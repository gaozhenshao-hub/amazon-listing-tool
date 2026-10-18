import { z } from "zod";
import { createHash } from "node:crypto";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { projects, projectFiles, competitorAnalyses, competitorComparisonReports } from "../../../../drizzle/schema/project";
import { listings, keywords, buyerQuestions } from "../../../../drizzle/schema/listing";
import { listingFactRevisions, listingCoreRevisions, listingBulletCandidates } from "../../../../drizzle/schema/listingRevisions";
import { ListingAuxiliaryIdentitySchema, ListingAuxiliaryPreviewInputSchema, listingAuxiliaryPreviewRequest, listingAuxiliaryDraftHash, listingAuxiliaryHash as hash, listingAuxiliaryCanonical as canonical, type ListingAuxiliaryIdentity, type ListingAuxiliaryPreviewInput } from "../../../../shared/listingAuxiliaryWorkflow";
import { captureListingConfiguredSource, listingConfiguredCompleteRows, listingConfiguredFail, listingConfiguredRows, listingConfiguredJson, ListingConfiguredSourceSchema, listingConfiguredCorePoint } from "./listingConfiguredSource";
import { hydrateActiveCompetitorResearchForLockedRow, readActiveCompetitorResearch } from "./competitorActiveResearch";
import { assertActiveCompetitorResearchScope } from "../../../services/competitorActiveResearch";
import { buildSellingPointPlanningResearch } from "./sellingPointPlanning";
import { containsTemplateFactInFreeText, isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";
import { readCompleteAttributeText } from "./listingRawAttributeSource";
export { listingConfiguredRows as listingAuxiliaryRows, listingConfiguredJson as listingAuxiliaryJson, listingConfiguredWrite as listingAuxiliaryWrite, assertListingConfiguredSchema as assertListingAuxiliarySchema, ListingConfiguredError as ListingAuxiliaryError, listingConfiguredFail as listingAuxiliaryFail } from "./listingConfiguredSource";
export type { ListingConfiguredExecutor as ListingAuxiliaryExecutor } from "./listingConfiguredSource";
import type { ListingConfiguredExecutor } from "./listingConfiguredSource";
function fail(code: string): never { return listingConfiguredFail(code); }
const object = z.record(z.string(), z.unknown());
export const ListingAuxiliarySourceSchema = z.object({ version: z.literal(1), identity: ListingAuxiliaryIdentitySchema, request: ListingAuxiliaryPreviewInputSchema,
  tables: z.record(z.string(), z.array(object)), attributeText: z.string().nullable(), confirmedFacts: z.array(object), optimizationSource: ListingConfiguredSourceSchema.nullable(), research: object,
  limitations: z.array(z.string()).max(100), sourceHash: z.string().regex(/^[a-f0-9]{64}$/u), draftHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().superRefine((value, ctx) => {
  const { sourceHash, draftHash, ...body } = value;
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId || sourceHash !== hash(body) || draftHash !== listingAuxiliaryDraftHash(value.request)
    || Buffer.byteLength(canonical(body)) > 12 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "SOURCE_BINDING_INVALID" });
});
export type ListingAuxiliarySource = z.infer<typeof ListingAuxiliarySourceSchema>;
export async function captureListingAuxiliarySource(tx: ListingConfiguredExecutor, identity: ListingAuxiliaryIdentity, raw: ListingAuxiliaryPreviewInput, rawReader = readCompleteAttributeText): Promise<ListingAuxiliarySource> {
  const request = listingAuxiliaryPreviewRequest(raw), tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of [projects, projectFiles, competitorAnalyses, competitorComparisonReports, listings, keywords, buyerQuestions, listingFactRevisions, listingCoreRevisions, listingBulletCandidates]) {
    tables[getTableConfig(table).name] = await listingConfiguredCompleteRows(tx, table, table === projects ? "id=?" : table === buyerQuestions ? "project_id=?" : "projectId=?", [request.projectId]);
  }
  const parent = tables.projects[0]; if (tables.projects.length !== 1 || parent.workspaceId !== identity.workspaceId || parent.id !== request.projectId) fail("ACCESS_DENIED");
  if (Object.values(tables).some(values => values.some(row => Object.hasOwn(row,"workspaceId") && row.workspaceId !== null && row.workspaceId !== identity.workspaceId))) fail("ACCESS_DENIED");
  let optimizationSource: z.infer<typeof ListingConfiguredSourceSchema> | null = null;
  if (request.operation === "optimizeBullet") {
    const payload = request.payload;
    optimizationSource = await captureListingConfiguredSource(tx, identity, { expectedWorkspaceId: request.expectedWorkspaceId, projectId: request.projectId, operationId: request.operationId, analysisIds: request.analysisIds,
      operation: "singleBullet", coreRevisionIds: [payload.coreRevisionId], emphasis: payload.optimizationNote });
  }
  // Optimize uses the existing strict fact/core source. Other auxiliaries may
  // inspect incomplete or unsaved text without asserting that it is a fact.
  const file = tables.projectFiles.filter(row => row.fileType === "product_attributes").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || Number(b.id) - Number(a.id))[0];
  let attributeText = optimizationSource?.rawText ?? null;
  if (!optimizationSource && file && file.status === "completed" && file.lifecycleState !== "deleted") {
    if (file.workspaceId !== identity.workspaceId || typeof file.rawContentHash !== "string") fail("FACT_SOURCE_UNAVAILABLE");
    if (typeof file.rawContent === "string" && file.rawContent.length > 0 && file.rawContent.length < 4000) attributeText = file.rawContent;
    else if (file.rawStorageUri) attributeText = await rawReader(file, identity.workspaceId);
    else {
      const raw = await listingConfiguredRows(tx, "SELECT workspaceId,projectId,userId,contentHash,IF(OCTET_LENGTH(contentJson)<=8388608,contentJson,NULL) AS contentJson FROM ai_artifacts WHERE workspaceId=? AND projectId=? AND userId=? AND artifactKey='project_file.product_attributes.raw' AND sourceTable='projectFiles' AND sourceRowId=? AND sourceId=? AND domain='listing' AND runId IS NULL AND nodeId IS NULL AND status='final' AND isCurrent=1 LIMIT 2 FOR SHARE", [identity.workspaceId, request.projectId, file.userId, String(file.id), String(file.id)], 2);
      if (raw.length !== 1 || raw[0].contentHash !== file.rawContentHash) fail("FACT_SOURCE_UNAVAILABLE");
      const content = listingConfiguredJson(raw[0].contentJson); if (typeof content !== "string") fail("FACT_SOURCE_UNAVAILABLE"); attributeText = content;
    }
    attributeText = attributeText.replace(/\r\n?/gu,"\n").trim();
    if (Buffer.byteLength(attributeText) > 2097152 || createHash("sha256").update(JSON.stringify(attributeText)).digest("hex") !== file.rawContentHash) fail("FACT_SOURCE_CHANGED");
  }
  const confirmedFacts = optimizationSource?.confirmedFacts ?? tables.listing_fact_revisions.filter(row => attributeText !== null && file
    && row.workspaceId === identity.workspaceId && row.status === "confirmed" && row.confirmedBy && row.confirmedAt && row.sourceFileId === file.id && row.rawHash === file.rawContentHash && !isTemplateOrEmptyFact(row.value));
  const limitations = confirmedFacts.length ? [] : ["confirmed_product_facts_missing_objects_are_not_product_claims"];
  if (request.operation === "optimizeBullet") {
    const payload = request.payload, core = optimizationSource!.cores[0];
    if (core.inputHash !== payload.coreInputHash) fail("CONFIRMED_CORE_CHANGED");
    if ([payload.optimizationNote, payload.currentBullet.subtitle, payload.currentBullet.fullText].some(containsTemplateFactInFreeText)) fail("TEMPLATE_FACT_REJECTED");
    if (payload.sourceCandidateId !== null) {
      const candidate = tables.listing_bullet_candidates.find(row => row.id === payload.sourceCandidateId);
      if (!candidate || candidate.workspaceId !== identity.workspaceId || candidate.coreRevisionId !== core.id || candidate.inputHash !== core.inputHash || candidate.staleAt != null
        || !["review_required", "confirmed", "draft"].includes(String(candidate.status))) fail("CANDIDATE_SOURCE_CHANGED");
    }
  }
  if (request.operation === "checkBullet") for (const item of request.payload.items) {
    if (item.coreRevisionId !== null && !tables.listing_core_revisions.some(row => row.id === item.coreRevisionId && row.workspaceId === identity.workspaceId)) fail("TARGET_SCOPE_INVALID");
    if (item.candidateId !== null && !tables.listing_bullet_candidates.some(row => row.id === item.candidateId && row.workspaceId === identity.workspaceId && (item.coreRevisionId === null || row.coreRevisionId === item.coreRevisionId))) fail("TARGET_SCOPE_INVALID");
  }
  const selected = [];
  for (const id of request.analysisIds) {
    const row = tables.competitorAnalyses.find(item => item.id === id); if (!row) fail("RESEARCH_SELECTION_CHANGED");
    const typed = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, /At$/u.test(key) && typeof value === "string" ? new Date(value) : value])) as unknown as typeof competitorAnalyses.$inferSelect;
    await hydrateActiveCompetitorResearchForLockedRow(typed, tx, parent as { id: number; userId: number; workspaceId: number });
    const active = readActiveCompetitorResearch(typed); if (active.status === "unavailable") fail("RESEARCH_UNAVAILABLE");
    if (active.status === "adopted_deep") assertActiveCompetitorResearchScope(typed, active, { ...identity, projectId: request.projectId });
    else { let value; try { value = typed.rawData ? JSON.parse(typed.rawData) : {}; } catch { fail("RESEARCH_UNAVAILABLE"); }
      if (!value || typeof value !== "object" || Array.isArray(value) || ["analysisStale", "captureOnly"].some(key => Object.hasOwn(value, key) && value[key] !== false)) fail("RESEARCH_UNAVAILABLE"); }
    selected.push(typed);
  }
  const research = buildSellingPointPlanningResearch({ projectId: request.projectId, competitors: selected, reviewAggregation: null, confirmedComparison: null, keywords: tables.keywords, buyerQuestions: tables.buyer_questions,
    researchSelection: { version: 1, projectId: request.projectId, workspaceId: identity.workspaceId, mode: "explicit", analysisIds: [...request.analysisIds].sort((a, b) => a - b), sourceHash: hash(tables.competitorAnalyses) } });
  const body = { version: 1 as const, identity, request, tables, attributeText, confirmedFacts, optimizationSource, research, limitations };
  const source = ListingAuxiliarySourceSchema.parse({ ...body, sourceHash: hash(body), draftHash: listingAuxiliaryDraftHash(request) });
  if (request.operation === "optimizeBullet") listingAuxiliaryOptimizationLineage(source);
  return source;
}
export function listingAuxiliaryOptimizationLineage(source: ListingAuxiliarySource) {
  if (source.request.operation !== "optimizeBullet") fail("OPERATION_INVALID");
  const payload = source.request.payload, candidates = source.tables.listing_bullet_candidates;
  const parent = payload.sourceCandidateId === null ? null : candidates.find(row => row.id === payload.sourceCandidateId);
  const lineage = (row: Record<string, unknown>) => {
    const gate = row.gateResultJson as { provenance?: { auxiliaryOptimization?: unknown } } | null;
    return z.object({ rootHash: z.string().regex(/^[a-f0-9]{64}$/u), depth: z.number().int().min(1).max(3) }).strict().nullish().parse(gate?.provenance?.auxiliaryOptimization);
  };
  const prior = parent ? lineage(parent) : null;
  if (!parent && candidates.some(row => row.coreRevisionId === payload.coreRevisionId && row.subtitle === payload.currentBullet.subtitle && row.fullText === payload.currentBullet.fullText && lineage(row))) fail("SOURCE_CANDIDATE_REQUIRED");
  const rootHash = prior?.rootHash ?? hash({ coreRevisionId: payload.coreRevisionId, coreInputHash: payload.coreInputHash, initialDraft: payload.currentBullet, sourceCandidateId: payload.sourceCandidateId });
  const depth = (prior?.depth ?? 0) + 1;
  if (depth > 3 || candidates.filter(row => lineage(row)?.rootHash === rootHash).length >= 3) fail("OPTIMIZATION_LIMIT");
  return { rootHash, depth };
}
export function listingAuxiliaryBusinessContext(source: ListingAuxiliarySource, targetIndex: number) {
  const target = source.request.operation === "checkBullet" ? source.request.payload.items[targetIndex] : source.request.payload;
  if (!target) fail("TARGET_INVALID");
  return { target, confirmedProductFacts: source.confirmedFacts, research: source.research, limitations: source.limitations,
    confirmedCore: source.optimizationSource ? listingConfiguredCorePoint(source.optimizationSource, source.optimizationSource.cores[0]) : null,
    constraints: { submittedDraftIsNotProductEvidence: true, suggestionsNeverConfirmFacts: true, competitorEvidenceIsNotOurFacts: true, completeSubmittedContext: true, explicitMissingEvidence: true } };
}
