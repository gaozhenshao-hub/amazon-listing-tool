// Metadata-only collector. No dotenv, application modules, migrations or file output.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_ROWS = 50_000;
const QUERY_TIMEOUT_MS = 5000;
const RUN_TIMEOUT_MS = 120_000;
const requireSafe = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const errorCode = error => ({ code: /^[A-Z][A-Z0-9_]{1,80}$/.test(String(error?.code ?? "")) ? error.code : "SCHEMA_INSPECTION_FAILED" });
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const spec = (fields, sql) => Object.freeze({ fields: Object.freeze(fields.split(" ")), sql: `${sql} LIMIT ${MAX_ROWS + 1}` });

// Every catalog SELECT is pinned here and binds the exact expected schema. Do
// not select comments, data counts, raw defaults, enum members or expressions.
export const METADATA_SELECTS = Object.freeze({
  schema: spec("schemaName characterSetName collationName", `SELECT SCHEMA_NAME AS schemaName,
    DEFAULT_CHARACTER_SET_NAME AS characterSetName, DEFAULT_COLLATION_NAME AS collationName
    FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME = BINARY ? ORDER BY SCHEMA_NAME`),
  tables: spec("tableName tableType engine collationName rowFormat", `SELECT TABLE_NAME AS tableName,
    TABLE_TYPE AS tableType, ENGINE AS engine, TABLE_COLLATION AS collationName, ROW_FORMAT AS rowFormat
    FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA = BINARY ? ORDER BY BINARY TABLE_NAME`),
  columns: spec("tableName columnName ordinalPosition dataType typeShape enumMembersRedacted nullable characterMaximumLength numericPrecision numericScale datetimePrecision characterSetName collationName columnKey extra defaultKind generationExpressionPresent srsId", `SELECT
    TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, DATA_TYPE AS dataType,
    CASE WHEN DATA_TYPE IN ('enum','set') THEN DATA_TYPE ELSE COLUMN_TYPE END AS typeShape,
    CASE WHEN DATA_TYPE IN ('enum','set') THEN 1 ELSE 0 END AS enumMembersRedacted,
    IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength,
    NUMERIC_PRECISION AS numericPrecision, NUMERIC_SCALE AS numericScale, DATETIME_PRECISION AS datetimePrecision,
    CHARACTER_SET_NAME AS characterSetName, COLLATION_NAME AS collationName, COLUMN_KEY AS columnKey, EXTRA AS extra,
    CASE WHEN COLUMN_DEFAULT IS NULL THEN 'NULL_OR_ABSENT'
      WHEN EXTRA LIKE '%DEFAULT_GENERATED%' THEN 'EXPRESSION_REDACTED' ELSE 'LITERAL_REDACTED' END AS defaultKind,
    CASE WHEN GENERATION_EXPRESSION IS NULL OR GENERATION_EXPRESSION = '' THEN 0 ELSE 1 END AS generationExpressionPresent,
    SRS_ID AS srsId FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA = BINARY ?
    ORDER BY BINARY TABLE_NAME, ORDINAL_POSITION`),
  indexes: spec("tableName indexName nonUnique sequence columnName direction prefixLength nullable indexType visible expressionPresent", `SELECT
    TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence,
    COLUMN_NAME AS columnName, COLLATION AS direction, SUB_PART AS prefixLength, NULLABLE AS nullable,
    INDEX_TYPE AS indexType, IS_VISIBLE AS visible, CASE WHEN EXPRESSION IS NULL THEN 0 ELSE 1 END AS expressionPresent
    FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA = BINARY ?
    ORDER BY BINARY TABLE_NAME, BINARY INDEX_NAME, SEQ_IN_INDEX`),
  constraints: spec("tableName constraintName constraintType enforced", `SELECT TABLE_NAME AS tableName,
    CONSTRAINT_NAME AS constraintName, CONSTRAINT_TYPE AS constraintType, ENFORCED AS enforced
    FROM information_schema.TABLE_CONSTRAINTS WHERE BINARY TABLE_SCHEMA = BINARY ? AND BINARY CONSTRAINT_SCHEMA = BINARY ?
    ORDER BY BINARY TABLE_NAME, BINARY CONSTRAINT_NAME`),
  keyColumns: spec("tableName constraintName columnName ordinalPosition uniqueConstraintPosition referencedSchemaScope referencedTableName referencedColumnName", `SELECT
    TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
    ORDINAL_POSITION AS ordinalPosition, POSITION_IN_UNIQUE_CONSTRAINT AS uniqueConstraintPosition,
    CASE WHEN REFERENCED_TABLE_SCHEMA IS NULL THEN NULL WHEN BINARY REFERENCED_TABLE_SCHEMA = BINARY ? THEN 'target' ELSE 'external' END AS referencedSchemaScope,
    CASE WHEN BINARY REFERENCED_TABLE_SCHEMA = BINARY ? THEN REFERENCED_TABLE_NAME ELSE NULL END AS referencedTableName,
    CASE WHEN BINARY REFERENCED_TABLE_SCHEMA = BINARY ? THEN REFERENCED_COLUMN_NAME ELSE NULL END AS referencedColumnName
    FROM information_schema.KEY_COLUMN_USAGE WHERE BINARY TABLE_SCHEMA = BINARY ? AND BINARY CONSTRAINT_SCHEMA = BINARY ?
    ORDER BY BINARY TABLE_NAME, BINARY CONSTRAINT_NAME, ORDINAL_POSITION`),
  foreignKeys: spec("tableName constraintName referencedSchemaScope referencedTableName uniqueConstraintName matchOption updateRule deleteRule", `SELECT
    TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
    CASE WHEN BINARY UNIQUE_CONSTRAINT_SCHEMA = BINARY ? THEN 'target' ELSE 'external' END AS referencedSchemaScope,
    CASE WHEN BINARY UNIQUE_CONSTRAINT_SCHEMA = BINARY ? THEN REFERENCED_TABLE_NAME ELSE NULL END AS referencedTableName,
    CASE WHEN BINARY UNIQUE_CONSTRAINT_SCHEMA = BINARY ? THEN UNIQUE_CONSTRAINT_NAME ELSE NULL END AS uniqueConstraintName,
    MATCH_OPTION AS matchOption, UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule
    FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE BINARY CONSTRAINT_SCHEMA = BINARY ?
    ORDER BY BINARY TABLE_NAME, BINARY CONSTRAINT_NAME`),
  checks: spec("tableName constraintName expressionPresent", `SELECT t.TABLE_NAME AS tableName,
    t.CONSTRAINT_NAME AS constraintName, CASE WHEN c.CHECK_CLAUSE IS NULL OR c.CHECK_CLAUSE = '' THEN 0 ELSE 1 END AS expressionPresent
    FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c
      ON BINARY t.CONSTRAINT_SCHEMA = BINARY c.CONSTRAINT_SCHEMA AND BINARY t.CONSTRAINT_NAME = BINARY c.CONSTRAINT_NAME
    WHERE BINARY t.TABLE_SCHEMA = BINARY ? AND BINARY t.CONSTRAINT_SCHEMA = BINARY ? AND t.CONSTRAINT_TYPE = 'CHECK'
    ORDER BY BINARY t.TABLE_NAME, BINARY t.CONSTRAINT_NAME`),
  partitions: spec("tableName partitionName subpartitionName ordinalPosition subpartitionOrdinalPosition method subpartitionMethod expressionPresent subpartitionExpressionPresent boundaryRedacted", `SELECT
    TABLE_NAME AS tableName, PARTITION_NAME AS partitionName, SUBPARTITION_NAME AS subpartitionName,
    PARTITION_ORDINAL_POSITION AS ordinalPosition, SUBPARTITION_ORDINAL_POSITION AS subpartitionOrdinalPosition,
    PARTITION_METHOD AS method, SUBPARTITION_METHOD AS subpartitionMethod,
    CASE WHEN PARTITION_EXPRESSION IS NULL OR PARTITION_EXPRESSION = '' THEN 0 ELSE 1 END AS expressionPresent,
    CASE WHEN SUBPARTITION_EXPRESSION IS NULL OR SUBPARTITION_EXPRESSION = '' THEN 0 ELSE 1 END AS subpartitionExpressionPresent,
    CASE WHEN PARTITION_DESCRIPTION IS NULL THEN 0 ELSE 1 END AS boundaryRedacted
    FROM information_schema.PARTITIONS WHERE BINARY TABLE_SCHEMA = BINARY ? AND PARTITION_NAME IS NOT NULL
    ORDER BY BINARY TABLE_NAME, PARTITION_ORDINAL_POSITION, SUBPARTITION_ORDINAL_POSITION`),
});

export const TARGET_INDEXES = Object.freeze([
  Object.freeze({ tableName: "knowledge_distillation_evidence", indexName: "uq_kdistill_evidence_project_source_claim" }),
  Object.freeze({ tableName: "emperor_scheduled_tasks", indexName: "uk_emperor_scheduled_tasks_external_task_uid" }),
  Object.freeze({ tableName: "emperor_scheduled_tasks", indexName: "idx_emperor_scheduled_tasks_workspace_managed" }),
]);
const TARGET_MIGRATIONS = new Set(["0180_emperor_lingxing_scheduled_task_unification.sql", "0187_skill_distillation_foundation.sql"]);

export function validateSchema(schema) {
  requireSafe(typeof schema === "string" && /^[A-Za-z0-9_]{1,64}$/.test(schema)
    && !["mysql", "sys", "information_schema", "performance_schema"].includes(schema.toLowerCase()), "INVALID_EXPECTED_SCHEMA");
  return schema;
}

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--inspect-read-only" && !options.inspectReadOnly) options.inspectReadOnly = true;
    else if (name === "--summary" && !options.summary) options.summary = true;
    else if (name === "--expected-schema" && !Object.hasOwn(options, "expectedSchema")) options.expectedSchema = validateSchema(args[++index]);
    else requireSafe(false, "INVALID_ARGUMENTS");
  }
  requireSafe(options.inspectReadOnly && options.expectedSchema, "EXPLICIT_READ_ONLY_SCOPE_REQUIRED");
  return options;
}

// mysql2 fills false-valued options from URI parameters. Reject control and
// unknown parameters before loading it, including debug options that can log.
export function validateManagedUri(uri, schema) {
  let parsed;
  try { parsed = new URL(uri); }
  catch { requireSafe(false, "MANAGED_DATABASE_URL_INVALID"); }
  requireSafe(parsed.protocol === "mysql:" && parsed.hostname && !parsed.hash, "MANAGED_DATABASE_URL_INVALID");
  let database;
  try { database = decodeURIComponent(parsed.pathname.slice(1)); }
  catch { requireSafe(false, "MANAGED_DATABASE_URL_INVALID"); }
  requireSafe(database === schema, "MANAGED_DATABASE_URL_SCHEMA_MISMATCH");
  const seen = new Set();
  for (const [key, value] of parsed.searchParams) {
    requireSafe(["ssl", "charset", "timezone"].includes(key) && !seen.has(key), "MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED");
    seen.add(key);
    let decoded = value;
    try { decoded = JSON.parse(value); } catch { /* mysql2 also accepts plain values. */ }
    if (key === "charset") requireSafe(typeof decoded === "string" && /^[A-Za-z0-9_]+$/.test(decoded), "MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED");
    if (key === "timezone") requireSafe(typeof decoded === "string" && /^(?:local|Z|[ +-]\d\d:\d\d)$/.test(decoded), "MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED");
    if (key === "ssl") requireSafe(decoded === null || decoded === false || decoded === "Amazon RDS"
      || (decoded && typeof decoded === "object" && !Array.isArray(decoded)), "MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED");
  }
}

function projectRows(rows, fields) {
  requireSafe(Array.isArray(rows) && rows.length <= MAX_ROWS, "METADATA_ROW_LIMIT_OR_SHAPE_INVALID");
  return rows.map(row => {
    requireSafe(row && fields.every(field => Object.hasOwn(row, field)), "METADATA_FIELD_MISSING");
    return Object.fromEntries(fields.map(field => {
      const value = row[field];
      requireSafe(value === null || ["string", "number", "boolean"].includes(typeof value), "METADATA_VALUE_INVALID");
      return [field, value];
    }));
  });
}

async function collect(query, schema) {
  const metadata = {};
  for (const [name, definition] of Object.entries(METADATA_SELECTS)) {
    const [rows] = await query(definition.sql, Array((definition.sql.match(/\?/g) ?? []).length).fill(schema));
    metadata[name] = projectRows(rows, definition.fields);
  }
  requireSafe(metadata.schema.length === 1 && metadata.schema[0].schemaName === schema, "TARGET_SCHEMA_NOT_VISIBLE");
  const table = metadata.tables.find(row => row.tableName === "app_schema_migrations");
  const ledger = { present: Boolean(table), rows: [] };
  if (table) {
    requireSafe(table.tableType === "BASE TABLE", "LEDGER_MUST_BE_BASE_TABLE");
    const columns = new Set(metadata.columns.filter(row => row.tableName === table.tableName).map(row => row.columnName.toLowerCase()));
    requireSafe(["migrationname", "checksum", "status"].every(column => columns.has(column)), "LEDGER_FIELDS_MISSING");
    const [rows] = await query(`SELECT migrationName, checksum, status FROM \`${schema}\`.\`app_schema_migrations\` ORDER BY BINARY migrationName LIMIT ${MAX_ROWS + 1}`);
    ledger.rows = projectRows(rows, ["migrationName", "checksum", "status"]);
  }
  return { metadata, ledger };
}

export function summarize(receipt) {
  const { metadata, ledger, ...base } = receipt;
  if (!metadata) return { ...base, summary: true };
  return { ...base, summary: true,
    counts: Object.fromEntries(Object.entries(metadata).map(([name, rows]) => [name, rows.length])),
    targetColumns: [...new Set(TARGET_INDEXES.map(item => item.tableName))].map(tableName => ({ tableName,
      present: metadata.tables.some(row => row.tableName === tableName), columns: metadata.columns.filter(row => row.tableName === tableName) })),
    targetIndexes: TARGET_INDEXES.map(target => ({ ...target,
      present: metadata.indexes.some(row => row.tableName === target.tableName && row.indexName === target.indexName),
      columns: metadata.indexes.filter(row => row.tableName === target.tableName && row.indexName === target.indexName) })),
    ledger: { present: ledger.present, rowCount: ledger.rows.length,
      targets: ledger.rows.filter(row => TARGET_MIGRATIONS.has(row.migrationName)) },
  };
}

async function loadConnector() { return (await import("mysql2/promise")).createConnection; }

export async function inspectProductionSchema(options, { environment = process.env, load = loadConnector } = {}) {
  requireSafe(options.inspectReadOnly === true, "EXPLICIT_READ_ONLY_SCOPE_REQUIRED");
  const schema = validateSchema(options.expectedSchema);
  requireSafe(typeof environment.DATABASE_URL === "string" && environment.DATABASE_URL.trim().length > 0, "MANAGED_DATABASE_ENV_REQUIRED");
  validateManagedUri(environment.DATABASE_URL, schema);
  const receipt = { formatVersion: 1, mode: "read-only-schema-metadata", expectedSchema: schema,
    startedAt: new Date().toISOString(), status: "running", stable: null, businessRowsRead: false, writesPerformed: false,
    limitations: ["Only metadata visible to the existing managed account is collected; privileges are not changed.",
      "Default literals, enum/set members, expressions, comments and cross-schema reference identities are redacted.",
      "NULL_OR_ABSENT cannot distinguish an omitted default from an explicit NULL default.",
      "Equal hashes compare redacted observations, not a full schema backup or literal/semantic equivalence.",
      "Two separate read-only transactions detect observed changes but cannot guarantee an atomic DDL snapshot.",
      "No migration manifest comparison, baseline, repair, business data, or SQL replay is performed."] };
  let raw, inTransaction = false;
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  const query = async (sql, values = []) => {
    const remaining = deadline - Date.now();
    requireSafe(remaining > 0, "INSPECTION_DEADLINE_EXCEEDED");
    return raw.query({ sql, timeout: Math.min(QUERY_TIMEOUT_MS, remaining) }, values);
  };
  try {
    const createConnection = await load();
    raw = await createConnection({ uri: environment.DATABASE_URL, multipleStatements: false, connectTimeout: 5000, rowsAsArray: false });
    const [identity] = await query("SELECT DATABASE() AS schemaName, @@version AS version, @@lower_case_table_names AS lowerCaseTableNames, @@sql_mode AS sqlMode");
    requireSafe(identity?.[0]?.schemaName === schema, "CONNECTED_SCHEMA_MISMATCH");
    requireSafe(/^8\.\d+\.\d+(?:[-+.][A-Za-z0-9_.-]+)?$/.test(String(identity[0].version))
      && !/mariadb/i.test(identity[0].version), "MYSQL_8_REQUIRED");
    requireSafe(/^[012]$/.test(String(identity[0].lowerCaseTableNames)) && typeof identity[0].sqlMode === "string", "SERVER_METADATA_INVALID");
    receipt.server = { version: identity[0].version, lowerCaseTableNames: Number(identity[0].lowerCaseTableNames), sqlMode: identity[0].sqlMode };
    await query("SET SESSION TRANSACTION READ ONLY");
    await query("SET SESSION MAX_EXECUTION_TIME = 5000");
    await query("SET SESSION lock_wait_timeout = 5");
    const snapshots = [];
    for (let pass = 0; pass < 2; pass += 1) {
      // Separate transactions are intentional: one repeatable-read transaction
      // would hide ledger changes between the two observations.
      inTransaction = true;
      await query("START TRANSACTION READ ONLY");
      snapshots.push(await collect(query, schema));
      await query("ROLLBACK");
      inTransaction = false;
    }
    receipt.hashes = { first: hash(snapshots[0]), second: hash(snapshots[1]) };
    receipt.stable = receipt.hashes.first === receipt.hashes.second;
    receipt.status = receipt.stable ? "completed" : "changed";
    Object.assign(receipt, snapshots[1]);
  } catch (error) {
    receipt.status = "failed"; receipt.error = errorCode(error);
  } finally {
    if (raw) {
      if (inTransaction) {
        try { await query("ROLLBACK"); }
        catch (error) { receipt.cleanupError = errorCode(error); receipt.status = "failed"; }
      }
      try { raw.destroy(); }
      catch (error) { receipt.cleanupError = errorCode(error); receipt.status = "failed"; }
    }
    receipt.finishedAt = new Date().toISOString();
  }
  return options.summary ? summarize(receipt) : receipt;
}

export async function main(args, { dependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const receipt = await inspectProductionSchema(parseArguments(args), dependencies);
    stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return receipt.status === "completed" && receipt.stable === true ? 0 : receipt.status === "changed" ? 2 : 1;
  } catch (error) {
    stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: errorCode(error) })}\n`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main(process.argv.slice(2));
