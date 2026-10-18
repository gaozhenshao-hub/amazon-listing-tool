import { describe, expect, it, vi } from "vitest";
import { createCompetitorDeepProcessor } from "./competitorDeepWorker";
import { createCompetitorDeepExecution } from "./competitorDeepExecution";
import { deepFixture, clone } from "./competitorDeepJob.testFixture";
import { deepPublicView } from "./competitorDeepJob";
import type { CompetitorDeepJobSession, DeepJob } from "../../../repositories/listing/competitorDeepJobRepository";
import type { CompetitorDeepPublicationStore } from "../../../repositories/listing/competitorDeepExecutionRepository";
async function harness() {
  const h = await deepFixture(); let job = clone(h.job), enabled = true, fenced = false, evidenceChanged = false, publishLostAck = false, failPublish = false;
  const writes: string[] = [];
  const session = { executor: h.executor, agent: vi.fn(async () => undefined), job: vi.fn(async () => clone(job)), authorize: vi.fn(async () => ({ revision: h.input.expectedRevision, analysis: { summaryStatus: "draft" }, sourceWorkspaceId: 7 })),
    fence: vi.fn(async () => fenced), lease: vi.fn((row: DeepJob, token: string) => { if (row.status !== "running" || row.lockedBy !== token || !row.leaseUntil || new Date(row.leaseUntil).getTime() <= Date.now()) throw new Error("LOST_LEASE"); }),
    write: vi.fn(async (query: string, values: unknown[]) => { writes.push(query);
      if (query.includes("status='running',attempt=1")) job = { ...job, status: "running", attempt: 1, lockedBy: String(values[0]), leaseUntil: new Date(Date.now() + 180000) };
      else if (query.includes("status='failed'")) job = { ...job, status: "failed", lockedBy: null, leaseUntil: null };
      else if (query.includes("DATE_SUB")) job = { ...job, lockedBy: null, leaseUntil: new Date(0) };
    }),
  } as unknown as CompetitorDeepJobSession;
  const repository = { transaction: async <T>(body: (s: CompetitorDeepJobSession) => Promise<T>) => body(session), next: vi.fn() };
  const store = { read: vi.fn(async () => clone(job.input.journal)), assertCurrent: vi.fn(async () => { if (fenced || job.status !== "running") throw new Error("CANCELED"); }),
    compareAndSwap: vi.fn(async (expected: string, journal: DeepJob["input"]["journal"]) => { if (fenced || job.input.journal.journalHash !== expected) throw new Error("CAS"); job.input.journal = clone(journal); return clone(journal); }),
    publish: vi.fn(async () => { if (failPublish) { failPublish = false; throw new Error("PUBLICATION_ROLLBACK"); } job.status = "succeeded"; job.progress = 100; if (publishLostAck) throw new Error("LOST_PUBLISH_ACK"); return {}; }),
  } as unknown as CompetitorDeepPublicationStore;
  const process = createCompetitorDeepProcessor({ repository, runtime: h.runtime, evidence: { load: vi.fn(async () => evidenceChanged ? { ...clone(h.evidence), evidenceHash: "f".repeat(64) } : clone(h.evidence)), preview: vi.fn() },
    store: () => store, enabled: () => enabled });
  return { h, process, store, session, writes, job: () => job, setJob: (value: DeepJob) => { job = value; }, disable: () => { enabled = false; }, cancel: () => { fenced = true; },
    changeEvidence: () => { evidenceChanged = true; }, losePublishAck: () => { publishLostAck = true; }, failNextPublish: () => { failPublish = true; } };
}
describe("deep dedicated processor: real kernel and synthetic provider", () => {
  it("runs all required stages, preserves missing reviews, and publishes only pending-review draft", async () => {
    const h = await harness(); await h.process(h.h.job.runId, new AbortController().signal);
    expect(h.h.paid()).toBe(3); expect(h.store.publish).toHaveBeenCalledTimes(1); expect(h.job().status).toBe("succeeded");
    expect(h.job().input.journal.steps.map(step => step.status)).toEqual(["succeeded", "succeeded", "missing", "succeeded"]);
  });
  it("does not claim or dispatch when default gate is off", async () => {
    const h = await harness(); h.disable(); await h.process(h.h.job.runId, new AbortController().signal); expect(h.session.job).not.toHaveBeenCalled(); expect(h.h.paid()).toBe(0);
  });
  it("expired dispatched work becomes unknown without another provider call", async () => {
    const h = await harness(), job = h.job();
    await expect(createCompetitorDeepExecution(job.input.evidence, job.input.skills).runNext(h.store, async () => { throw new Error("PAID_UNKNOWN"); }, new AbortController().signal)).rejects.toThrow();
    // The first write is enough; the lease/status assertion deliberately stops
    // this fixture after durable dispatched, before any synthetic provider.
    h.setJob({ ...job, status: "running", attempt: 1, lockedBy: "old", leaseUntil: new Date(0) });
    await h.process(job.runId, new AbortController().signal); expect(h.h.paid()).toBe(0); expect(h.store.publish).not.toHaveBeenCalled();
    expect(deepPublicView({ userId: 3, workspaceId: 7 }, { projectId: 11, analysisId: 21, expectedWorkspaceId: 7, operationId: h.h.input.operationId }, h.job(), h.h.input.expectedRevision).status).toBe("unknown");
  });
  it("provider unknown is kept dispatched, not automatically retried", async () => {
    const h = await harness(); h.h.failProvider(); await h.process(h.h.job.runId, new AbortController().signal); expect(h.h.paid()).toBe(1); expect(h.job().input.journal.steps[0].status).toBe("dispatched");
    await h.process(h.h.job.runId, new AbortController().signal); expect(h.h.paid()).toBe(1); expect(h.store.publish).not.toHaveBeenCalled();
  });
  it("changed complete original evidence prevents the first dispatch", async () => {
    const h = await harness(); h.changeEvidence(); await h.process(h.h.job.runId, new AbortController().signal); expect(h.h.paid()).toBe(0); expect(h.store.publish).not.toHaveBeenCalled();
  });
  it("cancel fence before claim never executes", async () => {
    const h = await harness(); h.cancel(); await h.process(h.h.job.runId, new AbortController().signal); expect(h.h.paid()).toBe(0); expect(h.writes).toHaveLength(0);
  });
  it("publication ACK loss does not overwrite persisted success or call again", async () => {
    const h = await harness(); h.losePublishAck(); await h.process(h.h.job.runId, new AbortController().signal); expect(h.job().status).toBe("succeeded"); expect(h.h.paid()).toBe(3);
    await h.process(h.h.job.runId, new AbortController().signal); expect(h.h.paid()).toBe(3); expect(h.store.publish).toHaveBeenCalledTimes(1);
  });
  it("completed checkpoints restart and publish locally with zero additional calls", async () => {
    const h = await harness(); await h.process(h.h.job.runId, new AbortController().signal); const calls = h.h.paid();
    h.setJob({ ...h.job(), status: "running", attempt: 1, lockedBy: "old", leaseUntil: new Date(0) }); await h.process(h.h.job.runId, new AbortController().signal);
    expect(h.h.paid()).toBe(calls); expect(h.store.publish).toHaveBeenCalledTimes(2);
  });
  it("failed publication retains complete paid checkpoints for same-UUID local recovery", async () => {
    const h = await harness(); h.failNextPublish(); await h.process(h.h.job.runId, new AbortController().signal);
    expect(h.job().status).toBe("running"); expect(new Date(h.job().leaseUntil!).getTime()).toBeLessThan(Date.now()); expect(h.h.paid()).toBe(3);
    await h.process(h.h.job.runId, new AbortController().signal); expect(h.job().status).toBe("succeeded"); expect(h.h.paid()).toBe(3); expect(h.store.publish).toHaveBeenCalledTimes(2);
  });
});
