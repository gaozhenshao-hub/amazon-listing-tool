export type SellerSpriteBatchFailureCode =
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_RATE_LIMITED"
  | "AI_OUTPUT_INVALID"
  | "SKILL_CONFIGURATION"
  | "PERSISTENCE_FAILED"
  | "CANCELED"
  | "ANALYSIS_FAILED";

export type SellerSpriteBatchFailure = {
  code: SellerSpriteBatchFailureCode;
  retryable: boolean;
  message: string;
};

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

function toErrorLike(value: unknown): ErrorLike | null {
  return value && typeof value === "object" ? value as ErrorLike : null;
}

/**
 * Converts internal execution errors into a short, safe, actionable result for
 * the SellerSprite batch UI. Raw provider responses and credentials never leave
 * the server; the user can keep only failed rows selected for an explicit retry.
 */
export function classifySellerSpriteBatchFailure(error: unknown): SellerSpriteBatchFailure {
  const outer = toErrorLike(error);
  const cause = toErrorLike(outer?.cause);
  const code = String(cause?.code ?? outer?.code ?? "");
  const message = String(outer?.message ?? cause?.message ?? "");

  if (code === "PROVIDER_TIMEOUT" || code === "PROVIDER_UNAVAILABLE" || /AI 服务暂时不可用|provider.*unavailable|timed?\s*out/i.test(message)) {
    return {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "AI 服务暂时不可用；本条未写入结果，请稍后由人工选择后重试。",
    };
  }
  if (code === "PROVIDER_RATE_LIMIT" || /rate.?limit|\b429\b/i.test(message)) {
    return {
      code: "AI_PROVIDER_RATE_LIMITED",
      retryable: true,
      message: "AI 服务当前限流；本条未写入结果，请稍后由人工选择后重试。",
    };
  }
  if (code === "INVALID_OUTPUT" || /输出.*JSON|output validation/i.test(message)) {
    return {
      code: "AI_OUTPUT_INVALID",
      retryable: true,
      message: "AI 返回格式未通过校验；本条未写入结果，请人工确认后重试。",
    };
  }
  if (code === "SKILL_NOT_FOUND" || code === "PROMPT_MISSING" || code === "MODEL_NOT_FOUND") {
    return {
      code: "SKILL_CONFIGURATION",
      retryable: false,
      message: "分析 Skill 或模型配置不可用；本条未写入结果，需管理员修复后再试。",
    };
  }
  if (code === "DATABASE_ERROR") {
    return {
      code: "PERSISTENCE_FAILED",
      retryable: false,
      message: "分析结果保存失败；系统未自动重试，以避免重复调用模型。",
    };
  }
  if (code === "CANCELED" || /cancel/i.test(message)) {
    return {
      code: "CANCELED",
      retryable: true,
      message: "本条分析已取消，未写入结果；可由人工重新选择后再试。",
    };
  }
  return {
    code: "ANALYSIS_FAILED",
    retryable: false,
    message: "本条分析未完成，未写入结果；请查看失败原因后由人工决定是否重试。",
  };
}
