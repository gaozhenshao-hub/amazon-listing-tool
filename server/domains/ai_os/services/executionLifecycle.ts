import { createHash, randomUUID } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../../../repositories/dbClient";
import { appendRunLedgerEvent } from "./runLedger";

export const EXECUTION_LIFECYCLE_STAGES = [
  "input_validated",
  "access_checked",
  "risk_resolved",
  "approval_checked",
  "context_compiled",
  "snapshot_created",
  "execution_started",
] as const;

export type ExecutionLifecycleStage = typeof EXECUTION_LIFECYCLE_STAGES[number];
export type ConversationCapabilityType = "skill" | "agent" | "tool";
export type ConversationRiskLevel = "L0" | "L1" | "L2" | "L3";

export type ConversationLifecyclePolicy = {
  executionMode: "serial";
  requiresHumanApproval: boolean;
  automaticRetryAllowed: boolean;
  maxAutomaticAttempts: number;
  recoveryAllowed: boolean;
  compensationRequiredOnFailure: boolean;
};

const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|api[-_]?key|access[-_]?key|refresh[-_]?token|connection[-_]?string|dsn|storageUri|publicUrl)/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, 100)
    .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(item, depth + 1)]));
}

function canonicalJson(value: unknown) { return JSON.stringify(sanitize(value ?? null)); }
export function executionHash(value: unknown) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

export function resolveConversationLifecyclePolicy(input: {
  capabilityType: ConversationCapabilityType;
  riskLevel: ConversationRiskLevel;
  approvalRequired: boolean;
  approvalState: string;
}): ConversationLifecyclePolicy {
  const requiresHumanApproval = input.approvalRequired || input.riskLevel === "L2" || input.riskLevel === "L3";
  // 仅L0/L1的Skill可以进入恢复准备态；P1不自动恢复或改用其他模型。
  const recoveryAllowed = input.capabilityType === "skill" && (input.riskLevel === "L0" || input.riskLevel === "L1") && !requiresHumanApproval;
  return {
    executionMode: "serial",
    requiresHumanApproval,
    automaticRetryAllowed: false,
    maxAutomaticAttempts: 1,
    recoveryAllowed,
    compensationRequiredOnFailure: input.capabilityType === "tool" || input.riskLevel === "L2" || input.riskLevel === "L3",
  };
}

export function buildRecoveryIdempotencyKey(input: {
  snapshotId: string;
  targetType: string;
  targetId: string;
  expectedStateVersion: number;
  requestedAction: string;
}) {
  return executionHash(input);
}

function rowsOf(value: unknown): any[] {
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0] as any[];
  return Array.isArray(value) ? value as any[] : [];
}

async function execute(sqlText: string, params: unknown[] = []) {
  const db = await getDb();
  if (!db) throw new Error("Database not available for execution lifecycle");
  if (!params.length) return db.execute(drizzleSql.raw(sqlText));
  const parts = sqlText.split("?");
  const chunks: any[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    chunks.push(drizzleSql.raw(parts[index]));
    if (index < params.length) chunks.push(drizzleSql`${params[index]}`);
  }
  return db.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
}

export async function createExecutionStateSnapshot(input: {
  workspaceId?: number | null;
  traceId?: string | null;
  targetType: string;
  targetId: string;
  stateVersion: number;
  status?: string | null;
  planId?: string | null;
  planVersion?: number | null;
  capabilityType?: ConversationCapabilityType | null;
  capabilitySlug?: string | null;
  capabilityVersion?: string | null;
  approvalState?: string | null;
  contextManifestHash?: string | null;
  snapshot: unknown;
  createdBy?: number | null;
}) {
  const snapshotId = `snapshot_${randomUUID().replace(/-/g, "")}`;
  const payload = sanitize(input.snapshot);
  await execute(
    `INSERT INTO emperor_execution_state_snapshots
      (snapshotId,workspaceId,traceId,targetType,targetId,stateVersion,status,planId,planVersion,capabilityType,capabilitySlug,capabilityVersion,approvalState,contextManifestHash,inputHash,snapshot,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [snapshotId, input.workspaceId ?? null, input.traceId ?? null, input.targetType, input.targetId, input.stateVersion, input.status ?? "captured", input.planId ?? null, input.planVersion ?? null, input.capabilityType ?? null, input.capabilitySlug ?? null, input.capabilityVersion ?? null, input.approvalState ?? null, input.contextManifestHash ?? null, executionHash(payload), canonicalJson(payload), input.createdBy ?? null],
  );
  return { snapshotId, inputHash: executionHash(payload) };
}

export async function claimExecutionRecoveryRequest(input: {
  idempotencyKey: string;
  snapshotId: string;
  traceId?: string | null;
  targetType: string;
  targetId: string;
  requestedAction: string;
  expectedStateVersion: number;
  requestedBy?: number | null;
}) {
  const recoveryId = `recovery_${randomUUID().replace(/-/g, "")}`;
  await execute(
    `INSERT INTO emperor_execution_recovery_requests
      (recoveryId,idempotencyKey,snapshotId,traceId,targetType,targetId,requestedAction,expectedStateVersion,requestedBy)
     VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updatedAt=updatedAt`,
    [recoveryId, input.idempotencyKey, input.snapshotId, input.traceId ?? null, input.targetType, input.targetId, input.requestedAction, input.expectedStateVersion, input.requestedBy ?? null],
  );
  const rows = rowsOf(await execute("SELECT * FROM emperor_execution_recovery_requests WHERE idempotencyKey=? LIMIT 1", [input.idempotencyKey]));
  const request = rows[0];
  if (!request) throw new Error("Execution recovery request was not persisted");
  return { request, replayed: request.recoveryId !== recoveryId };
}

export async function completeExecutionRecoveryRequest(input: {
  recoveryId: string;
  status: "completed" | "rejected" | "compensation_required";
  reasonCode?: string | null;
  result?: unknown;
}) {
  await execute(
    "UPDATE emperor_execution_recovery_requests SET status=?,reasonCode=?,result=?,completedAt=NOW() WHERE recoveryId=?",
    [input.status, input.reasonCode ?? null, canonicalJson(input.result ?? null), input.recoveryId],
  );
}

export async function appendConversationLifecycleStage(input: {
  traceId: string;
  stepId: string;
  actorUserId: number;
  stage: ExecutionLifecycleStage | "error_classified" | "compensation_required" | "completed" | "recovery_requested" | "recovery_rejected" | "recovery_completed";
  payload?: unknown;
}) {
  await appendRunLedgerEvent({
    traceId: input.traceId,
    eventType: `lifecycle.${input.stage}`,
    entityType: "system",
    entityId: input.stepId,
    actorUserId: input.actorUserId,
    payload: input.payload,
  });
}
