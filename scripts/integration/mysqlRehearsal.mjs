// Disposable local MySQL only. Importing this module performs no DB or dotenv work.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const rootPattern = /^\/private\/tmp\/amazon-mysql8-rehearsal\.[A-Za-z0-9_-]+$/;
const schemaPattern = /^amazon_rehearsal_[a-f0-9]{16}_(synthetic|general)$/;
const generalCount = 168;
// Reviewed 927a5d7 baseline plan, in execution order. A changed plan needs separate review.
export const GENERAL_PLAN_SHA256 = "084b92aaec180ba8110801b5cee4c68355eba56a2f01c028e3ed72cde8e67614";
const queryTimeout = 30_000;
const totalTimeout = 10 * 60_000;

function requireSafe(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

export function parseArguments(args) {
  const options = {};
  const names = new Set(["--root", "--socket", "--datadir", "--output"]);
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--execute-local" && !options.executeLocal) options.executeLocal = true;
    else {
      requireSafe(names.has(name) && !Object.hasOwn(options, name.slice(2)), "INVALID_ARGUMENTS");
      const value = args[++index];
      requireSafe(typeof value === "string" && value.length > 0 && !value.startsWith("--"), "INVALID_ARGUMENTS");
      options[name.slice(2)] = value;
    }
  }
  requireSafe(options.executeLocal && options.root && options.socket && options.datadir, "EXPLICIT_LOCAL_ARGUMENTS_REQUIRED");
  return options;
}

export function validateEnvironment(env, argv = []) {
  // Reject, rather than quietly ignoring, inherited target or preload configuration.
  for (const key of Object.keys(env)) {
    requireSafe(!/^(DATABASE_URL|MYSQL_PWD|MYSQL_HOST|MYSQL_TCP_PORT|MYSQL_UNIX_PORT|NODE_OPTIONS|DOTENV_KEY)$/i.test(key), "UNSAFE_INHERITED_ENVIRONMENT");
    if (/^DOTENV_CONFIG_/i.test(key)) {
      requireSafe(key === "DOTENV_CONFIG_PATH" && env[key] === "/dev/null", "UNSAFE_DOTENV_CONFIGURATION");
    }
  }
  requireSafe(!argv.some(value => /dotenv_config_/i.test(value)), "UNSAFE_DOTENV_ARGUMENT");
}

export function validatePaths(options, io = fs) {
  const { root, socket, datadir } = options;
  requireSafe(typeof root === "string" && rootPattern.test(root), "INVALID_TEMPORARY_ROOT");
  requireSafe(io.realpathSync(root) === root && io.lstatSync(root).isDirectory(), "ROOT_MUST_BE_CANONICAL_DIRECTORY");
  for (const value of [socket, datadir]) {
    requireSafe(typeof value === "string" && path.isAbsolute(value) && path.normalize(value) === value && path.dirname(value) === root, "PATH_MUST_BE_DIRECT_TEMPORARY_CHILD");
    requireSafe(io.realpathSync(value) === value && !io.lstatSync(value).isSymbolicLink(), "SYMLINK_TARGET_FORBIDDEN");
  }
  requireSafe(io.lstatSync(socket).isSocket(), "UNIX_SOCKET_REQUIRED");
  requireSafe(io.lstatSync(datadir).isDirectory(), "DATA_DIRECTORY_REQUIRED");
  return { root, socket, datadir };
}

export function validateOutput(output, io = fs) {
  if (output === undefined) return undefined;
  const artifacts = path.join(repositoryRoot, "artifacts");
  requireSafe(typeof output === "string" && path.isAbsolute(output) && path.normalize(output) === output
    && path.dirname(output) === artifacts && /^[A-Za-z0-9_-]+\.json$/.test(path.basename(output)), "OUTPUT_MUST_BE_ARTIFACT_JSON");
  requireSafe(io.realpathSync(artifacts) === artifacts && !io.existsSync(output), "OUTPUT_MUST_BE_NEW_CANONICAL_FILE");
  return output;
}

export function validateServerIdentity(row, paths, io = fs) {
  requireSafe(row && /^8\.\d+\.\d+(?:[-+.][A-Za-z0-9_.-]+)?$/.test(String(row.version)), "MYSQL_8_REQUIRED");
  requireSafe(!/mariadb/i.test(String(row.version)), "MYSQL_8_REQUIRED");
  requireSafe(row.skipNetworking === 1 || row.skipNetworking === "1" || row.skipNetworking === true || row.skipNetworking === "ON", "NETWORKING_MUST_BE_DISABLED");
  requireSafe(typeof row.socket === "string" && path.isAbsolute(row.socket)
    && path.normalize(row.socket) === paths.socket && io.realpathSync(row.socket) === paths.socket, "SERVER_SOCKET_MISMATCH");
  requireSafe(typeof row.datadir === "string" && path.isAbsolute(row.datadir)
    && path.normalize(row.datadir.replace(/\/$/, "")) === paths.datadir
    && io.realpathSync(row.datadir) === paths.datadir, "SERVER_DATADIR_MISMATCH");
  return { version: String(row.version), networkingDisabled: true };
}

export function connectionOptions(paths) {
  // No URI, host, port, defaults file, TLS, password source, or caller spread.
  return { socketPath: paths.socket, user: "root", password: "", multipleStatements: true, connectTimeout: 5000, charset: "utf8mb4" };
}

export function schemaNames(runId = randomBytes(8).toString("hex")) {
  requireSafe(/^[a-f0-9]{16}$/.test(runId), "INVALID_RUN_ID");
  return { synthetic: `amazon_rehearsal_${runId}_synthetic`, general: `amazon_rehearsal_${runId}_general` };
}

function assertSchema(schema) {
  requireSafe(schemaPattern.test(schema), "NON_REHEARSAL_SCHEMA_FORBIDDEN");
  return schema;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sqlOperationText(sql) {
  // Hide prompt strings / ordinary comments, but retain executable MySQL /*! ... */ bodies.
  let output = "";
  for (let index = 0; index < sql.length;) {
    const start = index;
    const char = sql[index];
    if (sql.startsWith("/*!", index)) {
      index += sql.slice(index).match(/^\/\*!\d*\s*/)[0].length;
      output += " ";
    } else if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      index = end < 0 ? sql.length : end + 2;
      output += " ";
    } else if (sql.startsWith("*/", index)) {
      index += 2;
      output += " ";
    } else if (char === "#" || (sql.startsWith("--", index) && /\s|^$/.test(sql[index + 2] ?? ""))) {
      const end = sql.indexOf("\n", index);
      index = end < 0 ? sql.length : end + 1;
      output += " ";
    } else if (["'", '"', "`"].includes(char)) {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "\\") index += 2;
        else if (sql[index] === char && sql[index + 1] === char) index += 2;
        else if (sql[index++] === char) break;
      }
      output += " ";
    } else {
      output += char;
      index += 1;
    }
    requireSafe(index > start, "SQL_SCAN_DID_NOT_ADVANCE");
  }
  return output;
}

export function validateGeneralPlan(plan) {
  requireSafe(Array.isArray(plan) && plan.length === generalCount, "GENERAL_PLAN_COUNT_CHANGED");
  requireSafe(new Set(plan.map(item => item.fileName)).size === plan.length, "DUPLICATE_GENERAL_MIGRATION");
  for (const item of plan) {
    requireSafe(/^[A-Za-z0-9_-]+\.sql$/.test(item.fileName), "UNSAFE_MIGRATION_NAME");
    requireSafe(!/^(019[6-9]|020[0-3]|020[67])_/.test(item.fileName), "NON_GENERAL_MIGRATION_FORBIDDEN");
    requireSafe(typeof item.sql === "string" && digest(item.sql) === item.checksum, "PLAN_CHECKSUM_MISMATCH");
    // This is not a SQL parser or approval of newly supplied migrations.
    requireSafe(!/\b(?:DROP\s+(?:DATABASE|SCHEMA)|CREATE\s+(?:DATABASE|SCHEMA|USER)|USE\s+|SET\s+(?:@@)?GLOBAL\b|GRANT\s+|LOAD\s+DATA\b|INTO\s+(?:OUTFILE|DUMPFILE)\b|INSTALL\s+PLUGIN\b|SHUTDOWN\b)/i.test(sqlOperationText(item.sql)), "INSTANCE_LEVEL_SQL_FORBIDDEN");
  }
  return digest(JSON.stringify(plan.map(item => [item.fileName, item.checksum])));
}

export function safeError(error) {
  const source = error?.cause ?? error;
  const code = String(source?.code ?? error?.code ?? "REHEARSAL_FAILED");
  return {
    code: /^[A-Z][A-Z0-9_]{1,80}$/.test(code) ? code : "REHEARSAL_FAILED",
    ...(Number.isInteger(source?.errno) ? { errno: source.errno } : {}),
    ...(/^[A-Z0-9]{5}$/.test(String(source?.sqlState ?? "")) ? { sqlState: source.sqlState } : {}),
  };
}

async function loadDependencies() {
  // No runner import until preflight passes. dotenv/config has argv overrides, too.
  validateEnvironment(process.env, process.argv);
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  const runner = await import("../run-database-migrations.mjs");
  requireSafe(!Object.hasOwn(process.env, "DATABASE_URL"), "DATABASE_URL_MUST_REMAIN_ABSENT");
  const { createConnection } = await import("mysql2/promise");
  return { runner, createConnection };
}

function boundedConnection(connection) {
  return {
    query(sql, values) { return connection.query({ sql, timeout: queryTimeout }, values); },
    execute(sql, values) { return connection.execute({ sql, timeout: queryTimeout }, values); },
  };
}

async function identity(connection, paths, io) {
  const [rows] = await connection.query("SELECT @@version AS version, @@datadir AS datadir, @@socket AS socket, @@skip_networking AS skipNetworking");
  return validateServerIdentity(rows[0], paths, io);
}

async function createSchema(connection, name) {
  assertSchema(name);
  // Deliberately no IF NOT EXISTS: even an improbable random collision stops.
  await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.query(`USE \`${name}\``);
  const [rows] = await connection.query("SELECT DATABASE() AS schemaName");
  requireSafe(rows[0]?.schemaName === name, "CURRENT_SCHEMA_MISMATCH");
}

function migration(fileName, sql, official = false) {
  return { fileName, sql, checksum: digest(sql), official, order: 0 };
}

async function quietlyApply(runner, connection, plan, retryFailed = false) {
  const log = console.log;
  console.log = () => {};
  try { await runner.applyMigrations(connection, plan, { retryFailed }); }
  finally { console.log = log; }
}

async function expectRejection(action, message) {
  await assert.rejects(action, message);
}

async function ledgerRows(connection) {
  const [rows] = await connection.query("SELECT migrationName,checksum,status,executionId FROM app_schema_migrations ORDER BY migrationName");
  return rows;
}

async function synthetic(runner, connection, result) {
  await runner.ensureLedger(connection);
  const first = migration("9000_rehearsal_first.sql", "CREATE TABLE rehearsal_first (id INT PRIMARY KEY); INSERT INTO rehearsal_first VALUES (1);");
  await quietlyApply(runner, connection, [first]);
  const before = await ledgerRows(connection);
  assert.equal(before[0]?.status, "succeeded");
  await quietlyApply(runner, connection, [first]);
  assert.deepEqual(await ledgerRows(connection), before);
  const [firstRows] = await connection.query("SELECT id FROM rehearsal_first");
  assert.deepEqual(firstRows.map(row => row.id), [1]);
  result.push({ case: "first_and_repeat", passed: true });

  const drift = migration(first.fileName, `${first.sql} CREATE TABLE rehearsal_drift_sentinel (id INT);`);
  await expectRejection(() => quietlyApply(runner, connection, [drift]), /Checksum mismatch/);
  assert.deepEqual(await ledgerRows(connection), before);
  const [sentinel] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='rehearsal_drift_sentinel'");
  assert.equal(Number(sentinel[0].count), 0);
  result.push({ case: "succeeded_checksum_drift_rejected", passed: true });

  const partial = migration("9001_rehearsal_partial.sql", "CREATE TABLE IF NOT EXISTS rehearsal_partial (id INT PRIMARY KEY); INSERT INTO rehearsal_repaired_dependency VALUES (1);");
  await expectRejection(() => quietlyApply(runner, connection, [partial]), /Migration failed/);
  const partialRow = (await runner.readLedger(connection)).get(partial.fileName);
  assert.equal(partialRow?.status, "failed");
  const [partialTables] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='rehearsal_partial'");
  assert.equal(Number(partialTables[0].count), 1);
  await expectRejection(() => quietlyApply(runner, connection, [partial]), /previously failed/);
  await connection.query("CREATE TABLE rehearsal_repaired_dependency (id INT PRIMARY KEY)");
  await quietlyApply(runner, connection, [partial], true);
  const repaired = (await runner.readLedger(connection)).get(partial.fileName);
  assert.equal(repaired?.status, "succeeded");
  assert.equal(repaired?.checksum, partial.checksum);
  const [repairedRows] = await connection.query("SELECT id FROM rehearsal_repaired_dependency");
  assert.deepEqual(repairedRows.map(row => row.id), [1]);
  result.push({ case: "partial_ddl_and_explicit_same_sql_retry", passed: true });

  const interrupted = migration("9002_rehearsal_interrupted.sql", "CREATE TABLE rehearsal_started_sentinel (id INT);");
  await connection.execute("INSERT INTO app_schema_migrations (migrationName,checksum,status) VALUES (?,?,'started')", [interrupted.fileName, interrupted.checksum]);
  for (const retry of [false, true]) await expectRejection(() => quietlyApply(runner, connection, [interrupted], retry), /interrupted migration record/);
  assert.equal((await runner.readLedger(connection)).get(interrupted.fileName)?.status, "started");
  const [startedTables] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='rehearsal_started_sentinel'");
  assert.equal(Number(startedTables[0].count), 0);
  result.push({ case: "started_rejected_with_both_retry_modes", passed: true });

  const legacy = migration("9003_rehearsal_legacy.sql", "CREATE TABLE rehearsal_legacy (id INT);", true);
  const unmatched = migration("9004_rehearsal_unmatched.sql", "CREATE TABLE rehearsal_unmatched (id INT);", true);
  const supplemental = migration("9005_rehearsal_supplemental.sql", "CREATE TABLE rehearsal_supplemental (id INT);");
  await connection.query(legacy.sql);
  await connection.query("CREATE TABLE __drizzle_migrations (hash VARCHAR(64) NOT NULL)");
  await connection.execute("INSERT INTO __drizzle_migrations (hash) VALUES (?),(?)", [legacy.checksum, supplemental.checksum]);
  await runner.importLegacyJournal(connection, [legacy, unmatched, supplemental]);
  const imported = await ledgerRows(connection);
  assert.equal(imported.find(row => row.migrationName === legacy.fileName)?.executionId, "legacy-drizzle-import");
  assert.equal(imported.find(row => row.migrationName === legacy.fileName)?.status, "succeeded");
  assert.equal(imported.find(row => row.migrationName === legacy.fileName)?.checksum, legacy.checksum);
  assert.equal(imported.some(row => [unmatched.fileName, supplemental.fileName].includes(row.migrationName)), false);
  await runner.importLegacyJournal(connection, [legacy, unmatched, supplemental]);
  assert.deepEqual(await ledgerRows(connection), imported);
  result.push({ case: "legacy_official_hash_matching_only", passed: true });
}

export async function runRehearsal(options, { load = loadDependencies, environment = process.env, argv = process.argv, io = fs } = {}) {
  requireSafe(options.executeLocal === true, "EXPLICIT_LOCAL_EXECUTION_REQUIRED");
  validateEnvironment(environment, argv);
  const paths = validatePaths(options, io);
  const output = validateOutput(options.output, io);
  const { runner, createConnection } = await load();
  const plan = runner.loadMigrationPlan();
  const planHash = validateGeneralPlan(plan);
  requireSafe(planHash === GENERAL_PLAN_SHA256, "GENERAL_PLAN_SNAPSHOT_CHANGED");
  const schemas = schemaNames();
  const receipt = {
    formatVersion: 1, startedAt: new Date().toISOString(), nodeVersion: process.version, status: "running", schemas,
    plan: { kind: "general_only", count: plan.length, sha256: planHash },
    connectionIsolation: { strategy: "fresh_connection_per_schema", schemaConnectionOrdinals: {} },
    historicalBaselineProvided: false, productionValidated: false, dedicatedMigrationsExecuted: false,
    synthetic: [], general: { status: "not_started" },
    limitations: ["No production structural copy", "No historical prerequisite schema supplied", "No dump/restore in this tool", "No application/worker/scheduler started"],
  };
  const connections = new Set();
  let release;
  let timer;
  let stopped = false;
  let nextConnectionOrdinal = 0;
  const connect = async () => {
    requireSafe(!stopped, "REHEARSAL_DEADLINE_EXCEEDED");
    const raw = await createConnection(connectionOptions(paths));
    if (stopped) { raw.destroy(); requireSafe(false, "REHEARSAL_DEADLINE_EXCEEDED"); }
    connections.add(raw);
    const connection = boundedConnection(raw);
    receipt.server = await identity(connection, paths, io);
    return { connection, raw, ordinal: ++nextConnectionOrdinal };
  };
  const work = async () => {
    const { connection, ordinal } = await connect();
    release = await runner.acquireMigrationLock(connection, { timeoutSeconds: 2 });
    const other = await connect();
    await expectRejection(() => runner.acquireMigrationLock(other.connection, { timeoutSeconds: 0 }), /Could not acquire/);
    await release();
    release = undefined;
    const releaseOther = await runner.acquireMigrationLock(other.connection, { timeoutSeconds: 0 });
    await releaseOther();
    await releaseOther();
    await other.raw.end();
    connections.delete(other.raw);
    receipt.synthetic.push({ case: "lock_mutual_exclusion_and_release", passed: true });
    release = await runner.acquireMigrationLock(connection, { timeoutSeconds: 2 });
    receipt.connectionIsolation.schemaConnectionOrdinals.synthetic = ordinal;
    await createSchema(connection, schemas.synthetic);
    await synthetic(runner, connection, receipt.synthetic);
    // mysql2 caches prepared statements on the connection. USE does not rebind
    // already prepared unqualified table names: never reuse a connection across schemas.
    // The synthetic connection keeps the instance lock while a fresh connection
    // independently validates identity, selects its one schema and prepares its SQL.
    const general = await connect();
    receipt.connectionIsolation.schemaConnectionOrdinals.general = general.ordinal;
    await createSchema(general.connection, schemas.general);
    await runner.ensureLedger(general.connection);
    receipt.general.status = "running";
    try {
      await quietlyApply(runner, general.connection, plan);
      receipt.general.status = "succeeded";
    } catch (error) {
      receipt.general.status = "failed";
      receipt.general.error = safeError(error);
    }
    const ledger = await runner.readLedger(general.connection);
    const syntheticLedger = await runner.readLedger(connection);
    const planNames = new Set(plan.map(item => item.fileName));
    receipt.connectionIsolation.syntheticGeneralMigrationCount = [...syntheticLedger.keys()].filter(name => planNames.has(name)).length;
    receipt.connectionIsolation.generalUnexpectedMigrationCount = [...ledger.keys()].filter(name => !planNames.has(name)).length;
    requireSafe(receipt.connectionIsolation.syntheticGeneralMigrationCount === 0, "GENERAL_LEDGER_LEAKED_TO_SYNTHETIC");
    requireSafe(receipt.connectionIsolation.generalUnexpectedMigrationCount === 0, "UNEXPECTED_GENERAL_LEDGER_ENTRY");
    receipt.general.ledger = plan.filter(item => ledger.has(item.fileName)).map(item => {
      const row = ledger.get(item.fileName);
      return { migrationName: item.fileName, checksum: row.checksum, status: row.status };
    });
    receipt.general.firstFailure = receipt.general.ledger.find(row => row.status !== "succeeded") ?? null;
    receipt.general.succeededCount = receipt.general.ledger.filter(row => row.status === "succeeded").length;
    if (receipt.general.status === "succeeded") assert.equal(receipt.general.succeededCount, generalCount);
    else requireSafe(receipt.general.firstFailure !== null, "GENERAL_FAILURE_WITHOUT_LEDGER_BOUNDARY");
    receipt.status = receipt.general.status === "succeeded" ? "completed" : "completed_with_general_failure";
  };
  try {
    await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => {
        stopped = true;
        for (const connection of connections) connection.destroy();
        reject(Object.assign(new Error("REHEARSAL_DEADLINE_EXCEEDED"), { code: "REHEARSAL_DEADLINE_EXCEEDED" }));
      }, totalTimeout);
    })]);
  } catch (error) {
    receipt.status = "failed";
    receipt.error = safeError(error);
  } finally {
    clearTimeout(timer);
    stopped = true;
    if (release) {
      try { await release(); }
      catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
    }
    for (const connection of connections) connection.destroy();
    receipt.finishedAt = new Date().toISOString();
  }
  if (output) fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}

export async function main(args, { rehearsalDependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const receipt = await runRehearsal(parseArguments(args), rehearsalDependencies);
    stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return receipt.status === "completed" ? 0 : receipt.status === "completed_with_general_failure" ? 2 : 1;
  } catch (error) {
    stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: safeError(error) })}\n`);
    return 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
