// Explicit schema-only export. Importing is inert: no dotenv, connector or files.
// Raw SHOW CREATE/default/comment text is private and must never reach stdout.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManagedUri, validateSchema } from "./readProductionSchema.mjs";
import { sqlOperationText } from "./mysqlRehearsal.mjs";

const MAX_ROWS = 100_000, MAX_TABLES = 1_000, MAX_BYTES = 64 * 1024 * 1024;
const QUERY_TIMEOUT = 5_000, RUN_TIMEOUT = 180_000;
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const requireSafe = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const sha256 = value => createHash("sha256").update(value).digest("hex");
const jsonHash = value => sha256(JSON.stringify(value));
const safeError = error => ({ code: /^[A-Z][A-Z0-9_]{1,80}$/.test(String(error?.code ?? "")) ? error.code : "DDL_EXPORT_FAILED" });
const spec = (fields, sql) => Object.freeze({ fields: Object.freeze(fields.split(" ")), sql: `${sql} LIMIT ${MAX_ROWS + 1}` });
export const IDENTITY_SQL = "SELECT DATABASE() AS schemaName, @@version AS version, @@lower_case_table_names AS lowerCaseTableNames, @@sql_mode AS sqlMode, @@sql_quote_show_create AS quoteShowCreate";

// All catalog reads are fixed and bind only the exact expected schema. No
// business-table SELECT, migration-ledger rows, grants, secret storage or body
// reads of unsupported executable objects are allowed.
export const DDL_CATALOG = Object.freeze({
  schema: spec("schemaName characterSetName collationName defaultEncryption", `SELECT SCHEMA_NAME AS schemaName, DEFAULT_CHARACTER_SET_NAME AS characterSetName, DEFAULT_COLLATION_NAME AS collationName, DEFAULT_ENCRYPTION AS defaultEncryption FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ? ORDER BY BINARY SCHEMA_NAME`),
  tables: spec("tableName tableType engine version rowFormat autoIncrement collationName createOptions tableComment", `SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine, VERSION AS version, ROW_FORMAT AS rowFormat, AUTO_INCREMENT AS autoIncrement, TABLE_COLLATION AS collationName, CREATE_OPTIONS AS createOptions, TABLE_COMMENT AS tableComment FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME`),
  columns: spec("tableName columnName ordinalPosition columnDefault isNullable dataType columnType characterMaximumLength characterOctetLength numericPrecision numericScale datetimePrecision characterSetName collationName columnKey extra columnComment generationExpression srsId", `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, COLUMN_DEFAULT AS columnDefault, IS_NULLABLE AS isNullable, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength, CHARACTER_OCTET_LENGTH AS characterOctetLength, NUMERIC_PRECISION AS numericPrecision, NUMERIC_SCALE AS numericScale, DATETIME_PRECISION AS datetimePrecision, CHARACTER_SET_NAME AS characterSetName, COLLATION_NAME AS collationName, COLUMN_KEY AS columnKey, EXTRA AS extra, COLUMN_COMMENT AS columnComment, GENERATION_EXPRESSION AS generationExpression, SRS_ID AS srsId FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME, ORDINAL_POSITION`),
  indexes: spec("tableName indexName nonUnique sequence columnName direction prefixLength packed nullable indexType comment indexComment visible expression", `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName, COLLATION AS direction, SUB_PART AS prefixLength, PACKED AS packed, NULLABLE AS nullable, INDEX_TYPE AS indexType, COMMENT AS comment, INDEX_COMMENT AS indexComment, IS_VISIBLE AS visible, EXPRESSION AS expression FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME, BINARY INDEX_NAME, SEQ_IN_INDEX`),
  constraints: spec("tableName constraintName constraintType enforced", `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, CONSTRAINT_TYPE AS constraintType, ENFORCED AS enforced FROM information_schema.TABLE_CONSTRAINTS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY CONSTRAINT_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME, BINARY CONSTRAINT_NAME`),
  keyColumns: spec("tableName constraintName columnName ordinalPosition uniqueConstraintPosition referencedTableSchema referencedTableName referencedColumnName", `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, POSITION_IN_UNIQUE_CONSTRAINT AS uniqueConstraintPosition, REFERENCED_TABLE_SCHEMA AS referencedTableSchema, REFERENCED_TABLE_NAME AS referencedTableName, REFERENCED_COLUMN_NAME AS referencedColumnName FROM information_schema.KEY_COLUMN_USAGE WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY CONSTRAINT_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME, BINARY CONSTRAINT_NAME, ORDINAL_POSITION`),
  foreignKeys: spec("tableName constraintName uniqueConstraintSchema uniqueConstraintName referencedTableName matchOption updateRule deleteRule", `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, UNIQUE_CONSTRAINT_SCHEMA AS uniqueConstraintSchema, UNIQUE_CONSTRAINT_NAME AS uniqueConstraintName, REFERENCED_TABLE_NAME AS referencedTableName, MATCH_OPTION AS matchOption, UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE BINARY CONSTRAINT_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME, BINARY CONSTRAINT_NAME`),
  checks: spec("tableName constraintName checkClause", `SELECT t.TABLE_NAME AS tableName, t.CONSTRAINT_NAME AS constraintName, c.CHECK_CLAUSE AS checkClause FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON BINARY t.CONSTRAINT_SCHEMA=BINARY c.CONSTRAINT_SCHEMA AND BINARY t.CONSTRAINT_NAME=BINARY c.CONSTRAINT_NAME WHERE BINARY t.TABLE_SCHEMA=BINARY ? AND BINARY t.CONSTRAINT_SCHEMA=BINARY ? AND t.CONSTRAINT_TYPE='CHECK' ORDER BY BINARY t.TABLE_NAME, BINARY t.CONSTRAINT_NAME`),
  partitions: spec("tableName partitionName", `SELECT TABLE_NAME AS tableName, PARTITION_NAME AS partitionName FROM information_schema.PARTITIONS WHERE BINARY TABLE_SCHEMA=BINARY ? AND PARTITION_NAME IS NOT NULL ORDER BY BINARY TABLE_NAME, PARTITION_ORDINAL_POSITION`),
  views: spec("tableName", `SELECT TABLE_NAME AS tableName FROM information_schema.VIEWS WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME`),
  triggers: spec("triggerName tableName", `SELECT TRIGGER_NAME AS triggerName, EVENT_OBJECT_TABLE AS tableName FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA=BINARY ? ORDER BY BINARY TRIGGER_NAME`),
  routines: spec("routineName routineType", `SELECT ROUTINE_NAME AS routineName, ROUTINE_TYPE AS routineType FROM information_schema.ROUTINES WHERE BINARY ROUTINE_SCHEMA=BINARY ? ORDER BY BINARY ROUTINE_NAME, ROUTINE_TYPE`),
  events: spec("eventName", `SELECT EVENT_NAME AS eventName FROM information_schema.EVENTS WHERE BINARY EVENT_SCHEMA=BINARY ? ORDER BY BINARY EVENT_NAME`),
});

const DATA_TYPES = new Set("tinyint smallint mediumint int bigint decimal float double bit date datetime timestamp time year char varchar binary varbinary tinyblob blob mediumblob longblob tinytext text mediumtext longtext enum set json".split(" "));
function projectRows(rows, fields) {
  requireSafe(Array.isArray(rows) && rows.length <= MAX_ROWS, "CATALOG_ROW_BOUND_OR_SHAPE_INVALID");
  return rows.map(row => {
    requireSafe(row && fields.every(field => Object.hasOwn(row, field)), "CATALOG_FIELD_MISSING");
    return Object.fromEntries(fields.map(field => {
      const value = row[field];
      requireSafe(value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value)), "CATALOG_VALUE_UNSUPPORTED");
      return [field, value];
    }));
  });
}

export function validateCatalog(catalog, schema) {
  requireSafe(catalog.schema.length === 1 && catalog.schema[0].schemaName === schema, "SCHEMA_NOT_VISIBLE");
  requireSafe(catalog.schema[0].defaultEncryption === "NO" || catalog.schema[0].defaultEncryption === "N", "SCHEMA_ENCRYPTION_UNSUPPORTED");
  for (const collection of ["views", "triggers", "routines", "events", "partitions"]) {
    requireSafe(catalog[collection].length === 0, `UNSUPPORTED_${collection.toUpperCase()}`);
  }
  requireSafe(catalog.tables.length > 0 && catalog.tables.length <= MAX_TABLES, "TABLE_COUNT_OUT_OF_SCOPE");
  const tables = new Set();
  for (const row of catalog.tables) {
    requireSafe(identifier.test(row.tableName) && !tables.has(row.tableName), "TABLE_IDENTIFIER_OR_DUPLICATE_INVALID");
    tables.add(row.tableName);
    requireSafe(row.tableType === "BASE TABLE" && row.engine === "InnoDB"
      && ["Dynamic", "Compact", "Redundant", "Compressed"].includes(row.rowFormat), "TABLE_STRUCTURE_UNSUPPORTED");
  }
  for (const collection of ["columns", "indexes", "constraints", "keyColumns", "foreignKeys", "checks"]) {
    requireSafe(catalog[collection].every(row => tables.has(row.tableName)), "CATALOG_TABLE_SCOPE_MISMATCH");
  }
  for (const tableName of tables) {
    const columns = catalog.columns.filter(row => row.tableName === tableName);
    requireSafe(columns.length > 0 && new Set(columns.map(row => row.columnName)).size === columns.length
      && columns.every((row, index) => Number(row.ordinalPosition) === index + 1), "COLUMN_CATALOG_INCOMPLETE");
  }
  requireSafe(catalog.columns.every(row => DATA_TYPES.has(row.dataType) && row.srsId === null), "COLUMN_STRUCTURE_UNSUPPORTED");
  for (const row of catalog.keyColumns) {
    requireSafe(row.referencedTableSchema === null || (row.referencedTableSchema === schema && tables.has(row.referencedTableName)), "EXTERNAL_OR_MISSING_FOREIGN_KEY_TARGET");
  }
  for (const row of catalog.foreignKeys) {
    requireSafe(row.uniqueConstraintSchema === schema && tables.has(row.referencedTableName), "EXTERNAL_OR_MISSING_FOREIGN_KEY_TARGET");
  }
  return tables;
}

export function validateTableDdl(sql, tableName) {
  requireSafe(identifier.test(tableName) && typeof sql === "string" && Buffer.byteLength(sql) <= 4 * 1024 * 1024
    && sql.startsWith(`CREATE TABLE \`${tableName}\` (`), "SHOW_CREATE_SHAPE_UNSUPPORTED");
  const operations = sqlOperationText(sql);
  requireSafe(!operations.includes(";"), "MULTI_STATEMENT_DDL_FORBIDDEN");
  const scoped = operations.replace(/^CREATE\s+TABLE\b/i, "")
    .replace(/\bON\s+(?:UPDATE|DELETE)\s+(?:CURRENT_TIMESTAMP(?:\s*\(\s*\d*\s*\))?|CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT)\b/gi, " ");
  requireSafe(!/\b(?:TABLESPACE|CONNECTION|SECONDARY_ENGINE|ENGINE_ATTRIBUTE|SECONDARY_ENGINE_ATTRIBUTE|ENCRYPTION)\b|\b(?:DATA|INDEX)\s+DIRECTORY\b|\bPARTITION\s+BY\b|\bWITH\s+PARSER\b|\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|GRANT|REVOKE|LOAD|CALL|USE)\b/i.test(scoped), "DDL_EXTERNAL_OR_EXECUTABLE_FEATURE_UNSUPPORTED");
  return { tableName, ddl: sql, sha256: sha256(sql) };
}

function validateIdentity(row, schema) {
  requireSafe(row?.schemaName === schema, "CONNECTED_SCHEMA_MISMATCH");
  requireSafe(/^8\.\d+\.\d+(?:[-+.][A-Za-z0-9_.-]+)?$/.test(String(row.version)) && !/mariadb/i.test(row.version), "MYSQL_8_REQUIRED");
  requireSafe(/^[012]$/.test(String(row.lowerCaseTableNames)) && typeof row.sqlMode === "string"
    && Number(row.quoteShowCreate) === 1 && !row.sqlMode.split(",").includes("NO_BACKSLASH_ESCAPES"), "SERVER_RENDERING_UNSUPPORTED");
  return { version: row.version, lowerCaseTableNames: Number(row.lowerCaseTableNames), sqlMode: row.sqlMode, quoteShowCreate: 1 };
}

async function collectSnapshot(query, schema, server) {
  const catalog = {};
  for (const [name, definition] of Object.entries(DDL_CATALOG)) {
    const [rows] = await query(definition.sql, Array((definition.sql.match(/\?/g) ?? []).length).fill(schema));
    catalog[name] = projectRows(rows, definition.fields);
  }
  const tableNames = validateCatalog(catalog, schema), tables = [];
  for (const tableName of tableNames) {
    const [rows] = await query(`SHOW CREATE TABLE \`${schema}\`.\`${tableName}\``);
    requireSafe(Array.isArray(rows) && rows.length === 1 && rows[0].Table === tableName, "SHOW_CREATE_IDENTITY_MISMATCH");
    tables.push(validateTableDdl(rows[0]["Create Table"], tableName));
  }
  const snapshot = { schema, server, catalog, tables };
  requireSafe(Buffer.byteLength(JSON.stringify(snapshot)) <= MAX_BYTES, "PRIVATE_EXPORT_SIZE_EXCEEDED");
  return snapshot;
}

async function loadConnector() { return (await import("mysql2/promise")).createConnection; }

// The raw artifact is intentionally returned only to a trusted in-process caller.
// Never text()/console.log() this return value or upload it to a public repository.
export async function collectProductionDdl(options, { environment = process.env, load = loadConnector } = {}) {
  requireSafe(options.exportReadOnly === true, "EXPLICIT_READ_ONLY_EXPORT_REQUIRED");
  const schema = validateSchema(options.expectedSchema);
  requireSafe(typeof environment.DATABASE_URL === "string" && environment.DATABASE_URL.length > 0, "MANAGED_DATABASE_ENV_REQUIRED");
  validateManagedUri(environment.DATABASE_URL, schema);
  const receipt = { formatVersion: 1, mode: "private-read-only-production-ddl", status: "running", stable: false,
    startedAt: new Date().toISOString(), expectedSchema: schema, businessRowsRead: false, databaseWrites: false,
    productionApplicationFilesModified: false, filesWritten: false, replayPerformed: false, sensitiveSchemaLiteralsPrivate: true,
    limitations: ["Schema/default/comment/expression text may be sensitive; artifact must remain private.",
      "Only metadata visible to the existing managed account is observable; privileges are not changed or inferred.",
      "Two read-only observations detect changes but are not an atomic DDL backup or proof of disaster recovery.",
      "No business rows or migration-ledger rows are read; no SQL is restored, repaired, baselined or executed from the artifact.",
      "Views, triggers, routines, events, partitions, non-InnoDB tables, external foreign keys and external DDL features are unsupported and refused."] };
  let raw, transaction = false, artifact;
  const deadline = Date.now() + RUN_TIMEOUT;
  const query = async (sql, values = []) => {
    const remaining = deadline - Date.now();
    requireSafe(remaining > 0, "DDL_EXPORT_DEADLINE_EXCEEDED");
    return raw.query({ sql, timeout: Math.min(remaining, QUERY_TIMEOUT) }, values);
  };
  try {
    const createConnection = await load();
    raw = await createConnection({ uri: environment.DATABASE_URL, multipleStatements: false, rowsAsArray: false,
      connectTimeout: 5000, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, jsonStrings: true });
    const [identity] = await query(IDENTITY_SQL);
    let server = validateIdentity(identity?.[0], schema);
    await query("SET SESSION TRANSACTION READ ONLY");
    await query("SET SESSION MAX_EXECUTION_TIME = 5000");
    await query("SET SESSION lock_wait_timeout = 5");
    const snapshots = [];
    for (let pass = 0; pass < 2; pass++) {
      if (pass) { const [rows] = await query(IDENTITY_SQL); server = validateIdentity(rows?.[0], schema); }
      transaction = true;
      await query("START TRANSACTION READ ONLY");
      snapshots.push(await collectSnapshot(query, schema, server));
      await query("ROLLBACK"); transaction = false;
    }
    receipt.hashes = { first: jsonHash(snapshots[0]), second: jsonHash(snapshots[1]) };
    receipt.stable = receipt.hashes.first === receipt.hashes.second;
    if (!receipt.stable) {
      const previousDdl = new Map(snapshots[0].tables.map(table => [table.tableName, table.sha256]));
      const nextDdl = new Map(snapshots[1].tables.map(table => [table.tableName, table.sha256]));
      receipt.observedChanges = {
        catalogCollections: Object.keys(DDL_CATALOG).filter(name => jsonHash(snapshots[0].catalog[name]) !== jsonHash(snapshots[1].catalog[name])),
        ddlChangedTableCount: [...new Set([...previousDdl.keys(), ...nextDdl.keys()])].filter(name => previousDdl.get(name) !== nextDdl.get(name)).length,
        serverChanged: jsonHash(snapshots[0].server) !== jsonHash(snapshots[1].server),
      };
    }
    requireSafe(receipt.stable, "DDL_CHANGED_BETWEEN_OBSERVATIONS");
    artifact = { formatVersion: 1, kind: "private-schema-only-not-auto-replayable", ...snapshots[1] };
    receipt.server = server;
    receipt.counts = Object.fromEntries(Object.entries(artifact.catalog).map(([name, rows]) => [name, rows.length]));
    receipt.captureSha256 = jsonHash(artifact);
    receipt.status = "completed";
  } catch (error) { receipt.status = "failed"; receipt.error = safeError(error); }
  finally {
    if (raw) {
      if (transaction) {
        try { await query("ROLLBACK"); }
        catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
      }
      try { raw.destroy(); }
      catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
    }
    receipt.finishedAt = new Date().toISOString();
  }
  return { receipt, ...(receipt.status === "completed" ? { artifact } : {}) };
}

export function validatePrivateDirectory(directory, io = fs) {
  requireSafe(typeof directory === "string" && path.isAbsolute(directory) && path.normalize(directory) === directory
    && io.realpathSync(directory) === directory, "PRIVATE_DIRECTORY_MUST_BE_CANONICAL");
  const stat = io.lstatSync(directory);
  requireSafe(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o7777) === 0o700
    && (typeof process.getuid !== "function" || stat.uid === process.getuid()), "PRIVATE_DIRECTORY_OWNER_OR_MODE_INVALID");
  return { dev: stat.dev, ino: stat.ino };
}

export function writePrivateExport(result, directory, { io = fs } = {}) {
  requireSafe(result?.receipt?.status === "completed" && result.receipt.stable === true && result.artifact
    && result.receipt.captureSha256 === jsonHash(result.artifact), "ONLY_VERIFIED_STABLE_EXPORT_CAN_BE_SAVED");
  const identity = validatePrivateDirectory(directory, io);
  requireSafe(io.readdirSync(directory).length === 0, "PRIVATE_EXPORT_DIRECTORY_MUST_BE_EMPTY");
  const artifactPath = path.join(directory, "production-ddl.json"), receiptPath = path.join(directory, "export-receipt.json");
  const artifactBytes = `${JSON.stringify(result.artifact, null, 2)}\n`;
  requireSafe(Buffer.byteLength(artifactBytes) <= MAX_BYTES, "PRIVATE_EXPORT_SIZE_EXCEEDED");
  const receipt = { ...result.receipt, privateFiles: { artifact: artifactPath, receipt: receiptPath },
    filesWritten: true, temporaryExportFilesCreated: 2, privateFilesCreated: 2,
    existingFilesOverwritten: false, artifactFileSha256: sha256(artifactBytes) };
  for (const [filename, bytes] of [[artifactPath, artifactBytes], [receiptPath, `${JSON.stringify(receipt, null, 2)}\n`]]) {
    const current = validatePrivateDirectory(directory, io);
    requireSafe(current.dev === identity.dev && current.ino === identity.ino, "PRIVATE_EXPORT_DIRECTORY_CHANGED");
    const fd = io.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const stat = io.fstatSync(fd);
      requireSafe(stat.isFile() && (stat.mode & 0o7777) === 0o600, "PRIVATE_EXPORT_FILE_MODE_INVALID");
      io.writeFileSync(fd, bytes); io.fsyncSync(fd);
    } finally { io.closeSync(fd); }
  }
  return receipt;
}

export async function exportProductionDdl(options, dependencies = {}) {
  const io = dependencies.io ?? fs;
  validatePrivateDirectory(options.outputDirectory, io);
  requireSafe(io.readdirSync(options.outputDirectory).length === 0, "PRIVATE_EXPORT_DIRECTORY_MUST_BE_EMPTY");
  const result = await collectProductionDdl(options, dependencies);
  return result.receipt.status === "completed"
    ? writePrivateExport(result, options.outputDirectory, dependencies) : result.receipt;
}

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--export-read-only" && !options.exportReadOnly) options.exportReadOnly = true;
    else if (arg === "--expected-schema" && !Object.hasOwn(options, "expectedSchema")) options.expectedSchema = validateSchema(args[++index]);
    else if (arg === "--output-directory" && !Object.hasOwn(options, "outputDirectory")) {
      const value = args[++index];
      requireSafe(typeof value === "string" && value.length > 0 && !value.startsWith("--"), "INVALID_ARGUMENTS");
      options.outputDirectory = value;
    } else requireSafe(false, "INVALID_ARGUMENTS");
  }
  requireSafe(options.exportReadOnly && options.expectedSchema && options.outputDirectory, "EXPLICIT_READ_ONLY_SCOPE_AND_PRIVATE_DIRECTORY_REQUIRED");
  return options;
}

export async function main(args, { dependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const receipt = await exportProductionDdl(parseArguments(args), dependencies);
    stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt.status === "completed" ? 0 : 1;
  } catch (error) { stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: safeError(error) })}\n`); return 1; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main(process.argv.slice(2));
