// Real migration executor + in-memory connection only. These tests prove control
// flow/ledger behavior, NOT that historical SQL runs or the application schema is complete.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DDL_CATALOG } from "./integration/exportProductionDdl.mjs";
import { CHOSEN, CHOSEN_SHA256 } from "./integration/freshHistoricalLineage.mjs";
import { catalogFixture, contractFixture } from "./database/freshBootstrapFixtures.test-helper.mjs";
import { RECEIPT_MIGRATION, loadFreshBootstrapPlan } from "./database/freshBootstrapPlan.mjs";
import { EMPTY_ALIGNMENT_MIGRATION, EMPTY_ALIGNMENT_TABLES, executeFreshBootstrap, main, parseArguments,
  validateExecutedLedger, validateTarget, verifyEmptyAlignmentTables } from "./bootstrap-fresh-database.mjs";

const bundle = loadFreshBootstrapPlan(), options = { execute: true, schema: "amazon_listing_ci", environment: "ci" };
const environment = { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://unit_user:unit_password@127.0.0.1:3306/amazon_listing_ci" };
const code = expected => error => error.code === expected;
const oldDotenv = process.env.DOTENV_CONFIG_PATH;
process.env.DOTENV_CONFIG_PATH = "/dev/null";
const actualRunner = await import("./run-database-migrations.mjs");
if (oldDotenv === undefined) delete process.env.DOTENV_CONFIG_PATH; else process.env.DOTENV_CONFIG_PATH = oldDotenv;

function fakeDatabase(settings = {}) {
  const state = { rows: new Map(), tables: [], queries: [], executedSql: [], started: [], loadCalls: 0, connections: 0,
    lock: false, released: 0, ended: 0, writes: 0, catalog: catalogFixture(), ...settings };
  const stamp = "2026-10-14 12:00:00";
  const query = async (sql, values = []) => {
    state.queries.push(typeof sql === "string" ? sql : sql.sql);
    if (sql.startsWith("SELECT DATABASE()")) return [[{ schemaName: state.identitySchema ?? options.schema,
      version: state.version ?? "8.0.46", lowerCaseTableNames: state.caseMode ?? 0, sqlMode: "STRICT_TRANS_TABLES" }]];
    if (sql.includes("AS characterSetName") && sql.includes("information_schema.SCHEMATA") && !sql.includes("defaultEncryption"))
      return [[{ characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci" }]];
    if (sql.startsWith("SELECT COUNT(*) AS objectCount")) {
      const collection = /information_schema\.([A-Z]+)/.exec(sql)[1];
      return [[{ objectCount: collection === "TABLES" ? state.tables.length : state.objects?.[collection] ?? 0 }]];
    }
    if (sql.includes("GET_LOCK")) { state.lock = !state.lockDenied; return [[{ acquired: state.lock ? 1 : 0 }]]; }
    if (sql.includes("RELEASE_LOCK")) { state.lock = false; state.released++; return [[{ released: 1 }]]; }
    if (sql.includes("CREATE TABLE IF NOT EXISTS app_schema_migrations")) {
      assert.ok(state.lock); state.writes++; state.tables.push("app_schema_migrations"); return [{ affectedRows: 0 }];
    }
    if (sql.startsWith("SELECT migrationName,")) {
      assert.ok(state.tables.includes("app_schema_migrations"), "Existing schema without our ledger must not be initialized");
      return [structuredClone([...state.rows.values()])];
    }
    if (/INSERT INTO app_schema_migrations/.test(sql)) {
      assert.ok(state.lock); state.writes++;
      const [name, checksum, executionId, order] = values;
      assert.ok(!state.rows.has(name), "First-run must not reuse any preexisting row");
      state.rows.set(name, { migrationName: name, checksum, executionId, status: "started", startedAt: stamp,
        finishedAt: null, error: null, metadata: JSON.stringify({ order }) });
      state.started.push(name); state.current = name; return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE app_schema_migrations SET metadata=")) {
      state.writes++;
      const [metadata, name, checksum, executionId] = values, row = state.rows.get(name);
      if (state.provenanceFailure || !row || row.checksum !== checksum || row.executionId !== executionId
        || sql.includes("status='started'") && row.status !== "started") return [{ affectedRows: 0 }];
      row.metadata = metadata; return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE app_schema_migrations SET status='succeeded'")) {
      state.writes++; const [name, executionId] = values, row = state.rows.get(name);
      assert.equal(row.executionId, executionId); assert.ok(state.executedSql.includes(name));
      row.status = "succeeded"; row.finishedAt = stamp;
      if (name === bundle.plan.at(-1).fileName) state.tables = state.catalog.tables.map(table => table.tableName);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE app_schema_migrations SET status='failed'")) {
      state.writes++; const [error, name] = values, row = state.rows.get(name);
      row.status = "failed"; row.finishedAt = stamp; row.error = error; return [{ affectedRows: 1 }];
    }
    // The runner's reviewed SQL normalizer queries optional historical columns.
    if (sql.includes("FROM information_schema.columns") && sql.includes("columnCount")) return [[{ columnCount: 0 }]];
    if (sql.includes("FROM information_schema.columns") && sql.includes("IN ('userId','user_id')")) return [[{ columnName: "userId" }]];
    if (sql.startsWith("SELECT column_name AS columnName,column_type")) return [[
      { columnName: "user_id", ordinalPosition: 6 },
      ...[["source_kind", "varchar(48)", "NO", "uploaded_parent_asin_weekly"], ["source_batch_id", "int", "YES", null],
        ["source_trace_id", "varchar(128)", "YES", null], ["source_schema_version", "varchar(32)", "YES", null]]
        .map(([columnName, columnType, isNullable, columnDefault], index) => ({ columnName, columnType, isNullable, columnDefault, ordinalPosition: index + 7 })),
    ]];
    if (sql.startsWith("SELECT index_name AS indexName,column_name")) return [[
      ["lingxing_product_weekly_source_batch_idx", ["workspaceId", "source_batch_id"]],
      ["lingxing_product_weekly_source_period_idx", ["workspaceId", "source_kind", "week_start_date", "week_end_date"]],
    ].flatMap(([indexName, columns]) => columns.map((columnName, index) => ({ indexName, columnName, seqInIndex: index + 1,
      nonUnique: 1, subPart: null, indexType: "BTREE", isVisible: "YES", collation: "A" })))];
    if (sql.startsWith("SELECT COUNT(*) AS rowCount FROM")) {
      const table = /`([^`]+)`/.exec(sql)?.[1];
      return [[{ rowCount: EMPTY_ALIGNMENT_TABLES.includes(table)
        ? Number(state.nonemptyAlignmentTable === table) : state.unexpectedSeed ? 1 : 0 }]];
    }
    if (sql.startsWith("SELECT slug,workspaceId,status,scope,version,isSystem,manifest")) {
      const prompts = filename => [...readFileSync(new URL(`../drizzle/${filename}`, import.meta.url), "utf8").matchAll(/'systemPrompt',\s*'([^']*)'/g)].map(match => match[1]);
      const summary = readFileSync(new URL("../drizzle/0202_competitor_gallery_analysis_scope.sql", import.meta.url), "utf8").match(/'\$\.implementation\.systemPrompt',\s*'([^']*)'/)[1];
      const values = [prompts("0199_image_competitor_gallery_analysis.sql")[0], summary, ...prompts("0200_image_expression_asset_linkage.sql")];
      return [bundle.manifest.skillSeeds.map((seed, index) => ({ ...seed, workspaceId: null, status: "Released", scope: "global", isSystem: 1,
        version: state.staleSeed ? 0 : seed.version, manifest: { implementation: { systemPrompt: values[index] } } }))];
    }
    if (sql.startsWith("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES")) return [state.tables.map(tableName => ({ tableName }))];
    if (sql.startsWith("SHOW CREATE TABLE")) {
      const tableName = /`([^`]+)`$/.exec(sql)[1];
      return [[{ Table: tableName, "Create Table": `CREATE TABLE \`${tableName}\` (\n  \`id\` int NOT NULL\n) ENGINE=InnoDB` }]];
    }
    if (sql === "SET SESSION information_schema_stats_expiry=0") return [{ affectedRows: 0 }];
    for (const [name, definition] of Object.entries(DDL_CATALOG)) if (sql === definition.sql) return [structuredClone(state.catalog[name])];
    assert.ok(state.current, "Unexpected query outside migration execution");
    const row = state.rows.get(state.current), metadata = JSON.parse(row.metadata);
    assert.equal(row.status, "started"); assert.equal(metadata.freshBootstrap.schema, options.schema, "Provenance must precede SQL");
    if (state.failAt === state.current) throw new Error("synthetic SQL failure without sensitive data");
    state.executedSql.push(state.current); return [{ affectedRows: 0 }];
  };
  const connection = { query, execute: query, async end() { state.ended++; } };
  const runner = { ...actualRunner, async applyMigrations(...args) {
    assert.deepEqual(args[2], { retryFailed: false });
    const old = console.log; console.log = () => {};
    try { return await actualRunner.applyMigrations(...args); } finally { console.log = old; }
  } };
  const dependencies = { async load() { state.loadCalls++; return { runner, async connect(target) {
    assert.equal(target.database, options.schema); assert.equal(target.host, "127.0.0.1");
    state.connections++; return connection;
  } }; } };
  return { state, dependencies, connection };
}
const run = mock => executeFreshBootstrap({ bundle, contract: contractFixture(), options, environment }, mock.dependencies);

test("CLI is strict, default plan is offline, and missing full contract prevents dependency/client loading", async () => {
  assert.equal(parseArguments([]).execute, false);
  for (const args of [["--retry-failed"], ["--baseline"], ["--execute", "--plan"], ["--schema", "amazon_listing_ci"], ["--execute", "--schema"]])
    assert.throws(() => parseArguments(args));
  let loaded = 0;
  const deps = { environment, loadPlan: () => ({ ...bundle, manifest: { ...bundle.manifest, structureContract: null } }),
    load: async () => { loaded++; throw new Error("must not load"); } };
  assert.equal((await main([], deps)).databaseConnected, false);
  await assert.rejects(main(["--execute", "--environment", "ci", "--schema", "amazon_listing_ci"], deps), code("FULL_STRUCTURE_CONTRACT_NOT_APPROVED"));
  assert.equal(loaded, 0);
});

test("target validation rejects production, remote or implicit targets and retry/preload inputs", () => {
  const accepted = validateTarget(options, environment); assert.equal(accepted.host, "127.0.0.1");
  for (const changed of [{ NODE_ENV: "production" }, { NODE_OPTIONS: "--require unwanted" }, { DOTENV_CONFIG_PATH: "some.env" },
    { ALLOW_PRODUCTION_MIGRATIONS: "true" }, { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://user@remote.example/amazon_listing_ci" },
    { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://user@localhost/amazon_listing_ci" },
    { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://user@127.0.0.1/amazon_listing_ci?multipleStatements=true" },
    { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://user@127.0.0.1/production" }])
    assert.throws(() => validateTarget(options, { ...environment, ...changed }));
  assert.throws(() => validateTarget(options, { DATABASE_URL: environment.FRESH_BOOTSTRAP_DATABASE_URL }), code("EXPLICIT_FRESH_DATABASE_URL_REQUIRED"));
  assert.throws(() => validateTarget({ ...options, schema: "production" }, environment), code("FRESH_SCHEMA_NAME_NOT_ALLOWED"));
  assert.throws(() => validateTarget({ ...options, environment: "production" }, environment));
  const socket = validateTarget({ ...options, socket: "/private/tmp/unit.sock" }, {
    FRESH_BOOTSTRAP_DATABASE_URL: "mysql://unit_user@localhost/amazon_listing_ci",
  }, { realpathSync: path => path, lstatSync: () => ({ isSocket: () => true }) });
  assert.equal(socket.socketPath, "/private/tmp/unit.sock");
});

test("complete mock contract executes the full plan via real runner with prior empty proof and actual succeeded records", async () => {
  const mock = fakeDatabase(), result = await run(mock);
  assert.equal(result.mode, "initialized-empty-schema"); assert.equal(result.migrationsExecuted, bundle.plan.length);
  assert.deepEqual(mock.state.executedSql, bundle.plan.map(item => item.fileName));
  assert.equal(mock.state.started.length, bundle.plan.length); assert.equal(mock.state.rows.size, bundle.plan.length);
  assert.equal(mock.state.rows.get(CHOSEN).checksum, CHOSEN_SHA256);
  const receipt = validateExecutedLedger([...mock.state.rows.values()], bundle, options.schema);
  assert.equal(receipt.stage, "completed"); assert.equal(receipt.originalEmpty.objects.tables, 0);
  assert.equal(receipt.seeds.verifiedLatestSkillSeeds, 4);
  assert.equal(mock.state.released, 1); assert.equal(mock.state.ended, 1);
  assert.ok(mock.state.queries.findIndex(sql => sql.includes("GET_LOCK")) < mock.state.queries.findIndex(sql => sql.includes("objectCount")));
});

test("complete same-lineage repeat verifies entire catalog but does no migration write or reseed", async () => {
  const mock = fakeDatabase(); await run(mock);
  const before = JSON.stringify([...mock.state.rows.values()]), writes = mock.state.writes, count = mock.state.executedSql.length;
  mock.state.unexpectedSeed = true; // Repeat must not inspect/reset user-owned rows or reapply initial seeds.
  const result = await run(mock);
  assert.equal(result.mode, "verified-repeat"); assert.equal(result.migrationsExecuted, 0); assert.equal(result.reseeded, false);
  assert.equal(mock.state.writes, writes); assert.equal(mock.state.executedSql.length, count);
  assert.equal(JSON.stringify([...mock.state.rows.values()]), before);
});

test("one historical SQL failure keeps failed real record, marks receipt failed and cannot auto-resume", async () => {
  const mock = fakeDatabase({ failAt: bundle.plan[6].fileName });
  await assert.rejects(run(mock), /Migration failed/);
  assert.equal(mock.state.rows.get(mock.state.failAt).status, "failed");
  assert.equal(mock.state.rows.size, 7); assert.equal(mock.state.executedSql.length, 6);
  assert.equal(JSON.parse(mock.state.rows.get(RECEIPT_MIGRATION).metadata).freshBootstrap.stage, "failed");
  const count = mock.state.started.length; delete mock.state.failAt;
  await assert.rejects(run(mock), code("FRESH_LEDGER_NOT_EXACT_COMPLETE"));
  assert.equal(mock.state.started.length, count); assert.equal(mock.state.released, 2); assert.equal(mock.state.ended, 2);
});

test("existing schema without fresh proof is read-only rejected, including empty ledger and non-table executable objects", async () => {
  for (const settings of [{ tables: ["legacy_business_table"] }, { tables: ["app_schema_migrations"] }, { objects: { EVENTS: 1 } }]) {
    const mock = fakeDatabase(settings);
    await assert.rejects(run(mock));
    assert.equal(mock.state.writes, 0); assert.equal(mock.state.executedSql.length, 0);
    assert.equal(mock.state.released, 1); assert.equal(mock.state.ended, 1);
  }
});

test("repeat refuses missing/extra/alternative/baseline/legacy/changed ownership or completion proof without writes", async () => {
  const original = fakeDatabase(); await run(original);
  const goodRows = structuredClone(original.state.rows);
  for (const mutate of [rows => rows.delete(CHOSEN), rows => rows.set("extra.sql", { ...rows.get(CHOSEN), migrationName: "extra.sql" }),
    rows => rows.get(CHOSEN).status = "baselined", rows => rows.get(CHOSEN).status = "failed",
    rows => rows.get(CHOSEN).executionId = "legacy-drizzle-import", rows => rows.get(CHOSEN).checksum = "0".repeat(64),
    rows => rows.get(CHOSEN).metadata = "{}", rows => rows.get(CHOSEN).finishedAt = null,
    rows => { const receipt = JSON.parse(rows.get(RECEIPT_MIGRATION).metadata); receipt.freshBootstrap.stage = "executing"; rows.get(RECEIPT_MIGRATION).metadata = JSON.stringify(receipt); },
    rows => { const receipt = JSON.parse(rows.get(RECEIPT_MIGRATION).metadata); receipt.freshBootstrap.originalEmpty.objects.tables = 1; rows.get(RECEIPT_MIGRATION).metadata = JSON.stringify(receipt); },
    rows => { const receipt = JSON.parse(rows.get(RECEIPT_MIGRATION).metadata); receipt.freshBootstrap.ledgerExecutionSha256 = "0".repeat(64); rows.get(RECEIPT_MIGRATION).metadata = JSON.stringify(receipt); },
    rows => { rows.delete(CHOSEN); rows.set("0191_parent_asin_weekly_mcp_source_forward_repair.sql", { ...goodRows.get(CHOSEN), migrationName: "0191_parent_asin_weekly_mcp_source_forward_repair.sql" }); }]) {
    const mock = fakeDatabase({ rows: structuredClone(goodRows), tables: [...original.state.tables] }); mutate(mock.state.rows);
    await assert.rejects(run(mock)); assert.equal(mock.state.writes, 0); assert.equal(mock.state.started.length, 0);
  }
});

test("failed provenance write never runs the associated SQL; interrupted started row remains non-resumable", async () => {
  const mock = fakeDatabase({ provenanceFailure: true });
  await assert.rejects(run(mock), code("FRESH_PROVENANCE_WRITE_FAILED"));
  assert.equal(mock.state.executedSql.length, 0); assert.equal(mock.state.rows.get(RECEIPT_MIGRATION).status, "started");
  await assert.rejects(run(mock)); assert.equal(mock.state.executedSql.length, 0);
});

test("identity/lock failures precede ledger or SQL writes and always close connections", async () => {
  for (const settings of [{ lockDenied: true }, { identitySchema: "production" }, { version: "8.4.6" }, { caseMode: 2 }]) {
    const mock = fakeDatabase(settings); await assert.rejects(run(mock));
    assert.equal(mock.state.writes, 0); assert.equal(mock.state.started.length, 0); assert.equal(mock.state.ended, 1);
  }
});

test("unexpected live seed, stale latest Skill, or same-table-count schema drift cannot produce completed receipt", async () => {
  for (const settings of [{ unexpectedSeed: true }, { staleSeed: true }, {}]) {
    const mock = fakeDatabase(settings);
    if (Object.keys(settings).length === 0) mock.state.catalog.indexes[0].nonUnique = 1;
    await assert.rejects(run(mock));
    assert.equal(mock.state.rows.size, bundle.plan.length); assert.ok([...mock.state.rows.values()].every(row => row.status === "succeeded"));
    assert.equal(JSON.parse(mock.state.rows.get(RECEIPT_MIGRATION).metadata).freshBootstrap.stage, "failed");
    const count = mock.state.started.length; await assert.rejects(run(mock)); assert.equal(mock.state.started.length, count);
  }
});

test("empty-table replacement refuses any row before its ledger start or destructive SQL", async () => {
  const calls = [];
  const malformed = { query: async sql => { calls.push(sql); return [[{ rowCount: null }]]; } };
  await assert.rejects(verifyEmptyAlignmentTables(malformed), code("FRESH_ALIGNMENT_TABLE_NOT_EMPTY"));
  assert.equal(calls.length, 1);
  if (!bundle.plan.some(item => item.fileName === EMPTY_ALIGNMENT_MIGRATION)) return;
  for (const table of [EMPTY_ALIGNMENT_TABLES[0], EMPTY_ALIGNMENT_TABLES.at(-1)]) {
    const mock = fakeDatabase({ nonemptyAlignmentTable: table });
    await assert.rejects(run(mock), code("FRESH_ALIGNMENT_TABLE_NOT_EMPTY"));
    assert.equal(mock.state.rows.has(EMPTY_ALIGNMENT_MIGRATION), false);
    assert.equal(mock.state.executedSql.includes(EMPTY_ALIGNMENT_MIGRATION), false);
    assert.equal(JSON.parse(mock.state.rows.get(RECEIPT_MIGRATION).metadata).freshBootstrap.stage, "failed");
    const before = mock.state.executedSql.length;
    await assert.rejects(run(mock), code("FRESH_LEDGER_NOT_EXACT_COMPLETE"));
    assert.equal(mock.state.executedSql.length, before);
  }
});
