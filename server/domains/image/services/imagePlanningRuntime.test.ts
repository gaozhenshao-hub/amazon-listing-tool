import { describe, expect, it } from "vitest";
import { ImagePlanningSourceSchema, imagePlanningHash } from "../../../../shared/imagePlanning";
import { createImagePlanningTestFixture, planningOperation } from "./imagePlanning.testFixture";
import { imagePlanningSourceContext } from "./imagePlanningRuntime";

describe("actual configured Image Step2 provider context", () => {
  it("keeps complete internal CAS source but sends only the adopted active research lane, never old AI or storage references", async () => {
    const f = createImagePlanningTestFixture(), original = await f.repository.readSource(f.identity, f.scope);
    const { sourceHash: _hash, ...body } = original;
    body.session.step2AiResult = "OLD_STEP2_AI_SENTINEL";
    body.competitors = [{ row: { id: 55, projectId: 8, asin: "B000000055", title: "SYNTHETIC_COLLECTED_TITLE", aiSummary: "OLD_AI_SUMMARY_SENTINEL", reviewAnalysis: "OLD_REVIEW_SENTINEL",
      summary: "OLD_HUMAN_SUMMARY_SENTINEL", rawData: JSON.stringify({ secretOldAi: "OLD_RAW_AI_SENTINEL", analysisStale: true, purchaseBadge: "100+ bought in past month" }) },
      active: { status: "adopted_deep", summary: "VERIFIED_ACTIVE_SUMMARY", result: { completeEvidence: Array.from({ length: 120 }, (_, index) => `ACTIVE_COMPLETE_ENTRY_${index}`) } } }];
    body.files = [{ id: 1, filename: "SYNTHETIC.txt", fileType: "text", status: "completed", rawContent: "FULL_SAVED_FILE_FACT", storageRef: "PRIVATE_STORAGE_SENTINEL", fileUrl: "PRIVATE_URL_SENTINEL" }];
    body.otherSources = [{ kind: "legacy_review_aggregation", row: { id: 88, analysis: "OLD_BATCH_AGGREGATE_SENTINEL" } }];
    const source = ImagePlanningSourceSchema.parse({ ...body, sourceHash: imagePlanningHash(body) });
    const { runtimeSnapshot } = await f.runtime.prepare({ executor: f.tx, source, operationId: planningOperation, configuration: f.configuration });
    const prepared = await f.runtime.prepareStage({ executor: f.tx, source, operationId: planningOperation, configuration: f.configuration, runtimeSnapshot });
    await f.runtime.executeStage(prepared, { beforeDispatch: async (_receipt, verifyFresh) => { await verifyFresh(f.tx, f.configuration, source.sourceHash, imagePlanningSourceContext(source)); } });
    const actual = f.providerContexts[0];
    for (const value of ["OLD_AI_SUMMARY_SENTINEL", "OLD_REVIEW_SENTINEL", "OLD_RAW_AI_SENTINEL", "OLD_HUMAN_SUMMARY_SENTINEL", "OLD_STEP2_AI_SENTINEL", "PRIVATE_STORAGE_SENTINEL", "PRIVATE_URL_SENTINEL", "OLD_BATCH_AGGREGATE_SENTINEL"]) expect(actual).not.toContain(value);
    for (const value of ["SYNTHETIC_COLLECTED_TITLE", "VERIFIED_ACTIVE_SUMMARY", "ACTIVE_COMPLETE_ENTRY_119", "FULL_SAVED_FILE_FACT", "SYNTHETIC_SAVED_RULE"]) expect(actual).toContain(value);
    expect(JSON.stringify(source)).toContain("OLD_AI_SUMMARY_SENTINEL"); expect(JSON.stringify(source)).toContain("PRIVATE_STORAGE_SENTINEL");
    expect(JSON.stringify(source)).toContain("OLD_BATCH_AGGREGATE_SENTINEL");
    expect(imagePlanningSourceContext(source).boundaries).toMatchObject({ allSavedInputsIncluded: false, internalSourceRetained: true, excludedLegacyAggregationCount: 1 });
    expect(f.providerContexts).toHaveLength(1);
  });
  it.each([true, "true", null, 1])("refuses stale legacy flag %j before any provider dispatch", async flag => {
    const f = createImagePlanningTestFixture(), { sourceHash: _hash, ...body } = await f.repository.readSource(f.identity, f.scope);
    body.competitors = [{ row: { asin: "B000000055", rawData: JSON.stringify({ analysisStale: flag }), aiSummary: "OLD_AI" }, active: { status: "legacy" } }];
    const source = ImagePlanningSourceSchema.parse({ ...body, sourceHash: imagePlanningHash(body) });
    expect(() => f.runtime.prepare({ executor: f.tx, source, operationId: planningOperation, configuration: f.configuration })).toThrow("COMPETITOR_SOURCE_STALE"); expect(f.providerContexts).toHaveLength(0);
  });
});
