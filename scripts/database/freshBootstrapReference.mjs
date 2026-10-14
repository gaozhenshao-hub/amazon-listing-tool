// Independently materialize PUBLIC source definitions, never the candidate
// bootstrap plan or a production export. Contract output remains UNAPPROVED.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { REPOSITORY_ROOT, loadFreshBootstrapPlan, readPublicFile, buildStructureContract, readFreshCatalog,
  validateCatalog, sha256, fingerprint, insist } from "./freshBootstrapPlan.mjs";
import { normalizeCreateStatement, EXCLUDED_TABLES, PROJECTION_VERSION } from "../integration/sourceProjection.mjs";
import { validateReplayDdl } from "../integration/productionStructureRehearsal.mjs";
import { createHistoricalPlatformProfile, validateLinuxPluginRows } from "../integration/historicalPlatformProfile.mjs";
import { connectionOptions, schemaNames, validateOutput, safeError, sqlOperationText } from "../integration/mysqlRehearsal.mjs";
import { deriveHistoricalColumnOrder } from "./freshBootstrapColumnOrder.mjs";

export const REFERENCE_VERSION = "amazon-fresh-public-reference/1";
export const SOURCE_MANIFEST_PATH = "scripts/database/freshBootstrapReference.sources.json";
export const INDEX_MANIFEST_PATH = "scripts/database/freshBootstrapHistoricalIndexes.sources.json";
export const INDEX_MANIFEST_SHA256 = "3a0debfa05e99fb4b0b21bb2ae1cbda2d8616324186b5d5e3e752ea5570d5e84";
const INDEX_JSON_SHA256 = "5b0b0fdb86b8a1879381a7d91af91faee774cf54b340002a37d2c3f95c8c4f9a";
export const SOURCE_MANIFEST_SHA256 = "d916af921bcb9ea797f88d32f077bdddd3e78f5a4053f9a65f2c3c02979d43c7";
const CONFIG_JSON_SHA256 = "4697f7e0e0826bc6acb647db0a161feb7a5885eb18bbeb94927e02f55e4213b5";
const schemaPattern = /^amazon_rehearsal_[a-f0-9]{16}_synthetic$/;
const identifier = "[A-Za-z_][A-Za-z0-9_]*";
const quotedIdentifier = `(?:\`(${identifier})\`|(${identifier}))`;
const createPattern = new RegExp(`^CREATE TABLE(?: IF NOT EXISTS)?\\s+${quotedIdentifier}\\s*\\(`, "i");
const indexPattern = new RegExp(`^CREATE(?: UNIQUE)? INDEX\\s+${quotedIdentifier}\\s+ON\\s+${quotedIdentifier}\\s*\\(`, "i");

// Split only at depth zero, preserving quoted commas and prefix lengths. Used
// for source index comparison, never to run arbitrary SQL or normalize it away.
export function splitDefinitionList(text) {
  const parts = []; let start = 0, depth = 0, quote = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote && text[index + 1] === quote) index++;
      else if (char === quote) quote = null;
    } else if (["'", '"', "`"].includes(char)) quote = char;
    else if (char === "(") depth++;
    else if (char === ")") { depth--; insist(depth >= 0, "REFERENCE_DEFINITION_UNBALANCED"); }
    else if (char === "," && depth === 0) { parts.push(text.slice(start, index).trim()); start = index + 1; }
  }
  insist(depth === 0 && quote === null, "REFERENCE_DEFINITION_UNBALANCED");
  parts.push(text.slice(start).trim()); insist(parts.every(Boolean), "REFERENCE_DEFINITION_EMPTY"); return parts;
}

function createParts(sql) {
  const open = sql.indexOf("("); insist(open > 0, "REFERENCE_CREATE_FRAMING_INVALID");
  let quote = null, depth = 1, end = open + 1;
  for (; end < sql.length; end++) {
    const char = sql[end];
    if (quote) { if (char === "\\") end++; else if (char === quote && sql[end + 1] === quote) end++; else if (char === quote) quote = null; }
    else if (["'", '"', "`"].includes(char)) quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) break;
  }
  insist(depth === 0 && quote === null, "REFERENCE_CREATE_FRAMING_INVALID");
  return { prefix: sql.slice(0, open + 1), definitions: splitDefinitionList(sql.slice(open + 1, end)), suffix: sql.slice(end) };
}

export function parseIndexColumns(text) {
  return splitDefinitionList(text).map(part => {
    const match = new RegExp(`^${quotedIdentifier}(?:\\(([1-9][0-9]*)\\))?(?:\\s+(ASC|DESC))?$`, "i").exec(part);
    insist(match, "REFERENCE_INDEX_EXPRESSION_UNREVIEWED");
    return { name: match[1] ?? match[2], prefixLength: match[3] === undefined ? null : Number(match[3]), direction: match[4]?.toUpperCase() === "DESC" ? "D" : "A" };
  });
}

function inlineIndex(definition, table) {
  let match = new RegExp(`^CONSTRAINT\\s+${quotedIdentifier}\\s+UNIQUE\\s*\\(([\\s\\S]+)\\)$`, "i").exec(definition);
  if (match) return { table, name: match[1] ?? match[2], unique: true, columns: parseIndexColumns(match[3]) };
  match = new RegExp(`^(UNIQUE\\s+)?(?:KEY|INDEX)\\s+${quotedIdentifier}\\s*\\(([\\s\\S]+)\\)$`, "i").exec(definition);
  if (match) return { table, name: match[2] ?? match[3], unique: Boolean(match[1]), columns: parseIndexColumns(match[4]) };
  insist(!/^(?:UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL)\b/i.test(definition)
    && !/^CONSTRAINT\s+\S+\s+UNIQUE\b/i.test(definition), "REFERENCE_INDEX_DECLARATION_UNREVIEWED");
  return null;
}

export function referenceIndexDefinitions(statements) {
  const result = [], seen = new Set();
  for (const item of statements) {
    const definitions = [];
    if (item.kind === "create-table") definitions.push(...createParts(item.sql).definitions.map(definition => inlineIndex(definition, item.tableName)).filter(Boolean));
    else if (item.kind === "create-index") {
      const match = new RegExp(`^CREATE( UNIQUE)? INDEX\\s+${quotedIdentifier}\\s+ON\\s+${quotedIdentifier}\\s*\\(([\\s\\S]+)\\)$`, "i").exec(item.sql);
      insist(match, "REFERENCE_INDEX_DECLARATION_UNREVIEWED");
      definitions.push({ table: match[4] ?? match[5], name: match[2] ?? match[3], unique: Boolean(match[1]), columns: parseIndexColumns(match[6]) });
    }
    for (const definition of definitions) {
      const key = `${definition.table}.${definition.name}`; insist(!seen.has(key), "REFERENCE_INDEX_DUPLICATE"); seen.add(key); result.push(definition);
    }
  }
  return result.sort((a, b) => `${a.table}.${a.name}`.localeCompare(`${b.table}.${b.name}`));
}

export function referencePrimaryKeys(statements) {
  const result = [];
  for (const item of statements.filter(value => value.kind === "create-table")) {
    const definitions = createParts(item.sql).definitions, keys = [];
    for (const definition of definitions) {
      const match = /^(?:CONSTRAINT\s+`?[A-Za-z_][A-Za-z0-9_]*`?\s+)?PRIMARY KEY\s*\(([\s\S]+)\)$/i.exec(definition);
      if (match) keys.push(parseIndexColumns(match[1]));
      else if (/\bPRIMARY KEY\b/i.test(definition)) {
        const column = new RegExp(`^${quotedIdentifier}\\s+`).exec(definition);
        insist(column, "REFERENCE_PRIMARY_DECLARATION_UNREVIEWED"); keys.push([{ name: column[1] ?? column[2], prefixLength: null, direction: "A" }]);
      }
    }
    insist(keys.length === 1, "REFERENCE_PRIMARY_KEY_MISSING_OR_DUPLICATE");
    result.push({ table: item.tableName, name: "PRIMARY", unique: true, columns: keys[0] });
  }
  return result.sort((a, b) => a.table.localeCompare(b.table));
}

const indexIdentity = item => ({ table: item.table, name: item.name, unique: item.unique, columns: item.columns });
const indexSemantics = item => ({ table: item.table, unique: item.unique, columns: item.columns });

export function applyHistoricalIndexInventory({ inventory, bundle, projectionSql, statements, tableSources }) {
  insist(sha256(JSON.stringify(inventory)) === INDEX_JSON_SHA256 && inventory?.version === "amazon-fresh-public-index-inventory/1" && inventory.databaseConnected === false
    && inventory.candidateDatabaseUsed === false && inventory.productionDdlUsed === false
    && inventory.bootstrapPlanSha256 === bundle.planSha256 && inventory.bootstrapSourcesSha256 === bundle.sourcesSha256
    && inventory.projection.sqlSha256 === sha256(projectionSql) && inventory.coverage.unhandledIndexDdl === 0,
  "REFERENCE_INDEX_INVENTORY_IDENTITY_CHANGED");
  insist(inventory.activeIndexes.length === 601 && inventory.primaryKeys.length === 302
    && inventory.comparison.projectionOnly.length === 43 && inventory.comparison.sameNameMismatch.length === 0
    && inventory.comparison.primaryKeys.sameNameMismatch.length === 0 && inventory.comparison.primaryKeys.projectionOnly.length === 0,
  "REFERENCE_INDEX_INVENTORY_UNREVIEWED");
  const pins = new Map(bundle.manifest.sources.map(item => [item.path, item.sha256]));
  insist(isDeepStrictEqual(inventory.inputs, bundle.plan.map(item => ({ path: `drizzle/${item.fileName}`, sha256: item.checksum }))), "REFERENCE_INDEX_INPUT_SET_CHANGED");
  const texts = new Map(bundle.plan.map(item => [`drizzle/${item.fileName}`, item.sql])); texts.set("source-projection.sql", projectionSql);
  const statementCache = new Map();
  const verifyStatement = source => {
    const text = texts.get(source.path);
    insist(typeof text === "string" && sha256(text) === source.sha256
      && (source.path === "source-projection.sql" || pins.get(source.path) === source.sha256), "REFERENCE_INDEX_SOURCE_CHANGED");
    if (!statementCache.has(source.path)) statementCache.set(source.path, splitPublicStatements(text));
    const raw = statementCache.get(source.path)[source.statementIndex];
    insist(typeof raw === "string" && sha256(raw) === source.statementSha256, "REFERENCE_INDEX_STATEMENT_CHANGED");
    const sql = raw.replaceAll("--> statement-breakpoint", "").trim();
    insist(sha256(sql) === source.executableStatementSha256, "REFERENCE_INDEX_EXECUTABLE_CHANGED"); return sql;
  };
  const verifyDeclaration = item => {
    const sql = verifyStatement(item.source);
    insist(typeof item.declarationSql === "string" && sha256(item.declarationSql) === item.declarationSha256
      && sql.includes(item.declarationSql), "REFERENCE_INDEX_DECLARATION_CHANGED");
    let original;
    if (item.declaration === "create-index") original = referenceIndexDefinitions([describeReferenceStatement(item.declarationSql)])[0];
    else if (item.name === "PRIMARY") original = referencePrimaryKeys([{ kind: "create-table", tableName: item.table,
      sql: `CREATE TABLE \`${item.table}\` (${item.declarationSql})` }])[0];
    else if (item.declaration === "inline-column") {
      const match = new RegExp(`^${quotedIdentifier}\\s+[\\s\\S]+\\bUNIQUE$`, "i").exec(item.declarationSql);
      insist(match, "REFERENCE_INDEX_DECLARATION_UNREVIEWED");
      const name = match[1] ?? match[2]; original = { table: item.table, name, unique: true, columns: [{ name, prefixLength: null, direction: "A" }] };
    } else {
      insist(["inline-key", "alter-add-index"].includes(item.declaration), "REFERENCE_INDEX_DECLARATION_UNREVIEWED");
      original = inlineIndex(item.declarationSql, item.table);
    }
    insist(original, "REFERENCE_INDEX_DECLARATION_UNREVIEWED");
    for (const rename of item.columnRenames ?? []) {
      const renamedSql = verifyStatement(rename.source);
      insist(new RegExp(`^ALTER TABLE\\s+\`?${item.table}\`?\\s+`, "i").test(renamedSql)
        && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rename.from) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rename.to)
        && new RegExp(`\\bCHANGE(?: COLUMN)?\\s+\`?${rename.from}\`?\\s+\`?${rename.to}\`?\\s+`, "i").test(renamedSql)
        && original.columns.some(column => column.name === rename.from), "REFERENCE_INDEX_RENAME_SOURCE_CHANGED");
      original = { ...original, columns: original.columns.map(column => column.name === rename.from ? { ...column, name: rename.to } : column) };
    }
    insist(isDeepStrictEqual(original, indexIdentity(item)), "REFERENCE_INDEX_DECLARATION_SEMANTICS_CHANGED");
    if (item.name === "PRIMARY") return;
    insist(item.indexType === "BTREE", "REFERENCE_INDEX_TYPE_UNREVIEWED");
    const parsed = referenceIndexDefinitions([describeReferenceStatement(item.createSql)]);
    insist(parsed.length === 1 && isDeepStrictEqual(parsed[0], indexIdentity(item)), "REFERENCE_INDEX_CANONICAL_SQL_CHANGED");
  };
  for (const item of [...inventory.activeIndexes, ...inventory.primaryKeys]) verifyDeclaration(item);
  for (const exclusion of inventory.exclusions) { verifyStatement(exclusion.source); verifyDeclaration(exclusion.removed); }
  const historical = new Map(inventory.activeIndexes.map(item => [`${item.table}.${item.name}`, item]));
  insist(historical.size === 601, "REFERENCE_INDEX_DUPLICATE");
  const aliases = new Map();
  for (const alias of inventory.comparison.projectionOnly) {
    const item = alias.index; verifyDeclaration(item);
    insist(alias.equivalentHistoricalNames.length > 0 && alias.equivalentHistoricalNames.length === alias.equivalentHistoricalDefinitions.length,
      "REFERENCE_INDEX_ALIAS_UNREVIEWED");
    for (const name of alias.equivalentHistoricalNames) {
      const target = historical.get(`${item.table}.${name}`);
      insist(target && isDeepStrictEqual(indexSemantics(item), indexSemantics(target)), "REFERENCE_INDEX_ALIAS_SEMANTICS_CHANGED");
      const evidence = alias.equivalentHistoricalDefinitions.find(value => value.name === name);
      insist(evidence && isDeepStrictEqual(evidence.source, target.source) && evidence.declarationSha256 === target.declarationSha256
        && evidence.createSql === target.createSql, "REFERENCE_INDEX_ALIAS_SOURCE_CHANGED");
    }
    const key = `${item.table}.${item.name}`; insist(!aliases.has(key) && !historical.has(key), "REFERENCE_INDEX_ALIAS_DUPLICATE"); aliases.set(key, item);
  }
  const rewritten = [];
  for (const item of statements) {
    if (item.kind === "create-index" && aliases.has(`${item.tableName}.${item.indexName}`)) {
      insist(isDeepStrictEqual(referenceIndexDefinitions([item])[0], indexIdentity(aliases.get(`${item.tableName}.${item.indexName}`))), "REFERENCE_INDEX_ALIAS_SEMANTICS_CHANGED");
      continue;
    }
    if (item.kind !== "create-table") { rewritten.push(item); continue; }
    const parts = createParts(item.sql), retained = parts.definitions.filter(definition => {
      const index = inlineIndex(definition, item.tableName), alias = index && aliases.get(`${index.table}.${index.name}`);
      if (!alias) return true;
      insist(isDeepStrictEqual(index, indexIdentity(alias)), "REFERENCE_INDEX_ALIAS_SEMANTICS_CHANGED"); return false;
    });
    if (retained.length === parts.definitions.length) rewritten.push(item);
    else {
      const sql = `${parts.prefix}\n${retained.map(value => `  ${value}`).join(",\n")}\n${parts.suffix}`;
      rewritten.push({ ...item, sql, sha256: sha256(sql) });
    }
  }
  const current = new Map(referenceIndexDefinitions(rewritten).map(item => [`${item.table}.${item.name}`, item]));
  for (const item of inventory.activeIndexes) {
    const key = `${item.table}.${item.name}`, existing = current.get(key), source = { path: item.source.path, sha256: item.source.sha256 };
    if (existing) insist(isDeepStrictEqual(existing, indexIdentity(item)), "REFERENCE_INDEX_SAME_NAME_CONFLICT");
    else rewritten.push({ ...describeReferenceStatement(item.createSql), sources: [source] });
    const sources = tableSources.get(item.table); insist(sources, "REFERENCE_INDEX_TABLE_MISSING");
    if (!sources.some(value => value.path === source.path)) sources.push(source);
  }
  const expected = referenceIndexDefinitions(rewritten);
  for (const item of expected) insist(item.table === "app_schema_migrations" || historical.has(`${item.table}.${item.name}`), "REFERENCE_INDEX_PROJECTION_EXTRA_UNREVIEWED");
  insist(expected.length === 602, "REFERENCE_INDEX_COMPLETE_SET_CHANGED");
  const primary = referencePrimaryKeys(rewritten);
  for (const item of primary) {
    if (item.table === "app_schema_migrations") continue;
    const historicalPrimary = inventory.primaryKeys.find(value => value.table === item.table);
    insist(historicalPrimary && isDeepStrictEqual(item, indexIdentity(historicalPrimary)), "REFERENCE_PRIMARY_SEMANTICS_CHANGED");
  }
  insist(primary.length === 303, "REFERENCE_PRIMARY_COMPLETE_SET_CHANGED");
  return { statements: rewritten, expectedIndexes: [...expected, ...primary], aliases: inventory.comparison.projectionOnly.map(item => ({
    table: item.index.table, projectionName: item.index.name, historicalNames: item.equivalentHistoricalNames,
    projectionSource: item.index.source, historicalSources: item.equivalentHistoricalDefinitions.map(value => value.source) })) };
}

// Trusted, hash-pinned public sources still receive lexical whole-statement
// checks. Literals may contain semicolons; executable comments are never allowed.
export function splitPublicStatements(source) {
  insist(typeof source === "string" && Buffer.byteLength(source) <= 8 * 1024 * 1024 && !source.includes("\0"), "REFERENCE_SQL_INPUT_INVALID");
  const result = []; let current = "";
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (["'", '"', "`"].includes(char)) {
      current += char; index++; let closed = false;
      while (index < source.length) {
        const next = source[index++]; current += next;
        if (next === "\\") { insist(index < source.length, "REFERENCE_SQL_QUOTE_INVALID"); current += source[index++]; }
        else if (next === char && source[index] === char) current += source[index++];
        else if (next === char) { closed = true; break; }
      }
      insist(closed, "REFERENCE_SQL_QUOTE_INVALID"); continue;
    }
    if (source.startsWith("/*", index)) {
      insist(!["!", "+"].includes(source[index + 2]), "REFERENCE_EXECUTABLE_COMMENT_FORBIDDEN");
      const end = source.indexOf("*/", index + 2); insist(end >= 0, "REFERENCE_SQL_COMMENT_INVALID");
      current += " "; index = end + 2; continue;
    }
    if (char === "#" || source.startsWith("--", index) && /\s|^$/.test(source[index + 2] ?? "")) {
      const end = source.indexOf("\n", index); current += "\n"; index = end < 0 ? source.length : end + 1; continue;
    }
    if (char === ";") { if (current.trim()) result.push(current.trim()); current = ""; index++; continue; }
    current += char; index++;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

export function describeReferenceStatement(sql) {
  const parts = splitPublicStatements(sql); insist(parts.length === 1, "REFERENCE_SINGLE_STATEMENT_REQUIRED");
  const statement = parts[0], create = createPattern.exec(statement), index = indexPattern.exec(statement);
  if (create) {
    const tableName = create[1] ?? create[2];
    const normalized = statement.replace(createPattern, `CREATE TABLE \`${tableName}\` (`);
    validateReplayDdl(normalized, tableName);
    return { kind: "create-table", tableName, sql: normalized, sha256: sha256(normalized) };
  }
  if (index) {
    const normalized = normalizeCreateStatement(statement).replace(/;$/, ""), tableName = index[3] ?? index[4];
    return { kind: "create-index", tableName, indexName: index[1] ?? index[2], sql: normalized, sha256: sha256(normalized) };
  }
  insist(false, "REFERENCE_NON_CREATE_SQL_FORBIDDEN");
}

function columnNames(sql) {
  // This narrow framing is independently hash-pinned. Every source/projection
  // column occupies a physical line; constraints do not start with a type.
  const columns = [...sql.matchAll(/^\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s+(?:tinyint|smallint|int|bigint|varchar|char|text|longtext|mediumtext|json|enum|decimal|float|double|date|datetime|timestamp|boolean)\b/gmi)]
    .map(match => match[1]);
  insist(columns.length > 0 && new Set(columns).size === columns.length, "REFERENCE_COLUMN_FRAMING_INVALID");
  return columns;
}

function createFromSource(source, tableName) {
  const matches = splitPublicStatements(source).filter(sql => {
    const match = createPattern.exec(sql); return match && (match[1] ?? match[2]) === tableName;
  });
  insist(matches.length === 1, "REFERENCE_CREATE_SOURCE_MISSING_OR_DUPLICATE");
  return describeReferenceStatement(matches[0]);
}

export function extractLedgerCreate(source) {
  const matches = [...source.matchAll(/export async function ensureLedger\(connection\)\s*\{\s*await connection\.query\(`([^`]+)`\);\s*\}/g)];
  insist(matches.length === 1 && !matches[0][1].includes("${"), "REFERENCE_LEDGER_SOURCE_UNREVIEWED");
  const create = describeReferenceStatement(matches[0][1]);
  insist(create.kind === "create-table" && create.tableName === "app_schema_migrations", "REFERENCE_LEDGER_TARGET_INVALID");
  return create;
}

export function deriveCommentOverlay({ sql, table, columns, projectedCreate }) {
  const parts = splitPublicStatements(sql);
  insist(parts.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(table), "REFERENCE_COMMENT_SOURCE_INVALID");
  const match = new RegExp(`^ALTER TABLE ${table}\\s+([\\s\\S]+)$`).exec(parts[0]);
  insist(match, "REFERENCE_COMMENT_SOURCE_INVALID");
  const pattern = /ADD COLUMN ([A-Za-z_][A-Za-z0-9_]*) (LONGTEXT|VARCHAR\([0-9]+\)) NULL COMMENT '([^'\\]*)'/g;
  const definitions = [...match[1].matchAll(pattern)];
  insist(isDeepStrictEqual(definitions.map(item => item[1]), columns)
    && match[1].replace(pattern, "").replace(/[\s,]/g, "") === "", "REFERENCE_COMMENT_SOURCE_INVALID");
  for (const [, name, type] of definitions) {
    const projected = new RegExp(`^\\s*\`${name}\` ([^\\n,]+),?$`, "m").exec(projectedCreate);
    insist(projected && projected[1].toLowerCase() === type.toLowerCase(), "REFERENCE_COMMENT_COLUMN_TYPE_CHANGED");
  }
  const derived = `ALTER TABLE \`${table}\`\n  ${definitions.map(item => item[0].replace(/^ADD COLUMN /, "MODIFY COLUMN ")).join(",\n  ")}`;
  return { kind: "preserve-column-comments", tableName: table, sql: derived, sha256: sha256(derived),
    comments: definitions.map(([, name, type, comment]) => ({ tableName: table, columnName: name, columnType: type.toLowerCase(), comment })) };
}

export function deriveColumnAddition(sql, table, columns) {
  const parts = splitPublicStatements(sql);
  insist(parts.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(table), "REFERENCE_COLUMN_ADDITION_INVALID");
  const match = new RegExp(`^ALTER TABLE \`${table}\`\\s+ADD COLUMN \`(${identifier})\` varchar\\([0-9]+\\) NULL AFTER \`(${identifier})\`$`, "i").exec(parts[0]);
  insist(match && !columns.includes(match[1]) && columns.includes(match[2]), "REFERENCE_COLUMN_ADDITION_INVALID");
  const next = [...columns]; next.splice(next.indexOf(match[2]) + 1, 0, match[1]);
  return { statement: { kind: "add-reviewed-column", tableName: table, sql: parts[0], sha256: sha256(parts[0]) }, columns: next };
}

// Diagnostic draft only. A draft cannot produce a contract or reach execution;
// assembleReferencePlan must also prove exact source column sets and ordinals.
export function assembleReferenceDraft({ bundle, config, projectionSql, projectionMetadata, sourceTexts, indexInventory }) {
  insist(sha256(JSON.stringify(config)) === CONFIG_JSON_SHA256 && config.version === REFERENCE_VERSION, "REFERENCE_CONFIGURATION_CHANGED");
  const pins = new Map(bundle.manifest.sources.map(item => [item.path, item.sha256]));
  const verifySource = item => {
    insist(typeof sourceTexts[item.path] === "string" && sha256(sourceTexts[item.path]) === item.sha256
      && pins.get(item.path) === item.sha256, "REFERENCE_PUBLIC_SOURCE_CHANGED_OR_MISSING");
  };
  config.sources.forEach(verifySource);
  const metadata = projectionMetadata;
  insist(metadata?.version === PROJECTION_VERSION && metadata.mode === "source-derived-projection" && metadata.productionClone === false
    && metadata.databaseConnected === false && metadata.sqlExecuted === false && metadata.migrationLedgerWritten === false
    && metadata.tableCount === config.projection.tableCount && metadata.ddlCount === config.projection.ddlCount
    && isDeepStrictEqual(metadata.excludedTables, EXCLUDED_TABLES) && metadata.schemaEntry === "drizzle/schema/index.ts"
    && metadata.sqlSha256 === config.projection.sqlSha256 && sha256(projectionSql) === config.projection.sqlSha256
    && metadata.sourceSha256 === config.projection.sourceSha256 && sha256(JSON.stringify(metadata.sourceFiles)) === metadata.sourceSha256,
  "REFERENCE_PROJECTION_IDENTITY_CHANGED");
  metadata.sourceFiles.forEach(verifySource);
  const projection = splitPublicStatements(projectionSql).map(describeReferenceStatement);
  insist(projection.length === config.projection.ddlCount, "REFERENCE_PROJECTION_DDL_COUNT_CHANGED");
  const projectedCreates = new Map(projection.filter(item => item.kind === "create-table").map(item => [item.tableName, item]));
  insist(projectedCreates.size === config.projection.tableCount
    && isDeepStrictEqual([...projectedCreates.keys()].sort(), metadata.tableNames), "REFERENCE_PROJECTION_TABLES_CHANGED");
  const projectedSources = new Map();
  for (const item of metadata.sourceFiles) for (const match of sourceTexts[item.path].matchAll(/\bmysqlTable\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) {
    if (!projectedCreates.has(match[1])) continue;
    insist(!projectedSources.has(match[1]), "REFERENCE_TABLE_SOURCE_AMBIGUOUS"); projectedSources.set(match[1], item);
  }
  insist(projectedSources.size === projectedCreates.size, "REFERENCE_TABLE_SOURCE_INCOMPLETE");
  const scheduled = config.scheduledTaskReplacement, replaced = new Set([...config.replacements.map(item => item.table), scheduled.table]);
  insist([...replaced].every(name => projectedCreates.has(name)), "REFERENCE_REPLACEMENT_SOURCE_MISSING");
  const discarded = projection.filter(item => replaced.has(item.tableName));
  let statements = projection.filter(item => !replaced.has(item.tableName) && item.kind === "create-table")
    .map(item => ({ ...item, sources: [projectedSources.get(item.tableName)] }));
  const indexes = projection.filter(item => !replaced.has(item.tableName) && item.kind === "create-index")
    .map(item => ({ ...item, sources: [projectedSources.get(item.tableName)] }));
  const tableSources = new Map([...projectedSources].map(([name, item]) => [name, [item]]));
  const sourcePin = filename => {
    const item = config.sources.find(value => value.path === filename); insist(item, "REFERENCE_SOURCE_NOT_IN_MANIFEST"); return item;
  };
  for (const group of config.rawTableSources) {
    const raw = splitPublicStatements(sourceTexts[group.path]).map(describeReferenceStatement);
    insist(raw.every(item => item.kind === "create-table") && isDeepStrictEqual(raw.map(item => item.tableName).sort(), group.tables), "REFERENCE_RAW_TABLE_SET_CHANGED");
    for (const item of raw) {
      insist(!tableSources.has(item.tableName), "REFERENCE_RAW_TABLE_OVERLAP");
      const sources = [sourcePin(group.path)]; statements.push({ ...item, sources }); tableSources.set(item.tableName, sources);
    }
  }
  const scheduledCreate = createFromSource(sourceTexts[scheduled.createSource], scheduled.table);
  const scheduledSql = splitPublicStatements(sourceTexts[scheduled.ddlSource]), additions = scheduled.ddlStatementIndices.map(index => scheduledSql[index]);
  insist(additions.length === 3 && /^ALTER TABLE emperor_scheduled_tasks\s+ADD COLUMN\b/.test(additions[0])
    && !/\b(?:DROP|MODIFY|CHANGE|RENAME|UPDATE|INSERT|DELETE|SELECT|REFERENCES)\b/i.test(sqlOperationText(additions[0])), "REFERENCE_SCHEDULED_DDL_UNREVIEWED");
  const addColumns = [...additions[0].matchAll(/\bADD COLUMN ([A-Za-z_][A-Za-z0-9_]*)\s/gi)].map(match => match[1]);
  insist(addColumns.length === 8 && isDeepStrictEqual([...columnNames(scheduledCreate.sql), ...addColumns].sort(), columnNames(projectedCreates.get(scheduled.table).sql).sort()),
    "REFERENCE_SCHEDULED_COLUMN_COVERAGE_CHANGED");
  const scheduledSources = [projectedSources.get(scheduled.table), sourcePin(scheduled.createSource), sourcePin(scheduled.ddlSource)];
  statements.push({ ...scheduledCreate, sources: scheduledSources }); tableSources.set(scheduled.table, scheduledSources);
  const replacementStatements = [], replacementColumns = new Map();
  for (const item of config.replacements) {
    const create = createFromSource(sourceTexts[item.path], item.table);
    const sources = [projectedSources.get(item.table), sourcePin(item.path)], additions = [];
    let columns = columnNames(create.sql);
    for (const addition of item.columnAdditions ?? []) {
      sources.push(sourcePin(addition.path));
      const derived = deriveColumnAddition(splitPublicStatements(sourceTexts[addition.path])[addition.statementIndex], item.table, columns);
      columns = derived.columns; additions.push({ ...derived.statement, sources });
    }
    insist(isDeepStrictEqual([...columns].sort(), columnNames(projectedCreates.get(item.table).sql).sort()), "REFERENCE_REPLACEMENT_COLUMN_COVERAGE_CHANGED");
    replacementStatements.push({ ...create, sources }, ...additions); tableSources.set(item.table, sources); replacementColumns.set(item.table, columns);
    if (item.collation) insist(create.sql.includes(`COLLATE=${item.collation}`), "REFERENCE_COLLATION_SOURCE_CHANGED");
  }
  const ledger = extractLedgerCreate(sourceTexts[config.ledger.path]), ledgerSources = [sourcePin(config.ledger.path)];
  statements.push({ ...ledger, sources: ledgerSources }); tableSources.set(ledger.tableName, ledgerSources);
  // FK-bearing replacement tables are created after every projected parent.
  statements.push(...replacementStatements, ...indexes,
    { kind: "add-scheduled-columns", tableName: scheduled.table, sql: additions[0], sha256: sha256(additions[0]), sources: scheduledSources },
    ...additions.slice(1).map(sql => ({ ...describeReferenceStatement(sql), sources: scheduledSources })));
  insist(statements.slice(-2).every(item => item.kind === "create-index" && item.tableName === scheduled.table), "REFERENCE_SCHEDULED_INDEX_SCOPE_CHANGED");
  const knownOverlayDdl = new Set([...replacementStatements, scheduledCreate,
    ...statements.filter(item => item.tableName === scheduled.table)].map(item => sha256(splitPublicStatements(item.sql)[0])));
  // Inspect every admitted public migration, but never execute it. Future ALTERs
  // on replaced tables must be deliberately added; old CREATE is not final truth.
  for (const entry of bundle.plan) for (const sql of splitPublicStatements(entry.sql.replaceAll("--> statement-breakpoint", ""))) {
    const operations = sqlOperationText(sql);
    if (!/^\s*(?:CREATE|ALTER|DROP|RENAME)\b/i.test(operations)) continue;
    for (const table of replaced) if (new RegExp(`(?:\\b|\`)${table}(?:\\b|\`)`).test(sql)) {
      let normalized = sql;
      if (createPattern.test(sql)) normalized = describeReferenceStatement(sql).sql;
      insist(knownOverlayDdl.has(sha256(normalized)), "REFERENCE_LATER_OVERLAY_DDL_UNACCOUNTED");
    }
  }
  const expectedComments = [];
  for (const item of config.columnComments) {
    const source = sourcePin(item.path), sql = splitPublicStatements(sourceTexts[item.path])[item.statementIndex];
    const overlay = deriveCommentOverlay({ sql, table: item.table, columns: item.columns, projectedCreate: projectedCreates.get(item.table)?.sql });
    const sources = [...tableSources.get(item.table), source]; tableSources.set(item.table, sources);
    expectedComments.push(...overlay.comments); statements.push({ ...overlay, sources });
  }
  const indexResult = applyHistoricalIndexInventory({ inventory: indexInventory, bundle, projectionSql, statements, tableSources });
  statements = indexResult.statements;
  const names = [...tableSources.keys()].sort(), required = [...bundle.manifest.requiredBusinessTables, "app_schema_migrations"].sort();
  insist(isDeepStrictEqual(names, required) && statements.filter(item => item.kind === "create-table").length === names.length
    && EXCLUDED_TABLES.every(name => !names.includes(name)), "REFERENCE_COMPLETE_TABLE_SET_MISMATCH");
  const expectedColumns = Object.fromEntries(names.map(name => {
    const create = statements.find(item => item.kind === "create-table" && item.tableName === name);
    return [name, replacementColumns.get(name) ?? (name === scheduled.table ? [...columnNames(create.sql), ...addColumns] : columnNames(create.sql))];
  }));
  return { version: REFERENCE_VERSION, approvedForBootstrapExecution: false, ordinalValidated: false, bootstrapPlanSha256: bundle.planSha256,
    bootstrapSourcesSha256: bundle.sourcesSha256, sourceManifestSha256: SOURCE_MANIFEST_SHA256,
    projection: config.projection, statements, expectedColumns, expectedComments, expectedIndexes: indexResult.expectedIndexes, tableNames: names,
    indexManifestSha256: INDEX_MANIFEST_SHA256, indexAliases: indexResult.aliases,
    expectedCollations: Object.fromEntries([...config.replacements.filter(item => item.collation).map(item => [item.table, item.collation]), [scheduled.table, "utf8mb4_bin"]]),
    discardedProjectionDdl: discarded.map(({ kind, tableName, sha256: statementSha256 }) => ({ kind, tableName, statementSha256 })),
    statementPlanSha256: fingerprint(statements),
    derivation: { kind: "public-source-projection-plus-reviewed-history", candidateDatabaseUsed: false, productionDdlUsed: false,
      referenceVersion: REFERENCE_VERSION, sourceManifestSha256: SOURCE_MANIFEST_SHA256, projection: config.projection,
      publicSources: [...new Map([...metadata.sourceFiles, ...config.sources, ...indexInventory.inputs].map(item => [item.path, item])).values()],
      tables: names.map(name => ({ name, sources: tableSources.get(name) })),
      overlays: [...config.replacements, scheduled, ...config.columnComments], indexManifestSha256: INDEX_MANIFEST_SHA256, indexAliases: indexResult.aliases,
      limitations: ["Historical column order, comments and additional physical indexes not declared by Drizzle are not silently ignored.",
        "A differing bootstrap catalog must be traced to public sources and explicitly reviewed; this reference is not automatic approval."] } };
}

export function reorderCreateColumns(sql, expectedOrder) {
  const parts = createParts(sql), names = columnNames(sql), definitions = new Map(), constraints = [];
  for (const definition of parts.definitions) {
    const match = new RegExp(`^${quotedIdentifier}\\s+`).exec(definition), name = match && (match[1] ?? match[2]);
    if (name && names.includes(name)) definitions.set(name, definition);
    else constraints.push(definition);
  }
  const order = expectedOrder.filter(name => definitions.has(name));
  insist(order.length === definitions.size && definitions.size === names.length && new Set(order).size === order.length,
    "REFERENCE_REORDER_COLUMN_COVERAGE_CHANGED");
  const result = `${parts.prefix}\n${[...order.map(name => definitions.get(name)), ...constraints].map(value => `  ${value}`).join(",\n")}\n${parts.suffix}`;
  insist(isDeepStrictEqual(columnNames(result), order), "REFERENCE_REORDER_COLUMNS_INVALID"); return result;
}

// Consume the already strict, source-pinned column replay. This records the last
// effective declaration; a repeated IF NOT EXISTS CREATE is deliberately a no-op.
// Nothing here executes historical SQL or takes a candidate catalog as input.
export function tracePublicColumnDeclarations({ bundle, order }) {
  insist(order.bootstrapPlanSha256 === bundle.planSha256 && order.bootstrapSourcesSha256 === bundle.sourcesSha256,
    "REFERENCE_DEFAULT_REPLAY_IDENTITY_CHANGED");
  const entries = new Map(bundle.plan.map(item => [`drizzle/${item.fileName}`, item]));
  const pins = new Map(bundle.manifest.sources.map(item => [item.path, item.sha256]));
  const tables = new Map(), cache = new Map();
  const named = definition => {
    const match = new RegExp(`^${quotedIdentifier}\\s+`).exec(definition);
    insist(match, "REFERENCE_DEFAULT_DECLARATION_INVALID"); return match[1] ?? match[2];
  };
  for (const operation of order.operations) {
    const entry = entries.get(operation.path);
    insist(entry && sha256(entry.sql) === entry.checksum && pins.get(operation.path) === entry.checksum,
      "REFERENCE_DEFAULT_SOURCE_CHANGED");
    if (!cache.has(operation.path)) cache.set(operation.path, splitPublicStatements(entry.sql));
    const raw = cache.get(operation.path)[operation.statementIndex];
    insist(typeof raw === "string", "REFERENCE_DEFAULT_STATEMENT_MISSING");
    let sql = raw.trim();
    while (sql.startsWith("--> statement-breakpoint")) {
      insist(/^--> statement-breakpoint(?:\r?\n|$)/.test(sql), "REFERENCE_DEFAULT_BREAKPOINT_INVALID");
      sql = sql.slice("--> statement-breakpoint".length).trim();
    }
    const source = { path: operation.path, sha256: entry.checksum, statementIndex: operation.statementIndex,
      statementSha256: sha256(raw), executableStatementSha256: sha256(sql) };
    const declaration = definition => ({ definition, declarationSha256: sha256(definition), source });
    if (operation.operation === "create") {
      const match = createPattern.exec(sql);
      insist(match && (match[1] ?? match[2]) === operation.tableName, "REFERENCE_DEFAULT_CREATE_CHANGED");
      if (tables.has(operation.tableName)) {
        insist(/^CREATE TABLE IF NOT EXISTS\b/i.test(sql), "REFERENCE_DEFAULT_RECREATE_UNREVIEWED"); continue;
      }
      const columns = new Map();
      for (const definition of createParts(sql).definitions) {
        if (/^(?:CONSTRAINT|PRIMARY KEY|UNIQUE|KEY|INDEX|FOREIGN KEY|CHECK)\b/i.test(definition)) continue;
        const name = named(definition); insist(!columns.has(name), "REFERENCE_DEFAULT_DUPLICATE_COLUMN"); columns.set(name, declaration(definition));
      }
      tables.set(operation.tableName, columns); continue;
    }
    const table = tables.get(operation.tableName); insist(table, "REFERENCE_DEFAULT_TABLE_MISSING");
    if (operation.operation === "drop-table") { tables.delete(operation.tableName); continue; }
    if (["drop", "conditional-drop-noop"].includes(operation.operation)) { table.delete(operation.column); continue; }
    insist(["add", "modify", "change"].includes(operation.operation), "REFERENCE_DEFAULT_OPERATION_UNSUPPORTED");
    if (operation.path === "drizzle/0112c_ad_dsp_product_link.sql") {
      // The column replay has already validated this sole literal dynamic ADD.
      // Retain its literal provenance instead of interpreting any dynamic SQL.
      const literal = "ALTER TABLE `ad_dsp_reports` ADD COLUMN `product_id` int NULL AFTER `upload_id`";
      insist(entry.checksum === "4768df2f3f0c3219ec53494aa1a1ee462baba7891caee7624328424f6284a83c"
        && operation.operation === "add" && operation.tableName === "ad_dsp_reports" && operation.column === "product_id"
        && operation.statementIndex === 1 && sql.includes(`'${literal}'`), "REFERENCE_DEFAULT_DYNAMIC_UNREVIEWED");
      sql = literal;
    }
    const alter = new RegExp(`^ALTER TABLE\\s+${quotedIdentifier}\\s+([\\s\\S]+)$`, "i").exec(sql);
    insist(alter && (alter[1] ?? alter[2]) === operation.tableName, "REFERENCE_DEFAULT_ALTER_CHANGED");
    const candidates = [];
    for (const clause of splitDefinitionList(alter[3])) {
      let match, definition;
      if (operation.operation === "change") {
        match = new RegExp(`^CHANGE(?: COLUMN)?\\s+${quotedIdentifier}\\s+([\\s\\S]+)$`, "i").exec(clause);
        if (match && (match[1] ?? match[2]) === operation.oldColumn) definition = match[3];
      } else {
        match = new RegExp(`^${operation.operation === "add" ? "ADD" : "MODIFY"}\\s+(?:COLUMN\\s+)?([\\s\\S]+)$`, "i").exec(clause);
        if (match && !/^(?:CONSTRAINT|PRIMARY KEY|UNIQUE|KEY|INDEX|FOREIGN KEY|CHECK)\b/i.test(match[1])) definition = match[1];
      }
      if (definition && named(definition) === operation.column) candidates.push(definition);
    }
    insist(candidates.length === 1, "REFERENCE_DEFAULT_DECLARATION_AMBIGUOUS");
    if (operation.operation !== "add") insist(table.has(operation.oldColumn ?? operation.column), "REFERENCE_DEFAULT_COLUMN_MISSING");
    else insist(!table.has(operation.column), "REFERENCE_DEFAULT_DUPLICATE_COLUMN");
    if (operation.oldColumn) table.delete(operation.oldColumn);
    table.set(operation.column, declaration(candidates[0]));
  }
  insist(isDeepStrictEqual([...tables.keys()].sort(), order.tables.map(item => item.name).sort()), "REFERENCE_DEFAULT_TABLE_SET_CHANGED");
  for (const item of order.tables) insist(isDeepStrictEqual([...tables.get(item.name).keys()].sort(), [...item.columns].sort()),
    "REFERENCE_DEFAULT_COLUMN_SET_CHANGED");
  return tables;
}

// A narrowly source-derived spelling correction, not a catalog normalizer.
// All bytes except the default expression token survive, including ON UPDATE,
// nullability, comments and temporal precision. Quoted text cannot trigger it.
export function deriveCurrentTimestampDefault({ projectedDefinition, sourceDefinition }) {
  const temporal = definition => {
    const match = new RegExp(`^${quotedIdentifier}\\s+(timestamp|datetime)(?:\\(([0-6])\\))?(?=\\s|$)`, "i").exec(definition);
    return match && { name: match[1] ?? match[2], type: match[3].toLowerCase(), precision: Number(match[4] ?? 0) };
  };
  const mask = definition => definition.replace(/'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|`(?:``|[^`])*`/g, value => " ".repeat(value.length));
  const projected = temporal(projectedDefinition), original = { definition: projectedDefinition, changed: false };
  if (!projected) return original;
  const projectedText = mask(projectedDefinition), sourceText = mask(sourceDefinition);
  const defaults = [...projectedText.matchAll(/\bDEFAULT\b/gi)];
  insist(defaults.length <= 1, "REFERENCE_TEMPORAL_MULTIPLE_DEFAULTS");
  const now = /\bDEFAULT\s+(\(\s*now\(\s*([0-6]?)\s*\)\s*\))(?=\s|$)/i.exec(projectedText);
  if (!now) {
    insist(!/\bDEFAULT\s+\(?\s*now\b/i.test(projectedText), "REFERENCE_TEMPORAL_NOW_UNSUPPORTED"); return original;
  }
  const sourceDefaults = [...sourceText.matchAll(/\bDEFAULT\b/gi)];
  insist(sourceDefaults.length <= 1, "REFERENCE_TEMPORAL_MULTIPLE_DEFAULTS");
  if (!/\bDEFAULT\s+CURRENT_TIMESTAMP\b/i.test(sourceText)) return original;
  const current = /\bDEFAULT\s+(CURRENT_TIMESTAMP(?:\(\s*([0-6]?)\s*\))?)(?=\s|$)/i.exec(sourceText);
  insist(current, "REFERENCE_TEMPORAL_CURRENT_TIMESTAMP_UNSUPPORTED");
  const permittedTail = value => /^(?:\s*$|\s+(?:ON UPDATE\b|COMMENT\b|NOT NULL\b|NULL\b|AFTER\b|FIRST\b))/i.test(value);
  insist(permittedTail(projectedText.slice(now.index + now[0].length))
    && permittedTail(sourceText.slice(current.index + current[0].length)), "REFERENCE_TEMPORAL_EXPRESSION_TAIL_UNSUPPORTED");
  const source = temporal(sourceDefinition);
  insist(source && source.name === projected.name && source.type === projected.type
    && source.precision === projected.precision && Number(now[2] || 0) === projected.precision
    && Number(current[2] || 0) === source.precision, "REFERENCE_TEMPORAL_PRECISION_OR_TYPE_CHANGED");
  const start = now.index + now[0].length - now[1].length;
  const sourceStart = current.index + current[0].length - current[1].length;
  const from = projectedDefinition.slice(start, start + now[1].length), to = sourceDefinition.slice(sourceStart, sourceStart + current[1].length);
  return { definition: projectedDefinition.slice(0, start) + to + projectedDefinition.slice(start + from.length),
    changed: true, from, to, type: projected.type, precision: projected.precision };
}

export function assembleReferencePlan(input) {
  const draft = assembleReferenceDraft(input);
  const expectedColumns = Object.fromEntries(Object.entries(draft.expectedColumns).filter(([name]) => name !== "app_schema_migrations"));
  const order = deriveHistoricalColumnOrder({ bundle: input.bundle, expectedColumns, splitPublicStatements, splitDefinitionList });
  const historical = new Map(order.tables.map(item => [item.name, item]));
  const declarations = tracePublicColumnDeclarations({ bundle: input.bundle, order }), temporalDefaultOverlays = [];
  const mergeSources = (existing, additional) => [...new Map([...existing, ...additional].map(item => [item.path, item])).values()];
  const statements = draft.statements.map(item => {
    if (item.kind !== "create-table" || item.tableName === "app_schema_migrations") return item;
    const table = historical.get(item.tableName), parts = createParts(reorderCreateColumns(item.sql, table.columns));
    const definitions = parts.definitions.map(definition => {
      const match = new RegExp(`^${quotedIdentifier}\\s+(?:timestamp|datetime)(?=\\s|\\()`, "i").exec(definition);
      if (!match) return definition;
      const columnName = match[1] ?? match[2], source = declarations.get(item.tableName)?.get(columnName);
      insist(source, "REFERENCE_TEMPORAL_FINAL_SOURCE_MISSING");
      const derived = deriveCurrentTimestampDefault({ projectedDefinition: definition, sourceDefinition: source.definition });
      if (derived.changed) temporalDefaultOverlays.push({ tableName: item.tableName, columnName, from: derived.from, to: derived.to,
        type: derived.type, precision: derived.precision, source: source.source, declarationSha256: source.declarationSha256,
        projectedDeclarationSha256: sha256(definition), referenceDeclarationSha256: sha256(derived.definition) });
      return derived.definition;
    });
    const sql = `${parts.prefix}\n${definitions.map(value => `  ${value}`).join(",\n")}\n${parts.suffix}`;
    return { ...item, sql, sha256: sha256(sql), sources: mergeSources(item.sources, table.sources) };
  });
  return { ...draft, ordinalValidated: true, statements, statementPlanSha256: fingerprint(statements),
    expectedColumns: { ...Object.fromEntries(order.tables.map(item => [item.name, item.columns])), app_schema_migrations: draft.expectedColumns.app_schema_migrations },
    columnOrderSha256: fingerprint(order), columnOrderChangedTables: order.changedOrderTableNames, temporalDefaultOverlays,
    derivation: { ...draft.derivation, columnOrderSha256: fingerprint(order), columnOrderChangedTables: order.changedOrderTableNames,
      temporalDefaultOverlays,
      tables: draft.derivation.tables.map(item => ({ ...item, sources: mergeSources(item.sources, historical.get(item.name)?.sources ?? []) })) } };
}

export function loadFreshReferencePlan({ root = REPOSITORY_ROOT, projectionDirectory, io = fs } = {}) {
  const bundle = loadFreshBootstrapPlan(root), manifestText = readPublicFile(root, SOURCE_MANIFEST_PATH);
  insist(sha256(manifestText) === SOURCE_MANIFEST_SHA256, "REFERENCE_SOURCE_MANIFEST_CHANGED");
  const config = JSON.parse(manifestText);
  const indexText = readPublicFile(root, INDEX_MANIFEST_PATH);
  insist(sha256(indexText) === INDEX_MANIFEST_SHA256, "REFERENCE_INDEX_MANIFEST_CHANGED");
  const indexInventory = JSON.parse(indexText);
  insist(typeof projectionDirectory === "string" && path.isAbsolute(projectionDirectory) && path.normalize(projectionDirectory) === projectionDirectory
    && io.realpathSync(projectionDirectory) === projectionDirectory && io.lstatSync(projectionDirectory).isDirectory(), "REFERENCE_PROJECTION_DIRECTORY_INVALID");
  const read = (name, bound) => {
    const filename = path.join(projectionDirectory, name), fd = io.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = io.fstatSync(fd); insist(stat.isFile() && stat.size > 0 && stat.size <= bound, "REFERENCE_PROJECTION_FILE_INVALID");
      const bytes = io.readFileSync(fd); insist(Buffer.isBuffer(bytes) && bytes.length === stat.size, "REFERENCE_PROJECTION_READ_INVALID"); return bytes.toString("utf8");
    } finally { io.closeSync(fd); }
  };
  const metadataText = read("source-projection.metadata.json", 1024 * 1024);
  insist(sha256(metadataText) === config.projection.metadataSha256, "REFERENCE_PROJECTION_METADATA_CHANGED");
  const projectionMetadata = JSON.parse(metadataText), projectionSql = read("source-projection.sql", 8 * 1024 * 1024);
  const sourceTexts = Object.fromEntries([...config.sources, ...projectionMetadata.sourceFiles].map(item => [item.path, readPublicFile(root, item.path)]));
  const plan = assembleReferencePlan({ bundle, config, projectionSql, projectionMetadata, sourceTexts, indexInventory });
  return { bundle, plan };
}

export function validateReferenceCatalog(catalog, plan) {
  const checked = validateCatalog(catalog, plan.tableNames);
  for (const tableName of plan.tableNames) insist(isDeepStrictEqual(checked.columns.filter(column => column.tableName === tableName)
    .map(column => column.columnName), plan.expectedColumns[tableName]), "REFERENCE_COMPLETE_COLUMN_ORDER_MISMATCH");
  const fks = [["competitorComparisonReports", "fk_competitor_comparison_project", "projects"],
    ["emperor_external_knowledge_callers", "fk_external_kb_caller_connector", "emperor_mcp_connectors"]];
  for (const [tableName, constraintName, parent] of fks) {
    const fk = checked.foreignKeys.filter(row => row.tableName === tableName && row.constraintName === constraintName);
    insist(fk.length === 1 && fk[0].referencedTableName === parent && fk[0].deleteRule === "CASCADE" && fk[0].updateRule === "NO ACTION", "REFERENCE_REQUIRED_FK_MISSING");
  }
  for (const [tableName, collation] of Object.entries(plan.expectedCollations)) {
    insist(checked.tables.find(table => table.tableName === tableName)?.collationName === collation, "REFERENCE_REQUIRED_TABLE_COLLATION_MISSING");
    insist(checked.columns.filter(column => column.tableName === tableName && column.characterSetName !== null)
      .every(column => column.characterSetName === "utf8mb4" && column.collationName === collation), "REFERENCE_REQUIRED_COLUMN_COLLATION_MISSING");
  }
  for (const expected of plan.expectedComments) {
    const column = checked.columns.find(item => item.tableName === expected.tableName && item.columnName === expected.columnName);
    insist(column?.columnComment === expected.comment && column.columnType === expected.columnType && column.isNullable === "YES"
      && column.columnDefault === null, "REFERENCE_REQUIRED_COLUMN_COMMENT_MISSING");
  }
  const expectedParts = plan.expectedIndexes.reduce((sum, item) => sum + item.columns.length, 0);
  insist(checked.indexes.length === expectedParts, "REFERENCE_INDEX_PART_COUNT_CHANGED");
  for (const expected of plan.expectedIndexes) {
    const parts = checked.indexes.filter(index => index.tableName === expected.table && index.indexName === expected.name);
    insist(parts.length === expected.columns.length && parts.every((part, index) => {
      const column = expected.columns[index];
      return part.columnName === column.name && Number(part.sequence) === index + 1 && Number(part.nonUnique) === (expected.unique ? 0 : 1)
        && (part.prefixLength === null ? column.prefixLength === null : column.prefixLength !== null && Number(part.prefixLength) === column.prefixLength)
        && part.direction === column.direction && part.indexType === "BTREE"
        && part.expression === null && part.visible === "YES";
    }), "REFERENCE_REQUIRED_INDEX_MISSING");
  }
  return checked;
}

export function constructReferenceContract({ bundle, plan, catalog, platform }) {
  insist(plan.ordinalValidated === true && /^[a-f0-9]{64}$/.test(plan.columnOrderSha256 ?? ""), "REFERENCE_ORDINAL_NOT_VALIDATED");
  insist(plan.version === REFERENCE_VERSION && plan.statementPlanSha256 === fingerprint(plan.statements)
    && plan.bootstrapPlanSha256 === bundle.planSha256 && plan.bootstrapSourcesSha256 === bundle.sourcesSha256,
  "REFERENCE_PLAN_BINDING_CHANGED");
  const checked = validateReferenceCatalog(catalog, plan);
  return buildStructureContract({ bundle, catalog: checked, derivation: { ...plan.derivation, referenceStatementPlanSha256: plan.statementPlanSha256 }, platform });
}

export function parseArguments(args) {
  const options = {}, flags = new Map([["--execute-local", "executeLocal"], ["--linux-isolated-vm", "linuxIsolatedVm"], ["--build-public-source-reference", "buildPublicSourceReference"]]);
  const names = new Map(["root", "socket", "datadir", "projection-directory", "output", "receipt-output"].map(name => [`--${name}`, name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]));
  for (let index = 0; index < args.length; index++) {
    const key = flags.get(args[index]) ?? names.get(args[index]); insist(key && !Object.hasOwn(options, key), "REFERENCE_ARGUMENTS_INVALID");
    if (flags.has(args[index])) options[key] = true;
    else { const value = args[++index]; insist(typeof value === "string" && value && !value.startsWith("--") && !value.includes("\0"), "REFERENCE_ARGUMENTS_INVALID"); options[key] = value; }
  }
  insist([...flags.values()].every(key => options[key] === true) && [...names.values()].every(key => options[key]), "REFERENCE_EXPLICIT_LOCAL_ARGUMENTS_REQUIRED");
  return options;
}

async function loadConnector() { return (await import("mysql2/promise")).createConnection; }

export async function runPublicSourceReference(options, { io = fs, environment = process.env, argv = process.argv,
  runtime = { platform: process.platform, arch: process.arch }, load = loadConnector, timers = { setTimeout, clearTimeout } } = {}) {
  insist(options.executeLocal === true && options.linuxIsolatedVm === true && options.buildPublicSourceReference === true,
    "REFERENCE_EXPLICIT_LOCAL_ARGUMENTS_REQUIRED");
  const profile = createHistoricalPlatformProfile(options, { io, runtime }); profile.validateEnvironment(environment, argv);
  const paths = profile.validatePaths(options), output = validateOutput(options.output, io), receiptOutput = validateOutput(options.receiptOutput, io);
  insist(output && receiptOutput && output !== receiptOutput, "REFERENCE_DISTINCT_NEW_OUTPUTS_REQUIRED");
  const { bundle, plan } = loadFreshReferencePlan({ projectionDirectory: options.projectionDirectory, io }), schema = schemaNames().synthetic;
  const receipt = { formatVersion: 1, mode: REFERENCE_VERSION, status: "running", stage: "connect", startedAt: new Date().toISOString(), schema,
    sourceManifestSha256: SOURCE_MANIFEST_SHA256, statementPlanSha256: plan.statementPlanSha256, bootstrapPlanSha256: bundle.planSha256,
    productionDdlUsed: false, candidateDatabaseUsed: false, bootstrapRunnerInvoked: false, seedsExecuted: false, ledgerRowsWritten: false,
    structureContractApproved: false, publishedContractPath: null, candidateFile: output, statementsSucceeded: 0, platform: profile.runtime };
  const connections = [], controller = new AbortController(); let candidate;
  const active = () => insist(!controller.signal.aborted, "REFERENCE_DEADLINE_EXCEEDED");
  const timer = timers.setTimeout(() => { controller.abort(); receipt.deadlineExceeded = true;
    for (const raw of connections) try { raw.destroy(); } catch { receipt.deadlineCleanupFailed = true; }
  }, 10 * 60_000);
  try {
    const createConnection = await load();
    const connect = async database => {
      profile.validatePaths(options); active(); insist(database === undefined || database === schema, "REFERENCE_FOREIGN_SCHEMA_FORBIDDEN");
      const raw = await createConnection({ ...connectionOptions(paths), multipleStatements: false, supportBigNumbers: true,
        bigNumberStrings: true, dateStrings: true, jsonStrings: true, ...(database ? { database } : {}) }); connections.push(raw);
      const query = (sql, values = []) => { active(); return raw.query({ sql, timeout: 30_000 }, values); };
      const connection = { query, execute: query };
      const [rows] = await query("SELECT DATABASE() AS schemaName, @@version AS version, @@datadir AS datadir, @@socket AS socket, @@skip_networking AS skipNetworking, @@lower_case_table_names AS lowerCaseTableNames, @@sql_mode AS sqlMode, @@event_scheduler AS eventScheduler");
      insist(rows?.length === 1 && rows[0].schemaName === (database ?? null), "REFERENCE_CURRENT_SCHEMA_MISMATCH");
      receipt.server = profile.validateServerIdentity(rows[0], paths);
      insist(rows[0].version === "8.0.46-0ubuntu0.24.04.4" && typeof rows[0].sqlMode === "string"
        && !rows[0].sqlMode.split(",").includes("NO_BACKSLASH_ESCAPES"), "REFERENCE_SERVER_VERSION_OR_MODE_UNREVIEWED");
      const [plugins] = await query("SELECT PLUGIN_STATUS AS pluginStatus FROM information_schema.plugins WHERE PLUGIN_NAME='mysqlx'");
      Object.assign(receipt.server, validateLinuxPluginRows(plugins)); receipt.sqlMode = rows[0].sqlMode;
      await query("SET SESSION sql_quote_show_create=1"); return connection;
    };
    const admin = await connect(); receipt.stage = "create_reference_schema";
    insist(schemaPattern.test(schema), "REFERENCE_SCHEMA_NAME_INVALID");
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`); receipt.schemaCreated = true;
    const connection = await connect(schema);
    const [existing] = await connection.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
    insist(Array.isArray(existing) && existing.length === 0, "REFERENCE_SCHEMA_NOT_EMPTY");
    receipt.stage = "materialize_public_ddl";
    for (const [index, statement] of plan.statements.entries()) {
      try { await connection.query(statement.sql); receipt.statementsSucceeded++; }
      catch (error) { receipt.firstFailure = { index, kind: statement.kind, tableName: statement.tableName, sha256: statement.sha256 }; throw error; }
    }
    receipt.stage = "capture_full_catalog";
    for (const tableName of plan.tableNames) {
      const [counts] = await connection.query(`SELECT COUNT(*) AS rowCount FROM \`${tableName}\``);
      insist(counts?.length === 1 && String(counts[0].rowCount) === "0", "REFERENCE_MUST_HAVE_NO_ROWS");
    }
    const catalog = await readFreshCatalog(connection, schema);
    const platform = { mysqlMajorMinor: "8.0", lowerCaseTableNames: 0, schemaCharacterSet: "utf8mb4", schemaCollation: "utf8mb4_0900_ai_ci" };
    candidate = constructReferenceContract({ bundle, plan, catalog, platform });
    // Detect source changes during DB work, without deriving expectations from it.
    const rechecked = loadFreshReferencePlan({ projectionDirectory: options.projectionDirectory, io });
    insist(fingerprint(rechecked.plan) === fingerprint(plan), "REFERENCE_SOURCES_CHANGED_DURING_CAPTURE");
    active(); receipt.catalogSha256 = candidate.catalogSha256; receipt.tableCount = catalog.tables.length;
    receipt.columnCount = catalog.columns.length; receipt.indexParts = catalog.indexes.length; receipt.foreignKeys = catalog.foreignKeys.length;
    receipt.zeroRowTables = plan.tableNames.length; receipt.status = "completed"; receipt.stage = "completed";
  } catch (error) { receipt.status = "failed"; receipt.error = safeError(error); }
  finally {
    timers.clearTimeout(timer);
    for (const raw of connections) try { raw.destroy(); } catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
    receipt.finishedAt = new Date().toISOString();
  }
  if (receipt.status === "completed") {
    try {
      const bytes = `${JSON.stringify(candidate, null, 2)}\n`; receipt.candidateWriteAttempted = true;
      io.writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
      receipt.candidateFileSha256 = sha256(bytes); receipt.candidateFileCreated = true;
    } catch (error) { receipt.status = "failed"; receipt.stage = "write_unapproved_candidate"; receipt.error = safeError(error); }
  }
  io.writeFileSync(receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 }); return receipt;
}

export async function main(args, { dependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try { const receipt = await runPublicSourceReference(parseArguments(args), dependencies); stdout.write(`${JSON.stringify(receipt, null, 2)}\n`); return receipt.status === "completed" ? 0 : 1; }
  catch (error) { stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: safeError(error) })}\n`); return 1; }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main(process.argv.slice(2));
