import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { classifySellerSpriteBatchFailure } from "./sellerSpriteBatchFailure";

describe("SellerSprite batch failure classification", () => {
  it("returns a safe retryable provider message without leaking a provider response", () => {
    const failure = classifySellerSpriteBatchFailure(new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "AI 服务暂时不可用，请稍后重试",
      cause: { code: "PROVIDER_UNAVAILABLE", message: "Provider HTTP 503: private provider body" },
    }));

    expect(failure).toEqual({
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "AI 服务暂时不可用；本条未写入结果，请稍后由人工选择后重试。",
    });
  });

  it("marks missing Skill configuration as non-retryable", () => {
    expect(classifySellerSpriteBatchFailure({ code: "SKILL_NOT_FOUND", message: "internal" })).toEqual({
      code: "SKILL_CONFIGURATION",
      retryable: false,
      message: "分析 Skill 或模型配置不可用；本条未写入结果，需管理员修复后再试。",
    });
  });

  it("fails closed for an unknown error without exposing internals", () => {
    const failure = classifySellerSpriteBatchFailure(new Error("token=secret-upstream-detail"));
    expect(failure.code).toBe("ANALYSIS_FAILED");
    expect(failure.message).not.toContain("secret");
  });
});
