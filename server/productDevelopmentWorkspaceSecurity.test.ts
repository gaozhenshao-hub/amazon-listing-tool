import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SECURITY_PERMISSION_MATRIX,
  SECURITY_RESOURCE_MODULES,
} from "../shared/const";
import { repoPath } from "./testPaths";

const PRODUCT_DEVELOPMENT_TABLES = [
  "dev_projects",
  "dev_uploaded_files",
  "dev_products",
  "dev_reviews",
  "dev_tag_dimensions",
  "dev_analysis_stages",
  "dev_product_tags",
  "dev_external_data",
  "dev_analysis_reports",
  "dev_project_scores",
  "dev_product_profiles",
  "dev_product_manuals",
  "dev_test_reports",
  "dev_bom_items",
  "dev_mold_costs",
  "dev_time_plans",
  "dev_suppliers",
  "dev_bom_summary",
  "dev_profit_calculations",
  "dev_global_suppliers",
  "dev_offsite_analyses",
  "dev_panorama_status",
  "dev_project_tag_categories",
  "dev_project_tag_items",
  "dev_module_locks",
  "dev_manual_assets",
] as const;

const PRODUCT_DEVELOPMENT_ROUTERS = [
  "devProject.ts",
  "devAnalysis.ts",
  "devTagging.ts",
  "devProjectTags.ts",
  "devProfile.ts",
  "devBom.ts",
  "devManual.ts",
  "devScoring.ts",
  "devLinkage.ts",
  "devGlobalSupplier.ts",
  "devPanorama.ts",
  "devModuleLock.ts",
  "offsiteAnalysis.ts",
] as const;

describe("product development workspace security", () => {
  it("defines a product-development-specific permission surface", () => {
    expect(SECURITY_RESOURCE_MODULES.product_development).toEqual({
      moduleId: "dev",
      subModuleId: "dev_projects",
    });
    expect(SECURITY_PERMISSION_MATRIX.admin?.product_development).toEqual(
      expect.arrayContaining(["read", "update", "delete", "run", "confirm"]),
    );
    expect(SECURITY_PERMISSION_MATRIX.product_dev?.product_development).toEqual(
      expect.arrayContaining(["read", "create", "update", "run", "confirm"]),
    );
    expect(SECURITY_PERMISSION_MATRIX.designer?.product_development).toEqual(["read"]);
  });

  it("adds and backfills workspace scope for every product-development table", () => {
    const migration = fs.readFileSync(
      repoPath("drizzle/0124_product_development_workspace_security.sql"),
      "utf8",
    );
    const schema = fs.readFileSync(repoPath("drizzle/schema/project.ts"), "utf8");
    for (const table of PRODUCT_DEVELOPMENT_TABLES) {
      expect(migration).toContain(`ALTER TABLE \`${table}\` ADD COLUMN \`workspaceId\` int`);
    }
    expect(migration).toContain("UPDATE `dev_projects` p");
    expect(migration).toContain("u.`defaultWorkspaceId`");
    expect(migration).toContain("product_development.workspace_backfill");
    expect(migration).toContain("unassignedProjects");
    expect(schema).toContain("idx_dev_projects_workspace_status");
    expect(schema).toContain("idx_dev_files_workspace_project");
    expect(schema).toContain("idx_dev_offsite_workspace_project");
    expect(schema).toContain("idx_dev_assets_workspace_project");
  });

  it("routes every product-development endpoint through the tenant guard", () => {
    for (const fileName of PRODUCT_DEVELOPMENT_ROUTERS) {
      const sourcePath = fileName === "devAnalysis.ts"
        ? "server/domains/product_development/router.ts"
        : `server/routers/${fileName}`;
      const source = fs.readFileSync(repoPath(sourcePath), "utf8");
      expect(source, fileName).toContain("productDevelopmentProcedure");
      expect(source, fileName).not.toContain("protectedProcedure, router } from \"../_core/trpc\"");
    }

    const procedure = fs.readFileSync(
      repoPath("server/domains/product_development/security/productDevelopmentProcedure.ts"),
      "utf8",
    );
    expect(procedure).toContain("getRawInput");
    expect(procedure).toContain("indirectProjectId");
    expect(procedure).toContain("productDevelopmentActionFromProcedure");
    expect(procedure).toContain("resource: \"product_development\"");
    expect(procedure).toContain("记录不属于当前产品开发项目");
    expect(procedure).toContain("devProductTags");
    expect(procedure).toContain("devManualAssets");
    expect(procedure).toContain("devOffsiteAnalyses");
  });

  it("removes global admin reads and records critical project and stage operations", () => {
    const projectRouter = fs.readFileSync(repoPath("server/routers/devProject.ts"), "utf8");
    const analysisService = fs.readFileSync(
      repoPath("server/domains/product_development/service.ts"),
      "utf8",
    );
    const informationSummary = fs.readFileSync(
      repoPath("server/domains/product_development/analysis/informationSummaryService.ts"),
      "utf8",
    );
    const moduleLockRouter = fs.readFileSync(repoPath("server/routers/devModuleLock.ts"), "utf8");
    const panoramaRouter = fs.readFileSync(repoPath("server/routers/devPanorama.ts"), "utf8");
    const scoringRouter = fs.readFileSync(repoPath("server/routers/devScoring.ts"), "utf8");

    expect(projectRouter).not.toContain("getAllDevProjects()");
    expect(projectRouter).not.toContain("getDevProjectByIdAdmin");
    expect(projectRouter).toContain("getDevProjectsForWorkspace");
    expect(projectRouter).toContain("product_development.project.delete");
    expect(projectRouter).toContain("product_development.data.confirm");
    expect(analysisService).toContain("product_development.stage.${operation}");
    expect(moduleLockRouter).toContain("product_development.module.batch_toggle");
    expect(panoramaRouter).toContain("product_development.panorama.unlock");
    expect(scoringRouter).toContain("product_development.project.revoke_approval");
    expect(informationSummary).toContain("getDevProjectByWorkspace");
    expect(informationSummary).not.toContain("getDevProjectByIdAdmin");
  });
});
