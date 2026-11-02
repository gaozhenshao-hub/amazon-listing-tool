import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { readRepoSources, repoPath } from "./testPaths";

function lines(relativePath: string) {
  return fs.readFileSync(repoPath(relativePath), "utf8").split("\n").length;
}

function tableFromQueryExpression(expression: ts.Expression, sourceFile: ts.SourceFile): string | null {
  if (ts.isCallExpression(expression)) {
    if (
      ts.isPropertyAccessExpression(expression.expression)
      && ["from", "update", "delete"].includes(expression.expression.name.text)
      && expression.arguments[0]
    ) {
      return expression.arguments[0].getText(sourceFile);
    }
    return tableFromQueryExpression(expression.expression, sourceFile);
  }
  if (ts.isPropertyAccessExpression(expression)) return tableFromQueryExpression(expression.expression, sourceFile);
  if (ts.isParenthesizedExpression(expression)) return tableFromQueryExpression(expression.expression, sourceFile);
  return null;
}

describe("platform architecture regression", () => {
  it("keeps the Emperor dashboard shell owned by the application router", () => {
    const app = fs.readFileSync(repoPath("client/src/App.tsx"), "utf8");
    expect(app.match(/<DashboardLayout>/g)).toHaveLength(1);

    const nestedLayoutPages = fs.readdirSync(repoPath("client/src/pages/emperor"))
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => fs.readFileSync(repoPath("client/src/pages/emperor", file), "utf8").includes("DashboardLayout"));

    expect(nestedLayoutPages).toEqual([]);
  });

  it("groups Listing preparation routes into one collapsible sidebar layer", () => {
    const layout = fs.readFileSync(repoPath("client/src/components/DashboardLayout.tsx"), "utf8");
    expect(layout).toContain('id: "listing-preparation"');
    expect(layout).toContain('label: "前置准备层"');
    expect(layout).toContain("aria-expanded={expanded}");

    for (const route of [
      "/listing",
      "/listing/analysis",
      "/listing/comparison",
      "/listing/review-history",
      "/listing/data-files",
      "/listing/keywords",
      "/listing/review-aggregation",
      "/listing/buyer-questions",
    ]) {
      expect(layout.match(new RegExp(`path: "${route}"`, "g")), route).toHaveLength(1);
    }
  });

  it("keeps removed compatibility roots absent and domain schemas canonical", () => {
    expect(fs.existsSync(repoPath("server/db.ts"))).toBe(false);
    expect(fs.existsSync(repoPath("drizzle/schema.ts"))).toBe(false);
    const index = fs.readFileSync(repoPath("drizzle/schema/index.ts"), "utf8");
    for (const domain of ["auth", "project", "listing", "image", "ads", "ops", "video", "knowledge", "ai_os"]) {
      expect(index).toContain(`./${domain}`);
    }
  });

  it("keeps split routers and AI OS service entries as composition facades", () => {
    expect(lines("server/routers/adAnalysis.ts")).toBeLessThan(40);
    expect(lines("server/routers/operations.ts")).toBeLessThan(40);
    expect(lines("server/domains/ai_os/services/agentRunner.ts")).toBeLessThan(120);
    expect(lines("server/domains/ai_os/services/toolGateway.ts")).toBeLessThan(120);
    expect(fs.existsSync(repoPath("server/domains/ads/adAnalysis/searchTerms.ts"))).toBe(true);
    expect(fs.existsSync(repoPath("server/domains/ops/operations/inventory.ts"))).toBe(true);
    expect(fs.existsSync(repoPath("server/domains/ai_os/services/agentRunner/execution.ts"))).toBe(true);
    expect(fs.existsSync(repoPath("server/domains/ai_os/services/toolGateway/executors.ts"))).toBe(true);
  });

  it("requires workspace context for every operations and ads table write", () => {
    const schemas = readRepoSources("drizzle/schema/ops.ts", "drizzle/schema/ads.ts");
    const workspaceColumns = schemas.match(/workspaceId: int\("workspaceId"\)/g) || [];
    const contextualDefaults = schemas.match(/\$defaultFn\(currentOpsWorkspaceId\)/g) || [];
    expect(workspaceColumns.length).toBeGreaterThan(80);
    expect(contextualDefaults.length).toBe(workspaceColumns.length);

    const governedRouters = [
      "shippingBatch", "logistics", "opsProductPlan", "afterSales", "dashboardUpgrade",
      "customDashboard", "customerProfile", "dataImport", "operatorMapping", "taskManagement", "crawler",
      "adDailyReportUpload", "adLocalAnalysis", "adReportUpload", "adTracking",
    ];
    for (const router of governedRouters) {
      expect(fs.readFileSync(repoPath(`server/routers/${router}.ts`), "utf8")).toContain("domains/ops/workspaceProcedure");
    }
  });

  it("scopes every operations and ads table query to the active workspace", () => {
    const schemaSource = readRepoSources("drizzle/schema/ops.ts", "drizzle/schema/ads.ts");
    const workspaceTables = new Set(
      [...schemaSource.matchAll(/export const (\w+)\s*=\s*mysqlTable/g)].map((match) => match[1]),
    );
    const governedRouterFiles = [
      ...fs.readdirSync(repoPath("server/domains/ops/routers"))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => repoPath("server/domains/ops/routers", file)),
      ...fs.readdirSync(repoPath("server/routers"))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => repoPath("server/routers", file))
        .filter((file) => fs.readFileSync(file, "utf8").includes("workspaceProcedure")),
    ];
    const unscopedQueries: string[] = [];

    for (const file of governedRouterFiles) {
      const source = fs.readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "where"
          && node.arguments[0]
        ) {
          const table = tableFromQueryExpression(node.expression.expression, sourceFile);
          const condition = node.arguments[0].getText(sourceFile);
          if (table && workspaceTables.has(table) && !condition.includes("workspaceId") && !condition.includes("opsWorkspaceCondition")) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            unscopedQueries.push(`${path.relative(repoPath(), file)}:${line}:${table}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(unscopedQueries).toEqual([]);
  });

  it("registers listing, image, ads, and video writes as unified artifacts", () => {
    const registry = fs.readFileSync(repoPath("server/domains/ai_os/services/businessArtifactRegistry.ts"), "utf8");
    for (const domain of ["listing", "image", "ads", "video"]) {
      expect(registry).toContain(`domain: "${domain}"`);
    }
    const sources = readRepoSources(
      "server/repositories/listing/listingRepository.ts",
      "server/repositories/image/imageRepository.ts",
      "server/routers/adDeepAnalysis.ts",
      "server/domains/ads/legacyAnalysis/service.ts",
      "server/videoScriptDb.ts",
    );
    expect(sources).toContain("registerListingArtifact");
    expect(sources).toContain("registerImageWorkflowArtifact");
    expect(sources).toContain("registerAdArtifact");
    expect(sources).toContain("registerVideoArtifact");
  });

  it("embeds Agent Run and Checkpoint controls in long workflow pages", () => {
    const pages = [
      "client/src/pages/AdStructurePage.tsx",
      "client/src/pages/VideoScriptPage.tsx",
      "client/src/pages/ops/OpsAds.tsx",
      "client/src/pages/ops/OpsAdDeep.tsx",
      "client/src/pages/dev/DevProjectDetail.tsx",
      "client/src/pages/dev/DevAnalysisFlow.tsx",
    ];
    for (const page of pages) {
      expect(fs.readFileSync(repoPath(page), "utf8"), page).toContain("EmbeddedAgentRunPanel");
    }
    const panel = fs.readFileSync(repoPath("client/src/components/workflow/EmbeddedAgentRunPanel.tsx"), "utf8");
    expect(panel).toContain("WorkflowCheckpointControls");
    expect(panel).toContain("WorkflowArtifactVersionPicker");
  });

  it("samples real normalized MySQL statement digests", () => {
    const sampler = fs.readFileSync(repoPath("server/repositories/database/slowQueryRepository.ts"), "utf8");
    expect(sampler).toContain("performance_schema.events_statements_summary_by_digest");
    expect(sampler).toContain("DIGEST_TEXT NOT LIKE");
    expect(sampler).toContain("databaseSlowQuerySamples");
  });
});
