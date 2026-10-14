// Explicit forward candidate on fresh isolated Linux structure copies only.
// Never invokes the migration runner, imports a ledger, or accepts an existing DB.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createHistoricalPlatformProfile, validateLinuxPluginRows, runLinuxNative } from "./historicalPlatformProfile.mjs";
import { connectionOptions, schemaNames, validateOutput, safeError } from "./mysqlRehearsal.mjs";
import { parseArguments as parseStructureArguments, loadPrivateExport, runStructureRehearsal, collectLocalStructure,
  compareStructure, mapCatalogSchema, structureDumpArguments, validateStructureDump } from "./productionStructureRehearsal.mjs";
import { TABLE_NAME, COLUMN_CONTRACTS, CANDIDATE_SQL, planCampaignNullability, verifyCampaignNullabilityTransition } from "./campaignNullabilityContract.mjs";
import { normalizeSnapshotCreateTable } from "./snapshotDdlNormalization.mjs";

const requireSafe = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const hash = value => createHash("sha256").update(value).digest("hex");
const jsonHash = value => hash(JSON.stringify(value));
const schemaPattern = /^amazon_rehearsal_[a-f0-9]{16}_synthetic$/;
const policy = Object.freeze({ scope: "isolated-local-only", defaultPolicy: "align-null-default" });
const MAX_BYTES = 64 * 1024 * 1024;
const extraArguments = new Map([["--structure-receipt", "structureReceipt"], ["--structure-receipt-sha256", "structureReceiptSha256"],
  ["--candidate-sha256", "candidateSha256"]]);

export function parseArguments(args) {
  const remaining = [], extras = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index] === "--forward-campaign-null-default" ? "forwardCampaignNullDefault" : extraArguments.get(args[index]);
    if (!key) { remaining.push(args[index]); continue; }
    requireSafe(!Object.hasOwn(extras, key), "INVALID_FORWARD_ARGUMENTS");
    if (key === "forwardCampaignNullDefault") extras[key] = true;
    else {
      const value = args[++index];
      requireSafe(typeof value === "string" && value.length > 0 && !value.startsWith("--") && !value.includes("\0"), "INVALID_FORWARD_ARGUMENTS");
      extras[key] = value;
    }
  }
  requireSafe(extras.forwardCampaignNullDefault && [...extraArguments.values()].every(key => extras[key]), "EXPLICIT_FORWARD_ARGUMENTS_REQUIRED");
  return { ...parseStructureArguments(remaining), ...extras };
}

function readReceipt(filename, io) {
  requireSafe(typeof filename === "string" && path.isAbsolute(filename) && path.normalize(filename) === filename
    && !filename.includes("\0") && io.realpathSync(filename) === filename, "STRUCTURE_RECEIPT_PATH_INVALID");
  const fd = io.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = io.fstatSync(fd);
    requireSafe(stat.isFile() && (stat.mode & 0o7777) === 0o600 && stat.uid === process.getuid()
      && stat.size > 0 && stat.size <= 1024 * 1024, "STRUCTURE_RECEIPT_FILE_INVALID");
    const bytes = io.readFileSync(fd);
    requireSafe(Buffer.isBuffer(bytes) && bytes.length === stat.size, "STRUCTURE_RECEIPT_READ_INVALID");
    let receipt;
    try { receipt = JSON.parse(bytes); } catch { requireSafe(false, "STRUCTURE_RECEIPT_JSON_INVALID"); }
    return { receipt, bytes };
  } finally { io.closeSync(fd); }
}

export function validateCompletedStructureReceipt(receipt, options, artifact) {
  requireSafe(receipt?.formatVersion === 1 && receipt.mode === "private-production-structure-only-linux-rehearsal"
    && receipt.status === "completed" && receipt.caseSensitiveLinuxValidated === true
    && receipt.productionWrites === false && receipt.productionBusinessRowsRead === false && receipt.businessRowsCopied === false
    && receipt.migrationsExecuted === false && receipt.migrationLedgerSeeded === false
    && receipt.productionBackupRecoveryValidated === false && !receipt.error && !receipt.deadlineExceeded,
  "COMPLETED_STRUCTURE_RECEIPT_REQUIRED");
  requireSafe(receipt.artifactSha256 === options.artifactSha256 && receipt.exportReceiptSha256 === options.receiptSha256
    && isDeepStrictEqual(receipt.sourceServer, artifact.server), "STRUCTURE_RECEIPT_BINDING_MISMATCH");
  requireSafe(receipt.platform?.platform === "linux" && receipt.platform.architecture === "arm64"
    && receipt.platform.distribution === "ubuntu" && receipt.platform.distributionVersion === "24.04"
    && receipt.localServer?.version === artifact.server.version && receipt.localServer.networkingDisabled === true
    && receipt.localServer.lowerCaseTableNames === 0 && receipt.localServer.mysqlxDisabled === true
    && ["OFF", "DISABLED"].includes(receipt.localServer.eventScheduler), "STRUCTURE_RECEIPT_PLATFORM_INVALID");
  const names = [receipt.schemas?.source, receipt.schemas?.restored];
  requireSafe(names.every(name => schemaPattern.test(name)) && new Set(names).size === 2
    && isDeepStrictEqual(receipt.schemasCreated, names), "STRUCTURE_RECEIPT_SCHEMAS_INVALID");
  for (const name of ["clone", "restoration", "sourceUnchanged"]) {
    const result = receipt[name];
    requireSafe(result?.tableCount === options.expectedTables && result.businessRows === 0 && result.catalogEqual === true
      && result.ddlEqual === true && result.schemaMappingOnly === true && /^[a-f0-9]{64}$/.test(result.catalogSha256)
      && /^[a-f0-9]{64}$/.test(result.normalizedDdlSha256), "STRUCTURE_RECEIPT_COMPARISON_INVALID");
    requireSafe(result.catalogSha256 === jsonHash(mapCatalogSchema(artifact.catalog, artifact.schema,
      name === "restoration" ? names[1] : names[0])), "STRUCTURE_RECEIPT_CATALOG_HASH_MISMATCH");
  }
  const normalizedDdlSha256 = jsonHash(artifact.tables.map(table => [table.tableName,
    normalizeSnapshotCreateTable(table.ddl, artifact.catalog.columns.filter(column => column.tableName === table.tableName))]));
  requireSafe([receipt.clone, receipt.restoration, receipt.sourceUnchanged].every(value => value.normalizedDdlSha256 === normalizedDdlSha256)
    && receipt.createdTableCount === options.expectedTables && receipt.dump?.status === "validated" && receipt.dump.schemaOnly === true
    && receipt.dump.tableCount === options.expectedTables && /^[a-f0-9]{64}$/.test(receipt.dump.sha256)
    && Number.isInteger(receipt.dump.bytes) && receipt.dump.bytes > 0 && receipt.dump.bytes <= MAX_BYTES,
  "STRUCTURE_RECEIPT_DDL_OR_DUMP_INVALID");
  return receipt;
}

export function loadCompletedStructureReceipt(options, artifact, io = fs) {
  requireSafe(/^[a-f0-9]{64}$/.test(options.structureReceiptSha256), "EXPLICIT_STRUCTURE_RECEIPT_HASH_REQUIRED");
  const { receipt, bytes } = readReceipt(options.structureReceipt, io);
  requireSafe(hash(bytes) === options.structureReceiptSha256, "STRUCTURE_RECEIPT_HASH_MISMATCH");
  return validateCompletedStructureReceipt(receipt, options, artifact);
}

export function verifyForwardStructure(before, after, candidate) {
  requireSafe(before.schema === after.schema && schemaPattern.test(before.schema), "FORWARD_SCHEMA_IDENTITY_CHANGED");
  const transition = verifyCampaignNullabilityTransition(before.catalog, after.catalog, candidate, policy);
  requireSafe(before.zeroRowTables === before.tables.length && after.zeroRowTables === before.tables.length
    && before.tables.length === after.tables.length, "FORWARD_NONEMPTY_OR_TABLE_COUNT_CHANGED");
  const normalize = (table, snapshot) => normalizeSnapshotCreateTable(table.ddl,
    snapshot.catalog.columns.filter(column => column.tableName === table.tableName));
  for (const [index, table] of before.tables.entries()) {
    requireSafe(table.tableName === after.tables[index]?.tableName, "FORWARD_DDL_TABLE_SET_CHANGED");
    let expectedTable = table;
    if (table.tableName === TABLE_NAME && candidate.action === "alter") {
      const lines = table.ddl.split("\n");
      for (const column of COLUMN_CONTRACTS) {
        const from = `  \`${column.name}\` ${column.columnType} NOT NULL DEFAULT '${column.defaultValue}',`;
        requireSafe(lines.filter(line => line === from).length === 1, "FORWARD_TARGET_DDL_SOURCE_UNREVIEWED");
        lines[lines.indexOf(from)] = `  \`${column.name}\` ${column.columnType} DEFAULT NULL,`;
      }
      expectedTable = { ...table, ddl: lines.join("\n") };
    }
    requireSafe(normalize(expectedTable, after) === normalize(after.tables[index], after), "FORWARD_UNAPPROVED_DDL_CHANGE");
  }
  return { ...transition, nonTargetDdlUnchanged: true, targetDdlOnlyFiveReviewedClauses: true,
    zeroRowTables: after.zeroRowTables, tableCount: after.tables.length };
}

const canaryColumns = Object.freeze(["workspaceId", "id", "user_id", "profile_id", "source_store_id", "country", "report_date", "ad_type",
  "campaign_id", "campaign_name", "campaign_status", "bidding_strategy", "budget", "currency", "source_batch_id", "source_row_hash",
  "source_payload_hash", "version", "created_at", "updated_at"]);
const canaryTypes = Object.freeze(["int", "int", "int", "varchar(64)", "varchar(64)", "varchar(16)", "varchar(10)", "varchar(12)",
  "varchar(80)", "varchar(500)", "varchar(64)", "varchar(100)", "decimal(14,2)", "varchar(12)", "int", "varchar(64)", "varchar(64)",
  "int", "timestamp", "timestamp"]);
const metricNames = COLUMN_CONTRACTS.map(column => column.name);

export function validateCanaryContract(catalog) {
  requireSafe(planCampaignNullability(catalog, policy).action === "noop", "CANARY_REQUIRES_COMPLETED_FORWARD_CONTRACT");
  const columns = catalog.columns.filter(column => column.tableName === TABLE_NAME);
  requireSafe(columns.length === canaryColumns.length + metricNames.length, "CANARY_COLUMN_SET_UNREVIEWED");
  for (const [index, name] of canaryColumns.entries()) {
    const column = columns.find(value => value.columnName === name);
    requireSafe(column?.columnType === canaryTypes[index] && column.generationExpression === ""
      && (name === "id" ? column.isNullable === "NO" && column.extra === "auto_increment" && column.columnKey === "PRI"
        : !/auto_increment|virtual|stored|invisible/i.test(column.extra)), "CANARY_COLUMN_CONTRACT_UNREVIEWED");
  }
  const idKeys = catalog.keyColumns.filter(key => key.tableName === TABLE_NAME && key.constraintName === "PRIMARY");
  requireSafe(idKeys.length === 1 && idKeys[0].columnName === "id" && Number(idKeys[0].ordinalPosition) === 1
    && idKeys[0].referencedTableSchema === null && idKeys[0].referencedTableName === null,
  "CANARY_SINGLE_SIGNED_ID_PRIMARY_KEY_REQUIRED");
  requireSafe(!catalog.foreignKeys.some(key => key.tableName === TABLE_NAME || key.referencedTableName === TABLE_NAME)
    && !catalog.keyColumns.some(key => (key.tableName === TABLE_NAME && key.referencedTableName !== null)
      || key.referencedTableName === TABLE_NAME), "CANARY_FOREIGN_KEY_DEPENDENCY_UNREVIEWED");
  requireSafe(!catalog.checks.some(check => check.tableName === TABLE_NAME)
    && !catalog.triggers.some(trigger => trigger.tableName === TABLE_NAME), "CANARY_TRIGGER_OR_CHECK_UNREVIEWED");
  requireSafe(!catalog.indexes.some(index => index.tableName === TABLE_NAME && index.expression !== null && index.expression !== ""),
    "CANARY_FUNCTIONAL_INDEX_UNREVIEWED");
  return { signedExplicitNegativeIds: [-1, -2], transactionOnly: true, omittedMetricDefaults: true, explicitNullMetrics: true };
}

export async function runRollbackCanaries(connection, catalog) {
  const contract = validateCanaryContract(catalog);
  let transactionStarted = false;
  try {
    await connection.query("START TRANSACTION"); transactionStarted = true;
    for (const [id, explicit] of [[-1, true], [-2, false]]) {
      const names = explicit ? [...canaryColumns, ...metricNames] : [...canaryColumns];
      const values = [-1, id, -1, "fixture-profile", "fixture-store", "US", "2026-01-01", "SP", `fixture-campaign-${-id}`,
        null, null, null, null, null, -1, `fixture-row-${-id}`, `fixture-payload-${-id}`, 1, "2026-01-01 00:00:00", "2026-01-01 00:00:00"];
      if (explicit) values.push(...metricNames.map(() => null));
      const [result] = await connection.query(`INSERT INTO \`${TABLE_NAME}\` (${names.map(name => `\`${name}\``).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, values);
      requireSafe(result?.affectedRows === 1 && result.warningStatus === 0, "CANARY_INSERT_NOT_EXACT");
    }
    const [rows] = await connection.query(`SELECT \`id\`, ${metricNames.map(name => `\`${name}\``).join(", ")} FROM \`${TABLE_NAME}\` WHERE \`id\` IN (-2, -1) ORDER BY \`id\``);
    requireSafe(Array.isArray(rows) && rows.length === 2 && rows.every((row, index) => Number(row.id) === index - 2
      && Object.keys(row).length === 6 && metricNames.every(name => row[name] === null)), "CANARY_NULL_SEMANTICS_FAILED");
  } finally { if (transactionStarted) await connection.query("ROLLBACK"); }
  return { ...contract, rowsInserted: 2, rollbackCompleted: true, businessRowsCopied: false };
}

async function loadConnector() { return (await import("mysql2/promise")).createConnection; }

export async function runCampaignNullabilityRehearsal(options, { environment = process.env, argv = process.argv, io = fs,
  runtime = { platform: process.platform, arch: process.arch }, load = loadConnector, native = runLinuxNative,
  baseline = runStructureRehearsal, timers = { setTimeout, clearTimeout } } = {}) {
  requireSafe(options.executeLocal === true && options.linuxIsolatedVm === true && options.forwardCampaignNullDefault === true
    && options.output, "EXPLICIT_FORWARD_ARGUMENTS_REQUIRED");
  requireSafe(options.candidateSha256 === hash(CANDIDATE_SQL), "FORWARD_CANDIDATE_HASH_MISMATCH");
  const profile = createHistoricalPlatformProfile(options, { io, runtime });
  profile.validateEnvironment(environment, argv);
  const paths = profile.validatePaths(options), output = validateOutput(options.output, io);
  const binaries = profile.validateBinaries(paths.root, options.bindir), artifact = loadPrivateExport(options, io);
  const prerequisite = loadCompletedStructureReceipt(options, artifact, io);
  const preflight = planCampaignNullability(mapCatalogSchema(artifact.catalog, artifact.schema, schemaNames().synthetic), policy);
  requireSafe(preflight.action === "alter" && preflight.sqlSha256 === options.candidateSha256, "FORWARD_SOURCE_MUST_REQUIRE_REVIEWED_ALTER");
  const baselineOutput = validateOutput(path.join(path.dirname(output), `campaign-baseline-${randomBytes(8).toString("hex")}.json`), io);
  const receipt = { formatVersion: 1, mode: "isolated-linux-forward-campaign-null-default-rehearsal", status: "running", stage: "baseline",
    startedAt: new Date().toISOString(), artifactSha256: options.artifactSha256, exportReceiptSha256: options.receiptSha256,
    prerequisiteStructureReceiptSha256: options.structureReceiptSha256, candidateSha256: options.candidateSha256,
    defaultPolicy: policy.defaultPolicy, baselineReceiptPath: baselineOutput, productionWrites: false, productionBusinessRowsRead: false,
    businessRowsCopied: false, migrationRunnerInvoked: false, migrationLedgerSeeded: false, registeredMigration: false,
    productionBackupRecoveryValidated: false, platform: profile.runtime,
    limitations: ["Fresh structure-only local copies; no production data recovery or migration ledger completion inferred.",
      "Only five reviewed nullable/default changes; this is not a registered or production-approved migration.",
      "Caller/setup establishes VM isolation; private dumps, failed schemas and receipts are retained."] };
  const connections = [], controller = new AbortController();
  const active = () => requireSafe(!controller.signal.aborted, "FORWARD_REHEARSAL_DEADLINE_EXCEEDED");
  let timer, dumpFd;
  try {
    const baselineReceipt = await baseline({ ...options, output: baselineOutput }, { environment, argv, io, runtime, load, native, timers });
    requireSafe(baselineReceipt?.status === "completed", "FORWARD_BASELINE_REHEARSAL_FAILED");
    validateCompletedStructureReceipt(baselineReceipt, options, artifact);
    const baselineFile = readReceipt(baselineOutput, io);
    requireSafe(isDeepStrictEqual(baselineFile.receipt, baselineReceipt), "FORWARD_BASELINE_RECEIPT_CHANGED");
    receipt.baselineReceiptSha256 = hash(baselineFile.bytes);
    const { source, restored: target } = baselineReceipt.schemas, recovered = schemaNames().synthetic;
    const allNames = [source, target, recovered, prerequisite.schemas.source, prerequisite.schemas.restored];
    requireSafe(allNames.every(name => schemaPattern.test(name)) && new Set(allNames).size === allNames.length, "FORWARD_FRESH_SCHEMA_COLLISION");
    receipt.schemas = { source, target, recovered };
    timer = timers.setTimeout(() => {
      controller.abort(); receipt.deadlineExceeded = true;
      for (const raw of connections) try { raw.destroy(); } catch { receipt.deadlineCleanupFailed = true; }
    }, 10 * 60_000);
    const createConnection = await load();
    const connect = async database => {
      active(); profile.validatePaths(options);
      requireSafe(database === undefined || [source, target, recovered].includes(database), "FORWARD_UNOWNED_SCHEMA_FORBIDDEN");
      const raw = await createConnection({ ...connectionOptions(paths), multipleStatements: false, supportBigNumbers: true,
        bigNumberStrings: true, dateStrings: true, jsonStrings: true, ...(database ? { database } : {}) });
      connections.push(raw);
      const connection = { query(sql, values = []) { active(); return raw.query({ sql, timeout: 30_000 }, values); } };
      const [rows] = await connection.query("SELECT DATABASE() AS schemaName, @@version AS version, @@datadir AS datadir, @@socket AS socket, @@skip_networking AS skipNetworking, @@lower_case_table_names AS lowerCaseTableNames, @@sql_mode AS sqlMode, @@event_scheduler AS eventScheduler");
      requireSafe(rows?.length === 1 && rows[0].schemaName === (database ?? null), "FORWARD_CURRENT_SCHEMA_MISMATCH");
      receipt.localServer = profile.validateServerIdentity(rows[0], paths);
      requireSafe(rows[0].version === artifact.server.version, "SOURCE_LOCAL_MYSQL_VERSION_MISMATCH");
      const [plugins] = await connection.query("SELECT PLUGIN_STATUS AS pluginStatus FROM information_schema.plugins WHERE PLUGIN_NAME='mysqlx'");
      Object.assign(receipt.localServer, validateLinuxPluginRows(plugins));
      await connection.query("SET SESSION sql_mode = ?", [artifact.server.sqlMode]);
      await connection.query("SET SESSION sql_quote_show_create = 1");
      return connection;
    };
    receipt.stage = "pre_alter_verification";
    const targetConnection = await connect(target), before = await collectLocalStructure(targetConnection, target);
    receipt.before = compareStructure(artifact, before);
    const candidate = planCampaignNullability(before.catalog, policy);
    requireSafe(candidate.action === "alter" && candidate.sql === CANDIDATE_SQL && candidate.sqlSha256 === options.candidateSha256,
      "FORWARD_CANDIDATE_HASH_MISMATCH");
    // Validate the exact canary shape before ALTER, against its expected catalog.
    const expectedCatalog = structuredClone(before.catalog);
    for (const column of expectedCatalog.columns) if (column.tableName === TABLE_NAME && metricNames.includes(column.columnName)) {
      column.isNullable = "YES"; column.columnDefault = null;
    }
    validateCanaryContract(expectedCatalog);
    receipt.stage = "apply_candidate";
    await targetConnection.query(candidate.sql); receipt.candidateApplied = true;
    const after = await collectLocalStructure(targetConnection, target);
    receipt.transition = verifyForwardStructure(before, after, candidate);
    const repeat = planCampaignNullability(after.catalog, policy);
    requireSafe(repeat.action === "noop" && repeat.sql === null, "FORWARD_SECOND_PLAN_NOT_NOOP");
    receipt.repeat = verifyCampaignNullabilityTransition(after.catalog, after.catalog, repeat, policy);
    receipt.stage = "rollback_canaries";
    receipt.canaries = await runRollbackCanaries(targetConnection, after.catalog);
    receipt.afterRollback = compareStructure(after, await collectLocalStructure(targetConnection, target));
    receipt.stage = "after_dump";
    profile.validateBinaries(paths.root, options.bindir);
    const dumpPath = path.join(paths.root, `campaign-nullability-${randomBytes(8).toString("hex")}.sql`);
    dumpFd = io.openSync(dumpPath, "wx+", 0o600);
    receipt.afterDump = { path: dumpPath, status: "writing", mode: "0600" };
    await native({ binary: binaries.mysqldump, args: structureDumpArguments(profile, paths.socket, target), root: paths.root, outputFd: dumpFd, signal: controller.signal });
    const stat = io.fstatSync(dumpFd);
    requireSafe(stat.isFile() && (stat.mode & 0o7777) === 0o600 && stat.size > 0 && stat.size <= MAX_BYTES, "PRIVATE_FORWARD_DUMP_INVALID");
    const bytes = Buffer.alloc(stat.size);
    requireSafe(io.readSync(dumpFd, bytes, 0, bytes.length, 0) === bytes.length, "FORWARD_DUMP_READ_INCOMPLETE");
    receipt.afterDump = { path: dumpPath, mode: "0600", status: "validated", ...validateStructureDump(bytes, after.tables.map(table => table.tableName)) };
    io.closeSync(dumpFd); dumpFd = undefined;
    receipt.stage = "after_restore";
    const admin = await connect(), schema = artifact.catalog.schema[0];
    await admin.query(`CREATE DATABASE \`${recovered}\` CHARACTER SET ${schema.characterSetName} COLLATE ${schema.collationName}`);
    receipt.recoverySchemaCreated = true;
    const recoveredConnection = await connect(recovered);
    const [tables] = await recoveredConnection.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
    requireSafe(Array.isArray(tables) && tables.length === 0, "NEW_SCHEMA_NOT_EMPTY");
    profile.validateBinaries(paths.root, options.bindir);
    await native({ binary: binaries.mysql, args: profile.nativeArguments("restore", paths.socket, recovered), root: paths.root, input: bytes, signal: controller.signal });
    const restoredAfter = await collectLocalStructure(recoveredConnection, recovered);
    receipt.afterRestoration = compareStructure(after, restoredAfter);
    const restoredPlan = planCampaignNullability(restoredAfter.catalog, policy);
    requireSafe(restoredPlan.action === "noop", "FORWARD_RESTORED_PLAN_NOT_NOOP");
    receipt.restoredRepeat = verifyCampaignNullabilityTransition(restoredAfter.catalog, restoredAfter.catalog, restoredPlan, policy);
    receipt.stage = "final_verification";
    receipt.targetUnchanged = compareStructure(after, await collectLocalStructure(targetConnection, target));
    const sourceConnection = await connect(source);
    receipt.sourceUnchanged = compareStructure(artifact, await collectLocalStructure(sourceConnection, source));
    loadPrivateExport(options, io); loadCompletedStructureReceipt(options, artifact, io);
    const finalBaselineFile = readReceipt(baselineOutput, io);
    requireSafe(hash(finalBaselineFile.bytes) === receipt.baselineReceiptSha256
      && isDeepStrictEqual(finalBaselineFile.receipt, baselineReceipt), "FORWARD_BASELINE_RECEIPT_CHANGED");
    active(); receipt.status = "completed"; receipt.stage = "completed";
  } catch (error) { receipt.status = "failed"; receipt.error = safeError(error); }
  finally {
    if (timer !== undefined) timers.clearTimeout(timer);
    if (dumpFd !== undefined) try { io.closeSync(dumpFd); } catch (error) { receipt.closeError = safeError(error); receipt.status = "failed"; }
    for (const raw of connections) try { raw.destroy(); } catch (error) { receipt.cleanupError = safeError(error); receipt.status = "failed"; }
    receipt.finishedAt = new Date().toISOString();
  }
  io.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}

export async function main(args, { dependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try { const receipt = await runCampaignNullabilityRehearsal(parseArguments(args), dependencies); stdout.write(`${JSON.stringify(receipt, null, 2)}\n`); return receipt.status === "completed" ? 0 : 1; }
  catch (error) { stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: safeError(error) })}\n`); return 1; }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main(process.argv.slice(2));
