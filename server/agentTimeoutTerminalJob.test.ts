import { describe, expect, it } from "vitest";
import { shouldFinalizeTimedOutNodeForTerminalJob } from "./domains/ai_os/services/agentRunner/execution";

describe("超时Agent节点的终态任务收敛", () => {
  it("只对已失败或已取消的关联AI任务收敛节点，而不重复进入重试分支", () => {
    expect(shouldFinalizeTimedOutNodeForTerminalJob("failed")).toBe(true);
    expect(shouldFinalizeTimedOutNodeForTerminalJob("canceled")).toBe(true);
    expect(shouldFinalizeTimedOutNodeForTerminalJob("queued")).toBe(false);
    expect(shouldFinalizeTimedOutNodeForTerminalJob("running")).toBe(false);
    expect(shouldFinalizeTimedOutNodeForTerminalJob("succeeded")).toBe(false);
  });
});
