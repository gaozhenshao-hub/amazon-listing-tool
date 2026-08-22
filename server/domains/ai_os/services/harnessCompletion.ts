import { createHash, randomUUID } from "node:crypto";
import { rawExecute } from "../routerContext";

export type HarnessReviewType = "review_required" | "approval_required" | "selection_required";
export type ExecutionPresetMode = "standard" | "quality_first" | "batch_background" | "evaluation";

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const encode = (value: unknown) => JSON.stringify(value ?? null);

export const SYSTEM_EXECUTION_PRESETS = [
  { presetSlug: "standard", name: "标准业务模式", mode: "standard" as const, description: "沿用Skill已配置模型、上下文与人工确认策略。", config: { modelStrategy: "skill_configured", contextBudget: "default", toolMode: "governed_only", approvalLevel: "standard", maxConcurrency: 1 } },
  { presetSlug: "quality_first", name: "质量优先模式", mode: "quality_first" as const, description: "优先使用Skill已配置的质量模型，并扩大已授权上下文和人工复核。", config: { modelStrategy: "skill_quality_configured", contextBudget: "expanded", toolMode: "governed_only", approvalLevel: "review", maxConcurrency: 1 } },
  { presetSlug: "batch_background", name: "批量后台模式", mode: "batch_background" as const, description: "使用Skill已配置模型、队列、断点恢复与保守并发，不自动写入业务结论。", config: { modelStrategy: "skill_configured", contextBudget: "bounded", toolMode: "read_only", approvalLevel: "selection", maxConcurrency: 2 } },
  { presetSlug: "evaluation", name: "评测模式", mode: "evaluation" as const, description: "固定使用候选快照或Skill已配置模型；只运行真实金标与候选比较。", config: { modelStrategy: "snapshot_or_skill_configured", contextBudget: "evaluation", toolMode: "read_only", approvalLevel: "approval", maxConcurrency: 1, prohibitBusinessWrites: true } },
];

export function normalizeReviewType(value: unknown): HarnessReviewType {
  return value === "approval_required" || value === "selection_required" ? value : "review_required";
}

export async function listExecutionPresets(workspaceId?: number | null) {
  const rows = await rawExecute(
    "SELECT * FROM emperor_execution_presets WHERE isActive=1 AND (workspaceId IS NULL OR workspaceId=?) ORDER BY workspaceId IS NULL DESC, presetSlug",
    [workspaceId ?? null],
  ).catch(() => []);
  const persisted = new Map(rows.map((row: any) => [row.presetSlug, { ...row, config: typeof row.config === "string" ? JSON.parse(row.config) : row.config }]));
  return SYSTEM_EXECUTION_PRESETS.map((preset) => persisted.get(preset.presetSlug) || { ...preset, isSystem: 1, isActive: 1, workspaceId: null });
}

export async function seedExecutionPresets(userId?: number | null) {
  for (const preset of SYSTEM_EXECUTION_PRESETS) {
    await rawExecute(
      `INSERT INTO emperor_execution_presets (presetSlug,workspaceId,name,description,mode,config,isSystem,isActive,createdBy)
       VALUES (?,NULL,?,?,?,?,1,1,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),mode=VALUES(mode),config=VALUES(config),isSystem=1,isActive=1`,
      [preset.presetSlug, preset.name, preset.description, preset.mode, encode(preset.config), userId ?? null],
    );
  }
  return listExecutionPresets(null);
}

export async function createHarnessReviewRequest(input: {
  workspaceId?: number | null; agentRunId?: string | null; nodeId?: string | null; requestType?: HarnessReviewType;
  title: string; candidateSummary?: unknown; requestedReason?: string | null; requestedBy?: number | null;
}) {
  const reviewId = id("harness_review");
  await rawExecute(
    `INSERT INTO emperor_harness_review_requests (reviewId,workspaceId,agentRunId,nodeId,requestType,title,candidateSummary,requestedReason,requestedBy)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [reviewId, input.workspaceId ?? null, input.agentRunId ?? null, input.nodeId ?? null, normalizeReviewType(input.requestType), input.title, encode(input.candidateSummary), input.requestedReason ?? null, input.requestedBy ?? null],
  );
  return { reviewId };
}

export async function listHarnessReviewRequests(workspaceId?: number | null, agentRunId?: string | null) {
  const clauses = ["1=1"]; const params: unknown[] = [];
  if (workspaceId != null) { clauses.push("(workspaceId IS NULL OR workspaceId=?)"); params.push(workspaceId); }
  if (agentRunId) { clauses.push("agentRunId=?"); params.push(agentRunId); }
  const rows = await rawExecute(`SELECT * FROM emperor_harness_review_requests WHERE ${clauses.join(" AND ")} ORDER BY createdAt DESC LIMIT 200`, params);
  return rows.map((row: any) => ({ ...row, candidateSummary: typeof row.candidateSummary === "string" ? JSON.parse(row.candidateSummary) : row.candidateSummary, decision: typeof row.decision === "string" ? JSON.parse(row.decision) : row.decision }));
}

export async function getHarnessReviewRequest(reviewId: string) {
  const rows = await rawExecute("SELECT * FROM emperor_harness_review_requests WHERE reviewId=? LIMIT 1", [reviewId]);
  const row: any = rows[0];
  if (!row) throw new Error("人审请求不存在");
  return {
    ...row,
    candidateSummary: typeof row.candidateSummary === "string" ? JSON.parse(row.candidateSummary) : row.candidateSummary,
    decision: typeof row.decision === "string" ? JSON.parse(row.decision) : row.decision,
  };
}

export async function resolveHarnessReviewRequest(input: { reviewId: string; status: "approved" | "rejected" | "selected" | "canceled"; reason: string; decision?: unknown; userId: number }) {
  const result: any = await rawExecute(
    "UPDATE emperor_harness_review_requests SET status=?,resolutionReason=?,decision=?,resolvedBy=?,resolvedAt=NOW() WHERE reviewId=? AND status='open'",
    [input.status, input.reason, encode(input.decision), input.userId, input.reviewId],
  );
  if (Number(result?.affectedRows || 0) !== 1) throw new Error("人审请求已被处理或不再处于待决状态");
  return { reviewId: input.reviewId, status: input.status };
}

export async function recordHarnessFeedback(input: {
  workspaceId?: number | null; projectId?: number | null; domain: string; artifactKey?: string | null; selectionId?: string | null;
  selectedArtifactId?: string | null; candidateArtifactIds?: string[]; editDiff?: unknown; selectionReason?: string | null;
  outcomeStatus?: "pending" | "accepted" | "revised" | "rejected" | "published"; outcomeMetadata?: unknown; userId?: number | null;
}) {
  const signalId = id("harness_feedback");
  await rawExecute(
    `INSERT INTO emperor_harness_feedback_signals (signalId,workspaceId,projectId,domain,artifactKey,selectionId,selectedArtifactId,candidateArtifactIds,editDiff,selectionReason,outcomeStatus,outcomeMetadata,userId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [signalId, input.workspaceId ?? null, input.projectId ?? null, input.domain, input.artifactKey ?? null, input.selectionId ?? null, input.selectedArtifactId ?? null, encode(input.candidateArtifactIds || []), encode(input.editDiff), input.selectionReason ?? null, input.outcomeStatus || "pending", encode(input.outcomeMetadata), input.userId ?? null],
  );
  return { signalId };
}

export function stableParallelBucket(input: { agentRunId: string; nodeId: string; branchKey: string }) {
  return Number.parseInt(createHash("sha256").update(`${input.agentRunId}:${input.nodeId}:${input.branchKey}`).digest("hex").slice(0, 8), 16) % 100;
}

export async function createParallelPlan(input: { workspaceId?: number | null; agentRunId: string; parentNodeId?: string | null; mergeNodeId?: string | null; maxConcurrency: number; branchNodeIds: string[]; policy?: unknown; userId: number }) {
  const unique = [...new Set(input.branchNodeIds.filter(Boolean))].slice(0, 8);
  if (unique.length < 2) throw new Error("受控并行至少需要两个独立分支");
  const parallelPlanId = id("parallel_plan");
  const maxConcurrency = Math.min(Math.max(Math.floor(input.maxConcurrency || 1), 1), Math.min(4, unique.length));
  await rawExecute(
    "INSERT INTO emperor_parallel_plans (parallelPlanId,workspaceId,agentRunId,parentNodeId,mergeNodeId,maxConcurrency,branchCount,policy,createdBy) VALUES (?,?,?,?,?,?,?,?,?)",
    [parallelPlanId, input.workspaceId ?? null, input.agentRunId, input.parentNodeId ?? null, input.mergeNodeId ?? null, maxConcurrency, unique.length, encode({ ...(input.policy as Record<string, unknown> || {}), mode: "evidence_only", requireMerge: true }), input.userId],
  );
  for (const nodeId of unique) {
    await rawExecute("INSERT INTO emperor_parallel_branches (branchId,parallelPlanId,nodeId,status) VALUES (?,?,?,'pending')", [id("parallel_branch"), parallelPlanId, nodeId]);
  }
  return { parallelPlanId, maxConcurrency, branchCount: unique.length, status: "draft" as const };
}

export async function listParallelPlans(agentRunId?: string) {
  const rows = await rawExecute(`SELECT * FROM emperor_parallel_plans ${agentRunId ? "WHERE agentRunId=?" : ""} ORDER BY createdAt DESC LIMIT 100`, agentRunId ? [agentRunId] : []);
  return Promise.all(rows.map(async (plan: any) => ({
    ...plan,
    policy: typeof plan.policy === "string" ? JSON.parse(plan.policy) : plan.policy,
    branches: await rawExecute("SELECT * FROM emperor_parallel_branches WHERE parallelPlanId=? ORDER BY createdAt", [plan.parallelPlanId]),
  })));
}
