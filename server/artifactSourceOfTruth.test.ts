import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildUnifiedArtifactCurrentRef,
  buildUnifiedArtifactRef,
  parseUnifiedArtifactRef,
} from "./domains/ai_os/services/artifactLifecycle";
import { repoPath } from "./testPaths";

function read(path: string) {
  return fs.readFileSync(repoPath(path), "utf8");
}

describe("Artifact source of truth v2", () => {
  it("uses stable lineage refs for current and immutable refs for executions", () => {
    const scope = {
      workspaceId: 7,
      domain: "listing" as const,
      artifactKey: "listing.content",
      sourceTable: "listings",
      sourceRowId: 42,
    };
    const currentRef = buildUnifiedArtifactCurrentRef(scope);
    expect(currentRef).toMatch(/^ai-artifact-scope:\/\/.+@current$/);
    expect(parseUnifiedArtifactRef(currentRef)).toEqual({
      kind: "current",
      scope: {
        ...scope,
        sourceRowId: "42",
        runId: null,
        nodeId: null,
      },
    });

    const versionRef = buildUnifiedArtifactRef("art_listing_v3", 3);
    expect(parseUnifiedArtifactRef(versionRef)).toEqual({
      kind: "version",
      artifactId: "art_listing_v3",
      version: 3,
    });
  });

  it("migrates pointer history, consumption provenance, and current indexes", () => {
    const migration = read("drizzle/0128_artifact_source_of_truth.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `ai_artifact_selection_events`");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `ai_artifact_consumptions`");
    expect(migration).toContain("WHERE `status`='draft' AND `isCurrent`=1");
    expect(migration).toContain("target.workspaceId <=> selected.workspaceId");
    expect(migration).toContain("idx_ai_artifacts_project_key_current");
    expect(migration).toContain("idx_ai_artifacts_lineage_version");
  });

  it("keeps Artifact versions immutable and stores large payloads by reference", () => {
    const lifecycle = read("server/domains/ai_os/services/artifactLifecycle.ts");
    expect(lifecycle).toContain('withDbTransaction("Register unified Artifact"');
    expect(lifecycle).toContain("ON DUPLICATE KEY UPDATE artifactId=VALUES(artifactId)");
    expect(lifecycle).not.toContain("ON DUPLICATE KEY UPDATE status=VALUES(status),isCurrent=VALUES(isCurrent)");
    expect(lifecycle).toContain("storagePut(");
    expect(lifecycle).toContain("storagePending = true");
    expect(lifecycle).toContain("recordUnifiedArtifactConsumption");
  });

  it("routes product, Listing, image, ads, and video inputs through current Artifacts", () => {
    const sources = [
      read("server/domains/product_development/analysis/informationSummaryService.ts"),
      read("server/listingContext.ts"),
      read("server/domains/image/routerContext.ts"),
      read("server/routers/adStructure.ts"),
      read("server/routers/videoScript.ts"),
    ].join("\n");
    expect(sources.match(/resolveCurrent(?:Business|DevAnalysis|ImageWorkflowStep)Artifact/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sources.match(/recordBusinessArtifactUse/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("exposes version selection on all human review surfaces", () => {
    for (const page of [
      "client/src/pages/dev/DevAnalysisFlow.tsx",
      "client/src/pages/PreviewPage.tsx",
      "client/src/pages/ImageWorkflowPage.tsx",
      "client/src/pages/AdStructurePage.tsx",
      "client/src/pages/VideoScriptPage.tsx",
    ]) {
      expect(read(page)).toContain("BusinessArtifactVersionPicker");
    }
  });
});
