#!/usr/bin/env node
// Separate entry point for a deliberately empty local/CI schema. This never
// changes existing-schema runner policy, baselines history, or resumes failures.
import { randomUUID } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkPostconditions } from "./integration/freshHistoricalLineage.mjs";
import { BOOTSTRAP_VERSION, RECEIPT_MIGRATION, assertCatalogMatches, fingerprint, insist,
  loadFreshBootstrapPlan, loadStructureContract, readFreshCatalog, sha256, validateStructureContract } from "./database/freshBootstrapPlan.mjs";

export const EMPTY_ALIGNMENT_MIGRATION = "bootstrap/0005_offsite_empty_table_alignment.sql";
export const EMPTY_ALIGNMENT_TABLES = Object.freeze([
  "off_ai_analysis_logs", "off_attribution_links", "off_campaign_analytics", "off_campaigns",
  "off_collaborations", "off_content_calendar", "off_content_submissions", "off_influencer_scores",
  "off_influencers", "off_matrix_groups", "off_outreach_messages", "off_social_accounts",
]);

// These obsolete definitions may be replaced only during an original empty
// installation. Recheck immediately before their migration starts, so a future
// seed cannot turn the replacement into deletion of initialized records.
export async function verifyEmptyAlignmentTables(connection) {
  for (const table of EMPTY_ALIGNMENT_TABLES) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``);
    insist(rows?.length === 1 && String(rows[0].rowCount) === "0", "FRESH_ALIGNMENT_TABLE_NOT_EMPTY");
  }
  return { migrationName: EMPTY_ALIGNMENT_MIGRATION, tables: [...EMPTY_ALIGNMENT_TABLES],
    checkedAt: new Date().toISOString() };
}

export function parseArguments(args) {
  const options = { execute: false };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (["--plan", "--execute"].includes(key)) {
      insist(options.mode === undefined, "BOOTSTRAP_ARGUMENTS_INVALID");
      options.mode = key.slice(2); options.execute = key === "--execute";
    } else {
      insist(["--schema", "--environment", "--socket"].includes(key) && !Object.hasOwn(options, key.slice(2)), "BOOTSTRAP_ARGUMENTS_INVALID");
      const value = args[++index];
      insist(typeof value === "string" && value.length > 0 && !value.startsWith("--"), "BOOTSTRAP_ARGUMENTS_INVALID");
      options[key.slice(2)] = value;
    }
  }
  insist(options.execute || Object.keys(options).every(key => ["execute", "mode"].includes(key)), "PLAN_TAKES_NO_TARGET_ARGUMENTS");
  return options;
}

export function validateTarget(options, environment, io = { lstatSync, realpathSync }) {
  insist(options.execute === true && ["local", "ci"].includes(options.environment), "EXPLICIT_FRESH_ENVIRONMENT_REQUIRED");
  insist(options.environment === "ci" ? options.schema === "amazon_listing_ci"
    : /^amazon_fresh_[a-f0-9]{16}_synthetic$/.test(options.schema ?? ""), "FRESH_SCHEMA_NAME_NOT_ALLOWED");
  insist(environment.NODE_ENV !== "production" && !environment.NODE_OPTIONS && !environment.DOTENV_KEY
    && !Object.keys(environment).some(key => /^ALLOW_.*PRODUCTION/.test(key) && environment[key] === "true"), "FRESH_PRODUCTION_OR_PRELOAD_ENV_FORBIDDEN");
  for (const key of Object.keys(environment)) if (/^DOTENV_CONFIG_/i.test(key)) {
    insist(key === "DOTENV_CONFIG_PATH" && environment[key] === "/dev/null", "FRESH_DOTENV_CONFIGURATION_FORBIDDEN");
  }
  // Do not consume DATABASE_URL, a .env, or the app's implicit production target.
  insist(typeof environment.FRESH_BOOTSTRAP_DATABASE_URL === "string", "EXPLICIT_FRESH_DATABASE_URL_REQUIRED");
  let url;
  try { url = new URL(environment.FRESH_BOOTSTRAP_DATABASE_URL); } catch { throw Object.assign(new Error("FRESH_DATABASE_URL_INVALID"), { code: "FRESH_DATABASE_URL_INVALID" }); }
  insist(url.protocol === "mysql:" && !url.search && !url.hash && url.pathname === `/${options.schema}`
    && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname), "FRESH_LOCAL_TARGET_REQUIRED");
  if (options.socket) {
    insist(isAbsolute(options.socket) && normalize(options.socket) === options.socket
      && io.realpathSync(options.socket) === options.socket && io.lstatSync(options.socket).isSocket(), "FRESH_UNIX_SOCKET_INVALID");
    insist(!url.port, "SOCKET_AND_PORT_CONFLICT");
  } else insist(["127.0.0.1", "[::1]"].includes(url.hostname), "NUMERIC_LOOPBACK_OR_SOCKET_REQUIRED");
  return { host: url.hostname === "[::1]" ? "::1" : url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: options.schema,
    ...(options.socket ? { socketPath: options.socket } : {}), multipleStatements: true,
    connectTimeout: 5_000, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, jsonStrings: true };
}

export async function readObjects(connection, schema) {
  const counts = {};
  for (const [name, table, field] of [["tables", "TABLES", "TABLE_SCHEMA"], ["views", "VIEWS", "TABLE_SCHEMA"],
    ["triggers", "TRIGGERS", "TRIGGER_SCHEMA"], ["routines", "ROUTINES", "ROUTINE_SCHEMA"], ["events", "EVENTS", "EVENT_SCHEMA"]]) {
    const [rows] = await connection.execute(`SELECT COUNT(*) AS objectCount FROM information_schema.${table} WHERE BINARY ${field}=BINARY ?`, [schema]);
    const count = Number(rows?.[0]?.objectCount);
    insist(Number.isSafeInteger(count) && count >= 0, "FRESH_OBJECT_INSPECTION_INVALID"); counts[name] = count;
  }
  return counts;
}

async function assertIdentity(connection, schema, contract) {
  const [rows] = await connection.query("SELECT DATABASE() AS schemaName, @@version AS version, @@lower_case_table_names AS lowerCaseTableNames, @@sql_mode AS sqlMode");
  const row = rows?.[0];
  insist(row?.schemaName === schema && /^8\.0\.\d+(?:[-+.][A-Za-z0-9_.-]+)?$/.test(row.version)
    && Number(row.lowerCaseTableNames) === contract.platform.lowerCaseTableNames
    && typeof row.sqlMode === "string" && !row.sqlMode.split(",").includes("NO_BACKSLASH_ESCAPES"), "FRESH_SERVER_IDENTITY_MISMATCH");
  const [schemaRows] = await connection.execute("SELECT DEFAULT_CHARACTER_SET_NAME AS characterSetName, DEFAULT_COLLATION_NAME AS collationName FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?", [schema]);
  insist(schemaRows?.length === 1 && schemaRows[0].characterSetName === contract.platform.schemaCharacterSet
    && schemaRows[0].collationName === contract.platform.schemaCollation, "FRESH_SCHEMA_PLATFORM_MISMATCH");
  return { schema, mysqlVersion: row.version, lowerCaseTableNames: Number(row.lowerCaseTableNames), sqlMode: row.sqlMode };
}

const decodeMetadata = value => {
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; }
};
export async function readFullLedger(connection) {
  const [rows] = await connection.query("SELECT migrationName,checksum,status,executionId,startedAt,finishedAt,error,metadata FROM app_schema_migrations ORDER BY migrationName");
  return rows;
}
export const ledgerExecutionHash = rows => fingerprint(rows.map(row => ({ migrationName: row.migrationName,
  checksum: row.checksum, status: row.status, executionId: row.executionId, startedAt: row.startedAt,
  finishedAt: row.finishedAt, error: row.error })).sort((a, b) => a.migrationName.localeCompare(b.migrationName)));

export function validateExecutedLedger(rows, bundle, schema, { completed = true } = {}) {
  insist(rows.length === bundle.plan.length && new Set(rows.map(row => row.migrationName)).size === rows.length, "FRESH_LEDGER_NOT_EXACT_COMPLETE");
  const byName = new Map(rows.map(row => [row.migrationName, row]));
  const receipt = decodeMetadata(byName.get(RECEIPT_MIGRATION)?.metadata)?.freshBootstrap;
  insist(receipt?.version === BOOTSTRAP_VERSION && receipt.schema === schema
    && receipt.planSha256 === bundle.planSha256 && receipt.sourcesSha256 === bundle.sourcesSha256
    && /^[a-f0-9-]{36}$/.test(receipt.runId ?? "") && receipt.originalEmpty?.schema === schema
    && Number.isFinite(Date.parse(receipt.originalEmpty.checkedAt)) && receipt.originalEmpty.identity?.schema === schema
    && /^8\.0\./.test(receipt.originalEmpty.identity.mysqlVersion)
    && receipt.originalEmpty.identity.lowerCaseTableNames === 0
    && fingerprint(receipt.originalEmpty.objects) === fingerprint({ tables: 0, views: 0, triggers: 0, routines: 0, events: 0 })
    && receipt.stage === (completed ? "completed" : "executing"), "FRESH_LINEAGE_RECEIPT_INVALID");
  for (const item of bundle.plan) {
    const row = byName.get(item.fileName), proof = decodeMetadata(row?.metadata)?.freshBootstrap;
    insist(row?.checksum === item.checksum && row.status === "succeeded" && row.error === null
      && /^migration-[a-f0-9-]{36}$/.test(row.executionId ?? "") && row.startedAt && row.finishedAt
      && proof?.version === BOOTSTRAP_VERSION && proof.runId === receipt.runId && proof.schema === schema
      && proof.planSha256 === bundle.planSha256 && proof.sourcesSha256 === bundle.sourcesSha256
      && proof.sequence === item.order, "FRESH_MIGRATION_EXECUTION_PROOF_INVALID");
    if (item.fileName === EMPTY_ALIGNMENT_MIGRATION) insist(proof.emptyAlignment?.migrationName === EMPTY_ALIGNMENT_MIGRATION
      && fingerprint(proof.emptyAlignment.tables) === fingerprint(EMPTY_ALIGNMENT_TABLES)
      && Number.isFinite(Date.parse(proof.emptyAlignment.checkedAt)), "FRESH_EMPTY_ALIGNMENT_PROOF_INVALID");
  }
  if (completed) insist(receipt.ledgerExecutionSha256 === ledgerExecutionHash(rows)
    && receipt.structure?.catalogSha256 && typeof receipt.completedAt === "string", "FRESH_COMPLETION_RECEIPT_INVALID");
  return receipt;
}

// Observe the existing executor's real started INSERT, then attach provenance
// before its SQL is sent. No succeeded rows are manufactured here. Every status
// transition and historical statement remains owned by applyMigrations.
function provenanceConnection(connection, bundle, receipt, state) {
  return {
    query: (...args) => connection.query(...args),
    async execute(sql, values) {
      const startsMigration = typeof sql === "string" && /INSERT INTO app_schema_migrations\s+\(migrationName,checksum,status,executionId,startedAt,finishedAt,error,metadata\)/.test(sql)
        && sql.includes("VALUES (?,?,'started',?,NOW(),NULL,NULL,JSON_OBJECT('order',?))");
      const emptyAlignment = startsMigration && values?.[0] === EMPTY_ALIGNMENT_MIGRATION
        ? await verifyEmptyAlignmentTables(connection) : null;
      const result = await connection.execute(sql, values);
      if (startsMigration) {
        const [name, checksum, executionId, order] = values;
        const item = bundle.plan[order];
        insist(item?.fileName === name && item.checksum === checksum && !state.started.has(name), "UNEXPECTED_FRESH_EXECUTION_RECORD");
        state.started.add(name);
        const proof = name === RECEIPT_MIGRATION ? { ...receipt, sequence: order }
          : { version: BOOTSTRAP_VERSION, runId: receipt.runId, schema: receipt.schema,
            planSha256: bundle.planSha256, sourcesSha256: bundle.sourcesSha256, sequence: order };
        if (emptyAlignment) proof.emptyAlignment = emptyAlignment;
        const [update] = await connection.execute("UPDATE app_schema_migrations SET metadata=? WHERE migrationName=? AND checksum=? AND executionId=? AND status='started'",
          [JSON.stringify({ order, freshBootstrap: proof }), name, checksum, executionId]);
        insist(update.affectedRows === 1, "FRESH_PROVENANCE_WRITE_FAILED");
        if (name === RECEIPT_MIGRATION) state.receiptExecutionId = executionId;
      }
      return result;
    },
  };
}

async function writeReceipt(connection, bundle, state, receipt) {
  insist(state.receiptExecutionId, "FRESH_RECEIPT_NOT_STARTED");
  const [result] = await connection.execute("UPDATE app_schema_migrations SET metadata=? WHERE migrationName=? AND checksum=? AND executionId=?",
    [JSON.stringify({ order: 0, freshBootstrap: { ...receipt, sequence: 0 } }), RECEIPT_MIGRATION, bundle.plan[0].checksum, state.receiptExecutionId]);
  insist(result.affectedRows === 1, "FRESH_RECEIPT_WRITE_FAILED");
}

export async function verifyInitialSeeds(connection, bundle) {
  // No external schedules/jobs/providers/callers or fabricated user-owned tags.
  for (const table of ["emperor_scheduled_tasks", "ops_lingxing_sync_schedules", "amazon_monitor_schedules", "amazon_monitor_runs",
    "acquisition_provider_profiles", "acquisition_jobs", "emperor_external_knowledge_callers", "kb_tag_definitions"]) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``);
    insist(Number(rows?.[0]?.rowCount) === 0, "UNEXPECTED_FRESH_EXTERNAL_OR_USER_SEED");
  }
  const expected = bundle.manifest.skillSeeds;
  insist(Array.isArray(expected) && expected.length === 4, "FRESH_SKILL_SEED_CONTRACT_MISSING");
  const [rows] = await connection.execute("SELECT slug,workspaceId,status,scope,version,isSystem,manifest FROM emperor_skills WHERE slug IN (?,?,?,?) ORDER BY slug", expected.map(seed => seed.slug));
  insist(rows.length === 4 && new Set(rows.map(row => row.slug)).size === 4, "FRESH_SKILL_SEED_COUNT_MISMATCH");
  for (const seed of expected) {
    const row = rows.find(row => row.slug === seed.slug), manifest = decodeMetadata(row?.manifest);
    insist(row?.workspaceId === null && row.status === "Released" && row.scope === "global"
      && Number(row.version) === seed.version && Number(row.isSystem) === 1
      && typeof manifest?.implementation?.systemPrompt === "string"
      && sha256(manifest.implementation.systemPrompt) === seed.systemPromptSha256, "FRESH_SKILL_SEED_POLICY_MISMATCH");
  }
  return { externalOrUserSeedRows: 0, verifiedLatestSkillSeeds: 4 };
}

export async function executeFreshBootstrap({ bundle, contract, options, environment }, dependencies) {
  validateStructureContract(contract, bundle);
  const target = validateTarget(options, environment, dependencies.io);
  const { runner, connect } = await dependencies.load();
  // The offline reader and real runner must still describe the same unchanged
  // 168-entry source plan when execution dependencies are loaded.
  const offline = loadFreshBootstrapPlan(bundle.root);
  insist(offline.planSha256 === bundle.planSha256 && offline.sourcesSha256 === bundle.sourcesSha256
    && fingerprint(bundle.plan.map(item => [item.fileName, sha256(item.sql)])) === bundle.planSha256,
  "FRESH_SOURCE_CHANGED_BEFORE_CONNECTION");
  const { selectFreshLineage } = await import("./integration/freshHistoricalLineage.mjs");
  selectFreshLineage(runner.loadMigrationPlan());
  const connection = await connect(target);
  let release, receipt, result, failure;
  const state = { started: new Set() };
  try {
    release = await runner.acquireMigrationLock(connection);
    const identity = await assertIdentity(connection, options.schema, contract);
    const objects = await readObjects(connection, options.schema);
    if (Object.values(objects).some(count => count !== 0)) {
      const rows = await readFullLedger(connection);
      const previous = validateExecutedLedger(rows, bundle, options.schema);
      insist(previous.structure.catalogSha256 === contract.catalogSha256, "FRESH_RECEIPT_CONTRACT_CHANGED");
      await checkPostconditions(runner, connection);
      const structure = assertCatalogMatches(await readFreshCatalog(connection, options.schema), contract, bundle);
      result = { mode: "verified-repeat", migrationsExecuted: 0, reseeded: false, structure };
    } else {
      receipt = { version: BOOTSTRAP_VERSION, runId: randomUUID(), schema: options.schema,
        planSha256: bundle.planSha256, sourcesSha256: bundle.sourcesSha256, stage: "executing",
        originalEmpty: { schema: options.schema, checkedAt: new Date().toISOString(), objects, identity } };
      await runner.ensureLedger(connection);
      await runner.applyMigrations(provenanceConnection(connection, bundle, receipt, state), bundle.plan, { retryFailed: false });
      insist(state.started.size === bundle.plan.length, "FRESH_EXECUTOR_DID_NOT_START_ALL_MIGRATIONS");
      const rows = await readFullLedger(connection);
      validateExecutedLedger(rows, bundle, options.schema, { completed: false });
      await checkPostconditions(runner, connection);
      const seeds = await verifyInitialSeeds(connection, bundle);
      const structure = assertCatalogMatches(await readFreshCatalog(connection, options.schema), contract, bundle);
      receipt = { ...receipt, stage: "completed", completedAt: new Date().toISOString(),
        ledgerExecutionSha256: ledgerExecutionHash(rows), structure, seeds };
      await writeReceipt(connection, bundle, state, receipt);
      validateExecutedLedger(await readFullLedger(connection), bundle, options.schema);
      result = { mode: "initialized-empty-schema", migrationsExecuted: bundle.plan.length, reseeded: false, structure, seeds };
    }
  } catch (error) {
    failure = error;
    if (receipt && state.receiptExecutionId) {
      try { await writeReceipt(connection, bundle, state, { ...receipt, stage: "failed", failedAt: new Date().toISOString(),
        failureCode: /^[A-Z][A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "MIGRATION_OR_VERIFICATION_FAILED" }); }
      catch { /* Existing started/failed rows still make every repeat fail closed. */ }
    }
  } finally {
    let cleanupError;
    if (release) try { await release(); } catch (error) { cleanupError = error; }
    try { await connection.end(); } catch (error) { cleanupError ??= error; }
    if (cleanupError && !failure) failure = Object.assign(new Error("FRESH_CONNECTION_CLEANUP_FAILED"), { code: "FRESH_CONNECTION_CLEANUP_FAILED" });
  }
  if (failure) throw failure;
  return result;
}

async function loadExecutionDependencies() {
  // Existing runner imports dotenv/config; prevent even its file read in this
  // explicitly targeted entry point. No database URL is assigned globally.
  const old = process.env.DOTENV_CONFIG_PATH;
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  try {
    const runner = await import("./run-database-migrations.mjs");
    return { runner, connect: (await import("mysql2/promise")).createConnection };
  } finally {
    if (old === undefined) delete process.env.DOTENV_CONFIG_PATH; else process.env.DOTENV_CONFIG_PATH = old;
  }
}

export async function main(args, { environment = process.env, load = loadExecutionDependencies, loadPlan = loadFreshBootstrapPlan } = {}) {
  const options = parseArguments(args), bundle = loadPlan();
  if (!options.execute) return { mode: "offline-plan", databaseConnected: false, migrations: bundle.plan.map(item => ({ name: item.fileName, checksum: item.checksum })),
    migrationCount: bundle.plan.length, planSha256: bundle.planSha256, sourcesSha256: bundle.sourcesSha256,
    expectedBusinessTables: 302, excluded: bundle.excluded, structureContractBound: Boolean(bundle.manifest.structureContract),
    completionRequires: "Pinned, independent public-source full catalog; not table count or production baseline." };
  const contract = loadStructureContract(bundle); // Fail before loading a client or connecting if approval is missing.
  return executeFreshBootstrap({ bundle, contract, options, environment }, { load });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(error => {
  // Do not echo SQL, URLs, driver diagnostics, environment variables or secrets.
  console.error(JSON.stringify({ ok: false, code: /^[A-Z][A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "FRESH_BOOTSTRAP_FAILED_INSPECT_LOCAL_LEDGER" }));
  process.exitCode = 1;
});
