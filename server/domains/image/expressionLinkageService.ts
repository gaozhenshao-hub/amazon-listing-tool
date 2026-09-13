import { createHash } from "node:crypto";
import type { ImageExpressionAnalysisVersion } from "../../../drizzle/schema/image";
import { requireDb } from "../../repositories/dbClient";
import * as imageDb from "./repository";
import {
  ExpressionGroupAnalysisSchema,
  ExpressionSelectionFilterSchema,
  Step0SynthesisSchema,
  assertExpressionEvidence,
  assertSynthesisSelection,
  buildExpressionSelectionHash,
  collectSynthesisDecisionIds,
  type ExpressionSelectionFilter,
} from "./expressionLinkageContracts";
import {
  confirmExpressionSelection,
  countConfirmedSelectionsWithoutAnalysis,
  createExpressionAnalysisVersion,
  createExpressionAssetLinks,
  createExpressionSelectionVersion,
  createStep0SynthesisVersion,
  getExpressionGroupForProject,
  getExpressionSelectionById,
  getLatestConfirmedStep0Artifact,
  getLatestExpressionAnalysis,
  getLatestExpressionSelection,
  getLatestStep0Synthesis,
  listConfirmedExpressionAnalyses,
  listExpressionSelectionLinks,
  nextExpressionAnalysisVersion,
  nextExpressionSelectionVersion,
  nextStep0SynthesisVersion,
  supersedeExpressionAnalyses,
  supersedeExpressionSelections,
  supersedeStep0Synthesis,
  updateExpressionAnalysis,
  updateStep0Synthesis,
} from "./expressionLinkageRepository";
import { listCompetitorGallerySubjects } from "./competitorGalleryService";
import {
  createStep0Artifact,
  nextStep0ArtifactVersion,
  supersedeStep0Artifacts,
} from "./competitorGalleryRepository";

function workspaceIdOrThrow(workspaceId?: number | null) {
  const value = Number(workspaceId || 0);
  if (value <= 0) throw new Error("当前工作空间不可用");
  return value;
}

function factValue(fact: any) {
  return (fact?.userEdit || fact?.aiFacts || {}) as Record<string, unknown>;
}

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function includesText(values: unknown[], query: string) {
  const keyword = normalized(query);
  return !keyword || values.some((value) => normalized(value).includes(keyword));
}

function candidateScore(input: { expressionName: string; facts: Record<string, unknown> }) {
  const sellingPoints = Array.isArray(input.facts.sellingPoints) ? input.facts.sellingPoints : [];
  const expressionMethod = String(input.facts.expressionMethod || "");
  const expressionMatch = includesText([expressionMethod], input.expressionName);
  const sellingPointMatch = includesText(sellingPoints, input.expressionName);
  const confidence = Number(input.facts.confidence || 0);
  const score = Math.min(1, (expressionMatch ? 0.5 : 0) + (sellingPointMatch ? 0.35 : 0) + Math.max(0, confidence) * 0.15);
  return { score, recommended: score >= 0.45 };
}

export async function listExpressionAssetCandidates(input: {
  workspaceId?: number | null;
  projectId: number;
  groupId: number;
  filters?: Partial<ExpressionSelectionFilter>;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("expression asset candidates");
  const group = await getExpressionGroupForProject(db, input.projectId, input.groupId);
  if (!group) throw new Error("表达方向不存在");
  const filters = ExpressionSelectionFilterSchema.parse(input.filters || {});
  const subjects = await listCompetitorGallerySubjects({ workspaceId, projectId: input.projectId });
  const candidates = subjects.flatMap((subject: any) => (subject.status === "confirmed" ? subject.assets : []).flatMap((asset: any) => {
    if (!asset.fact || asset.fact.status !== "confirmed") return [];
    const facts = factValue(asset.fact);
    const sellingPoints = Array.isArray(facts.sellingPoints) ? facts.sellingPoints.map(String) : [];
    const expressionMethod = String(facts.expressionMethod || "");
    const proofType = String(facts.proofType || "none");
    const confidence = Number(facts.confidence || asset.fact.confidence || 0);
    if (filters.subjectIds.length && !filters.subjectIds.includes(subject.id)) return [];
    if (filters.subjectRoles.length && !filters.subjectRoles.includes(subject.role)) return [];
    if (filters.assetRoles.length && !filters.assetRoles.includes(asset.role)) return [];
    if (filters.proofTypes.length && !filters.proofTypes.includes(proofType)) return [];
    if (confidence < filters.minConfidence) return [];
    if (!includesText(sellingPoints, filters.sellingPoint)) return [];
    if (!includesText([expressionMethod], filters.expressionMethod)) return [];
    const recommendation = candidateScore({ expressionName: group.expressionName, facts });
    return [{
      assetId: asset.id,
      subjectId: subject.id,
      subjectRole: subject.role,
      subjectName: subject.displayName,
      asin: subject.asin,
      assetRole: asset.role,
      positionIndex: asset.positionIndex,
      imageUrl: asset.imageUrl,
      sellingPoints,
      expressionMethod,
      proofType,
      confidence,
      recommended: recommendation.recommended,
      matchScore: recommendation.score,
    }];
  }));
  const selection = await getLatestExpressionSelection(db, workspaceId, input.projectId, input.groupId);
  const links = selection ? await listExpressionSelectionLinks(db, workspaceId, selection.id) : [];
  const analysis = await getLatestExpressionAnalysis(db, workspaceId, input.projectId, input.groupId);
  return { group, filters, candidates, selection, links, analysis };
}

export async function saveExpressionSelection(input: {
  workspaceId?: number | null;
  projectId: number;
  groupId: number;
  sessionId: number;
  userId: number;
  filters?: Partial<ExpressionSelectionFilter>;
  selectedAssetIds: number[];
  aiRecommendedAssetIds?: number[];
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const filters = ExpressionSelectionFilterSchema.parse(input.filters || {});
  const selectedAssetIds = [...new Set(input.selectedAssetIds.map(Number))];
  if (!selectedAssetIds.length) throw new Error("请至少选择一张已确认竞品图片");
  if (selectedAssetIds.length !== input.selectedAssetIds.length || selectedAssetIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("同一选择版本不能包含重复或无效图片");
  }
  const options = await listExpressionAssetCandidates({ workspaceId, projectId: input.projectId, groupId: input.groupId, filters: {} });
  const candidateById = new Map(options.candidates.map((item) => [item.assetId, item]));
  const selected = selectedAssetIds.map((assetId) => candidateById.get(assetId));
  if (selected.some((item) => !item)) throw new Error("选择包含未确认或不属于当前项目的竞品图片");
  const db = await requireDb("save expression selection");
  const selectionHash = buildExpressionSelectionHash({ groupId: input.groupId, assetIds: selectedAssetIds, filters });
  const latest = await getLatestExpressionSelection(db, workspaceId, input.projectId, input.groupId);
  if (latest?.selectionHash === selectionHash && latest.status !== "superseded") return { ...latest, reused: true };
  const aiRecommended = new Set(input.aiRecommendedAssetIds || []);
  return db.transaction(async (tx) => {
    await supersedeExpressionSelections(tx, workspaceId, input.projectId, input.groupId);
    await supersedeExpressionAnalyses(tx, workspaceId, input.projectId, input.groupId);
    await supersedeStep0Synthesis(tx, workspaceId, input.projectId);
    await supersedeStep0Artifacts(tx, workspaceId, input.projectId, "composite");
    const version = await nextExpressionSelectionVersion(tx, input.groupId);
    const selectionVersionId = await createExpressionSelectionVersion(tx, {
      workspaceId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      groupId: input.groupId,
      version,
      status: "draft",
      filterState: filters,
      selectedAssetIds,
      selectionHash,
      createdBy: input.userId,
    });
    await createExpressionAssetLinks(tx, selected.map((candidate: any, index) => ({
      workspaceId,
      projectId: input.projectId,
      selectionVersionId,
      groupId: input.groupId,
      subjectId: candidate.subjectId,
      acquisitionAssetId: candidate.assetId,
      sortOrder: index,
      source: aiRecommended.has(candidate.assetId) ? "ai_recommended" : "manual",
      matchScore: String(candidate.matchScore),
      matchedSellingPoint: candidate.sellingPoints[0] || null,
      matchedExpressionMethod: candidate.expressionMethod || null,
    })));
    return { id: selectionVersionId, version, status: "draft", reused: false };
  });
}

export async function confirmExpressionSelectionVersion(input: {
  workspaceId?: number | null; projectId: number; groupId: number; selectionVersionId: number; userId: number;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("confirm expression selection");
  const selection = await getExpressionSelectionById(db, workspaceId, input.projectId, input.selectionVersionId);
  if (!selection || selection.groupId !== input.groupId) throw new Error("选择版本不存在");
  if (selection.status === "confirmed") return { success: true };
  if (selection.status !== "draft") throw new Error("只有当前草稿选择版本可以确认");
  const links = await listExpressionSelectionLinks(db, workspaceId, selection.id);
  if (!links.length || links.length !== (Array.isArray(selection.selectedAssetIds) ? selection.selectedAssetIds.length : 0)) {
    throw new Error("选择版本图片链接不完整");
  }
  await confirmExpressionSelection(db, workspaceId, input.projectId, selection.id, input.userId);
  return { success: true };
}

export async function saveExpressionAnalysisEdit(input: {
  workspaceId?: number | null; projectId: number; groupId: number; analysisId: number; analysis: unknown;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("save expression analysis");
  const current = await getLatestExpressionAnalysis(db, workspaceId, input.projectId, input.groupId);
  if (!current || current.id !== input.analysisId) throw new Error("表达分析版本不存在");
  if (["confirmed", "superseded"].includes(current.status)) throw new Error("已确认表达分析不可修改");
  const parsed = ExpressionGroupAnalysisSchema.parse(input.analysis);
  const allowedAssetIds = Array.isArray(current.evidenceAssetIds) ? current.evidenceAssetIds.map(Number) : [];
  assertExpressionEvidence({ analysis: parsed, selectedAssetIds: allowedAssetIds });
  await updateExpressionAnalysis({ db, workspaceId, projectId: input.projectId, groupId: input.groupId, analysisId: input.analysisId, values: {
    userEdit: parsed,
    status: "review_required",
  } });
  return { success: true };
}

export async function confirmExpressionAnalysisVersion(input: {
  workspaceId?: number | null; projectId: number; groupId: number; analysisId: number; userId: number;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("confirm expression analysis");
  const session = await imageDb.getImageWorkflowSessionByProject(input.projectId);
  if (!session) throw new Error("图片工作流会话不存在");
  await db.transaction(async (tx) => {
    const current = await getLatestExpressionAnalysis(tx, workspaceId, input.projectId, input.groupId);
    if (!current || current.id !== input.analysisId) throw new Error("表达分析版本不存在");
    if (current.status === "confirmed") return;
    if (current.status !== "review_required") throw new Error("只有待审核表达分析可以确认");
    const selection = await getExpressionSelectionById(tx, workspaceId, input.projectId, current.selectionVersionId);
    if (!selection || selection.status !== "confirmed") throw new Error("请先确认当前图片选择版本");
    const analysis = ExpressionGroupAnalysisSchema.parse(current.userEdit || current.analysis);
    const allowedAssetIds = Array.isArray(current.evidenceAssetIds) ? current.evidenceAssetIds.map(Number) : [];
    assertExpressionEvidence({ analysis, selectedAssetIds: allowedAssetIds });
    await supersedeExpressionAnalyses(tx, workspaceId, input.projectId, input.groupId, current.id);
    await updateExpressionAnalysis({ db: tx, workspaceId, projectId: input.projectId, groupId: input.groupId, analysisId: current.id, values: {
      status: "confirmed", userEdit: analysis, confirmedBy: input.userId, confirmedAt: new Date(),
    } });
    await supersedeStep0Synthesis(tx, workspaceId, input.projectId);
    await supersedeStep0Artifacts(tx, workspaceId, input.projectId, "composite");
    const confirmed = await listConfirmedExpressionAnalyses(tx, workspaceId, input.projectId);
    await supersedeStep0Artifacts(tx, workspaceId, input.projectId, "expression_summary");
    const artifactVersion = await nextStep0ArtifactVersion(tx, session.id, "expression_summary");
    await createStep0Artifact(tx, {
      workspaceId,
      projectId: input.projectId,
      sessionId: session.id,
      artifactType: "expression_summary",
      version: artifactVersion,
      status: "confirmed",
      content: confirmed.map((item: any) => ({
        groupId: item.group.id,
        expressionName: item.group.expressionName,
        selectionVersionId: item.selection.id,
        selectionVersion: item.selection.version,
        analysisVersion: item.analysis.version,
        analysis: item.analysis.userEdit || item.analysis.analysis,
      })),
      evidenceRefs: confirmed.map((item: any) => ({
        groupId: item.group.id,
        assetIds: item.analysis.evidenceAssetIds,
      })),
      createdBy: input.userId,
      confirmedBy: input.userId,
      confirmedAt: new Date(),
    });
  });
  return { success: true };
}

export async function getStep0SynthesisState(input: { workspaceId?: number | null; projectId: number; sessionId: number }) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("step0 synthesis state");
  const [galleryArtifact, expressionArtifact, synthesis] = await Promise.all([
    getLatestConfirmedStep0Artifact(db, workspaceId, input.projectId, "competitor_gallery"),
    getLatestConfirmedStep0Artifact(db, workspaceId, input.projectId, "expression_summary"),
    getLatestStep0Synthesis(db, workspaceId, input.projectId, input.sessionId),
  ]);
  return { galleryArtifact, expressionArtifact, synthesis };
}

export async function saveStep0SynthesisEdit(input: {
  workspaceId?: number | null; projectId: number; sessionId: number; synthesisId: number; analysis: unknown; selectedDecisionIds: string[];
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("save step0 synthesis");
  const current = await getLatestStep0Synthesis(db, workspaceId, input.projectId, input.sessionId);
  if (!current || current.id !== input.synthesisId) throw new Error("综合结论版本不存在");
  if (["confirmed", "superseded"].includes(current.status)) throw new Error("已确认综合结论不可修改");
  const analysis = Step0SynthesisSchema.parse(input.analysis);
  const allowedAssetIds = Array.isArray(current.evidenceRefs) ? current.evidenceRefs.map(Number) : [];
  const selectedDecisionIds = assertSynthesisSelection({ analysis, selectedDecisionIds: input.selectedDecisionIds, allowedAssetIds });
  await updateStep0Synthesis({ db, workspaceId, projectId: input.projectId, sessionId: input.sessionId, synthesisId: input.synthesisId, values: {
    userEdit: analysis,
    selectedDecisionIds,
    status: "review_required",
  } });
  return { success: true };
}

export async function confirmStep0SynthesisVersion(input: {
  workspaceId?: number | null; projectId: number; sessionId: number; synthesisId: number; userId: number;
}) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("confirm step0 synthesis");
  await db.transaction(async (tx) => {
    const current = await getLatestStep0Synthesis(tx, workspaceId, input.projectId, input.sessionId);
    if (!current || current.id !== input.synthesisId) throw new Error("综合结论版本不存在");
    if (current.status === "confirmed") return;
    if (current.status !== "review_required") throw new Error("只有待审核综合结论可以确认");
    const analysis = Step0SynthesisSchema.parse(current.userEdit || current.analysis);
    const allowedAssetIds = Array.isArray(current.evidenceRefs) ? current.evidenceRefs.map(Number) : [];
    const selectedDecisionIds = assertSynthesisSelection({
      analysis,
      selectedDecisionIds: Array.isArray(current.selectedDecisionIds) ? current.selectedDecisionIds.map(String) : [],
      allowedAssetIds,
    });
    await supersedeStep0Synthesis(tx, workspaceId, input.projectId, current.id);
    await updateStep0Synthesis({ db: tx, workspaceId, projectId: input.projectId, sessionId: input.sessionId, synthesisId: current.id, values: {
      status: "confirmed", userEdit: analysis, selectedDecisionIds, confirmedBy: input.userId, confirmedAt: new Date(),
    } });
    await supersedeStep0Artifacts(tx, workspaceId, input.projectId, "composite");
    const artifactVersion = await nextStep0ArtifactVersion(tx, input.sessionId, "composite");
    const selected = new Set(selectedDecisionIds);
    const allItems = [
      ...analysis.primaryCompetitorTakeaways,
      ...analysis.expressionStrategyPriorities,
      ...analysis.differentiationOpportunities,
      ...analysis.conflicts,
      ...analysis.downstreamRecommendations,
    ];
    await createStep0Artifact(tx, {
      workspaceId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      artifactType: "composite",
      version: artifactVersion,
      status: "confirmed",
      content: {
        synthesisVersion: current.version,
        positioningSummary: analysis.positioningSummary,
        overallConclusion: analysis.overallConclusion,
        selectedDecisions: allItems.filter((item) => selected.has(item.id)),
      },
      evidenceRefs: allowedAssetIds,
      createdBy: input.userId,
      confirmedBy: input.userId,
      confirmedAt: new Date(),
    });
  });
  return { success: true };
}

export async function requireConfirmedCompositeForSelections(workspaceId: number, projectId: number) {
  const db = await requireDb("confirmed step0 composite");
  const selections = await countConfirmedSelectionsWithoutAnalysis(db, workspaceId, projectId);
  if (selections > 0) throw new Error("请先完成所有已确认图库选择的表达方式分析");
  const confirmedAnalyses = await listConfirmedExpressionAnalyses(db, workspaceId, projectId);
  if (!confirmedAnalyses.length) return;
  const composite = await getLatestConfirmedStep0Artifact(db, workspaceId, projectId, "composite");
  if (!composite) throw new Error("请先生成并确认竞品全图与表达方式综合结论");
}

export async function getConfirmedCompositeContext(workspaceId: number, projectId: number) {
  const db = await requireDb("confirmed step0 composite context");
  const composite = await getLatestConfirmedStep0Artifact(db, workspaceId, projectId, "composite");
  return composite ? JSON.stringify(composite.content) : "";
}

export async function getExpressionLinkageSessionState(input: { workspaceId?: number | null; projectId: number; sessionId: number }) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("expression linkage session state");
  const groups = await imageDb.getExpressionGroupsByProject(input.projectId);
  const groupStates = await Promise.all(groups.map(async (group: any) => ({
    groupId: group.id,
    expressionName: group.expressionName,
    selection: await getLatestExpressionSelection(db, workspaceId, input.projectId, group.id),
    analysis: await getLatestExpressionAnalysis(db, workspaceId, input.projectId, group.id),
  })));
  const synthesis = await getLatestStep0Synthesis(db, workspaceId, input.projectId, input.sessionId);
  const [expressionArtifact, compositeArtifact] = await Promise.all([
    getLatestConfirmedStep0Artifact(db, workspaceId, input.projectId, "expression_summary"),
    getLatestConfirmedStep0Artifact(db, workspaceId, input.projectId, "composite"),
  ]);
  return { groups: groupStates, synthesis, expressionArtifact, compositeArtifact };
}

export async function supersedeExpressionLinkageForStep0Reset(input: { workspaceId?: number | null; projectId: number }) {
  const workspaceId = workspaceIdOrThrow(input.workspaceId);
  const db = await requireDb("reset expression linkage");
  const groups = await imageDb.getExpressionGroupsByProject(input.projectId);
  await db.transaction(async (tx) => {
    for (const group of groups) {
      await supersedeExpressionSelections(tx, workspaceId, input.projectId, group.id);
      await supersedeExpressionAnalyses(tx, workspaceId, input.projectId, group.id);
    }
    await supersedeStep0Synthesis(tx, workspaceId, input.projectId);
    await supersedeStep0Artifacts(tx, workspaceId, input.projectId, "expression_summary");
    await supersedeStep0Artifacts(tx, workspaceId, input.projectId, "composite");
  });
}

export function synthesisInputHash(input: { galleryArtifactId: number; expressionArtifactId: number; expressionAnalysisIds: number[] }) {
  return createHash("sha256").update(JSON.stringify({
    galleryArtifactId: input.galleryArtifactId,
    expressionArtifactId: input.expressionArtifactId,
    expressionAnalysisIds: [...input.expressionAnalysisIds].sort((a, b) => a - b),
  })).digest("hex");
}

export function defaultSynthesisSelections(analysis: unknown) {
  return collectSynthesisDecisionIds(Step0SynthesisSchema.parse(analysis));
}

export async function createExpressionAnalysisDraft(input: {
  workspaceId: number; projectId: number; sessionId: number; groupId: number; selectionVersionId: number;
  analysis: unknown; evidenceAssetIds: number[]; inputHash: string; jobRunId: string; userId: number;
}) {
  const db = await requireDb("create expression analysis");
  const parsed = ExpressionGroupAnalysisSchema.parse(input.analysis);
  assertExpressionEvidence({ analysis: parsed, selectedAssetIds: input.evidenceAssetIds });
  const version = await nextExpressionAnalysisVersion(db, input.groupId);
  const id = await createExpressionAnalysisVersion(db, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    groupId: input.groupId,
    selectionVersionId: input.selectionVersionId,
    version,
    inputHash: input.inputHash,
    status: "review_required",
    analysis: parsed,
    evidenceAssetIds: input.evidenceAssetIds,
    skillVersion: "image-step0-expression-linkage-v1",
    jobRunId: input.jobRunId,
    createdBy: input.userId,
  });
  return { id, version };
}

export async function createSynthesisDraft(input: {
  workspaceId: number; projectId: number; sessionId: number; analysis: unknown; evidenceAssetIds: number[];
  inputHash: string; jobRunId: string; userId: number;
}) {
  const db = await requireDb("create step0 synthesis");
  const analysis = Step0SynthesisSchema.parse(input.analysis);
  // 这里只校验证据范围；AI输出的决策不能自动代替用户勾选。
  assertSynthesisSelection({ analysis, selectedDecisionIds: collectSynthesisDecisionIds(analysis), allowedAssetIds: input.evidenceAssetIds });
  const version = await nextStep0SynthesisVersion(db, input.sessionId);
  const id = await createStep0SynthesisVersion(db, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    version,
    inputHash: input.inputHash,
    status: "review_required",
    analysis,
    selectedDecisionIds: [],
    evidenceRefs: input.evidenceAssetIds,
    skillVersion: "image-step0-synthesis-v1",
    jobRunId: input.jobRunId,
    createdBy: input.userId,
  });
  return { id, version };
}

export type ConfirmedExpressionAnalysisRow = {
  group: { id: number; expressionName: string };
  analysis: ImageExpressionAnalysisVersion;
};
