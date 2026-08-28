import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { registerUnifiedArtifact } from "../ai_os/services/artifactLifecycle";
import { captureSkillVersionSnapshot } from "../ai_os/services/skillQualityGates";
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

export async function createSkillDraft(input: { workspaceId: number; userId: number; projectKey: string; skillTypeKey: string; title: string; profile: Partial<DistillationProfile>; evidenceKeys: string[]; manifestDraft?: Record<string, unknown>; proposedSkillSlug?: string | null }) {
  if (!isDistillationSkillType(input.skillTypeKey)) throw new TRPCError({ code: "BAD_REQUEST", message: "未知的蒸馏Skill类型" });
  const project = await getProject(input.projectKey, input.workspaceId);
  const evidenceRows = await rawExecute(
    `SELECT evidenceKey FROM knowledge_distillation_evidence
     WHERE distillationProjectId=? AND workspaceId=? AND status='approved' AND evidenceKey IN (${input.evidenceKeys.map(() => "?").join(",") || "NULL"})`,
    [project.id, input.workspaceId, ...input.evidenceKeys],
  );
  if (input.evidenceKeys.length === 0 || evidenceRows.length !== new Set(input.evidenceKeys).size) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "草案必须引用至少一张已批准的证据卡" });
  }
  const skillTypeKey = input.skillTypeKey as DistillationSkillType;
  const profile = normalizeDistillationProfile(input.profile);
  const sourceFingerprint = fingerprint({ skillTypeKey, profile, evidenceKeys: [...new Set(input.evidenceKeys)].sort() });
  const draftKey = key("kdraft");
  const manifestDraft = input.manifestDraft || defaultManifestForSkillType(skillTypeKey);
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
    `INSERT INTO knowledge_skill_drafts (draftKey,workspaceId,distillationProjectId,skillTypeKey,title,profile,manifestDraft,evidenceKeys,sourceFingerprint,proposedSkillSlug,status,artifactId,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [draftKey, input.workspaceId, project.id, skillTypeKey, input.title, json(profile), json(manifestDraft), json([...new Set(input.evidenceKeys)]), sourceFingerprint, input.proposedSkillSlug || null, "draft", artifact?.artifactId || null, input.userId],
  );
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey, actorUserId: input.userId, eventType: "draft_created", afterSnapshot: { skillTypeKey, profile, evidenceCount: input.evidenceKeys.length } });
  return { draftKey, status: "draft" as const, artifactRef: artifact?.ref || null };
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
  const skillSlug = String(draft.proposedSkillSlug || `distilled.${draft.skillTypeKey}.${String(draft.sourceFingerprint).slice(0, 12)}`).slice(0, 128);
  const existing = (await rawExecute("SELECT * FROM emperor_skills WHERE slug=? LIMIT 1", [skillSlug]))[0];
  const manifest = parse<Record<string, unknown>>(draft.manifestDraft, {});
  const nextVersion = existing ? Number(existing.version || 0) + 1 : 1;
  if (existing) {
    await rawExecute("UPDATE emperor_skills SET name=?,description=?,category=?,owner=?,riskTier=?,status='Released',scope='shared',version=?,manifest=?,updatedAt=NOW() WHERE slug=?", [draft.title, `由知识蒸馏草案 ${draft.draftKey} 经人工审批发布。`, "知识蒸馏", "knowledge_distillation", "L2", nextVersion, json(manifest), skillSlug]);
  } else {
    await rawExecute(
      `INSERT INTO emperor_skills (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,manifest,when_to_use,timeout_seconds,execution_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [input.workspaceId, skillSlug, draft.title, `由知识蒸馏草案 ${draft.draftKey} 经人工审批发布。`, "知识蒸馏", "knowledge_distillation", "L2", "Released", "shared", nextVersion, 0, 0, json(manifest), "仅当用户在匹配Profile下显式选择后使用。", 120, "inline"],
    );
  }
  const skill = (await rawExecute("SELECT * FROM emperor_skills WHERE slug=? LIMIT 1", [skillSlug]))[0];
  const snapshot = await captureSkillVersionSnapshot({ skill, workspaceId: input.workspaceId, userId: input.userId, source: existing ? "release" : "create" });
  await rawExecute("UPDATE knowledge_skill_drafts SET status='published',proposedSkillSlug=?,proposedSkillVersion=?,publishedAt=NOW(),reviewSummary=?,updatedAt=NOW() WHERE draftKey=?", [skillSlug, nextVersion, input.releaseNote, input.draftKey]);
  await recordReviewEvent({ workspaceId: input.workspaceId, distillationProjectId: Number(project.id), draftKey: input.draftKey, actorUserId: input.userId, eventType: "published", afterSnapshot: { skillSlug, skillVersion: nextVersion, snapshotId: snapshot.snapshotId }, reason: input.releaseNote });
  return { skillSlug, skillVersion: nextVersion, snapshotId: snapshot.snapshotId };
}

export async function recordDistillationFeedback(input: { workspaceId: number; userId: number; projectKey?: string | null; skillSlug: string; skillVersion?: number | null; consumerDomain: "listing" | "image" | "other"; consumerRef: string; outcome: "accepted" | "revised" | "rejected" | "published" | "issue"; editDelta?: unknown; note?: string | null }) {
  let projectId: number | null = null;
  if (input.projectKey) projectId = Number((await getProject(input.projectKey, input.workspaceId)).id);
  const feedbackKey = key("kfeedback");
  await rawExecute(
    `INSERT INTO knowledge_skill_feedback (feedbackKey,workspaceId,distillationProjectId,skillSlug,skillVersion,consumerDomain,consumerRef,outcome,editDelta,note,recordedBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [feedbackKey, input.workspaceId, projectId, input.skillSlug, input.skillVersion || null, input.consumerDomain, input.consumerRef, input.outcome, json(input.editDelta), input.note || null, input.userId],
  );
  return { feedbackKey };
}
