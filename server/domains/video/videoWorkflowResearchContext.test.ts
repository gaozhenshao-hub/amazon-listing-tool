import { describe, expect, it, vi } from "vitest";
import { createVideoWorkflowTestFixture } from "./videoWorkflow.testFixture";
import { captureVideoWorkflowSource } from "./videoWorkflowSource";
import { videoWorkflowProductResearchContext } from "./videoWorkflowResearchContext";
import { issueActiveCompetitorResearch } from "../../services/competitorActiveResearch";
import { competitorRevision } from "../../repositories/project/competitorWritePolicy";
import type { ActiveCompetitorResearch } from "../../services/competitorActiveResearch";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";

const row = () => ({ id: 41, projectId: 8, asin: "B000TEST01", title: "Observed external title", bulletPoints: "Observed external bullets",
  price: null, rating: null, reviewCount: null, reviewAnalysis: "FORBIDDEN_OLD_REVIEW", keywords: null, imageUrls: null, aiSummary: "FORBIDDEN_OLD_AI",
  summary: "Reviewed legacy summary", summaryStatus: "confirmed", summaryVersion: 1, summaryConfirmedBy: 3,
  summaryConfirmedAt: "2026-01-01T00:00:00.000000Z", createdAt: "2026-01-01T00:00:00.000000Z", updatedAt: "2026-01-01T00:00:00.000000Z",
  rawData: JSON.stringify({ unknown: "FORBIDDEN_RAW", analysisStale: false }) });
describe("video product context never confuses a complete private archive with current provider evidence", () => {
  it.each([true, "false", null])("excludes legacy research with invalid/stale flag %s while keeping archived bytes", async flag => {
    const f = createVideoWorkflowTestFixture("product_info");
    f.state.sourceTables.competitorAnalyses = [{ ...row(), rawData: JSON.stringify({ analysisStale: flag, old: "FORBIDDEN_RAW" }) }];
    f.state.sourceTables.reviewAggregations = [{ id: 2, projectId: 8, content: "FORBIDDEN_MIXED_AGGREGATE" }];
    f.state.sourceTables.listings = [{ id: 3, projectId: 8, title: "FORBIDDEN_OLD_LISTING" }];
    const source = await captureVideoWorkflowSource(f.tx, f.identity, { ...f.scope, operation: "product_info", competitorScriptId: null, operationId: "11111111-1111-4111-8111-111111111111" });
    expect(JSON.stringify(source.tables)).toContain("FORBIDDEN_OLD_AI");
    const wire = JSON.stringify(source.context);
    expect(wire).not.toContain("FORBIDDEN_"); expect(wire).not.toContain("Reviewed legacy summary");
    expect(wire).toContain("mixed_legacy_ai_batch_lacks_current_per_source_human_provenance");
  });
  it("permits only explicit current legacy human summary, never raw AI, aggregates or derived file analysis", async () => {
    const f = createVideoWorkflowTestFixture("product_info"), project = f.state.sourceTables.projects[0];
    const tables = { competitorAnalyses: [row()], projectFiles: [{ id: 2, fileType: "product_attributes", lifecycleState: "hot", rawContent: "USER_UPLOAD", analysisResult: "FORBIDDEN_AI" }],
      listings: [], reviewAggregations: [] };
    const hydrate = vi.fn(async () => {});
    const context = await videoWorkflowProductResearchContext(f.tx, f.identity, project, tables, hydrate);
    expect(hydrate).toHaveBeenCalledWith(expect.objectContaining({ summaryConfirmedAt: expect.any(Date) }), f.tx, { id: 8, userId: 3, workspaceId: 7 });
    expect(JSON.stringify(context)).toContain("Reviewed legacy summary"); expect(JSON.stringify(context)).toContain("USER_UPLOAD");
    expect(JSON.stringify(context)).not.toContain("FORBIDDEN_");
  });
  it("the provider uses the verified adopted result exclusively, not stale legacy fields", async () => {
    const f = createVideoWorkflowTestFixture("product_info");
    const original = { ...row(), rawData: JSON.stringify({ deepAdoptionRef: {}, analysisStale: true }) };
    const hydrate = async (target: CompetitorAnalysis) => {
      // Isolated projection test: loader/replay itself has separate real-SQL coverage.
      issueActiveCompetitorResearch(target, { status: "adopted_deep", identity: { ...f.identity, sourceWorkspaceId: 7, projectId: 8, analysisId: 41, asin: original.asin },
        currentRevision: competitorRevision(target), ref: { artifactId: "synthetic" }, summary: "ONLY_ADOPTED_SUMMARY", result: { completeVerifiedPayload: "ONLY_ADOPTED_RESULT" } } as unknown as Extract<ActiveCompetitorResearch, { status: "adopted_deep" }>);
    };
    const result = await videoWorkflowProductResearchContext(f.tx, f.identity, f.state.sourceTables.projects[0], { competitorAnalyses: [original] }, hydrate);
    expect(JSON.stringify(result)).toContain("ONLY_ADOPTED_RESULT"); expect(JSON.stringify(result)).not.toContain("FORBIDDEN_");
    expect(JSON.stringify(result)).not.toContain("Reviewed legacy summary");
  });
  it("an unverified deep ref never falls back to a confirmed legacy summary", async () => {
    const f = createVideoWorkflowTestFixture("product_info");
    const result = await videoWorkflowProductResearchContext(f.tx, f.identity, f.state.sourceTables.projects[0],
      { competitorAnalyses: [{ ...row(), rawData: JSON.stringify({ deepAdoptionRef: {} }) }] }, async () => {});
    expect(JSON.stringify(result)).not.toContain("Reviewed legacy summary");
    expect(JSON.stringify(result)).toContain("unavailable");
  });
});
