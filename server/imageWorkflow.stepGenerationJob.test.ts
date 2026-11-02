import { describe, expect, it } from "vitest";
import { shouldApplyCompletedImageStepOutput } from "../client/src/pages/imageWorkflow/useImageStepGenerationJob";

describe("图片步骤任务结果写入", () => {
  it("仅将当前页面启动或恢复执行的成功任务写入编辑态", () => {
    expect(shouldApplyCompletedImageStepOutput({
      wasActive: true,
      status: "succeeded",
      output: { aPlusModules: [] },
    })).toBe(true);
  });

  it("页面刷新读取到的历史成功任务不得覆盖用户草稿", () => {
    expect(shouldApplyCompletedImageStepOutput({
      wasActive: false,
      status: "succeeded",
      output: { aPlusModules: [] },
    })).toBe(false);
  });
});
