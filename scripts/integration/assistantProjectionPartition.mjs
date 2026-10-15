#!/usr/bin/env node
// Offline candidate evidence only. No database client, executor or native approval.
import { createHash } from "node:crypto";
import { constants, fstatSync, openSync, closeSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as projectionTools from "./sourceProjection.mjs";
import { splitPublicStatements } from "../database/freshBootstrapReference.mjs";

export const PARTITION_VERSION = "assistant-source-projection-partition/1";
export const ASSISTANT_PROJECTION_PINS = Object.freeze({
  dedicatedSql: Object.freeze({ path: "drizzle/0230_assistant_configurations.sql", sha256: "88b08b6852381336d06af255e25c6dd6a5ed574b7ed27c94b2b86db34fe080e8" }),
  assistantSchema: Object.freeze({ path: "drizzle/schema/assistantConfigurations.ts", sha256: "e07c4126be9e5152db9f28ce742291e05290006901ddb37ac2175e06eb66ae2b" }),
  indexSource: Object.freeze({ path: "drizzle/schema/index.ts", sha256: "83ad4960a3116d5d8274ee4377ae42ef6f7d109c074bbddc72c1ab0534d0104c" }),
  historicalIndexSha256: "e2990343f4c0ea8b16d21a78e54c696044b45a0cee5159abb7325411fe68ea29",
  historicalSourceSha256: "7b0b730998509d2ba70dc7b771bf5a6233146c58b35d2ef83bf028945a2c1a6f",
  baseSqlSha256: "c2ea534b048427e7b3b464dd37ec442524cf5e8dd1ec80fac3e514259957a6aa",
  currentSourceCount: 19, baseTableCount: 287, baseDdlCount: 406,
});
export const ASSISTANT_PARTITION_TABLES = Object.freeze([
  "emperor_assistant_configuration_versions", "emperor_assistant_configurations",
]);
const INDEXES = Object.freeze({
  emperor_assistant_configurations: { name: "uq_assistant_configuration_scope", columns: ["workspaceId", "agentKey"] },
  emperor_assistant_configuration_versions: { name: "uq_assistant_configuration_version_scope", columns: ["workspaceId", "agentKey", "revision"] },
});
const digest = value => createHash("sha256").update(value).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const insist = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const fail = suffix => `ASSISTANT_PARTITION_${suffix}`;
const GENERATED_HEADER = "-- SOURCE-DERIVED PROJECTION ONLY; NOT A PRODUCTION CLONE OR MIGRATION LEDGER.\n"
  + `-- ${projectionTools.PROJECTION_VERSION}; excludes dedicated 0206/0207 tables; no business data or seeds.\n`;

export function validateAssistantProjectionSources(sourceFiles, sources) {
  insist(Array.isArray(sourceFiles) && sourceFiles.length === ASSISTANT_PROJECTION_PINS.currentSourceCount, fail("SOURCE_VECTOR_INVALID"));
  const seen = new Set();
  for (const item of sourceFiles) {
    insist(item && same(Object.keys(item).sort(), ["path", "sha256"]) && typeof item.path === "string"
      && (/^drizzle\/schema\/[A-Za-z][A-Za-z0-9_]*\.ts$/.test(item.path) || item.path === "server/domains/ops/workspaceContext.ts")
      && /^[a-f0-9]{64}$/.test(item.sha256) && !seen.has(item.path), fail("SOURCE_VECTOR_INVALID"));
    seen.add(item.path);
  }
  insist(same(sourceFiles, [...sourceFiles].sort((a, b) => a.path.localeCompare(b.path))), fail("SOURCE_VECTOR_ORDER_CHANGED"));
  for (const [name, pin] of Object.entries(ASSISTANT_PROJECTION_PINS).filter(([, value]) => typeof value === "object")) {
    insist(typeof sources[name] === "string" && digest(sources[name]) === pin.sha256, fail("SOURCE_PIN_CHANGED"));
    if (name !== "dedicatedSql") insist(sourceFiles.find(item => item.path === pin.path)?.sha256 === pin.sha256, fail("SOURCE_VECTOR_PIN_CHANGED"));
  }
  const historical = sourceFiles.filter(item => item.path !== ASSISTANT_PROJECTION_PINS.assistantSchema.path)
    .map(item => item.path === ASSISTANT_PROJECTION_PINS.indexSource.path ? { ...item, sha256: ASSISTANT_PROJECTION_PINS.historicalIndexSha256 } : { ...item });
  insist(digest(JSON.stringify(historical)) === ASSISTANT_PROJECTION_PINS.historicalSourceSha256, fail("HISTORICAL_SOURCE_VECTOR_CHANGED"));
  return { actualSourceSha256: digest(JSON.stringify(sourceFiles)), historicalSourceSha256: digest(JSON.stringify(historical)) };
}

// Tokens are used only to attribute tables/indexes/references. Raw statement bytes
// remain the comparison input; literals, spacing and definition order are not rewritten.
function tokens(sql) {
  const result = [];
  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === "'" || char === '"') {
      const quote = char; index++; let closed = false;
      while (index < sql.length) {
        if (sql[index] === "\\") index += 2;
        else if (sql[index] === quote && sql[index + 1] === quote) index += 2;
        else if (sql[index++] === quote) { closed = true; break; }
      }
      insist(closed, fail("SQL_TOKEN_INVALID")); result.push({ kind: "literal", value: "" }); continue;
    }
    if (char === "`") {
      index++; let value = "", closed = false;
      while (index < sql.length) {
        if (sql[index] === "`" && sql[index + 1] === "`") { value += "`"; index += 2; }
        else if (sql[index] === "`") { index++; closed = true; break; }
        else value += sql[index++];
      }
      insist(closed, fail("SQL_TOKEN_INVALID")); result.push({ kind: "identifier", value }); continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index));
    if (word) { result.push({ kind: "word", value: word[0] }); index += word[0].length; }
    else { result.push({ kind: "symbol", value: char }); index++; }
  }
  return result;
}
const keyword = (token, value) => token?.kind === "word" && token.value.toUpperCase() === value;
const identifier = token => token && ["word", "identifier"].includes(token.kind) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(token.value);
function columnsAt(items, offset) {
  insist(items[offset]?.value === "(", fail("INDEX_INVALID"));
  const columns = []; let next = offset + 1;
  while (items[next]?.value !== ")") {
    insist(identifier(items[next]), fail("INDEX_INVALID")); columns.push(items[next++].value);
    if (items[next]?.value === ",") next++;
    else insist(items[next]?.value === ")", fail("INDEX_INVALID"));
  }
  insist(columns.length > 0, fail("INDEX_INVALID"));
  return { columns, next: next + 1 };
}
function describe(sql, sourceIndex) {
  const items = tokens(sql);
  insist(keyword(items[0], "CREATE"), fail("UNKNOWN_DDL"));
  let tableName, kind, indexName = null, indexColumns = null, unique = false;
  if (keyword(items[1], "TABLE") && identifier(items[2]) && items[3]?.value === "(") {
    kind = "create-table"; tableName = items[2].value;
  } else {
    const at = keyword(items[1], "UNIQUE") ? 2 : 1;
    insist(keyword(items[at], "INDEX") && identifier(items[at + 1]) && keyword(items[at + 2], "ON") && identifier(items[at + 3]), fail("UNKNOWN_DDL"));
    kind = "create-index"; unique = at === 2; indexName = items[at + 1].value; tableName = items[at + 3].value;
    insist(items[at + 4]?.value === "(", fail("INDEX_INVALID"));
    if (ASSISTANT_PARTITION_TABLES.includes(tableName)) {
      const parsed = columnsAt(items, at + 4); indexColumns = parsed.columns;
      insist(parsed.next === items.length, fail("INDEX_INVALID"));
    }
  }
  const references = [];
  for (let index = 0; index < items.length; index++) if (keyword(items[index], "REFERENCES")) {
    insist(identifier(items[index + 1]) && items[index + 2]?.value === "(", fail("REFERENCE_INVALID"));
    references.push(items[index + 1].value);
  }
  return { sql, sourceIndex, kind, tableName, indexName, indexColumns, unique, references, items, sha256: digest(sql) };
}
function assertGeneratedFraming(sql) {
  insist(typeof sql === "string" && sql.startsWith(GENERATED_HEADER), fail("GENERATED_FRAMING_CHANGED"));
  // The shared splitter removes comments. Permit only the exact generated header
  // above, so it cannot erase differences inside any compared CREATE statement.
  for (let index = GENERATED_HEADER.length; index < sql.length;) {
    const char = sql[index];
    if (["'", '"', "`"].includes(char)) {
      const quote = char; index++; let closed = false;
      while (index < sql.length) {
        if (sql[index] === "\\") index += 2;
        else if (sql[index] === quote && sql[index + 1] === quote) index += 2;
        else if (sql[index++] === quote) { closed = true; break; }
      }
      insist(closed, fail("SQL_TOKEN_INVALID"));
    } else {
      insist(char !== "#" && !sql.startsWith("/*", index)
        && !(sql.startsWith("--", index) && /\s|^$/.test(sql[index + 2] ?? "")), fail("GENERATED_BODY_COMMENT"));
      index++;
    }
  }
}
function projectionStatements(projection) {
  assertGeneratedFraming(projection.sql);
  const statements = splitPublicStatements(projection.sql).map(describe);
  insist(projection.metadata.sqlSha256 === digest(projection.sql) && projection.metadata.ddlCount === statements.length, fail("PROJECTION_IDENTITY_INVALID"));
  const names = projection.metadata.tableNames, seen = new Set(), creates = new Set();
  for (const item of statements) {
    insist(names.includes(item.tableName), fail("UNKNOWN_TABLE_DDL"));
    const id = `${item.kind}:${item.tableName}:${item.indexName ?? ""}`;
    insist(!seen.has(id), fail("DUPLICATE_DDL")); seen.add(id);
    if (item.kind === "create-table") creates.add(item.tableName);
    for (const referenced of item.references) insist(names.includes(referenced), fail("CROSS_OR_UNKNOWN_REFERENCE"));
  }
  insist(same([...creates].sort(), names) && creates.size === projection.metadata.tableCount, fail("MISSING_TABLE_DDL"));
  return statements;
}
function validateDeltaIndexes(statements) {
  const found = new Map(), primaryKeys = new Set();
  function add(tableName, name, columns) {
    const expected = INDEXES[tableName];
    insist(expected && name === expected.name && same(columns, expected.columns) && !found.has(tableName), fail("DELTA_INDEX_CHANGED"));
    found.set(tableName, name);
  }
  for (const item of statements) {
    insist(item.references.length === 0, fail("DELTA_REFERENCE_CHANGED"));
    if (item.kind === "create-index") { insist(item.unique, fail("DELTA_INDEX_CHANGED")); add(item.tableName, item.indexName, item.indexColumns); continue; }
    for (let index = 4; index < item.items.length; index++) {
      const token = item.items[index];
      if (keyword(token, "CONSTRAINT")) {
        insist(identifier(item.items[index + 1]), fail("DELTA_INDEX_CHANGED"));
        if (keyword(item.items[index + 2], "UNIQUE")) add(item.tableName, item.items[index + 1].value, columnsAt(item.items, index + 3).columns);
        else {
          insist(keyword(item.items[index + 2], "PRIMARY") && keyword(item.items[index + 3], "KEY")
            && same(columnsAt(item.items, index + 4).columns, ["id"]) && !primaryKeys.has(item.tableName), fail("DELTA_INDEX_CHANGED"));
          primaryKeys.add(item.tableName);
        }
      } else if (keyword(token, "UNIQUE") || keyword(token, "PRIMARY")) {
        insist(keyword(item.items[index - 2], "CONSTRAINT"), fail("DELTA_INDEX_CHANGED"));
      } else if (keyword(token, "INDEX") || keyword(token, "FOREIGN")) insist(false, fail("DELTA_INDEX_CHANGED"));
      else if (keyword(token, "KEY")) insist(keyword(item.items[index - 1], "PRIMARY") && keyword(item.items[index - 3], "CONSTRAINT"), fail("DELTA_INDEX_CHANGED"));
    }
  }
  insist(found.size === ASSISTANT_PARTITION_TABLES.length && primaryKeys.size === ASSISTANT_PARTITION_TABLES.length, fail("DELTA_INDEX_MISSING"));
}

export function selectAssistantProjectionExports(inputs) {
  const selected = projectionTools.selectProjectionTables(inputs.exports, inputs.isTable, inputs.getTableName);
  insist(selected.tableNames.length === ASSISTANT_PROJECTION_PINS.baseTableCount + ASSISTANT_PARTITION_TABLES.length
    && ASSISTANT_PARTITION_TABLES.every(name => selected.tableNames.includes(name)), fail("TABLE_SET_CHANGED"));
  const isRuntimeTable = value => value && typeof value === "object" && Object.getPrototypeOf(value) !== null && inputs.isTable(value);
  const entries = Object.entries(inputs.exports);
  const baseExports = Object.fromEntries(entries.filter(([, value]) => !isRuntimeTable(value) || !ASSISTANT_PARTITION_TABLES.includes(inputs.getTableName(value))));
  const deltaExports = Object.fromEntries(entries.filter(([, value]) => isRuntimeTable(value)
    && [...ASSISTANT_PARTITION_TABLES, ...projectionTools.EXCLUDED_TABLES].includes(inputs.getTableName(value))));
  return { full: inputs.exports, base: baseExports, delta: deltaExports };
}

export function validateAssistantStatementPartition({ full, base, delta }) {
  insist(same(delta.metadata.tableNames, ASSISTANT_PARTITION_TABLES) && base.metadata.tableNames.every(name => !ASSISTANT_PARTITION_TABLES.includes(name)), fail("DELTA_TABLE_SET_CHANGED"));
  insist(same(full.metadata.tableNames, [...base.metadata.tableNames, ...delta.metadata.tableNames].sort()), fail("TABLE_PARTITION_CHANGED"));
  for (const projection of [full, base, delta]) insist(same(projection.metadata.excludedTables, projectionTools.EXCLUDED_TABLES), fail("EXCLUSIONS_CHANGED"));
  const vectors = { full: projectionStatements(full), base: projectionStatements(base), delta: projectionStatements(delta) };
  validateDeltaIndexes(vectors.delta);
  const baseFromFull = vectors.full.filter(item => !ASSISTANT_PARTITION_TABLES.includes(item.tableName));
  const deltaFromFull = vectors.full.filter(item => ASSISTANT_PARTITION_TABLES.includes(item.tableName));
  insist(vectors.full.length === vectors.base.length + vectors.delta.length
    && same(baseFromFull.map(item => item.sql), vectors.base.map(item => item.sql))
    && same(deltaFromFull.map(item => item.sql), vectors.delta.map(item => item.sql)), fail("STATEMENT_PARTITION_CHANGED"));
  for (const item of vectors.full) for (const referenced of item.references) insist(ASSISTANT_PARTITION_TABLES.includes(item.tableName) === ASSISTANT_PARTITION_TABLES.includes(referenced), fail("CROSS_OR_UNKNOWN_REFERENCE"));
  return vectors;
}

export async function buildAssistantProjectionPartition(inputs, { dedicatedSql, assistantSchema, indexSource }) {
  const sources = { dedicatedSql, assistantSchema, indexSource };
  insist(inputs && ["isTable", "getTableName", "generateSnapshot", "generateMigration", "assertUnchanged"].every(name => typeof inputs[name] === "function"), fail("INPUTS_INVALID"));
  inputs.assertUnchanged();
  const sourceFiles = structuredClone(inputs.sourceFiles), identity = validateAssistantProjectionSources(sourceFiles, sources);
  const exports = selectAssistantProjectionExports(inputs);
  const dedicated = splitPublicStatements(dedicatedSql).map(describe);
  insist(dedicated.length === 2 && dedicated.every(item => item.kind === "create-table" && item.references.length === 0)
    && same(dedicated.map(item => item.tableName).sort(), ASSISTANT_PARTITION_TABLES), fail("DEDICATED_SCOPE_CHANGED"));
  const full = await projectionTools.buildProjection({ ...inputs, sourceFiles });
  const base = await projectionTools.buildProjection({ ...inputs, exports: exports.base, sourceFiles });
  const delta = await projectionTools.buildProjection({ ...inputs, exports: exports.delta, sourceFiles });
  insist(base.metadata.tableCount === ASSISTANT_PROJECTION_PINS.baseTableCount && base.metadata.ddlCount === ASSISTANT_PROJECTION_PINS.baseDdlCount
    && digest(base.sql) === ASSISTANT_PROJECTION_PINS.baseSqlSha256, fail("BASE_BYTES_CHANGED"));
  const vectors = validateAssistantStatementPartition({ full, base, delta });
  inputs.assertUnchanged();
  insist(same(inputs.sourceFiles, sourceFiles), fail("SOURCE_CHANGED_DURING_BUILD"));
  validateAssistantProjectionSources(sourceFiles, sources);
  const projections = { full, base, delta };
  for (const [member, projection] of Object.entries(projections)) projection.metadata.partition = {
    version: PARTITION_VERSION, member, actualSourceGraph: true, dedicatedTables: ASSISTANT_PARTITION_TABLES,
    selection: member === "full" ? "All current exported tables, retaining the existing five physical exclusions."
      : member === "base" ? "Remove only the two pinned assistant physical tables from current exports."
        : "Select only the two pinned assistant physical tables; retain the five excluded definitions for the unchanged selector audit.",
    selectedPhysicalTables: projection.metadata.tableNames,
    removedDedicatedTables: member === "base" ? ASSISTANT_PARTITION_TABLES : [],
    approvedForExecution: false,
  };
  const receipt = {
    version: PARTITION_VERSION, mode: "offline-assistant-projection-partition-candidate", status: "pending-native",
    approvedForExecution: false, databaseConnected: false, sqlExecuted: false, DBExecutions: 0,
    dedicatedMigration: ASSISTANT_PROJECTION_PINS.dedicatedSql,
    assistantSchema: ASSISTANT_PROJECTION_PINS.assistantSchema, indexSource: ASSISTANT_PROJECTION_PINS.indexSource,
    dedicatedTables: ASSISTANT_PARTITION_TABLES, unchangedExistingExclusions: projectionTools.EXCLUDED_TABLES,
    actualSourceFiles: sourceFiles, actualSourceSha256: identity.actualSourceSha256,
    historicalSourceAncestry: {
      historicalSourceSha256: identity.historicalSourceSha256, actualCurrentMetadataUsesHistoricalVector: false,
      proof: "Only remove the pinned assistant schema and substitute the pinned historical index digest in the current source vector.",
      removedSource: ASSISTANT_PROJECTION_PINS.assistantSchema.path, substitutedIndexSha256: ASSISTANT_PROJECTION_PINS.historicalIndexSha256,
    },
    baseWholeSqlIdentity: { sha256: digest(base.sql), historicalSha256: ASSISTANT_PROJECTION_PINS.baseSqlSha256, exactBytes: true },
    projections: Object.fromEntries(Object.entries(projections).map(([member, projection]) => [member, {
      sqlSha256: digest(projection.sql), sourceSha256: projection.metadata.sourceSha256,
      metadataSha256: digest(`${JSON.stringify(projection.metadata, null, 2)}\n`), tableCount: projection.metadata.tableCount,
      ddlCount: projection.metadata.ddlCount, tableNames: projection.metadata.tableNames,
    }])),
    statementPartition: vectors.full.map(item => ({ sourceIndex: item.sourceIndex, partition: ASSISTANT_PARTITION_TABLES.includes(item.tableName) ? "delta" : "base", kind: item.kind, tableName: item.tableName, indexName: item.indexName, sha256: item.sha256 })),
    statementComparison: {
      scope: "Exact CREATE statement internal bytes after the fixed two-line generated header; only outer statement whitespace and semicolon framing are removed.",
      bodyCommentsOutsideQuotedLiteralsOrIdentifiers: "rejected", semanticNormalization: false,
    },
    relativeStatementOrderPreserved: true, fullEqualsBasePlusDelta: true,
    expectedReleaseOrder: [
      { phase: "existing-base-bootstrap", physicalTableCount: 303, contractModified: false },
      { phase: "separate-dedicated-0230", migration: ASSISTANT_PROJECTION_PINS.dedicatedSql, tables: ASSISTANT_PARTITION_TABLES },
    ],
    executionBoundary: "Evidence only: preserve the 303-table bootstrap contract, then separately review 0230. No contract, manifest, historical inventory or native admission is updated.",
  };
  return { ...projections, receipt };
}

function readPinnedSource(root, pin) {
  const filename = join(root, pin.path);
  insist(realpathSync(filename) === filename, fail("SOURCE_PATH_INVALID"));
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd); insist(stat.isFile() && stat.size > 0 && stat.size < 1024 * 1024, fail("SOURCE_PATH_INVALID"));
    const source = readFileSync(fd, "utf8"); insist(digest(source) === pin.sha256, fail("SOURCE_PIN_CHANGED")); return source;
  } finally { closeSync(fd); }
}

export async function exportAssistantProjectionPartition({ repoRoot, outputDirectory }) {
  const root = realpathSync(repoRoot), ownRoot = realpathSync(new URL("../../", import.meta.url));
  insist(root === ownRoot, "REPO_MUST_MATCH_TOOL_CHECKOUT");
  const target = resolve(outputDirectory), outputRelative = relative(root, target);
  insist(outputRelative && (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)), "OUTPUT_MUST_BE_OUTSIDE_CHECKOUT");
  insist(realpathSync(dirname(target)) === dirname(target), "OUTPUT_PARENT_SYMLINK");
  insist(typeof projectionTools.loadReviewedProjectionInputs === "function", fail("REVIEWED_LOADER_UNAVAILABLE"));
  const inputs = await projectionTools.loadReviewedProjectionInputs(root);
  const sources = Object.fromEntries(["dedicatedSql", "assistantSchema", "indexSource"].map(name => [name, readPinnedSource(root, ASSISTANT_PROJECTION_PINS[name])]));
  const result = await buildAssistantProjectionPartition(inputs, sources);
  inputs.assertUnchanged();
  for (const name of ["dedicatedSql", "assistantSchema", "indexSource"]) readPinnedSource(root, ASSISTANT_PROJECTION_PINS[name]);
  mkdirSync(target, { mode: 0o700 });
  for (const member of ["full", "base", "delta"]) projectionTools.writeProjection(join(target, member), result[member]);
  const receipt = `${JSON.stringify(result.receipt, null, 2)}\n`;
  writeFileSync(join(target, "partition-receipt.json"), receipt, { flag: "wx", mode: 0o600 });
  return { outputDirectory: target, receiptSha256: digest(receipt), approvedForExecution: false, databaseConnected: false, DBExecutions: 0, status: "pending-native",
    projections: Object.fromEntries(Object.entries(result.receipt.projections).map(([member, projection]) => [member, {
      sqlSha256: projection.sqlSha256, sourceSha256: projection.sourceSha256, metadataSha256: projection.metadataSha256,
      tableCount: projection.tableCount, ddlCount: projection.ddlCount,
    }])) };
}

export async function main(args) {
  try {
    const options = projectionTools.parseArguments(args);
    if (options.help) return { exitCode: 0, output: { usage: "node scripts/integration/assistantProjectionPartition.mjs --repo-root <this checkout> --out-dir <new directory outside checkout>", approvedForExecution: false, databaseConnected: false, DBExecutions: 0 } };
    const result = await exportAssistantProjectionPartition(options);
    return { exitCode: 0, output: { ok: true, ...result } };
  } catch (error) {
    return { exitCode: 1, output: { ok: false, approvedForExecution: false, databaseConnected: false, DBExecutions: 0,
      error: /^(?:ASSISTANT_PARTITION_|CLI_ARGUMENTS_INVALID$|REPO_MUST_MATCH_TOOL_CHECKOUT$|OUTPUT_MUST_BE_OUTSIDE_CHECKOUT$|OUTPUT_PARENT_SYMLINK$|EEXIST$)/.test(error?.code ?? "") ? error.code : "ASSISTANT_PARTITION_EXPORT_FAILED" } };
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`); process.exitCode = result.exitCode;
}
