import { describe, expect, it } from "vitest";
import { EXECUTION_LIFECYCLE_STAGES, buildRecoveryIdempotencyKey, executionHash, resolveConversationLifecyclePolicy } from "./executionLifecycle";

describe("P1执行生命周期治理", () => {
  it("固定记录输入、权限、风险、审批、上下文、快照与执行阶段", () => {
    expect(EXECUTION_LIFECYCLE_STAGES).toEqual([
      "input_validated", "access_checked", "risk_resolved", "approval_checked", "context_compiled", "snapshot_created", "execution_started",
    ]);
  });

  it("仅允许未审批的L0/L1 Skill进入恢复准备态，且不在P1自动改模型或自动恢复", () => {
    expect(resolveConversationLifecyclePolicy({ capabilityType: "skill", riskLevel: "L1", approvalRequired: false, approvalState: "not_required" }))
      .toMatchObject({ executionMode: "serial", recoveryAllowed: true, automaticRetryAllowed: false, maxAutomaticAttempts: 1 });
    expect(resolveConversationLifecyclePolicy({ capabilityType: "skill", riskLevel: "L2", approvalRequired: true, approvalState: "approved" }))
      .toMatchObject({ recoveryAllowed: false, requiresHumanApproval: true });
    expect(resolveConversationLifecyclePolicy({ capabilityType: "tool", riskLevel: "L1", approvalRequired: false, approvalState: "not_required" }))
      .toMatchObject({ recoveryAllowed: false, compensationRequiredOnFailure: true });
  });

  it("为相同快照、目标、版本和动作生成稳定恢复幂等键，并脱敏敏感字段", () => {
    const input = { snapshotId: "snapshot_a", targetType: "conversation_step", targetId: "step_a", expectedStateVersion: 3, requestedAction: "restore_ready" };
    expect(buildRecoveryIdempotencyKey(input)).toBe(buildRecoveryIdempotencyKey(input));
    expect(executionHash({ token: "private", content: "same" })).toBe(executionHash({ token: "different", content: "same" }));
  });
});
