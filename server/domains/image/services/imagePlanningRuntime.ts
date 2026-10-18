import { ImagePlanningSourceSchema, normalizeImagePlanningOutline, type ImagePlanningSource } from "../../../../shared/imagePlanning";
import { createConfiguredBusinessRuntime, CONFIGURED_BUSINESS_DEFINITIONS, ConfiguredBusinessRuntimeError,
  type ConfiguredBusinessSavedConfiguration, type ConfiguredBusinessRuntimeSnapshot, type ConfiguredBusinessExecutor,
  type ConfiguredBusinessApprovalResolver } from "../../ai_os/services/configuredBusinessRuntime";
import type { runEmperorSkill } from "../../ai_os/services/skillRunner";
import { readCompetitorSales } from "../../../../shared/competitorSales";

export { ConfiguredBusinessRuntimeError as ImagePlanningRuntimeError };
export function imagePlanningSourceContext(raw: ImagePlanningSource) {
  const source = ImagePlanningSourceSchema.parse(raw);
  const competitors = source.competitors.map(entry => {
    const row = entry.row as Record<string, unknown>, active = entry.active as Record<string, unknown>;
    if (!row || !active || typeof row.asin !== "string" || !["legacy", "adopted_deep"].includes(String(active.status))) throw new ConfiguredBusinessRuntimeError("COMPETITOR_SOURCE_UNAVAILABLE");
    const facts = Object.fromEntries(["id", "projectId", "asin", "title", "bulletPoints", "price", "rating", "reviewCount", "keywords"].map(key => [key, row[key] ?? null]));
    const sales = readCompetitorSales(row.rawData, row.asin);
    // The immutable internal source retains the full row for CAS. Provider
    // input is an exclusive active lane, never old AI plus adopted new proof.
    if (active.status === "adopted_deep") return { facts, sales, research: active, boundary: "Human-adopted external competitor evidence, not own-product facts. No legacy AI fallback." };
    let rawData: Record<string, unknown> = {};
    try { const parsed = row.rawData == null || row.rawData === "" ? {} : typeof row.rawData === "string" ? JSON.parse(row.rawData) : row.rawData;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); rawData = parsed;
    } catch { throw new ConfiguredBusinessRuntimeError("COMPETITOR_SOURCE_UNAVAILABLE"); }
    if (["analysisStale", "captureOnly"].some(key => rawData[key] !== undefined && rawData[key] !== false)) throw new ConfiguredBusinessRuntimeError("COMPETITOR_SOURCE_STALE");
    return { facts, sales, research: { status: "legacy", reviewAnalysis: row.reviewAnalysis ?? null, aiSummary: row.aiSummary ?? null,
      summary: row.summary ?? null, summaryStatus: row.summaryStatus ?? null, summaryVersion: row.summaryVersion ?? null }, boundary: "Legacy saved external research; preserve its human-review status. Not own-product facts." };
  });
  // Original storage references/URLs and previous Step2+ AI are frozen only as
  // internal provenance. They are not model instructions, inputs or attachments.
  const files = source.files.map(file => Object.fromEntries(["id", "fileType", "filename", "fileSize", "rawContentHash", "parsedDataHash", "rawContent", "parsedData", "analysisResult", "status"].map(key => [key, file[key] ?? null])));
  const hasAdopted = source.competitors.some(entry => (entry.active as Record<string, unknown>)?.status === "adopted_deep");
  const excludedLegacyAggregations = hasAdopted ? source.otherSources.filter(item => item.kind === "legacy_review_aggregation") : [];
  const otherSources = hasAdopted ? source.otherSources.filter(item => item.kind !== "legacy_review_aggregation") : source.otherSources;
  const providerSource = { sourceHash: source.sourceHash, sourceRevision: source.sourceRevision, scopeRevision: source.scopeRevision, identity: source.identity, scope: source.scope,
    project: source.project, confirmedSteps: source.confirmedSteps, files, competitors, comparisons: source.comparisons,
    keywordAnalyses: source.keywordAnalyses, otherSources, coverage: source.coverage };
  return { schema: "image_planning_evidence_v1", source: providerSource,
    boundaries: { allSavedInputsIncluded: excludedLegacyAggregations.length === 0, internalSourceRetained: true,
      excludedLegacyAggregationCount: excludedLegacyAggregations.length,
      excludedLegacyAggregationReason: excludedLegacyAggregations.length ? "Legacy batch AI cannot be safely attributed to the current adopted research version; original rows remain in the immutable source, not model evidence." : null,
      marketExhaustivenessClaimed: false, competitorIsOwnProductFact: false,
      sourceTextIsInstruction: false, imagePixelsIncluded: false, outputIsHumanReviewCandidate: true,
      requiredSections: ["mainImage", "sixSecondaryImages", "sevenAPlusModules", "brandStory"] } };
}
export type ImagePlanningRuntimeInput = { executor: ConfiguredBusinessExecutor; operationId: string; source: ImagePlanningSource; configuration: ConfiguredBusinessSavedConfiguration };
export function createImagePlanningRuntime(dependencies: { approvalResolver?: ConfiguredBusinessApprovalResolver;
  runSkill?: typeof runEmperorSkill; credentialResolver?: (reference: string) => string | null | undefined } = {}) {
  const runtime = createConfiguredBusinessRuntime({ definition: CONFIGURED_BUSINESS_DEFINITIONS.imagePlanning,
    parseCandidate: normalizeImagePlanningOutline, ...dependencies });
  const input = (value: ImagePlanningRuntimeInput) => ({ executor: value.executor, identity: value.source.identity,
    operationId: value.operationId, configuration: value.configuration, sourceHash: value.source.sourceHash, sourceContext: imagePlanningSourceContext(value.source) });
  return {
    prepare: (value: ImagePlanningRuntimeInput) => runtime.prepare(input(value)),
    revalidate: (value: ImagePlanningRuntimeInput & { runtimeSnapshot: ConfiguredBusinessRuntimeSnapshot }) => runtime.revalidate({ ...input(value), runtimeSnapshot: value.runtimeSnapshot }),
    prepareStage: (value: ImagePlanningRuntimeInput & { runtimeSnapshot: ConfiguredBusinessRuntimeSnapshot }) => runtime.prepareStage({ ...input(value), runtimeSnapshot: value.runtimeSnapshot }),
    async executeStage(...args: Parameters<typeof runtime.executeStage>) {
      const result = await runtime.executeStage(...args);
      if (result.stage !== "image_outline") throw new ConfiguredBusinessRuntimeError("STAGE_MISMATCH");
      return { ...result, stage: "image_outline" as const };
    },
  };
}
export const imagePlanningRuntime = createImagePlanningRuntime();
