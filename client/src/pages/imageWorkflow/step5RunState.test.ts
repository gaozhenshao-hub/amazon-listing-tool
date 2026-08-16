import { describe, expect, it } from "vitest";
import { buildStep5SegmentStates, resolveCurrentStep5RunId } from "./step5RunState";

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

  it("按后台阶段进度展示主图、辅图、A+、品牌故事和合并状态", () => {
    const inAplus = Object.fromEntries(buildStep5SegmentStates(70).map((item) => [item.key, item.status]));
    expect(inAplus).toEqual({
      main: "complete",
      secondary: "complete",
      aplus: "running",
      brand: "running",
      merge: "pending",
    });
  });
});
