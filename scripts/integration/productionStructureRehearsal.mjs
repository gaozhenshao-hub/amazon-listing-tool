// Explicit isolated-Linux replay of a hash-pinned private schema-only export.
// No managed URI, production connection, migration runner, ledger seed or data import.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { DDL_CATALOG, validateCatalog, validateTableDdl, validatePrivateDirectory } from "./exportProductionDdl.mjs";
import { createHistoricalPlatformProfile, validateLinuxPluginRows, runLinuxNative } from "./historicalPlatformProfile.mjs";
import { connectionOptions, schemaNames, validateOutput, safeError, sqlOperationText } from "./mysqlRehearsal.mjs";
import { normalizeSnapshotCreateTable } from "./snapshotDdlNormalization.mjs";

const SOURCE_SCHEMA = "amz_listing", SOURCE_VERSION = "8.0.46-0ubuntu0.24.04.4";
const MAX_BYTES = 64 * 1024 * 1024, MAX_ROWS = 100_000;
const pattern = /^amazon_rehearsal_[a-f0-9]{16}_synthetic$/;
const digest = value => createHash("sha256").update(value).digest("hex");
const jsonHash = value => digest(JSON.stringify(value));
const requireSafe = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
export const LOCAL_TABLE_DISCOVERY_SQL = "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME";

export function parseArguments(args) {
  const options = {}, flags = new Map([["--execute-local", "executeLocal"], ["--linux-isolated-vm", "linuxIsolatedVm"]]);
  const names = new Map(["root", "socket", "datadir", "bindir", "output", "artifact-directory", "artifact-sha256", "receipt-sha256", "expected-tables"]
    .map(name => [`--${name}`, name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())]));
  for (let index = 0; index < args.length; index++) {
    const key = flags.get(args[index]) ?? names.get(args[index]);
    requireSafe(key && !Object.hasOwn(options, key), "INVALID_ARGUMENTS");
    if (flags.has(args[index])) options[key] = true;
    else {
      const value = args[++index];
      requireSafe(typeof value === "string" && value && !value.startsWith("--") && !value.includes("\0"), "INVALID_ARGUMENTS");
      options[key] = value;
    }
  }
  requireSafe(options.executeLocal && options.linuxIsolatedVm && [...names.values()].every(name => options[name]), "EXPLICIT_STRUCTURE_REHEARSAL_ARGUMENTS_REQUIRED");
  requireSafe(/^[1-9]\d{0,2}$/.test(options.expectedTables), "EXPECTED_TABLE_COUNT_INVALID");
  options.expectedTables = Number(options.expectedTables);
  return options;
}

function projectCatalog(catalog) {
  requireSafe(catalog && Object.keys(catalog).length === Object.keys(DDL_CATALOG).length, "CATALOG_COLLECTIONS_INVALID");
  return Object.fromEntries(Object.entries(DDL_CATALOG).map(([name, definition]) => {
    const rows = catalog[name];
    requireSafe(Array.isArray(rows) && rows.length <= MAX_ROWS, "CATALOG_ROW_BOUND_INVALID");
    return [name, rows.map(row => {
      requireSafe(row && definition.fields.every(field => Object.hasOwn(row, field))
        && Object.keys(row).length === definition.fields.length, "CATALOG_FIELDS_INVALID");
      return Object.fromEntries(definition.fields.map(field => {
        const value = row[field];
        requireSafe(value === null || typeof value === "string" || typeof value === "boolean"
          || (typeof value === "number" && Number.isFinite(value)), "CATALOG_VALUE_INVALID");
        return [field, value];
      }));
    })];
  }));
}

export function validateReplayDdl(sql, tableName) {
  const checked = validateTableDdl(sql, tableName), operations = sqlOperationText(sql);
  // This is defense in depth for independently pinned SHOW CREATE only, NOT an
  // arbitrary SQL import facility. Targets and FK references cannot be qualified.
  requireSafe(!/\b(?:CREATE\s+TABLE|REFERENCES)\s+[A-Za-z0-9_$]*\s*\./i.test(operations), "QUALIFIED_REPLAY_TARGET_FORBIDDEN");
  requireSafe(!/\b(?:SELECT|LIKE|OUTFILE|DUMPFILE|INFILE|INSTALL|UNINSTALL|SHUTDOWN|PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i.test(operations), "REPLAY_DDL_FEATURE_FORBIDDEN");
  return checked;
}

export function validateExport(artifact, receipt, { artifactSha256, artifactBytes, expectedTables }) {
  requireSafe(Number.isInteger(expectedTables) && expectedTables > 0 && expectedTables <= 999, "EXPECTED_TABLE_COUNT_INVALID");
  requireSafe(artifact?.formatVersion === 1 && artifact.kind === "private-schema-only-not-auto-replayable"
    && artifact.schema === SOURCE_SCHEMA && artifact.server?.version === SOURCE_VERSION
    && artifact.server.lowerCaseTableNames === 0 && artifact.server.quoteShowCreate === 1
    && /^[A-Z_,]*$/.test(artifact.server.sqlMode) && !artifact.server.sqlMode.split(",").includes("NO_BACKSLASH_ESCAPES"), "SOURCE_ARTIFACT_IDENTITY_INVALID");
  requireSafe(receipt?.formatVersion === 1 && receipt.mode === "private-read-only-production-ddl" && receipt.status === "completed"
    && receipt.stable === true && receipt.expectedSchema === SOURCE_SCHEMA && receipt.businessRowsRead === false
    && receipt.databaseWrites === false && receipt.replayPerformed === false && receipt.filesWritten === true,
  "EXPORT_RECEIPT_NOT_STABLE_READ_ONLY");
  requireSafe(receipt.artifactFileSha256 === artifactSha256 && digest(artifactBytes) === artifactSha256
    && receipt.captureSha256 === jsonHash(artifact) && jsonHash(receipt.server) === jsonHash(artifact.server), "EXPORT_HASH_BINDING_MISMATCH");
  const snapshot = { schema: artifact.schema, server: artifact.server, catalog: artifact.catalog, tables: artifact.tables };
  requireSafe(receipt.hashes?.first === jsonHash(snapshot) && receipt.hashes.second === receipt.hashes.first, "EXPORT_OBSERVATION_HASH_MISMATCH");
  const catalog = projectCatalog(artifact.catalog), names = [...validateCatalog(catalog, SOURCE_SCHEMA)];
  requireSafe(jsonHash(receipt.counts) === jsonHash(Object.fromEntries(Object.entries(catalog).map(([name, rows]) => [name, rows.length]))), "EXPORT_COUNTS_MISMATCH");
  requireSafe(names.length === expectedTables && Array.isArray(artifact.tables) && artifact.tables.length === expectedTables,
    "EXPORT_TABLE_COUNT_MISMATCH");
  for (const [index, table] of artifact.tables.entries()) {
    requireSafe(table?.tableName === names[index] && table.sha256 === digest(table.ddl), "EXPORT_TABLE_HASH_OR_ORDER_MISMATCH");
    validateReplayDdl(table.ddl, table.tableName);
    normalizeSnapshotCreateTable(table.ddl, catalog.columns.filter(row => row.tableName === table.tableName));
  }
  const schema = catalog.schema[0];
  requireSafe(/^[a-z0-9_]+$/.test(schema.characterSetName) && /^[a-z0-9_]+$/.test(schema.collationName), "SCHEMA_CHARSET_INVALID");
  return artifact;
}

function readPrivateFile(filename, maxBytes, io) {
  const fd = io.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = io.fstatSync(fd);
    requireSafe(stat.isFile() && (stat.mode & 0o7777) === 0o600 && stat.uid === process.getuid()
      && stat.size > 0 && stat.size <= maxBytes, "PRIVATE_INPUT_FILE_INVALID");
    const bytes = io.readFileSync(fd);
    requireSafe(Buffer.isBuffer(bytes) && bytes.length === stat.size, "PRIVATE_INPUT_READ_INVALID");
    return bytes;
  } finally { io.closeSync(fd); }
}

export function loadPrivateExport(options, io = fs) {
  requireSafe(/^[a-f0-9]{64}$/.test(options.artifactSha256) && /^[a-f0-9]{64}$/.test(options.receiptSha256), "EXPLICIT_INPUT_HASHES_REQUIRED");
  const before = validatePrivateDirectory(options.artifactDirectory, io);
  const artifactBytes = readPrivateFile(path.join(options.artifactDirectory, "production-ddl.json"), MAX_BYTES, io);
  const receiptBytes = readPrivateFile(path.join(options.artifactDirectory, "export-receipt.json"), 1024 * 1024, io);
  requireSafe(digest(artifactBytes) === options.artifactSha256 && digest(receiptBytes) === options.receiptSha256, "PRIVATE_INPUT_HASH_MISMATCH");
  const after = validatePrivateDirectory(options.artifactDirectory, io);
  requireSafe(before.dev === after.dev && before.ino === after.ino, "PRIVATE_INPUT_DIRECTORY_CHANGED");
  let artifact, receipt;
  try { artifact = JSON.parse(artifactBytes); receipt = JSON.parse(receiptBytes); }
  catch { requireSafe(false, "PRIVATE_INPUT_JSON_INVALID"); }
  return validateExport(artifact, receipt, { ...options, artifactBytes });
}

export function mapCatalogSchema(catalog, from, to) {
  requireSafe(pattern.test(to), "NON_SYNTHETIC_SCHEMA_FORBIDDEN");
  const mapped = structuredClone(catalog);
  for (const row of mapped.schema) { requireSafe(row.schemaName === from, "SCHEMA_MAPPING_MISMATCH"); row.schemaName = to; }
  for (const row of mapped.keyColumns) if (row.referencedTableSchema !== null) {
    requireSafe(row.referencedTableSchema === from, "SCHEMA_MAPPING_MISMATCH"); row.referencedTableSchema = to;
  }
  for (const row of mapped.foreignKeys) { requireSafe(row.uniqueConstraintSchema === from, "SCHEMA_MAPPING_MISMATCH"); row.uniqueConstraintSchema = to; }
  return mapped;
}

export async function collectLocalStructure(connection, schema) {
  requireSafe(pattern.test(schema), "NON_SYNTHETIC_SCHEMA_FORBIDDEN");
  await connection.query("SET SESSION information_schema_stats_expiry = 0");
  const [statsRows] = await connection.query("SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry");
  requireSafe(Array.isArray(statsRows) && statsRows.length === 1
    && (statsRows[0]?.statsExpiry === 0 || statsRows[0]?.statsExpiry === "0"), "LOCAL_STATS_EXPIRY_NOT_DISABLED");
  const [discovered] = await connection.query(LOCAL_TABLE_DISCOVERY_SQL, [schema]);
  requireSafe(Array.isArray(discovered) && discovered.length > 0 && discovered.length <= 999
    && discovered.every(row => row && Object.keys(row).length === 3
      && typeof row.tableName === "string" && row.tableName.length <= 64
      && /^[A-Za-z_][A-Za-z0-9_]*$/.test(row.tableName) && row.tableType === "BASE TABLE" && row.engine === "InnoDB"),
  "LOCAL_TABLE_DISCOVERY_INVALID");
  const names = discovered.map(row => row.tableName), tables = [];
  requireSafe(new Set(names).size === names.length && isDeepStrictEqual(names, [...names].sort()), "LOCAL_TABLE_DISCOVERY_INVALID");
  // I_S may peek an uninitialized InnoDB counter even with stats_expiry=0.
  // Open and verify every local empty table before capturing its full catalog.
  for (const tableName of names) {
    const [ddl] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
    requireSafe(ddl?.length === 1 && ddl[0].Table === tableName, "LOCAL_SHOW_CREATE_IDENTITY_INVALID");
    tables.push(validateReplayDdl(ddl[0]["Create Table"], tableName));
    const [counts] = await connection.query(`SELECT COUNT(*) AS rowCount FROM \`${tableName}\``);
    requireSafe(counts?.length === 1 && String(counts[0].rowCount) === "0", "LOCAL_BUSINESS_ROWS_NOT_EMPTY");
  }
  const readCatalog = async () => {
    const catalog = {};
    for (const [name, definition] of Object.entries(DDL_CATALOG)) {
      const [rows] = await connection.query(definition.sql, Array((definition.sql.match(/\?/g) ?? []).length).fill(schema));
      catalog[name] = rows;
    }
    const projected = projectCatalog(catalog), observedNames = [...validateCatalog(projected, schema)];
    requireSafe(isDeepStrictEqual(observedNames, names), "LOCAL_TABLE_SET_CHANGED");
    return projected;
  };
  const firstCatalog = await readCatalog(), secondCatalog = await readCatalog();
  requireSafe(isDeepStrictEqual(firstCatalog, secondCatalog), "LOCAL_CATALOG_CHANGED_DURING_CAPTURE");
  return { schema, catalog: firstCatalog, tables, zeroRowTables: tables.length };
}

export function compareStructure(expected, actual) {
  const mapped = mapCatalogSchema(expected.catalog, expected.schema, actual.schema);
  requireSafe(jsonHash(mapped) === jsonHash(actual.catalog), "FULL_CATALOG_MISMATCH");
  requireSafe(actual.zeroRowTables === expected.tables.length && actual.tables.length === expected.tables.length, "EMPTY_TABLE_COUNT_MISMATCH");
  const normalized = snapshot => snapshot.tables.map(table => [table.tableName,
    normalizeSnapshotCreateTable(table.ddl, snapshot.catalog.columns.filter(row => row.tableName === table.tableName))]);
  requireSafe(jsonHash(normalized(expected)) === jsonHash(normalized(actual)), "FULL_DDL_MISMATCH");
  return { tableCount: actual.tables.length, businessRows: 0, catalogEqual: true, ddlEqual: true,
    catalogSha256: jsonHash(actual.catalog), normalizedDdlSha256: jsonHash(normalized(actual)), schemaMappingOnly: true };
}

export function structureDumpArguments(profile, socket, schema) {
  const args = profile.nativeArguments("dump", socket, schema);
  return [...args.slice(0, -1), "--no-data", args.at(-1)];
}

// Only used to validate the narrow ALTER TABLE ... ENABLE/DISABLE KEYS emitted
// by a native dump. Literal/default/comment text cannot fabricate statements.
function dumpControlTokens(sql) {
  const tokens = [];
  for (let index = 0; index < sql.length;) {
    if (/\s/.test(sql[index])) { index++; continue; }
    if (sql.startsWith("/*!", index)) { index += sql.slice(index).match(/^\/\*!\d*\s*/)[0].length; continue; }
    if (sql.startsWith("*/", index)) { index += 2; continue; }
    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2); requireSafe(end >= 0, "STRUCTURE_DUMP_TOKEN_INVALID"); index = end + 2; continue;
    }
    if (sql[index] === "#" || (sql.startsWith("--", index) && /\s|^$/.test(sql[index + 2] ?? ""))) {
      const end = sql.indexOf("\n", index); index = end < 0 ? sql.length : end + 1; continue;
    }
    if (["'", '"', "`"].includes(sql[index])) {
      const quote = sql[index++]; let value = "", closed = false;
      while (index < sql.length) {
        const char = sql[index++];
        if (char === "\\") { requireSafe(index < sql.length, "STRUCTURE_DUMP_TOKEN_INVALID"); value += sql[index++]; }
        else if (char === quote && sql[index] === quote) { value += quote; index++; }
        else if (char === quote) { closed = true; break; }
        else value += char;
      }
      requireSafe(closed, "STRUCTURE_DUMP_TOKEN_INVALID");
      tokens.push({ type: quote === "`" ? "identifier" : "literal", value }); continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index));
    if (word) { tokens.push({ type: "word", value: word[0] }); index += word[0].length; }
    else tokens.push({ type: "symbol", value: sql[index++] });
  }
  return tokens;
}

function validateDumpAlterTargets(sql, tableNames) {
  const tokens = dumpControlTokens(sql), tables = new Set(tableNames);
  const isWord = (token, expected) => token?.type === "word" && token.value.toUpperCase() === expected;
  for (let index = 0; index < tokens.length; index++) {
    if (!isWord(tokens[index], "ALTER")) continue;
    const name = tokens[index + 2];
    requireSafe(isWord(tokens[index + 1], "TABLE") && ["identifier", "word"].includes(name?.type)
      && tables.has(name.value) && (isWord(tokens[index + 3], "ENABLE") || isWord(tokens[index + 3], "DISABLE"))
      && isWord(tokens[index + 4], "KEYS") && (!tokens[index + 5] || tokens[index + 5].value === ";"),
    "STRUCTURE_DUMP_ALTER_OUT_OF_SCOPE");
  }
}

export function validateStructureDump(bytes, tableNames) {
  requireSafe(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_BYTES, "STRUCTURE_DUMP_SIZE_INVALID");
  let sql;
  try { sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { requireSafe(false, "STRUCTURE_DUMP_ENCODING_INVALID"); }
  const operations = sqlOperationText(sql).replace(/\bON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\s*\(\s*\d*\s*\))?/gi, " ")
    .replace(/\bON\s+(?:UPDATE|DELETE)\s+(?:CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT)/gi, " ");
  requireSafe(!/\b(?:DROP|USE|GRANT|REVOKE|SHUTDOWN|INSERT|UPDATE|DELETE|REPLACE|LOAD|SELECT|CALL|TABLESPACE|CONNECTION|ENCRYPTION|INSTALL|UNINSTALL|RENAME|TRUNCATE|HANDLER|FLUSH|RESET|KILL)\b|\b(?:CREATE|ALTER)\s+(?:DATABASE|SCHEMA|USER|ROLE|SERVER|VIEW|EVENT|TRIGGER|PROCEDURE|FUNCTION)\b|\bSET\s+(?:@@)?(?:GLOBAL|PERSIST|PERSIST_ONLY)\b|\b(?:DATA|INDEX)\s+DIRECTORY\b/i.test(operations), "UNSAFE_STRUCTURE_DUMP_OPERATION");
  requireSafe(!/^\s*(?:\\[.!]|source\b|system\b|connect\b|delimiter\b)/im.test(operations), "MYSQL_CLIENT_COMMAND_FORBIDDEN");
  requireSafe(!/\b(?:CREATE\s+TABLE|ALTER\s+TABLE|REFERENCES|LOCK\s+TABLES)\s+[A-Za-z0-9_$]*\s*\./i.test(operations), "QUALIFIED_DUMP_TARGET_FORBIDDEN");
  const names = [...sql.matchAll(/^CREATE TABLE `([A-Za-z_][A-Za-z0-9_]*)` \(/gm)].map(match => match[1]).sort();
  requireSafe(jsonHash(names) === jsonHash([...tableNames].sort()), "STRUCTURE_DUMP_TABLE_SET_MISMATCH");
  validateDumpAlterTargets(sql, tableNames);
  return { bytes: bytes.length, sha256: digest(bytes), tableCount: names.length, schemaOnly: true };
}

async function loadConnector() { return (await import("mysql2/promise")).createConnection; }

export async function runStructureRehearsal(options, { environment = process.env, argv = process.argv, io = fs,
  runtime = { platform: process.platform, arch: process.arch }, load = loadConnector, native = runLinuxNative,
  timers = { setTimeout, clearTimeout } } = {}) {
  requireSafe(options.executeLocal === true && options.linuxIsolatedVm === true && options.output, "EXPLICIT_STRUCTURE_REHEARSAL_ARGUMENTS_REQUIRED");
  const profile = createHistoricalPlatformProfile(options, { io, runtime });
  profile.validateEnvironment(environment, argv);
  const paths = profile.validatePaths(options), output = validateOutput(options.output, io);
  const binaries = profile.validateBinaries(paths.root, options.bindir), artifact = loadPrivateExport(options, io);
  const source = schemaNames().synthetic, restored = schemaNames().synthetic;
  requireSafe(source !== restored, "FRESH_SCHEMA_COLLISION");
  const receipt = { formatVersion: 1, mode: "private-production-structure-only-linux-rehearsal", status: "running",
    startedAt: new Date().toISOString(), artifactSha256: options.artifactSha256, exportReceiptSha256: options.receiptSha256,
    schemas: { source, restored }, sourceServer: artifact.server, platform: profile.runtime,
    productionWrites: false, productionBusinessRowsRead: false, businessRowsCopied: false,
    migrationsExecuted: false, migrationLedgerSeeded: false, productionBackupRecoveryValidated: false,
    caseSensitiveLinuxValidated: false, limitations: ["Schema-only structure clone and local dump/restore; no production data or ledger completion inferred.",
      "Caller/setup establishes VM isolation; this tool does not attest the hypervisor.",
      "Raw defaults/comments/expressions and generated dump remain private; failed schemas and receipts are retained."] };
  const connections = [], controller = new AbortController();
  const timer = timers.setTimeout(() => {
    controller.abort(); receipt.status = "failed"; receipt.deadlineExceeded = true;
    receipt.error = { code: "STRUCTURE_REHEARSAL_DEADLINE_EXCEEDED" };
    for (const raw of connections) {
      try { raw.destroy(); }
      catch (error) { (receipt.deadlineCleanupErrors ??= []).push(safeError(error)); }
    }
  }, 10 * 60_000);
  let dumpFd;
  const active = () => requireSafe(!controller.signal.aborted, "STRUCTURE_REHEARSAL_DEADLINE_EXCEEDED");
  try {
    const createConnection = await load();
    const connect = async database => {
      active(); profile.validatePaths(options);
      requireSafe(database === undefined || pattern.test(database), "NON_SYNTHETIC_SCHEMA_FORBIDDEN");
      const raw = await createConnection({ ...connectionOptions(paths), multipleStatements: false, supportBigNumbers: true,
        bigNumberStrings: true, dateStrings: true, jsonStrings: true, ...(database ? { database } : {}) });
      connections.push(raw);
      const connection = { query(sql, values = []) { active(); return raw.query({ sql, timeout: 30_000 }, values); } };
      const [identities] = await connection.query("SELECT DATABASE() AS schemaName, @@version AS version, @@datadir AS datadir, @@socket AS socket, @@skip_networking AS skipNetworking, @@lower_case_table_names AS lowerCaseTableNames, @@sql_mode AS sqlMode, @@event_scheduler AS eventScheduler");
      const row = identities?.[0];
      receipt.localServer = profile.validateServerIdentity(row, paths);
      requireSafe(row.schemaName === (database ?? null), "CURRENT_SCHEMA_MISMATCH");
      requireSafe(row.version === artifact.server.version, "SOURCE_LOCAL_MYSQL_VERSION_MISMATCH");
      const [plugins] = await connection.query("SELECT PLUGIN_STATUS AS pluginStatus FROM information_schema.plugins WHERE PLUGIN_NAME='mysqlx'");
      Object.assign(receipt.localServer, validateLinuxPluginRows(plugins));
      receipt.serverEnvironment = { sourceSqlMode: artifact.server.sqlMode, localInitialSqlMode: row.sqlMode };
      await connection.query("SET SESSION sql_mode = ?", [artifact.server.sqlMode]);
      await connection.query("SET SESSION sql_quote_show_create = 1");
      return connection;
    };
    const admin = await connect();
    const create = async name => {
      requireSafe(pattern.test(name), "NON_SYNTHETIC_SCHEMA_FORBIDDEN");
      const schema = artifact.catalog.schema[0];
      await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET ${schema.characterSetName} COLLATE ${schema.collationName}`);
      (receipt.schemasCreated ??= []).push(name);
      const connection = await connect(name);
      const [tables] = await connection.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
      requireSafe(tables.length === 0, "NEW_SCHEMA_NOT_EMPTY");
      return connection;
    };
    const sourceConnection = await create(source);
    await sourceConnection.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
    for (const table of artifact.tables) {
      active(); await sourceConnection.query(table.ddl);
      receipt.createdTableCount = (receipt.createdTableCount ?? 0) + 1;
    }
    await sourceConnection.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
    receipt.clone = compareStructure(artifact, await collectLocalStructure(sourceConnection, source));
    const dumpPath = path.join(paths.root, `production-structure-${randomBytes(8).toString("hex")}.sql`);
    profile.validateBinaries(paths.root, options.bindir);
    dumpFd = io.openSync(dumpPath, "wx+", 0o600);
    receipt.dump = { path: dumpPath, status: "writing", mode: "0600" };
    await native({ binary: binaries.mysqldump, args: structureDumpArguments(profile, paths.socket, source), root: paths.root, outputFd: dumpFd, signal: controller.signal });
    const stat = io.fstatSync(dumpFd);
    requireSafe(stat.isFile() && (stat.mode & 0o7777) === 0o600 && stat.size > 0 && stat.size <= MAX_BYTES, "PRIVATE_STRUCTURE_DUMP_INVALID");
    const bytes = Buffer.alloc(stat.size);
    requireSafe(io.readSync(dumpFd, bytes, 0, bytes.length, 0) === bytes.length, "STRUCTURE_DUMP_READ_INCOMPLETE");
    receipt.dump = { path: dumpPath, mode: "0600", status: "validated", ...validateStructureDump(bytes, artifact.tables.map(table => table.tableName)) };
    io.closeSync(dumpFd); dumpFd = undefined;
    const restoredConnection = await create(restored);
    profile.validateBinaries(paths.root, options.bindir);
    await native({ binary: binaries.mysql, args: profile.nativeArguments("restore", paths.socket, restored), root: paths.root, input: bytes, signal: controller.signal });
    receipt.restoration = compareStructure(artifact, await collectLocalStructure(restoredConnection, restored));
    receipt.sourceUnchanged = compareStructure(artifact, await collectLocalStructure(sourceConnection, source));
    loadPrivateExport(options, io);
    active(); // A deadline during the final awaited read cannot turn green.
    receipt.status = "completed";
  } catch (error) { receipt.status = "failed"; receipt.error = safeError(error); }
  finally {
    timers.clearTimeout(timer);
    if (dumpFd !== undefined) { try { io.closeSync(dumpFd); } catch (error) { receipt.closeError = safeError(error); receipt.status = "failed"; } }
    for (const raw of connections) { try { raw.destroy(); } catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; } }
    receipt.finishedAt = new Date().toISOString();
  }
  receipt.caseSensitiveLinuxValidated = receipt.status === "completed";
  io.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}

export async function main(args, { dependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try { const receipt = await runStructureRehearsal(parseArguments(args), dependencies); stdout.write(`${JSON.stringify(receipt, null, 2)}\n`); return receipt.status === "completed" ? 0 : 1; }
  catch (error) { stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: safeError(error) })}\n`); return 1; }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main(process.argv.slice(2));
