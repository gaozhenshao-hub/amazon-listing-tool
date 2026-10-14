// Explicit disposable-local execution only. Importing does not load dotenv or connect.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateEnvironment, validatePaths, validateOutput, validateServerIdentity,
  connectionOptions, schemaNames, sqlOperationText, safeError,
} from "./mysqlRehearsal.mjs";

export const BINARY_BUNDLE = "mysql-8.4.11-macos15-arm64";
const TABLES = ["app_schema_migrations", "rehearsal_snapshot_items"];
const schemaPattern = /^amazon_rehearsal_[a-f0-9]{16}_synthetic$/;
const MAX_DUMP_BYTES = 1024 * 1024;
const digest = value => createHash("sha256").update(value).digest("hex");
const requireSafe = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };

export function parseArguments(args) {
  const options = {};
  const names = new Set(["--root", "--socket", "--datadir", "--bindir", "--output"]);
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--execute-local" && !options.executeLocal) options.executeLocal = true;
    else {
      requireSafe(names.has(name) && !Object.hasOwn(options, name.slice(2)), "INVALID_ARGUMENTS");
      const value = args[++index];
      requireSafe(typeof value === "string" && value && !value.startsWith("--") && !value.includes("\0"), "INVALID_ARGUMENTS");
      options[name.slice(2)] = value;
    }
  }
  requireSafe(options.executeLocal && [...names].every(name => options[name.slice(2)]), "EXPLICIT_LOCAL_ARGUMENTS_REQUIRED");
  return options;
}

export function validateBinaries(root, bindir, io = fs) {
  const bundle = path.join(root, BINARY_BUNDLE);
  requireSafe(bindir === path.join(bundle, "bin"), "OFFICIAL_LOCAL_BINARY_DIRECTORY_REQUIRED");
  for (const directory of [bundle, bindir]) {
    requireSafe(io.realpathSync(directory) === directory && !io.lstatSync(directory).isSymbolicLink()
      && io.lstatSync(directory).isDirectory(), "BINARY_DIRECTORY_MUST_BE_CANONICAL");
  }
  return Object.fromEntries(["mysql", "mysqldump"].map(name => {
    const binary = path.join(bindir, name), info = io.lstatSync(binary);
    requireSafe(io.realpathSync(binary) === binary && !info.isSymbolicLink() && info.isFile()
      && (info.mode & 0o111) !== 0, "BINARY_MUST_BE_REGULAR_LOCAL_EXECUTABLE");
    return [name, binary];
  }));
}

export function nativeEnvironment(root) {
  // Do not forward HOME, MYSQL_*, login-file selectors, DYLD_*, NODE_OPTIONS or credentials.
  return { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: root };
}

export function nativeArguments(kind, socket, schema) {
  requireSafe(schemaPattern.test(schema), "NON_SYNTHETIC_SCHEMA_FORBIDDEN");
  requireSafe(typeof socket === "string" && /^\/private\/tmp\/amazon-mysql8-rehearsal\.[A-Za-z0-9_-]+\/[^/\0]+$/.test(socket), "LOCAL_SOCKET_REQUIRED");
  const common = ["--no-defaults", "--no-login-paths", "--protocol=SOCKET", `--socket=${socket}`,
    "--user=root", "--password=", "--default-character-set=utf8mb4"];
  if (kind === "dump") return [...common, "--single-transaction", "--no-tablespaces", "--set-gtid-purged=OFF",
    "--skip-add-drop-table", "--skip-comments", "--skip-dump-date", "--skip-add-locks", "--skip-triggers", schema];
  requireSafe(kind === "restore", "UNKNOWN_CLIENT_ACTION");
  return [...common, "--binary-mode=1", "--local-infile=0", "--skip-reconnect", `--database=${schema}`];
}

export function syntheticMigration() {
  const sql = `CREATE TABLE rehearsal_snapshot_items (
    id INT NOT NULL PRIMARY KEY,
    sku VARCHAR(40) NOT NULL,
    label VARCHAR(100) NOT NULL,
    category VARCHAR(30) NOT NULL,
    quantity INT NOT NULL,
    note TEXT NULL,
    UNIQUE KEY uq_snapshot_sku (sku),
    KEY idx_snapshot_category (category,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  INSERT INTO rehearsal_snapshot_items (id,sku,label,category,quantity,note) VALUES
    (1,'SYN-A','中文样品 😀','合成配件',3,'O''Brien：仅本地演练'),
    (2,'SYN-B','恢复验证','合成配件',0,NULL),
    (3,'SYN-C','索引校验','合成工具',7,'不含业务数据');`;
  return { fileName: "9000_rehearsal_snapshot.sql", sql, checksum: digest(sql), official: false, order: 0 };
}

// Normalize rendering whitespace only, preserving quoted identifiers/literals,
// indexes, collations, defaults and AUTO_INCREMENT values rather than hiding drift.
export function normalizeCreateTable(sql) {
  requireSafe(typeof sql === "string" && /^\s*CREATE\s+TABLE\b/i.test(sql), "CREATE_TABLE_EXPECTED");
  let output = "", quote = null, space = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      output += char;
      if (char === "\\") output += sql[++i] ?? "";
      else if (char === quote && sql[i + 1] === quote) output += sql[++i];
      else if (char === quote) quote = null;
    } else if (/\s/.test(char)) space = true;
    else {
      if (space && output) output += " ";
      space = false; output += char;
      if (["'", '"', "`"].includes(char)) quote = char;
    }
  }
  requireSafe(quote === null, "UNTERMINATED_CREATE_TABLE_QUOTE");
  return output;
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { bytesHex: value.toString("hex") };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function compareSnapshots(before, after) {
  assert.deepEqual(after, before, "Logical snapshot mismatch");
  return { tableCount: Object.keys(before.structure).length, rowCount: before.rows.length, ledgerCount: before.ledger.length,
    structureSha256: digest(JSON.stringify(before.structure)), rowsSha256: digest(JSON.stringify(before.rows)),
    fullLedgerSha256: digest(JSON.stringify(before.ledger)), structureEqual: true, fullLedgerEqual: true, rowsEqual: true };
}

export function validateDump(bytes) {
  requireSafe(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_DUMP_BYTES, "DUMP_SIZE_INVALID");
  let sql;
  try { sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { requireSafe(false, "DUMP_ENCODING_INVALID"); }
  const operations = sqlOperationText(sql);
  // Defense in depth for a dump generated here from fixed synthetic tables, NOT
  // a generic SQL sanitizer or permission to accept an arbitrary external dump.
  requireSafe(!/\b(?:DROP|USE|GRANT|REVOKE|SHUTDOWN)\b|\b(?:CREATE|ALTER)\s+(?:DATABASE|SCHEMA|USER|EVENT|TRIGGER|PROCEDURE|FUNCTION)\b|\bSET\s+(?:@@)?GLOBAL\b|\bLOAD\s+DATA\b|\bINTO\s+(?:OUTFILE|DUMPFILE)\b|\bINSTALL\s+PLUGIN\b/i.test(operations), "UNSAFE_DUMP_OPERATION");
  requireSafe(!/^\s*(?:\\[.!]|source\b|system\b|connect\b|delimiter\b)/im.test(operations), "MYSQL_CLIENT_COMMAND_FORBIDDEN");
  requireSafe(!/\b(?:CREATE\s+TABLE|INSERT\s+INTO|ALTER\s+TABLE|LOCK\s+TABLES)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[A-Za-z0-9_$]+\s*)?\./i.test(operations), "QUALIFIED_DUMP_TARGET_FORBIDDEN");
  for (const table of TABLES) requireSafe(sql.includes(`CREATE TABLE \`${table}\``), "SYNTHETIC_DUMP_TABLE_MISSING");
  return { bytes: bytes.length, sha256: digest(bytes) };
}

export async function runNative({ binary, args, root, outputFd, input, signal }, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(binary, args, { cwd: root, env: nativeEnvironment(root), shell: false,
      stdio: [input ? "pipe" : "ignore", outputFd ?? "ignore", "pipe"], timeout: 60_000, killSignal: "SIGKILL", signal });
    // Drain, but never print or include dump/restore stderr in the receipt.
    child.stderr.on("data", () => {});
    child.on("error", () => reject(Object.assign(new Error("MYSQL_CLIENT_FAILED"), { code: "MYSQL_CLIENT_FAILED" })));
    child.on("close", code => code === 0 ? resolve() : reject(Object.assign(new Error("MYSQL_CLIENT_FAILED"), { code: "MYSQL_CLIENT_FAILED" })));
    if (input) {
      child.stdin.on("error", () => reject(Object.assign(new Error("MYSQL_CLIENT_FAILED"), { code: "MYSQL_CLIENT_FAILED" })));
      child.stdin.end(input);
    }
  });
}

async function loadDependencies() {
  validateEnvironment(process.env, process.argv);
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  const runner = await import("../run-database-migrations.mjs");
  requireSafe(!Object.hasOwn(process.env, "DATABASE_URL"), "DATABASE_URL_MUST_REMAIN_ABSENT");
  const { createConnection } = await import("mysql2/promise");
  return { runner, createConnection };
}

async function quietlyApply(runner, connection, migration) {
  const log = console.log;
  console.log = () => {};
  try { await runner.applyMigrations(connection, [migration], { retryFailed: false }); }
  finally { console.log = log; }
}

async function readSnapshot(connection) {
  const [tables] = await connection.query("SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name");
  assert.deepEqual(tables.map(row => row.tableName), TABLES, "Unexpected synthetic schema tables");
  const structure = {};
  for (const table of TABLES) {
    const [rows] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
    structure[table] = normalizeCreateTable(rows[0]?.["Create Table"]);
  }
  const [rows] = await connection.query("SELECT * FROM rehearsal_snapshot_items ORDER BY id");
  const [ledger] = await connection.query("SELECT * FROM app_schema_migrations ORDER BY migrationName");
  return canonical({ structure, rows, ledger });
}

export async function runSnapshotRehearsal(options, { environment = process.env, argv = process.argv, io = fs,
  load = loadDependencies, native = runNative } = {}) {
  requireSafe(options.executeLocal === true && options.output, "EXPLICIT_LOCAL_EXECUTION_AND_OUTPUT_REQUIRED");
  validateEnvironment(environment, argv);
  const paths = validatePaths(options, io);
  const binaries = validateBinaries(paths.root, options.bindir, io);
  const output = validateOutput(options.output, io);
  const source = schemaNames().synthetic, restored = schemaNames().synthetic;
  requireSafe(source !== restored, "FRESH_SCHEMA_COLLISION");
  const migration = syntheticMigration();
  const dumpPath = path.join(paths.root, `snapshot-${randomBytes(8).toString("hex")}.sql`);
  const receipt = { formatVersion: 1, status: "running", startedAt: new Date().toISOString(), nodeVersion: process.version,
    schemas: { source, restored }, migration: { name: migration.fileName, checksum: migration.checksum },
    productionValidated: false, productionBackupChainValidated: false, businessMigrationsExecuted: false,
    limitations: ["Synthetic disposable-local logical dump/restore only; not production backup-chain validation", "No OSS, remote backup, business SQL, application or DROP operation", "Fresh schemas and private dump are retained for explicit local cleanup"] };
  const { runner, createConnection } = await load();
  const controller = new AbortController();
  const rawConnections = [];
  let release, dumpFd;
  const timer = setTimeout(() => { controller.abort(); for (const raw of rawConnections) raw.destroy(); }, 180_000);
  const active = () => requireSafe(!controller.signal.aborted, "SNAPSHOT_DEADLINE_EXCEEDED");
  try {
    const connect = async database => {
      if (database !== undefined) requireSafe(schemaPattern.test(database), "NON_SYNTHETIC_SCHEMA_FORBIDDEN");
      const raw = await createConnection({ ...connectionOptions(paths), dateStrings: true, timezone: "Z",
        ...(database === undefined ? {} : { database }) });
      rawConnections.push(raw);
      return {
        query(sql, values) { active(); return raw.query({ sql, timeout: 30_000 }, values); },
        execute(sql, values) { active(); return raw.execute({ sql, timeout: 30_000 }, values); },
      };
    };
    const identity = async (connection, schema) => {
      validatePaths(options, io); validateBinaries(paths.root, options.bindir, io);
      const [rows] = await connection.query("SELECT @@version AS version, @@datadir AS datadir, @@socket AS socket, @@skip_networking AS skipNetworking");
      receipt.server = validateServerIdentity(rows[0], paths, io);
      const [current] = await connection.query("SELECT DATABASE() AS schemaName");
      requireSafe(current[0]?.schemaName === (schema ?? null), "CURRENT_SCHEMA_MISMATCH");
    };
    const admin = await connect();
    await identity(admin);
    release = await runner.acquireMigrationLock(admin, { timeoutSeconds: 2 });
    const createSchema = async name => {
      requireSafe(schemaPattern.test(name), "NON_SYNTHETIC_SCHEMA_FORBIDDEN");
      await identity(admin);
      await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
      // Never USE on a reused mysql2 connection: prepared statement caches are
      // connection-scoped and may retain the previously selected database.
      const connection = await connect(name);
      await identity(connection, name);
      await connection.query("SET time_zone = '+00:00'");
      return connection;
    };
    const sourceConnection = await createSchema(source);
    await runner.ensureLedger(sourceConnection);
    await quietlyApply(runner, sourceConnection, migration);
    const before = await readSnapshot(sourceConnection);
    requireSafe(before.rows.length === 3 && before.ledger.length === 1 && before.ledger[0].status === "succeeded"
      && before.ledger[0].migrationName === migration.fileName && before.ledger[0].checksum === migration.checksum, "SYNTHETIC_FIRST_APPLY_INVALID");
    await identity(sourceConnection, source);
    dumpFd = io.openSync(dumpPath, "wx+", 0o600);
    await native({ binary: binaries.mysqldump, args: nativeArguments("dump", paths.socket, source), root: paths.root, outputFd: dumpFd, signal: controller.signal });
    const info = io.fstatSync(dumpFd);
    requireSafe(info.isFile() && (info.mode & 0o777) === 0o600 && info.size > 0 && info.size <= MAX_DUMP_BYTES, "PRIVATE_DUMP_REQUIRED");
    const bytes = Buffer.alloc(info.size);
    requireSafe(io.readSync(dumpFd, bytes, 0, bytes.length, 0) === bytes.length, "DUMP_READ_INCOMPLETE");
    receipt.dump = { path: dumpPath, mode: "0600", ...validateDump(bytes) };
    io.closeSync(dumpFd); dumpFd = undefined;
    const restoredConnection = await createSchema(restored);
    await native({ binary: binaries.mysql, args: nativeArguments("restore", paths.socket, restored), root: paths.root, input: bytes, signal: controller.signal });
    await identity(restoredConnection, restored);
    const after = await readSnapshot(restoredConnection);
    receipt.restoration = compareSnapshots(before, after);
    await quietlyApply(runner, restoredConnection, migration);
    compareSnapshots(after, await readSnapshot(restoredConnection));
    await identity(sourceConnection, source);
    compareSnapshots(before, await readSnapshot(sourceConnection));
    receipt.schemaIsolation = { separateConnections: true, noUseStatements: true, sourceUnchanged: true };
    receipt.repeatAfterRestore = { unchanged: true, duplicateRows: 0, fullLedgerUnchanged: true };
    receipt.status = "completed";
  } catch (error) {
    receipt.status = "failed"; receipt.error = safeError(error);
  } finally {
    clearTimeout(timer);
    if (dumpFd !== undefined) {
      try { io.closeSync(dumpFd); } catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
    }
    if (release) {
      try { await release(); } catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
    }
    controller.abort(); for (const raw of rawConnections) raw.destroy();
    receipt.finishedAt = new Date().toISOString();
  }
  io.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}

export async function main(args) {
  try {
    const receipt = await runSnapshotRehearsal(parseArguments(args));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return receipt.status === "completed" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: safeError(error) })}\n`);
    return 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main(process.argv.slice(2));
