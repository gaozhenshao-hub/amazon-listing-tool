import { describe, expect, it } from "vitest";
import { settleStep5AgentSync } from "./domains/image/routerContext";

describe("Step5 Agent同步边界", () => {
  it("正常同步完成时不影响业务任务", async () => {
    await expect(settleStep5AgentSync(Promise.resolve(), 50)).resolves.toBe("synced");
  });

  it("卡住的同步会超时降级，不阻塞Step5皇帝Skill调用", async () => {
    const pending = new Promise<void>(() => undefined);
    await expect(settleStep5AgentSync(pending, 5)).resolves.toBe("timed_out");
  });

  it("同步拒绝会降级为failed，不阻塞Step5业务任务", async () => {
    await expect(settleStep5AgentSync(Promise.reject(new Error("Agent unavailable")), 50)).resolves.toBe("failed");
  });
});
