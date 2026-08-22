import { createHash, randomUUID } from "node:crypto";
import { rawExecute } from "../routerContext";
import { runEmperorSkill } from "./skillRunner";

const json = (value: unknown) => JSON.stringify(value ?? null);
const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

export type ReleaseGateDecision = {
  mode: "advisory" | "enforced";
  allowed: boolean;
  reasons: string[];
  metrics: { approvedCases: number; averageScore: number; passRate: number; humanApproved: number };
  policy: { minApprovedCases: number; minAverageScore: number; minPassRate: number; requireHumanApproval: boolean };
};

export async function captureSkillVersionSnapshot(input: {
  skill: Record<string, any>;
  workspaceId?: number | null;
  userId?: number | null;
  source: "create" | "update" | "release";
}) {
  const manifest = parse(input.skill.manifest, {} as Record<string, unknown>);
  const skillVersion = String(input.skill.version ?? "1");
  const snapshotPayload = { manifest, modelOverride: input.skill.modelOverride ?? null, status: input.skill.status ?? "Draft" };
  const snapshotHash = createHash("sha256").update(json(snapshotPayload)).digest("hex");
  const existing = await rawExecute(
    "SELECT snapshotId FROM emperor_skill_version_snapshots WHERE skillSlug=? AND skillVersion=? AND snapshotHash=? LIMIT 1",
    [input.skill.slug, skillVersion, snapshotHash],
  );
  if (existing[0]) return { snapshotId: existing[0].snapshotId as string, created: false, snapshotHash };
  const snapshotId = `skill_snapshot_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await rawExecute(
    `INSERT INTO emperor_skill_version_snapshots (snapshotId,workspaceId,skillSlug,skillVersion,snapshotHash,source,status,manifest,modelOverride,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [snapshotId, input.workspaceId ?? null, input.skill.slug, skillVersion, snapshotHash, input.source, input.skill.status ?? "Draft", json(manifest), input.skill.modelOverride ?? null, input.userId ?? null],
  );
  return { snapshotId, created: true, snapshotHash };
}

export async function listSkillEvalCases(skillSlug?: string, status?: string) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (skillSlug) { clauses.push("skillSlug=?"); params.push(skillSlug); }
  if (status) { clauses.push("status=?"); params.push(status); }
  const rows = await rawExecute(`SELECT * FROM emperor_skill_eval_cases ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updatedAt DESC LIMIT 300`, params);
  return rows.map((row: any) => ({ ...row, tags: parse(row.tags, []), inputContext: parse(row.inputContext, {}), expectedConstraints: parse(row.expectedConstraints, {}), rubric: parse(row.rubric, {}) }));
}

export async function listSkillVersionSnapshots(skillSlug?: string) {
  return rawExecute(
    `SELECT snapshotId,skillSlug,skillVersion,snapshotHash,source,status,modelOverride,createdAt FROM emperor_skill_version_snapshots ${skillSlug ? "WHERE skillSlug=?" : ""} ORDER BY createdAt DESC LIMIT 200`,
    skillSlug ? [skillSlug] : [],
  );
}

export async function createSkillEvalCase(input: {
  skillSlug: string; name: string; description?: string | null; status?: string; tags?: unknown; inputContext: unknown; expectedConstraints?: unknown; rubric: unknown;
  sourceArtifactId?: string | null; sourceRunId?: string | null; workspaceId?: number | null; userId?: number | null;
}) {
  const caseId = `eval_case_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await rawExecute(
    `INSERT INTO emperor_skill_eval_cases (caseId,workspaceId,skillSlug,name,description,status,tags,inputContext,expectedConstraints,rubric,sourceArtifactId,sourceRunId,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [caseId, input.workspaceId ?? null, input.skillSlug, input.name, input.description ?? null, input.status ?? "draft", json(input.tags ?? []), json(input.inputContext), json(input.expectedConstraints ?? {}), json(input.rubric), input.sourceArtifactId ?? null, input.sourceRunId ?? null, input.userId ?? null],
  );
  return { caseId };
}

export async function recordSkillEvalResult(input: {
  caseId: string; skillSlug: string; snapshotId?: string | null; skillVersion?: string | null; score?: number | null; passed: boolean; humanApproved?: boolean;
  feedback?: string | null; dimensionScores?: unknown; outputSummary?: unknown; sourceArtifactId?: string | null; workspaceId?: number | null; evaluatorUserId?: number | null;
}) {
  const resultId = `eval_result_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await rawExecute(
    `INSERT INTO emperor_skill_eval_results (resultId,workspaceId,caseId,skillSlug,snapshotId,skillVersion,evaluationMode,status,score,passed,humanApproved,feedback,dimensionScores,outputSummary,sourceArtifactId,evaluatorUserId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [resultId, input.workspaceId ?? null, input.caseId, input.skillSlug, input.snapshotId ?? null, input.skillVersion ?? null, "manual", "completed", input.score ?? null, input.passed ? 1 : 0, input.humanApproved ? 1 : 0, input.feedback ?? null, json(input.dimensionScores ?? {}), json(input.outputSummary ?? {}), input.sourceArtifactId ?? null, input.evaluatorUserId ?? null],
  );
  return { resultId };
}

export async function getSkillReleaseGateDecision(skillSlug: string, skillVersion?: string | null): Promise<ReleaseGateDecision> {
  const policyRows = await rawExecute("SELECT * FROM emperor_skill_release_gates WHERE skillSlug=? LIMIT 1", [skillSlug]);
  const policyRow: any = policyRows[0] ?? {};
  const policy = {
    minApprovedCases: Number(policyRow.minApprovedCases ?? 0),
    minAverageScore: Number(policyRow.minAverageScore ?? 0),
    minPassRate: Number(policyRow.minPassRate ?? 0),
    requireHumanApproval: Number(policyRow.requireHumanApproval ?? 0) === 1,
  };
  const metricsRows = await rawExecute(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN passed=1 THEN 1 ELSE 0 END) AS passedCount,
       SUM(CASE WHEN humanApproved=1 THEN 1 ELSE 0 END) AS humanApproved, AVG(score) AS averageScore
     FROM emperor_skill_eval_results WHERE skillSlug=? AND evaluationMode='manual' ${skillVersion ? "AND skillVersion=?" : ""}`,
    skillVersion ? [skillSlug, skillVersion] : [skillSlug],
  );
  const metricsRow: any = metricsRows[0] ?? {};
  const approvedCases = Number(metricsRow.total ?? 0);
  const averageScore = Number(metricsRow.averageScore ?? 0);
  const passRate = approvedCases ? Number(metricsRow.passedCount ?? 0) * 100 / approvedCases : 0;
  const humanApproved = Number(metricsRow.humanApproved ?? 0);
  const reasons: string[] = [];
  if (approvedCases < policy.minApprovedCases) reasons.push(`评测样本不足：${approvedCases}/${policy.minApprovedCases}`);
  if (averageScore < policy.minAverageScore) reasons.push(`平均分不足：${averageScore.toFixed(1)}/${policy.minAverageScore}`);
  if (passRate < policy.minPassRate) reasons.push(`通过率不足：${passRate.toFixed(1)}%/${policy.minPassRate}%`);
  if (policy.requireHumanApproval && humanApproved < 1) reasons.push("缺少人工批准的评测结果");
  const mode = policyRow.mode === "enforced" ? "enforced" : "advisory";
  return { mode, allowed: mode === "advisory" || reasons.length === 0, reasons, metrics: { approvedCases, averageScore, passRate, humanApproved }, policy };
}

export async function upsertSkillReleaseGate(input: {
  skillSlug: string; mode: "advisory" | "enforced"; minApprovedCases: number; minAverageScore: number; minPassRate: number; requireHumanApproval: boolean; workspaceId?: number | null; userId?: number | null;
}) {
  await rawExecute(
    `INSERT INTO emperor_skill_release_gates (workspaceId,skillSlug,mode,minApprovedCases,minAverageScore,minPassRate,requireHumanApproval,updatedBy)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE mode=VALUES(mode),minApprovedCases=VALUES(minApprovedCases),minAverageScore=VALUES(minAverageScore),minPassRate=VALUES(minPassRate),requireHumanApproval=VALUES(requireHumanApproval),updatedBy=VALUES(updatedBy),updatedAt=NOW()`,
    [input.workspaceId ?? null, input.skillSlug, input.mode, input.minApprovedCases, input.minAverageScore, input.minPassRate, input.requireHumanApproval ? 1 : 0, input.userId ?? null],
  );
}

function flattenRuleValues(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 20) : [];
}

function evaluateExpectedConstraints(content: string, expectedConstraints: Record<string, unknown>) {
  const requiredIncludes = flattenRuleValues(expectedConstraints.requiredIncludes);
  const forbiddenIncludes = flattenRuleValues(expectedConstraints.forbiddenIncludes);
  const minLength = Number(expectedConstraints.minLength || 0);
  const checks = [
    ...requiredIncludes.map((value) => ({ rule: "requiredIncludes", value, passed: content.includes(value) })),
    ...forbiddenIncludes.map((value) => ({ rule: "forbiddenIncludes", value, passed: !content.includes(value) })),
    ...(minLength > 0 ? [{ rule: "minLength", value: String(minLength), passed: content.length >= minLength }] : []),
  ];
  return { passed: checks.every((item) => item.passed), checks };
}

export async function replaySkillEvalCase(input: { caseId: string; snapshotId: string; userId: number; workspaceId?: number | null }) {
  const caseRows = await rawExecute("SELECT * FROM emperor_skill_eval_cases WHERE caseId=? LIMIT 1", [input.caseId]);
  const evalCase: any = caseRows[0];
  if (!evalCase || evalCase.status !== "approved") throw new Error("仅允许回放已批准的真实金标用例");
  const snapshotRows = await rawExecute("SELECT * FROM emperor_skill_version_snapshots WHERE snapshotId=? AND skillSlug=? LIMIT 1", [input.snapshotId, evalCase.skillSlug]);
  const snapshot: any = snapshotRows[0];
  if (!snapshot) throw new Error("候选版本快照不存在或不属于该Skill");
  const inputContext = parse<Record<string, unknown>>(evalCase.inputContext, {});
  const expectedConstraints = parse<Record<string, unknown>>(evalCase.expectedConstraints, {});
  const result = await runEmperorSkill({
    skillSlug: evalCase.skillSlug,
    userId: input.userId,
    workspaceId: input.workspaceId ?? snapshot.workspaceId ?? evalCase.workspaceId ?? null,
    variables: inputContext,
    context: JSON.stringify(inputContext),
    evaluationMode: "replay",
    replaySnapshot: {
      snapshotId: snapshot.snapshotId,
      skillVersion: String(snapshot.skillVersion),
      manifest: parse(snapshot.manifest, {}),
      modelOverride: snapshot.modelOverride ?? null,
    },
  });
  const constraints = evaluateExpectedConstraints(result.content, expectedConstraints);
  const replayResultId = `eval_result_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const outputSummary = {
    schema: "emperor.skill_replay/1.0",
    runId: result.runId,
    output: result.content,
    constraintEvaluation: constraints,
    model: { slug: result.modelSlug, provider: result.provider, inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs: result.durationMs },
  };
  await rawExecute(
    `INSERT INTO emperor_skill_eval_results (resultId,workspaceId,caseId,skillSlug,snapshotId,skillVersion,evaluationMode,status,score,passed,humanApproved,feedback,dimensionScores,outputSummary,evaluatorUserId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [replayResultId, input.workspaceId ?? snapshot.workspaceId ?? null, input.caseId, evalCase.skillSlug, snapshot.snapshotId, String(snapshot.skillVersion), "replay", "completed", null, constraints.passed ? 1 : 0, 0, null, json({}), json(outputSummary), input.userId],
  );
  return { resultId: replayResultId, caseId: input.caseId, snapshotId: snapshot.snapshotId, skillSlug: evalCase.skillSlug, skillVersion: String(snapshot.skillVersion), ...outputSummary };
}

export async function listSkillReplayResults(skillSlug?: string, snapshotId?: string) {
  const clauses = ["evaluationMode='replay'"];
  const params: unknown[] = [];
  if (skillSlug) { clauses.push("skillSlug=?"); params.push(skillSlug); }
  if (snapshotId) { clauses.push("snapshotId=?"); params.push(snapshotId); }
  const rows = await rawExecute(`SELECT * FROM emperor_skill_eval_results WHERE ${clauses.join(" AND ")} ORDER BY createdAt DESC LIMIT 200`, params);
  return rows.map((row: any) => ({ ...row, outputSummary: parse(row.outputSummary, {}), dimensionScores: parse(row.dimensionScores, {}) }));
}
