import { describe, expect, it } from "vitest";
import { createListingConfiguredTestFixture } from "./listingConfigured.testFixture";
import { captureListingConfiguredSource, listingConfiguredCompleteRows } from "./listingConfiguredSource";
import { listingConfiguredHash as hash } from "../../../../shared/listingConfiguredWorkflow";
import { projects } from "../../../../drizzle/schema/project";
describe("complete configured Listing source and private identity capture", () => {
  it("captures full raw/fact/core/source rows without truncating long original fields", async () => {
    const f = createListingConfiguredTestFixture("singleBullet"); f.state.sourceTables.projects[0].description = "原件".repeat(10000);
    const source = await f.capture(); expect(source.tables.projects[0].description).toBe("原件".repeat(10000)); expect(source.rawText).toContain("smooth woven fabric"); expect(source.cores[0].id).toBe(12);
    const { sourceHash, draftHash, ...body } = source; expect(sourceHash).toBe(hash(body)); expect(draftHash).toBe(hash(source.tables.listings));
  });
  it.each(["latest_failed", "raw_hash", "confirmed_fact_removed", "foreign_core", "newer_core", "draft_core"])("refuses %s instead of falling back to older facts", async kind => {
    const f = createListingConfiguredTestFixture("singleBullet");
    if (kind === "latest_failed") f.state.sourceTables.projectFiles.push({ ...f.state.sourceTables.projectFiles[0], id: 20, status: "failed", createdAt: "2026-10-20T00:00:00.000000Z" });
    if (kind === "raw_hash") f.state.sourceTables.projectFiles[0].rawContent = "changed raw";
    if (kind === "confirmed_fact_removed") f.state.sourceTables.listing_fact_revisions[0].status = "rejected";
    if (kind === "foreign_core") f.state.sourceTables.listing_core_revisions[0].workspaceId = 8;
    if (kind === "draft_core") f.state.sourceTables.listing_core_revisions[0].status = "draft";
    if (kind === "newer_core") f.state.sourceTables.listing_core_revisions.push({ ...f.state.sourceTables.listing_core_revisions[0], id: 15, revision: 2 });
    await expect(f.capture()).rejects.toBeDefined(); expect(f.providerInputs).toHaveLength(0);
  });
  it("requires the exact selected competitors and never silently substitutes all", async () => {
    const f = createListingConfiguredTestFixture(); await expect(captureListingConfiguredSource(f.tx, f.identity, { ...f.request, analysisIds: [99] })).rejects.toMatchObject({ code: "RESEARCH_SELECTION_CHANGED" });
  });
  it("binds legacy hidden fields and all draft fields in the source hash", async () => {
    const f = createListingConfiguredTestFixture(), source = await f.capture(); f.state.sourceTables.listings[0].imageAdvice = "HUMAN UNRELATED FIELD";
    const changed = await f.capture(); expect(changed.sourceHash).not.toBe(source.sourceHash); expect(changed.draftHash).not.toBe(source.draftHash);
  });
  it("refuses whole-source overflow and duplicate rows; not paginated or sliced", async () => {
    const f = createListingConfiguredTestFixture(); f.state.sourceTables.projects[0].description = "x".repeat(8388609); await expect(f.capture()).rejects.toMatchObject({ code: "SOURCE_LIMIT" });
    await expect(listingConfiguredCompleteRows({ execute: async () => [[{ id: 1, __bytes: 1 }, { id: 1, __bytes: 1 }]] }, projects, "id=?", [1])).rejects.toBeDefined();
  });
});
