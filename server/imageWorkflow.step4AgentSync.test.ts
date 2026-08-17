import { describe, expect, it } from "vitest";
import { settleStep4AgentSync } from "./domains/image/services/step4ReferenceJob";

describe("Step4 Agent sync completion boundary", () => {
  it("returns after a successful Agent sync", async () => {
    await expect(settleStep4AgentSync(Promise.resolve(), 20)).resolves.toBe("synced");
  });

  it("does not let a stalled Agent sync block the AI Job completion path", async () => {
    const stalled = new Promise<void>(() => undefined);
    await expect(settleStep4AgentSync(stalled, 5)).resolves.toBe("timed_out");
  });
});
