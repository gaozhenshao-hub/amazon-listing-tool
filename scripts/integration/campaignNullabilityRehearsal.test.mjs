// Public synthetic metadata + connector/native mocks; no real database access.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DDL_CATALOG } from "./exportProductionDdl.mjs";
import { TABLE_NAME, COLUMN_CONTRACTS, CANDIDATE_SQL, planCampaignNullability } from "./campaignNullabilityContract.mjs";
import { mapCatalogSchema, compareStructure, LOCAL_TABLE_DISCOVERY_SQL } from "./productionStructureRehearsal.mjs";
import { parseArguments, validateCompletedStructureReceipt, loadCompletedStructureReceipt, verifyForwardStructure,
  validateCanaryContract, runRollbackCanaries, runCampaignNullabilityRehearsal, main } from "./campaignNullabilityRehearsal.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const jsonHash = value => hash(JSON.stringify(value));
const clone = value => structuredClone(value);
const policy = { scope: "isolated-local-only", defaultPolicy: "align-null-default" };
const code = expected => error => error.code === expected;
const schema = n => `amazon_rehearsal_${String(n).repeat(16)}_synthetic`;
const sourceSchema = "amz_listing", privateLiteral = "synthetic-sensitive-comment";
const root = "/tmp/amazon-mysql8-rehearsal.forward-test";
const server = { version: "8.0.46-0ubuntu0.24.04.4", lowerCaseTableNames: 0, sqlMode: "STRICT_TRANS_TABLES", quoteShowCreate: 1 };
const platform = { platform: "linux", architecture: "arm64", distribution: "ubuntu", distributionVersion: "24.04" };
const row = (collection, values) => ({ ...Object.fromEntries(DDL_CATALOG[collection].fields.map(field => [field, null])), ...values });
const names = ["workspaceId", "id", "user_id", "profile_id", "source_store_id", "country", "report_date", "ad_type", "campaign_id",
  "campaign_name", "campaign_status", "bidding_strategy", "budget", "currency", "impressions", "clicks", "spend", "sales", "orders",
  "source_batch_id", "source_row_hash", "source_payload_hash", "version", "created_at", "updated_at"];
const types = ["int", "int", "int", "varchar(64)", "varchar(64)", "varchar(16)", "varchar(10)", "varchar(12)", "varchar(80)",
  "varchar(500)", "varchar(64)", "varchar(100)", "decimal(14,2)", "varchar(12)", "bigint", "bigint", "decimal(14,2)", "decimal(14,2)",
  "int", "int", "varchar(64)", "varchar(64)", "int", "timestamp", "timestamp"];

function fixture() {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(name => [name, []]));
  catalog.schema = [row("schema", { schemaName: sourceSchema, characterSetName: "utf8mb4", collationName: "utf8mb4_bin", defaultEncryption: "NO" })];
  catalog.tables = [TABLE_NAME, "unrelated"].map(tableName => row("tables", { tableName, tableType: "BASE TABLE", engine: "InnoDB",
    version: 10, rowFormat: "Dynamic", autoIncrement: tableName === TABLE_NAME ? "42" : null,
    collationName: "utf8mb4_bin", createOptions: "", tableComment: privateLiteral }));
  catalog.columns = names.map((columnName, index) => {
    const metric = COLUMN_CONTRACTS.find(value => value.name === columnName), columnType = types[index], dataType = columnType.replace(/\(.*/, "");
    const length = dataType === "varchar" ? Number(columnType.match(/\d+/)[0]) : null;
    return row("columns", { tableName: TABLE_NAME, columnName, ordinalPosition: index + 1,
      columnDefault: metric?.defaultValue ?? null, isNullable: metric || columnName === "id" ? "NO" : "YES", dataType, columnType,
      characterMaximumLength: length, characterOctetLength: length === null ? null : length * 4,
      characterSetName: length === null ? null : "utf8mb4", collationName: length === null ? null : "utf8mb4_bin",
      numericPrecision: dataType === "bigint" ? "19" : dataType === "int" ? "10" : dataType === "decimal" ? "14" : null,
      numericScale: dataType === "decimal" ? "2" : ["int", "bigint"].includes(dataType) ? "0" : null,
      datetimePrecision: dataType === "timestamp" ? 0 : null, columnKey: columnName === "id" ? "PRI" : "",
      extra: columnName === "id" ? "auto_increment" : "", columnComment: "", generationExpression: "" });
  });
  catalog.columns.push(row("columns", { tableName: "unrelated", columnName: "note", ordinalPosition: 1, columnDefault: privateLiteral,
    isNullable: "YES", dataType: "varchar", columnType: "varchar(50)", characterMaximumLength: 50, characterOctetLength: 200,
    characterSetName: "utf8mb4", collationName: "utf8mb4_bin", extra: "", columnComment: "", generationExpression: "", columnKey: "" }));
  catalog.indexes = [row("indexes", { tableName: TABLE_NAME, indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id",
    direction: "A", nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES" })];
  catalog.constraints = [row("constraints", { tableName: TABLE_NAME, constraintName: "PRIMARY", constraintType: "PRIMARY KEY", enforced: "YES" })];
  catalog.keyColumns = [row("keyColumns", { tableName: TABLE_NAME, constraintName: "PRIMARY", columnName: "id", ordinalPosition: 1 })];
  const clauses = catalog.columns.filter(column => column.tableName === TABLE_NAME).map(column => {
    const metric = COLUMN_CONTRACTS.find(value => value.name === column.columnName);
    return `  \`${column.columnName}\` ${column.columnType}${column.columnName === "id" ? " NOT NULL AUTO_INCREMENT"
      : metric ? ` NOT NULL DEFAULT '${metric.defaultValue}'` : " DEFAULT NULL"},`;
  });
  const ddls = [`CREATE TABLE \`${TABLE_NAME}\` (\n${clauses.join("\n")}\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`unrelated\` (\n  \`note\` varchar(50) DEFAULT '${privateLiteral}'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`];
  return { formatVersion: 1, kind: "private-schema-only-not-auto-replayable", schema: sourceSchema, server: clone(server), catalog,
    tables: ddls.map((ddl, index) => ({ tableName: catalog.tables[index].tableName, ddl, sha256: hash(ddl) })) };
}

function local(artifact, name, altered = false) {
  const snapshot = { schema: name, catalog: mapCatalogSchema(artifact.catalog, artifact.schema, name), tables: clone(artifact.tables), zeroRowTables: artifact.tables.length };
  if (altered) {
    for (const column of snapshot.catalog.columns) if (column.tableName === TABLE_NAME && COLUMN_CONTRACTS.some(metric => metric.name === column.columnName)) {
      column.isNullable = "YES"; column.columnDefault = null;
    }
    for (const metric of COLUMN_CONTRACTS) snapshot.tables[0].ddl = snapshot.tables[0].ddl.replace(
      `  \`${metric.name}\` ${metric.columnType} NOT NULL DEFAULT '${metric.defaultValue}',`, `  \`${metric.name}\` ${metric.columnType} DEFAULT NULL,`);
    snapshot.tables[0].sha256 = hash(snapshot.tables[0].ddl);
  }
  return snapshot;
}

function completed(artifact, options, source = schema(1), restored = schema(2)) {
  return { formatVersion: 1, mode: "private-production-structure-only-linux-rehearsal", status: "completed", caseSensitiveLinuxValidated: true,
    productionWrites: false, productionBusinessRowsRead: false, businessRowsCopied: false, migrationsExecuted: false, migrationLedgerSeeded: false,
    productionBackupRecoveryValidated: false, artifactSha256: options.artifactSha256, exportReceiptSha256: options.receiptSha256,
    sourceServer: clone(artifact.server), platform: clone(platform), localServer: { version: server.version, networkingDisabled: true,
      lowerCaseTableNames: 0, mysqlxDisabled: true, eventScheduler: "OFF" }, schemas: { source, restored }, schemasCreated: [source, restored],
    clone: compareStructure(artifact, local(artifact, source)), restoration: compareStructure(artifact, local(artifact, restored)),
    sourceUnchanged: compareStructure(artifact, local(artifact, source)), createdTableCount: 2,
    dump: { status: "validated", schemaOnly: true, tableCount: 2, sha256: hash("synthetic dump"), bytes: 123 } };
}

function inputs() {
  const artifact = fixture(), directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amazon-forward-test.")));
  fs.chmodSync(directory, 0o700);
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact)}\n`), artifactSha256 = hash(artifactBytes);
  const snapshot = { schema: artifact.schema, server: artifact.server, catalog: artifact.catalog, tables: artifact.tables };
  const exportReceipt = { formatVersion: 1, mode: "private-read-only-production-ddl", status: "completed", stable: true,
    expectedSchema: sourceSchema, businessRowsRead: false, databaseWrites: false, replayPerformed: false, filesWritten: true,
    server: clone(server), counts: Object.fromEntries(Object.entries(artifact.catalog).map(([name, rows]) => [name, rows.length])),
    hashes: { first: jsonHash(snapshot), second: jsonHash(snapshot) }, captureSha256: jsonHash(artifact), artifactFileSha256: artifactSha256 };
  const exportBytes = Buffer.from(`${JSON.stringify(exportReceipt)}\n`);
  fs.writeFileSync(path.join(directory, "production-ddl.json"), artifactBytes, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(directory, "export-receipt.json"), exportBytes, { mode: 0o600, flag: "wx" });
  const options = { executeLocal: true, linuxIsolatedVm: true, forwardCampaignNullDefault: true, root, socket: `${root}/mysql.sock`, datadir: `${root}/data`,
    bindir: "/usr/bin", output: fileURLToPath(new URL("../../artifacts/campaign-forward-pure-test.json", import.meta.url)), expectedTables: 2,
    artifactDirectory: directory, artifactSha256, receiptSha256: hash(exportBytes), candidateSha256: hash(CANDIDATE_SQL), structureReceipt: path.join(directory, "structure.json") };
  const prerequisite = completed(artifact, options), receiptBytes = Buffer.from(`${JSON.stringify(prerequisite)}\n`);
  fs.writeFileSync(options.structureReceipt, receiptBytes, { mode: 0o600, flag: "wx" }); options.structureReceiptSha256 = hash(receiptBytes);
  return { artifact, options, prerequisite };
}

const argumentNames = ["root", "socket", "datadir", "bindir", "output", "expected-tables", "artifact-directory", "artifact-sha256", "receipt-sha256",
  "structure-receipt", "structure-receipt-sha256", "candidate-sha256"];
function args(options) { return ["--execute-local", "--linux-isolated-vm", "--forward-campaign-null-default",
  ...argumentNames.flatMap(name => [`--${name}`, String(options[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())])])]; }

test("import is inert even with production-looking environment; default composition uses structure and Linux helpers", () => {
  const url = new URL("./campaignNullabilityRehearsal.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url.href)}); console.log('INERT')`],
    { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", DATABASE_URL: "must-not-use" } });
  assert.equal(result.status, 0); assert.equal(result.stdout, "INERT\n"); assert.equal(result.stderr, "");
  const source = fs.readFileSync(url, "utf8");
  assert.match(source, /baseline = runStructureRehearsal/); assert.match(source, /native = runLinuxNative/);
  assert.doesNotMatch(source, /dotenv|migrate\.ts|DELETE FROM|COMMIT|DROP DATABASE|ALTER TABLE.*AUTO_INCREMENT/);
});

test("CLI requires the independent forward flag, both receipt pins and the candidate hash, and forbids DB/URI options", () => {
  const { options } = inputs(), all = args(options); assert.deepEqual(parseArguments(all), options);
  for (const invalid of [[], all.filter(value => value !== "--forward-campaign-null-default"), [...all, "--forward-campaign-null-default"],
    ...["--structure-receipt", "--structure-receipt-sha256", "--candidate-sha256"].map(flag => { const copy = [...all]; copy.splice(copy.indexOf(flag), 2); return copy; }),
    [...all, "--database", schema(3)], [...all, "--uri", "mysql://x"], [...all, "--candidate-sha256", hash("x")]]) assert.throws(() => parseArguments(invalid));
});

test("completed prerequisite is pinned to the exact artifact and full structure recovery evidence, not a success label", () => {
  const { artifact, options, prerequisite } = inputs(); assert.equal(validateCompletedStructureReceipt(prerequisite, options, artifact), prerequisite);
  for (const mutate of [r => r.status = "failed", r => r.caseSensitiveLinuxValidated = false, r => r.productionWrites = true,
    r => r.migrationLedgerSeeded = true, r => r.migrationsExecuted = true, r => r.businessRowsCopied = true, r => r.deadlineExceeded = true,
    r => r.artifactSha256 = hash("other"), r => r.exportReceiptSha256 = hash("other"), r => r.localServer.mysqlxDisabled = false,
    r => r.localServer.version = "8.4.11", r => r.platform.architecture = "x64", r => r.schemas.source = sourceSchema,
    r => r.schemas.restored = r.schemas.source, r => r.schemasCreated.pop(), r => r.clone.businessRows = 1,
    r => r.restoration.catalogEqual = false, r => r.sourceUnchanged.catalogSha256 = hash("other"), r => r.clone.normalizedDdlSha256 = hash("other"),
    r => r.dump.schemaOnly = false, r => r.dump.status = "writing", r => r.createdTableCount--]) {
    const invalid = clone(prerequisite); mutate(invalid); assert.throws(() => validateCompletedStructureReceipt(invalid, options, artifact));
  }
});

test("receipt input requires canonical owned 0600 regular file and exact bytes", () => {
  const { artifact, options } = inputs(); assert.equal(loadCompletedStructureReceipt(options, artifact).status, "completed");
  assert.throws(() => loadCompletedStructureReceipt({ ...options, structureReceiptSha256: hash("wrong") }, artifact), code("STRUCTURE_RECEIPT_HASH_MISMATCH"));
  fs.chmodSync(options.structureReceipt, 0o644); assert.throws(() => loadCompletedStructureReceipt(options, artifact), code("STRUCTURE_RECEIPT_FILE_INVALID"));
  const link = path.join(options.artifactDirectory, "link.json"); fs.symlinkSync(options.structureReceipt, link);
  assert.throws(() => loadCompletedStructureReceipt({ ...options, structureReceipt: link }, artifact), code("STRUCTURE_RECEIPT_PATH_INVALID"));
});

test("only ten catalog-field changes and the corresponding five target DDL clauses are accepted", () => {
  const artifact = fixture(), before = local(artifact, schema(3)), after = local(artifact, schema(3), true), candidate = planCampaignNullability(before.catalog, policy);
  const result = verifyForwardStructure(before, after, candidate); assert.equal(result.changedColumns, 5); assert.equal(result.nonTargetDdlUnchanged, true);
  for (const mutate of [r => r.schema = schema(4), r => r.catalog.tables[0].autoIncrement = "43", r => r.catalog.columns[0].columnComment = "changed",
    r => r.tables[1].ddl += " ROW_FORMAT=COMPACT", r => r.tables[0].ddl += " ROW_FORMAT=COMPACT", r => r.tables.reverse(),
    r => r.tables[0].ddl = r.tables[0].ddl.replace("DEFAULT NULL", "DEFAULT '0'"), r => r.zeroRowTables--]) {
    const invalid = clone(after); mutate(invalid); assert.throws(() => verifyForwardStructure(before, invalid, candidate));
  }
  const invalid = clone(before); invalid.tables[0].ddl = invalid.tables[0].ddl.replace("`impressions` bigint NOT NULL DEFAULT '0'", "`impressions` bigint NOT NULL DEFAULT 0");
  assert.throws(() => verifyForwardStructure(invalid, after, candidate), code("FORWARD_TARGET_DDL_SOURCE_UNREVIEWED"));
});

test("canary refuses unsigned/other ID types, composite keys, extra columns, dependencies and generated columns", () => {
  const catalog = local(fixture(), schema(3), true).catalog; assert.deepEqual(validateCanaryContract(catalog).signedExplicitNegativeIds, [-1, -2]);
  const field = (c, name) => c.columns.find(column => column.tableName === TABLE_NAME && column.columnName === name);
  for (const mutate of [c => field(c, "id").columnType = "int unsigned", c => field(c, "id").columnType = "bigint",
    c => field(c, "id").extra = "", c => field(c, "id").columnKey = "", c => field(c, "profile_id").generationExpression = "id + 1",
    c => field(c, "profile_id").extra = "STORED GENERATED", c => c.columns.push({ ...field(c, "id"), columnName: "extra", ordinalPosition: 26 }),
    c => c.keyColumns.push({ ...c.keyColumns[0], columnName: "workspaceId", ordinalPosition: 2 }),
    c => c.foreignKeys.push(row("foreignKeys", { tableName: TABLE_NAME, referencedTableName: "unrelated" })),
    c => c.foreignKeys.push(row("foreignKeys", { tableName: "unrelated", referencedTableName: TABLE_NAME })),
    c => c.keyColumns[0].referencedTableName = "unrelated", c => c.triggers.push(row("triggers", { tableName: TABLE_NAME, triggerName: "bad" })),
    c => c.checks.push(row("checks", { tableName: TABLE_NAME, constraintName: "bad", checkClause: "id > 0" }))]) {
    const invalid = clone(catalog); mutate(invalid); assert.throws(() => validateCanaryContract(invalid));
  }
  const withDefaults = clone(catalog); field(withDefaults, "updated_at").extra = "DEFAULT_GENERATED on update CURRENT_TIMESTAMP";
  assert.doesNotThrow(() => validateCanaryContract(withDefaults));
});

function canaryMock({ fail = "", badRow = false } = {}) {
  const calls = [], connection = { async query(sql, values) {
    calls.push({ sql, values });
    if (fail && sql.startsWith(fail)) throw Object.assign(new Error(privateLiteral), { code: "ER_FIXTURE" });
    if (sql.startsWith("INSERT")) return [{ affectedRows: 1, warningStatus: 0 }];
    if (sql.startsWith("SELECT")) return [[-2, -1].map(id => ({ id, ...Object.fromEntries(COLUMN_CONTRACTS.map(metric => [metric.name, badRow ? 0 : null])) }))];
    return [[]];
  } }; return { connection, calls };
}

test("two synthetic inserts use explicit negative IDs, explicit NULL then omitted metrics, and always ROLLBACK without COMMIT", async () => {
  const mock = canaryMock(), result = await runRollbackCanaries(mock.connection, local(fixture(), schema(3), true).catalog);
  assert.equal(result.rowsInserted, 2); assert.equal(result.rollbackCompleted, true);
  assert.equal(mock.calls[0].sql, "START TRANSACTION"); assert.equal(mock.calls.at(-1).sql, "ROLLBACK");
  const inserts = mock.calls.filter(call => call.sql.startsWith("INSERT")); assert.equal(inserts.length, 2);
  assert.equal(inserts[0].values[1], -1); assert.equal(inserts[1].values[1], -2);
  assert.ok(inserts[0].values.slice(-5).every(value => value === null));
  for (const metric of COLUMN_CONTRACTS) { assert.ok(inserts[0].sql.includes(`\`${metric.name}\``)); assert.ok(!inserts[1].sql.includes(`\`${metric.name}\``)); }
  assert.equal(mock.calls.some(call => /COMMIT|DELETE|UPDATE|ALTER|SELECT \*/.test(call.sql)), false);
});

test("insert/SELECT/wrong-default failures still roll back; failed START never pretends a transaction began", async () => {
  for (const options of [{ fail: "INSERT" }, { fail: "SELECT" }, { badRow: true }]) {
    const mock = canaryMock(options); await assert.rejects(runRollbackCanaries(mock.connection, local(fixture(), schema(3), true).catalog));
    assert.equal(mock.calls.at(-1).sql, "ROLLBACK");
  }
  const mock = canaryMock({ fail: "START" }); await assert.rejects(runRollbackCanaries(mock.connection, local(fixture(), schema(3), true).catalog)); assert.equal(mock.calls.length, 1);
});

test("insert warnings, unexpected row counts and extra SELECT data cannot count as accepted NULL semantics", async () => {
  const catalog = local(fixture(), schema(3), true).catalog;
  for (const result of [{ affectedRows: 0, warningStatus: 0 }, { affectedRows: 2, warningStatus: 0 },
    { affectedRows: 1, warningStatus: 1 }, { affectedRows: 1 }, { affectedRows: "1", warningStatus: 0 }]) {
    const mock = canaryMock(), query = mock.connection.query;
    mock.connection.query = async (...args) => args[0].startsWith("INSERT") ? [result] : query(...args);
    await assert.rejects(runRollbackCanaries(mock.connection, catalog), code("CANARY_INSERT_NOT_EXACT"));
    assert.equal(mock.calls.at(-1).sql, "ROLLBACK");
  }
  for (const change of [rows => rows.pop(), rows => rows[0].id = 1, rows => rows[0].unrequested = "private", rows => rows.reverse()]) {
    const mock = canaryMock(), query = mock.connection.query;
    mock.connection.query = async (...args) => { const result = await query(...args); if (args[0].startsWith("SELECT")) change(result[0]); return result; };
    await assert.rejects(runRollbackCanaries(mock.connection, catalog), code("CANARY_NULL_SEMANTICS_FAILED"));
    assert.equal(mock.calls.at(-1).sql, "ROLLBACK");
  }
});

function workflow({ baselineFail = false, failSql = "", failNative = false, changedCounter = false, cleanupFail = false } = {}) {
  const { artifact, options, prerequisite } = inputs(), databases = new Map(), events = [], configs = [], writes = new Map(), fds = new Map();
  let nextFd = 10001, loadCount = 0, nativeCount = 0, destroyed = 0, baselineCount = 0, timerCallback;
  const uid = process.getuid(), actual = fs;
  const special = [root, options.socket, options.datadir, "/usr/lib/os-release", "/usr/bin", "/usr/bin/mysql", "/usr/bin/mysqldump"];
  const io = { ...fs,
    realpathSync: filename => filename === "/etc/os-release" ? "/usr/lib/os-release" : special.includes(filename.replace(/\/$/, "")) || writes.has(filename)
      ? filename.replace(/\/$/, "") : actual.realpathSync(filename),
    lstatSync: filename => special.includes(filename) ? { size: 50, uid: filename === root ? uid : 0, mode: filename === root ? 0o40700 : 0o100755,
      isDirectory: () => [root, options.datadir, "/usr/bin"].includes(filename), isSocket: () => filename === options.socket,
      isFile: () => ["/usr/lib/os-release", "/usr/bin/mysql", "/usr/bin/mysqldump"].includes(filename), isSymbolicLink: () => false } : actual.lstatSync(filename),
    existsSync: filename => writes.has(filename) || (filename === options.output ? false : actual.existsSync(filename)),
    openSync: (filename, ...rest) => {
      if (writes.has(filename) || filename.startsWith(`${root}/campaign-nullability-`)) {
        if (!writes.has(filename)) { assert.deepEqual(rest, ["wx+", 0o600]); writes.set(filename, Buffer.alloc(0)); }
        const fd = nextFd++; fds.set(fd, filename); return fd;
      }
      return actual.openSync(filename, ...rest);
    },
    fstatSync: fd => fds.has(fd) ? { size: writes.get(fds.get(fd)).length, uid, mode: 0o100600, isFile: () => true } : actual.fstatSync(fd),
    readFileSync: (filename, ...rest) => filename === "/usr/lib/os-release" ? 'ID=ubuntu\nVERSION_ID="24.04"\n'
      : fds.has(filename) ? writes.get(fds.get(filename)) : actual.readFileSync(filename, ...rest),
    readSync: (fd, bytes) => { const value = writes.get(fds.get(fd)); value.copy(bytes); return value.length; },
    closeSync: fd => { if (fds.has(fd)) fds.delete(fd); else actual.closeSync(fd); },
    writeFileSync: (filename, bytes, flags) => { assert.deepEqual(flags, { flag: "wx", mode: 0o600 }); assert.equal(writes.has(filename), false); writes.set(filename, Buffer.from(bytes)); },
  };
  const dependencies = { io, environment: {}, argv: [], runtime: { platform: "linux", arch: "arm64", effectiveUid: uid },
    timers: { setTimeout(callback) { timerCallback = callback; return 1; }, clearTimeout() {} },
    baseline: async (input, passed) => {
      baselineCount++; assert.equal(passed.io, io); assert.notEqual(input.output, options.output); assert.equal(input.artifactSha256, options.artifactSha256);
      const receipt = completed(artifact, options, schema(3), schema(4));
      if (baselineFail) receipt.status = "failed";
      else { databases.set(schema(3), { altered: false, rows: [], ready: true }); databases.set(schema(4), { altered: false, rows: [], ready: true }); }
      io.writeFileSync(input.output, `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 }); return receipt;
    },
    load: async () => { loadCount++; return async config => {
      configs.push(config); assert.equal(config.multipleStatements, false); assert.equal(config.socketPath, options.socket); assert.equal(Object.hasOwn(config, "host"), false);
      const database = config.database ?? null;
      return { async query({ sql, timeout }, values = []) {
        events.push({ database, sql, values }); assert.equal(timeout, 30_000);
        if (failSql && sql.startsWith(failSql)) throw Object.assign(new Error(privateLiteral), { code: "ER_FORWARD_FIXTURE" });
        if (sql.startsWith("SELECT DATABASE()")) return [[{ schemaName: database, ...server, datadir: options.datadir, socket: options.socket, skipNetworking: 1, eventScheduler: "OFF" }]];
        if (sql.includes("information_schema.plugins")) return [[{ pluginStatus: "DISABLED" }]];
        if (sql === "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry") return [[{ statsExpiry: 0 }]];
        if (sql.startsWith("SET SESSION")) return [[]];
        const create = /^CREATE DATABASE `(amazon_rehearsal_[a-f0-9]{16}_synthetic)` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin$/.exec(sql);
        if (create) { assert.equal(database, null); assert.equal(databases.has(create[1]), false); databases.set(create[1], { altered: false, rows: [], ready: false }); return [[]]; }
        assert.ok(databases.has(database)); const db = databases.get(database);
        if (sql === "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()") { assert.equal(db.ready, false); return [[]]; }
        assert.equal(db.ready, true);
        if (sql === CANDIDATE_SQL) { assert.equal(database, schema(4)); assert.equal(db.altered, false); db.altered = true; return [[]]; }
        if (sql === "START TRANSACTION") { db.transaction = true; return [[]]; }
        if (sql.startsWith("INSERT")) {
          assert.equal(database, schema(4)); assert.equal(db.altered, true); assert.equal(db.transaction, true); assert.ok([-1, -2].includes(values[1]));
          db.rows.push({ id: values[1], ...Object.fromEntries(COLUMN_CONTRACTS.map(metric => [metric.name, null])) }); return [{ affectedRows: 1, warningStatus: 0 }];
        }
        if (sql === "ROLLBACK") { assert.equal(db.transaction, true); db.rows = []; db.transaction = false; db.canaryRan = true; return [[]]; }
        if (sql.startsWith("SELECT `id`")) return [clone(db.rows).sort((a, b) => a.id - b.id)];
        const snapshot = local(artifact, database, db.altered);
        if (changedCounter && db.canaryRan) snapshot.catalog.tables[0].autoIncrement = "43";
        if (sql === LOCAL_TABLE_DISCOVERY_SQL) return [snapshot.catalog.tables.map(table => ({ tableName: table.tableName, tableType: table.tableType, engine: table.engine }))];
        const definition = Object.entries(DDL_CATALOG).find(([, value]) => value.sql === sql); if (definition) return [snapshot.catalog[definition[0]]];
        const show = /^SHOW CREATE TABLE `([^`]+)`$/.exec(sql); if (show) return [[{ Table: show[1], "Create Table": snapshot.tables.find(table => table.tableName === show[1]).ddl }]];
        const count = /^SELECT COUNT\(\*\) AS rowCount FROM `([^`]+)`$/.exec(sql); if (count) return [[{ rowCount: count[1] === TABLE_NAME ? db.rows.length : 0 }]];
        assert.fail(`Unexpected query ${sql}`);
      }, destroy() { destroyed++; if (cleanupFail) throw Object.assign(new Error(privateLiteral), { code: "ER_CLEANUP_FIXTURE" }); } };
    }; },
    native: async call => {
      nativeCount++; assert.equal(call.root, root); assert.equal(call.signal.aborted, false);
      if (failNative) throw Object.assign(new Error(privateLiteral), { code: "MYSQL_CLIENT_FAILED" });
      if (call.binary === "/usr/bin/mysqldump") {
        assert.ok(call.args.includes("--no-data")); assert.equal(call.args.at(-1), schema(4));
        writes.set(fds.get(call.outputFd), Buffer.from(`${local(artifact, schema(4), true).tables.map(table => `${table.ddl};`).join("\n")}\n`));
      } else {
        assert.equal(call.binary, "/usr/bin/mysql"); const name = call.args.find(value => value.startsWith("--database=")).slice(11);
        assert.ok(databases.has(name)); assert.equal(databases.get(name).ready, false); databases.get(name).ready = true; databases.get(name).altered = true;
      }
    } };
  return { artifact, options, prerequisite, dependencies, events, configs, databases, writes, fds,
    loadCount: () => loadCount, nativeCount: () => nativeCount, destroyed: () => destroyed, baselineCount: () => baselineCount,
    expire: () => timerCallback() };
}

test("full mocked forward workflow composes fresh baseline, one ALTER, rollback canaries, third-schema recovery and no-op verification", async () => {
  const mock = workflow(), result = await runCampaignNullabilityRehearsal(mock.options, mock.dependencies);
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.stage, "completed"); assert.equal(mock.baselineCount(), 1);
  assert.equal(mock.databases.size, 3); assert.equal(result.schemas.source, schema(3)); assert.equal(result.schemas.target, schema(4));
  assert.ok(![schema(1), schema(2), schema(3), schema(4)].includes(result.schemas.recovered));
  assert.equal(result.transition.changedColumns, 5); assert.equal(result.repeat.action, "noop"); assert.equal(result.restoredRepeat.action, "noop");
  assert.equal(result.canaries.rollbackCompleted, true); assert.equal(result.afterRestoration.catalogEqual, true); assert.equal(result.sourceUnchanged.ddlEqual, true);
  assert.equal(result.afterRollback.businessRows, 0); assert.equal(result.targetUnchanged.businessRows, 0); assert.equal(result.afterDump.schemaOnly, true);
  assert.equal(mock.events.filter(event => event.sql === CANDIDATE_SQL).length, 1); assert.equal(mock.events.filter(event => event.sql.startsWith("INSERT")).length, 2);
  assert.equal(mock.events.some(event => /COMMIT|DELETE FROM|DROP|SELECT \*|__drizzle_migrations/.test(event.sql)), false);
  assert.ok([...mock.databases.values()].every(db => db.rows.length === 0)); assert.equal(mock.nativeCount(), 2);
  assert.equal(mock.destroyed(), mock.configs.length); assert.equal(mock.fds.size, 0);
  assert.equal(result.productionWrites, false); assert.equal(result.migrationLedgerSeeded, false); assert.equal(result.registeredMigration, false);
  assert.equal(JSON.stringify(result).includes(privateLiteral), false); assert.equal(JSON.stringify(result).includes("CREATE TABLE"), false);
  assert.equal(JSON.parse(mock.writes.get(mock.options.output)).status, "completed");
});

test("bad approval/hash/environment/platform/prerequisite fail before baseline and connector load", async () => {
  for (const mutate of [m => m.options.forwardCampaignNullDefault = false, m => m.options.candidateSha256 = hash("other"),
    m => m.options.structureReceiptSha256 = hash("other"), m => m.options.artifactSha256 = hash("other"),
    m => m.dependencies.environment = { DATABASE_URL: "private" }, m => m.dependencies.environment = { MYSQL_PWD: "private" },
    m => m.dependencies.runtime.platform = "darwin", m => m.dependencies.runtime.arch = "x64"]) {
    const mock = workflow(); mutate(mock); await assert.rejects(runCampaignNullabilityRehearsal(mock.options, mock.dependencies));
    assert.equal(mock.baselineCount(), 0); assert.equal(mock.loadCount(), 0); assert.equal(mock.events.length, 0);
  }
});

test("failed baseline produces a failed stage receipt without any forward connector or candidate execution", async () => {
  const mock = workflow({ baselineFail: true }), result = await runCampaignNullabilityRehearsal(mock.options, mock.dependencies);
  assert.equal(result.status, "failed"); assert.equal(result.stage, "baseline"); assert.equal(result.error.code, "FORWARD_BASELINE_REHEARSAL_FAILED");
  assert.equal(mock.loadCount(), 0); assert.equal(mock.nativeCount(), 0); assert.equal(result.candidateApplied, undefined);
});

test("a claimed fresh baseline cannot reuse prerequisite schemas, skip recovery or mismatch its stored receipt", async () => {
  for (const kind of ["reused", "unrecovered", "stored-changed"]) {
    const mock = workflow();
    mock.dependencies.baseline = async input => {
      const receipt = completed(mock.artifact, mock.options, kind === "reused" ? schema(1) : schema(3), schema(4));
      if (kind === "unrecovered") receipt.restoration.ddlEqual = false;
      const stored = clone(receipt); if (kind === "stored-changed") stored.createdTableCount++;
      mock.dependencies.io.writeFileSync(input.output, `${JSON.stringify(stored)}\n`, { flag: "wx", mode: 0o600 }); return receipt;
    };
    const result = await runCampaignNullabilityRehearsal(mock.options, mock.dependencies);
    assert.equal(result.status, "failed"); assert.equal(result.stage, "baseline"); assert.equal(mock.loadCount(), 0); assert.equal(mock.events.length, 0);
  }
});

test("identity mismatch, enabled networking/X plugin or pre-alter structure drift refuse before ALTER", async () => {
  for (const kind of ["identity", "network", "mysqlx", "catalog"]) {
    const mock = workflow(), load = mock.dependencies.load;
    mock.dependencies.load = async () => { const create = await load(); return async options => {
      const raw = await create(options), query = raw.query;
      raw.query = async (...args) => {
        const result = await query(...args), sql = args[0].sql;
        if (sql.startsWith("SELECT DATABASE()") && kind === "identity") result[0][0].schemaName = sourceSchema;
        if (sql.startsWith("SELECT DATABASE()") && kind === "network") result[0][0].skipNetworking = 0;
        if (sql.includes("information_schema.plugins") && kind === "mysqlx") result[0][0].pluginStatus = "ACTIVE";
        if (sql === DDL_CATALOG.tables.sql && kind === "catalog") result[0][0].autoIncrement = "43";
        return result;
      }; return raw;
    }; };
    const result = await runCampaignNullabilityRehearsal(mock.options, mock.dependencies);
    assert.equal(result.status, "failed"); assert.equal(result.stage, "pre_alter_verification"); assert.equal(result.candidateApplied, undefined);
    assert.equal(mock.events.some(event => event.sql === CANDIDATE_SQL), false); assert.equal(mock.nativeCount(), 0);
  }
});

test("ALTER/canary/native/cleanup failures retain sanitized stage receipts and never run historical migrations or retry", async () => {
  for (const options of [{ failSql: "ALTER TABLE" }, { failSql: "INSERT" }, { failSql: "ROLLBACK" }, { failNative: true }, { cleanupFail: true }]) {
    const mock = workflow(options), result = await runCampaignNullabilityRehearsal(mock.options, mock.dependencies);
    assert.equal(result.status, "failed", JSON.stringify(options)); assert.ok(result.error || result.cleanupError);
    assert.equal(JSON.stringify(result).includes(privateLiteral), false); assert.equal(mock.baselineCount(), 1);
    assert.ok(mock.events.filter(event => event.sql === CANDIDATE_SQL).length <= 1); assert.equal(mock.destroyed(), mock.configs.length);
    assert.equal(JSON.parse(mock.writes.get(mock.options.output)).status, "failed");
  }
});

test("negative-ID canary counter drift is detected, not reset or removed from comparison", async () => {
  const mock = workflow({ changedCounter: true }), result = await runCampaignNullabilityRehearsal(mock.options, mock.dependencies);
  assert.equal(result.status, "failed"); assert.equal(result.stage, "rollback_canaries"); assert.equal(result.error.code, "FULL_CATALOG_MISMATCH");
  assert.equal(mock.nativeCount(), 0); assert.equal(mock.events.filter(event => event.sql === CANDIDATE_SQL).length, 1);
});

test("deadline after an awaited operation cannot label the result successful", async () => {
  const mock = workflow(), load = mock.dependencies.load;
  mock.dependencies.load = async () => { const create = await load(); return async options => {
    const raw = await create(options), query = raw.query;
    raw.query = async (...values) => { const result = await query(...values); if (values[0].sql === CANDIDATE_SQL) mock.expire(); return result; }; return raw;
  }; };
  const result = await runCampaignNullabilityRehearsal(mock.options, mock.dependencies);
  assert.equal(result.status, "failed"); assert.equal(result.deadlineExceeded, true); assert.equal(result.error.code, "FORWARD_REHEARSAL_DEADLINE_EXCEEDED");
  assert.equal(mock.nativeCount(), 0);
});

test("changing baseline receipt bytes or unchanged source metadata during execution fails final verification", async () => {
  for (const kind of ["receipt-bytes", "source-catalog"]) {
    const mock = workflow(), load = mock.dependencies.load;
    mock.dependencies.load = async () => { const create = await load(); return async options => {
      const raw = await create(options), query = raw.query;
      raw.query = async (...args) => {
        const result = await query(...args);
        if (options.database === schema(3)) {
          if (kind === "receipt-bytes") for (const [filename, bytes] of mock.writes) if (filename.includes("campaign-baseline-")) mock.writes.set(filename, Buffer.concat([bytes, Buffer.from(" ")]));
          if (kind === "source-catalog" && args[0].sql === DDL_CATALOG.tables.sql) result[0][0].autoIncrement = "43";
        }
        return result;
      }; return raw;
    }; };
    const result = await runCampaignNullabilityRehearsal(mock.options, mock.dependencies);
    assert.equal(result.status, "failed"); assert.equal(result.stage, "final_verification");
    assert.equal(result.error.code, kind === "receipt-bytes" ? "FORWARD_BASELINE_RECEIPT_CHANGED" : "FULL_CATALOG_MISMATCH");
  }
});

test("CLI reports refusal without leaking error SQL or inherited credentials", async () => {
  const mock = workflow(); mock.dependencies.environment = { DATABASE_URL: privateLiteral };
  let stdout = "", stderr = "";
  const status = await main(args(mock.options), { dependencies: mock.dependencies, stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } });
  assert.equal(status, 1); assert.equal(stdout, ""); assert.equal(JSON.parse(stderr).status, "refused_or_failed"); assert.equal(stderr.includes(privateLiteral), false);
});
