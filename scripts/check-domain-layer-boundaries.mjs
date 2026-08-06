import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();

const layerFiles = {
  router: [
    "server/domains/product_development/router.ts",
    "server/domains/ads/router.ts",
    "server/domains/ops/router.ts",
    "server/domains/ops/routers/todosLogs.ts",
    "server/domains/ops/routers/teamTasks.ts",
    "server/domains/ops/routers/keywordMonitors.ts",
    "server/routers/devAnalysis.ts",
    "server/routers/adAnalysisP2.ts",
    "server/routers/operations.ts",
  ],
  compatibilityRouter: [
    "server/routers/adDeepAnalysis.ts",
    "server/routers/adLocalAnalysis.ts",
    "server/domains/ops/routers/weeklyOps.ts",
    "server/domains/ops/routers/plans.ts",
    "server/domains/ops/routers/products.ts",
    "server/domains/ops/routers/imports.ts",
    "server/domains/ops/routers/executionReviews.ts",
    "server/domains/ops/routers/conversion.ts",
    "server/domains/ops/routers/marketplaceSummaries.ts",
    "server/domains/ops/operations/tags.ts",
    "server/domains/ops/operations/settings.ts",
    "server/domains/ops/operations/inventory.ts",
    "server/domains/ops/operations/competitors.ts",
    "server/domains/ops/operations/profit.ts",
    "server/domains/ops/operations/advertising.ts",
  ],
  service: [
    "server/domains/product_development/service.ts",
    "server/domains/ads/service.ts",
    "server/domains/ops/workManagement/service.ts",
  ],
  repository: [
    "server/domains/product_development/repository.ts",
    "server/domains/ads/repository.ts",
    "server/domains/ops/workManagement/repository.ts",
  ],
};

const forbiddenImports = {
  router: ["drizzle-orm", "drizzle/schema", "repositories/dbClient", "businessSkillGateway", "devDb"],
  compatibilityRouter: ["repositories/dbClient", "businessSkillGateway", "_core/llm"],
  service: ["@trpc/server", "_core/trpc", "drizzle-orm", "drizzle/schema", "repositories/dbClient"],
  repository: ["@trpc/server", "_core/trpc", "businessSkillGateway", "_core/llm"],
};

const forbiddenCalls = {
  router: new Set(["getDb", "requireDb", "invokeLLM", "invokeBusinessSkill"]),
  compatibilityRouter: new Set(["getDb", "requireDb", "invokeLLM", "invokeBusinessSkill"]),
  service: new Set(["getDb", "requireDb", "invokeLLM"]),
  repository: new Set(["invokeLLM", "invokeBusinessSkill"]),
};

function inspectLayerFile(layer, relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) return [`${relativePath}: missing declared ${layer} file`];
  const sourceText = fs.readFileSync(fullPath, "utf8");
  const source = ts.createSourceFile(fullPath, sourceText, ts.ScriptTarget.Latest, true);
  const violations = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (forbiddenImports[layer].some((token) => specifier.includes(token))) {
      violations.push(`${relativePath}: ${layer} imports forbidden dependency '${specifier}'`);
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && forbiddenCalls[layer].has(node.expression.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      violations.push(`${relativePath}:${line}: ${layer} calls forbidden '${node.expression.text}'`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

function productionFiles(directory, extensions) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(target, extensions);
    if (!entry.isFile() || !extensions.some((extension) => entry.name.endsWith(extension))) return [];
    if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) return [];
    return [target];
  });
}

const violations = Object.entries(layerFiles).flatMap(([layer, files]) => (
  files.flatMap((file) => inspectLayerFile(layer, file))
));

const compatibilityDevDb = fs.readFileSync(path.join(root, "server/devDb.ts"), "utf8");
if (/drizzle-orm|repositories\/dbClient|getDb\s*\(/.test(compatibilityDevDb)) {
  violations.push("server/devDb.ts: compatibility facade contains database implementation");
}

for (const file of productionFiles(path.join(root, "client/src"), [".ts", ".tsx"])) {
  const source = fs.readFileSync(file, "utf8");
  if (/\b(?:message|msg)\.(?:includes|match)\s*\(/.test(source)) {
    violations.push(`${path.relative(root, file)}: client infers state from error message text`);
  }
}

if (violations.length > 0) {
  console.error(`Domain layer boundary failed (${violations.length} violation${violations.length === 1 ? "" : "s"}):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `Domain layer boundary passed: ${layerFiles.router.length} routers, ${layerFiles.compatibilityRouter.length} governed compatibility routers, ${layerFiles.service.length} services, ${layerFiles.repository.length} repositories.`,
);
