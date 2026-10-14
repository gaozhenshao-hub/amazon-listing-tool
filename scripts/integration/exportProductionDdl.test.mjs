import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DDL_CATALOG, IDENTITY_SQL, collectProductionDdl, exportProductionDdl, main, parseArguments,
  validatePrivateDirectory, validateTableDdl, writePrivateExport } from "./exportProductionDdl.mjs";

const schema = "synthetic_export", uri = `mysql://fixture:private-password@invalid.test/${schema}`;
const options = { exportReadOnly: true, expectedSchema: schema };
const secret = "synthetic-private-schema-literal";
const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);
const row = (collection, values) => ({ ...Object.fromEntries(DDL_CATALOG[collection].fields.map(field => [field, null])), ...values });
function snapshot() {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(name => [name, []]));
  catalog.schema = [row("schema", { schemaName: schema, characterSetName: "utf8mb4", collationName: "utf8mb4_bin", defaultEncryption: "NO" })];
  catalog.tables = [row("tables", { tableName: "products", tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic", collationName: "utf8mb4_bin", tableComment: secret, createOptions: "", autoIncrement: "7" })];
  catalog.columns = [row("columns", { tableName: "products", columnName: "id", ordinalPosition: 1, dataType: "int", columnType: "int", isNullable: "NO", extra: "auto_increment" }),
    row("columns", { tableName: "products", columnName: "note", ordinalPosition: 2, dataType: "varchar", columnType: "varchar(50)", characterSetName: "utf8mb4", collationName: "utf8mb4_bin", columnDefault: secret, columnComment: secret, isNullable: "YES" })];
  catalog.indexes = [row("indexes", { tableName: "products", indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", direction: "A", indexType: "BTREE", visible: "YES" })];
  catalog.constraints = [row("constraints", { tableName: "products", constraintName: "PRIMARY", constraintType: "PRIMARY KEY", enforced: "YES" })];
  catalog.keyColumns = [row("keyColumns", { tableName: "products", constraintName: "PRIMARY", columnName: "id", ordinalPosition: 1 })];
  return { catalog, ddl: { products: `CREATE TABLE \`products\` (\n  \`id\` int NOT NULL AUTO_INCREMENT,\n  \`note\` varchar(50) DEFAULT '${secret}' COMMENT '${secret}',\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='${secret}'` } };
}

function fixture({ first = snapshot(), second = clone(first), identity = {}, failCollection, failDestroy = false, failRollback = false } = {}) {
  const calls = [], configs = []; let loads = 0, destroyed = 0, pass = -1, active = false;
  const snapshots = [first, second];
  const dependencies = { environment: { DATABASE_URL: uri, ANOTHER_SECRET: secret }, load: async () => {
    loads++;
    return async config => { configs.push(config); return {
      async query({ sql, timeout }, values) {
        calls.push({ sql, values }); assert.ok(timeout > 0 && timeout <= 5000);
        if (sql === IDENTITY_SQL) return [[{ schemaName: schema, version: "8.0.46", lowerCaseTableNames: 0, sqlMode: "STRICT_TRANS_TABLES", quoteShowCreate: 1, ...identity }]];
        if (sql.startsWith("SET SESSION ")) { assert.equal(active, false); return [[]]; }
        if (sql === "START TRANSACTION READ ONLY") { assert.equal(active, false); active = true; pass++; return [[]]; }
        if (sql === "ROLLBACK") {
          if (failRollback) throw Object.assign(new Error(secret), { code: "ER_FIXTURE_ROLLBACK" });
          assert.equal(active, true); active = false; return [[]];
        }
        assert.equal(active, true, "All catalog/SHOW reads must be inside read-only transactions");
        const entry = Object.entries(DDL_CATALOG).find(([, definition]) => definition.sql === sql);
        if (entry) {
          assert.deepEqual(values, Array((sql.match(/\?/g) ?? []).length).fill(schema));
          if (entry[0] === failCollection) throw Object.assign(new Error(secret), { code: "ER_FIXTURE_READ", sql: secret });
          return [clone(snapshots[pass].catalog[entry[0]])];
        }
        assert.equal(sql, `SHOW CREATE TABLE \`${schema}\`.\`products\``); assert.deepEqual(values, []);
        return [[{ Table: "products", "Create Table": snapshots[pass].ddl.products }]];
      },
      execute() { assert.fail("No arbitrary execution path"); },
      destroy() { destroyed++; if (failDestroy) throw Object.assign(new Error(secret), { code: "ER_FIXTURE_DESTROY" }); },
    }; };
  } };
  return { dependencies, calls, configs, loads: () => loads, destroyed: () => destroyed };
}

function privateDirectory() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amazon-ddl-export-test.")));
  fs.chmodSync(directory, 0o700);
  return directory;
}

test("import is inert even with invalid managed connection environment", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./scripts/integration/exportProductionDdl.mjs'); console.log('inert')"], {
    encoding: "utf8", env: { PATH: process.env.PATH, DATABASE_URL: "not a managed URI" },
  });
  assert.equal(result.status, 0); assert.equal(result.stdout, "inert\n"); assert.equal(result.stderr, "");
});

test("requires explicit read-only schema and output CLI; no host, arbitrary SQL, URL or duplicate overrides", () => {
  const args = ["--export-read-only", "--expected-schema", schema, "--output-directory", "/private/tmp/example"];
  assert.deepEqual(parseArguments(args), { ...options, outputDirectory: "/private/tmp/example" });
  for (const input of [[], args.slice(1), args.slice(0, -2), [...args, "--export-read-only"], [...args, "--sql", "SELECT 1"],
    [...args, "--url", uri], [...args, "--host", "elsewhere"], [...args, "--expected-schema", "other"],
    ["--export-read-only", "--expected-schema", "mysql", "--output-directory", "/private/tmp/example"]]) assert.throws(() => parseArguments(input));
});

test("rejects unsafe managed URI and missing consent before loading connector", async () => {
  for (const [input, environment] of [[{ ...options, exportReadOnly: false }, { DATABASE_URL: uri }], [options, {}],
    [options, { DATABASE_URL: uri.replace(schema, "different") }], [options, { DATABASE_URL: `${uri}?debug=true` }],
    [options, { DATABASE_URL: `${uri}?multipleStatements=true` }], [options, { DATABASE_URL: `${uri}?rowsAsArray=true` }]]) {
    const fake = fixture(); await assert.rejects(collectProductionDdl(input, { ...fake.dependencies, environment })); assert.equal(fake.loads(), 0);
  }
});

test("wrong identity fails before catalog and never leaks credentials/errors", async () => {
  for (const identity of [{ schemaName: "different" }, { schemaName: schema.toUpperCase() }, { version: "5.7.44" },
    { version: "8.0.46-MariaDB" }, { lowerCaseTableNames: 3 }, { quoteShowCreate: 0 }, { sqlMode: "NO_BACKSLASH_ESCAPES" }]) {
    const fake = fixture({ identity }), result = await collectProductionDdl(options, fake.dependencies);
    assert.equal(result.receipt.status, "failed"); assert.equal(result.artifact, undefined); assert.equal(fake.calls.length, 1);
    assert.equal(fake.destroyed(), 1); assert.equal(JSON.stringify(result).includes(secret), false); assert.equal(JSON.stringify(result).includes(uri), false);
  }
});

test("stable complete schema uses only fixed scoped metadata and SHOW CREATE, without any business/ledger row read", async () => {
  const fake = fixture(), result = await collectProductionDdl(options, fake.dependencies);
  assert.equal(result.receipt.status, "completed"); assert.equal(result.receipt.stable, true);
  assert.equal(result.receipt.hashes.first, result.receipt.hashes.second);
  assert.equal(result.receipt.captureSha256, hash(JSON.stringify(result.artifact)));
  assert.equal(result.artifact.tables[0].ddl, snapshot().ddl.products);
  assert.ok(JSON.stringify(result.artifact).includes(secret)); assert.equal(JSON.stringify(result.receipt).includes(secret), false);
  assert.equal(fake.calls.filter(call => call.sql.startsWith("SHOW CREATE")).length, 2);
  assert.equal(fake.calls.filter(call => call.sql === "START TRANSACTION READ ONLY").length, 2);
  const allowed = new Set([IDENTITY_SQL, ...Object.values(DDL_CATALOG).map(value => value.sql),
    "SET SESSION TRANSACTION READ ONLY", "SET SESSION MAX_EXECUTION_TIME = 5000", "SET SESSION lock_wait_timeout = 5",
    "START TRANSACTION READ ONLY", "ROLLBACK", `SHOW CREATE TABLE \`${schema}\`.\`products\``]);
  assert.ok(fake.calls.every(call => allowed.has(call.sql)));
  assert.ok(fake.calls.filter(call => call.sql.startsWith("SELECT") && call.sql !== IDENTITY_SQL).every(call => call.sql.includes("information_schema.")));
  assert.equal(fake.configs[0].multipleStatements, false); assert.equal(fake.configs[0].bigNumberStrings, true);
  assert.equal(result.receipt.businessRowsRead, false); assert.equal(result.receipt.databaseWrites, false);
  assert.equal(result.receipt.replayPerformed, false); assert.equal(fake.destroyed(), 1);
});

test("DDL, comments, defaults and AUTO_INCREMENT changes fail closed without artifact or raw error output", async () => {
  for (const mutate of [value => { value.ddl.products = value.ddl.products.replace("AUTO_INCREMENT=7", "AUTO_INCREMENT=8"); },
    value => { value.catalog.columns[1].columnDefault = "different-private-default"; },
    value => { value.catalog.tables[0].tableComment = "different-private-comment"; },
    value => { value.catalog.tables[0].autoIncrement = "8"; }]) {
    const first = snapshot(), second = clone(first); mutate(second);
    const result = await collectProductionDdl(options, fixture({ first, second }).dependencies);
    assert.equal(result.receipt.error.code, "DDL_CHANGED_BETWEEN_OBSERVATIONS"); assert.equal(result.receipt.stable, false);
    assert.equal(result.artifact, undefined); assert.ok(result.receipt.observedChanges);
    assert.equal(JSON.stringify(result.receipt).includes("different-private"), false);
  }
});

test("unsupported views/triggers/routines/events/partitions reject before SHOW; never silently omit", async () => {
  for (const name of ["views", "triggers", "routines", "events", "partitions"]) {
    const first = snapshot(); first.catalog[name] = [row(name, {})];
    const fake = fixture({ first }), result = await collectProductionDdl(options, fake.dependencies);
    assert.equal(result.receipt.error.code, `UNSUPPORTED_${name.toUpperCase()}`); assert.equal(result.artifact, undefined);
    assert.equal(fake.calls.some(call => call.sql.startsWith("SHOW")), false);
  }
});

test("non-InnoDB, spatial, encryption, malformed/missing catalog and unsafe table identifiers reject", async () => {
  for (const mutate of [value => { value.catalog.tables[0].engine = "FEDERATED"; }, value => { value.catalog.tables[0].tableType = "VIEW"; },
    value => { value.catalog.tables[0].tableName = "unsafe`;SELECT"; }, value => { value.catalog.schema[0].defaultEncryption = "YES"; },
    value => { value.catalog.columns[0].dataType = "geometry"; }, value => { value.catalog.columns[0].srsId = 4326; },
    value => { value.catalog.columns = []; }, value => { delete value.catalog.columns[0].columnDefault; },
    value => { value.catalog.columns[0].tableName = "other"; }]) {
    const first = snapshot(); mutate(first); const fake = fixture({ first }), result = await collectProductionDdl(options, fake.dependencies);
    assert.equal(result.receipt.status, "failed"); assert.equal(result.artifact, undefined); assert.equal(fake.calls.some(call => call.sql.startsWith("SHOW")), false);
  }
});

test("catalog row and table-count bounds fail before any SHOW or output artifact", async () => {
  for (const mutate of [value => { value.catalog.views = Array(100_001).fill(null); },
    value => { value.catalog.tables = Array.from({ length: 1001 }, (_, index) => ({ ...value.catalog.tables[0], tableName: `table_${index}` })); }]) {
    const first = snapshot(); mutate(first); const fake = fixture({ first });
    const result = await collectProductionDdl(options, fake.dependencies);
    assert.equal(result.receipt.status, "failed"); assert.equal(result.artifact, undefined);
    assert.equal(fake.calls.some(call => call.sql.startsWith("SHOW")), false);
  }
});

test("external or missing FK target rejects even if the other FK catalog omits it", async () => {
  for (const collection of ["keyColumns", "foreignKeys"]) {
    const first = snapshot();
    first.catalog[collection].push(row(collection, { tableName: "products", referencedTableSchema: "external", uniqueConstraintSchema: "external", referencedTableName: "secrets" }));
    const result = await collectProductionDdl(options, fixture({ first }).dependencies);
    assert.equal(result.receipt.error.code, "EXTERNAL_OR_MISSING_FOREIGN_KEY_TARGET"); assert.equal(result.artifact, undefined);
  }
});

test("DDL allows literal/comment text, ON UPDATE timestamps and internal FK actions without rewriting", () => {
  const ddl = "CREATE TABLE `products` (`id` int, `updatedAt` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, `note` varchar(20) DEFAULT 'DROP; UPDATE; private' COMMENT 'DATA DIRECTORY', CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT) ENGINE=InnoDB";
  assert.equal(validateTableDdl(ddl, "products").ddl, ddl);
});

test("external/executable DDL, table mismatch and extra statements reject", () => {
  const base = "CREATE TABLE `products` (`id` int) ENGINE=InnoDB";
  for (const ddl of [base + "; DROP TABLE products", base + " DATA DIRECTORY='/outside'", base + " TABLESPACE `outside`", base + " CONNECTION='remote'",
    base + " /*!50100 PARTITION BY HASH (`id`) PARTITIONS 2 */", base + " ENCRYPTION='Y'", base.replace("products", "other"), base + " WITH PARSER custom"]) {
    assert.throws(() => validateTableDdl(ddl, "products"));
  }
});

test("query, rollback and destroy errors fail closed with safe error codes only", async () => {
  for (const flags of [{ failCollection: "columns" }, { failRollback: true }, { failDestroy: true }]) {
    const fake = fixture(flags), result = await collectProductionDdl(options, fake.dependencies);
    assert.equal(result.receipt.status, "failed"); assert.equal(result.artifact, undefined); assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(fake.destroyed(), 1);
  }
});

test("private directory requires canonical 0700 owned directory, no symlinks", () => {
  const directory = privateDirectory();
  assert.doesNotThrow(() => validatePrivateDirectory(directory));
  for (const mode of [0o755, 0o777, 0o750, 0o1700]) { fs.chmodSync(directory, mode); assert.throws(() => validatePrivateDirectory(directory)); }
  fs.chmodSync(directory, 0o700);
  assert.throws(() => validatePrivateDirectory(`${directory}/../${path.basename(directory)}`));
  const holder = privateDirectory(), link = path.join(holder, "link"); fs.symlinkSync(directory, link);
  assert.throws(() => validatePrivateDirectory(link));
});

test("saves exact raw private JSON and safe receipt as exclusive 0600, never overwrites", async () => {
  const directory = privateDirectory(), result = await collectProductionDdl(options, fixture().dependencies);
  const receipt = writePrivateExport(result, directory);
  const files = fs.readdirSync(directory); assert.deepEqual(files.sort(), ["export-receipt.json", "production-ddl.json"]);
  for (const name of files) assert.equal(fs.statSync(path.join(directory, name)).mode & 0o777, 0o600);
  const bytes = fs.readFileSync(receipt.privateFiles.artifact);
  assert.equal(hash(bytes), receipt.artifactFileSha256); assert.deepEqual(JSON.parse(bytes), result.artifact);
  assert.equal(fs.readFileSync(receipt.privateFiles.receipt, "utf8").includes(secret), false);
  assert.throws(() => writePrivateExport(result, directory), { code: "PRIVATE_EXPORT_DIRECTORY_MUST_BE_EMPTY" });
  assert.equal(hash(fs.readFileSync(receipt.privateFiles.artifact)), receipt.artifactFileSha256);
});

test("unstable or tampered capture cannot be saved; nonprivate path refuses before connection", async () => {
  const result = await collectProductionDdl(options, fixture().dependencies), directory = privateDirectory();
  const tampered = clone(result); tampered.artifact.tables[0].ddl += " changed";
  assert.throws(() => writePrivateExport(tampered, directory), { code: "ONLY_VERIFIED_STABLE_EXPORT_CAN_BE_SAVED" });
  assert.throws(() => writePrivateExport({ receipt: { status: "failed" } }, directory));
  fs.chmodSync(directory, 0o755); const fake = fixture();
  await assert.rejects(exportProductionDdl({ ...options, outputDirectory: directory }, fake.dependencies)); assert.equal(fake.loads(), 0);
});

test("nonempty directory and pre-existing symlink refuse before connector load", async () => {
  const directory = privateDirectory(), target = privateDirectory();
  fs.symlinkSync(target, path.join(directory, "production-ddl.json"));
  const fake = fixture();
  await assert.rejects(exportProductionDdl({ ...options, outputDirectory: directory }, fake.dependencies), { code: "PRIVATE_EXPORT_DIRECTORY_MUST_BE_EMPTY" });
  assert.equal(fake.loads(), 0); assert.equal(fs.lstatSync(path.join(directory, "production-ddl.json")).isSymbolicLink(), true);
});

test("CLI stdout contains only safe receipt/counts/hashes/paths, never raw defaults or DDL", async () => {
  const directory = privateDirectory(); let stdout = "", stderr = "";
  const exitCode = await main(["--export-read-only", "--expected-schema", schema, "--output-directory", directory], {
    dependencies: fixture().dependencies, stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } },
  });
  assert.equal(exitCode, 0); assert.equal(stderr, ""); assert.equal(stdout.includes(secret), false); assert.equal(stdout.includes("CREATE TABLE"), false);
  assert.equal(stdout.includes("private-password"), false); assert.equal(JSON.parse(stdout).privateFilesCreated, 2);
});
