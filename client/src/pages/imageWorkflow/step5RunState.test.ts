import { describe, expect, it } from "vitest";
import { resolveCurrentStep5RunId } from "./step5RunState";

describe("Step5当前运行选择", () => {
  it("不追踪失败会话遗留的旧runId", () => {
    expect(resolveCurrentStep5RunId({
      activeRunId: null,
      sessionRunId: "old_failed_run",
      sessionRunStatus: "failed",
    })).toBeNull();
  });

  it("继续追踪仍在执行的会话runId", () => {
    expect(resolveCurrentStep5RunId({
      activeRunId: null,
      sessionRunId: "active_run",
      sessionRunStatus: "running",
    })).toBe("active_run");
  });

  it("重新生成时优先追踪新返回的runId", () => {
    expect(resolveCurrentStep5RunId({
      activeRunId: "new_run",
      sessionRunId: "old_failed_run",
      sessionRunStatus: "failed",
    })).toBe("new_run");
  });
});
