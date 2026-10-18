// Pure, target-specific STRUCTURE candidate assessment. No filesystem, connector,
// environment, DDL execution, ledger registration or runtime activation.
// This is independent of the historical synthetic 0230 reference planner. A
// caller must authenticate collected evidence; hashes here prove consistency,
// not provenance, an atomic DDL snapshot or permission to deploy.
import { createHash } from "node:crypto";

export const AI_FEATURE_TARGET_DATABASE = "amz_listing";
export const AI_FEATURE_TARGET_SOURCES = Object.freeze([
  Object.freeze({ fileName: "0230_assistant_configurations.sql", sha256: "88b08b6852381336d06af255e25c6dd6a5ed574b7ed27c94b2b86db34fe080e8", tables: Object.freeze(["emperor_assistant_configurations", "emperor_assistant_configuration_versions"]) }),
  Object.freeze({ fileName: "0231_assistant_conversations.sql", sha256: "104137a6178b5a69ce5c849249e9c27c5c2691349fe2377ef1753657f5ac85e5", tables: Object.freeze(["assistant_conversation_threads", "assistant_conversation_turns", "assistant_conversation_attachments"]) }),
  Object.freeze({ fileName: "0309_integration_profit_analysis.sql", sha256: "1b681081b730fbfea014357fe11d5f4e0d440fcbc8bd29df4adb20088fd0c8c9", tables: Object.freeze(["ops_profit_analysis_reports", "ops_profit_analysis_runs", "ops_profit_analysis_save_operations"]) }),
]);
export const AI_FEATURE_TARGET_TABLES = Object.freeze(AI_FEATURE_TARGET_SOURCES.flatMap(source => source.tables));
const TARGETS = new Set(AI_FEATURE_TARGET_TABLES);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sha = value => createHash("sha256").update(value).digest("hex");
const bytes = value => Buffer.byteLength(value, "utf8");
export class AiFeatureTargetSchemaError extends Error {
  constructor(code) { super(`AI_FEATURE_TARGET_${code}`); this.code = `AI_FEATURE_TARGET_${code}`; }
}
function insist(condition, code) { if (!condition) throw new AiFeatureTargetSchemaError(code); }
function plain(value) { return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype; }
function keys(value, expected) { return plain(value) && same(Object.keys(value).sort(), [...expected].sort()); }
function integer(value) { return (typeof value === "number" || typeof value === "string") && /^(?:0|[1-9][0-9]*)$/u.test(String(value)) && Number.isSafeInteger(Number(value)) && !Object.is(value, -0); }
function numberIs(value, expected) { return integer(value) && Number(value) === expected; }
function identifier(value) { return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value); }

// Reject executable/non-JSON values before hashing; never invoke a getter or
// toJSON hook supplied by a planning input. Preserve collector key order/hash.
function checkedJson(value, limit) {
  const stack = new Set(); let nodes = 0;
  function visit(item, depth) {
    insist(++nodes <= 300000 && depth <= 30, "INPUT_BUDGET");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") { insist(bytes(item) <= limit && Buffer.from(item).toString("utf8") === item, "INPUT_TEXT"); return; }
    if (typeof item === "number") { insist(Number.isFinite(item) && !Object.is(item, -0), "INPUT_NUMBER"); return; }
    insist((Array.isArray(item) || plain(item)) && !stack.has(item), "INPUT_JSON");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    insist(Reflect.ownKeys(item).every(key => typeof key === "string" && (Array.isArray(item) && key === "length" || descriptors[key].enumerable && own(descriptors[key], "value"))), "INPUT_JSON");
    if (Array.isArray(item)) insist(Object.keys(item).length === item.length, "INPUT_JSON");
    stack.add(item);
    for (const [key, descriptor] of Object.entries(descriptors)) if (!(Array.isArray(item) && key === "length")) visit(descriptor.value, depth + 1);
    stack.delete(item);
  }
  visit(value, 0); const text = JSON.stringify(value); insist(bytes(text) <= limit, "INPUT_BUDGET"); return text;
}

// This parser handles ONLY the three byte-pinned source files above. Changing a
// source, even whitespace, requires a separate review; it cannot approve new SQL.
function definitions(body) {
  const parts = []; let start = 0, depth = 0, quoted = false;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "'") quoted = !quoted;
    else if (!quoted) {
      if (body[i] === "(") depth++;
      if (body[i] === ")") depth--;
      if (body[i] === "," && depth === 0) { parts.push(body.slice(start, i).trim()); start = i + 1; }
    }
    insist(depth >= 0, "SOURCE_SYNTAX");
  }
  insist(depth === 0 && !quoted, "SOURCE_SYNTAX"); parts.push(body.slice(start).trim()); return parts;
}
function parseTable(sql, source, expectedName) {
  const match = /^CREATE TABLE `?([A-Za-z_][A-Za-z0-9_]*)`? \(([\s\S]+)\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin$/u.exec(sql);
  insist(match && match[1] === expectedName, "SOURCE_TABLE_SET");
  const columns = [], indexes = [];
  for (const part of definitions(match[2])) {
    const key = /^(PRIMARY KEY|UNIQUE KEY\s+`?([A-Za-z_][A-Za-z0-9_]*)`?|KEY\s+`?([A-Za-z_][A-Za-z0-9_]*)`?)\s*\(([^)]+)\)$/u.exec(part);
    if (key) { indexes.push({ name: key[1] === "PRIMARY KEY" ? "PRIMARY" : key[2] ?? key[3], unique: !key[1].startsWith("KEY"), columns: key[4].split(",").map(name => name.trim().replaceAll("`", "")) }); continue; }
    const field = /^`?([A-Za-z_][A-Za-z0-9_]*)`?\s+(INT|JSON|MEDIUMBLOB|TIMESTAMP|DATETIME\(3\)|(?:VAR)?CHAR\([0-9]+\)|ENUM\('[a-z_]+'(?:,'[a-z_]+')*\))\s+(.+)$/iu.exec(part);
    insist(field, "SOURCE_COLUMN_SYNTAX");
    const type = field[2].toLowerCase(), suffix = field[3].toUpperCase();
    insist(/^(?:NOT NULL|NULL|DEFAULT NULL)(?: AUTO_INCREMENT)?(?: PRIMARY KEY)?(?: DEFAULT CURRENT_TIMESTAMP)?(?: ON UPDATE CURRENT_TIMESTAMP)?$/u.test(suffix), "SOURCE_COLUMN_SYNTAX");
    columns.push({ name: field[1], type, nullable: !suffix.startsWith("NOT NULL"), auto: suffix.includes("AUTO_INCREMENT"), timestampDefault: suffix.includes("DEFAULT CURRENT_TIMESTAMP"), timestampUpdate: suffix.includes("ON UPDATE CURRENT_TIMESTAMP") });
    if (suffix.includes("PRIMARY KEY")) indexes.push({ name: "PRIMARY", unique: true, columns: [field[1]] });
  }
  insist(new Set(columns.map(row => row.name)).size === columns.length && indexes.some(index => index.name === "PRIMARY"), "SOURCE_COLUMN_SET");
  return { name: expectedName, fileName: source.fileName, sourceSha256: source.sha256, statementSha256: sha(sql), sql, columns, indexes };
}
export function deriveAiFeatureTargetDefinitions(sources) {
  checkedJson(sources, 128 * 1024);
  insist(Array.isArray(sources) && sources.length === 3 && new Set(sources.map(item => item.fileName)).size === 3, "SOURCE_SET");
  return AI_FEATURE_TARGET_SOURCES.flatMap(source => {
    const found = sources.find(item => item.fileName === source.fileName);
    insist(keys(found, ["fileName", "sql"]) && typeof found.sql === "string" && sha(found.sql) === source.sha256, "SOURCE_PIN_CHANGED");
    const statements = found.sql.replace(/^--[^\r\n]*(?:\r?\n|$)/gmu, "").split(";").map(text => text.trim()).filter(Boolean);
    insist(statements.length === source.tables.length, "SOURCE_STATEMENT_SET");
    return statements.map((sql, index) => parseTable(sql, source, source.tables[index]));
  });
}

function observationOf(receipt) {
  checkedJson(receipt, 24 * 1024 * 1024);
  insist(receipt?.schema === "amazon-main-feature-metadata/v1" && receipt.database === AI_FEATURE_TARGET_DATABASE
    && receipt.status === "completed" && receipt.complete === true && receipt.stable === true && receipt.readOnly === true
    && receipt.databaseWrites === false && receipt.businessRowsRead === false && receipt.migrationLedgerRead === false && receipt.credentialsReturned === false
    && !own(receipt, "error") && !own(receipt, "cleanupError"), "METADATA_INCOMPLETE");
  insist(Array.isArray(receipt.tableNames) && receipt.tableNames.length <= 100 && receipt.tableNames.every(identifier)
    && new Set(receipt.tableNames).size === receipt.tableNames.length && AI_FEATURE_TARGET_TABLES.every(name => receipt.tableNames.includes(name)), "TABLE_COVERAGE");
  const observation = receipt.observation, identity = observation?.identity;
  insist(keys(identity, ["schemaName", "version", "lowerCaseTableNames", "sqlMode"]) && identity.schemaName === AI_FEATURE_TARGET_DATABASE
    && typeof identity.version === "string" && /^8\.\d+\.\d+(?:[-+.][A-Za-z0-9_.-]+)?$/u.test(identity.version)
    && !/mariadb/iu.test(identity.version) && numberIs(identity.lowerCaseTableNames, 0)
    && typeof identity.sqlMode === "string" && identity.sqlMode.split(",").some(mode => ["STRICT_TRANS_TABLES", "STRICT_ALL_TABLES"].includes(mode)), "DATABASE_IDENTITY");
  const observationSha256 = sha(JSON.stringify(observation));
  insist(Array.isArray(receipt.hashes) && receipt.hashes.length === 2 && receipt.hashes.every(hash => hash === observationSha256), "METADATA_HASH_CHANGED");
  const raw = observation.metadata;
  insist(keys(raw, ["schema", "tables", "columns", "indexes"]) && ["schema", "tables", "columns", "indexes"].every(key => Array.isArray(raw[key]))
    && raw.schema.length === 1 && raw.schema[0].schemaName === AI_FEATURE_TARGET_DATABASE && raw.schema[0].characterSetName === "utf8mb4"
    && typeof raw.schema[0].collationName === "string" && raw.schema[0].collationName.startsWith("utf8mb4_")
    && raw.tables.length <= 100 && raw.columns.length <= 5000 && raw.indexes.length <= 5000 && Array.isArray(observation.absent), "METADATA_SHAPE");
  const present = raw.tables.map(row => row.tableName), absent = observation.absent.map(row => row.tableName);
  insist(new Set(present).size === present.length && new Set(absent).size === absent.length && present.every(name => receipt.tableNames.includes(name) && !absent.includes(name))
    && absent.every(name => receipt.tableNames.includes(name)) && receipt.tableNames.every(name => present.includes(name) || absent.includes(name))
    && observation.absent.every(row => keys(row, ["tableName", "confirmation", "errno"]) && row.confirmation === "ER_NO_SUCH_TABLE" && row.errno === 1146)
    && raw.columns.every(row => present.includes(row.tableName)) && raw.indexes.every(row => present.includes(row.tableName)), "METADATA_COVERAGE");
  for (const name of ["columns", "indexes"]) insist(plain(observation.metadataBudgets?.[name]) && numberIs(observation.metadataBudgets[name].rowCount, raw[name].length), "METADATA_COUNT");
  insist(receipt.counts?.requestedTables === receipt.tableNames.length && receipt.counts.existingTables === present.length && receipt.counts.absentTables === absent.length
    && receipt.counts.columns === raw.columns.length && receipt.counts.indexRows === raw.indexes.length, "METADATA_COUNT");
  return { raw, identity, observationSha256 };
}
function boundedField(row, key) {
  if (!own(row, key) || !own(row, `${key}Bytes`)) return false;
  return row[key] === null ? row[`${key}Bytes`] === null
    : typeof row[key] === "string" && bytes(row[key]) <= 65536 && numberIs(row[`${key}Bytes`], bytes(row[key]));
}
function timestampDefault(value) { return typeof value === "string" && /^current_timestamp(?:\(\))?$/iu.test(value); }
function columnCompatible(row, spec, index) {
  if (!numberIs(row.ordinalPosition, index + 1) || row.columnName !== spec.name || row.dataType !== spec.type.split("(")[0]
    || row.isNullable !== (spec.nullable ? "YES" : "NO") || !boundedField(row, "columnType") || !boundedField(row, "columnDefault") || !boundedField(row, "generationExpression")
    || row.generationExpression !== "" || typeof row.extra !== "string") return false;
  if (spec.type === "int" ? !/^int(?:\(11\))?$/u.test(row.columnType) : row.columnType !== spec.type) return false;
  if (spec.auto ? row.extra !== "auto_increment" : spec.timestampDefault
    ? !(spec.timestampUpdate ? /^(?:DEFAULT_GENERATED )?on update CURRENT_TIMESTAMP(?:\(\))?$/iu : /^(?:DEFAULT_GENERATED)?$/iu).test(row.extra)
    : row.extra !== "") return false;
  if (spec.timestampDefault ? !timestampDefault(row.columnDefault) : row.columnDefault !== null) return false;
  const text = /^(?:(?:var)?char\(|enum\()/u.test(spec.type), length = /^(?:var)?char\((\d+)\)$/u.exec(spec.type);
  const enumLength = spec.type.startsWith("enum(") ? Math.max(...[...spec.type.matchAll(/'([a-z_]+)'/gu)].map(match => match[1].length)) : null;
  if (row.collationName !== (text ? "utf8mb4_bin" : null) || row.characterSetName !== (text ? "utf8mb4" : null)) return false;
  const maxLength = length ? Number(length[1]) : enumLength ?? (spec.type === "mediumblob" ? 16777215 : null);
  if (maxLength === null ? row.characterMaximumLength !== null : !numberIs(row.characterMaximumLength, maxLength)) return false;
  if (spec.type === "int" ? !numberIs(row.numericPrecision, 10) || !numberIs(row.numericScale, 0) : row.numericPrecision !== null || row.numericScale !== null) return false;
  const precision = spec.type === "datetime(3)" ? 3 : spec.type === "timestamp" ? 0 : null;
  return precision === null ? row.datetimePrecision === null : numberIs(row.datetimePrecision, precision);
}
function assessTable(definition, raw) {
  const base = { name: definition.name, fileName: definition.fileName, status: "compatible", reasons: [] };
  const reject = reason => { base.status = "conflict"; base.reasons.push(reason); };
  const table = raw.tables.find(row => row.tableName === definition.name);
  if (!table) return { ...base, status: "absent" };
  if (table.tableType !== "BASE TABLE" || table.engine !== "InnoDB" || table.collationName !== "utf8mb4_bin"
    || table.rowFormat !== "Dynamic" || table.createOptions !== "") reject("table_storage_or_options");
  const columns = raw.columns.filter(row => row.tableName === definition.name);
  if (columns.length !== definition.columns.length || new Set(columns.map(row => row.columnName)).size !== columns.length
    || definition.columns.some((spec, i) => !columnCompatible(columns[i] ?? {}, spec, i))) reject("columns_defaults_or_nullability");
  const entries = raw.indexes.filter(row => row.tableName === definition.name), groups = new Map();
  if (!entries.length || entries.length > 100) reject("index_budget_or_missing");
  for (const row of entries) {
    if (!identifier(row.indexName) || ![0, 1].some(value => numberIs(row.nonUnique, value)) || !integer(row.sequence) || Number(row.sequence) < 1
      || row.prefixLength !== null || row.expression !== null || !boundedField(row, "expression") || row.direction !== "A"
      || row.indexType !== "BTREE" || row.visible !== "YES" || !definition.columns.some(column => column.name === row.columnName)
      || row.nullable !== (definition.columns.find(column => column.name === row.columnName)?.nullable ? "YES" : "")) { reject("index_features_or_shape"); continue; }
    const group = groups.get(row.indexName) ?? []; group.push(row); groups.set(row.indexName, group);
  }
  const actual = [...groups.entries()].map(([name, rows]) => {
    rows.sort((a, b) => Number(a.sequence) - Number(b.sequence));
    if (rows.some((row, i) => !numberIs(row.sequence, i + 1) || Number(row.nonUnique) !== Number(rows[0].nonUnique))) reject("index_sequence_or_duplicates");
    return { name, unique: Number(rows[0].nonUnique) === 0, columns: rows.map(row => row.columnName) };
  });
  const matches = (a, b) => a.unique === b.unique && same(a.columns, b.columns) && (b.name !== "PRIMARY" || a.name === "PRIMARY");
  if (definition.indexes.some(index => !actual.some(group => matches(group, index)))) reject("required_complete_index_missing");
  if (actual.some(index => index.unique && !definition.indexes.some(required => required.unique && matches(index, required)))) reject("extra_uniqueness");
  base.reasons = [...new Set(base.reasons)]; return base;
}

function assessObjects(value, observationSha256) {
  if (value === undefined) return { status: "missing", blockers: ["target_trigger_fk_check_partition_evidence_missing"] };
  checkedJson(value, 1024 * 1024);
  insist(keys(value, ["schema", "database", "metadataObservationSha256", "complete", "tableNames", "coverage", "triggers", "foreignKeys", "checks", "partitions"])
    && value.schema === "ai-feature-target-objects/v1" && value.database === AI_FEATURE_TARGET_DATABASE
    && value.metadataObservationSha256 === observationSha256 && value.complete === true
    && Array.isArray(value.tableNames) && same([...value.tableNames].sort(), [...AI_FEATURE_TARGET_TABLES].sort())
    && keys(value.coverage, ["triggers", "foreignKeys", "checks", "partitions"])
    && value.coverage.triggers === "all_target_tables" && value.coverage.foreignKeys === "inbound_and_outbound"
    && value.coverage.checks === "all_target_tables" && value.coverage.partitions === "all_target_tables", "OBJECT_EVIDENCE_INCOMPLETE");
  const blockers = [];
  for (const kind of ["triggers", "foreignKeys", "checks", "partitions"]) {
    insist(Array.isArray(value[kind]) && value[kind].length <= 1000 && value[kind].every(row => plain(row)
      && (TARGETS.has(row.tableName) || kind === "foreignKeys" && TARGETS.has(row.referencedTableName))), "OBJECT_EVIDENCE_SCOPE");
    if (value[kind].length) blockers.push(`target_${kind}_require_review`);
  }
  return { status: blockers.length ? "conflict" : "observed_empty", blockers };
}

/** Inputs are collected facts, not authority. Compatible means ONLY these eight
 * table structures match. No rows, ledger, current auth tables, model approvals,
 * FK/trigger immutability or application readiness are proven by this planner.
 * objectEvidence must be separately collected for inbound/outbound FKs, triggers,
 * CHECK constraints and actual named partitions (not MySQL's unpartitioned row).
 */
export function planAiFeatureTargetSchema({ metadataReceipt, sources, objectEvidence }) {
  const definitions = deriveAiFeatureTargetDefinitions(sources);
  const { raw, identity, observationSha256 } = observationOf(metadataReceipt);
  const tables = definitions.map(definition => assessTable(definition, raw));
  const objects = assessObjects(objectEvidence, observationSha256);
  const hasConflict = tables.some(table => table.status === "conflict") || objects.status === "conflict";
  const absent = tables.filter(table => table.status === "absent");
  const structureState = hasConflict ? "conflict" : absent.length === 8 ? "absent" : absent.length ? "partial" : "compatible";
  const state = hasConflict ? "conflict" : objects.status === "missing" ? "evidence_required" : structureState;
  // Planning is separate from execution admission: retain exact missing-table
  // CREATE proposals even when another table conflicts or object facts are
  // missing. They are NOT an executable batch or adoption of a partial install.
  const statements = definitions.filter(definition => absent.some(table => table.name === definition.name))
    .map(({ name, fileName, sourceSha256, statementSha256, sql }) => ({ tableName: name, fileName, sourceSha256, statementSha256, sql }));
  return {
    schema: "ai-feature-target-schema-plan/v1", database: AI_FEATURE_TARGET_DATABASE, identity, observationSha256,
    sources: AI_FEATURE_TARGET_SOURCES.map(({ fileName, sha256 }) => ({ fileName, sha256 })),
    state, structureState, tables, objectEvidence: objects, statements,
    executionEligibility: hasConflict ? "conflict" : objects.status === "missing" ? "evidence_required" : "not_approved",
    executable: false, productionApproved: false, databaseExecutionAuthorized: false, provenanceAuthenticated: false,
    ledgerRegistration: "unchanged", historicalReferenceChanged: false,
    remainingGates: ["Authenticate current target, complete metadata, SQL source and object-evidence provenance before any separately approved apply.",
      "Reconcile the real migration ledger, existing data and any partial installation; this planner never adopts or backfills it.",
      "Metadata observations are not atomic DDL snapshots and do not prove triggers or foreign keys stayed unchanged.",
      "Recheck exact before-state under a separately controlled deployment boundary; unknown or partial DDL outcomes require reconciliation.",
      "Verify transactional auth/support schemas, backup/restore and feature-specific native behavior; eight-table compatibility is not runtime readiness.",
      "Keep writes/workers/source approvals separately gated; no model call, configuration seed or public feature activation is authorized."],
  };
}
