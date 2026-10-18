import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ getDb: vi.fn(), http: vi.fn(), legacy: vi.fn(), key: vi.fn(), metric: vi.fn(), evaluation: vi.fn(), rollout: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ getDb: io.getDb, requireDb: io.getDb }));
vi.mock("../../_core/llm", () => ({ invokeLLM: io.legacy }));
vi.mock("../../infrastructure/http/safeHttpClient", () => ({ SafeHttpError: class extends Error {}, safeHttpRequest: io.http }));
vi.mock("../ai_os/services/teamorouterCatalog", async original => ({ ...await original<object>(), resolveGovernedModelApiKey: io.key }));
vi.mock("../ai_os/services/observability", () => ({ recordAiOsMetric: io.metric, recordAiOsEvaluation: io.evaluation }));
vi.mock("../ai_os/services/skillRollout", () => ({ resolveActiveSkillRollout: io.rollout }));
import { createKnowledgeQaTestFixture } from "./knowledgeQa.testFixture";
import { createKnowledgeQaRuntime, createFixedKnowledgeQaApprovalResolver } from "./knowledgeQaRuntime";
import { strictSkillAuditIdentity } from "../ai_os/services/strictSkillRuntime";
import type { KnowledgeQaStage } from "../../../shared/knowledgeQa";
const dialect = new MySqlDialect();
beforeEach(() => { vi.clearAllMocks(); io.key.mockReturnValue("SYNTHETIC_NOT_A_CREDENTIAL"); io.legacy.mockImplementation(() => { throw new Error("NO_LEGACY_MODEL"); }); io.metric.mockResolvedValue({ recorded: true }); io.evaluation.mockResolvedValue({ recorded: true }); io.rollout.mockResolvedValue(null); });
afterEach(() => vi.restoreAllMocks());
async function fixture(stageKey: KnowledgeQaStage = "answer") {
  const f = createKnowledgeQaTestFixture(), source = await f.repository.source(f.identity, f.previewInput), writes: Array<{ sql: string; params: unknown[] }> = [];
  const executor = { execute: async (query: SQL) => { const statement = dialect.sqlToQuery(query); if (!statement.sql.startsWith("SELECT")) { writes.push(statement); return [{ affectedRows: 1 }]; } return f.tx.execute(query); } };
  io.getDb.mockResolvedValue(executor);
  const runtime = createKnowledgeQaRuntime({ approvalResolver: createFixedKnowledgeQaApprovalResolver(f.approvals), credentialResolver: io.key });
  const input = { executor, source, operationId: f.previewInput.operationId, configuration: f.configuration }, { runtimeSnapshot } = await runtime.prepare(input);
  const indices = stageKey === "l1_select" ? [] : Array.from({ length: stageKey === "answer" ? 5 : 10 }, (_, index) => index + 1);
  const prepared = await runtime.prepareStage({ ...input, runtimeSnapshot, stageKey, indices });
  const content = stageKey === "answer" ? "# SYNTHETIC 实际 Markdown\n\n完整回答 [引用1]" : JSON.stringify({ selectedIndices: [1, 2], reasoning: "SYNTHETIC" });
  io.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 50, completion_tokens: 30 } }) });
  const fence = vi.fn(async (_receipt: unknown, verify: Parameters<Parameters<typeof runtime.executeStage>[1]["beforeDispatch"]>[1]) => { await verify(executor, f.configuration, source); });
  return { f, source, executor, runtime, prepared, content, fence, writes };
}
describe("knowledge QA real strict runner and synthetic SQL/HTTP transport", () => {
  it.each(["l1_select", "l2_select", "answer"] as const)("%s uses exact frozen source, Skill/model and its distinct audit identity", async stage => {
    const f = await fixture(stage), result = await f.runtime.executeStage(f.prepared, { beforeDispatch: f.fence });
    expect(result.candidate).toEqual(stage === "answer" ? f.content : [1, 2]); expect(result.tokensUsed).toBe(80); expect(io.http).toHaveBeenCalledOnce(); expect(f.fence).toHaveBeenCalledOnce();
    const request = io.http.mock.calls[0][1], body = JSON.parse(request.body);
    expect(request.auditContext.operation).toBe(strictSkillAuditIdentity(stage === "answer" ? "knowledge_answer" : "knowledge_select").operation);
    expect(body.messages[0].content).toBe("SYNTHETIC ORIGINAL"); expect(request.body).toContain("SAVED_KNOWLEDGE_INSTRUCTION"); expect(request.body).toContain("SAVED_KNOWLEDGE_RULE"); expect(request.body).toContain("SAVED_BINDING");
    expect(body.response_format).toEqual(stage === "answer" ? undefined : { type: "json_object" }); expect(io.legacy).not.toHaveBeenCalled(); expect(io.rollout).not.toHaveBeenCalled();
    expect(f.writes.every(item => /emperor_skill_runs|emperor_skills/u.test(item.sql))).toBe(true); expect(JSON.stringify(f.writes)).not.toMatch(/FULL ORIGINAL|SAVED_KNOWLEDGE_RULE|SYNTHETIC_NOT_A_CREDENTIAL/u);
    await expect(f.runtime.executeStage(f.prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" }); expect(io.http).toHaveBeenCalledOnce();
  });
  it("does not send HTTP until actual fresh verification and the durable fence ACK", async () => {
    const f = await fixture(); let release!: () => void;
    const running = f.runtime.executeStage(f.prepared, { beforeDispatch: async (receipt, verify) => { await f.fence(receipt, verify); await new Promise<void>(resolve => { release = resolve; }); } });
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(io.http).not.toHaveBeenCalled(); release(); await running; expect(io.http).toHaveBeenCalledOnce();
  });
  it.each(["no_verify", "unawaited", "twice", "lost_ack", "source", "configuration", "authority"] as const)("%s cannot cause a paid fallback or second call", async mode => {
    const f = await fixture(); await expect(f.runtime.executeStage(f.prepared, { beforeDispatch: async (receipt, verify) => {
      if (mode === "no_verify") return; if (mode === "unawaited") { void verify(f.executor, f.f.configuration, f.source); return; }
      if (mode === "source") f.source.question = "Changed after preview";
      if (mode === "configuration") f.f.configuration.config.rules.push("Changed after preview");
      if (mode === "authority") throw new Error("SYNTHETIC_DENIED");
      await f.fence(receipt, verify); if (mode === "twice") await f.fence(receipt, verify); if (mode === "lost_ack") throw new Error("SYNTHETIC_ACK_LOST");
    } })).rejects.toBeInstanceOf(Error); expect(io.http).not.toHaveBeenCalled(); expect(io.legacy).not.toHaveBeenCalled();
  });
  it.each(["network", "bad_citation", "no_citation"] as const)("paid %s is unknown and never retried", async mode => {
    const f = await fixture(); if (mode === "network") io.http.mockRejectedValue(new Error("PRIVATE_PROVIDER_BODY"));
    else io.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: mode === "bad_citation" ? "Wrong [引用99]" : "Uncited unsupported answer" } }] }) });
    await expect(f.runtime.executeStage(f.prepared, { beforeDispatch: f.fence })).rejects.toBeInstanceOf(Error); expect(io.http).toHaveBeenCalledOnce(); expect(io.legacy).not.toHaveBeenCalled();
    await expect(f.runtime.executeStage(f.prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
  });
});
