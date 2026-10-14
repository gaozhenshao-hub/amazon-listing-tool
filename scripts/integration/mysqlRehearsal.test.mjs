import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  parseArguments, validateEnvironment, validatePaths, validateOutput, validateServerIdentity,
  connectionOptions, schemaNames, validateGeneralPlan, sqlOperationText, safeError, runRehearsal, main, GENERAL_PLAN_SHA256,
} from "./mysqlRehearsal.mjs";

const root = "/private/tmp/amazon-mysql8-rehearsal.unit-test";
const paths = { root, socket: `${root}/mysql.sock`, datadir: `${root}/data` };
const repo = fileURLToPath(new URL("../../", import.meta.url));
const args = ["--execute-local", "--root", root, "--socket", paths.socket, "--datadir", paths.datadir];
const code = expected => error => error.code === expected;

function fakeFs(overrides = {}) {
  return {
    realpathSync: value => path.normalize(value).replace(/\/$/, ""),
    lstatSync: value => ({
      isDirectory: () => value === root || value === paths.datadir,
      isSocket: () => value === paths.socket,
      isSymbolicLink: () => false,
    }),
    existsSync: () => false,
    ...overrides,
  };
}

function serverRow(overrides = {}) {
  return { version: "8.4.8", skipNetworking: 1, socket: paths.socket, datadir: `${paths.datadir}/`, ...overrides };
}

function planFixture() {
  return Array.from({ length: 168 }, (_, index) => {
    const sql = `CREATE TABLE rehearsal_${index} (id INT);`;
    return { fileName: `${String(index).padStart(4, "0")}_fixture.sql`, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

function checkedInPlan() {
  const source = fs.readFileSync(path.join(repo, "scripts/run-database-migrations.mjs"), "utf8");
  const supplemental = source.match(/const supplementalMigrations = \[([\s\S]*?)\];/);
  assert.ok(supplemental);
  const journal = JSON.parse(fs.readFileSync(path.join(repo, "drizzle/meta/_journal.json"), "utf8"));
  const names = [...journal.entries.map(entry => `${entry.tag}.sql`), ...[...supplemental[1].matchAll(/"([^"]+\.sql)"/g)].map(match => match[1])];
  return names.map(fileName => {
    const sql = fs.readFileSync(path.join(repo, "drizzle", fileName), "utf8");
    return { fileName, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

// A narrow in-memory connector/runner double for orchestration, not a SQL engine
// or a substitute for the actual MySQL migration-policy rehearsal. Unknown calls fail.
function workflowFixture({ badSecondIdentity = false, badGeneralIdentity = false, badSyntheticRows = false, failGeneral = true, failCleanup = false, leakGeneralLedger = false } = {}) {
  const plan = checkedInPlan(), events = [], rawConnections = [], databases = new Map();
  const lockIds = new WeakMap();
  let lockOwner, nextLockId = 0, lockAcquisitions = 0, generalCalls = 0;
  const stateFor = async connection => {
    const [rows] = await connection.query("SELECT DATABASE() AS schemaName");
    assert.ok(databases.has(rows[0].schemaName));
    return databases.get(rows[0].schemaName);
  };
  const row = (migration, status, executionId = "fixture-run") => ({ migrationName: migration.fileName, checksum: migration.checksum, status, executionId });
  const runner = {
    loadMigrationPlan: () => plan,
    acquireMigrationLock: async (connection, options) => {
      if (!lockIds.has(connection)) lockIds.set(connection, ++nextLockId);
      const id = lockIds.get(connection);
      if (lockOwner) { events.push(`lock_refused:${id}`); assert.equal(options.timeoutSeconds, 0); throw new Error("Could not acquire the database migration advisory lock"); }
      lockOwner = connection;
      const acquisition = ++lockAcquisitions;
      events.push(`lock_acquired:${id}`);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        if (failCleanup && acquisition === 3) {
          events.push(`release_failed:${id}`);
          throw Object.assign(new Error("private cleanup detail"), { code: "ER_FIXTURE_RELEASE" });
        }
        assert.equal(lockOwner, connection);
        lockOwner = undefined;
        events.push(`lock_released:${id}`);
      };
    },
    ensureLedger: async connection => { await stateFor(connection); events.push("ensure_ledger"); },
    readLedger: async connection => new Map([...(await stateFor(connection)).ledger].map(([name, value]) => [name, { ...value }])),
    applyMigrations: async (connection, migrations, options) => {
      const current = await stateFor(connection);
      if (migrations.length === 168) {
        generalCalls += 1;
        assert.equal(options.retryFailed, false);
        assert.equal(migrations, plan);
        if (leakGeneralLedger) {
          const synthetic = [...databases].find(([name]) => name.endsWith("_synthetic"))[1];
          synthetic.ledger.set(plan[0].fileName, row(plan[0], "succeeded"));
        }
        if (!failGeneral) { for (const migration of plan) current.ledger.set(migration.fileName, row(migration, "succeeded")); return; }
        current.ledger.set(plan[0].fileName, row(plan[0], "succeeded"));
        current.ledger.set(plan[1].fileName, { ...row(plan[1], "failed"), error: "private SQL detail" });
        throw Object.assign(new Error("private SQL detail"), { cause: { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlState: "42S02", sql: "private SQL detail" } });
      }
      assert.equal(migrations.length, 1);
      const migration = migrations[0], existing = current.ledger.get(migration.fileName);
      if (existing && existing.checksum !== migration.checksum) throw new Error("Checksum mismatch");
      if (existing?.status === "succeeded") return;
      if (migration.fileName === "9000_rehearsal_first.sql") {
        current.tables.add("rehearsal_first"); current.ledger.set(migration.fileName, row(migration, "succeeded"));
      } else if (migration.fileName === "9001_rehearsal_partial.sql") {
        if (existing?.status === "failed" && !options.retryFailed) throw new Error("previously failed");
        current.tables.add("rehearsal_partial");
        if (!current.tables.has("rehearsal_repaired_dependency")) {
          current.ledger.set(migration.fileName, row(migration, "failed")); throw new Error("Migration failed");
        }
        assert.equal(options.retryFailed, true);
        current.ledger.set(migration.fileName, row(migration, "succeeded"));
      } else if (migration.fileName === "9002_rehearsal_interrupted.sql") {
        assert.equal(existing.status, "started"); throw new Error("interrupted migration record");
      } else assert.fail("Unexpected synthetic migration");
    },
    importLegacyJournal: async (connection, migrations) => {
      const current = await stateFor(connection);
      for (const migration of migrations) if (migration.official && current.legacyHashes.includes(migration.checksum) && !current.ledger.has(migration.fileName)) {
        current.ledger.set(migration.fileName, row(migration, "succeeded", "legacy-drizzle-import"));
      }
    },
  };
  const createConnection = async options => {
    assert.deepEqual(options, connectionOptions(paths));
    const id = rawConnections.length + 1;
    let selectedSchema;
    const state = () => { assert.ok(databases.has(selectedSchema)); return databases.get(selectedSchema); };
    const raw = {
      destroyed: 0, ended: 0, schemaUses: [],
      async query({ sql, timeout }) {
        assert.equal(timeout, 30000); events.push(`query:${id}:${sql}`);
        if (sql.startsWith("SELECT @@version")) return [[serverRow((id === 2 && badSecondIdentity) || (id === 3 && badGeneralIdentity) ? { skipNetworking: 0 } : {})]];
        const create = sql.match(/^CREATE DATABASE `([^`]+)` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci$/);
        if (create) { assert.equal(databases.has(create[1]), false); databases.set(create[1], { ledger: new Map(), tables: new Set(), legacyHashes: [] }); return [[]]; }
        const use = sql.match(/^USE `([^`]+)`$/);
        if (use) {
          // mysql2 prepared statements retain their original schema. Any future
          // regression that switches one connection between schemas fails here.
          assert.equal(raw.schemaUses.length, 0, "A prepared connection must never switch schemas");
          selectedSchema = use[1]; raw.schemaUses.push(selectedSchema); state(); return [[]];
        }
        if (sql === "SELECT DATABASE() AS schemaName") return [[{ schemaName: selectedSchema }]];
        const current = state();
        if (sql.startsWith("SELECT migrationName,checksum,status,executionId")) return [[...current.ledger.values()].sort((a, b) => a.migrationName.localeCompare(b.migrationName)).map(value => ({ ...value }))];
        if (sql === "SELECT id FROM rehearsal_first") return [[{ id: badSyntheticRows ? 2 : 1 }]];
        if (sql === "SELECT id FROM rehearsal_repaired_dependency") return [[{ id: 1 }]];
        const tableCount = sql.match(/FROM information_schema\.tables WHERE table_schema=DATABASE\(\) AND table_name='([^']+)'$/);
        if (tableCount) return [[{ count: Number(current.tables.has(tableCount[1])) }]];
        const tableCreate = sql.match(/^CREATE TABLE (rehearsal_repaired_dependency|rehearsal_legacy|__drizzle_migrations) \(/);
        if (tableCreate) { current.tables.add(tableCreate[1]); return [[]]; }
        assert.fail(`Unexpected query in workflow double: ${sql}`);
      },
      async execute({ sql, timeout }, values) {
        assert.equal(timeout, 30000);
        const current = state();
        if (sql === "INSERT INTO app_schema_migrations (migrationName,checksum,status) VALUES (?,?,'started')") {
          current.ledger.set(values[0], { migrationName: values[0], checksum: values[1], status: "started", executionId: null }); return [[]];
        }
        if (sql === "INSERT INTO __drizzle_migrations (hash) VALUES (?),(?)") { current.legacyHashes.push(...values); return [[]]; }
        assert.fail(`Unexpected execute in workflow double: ${sql}`);
      },
      async end() { raw.ended += 1; events.push(`end:${id}`); },
      destroy() { raw.destroyed += 1; events.push(`destroy:${id}`); },
    };
    rawConnections.push(raw);
    return raw;
  };
  return {
    dependencies: { load: async () => ({ runner, createConnection }), environment: {}, argv: [], io: fakeFs() },
    events, rawConnections, databases, plan, generalCalls: () => generalCalls,
  };
}

test("CLI requires explicit execution and all literal local paths", () => {
  assert.deepEqual(parseArguments(args), { executeLocal: true, ...paths });
  for (const invalid of [[], args.slice(1), [...args, "--host", "localhost"], [...args, "--socket", paths.socket], [...args, "--execute-local"], [...args, "--output"]]) {
    assert.throws(() => parseArguments(invalid));
  }
});

test("environment refuses DB targets, preloads and dotenv overrides, even empty values", () => {
  validateEnvironment({ PATH: "/usr/bin", DOTENV_CONFIG_PATH: "/dev/null" });
  for (const name of ["DATABASE_URL", "database_url", "MYSQL_PWD", "MYSQL_HOST", "MYSQL_TCP_PORT", "MYSQL_UNIX_PORT", "NODE_OPTIONS", "DOTENV_KEY", "DOTENV_CONFIG_OVERRIDE", "DOTENV_CONFIG_DEBUG", "DOTENV_CONFIG_DOTENV_KEY"]) {
    assert.throws(() => validateEnvironment({ [name]: "" }));
  }
  assert.throws(() => validateEnvironment({ DOTENV_CONFIG_PATH: "/tmp/not-env" }));
  assert.throws(() => validateEnvironment({}, ["dotenv_config_path=/tmp/not-env"]), code("UNSAFE_DOTENV_ARGUMENT"));
});

test("canonical direct-child socket and datadir accepted", () => {
  assert.deepEqual(validatePaths(paths, fakeFs()), paths);
});

test("rejects alias roots, traversal, siblings, relative paths and root-as-datadir", () => {
  for (const invalid of [
    { ...paths, root: "/tmp/amazon-mysql8-rehearsal.unit-test" },
    { ...paths, root: "/private/tmp/amazon-mysql8-rehearsal.unit-test/../elsewhere" },
    { ...paths, root: "/private/tmp/unrelated" },
    { ...paths, datadir: `${root}/../outside` },
    { ...paths, datadir: root },
    { ...paths, datadir: "data" },
    { ...paths, socket: `${root}-other/mysql.sock` },
    { ...paths, socket: `${root}/nested/mysql.sock` },
  ]) assert.throws(() => validatePaths(invalid, fakeFs()));
});

test("rejects symlink roots and children, non-sockets and non-directory datadir", () => {
  assert.throws(() => validatePaths(paths, fakeFs({ realpathSync: () => "/private/tmp/elsewhere" })), code("ROOT_MUST_BE_CANONICAL_DIRECTORY"));
  assert.throws(() => validatePaths(paths, fakeFs({ realpathSync: value => value === paths.datadir ? "/private/tmp/elsewhere" : value })), code("SYMLINK_TARGET_FORBIDDEN"));
  assert.throws(() => validatePaths(paths, fakeFs({ lstatSync: value => ({ isDirectory: () => value === root, isSocket: () => false, isSymbolicLink: () => false }) })), code("UNIX_SOCKET_REQUIRED"));
  assert.throws(() => validatePaths(paths, fakeFs({ lstatSync: value => ({ isDirectory: () => value === root, isSocket: () => value === paths.socket, isSymbolicLink: () => false }) })), code("DATA_DIRECTORY_REQUIRED"));
});

test("server identity requires actual socket, datadir, disabled networking and MySQL 8", () => {
  assert.deepEqual(validateServerIdentity(serverRow(), paths, fakeFs()), { version: "8.4.8", networkingDisabled: true });
  for (const version of ["5.7.44", "9.0.1", "10.11.8-MariaDB", "8.0.1-MariaDB", "8", "8.0.1\nsecret"]) {
    assert.throws(() => validateServerIdentity(serverRow({ version }), paths, fakeFs()), code("MYSQL_8_REQUIRED"));
  }
  for (const skipNetworking of [0, "0", "OFF", null, undefined]) {
    assert.throws(() => validateServerIdentity(serverRow({ skipNetworking }), paths, fakeFs()), code("NETWORKING_MUST_BE_DISABLED"));
  }
  assert.throws(() => validateServerIdentity(serverRow({ socket: "/tmp/mysql.sock" }), paths, fakeFs()), code("SERVER_SOCKET_MISMATCH"));
  assert.throws(() => validateServerIdentity(serverRow({ datadir: "/private/tmp/other/data" }), paths, fakeFs()), code("SERVER_DATADIR_MISMATCH"));
  assert.throws(() => validateServerIdentity(serverRow({ socket: "mysql.sock" }), paths, fakeFs()), code("SERVER_SOCKET_MISMATCH"));
});

test("server realpaths are rechecked, not only compared as strings", () => {
  assert.throws(() => validateServerIdentity(serverRow(), paths, fakeFs({ realpathSync: () => "/private/tmp/other" })), code("SERVER_SOCKET_MISMATCH"));
});

test("mysql connection options never propagate user-supplied host, URL, port or password", () => {
  const options = connectionOptions({ ...paths, host: "remote.invalid", uri: "sentinel", port: 3306, password: "sentinel" });
  assert.equal(options.socketPath, paths.socket);
  assert.equal(options.password, "");
  for (const field of ["host", "uri", "port", "database", "ssl"]) assert.equal(Object.hasOwn(options, field), false);
});

test("fresh schema names have narrow prefix and random run identity", () => {
  const first = schemaNames();
  assert.notDeepEqual(schemaNames(), first);
  assert.match(first.synthetic, /^amazon_rehearsal_[a-f0-9]{16}_synthetic$/);
  assert.match(first.general, /^amazon_rehearsal_[a-f0-9]{16}_general$/);
  assert.throws(() => schemaNames("anything`"), code("INVALID_RUN_ID"));
});

test("output must be a new JSON directly in canonical repo artifacts", () => {
  assert.equal(validateOutput(undefined, fakeFs()), undefined);
  const output = path.join(repo, "artifacts/rehearsal-unit.json");
  assert.equal(validateOutput(output, fakeFs()), output);
  for (const invalid of ["artifacts/test.json", "/tmp/test.json", path.join(repo, "artifacts/sub/test.json"), path.join(repo, "artifacts/test.sql")]) {
    assert.throws(() => validateOutput(invalid, fakeFs()), code("OUTPUT_MUST_BE_ARTIFACT_JSON"));
  }
  assert.throws(() => validateOutput(output, fakeFs({ existsSync: () => true })), code("OUTPUT_MUST_BE_NEW_CANONICAL_FILE"));
  assert.throws(() => validateOutput(output, fakeFs({ realpathSync: () => "/tmp/artifacts" })), code("OUTPUT_MUST_BE_NEW_CANONICAL_FILE"));
});

test("general plan gate enforces 168 unique, hash-verified general migrations", () => {
  const plan = planFixture();
  assert.match(validateGeneralPlan(plan), /^[a-f0-9]{64}$/);
  assert.throws(() => validateGeneralPlan(plan.slice(1)), code("GENERAL_PLAN_COUNT_CHANGED"));
  assert.throws(() => validateGeneralPlan([...plan.slice(1), plan[1]]), code("DUPLICATE_GENERAL_MIGRATION"));
  plan[0].checksum = "0".repeat(64);
  assert.throws(() => validateGeneralPlan(plan), code("PLAN_CHECKSUM_MISMATCH"));
});

test("checked-in general plan passes preflight by static reads, without importing runner", () => {
  assert.equal(validateGeneralPlan(checkedInPlan()), GENERAL_PLAN_SHA256);
});

test("historical manual, dedicated and draft migrations cannot enter this plan", () => {
  for (const prefix of ["0196", "0197", "0198", "0199", "0200", "0201", "0202", "0203", "0206", "0207"]) {
    const plan = planFixture();
    plan[0].fileName = `${prefix}_forbidden.sql`;
    assert.throws(() => validateGeneralPlan(plan), code("NON_GENERAL_MIGRATION_FORBIDDEN"));
  }
});

test("instance-level SQL is refused before any DB connection", () => {
  for (const sql of ["DROP DATABASE x", "DROP SCHEMA x", "CREATE DATABASE x", "CREATE USER x", "USE elsewhere;", "SET GLOBAL x=1", "GRANT ALL ON *.* TO x", "LOAD DATA INFILE 'x' INTO TABLE x", "SELECT 1 INTO OUTFILE 'x'", "INSTALL PLUGIN x SONAME 'x'", "SHUTDOWN", "/*!80000 DROP DATABASE x */", "DROP/* comment */DATABASE x"]) {
    const plan = planFixture();
    plan[0].sql = sql;
    plan[0].checksum = createHash("sha256").update(sql).digest("hex");
    assert.throws(() => validateGeneralPlan(plan), code("INSTANCE_LEVEL_SQL_FORBIDDEN"));
  }
});

test("SQL operation gate ignores instructions inside prompt values but not versioned comments", () => {
  assert.equal(sqlOperationText("INSERT INTO t VALUES ('Use confirmed facts; DROP DATABASE only words', 'it''s safe'); -- use comments\n"), "INSERT INTO t VALUES ( ,  );  ");
  assert.match(sqlOperationText("/*!80000 SET GLOBAL x=1 */"), /SET GLOBAL x=1/);
  assert.match(sqlOperationText("# comment\nDROP/**/DATABASE x"), /DROP DATABASE/);
});

test("error receipts never include SQL, messages, passwords or connection metadata", () => {
  const error = Object.assign(new Error("sensitive SQL and password"), { sql: "sensitive SQL", cause: { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlState: "42S02", message: "private schema" } });
  assert.deepEqual(safeError(error), { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlState: "42S02" });
  assert.deepEqual(safeError({ code: "password=secret", sqlState: "private" }), { code: "REHEARSAL_FAILED" });
});

test("unsafe environment and paths cannot import runner or instantiate a connector", async () => {
  let loads = 0;
  const load = async () => { loads += 1; throw new Error("must not load"); };
  await assert.rejects(runRehearsal({ ...paths, executeLocal: true }, { load, environment: { DATABASE_URL: "sentinel" }, argv: [] }), code("UNSAFE_INHERITED_ENVIRONMENT"));
  await assert.rejects(runRehearsal({ ...paths, root: "/tmp/not-allowed", executeLocal: true }, { load, environment: {}, argv: [] }), code("INVALID_TEMPORARY_ROOT"));
  assert.equal(loads, 0);
});

test("programmatic execution also requires the explicit local flag", async () => {
  let loads = 0;
  await assert.rejects(runRehearsal(paths, { load: async () => { loads += 1; }, environment: {}, argv: [] }), code("EXPLICIT_LOCAL_EXECUTION_REQUIRED"));
  assert.equal(loads, 0);
});

test("invalid plan refuses before connector creation", async () => {
  let connections = 0;
  const load = async () => ({ runner: { loadMigrationPlan: () => [] }, createConnection: async () => { connections += 1; } });
  await assert.rejects(runRehearsal({ ...paths, executeLocal: true }, { load, environment: {}, argv: [], io: fakeFs() }), code("GENERAL_PLAN_COUNT_CHANGED"));
  assert.equal(connections, 0);
});

test("same-count substituted or reordered general plan refuses before connection", async () => {
  let connections = 0;
  for (const plan of [planFixture(), checkedInPlan().reverse()]) {
    const load = async () => ({ runner: { loadMigrationPlan: () => plan }, createConnection: async () => { connections += 1; } });
    await assert.rejects(runRehearsal({ ...paths, executeLocal: true }, { load, environment: {}, argv: [], io: fakeFs() }), code("GENERAL_PLAN_SNAPSHOT_CHANGED"));
  }
  assert.equal(connections, 0);
});

test("connected instance mismatch destroys connection before locks or any DDL", async () => {
  for (const row of [serverRow({ skipNetworking: 0 }), serverRow({ datadir: "/private/tmp/foreign/data" }), serverRow({ version: "5.7.44" })]) {
    const queries = [];
    let destroyed = 0;
    const load = async () => ({
      runner: { loadMigrationPlan: checkedInPlan, acquireMigrationLock: () => { throw new Error("must not lock"); } },
      createConnection: async options => {
        assert.deepEqual(options, connectionOptions(paths));
        return {
          query: async options => { queries.push(options); return [[row]]; },
          execute: async () => { throw new Error("must not execute"); },
          destroy: () => { destroyed += 1; },
        };
      },
    });
    const receipt = await runRehearsal({ ...paths, executeLocal: true }, { load, environment: {}, argv: [], io: fakeFs() });
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.general.status, "not_started");
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /^SELECT @@version/);
    assert.equal(queries[0].timeout, 30000);
    assert.equal(destroyed, 1);
  }
});

test("second connection identity failure releases the first lock with zero DDL", async () => {
  const fixture = workflowFixture({ badSecondIdentity: true });
  const receipt = await runRehearsal({ ...paths, executeLocal: true }, fixture.dependencies);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error.code, "NETWORKING_MUST_BE_DISABLED");
  assert.equal(receipt.general.status, "not_started");
  assert.equal(fixture.databases.size, 0);
  assert.equal(fixture.generalCalls(), 0);
  const queries = fixture.events.filter(event => event.startsWith("query:"));
  assert.equal(queries.length, 2);
  assert.ok(queries.every(event => event.includes(":SELECT @@version")));
  assert.deepEqual(fixture.events.filter(event => !event.startsWith("query:")), ["lock_acquired:1", "lock_released:1", "destroy:1", "destroy:2"]);
  assert.deepEqual(fixture.rawConnections.map(connection => connection.destroyed), [1, 1]);
});

test("synthetic assertion failure cannot become successful or proceed to general DDL", async () => {
  const fixture = workflowFixture({ badSyntheticRows: true });
  const receipt = await runRehearsal({ ...paths, executeLocal: true }, fixture.dependencies);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error.code, "ERR_ASSERTION");
  assert.equal(receipt.general.status, "not_started");
  assert.equal(fixture.generalCalls(), 0);
  assert.deepEqual([...fixture.databases.keys()], [receipt.schemas.synthetic]);
  assert.deepEqual(receipt.synthetic, [{ case: "lock_mutual_exclusion_and_release", passed: true }]);
  assert.equal(fixture.events.at(-2), "lock_released:1");
  assert.equal(fixture.events.at(-1), "destroy:1");
  assert.equal(fixture.rawConnections[1].ended, 1);
});

test("general first failure preserves partial ledger and sanitized receipt, with actual main exit 2", async () => {
  const fixture = workflowFixture();
  let stdout = "", stderr = "";
  const exitCode = await main(args, {
    rehearsalDependencies: fixture.dependencies,
    stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } },
  });
  const receipt = JSON.parse(stdout);
  assert.equal(exitCode, 2);
  assert.equal(stderr, "");
  assert.equal(receipt.status, "completed_with_general_failure");
  assert.equal(receipt.general.status, "failed");
  assert.equal(receipt.general.succeededCount, 1);
  assert.deepEqual(receipt.general.ledger, fixture.plan.slice(0, 2).map((migration, index) => ({ migrationName: migration.fileName, checksum: migration.checksum, status: index ? "failed" : "succeeded" })));
  assert.deepEqual(receipt.general.firstFailure, receipt.general.ledger[1]);
  assert.deepEqual(receipt.general.error, { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlState: "42S02" });
  assert.equal(stdout.includes("private SQL detail"), false);
  assert.equal(fixture.generalCalls(), 1);
  assert.equal(fixture.databases.size, 2);
  assert.equal(receipt.synthetic.length, 6);
  assert.ok(receipt.synthetic.every(item => item.passed === true));
  assert.equal(receipt.productionValidated, false);
  assert.equal(receipt.historicalBaselineProvided, false);
  assert.deepEqual(receipt.connectionIsolation, {
    strategy: "fresh_connection_per_schema", schemaConnectionOrdinals: { synthetic: 1, general: 3 },
    syntheticGeneralMigrationCount: 0, generalUnexpectedMigrationCount: 0,
  });
  assert.deepEqual(fixture.rawConnections.map(connection => connection.schemaUses), [[receipt.schemas.synthetic], [], [receipt.schemas.general]]);
  const syntheticNames = [...fixture.databases.get(receipt.schemas.synthetic).ledger.keys()];
  assert.ok(syntheticNames.length > 0 && syntheticNames.every(name => name.startsWith("900")));
  assert.deepEqual([...fixture.databases.get(receipt.schemas.general).ledger.keys()], fixture.plan.slice(0, 2).map(item => item.fileName));
  assert.deepEqual(fixture.events.slice(-3), ["lock_released:1", "destroy:1", "destroy:3"]);
});

test("cleanup release error overrides a completed general run to failed and still destroys connection", async () => {
  const fixture = workflowFixture({ failGeneral: false, failCleanup: true });
  const receipt = await runRehearsal({ ...paths, executeLocal: true }, fixture.dependencies);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.general.status, "succeeded");
  assert.equal(receipt.general.succeededCount, 168);
  assert.deepEqual(receipt.cleanupError, { code: "ER_FIXTURE_RELEASE" });
  assert.equal(JSON.stringify(receipt).includes("private cleanup detail"), false);
  assert.equal(fixture.generalCalls(), 1);
  assert.deepEqual(fixture.events.slice(-3), ["release_failed:1", "destroy:1", "destroy:3"]);
  assert.equal(fixture.rawConnections[0].destroyed, 1);
  assert.equal(fixture.rawConnections[1].ended, 1);
  assert.equal(fixture.rawConnections[2].destroyed, 1);
});

test("fresh general connection must independently pass identity before any general DDL", async () => {
  const fixture = workflowFixture({ badGeneralIdentity: true });
  const receipt = await runRehearsal({ ...paths, executeLocal: true }, fixture.dependencies);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error.code, "NETWORKING_MUST_BE_DISABLED");
  assert.equal(receipt.general.status, "not_started");
  assert.equal(fixture.generalCalls(), 0);
  assert.deepEqual([...fixture.databases.keys()], [receipt.schemas.synthetic]);
  assert.equal(receipt.synthetic.length, 6);
  assert.deepEqual(fixture.rawConnections.map(connection => connection.schemaUses), [[receipt.schemas.synthetic], [], []]);
  const generalQueries = fixture.events.filter(event => event.startsWith("query:3:"));
  assert.equal(generalQueries.length, 1);
  assert.match(generalQueries[0], /^query:3:SELECT @@version/);
  assert.deepEqual(fixture.events.slice(-3), ["lock_released:1", "destroy:1", "destroy:3"]);
});

test("receipt fails closed if general migrations ever appear in synthetic ledger", async () => {
  const fixture = workflowFixture({ leakGeneralLedger: true });
  const receipt = await runRehearsal({ ...paths, executeLocal: true }, fixture.dependencies);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error.code, "GENERAL_LEDGER_LEAKED_TO_SYNTHETIC");
  assert.equal(receipt.connectionIsolation.syntheticGeneralMigrationCount, 1);
  assert.equal(fixture.generalCalls(), 1);
  assert.deepEqual(fixture.events.slice(-3), ["lock_released:1", "destroy:1", "destroy:3"]);
});

test("module import remains inert with inherited DB configuration", () => {
  const target = new URL("./mysqlRehearsal.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(target)});`], {
    env: { DATABASE_URL: "sentinel-must-not-connect", DOTENV_CONFIG_PATH: "/nonexistent/do-not-read" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("tool has no drop-database, baseline or dedicated-runner execution path", () => {
  const source = fs.readFileSync(new URL("./mysqlRehearsal.mjs", import.meta.url), "utf8");
  assert.equal(/runner\.(?:baselineExistingSchema|loadExternalKnowledgeCallerBindingMigrationPlan|loadImageQualityDevelopmentMigrationPlan|loadImageQualityProductionMigrationPlan)\s*\(/.test(source), false);
  assert.equal(/(?:query|execute)\(\s*[`'"]DROP\s+(?:DATABASE|SCHEMA)/i.test(source), false);
  assert.match(source, /flag: "wx", mode: 0o600/);
});
