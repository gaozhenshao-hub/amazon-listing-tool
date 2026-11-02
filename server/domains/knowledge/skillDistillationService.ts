import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { registerUnifiedArtifact } from "../ai_os/services/artifactLifecycle";
import { captureSkillVersionSnapshot } from "../ai_os/services/skillQualityGates";
import { runEmperorSkill } from "../ai_os/services/skillRunner";
import { rawExecute } from "../ai_os/routerContext";
import { defaultManifestForSkillType } from "./skillDistillationCatalog";
import {
  canTransitionDraft,
  isDistillationSkillType,
  normalizeDistillationProfile,
  type DistillationDraftStatus,
  type DistillationProfile,
  type DistillationSkillType,
} from "./skillDistillationContracts";

type SourceDomain = "products" | "listings" | "images" | "skills" | "videos";
type SourceRecord = { id: number; sourceTable: string; title: string; category?: string | null; tags?: unknown; updatedAt?: unknown; status?: string; visibility?: string; asin?: string | null };

const json = (value: unknown) => JSON.stringify(value ?? null);
const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const key = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function ruleInstructions(manifest: Record<string, unknown>) {
  const distillation = manifest.distillation as Record<string, unknown> | undefined;
  const rules = Array.isArray(distillation?.rules) ? distillation.rules : Array.isArray(manifest.rules) ? manifest.rules : [];
  return rules.map((rule: any) => String(rule?.instruction || rule?.text || "").trim()).filter(Boolean).slice(0, 30);
}

function normalizeRuleText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[，。；、,.!！?？:：]/g, "").trim();
}

const OPPOSING_RULE_TERMS: Array<[string, string]> = [
  ["compatible", "incompatible"], ["include", "exclude"], ["required", "optional"], ["always", "never"],
  ["适用于", "不适用于"], ["包含", "不包含"], ["必须", "可选"], ["始终", "绝不"],
];

async function detectDraftConflicts(input: { projectId: number; workspaceId: number; skillTypeKey: string; profile: DistillationProfile; sourceFingerprint: string; manifestDraft: Record<string, unknown>; excludingDraftKey?: string }) {
  const rows = await rawExecute(
    `SELECT draftKey,title,status,profile,sourceFingerprint,manifestDraft FROM knowledge_skill_drafts
     WHERE distillationProjectId=? AND workspaceId=? AND skillTypeKey=? AND status NOT IN ('rejected','superseded') ${input.excludingDraftKey ? "AND draftKey<>?" : ""}
     ORDER BY updatedAt DESC LIMIT 100`,
    input.excludingDraftKey ? [input.projectId, input.workspaceId, input.skillTypeKey, input.excludingDraftKey] : [input.projectId, input.workspaceId, input.skillTypeKey],
  ) as any[];
  const normalizedProfile = json(normalizeDistillationProfile(input.profile));
  const candidateRules = ruleInstructions(input.manifestDraft).map(normalizeRuleText).filter(Boolean);
  const duplicateFingerprint = rows.filter((row) => String(row.sourceFingerprint) === input.sourceFingerprint).map((row) => ({ draftKey: String(row.draftKey), title: String(row.title), status: String(row.status) }));
  const sameProfile = rows.filter((row) => json(normalizeDistillationProfile(parse(row.profile, {}))) === normalizedProfile).map((row) => ({ draftKey: String(row.draftKey), title: String(row.title), status: String(row.status) }));
  const duplicateRules: Array<{ draftKey: string; instruction: string }> = [];
  const opposingRules: Array<{ draftKey: string; candidateInstruction: string; existingInstruction: string; terms: [string, string] }> = [];
  for (const row of rows) {
    for (const existingInstruction of ruleInstructions(parse<Record<string, unknown>>(row.manifestDraft, {}))) {
      const normalizedExisting = normalizeRuleText(existingInstruction);
      for (const candidateInstruction of candidateRules) {
        if (candidateInstruction === normalizedExisting) duplicateRules.push({ draftKey: String(row.draftKey), instruction: candidateInstruction });
        for (const terms of OPPOSING_RULE_TERMS) {
          if ((candidateInstruction.includes(terms[0]) && normalizedExisting.includes(terms[1])) || (candidateInstruction.includes(terms[1]) && normalizedExisting.includes(terms[0]))) {
            opposingRules.push({ draftKey: String(row.draftKey), candidateInstruction, existingInstruction: normalizedExisting, terms });
          }
        }
      }
    }
  }
  const hasConflict = duplicateFingerprint.length > 0 || duplicateRules.length > 0 || opposingRules.length > 0;
  return { schema: "knowledge.distillation.conflict-report/1.0", checkedAt: new Date().toISOString(), hasConflict, duplicateFingerprint, sameProfile, duplicateRules: duplicateRules.slice(0, 20), opposingRules: opposingRules.slice(0, 20), advisory: "冲突报告仅供人工决定返回编辑、提交审查或拒绝；系统不会自动合并规则。" };
}

export function parseDistillationOutput(value: string): Record<string, unknown> {
  const clean = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(clean);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("蒸馏执行器未返回JSON对象");
  return parsed as Record<string, unknown>;
}

async function recordReviewEvent(input: {
  workspaceId: number;
  distillationProjectId: number;
  actorUserId: number;
  eventType: "source_selected" | "source_invalidated" | "evidence_approved" | "draft_created" | "draft_edited" | "conflict_detected" | "review_requested" | "approved" | "rejected" | "published" | "rolled_back";
  draftKey?: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  reason?: string | null;
}) {
  await rawExecute(
    `INSERT INTO knowledge_skill_review_events (eventKey,workspaceId,distillationProjectId,draftKey,eventType,beforeSnapshot,afterSnapshot,reason,actorUserId)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [key("kreview"), input.workspaceId, input.distillationProjectId, input.draftKey || null, input.eventType, json(input.beforeSnapshot), json(input.afterSnapshot), input.reason || null, input.actorUserId],
  );
}

async function getProject(projectKey: string, workspaceId: number) {
  const rows = await rawExecute("SELECT * FROM knowledge_distillation_projects WHERE projectKey=? AND workspaceId=? LIMIT 1", [projectKey, workspaceId]);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "蒸馏项目不存在或不属于当前工作空间" });
  return { ...row, profile: parse(row.profile, {}), sourcePolicy: parse(row.sourcePolicy, {}) };
}

async function fetchEligibleKnowledgeSource(input: { workspaceId: number; sourceDomain: SourceDomain; sourceRowId: number }): Promise<SourceRecord> {
  const sharedCondition = "status='confirmed' AND visibility IN ('team','public')";
  const queries: Record<SourceDomain, { table: string; query: string }> = {
    products: { table: "kb_product_innovations", query: `SELECT id,'kb_product_innovations' AS sourceTable,COALESCE(productTitle,asin) AS title,category,tags,asin,status,visibility,updatedAt FROM kb_product_innovations WHERE id=? AND workspaceId=? AND ${sharedCondition} LIMIT 1` },
    listings: { table: "kb_listing_copywriting", query: `SELECT id,'kb_listing_copywriting' AS sourceTable,COALESCE(productTitle,asin) AS title,category,tags,asin,status,visibility,updatedAt FROM kb_listing_copywriting WHERE id=? AND workspaceId=? AND ${sharedCondition} LIMIT 1` },
    images: { table: "kb_image_sets", query: `SELECT id,'kb_image_sets' AS sourceTable,COALESCE(productTitle,asin) AS title,category,NULL AS tags,asin,status,visibility,updatedAt FROM kb_image_sets WHERE id=? AND workspaceId=? AND ${sharedCondition} LIMIT 1` },
    skills: { table: "kb_operation_skills", query: `SELECT id,'kb_operation_skills' AS sourceTable,title,NULL AS category,tags,NULL AS asin,status,visibility,updatedAt FROM kb_operation_skills WHERE id=? AND workspaceId=? AND ${sharedCondition} LIMIT 1` },
    videos: { table: "kb_videos", query: `SELECT id,'kb_videos' AS sourceTable,COALESCE(videoTitle,asin) AS title,category,tags,asin,status,visibility,updatedAt FROM kb_videos WHERE id=? AND workspaceId=? AND ${sharedCondition} LIMIT 1` },
  };
  const config = queries[input.sourceDomain];
  const rows = await rawExecute(config.query, [input.sourceRowId, input.workspaceId]);
  if (!rows[0]) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "来源必须是当前工作空间内已确认且已共享的产品知识" });
  }
  return rows[0] as SourceRecord;
}

export async function listDistillationProjects(workspaceId: number) {
  const rows = await rawExecute(
    `SELECT p.*,COUNT(DISTINCT s.id) AS sourceCount,COUNT(DISTINCT e.id) AS evidenceCount,COUNT(DISTINCT d.id) AS draftCount
     FROM knowledge_distillation_projects p
     LEFT JOIN knowledge_distillation_sources s ON s.distillationProjectId=p.id AND s.sourceStatus='eligible'
     LEFT JOIN knowledge_distillation_evidence e ON e.distillationProjectId=p.id AND e.status='approved'
     LEFT JOIN knowledge_skill_drafts d ON d.distillationProjectId=p.id
     WHERE p.workspaceId=? GROUP BY p.id ORDER BY p.updatedAt DESC LIMIT 100`,
    [workspaceId],
  );
  return rows.map((row) => ({ ...row, profile: parse(row.profile, {}), sourcePolicy: parse(row.sourcePolicy, {}) }));
}

export async function createDistillationProject(input: { workspaceId: number; userId: number; name: string; description?: string | null; profile: Partial<DistillationProfile> }) {
  const projectKey = key("kdistill");
  const profile = normalizeDistillationProfile(input.profile);
  const sourcePolicy = { selection: "manual_only", eligibleStates: ["confirmed", "team", "public"], autoDistill: false, autoPublish: false };
  await rawExecute(
    `INSERT INTO knowledge_distillation_projects (workspaceId,projectKey,name,description,status,profile,sourcePolicy,createdBy,updatedBy)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [input.workspaceId, projectKey, input.name, input.description || null, "setup", json(profile), json(sourcePolicy), input.userId, input.userId],
  );
  const project = await getProject(projectKey, input.workspaceId);
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), actorUserId: input.userId, eventType: "source_selected", afterSnapshot: { projectKey, action: "created", sourcePolicy } });
  return project;
}

export async function getDistillationProjectDetail(input: { workspaceId: number; projectKey: string }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const [sources, evidence, drafts, events] = await Promise.all([
    rawExecute("SELECT * FROM knowledge_distillation_sources WHERE distillationProjectId=? ORDER BY updatedAt DESC LIMIT 200", [project.id]),
    rawExecute("SELECT * FROM knowledge_distillation_evidence WHERE distillationProjectId=? ORDER BY updatedAt DESC LIMIT 300", [project.id]),
    rawExecute("SELECT * FROM knowledge_skill_drafts WHERE distillationProjectId=? ORDER BY updatedAt DESC LIMIT 200", [project.id]),
    rawExecute("SELECT * FROM knowledge_skill_review_events WHERE distillationProjectId=? ORDER BY createdAt DESC LIMIT 200", [project.id]),
  ]);
  return {
    project,
    sources: sources.map((row) => ({ ...row, sourceMetadata: parse(row.sourceMetadata, {}) })),
    evidence: evidence.map((row) => ({ ...row, normalizedAttributes: parse(row.normalizedAttributes, {}) })),
    drafts: drafts.map((row) => ({ ...row, profile: parse(row.profile, {}), manifestDraft: parse(row.manifestDraft, {}), evidenceKeys: parse(row.evidenceKeys, []), conflictReport: parse(row.conflictReport, null) })),
    events: events.map((row) => ({ ...row, beforeSnapshot: parse(row.beforeSnapshot, null), afterSnapshot: parse(row.afterSnapshot, null) })),
  };
}

export async function listEligibleDistillationSources(input: { workspaceId: number; sourceDomain?: SourceDomain; query?: string }) {
  const sourceDomain = input.sourceDomain || null;
  const query = `%${String(input.query || "").trim().slice(0, 120)}%`;
  const rows = await rawExecute(
    `SELECT * FROM (
       SELECT 'products' AS sourceDomain,id AS sourceRowId,'kb_product_innovations' AS sourceTable,COALESCE(productTitle,asin) AS title,category,asin,updatedAt FROM kb_product_innovations WHERE workspaceId=? AND status='confirmed' AND visibility IN ('team','public')
       UNION ALL
       SELECT 'listings' AS sourceDomain,id AS sourceRowId,'kb_listing_copywriting' AS sourceTable,COALESCE(productTitle,asin) AS title,category,asin,updatedAt FROM kb_listing_copywriting WHERE workspaceId=? AND status='confirmed' AND visibility IN ('team','public')
       UNION ALL
       SELECT 'images' AS sourceDomain,id AS sourceRowId,'kb_image_sets' AS sourceTable,COALESCE(productTitle,asin) AS title,category,asin,updatedAt FROM kb_image_sets WHERE workspaceId=? AND status='confirmed' AND visibility IN ('team','public')
       UNION ALL
       SELECT 'skills' AS sourceDomain,id AS sourceRowId,'kb_operation_skills' AS sourceTable,title,NULL AS category,NULL AS asin,updatedAt FROM kb_operation_skills WHERE workspaceId=? AND status='confirmed' AND visibility IN ('team','public')
       UNION ALL
       SELECT 'videos' AS sourceDomain,id AS sourceRowId,'kb_videos' AS sourceTable,COALESCE(videoTitle,asin) AS title,category,asin,updatedAt FROM kb_videos WHERE workspaceId=? AND status='confirmed' AND visibility IN ('team','public')
     ) candidates
     WHERE (? IS NULL OR sourceDomain=?) AND (title LIKE ? OR COALESCE(asin,'') LIKE ? OR COALESCE(category,'') LIKE ?)
     ORDER BY updatedAt DESC LIMIT 100`,
    [input.workspaceId, input.workspaceId, input.workspaceId, input.workspaceId, input.workspaceId, sourceDomain, sourceDomain, query, query, query],
  );
  return rows.map((row) => ({ ...row, sourceRowId: Number(row.sourceRowId) }));
}

export async function addDistillationSource(input: { workspaceId: number; userId: number; projectKey: string; sourceDomain: SourceDomain; sourceRowId: number }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const source = await fetchEligibleKnowledgeSource(input);
  const sourceContentHash = fingerprint({ sourceTable: source.sourceTable, sourceRowId: source.id, updatedAt: source.updatedAt, status: source.status, visibility: source.visibility });
  const sourceKey = key("ksource");
  await rawExecute(
    `INSERT INTO knowledge_distillation_sources (sourceKey,workspaceId,distillationProjectId,sourceDomain,sourceTable,sourceRowId,sourceContentHash,sourceStatus,sourceSummary,sourceMetadata,selectedBy,confirmedBy,confirmedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE sourceStatus='eligible',updatedAt=NOW()`,
    [sourceKey, input.workspaceId, project.id, input.sourceDomain, source.sourceTable, String(source.id), sourceContentHash, "eligible", source.title, json({ asin: source.asin || null, category: source.category || null, tags: parse(source.tags, []) }), input.userId, input.userId],
  );
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), actorUserId: input.userId, eventType: "source_selected", afterSnapshot: { sourceDomain: input.sourceDomain, sourceTable: source.sourceTable, sourceRowId: source.id, sourceContentHash } });
  return { sourceKey, sourceContentHash, title: source.title, accepted: true };
}

/** 仅由超级管理员明确点击发起；不扫描全库，绝不自动发布。 */
export async function runManualDistillation(input: { workspaceId: number; userId: number; projectKey: string; skillTypeKey: string; title: string; profile: Partial<DistillationProfile>; evidenceKeys: string[]; feedbackContext?: Array<{ feedbackKey: string; outcome: string; note?: string | null; editDelta?: unknown }>; parentDraftKey?: string | null }) {
  if (!isDistillationSkillType(input.skillTypeKey)) throw new TRPCError({ code: "BAD_REQUEST", message: "未知的蒸馏Skill类型" });
  const project = await getProject(input.projectKey, input.workspaceId);
  const uniqueEvidenceKeys = [...new Set(input.evidenceKeys)];
  if (!uniqueEvidenceKeys.length || uniqueEvidenceKeys.length > 30) throw new TRPCError({ code: "BAD_REQUEST", message: "每次手动蒸馏须选择1至30张已批准证据卡" });
  const evidenceRows = await rawExecute(
    `SELECT e.evidenceKey,e.evidenceType,e.claim,e.normalizedAttributes,e.confidence,s.sourceKey,s.sourceSummary,s.sourceMetadata
     FROM knowledge_distillation_evidence e
     INNER JOIN knowledge_distillation_sources s ON s.sourceKey=e.sourceKey AND s.sourceStatus='eligible'
     WHERE e.distillationProjectId=? AND e.workspaceId=? AND e.status='approved' AND e.evidenceKey IN (${uniqueEvidenceKeys.map(() => "?").join(",")})
     ORDER BY e.evidenceKey`,
    [project.id, input.workspaceId, ...uniqueEvidenceKeys],
  ) as any[];
  if (evidenceRows.length !== uniqueEvidenceKeys.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "只能使用当前项目中仍有效的已批准Evidence Card" });
  const profile = normalizeDistillationProfile(input.profile);
  const sourceFingerprint = fingerprint({ skillTypeKey: input.skillTypeKey, profile, evidenceKeys: uniqueEvidenceKeys.sort() });
  const existing = await rawExecute("SELECT draftKey,status FROM knowledge_skill_drafts WHERE distillationProjectId=? AND skillTypeKey=? AND sourceFingerprint=? LIMIT 1", [project.id, input.skillTypeKey, sourceFingerprint]) as any[];
  if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: `相同证据与Profile的草案已存在（${existing[0].status}），请编辑、审查或新建证据版本。` });
  const evidence = evidenceRows.map((row) => ({
    evidenceKey: String(row.evidenceKey), evidenceType: String(row.evidenceType), claim: String(row.claim).slice(0, 2400), confidence: Number(row.confidence),
    normalizedAttributes: parse(row.normalizedAttributes, {}), source: { sourceKey: String(row.sourceKey), summary: String(row.sourceSummary || "").slice(0, 500), metadata: parse(row.sourceMetadata, {}) },
  }));
  const executor = await runEmperorSkill({
    skillSlug: "system.knowledge.distillation.manual", userId: input.userId, workspaceId: input.workspaceId,
    context: JSON.stringify({ task: input.feedbackContext?.length ? "基于已批准证据和人工反馈生成下一版待审Skill规则草案" : "基于已批准证据生成待人工审查的Skill规则草案", skillTypeKey: input.skillTypeKey, title: input.title, profile, evidence, selectedFeedback: (input.feedbackContext || []).slice(0, 30), outputContract: { title: "string", summary: "string", rules: [{ ruleId: "string", instruction: "string", evidenceKeys: ["string"], confidence: "0-1" }], conflicts: [{ type: "string", detail: "string", evidenceKeys: ["string"] }], requiresHumanReview: true } }),
    variables: { projectKey: input.projectKey, skillTypeKey: input.skillTypeKey, evidenceKeys: uniqueEvidenceKeys, profile }, validate: (content) => content,
  });
  const output = parseDistillationOutput(executor.content);
  const rules = Array.isArray(output.rules) ? output.rules.slice(0, 30) : [];
  if (!rules.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "蒸馏结果没有可审查规则，未创建草案" });
  const manifestDraft = {
    ...defaultManifestForSkillType(input.skillTypeKey as DistillationSkillType),
    distillation: { executorRunId: executor.runId, generatedAt: new Date().toISOString(), summary: String(output.summary || "").slice(0, 2000), rules, conflicts: Array.isArray(output.conflicts) ? output.conflicts.slice(0, 20) : [], requiresHumanReview: true },
  };
  const draft = await createSkillDraft({ workspaceId: input.workspaceId, userId: input.userId, projectKey: input.projectKey, skillTypeKey: input.skillTypeKey, title: String(output.title || input.title).slice(0, 255), profile, evidenceKeys: uniqueEvidenceKeys, manifestDraft, parentDraftKey: input.parentDraftKey || null, fingerprintSalt: input.feedbackContext?.map((item) => item.feedbackKey).sort() || null });
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), actorUserId: input.userId, eventType: "draft_created", draftKey: draft.draftKey, afterSnapshot: { mode: "manual_llm", executorRunId: executor.runId, evidenceCount: evidence.length, ruleCount: rules.length } });
  return { ...draft, executorRunId: executor.runId, generatedRuleCount: rules.length, conflicts: manifestDraft.distillation.conflicts };
}

/** 仅复核当前项目已手动选择的来源；不会扫描整个知识库，也不会替换草案。 */
export async function revalidateDistillationSources(input: { workspaceId: number; userId: number; projectKey: string }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const sources = await rawExecute("SELECT sourceKey,sourceDomain,sourceRowId,sourceContentHash FROM knowledge_distillation_sources WHERE distillationProjectId=? AND workspaceId=? AND sourceStatus='eligible'", [project.id, input.workspaceId]) as any[];
  const invalidated: string[] = [];
  for (const source of sources) {
    try {
      const current = await fetchEligibleKnowledgeSource({ workspaceId: input.workspaceId, sourceDomain: source.sourceDomain as SourceDomain, sourceRowId: Number(source.sourceRowId) });
      const currentHash = fingerprint({ sourceTable: current.sourceTable, sourceRowId: current.id, updatedAt: current.updatedAt, status: current.status, visibility: current.visibility });
      if (currentHash !== source.sourceContentHash) invalidated.push(String(source.sourceKey));
    } catch { invalidated.push(String(source.sourceKey)); }
  }
  if (invalidated.length) {
    const placeholders = invalidated.map(() => "?").join(",");
    await rawExecute(`UPDATE knowledge_distillation_sources SET sourceStatus='invalidated',invalidatedAt=NOW(),updatedAt=NOW() WHERE sourceKey IN (${placeholders})`, invalidated);
    await rawExecute(`UPDATE knowledge_distillation_evidence SET status='invalidated',invalidatedAt=NOW(),updatedAt=NOW() WHERE distillationProjectId=? AND sourceKey IN (${placeholders}) AND status='approved'`, [project.id, ...invalidated]);
    await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), actorUserId: input.userId, eventType: "source_invalidated", afterSnapshot: { invalidatedSourceKeys: invalidated, action: "approved_evidence_invalidated" }, reason: "来源发生内容变更、取消共享或未确认，需人工重新选择和批准。" });
  }
  return { checked: sources.length, invalidatedCount: invalidated.length, invalidatedSourceKeys: invalidated };
}

export async function createEvidenceCard(input: {
  workspaceId: number; userId: number; projectKey: string; sourceKey: string; evidenceType: "specification" | "benefit" | "compatibility" | "proof" | "objection" | "visual_pattern" | "compliance" | "brand"; claim: string; normalizedAttributes: Record<string, unknown>; confidence: number;
}) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const source = (await rawExecute("SELECT sourceKey FROM knowledge_distillation_sources WHERE sourceKey=? AND distillationProjectId=? AND sourceStatus='eligible' LIMIT 1", [input.sourceKey, project.id]))[0];
  if (!source) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "证据卡必须关联当前项目中合格的共享知识来源" });
  const evidenceKey = key("kevidence");
  await rawExecute(
    `INSERT INTO knowledge_distillation_evidence (evidenceKey,workspaceId,distillationProjectId,sourceKey,evidenceType,claim,normalizedAttributes,confidence,status,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [evidenceKey, input.workspaceId, project.id, input.sourceKey, input.evidenceType, input.claim, json(input.normalizedAttributes), Math.max(0, Math.min(1, input.confidence)), "draft", input.userId],
  );
  return { evidenceKey, status: "draft" as const };
}

export async function reviewEvidenceCard(input: { workspaceId: number; userId: number; projectKey: string; evidenceKey: string; approved: boolean; reviewNote?: string | null }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const status = input.approved ? "approved" : "rejected";
  const result = await rawExecute(
    `UPDATE knowledge_distillation_evidence SET status=?,reviewerUserId=?,reviewNote=?,approvedAt=IF(?='approved',NOW(),NULL),updatedAt=NOW()
     WHERE evidenceKey=? AND distillationProjectId=? AND workspaceId=?`,
    [status, input.userId, input.reviewNote || null, status, input.evidenceKey, project.id, input.workspaceId],
  );
  if ((result as any)?.affectedRows === 0) throw new TRPCError({ code: "NOT_FOUND", message: "证据卡不存在" });
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), actorUserId: input.userId, eventType: "evidence_approved", afterSnapshot: { evidenceKey: input.evidenceKey, status }, reason: input.reviewNote || null });
  return { evidenceKey: input.evidenceKey, status };
}

export async function createSkillDraft(input: { workspaceId: number; userId: number; projectKey: string; skillTypeKey: string; title: string; profile: Partial<DistillationProfile>; evidenceKeys: string[]; manifestDraft?: Record<string, unknown>; proposedSkillSlug?: string | null; parentDraftKey?: string | null; fingerprintSalt?: unknown }) {
  if (!isDistillationSkillType(input.skillTypeKey)) throw new TRPCError({ code: "BAD_REQUEST", message: "未知的蒸馏Skill类型" });
  const project = await getProject(input.projectKey, input.workspaceId);
  const evidenceRows = await rawExecute(
    `SELECT e.evidenceKey FROM knowledge_distillation_evidence e
     INNER JOIN knowledge_distillation_sources s ON s.sourceKey=e.sourceKey AND s.sourceStatus='eligible'
     WHERE e.distillationProjectId=? AND e.workspaceId=? AND e.status='approved' AND e.evidenceKey IN (${input.evidenceKeys.map(() => "?").join(",") || "NULL"})`,
    [project.id, input.workspaceId, ...input.evidenceKeys],
  );
  if (input.evidenceKeys.length === 0 || evidenceRows.length !== new Set(input.evidenceKeys).size) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "草案必须引用至少一张已批准的证据卡" });
  }
  const skillTypeKey = input.skillTypeKey as DistillationSkillType;
  const profile = normalizeDistillationProfile(input.profile);
  const sourceFingerprint = fingerprint({ skillTypeKey, profile, evidenceKeys: [...new Set(input.evidenceKeys)].sort(), revisionContext: input.fingerprintSalt || null });
  const draftKey = key("kdraft");
  const manifestDraft = input.manifestDraft || defaultManifestForSkillType(skillTypeKey);
  const conflictReport = await detectDraftConflicts({ projectId: Number(project.id), workspaceId: input.workspaceId, skillTypeKey, profile, sourceFingerprint, manifestDraft });
  const draftStatus: DistillationDraftStatus = conflictReport.hasConflict ? "conflict" : "draft";
  const artifact = await registerUnifiedArtifact({
    workspaceId: input.workspaceId,
    domain: "agent",
    artifactKey: `knowledge.distillation.draft.${skillTypeKey}`,
    artifactType: "json",
    sourceType: "user_edit",
    sourceTable: "knowledge_skill_drafts",
    sourceRowId: draftKey,
    userId: input.userId,
    status: "draft",
    content: { title: input.title, skillTypeKey, profile, evidenceKeys: input.evidenceKeys, manifestDraft },
    metadata: { projectKey: input.projectKey, sourceFingerprint },
  });
  await rawExecute(
    `INSERT INTO knowledge_skill_drafts (draftKey,workspaceId,distillationProjectId,skillTypeKey,title,profile,manifestDraft,evidenceKeys,sourceFingerprint,parentDraftKey,proposedSkillSlug,status,conflictReport,artifactId,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [draftKey, input.workspaceId, project.id, skillTypeKey, input.title, json(profile), json(manifestDraft), json([...new Set(input.evidenceKeys)]), sourceFingerprint, input.parentDraftKey || null, input.proposedSkillSlug || null, draftStatus, json(conflictReport), artifact?.artifactId || null, input.userId],
  );
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey, actorUserId: input.userId, eventType: "draft_created", afterSnapshot: { skillTypeKey, profile, evidenceCount: input.evidenceKeys.length, status: draftStatus } });
  if (conflictReport.hasConflict) await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey, actorUserId: input.userId, eventType: "conflict_detected", afterSnapshot: conflictReport, reason: "系统检测到重复或相反规则，等待人工处理。" });
  return { draftKey, status: draftStatus, artifactRef: artifact?.ref || null, conflictReport };
}

/** 草案在人工审查或发布前可编辑；已批准/已发布记录不可原地改写。 */
export async function updateSkillDraft(input: { workspaceId: number; userId: number; projectKey: string; draftKey: string; title: string; profile: Partial<DistillationProfile>; evidenceKeys: string[]; manifestDraft: Record<string, unknown>; editNote?: string | null }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const before = (await rawExecute("SELECT * FROM knowledge_skill_drafts WHERE draftKey=? AND distillationProjectId=? AND workspaceId=? LIMIT 1", [input.draftKey, project.id, input.workspaceId]))[0] as any;
  if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Skill草案不存在" });
  if (!["draft", "conflict", "rejected"].includes(String(before.status))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "仅草案、冲突或已拒绝版本可编辑；已审查/已发布版本必须创建新草案" });
  const evidenceKeys = [...new Set(input.evidenceKeys)];
  const evidenceRows = await rawExecute(
    `SELECT e.evidenceKey FROM knowledge_distillation_evidence e
     INNER JOIN knowledge_distillation_sources s ON s.sourceKey=e.sourceKey AND s.sourceStatus='eligible'
     WHERE e.distillationProjectId=? AND e.workspaceId=? AND e.status='approved' AND e.evidenceKey IN (${evidenceKeys.map(() => "?").join(",") || "NULL"})`,
    [project.id, input.workspaceId, ...evidenceKeys],
  );
  if (!evidenceKeys.length || evidenceRows.length !== evidenceKeys.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "编辑后的草案必须引用当前项目中仍有效的已批准证据卡" });
  const skillTypeKey = String(before.skillTypeKey) as DistillationSkillType;
  const profile = normalizeDistillationProfile(input.profile);
  const sourceFingerprint = fingerprint({ skillTypeKey, profile, evidenceKeys: [...evidenceKeys].sort() });
  const duplicate = (await rawExecute("SELECT draftKey,status FROM knowledge_skill_drafts WHERE distillationProjectId=? AND skillTypeKey=? AND sourceFingerprint=? AND draftKey<>? LIMIT 1", [project.id, skillTypeKey, sourceFingerprint, input.draftKey]))[0] as any;
  if (duplicate) throw new TRPCError({ code: "CONFLICT", message: `相同证据与Profile的草案已存在（${duplicate.status}），请在该草案继续处理或选择新的证据版本。` });
  const conflictReport = await detectDraftConflicts({ projectId: Number(project.id), workspaceId: input.workspaceId, skillTypeKey, profile, sourceFingerprint, manifestDraft: input.manifestDraft, excludingDraftKey: input.draftKey });
  const nextStatus: DistillationDraftStatus = conflictReport.hasConflict ? "conflict" : "draft";
  await rawExecute(
    "UPDATE knowledge_skill_drafts SET title=?,profile=?,manifestDraft=?,evidenceKeys=?,sourceFingerprint=?,status=?,conflictReport=?,reviewSummary=NULL,reviewedBy=NULL,reviewedAt=NULL,updatedAt=NOW() WHERE draftKey=? AND workspaceId=?",
    [input.title.trim(), json(profile), json(input.manifestDraft), json(evidenceKeys), sourceFingerprint, nextStatus, json(conflictReport), input.draftKey, input.workspaceId],
  );
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey: input.draftKey, actorUserId: input.userId, eventType: "draft_edited", beforeSnapshot: { title: before.title, profile: parse(before.profile, {}), evidenceKeys: parse(before.evidenceKeys, []), status: before.status }, afterSnapshot: { title: input.title.trim(), profile, evidenceKeys, status: nextStatus }, reason: input.editNote || "人工编辑草案" });
  if (conflictReport.hasConflict) await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey: input.draftKey, actorUserId: input.userId, eventType: "conflict_detected", afterSnapshot: conflictReport, reason: "编辑后检测到重复或相反规则，等待人工处理。" });
  return { draftKey: input.draftKey, status: nextStatus, conflictReport };
}

export async function transitionSkillDraft(input: { workspaceId: number; userId: number; projectKey: string; draftKey: string; status: DistillationDraftStatus; reviewSummary?: string | null; conflictReport?: unknown }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const rows = await rawExecute("SELECT * FROM knowledge_skill_drafts WHERE draftKey=? AND distillationProjectId=? AND workspaceId=? LIMIT 1", [input.draftKey, project.id, input.workspaceId]);
  const before = rows[0];
  if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Skill草案不存在" });
  const currentStatus = String(before.status) as DistillationDraftStatus;
  if (!canTransitionDraft(currentStatus, input.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `草案不能从${currentStatus}直接变更为${input.status}` });
  await rawExecute(
    "UPDATE knowledge_skill_drafts SET status=?,reviewSummary=?,conflictReport=?,reviewedBy=?,reviewedAt=NOW(),updatedAt=NOW() WHERE draftKey=?",
    [input.status, input.reviewSummary || null, input.conflictReport === undefined ? before.conflictReport : json(input.conflictReport), input.userId, input.draftKey],
  );
  const eventType = input.status === "review" ? "review_requested" : input.status === "approved" ? "approved" : input.status === "rejected" ? "rejected" : input.status === "conflict" ? "conflict_detected" : "draft_edited";
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey: input.draftKey, actorUserId: input.userId, eventType, beforeSnapshot: { status: currentStatus }, afterSnapshot: { status: input.status }, reason: input.reviewSummary || null });
  return { draftKey: input.draftKey, status: input.status };
}

export async function publishApprovedSkillDraft(input: { workspaceId: number; userId: number; projectKey: string; draftKey: string; releaseNote: string }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const draft = (await rawExecute("SELECT * FROM knowledge_skill_drafts WHERE draftKey=? AND workspaceId=? AND distillationProjectId=? LIMIT 1", [input.draftKey, input.workspaceId, project.id]))[0];
  if (!draft || draft.status !== "approved") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "只有已批准的草案可以发布为Skill版本" });
  const skillSlug = `distilled.ws${input.workspaceId}.${draft.skillTypeKey}.${String(draft.sourceFingerprint).slice(0, 12)}.${String(draft.draftKey).slice(-8)}`.slice(0, 128);
  const existing = (await rawExecute("SELECT slug FROM emperor_skills WHERE slug=? LIMIT 1", [skillSlug]))[0];
  if (existing) throw new TRPCError({ code: "CONFLICT", message: "该草案已生成不可变发布版本，不能重复覆盖或发布。" });
  const manifest = parse<Record<string, unknown>>(draft.manifestDraft, {});
  const nextVersion = 1;
  await rawExecute(
    `INSERT INTO emperor_skills (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,manifest,when_to_use,timeout_seconds,execution_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [input.workspaceId, skillSlug, draft.title, `由知识蒸馏草案 ${draft.draftKey} 经人工审批发布。`, "知识蒸馏", "knowledge_distillation", "L2", "Released", "shared", nextVersion, 0, 0, json(manifest), "仅当用户在匹配Profile下显式选择后使用。", 120, "inline"],
  );
  const skill = (await rawExecute("SELECT * FROM emperor_skills WHERE slug=? LIMIT 1", [skillSlug]))[0];
  const snapshot = await captureSkillVersionSnapshot({ skill, workspaceId: input.workspaceId, userId: input.userId, source: "create" });
  await rawExecute("UPDATE knowledge_skill_drafts SET status='published',proposedSkillSlug=?,proposedSkillVersion=?,publishedAt=NOW(),reviewSummary=?,updatedAt=NOW() WHERE draftKey=?", [skillSlug, nextVersion, input.releaseNote, input.draftKey]);
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey: input.draftKey, actorUserId: input.userId, eventType: "published", afterSnapshot: { skillSlug, skillVersion: nextVersion, snapshotId: snapshot.snapshotId }, reason: input.releaseNote });
  return { skillSlug, skillVersion: nextVersion, snapshotId: snapshot.snapshotId };
}

export async function listPublishedDistillationSkillVersions(workspaceId: number) {
  return rawExecute(
    `SELECT s.snapshotId,s.skillSlug,s.skillVersion,s.snapshotHash,s.source,s.createdAt AS snapshotCreatedAt,
            e.name,e.description,e.version,e.updatedAt,e.createdAt,e.manifest
     FROM emperor_skill_version_snapshots s
     INNER JOIN emperor_skills e ON e.slug=s.skillSlug AND e.workspaceId=? AND e.owner='knowledge_distillation' AND e.status='Released'
     WHERE s.workspaceId=?
     ORDER BY s.createdAt DESC LIMIT 200`,
    [workspaceId, workspaceId],
  ).then((rows: any[]) => rows.map((row) => ({ ...row, manifest: parse(row.manifest, {}) })));
}

/** 回滚只从属于当前项目、当前工作空间的历史快照新建一条版本，不会修改历史Skill或已锁定任务。 */
export async function restoreDistillationSkillSnapshot(input: { workspaceId: number; userId: number; projectKey: string; snapshotId: string; releaseNote: string }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const source = (await rawExecute(
    `SELECT s.*,e.name,e.description,d.draftKey
     FROM emperor_skill_version_snapshots s
     INNER JOIN emperor_skills e ON e.slug=s.skillSlug AND e.workspaceId=? AND e.owner='knowledge_distillation' AND e.status='Released'
     INNER JOIN knowledge_skill_drafts d ON d.proposedSkillSlug=e.slug AND d.workspaceId=? AND d.distillationProjectId=? AND d.status='published'
     WHERE s.snapshotId=? AND s.workspaceId=? LIMIT 1`,
    [input.workspaceId, input.workspaceId, project.id, input.snapshotId, input.workspaceId],
  ))[0] as any;
  if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "历史快照不存在、无权访问，或不属于当前蒸馏项目" });
  const restoredSlug = `distilled.ws${input.workspaceId}.rollback.${String(source.snapshotHash).slice(0, 12)}.${randomUUID().replace(/-/g, "").slice(0, 8)}`.slice(0, 128);
  const manifest = parse<Record<string, unknown>>(source.manifest, {});
  await rawExecute(
    `INSERT INTO emperor_skills (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,manifest,when_to_use,timeout_seconds,execution_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [input.workspaceId, restoredSlug, `回滚版本 · ${String(source.name).slice(0, 220)}`, `由历史快照 ${input.snapshotId} 经超级管理员明确恢复；不覆盖原版本。`, "知识蒸馏", "knowledge_distillation", "L2", "Released", "shared", 1, 0, 0, json(manifest), "仅当用户在匹配Profile下显式选择后使用。", 120, "inline"],
  );
  const restored = (await rawExecute("SELECT * FROM emperor_skills WHERE slug=? AND workspaceId=? LIMIT 1", [restoredSlug, input.workspaceId]))[0];
  const snapshot = await captureSkillVersionSnapshot({ skill: restored, workspaceId: input.workspaceId, userId: input.userId, source: "create" });
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey: String(source.draftKey), actorUserId: input.userId, eventType: "rolled_back", beforeSnapshot: { sourceSkillSlug: source.skillSlug, sourceSnapshotId: input.snapshotId }, afterSnapshot: { restoredSkillSlug: restoredSlug, restoredSnapshotId: snapshot.snapshotId }, reason: input.releaseNote });
  return { restoredSkillSlug: restoredSlug, restoredSnapshotId: snapshot.snapshotId, sourceSkillSlug: String(source.skillSlug), sourceSnapshotId: input.snapshotId };
}

export async function recordDistillationFeedback(input: { workspaceId: number; userId: number; projectKey?: string | null; skillSlug: string; skillVersion?: number | null; consumerDomain: "listing" | "image" | "other"; consumerRef: string; outcome: "accepted" | "revised" | "rejected" | "published" | "issue"; editDelta?: unknown; note?: string | null }) {
  let projectId: number | null = null;
  if (input.projectKey) projectId = Number((await getProject(input.projectKey, input.workspaceId)).id);
  const skill = (await rawExecute("SELECT slug,version FROM emperor_skills WHERE slug=? AND workspaceId=? AND owner='knowledge_distillation' AND status='Released' LIMIT 1", [input.skillSlug, input.workspaceId]))[0] as any;
  if (!skill) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "反馈只能关联当前工作空间已发布的知识蒸馏Skill" });
  if (input.skillVersion && Number(skill.version) !== input.skillVersion) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "反馈的Skill版本与当前受治理版本不一致" });
  const feedbackKey = key("kfeedback");
  await rawExecute(
    `INSERT INTO knowledge_skill_feedback (feedbackKey,workspaceId,distillationProjectId,skillSlug,skillVersion,consumerDomain,consumerRef,outcome,editDelta,note,recordedBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [feedbackKey, input.workspaceId, projectId, input.skillSlug, input.skillVersion || null, input.consumerDomain, input.consumerRef, input.outcome, json(input.editDelta), input.note || null, input.userId],
  );
  return { feedbackKey };
}

export async function listDistillationFeedback(input: { workspaceId: number; projectKey?: string | null }) {
  let projectId: number | null = null;
  if (input.projectKey) projectId = Number((await getProject(input.projectKey, input.workspaceId)).id);
  const rows = await rawExecute(
    `SELECT f.*,d.draftKey AS parentDraftKey,d.skillTypeKey,d.title AS parentDraftTitle
     FROM knowledge_skill_feedback f
     INNER JOIN knowledge_skill_drafts d ON d.proposedSkillSlug=f.skillSlug AND d.workspaceId=f.workspaceId AND d.status='published'
     WHERE f.workspaceId=? ${projectId ? "AND d.distillationProjectId=?" : ""}
     ORDER BY f.createdAt DESC LIMIT 200`,
    projectId ? [input.workspaceId, projectId] : [input.workspaceId],
  );
  return (rows as any[]).map((row) => ({ ...row, editDelta: parse(row.editDelta, null) }));
}

export async function summarizeDistillationFeedback(input: { workspaceId: number; projectKey?: string | null }) {
  let projectId: number | null = null;
  if (input.projectKey) projectId = Number((await getProject(input.projectKey, input.workspaceId)).id);
  return rawExecute(
    `SELECT f.skillSlug,f.skillVersion,COUNT(*) AS total,
            SUM(CASE WHEN f.outcome='accepted' THEN 1 ELSE 0 END) AS acceptedCount,
            SUM(CASE WHEN f.outcome='revised' THEN 1 ELSE 0 END) AS revisedCount,
            SUM(CASE WHEN f.outcome='rejected' THEN 1 ELSE 0 END) AS rejectedCount,
            SUM(CASE WHEN f.outcome='issue' THEN 1 ELSE 0 END) AS issueCount,
            MAX(f.createdAt) AS latestFeedbackAt
     FROM knowledge_skill_feedback f
     INNER JOIN knowledge_skill_drafts d ON d.proposedSkillSlug=f.skillSlug AND d.workspaceId=f.workspaceId AND d.status='published'
     WHERE f.workspaceId=? ${projectId ? "AND d.distillationProjectId=?" : ""}
     GROUP BY f.skillSlug,f.skillVersion
     ORDER BY latestFeedbackAt DESC LIMIT 100`,
    projectId ? [input.workspaceId, projectId] : [input.workspaceId],
  );
}

/** 反馈只在管理员显式点击、明确选择同一父草案的反馈和有效Evidence后用于生成下一版草案。 */
export async function createNextDraftFromFeedback(input: { workspaceId: number; userId: number; projectKey: string; title: string; feedbackKeys: string[]; evidenceKeys: string[] }) {
  const project = await getProject(input.projectKey, input.workspaceId);
  const uniqueFeedbackKeys = [...new Set(input.feedbackKeys)];
  if (!uniqueFeedbackKeys.length || uniqueFeedbackKeys.length > 30) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择1至30条反馈来创建下一版草案" });
  const feedbackRows = await rawExecute(
    `SELECT f.feedbackKey,f.outcome,f.note,f.editDelta,d.draftKey AS parentDraftKey,d.skillTypeKey,d.profile
     FROM knowledge_skill_feedback f
     INNER JOIN knowledge_skill_drafts d ON d.proposedSkillSlug=f.skillSlug AND d.workspaceId=f.workspaceId AND d.status='published'
     WHERE f.workspaceId=? AND d.distillationProjectId=? AND f.feedbackKey IN (${uniqueFeedbackKeys.map(() => "?").join(",")})`,
    [input.workspaceId, project.id, ...uniqueFeedbackKeys],
  ) as any[];
  if (feedbackRows.length !== uniqueFeedbackKeys.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "反馈必须来自当前项目已发布的蒸馏Skill" });
  const parentDraftKeys = [...new Set(feedbackRows.map((row) => String(row.parentDraftKey)))];
  if (parentDraftKeys.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "每次下一版草案只能使用同一个已发布Skill的反馈" });
  const first = feedbackRows[0];
  return runManualDistillation({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectKey: input.projectKey,
    skillTypeKey: String(first.skillTypeKey),
    title: input.title,
    profile: parse(first.profile, {}),
    evidenceKeys: input.evidenceKeys,
    parentDraftKey: String(first.parentDraftKey),
    feedbackContext: feedbackRows.map((row) => ({ feedbackKey: String(row.feedbackKey), outcome: String(row.outcome), note: row.note ? String(row.note).slice(0, 2000) : null, editDelta: parse(row.editDelta, null) })),
  });
}
