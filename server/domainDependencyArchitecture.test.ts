import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_DEPENDENCY_RULES,
  type DomainDependencySlug,
} from "./domains/domainManifest";

const domainsRoot = path.resolve(import.meta.dirname, "domains");

function productionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(target);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    if (/\.(?:test|spec)\.ts$/.test(entry.name)) return [];
    return [path.normalize(target)];
  });
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function staticDependencies(filePath: string) {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const dependencies: string[] = [];

  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const resolved = resolveLocalModule(filePath, statement.moduleSpecifier.text);
      if (resolved) dependencies.push(path.normalize(resolved));
    }
  }
  return dependencies;
}

function domainOf(filePath: string): DomainDependencySlug | null {
  const relative = path.relative(domainsRoot, filePath);
  if (relative.startsWith("..")) return null;
  const slug = relative.split(path.sep)[0] as DomainDependencySlug;
  return Object.hasOwn(DOMAIN_DEPENDENCY_RULES, slug) ? slug : null;
}

function findCycles(graph: Map<string, string[]>) {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles = new Set<string>();

  function visit(filePath: string) {
    if (active.has(filePath)) {
      const start = stack.indexOf(filePath);
      const cycle = [...stack.slice(start), filePath]
        .map((entry) => path.relative(domainsRoot, entry))
        .join(" -> ");
      cycles.add(cycle);
      return;
    }
    if (visited.has(filePath)) return;

    visited.add(filePath);
    active.add(filePath);
    stack.push(filePath);
    for (const dependency of graph.get(filePath) ?? []) visit(dependency);
    stack.pop();
    active.delete(filePath);
  }

  for (const filePath of graph.keys()) visit(filePath);
  return [...cycles].sort();
}

describe("domain dependency architecture", () => {
  const files = productionFiles(domainsRoot);
  const fileSet = new Set(files);
  const graph = new Map(
    files.map((filePath) => [
      filePath,
      staticDependencies(filePath).filter((dependency) => fileSet.has(dependency)),
    ]),
  );

  it("allows only declared cross-domain dependencies", () => {
    const violations: string[] = [];
    for (const [filePath, dependencies] of graph) {
      const owner = domainOf(filePath);
      if (!owner) continue;
      for (const dependency of dependencies) {
        const target = domainOf(dependency);
        if (!target || target === owner) continue;
        if (!DOMAIN_DEPENDENCY_RULES[owner].includes(target)) {
          violations.push(
            `${path.relative(domainsRoot, filePath)} imports ${path.relative(domainsRoot, dependency)} (${owner} -> ${target})`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("contains no static import or export cycles", () => {
    const cycles = findCycles(graph);
    expect(cycles, cycles.join("\n")).toEqual([]);
  });
});
