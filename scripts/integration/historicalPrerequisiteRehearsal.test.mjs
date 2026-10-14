// Pure / mocked prerequisite-rehearsal contracts. No database, native MySQL
// executable, network request, migration runner or filesystem write is used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SOURCE_PINS, ORIGINAL_COLUMNS, ADDED_COLUMNS, PREREQUISITE_SQL, PREREQUISITE_SHA256, validateSources,
  initializePrerequisite, canonical, validateLedger, readSnapshot, compareSnapshots,
  validateDump, main,
} from "./historicalPrerequisiteRehearsal.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const schema = "amazon_rehearsal_0123456789abcdef_synthetic";
const hash = value => createHash("sha256").update(value).digest("hex");
const code = expected => error => error.code === expected;
const clone = value => structuredClone(value);
const plan = [
  { fileName: "0001_fixture.sql", checksum: hash("first") },
  { fileName: "0180_fixture.sql", checksum: hash("second") },
];
const ledger = () => plan.map(item => ({ migrationName: item.fileName, checksum: item.checksum,
  status: "succeeded", executionId: "local-only", startedAt: "2026-10-14 01:00:00",
  finishedAt: "2026-10-14 01:00:01", error: null }));
const tables = ["app_schema_migrations", "emperor_scheduled_tasks"];
const dump = Buffer.from(tables.map(name => `CREATE TABLE \`${name}\` (\n  \`id\` int NOT NULL\n);`).join("\n")
  + "\nINSERT INTO `emperor_scheduled_tasks` VALUES (1);\n");

function sourceIo(overrides = {}) {
  return {
    lstatSync: fs.lstatSync,
    realpathSync: fs.realpathSync,
    readFileSync: fs.readFileSync,
    ...overrides,
  };
}

function initializer({ current = schema, present = [] } = {}) {
  const queries = [];
  return { queries, connection: { async query(sql) {
    queries.push(sql);
    if (sql === "SELECT DATABASE() AS schemaName") return [[{ schemaName: current }]];
    if (sql.startsWith("SELECT table_name AS tableName")) return [present];
    assert.equal(sql, PREREQUISITE_SQL);
    return [[]];
  } } };
}

function columnFixture() {
  return [
    { columnName: "id", columnType: "int", isNullable: "NO", columnDefault: null, ordinalPosition: 1,
      characterSetName: null, collationName: null, extra: "", generationExpression: "", columnComment: "" },
    { columnName: "note", columnType: "varchar(255)", isNullable: "YES", columnDefault: null, ordinalPosition: 2,
      characterSetName: "utf8mb4", collationName: "utf8mb4_bin", extra: "", generationExpression: "", columnComment: "" },
  ];
}

function snapshotConnection({ names = tables.map(tableName => ({ tableName, tableType: "BASE TABLE" })),
  rows = [{ id: 2, note: "中文 😀", settings: { z: 1, a: null } }, { id: 1, note: null }],
  migrations = ledger(), columns = columnFixture(), explicitCharacterSet = false } = {}) {
  const queries = [], catalogQueries = [];
  return { queries, catalogQueries, connection: { async query(sql, values) {
    queries.push(sql);
    if (sql.startsWith("SELECT table_name AS tableName,table_type")) return [names];
    const create = sql.match(/^SHOW CREATE TABLE `([A-Za-z_][A-Za-z0-9_]*)`$/);
    if (create) return [[{ "Create Table": `CREATE TABLE \`${create[1]}\` (\n  \`id\` int NOT NULL,\n  \`note\` varchar(255)${explicitCharacterSet ? " CHARACTER SET utf8mb4" : ""} COLLATE utf8mb4_bin DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin` }]];
    if (sql.includes("FROM information_schema.columns")) {
      assert.match(sql, /WHERE table_schema=DATABASE\(\) AND table_name=\? ORDER BY ordinal_position$/);
      assert.equal(values.length, 1); assert.ok(tables.includes(values[0]));
      for (const alias of Object.keys(columnFixture()[0])) assert.match(sql, new RegExp(`\\bAS ${alias}\\b`));
      catalogQueries.push({ sql, values });
      return [columns];
    }
    const select = sql.match(/^SELECT \* FROM `([A-Za-z_][A-Za-z0-9_]*)` LIMIT 10001$/);
    if (select) return [select[1] === "app_schema_migrations" ? migrations : rows];
    if (sql === "SELECT * FROM app_schema_migrations ORDER BY migrationName") return [migrations];
    assert.fail(`Unexpected mocked query: ${sql}`);
  } } };
}

test("import is inert even when an inherited production-like DB target is forbidden", () => {
  const url = new URL("./historicalPrerequisiteRehearsal.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)}); console.log('IMPORT_SAFE')`],
    { encoding: "utf8", env: { PATH: "/usr/bin:/bin", DATABASE_URL: "must-not-read-or-connect" }, timeout: 10_000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, "IMPORT_SAFE\n"); assert.equal(result.stderr, "");
});

test("fixed prerequisite has exactly 15 original columns and none of the eight later columns", () => {
  assert.ok(Object.isFrozen(ORIGINAL_COLUMNS)); assert.ok(Object.isFrozen(ADDED_COLUMNS)); assert.ok(Object.isFrozen(SOURCE_PINS));
  assert.equal(ORIGINAL_COLUMNS.length, 15); assert.equal(ADDED_COLUMNS.length, 8);
  assert.deepEqual([...PREREQUISITE_SQL.matchAll(/^ {2}`([A-Za-z_][A-Za-z0-9_]*)` /gm)].map(match => match[1]), ORIGINAL_COLUMNS);
  for (const added of ADDED_COLUMNS) assert.equal(PREREQUISITE_SQL.includes(`\`${added}\``), false);
  assert.match(PREREQUISITE_SQL, /UNIQUE KEY `emperor_scheduled_tasks_slug_unique` \(`slug`\)/);
  assert.match(PREREQUISITE_SQL, /COLLATE=utf8mb4_bin/);
  assert.equal(hash(PREREQUISITE_SQL), PREREQUISITE_SHA256);
  assert.doesNotMatch(PREREQUISITE_SQL, /\b(?:INSERT|DROP|USE|DATABASE|IF NOT EXISTS)\b|app_schema_migrations|(?:^|;)\s*UPDATE\b/);
});

test("source pins validate current read-only sources and state limited provenance", () => {
  const result = validateSources();
  assert.deepEqual(result.sourcePins, SOURCE_PINS); assert.equal(result.fixtureSha256, hash(PREREQUISITE_SQL));
  assert.equal(result.provenance, "current_source_minus_0180_columns_not_recovered_historical_ddl");
});

test("source pin drift, symlink, non-file, oversized and noncanonical sources are refused", () => {
  for (const relative of Object.keys(SOURCE_PINS)) {
    const target = path.join(repo, relative);
    assert.throws(() => validateSources(sourceIo({ readFileSync: filename => filename === target ? Buffer.from("drift") : fs.readFileSync(filename) })), code("PREREQUISITE_SOURCE_DRIFT"));
    assert.throws(() => validateSources(sourceIo({ realpathSync: filename => filename === target ? `${target}.other` : filename })), code("PREREQUISITE_SOURCE_DRIFT"));
    for (const override of [{ isSymbolicLink: () => true }, { isFile: () => false }, { size: 256 * 1024 }]) {
      assert.throws(() => validateSources(sourceIo({ lstatSync: filename => filename === target
        ? { isFile: () => true, isSymbolicLink: () => false, size: 1, ...override } : fs.lstatSync(filename) })), code("PREREQUISITE_SOURCE_DRIFT"));
    }
  }
});

test("initialization creates only the fixed prerequisite in an empty matching isolated schema", async () => {
  const mock = initializer();
  await initializePrerequisite(mock.connection, schema);
  assert.equal(mock.queries.length, 3); assert.equal(mock.queries.at(-1), PREREQUISITE_SQL);
});

test("initialization rejects non-isolated, mismatched and nonempty schemas before writing", async () => {
  for (const name of ["amz_listing", "mysql", schema.replace("synthetic", "general"), `${schema};DROP TABLE x`, schema.toUpperCase()]) {
    const mock = initializer();
    await assert.rejects(initializePrerequisite(mock.connection, name), code("NON_REHEARSAL_SCHEMA_FORBIDDEN"));
    assert.equal(mock.queries.length, 0);
  }
  const mismatch = initializer({ current: "amz_listing" });
  await assert.rejects(initializePrerequisite(mismatch.connection, schema), code("CURRENT_SCHEMA_MISMATCH"));
  assert.equal(mismatch.queries.length, 1);
  const nonempty = initializer({ present: [{ tableName: "existing" }] });
  await assert.rejects(initializePrerequisite(nonempty.connection, schema), code("PREREQUISITE_REQUIRES_EMPTY_SCHEMA"));
  assert.equal(nonempty.queries.length, 2); assert.equal(nonempty.queries.includes(PREREQUISITE_SQL), false);
});

test("ledger succeeds only for exact succeeded names and checksums, regardless of row order", () => {
  assert.deepEqual(validateLedger(ledger().reverse(), plan), { succeeded: 2, baselined: 0, exactNamesAndChecksums: true });
});

test("ledger rejects missing, duplicate, additional and substituted migrations", () => {
  const rows = ledger();
  for (const bad of [rows.slice(1), [rows[0], rows[0]], [...rows, { ...rows[0], migrationName: "extra.sql" }]]) {
    assert.throws(() => validateLedger(bad, plan), code("GENERAL_LEDGER_COUNT_OR_UNIQUENESS_MISMATCH"));
  }
  assert.throws(() => validateLedger([rows[0], { ...rows[1], migrationName: "extra.sql" }], plan), code("GENERAL_LEDGER_NOT_EXACT_SUCCEEDED"));
});

test("ledger rejects checksum drift and every nonsucceeded status, including baselined", () => {
  for (const change of [{ checksum: hash("changed") }, ...["baselined", "failed", "started", "running", "SUCCEEDED", null, undefined].map(status => ({ status }))]) {
    const rows = ledger(); Object.assign(rows[1], change);
    assert.throws(() => validateLedger(rows, plan), code("GENERAL_LEDGER_NOT_EXACT_SUCCEEDED"));
  }
});

test("canonical representation sorts object keys but preserves arrays, duplicate rows, dates, buffers and nulls", () => {
  const value = { z: [null, { b: Buffer.from([0, 255]), a: new Date("2026-10-14T01:02:03.000Z") }, 1, 1], a: "中文 😀" };
  assert.deepEqual(canonical(value), { a: "中文 😀", z: [null, { a: "2026-10-14T01:02:03.000Z", b: { bytesHex: "00ff" } }, 1, 1] });
  assert.deepEqual(Object.keys(value), ["z", "a"]);
});

test("snapshot digests are row-order independent while preserving duplicate rows and content", async () => {
  const rows = [{ id: 1, note: "two  spaces" }, { id: 1, note: "two  spaces" }, { id: 2, note: null }];
  const before = await readSnapshot(snapshotConnection({ rows }).connection);
  const reordered = await readSnapshot(snapshotConnection({ rows: rows.toReversed() }).connection);
  assert.deepEqual(reordered, before);
  assert.equal(before.data.emperor_scheduled_tasks.rows, 3); assert.equal(before.tableCount, 2);
  assert.equal(before.rowCount, 5);
  for (const changed of [rows.slice(1), [...rows, rows[0]], rows.map(row => ({ ...row, note: row.note?.trim().replace("  ", " ") ?? null }))]) {
    assert.notEqual((await readSnapshot(snapshotConnection({ rows: changed }).connection)).data.emperor_scheduled_tasks.sha256,
      before.data.emperor_scheduled_tasks.sha256);
  }
});

test("snapshot retains every column catalog field and accepts only redundant charset DDL rendering differences", async () => {
  const beforeMock = snapshotConnection(), afterMock = snapshotConnection({ explicitCharacterSet: true });
  const before = await readSnapshot(beforeMock.connection), after = await readSnapshot(afterMock.connection);
  assert.deepEqual(before.columnMetadata, Object.fromEntries(tables.map(name => [name, canonical(columnFixture())])));
  assert.deepEqual(beforeMock.catalogQueries.map(query => query.values), tables.map(name => [name]));
  assert.deepEqual(after, before);
  assert.equal(compareSnapshots(before, after).columnMetadataEqual, true);
});

test("snapshot refuses missing or unbounded column catalogs before reading table rows", async () => {
  for (const columns of [[], Array(501).fill(columnFixture()[0])]) {
    const mock = snapshotConnection({ columns });
    await assert.rejects(readSnapshot(mock.connection), code("SNAPSHOT_COLUMN_SCOPE_INVALID"));
    assert.equal(mock.queries.some(sql => /^SELECT \* FROM `/.test(sql)), false);
  }
});

test("snapshot refuses empty, oversized, unsafe and non-base-table scopes and excess rows", async () => {
  for (const names of [[], Array.from({ length: 401 }, (_, i) => ({ tableName: `t${i}`, tableType: "BASE TABLE" })),
    [{ tableName: "unsafe`name", tableType: "BASE TABLE" }], [{ tableName: "valid", tableType: "VIEW" }]]) {
    const mock = snapshotConnection({ names });
    await assert.rejects(readSnapshot(mock.connection), code("SNAPSHOT_TABLE_SCOPE_INVALID"));
    assert.equal(mock.queries.length, 1);
  }
  await assert.rejects(readSnapshot(snapshotConnection({ rows: Array(10001).fill({ id: 1 }) }).connection), code("SNAPSHOT_ROW_BOUND_EXCEEDED"));
});

test("snapshot comparison checks every DDL, data digest, count and full ledger field", async () => {
  const before = await readSnapshot(snapshotConnection().connection);
  const result = compareSnapshots(before, clone(before));
  assert.equal(result.structureSha256, hash(JSON.stringify(before.structure)));
  assert.equal(result.dataSha256, hash(JSON.stringify(before.data)));
  assert.equal(result.columnMetadataSha256, hash(JSON.stringify(before.columnMetadata)));
  assert.equal(result.fullLedgerSha256, hash(JSON.stringify(before.ledger)));
  assert.equal(result.tableCount, 2); assert.equal(result.rowCount, 4); assert.equal(result.ledgerCount, 2);
  assert.equal(result.structureEqual && result.columnMetadataEqual && result.allRowsEqual && result.fullLedgerEqual, true);
  const changes = [after => after.structure.emperor_scheduled_tasks += " ROW_FORMAT=DYNAMIC",
    after => delete after.structure.emperor_scheduled_tasks,
    after => after.data.emperor_scheduled_tasks.sha256 = hash("other"),
    after => after.data.emperor_scheduled_tasks.rows++, after => after.tableCount++, after => after.rowCount++,
    after => delete after.columnMetadata.emperor_scheduled_tasks,
    after => after.columnMetadata.emperor_scheduled_tasks.pop(),
    ...Object.keys(before.ledger[0]).map(field => after => after.ledger[0][field] = "changed")];
  for (const change of changes) { const after = clone(before); change(after); assert.throws(() => compareSnapshots(before, after)); }
  assert.doesNotMatch(JSON.stringify(result), /local-only|migrationName|中文/);
});

test("catalog type, nullability, default, charset, collation, order and all extra metadata drift is never normalized away", async () => {
  const before = await readSnapshot(snapshotConnection().connection);
  const changes = [
    { columnName: "renamed" }, { columnType: "varchar(512)" }, { isNullable: "NO" }, { columnDefault: "" },
    { ordinalPosition: 3 }, { characterSetName: "latin1" }, { collationName: "utf8mb4_0900_ai_ci" },
    { extra: "DEFAULT_GENERATED" }, { generationExpression: "lower(`id`)" }, { columnComment: "changed" },
  ];
  for (const patch of changes) {
    const after = clone(before); Object.assign(after.columnMetadata.emperor_scheduled_tasks[1], patch);
    assert.deepEqual(after.structure, before.structure, "Unchanged normalized DDL cannot hide catalog drift");
    assert.deepEqual(after.data, before.data); assert.deepEqual(after.ledger, before.ledger);
    assert.throws(() => compareSnapshots(before, after));
  }
  const reordered = clone(before); reordered.columnMetadata.emperor_scheduled_tasks.reverse();
  assert.throws(() => compareSnapshots(before, reordered));
});

test("dump validation matches the exact table set and allows literal/comment operation words", () => {
  const bytes = Buffer.concat([dump, Buffer.from("\n-- DROP DATABASE harmless_comment;\nINSERT INTO `emperor_scheduled_tasks` VALUES ('USE other; DROP DATABASE x; 中文 😀');\n")]);
  assert.deepEqual(validateDump(bytes, tables.toReversed()), { bytes: bytes.length, sha256: hash(bytes), tableCount: 2 });
  for (const names of [tables.slice(1), [...tables, "extra"], [tables[0], tables[0]], []]) assert.throws(() => validateDump(dump, names));
  assert.throws(() => validateDump(Buffer.concat([dump, Buffer.from("CREATE TABLE `extra` (id int);\n")]), tables));
  assert.throws(() => validateDump(Buffer.concat([dump, Buffer.from("CREATE TABLE `emperor_scheduled_tasks` (id int);\n")]), tables));
});

test("dump validation rejects destructive, instance-level and executable-comment statements", () => {
  for (const sql of ["DROP TABLE x;", "/*!40000 DROP TABLE x */;", "CREATE DATABASE other;", "ALTER SCHEMA other DEFAULT CHARACTER SET utf8mb4;",
    "USE other;", "GRANT ALL ON *.* TO x;", "REVOKE ALL ON *.* FROM x;", "SET @@GLOBAL.read_only=0;", "SET GLOBAL read_only=0;",
    "LOAD DATA LOCAL INFILE 'x' INTO TABLE y;", "SELECT 1 INTO OUTFILE '/tmp/x';", "SELECT 1 INTO DUMPFILE '/tmp/x';",
    "CREATE USER x;", "CREATE EVENT e ON SCHEDULE EVERY 1 DAY DO SELECT 1;", "CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET @a=1;",
    "CREATE PROCEDURE p() SELECT 1;", "CREATE FUNCTION f() RETURNS INT RETURN 1;", "INSTALL PLUGIN x SONAME 'y';", "SHUTDOWN;"]) {
    assert.throws(() => validateDump(Buffer.concat([dump, Buffer.from(`\n${sql}\n`)]), tables), code("UNSAFE_DUMP_OPERATION"), sql);
  }
});

test("dump validation rejects MySQL client commands and qualified cross-schema writes", () => {
  for (const sql of ["\\. /tmp/x", "\\! arbitrary", "source /tmp/x", "system arbitrary", "connect other", "delimiter $$"]) {
    assert.throws(() => validateDump(Buffer.concat([dump, Buffer.from(`\n${sql}\n`)]), tables), code("MYSQL_CLIENT_COMMAND_FORBIDDEN"), sql);
  }
  for (const sql of ["INSERT INTO other.x VALUES (1);", "INSERT INTO `other`.`x` VALUES (1);",
    "INSERT INTO `other`.x VALUES (1);", "INSERT INTO other.`x` VALUES (1);",
    "CREATE TABLE `other`.`x` (id int);", "ALTER TABLE `other`.`x` DISABLE KEYS;", "LOCK TABLES `other`.`x` WRITE;"]) {
    assert.throws(() => validateDump(Buffer.concat([dump, Buffer.from(`\n${sql}\n`)]), tables), undefined, sql);
  }
});

test("dump validation refuses empty, nonbuffer, oversized and invalid UTF-8 input", () => {
  for (const bytes of [Buffer.alloc(0), "CREATE TABLE x (id int)", Buffer.alloc(32 * 1024 * 1024 + 1)]) {
    assert.throws(() => validateDump(bytes, tables), code("DUMP_SIZE_INVALID"));
  }
  assert.throws(() => validateDump(Buffer.from([0xff]), tables));
});

test("CLI main refuses absent explicit local execution before loading or writing anything", async () => {
  let loaded = false, written = false, output = "", error = "";
  const dependencies = { environment: {}, argv: [], load: async () => { loaded = true; assert.fail("must not load dependencies"); },
    io: { writeFileSync: () => { written = true; assert.fail("must not write"); } } };
  const localPaths = ["--root", "/private/tmp/amazon-mysql8-rehearsal.test", "--socket", "/private/tmp/amazon-mysql8-rehearsal.test/mysql.sock",
    "--datadir", "/private/tmp/amazon-mysql8-rehearsal.test/data", "--bindir", "/private/tmp/amazon-mysql8-rehearsal.test/mysql/bin",
    "--output", path.join(repo, "artifacts/prerequisite-test.json")];
  for (const args of [[], localPaths, ["--execute-local"], [...localPaths, "--host", "production"]]) {
    output = ""; error = "";
    assert.equal(await main(args, { dependencies, stdout: { write: value => { output += value; } }, stderr: { write: value => { error += value; } } }), 1);
    assert.equal(output, ""); assert.equal(JSON.parse(error).status, "refused_or_failed");
    assert.match(JSON.parse(error).error.code, /^(?:EXPLICIT_LOCAL_ARGUMENTS_REQUIRED|INVALID_ARGUMENTS)$/);
  }
  assert.equal(loaded, false); assert.equal(written, false);
});
