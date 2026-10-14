// Entirely synthetic 312-table/174-observation fixtures; public plan reads only.
// No private artifacts, drivers, sockets, databases, VM or external requests.
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DDL_CATALOG } from "../integration/exportProductionDdl.mjs";
import { CANDIDATE_SQL, COLUMN_CONTRACTS, TABLE_NAME } from "../integration/campaignNullabilityContract.mjs";
import { fingerprint, loadOfflineGeneralPlan } from "./freshBootstrapPlan.mjs";
import { assessExistingLineage, ADOPTION_VERSION, ADOPTION_TABLES, ADOPTABLE_MIGRATION, GENERAL_PLAN_SHA256 } from "./existingLineageAdmission.mjs";
import { DELTA_DEFINITION, REHEARSAL_EVIDENCE } from "./existingDeltaPlan.mjs";
import { executeExistingDelta, createExecutionDeadline, canonicalControlInteger, EXECUTION_SCOPE, EXECUTION_VERSION,
  IDENTITY_SQL, LEDGER_SQL, LOCK_SQL, UNLOCK_SQL } from "./existingDeltaExecution.mjs";

const clone = value => structuredClone(value), code = expected => error => error.code === expected;
const publicPlan = loadOfflineGeneralPlan(), schema = "amazon_existing_0123456789abcdef_synthetic";
const secret = "synthetic-private-schema-comment-must-not-leak";
const row = (collection, values) => ({ ...Object.fromEntries(DDL_CATALOG[collection].fields.map(name => [name, null])), ...values });
const columnNames = ["workspaceId", "id", "user_id", "profile_id", "source_store_id", "country", "report_date", "ad_type", "campaign_id",
  "campaign_name", "campaign_status", "bidding_strategy", "budget", "currency", "impressions", "clicks", "spend", "sales", "orders",
  "source_batch_id", "source_row_hash", "source_payload_hash", "version", "created_at", "updated_at"];

function catalogFixture() {
  const names = [...ADOPTION_TABLES, "app_schema_migrations", ...Array.from({ length: 307 }, (_, index) => `synthetic_table_${String(index).padStart(3, "0")}`)].sort();
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(name => [name, []]));
  catalog.schema = [row("schema", { schemaName: schema, characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci", defaultEncryption: "NO" })];
  for (const tableName of names) {
    catalog.tables.push(row("tables", { tableName, tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic",
      autoIncrement: 10, collationName: "utf8mb4_0900_ai_ci", createOptions: "", tableComment: secret }));
    for (const [index, columnName] of (tableName === TABLE_NAME ? columnNames : ["id"]).entries()) {
      const metric = COLUMN_CONTRACTS.find(column => column.name === columnName), dataType = metric?.dataType ?? "int";
      catalog.columns.push(row("columns", { tableName, columnName, ordinalPosition: index + 1,
        columnDefault: metric?.defaultValue ?? null, isNullable: "NO", dataType, columnType: metric?.columnType ?? "int",
        numericPrecision: dataType === "bigint" ? "19" : dataType === "decimal" ? "14" : "10",
        numericScale: dataType === "decimal" ? "2" : "0", columnKey: columnName === "id" ? "PRI" : "",
        extra: columnName === "id" ? "auto_increment" : "", columnComment: "", generationExpression: "" }));
    }
    catalog.indexes.push(row("indexes", { tableName, indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", direction: "A",
      nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES" }));
    catalog.constraints.push(row("constraints", { tableName, constraintName: "PRIMARY", constraintType: "PRIMARY KEY", enforced: "YES" }));
    catalog.keyColumns.push(row("keyColumns", { tableName, constraintName: "PRIMARY", columnName: "id", ordinalPosition: 1 }));
  }
  return catalog;
}

function fixture() {
  const fullSourceCatalog = catalogFixture(), ledgerSnapshot = { present: true, rows: [...publicPlan
    .filter(item => item.fileName !== ADOPTABLE_MIGRATION.fileName)
    .map(item => ({ migrationName: item.fileName, checksum: item.checksum, status: "succeeded" })),
  ...Array.from({ length: 7 }, (_, index) => ({ migrationName: `synthetic_observation_${index}.sql`, checksum: fingerprint(index), status: "baselined" }))] };
  const needs = assessExistingLineage({ generalPlan: publicPlan, currentCatalog: fullSourceCatalog, ledgerSnapshot });
  const sourceContract = { catalog: Object.fromEntries(Object.entries(fullSourceCatalog).map(([name, rows]) => [name,
    rows.filter(item => !Object.hasOwn(item, "tableName") || ADOPTION_TABLES.includes(item.tableName))])), sha256: needs.currentCatalogSha256 };
  const adoption = { version: ADOPTION_VERSION, decision: "structural-adoption-for-delta-gate", approved: true,
    historicalExecutionProven: false, generalRunnerAdmitted: false, generalPlanSha256: GENERAL_PLAN_SHA256,
    migration: { ...ADOPTABLE_MIGRATION }, ledgerSnapshotSha256: needs.ledgerSnapshotSha256, structureContract: sourceContract,
    evidence: { artifactSha256: REHEARSAL_EVIDENCE.artifactSha256, exportReceiptSha256: REHEARSAL_EVIDENCE.exportReceiptSha256 } };
  const lineage = assessExistingLineage({ generalPlan: publicPlan, currentCatalog: fullSourceCatalog, ledgerSnapshot, adoption });
  const inputs = { generalPlan: publicPlan, fullSourceCatalog, ledgerSnapshot, sourceContract, adoption, lineage,
    definition: { ...DELTA_DEFINITION, lineageSha256: fingerprint(lineage), sourceContractSha256: sourceContract.sha256 }, evidence: { ...REHEARSAL_EVIDENCE } };
  const root = "/tmp/amazon-existing-mysql8.Fixture1";
  const instance = { platform: "linux", version: "8.0.46-0ubuntu0.24.04.4", root, socket: `${root}/mysql.sock`, datadir: `${root}/data/`,
    pidFile: `${root}/mysqld.pid`, pid: 12345, startTime: "123456", serverUuid: "01234567-89ab-cdef-0123-456789abcdef", nativeProofSha256: "a".repeat(64) };
  const authorization = { version: EXECUTION_VERSION, scope: EXECUTION_SCOPE, executeLocalIsolatedDelta: true,
    schema, instance, inputsSha256: fingerprint(inputs) };
  const state = { catalog: clone(fullSourceCatalog), ledger: clone(ledgerSnapshot.rows), journal: [], calls: [], events: [],
    identity: { schemaName: schema, connectionId: 5, version: instance.version, lowerCaseTableNames: 0, skipNetworking: 1, port: 0,
      socket: instance.socket, datadir: instance.datadir, pidFile: instance.pidFile, serverUuid: instance.serverUuid,
      eventScheduler: "OFF", mysqlX: "DISABLED" }, held: false, destroyed: false, alterCount: 0 };
  const connection = {
    transport: { socketPath: instance.socket, database: schema, multipleStatements: false, rowsAsArray: false, host: null, port: null },
    destroy() { state.destroyed = true; },
    async query(options, values) {
      assert.equal(typeof options, "object"); assert.ok(options.timeout > 0 && options.timeout <= 60_000);
      const { sql } = options; state.calls.push({ sql, values: clone(values) }); state.events.push(sql);
      if (state.onQuery) await state.onQuery(sql);
      if (sql === IDENTITY_SQL) return [[clone(state.identity)]];
      if (sql === LEDGER_SQL) return [clone(state.ledger)];
      if (sql === LOCK_SQL) { assert.equal(state.held, false); state.held = true; return [[{ acquired: state.lockResult ?? 1 }]]; }
      if (sql === UNLOCK_SQL) { state.held = false; return [[{ released: state.releaseResult ?? 1 }]]; }
      if (sql.startsWith("SET SESSION ")) return [{}];
      if (sql === CANDIDATE_SQL) {
        assert.equal(state.held, true); assert.equal(state.journal.length, 1); assert.equal(state.journal[0].status, "started");
        assert.equal(++state.alterCount, 1);
        for (const column of state.catalog.columns) if (column.tableName === TABLE_NAME && COLUMN_CONTRACTS.some(metric => metric.name === column.columnName)) {
          column.isNullable = "YES"; column.columnDefault = null;
        }
        if (state.afterAlter) await state.afterAlter(); return [{}];
      }
      const match = Object.entries(DDL_CATALOG).find(([, definition]) => definition.sql === sql);
      assert.ok(match, `Unexpected SQL: ${sql}`); assert.ok(values.every(value => value === schema));
      return [clone(state.catalog[match[0]])];
    },
  };
  const evidenceIO = {
    async loadBoundInputs() { return clone(inputs); },
    async verifyLocalInstance(value) { assert.deepEqual(value, instance); return clone(instance); },
    async readOperation() { return clone(state.journal); },
    async appendReceipt(key, entry, previous) {
      state.events.push(`receipt:${entry.status}`);
      assert.equal(previous, state.journal.length ? fingerprint(state.journal.at(-1)) : null);
      assert.equal(entry.operationKey, key); state.journal.push(clone(entry)); return { durable: true, sha256: fingerprint(entry) };
    },
  };
  return { inputs, authorization, connection, evidenceIO, state, run: () => executeExistingDelta({ authorization, connection, evidenceIO }) };
}

test("import is inert with hostile connection env; no private IO, runner, connector or executable entrypoint", () => {
  const url = new URL("./existingDeltaExecution.mjs", import.meta.url);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url.href)});console.log('INERT')`], {
    encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", DATABASE_URL: "mysql://never-connect" } });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, "INERT\n");
  const source = fs.readFileSync(url, "utf8");
  assert.doesNotMatch(source, /process\.|node:fs|node:child_process|["']mysql2(?:\/promise)?["']|dotenv|applyMigrations|run-database-migrations|START TRANSACTION|ROLLBACK/);
});

test("ledger projection uses real public runner camelCase columns, never guessed historical metadata", () => {
  const runner = fs.readFileSync(new URL("../run-database-migrations.mjs", import.meta.url), "utf8");
  assert.match(runner, /CREATE TABLE IF NOT EXISTS app_schema_migrations\s*\(\s*migrationName varchar\(255\) NOT NULL,/);
  assert.equal(LEDGER_SQL, "SELECT migrationName, checksum, status FROM app_schema_migrations ORDER BY BINARY migrationName LIMIT 175");
  assert.doesNotMatch(LEDGER_SQL, /migration_name|metadata|executionId|startedAt|finishedAt|SELECT \*/);
});

test("identity integer parsing matches fixed mysql2 number/string representations without general metadata normalization", async () => {
  for (const value of [0, "0", 1, "1", 12345, "12345", Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]) {
    assert.equal(canonicalControlInteger(value), Number(value));
  }
  for (const value of [null, undefined, true, false, "", " ", " 1", "1 ", "01", "00", "+1", "-0", "-1", -0, -1,
    "1e0", "0x1", "1.0", 1.5, NaN, Infinity, "9007199254740992", Number.MAX_SAFE_INTEGER + 1, 1n, {}, []]) {
    assert.throws(() => canonicalControlInteger(value), code("DELTA_IDENTITY_INTEGER_INVALID"));
  }
  const f = fixture();
  for (const key of ["connectionId", "lowerCaseTableNames", "skipNetworking", "port"]) f.state.identity[key] = String(f.state.identity[key]);
  f.state.lockResult = "1"; f.state.releaseResult = "1";
  assert.equal((await f.run()).status, "completed");
  const g = fixture(); g.state.catalog.columns.find(column => column.columnName === "impressions").numericPrecision = 19;
  await assert.rejects(g.run, code("DELTA_UNREVIEWED_STRUCTURAL_DRIFT")); assert.equal(g.state.alterCount, 0);
});

test("both lock results accept only canonical success 1 or string 1; malformed strings never report success", async () => {
  for (const value of ["01", "1e0", " 1", "0x1", "9007199254740992", true, -0]) {
    const f = fixture(); f.state.lockResult = value;
    await assert.rejects(f.run, code("DELTA_IDENTITY_INTEGER_INVALID")); assert.equal(f.state.alterCount, 0); assert.equal(f.state.destroyed, true);
    const g = fixture(); g.state.releaseResult = value;
    await assert.rejects(g.run, code("DELTA_IDENTITY_INTEGER_INVALID")); assert.equal(g.state.journal.at(-1).status, "unknown");
    assert.equal(g.state.destroyed, true); assert.equal(g.state.journal.at(-1).observation.lockReleased, false);
  }
  const zero = fixture(); zero.state.lockResult = "0";
  await assert.rejects(zero.run, code("DELTA_LOCK_NOT_ACQUIRED")); assert.equal(zero.state.alterCount, 0);
});

test("wrong live identity is rejected before session SET or lock acquisition", async () => {
  const f = fixture(); f.state.identity.schemaName = "amz_listing";
  await assert.rejects(f.run, code("DELTA_LIVE_ISOLATION_MISMATCH"));
  assert.deepEqual(f.state.calls.map(call => call.sql), [IDENTITY_SQL]);
});

test("explicit local authority, schema, transport and native birth bindings fail closed before any SQL", async () => {
  for (const mutate of [f => f.authorization.executeLocalIsolatedDelta = false, f => f.authorization.scope = "production",
    f => f.authorization.schema = "amz_listing", f => f.authorization.schema = "amazon_fresh_0123456789abcdef_synthetic",
    f => f.authorization.instance.platform = "darwin", f => f.authorization.instance.version = "8.0.47",
    f => f.authorization.instance.socket = "/tmp/old/mysql.sock", f => f.authorization.instance.startTime = "0",
    f => f.authorization.extra = true, f => f.connection.transport.host = "localhost", f => f.connection.transport.multipleStatements = true,
    f => f.authorization.inputsSha256 = "f".repeat(64)]) {
    const f = fixture(); mutate(f); await assert.rejects(f.run); assert.equal(f.state.calls.length, 0);
  }
  const f = fixture(); f.evidenceIO.verifyLocalInstance = async () => ({ ...f.authorization.instance, pid: 99 });
  await assert.rejects(f.run, code("DELTA_NATIVE_INSTANCE_CHANGED")); assert.equal(f.state.calls.length, 0);
});

test("exact OLD sends one fixed ALTER only after durable started, then proves full312/full4/ledger, unlocks before completed", async () => {
  const f = fixture(), original = clone(f.inputs), result = await f.run();
  assert.equal(result.status, "completed"); assert.equal(result.ddlDispatches, 1); assert.equal(result.ledgerWrites, 0);
  assert.equal(result.changedFields, 10); assert.equal(result.comparedTables, 312); assert.equal(result.comparedCatalogCollections, 13);
  assert.deepEqual(result.comparedAdoptionTables, ADOPTION_TABLES); assert.equal(result.lockReleased, true);
  assert.equal(result.fullHistoricalLedgerFieldsVerified, false); assert.equal(result.historicalExecutionProven, false);
  assert.equal(result.generalRunnerAdmitted, false); assert.equal(result.productionApproved, false); assert.equal(result.implicitCommitRollbackClaimed, false);
  assert.deepEqual(f.inputs, original); assert.deepEqual(f.state.ledger, original.ledgerSnapshot.rows);
  assert.equal(f.state.calls.filter(call => call.sql === CANDIDATE_SQL).length, 1);
  assert.ok(f.state.events.indexOf("receipt:started") < f.state.events.indexOf(CANDIDATE_SQL));
  assert.ok(f.state.events.indexOf(UNLOCK_SQL) < f.state.events.indexOf("receipt:completed"));
  assert.deepEqual(f.state.journal.map(entry => entry.status), ["started", "completed"]);
  assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(f.state.journal).includes(secret));
});

test("same completed target repeats only exact NEW with zero SQL writes and no receipt rewrite", async () => {
  const f = fixture(); await f.run(); const journal = clone(f.state.journal), offset = f.state.calls.length;
  const result = await f.run(); assert.equal(result.status, "noop-verified"); assert.equal(result.ddlDispatches, 0); assert.equal(result.changedFields, 0);
  assert.equal(f.state.calls.slice(offset).filter(call => /^(?:ALTER|INSERT|UPDATE|DELETE|CREATE|DROP|REPLACE|GRANT)/.test(call.sql)).length, 0);
  assert.deepEqual(f.state.journal, journal); assert.equal(f.state.alterCount, 1);
});

test("refreshed native proof cannot switch lock/journal namespace for the same physical server and schema", async () => {
  const f = fixture(); await f.run(); const firstKey = f.state.calls.find(call => call.sql === LOCK_SQL).values[0];
  f.authorization.instance.nativeProofSha256 = "b".repeat(64);
  await assert.rejects(f.run, code("DELTA_OPERATION_BINDING_CHANGED"));
  assert.equal(f.state.calls.filter(call => call.sql === LOCK_SQL).at(-1).values[0], firstKey);
  assert.equal(f.state.alterCount, 1);
});

test("input adoption/lineage/definition/evidence, full312 catalog and exact174 three-field observations cannot be substituted", async () => {
  for (const mutate of [f => f.inputs.adoption.approved = false, f => f.inputs.lineage.historicalExecutionProven = true,
    f => f.inputs.definition.sqlSha256 = "f".repeat(64), f => f.inputs.evidence.status = "failed",
    f => f.inputs.ledgerSnapshot.rows.pop(), f => f.inputs.ledgerSnapshot.rows[0].metadata = "invented",
    f => f.inputs.fullSourceCatalog.tables.pop(), f => f.inputs.fullSourceCatalog.events.push({ eventName: "evil" })]) {
    const f = fixture(); mutate(f); f.authorization.inputsSha256 = fingerprint(f.inputs);
    await assert.rejects(f.run); assert.equal(f.state.alterCount, 0); assert.equal(f.state.calls.length, 0);
  }
});

test("live platform/isolation mismatch and preexisting ledger/catalog drift reject before ALTER", async () => {
  for (const mutate of [f => f.state.identity.version = "8.0.47", f => f.state.identity.lowerCaseTableNames = 1,
    f => f.state.identity.skipNetworking = 0, f => f.state.identity.port = 3306, f => f.state.identity.eventScheduler = "ON",
    f => f.state.identity.mysqlX = "ACTIVE", f => f.state.identity.serverUuid = "wrong", f => f.state.identity.schemaName = "amz_listing",
    f => f.state.ledger[0].status = "failed", f => f.state.ledger[0].checksum = "f".repeat(64),
    f => f.state.catalog.tables.at(-1).tableComment = "drift", f => f.state.catalog.columns.find(c => c.columnName === "impressions").isNullable = "YES"]) {
    const f = fixture(); mutate(f); await assert.rejects(f.run); assert.equal(f.state.alterCount, 0); assert.equal(f.state.journal.length, 0);
  }
});

test("lock denial and changes during lock window never write ALTER; acquired lock is released", async () => {
  const denied = fixture(); denied.state.lockResult = 0; await assert.rejects(denied.run, code("DELTA_LOCK_NOT_ACQUIRED")); assert.equal(denied.state.alterCount, 0);
  for (const change of [f => f.state.catalog.tables.at(-1).tableComment = "raced",
    f => f.state.ledger[0].checksum = "f".repeat(64), f => f.state.identity.connectionId++]) {
    const f = fixture(); f.state.onQuery = sql => { if (sql === LOCK_SQL) change(f); };
    await assert.rejects(f.run); assert.equal(f.state.alterCount, 0); assert.equal(f.state.held, false);
  }
});

test("receipt persistence must confirm durable exact hash before ALTER; missing/new/failed/unknown journal cannot admit blind rerun", async () => {
  const notDurable = fixture(); notDurable.evidenceIO.appendReceipt = async () => ({ durable: false, sha256: "0".repeat(64) });
  await assert.rejects(notDurable.run, code("DELTA_DURABLE_RECEIPT_NOT_CONFIRMED")); assert.equal(notDurable.state.alterCount, 0);
  for (const status of ["started-only", "failed", "unknown", "forged-completed", "wrong-binding"]) {
    const f = fixture(); await f.run();
    if (status === "started-only") f.state.journal.pop();
    else if (status === "forged-completed") f.state.journal[1].observation.afterVerified = false;
    else if (status === "wrong-binding") f.state.journal[0].binding.inputsSha256 = "f".repeat(64);
    else f.state.journal[1].status = status;
    const count = f.state.calls.length; await assert.rejects(f.run);
    assert.equal(f.state.calls.slice(count).filter(call => call.sql === CANDIDATE_SQL).length, 0);
  }
  const unknown = fixture(); await unknown.run(); unknown.state.journal = [];
  await assert.rejects(unknown.run, code("DELTA_NEW_STATE_WITHOUT_COMPLETED_RECEIPT")); assert.equal(unknown.state.alterCount, 1);
});

test("implicit-commit ALTER error is unknown, preserved, never rolled back or retried", async () => {
  const f = fixture(); f.state.afterAlter = () => { throw Object.assign(new Error("synthetic timeout"), { code: "ER_QUERY_TIMEOUT" }); };
  await assert.rejects(f.run, error => { assert.equal(error.receipt.status, "unknown-requires-review"); assert.equal(error.receipt.ddlDispatches, 1);
    assert.equal(error.receipt.implicitCommitRollbackClaimed, false); assert.equal(error.receipt.rerunAllowed, false); return true; });
  assert.deepEqual(f.state.journal.map(entry => entry.status), ["started", "unknown"]); assert.equal(f.state.held, false);
  f.state.afterAlter = null; await assert.rejects(f.run, code("DELTA_PRIOR_OUTCOME_REQUIRES_REVIEW")); assert.equal(f.state.alterCount, 1);
});

test("any post ALTER non-target metadata/counter/ledger change prevents completed claim and retains unknown receipt", async () => {
  for (const mutate of [f => f.state.catalog.tables.at(-1).tableComment = "unapproved", f => f.state.catalog.tables.at(-1).autoIncrement++,
    f => f.state.catalog.columns.find(c => c.tableName === TABLE_NAME && c.columnName === "id").extra = "",
    f => f.state.catalog.indexes.at(-1).indexComment = "changed", f => f.state.ledger[0].checksum = "e".repeat(64),
    f => f.state.catalog.columns.find(c => c.columnName === "orders").columnDefault = "0"]) {
    const f = fixture(); f.state.afterAlter = () => mutate(f);
    await assert.rejects(f.run); assert.equal(f.state.journal.at(-1).status, "unknown"); assert.equal(f.state.alterCount, 1);
  }
});

test("release or completed receipt persistence failure cannot report success", async () => {
  const f = fixture(); f.state.releaseResult = 0; await assert.rejects(f.run, code("DELTA_LOCK_RELEASE_FAILED"));
  assert.equal(f.state.journal.at(-1).status, "unknown");
  assert.equal(f.state.calls.filter(call => call.sql === UNLOCK_SQL).length, 1);
  assert.equal(f.state.destroyed, true); assert.equal(f.state.journal.at(-1).observation.lockReleased, false);
  const g = fixture(), append = g.evidenceIO.appendReceipt;
  g.evidenceIO.appendReceipt = async (...args) => { if (args[1].status === "completed") throw new Error("store offline"); return append(...args); };
  await assert.rejects(g.run); assert.equal(g.state.journal.at(-1).status, "unknown"); assert.equal(g.state.held, false);
});

test("private input or native-proof drift after durable intent stops before the fixed ALTER", async () => {
  for (const native of [false, true]) {
    const f = fixture(), append = f.evidenceIO.appendReceipt;
    f.evidenceIO.appendReceipt = async (...args) => {
      const result = await append(...args);
      if (args[1].status === "started") {
        if (native) f.evidenceIO.verifyLocalInstance = async () => ({ ...f.authorization.instance, pid: 999 });
        else f.evidenceIO.loadBoundInputs = async () => ({ ...clone(f.inputs), injected: true });
      }
      return result;
    };
    await assert.rejects(f.run, code(native ? "DELTA_NATIVE_INSTANCE_CHANGED" : "DELTA_PRIVATE_INPUT_DRIFT"));
    assert.equal(f.state.alterCount, 0); assert.equal(f.state.journal.at(-1).status, "failed"); assert.equal(f.state.held, false);
  }
});

test("lazy deadline rejects work before dispatch after expiry and bounds pending work even if abort throws", async () => {
  const gate = createExecutionDeadline(1); await new Promise(resolve => setTimeout(resolve, 5)); let called = false;
  await assert.rejects(() => gate(() => { called = true; }, 5), code("DELTA_DEADLINE_EXCEEDED")); assert.equal(called, false);
  const pending = createExecutionDeadline(10); let aborted = false;
  await assert.rejects(() => pending(() => new Promise(() => {}), 5, () => { aborted = true; throw new Error("abort"); }), code("DELTA_DEADLINE_EXCEEDED"));
  assert.equal(aborted, true);
});
