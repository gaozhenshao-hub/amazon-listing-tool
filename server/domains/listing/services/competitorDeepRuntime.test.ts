import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompetitorDeepRuntime, createFixedCompetitorDeepApprovalResolver } from "./competitorDeepRuntime";
import { CompetitorDeepRuntimeSnapshotSchema } from "./competitorDeepRuntimeContract";
import { deepFixture, syntheticIdentity, clone } from "./competitorDeepJob.testFixture";
import { createCompetitorDeepExecution, type DeepExecutionRequest } from "./competitorDeepExecution";

afterEach(() => vi.unstubAllEnvs());
async function prepared() {
  const h = await deepFixture(); let request: DeepExecutionRequest | null = null, journal = h.stored.journal;
  await expect(createCompetitorDeepExecution(h.evidence, h.skills).runNext({ read: async () => journal,
    compareAndSwap: async (_hash, next) => journal = next, assertCurrent: async () => undefined }, async value => { request = value; throw new Error("CAPTURE_REQUEST"); }, new AbortController().signal)).rejects.toThrow("CAPTURE_REQUEST");
  const stage = await h.runtime.prepareStage({ executor: h.executor, identity: syntheticIdentity, runtime: h.snapshot, request: request! });
  return { h, stage, request: request!, invoke: () => h.runtime.invoke({ prepared: stage, signal: new AbortController().signal, beforeDispatch: async (_receipt, verify) => { await verify(h.executor); } }) };
}
describe("deep user-primary runtime (synthetic registry, never a real model)", () => {
  it("defaults to unavailable without registry/model work", async () => {
    vi.stubEnv("LISTING_DEEP_ANALYSIS_APPROVAL_FILE", undefined); vi.stubEnv("LISTING_DEEP_ANALYSIS_APPROVAL_SHA256", undefined);
    const executor = { execute: vi.fn() };
    await expect(createCompetitorDeepRuntime().prepare(executor, 7)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" }); expect(executor.execute).not.toHaveBeenCalled();
  });
  it("requires all five explicit mappings, not Released/name discovery", async () => {
    const h = await deepFixture(); h.setApprovals(h.getApprovals().slice(0, 4)); await expect(h.runtime.prepare(h.executor, 7)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" }); expect(h.paid()).toBe(0);
  });
  it("rejects duplicate workspace-stage mappings", async () => {
    const h = await deepFixture(); expect(() => createFixedCompetitorDeepApprovalResolver([...h.getApprovals(), h.getApprovals()[0]])).toThrow("APPROVAL_AMBIGUOUS");
  });
  it("binds exact user source, model budget and full registry pins", async () => {
    const h = await deepFixture(); expect(CompetitorDeepRuntimeSnapshotSchema.safeParse(h.snapshot).success).toBe(true);
    const bad = clone(h.snapshot); bad.stages[0].approval.source.origin = "qingdao" as "user_listing"; expect(CompetitorDeepRuntimeSnapshotSchema.safeParse(bad).success).toBe(false);
    h.rows[0].version++; await expect(h.runtime.revalidate(h.executor, h.snapshot)).rejects.toMatchObject({ code: "REGISTRY_UNAVAILABLE" });
  });
  it("runs strict pinned mode once after awaited fresh fence and returns original raw result", async () => {
    const p = await prepared(), output = await p.invoke(); expect(output.raw).toMatchObject({ titleZh: "灯" }); expect(p.h.paid()).toBe(1);
    expect(p.h.calls[0]).toMatchObject({ skillVersionPolicy: "pinned", variables: {}, maxModelAttempts: 1, fallbackModels: [], strictExecution: { stage: "competitor_deep" } });
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
    const newer = await h.runtime.prepare(h.executor, 7); const p = await prepared();
    const request = { ...p.request, binding: newer.skills.title };
    const stage = await h.runtime.prepareStage({ executor: h.executor, identity: syntheticIdentity, runtime: newer.runtime, request });
    await expect(h.runtime.invoke({ prepared: stage, signal: new AbortController().signal, beforeDispatch: async (_receipt, verify) => { await verify(h.executor); } })).rejects.toMatchObject({ code: "COST_BUDGET_EXCEEDED" }); expect(h.paid()).toBe(0);
  });
});
