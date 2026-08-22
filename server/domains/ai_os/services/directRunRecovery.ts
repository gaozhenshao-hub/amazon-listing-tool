import { rawExecute } from "../routerContext";
import {
  buildRecoveryIdempotencyKey,
  claimExecutionRecoveryRequest,
  completeExecutionRecoveryRequest,
  createExecutionStateSnapshot,
} from "./executionLifecycle";
import { appendRunLedgerEvent, ensureRunTrace } from "./runLedger";

const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

export function resolveToolRecoveryEligibility(run: Record<string, any>, tool: Record<string, any>) {
  const config = parse<Record<string, any>>(tool.config, {});
  const policy = parse<Record<string, any>>(tool.governancePolicy, {});
  const retry = { ...(config.retry || {}), ...(policy.retry || {}) };
  const declaredSideEffect = String(policy.sideEffect || config.sideEffect || "").toLowerCase();
  const eligible = run.status === "failed"
    && String(run.riskLevel) === "low"
    && Number(run.retryable) === 1
    && retry.idempotent === true
    && declaredSideEffect === "read";
  return {
    eligible,
    reasonCode: eligible ? null : "TOOL_RECOVERY_REQUIRES_EXPLICIT_LOW_RISK_READ_IDEMPOTENCY",
    retryPolicy: { idempotent: retry.idempotent === true, declaredSideEffect },
  };
}

export function resolveSkillRecoveryEligibility(run: Record<string, any>, skill: Record<string, any>) {
  const manifest = parse<Record<string, any>>(skill.manifest, {});
  const implementation = manifest.implementation || {};
  const recovery = implementation.recovery || implementation.retry || {};
  const declaredSideEffect = String(implementation.sideEffect || recovery.sideEffect || "").toLowerCase();
  const eligible = run.status === "failed"
    && ["L0", "L1"].includes(String(skill.riskTier))
    && recovery.idempotent === true
    && declaredSideEffect === "read";
  return {
    eligible,
    reasonCode: eligible ? null : "SKILL_RECOVERY_REQUIRES_EXPLICIT_L0_L1_READ_IDEMPOTENCY",
    recoveryPolicy: { idempotent: recovery.idempotent === true, declaredSideEffect, riskTier: skill.riskTier },
  };
}

export function resolveRecoveryLedgerEntity(targetType: "skill_run" | "tool_run", runId: string) {
  return { entityType: targetType, entityId: runId } as const;
}

async function appendRecoveryEvent(input: { traceId?: string | null; targetType: "skill_run" | "tool_run"; runId: string; userId: number; eventType: string; payload: unknown }) {
  if (!input.traceId) return;
  const entity = resolveRecoveryLedgerEntity(input.targetType, input.runId);
  await appendRunLedgerEvent({
    traceId: input.traceId,
    eventType: input.eventType,
    entityType: entity.entityType,
    entityId: entity.entityId,
    actorUserId: input.userId,
    payload: input.payload,
  });
}

export async function prepareToolRunRecovery(input: { toolRunId: string; userId: number; workspaceId?: number | null }) {
  const rows = await rawExecute(
    `SELECT r.*,t.config,t.governancePolicy
       FROM emperor_tool_runs r
       JOIN emperor_tools t ON t.slug=r.toolSlug
      WHERE r.toolRunId=? AND (r.workspaceId=? OR (r.workspaceId IS NULL AND ? IS NULL))
      LIMIT 1`,
    [input.toolRunId, input.workspaceId ?? null, input.workspaceId ?? null],
  );
  const run = rows[0];
  if (!run) throw new Error("Tool Run not found in the active workspace");
  const traceId = run.agentRunId ? `agent_run_${run.agentRunId}` : `tool_run_${input.toolRunId}`;
  if (!run.agentRunId) {
    await ensureRunTrace({
      runId: traceId,
      rootRunType: "agent_run",
      workspaceId: input.workspaceId ?? null,
      agentSlug: "tool.recovery.audit",
      userId: input.userId,
      metadata: { targetType: "tool_run", targetId: input.toolRunId, recoveryOnly: true },
    });
  }
  const stateVersion = Number(run.attemptCount || 0);
  const existingSnapshots = await rawExecute(
    "SELECT snapshotId FROM emperor_execution_state_snapshots WHERE targetType='tool_run' AND targetId=? AND stateVersion=? LIMIT 1",
    [input.toolRunId, stateVersion],
  );
  const snapshotId = existingSnapshots[0]?.snapshotId || (await createExecutionStateSnapshot({
    workspaceId: input.workspaceId ?? null,
    traceId,
    targetType: "tool_run",
    targetId: input.toolRunId,
    stateVersion,
    status: "captured",
    capabilityType: "tool",
    capabilitySlug: run.toolSlug,
    approvalState: run.status,
    snapshot: { toolSlug: run.toolSlug, status: run.status, riskLevel: run.riskLevel, attemptCount: stateVersion, failureKind: run.failureKind },
    createdBy: input.userId,
  })).snapshotId;
  const eligibility = resolveToolRecoveryEligibility(run, run);
  const recovery = await claimExecutionRecoveryRequest({
    idempotencyKey: buildRecoveryIdempotencyKey({ snapshotId, targetType: "tool_run", targetId: input.toolRunId, expectedStateVersion: stateVersion, requestedAction: "manual_recovery_prepare" }),
    snapshotId,
    traceId,
    targetType: "tool_run",
    targetId: input.toolRunId,
    requestedAction: "manual_recovery_prepare",
    expectedStateVersion: stateVersion,
    requestedBy: input.userId,
  });
  if (!eligibility.eligible) {
    await completeExecutionRecoveryRequest({ recoveryId: recovery.request.recoveryId, status: "compensation_required", reasonCode: eligibility.reasonCode, result: eligibility });
    await appendRecoveryEvent({ traceId, targetType: "tool_run", runId: input.toolRunId, userId: input.userId, eventType: "lifecycle.compensation_required", payload: eligibility });
    return { allowed: false, recoveryId: recovery.request.recoveryId, manualExecutionRequired: false, reasonCode: eligibility.reasonCode };
  }
  await appendRecoveryEvent({ traceId, targetType: "tool_run", runId: input.toolRunId, userId: input.userId, eventType: recovery.replayed ? "lifecycle.recovery_deduped" : "lifecycle.recovery_requested", payload: { ...eligibility.retryPolicy, snapshotId } });
  return { allowed: true, recoveryId: recovery.request.recoveryId, manualExecutionRequired: true, toolRunId: input.toolRunId, snapshotId };
}

export async function prepareSkillRunRecovery(input: { runId: string; userId: number; workspaceId?: number | null; isAdmin: boolean }) {
  const rows = await rawExecute(
    `SELECT r.*,s.manifest,s.riskTier
       FROM emperor_skill_runs r
       JOIN emperor_skills s ON s.slug=r.skillSlug
      WHERE r.runId=? AND (r.workspaceId=? OR (r.workspaceId IS NULL AND ? IS NULL))
        AND (r.userId=? OR ?=1)
      LIMIT 1`,
    [input.runId, input.workspaceId ?? null, input.workspaceId ?? null, input.userId, input.isAdmin ? 1 : 0],
  );
  const run = rows[0];
  if (!run) throw new Error("Skill Run not found in the active workspace");
  const stateVersion = Number(run.stateVersion || 0);
  const existingSnapshots = await rawExecute(
    "SELECT snapshotId FROM emperor_execution_state_snapshots WHERE targetType='skill_run' AND targetId=? AND stateVersion=? LIMIT 1",
    [input.runId, stateVersion],
  );
  const snapshotId = existingSnapshots[0]?.snapshotId || (await createExecutionStateSnapshot({
    workspaceId: input.workspaceId ?? null,
    traceId: run.traceId ?? null,
    targetType: "skill_run",
    targetId: input.runId,
    stateVersion,
    status: "captured",
    capabilityType: "skill",
    capabilitySlug: run.skillSlug,
    capabilityVersion: run.skillVersion ? String(run.skillVersion) : null,
    approvalState: run.status,
    snapshot: { skillSlug: run.skillSlug, status: run.status, skillVersion: run.skillVersion ?? null, skillManifestHash: run.skillManifestHash ?? null },
    createdBy: input.userId,
  })).snapshotId;
  const eligibility = resolveSkillRecoveryEligibility(run, run);
  const recovery = await claimExecutionRecoveryRequest({
    idempotencyKey: buildRecoveryIdempotencyKey({ snapshotId, targetType: "skill_run", targetId: input.runId, expectedStateVersion: stateVersion, requestedAction: "manual_recovery_prepare" }),
    snapshotId,
    traceId: run.traceId ?? null,
    targetType: "skill_run",
    targetId: input.runId,
    requestedAction: "manual_recovery_prepare",
    expectedStateVersion: stateVersion,
    requestedBy: input.userId,
  });
  if (!eligibility.eligible) {
    await completeExecutionRecoveryRequest({ recoveryId: recovery.request.recoveryId, status: "compensation_required", reasonCode: eligibility.reasonCode, result: eligibility });
    await appendRecoveryEvent({ traceId: run.traceId ?? null, targetType: "skill_run", runId: input.runId, userId: input.userId, eventType: "lifecycle.compensation_required", payload: eligibility });
    return { allowed: false, recoveryId: recovery.request.recoveryId, manualExecutionRequired: false, reasonCode: eligibility.reasonCode };
  }
  await appendRecoveryEvent({ traceId: run.traceId ?? null, targetType: "skill_run", runId: input.runId, userId: input.userId, eventType: recovery.replayed ? "lifecycle.recovery_deduped" : "lifecycle.recovery_requested", payload: { ...eligibility.recoveryPolicy, snapshotId } });
  return { allowed: true, recoveryId: recovery.request.recoveryId, manualExecutionRequired: true, runId: input.runId, snapshotId };
}
