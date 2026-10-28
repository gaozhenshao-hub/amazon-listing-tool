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
      && ts.isStringLiteral(property.initializer) && property.initializer.text === "ops")) listing = node;
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
it("keeps Listing routes unique under the operations menu",()=>{
 const layout=fs.readFileSync(repoPath("client/src/components/DashboardLayout.tsx"),"utf8");
 const listing=listingMenuSnapshot(layout,false);
 const flatten=(nodes:MenuSnapshot[]):MenuSnapshot[]=>nodes.flatMap(n=>[n,...flatten(n.items||[])]);
 const paths=flatten(listing.items||[]).flatMap(n=>n.path?[n.path]:[]);
 for(const route of ["/listing","/listing/analysis","/listing/comparison","/listing/generate","/listing/keywords","/listing/ad-structure"]) expect(paths).toContain(route);
 expect(new Set(paths).size).toBe(paths.length);
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
    expect(fs.existsSync(repoPath("server/domains/ops/operations/inventory.ts"))).toBe(false);
    expect(fs.existsSync(repoPath("server/domains/ai_os/services/agentRunner/execution.ts"))).toBe(true);
    expect(fs.existsSync(repoPath("server/domains/ai_os/services/toolGateway/executors.ts"))).toBe(true);
  });

  it("requires workspace context for every operations and ads table write", () => {
    const schemas = readRepoSources("drizzle/schema/ops.ts", "drizzle/schema/ads.ts");
    const workspaceColumns = schemas.match(/workspaceId: int\("workspaceId"\)/g) || [];
    const contextualDefaults = schemas.match(/\$defaultFn\(currentOpsWorkspaceId\)/g) || [];
    expect(workspaceColumns.length).toBeGreaterThan(80);
    expect(contextualDefaults.length).toBe(workspaceColumns.length);

    const governedRouters = ["shippingBatch", "logistics", "dataImport"];
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
it("preserves Listing artifact registration",()=>{expect(fs.readFileSync(repoPath("server/repositories/listing/listingRepository.ts"),"utf8")).toContain("registerListingArtifact");});

  it("samples real normalized MySQL statement digests", () => {
    const sampler = fs.readFileSync(repoPath("server/repositories/database/slowQueryRepository.ts"), "utf8");
    expect(sampler).toContain("performance_schema.events_statements_summary_by_digest");
    expect(sampler).toContain("DIGEST_TEXT NOT LIKE");
    expect(sampler).toContain("databaseSlowQuerySamples");
  });
});
