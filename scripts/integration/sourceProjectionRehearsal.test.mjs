import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test, { after, before } from "node:test";
import { exportSourceProjection, EXCLUDED_TABLES, normalizeCreateStatement } from "./sourceProjection.mjs";
import {
  currentSourceFiles, main, parseArguments, PRE_INDEX_ALIGNMENT_PROJECTION_PIN,
  PROJECTION_SQL_SHA256, PROJECTION_SOURCE_SHA256, runProjectionRehearsal,
  validateProjectionArtifact, validateResultTables,
} from "./sourceProjectionRehearsal.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const root = "/private/tmp/amazon-mysql8-rehearsal.projection-unit";
const paths = { root, socket: `${root}/mysql.sock`, datadir: `${root}/data` };
const output = path.join(repo, "artifacts/source-projection-unit.json");
const digest = value => createHash("sha256").update(value).digest("hex");
const errorCode = value => error => error.code === value;
const historicalFixture = fileURLToPath(new URL("./fixtures/aligned-source-projection-20261014/", import.meta.url));
const historicalMetadataSha256 = "8e216c7c03a26915fb9e8e43d8055f9c61858aca27ca0efd111ab58aff36e0b8";
let temporary, directory, currentDirectory, metadata, sql, artifact;

before(async () => {
  temporary = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "source-projection-rehearsal-test-")));
  directory = path.join(temporary, "exported");
  fs.mkdirSync(directory);
  // Authentic public historical export, not a regenerated current artifact with
  // its hash relabeled. Only mocked workflows use this historical source audit.
  for (const [name, expected] of [["source-projection.sql", PROJECTION_SQL_SHA256],
    ["source-projection.metadata.json", historicalMetadataSha256]]) {
    const source = path.join(historicalFixture, name);
    assert.equal(digest(fs.readFileSync(source)), expected);
    fs.copyFileSync(source, path.join(directory, name));
  }
  metadata = JSON.parse(fs.readFileSync(path.join(directory, "source-projection.metadata.json"), "utf8"));
  sql = fs.readFileSync(path.join(directory, "source-projection.sql"), "utf8");
  artifact = validateProjectionArtifact(directory, { sourceFiles: metadata.sourceFiles });
  currentDirectory = path.join(temporary, "current-exported");
  // Real current offline export is separately checked to remain inadmissible
  // to this old diagnostic. No SQL execution or database connection occurs.
  await exportSourceProjection({ repoRoot: repo, outputDirectory: currentDirectory });
});
after(() => { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); });

const options = () => ({ executeLocal: true, ...paths, "projection-directory": directory, output });
const args = () => ["--execute-local", "--root", root, "--socket", paths.socket, "--datadir", paths.datadir,
  "--projection-directory", directory, "--output", output];
const server = overrides => ({ version: "8.4.8", socket: paths.socket, datadir: `${paths.datadir}/`, skipNetworking: 1,
  lowerCaseTableNames: 2, sqlMode: "STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION", ...overrides });

function fakeFs(overrides = {}) {
  const writes = [];
  return {
    ...fs,
    // Output is mocked too: do not depend on an ignored local artifacts directory.
    realpathSync: value => [root, paths.socket, paths.datadir, `${paths.datadir}/`, path.dirname(output)].includes(value) ? value.replace(/\/$/, "") : fs.realpathSync(value),
    lstatSync: value => [root, paths.socket, paths.datadir].includes(value)
      ? { isDirectory: () => value !== paths.socket, isSocket: () => value === paths.socket, isSymbolicLink: () => false }
      : fs.lstatSync(value),
    existsSync: value => value === output ? false : fs.existsSync(value),
    writeFileSync: (filename, value, flags) => { writes.push({ filename, value, flags }); },
    writes, ...overrides,
  };
}

function workflowFixture({ identity, failDdl, tableTransform = rows => rows, failDestroy = false, failCreate = false, wrongSchema = false, io = fakeFs() } = {}) {
  const connections = [], events = [];
  let loads = 0;
  const createConnection = async connectionOptions => {
    assert.equal(connectionOptions.socketPath, paths.socket);
    assert.equal(connectionOptions.multipleStatements, false);
    assert.equal(connectionOptions.password, "");
    assert.equal(Object.hasOwn(connectionOptions, "uri"), false);
    assert.equal(Object.hasOwn(connectionOptions, "host"), false);
    let schema, ddl = 0;
    const raw = {
      destroyed: 0,
      async query({ sql: statement, timeout }) {
        assert.ok(timeout > 0 && timeout <= 30000); events.push(statement);
        if (statement.startsWith("SELECT @@version")) return [[server(identity)]];
        if (statement.startsWith("CREATE DATABASE")) {
          assert.equal(schema, undefined);
          assert.match(statement, /^CREATE DATABASE `amazon_rehearsal_[a-f0-9]{16}_synthetic` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci$/);
          if (failCreate) throw Object.assign(new Error("private SQL"), { code: "ER_DB_CREATE_EXISTS" });
          schema = statement.match(/`([^`]+)`/)[1]; return [[]];
        }
        if (statement.startsWith("USE ")) { assert.equal(statement, `USE \`${schema}\``); return [[]]; }
        if (statement === "SELECT DATABASE() AS schemaName") return [[{ schemaName: wrongSchema ? "other" : schema }]];
        if (statement.startsWith("SELECT table_name AS tableName")) return [tableTransform(artifact.tableNames.map(tableName => ({ tableName, tableType: "BASE TABLE" })))];
        assert.ok(schema);
        assert.equal(normalizeCreateStatement(statement), statement);
        assert.equal(statement, artifact.statements[ddl], "Execute the pinned DDL sequence exactly once and in order");
        ddl += 1;
        if (ddl === failDdl) throw Object.assign(new Error("private full SQL and password"), { code: "ER_DUP_KEYNAME", errno: 1061, sqlState: "42000", sql: "private statement" });
        return [[]];
      },
      execute() { assert.fail("Prepared statements are forbidden in this rehearsal"); },
      destroy() { raw.destroyed += 1; if (failDestroy) throw Object.assign(new Error("private cleanup"), { code: "ER_FAKE_CLEANUP" }); },
    };
    connections.push(raw); return raw;
  };
  return { connections, events, io, loads: () => loads,
    dependencies: { environment: {}, argv: [], io, auditSources: () => metadata.sourceFiles,
      load: async () => { loads += 1; return createConnection; } } };
}

test("requires every explicit local argument and refuses remote/duplicate/unknown options", () => {
  assert.deepEqual(parseArguments(args()), options());
  for (const invalid of [[], args().slice(1), args().slice(0, -2), [...args(), "--execute-local"],
    [...args(), "--host", "localhost"], [...args(), "--output", output], [...args(), "--retry"]]) assert.throws(() => parseArguments(invalid));
});

test("validates authentic historical aligned hashes and all 406 single-DDL blocks offline", () => {
  assert.equal(digest(sql), PROJECTION_SQL_SHA256);
  assert.equal(artifact.statements.length, 406);
  assert.equal(artifact.tableNames.length, 287);
  assert.equal(digest(fs.readFileSync(path.join(directory, "source-projection.metadata.json"))), historicalMetadataSha256);
  assert.notDeepEqual(metadata.sourceFiles, currentSourceFiles());
  assert.equal(artifact.sourceSha256, digest(JSON.stringify(metadata.sourceFiles)));
  assert.equal(artifact.sourceSha256, PROJECTION_SOURCE_SHA256);
  assert.ok(artifact.statements.every(statement => normalizeCreateStatement(statement) === statement));
});

test("current reviewed source cannot impersonate the historical export or enter the old workflow", async () => {
  const current = JSON.parse(fs.readFileSync(path.join(currentDirectory, "source-projection.metadata.json"), "utf8"));
  assert.equal(current.sqlSha256, "c2ea534b048427e7b3b464dd37ec442524cf5e8dd1ec80fac3e514259957a6aa");
  assert.equal(current.sourceSha256, "7b0b730998509d2ba70dc7b771bf5a6233146c58b35d2ef83bf028945a2c1a6f");
  assert.deepEqual(current.sourceFiles, currentSourceFiles());
  assert.throws(() => validateProjectionArtifact(currentDirectory), errorCode("PROJECTION_SOURCE_HASH_MISMATCH"));
  assert.throws(() => validateProjectionArtifact(directory));
  for (const projectionDirectory of [directory, currentDirectory]) {
    const fixture = workflowFixture();
    await assert.rejects(runProjectionRehearsal({ ...options(), "projection-directory": projectionDirectory },
      { ...fixture.dependencies, auditSources: currentSourceFiles }));
    assert.equal(fixture.loads(), 0);
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.io.writes.length, 0);
  }
});

test("preserves the superseded 405-DDL source/SQL pins for audit, not current execution", async () => {
  assert.deepEqual(PRE_INDEX_ALIGNMENT_PROJECTION_PIN, {
    sqlSha256: "582a5babb990537759adb633a28e82dae668112ca2a9e3e505e626b2424d46f2",
    sourceSha256: "253fbc80b84b53600c19abfa8f9c5d4d4d3c0f4244dcd140ce5a8c86a8fc2f07",
    tableCount: 287, ddlCount: 405, retainedForAuditOnly: true,
  });
  assert.equal(Object.isFrozen(PRE_INDEX_ALIGNMENT_PROJECTION_PIN), true);
  assert.notEqual(PRE_INDEX_ALIGNMENT_PROJECTION_PIN.sqlSha256, PROJECTION_SQL_SHA256);
  assert.notEqual(PRE_INDEX_ALIGNMENT_PROJECTION_PIN.sourceSha256, PROJECTION_SOURCE_SHA256);
  const io = fakeFs({ readFileSync: (filename, encoding) => filename.endsWith("metadata.json")
    ? JSON.stringify({ ...metadata, sqlSha256: PRE_INDEX_ALIGNMENT_PROJECTION_PIN.sqlSha256 }) : fs.readFileSync(filename, encoding) });
  const fixture = workflowFixture({ io });
  await assert.rejects(runProjectionRehearsal(options(), fixture.dependencies), errorCode("PROJECTION_SQL_HASH_MISMATCH"));
  assert.equal(fixture.loads(), 0);
});

test("self-consistent metadata and local source drift still require an explicit new source pin", () => {
  const changedSources = metadata.sourceFiles.map((value, index) => index === 0 ? { ...value, sha256: "0".repeat(64) } : value);
  const io = fakeFs({ readFileSync: (filename, encoding) => filename.endsWith("metadata.json")
    ? JSON.stringify({ ...metadata, sourceFiles: changedSources, sourceSha256: digest(JSON.stringify(changedSources)) }) : fs.readFileSync(filename, encoding) });
  assert.throws(() => validateProjectionArtifact(directory, { io, sourceFiles: changedSources }), errorCode("PROJECTION_SOURCE_HASH_MISMATCH"));
});

test("rejects changed SQL and forged metadata before loading any connector", async () => {
  const changes = [
    value => ({ ...value, sqlSha256: "0".repeat(64) }),
    value => ({ ...value, sourceSha256: "0".repeat(64) }),
    value => ({ ...value, sourceFiles: value.sourceFiles.slice(1) }),
    value => ({ ...value, tableNames: [...value.tableNames.slice(1), "forged"] }),
    value => ({ ...value, tableCount: 286 }), value => ({ ...value, ddlCount: 405 }),
    value => ({ ...value, excludedTables: [] }), value => ({ ...value, productionClone: true }),
    value => ({ ...value, migrationLedgerWritten: true }), value => ({ ...value, sqlExecuted: true }),
    value => ({ ...value, mode: "production-clone" }), value => ({ ...value, sqlFile: "../elsewhere.sql" }),
  ];
  for (const change of [...changes, null]) {
    const io = fakeFs({ readFileSync: (filename, encoding) => filename.endsWith("metadata.json") && change
      ? JSON.stringify(change(metadata)) : filename.endsWith("source-projection.sql") && !change
        ? `${sql}DROP TABLE users;` : fs.readFileSync(filename, encoding) });
    const fixture = workflowFixture({ io });
    await assert.rejects(runProjectionRehearsal(options(), fixture.dependencies));
    assert.equal(fixture.loads(), 0); assert.equal(fixture.connections.length, 0); assert.equal(io.writes.length, 0);
  }
});

test("rejects source drift, missing execute/output and inherited target configuration without connector loading", async () => {
  for (const [input, patch] of [
    [{ ...options(), executeLocal: false }, {}], [{ ...options(), output: undefined }, {}],
    [options(), { environment: { DATABASE_URL: "synthetic-do-not-connect" } }],
    [options(), { environment: { NODE_OPTIONS: "" } }], [options(), { auditSources: () => [] }],
  ]) {
    const fixture = workflowFixture();
    await assert.rejects(runProjectionRehearsal(input, { ...fixture.dependencies, ...patch }));
    assert.equal(fixture.loads(), 0);
  }
});

test("artifact symlinks, excessive sizes and noncanonical directories are refused", () => {
  assert.throws(() => validateProjectionArtifact(`${directory}/../exported`), errorCode("PROJECTION_DIRECTORY_MUST_BE_ABSOLUTE"));
  assert.throws(() => validateProjectionArtifact(directory, { sourceFiles: metadata.sourceFiles, io: fakeFs({
    lstatSync: filename => ({ ...fs.lstatSync(filename), isDirectory: () => filename === directory, isSymbolicLink: () => filename !== directory, isFile: () => filename !== directory, size: 1 }),
  }) }), errorCode("PROJECTION_FILE_MUST_BE_REGULAR_BOUNDED"));
  assert.throws(() => validateProjectionArtifact(directory, { sourceFiles: metadata.sourceFiles, io: fakeFs({
    lstatSync: filename => ({ isDirectory: () => filename === directory, isSymbolicLink: () => false, isFile: () => filename !== directory, size: 9 * 1024 * 1024 }),
  }) }), errorCode("PROJECTION_FILE_MUST_BE_REGULAR_BOUNDED"));
});

test("every fresh connection verifies actual instance identity before any DDL", async () => {
  for (const identity of [{ skipNetworking: 0 }, { datadir: "/private/tmp/foreign/data" }, { socket: "/tmp/mysql.sock" }, { version: "5.7.44" }]) {
    const fixture = workflowFixture({ identity });
    const receipt = await runProjectionRehearsal(options(), fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(receipt.ddlSucceeded, 0);
    assert.equal(fixture.events.length, 1); assert.match(fixture.events[0], /^SELECT @@version/);
    assert.equal(fixture.connections[0].destroyed, 1);
    assert.equal(receipt.schemaCreated, undefined);
  }
});

test("one successful rehearsal uses one schema/session, unprepared single DDL and exact table validation", async () => {
  const fixture = workflowFixture(), receipt = await runProjectionRehearsal(options(), fixture.dependencies);
  assert.equal(receipt.status, "completed"); assert.equal(receipt.ddlSucceeded, 406);
  assert.equal(fixture.connections.length, 1); assert.equal(fixture.connections[0].destroyed, 1);
  assert.equal(fixture.events.filter(value => value.startsWith("USE ")).length, 1);
  assert.match(fixture.events[0], /^SELECT @@version/); assert.match(fixture.events[1], /^CREATE DATABASE/);
  assert.deepEqual(fixture.events.slice(4, -1), artifact.statements);
  assert.deepEqual(receipt.validation, { tableCount: 287, exactTableNames: true, excludedTablesAbsent: true, migrationLedgerAbsent: true });
  assert.equal(receipt.server.lowerCaseTableNames, 2); assert.equal(receipt.server.sqlMode, server().sqlMode);
  assert.deepEqual(receipt.previousProjectionPin, PRE_INDEX_ALIGNMENT_PROJECTION_PIN);
  for (const field of ["productionValidated", "historicalUpgradeValidated", "migrationLedgerWritten", "caseSensitiveLinuxValidated", "seeded"]) assert.equal(receipt[field], false);
  assert.equal(fixture.io.writes.length, 1); assert.deepEqual(fixture.io.writes[0].flags, { flag: "wx", mode: 0o600 });
  assert.equal(JSON.parse(fixture.io.writes[0].value).schema, receipt.schema);
});

test("missing/invalid server case or SQL mode diagnostics are rejected before CREATE", async () => {
  for (const identity of [{ lowerCaseTableNames: null }, { lowerCaseTableNames: undefined }, { lowerCaseTableNames: 3 },
    { lowerCaseTableNames: false }, { sqlMode: null }]) {
    const fixture = workflowFixture({ identity }), receipt = await runProjectionRehearsal(options(), fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(receipt.error.code, "PROJECTION_SERVER_SETTINGS_INVALID");
    assert.equal(fixture.events.length, 1); assert.equal(fixture.connections[0].destroyed, 1);
  }
});

test("separate invocations get fresh random schema identities and fresh sessions", async () => {
  const fixture = workflowFixture();
  const first = await runProjectionRehearsal(options(), fixture.dependencies);
  const second = await runProjectionRehearsal(options(), fixture.dependencies);
  assert.notEqual(first.schema, second.schema); assert.equal(fixture.connections.length, 2);
  assert.ok(fixture.connections.every(connection => connection.destroyed === 1));
});

test("first DDL failure stops immediately with index/hash/safe error, no retries, no leaked SQL", async () => {
  const fixture = workflowFixture({ failDdl: 2 }), receipt = await runProjectionRehearsal(options(), fixture.dependencies);
  assert.equal(receipt.status, "failed"); assert.equal(receipt.ddlSucceeded, 1);
  assert.deepEqual(receipt.firstFailure, { statementIndex: 2, statementSha256: digest(artifact.statements[1]), error: { code: "ER_DUP_KEYNAME", errno: 1061, sqlState: "42000" } });
  assert.equal(fixture.events.length, 6); assert.equal(receipt.validation, undefined);
  assert.equal(fixture.connections[0].destroyed, 1);
  const reported = JSON.stringify(receipt);
  for (const sensitive of ["private", "password", "CREATE TABLE"]) assert.equal(reported.includes(sensitive), false);
});

test("new-schema collision and current-schema mismatch stop before projection DDL", async () => {
  for (const config of [{ failCreate: true }, { wrongSchema: true }]) {
    const fixture = workflowFixture(config), receipt = await runProjectionRehearsal(options(), fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(receipt.ddlSucceeded, 0);
    assert.equal(receipt.firstFailure, undefined); assert.equal(fixture.connections[0].destroyed, 1);
    assert.ok(fixture.events.length <= 4);
  }
});

test("missing/extra/case-changed/duplicate/view table results cannot claim successful validation", async () => {
  for (const tableTransform of [rows => rows.slice(1), rows => [...rows, { tableName: "app_schema_migrations", tableType: "BASE TABLE" }],
    rows => [...rows, { tableName: EXCLUDED_TABLES[0], tableType: "BASE TABLE" }],
    rows => rows.map(row => ({ ...row, tableName: row.tableName.toLowerCase() })),
    rows => [...rows.slice(1), rows[1]], rows => rows.map(row => ({ ...row, tableType: "VIEW" }))]) {
    const fixture = workflowFixture({ tableTransform }), receipt = await runProjectionRehearsal(options(), fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(receipt.ddlSucceeded, 406); assert.equal(receipt.validation, undefined);
  }
  assert.throws(() => validateResultTables([{ tableName: "app_schema_migrations", tableType: "BASE TABLE" }], ["app_schema_migrations"]), errorCode("PROJECTION_FORBIDDEN_TABLE_PRESENT"));
});

test("cleanup failure converts successful work to a nonzero CLI result; DDL failures are also nonzero", async () => {
  for (const config of [{ failDestroy: true }, { failDdl: 1 }, {}]) {
    const fixture = workflowFixture(config), stdout = [], stderr = [];
    const code = await main(args(), { dependencies: fixture.dependencies, stdout: { write: value => stdout.push(value) }, stderr: { write: value => stderr.push(value) } });
    assert.equal(code, config.failDestroy || config.failDdl ? 1 : 0);
    assert.equal(stderr.length, 0); assert.equal(stdout.length, 1);
    if (config.failDestroy) assert.deepEqual(JSON.parse(stdout[0]).cleanupError, { code: "ER_FAKE_CLEANUP" });
  }
});

test("output refusal occurs before connection; output I/O failure cannot return a green CLI code", async () => {
  const existing = workflowFixture({ io: fakeFs({ existsSync: () => true }) });
  await assert.rejects(runProjectionRehearsal(options(), existing.dependencies), errorCode("OUTPUT_MUST_BE_NEW_CANONICAL_FILE"));
  assert.equal(existing.loads(), 0);
  const fixture = workflowFixture({ io: fakeFs({ writeFileSync: () => { throw Object.assign(new Error("private path"), { code: "ENOSPC" }); } }) });
  const stdout = [], stderr = [];
  assert.equal(await main(args(), { dependencies: fixture.dependencies, stdout: { write: value => stdout.push(value) }, stderr: { write: value => stderr.push(value) } }), 1);
  assert.equal(stdout.length, 0); assert.equal(JSON.parse(stderr[0]).error.code, "ENOSPC");
  assert.equal(fixture.connections[0].destroyed, 1);
});

test("module import is inert with inherited database configuration and has no runner/execute/seed path", () => {
  const target = new URL("./sourceProjectionRehearsal.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(target.href)});`], {
    env: { DATABASE_URL: "synthetic-not-a-connection", DOTENV_CONFIG_PATH: "/nonexistent-do-not-load" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  const source = fs.readFileSync(target, "utf8");
  assert.equal(source.includes("run-database-migrations"), false);
  assert.equal(/\.(?:execute|applyMigrations|ensureLedger)\s*\(/.test(source), false);
  assert.equal(/(?:query|execute)\(\s*[`'"](?:INSERT|DROP)/i.test(source), false);
});
