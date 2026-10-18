import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), http: vi.fn(), key: vi.fn(), legacy: vi.fn(), metric: vi.fn(), evaluation: vi.fn(), rollout: vi.fn() }));
vi.mock("../../../repositories/dbClient", async original => ({ ...await original<object>(), getDb: mocks.db }));
vi.mock("../../../_core/llm", () => ({ invokeLLM: mocks.legacy }));
vi.mock("../../../infrastructure/http/safeHttpClient", () => ({ SafeHttpError: class extends Error {}, safeHttpRequest: mocks.http }));
vi.mock("../../ai_os/services/teamorouterCatalog", async original => ({ ...await original<object>(), resolveGovernedModelApiKey: mocks.key }));
vi.mock("../../ai_os/services/observability", () => ({ recordAiOsMetric: mocks.metric, recordAiOsEvaluation: mocks.evaluation }));
vi.mock("../../ai_os/services/skillRollout", () => ({ resolveActiveSkillRollout: mocks.rollout }));
import { createListingAuxiliaryTestFixture } from "./listingAuxiliary.testFixture";
import { createListingAuxiliaryRuntime, createFixedListingAuxiliaryApprovalResolver, listingAuxiliaryNextAttempt } from "./listingAuxiliaryRuntime";
import { ListingAuxiliaryApprovalSchema, ListingAuxiliaryRuntimeSnapshotSchema } from "./listingAuxiliaryRuntimeContract";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow } from "../../ai_os/services/strictSkillRuntime";
beforeEach(() => { vi.clearAllMocks(); mocks.key.mockReturnValue("SYNTHETIC_NOT_REAL"); mocks.metric.mockResolvedValue({ recorded: true }); mocks.evaluation.mockResolvedValue({ recorded: true }); mocks.rollout.mockResolvedValue(null);
  mocks.legacy.mockImplementation(() => { throw new Error("NO_LEGACY_PROVIDER"); }); vi.stubEnv("LISTING_AUXILIARY_APPROVAL_FILE", undefined); vi.stubEnv("LISTING_AUXILIARY_APPROVAL_SHA256", undefined); });
afterEach(() => vi.unstubAllEnvs());
async function fixture(operation: Parameters<typeof createListingAuxiliaryTestFixture>[0] = "checkTitle") {
  const f = createListingAuxiliaryTestFixture(operation), dialect = new MySqlDialect(), source = await f.capture();
  const executor = { execute: async (query: SQL) => { const statement = dialect.sqlToQuery(query); return statement.sql.startsWith("SELECT") ? f.tx.execute(query) : [{ affectedRows: 1 }]; } };
  mocks.db.mockResolvedValue(executor); mocks.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: JSON.stringify(f.good[operation]) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) });
  const runtime = createListingAuxiliaryRuntime({ approvals: async () => structuredClone(f.approvals), credential: mocks.key });
  const input = { executor, source, configuration: f.configuration }, { runtimeSnapshot } = await runtime.prepare(input);
  const stage = () => runtime.prepareStage({ ...input, runtimeSnapshot, attempt: { operation, targetIndex: 0, qualityAttempt: 0, modelIndex: 0 }, previous: null });
  const fence: Parameters<typeof runtime.executeStage>[1]["beforeDispatch"] = async (_receipt, verify) => { await verify(executor, source, f.configuration); };
  return { ...f, executor, source, input, runtime, runtimeSnapshot, stage, fence };
}
describe("Listing exact user Skill and original output runtime, real strict runner with synthetic HTTP", () => {
  it.each(["keywordFabe", "optimizeBullet", "checkBullet", "checkDescription", "checkSearchTerms", "checkQa"] as const)("%s reaches its actual strict stage and keeps full original output", async operation => {
    const f = await fixture(operation), result = await f.runtime.executeStage(await f.stage(), { beforeDispatch: f.fence });
    expect(result.returned.candidate).not.toBeNull(); expect(result.returned.issues).toEqual([]); expect(mocks.http).toHaveBeenCalledOnce();
    const payload = JSON.parse(mocks.http.mock.calls[0][1].body), user = payload.messages[1].content;
    expect(user).toContain("submittedDraftIsNotProductEvidence");
    if (operation === "checkSearchTerms") { expect(user).toContain("Current local title"); expect(user).toContain("Local full text"); }
    if (operation === "optimizeBullet") { expect(user).toContain("Initial draft:"); expect(user).toContain("Clarify the grounded buyer benefit."); }
    if (operation === "checkQa") { expect(user).toContain("Current question"); expect(user).toContain("Current answer"); }
  });
  it("unconfigured approval is unavailable before registry/model access", async () => {
    const f = await fixture(), executor = { execute: vi.fn() }; await expect(createListingAuxiliaryRuntime().prepare({ ...f.input, executor })).rejects.toMatchObject({ code: "SOURCE_APPROVAL_UNAVAILABLE" }); expect(executor.execute).not.toHaveBeenCalled();
  });
  it("binds saved instructions/rules/binding and complete source in one actual strict HTTP call", async () => {
    const f = await fixture(), prepared = await f.stage(), result = await f.runtime.executeStage(prepared, { beforeDispatch: f.fence });
    expect(result.returned.candidate).toMatchObject({ checkListScores: { readability: { pass: true, reason: "synthetic reason" } } }); expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.rollout).not.toHaveBeenCalled();
    const request = mocks.http.mock.calls[0][1]; expect(request.auditContext.operation).toBe("listing.auxiliary.check_title.strict");
    expect(request.body).toContain("SYNTHETIC_SAVED_INSTRUCTIONS"); expect(request.body).toContain("SYNTHETIC_SAVED_RULE"); expect(request.body).toContain("SYNTHETIC_BINDING");
    expect(request.body).toContain("smooth woven fabric"); expect(JSON.parse(request.body).messages[0].content).toBe("SYNTHETIC_USER_OWNED_PROMPT");
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" }); expect(mocks.http).toHaveBeenCalledOnce();
  });
  it.each(["qingdao", "reviewed_supplement", "friend"])("never accepts %s as user Listing source approval", async origin => { const f = await fixture(); expect(ListingAuxiliaryApprovalSchema.safeParse({ ...f.approvals[0], source: { ...f.approvals[0].source, origin } }).success).toBe(false); });
  it.each(["inputContract", "outputContract", "skillSlug", "maxQualityRepairs", "originalPreset"])("binds approved original policy field %s", async field => {
    const f = await fixture(); expect(ListingAuxiliaryApprovalSchema.safeParse({ ...f.approvals.find(row => row.operation === "checkTitle"), [field]: field === "maxQualityRepairs" ? 2 : "changed" }).success).toBe(false);
  });
  it("cannot mint duplicate approval mappings, incomplete total budget, or changed model snapshot", async () => {
    const f = await fixture(); expect(() => createFixedListingAuxiliaryApprovalResolver([f.approvals[0], f.approvals[0]])).toThrow();
    expect(ListingAuxiliaryRuntimeSnapshotSchema.safeParse({ ...f.runtimeSnapshot, maxCalls: 0 }).success).toBe(false);
    f.modelRow.costPer1kInputTokens = "0.02"; await expect(f.stage()).rejects.toMatchObject({ code: "APPROVED_MODEL_CHANGED" }); expect(mocks.http).not.toHaveBeenCalled();
  });
  it.each(["no_verify", "twice", "not_awaited", "ack_lost", "config", "source", "source_body", "approval", "skill"])("%s cannot reach HTTP", async kind => {
    const f = await fixture(), stage = await f.stage();
    await expect(f.runtime.executeStage(stage, { beforeDispatch: async (_receipt, verify) => {
      if (kind === "no_verify") return;
      if (kind === "not_awaited") { void verify(f.executor, f.source, f.configuration); return; }
      if (kind === "config") { f.configuration.config.rules.push("CHANGED"); f.configuration.hash = configurationHash(f.configuration.config); }
      if (kind === "source") f.source.sourceHash = "f".repeat(64);
      if (kind === "source_body") f.source.tables.projects[0].name = "CHANGED_WITHOUT_REHASH";
      if (kind === "approval") f.approvals.length = 0;
      if (kind === "skill") f.skillRows.find(row => row.slug === "listing.checklist.title")!.version++;
      await verify(f.executor, f.source, f.configuration); if (kind === "twice") await verify(f.executor, f.source, f.configuration); if (kind === "ack_lost") throw new Error("SYNTHETIC_ACK_LOST");
    } })).rejects.toBeDefined(); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("empty saved model inherits only the approved original model, never guessed default", async () => {
    const f = await fixture(); f.configuration.config.modelSlug = ""; f.configuration.hash = configurationHash(f.configuration.config); expect((await f.runtime.prepare(f.input)).runtimeSnapshot.entries[0].models[0].model.slug).toBe("synthetic-text");
    const row = f.skillRows.find(row => row.slug === "listing.checklist.title")!; row.modelOverride = "";
    f.approvals.find(row => row.operation === "checkTitle")!.skillSnapshotHash = assistantConversationSkillSnapshotHash(assistantConversationSkillSnapshotFromRow({ ...row, modelOverride: null }).pin);
    await expect(f.runtime.prepare(f.input)).rejects.toBeDefined(); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("known invalid output is returned once for durable repair, while thrown provider is never retried", async () => {
    const f = await fixture(); mocks.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: "not JSON" } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) });
    const result = await f.runtime.executeStage(await f.stage(), { beforeDispatch: f.fence }); expect(result.returned).toMatchObject({ candidate: null, formatInvalid: true }); expect(mocks.http).toHaveBeenCalledOnce();
    expect(listingAuxiliaryNextAttempt(f.runtimeSnapshot, result.attempt, result.returned)).toBe("exhausted");
    const g = await fixture(); mocks.http.mockRejectedValue(new Error("SYNTHETIC_PROVIDER_UNKNOWN")); await expect(g.runtime.executeStage(await g.stage(), { beforeDispatch: g.fence })).rejects.toBeDefined(); expect(mocks.http).toHaveBeenCalledTimes(2);
  });
  it("known-format fallback is restricted to frozen approved route before bounded quality repair", async () => {
    const f = await fixture(), entry = f.runtimeSnapshot.entries[0], second = { ...f.modelRow, slug: "synthetic-backup" }, secondModel = strictModelSnapshotFromRow(7, second.slug, second);
    entry.models.push(secondModel); entry.approval.modelRoutes.push({ slug: second.slug, configurationHash: secondModel.configurationHash, maxCostCents: 100 });
    expect(listingAuxiliaryNextAttempt(f.runtimeSnapshot, { operation: "checkTitle", targetIndex: 0, qualityAttempt: 0, modelIndex: 0 }, { content: "bad", candidate: null, issues: ["FORMAT"], formatInvalid: true })).toEqual({ operation: "checkTitle", targetIndex: 0, qualityAttempt: 0, modelIndex: 1 });
    expect(listingAuxiliaryNextAttempt(f.runtimeSnapshot, { operation: "checkTitle", targetIndex: 0, qualityAttempt: 2, modelIndex: 1 }, { content: "bad", candidate: null, issues: ["FORMAT"], formatInvalid: true })).toBe("exhausted");
  });
  it("awaits dispatch transaction ACK and denies a copied prepared object", async () => {
    const f = await fixture(), stage = await f.stage(); await expect(f.runtime.executeStage({ ...stage }, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
    let release!: () => void; const running = f.runtime.executeStage(stage, { beforeDispatch: async (receipt, verify) => { await f.fence(receipt, verify); await new Promise<void>(resolve => { release = resolve; }); } });
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(mocks.http).not.toHaveBeenCalled(); release(); await running; expect(mocks.http).toHaveBeenCalledOnce();
  });
  it("actually executes only the explicitly approved backup after a known returned format error", async () => {
    const f = await fixture(), second = { ...f.modelRow, slug: "synthetic-backup", modelId: "synthetic-backup" };
    f.modelRows.push(second);
    const pin = strictModelSnapshotFromRow(7, second.slug, second), approval = f.approvals.find(row => row.operation === "checkTitle")!;
    approval.modelRoutes.push({ slug: second.slug, configurationHash: pin.configurationHash, maxCostCents: 100 });
    const { runtimeSnapshot } = await f.runtime.prepare(f.input);
    expect(runtimeSnapshot.maxCalls).toBe(2); expect(runtimeSnapshot.maxCostCents).toBe(200);
    mocks.http.mockResolvedValueOnce({ ok: true, json: () => ({ choices: [{ message: { content: "bad-json" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
    const attempt = { operation: "checkTitle" as const, targetIndex: 0, qualityAttempt: 0, modelIndex: 0 };
    const first = await f.runtime.executeStage(await f.runtime.prepareStage({ ...f.input, runtimeSnapshot, attempt, previous: null }), { beforeDispatch: f.fence });
    const next = listingAuxiliaryNextAttempt(runtimeSnapshot, attempt, first.returned); if (!next || next === "exhausted") throw new Error("MISSING_APPROVED_ROUTE");
    const result = await f.runtime.executeStage(await f.runtime.prepareStage({ ...f.input, runtimeSnapshot, attempt: next, previous: first.returned }), { beforeDispatch: f.fence });
    expect(result.returned.candidate?.checkListScores).toEqual(f.good.checkTitle.checkListScores);
    expect(mocks.http).toHaveBeenCalledTimes(2); expect(JSON.parse(mocks.http.mock.calls[1][1].body).model).toBe("synthetic-backup"); expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
