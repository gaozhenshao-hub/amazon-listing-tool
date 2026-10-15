#!/usr/bin/env node
// Offline, source-derived DDL only. This is NOT a production schema clone or a
// migration plan. Never import drizzle.config, a migration runner or a DB client.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROJECTION_VERSION = "source-schema-projection/1.0";
export const EXCLUDED_TABLES = Object.freeze([
  "image_controlled_upload_receipts",
  "image_asset_license_evidence_revisions",
  "image_workflow_version_scopes",
  "image_workflow_stage_snapshots",
  "image_workflow_snapshot_state_events",
].sort());
const SCHEMA_ENTRY = "drizzle/schema/index.ts";
export const ASSISTANT_SCHEMA_SOURCE = Object.freeze({
  path: "drizzle/schema/assistantConfigurations.ts",
  sha256: "e07c4126be9e5152db9f28ce742291e05290006901ddb37ac2175e06eb66ae2b",
});
const WORKSPACE_HELPER = "server/domains/ops/workspaceContext.ts";
// The only non-schema runtime dependency: AsyncLocalStorage construction and
// exported helpers, with a type-only cache import. Changes require a new review.
const WORKSPACE_HELPER_SHA256 = "a25652858ed79f28291c9a3fe459bf6b152d43c4195daead5b488cca2023999b";
const ORM_FACTORIES = new Set([
  "bigint", "boolean", "decimal", "index", "int", "json", "longtext", "mysqlEnum",
  "mysqlTable", "text", "timestamp", "tinyint", "uniqueIndex", "varchar",
]);
const COLUMN_METHODS = new Set(["autoincrement", "primaryKey", "notNull", "default", "defaultNow", "onUpdateNow", "unique", "on", "$defaultFn"]);
const CLAIM_PREFIX_SCHEMA = "drizzle/schema/skillDistillation.ts";
const sha256 = value => createHash("sha256").update(value).digest("hex");
class ProjectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ProjectionError(code); };

// Reject new executable schema constructs rather than importing arbitrary TS.
// This is a narrow declarative-source admission check, not a hostile-code sandbox.
export function inspectSchemaModule(source, filename, ts) {
  // The feature schema adds one CHAR builder and a type-only JSON annotation.
  // Admit the reviewed whole file, not arbitrary new imports or $type calls.
  const isAssistant = filename === ASSISTANT_SCHEMA_SOURCE.path;
  if (isAssistant && sha256(source) !== ASSISTANT_SCHEMA_SOURCE.sha256) fail("ASSISTANT_SCHEMA_REVIEW_REQUIRED");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) fail("SCHEMA_PARSE_FAILED");
  const dependencies = [], names = new Set();
  const isIndex = filename === SCHEMA_ENTRY;
  const factoryAllowed = name => ORM_FACTORIES.has(name) || isAssistant && name === "char";
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleName = statement.moduleSpecifier.text;
      const bindings = statement.importClause?.namedBindings;
      if (statement.importClause?.isTypeOnly) {
        if (!isAssistant || moduleName !== "../../shared/assistantConfigurations" || statement.importClause.name
          || !bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== 1
          || bindings.elements[0].propertyName || bindings.elements[0].name.text !== "AssistantConfiguration") fail("UNREVIEWED_SCHEMA_IMPORT");
        // Type-only: not a runtime import and not executed by the schema loader.
        continue;
      }
      if (isIndex) fail("UNREVIEWED_SCHEMA_IMPORT");
      if (statement.importClause?.name || !bindings || !ts.isNamedImports(bindings)) fail("UNREVIEWED_SCHEMA_IMPORT");
      for (const binding of bindings.elements) {
        if (binding.propertyName || binding.isTypeOnly) fail("UNREVIEWED_SCHEMA_IMPORT");
        const name = binding.name.text;
        if (!(moduleName === "drizzle-orm/mysql-core" && factoryAllowed(name))
          && !(filename === CLAIM_PREFIX_SCHEMA && moduleName === "drizzle-orm" && name === "sql")
          && !(moduleName === "../../server/domains/ops/workspaceContext" && name === "currentOpsWorkspaceId")) fail("UNREVIEWED_SCHEMA_IMPORT");
        names.add(name);
      }
      if (moduleName === "../../server/domains/ops/workspaceContext") dependencies.push(WORKSPACE_HELPER);
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier?.text;
      if (!isIndex || !/^\.\/[A-Za-z][A-Za-z0-9_]*$/.test(specifier ?? "")) fail("UNREVIEWED_SCHEMA_EXPORT");
      dependencies.push(`drizzle/schema/${specifier.slice(2)}.ts`);
    } else if (!ts.isVariableStatement(statement) && !ts.isTypeAliasDeclaration(statement)) {
      fail("UNREVIEWED_SCHEMA_STATEMENT");
    }
  }
  let currentTable;
  const column = (node, name) => node && ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === "table" && node.name.text === name;
  function reviewedClaimPrefix(node, inTableCallback) {
    // This is one historical 0187 index expression, not general SQL admission.
    // Keep its source spelling, table, index, columns and literal prefix exact.
    const onCall = node.parent;
    if (filename !== CLAIM_PREFIX_SCHEMA || !inTableCallback || !names.has("sql")
      || currentTable?.exportName !== "knowledgeDistillationEvidence" || currentTable?.physicalName !== "knowledge_distillation_evidence"
      || !ts.isIdentifier(node.tag) || node.tag.text !== "sql" || node.typeArguments?.length
      || node.getText(ast) !== 'sql`${table.claim}(191)`'
      || !ts.isTemplateExpression(node.template) || node.template.head.text !== "" || node.template.templateSpans.length !== 1
      || !column(node.template.templateSpans[0].expression, "claim") || node.template.templateSpans[0].literal.text !== "(191)"
      || !onCall || !ts.isCallExpression(onCall) || onCall.arguments.length !== 3 || onCall.arguments[2] !== node
      || !column(onCall.arguments[0], "distillationProjectId") || !column(onCall.arguments[1], "sourceKey")) return false;
    const on = onCall.expression;
    if (!ts.isPropertyAccessExpression(on) || on.name.text !== "on" || !ts.isCallExpression(on.expression)) return false;
    const factory = on.expression;
    return ts.isIdentifier(factory.expression) && factory.expression.text === "uniqueIndex" && factory.arguments.length === 1
      && ts.isStringLiteral(factory.arguments[0]) && factory.arguments[0].text === "uq_kdistill_evidence_project_source_claim";
  }
  function expression(node, inTableCallback = false) {
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)
      || [ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(node.kind)) return;
    if (ts.isIdentifier(node) && ((names.has(node.text) && node.text !== "sql") || (inTableCallback && node.text === "table"))) return;
    if (ts.isTaggedTemplateExpression(node) && reviewedClaimPrefix(node, inTableCallback)) return;
    if (ts.isAsExpression(node)) return expression(node.expression, inTableCallback);
    if (ts.isParenthesizedExpression(node)) return expression(node.expression, inTableCallback);
    if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator)) return expression(node.operand, inTableCallback);
    if (ts.isArrayLiteralExpression(node)) { node.elements.forEach(item => expression(item, inTableCallback)); return; }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) fail("UNREVIEWED_SCHEMA_EXPRESSION");
        expression(property.initializer, inTableCallback);
      }
      return;
    }
    if (ts.isArrowFunction(node) && !node.modifiers?.length && node.parameters.length === 1
      && ts.isIdentifier(node.parameters[0].name) && node.parameters[0].name.text === "table"
      && !node.parameters[0].initializer && !ts.isBlock(node.body)) return expression(node.body, true);
    if (ts.isPropertyAccessExpression(node) && inTableCallback && ts.isIdentifier(node.expression)
      && node.expression.text === "table") return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && names.has(callee.text) && factoryAllowed(callee.text)) {
        node.arguments.forEach(item => expression(item, inTableCallback)); return;
      }
      if (isAssistant && ts.isPropertyAccessExpression(callee) && callee.name.text === "$type"
        && node.arguments.length === 0 && node.typeArguments?.length === 1
        && ts.isTypeReferenceNode(node.typeArguments[0]) && ts.isIdentifier(node.typeArguments[0].typeName)
        && node.typeArguments[0].typeName.text === "AssistantConfiguration"
        && ts.isCallExpression(callee.expression) && ts.isIdentifier(callee.expression.expression)
        && callee.expression.expression.text === "json" && callee.expression.arguments.length === 1
        && ts.isStringLiteral(callee.expression.arguments[0]) && callee.expression.arguments[0].text === "config") {
        return expression(callee.expression, inTableCallback);
      }
      if (ts.isPropertyAccessExpression(callee) && COLUMN_METHODS.has(callee.name.text) && ts.isCallExpression(callee.expression)) {
        expression(callee.expression, inTableCallback);
        if (callee.name.text === "$defaultFn" && !(node.arguments.length === 1
          && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === "currentOpsWorkspaceId")) fail("UNREVIEWED_SCHEMA_DEFAULT_FUNCTION");
        node.arguments.forEach(item => expression(item, inTableCallback)); return;
      }
    }
    fail("UNREVIEWED_SCHEMA_EXPRESSION");
  }
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (isIndex || !(statement.declarationList.flags & ts.NodeFlags.Const)) fail("UNREVIEWED_SCHEMA_STATEMENT");
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && init && ts.isAsExpression(init)
        && ts.isArrayLiteralExpression(init.expression) && init.expression.elements.every(ts.isStringLiteral)) {
        names.add(declaration.name.text); continue;
      }
      if (!ts.isIdentifier(declaration.name) || !init || !ts.isCallExpression(init)
        || !ts.isIdentifier(init.expression) || init.expression.text !== "mysqlTable") fail("UNREVIEWED_SCHEMA_STATEMENT");
      currentTable = { exportName: declaration.name.text,
        physicalName: ts.isStringLiteral(init.arguments[0]) ? init.arguments[0].text : undefined };
      expression(init);
    }
  }
  return [...new Set(dependencies)].sort();
}

function readRegularSource(repoRoot, path) {
  const fullPath = join(repoRoot, path);
  if (lstatSync(fullPath).isSymbolicLink() || !lstatSync(fullPath).isFile()
    || realpathSync(fullPath) !== fullPath) fail("SOURCE_PATH_NOT_REGULAR");
  return readFileSync(fullPath, "utf8");
}

export function auditSchemaSources(repoRoot, ts) {
  const pending = [SCHEMA_ENTRY], audited = new Map();
  while (pending.length) {
    const path = pending.pop();
    if (audited.has(path)) continue;
    const source = readRegularSource(repoRoot, path), digest = sha256(source);
    if (path === WORKSPACE_HELPER) {
      if (digest !== WORKSPACE_HELPER_SHA256) fail("WORKSPACE_HELPER_REVIEW_REQUIRED");
    } else pending.push(...inspectSchemaModule(source, path, ts));
    audited.set(path, digest);
  }
  return [...audited].sort(([a], [b]) => a.localeCompare(b)).map(([path, hash]) => ({ path, sha256: hash }));
}

export function selectProjectionTables(exports, isTable, getTableName) {
  const selected = {}, seen = new Set(), excluded = new Set();
  for (const [key, value] of Object.entries(exports)) {
    // Module namespace objects have a null prototype and break Drizzle's `is`.
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) === null || !isTable(value)) continue;
    const tableName = getTableName(value);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) fail("TABLE_NAME_INVALID");
    if (EXCLUDED_TABLES.includes(tableName)) { excluded.add(tableName); continue; }
    if (seen.has(tableName)) fail("DUPLICATE_TABLE_EXPORT");
    seen.add(tableName); selected[key] = value;
  }
  if (!seen.size) fail("NO_TABLES_FOUND");
  if (excluded.size !== EXCLUDED_TABLES.length) fail("DRAFT_EXCLUSION_SOURCE_CHANGED");
  return { tables: selected, tableNames: [...seen].sort(), excludedTables: [...excluded].sort() };
}

export function normalizeCreateStatement(sql) {
  const refuse = () => fail("PROJECTION_NOT_CREATE_ONLY");
  if (typeof sql !== "string") refuse();
  for (const char of sql) {
    const value = char.charCodeAt(0);
    if (value === 127 || (value < 32 && ![9, 10, 13].includes(value))) refuse();
  }
  // Admit only the generator's CREATE TABLE (...) / CREATE [UNIQUE] INDEX ...
  // (...) shape, not arbitrary SQL. Comments and quoted semicolons are not
  // statement boundaries. Executable/hint comments, ambiguous backslash escapes,
  // unfinished tokens, table options and any second statement fail closed.
  let header = "", depth = 0, bodyStarted = false, bodyClosed = false;
  let terminator = -1, trailingLineComment = false;
  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    if (/\s/.test(char)) { if (!bodyStarted) header += " "; index += 1; continue; }
    if (char === "#" || (sql.startsWith("--", index) && /\s|^$/.test(sql[index + 2] ?? ""))) {
      const end = sql.slice(index).search(/[\r\n]/);
      if (!bodyStarted) header += " ";
      if (end < 0) { trailingLineComment = true; break; }
      index += end + 1;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      if (["!", "+"].includes(sql[index + 2])) refuse();
      const end = sql.indexOf("*/", index + 2);
      if (end < 0 || sql.slice(index + 2, end).includes("/*")) refuse();
      if (!bodyStarted) header += " ";
      index = end + 2;
      continue;
    }
    if (terminator >= 0) refuse();
    if (char === ";") {
      if (!bodyClosed || depth !== 0) refuse();
      terminator = index++;
      continue;
    }
    if (bodyClosed) refuse();
    if (["'", '"', "`"].includes(char)) {
      index += 1;
      let closed = false;
      while (index < sql.length) {
        // Parsing escaped quotes depends on NO_BACKSLASH_ESCAPES. Do not guess.
        if (sql[index] === "\\") refuse();
        if (sql[index] === char && sql[index + 1] === char) index += 2;
        else if (sql[index] === char) { index += 1; closed = true; break; }
        else index += 1;
      }
      if (!closed) refuse();
      if (!bodyStarted) header += char === "`" ? " __quoted_identifier__ " : " 'literal' ";
      continue;
    }
    if (char === "(") {
      if (!bodyStarted) {
        const identifier = "[A-Za-z_][A-Za-z0-9_]*";
        const prefix = new RegExp(`^CREATE\\s+(?:TABLE\\s+${identifier}|(?:UNIQUE\\s+)?INDEX\\s+${identifier}\\s+ON\\s+${identifier})$`, "i");
        if (!prefix.test(header.trim())) refuse();
        bodyStarted = true;
      }
      depth += 1;
    } else if (char === ")") {
      if (!bodyStarted || depth <= 0) refuse();
      depth -= 1;
      if (depth === 0) bodyClosed = true;
    } else if (!bodyStarted) header += char;
    index += 1;
  }
  if (!bodyClosed || depth !== 0) refuse();
  const body = (terminator < 0 ? sql : sql.slice(0, terminator)).trim();
  // A terminal line comment without a delimiter must not swallow our delimiter.
  return `${body}${terminator < 0 && trailingLineComment ? "\n" : ""};`;
}

export async function buildProjection({ exports, isTable, getTableName, generateSnapshot, generateMigration, sourceFiles, versions }) {
  const selected = selectProjectionTables(exports, isTable, getTableName);
  const empty = await generateSnapshot({}), current = await generateSnapshot(selected.tables);
  const statements = await generateMigration(empty, current);
  if (!Array.isArray(statements) || !statements.length) fail("PROJECTION_NOT_CREATE_ONLY");
  const normalizedStatements = statements.map(normalizeCreateStatement);
  const sql = `-- SOURCE-DERIVED PROJECTION ONLY; NOT A PRODUCTION CLONE OR MIGRATION LEDGER.\n`
    + `-- ${PROJECTION_VERSION}; excludes dedicated 0206/0207 tables; no business data or seeds.\n`
    + normalizedStatements.join("\n\n") + "\n";
  return { sql, metadata: {
    version: PROJECTION_VERSION, mode: "source-derived-projection", productionClone: false,
    databaseConnected: false, sqlExecuted: false, migrationLedgerWritten: false,
    schemaEntry: SCHEMA_ENTRY, sqlFile: "source-projection.sql", sqlSha256: sha256(sql),
    tableCount: selected.tableNames.length, ddlCount: statements.length,
    tableNames: selected.tableNames, excludedTables: selected.excludedTables,
    excludedReason: "0206/0207 dedicated-release tables are excluded by actual physical table name.",
    sourceFiles, sourceSha256: sha256(JSON.stringify(sourceFiles)), versions,
    limitations: [
      "Generated from reviewed local Drizzle declarations, not an inspected database or production backup.",
      "No migration history, production indexes missing from source, data, grants, routines, triggers or Skill seeds are reconstructed.",
      "Historical first-run, repeat-run and recovery validation require separate migration rehearsals.",
      "Do not replay historical migrations over this projection or baseline a real database from this metadata.",
    ],
  } };
}

export function writeProjection(outputDirectory, projection) {
  const target = resolve(outputDirectory), parent = realpathSync(dirname(target));
  if (parent !== dirname(target)) fail("OUTPUT_PARENT_SYMLINK");
  // Deliberately no recursive mkdir or overwrite: preserve every existing output.
  mkdirSync(target, { mode: 0o700 });
  writeFileSync(join(target, "source-projection.sql"), projection.sql, { flag: "wx", mode: 0o600 });
  writeFileSync(join(target, "source-projection.metadata.json"), `${JSON.stringify(projection.metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { outputDirectory: target, sqlSha256: projection.metadata.sqlSha256, tableCount: projection.metadata.tableCount, ddlCount: projection.metadata.ddlCount };
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!["--repo-root", "--out-dir"].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith("--")) fail("CLI_ARGUMENTS_INVALID");
    options[key] = resolve(value);
  }
  if (!options["--repo-root"] || !options["--out-dir"]) fail("CLI_ARGUMENTS_INVALID");
  return { repoRoot: options["--repo-root"], outputDirectory: options["--out-dir"] };
}

/** Reviewed inputs only; never a migration, DB client, or approval factory. */
export async function loadReviewedProjectionInputs(repoRoot) {
  const root = realpathSync(repoRoot), ownRoot = realpathSync(new URL("../../", import.meta.url));
  if (root !== ownRoot) fail("REPO_MUST_MATCH_TOOL_CHECKOUT");
  const require = createRequire(join(root, "package.json"));
  const ts = require("typescript");
  const sourceFiles = Object.freeze(auditSchemaSources(root, ts).map(item => Object.freeze(item)));
  // Retain a private immutable baseline even if callers copy metadata for a
  // separate projection. This check detects drift; it is not an import sandbox.
  const sourceBaseline = JSON.stringify(sourceFiles);
  const { tsImport } = require("tsx/esm/api");
  const schema = await tsImport(pathToFileURL(join(root, SCHEMA_ENTRY)).href, { parentURL: import.meta.url, tsconfig: false });
  const { is, getTableName } = require("drizzle-orm"), { MySqlTable } = require("drizzle-orm/mysql-core");
  // CJS API avoids the Node 24 dynamic-require bug in drizzle-kit/api.mjs.
  const { generateMySQLDrizzleJson, generateMySQLMigration } = require("drizzle-kit/api");
  const readVersion = entry => JSON.parse(readFileSync(join(dirname(require.resolve(entry)), "package.json"), "utf8")).version;
  const versions = { node: process.versions.node, drizzleKit: readVersion("drizzle-kit/api"), drizzleOrm: readVersion("drizzle-orm"),
    tsx: JSON.parse(readFileSync(require.resolve("tsx/package.json"), "utf8")).version };
  const assertUnchanged = () => {
    if (sourceBaseline !== JSON.stringify(auditSchemaSources(root, ts))) fail("SOURCE_CHANGED_DURING_GENERATION");
  };
  assertUnchanged();
  return { exports: schema, isTable: value => is(value, MySqlTable), getTableName,
    generateSnapshot: generateMySQLDrizzleJson, generateMigration: generateMySQLMigration, sourceFiles, versions, assertUnchanged };
}

export async function exportSourceProjection({ repoRoot, outputDirectory }) {
  const root = realpathSync(repoRoot), ownRoot = realpathSync(new URL("../../", import.meta.url));
  if (root !== ownRoot) fail("REPO_MUST_MATCH_TOOL_CHECKOUT");
  const outputRelative = relative(root, resolve(outputDirectory));
  if (!outputRelative || (!isAbsolute(outputRelative) && outputRelative !== ".." && !outputRelative.startsWith(`..${sep}`))) fail("OUTPUT_MUST_BE_OUTSIDE_CHECKOUT");
  const inputs = await loadReviewedProjectionInputs(root);
  const projection = await buildProjection(inputs);
  inputs.assertUnchanged();
  return writeProjection(outputDirectory, projection);
}

export async function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) return { exitCode: 0, output: { usage: "node scripts/integration/sourceProjection.mjs --repo-root <this checkout> --out-dir <new directory outside checkout>", databaseConnected: false, sqlExecuted: false } };
    const result = await exportSourceProjection(options);
    return { exitCode: 0, output: { ok: true, mode: "source-derived-projection", ...result, databaseConnected: false, sqlExecuted: false } };
  } catch (error) {
    return { exitCode: 1, output: { ok: false, databaseConnected: false, sqlExecuted: false,
      error: error instanceof ProjectionError ? error.code : "PROJECTION_EXPORT_FAILED" } };
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
