import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "./testPaths";
import {
  StaleDevAnalysisRunError,
  downstreamDevAnalysisStages,
} from "./domains/product_development/analysis/stageConsistency";

function source(path: string) {
  return fs.readFileSync(repoPath(path), "utf8");
}

describe("product-development stage consistency", () => {
  it("defines deterministic downstream invalidation", () => {
    expect(downstreamDevAnalysisStages("market_overview")).toEqual([
      "information_summary",
      "decision_dashboard",
    ]);
    expect(downstreamDevAnalysisStages("attribute_tagging")).toEqual([
      "attribute_cross",
      "information_summary",
      "decision_dashboard",
    ]);
    expect(downstreamDevAnalysisStages("information_summary")).toEqual(["decision_dashboard"]);
    expect(downstreamDevAnalysisStages("decision_dashboard")).toEqual([]);
  });

  it("uses one transaction for stage mutation, artifact registration, and invalidation", () => {
    const stageService = source("server/domains/product_development/analysis/stageConsistency.ts");
    expect(stageService).toContain('withDbTransaction("Confirm product-development analysis stage"');
    expect(stageService).toContain('withDbTransaction("Edit product-development analysis stage"');
    expect(stageService).toContain('withDbTransaction("Unlock product-development analysis stage"');
    expect(stageService).toContain("FOR UPDATE");
    expect(stageService).toContain("failOnError: true");
    expect(stageService).toContain("eq(devAnalysisStages.runId, input.runId)");
    expect(stageService).toContain("runId: null");
    expect(stageService).toContain("downstreamDevAnalysisStages(input.stageType)");
    expect(stageService).toContain("当前阶段正在分析");
  });

  it("routes every active analysis mutation through the consistency service", () => {
    const router = source("server/domains/product_development/service.ts");
    const summaryService = source(
      "server/domains/product_development/analysis/informationSummaryService.ts",
    );
    expect(router).toContain("queueProductAnalysisStage");
    expect(router).toContain("cancelProductAnalysisStage");
    expect(router).toContain("confirmDevAnalysisStageConsistently");
    expect(router).toContain("editDevAnalysisStageConsistently");
    expect(router).toContain("unlockDevAnalysisStageConsistently");
    expect(router).not.toContain("devDb.confirmDevAnalysisStage(");
    expect(router).not.toContain("devDb.unlockDevAnalysisStage(");
    expect(summaryService).toContain("completeDevAnalysisStageRunConsistently");
  });

  it("archives duplicate rows before enforcing the unique stage key", () => {
    const migration = source("drizzle/0125_dev_stage_consistency.sql");
    const archiveAt = migration.indexOf("INSERT INTO `dev_analysis_stage_conflicts`");
    const deleteAt = migration.indexOf("DELETE duplicate_stage");
    const uniqueAt = migration.indexOf("CREATE UNIQUE INDEX `uniq_dev_stages_project_type`");
    expect(archiveAt).toBeGreaterThan(0);
    expect(deleteAt).toBeGreaterThan(archiveAt);
    expect(uniqueAt).toBeGreaterThan(deleteAt);
    expect(migration).toContain("ROW_NUMBER() OVER");
    expect(migration).toContain("`duplicateSnapshot` json NOT NULL");
  });

  it("uses atomic upsert and conditional run ownership", () => {
    const database = source(
      "server/domains/product_development/repositories/legacyDevRepository.ts",
    );
    expect(database).toContain(".onDuplicateKeyUpdate({");
    expect(database).toContain("claimDevAnalysisStageRun");
    expect(database).toContain("IF(${claimable}");
    expect(database).toContain("stage.runId === runId");
    expect(database).toContain("rawResult: sql`${devAnalysisStages.rawResult}`");
  });

  it("exposes a stable stale-run error code", () => {
    expect(new StaleDevAnalysisRunError()).toMatchObject({
      code: "DEV_STAGE_STALE_RUN",
    });
  });
});
