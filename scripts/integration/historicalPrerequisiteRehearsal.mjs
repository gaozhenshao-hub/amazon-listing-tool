// Source-derived missing prerequisite, for disposable-local diagnostics ONLY.
// This is NOT recovered historical DDL, a production clone or a release migration.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateEnvironment, validateOutput,
  connectionOptions, schemaNames, validateGeneralPlan, GENERAL_PLAN_SHA256,
  safeError, sqlOperationText,
} from "./mysqlRehearsal.mjs";
import {
  parseArguments as parseLocalArguments, runNative,
} from "./mysqlSnapshotRehearsal.mjs";
import { selectFreshLineage, checkPostconditions, CHOSEN } from "./freshHistoricalLineage.mjs";
import { normalizeSnapshotCreateTable } from "./snapshotDdlNormalization.mjs";
import { createHistoricalPlatformProfile, validateLinuxPluginRows, runLinuxNative } from "./historicalPlatformProfile.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");
const requireSafe = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
const schemaPattern = /^amazon_rehearsal_[a-f0-9]{16}_synthetic$/;
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ROWS_PER_TABLE = 10_000;
export function parseArguments(args) {
  const flags = args.filter(value => value === "--fresh-reviewed-lineage");
  const linuxFlags = args.filter(value => value === "--linux-isolated-vm");
  requireSafe(flags.length <= 1, "DUPLICATE_LINEAGE_FLAG");
  requireSafe(linuxFlags.length <= 1, "DUPLICATE_LINUX_PROFILE_FLAG");
  return { ...parseLocalArguments(args.filter(value => value !== "--fresh-reviewed-lineage" && value !== "--linux-isolated-vm")),
    freshReviewedLineage: flags.length === 1, linuxIsolatedVm: linuxFlags.length === 1 };
}
export const SOURCE_PINS = Object.freeze({
  "drizzle/schema/ai_os.ts": "99aff033bb3b6e3ffe518df787ae2fde017f8afcdeb97c458e26001a580d7f2d",
  "drizzle/0180_emperor_lingxing_scheduled_task_unification.sql": "86128ad785f71aeaff7c2e47a2646892458aa12d1d86256a036f6e5d89635296",
});
export const ORIGINAL_COLUMNS = Object.freeze([
  "id", "slug", "name", "description", "skillSlug", "cronExpr", "inputTemplate", "isActive",
  "lastRunAt", "nextRunAt", "lastRunStatus", "runCount", "createdByUserId", "createdAt", "updatedAt",
]);
export const ADDED_COLUMNS = Object.freeze([
  "workspaceId", "triggerMode", "systemManaged", "dataDomain", "externalScheduleId",
  "externalTaskUid", "managePath", "lastBatchId",
]);
export const PREREQUISITE_SHA256 = "905e9b3916c7043bded751e6bf8434580b8f5da00fcb832f2e37a1788c5a1f4b";
// Fifteen current source columns, excluding precisely the eight added by 0180.
// Table collation matches the observed metadata, not an assertion of DDL parity.
// No scheduler seeds, no IF NOT EXISTS, no app_schema_migrations entry.
export const PREREQUISITE_SQL = `CREATE TABLE \`emperor_scheduled_tasks\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`slug\` VARCHAR(128) NOT NULL,
  \`name\` VARCHAR(255) NOT NULL,
  \`description\` TEXT NULL,
  \`skillSlug\` VARCHAR(128) NOT NULL,
  \`cronExpr\` VARCHAR(64) NULL,
  \`inputTemplate\` JSON NULL,
  \`isActive\` INT NOT NULL DEFAULT 1,
  \`lastRunAt\` TIMESTAMP NULL,
  \`nextRunAt\` TIMESTAMP NULL,
  \`lastRunStatus\` ENUM('succeeded','failed','running') NULL,
  \`runCount\` INT NOT NULL DEFAULT 0,
  \`createdByUserId\` INT NULL,
  \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`emperor_scheduled_tasks_slug_unique\` (\`slug\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;`;

export function validateSources(io = fs) {
  requireSafe(digest(PREREQUISITE_SQL) === PREREQUISITE_SHA256, "PREREQUISITE_FIXTURE_DRIFT");
  for (const [relative, hash] of Object.entries(SOURCE_PINS)) {
    const filename = path.join(repo, relative), stat = io.lstatSync(filename);
    requireSafe(stat.isFile() && !stat.isSymbolicLink() && stat.size < 256 * 1024
      && io.realpathSync(filename) === filename && digest(io.readFileSync(filename)) === hash,
    "PREREQUISITE_SOURCE_DRIFT");
  }
  return { sourcePins: SOURCE_PINS, fixtureSha256: digest(PREREQUISITE_SQL),
    provenance: "current_source_minus_0180_columns_not_recovered_historical_ddl" };
}

export async function initializePrerequisite(connection, schema) {
  requireSafe(schemaPattern.test(schema), "NON_REHEARSAL_SCHEMA_FORBIDDEN");
  const [current] = await connection.query("SELECT DATABASE() AS schemaName");
  requireSafe(current[0]?.schemaName === schema, "CURRENT_SCHEMA_MISMATCH");
  const [tables] = await connection.query("SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema=DATABASE()");
  requireSafe(tables.length === 0, "PREREQUISITE_REQUIRES_EMPTY_SCHEMA");
  await connection.query(PREREQUISITE_SQL);
}

export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { bytesHex: value.toString("hex") };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function validateLedger(rows, plan) {
  requireSafe(rows.length === plan.length && new Set(rows.map(row => row.migrationName)).size === plan.length,
    "GENERAL_LEDGER_COUNT_OR_UNIQUENESS_MISMATCH");
  const byName = new Map(rows.map(row => [row.migrationName, row]));
  for (const item of plan) requireSafe(byName.get(item.fileName)?.checksum === item.checksum
    && byName.get(item.fileName)?.status === "succeeded", "GENERAL_LEDGER_NOT_EXACT_SUCCEEDED");
  return { succeeded: rows.length, baselined: 0, exactNamesAndChecksums: true };
}

export async function readSnapshot(connection) {
  const [tables] = await connection.query("SELECT table_name AS tableName,table_type AS tableType FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name");
  requireSafe(tables.length > 0 && tables.length <= 400 && tables.every(row => identifierPattern.test(row.tableName)
    && row.tableType === "BASE TABLE"), "SNAPSHOT_TABLE_SCOPE_INVALID");
  const structure = {}, columnMetadata = {}, data = {};
  let totalBytes = 0, rowCount = 0;
  for (const { tableName } of tables) {
    const [ddl] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
    const [columns] = await connection.query("SELECT column_name AS columnName,column_type AS columnType,is_nullable AS isNullable,column_default AS columnDefault,ordinal_position AS ordinalPosition,character_set_name AS characterSetName,collation_name AS collationName,extra AS extra,generation_expression AS generationExpression,column_comment AS columnComment FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position", [tableName]);
    requireSafe(columns.length > 0 && columns.length <= 500, "SNAPSHOT_COLUMN_SCOPE_INVALID");
    columnMetadata[tableName] = canonical(columns);
    structure[tableName] = normalizeSnapshotCreateTable(ddl[0]?.["Create Table"], columns);
    const [rows] = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT ${MAX_ROWS_PER_TABLE + 1}`);
    requireSafe(rows.length <= MAX_ROWS_PER_TABLE, "SNAPSHOT_ROW_BOUND_EXCEEDED");
    // Sort the complete canonical row strings, preserving duplicates and nulls.
    // No dependency on a PK, JSON SQL ordering, collation or driver row order.
    const serialized = JSON.stringify(rows.map(row => JSON.stringify(canonical(row))).sort());
    totalBytes += Buffer.byteLength(serialized) + Buffer.byteLength(structure[tableName]) + Buffer.byteLength(JSON.stringify(columnMetadata[tableName]));
    requireSafe(totalBytes <= MAX_BYTES, "SNAPSHOT_SIZE_BOUND_EXCEEDED");
    rowCount += rows.length;
    data[tableName] = { rows: rows.length, sha256: digest(serialized) };
  }
  const [ledger] = await connection.query("SELECT * FROM app_schema_migrations ORDER BY migrationName");
  return { structure, columnMetadata, data, ledger: canonical(ledger), tableCount: tables.length, rowCount };
}

export function compareSnapshots(before, after) {
  assert.deepEqual(after, before, "Full local schema/seed/ledger snapshot mismatch");
  return { tableCount: before.tableCount, rowCount: before.rowCount, ledgerCount: before.ledger.length,
    structureSha256: digest(JSON.stringify(before.structure)), dataSha256: digest(JSON.stringify(before.data)),
    columnMetadataSha256: digest(JSON.stringify(before.columnMetadata)),
    fullLedgerSha256: digest(JSON.stringify(before.ledger)), structureEqual: true, columnMetadataEqual: true,
    allRowsEqual: true, fullLedgerEqual: true };
}

export function validateDump(bytes, tableNames) {
  requireSafe(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_BYTES, "DUMP_SIZE_INVALID");
  const sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const operations = sqlOperationText(sql);
  // This only admits this process's own dump of pinned source-created schemas.
  // It is NOT an arbitrary external SQL sanitizer/import facility.
  requireSafe(!/\b(?:DROP|USE|GRANT|REVOKE|SHUTDOWN)\b|\b(?:CREATE|ALTER)\s+(?:DATABASE|SCHEMA|USER|EVENT|TRIGGER|PROCEDURE|FUNCTION)\b|\bSET\s+(?:@@)?GLOBAL\b|\bLOAD\s+DATA\b|\bINTO\s+(?:OUTFILE|DUMPFILE)\b|\bINSTALL\s+PLUGIN\b/i.test(operations), "UNSAFE_DUMP_OPERATION");
  requireSafe(!/^\s*(?:\\[.!]|source\b|system\b|connect\b|delimiter\b)/im.test(operations), "MYSQL_CLIENT_COMMAND_FORBIDDEN");
  // sqlOperationText hides quoted identifiers, so a quoted qualified target
  // becomes whitespace-dot-whitespace; unquoted identifiers remain visible.
  requireSafe(!/\b(?:CREATE\s+TABLE|ALTER\s+TABLE|INSERT\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|LOCK\s+TABLES|REFERENCES|FROM|JOIN)\s+(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z0-9_$]*\s*\./i.test(operations), "QUALIFIED_DUMP_TARGET_FORBIDDEN");
  const dumpedTables = [...sql.matchAll(/^CREATE TABLE `([A-Za-z_][A-Za-z0-9_]*)` \(/gm)].map(match => match[1]).sort();
  assert.deepEqual(dumpedTables, [...tableNames].sort(), "Dump table names differ from local snapshot");
  return { bytes: bytes.length, sha256: digest(bytes), tableCount: dumpedTables.length };
}

async function loadDependencies() {
  validateEnvironment(process.env, process.argv);
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  const runner = await import("../run-database-migrations.mjs");
  requireSafe(!Object.hasOwn(process.env, "DATABASE_URL"), "DATABASE_URL_MUST_REMAIN_ABSENT");
  return { runner, createConnection: (await import("mysql2/promise")).createConnection };
}

async function quietlyApply(runner, connection, plan) {
  const log = console.log;
  console.log = () => {};
  try { await runner.applyMigrations(connection, plan, { retryFailed: false }); }
  finally { console.log = log; }
}

export async function runRehearsal(options, { environment = process.env, argv = process.argv, io = fs,
  load = loadDependencies, native, runtime = { platform: process.platform, arch: process.arch } } = {}) {
  requireSafe(options.executeLocal === true && options.output, "EXPLICIT_LOCAL_EXECUTION_AND_OUTPUT_REQUIRED");
  const profile = createHistoricalPlatformProfile(options, { io, runtime });
  const nativeRunner = native ?? (profile.kind === "linux-isolated-vm" ? runLinuxNative : runNative);
  profile.validateEnvironment(environment, argv);
  const paths = profile.validatePaths(options), output = validateOutput(options.output, io);
  const binaries = profile.validateBinaries(paths.root, options.bindir), provenance = validateSources(io);
  const { runner, createConnection } = await load();
  const sourcePlan = runner.loadMigrationPlan();
  requireSafe(validateGeneralPlan(sourcePlan) === GENERAL_PLAN_SHA256, "GENERAL_PLAN_SNAPSHOT_CHANGED");
  const lineage = options.freshReviewedLineage === true ? selectFreshLineage(sourcePlan) : undefined;
  const plan = lineage?.plan ?? sourcePlan;
  const source = schemaNames().synthetic, restored = schemaNames().synthetic;
  requireSafe(source !== restored, "FRESH_SCHEMA_COLLISION");
  const receipt = { formatVersion: 1, mode: "source-derived-prerequisite-general-chain", status: "running",
    startedAt: new Date().toISOString(), schemas: { source, restored }, prerequisite: provenance,
    platformProfile: { kind: profile.kind, runtime: profile.runtime },
    sourcePlan: { count: sourcePlan.length, sha256: GENERAL_PLAN_SHA256 },
    plan: { count: plan.length, sha256: lineage?.sha256 ?? GENERAL_PLAN_SHA256 },
    lineage: lineage ? { mode: "explicit_local_0190_lineage", excluded: lineage.excluded, postconditions: [] }
      : { mode: "original_168_no_exclusions" },
    productionCloneValidated: false, caseSensitiveLinuxValidated: false, fullApplicationFreshSchemaValidated: false,
    productionWrites: false, historicalSqlChanged: false, blanketBaselineUsed: false,
    structureComparison: "whitespace_and_catalog_verified_redundant_charset_only; complete_column_metadata_also_exactly_compared",
    limitations: ["Fixture derives from pinned source, not recovered historical DDL or production SHOW CREATE.",
      lineage ? "Explicit fresh-only 0190 lineage: 165 executed, 0191/0192/0193 alternative repairs excluded with no ledger rows. Default production runner remains unchanged."
        : "Only the original 168-item general chain; dedicated/retired/manual/friend migrations remain excluded.",
      "All data originate from pinned migration seeds; no production business rows or services.",
      profile.kind === "linux-isolated-vm" ? "Isolated Linux VM source-derived rehearsal only; not production baseline-copy upgrade or a production clone."
        : "Local native MySQL dump/restore is not production baseline-copy upgrade or Linux validation.",
      "VM isolation is an explicit caller/setup assurance, not an attestation inferred by this tool.",
      "Original unbootstrapped failure is retained; this tool never retries or repairs a failed migration."] };
  const controller = new AbortController(), connections = [];
  let release, dumpFd;
  const timer = setTimeout(() => { controller.abort(); for (const raw of connections) raw.destroy(); }, 10 * 60_000);
  const active = () => requireSafe(!controller.signal.aborted, "REHEARSAL_DEADLINE_EXCEEDED");
  try {
    const connect = async database => {
      active();
      if (database !== undefined) requireSafe(schemaPattern.test(database), "NON_REHEARSAL_SCHEMA_FORBIDDEN");
      const raw = await createConnection({ ...connectionOptions(paths), dateStrings: true, timezone: "Z",
        supportBigNumbers: true, bigNumberStrings: true, jsonStrings: true,
        ...(database === undefined ? {} : { database }) });
      connections.push(raw); active();
      const connection = {
        query(sql, values) { active(); return raw.query({ sql, timeout: 30_000 }, values); },
        execute(sql, values) { active(); return raw.execute({ sql, timeout: 30_000 }, values); },
      };
      profile.validatePaths(options);
      const identitySql = "SELECT @@version AS version, @@datadir AS datadir, @@socket AS socket, @@skip_networking AS skipNetworking, @@lower_case_table_names AS lowerCaseTableNames, @@sql_mode AS sqlMode";
      const [rows] = await connection.query(identitySql + (profile.kind === "linux-isolated-vm" ? ", @@event_scheduler AS eventScheduler" : ""));
      const row = rows[0];
      receipt.server = { ...profile.validateServerIdentity(row, paths), lowerCaseTableNames: Number(row.lowerCaseTableNames), sqlMode: row.sqlMode };
      requireSafe([0, 1, 2].includes(receipt.server.lowerCaseTableNames) && typeof row.sqlMode === "string", "SERVER_SETTINGS_INVALID");
      if (profile.kind === "linux-isolated-vm") {
        const [plugins] = await connection.query("SELECT PLUGIN_STATUS AS pluginStatus FROM information_schema.plugins WHERE PLUGIN_NAME='mysqlx'");
        Object.assign(receipt.server, validateLinuxPluginRows(plugins));
      }
      const [current] = await connection.query("SELECT DATABASE() AS schemaName");
      requireSafe(current[0]?.schemaName === (database ?? null), "CURRENT_SCHEMA_MISMATCH");
      await connection.query("SET time_zone = '+00:00'");
      return connection;
    };
    const admin = await connect();
    release = await runner.acquireMigrationLock(admin, { timeoutSeconds: 2 });
    const createSchema = async name => {
      requireSafe(schemaPattern.test(name), "NON_REHEARSAL_SCHEMA_FORBIDDEN");
      await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
      (receipt.schemasCreated ??= []).push(name);
      return connect(name); // Fresh mysql2 connection, never USE across schemas.
    };
    const sourceConnection = await createSchema(source);
    await initializePrerequisite(sourceConnection, source);
    await assert.rejects(() => initializePrerequisite(sourceConnection, source), { code: "PREREQUISITE_REQUIRES_EMPTY_SCHEMA" });
    receipt.prerequisite.nonemptyInitializationRejected = true;
    const readColumns = async () => {
      const [rows] = await sourceConnection.query("SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='emperor_scheduled_tasks' ORDER BY ordinal_position");
      return rows.map(row => row.columnName);
    };
    assert.deepEqual(await readColumns(), ORIGINAL_COLUMNS);
    await runner.ensureLedger(sourceConnection);
    const apply = async (connection, phase) => {
      if (!lineage) return quietlyApply(runner, connection, plan);
      const boundary = plan.findIndex(item => item.fileName === CHOSEN) + 1;
      requireSafe(boundary > 0, "CHOSEN_LINEAGE_BOUNDARY_MISSING");
      await quietlyApply(runner, connection, plan.slice(0, boundary));
      const postcondition = await checkPostconditions(runner, connection);
      receipt.lineage.postconditions.push({ phase, ...postcondition });
      await quietlyApply(runner, connection, plan.slice(boundary));
    };
    try { await apply(sourceConnection, "first_apply"); }
    catch (error) {
      receipt.generalFailure = { phase: "first_general_apply", error: safeError(error) };
      try {
        const ledger = await runner.readLedger(sourceConnection);
        receipt.generalFailure.succeededCount = [...ledger.values()].filter(row => row.status === "succeeded").length;
        receipt.generalFailure.firstFailure = plan.filter(item => ledger.has(item.fileName)).map(item => ({ migrationName: item.fileName,
          checksum: ledger.get(item.fileName).checksum, status: ledger.get(item.fileName).status })).find(row => row.status !== "succeeded") ?? null;
      } catch (ledgerError) { receipt.generalFailure.ledgerReadError = safeError(ledgerError); }
      throw error;
    }
    assert.deepEqual(await readColumns(), [...ORIGINAL_COLUMNS, ...ADDED_COLUMNS]);
    receipt.prerequisite.columnTransition = { before: 15, after: 23, exactNamesAndOrder: true };
    const before = await readSnapshot(sourceConnection);
    receipt.general = validateLedger(before.ledger, plan);
    await apply(sourceConnection, "repeat");
    receipt.repeat = compareSnapshots(before, await readSnapshot(sourceConnection));
    const dumpPath = path.join(paths.root, `historical-prerequisite-${randomBytes(8).toString("hex")}.sql`);
    profile.validateBinaries(paths.root, options.bindir);
    dumpFd = io.openSync(dumpPath, "wx+", 0o600);
    receipt.dump = { path: dumpPath, mode: "0600", status: "writing" };
    await nativeRunner({ binary: binaries.mysqldump, args: profile.nativeArguments("dump", paths.socket, source),
      root: paths.root, outputFd: dumpFd, signal: controller.signal });
    const stat = io.fstatSync(dumpFd);
    requireSafe(stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.size > 0 && stat.size <= MAX_BYTES, "PRIVATE_BOUNDED_DUMP_REQUIRED");
    const bytes = Buffer.alloc(stat.size);
    requireSafe(io.readSync(dumpFd, bytes, 0, bytes.length, 0) === bytes.length, "DUMP_READ_INCOMPLETE");
    receipt.dump = { path: dumpPath, mode: "0600", status: "validated", ...validateDump(bytes, Object.keys(before.structure)) };
    io.closeSync(dumpFd); dumpFd = undefined;
    const restoredConnection = await createSchema(restored);
    profile.validateBinaries(paths.root, options.bindir);
    await nativeRunner({ binary: binaries.mysql, args: profile.nativeArguments("restore", paths.socket, restored),
      root: paths.root, input: bytes, signal: controller.signal });
    receipt.restoration = compareSnapshots(before, await readSnapshot(restoredConnection));
    await apply(restoredConnection, "restored_repeat");
    receipt.restoredRepeat = compareSnapshots(before, await readSnapshot(restoredConnection));
    compareSnapshots(before, await readSnapshot(sourceConnection));
    receipt.schemaIsolation = { separateConnections: true, sourceUnchanged: true };
    validateSources(io);
    requireSafe(validateGeneralPlan(runner.loadMigrationPlan()) === GENERAL_PLAN_SHA256, "SOURCE_CHANGED_DURING_REHEARSAL");
    receipt.status = "completed";
  } catch (error) { receipt.status = "failed"; receipt.error = safeError(error); }
  finally {
    clearTimeout(timer);
    if (dumpFd !== undefined) {
      try { io.closeSync(dumpFd); }
      catch (error) { receipt.dumpCloseError = safeError(error); receipt.status = "failed"; }
    }
    if (release) {
      try { await release(); }
      catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
    }
    for (const raw of connections) raw.destroy();
    receipt.finishedAt = new Date().toISOString();
  }
  // Never label preflight, partial apply, failed restore or failed cleanup as
  // Linux validation. This flag covers only the source-derived chain above.
  receipt.caseSensitiveLinuxValidated = receipt.status === "completed" && profile.kind === "linux-isolated-vm";
  io.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}

export async function main(args, { dependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const receipt = await runRehearsal(parseArguments(args), dependencies);
    stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return receipt.status === "completed" ? 0 : 1;
  } catch (error) {
    stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: safeError(error) })}\n`);
    return 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
