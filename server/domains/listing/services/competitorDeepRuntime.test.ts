import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompetitorDeepRuntime, createFixedCompetitorDeepApprovalResolver } from "./competitorDeepRuntime";
import { CompetitorDeepRuntimeSnapshotSchema, DEEP_STAGES } from "./competitorDeepRuntimeContract";
import { deepFixture, syntheticIdentity, clone } from "./competitorDeepJob.testFixture";
import { createCompetitorDeepExecution, type DeepExecutionRequest } from "./competitorDeepExecution";

afterEach(() => vi.unstubAllEnvs());
async function prepared(version: 1 | 2 = 2) {
  const h = await deepFixture(version); let request: DeepExecutionRequest | null = null, journal = h.stored.journal;
  await expect(createCompetitorDeepExecution(h.evidence, h.skills).runNext({ read: async () => journal,
    compareAndSwap: async (_hash, next) => journal = next, assertCurrent: async () => undefined }, async value => { request = value; throw new Error("CAPTURE_REQUEST"); }, new AbortController().signal)).rejects.toThrow("CAPTURE_REQUEST");
  const stage = await h.runtime.prepareStage({ executor: h.executor, identity: syntheticIdentity, runtime: h.snapshot, request: request! });
  return { h, stage, request: request!, invoke: () => h.runtime.invoke({ prepared: stage, signal: new AbortController().signal, beforeDispatch: async (_receipt, verify) => { await verify(h.executor); } }) };
}
describe("deep user-primary runtime (synthetic registry, never a real model)", () => {
  it("defaults to unavailable without registry/model work", async () => {
    vi.stubEnv("LISTING_DEEP_ANALYSIS_APPROVAL_FILE", undefined); vi.stubEnv("LISTING_DEEP_ANALYSIS_APPROVAL_SHA256", undefined);
    const executor = { execute: vi.fn() };
    await expect(createCompetitorDeepRuntime().prepare(executor, syntheticIdentity)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" }); expect(executor.execute).not.toHaveBeenCalled();
  });
  it("requires all five explicit mappings, not Released/name discovery", async () => {
    const h = await deepFixture(); h.setApprovals(h.getApprovals().slice(0, 4)); await expect(h.runtime.prepare(h.executor, syntheticIdentity)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" }); expect(h.paid()).toBe(0);
  });
  it("rejects duplicate workspace-stage mappings", async () => {
    const h = await deepFixture(); expect(() => createFixedCompetitorDeepApprovalResolver([...h.getApprovals(), h.getApprovals()[0]])).toThrow("APPROVAL_AMBIGUOUS");
  });
  it("binds exact user source, model budget and full registry pins", async () => {
    const h = await deepFixture(); expect(CompetitorDeepRuntimeSnapshotSchema.safeParse(h.snapshot).success).toBe(true);
    const bad = clone(h.snapshot); bad.stages[0].approval.source.origin = "qingdao" as "user_listing"; expect(CompetitorDeepRuntimeSnapshotSchema.safeParse(bad).success).toBe(false);
    h.rows[0].version++; await expect(h.runtime.revalidate(h.executor, h.snapshot, syntheticIdentity)).rejects.toMatchObject({ code: "CONFIGURATION_SKILL_MISMATCH" });
  });
  it("runs strict pinned mode once after awaited fresh fence and returns original raw result", async () => {
    const p = await prepared(), output = await p.invoke(); expect(output.raw).toMatchObject({ titleZh: "灯" }); expect(p.h.paid()).toBe(1);
    expect(p.h.calls[0]).toMatchObject({ skillVersionPolicy: "pinned", variables: { agentKey: "listing", agentRevision: 1, stage: "title" }, maxModelAttempts: 1, fallbackModels: [], strictExecution: { stage: "competitor_deep" } });
    await expect(p.invoke()).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" }); expect(p.h.paid()).toBe(1);
  });
  it("rejects missing awaited authorization before any provider call", async () => {
    const p = await prepared(); await expect(p.h.runtime.invoke({ prepared: p.stage, signal: new AbortController().signal, beforeDispatch: async () => undefined })).rejects.toMatchObject({ code: "DISPATCH_DENIED" }); expect(p.h.paid()).toBe(0);
  });
  it("rejects changed approvals during the final fence", async () => {
    const p = await prepared(); p.h.setApprovals([]); await expect(p.invoke()).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" }); expect(p.h.paid()).toBe(0);
  });
  it("does not retry a thrown provider or reuse its consumed stage", async () => {
    const p = await prepared(); p.h.failProvider(); await expect(p.invoke()).rejects.toThrow("SYNTHETIC_PROVIDER_UNKNOWN"); await expect(p.invoke()).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" }); expect(p.h.paid()).toBe(1);
  });
  it("does not accept a runner that omits the dispatch callback", async () => {
    const p = await prepared(); p.h.skipFence(); await expect(p.invoke()).rejects.toMatchObject({ code: "RESULT_RECEIPT_INVALID" });
  });
  it("rejects budget evidence tampering instead of inventing a budget", async () => {
    const h = await deepFixture(), records = h.getApprovals(); records[0].maxCostCents = 0; h.setApprovals(records);
    const newer = await h.runtime.prepare(h.executor, syntheticIdentity); const p = await prepared();
    const request = { ...p.request, binding: newer.skills.title };
    const stage = await h.runtime.prepareStage({ executor: h.executor, identity: syntheticIdentity, runtime: newer.runtime, request });
    await expect(h.runtime.invoke({ prepared: stage, signal: new AbortController().signal, beforeDispatch: async (_receipt, verify) => { await verify(h.executor); } })).rejects.toMatchObject({ code: "COST_BUDGET_EXCEEDED" }); expect(h.paid()).toBe(0);
  });
  it.each(DEEP_STAGES)("renders saved shared rules and exact binding instructions for %s", async key => {
    const p = await prepared(), request = { ...p.request, stage: key === "buyers_batch" ? "buyers:0" as const : key, binding: p.h.skills[key] };
    const stage = await p.h.runtime.prepareStage({ executor: p.h.executor, identity: syntheticIdentity, runtime: p.h.snapshot, request });
    await p.h.runtime.invoke({ prepared: stage, signal: new AbortController().signal, beforeDispatch: async (_receipt, verify) => { await verify(p.h.executor); } });
    expect(JSON.parse(String(p.h.calls[0].context))).toMatchObject({ schema: "competitor-deep-agent-input/v2", agent: {
      key: "listing", revision: 1, hash: p.h.configuration.configHash, instructions: "SYNTHETIC_SAVED_INSTRUCTIONS", rules: ["SYNTHETIC_SAVED_RULE"],
      skill: { slug: `synthetic.${key}`, trigger: `trigger:synthetic.${key}`, instructions: `instructions:synthetic.${key}` } } });
    expect(p.h.calls[0].modelOverride).toBe(p.h.config.modelSlug);
  });
  it("keeps unsaved drafts out of invocation, but saved version changes block paid dispatch", async () => {
    const p = await prepared(); p.h.config.rules.push("UNSAVED_ONLY"); await p.invoke(); expect(String(p.h.calls[0].context)).not.toContain("UNSAVED_ONLY");
    const q = await prepared(); q.h.config.rules.push("SAVED_RULE"); q.h.saveConfiguration();
    await expect(q.invoke()).rejects.toMatchObject({ code: "APPROVED_RUNTIME_CHANGED" }); expect(q.h.paid()).toBe(0);
  });
  it.each(["removed", "disabled", "version", "manifest"])("rejects %s saved Skill binding rather than substituting another source", async change => {
    const h = await deepFixture();
    if (change === "removed") h.config.skills.shift();
    else if (change === "disabled") h.config.skills[0].enabled = false;
    else if (change === "version") h.config.skills[0].version++;
    else h.config.skills[0].manifestSha256 = "f".repeat(64);
    h.saveConfiguration(); await expect(h.runtime.prepare(h.executor, syntheticIdentity)).rejects.toMatchObject({ code: "CONFIGURATION_SKILL_MISMATCH" }); expect(h.paid()).toBe(0);
  });
  it("empty model inherits only an exact approved Skill model, never an inferred registry default", async () => {
    const h = await deepFixture(); h.config.modelSlug = ""; h.saveConfiguration();
    await expect(h.runtime.prepare(h.executor, syntheticIdentity)).rejects.toMatchObject({ code: "MODEL_BINDING_MISMATCH" });
    h.rows.forEach(row => { row.modelOverride = h.model.slug; });
    const { assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } = await import("../../ai_os/services/assistantConversationSourcePrimitives");
    h.setApprovals(h.getApprovals().map((approval, i) => ({ ...approval, skillSnapshotHash: assistantConversationSkillSnapshotHash(assistantConversationSkillSnapshotFromRow(h.rows[i]).pin) })));
    expect((await h.runtime.prepare(h.executor, syntheticIdentity)).runtime.version).toBe(2);
    h.config.modelSlug = "unapproved-other-model"; h.saveConfiguration();
    await expect(h.runtime.prepare(h.executor, syntheticIdentity)).rejects.toMatchObject({ code: "MODEL_BINDING_MISMATCH" });
  });
  it("fresh agent permissions are rechecked in the final transaction, not from a saved actor role", async () => {
    const p = await prepared(); p.h.permission.mockRejectedValue(new Error("SYNTHETIC_DENIED"));
    await expect(p.invoke()).rejects.toMatchObject({ code: "ACCESS_DENIED" }); expect(p.h.paid()).toBe(0);
    const q = await prepared(); q.h.actor.defaultWorkspaceId = 8;
    await expect(q.invoke()).rejects.toMatchObject({ code: "ACCESS_DENIED" }); expect(q.h.paid()).toBe(0);
  });
  it("v1 resumes with its exact original context and no current Agent configuration or new permissions", async () => {
    const p = await prepared(1); p.h.configuration.configText = "corrupt current configuration must not be read"; p.h.permission.mockRejectedValue(new Error("NEW_AGENT_PERMISSION_DENIED"));
    await p.invoke(); expect(p.h.paid()).toBe(1); expect(p.h.calls[0].variables).toEqual({});
    const { canonicalCompetitorResearchEvidence } = await import("../../../../shared/competitorResearchEvidence");
    expect(p.h.calls[0].context).toBe(canonicalCompetitorResearchEvidence({ schema: "competitor-deep-input/v1", inputContract: "competitor_deep_evidence_v1", request: p.request }));
    expect(p.h.permission).not.toHaveBeenCalled();
  });
  it("v1 and v2 approvals coexist without ever authorizing the other payload contract", async () => {
    const old = await prepared(1), current = await deepFixture();
    old.h.setApprovals([...old.h.getApprovals(), ...current.getApprovals()]); await old.invoke();
    current.setApprovals(old.h.getApprovals().filter(item => item.inputContract === "competitor_deep_evidence_v1"));
    await expect(current.runtime.prepare(current.executor, syntheticIdentity)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    const legacy = await prepared(1); legacy.h.setApprovals((await deepFixture()).getApprovals());
    await expect(legacy.invoke()).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" }); expect(legacy.h.paid()).toBe(0);
  });
});
