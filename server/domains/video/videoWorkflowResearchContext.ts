import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import type { DbExecutor } from "../../repositories/dbClient";
import { hydrateVideoWorkflowResearch } from "../../services/videoWorkflowResearch";
import { assertActiveCompetitorResearchScope, readActiveCompetitorResearch } from "../../services/competitorActiveResearch";
import type { VideoWorkflowIdentity } from "../../../shared/videoWorkflow";

type Row = Record<string, unknown>;
/** Full persisted rows remain in the private source snapshot. Provider inputs
 * deliberately do not inherit arbitrary raw/old AI fields from those rows. */
export async function videoWorkflowProductResearchContext(tx: DbExecutor, identity: VideoWorkflowIdentity, project: Row,
  tables: Record<string, Row[]>, hydrate = hydrateVideoWorkflowResearch) {
  const omitted: Array<{ table: string; id: unknown; reason: string }> = [];
  const competitors: Row[] = [];
  for (const original of tables.competitorAnalyses ?? []) {
    const row = { ...original } as unknown as CompetitorAnalysis;
    // The bounded SQL projection preserves microsecond strings in the private
    // archive; this existing proof loader expects native Drizzle Date fields.
    for (const key of ["createdAt", "updatedAt", "summaryConfirmedAt"] as const) {
      if (original[key] !== null) row[key] = new Date(String(original[key]));
    }
    await hydrate(row, tx, { id: Number(project.id), userId: Number(project.userId), workspaceId: identity.workspaceId });
    const active = readActiveCompetitorResearch(row);
    assertActiveCompetitorResearchScope(row, active, { ...identity, projectId: Number(project.id) });
    const observed = { id: row.id, asin: row.asin, title: row.title, bulletPoints: row.bulletPoints, price: row.price, rating: row.rating, reviewCount: row.reviewCount };
    if (active.status === "adopted_deep") {
      competitors.push({ ...observed, meaning: "external_competitor_not_our_product_facts", research: { status: active.status,
        identity: active.identity, ref: active.ref, summary: active.summary, result: active.result } });
      continue;
    }
    let raw: Row | null = null;
    try { const value: unknown = row.rawData ? JSON.parse(row.rawData) : {}; if (value && typeof value === "object" && !Array.isArray(value)) raw = value as Row; } catch { /* explicitly omitted below */ }
    const flagsValid = raw && ["analysisStale", "captureOnly", "deepAnalysisStale"].every(key => !(key in raw!) || raw![key] === false);
    const confirmed = active.status === "legacy" && flagsValid && row.summaryStatus === "confirmed"
      && typeof row.summary === "string" && row.summary.trim() && Number.isSafeInteger(row.summaryVersion) && row.summaryVersion > 0
      && Number.isSafeInteger(row.summaryConfirmedBy) && Number(row.summaryConfirmedBy) > 0
      && row.summaryConfirmedAt instanceof Date && Number.isFinite(row.summaryConfirmedAt.getTime());
    competitors.push({ ...observed, meaning: "external_competitor_not_our_product_facts",
      research: confirmed ? { status: "legacy_human_reviewed_summary", summary: row.summary, summaryVersion: row.summaryVersion }
        : { status: "unavailable", reason: "historical_or_unverified_research_excluded" } });
    omitted.push({ table: "competitorAnalyses", id: row.id, reason: confirmed ? "unprovenanced_legacy_ai_fields_excluded" : "historical_or_unverified_research_excluded" });
  }
  const files = (tables.projectFiles ?? []).map(row => {
    omitted.push({ table: "projectFiles", id: row.id, reason: "legacy_ai_analysis_and_unverified_parsed_derivatives_excluded" });
    return { id: row.id, fileType: row.fileType, rawContent: row.lifecycleState !== "deleted" ? row.rawContent : null,
      rawContentHash: row.rawContentHash, meaning: row.fileType === "product_attributes" ? "user_supplied_product_attributes_not_independently_verified" : "external_research_not_our_product_facts" };
  });
  for (const table of ["listings", "reviewAggregations"]) for (const row of tables[table] ?? []) {
    omitted.push({ table, id: row.id, reason: "mixed_legacy_ai_batch_lacks_current_per_source_human_provenance" });
  }
  const providerTables: Record<string, Row[]> = { ...tables, projectFiles: files, competitorAnalyses: competitors, listings: [], reviewAggregations: [] };
  for (const [name, entries] of Object.entries(tables)) {
    if (!name.startsWith("video_") || name === "video_scripts") continue;
    for (const row of entries) omitted.push({ table: name, id: row.id, reason: "previous_video_derivative_not_product_fact_input" });
    providerTables[name] = [];
  }
  return { tables: providerTables,
    coverage: { completePrivateArchive: true, completeProviderEvidence: false, omitted,
      meaning: "Full originals are privately frozen; omitted legacy AI and unsplit aggregates are not evidence supplied to the model." } };
}
