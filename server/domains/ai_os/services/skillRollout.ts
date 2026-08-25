import { createHash, randomUUID } from "node:crypto";
import { rawExecute } from "../routerContext";

export type SkillRolloutStatus = "draft" | "approved" | "active" | "paused" | "rolled_back" | "completed";

const json = (value: unknown) => JSON.stringify(value ?? null);
const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const normalizeIds = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))].slice(0, 100)
  : [];

const normalizePercent = (value: unknown) => Math.min(Math.max(Math.floor(Number(value || 0)), 0), 50);

function normalizePlan(row: any) {
  return {
    ...row,
    rolloutPercent: normalizePercent(row.rolloutPercent),
    allowedUserIds: normalizeIds(parse(row.allowedUserIds, [])),
    allowedProjectIds: normalizeIds(parse(row.allowedProjectIds, [])),
  };
}

export function skillRolloutBucket(input: { skillSlug: string; snapshotId: string; workspaceId?: number | null; userId: number; projectId?: number | null }) {
  const key = `${input.skillSlug}:${input.snapshotId}:${input.workspaceId ?? "company"}:${input.userId}:${input.projectId ?? "none"}`;
  return Number.parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) % 100;
}

async function appendDecision(input: { planId: string; action: string; actorId?: number | null; reason?: string | null; metadata?: unknown }) {
  await rawExecute(
    "INSERT INTO emperor_skill_rollout_decisions (decisionId,planId,action,actorId,reason,metadata) VALUES (?,?,?,?,?,?)",
    [`skill_rollout_decision_${randomUUID().replace(/-/g, "").slice(0, 24)}`, input.planId, input.action, input.actorId ?? null, input.reason ?? null, json(input.metadata ?? {})],
  );
}

async function findPlan(planId: string) {
  const rows = await rawExecute("SELECT * FROM emperor_skill_rollout_plans WHERE planId=? LIMIT 1", [planId]);
  if (!rows[0]) throw new Error("灰度计划不存在");
  return normalizePlan(rows[0]);
}

async function assertApprovalEvidence(plan: any) {
  const evidence = await rawExecute(
    `SELECT resultId FROM emperor_skill_eval_results
     WHERE snapshotId=? AND skillSlug=? AND evaluationMode='manual' AND humanApproved=1
     ORDER BY createdAt DESC LIMIT 1`,
    [plan.snapshotId, plan.skillSlug],
  );
  if (!evidence[0]?.resultId) throw new Error("候选版本缺少人工批准的真实金标评测，不能进入灰度");

  const gateRows = await rawExecute("SELECT * FROM emperor_skill_release_gates WHERE skillSlug=? LIMIT 1", [plan.skillSlug]);
  const gate: any = gateRows[0];
  if (gate?.mode === "enforced") {
    const metricsRows = await rawExecute(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN passed=1 THEN 1 ELSE 0 END) AS passedCount,
       SUM(CASE WHEN humanApproved=1 THEN 1 ELSE 0 END) AS humanApproved, AVG(score) AS averageScore
       FROM emperor_skill_eval_results WHERE skillSlug=? AND snapshotId=? AND evaluationMode='manual'`,
      [plan.skillSlug, plan.snapshotId],
    );
    const metrics: any = metricsRows[0] ?? {};
    const total = Number(metrics.total || 0);
    const averageScore = Number(metrics.averageScore || 0);
    const passRate = total ? Number(metrics.passedCount || 0) * 100 / total : 0;
    if (total < Number(gate.minApprovedCases || 0)
      || averageScore < Number(gate.minAverageScore || 0)
      || passRate < Number(gate.minPassRate || 0)
      || (Number(gate.requireHumanApproval || 0) === 1 && Number(metrics.humanApproved || 0) < 1)) {
      throw new Error("候选版本未通过当前强制发布门禁，不能进入灰度");
    }
  }
  return String(evidence[0].resultId);
}

export async function listSkillRolloutPlans(skillSlug?: string) {
  const rows = await rawExecute(
    `SELECT p.*, s.name AS skillName FROM emperor_skill_rollout_plans p
     LEFT JOIN emperor_skills s ON s.slug=p.skillSlug ${skillSlug ? "WHERE p.skillSlug=?" : ""}
     ORDER BY p.updatedAt DESC LIMIT 200`,
    skillSlug ? [skillSlug] : [],
  );
  return rows.map(normalizePlan);
}

export async function listSkillRolloutDecisions(planId: string) {
  const rows = await rawExecute("SELECT * FROM emperor_skill_rollout_decisions WHERE planId=? ORDER BY createdAt DESC LIMIT 100", [planId]);
  return rows.map((row: any) => ({ ...row, metadata: parse(row.metadata, {}) }));
}

export async function createSkillRolloutPlan(input: {
  skillSlug: string; snapshotId: string; rolloutPercent?: number; allowedUserIds?: unknown; allowedProjectIds?: unknown; decisionNote: string; userId: number; workspaceId?: number | null;
}) {
  const snapshots = await rawExecute("SELECT * FROM emperor_skill_version_snapshots WHERE snapshotId=? AND skillSlug=? LIMIT 1", [input.snapshotId, input.skillSlug]);
  const snapshot: any = snapshots[0];
  if (!snapshot) throw new Error("候选快照不存在或不属于该Skill");
  const planId = `skill_rollout_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await rawExecute(
    `INSERT INTO emperor_skill_rollout_plans (planId,workspaceId,skillSlug,snapshotId,skillVersion,snapshotHash,status,rolloutPercent,allowedUserIds,allowedProjectIds,decisionNote,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [planId, input.workspaceId ?? snapshot.workspaceId ?? null, input.skillSlug, input.snapshotId, String(snapshot.skillVersion), snapshot.snapshotHash, "draft", normalizePercent(input.rolloutPercent), json(normalizeIds(input.allowedUserIds)), json(normalizeIds(input.allowedProjectIds)), input.decisionNote, input.userId],
  );
  await appendDecision({ planId, action: "created", actorId: input.userId, reason: input.decisionNote, metadata: { rolloutPercent: normalizePercent(input.rolloutPercent) } });
  return findPlan(planId);
}

export async function approveSkillRolloutPlan(input: { planId: string; decisionNote: string; userId: number }) {
  const plan = await findPlan(input.planId);
  if (plan.status !== "draft" && plan.status !== "paused") throw new Error("仅草稿或暂停计划可批准");
  const evidenceResultId = await assertApprovalEvidence(plan);
  await rawExecute("UPDATE emperor_skill_rollout_plans SET status='approved',evidenceResultId=?,approvedBy=?,approvedAt=NOW(),decisionNote=?,updatedAt=NOW() WHERE planId=?", [evidenceResultId, input.userId, input.decisionNote, input.planId]);
  await appendDecision({ planId: input.planId, action: "approved", actorId: input.userId, reason: input.decisionNote, metadata: { evidenceResultId } });
  return findPlan(input.planId);
}

export async function activateSkillRolloutPlan(input: { planId: string; rolloutPercent: number; decisionNote: string; userId: number }) {
  const plan = await findPlan(input.planId);
  if (plan.status !== "approved" && plan.status !== "paused") throw new Error("仅已批准或暂停计划可启动灰度");
  const evidenceResultId = await assertApprovalEvidence(plan);
  const rolloutPercent = normalizePercent(input.rolloutPercent);
  if (rolloutPercent < 1) throw new Error("灰度比例必须在1%到50%之间");
  await rawExecute("UPDATE emperor_skill_rollout_plans SET status='paused',pausedAt=NOW(),updatedAt=NOW() WHERE skillSlug=? AND status='active' AND planId<>?", [plan.skillSlug, input.planId]);
  await rawExecute("UPDATE emperor_skill_rollout_plans SET status='active',rolloutPercent=?,evidenceResultId=?,activatedBy=?,activatedAt=NOW(),decisionNote=?,updatedAt=NOW() WHERE planId=?", [rolloutPercent, evidenceResultId, input.userId, input.decisionNote, input.planId]);
  await appendDecision({ planId: input.planId, action: "activated", actorId: input.userId, reason: input.decisionNote, metadata: { rolloutPercent, evidenceResultId } });
  return findPlan(input.planId);
}

export async function stopSkillRolloutPlan(input: { planId: string; status: "paused" | "rolled_back" | "completed"; decisionNote: string; userId: number }) {
  const plan = await findPlan(input.planId);
  if (plan.status === "rolled_back" || plan.status === "completed") throw new Error("该灰度计划已结束");
  const timestampColumn = input.status === "paused" ? "pausedAt" : input.status === "rolled_back" ? "rolledBackAt" : "updatedAt";
  const actorColumn = input.status === "rolled_back" ? "rolledBackBy" : "activatedBy";
  await rawExecute(`UPDATE emperor_skill_rollout_plans SET status=?,${timestampColumn}=NOW(),${actorColumn}=?,decisionNote=?,updatedAt=NOW() WHERE planId=?`, [input.status, input.userId, input.decisionNote, input.planId]);
  await appendDecision({ planId: input.planId, action: input.status, actorId: input.userId, reason: input.decisionNote });
  return findPlan(input.planId);
}

export async function resolveActiveSkillRollout(input: { skillSlug: string; workspaceId?: number | null; userId: number; projectId?: number | null }) {
  const rows = await rawExecute(
    `SELECT * FROM emperor_skill_rollout_plans
     WHERE skillSlug=? AND status='active' AND rolloutPercent>0 AND (workspaceId IS NULL OR workspaceId=?)
     ORDER BY activatedAt DESC LIMIT 1`,
    [input.skillSlug, input.workspaceId ?? null],
  );
  const plan = rows[0] ? normalizePlan(rows[0]) : null;
  if (!plan) return null;
  if (plan.allowedUserIds.length && !plan.allowedUserIds.includes(input.userId)) return null;
  if (plan.allowedProjectIds.length && (!input.projectId || !plan.allowedProjectIds.includes(input.projectId))) return null;
  const bucket = skillRolloutBucket({ skillSlug: plan.skillSlug, snapshotId: plan.snapshotId, workspaceId: input.workspaceId ?? null, userId: input.userId, projectId: input.projectId ?? null });
  if (bucket >= plan.rolloutPercent) return null;
  const snapshots = await rawExecute("SELECT manifest,modelOverride FROM emperor_skill_version_snapshots WHERE snapshotId=? LIMIT 1", [plan.snapshotId]);
  const snapshot: any = snapshots[0];
  if (!snapshot) return null;
  return { planId: plan.planId, snapshotId: plan.snapshotId, skillVersion: plan.skillVersion, snapshotHash: plan.snapshotHash, manifest: parse(snapshot.manifest, {}), modelOverride: snapshot.modelOverride ?? null, bucket, rolloutPercent: plan.rolloutPercent };
}
