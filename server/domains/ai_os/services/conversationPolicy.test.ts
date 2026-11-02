import { describe, expect, it } from "vitest";
import {
  CONVERSATION_PLANNER_MAX_ATTEMPTS,
  conversationAttachmentContextPolicy,
  conversationExecutionPolicy,
  highestConversationRisk,
  conversationPlannerRetryDelayMs,
  conversationStepRequiresApproval,
  filterConversationPlanSteps,
  parseConversationStructuredJson,
  shouldRetryConversationPlannerError,
} from "./conversationPolicy";

describe("皇帝对话任务治理策略", () => {
  it("对L2和L3步骤强制要求人工批准，不能由客户端关闭", () => {
    expect(conversationStepRequiresApproval({ riskLevel: "L2", approvalRequired: false })).toBe(true);
    expect(conversationStepRequiresApproval({ riskLevel: "L3", approvalRequired: false })).toBe(true);
  });

  it("允许低风险只读步骤无额外批准，但尊重显式批准要求", () => {
    expect(conversationStepRequiresApproval({ riskLevel: "L1", approvalRequired: false })).toBe(false);
    expect(conversationStepRequiresApproval({ riskLevel: "L0", approvalRequired: true })).toBe(true);
  });

  it("默认串行，且客户端不能将高风险步骤标记为免审批或并行", () => {
    expect(conversationExecutionPolicy({ riskLevel: "L1", capabilityType: "skill" })).toMatchObject({ executionMode: "serial", allowParallel: false, requiresPlanApproval: true, requiresStepApproval: false });
    expect(conversationExecutionPolicy({ riskLevel: "L3", approvalRequired: false, capabilityType: "tool" })).toMatchObject({ executionMode: "serial", allowParallel: false, requiresStepApproval: true, approvalProtocol: "plan_then_step_human_review" });
  });

  it("以登记能力的实际风险作为客户端计划风险的最低值", () => {
    expect(highestConversationRisk("L1", "L3")).toBe("L3");
    expect(highestConversationRisk("L2", "L1")).toBe("L2");
  });

  it("根据MIME类型限制附件上下文策略", () => {
    expect(conversationAttachmentContextPolicy("image/png")).toBe("image_vision");
    expect(conversationAttachmentContextPolicy("text/csv")).toBe("extracted_text");
    expect(conversationAttachmentContextPolicy("application/pdf")).toBe("extracted_text");
    expect(conversationAttachmentContextPolicy("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("summary_only");
  });

  it("兼容模型返回的完整JSON围栏，但不把普通文本误解析为结构化计划", () => {
    expect(parseConversationStructuredJson("```json\n{\"goal\":\"只读分析\"}\n```", { goal: "fallback" })).toEqual({ goal: "只读分析" });
    expect(parseConversationStructuredJson("说明文本", { goal: "fallback" })).toEqual({ goal: "fallback" });
  });

  it("只保留能力目录中已登记的候选步骤", () => {
    const result = filterConversationPlanSteps(
      [{ capabilityType: "tool", capabilitySlug: "internal.lingxing.read" }, { capabilityType: "tool", capabilitySlug: "shell.exec" }],
      [{ capabilityType: "tool", slug: "internal.lingxing.read" }],
    );
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.capabilitySlug).toBe("shell.exec");
  });

  it("仅对瞬时模型网关错误执行受限规划重试", () => {
    expect(CONVERSATION_PLANNER_MAX_ATTEMPTS).toBe(2);
    expect(shouldRetryConversationPlannerError({ cause: { code: "PROVIDER_UNAVAILABLE", retryable: true } })).toBe(true);
    expect(shouldRetryConversationPlannerError({ cause: { code: "UNKNOWN", retryable: false } })).toBe(false);
    expect(conversationPlannerRetryDelayMs(0)).toBe(250);
    expect(conversationPlannerRetryDelayMs(10)).toBe(1_000);
  });
});
