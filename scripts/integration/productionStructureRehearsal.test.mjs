// Synthetic private files + pure/mocked MySQL only. No production artifact read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DDL_CATALOG } from "./exportProductionDdl.mjs";
import { linuxNativeArguments } from "./historicalPlatformProfile.mjs";
import {
  parseArguments, validateExport, loadPrivateExport, validateReplayDdl, mapCatalogSchema, collectLocalStructure,
  compareStructure, structureDumpArguments, validateStructureDump, runStructureRehearsal, main, LOCAL_TABLE_DISCOVERY_SQL,
} from "./productionStructureRehearsal.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const jhash = value => hash(JSON.stringify(value));
const clone = value => structuredClone(value);
const code = expected => error => error.code === expected;
const privateLiteral = "fixture-private-default-and-comment";
const sourceSchema = "amz_listing", targetSchema = "amazon_rehearsal_0123456789abcdef_synthetic";
const server = { version: "8.0.46-0ubuntu0.24.04.4", lowerCaseTableNames: 0, sqlMode: "STRICT_TRANS_TABLES", quoteShowCreate: 1 };
const row = (name, values) => ({ ...Object.fromEntries(DDL_CATALOG[name].fields.map(field => [field, null])), ...values });
const root = "/tmp/amazon-mysql8-rehearsal.structure-test";
const basic = { executeLocal: true, linuxIsolatedVm: true, root, socket: `${root}/mysql.sock`, datadir: `${root}/data`, bindir: "/usr/bin",
  output: fileURLToPath(new URL("../../artifacts/production-structure-pure-test.json", import.meta.url)), expectedTables: 1 };

function artifactFixture() {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(name => [name, []]));
  catalog.schema = [row("schema", { schemaName: sourceSchema, characterSetName: "utf8mb4", collationName: "utf8mb4_bin", defaultEncryption: "NO" })];
  catalog.tables = [row("tables", { tableName: "products", tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic",
    autoIncrement: "7", collationName: "utf8mb4_bin", createOptions: "", tableComment: privateLiteral })];
  catalog.columns = [row("columns", { tableName: "products", columnName: "id", ordinalPosition: 1, dataType: "int", columnType: "int",
    isNullable: "NO", extra: "auto_increment" }), row("columns", { tableName: "products", columnName: "note", ordinalPosition: 2,
    dataType: "varchar", columnType: "varchar(60)", characterSetName: "utf8mb4", collationName: "utf8mb4_bin", isNullable: "YES",
    columnDefault: privateLiteral, columnComment: privateLiteral })];
  catalog.indexes = [row("indexes", { tableName: "products", indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", direction: "A", indexType: "BTREE", visible: "YES" })];
  catalog.constraints = [row("constraints", { tableName: "products", constraintName: "PRIMARY", constraintType: "PRIMARY KEY", enforced: "YES" })];
  catalog.keyColumns = [row("keyColumns", { tableName: "products", constraintName: "PRIMARY", columnName: "id", ordinalPosition: 1 })];
  const ddl = `CREATE TABLE \`products\` (\n  \`id\` int NOT NULL AUTO_INCREMENT,\n  \`note\` varchar(60) COLLATE utf8mb4_bin DEFAULT '${privateLiteral}' COMMENT '${privateLiteral}',\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='${privateLiteral}'`;
  return { formatVersion: 1, kind: "private-schema-only-not-auto-replayable", schema: sourceSchema, server: clone(server), catalog,
    tables: [{ tableName: "products", ddl, sha256: hash(ddl) }] };
}

function bound(artifact = artifactFixture()) {
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`), artifactSha256 = hash(artifactBytes);
  const snapshot = { schema: artifact.schema, server: artifact.server, catalog: artifact.catalog, tables: artifact.tables };
  const receipt = { formatVersion: 1, mode: "private-read-only-production-ddl", status: "completed", stable: true,
    expectedSchema: sourceSchema, businessRowsRead: false, databaseWrites: false, replayPerformed: false, filesWritten: true,
    server: clone(artifact.server), counts: Object.fromEntries(Object.entries(artifact.catalog).map(([key, value]) => [key, value.length])),
    hashes: { first: jhash(snapshot), second: jhash(snapshot) }, captureSha256: jhash(artifact), artifactFileSha256: artifactSha256 };
  return { artifact, receipt, artifactBytes, artifactSha256, expectedTables: 1 };
}

function privateInput(value = bound()) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amazon-structure-test.")));
  fs.chmodSync(directory, 0o700);
  const receiptBytes = Buffer.from(`${JSON.stringify(value.receipt)}\n`);
  fs.writeFileSync(path.join(directory, "production-ddl.json"), value.artifactBytes, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(directory, "export-receipt.json"), receiptBytes, { mode: 0o600, flag: "wx" });
  return { ...basic, artifactDirectory: directory, artifactSha256: value.artifactSha256, receiptSha256: hash(receiptBytes) };
}

function local(artifact = artifactFixture(), schema = targetSchema) {
  return { schema, catalog: mapCatalogSchema(artifact.catalog, sourceSchema, schema), tables: clone(artifact.tables), zeroRowTables: artifact.tables.length };
}

test("import is inert with inherited production-looking connection configuration", () => {
  const url = new URL("./productionStructureRehearsal.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});console.log('INERT')`],
    { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", DATABASE_URL: "must-not-use" } });
  assert.equal(result.status, 0); assert.equal(result.stdout, "INERT\n"); assert.equal(result.stderr, "");
});

test("CLI requires both execution flags, every private-file pin and bounded expected table count", () => {
  const input = privateInput();
  const names = ["root", "socket", "datadir", "bindir", "output", "artifact-directory", "artifact-sha256", "receipt-sha256", "expected-tables"];
  const args = ["--execute-local", "--linux-isolated-vm", ...names.flatMap(name => [`--${name}`, String(input[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())])])];
  assert.deepEqual(parseArguments(args), input);
  for (const bad of [[], args.slice(1), args.slice(0, -2), [...args, "--execute-local"], [...args, "--expected-tables", "1"],
    [...args, "--uri", "mysql://x"], [...args, "--host", "localhost"], [...args.slice(0, -1), "0"], [...args.slice(0, -1), "1000"]]) assert.throws(() => parseArguments(bad));
});

test("stable source artifact requires exact production schema/version, full counts and all internal hashes", () => {
  const value = bound(); assert.equal(validateExport(value.artifact, value.receipt, value), value.artifact);
  for (const mutate of [x => x.receipt.stable = false, x => x.receipt.status = "failed", x => x.receipt.businessRowsRead = true,
    x => x.receipt.databaseWrites = true, x => x.receipt.replayPerformed = true, x => x.receipt.counts.columns++,
    x => x.receipt.captureSha256 = hash("wrong"), x => x.receipt.hashes.second = hash("wrong"),
    x => x.receipt.server.version = "8.4.11", x => x.artifact.tables[0].sha256 = hash("wrong")]) {
    const broken = clone(value); mutate(broken); assert.throws(() => validateExport(broken.artifact, broken.receipt, broken));
  }
  for (const mutate of [a => a.schema = "other", a => a.server.version = "8.0.45", a => a.server.lowerCaseTableNames = 2,
    a => a.server.sqlMode = "NO_BACKSLASH_ESCAPES", a => a.server.quoteShowCreate = 0]) {
    const artifact = artifactFixture(); mutate(artifact); const broken = bound(artifact);
    assert.throws(() => validateExport(broken.artifact, broken.receipt, broken), code("SOURCE_ARTIFACT_IDENTITY_INVALID"));
  }
  assert.throws(() => validateExport(value.artifact, value.receipt, { ...value, expectedTables: 312 }), code("EXPORT_TABLE_COUNT_MISMATCH"));
});

test("catalog incomplete fields, unsupported object types and external FK cannot be approved by recomputed hashes", () => {
  for (const mutate of [a => delete a.catalog.columns[0].columnDefault, a => a.catalog.columns[0].extraField = "x",
    a => a.catalog.tables[0].engine = "FEDERATED", a => a.catalog.views.push(row("views", { tableName: "v" })),
    a => a.catalog.columns[0].srsId = 4326, a => a.catalog.schema[0].defaultEncryption = "YES",
    a => a.catalog.foreignKeys.push(row("foreignKeys", { tableName: "products", uniqueConstraintSchema: "outside", referencedTableName: "products" })),
    a => a.catalog.keyColumns[0].referencedTableSchema = "outside"]) {
    const artifact = artifactFixture(); mutate(artifact); const value = bound(artifact);
    assert.throws(() => validateExport(value.artifact, value.receipt, value));
  }
});

test("private-file boundary requires 0700 directory, 0600 regular owned files and both explicit hashes", () => {
  const input = privateInput(); assert.deepEqual(loadPrivateExport(input), artifactFixture());
  for (const name of ["artifactSha256", "receiptSha256"]) {
    assert.throws(() => loadPrivateExport({ ...input, [name]: hash("wrong") }), code("PRIVATE_INPUT_HASH_MISMATCH"));
    assert.throws(() => loadPrivateExport({ ...input, [name]: "" }), code("EXPLICIT_INPUT_HASHES_REQUIRED"));
  }
  for (const name of ["production-ddl.json", "export-receipt.json"]) {
    const sample = privateInput(), file = path.join(sample.artifactDirectory, name); fs.chmodSync(file, 0o644);
    assert.throws(() => loadPrivateExport(sample), code("PRIVATE_INPUT_FILE_INVALID"));
  }
  const shared = privateInput(); fs.chmodSync(shared.artifactDirectory, 0o755); assert.throws(() => loadPrivateExport(shared));
  const linkDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amazon-structure-link."))); fs.chmodSync(linkDir, 0o700);
  fs.symlinkSync(path.join(input.artifactDirectory, "production-ddl.json"), path.join(linkDir, "production-ddl.json"));
  assert.throws(() => loadPrivateExport({ ...input, artifactDirectory: linkDir }));
});

test("single CREATE replay rejects qualified targets, cross-schema FK and external or executable SQL features", () => {
  const base = "CREATE TABLE `products` (`id` int) ENGINE=InnoDB";
  assert.equal(validateReplayDdl(base, "products").ddl, base);
  assert.doesNotThrow(() => validateReplayDdl(base.replace("`id` int", "`id` int COMMENT 'SELECT; DROP; private'"), "products"));
  for (const sql of [base + "; DROP TABLE products", base.replace("`products`", "`amz_listing`.`products`"),
    base.replace("`id` int", "`id` int REFERENCES `amz_listing`.`other` (`id`)"), base.replace("`id` int", "`id` int REFERENCES other.x (`id`)"),
    base + " AS SELECT * FROM mysql.user", base + " TABLESPACE `external`", base + " DATA DIRECTORY='/tmp/other'", base + " CONNECTION='remote'"]) {
    assert.throws(() => validateReplayDdl(sql, "products"));
  }
});

test("schema mapping changes only allowed schema/FK identity fields, preserving all literals", () => {
  const artifact = artifactFixture();
  artifact.catalog.keyColumns[0].referencedTableSchema = sourceSchema;
  artifact.catalog.foreignKeys.push(row("foreignKeys", { tableName: "products", uniqueConstraintSchema: sourceSchema, referencedTableName: "products" }));
  artifact.catalog.tables[0].tableComment = "literal amz_listing must remain";
  const mapped = mapCatalogSchema(artifact.catalog, sourceSchema, targetSchema);
  assert.equal(mapped.schema[0].schemaName, targetSchema); assert.equal(mapped.keyColumns[0].referencedTableSchema, targetSchema);
  assert.equal(mapped.foreignKeys[0].uniqueConstraintSchema, targetSchema); assert.equal(mapped.tables[0].tableComment, "literal amz_listing must remain");
  assert.equal(artifact.catalog.schema[0].schemaName, sourceSchema);
  assert.throws(() => mapCatalogSchema(artifact.catalog, sourceSchema, "amz_listing"));
});

test("full comparison rejects type/default/comment/index/FK/AUTO_INCREMENT drift and permits only proven redundant charset", () => {
  const artifact = artifactFixture(), result = compareStructure(artifact, local(artifact));
  assert.equal(result.catalogEqual && result.ddlEqual, true); assert.equal(result.businessRows, 0);
  const rendered = local(artifact); rendered.tables[0].ddl = rendered.tables[0].ddl.replace("varchar(60) COLLATE", "varchar(60) CHARACTER SET utf8mb4 COLLATE");
  assert.doesNotThrow(() => compareStructure(artifact, rendered));
  for (const mutate of [a => a.catalog.columns[1].columnType = "varchar(100)", a => a.catalog.columns[1].columnDefault = "changed",
    a => a.catalog.columns[1].columnComment = "changed", a => a.catalog.columns[1].collationName = "utf8mb4_0900_ai_ci",
    a => a.catalog.indexes[0].visible = "NO", a => a.catalog.indexes[0].prefixLength = 1, a => a.catalog.indexes[0].direction = "D",
    a => a.catalog.tables[0].autoIncrement = "8", a => a.catalog.constraints[0].enforced = "NO",
    a => a.catalog.keyColumns[0].referencedTableSchema = "other", a => a.tables[0].ddl += " ROW_FORMAT=COMPACT",
    a => a.tables[0].ddl = a.tables[0].ddl.replace("AUTO_INCREMENT=7", "AUTO_INCREMENT=8"), a => a.zeroRowTables = 0]) {
    const changed = local(artifact); mutate(changed); assert.throws(() => compareStructure(artifact, changed));
  }
});

test("local structure collection uses fixed catalog queries and COUNT only, never business content or ledger rows", async () => {
  const current = local(), calls = [];
  const connection = { async query(sql, values) {
    calls.push(sql);
    if (sql === "SET SESSION information_schema_stats_expiry = 0") return [[]];
    if (sql === "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry") return [[{ statsExpiry: "0" }]];
    if (sql === LOCAL_TABLE_DISCOVERY_SQL) { assert.deepEqual(values, [targetSchema]); return [[{ tableName: "products", tableType: "BASE TABLE", engine: "InnoDB" }]]; }
    const entry = Object.entries(DDL_CATALOG).find(([, spec]) => spec.sql === sql);
    if (entry) { assert.deepEqual(values, Array((sql.match(/\?/g) ?? []).length).fill(targetSchema)); return [current.catalog[entry[0]]]; }
    if (sql === "SHOW CREATE TABLE `products`") return [[{ Table: "products", "Create Table": current.tables[0].ddl }]];
    assert.equal(sql, "SELECT COUNT(*) AS rowCount FROM `products`"); return [[{ rowCount: "0" }]];
  } };
  assert.deepEqual(await collectLocalStructure(connection, targetSchema), current);
  assert.deepEqual(calls.slice(0, 2), ["SET SESSION information_schema_stats_expiry = 0", "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry"]);
  assert.deepEqual(calls.slice(2, 5), [LOCAL_TABLE_DISCOVERY_SQL, "SHOW CREATE TABLE `products`", "SELECT COUNT(*) AS rowCount FROM `products`"]);
  assert.deepEqual(calls.slice(5), [...Object.values(DDL_CATALOG), ...Object.values(DDL_CATALOG)].map(spec => spec.sql));
  assert.equal(calls.some(sql => /SELECT \*/.test(sql)), false);
  await assert.rejects(collectLocalStructure(connection, sourceSchema), code("NON_SYNTHETIC_SCHEMA_FORBIDDEN"));
  const nonempty = { query: async (sql, values) => sql.startsWith("SELECT COUNT") ? [[{ rowCount: 1 }]] : connection.query(sql, values) };
  await assert.rejects(collectLocalStructure(nonempty, targetSchema), code("LOCAL_BUSINESS_ROWS_NOT_EMPTY"));
});

test("each collection refuses before catalog reads when stats-expiry SET/SELECT fails or verification is not exactly zero", async () => {
  const set = "SET SESSION information_schema_stats_expiry = 0", select = "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry";
  for (const failure of ["set", "select"]) {
    const calls = [], error = Object.assign(new Error(privateLiteral), { code: "ER_STATS_FIXTURE" });
    const connection = { async query(sql) {
      calls.push(sql);
      if (sql === (failure === "set" ? set : select)) throw error;
      assert.equal(sql, set); return [[]];
    } };
    await assert.rejects(collectLocalStructure(connection, targetSchema), value => value === error);
    assert.deepEqual(calls, failure === "set" ? [set] : [set, select]);
  }
  for (const rows of [[], [{ statsExpiry: 86400 }], [{ statsExpiry: "1" }], [{ statsExpiry: false }], [{ statsExpiry: null }],
    [{ statsExpiry: "00" }], [{ statsExpiry: "0 " }], [{}], [{ statsExpiry: 0 }, { statsExpiry: 0 }], null, {}]) {
    const calls = [], connection = { async query(sql) { calls.push(sql); return sql === set ? [[]] : [rows]; } };
    await assert.rejects(collectLocalStructure(connection, targetSchema), code("LOCAL_STATS_EXPIRY_NOT_DISABLED"));
    assert.deepEqual(calls, [set, select]);
  }
});

function collectionFixture({ current = local(), discovery, mutateCatalog = () => {}, warmFirst = false, failShow = false, failCount = false } = {}) {
  const calls = [], opened = new Set(), counted = new Set();
  let catalogReads = 0;
  const connection = { async query(sql, values) {
    calls.push(sql);
    if (sql === "SET SESSION information_schema_stats_expiry = 0") return [[]];
    if (sql === "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry") return [[{ statsExpiry: 0 }]];
    if (sql === LOCAL_TABLE_DISCOVERY_SQL) {
      assert.deepEqual(values, [current.schema]);
      return [discovery ?? current.catalog.tables.map(table => ({ tableName: table.tableName, tableType: table.tableType, engine: table.engine }))];
    }
    const show = /^SHOW CREATE TABLE `([^`]+)`$/.exec(sql);
    if (show) {
      if (failShow) throw Object.assign(new Error(privateLiteral), { code: "ER_SHOW_FIXTURE" });
      const table = current.tables.find(value => value.tableName === show[1]); assert.ok(table);
      opened.add(table.tableName); return [[{ Table: table.tableName, "Create Table": table.ddl }]];
    }
    const count = /^SELECT COUNT\(\*\) AS rowCount FROM `([^`]+)`$/.exec(sql);
    if (count) {
      assert.equal(opened.has(count[1]), true);
      counted.add(count[1]); return [[{ rowCount: failCount ? "1" : "0" }]];
    }
    const entry = Object.entries(DDL_CATALOG).find(([, spec]) => spec.sql === sql); assert.ok(entry);
    assert.deepEqual(values, Array((sql.match(/\?/g) ?? []).length).fill(current.schema));
    const pass = Math.floor(catalogReads++ / Object.keys(DDL_CATALOG).length), catalog = clone(current.catalog);
    if (warmFirst && (opened.size !== current.tables.length || counted.size !== current.tables.length)) {
      for (const table of catalog.tables) table.autoIncrement = null;
    }
    mutateCatalog(catalog, pass);
    return [catalog[entry[0]]];
  } };
  return { connection, calls, opened, counted, catalogReads: () => catalogReads };
}

test("all tables are opened and counted before either catalog pass, avoiding initial NULL autoIncrement without normalizing it", async () => {
  const current = local(), originalTable = current.tables[0], tableName = "second_table";
  const secondDdl = originalTable.ddl.replace("CREATE TABLE `products`", `CREATE TABLE \`${tableName}\``);
  current.tables.push({ tableName, ddl: secondDdl, sha256: hash(secondDdl) }); current.zeroRowTables++;
  for (const rows of Object.values(current.catalog)) {
    for (const value of [...rows]) if (value.tableName === "products") rows.push({ ...clone(value), tableName });
  }
  const fake = collectionFixture({ current, warmFirst: true }), observed = await collectLocalStructure(fake.connection, current.schema);
  assert.deepEqual(observed, current); assert.ok(observed.catalog.tables.every(table => table.autoIncrement === "7"));
  const firstCatalog = fake.calls.indexOf(DDL_CATALOG.schema.sql);
  assert.equal(firstCatalog, 7); assert.equal(fake.catalogReads(), Object.keys(DDL_CATALOG).length * 2);
  assert.deepEqual(fake.calls.slice(3, firstCatalog), ["SHOW CREATE TABLE `products`", "SELECT COUNT(*) AS rowCount FROM `products`",
    "SHOW CREATE TABLE `second_table`", "SELECT COUNT(*) AS rowCount FROM `second_table`"]);
});

test("nonstatistical discovery is bounded, exact, sorted, unique and limited to safe InnoDB base tables", async () => {
  const valid = { tableName: "products", tableType: "BASE TABLE", engine: "InnoDB" };
  assert.doesNotMatch(LOCAL_TABLE_DISCOVERY_SQL, /AUTO_INCREMENT|TABLE_ROWS|DATA_LENGTH|STATISTICS/i);
  for (const discovery of [[], [valid, valid], [{ ...valid, tableName: "outside.products" }], [{ ...valid, tableName: "x`" }],
    [{ ...valid, tableName: "a".repeat(65) }], [{ ...valid, tableName: null }], [{ ...valid, tableName: undefined }],
    [{ ...valid, tableType: "VIEW" }], [{ ...valid, engine: "MyISAM" }], [{ ...valid, extra: true }],
    [{ tableName: "products", tableType: "BASE TABLE" }], [valid, { ...valid, tableName: "a" }], Array(1000).fill(valid)]) {
    const fake = collectionFixture({ discovery });
    await assert.rejects(collectLocalStructure(fake.connection, targetSchema), code("LOCAL_TABLE_DISCOVERY_INVALID"));
    assert.equal(fake.calls.length, 3); assert.equal(fake.catalogReads(), 0); assert.equal(fake.opened.size, 0);
  }
});

test("SHOW failure or nonzero COUNT stops before any full catalog observation", async () => {
  for (const options of [{ failShow: true }, { failCount: true }]) {
    const fake = collectionFixture(options);
    await assert.rejects(collectLocalStructure(fake.connection, targetSchema));
    assert.equal(fake.catalogReads(), 0);
  }
});

test("table additions, removals and replacements in either catalog pass are refused, not dropped from coverage", async () => {
  for (const changePass of [0, 1]) for (const change of ["add", "remove", "rename"]) {
    const fake = collectionFixture({ mutateCatalog(catalog, pass) {
      if (pass !== changePass) return;
      if (change === "add") {
        const name = "second_table";
        for (const rows of Object.values(catalog)) for (const value of [...rows]) if (value.tableName === "products") rows.push({ ...clone(value), tableName: name });
      } else if (change === "remove") {
        for (const [key, rows] of Object.entries(catalog)) catalog[key] = rows.filter(value => value.tableName !== "products");
      } else for (const rows of Object.values(catalog)) for (const value of rows) if (value.tableName === "products") value.tableName = "renamed";
    } });
    await assert.rejects(collectLocalStructure(fake.connection, targetSchema), error => ["LOCAL_TABLE_SET_CHANGED", "TABLE_COUNT_OUT_OF_SCOPE"].includes(error.code));
    assert.ok(fake.catalogReads() <= Object.keys(DDL_CATALOG).length * 2);
  }
});

test("two post-open catalogs must be identical in every field; no choosing later values or retrying", async () => {
  const mutations = [catalog => catalog.tables[0].autoIncrement = "8", catalog => catalog.tables[0].autoIncrement = null,
    catalog => catalog.tables[0].tableComment = "changed", catalog => catalog.columns[1].columnType = "varchar(90)",
    catalog => catalog.columns[1].columnDefault = "changed", catalog => catalog.columns[1].columnComment = "changed",
    catalog => catalog.indexes[0].visible = "NO", catalog => catalog.indexes[0].prefixLength = 1,
    catalog => catalog.constraints[0].enforced = "NO", catalog => catalog.keyColumns[0].uniqueConstraintPosition = 1,
    catalog => catalog.schema[0].collationName = "utf8mb4_general_ci"];
  for (const mutate of mutations) {
    const fake = collectionFixture({ mutateCatalog(catalog, pass) { if (pass === 1) mutate(catalog); } });
    await assert.rejects(collectLocalStructure(fake.connection, targetSchema), code("LOCAL_CATALOG_CHANGED_DURING_CAPTURE"));
    assert.equal(fake.catalogReads(), Object.keys(DDL_CATALOG).length * 2);
  }
});

test("stable post-open catalogs still fail artifact comparison when any captured definition differs", async () => {
  for (const mutate of [catalog => catalog.tables[0].autoIncrement = null, catalog => catalog.tables[0].autoIncrement = "8",
    catalog => catalog.columns[1].columnDefault = "different"]) {
    const fake = collectionFixture({ mutateCatalog: mutate }), observed = await collectLocalStructure(fake.connection, targetSchema);
    assert.throws(() => compareStructure(artifactFixture(), observed), code("FULL_CATALOG_MISMATCH"));
    assert.equal(fake.catalogReads(), Object.keys(DDL_CATALOG).length * 2);
  }
});

test("dump is explicitly no-data and rejects DML, DROP, other objects, cross-schema writes and client commands", () => {
  const profile = { nativeArguments: linuxNativeArguments };
  assert.ok(structureDumpArguments(profile, basic.socket, targetSchema).includes("--no-data"));
  const bytes = Buffer.from(`${artifactFixture().tables[0].ddl};\n`);
  assert.equal(validateStructureDump(bytes, ["products"]).schemaOnly, true);
  for (const statement of ["INSERT INTO products VALUES (1);", "REPLACE INTO products VALUES (1);", "DROP TABLE products;", "USE amz_listing;",
    "CREATE VIEW v AS SELECT 1;", "CREATE VIEW v AS TABLE products;", "CREATE ROLE elevated;", "INSTALL COMPONENT 'file://other';",
    "CREATE TRIGGER t BEFORE INSERT ON products FOR EACH ROW SET @x=1;", "SET @@GLOBAL.read_only=0;",
    "SET PERSIST max_connections=200;", "SET PERSIST_ONLY max_connections=200;", "SET @@PERSIST.max_connections=200;",
    "ALTER TABLE other.products DISABLE KEYS;", "\\! arbitrary", "source /tmp/x", "/*!40000 DROP TABLE products */;"]) {
    assert.throws(() => validateStructureDump(Buffer.concat([bytes, Buffer.from(`\n${statement}\n`)]), ["products"]));
  }
  assert.throws(() => validateStructureDump(bytes, ["other"]));
});

test("dump ALTER is limited to included-table key toggles, including executable comments", () => {
  const bytes = Buffer.from(`${artifactFixture().tables[0].ddl};\n`);
  for (const statement of ["ALTER TABLE `products` DISABLE KEYS;", "/*!40000 ALTER TABLE products ENABLE KEYS */;"])
    assert.doesNotThrow(() => validateStructureDump(Buffer.concat([bytes, Buffer.from(statement)]), ["products"]));
  for (const statement of ["ALTER TABLE `other` DISABLE KEYS;", "/*!40000 ALTER TABLE other ENABLE KEYS */;",
    "ALTER TABLE `products` ADD COLUMN `extra` int;", "ALTER TABLE `products` DISABLE KEYS, ADD COLUMN x int;"]) {
    assert.throws(() => validateStructureDump(Buffer.concat([bytes, Buffer.from(statement)]), ["products"]), code("STRUCTURE_DUMP_ALTER_OUT_OF_SCOPE"));
  }
  const inert = bytes.toString().replace(privateLiteral, "ALTER TABLE other DISABLE KEYS; private");
  assert.doesNotThrow(() => validateStructureDump(Buffer.from(inert + "\n/* ALTER TABLE other ENABLE KEYS; */\n"), ["products"]));
});

test("structure default native binding uses the fixed Linux client environment runner", () => {
  const source = fs.readFileSync(new URL("./productionStructureRehearsal.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{[^\n]*runLinuxNative[^\n]*\} from "\.\/historicalPlatformProfile\.mjs"/);
  assert.match(source, /load = loadConnector, native = runLinuxNative/);
  assert.doesNotMatch(source, /native = runNative/);
});

function workflow({ failDdl = false, failNative = false, nonempty = false, failCleanup = false } = {}) {
  const artifact = artifactFixture(), options = privateInput(), databases = new Map(), configs = [], events = [], receipts = [];
  let loads = 0, natives = 0, destroyed = 0, dumpOpen = false;
  const dump = Buffer.from(`${artifact.tables[0].ddl};\n`);
  const actual = fs;
  const uid = process.getuid();
  const io = { ...fs,
    realpathSync: value => value === "/etc/os-release" ? "/usr/lib/os-release" : [root, options.socket, options.datadir, "/usr/lib/os-release", "/usr/bin", "/usr/bin/mysql", "/usr/bin/mysqldump"].includes(value.replace(/\/$/, "")) ? value.replace(/\/$/, "") : actual.realpathSync(value),
    lstatSync: value => [root, options.socket, options.datadir, "/usr/lib/os-release", "/usr/bin", "/usr/bin/mysql", "/usr/bin/mysqldump"].includes(value)
      ? { size: 50, uid: value === root ? uid : 0, mode: value === root ? 0o40700 : 0o100755,
        isDirectory: () => [root, options.datadir, "/usr/bin"].includes(value), isSocket: () => value === options.socket,
        isFile: () => ["/usr/lib/os-release", "/usr/bin/mysql", "/usr/bin/mysqldump"].includes(value), isSymbolicLink: () => false } : actual.lstatSync(value),
    readFileSync: (...args) => args[0] === "/usr/lib/os-release" ? 'ID=ubuntu\nVERSION_ID="24.04"\n' : actual.readFileSync(...args),
    existsSync: filename => filename === options.output ? false : actual.existsSync(filename),
    openSync: (filename, ...args) => { if (filename.startsWith(`${root}/production-structure-`)) { assert.equal(args[0], "wx+"); assert.equal(args[1], 0o600); dumpOpen = true; return 10001; } return actual.openSync(filename, ...args); },
    fstatSync: fd => fd === 10001 ? { size: dump.length, mode: 0o100600, isFile: () => true } : actual.fstatSync(fd),
    readSync: (fd, buffer) => { assert.equal(fd, 10001); dump.copy(buffer); return dump.length; },
    closeSync: fd => { if (fd === 10001) dumpOpen = false; else actual.closeSync(fd); },
    writeFileSync: (filename, bytes, flags) => { assert.equal(filename, options.output); assert.deepEqual(flags, { flag: "wx", mode: 0o600 }); receipts.push(JSON.parse(bytes)); },
  };
  const dependencies = { io, environment: {}, argv: [], runtime: { platform: "linux", arch: "arm64", effectiveUid: uid },
    load: async () => { loads++; return async config => {
      configs.push(config); assert.equal(config.multipleStatements, false); assert.equal(Object.hasOwn(config, "uri"), false); assert.equal(Object.hasOwn(config, "host"), false);
      const database = config.database ?? null;
      return { async query({ sql, timeout }, values = []) {
        events.push({ database, sql }); assert.equal(timeout, 30_000); assert.doesNotMatch(sql, /^USE\b|\bDROP\b|SELECT \*/i);
        if (sql.startsWith("SELECT DATABASE()")) return [[{ schemaName: database, ...server, datadir: `${options.datadir}/`, socket: options.socket, skipNetworking: 1, eventScheduler: "OFF" }]];
        if (sql.includes("information_schema.plugins")) return [[{ pluginStatus: "DISABLED" }]];
        if (sql === "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry") return [[{ statsExpiry: 0 }]];
        if (sql.startsWith("SET SESSION")) return [[]];
        const create = sql.match(/^CREATE DATABASE `(amazon_rehearsal_[a-f0-9]{16}_synthetic)` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin$/);
        if (create) { assert.equal(database, null); assert.equal(databases.has(create[1]), false); databases.set(create[1], { created: false }); return [[]]; }
        assert.ok(database && databases.has(database));
        if (sql === "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()") return [[]];
        if (sql === artifact.tables[0].ddl) {
          if (failDdl) throw Object.assign(new Error(privateLiteral), { code: "ER_FIXTURE_DDL", sql: privateLiteral });
          databases.get(database).created = true; return [[]];
        }
        assert.equal(databases.get(database).created, true);
        if (sql === LOCAL_TABLE_DISCOVERY_SQL) { assert.deepEqual(values, [database]); return [[{ tableName: "products", tableType: "BASE TABLE", engine: "InnoDB" }]]; }
        const entry = Object.entries(DDL_CATALOG).find(([, spec]) => spec.sql === sql);
        if (entry) { assert.deepEqual(values, Array((sql.match(/\?/g) ?? []).length).fill(database)); return [local(artifact, database).catalog[entry[0]]]; }
        if (sql === "SHOW CREATE TABLE `products`") return [[{ Table: "products", "Create Table": artifact.tables[0].ddl }]];
        assert.equal(sql, "SELECT COUNT(*) AS rowCount FROM `products`"); return [[{ rowCount: nonempty ? 1 : 0 }]];
      }, destroy() { destroyed++; if (failCleanup) throw Object.assign(new Error(privateLiteral), { code: "ER_FIXTURE_CLEANUP" }); } };
    }; },
    native: async call => {
      natives++; assert.equal(call.root, root); assert.equal(call.signal.aborted, false);
      if (failNative) throw Object.assign(new Error(privateLiteral), { code: "MYSQL_CLIENT_FAILED" });
      if (call.binary === "/usr/bin/mysqldump") { assert.ok(call.args.includes("--no-data")); assert.equal(call.outputFd, 10001); assert.equal(dumpOpen, true); }
      else { assert.equal(call.binary, "/usr/bin/mysql"); assert.deepEqual(call.input, dump); const database = call.args.find(value => value.startsWith("--database=")).slice(11); databases.get(database).created = true; }
    } };
  return { options, dependencies, databases, configs, events, receipts, loads: () => loads, natives: () => natives, destroyed: () => destroyed };
}

test("mocked Linux clone/restore uses fresh per-schema connections, exact raw DDL and no migrations or business content", async () => {
  const fake = workflow(), receipt = await runStructureRehearsal(fake.options, fake.dependencies);
  assert.equal(receipt.status, "completed", JSON.stringify(receipt)); assert.equal(receipt.caseSensitiveLinuxValidated, true);
  assert.equal(receipt.clone.tableCount, 1); assert.equal(receipt.restoration.businessRows, 0); assert.equal(receipt.sourceUnchanged.catalogEqual, true);
  assert.equal(receipt.migrationsExecuted, false); assert.equal(receipt.migrationLedgerSeeded, false); assert.equal(receipt.productionBackupRecoveryValidated, false);
  assert.equal(fake.databases.size, 2); assert.equal(fake.configs.length, 3); assert.equal(fake.destroyed(), 3); assert.equal(fake.natives(), 2);
  assert.notEqual(fake.configs[1].database, fake.configs[2].database); assert.equal(fake.events.filter(event => event.sql === artifactFixture().tables[0].ddl).length, 1);
  const statsSets = fake.events.filter(event => event.sql === "SET SESSION information_schema_stats_expiry = 0");
  const statsChecks = fake.events.filter(event => event.sql === "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry");
  assert.deepEqual(statsSets.map(event => event.database), [receipt.schemas.source, receipt.schemas.restored, receipt.schemas.source]);
  assert.deepEqual(statsChecks.map(event => event.database), statsSets.map(event => event.database));
  for (const event of statsSets) {
    const index = fake.events.indexOf(event);
    assert.equal(fake.events[index + 1].sql, "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry");
    assert.equal(fake.events[index + 2].sql, LOCAL_TABLE_DISCOVERY_SQL);
  }
  assert.equal(JSON.stringify(receipt).includes(privateLiteral), false); assert.equal(JSON.stringify(receipt).includes("CREATE TABLE"), false);
});

test("stats-expiry collection failures create sanitized failed receipts without dump, restore or catalog reads", async () => {
  for (const failure of ["set", "select", "nonzero"]) {
    const fake = workflow(), load = fake.dependencies.load;
    fake.dependencies.load = async () => {
      const connect = await load();
      return async options => {
        const raw = await connect(options), query = raw.query;
        raw.query = async (...args) => {
          const sql = args[0].sql;
          if ((failure === "set" && sql === "SET SESSION information_schema_stats_expiry = 0")
            || (failure === "select" && sql === "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry")) {
            throw Object.assign(new Error(privateLiteral), { code: "ER_STATS_FIXTURE" });
          }
          if (failure === "nonzero" && sql === "SELECT @@SESSION.information_schema_stats_expiry AS statsExpiry") return [[{ statsExpiry: 86400 }]];
          return query(...args);
        };
        return raw;
      };
    };
    const receipt = await runStructureRehearsal(fake.options, fake.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(receipt.caseSensitiveLinuxValidated, false); assert.equal(fake.receipts.length, 1);
    assert.equal(fake.natives(), 0); assert.equal(fake.databases.size, 1); assert.equal(fake.destroyed(), fake.configs.length);
    assert.equal(fake.events.some(event => Object.values(DDL_CATALOG).some(spec => spec.sql === event.sql)), false);
    assert.equal(receipt.error.code, failure === "nonzero" ? "LOCAL_STATS_EXPIRY_NOT_DISABLED" : "ER_STATS_FIXTURE");
    assert.equal(JSON.stringify(receipt).includes(privateLiteral), false);
  }
});

test("DDL/native/nonempty/cleanup failure is retained, sanitized, never retried or labeled successful", async () => {
  for (const flags of [{ failDdl: true }, { failNative: true }, { nonempty: true }, { failCleanup: true }]) {
    const fake = workflow(flags), receipt = await runStructureRehearsal(fake.options, fake.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(receipt.caseSensitiveLinuxValidated, false); assert.equal(fake.receipts.length, 1);
    assert.equal(JSON.stringify(receipt).includes(privateLiteral), false);
    assert.ok(fake.events.filter(event => event.sql === artifactFixture().tables[0].ddl).length <= 1);
    assert.equal(fake.destroyed(), fake.configs.length);
  }
});

test("deadline destroy exceptions remain sanitized in the failed receipt and cleanup still runs", async () => {
  const fake = workflow({ failCleanup: true }), load = fake.dependencies.load;
  let deadline, cleared = false, fired = false;
  fake.dependencies.timers = {
    setTimeout(callback, ms) { assert.equal(ms, 600_000); deadline = callback; return 123; },
    clearTimeout(id) { assert.equal(id, 123); cleared = true; },
  };
  fake.dependencies.load = async () => {
    const connect = await load();
    return async options => {
      const raw = await connect(options), query = raw.query;
      raw.query = async (...args) => { if (!fired) { fired = true; assert.doesNotThrow(() => deadline()); } return query(...args); };
      return raw;
    };
  };
  const receipt = await runStructureRehearsal(fake.options, fake.dependencies);
  assert.equal(receipt.status, "failed"); assert.equal(receipt.caseSensitiveLinuxValidated, false); assert.equal(receipt.deadlineExceeded, true);
  assert.equal(receipt.error.code, "STRUCTURE_REHEARSAL_DEADLINE_EXCEEDED");
  assert.deepEqual(receipt.deadlineCleanupErrors, [{ code: "ER_FIXTURE_CLEANUP" }]);
  assert.deepEqual(receipt.cleanupError, { code: "ER_FIXTURE_CLEANUP" });
  assert.equal(cleared, true); assert.equal(fake.destroyed(), 2); assert.equal(fake.receipts.length, 1);
  assert.equal(fake.natives(), 0); assert.equal(JSON.stringify(receipt).includes(privateLiteral), false);
});

test("deadline during the final awaited COUNT cannot be overwritten by completed status", async () => {
  const fake = workflow(), load = fake.dependencies.load;
  let deadline, countReads = 0;
  fake.dependencies.timers = { setTimeout(callback) { deadline = callback; return 123; }, clearTimeout() {} };
  fake.dependencies.load = async () => {
    const connect = await load();
    return async options => {
      const raw = await connect(options), query = raw.query;
      raw.query = async (...args) => {
        const result = await query(...args);
        if (args[0].sql.startsWith("SELECT COUNT") && ++countReads === 3) deadline();
        return result;
      };
      return raw;
    };
  };
  const receipt = await runStructureRehearsal(fake.options, fake.dependencies);
  assert.equal(countReads, 3); assert.equal(receipt.status, "failed"); assert.equal(receipt.caseSensitiveLinuxValidated, false);
  assert.equal(receipt.deadlineExceeded, true); assert.equal(receipt.error.code, "STRUCTURE_REHEARSAL_DEADLINE_EXCEEDED");
  assert.equal(fake.receipts.length, 1);
});

test("unsafe profile/env/hash refuses before load and CLI does not emit private errors", async () => {
  const fake = workflow();
  await assert.rejects(runStructureRehearsal({ ...fake.options, linuxIsolatedVm: false }, fake.dependencies));
  await assert.rejects(runStructureRehearsal(fake.options, { ...fake.dependencies, environment: { DATABASE_URL: "must-not-use" } }));
  await assert.rejects(runStructureRehearsal({ ...fake.options, artifactSha256: hash("wrong") }, fake.dependencies));
  assert.equal(fake.loads(), 0);
  let output = "", errors = "";
  assert.equal(await main([], { stdout: { write: value => { output += value; } }, stderr: { write: value => { errors += value; } } }), 1);
  assert.equal(output, ""); assert.equal(JSON.parse(errors).status, "refused_or_failed"); assert.equal(errors.includes(privateLiteral), false);
});
