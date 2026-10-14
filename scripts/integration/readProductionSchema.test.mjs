import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import {
  METADATA_SELECTS, TARGET_INDEXES, inspectProductionSchema, main, parseArguments, validateManagedUri, validateSchema,
} from "./readProductionSchema.mjs";

const schema = "synthetic_metadata_scope";
const uri = "mysql://fixture:never-real@invalid.test/synthetic_metadata_scope";
const options = { inspectReadOnly: true, expectedSchema: schema };
const args = ["--inspect-read-only", "--expected-schema", schema];
const clone = value => structuredClone(value);
const code = value => error => error.code === value;
const row = (collection, values) => ({ ...Object.fromEntries(METADATA_SELECTS[collection].fields.map(field => [field, null])), ...values });

function snapshot({ ledgerPresent = true } = {}) {
  const tables = ["emperor_scheduled_tasks", "knowledge_distillation_evidence", "products", ...(ledgerPresent ? ["app_schema_migrations"] : [])].sort();
  const metadata = Object.fromEntries(Object.keys(METADATA_SELECTS).map(name => [name, []]));
  metadata.schema = [row("schema", { schemaName: schema, characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci" })];
  metadata.tables = tables.map(tableName => row("tables", { tableName, tableType: "BASE TABLE", engine: "InnoDB" }));
  const columns = {
    emperor_scheduled_tasks: ["workspaceId", "systemManaged", "externalTaskUid"],
    knowledge_distillation_evidence: ["distillationProjectId", "sourceKey", "claim"],
    products: ["privateProductColumn"],
    ...(ledgerPresent ? { app_schema_migrations: ["migrationName", "checksum", "status"] } : {}),
  };
  metadata.columns = Object.entries(columns).flatMap(([tableName, names]) => names.map((columnName, index) => row("columns", {
    tableName, columnName, ordinalPosition: index + 1, dataType: "varchar", typeShape: "varchar(255)",
    defaultKind: "LITERAL_REDACTED", enumMembersRedacted: 0, generationExpressionPresent: 0,
    rawDefault: "synthetic-secret-default", COLUMN_COMMENT: "synthetic-secret-comment",
  })));
  metadata.indexes = TARGET_INDEXES.flatMap((target, index) => {
    const names = index === 0 ? ["distillationProjectId", "sourceKey", "claim"] : index === 1 ? ["externalTaskUid"] : ["workspaceId", "systemManaged"];
    return names.map((columnName, ordinal) => row("indexes", { ...target, columnName, sequence: ordinal + 1,
      nonUnique: index === 2 ? 1 : 0, prefixLength: columnName === "claim" ? 191 : null, indexType: "BTREE", visible: "YES" }));
  });
  const ledger = [
    "0180_emperor_lingxing_scheduled_task_unification.sql", "0187_skill_distillation_foundation.sql", "unrelated_other.sql",
  ].map(migrationName => ({ migrationName, checksum: "a".repeat(64), status: "succeeded", error: "synthetic-secret-error", metadata: "synthetic-secret-metadata" }));
  return { metadata, ledger };
}

function fixture({ first = snapshot(), second = clone(first), identity = {}, failCollection, failDestroy = false, failRollback = false } = {}) {
  const calls = [], observedConfig = [], passes = [first, second];
  let loads = 0, pass = -1, active = false, destroyed = 0;
  const load = async () => {
    loads += 1;
    return async config => {
      observedConfig.push(config);
      return {
        async query({ sql, timeout }, values) {
          assert.ok(timeout > 0 && timeout <= 5000); calls.push({ sql, values });
          if (sql.startsWith("SELECT DATABASE()")) return [[{ schemaName: schema, version: "8.0.44", lowerCaseTableNames: 0,
            sqlMode: "STRICT_TRANS_TABLES", unusedSecret: "synthetic-secret-identity", ...identity }]];
          if (["SET SESSION TRANSACTION READ ONLY", "SET SESSION MAX_EXECUTION_TIME = 5000", "SET SESSION lock_wait_timeout = 5"].includes(sql)) {
            assert.equal(active, false); return [[]];
          }
          if (sql === "START TRANSACTION READ ONLY") { assert.equal(active, false); active = true; pass += 1; return [[]]; }
          if (sql === "ROLLBACK") {
            if (failRollback) throw Object.assign(new Error("synthetic-secret-rollback"), { code: "ER_FIXTURE_ROLLBACK" });
            assert.equal(active, true); active = false; return [[]];
          }
          assert.equal(active, true, "All catalog/ledger reads must be in the read-only transaction");
          const collection = Object.entries(METADATA_SELECTS).find(([, definition]) => definition.sql === sql);
          if (collection) {
            const [name] = collection;
            assert.deepEqual(values, Array((sql.match(/\?/g) ?? []).length).fill(schema));
            if (failCollection === name) throw Object.assign(new Error("synthetic-secret SQL password"), { code: "ER_FIXTURE_QUERY", sql: "private SQL" });
            return [clone(passes[pass].metadata[name])];
          }
          assert.equal(sql, `SELECT migrationName, checksum, status FROM \`${schema}\`.\`app_schema_migrations\` ORDER BY BINARY migrationName LIMIT 50001`);
          assert.deepEqual(values, []);
          return [clone(passes[pass].ledger)];
        },
        execute() { assert.fail("No prepared, arbitrary, or application query path expected"); },
        destroy() { destroyed += 1; if (failDestroy) throw Object.assign(new Error("synthetic-secret-destroy"), { code: "ER_FIXTURE_DESTROY" }); },
      };
    };
  };
  return { dependencies: { load, environment: { DATABASE_URL: uri, UNRELATED_SECRET: "synthetic-secret-env" } },
    calls, observedConfig, loads: () => loads, destroyed: () => destroyed };
}

test("CLI requires explicit read-only mode and exact non-system schema, no URL/host/table/SQL options", () => {
  assert.deepEqual(parseArguments(args), options);
  assert.deepEqual(parseArguments([...args, "--summary"]), { ...options, summary: true });
  for (const invalid of [[], args.slice(1), ["--inspect-read-only"], [...args, "--summary", "--summary"],
    [...args, "--expected-schema", schema], [...args, "--inspect-read-only"], [...args, "--url", uri],
    [...args, "--host", "invalid.test"], [...args, "--table", "users"], [...args, "--sql", "SELECT 1"]]) assert.throws(() => parseArguments(invalid));
  for (const invalid of ["mysql", "MYSQL", "sys", "information_schema", "performance_schema", "other.schema", "x`", "a;DROP", "", "x".repeat(65), "x\0"])
    assert.throws(() => validateSchema(invalid), code("INVALID_EXPECTED_SCHEMA"));
});

test("missing consent/scope/managed environment refuses before loading connector", async () => {
  for (const [input, environment] of [[{ ...options, inspectReadOnly: false }, { DATABASE_URL: uri }],
    [{ ...options, expectedSchema: "mysql" }, { DATABASE_URL: uri }], [options, {}], [options, { DATABASE_URL: "" }]]) {
    const fake = fixture();
    await assert.rejects(inspectProductionSchema(input, { ...fake.dependencies, environment }));
    assert.equal(fake.loads(), 0);
  }
});

test("managed URL cannot override driver safety or trigger parameter logging", async () => {
  for (const suffix of ["?multipleStatements=true", "?debug=true", "?rowsAsArray=true", "?flags=MULTI_STATEMENTS",
    "?database=other", "?host=other", "?uri=other", "?synthetic-secret=value", "?timezone=synthetic-secret",
    "?timezone=%5B%22Z%22%5D", "?charset=utf8mb4&charset=utf8", "?ssl=true"]) {
    const fake = fixture();
    await assert.rejects(inspectProductionSchema(options, { ...fake.dependencies, environment: { DATABASE_URL: uri + suffix } }),
      code("MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED"));
    assert.equal(fake.loads(), 0);
  }
  for (const invalid of ["invalid", uri.replace("mysql:", "https:"), uri.replace(schema, "other"), `${uri}#private`])
    assert.throws(() => validateManagedUri(invalid, schema));
  for (const suffix of ["", "?charset=utf8mb4", "?timezone=Z", "?timezone=%2B08%3A00", "?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D"])
    assert.doesNotThrow(() => validateManagedUri(uri + suffix, schema));
});

test("wrong schema/case or unsupported identity stops after one read, without session or catalog changes", async () => {
  for (const identity of [{ schemaName: "other" }, { schemaName: schema.toUpperCase() }, { schemaName: null }, { version: "5.7.44" },
    { version: "8.0.44-MariaDB" }, { lowerCaseTableNames: 3 }, { sqlMode: null }]) {
    const fake = fixture({ identity }), receipt = await inspectProductionSchema(options, fake.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(receipt.stable, null);
    assert.equal(fake.calls.length, 1); assert.equal(fake.destroyed(), 1);
    assert.equal(receipt.metadata, undefined);
  }
});

test("stable complete capture uses two separate read-only transactions and only scoped fixed queries", async () => {
  const fake = fixture(), receipt = await inspectProductionSchema(options, fake.dependencies);
  assert.equal(receipt.status, "completed"); assert.equal(receipt.stable, true);
  assert.equal(receipt.hashes.first, receipt.hashes.second); assert.match(receipt.hashes.first, /^[a-f0-9]{64}$/);
  assert.deepEqual(fake.observedConfig, [{ uri, multipleStatements: false, connectTimeout: 5000, rowsAsArray: false }]);
  assert.equal(fake.loads(), 1); assert.equal(fake.destroyed(), 1);
  assert.deepEqual(fake.calls.filter(call => !call.sql.startsWith("SELECT")).map(call => call.sql),
    ["SET SESSION TRANSACTION READ ONLY", "SET SESSION MAX_EXECUTION_TIME = 5000", "SET SESSION lock_wait_timeout = 5",
      "START TRANSACTION READ ONLY", "ROLLBACK", "START TRANSACTION READ ONLY", "ROLLBACK"]);
  assert.equal(Object.keys(receipt.metadata).length, 9);
  assert.equal(receipt.ledger.rows.length, 3);
  assert.ok(receipt.ledger.rows.every(value => Object.keys(value).join(",") === "migrationName,checksum,status"));
  assert.equal(JSON.stringify(receipt).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(receipt).includes(uri), false);
  assert.equal(receipt.businessRowsRead, false); assert.equal(receipt.writesPerformed, false);
});

test("metadata and ledger changes are unstable rather than successful", async () => {
  for (const modify of [value => { value.metadata.tables[0].engine = "MyISAM"; }, value => { value.ledger[0].status = "failed"; }]) {
    const first = snapshot(), second = clone(first); modify(second);
    const fake = fixture({ first, second }), receipt = await inspectProductionSchema(options, fake.dependencies);
    assert.equal(receipt.status, "changed"); assert.equal(receipt.stable, false);
    assert.notEqual(receipt.hashes.first, receipt.hashes.second);
    const boundaries = fake.calls.map(call => call.sql).filter(sql => ["START TRANSACTION READ ONLY", "ROLLBACK"].includes(sql));
    assert.deepEqual(boundaries, ["START TRANSACTION READ ONLY", "ROLLBACK", "START TRANSACTION READ ONLY", "ROLLBACK"]);
  }
});

test("missing ledger is recorded absent and never queried or created", async () => {
  const fake = fixture({ first: snapshot({ ledgerPresent: false }) }), receipt = await inspectProductionSchema(options, fake.dependencies);
  assert.equal(receipt.status, "completed"); assert.deepEqual(receipt.ledger, { present: false, rows: [] });
  assert.equal(fake.calls.some(call => call.sql.includes(`\`${schema}\`.\`app_schema_migrations\``)), false);
  assert.equal(fake.calls.some(call => /\b(?:CREATE|INSERT|UPDATE|DELETE|USE)\b/i.test(call.sql)), false);
});

test("ledger view or missing expected columns fails before any ledger read", async () => {
  for (const modify of [value => { value.metadata.tables.find(item => item.tableName === "app_schema_migrations").tableType = "VIEW"; },
    value => { value.metadata.columns = value.metadata.columns.filter(item => item.columnName !== "checksum"); }]) {
    const first = snapshot(); modify(first);
    const fake = fixture({ first }), receipt = await inspectProductionSchema(options, fake.dependencies);
    assert.equal(receipt.status, "failed");
    assert.equal(fake.calls.some(call => call.sql.includes(`\`${schema}\`.\`app_schema_migrations\``)), false);
    assert.equal(fake.calls.at(-1).sql, "ROLLBACK"); assert.equal(fake.destroyed(), 1);
  }
});

test("summary contains only counts, two target table columns, three indexes and two migration records", async () => {
  const fake = fixture(), receipt = await inspectProductionSchema({ ...options, summary: true }, fake.dependencies);
  assert.equal(receipt.summary, true); assert.equal(receipt.metadata, undefined);
  assert.equal(receipt.targetColumns.length, 2); assert.equal(receipt.targetIndexes.length, 3);
  assert.deepEqual(receipt.targetIndexes[0].columns.map(item => [item.columnName, item.sequence, item.prefixLength, item.nonUnique]),
    [["distillationProjectId", 1, null, 0], ["sourceKey", 2, null, 0], ["claim", 3, 191, 0]]);
  assert.equal(receipt.targetIndexes[1].columns[0].nonUnique, 0);
  assert.deepEqual(receipt.targetIndexes[2].columns.map(item => [item.columnName, item.nonUnique]), [["workspaceId", 1], ["systemManaged", 1]]);
  assert.equal(receipt.ledger.rowCount, 3); assert.equal(receipt.ledger.targets.length, 2);
  for (const forbidden of [uri, "synthetic-secret", "privateProductColumn", "unrelated_other.sql"])
    assert.equal(JSON.stringify(receipt).includes(forbidden), false);
});

test("fixed SQL uses exact schema filters and does not select sensitive raw values", () => {
  for (const [name, definition] of Object.entries(METADATA_SELECTS)) {
    assert.match(definition.sql, /^SELECT\s/);
    assert.match(definition.sql, /WHERE BINARY (?:t\.)?(?:TABLE_SCHEMA|CONSTRAINT_SCHEMA|SCHEMA_NAME) = BINARY \?/);
    assert.match(definition.sql, /LIMIT 50001$/);
    assert.doesNotMatch(definition.sql, /SELECT\s+\*|TABLE_COMMENT|COLUMN_COMMENT|INDEX_COMMENT|CARDINALITY|TABLE_ROWS|AUTO_INCREMENT|DATA_LENGTH|INDEX_LENGTH/i);
    if (name === "columns") {
      assert.match(definition.sql, /CASE WHEN DATA_TYPE IN \('enum','set'\) THEN DATA_TYPE ELSE COLUMN_TYPE END AS typeShape/);
      assert.match(definition.sql, /LITERAL_REDACTED/);
    }
    assert.ok(!definition.fields.some(field => /raw|comment|checkClause|columnDefault|generationExpression$|partitionDescription|referencedTableSchema/i.test(field)));
  }
  assert.match(METADATA_SELECTS.keyColumns.sql, /ELSE 'external'/);
  assert.match(METADATA_SELECTS.keyColumns.sql, /THEN REFERENCED_TABLE_NAME ELSE NULL/);
});

test("query failure rolls back and returns code only, no raw SQL/error/URI", async () => {
  const fake = fixture({ failCollection: "columns" }), receipt = await inspectProductionSchema(options, fake.dependencies);
  assert.equal(receipt.status, "failed"); assert.equal(receipt.stable, null);
  assert.deepEqual(receipt.error, { code: "ER_FIXTURE_QUERY" });
  assert.equal(receipt.metadata, undefined); assert.equal(fake.calls.at(-1).sql, "ROLLBACK");
  assert.equal(fake.destroyed(), 1); assert.equal(JSON.stringify(receipt).includes("synthetic-secret"), false);
});

test("bounded result and malformed metadata fail rather than silently truncate", async () => {
  for (const modify of [value => { value.metadata.tables = Array(50001).fill({}); },
    value => { delete value.metadata.tables[0].tableName; }, value => { value.metadata.tables[0].engine = { private: true }; },
    value => { value.metadata.schema = []; }]) {
    const first = snapshot(); modify(first);
    const fake = fixture({ first }), receipt = await inspectProductionSchema(options, fake.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(receipt.metadata, undefined);
    assert.equal(fake.destroyed(), 1);
  }
});

test("real main exit codes distinguish completed, changed, failure and cleanup failure", async () => {
  for (const setup of [{ expected: 0 }, { expected: 2, changed: true }, { expected: 1, failCollection: "indexes" },
    { expected: 1, failDestroy: true }, { expected: 1, failRollback: true }]) {
    const first = snapshot(), second = clone(first); if (setup.changed) second.ledger[0].status = "failed";
    const fake = fixture({ first, second, ...setup });
    let stdout = "", stderr = "";
    const result = await main(args, { dependencies: fake.dependencies,
      stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } });
    assert.equal(result, setup.expected); assert.equal(stderr, "");
    const receipt = JSON.parse(stdout);
    if (setup.failDestroy || setup.failRollback) { assert.equal(receipt.status, "failed"); assert.ok(receipt.cleanupError); }
    assert.equal(stdout.includes("synthetic-secret"), false);
  }
});

test("module import is inert; source has no dotenv/runner/application imports or output-file path", () => {
  const target = new URL("./readProductionSchema.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(target.href)});`],
    { env: { DATABASE_URL: "never-connect-on-import", DOTENV_CONFIG_PATH: "/nonexistent" }, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  const source = fs.readFileSync(target, "utf8");
  assert.doesNotMatch(source, /(?:import|from)\s*\(?\s*["'](?:dotenv|.*run-database-migrations|.*dbClient|.*routerContext)/);
  assert.doesNotMatch(source, /writeFile|ensureLedger|applyMigrations|baselineExistingSchema/);
});
