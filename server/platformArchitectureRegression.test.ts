import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { readRepoSources, repoPath } from "./testPaths";

function lines(relativePath: string) {
  return fs.readFileSync(repoPath(relativePath), "utf8").split("\n").length;
}

type MenuSnapshot = { id?: string; label?: string; path?: string; items?: MenuSnapshot[] };

// Resolve only the Listing menu's declarative AST; never import the application
// or execute arbitrary source. Icons do not affect route/branch semantics.
function listingMenuSnapshot(source: string, merged: boolean): MenuSnapshot {
  const file = ts.createSourceFile("DashboardLayout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let listing: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(property =>
      ts.isPropertyAssignment(property) && property.name.getText(file) === "id"
      && ts.isStringLiteral(property.initializer) && property.initializer.text === "listing")) listing = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!listing) throw new Error("Listing menu is missing");
  const read = (expression: ts.Expression): unknown => {
    if (ts.isStringLiteral(expression)) return expression.text;
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isIdentifier(expression) && expression.text === "MERGED_LISTING_WORKFLOW_ENABLED") return merged;
    if (ts.isParenthesizedExpression(expression)) return read(expression.expression);
    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) return !read(expression.operand);
    if (ts.isConditionalExpression(expression)) return read(read(expression.condition) ? expression.whenTrue : expression.whenFalse);
    if (ts.isArrayLiteralExpression(expression)) return expression.elements.flatMap(element => {
      if (!ts.isSpreadElement(element)) return [read(element)];
      const value = read(element.expression);
      if (!Array.isArray(value)) throw new Error("Menu spread is not an array");
      return value;
    });
    if (ts.isObjectLiteralExpression(expression)) return Object.fromEntries(expression.properties.flatMap(property => {
      if (!ts.isPropertyAssignment(property)) throw new Error("Unsupported menu property");
      const name = property.name.getText(file);
      return name === "icon" ? [] : [[name, read(property.initializer)]];
    }));
    throw new Error(`Unsupported Listing menu expression: ${expression.getText(file)}`);
  };
  return read(listing) as MenuSnapshot;
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

  it.each([false, true])("preserves unique complete Listing routes and preparation navigation with merged=%s", merged => {
    const layout = fs.readFileSync(repoPath("client/src/components/DashboardLayout.tsx"), "utf8");
    expect(layout).toContain("aria-expanded={expanded}");
    const listing = listingMenuSnapshot(layout, merged), items = listing.items!;
    const preparation = items.filter(item => item.id === "listing-preparation");
    expect(preparation).toHaveLength(1);
    expect(preparation[0].label).toBe(merged ? "项目与补充资料" : "前置准备层");
    const flatten = (nodes: MenuSnapshot[]): MenuSnapshot[] => nodes.flatMap(node => [node, ...flatten(node.items || [])]);
    const paths = flatten(items).flatMap(item => item.path ? [item.path] : []);
    expect(paths.slice().sort()).toEqual([
      "/listing", "/listing/analysis", "/listing/comparison", "/listing/generate", "/listing/canvas",
      "/listing/review-history", "/listing/data-files", "/listing/keywords", "/listing/review-aggregation", "/listing/buyer-questions",
      "/listing/ad-structure", "/listing/preview", "/listing/score", "/listing/image-workflow", "/listing/quality", "/listing/video-script",
    ].sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(preparation[0].items?.find(item => item.path === "/listing/data-files")?.label).toBe(merged ? "本品属性与补充资料" : "数据文件");
    if (merged) {
      expect(items.slice(0, 3)).toEqual([
        { label: "1. Listing 抓取", path: "/listing/analysis" },
        { label: "2. Listing 对比及分析", path: "/listing/comparison" },
        { label: "3. 智能 Listing 生成", path: "/listing/generate" },
      ]);
      expect(preparation[0].items?.some(item => item.path === "/listing/analysis" || item.path === "/listing/comparison")).toBe(false);
    } else {
      expect(preparation[0].items).toEqual(expect.arrayContaining([
        { label: "竞品分析", path: "/listing/analysis" }, { label: "竞品对比", path: "/listing/comparison" },
      ]));
      expect(items.find(item => item.path === "/listing/generate")?.label).toBe("Listing生成");
      expect(items.some(item => item.path === "/listing/analysis" || item.path === "/listing/comparison")).toBe(false);
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
