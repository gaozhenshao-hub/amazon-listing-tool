import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const serverRoot = path.resolve(import.meta.dirname);
const safeClientPath = path.join(serverRoot, "infrastructure/http/safeHttpClient.ts");

function productionTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(target);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    if (/\.(?:test|spec)\.ts$/.test(entry.name)) return [];
    if (/\s+\d+\.ts$/.test(entry.name)) return [];
    return [target];
  });
}

function findNetworkBypasses(filePath: string) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const axiosIdentifiers = new Set<string>();
  const httpNamespaces = new Set<string>();
  const requestIdentifiers = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (moduleName === "axios" && clause) {
      if (clause.name) axiosIdentifiers.add(clause.name.text);
      violations.push("imports axios directly");
    }
    if (!["http", "https", "node:http", "node:https"].includes(moduleName) || !clause) continue;
    if (clause.name) httpNamespaces.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      httpNamespaces.add(clause.namedBindings.name.text);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const item of clause.namedBindings.elements) {
        if ((item.propertyName?.text || item.name.text) === "request") requestIdentifiers.add(item.name.text);
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === "fetch") {
        violations.push(`calls fetch() at ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      if (ts.isIdentifier(expression) && requestIdentifiers.has(expression.text)) {
        violations.push(`calls a raw HTTP request at ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
        const owner = expression.expression.text;
        if (httpNamespaces.has(owner) && expression.name.text === "request") {
          violations.push(`calls ${owner}.request() at ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        if (axiosIdentifiers.has(owner)) {
          violations.push(`calls axios directly at ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  if (/\b(?:exec|execSync|spawn|spawnSync)\s*\([^\n]*(?:curl|wget)\b/.test(sourceText)) {
    violations.push("launches curl/wget through child_process");
  }
  return violations;
}

describe("server network egress architecture", () => {
  it("routes production network requests through Safe HTTP", () => {
    const violations = productionTypeScriptFiles(serverRoot)
      .filter((filePath) => filePath !== safeClientPath)
      .flatMap((filePath) => findNetworkBypasses(filePath).map((message) => (
        `${path.relative(serverRoot, filePath)}: ${message}`
      )));

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
