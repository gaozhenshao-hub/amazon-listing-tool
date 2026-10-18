import { describe, expect, it } from "vitest";
import { createKnowledgeQaTestFixture } from "./knowledgeQa.testFixture";
import { createKnowledgeQaProcessor } from "./knowledgeQaWorker";

describe("knowledge QA paid checkpoint continuation boundaries", () => {
  it.each(["abort", "gate"] as const)("%s during a later claim does not discard an already-paid selector checkpoint", async mode => {
    const f = createKnowledgeQaTestFixture(), { input } = await f.submitted();
    f.control.afterPaid = async () => { f.control.enabled = false; };
    await f.process(input); expect((await f.check(input))?.state).toBe("running"); expect(f.control.paidCalls).toBe(1);
    f.control.afterPaid = null; f.control.enabled = true; f.control.now += 200; const controller = new AbortController();
    const process = createKnowledgeQaProcessor({ repository: { ...f.repository, claim: async (...args) => {
      const result = await f.repository.claim(...args); if (mode === "abort") controller.abort(); else f.control.enabled = false; return result;
    } }, runtime: f.runtime, enabled: () => f.control.enabled, loadConfiguration: async () => f.configuration });
    await process({ id: 1, ...f.identity, threadId: input.threadId, operationId: input.operationId }, controller.signal);
    const preserved = await f.check(input); expect(preserved?.state).toBe("running"); expect(preserved?.checkpoints[0].result).toHaveLength(10); expect(f.control.paidCalls).toBe(1);
    f.control.enabled = true; f.control.now += 200; await f.process(input); expect((await f.check(input))?.state).toBe("succeeded"); expect(f.control.paidCalls).toBe(3);
  });
});
