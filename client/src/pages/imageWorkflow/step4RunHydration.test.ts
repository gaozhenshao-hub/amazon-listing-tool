import { describe, expect, it } from "vitest";
import { shouldApplyStep4RunOutput } from "./step4RunHydration";

describe("Step4任务输出前端水合", () => {
  it("仅将当前页面实际启动且成功的任务结果写入编辑状态", () => {
    expect(shouldApplyStep4RunOutput({
      status: "succeeded",
      wasStartedInCurrentView: true,
      hasImageReferences: true,
    })).toBe(true);
  });

  it("不允许历史成功任务覆盖已经保存的本地参考图草稿", () => {
    expect(shouldApplyStep4RunOutput({
      status: "succeeded",
      wasStartedInCurrentView: false,
      hasImageReferences: true,
    })).toBe(false);
  });

  it("不处理缺少参考图或尚未成功的任务", () => {
    expect(shouldApplyStep4RunOutput({
      status: "running",
      wasStartedInCurrentView: true,
      hasImageReferences: true,
    })).toBe(false);
    expect(shouldApplyStep4RunOutput({
      status: "succeeded",
      wasStartedInCurrentView: true,
      hasImageReferences: false,
    })).toBe(false);
  });
});
