import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Step4重新推荐前置校验", () => {
  it("在未确认Step3时返回可操作的风格确认提示，而不是通用内部错误", () => {
    const source = readFileSync(new URL("./domains/image/routers/workflowSteps.ts", import.meta.url), "utf8");
    expect(source).toContain("请先在 Step 3 确认视觉风格，再生成或重新推荐参考图");
    expect(source).toContain('code: "BAD_REQUEST"');
  });
});
