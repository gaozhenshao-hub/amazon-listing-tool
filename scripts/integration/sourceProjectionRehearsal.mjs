// Explicit, disposable local diagnostic only. Importing this file is inert.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectionOptions, safeError, schemaNames, validateEnvironment, validateOutput,
  validatePaths, validateServerIdentity,
} from "./mysqlRehearsal.mjs";
import {
  auditSchemaSources, EXCLUDED_TABLES, normalizeCreateStatement, PROJECTION_VERSION,
} from "./sourceProjection.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
export const PROJECTION_SQL_SHA256 = "582a5babb990537759adb633a28e82dae668112ca2a9e3e505e626b2424d46f2";
const tableCount = 287, ddlCount = 405;
const digest = value => createHash("sha256").update(value).digest("hex");
const requireSafe = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function parseArguments(args) {
  const result = {}, allowed = new Set(["--root", "--socket", "--datadir", "--projection-directory", "--output"]);
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--execute-local" && !result.executeLocal) result.executeLocal = true;
    else {
      requireSafe(allowed.has(key) && !Object.hasOwn(result, key.slice(2)), "INVALID_ARGUMENTS");
      const value = args[++index];
      requireSafe(typeof value === "string" && value.length > 0 && !value.startsWith("--"), "INVALID_ARGUMENTS");
      result[key.slice(2)] = value;
    }
  }
  requireSafe(result.executeLocal && [...allowed].every(key => result[key.slice(2)]), "EXPLICIT_LOCAL_ARGUMENTS_REQUIRED");
  return result;
}

export function currentSourceFiles() {
  const require = createRequire(path.join(repositoryRoot, "package.json"));
  // Static TypeScript AST/source audit only: do not import the schema or dotenv.
  return auditSchemaSources(repositoryRoot, require("typescript"));
}

export function validateProjectionArtifact(directory, { io = fs, sourceFiles = currentSourceFiles() } = {}) {
  requireSafe(typeof directory === "string" && path.isAbsolute(directory) && path.normalize(directory) === directory,
    "PROJECTION_DIRECTORY_MUST_BE_ABSOLUTE");
  requireSafe(io.realpathSync(directory) === directory && io.lstatSync(directory).isDirectory()
    && !io.lstatSync(directory).isSymbolicLink(), "PROJECTION_DIRECTORY_MUST_BE_CANONICAL");
  const read = (name, maxBytes) => {
    const filename = path.join(directory, name), stat = io.lstatSync(filename);
    requireSafe(stat.isFile() && !stat.isSymbolicLink() && io.realpathSync(filename) === filename && stat.size <= maxBytes,
      "PROJECTION_FILE_MUST_BE_REGULAR_BOUNDED");
    return io.readFileSync(filename, "utf8");
  };
  const metadataText = read("source-projection.metadata.json", 256 * 1024);
  let metadata;
  try { metadata = JSON.parse(metadataText); } catch { requireSafe(false, "PROJECTION_METADATA_INVALID"); }
  requireSafe(metadata && metadata.version === PROJECTION_VERSION && metadata.mode === "source-derived-projection"
    && metadata.productionClone === false && metadata.databaseConnected === false && metadata.sqlExecuted === false
    && metadata.migrationLedgerWritten === false && metadata.schemaEntry === "drizzle/schema/index.ts"
    && metadata.sqlFile === "source-projection.sql", "PROJECTION_METADATA_INVALID");
  requireSafe(same(metadata.sourceFiles, sourceFiles) && metadata.sourceSha256 === digest(JSON.stringify(sourceFiles)),
    "PROJECTION_SOURCE_HASH_MISMATCH");
  requireSafe(metadata.tableCount === tableCount && metadata.ddlCount === ddlCount
    && same(metadata.excludedTables, EXCLUDED_TABLES), "PROJECTION_SCOPE_CHANGED");
  const sql = read("source-projection.sql", 8 * 1024 * 1024);
  requireSafe(metadata.sqlSha256 === PROJECTION_SQL_SHA256 && digest(sql) === PROJECTION_SQL_SHA256, "PROJECTION_SQL_HASH_MISMATCH");
  // The fixed reviewed artifact has one generator item per blank-line block.
  // The hash check above binds this framing; normalize validates every whole
  // block, including quoted semicolons/comments, before a connector is loaded.
  const statements = sql.trimEnd().split("\n\n").map(normalizeCreateStatement);
  requireSafe(statements.length === ddlCount, "PROJECTION_DDL_COUNT_MISMATCH");
  const names = statements.flatMap(statement => {
    const match = statement.match(/(?:^|\n)CREATE TABLE `([A-Za-z_][A-Za-z0-9_]*)` \(/);
    return match ? [match[1]] : [];
  }).sort();
  requireSafe(names.length === tableCount && new Set(names).size === tableCount && same(names, metadata.tableNames)
    && !names.includes("app_schema_migrations") && EXCLUDED_TABLES.every(name => !names.includes(name)), "PROJECTION_TABLE_NAMES_MISMATCH");
  return { statements, tableNames: names, sourceSha256: metadata.sourceSha256,
    metadataSha256: digest(metadataText), sqlSha256: PROJECTION_SQL_SHA256 };
}

async function loadConnector() {
  // No migration runner, dotenv, schema import, defaults file or env URI.
  return (await import("mysql2/promise")).createConnection;
}

export function validateResultTables(rows, expectedNames) {
  requireSafe(Array.isArray(rows) && rows.every(row => typeof row.tableName === "string" && row.tableType === "BASE TABLE"),
    "PROJECTION_RESULT_TABLES_INVALID");
  const names = rows.map(row => row.tableName).sort();
  requireSafe(same(names, expectedNames), "PROJECTION_RESULT_TABLE_NAMES_MISMATCH");
  requireSafe(!names.includes("app_schema_migrations") && EXCLUDED_TABLES.every(name => !names.includes(name)),
    "PROJECTION_FORBIDDEN_TABLE_PRESENT");
  return { tableCount: names.length, exactTableNames: true, excludedTablesAbsent: true, migrationLedgerAbsent: true };
}

export async function runProjectionRehearsal(options, {
  environment = process.env, argv = process.argv, io = fs, auditSources = currentSourceFiles, load = loadConnector,
} = {}) {
  requireSafe(options.executeLocal === true && options.output && options["projection-directory"], "EXPLICIT_LOCAL_ARGUMENTS_REQUIRED");
  validateEnvironment(environment, argv);
  const paths = validatePaths(options, io), output = validateOutput(options.output, io);
  const artifact = validateProjectionArtifact(options["projection-directory"], { io, sourceFiles: auditSources() });
  const createConnection = await load();
  const schema = schemaNames().synthetic;
  const receipt = {
    formatVersion: 1, mode: "source-derived-projection-rehearsal", status: "running", startedAt: new Date().toISOString(),
    schema, nodeVersion: process.version, sqlSha256: artifact.sqlSha256, metadataSha256: artifact.metadataSha256,
    sourceSha256: artifact.sourceSha256, expectedTableCount: tableCount, expectedDdlCount: ddlCount, ddlSucceeded: 0,
    productionValidated: false, historicalUpgradeValidated: false, migrationLedgerWritten: false,
    caseSensitiveLinuxValidated: false, seeded: false,
    limitations: ["Source-derived local diagnostic, not a production clone or historical migration/upgrade rehearsal.",
      "No migration runner, ledger, seeds, automatic repair, retry, DROP DATABASE or application processes.",
      "Case-sensitive Linux validation remains a separate pending rehearsal.",
      "A failed or timed-out DDL may have committed partially; preserve this schema for inspection and never auto-retry."],
  };
  let raw;
  const deadline = Date.now() + 10 * 60_000;
  try {
    // One fresh session for one schema. Never share mysql2 prepared-statement
    // caches across USE transitions; this tool only uses unprepared query().
    raw = await createConnection({ ...connectionOptions(paths), multipleStatements: false });
    const query = async (sql, values) => {
      const remaining = deadline - Date.now();
      requireSafe(remaining > 0, "PROJECTION_REHEARSAL_DEADLINE_EXCEEDED");
      return raw.query({ sql, timeout: Math.min(30_000, remaining) }, values);
    };
    const [identityRows] = await query("SELECT @@version AS version, @@datadir AS datadir, @@socket AS socket, @@skip_networking AS skipNetworking, @@lower_case_table_names AS lowerCaseTableNames, @@sql_mode AS sqlMode");
    const identity = identityRows[0];
    receipt.server = validateServerIdentity(identity, paths, io);
    requireSafe(/^[012]$/.test(String(identity.lowerCaseTableNames)) && typeof identity.sqlMode === "string", "PROJECTION_SERVER_SETTINGS_INVALID");
    const lowerCaseTableNames = Number(identity.lowerCaseTableNames);
    receipt.server = { ...receipt.server, lowerCaseTableNames, sqlMode: identity.sqlMode };
    await query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    receipt.schemaCreated = true;
    await query(`USE \`${schema}\``);
    const [current] = await query("SELECT DATABASE() AS schemaName");
    requireSafe(current[0]?.schemaName === schema, "CURRENT_SCHEMA_MISMATCH");
    for (const [index, statement] of artifact.statements.entries()) {
      try { await query(statement); }
      catch (error) {
        receipt.firstFailure = { statementIndex: index + 1, statementSha256: digest(statement), error: safeError(error) };
        throw error;
      }
      receipt.ddlSucceeded += 1;
    }
    const [rows] = await query("SELECT table_name AS tableName, table_type AS tableType FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name");
    receipt.validation = validateResultTables(rows, artifact.tableNames);
    receipt.status = "completed";
  } catch (error) {
    receipt.status = "failed";
    receipt.error = safeError(error);
  } finally {
    if (raw) {
      try { raw.destroy(); }
      catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
    }
    receipt.finishedAt = new Date().toISOString();
  }
  io.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}

export async function main(args, { dependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const receipt = await runProjectionRehearsal(parseArguments(args), dependencies);
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
