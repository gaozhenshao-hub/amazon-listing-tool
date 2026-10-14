import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  BINARY_BUNDLE, parseArguments, validateBinaries, nativeEnvironment, nativeArguments,
  syntheticMigration, normalizeCreateTable, compareSnapshots, validateDump, runNative, runSnapshotRehearsal,
} from "./mysqlSnapshotRehearsal.mjs";
import { connectionOptions } from "./mysqlRehearsal.mjs";

const root = "/private/tmp/amazon-mysql8-rehearsal.snapshot-test";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const options = { executeLocal: true, root, socket: `${root}/mysql.sock`, datadir: `${root}/data`,
  bindir: `${root}/${BINARY_BUNDLE}/bin`, output: path.join(repo, "artifacts/snapshot-pure-test.json") };
const schema = "amazon_rehearsal_0123456789abcdef_synthetic";
const args = ["--execute-local", ...["root", "socket", "datadir", "bindir", "output"].flatMap(key => [`--${key}`, options[key]])];
const code = expected => error => error.code === expected;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const clone = value => structuredClone(value);
const ledgerDDL = "CREATE TABLE `app_schema_migrations` (`migrationName` varchar(255) NOT NULL, `checksum` varchar(64) NOT NULL, `status` varchar(20) NOT NULL, PRIMARY KEY (`migrationName`), KEY `idx_status` (`status`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
const itemsDDL = "CREATE TABLE `rehearsal_snapshot_items` (`id` int NOT NULL, `sku` varchar(40) NOT NULL, `label` varchar(100) NOT NULL, `category` varchar(30) NOT NULL, `quantity` int NOT NULL, `note` text, PRIMARY KEY (`id`), UNIQUE KEY `uq_snapshot_sku` (`sku`), KEY `idx_snapshot_category` (`category`,`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci";
const dump = Buffer.from(`/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n${ledgerDDL};\n${itemsDDL};\nINSERT INTO \`rehearsal_snapshot_items\` VALUES (1,'SYN-A','中文样品 😀','合成配件',3,'O\\'Brien：仅本地演练');\n`);

function fakeFs(overrides = {}) {
  return {
    realpathSync: value => path.normalize(value).replace(/\/$/, ""),
    lstatSync: value => ({ mode: 0o100755,
      isDirectory: () => [root, options.datadir, path.dirname(options.bindir), options.bindir].includes(value),
      isSocket: () => value === options.socket,
      isSymbolicLink: () => false,
      isFile: () => ["mysql", "mysqldump"].some(name => value === `${options.bindir}/${name}`),
    }),
    existsSync: () => false,
    ...overrides,
  };
}

function snapshot() {
  const migration = syntheticMigration();
  return { structure: { app_schema_migrations: normalizeCreateTable(ledgerDDL), rehearsal_snapshot_items: normalizeCreateTable(itemsDDL) },
    rows: [
      { id: 1, sku: "SYN-A", label: "中文样品 😀", category: "合成配件", quantity: 3, note: "O'Brien：仅本地演练" },
      { id: 2, sku: "SYN-B", label: "恢复验证", category: "合成配件", quantity: 0, note: null },
      { id: 3, sku: "SYN-C", label: "索引校验", category: "合成工具", quantity: 7, note: "不含业务数据" },
    ], ledger: [{ migrationName: migration.fileName, checksum: migration.checksum, status: "succeeded", executionId: "private-execution-id",
      startedAt: "2026-10-14 00:00:01", finishedAt: "2026-10-14 00:00:02", error: null, metadata: "{\"private\":true}",
      createdAt: "2026-10-14 00:00:01", updatedAt: "2026-10-14 00:00:02" }] };
}

// No SQL engine, filesystem writes, network or native executable is used by this
// orchestration double. Each connection owns a fixed database; USE is forbidden.
function workflow({ badIdentityConnection, badCurrentSchema, mutateRestored, mutateSourceOnRepeat,
  mutateRepeat, dumpBytes = dump, dumpMode = 0o100600, nativeFailure, releaseFailure, shortRead = false } = {}) {
  const databases = new Map(), connections = [], events = [], receipts = [], nativeCalls = [], applyConnections = [];
  let loaded = 0, releases = 0, dumpDescriptorOpen = false, destroyed = 0;
  const state = async connection => {
    const [[row]] = await connection.query("SELECT DATABASE() AS schemaName");
    assert.ok(databases.has(row.schemaName));
    return databases.get(row.schemaName);
  };
  const runner = {
    acquireMigrationLock: async (connection, lockOptions) => {
      const [[row]] = await connection.query("SELECT DATABASE() AS schemaName");
      assert.equal(row.schemaName, null); assert.equal(lockOptions.timeoutSeconds, 2);
      events.push("lock");
      return async () => { releases++; if (releaseFailure) throw Object.assign(new Error("private lock detail"), { code: "ER_TEST_RELEASE" }); };
    },
    ensureLedger: async connection => { const current = await state(connection); assert.equal(current.snapshot, null); events.push("ensureLedger"); },
    applyMigrations: async (connection, migrations, policy) => {
      const current = await state(connection);
      applyConnections.push(connection);
      assert.deepEqual(migrations, [syntheticMigration()]); assert.deepEqual(policy, { retryFailed: false });
      events.push("apply");
      if (current.snapshot) {
        if (mutateRepeat) mutateRepeat(current.snapshot);
        if (mutateSourceOnRepeat) mutateSourceOnRepeat([...databases.values()][0].snapshot);
      } else current.snapshot = snapshot();
    },
    loadMigrationPlan: () => assert.fail("Business migration plan must never load"),
  };
  const createConnection = async config => {
    const id = connections.length + 1, database = config.database ?? null;
    assert.deepEqual(config, { ...connectionOptions(options), dateStrings: true, timezone: "Z", ...(database ? { database } : {}) });
    if (database) assert.ok(databases.has(database));
    const raw = {
      config,
      async query({ sql, timeout }) {
        assert.equal(timeout, 30_000); events.push({ id, database, sql });
        assert.doesNotMatch(sql, /^USE\b|\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i);
        if (sql.startsWith("SELECT @@version")) return [[{ version: "8.4.11", datadir: `${options.datadir}/`, socket: options.socket,
          skipNetworking: badIdentityConnection === id ? 0 : 1 }]];
        if (sql === "SELECT DATABASE() AS schemaName") return [[{ schemaName: badCurrentSchema === id ? "wrong_database" : database }]];
        const create = sql.match(/^CREATE DATABASE `(amazon_rehearsal_[a-f0-9]{16}_synthetic)` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci$/);
        if (create) {
          assert.equal(database, null); assert.equal(databases.has(create[1]), false);
          databases.set(create[1], { snapshot: null }); return [[]];
        }
        assert.ok(database, "Data queries must use dedicated schema connections");
        if (sql === "SET time_zone = '+00:00'") return [[]];
        const current = databases.get(database).snapshot;
        assert.ok(current);
        if (sql.startsWith("SELECT table_name AS tableName FROM information_schema.tables")) return [Object.keys(current.structure).sort().map(tableName => ({ tableName }))];
        const show = sql.match(/^SHOW CREATE TABLE `([^`]+)`$/);
        if (show) return [[{ "Create Table": current.structure[show[1]] }]];
        if (sql === "SELECT * FROM rehearsal_snapshot_items ORDER BY id") return [clone(current.rows)];
        if (sql === "SELECT * FROM app_schema_migrations ORDER BY migrationName") return [clone(current.ledger)];
        assert.fail(`Unexpected test-double query: ${sql}`);
      },
      execute: () => assert.fail("Fixture runner does not issue SQL statements"),
      destroy: () => { destroyed++; },
    };
    connections.push(raw);
    return raw;
  };
  const io = fakeFs({
    openSync: (filename, flags, mode) => {
      assert.equal(path.dirname(filename), root); assert.match(path.basename(filename), /^snapshot-[a-f0-9]{16}\.sql$/);
      assert.equal(flags, "wx+"); assert.equal(mode, 0o600); assert.equal(dumpDescriptorOpen, false); dumpDescriptorOpen = true; return 17;
    },
    fstatSync: fd => { assert.equal(fd, 17); assert.equal(dumpDescriptorOpen, true); return { mode: dumpMode, size: dumpBytes.length, isFile: () => true }; },
    readSync: (fd, buffer, offset, length, position) => {
      assert.equal(fd, 17); assert.equal(position, 0); dumpBytes.copy(buffer, offset, 0, length); return shortRead ? length - 1 : length;
    },
    closeSync: fd => { assert.equal(fd, 17); assert.equal(dumpDescriptorOpen, true); dumpDescriptorOpen = false; events.push("closeDump"); },
    writeFileSync: (filename, content, flags) => {
      assert.equal(filename, options.output); assert.deepEqual(flags, { flag: "wx", mode: 0o600 }); receipts.push(JSON.parse(content));
    },
  });
  const native = async call => {
    nativeCalls.push(call);
    assert.equal(call.root, root); assert.equal(call.signal.aborted, false);
    const kind = path.basename(call.binary);
    if (nativeFailure === kind) throw Object.assign(new Error("private stderr SQL content"), { code: "MYSQL_CLIENT_FAILED" });
    if (kind === "mysqldump") {
      assert.equal(dumpDescriptorOpen, true); assert.equal(call.outputFd, 17);
      assert.equal(databases.size, 1); assert.equal(call.args.at(-1), [...databases.keys()][0]);
    } else {
      assert.equal(kind, "mysql"); assert.equal(dumpDescriptorOpen, false);
      assert.deepEqual(call.input, dumpBytes); assert.equal(databases.size, 2);
      const [source, restored] = [...databases.keys()];
      assert.ok(call.args.includes(`--database=${restored}`)); assert.notEqual(source, restored);
      const restoredSnapshot = clone(databases.get(source).snapshot);
      if (mutateRestored) mutateRestored(restoredSnapshot);
      databases.get(restored).snapshot = restoredSnapshot;
    }
  };
  return { dependencies: { io, environment: {}, argv: [], load: async () => { loaded++; return { runner, createConnection }; }, native },
    databases, connections, events, receipts, nativeCalls, applyConnections,
    loaded: () => loaded, releases: () => releases, destroyed: () => destroyed, dumpOpen: () => dumpDescriptorOpen };
}

test("import remains inert even with a forbidden inherited DB target", () => {
  const url = new URL("./mysqlSnapshotRehearsal.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)}); console.log('IMPORT_SAFE')`],
    { encoding: "utf8", env: { PATH: "/usr/bin:/bin", DATABASE_URL: "must-not-read-or-connect" }, timeout: 10_000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, "IMPORT_SAFE\n"); assert.equal(result.stderr, "");
});

test("CLI requires execute flag and every local path, rejects duplicates and extra controls", () => {
  assert.deepEqual(parseArguments(args), options);
  for (const invalid of [[], args.slice(1), args.slice(0, -2), [...args, "--execute-local"], [...args, "--bindir", options.bindir],
    [...args, "--database", "production"], [...args, "--host", "localhost"], [...args.slice(0, -1), "bad\0path"]]) assert.throws(() => parseArguments(invalid));
});

test("only direct canonical official-bundle executables are accepted", () => {
  assert.deepEqual(validateBinaries(root, options.bindir, fakeFs()), { mysql: `${options.bindir}/mysql`, mysqldump: `${options.bindir}/mysqldump` });
  for (const bindir of ["/usr/local/bin", `${root}/bin`, `${root}/${BINARY_BUNDLE}/other/../bin`, `${root}/nested/${BINARY_BUNDLE}/bin`]) {
    assert.throws(() => validateBinaries(root, bindir, fakeFs()), code("OFFICIAL_LOCAL_BINARY_DIRECTORY_REQUIRED"));
  }
  for (const target of [path.dirname(options.bindir), options.bindir, `${options.bindir}/mysql`, `${options.bindir}/mysqldump`]) {
    const original = fakeFs();
    assert.throws(() => validateBinaries(root, options.bindir, fakeFs({ realpathSync: value => value === target ? "/somewhere-else" : value })));
    assert.throws(() => validateBinaries(root, options.bindir, fakeFs({ lstatSync: value => ({ ...original.lstatSync(value), isSymbolicLink: () => value === target }) })));
  }
  const original = fakeFs();
  assert.throws(() => validateBinaries(root, options.bindir, fakeFs({ lstatSync: value => ({ ...original.lstatSync(value), mode: 0o100644 }) })), code("BINARY_MUST_BE_REGULAR_LOCAL_EXECUTABLE"));
});

test("native commands have no configuration, login-path, network, DROP or alternate DB flags", () => {
  assert.deepEqual(nativeEnvironment(root), { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: root });
  for (const kind of ["dump", "restore"]) {
    const values = nativeArguments(kind, options.socket, schema);
    assert.deepEqual(values.slice(0, 3), ["--no-defaults", "--no-login-paths", "--protocol=SOCKET"]);
    assert.ok(values.includes(`--socket=${options.socket}`)); assert.ok(values.includes("--password="));
    assert.equal(values.some(value => /^--(?:host|port|defaults-file|defaults-extra-file|login-path|databases|add-drop)/.test(value)), false);
  }
  assert.deepEqual(nativeArguments("dump", options.socket, schema).slice(7), ["--single-transaction", "--no-tablespaces", "--set-gtid-purged=OFF",
    "--skip-add-drop-table", "--skip-comments", "--skip-dump-date", "--skip-add-locks", "--skip-triggers", schema]);
  assert.ok(nativeArguments("restore", options.socket, schema).includes("--local-infile=0"));
  assert.ok(nativeArguments("restore", options.socket, schema).includes("--binary-mode=1"));
  for (const target of ["production", "mysql", schema.replace("synthetic", "general"), `${schema};DROP DATABASE x`]) {
    assert.throws(() => nativeArguments("dump", options.socket, target), code("NON_SYNTHETIC_SCHEMA_FORBIDDEN"));
  }
  assert.throws(() => nativeArguments("dump", "/tmp/mysql.sock", schema), code("LOCAL_SOCKET_REQUIRED"));
  assert.throws(() => nativeArguments("other", options.socket, schema), code("UNKNOWN_CLIENT_ACTION"));
});

test("synthetic migration is fixed, checksum-valid and includes Unicode, unique and secondary indexes", () => {
  const migration = syntheticMigration();
  assert.equal(migration.checksum, hash(migration.sql)); assert.equal(migration.official, false);
  assert.match(migration.sql, /中文样品 😀/); assert.match(migration.sql, /UNIQUE KEY uq_snapshot_sku/);
  assert.match(migration.sql, /KEY idx_snapshot_category/); assert.match(migration.sql, /NULL/);
  assert.doesNotMatch(migration.sql, /\b(?:DROP|USE|DATABASE)\b/);
});

test("DDL normalization preserves quoted whitespace, escaping, indexes, collation and auto-increment", () => {
  const ddl = " CREATE\n TABLE `x  x` (\n `id` int, `note` varchar(40) DEFAULT 'two  spaces',\n UNIQUE KEY `uq` (`id`)\n ) ENGINE=InnoDB AUTO_INCREMENT=5 COLLATE=utf8mb4_0900_ai_ci ";
  const normalized = normalizeCreateTable(ddl);
  assert.equal(normalized, "CREATE TABLE `x  x` ( `id` int, `note` varchar(40) DEFAULT 'two  spaces', UNIQUE KEY `uq` (`id`) ) ENGINE=InnoDB AUTO_INCREMENT=5 COLLATE=utf8mb4_0900_ai_ci");
  assert.notEqual(normalized, normalizeCreateTable(ddl.replace("two  spaces", "two spaces")));
  assert.notEqual(normalized, normalizeCreateTable(ddl.replace("AUTO_INCREMENT=5", "AUTO_INCREMENT=6")));
  assert.notEqual(normalized, normalizeCreateTable(ddl.replace("UNIQUE KEY", "KEY")));
  assert.notEqual(normalized, normalizeCreateTable(ddl.replace("0900_ai_ci", "bin")));
  assert.match(normalizeCreateTable("CREATE TABLE `x``x` (`note` text DEFAULT 'O''Brien\\'s')"), /O''Brien/);
  assert.throws(() => normalizeCreateTable("CREATE TABLE `broken"), code("UNTERMINATED_CREATE_TABLE_QUOTE"));
  assert.throws(() => normalizeCreateTable("DROP TABLE x"), code("CREATE_TABLE_EXPECTED"));
});

test("snapshot comparison covers every ledger field, all row contents and all structure", () => {
  const before = snapshot(), result = compareSnapshots(before, clone(before));
  assert.equal(result.tableCount, 2); assert.equal(result.rowCount, 3); assert.equal(result.ledgerCount, 1);
  assert.equal(result.fullLedgerSha256, hash(JSON.stringify(before.ledger)));
  for (const field of Object.keys(before.ledger[0])) {
    const after = clone(before); after.ledger[0][field] = "changed";
    assert.throws(() => compareSnapshots(before, after));
  }
  for (const change of [after => after.rows[0].note = "changed", after => after.rows.push(clone(after.rows[0])),
    after => delete after.structure.app_schema_migrations, after => after.structure.rehearsal_snapshot_items += " ROW_FORMAT=DYNAMIC"]) {
    const after = clone(before); change(after); assert.throws(() => compareSnapshots(before, after));
  }
  assert.doesNotMatch(JSON.stringify(result), /中文|SYN-A|private-execution-id|migrationName/);
});

test("generated dump validation accepts Unicode and quoted keywords without leaking rows", () => {
  const bytes = Buffer.concat([dump, Buffer.from("INSERT INTO `rehearsal_snapshot_items` VALUES (4,'DROP DATABASE production; USE other');\n")]);
  assert.deepEqual(validateDump(bytes), { bytes: bytes.length, sha256: hash(bytes) });
});

test("dump validation refuses executable forbidden operations and mysql client escape commands", () => {
  for (const sql of ["DROP TABLE x;", "/*!40000 DROP TABLE x */;", "CREATE DATABASE other;", "ALTER SCHEMA other DEFAULT CHARACTER SET utf8mb4;",
    "USE other;", "GRANT ALL ON *.* TO x;", "SET @@GLOBAL.read_only=0;", "LOAD DATA LOCAL INFILE 'x' INTO TABLE y;",
    "SELECT 1 INTO OUTFILE '/tmp/other';", "CREATE USER x;", "INSTALL PLUGIN x SONAME 'y';", "SHUTDOWN;",
    "\\. /tmp/x", "\\! arbitrary", "source /tmp/x", "system arbitrary", "connect other", "delimiter $$",
    "CREATE TABLE `other`.`x` (id int);", "INSERT INTO other.x VALUES (1);", "ALTER TABLE `other`.`x` DISABLE KEYS;"]) {
    assert.throws(() => validateDump(Buffer.concat([dump, Buffer.from(`\n${sql}\n`)])), undefined, sql);
  }
  assert.throws(() => validateDump(Buffer.alloc(0)), code("DUMP_SIZE_INVALID"));
  assert.throws(() => validateDump(Buffer.alloc(1024 * 1024 + 1)), code("DUMP_SIZE_INVALID"));
  assert.throws(() => validateDump(Buffer.from([0xff])), code("DUMP_ENCODING_INVALID"));
  assert.throws(() => validateDump(Buffer.from(itemsDDL)), code("SYNTHETIC_DUMP_TABLE_MISSING"));
});

test("native process runner uses whitelisted environment, direct fd and validated stdin bytes", async () => {
  for (const restore of [false, true]) {
    let observed;
    const child = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = input => assert.deepEqual(input, dump);
    const spawn = (binary, values, settings) => {
      observed = { binary, values, settings }; queueMicrotask(() => { child.stderr.emit("data", "private SQL detail"); child.emit("close", 0); }); return child;
    };
    await runNative({ binary: `${options.bindir}/${restore ? "mysql" : "mysqldump"}`, args: ["controlled"], root,
      ...(restore ? { input: dump } : { outputFd: 17 }) }, spawn);
    assert.equal(observed.settings.shell, false); assert.equal(observed.settings.cwd, root);
    assert.deepEqual(observed.settings.env, nativeEnvironment(root)); assert.equal(observed.settings.timeout, 60_000);
    assert.equal(observed.settings.killSignal, "SIGKILL");
    assert.deepEqual(observed.settings.stdio, restore ? ["pipe", "ignore", "pipe"] : ["ignore", 17, "pipe"]);
  }
});

test("native failures and broken input pipes redact raw stderr/errors", async () => {
  for (const kind of ["error", "close", "stdin"]) {
    const child = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = () => {};
    const spawn = () => { queueMicrotask(() => {
      const privateError = new Error("private SQL password secret");
      child.stderr.emit("data", privateError.message);
      if (kind === "stdin") child.stdin.emit("error", privateError);
      else child.emit(kind, kind === "close" ? 1 : privateError);
    }); return child; };
    await assert.rejects(runNative({ binary: "unused", args: [], root, input: dump }, spawn), error => error.code === "MYSQL_CLIENT_FAILED" && !/private|secret/.test(error.message));
  }
});

test("orchestration uses three fixed-scope connections, full snapshots and metadata-only receipt", async () => {
  const fixture = workflow();
  const receipt = await runSnapshotRehearsal(options, fixture.dependencies);
  assert.equal(receipt.status, "completed"); assert.equal(fixture.loaded(), 1); assert.equal(fixture.releases(), 1);
  assert.equal(fixture.connections.length, 3); assert.equal(fixture.destroyed(), 3); assert.equal(fixture.dumpOpen(), false);
  assert.equal(fixture.applyConnections.length, 2); assert.notEqual(...fixture.applyConnections);
  assert.equal(fixture.connections[0].config.database, undefined);
  assert.equal(fixture.connections[1].config.database, receipt.schemas.source);
  assert.equal(fixture.connections[2].config.database, receipt.schemas.restored);
  assert.notEqual(receipt.schemas.source, receipt.schemas.restored);
  assert.deepEqual(receipt.schemaIsolation, { separateConnections: true, noUseStatements: true, sourceUnchanged: true });
  assert.deepEqual(receipt.repeatAfterRestore, { unchanged: true, duplicateRows: 0, fullLedgerUnchanged: true });
  assert.equal(receipt.restoration.tableCount, 2); assert.equal(receipt.restoration.rowCount, 3); assert.equal(receipt.restoration.ledgerCount, 1);
  assert.equal(receipt.productionValidated, false); assert.equal(receipt.productionBackupChainValidated, false); assert.equal(receipt.businessMigrationsExecuted, false);
  assert.deepEqual(fixture.receipts, [receipt]); assert.equal(fixture.nativeCalls.length, 2);
  assert.doesNotMatch(JSON.stringify(receipt), /中文|SYN-A|private-execution-id|CREATE TABLE|2026-10-14 00:00:01/);
  assert.equal(fixture.events.filter(event => typeof event === "object" && /^CREATE DATABASE/.test(event.sql)).length, 2);
  assert.equal(fixture.events.filter(event => typeof event === "object" && event.sql === "SELECT * FROM app_schema_migrations ORDER BY migrationName").length, 4);
});

test("preflight rejects environment, unsafe paths, existing output and absent explicit execution before imports", async () => {
  for (const [override, dependencyChange] of [
    [{ executeLocal: false }, {}], [{ output: undefined }, {}], [{ root: "/private/tmp/other" }, {}],
    [{ socket: "/tmp/mysql.sock" }, {}], [{ bindir: "/usr/bin" }, {}], [{ output: "/tmp/receipt.json" }, {}],
    [{}, { environment: { DATABASE_URL: "must-never-connect" } }], [{}, { environment: { NODE_OPTIONS: "--import hidden" } }],
    [{}, { argv: ["dotenv_config_path=.env"] }], [{}, { io: fakeFs({ existsSync: () => true }) }],
  ]) {
    const fixture = workflow();
    await assert.rejects(runSnapshotRehearsal({ ...options, ...override }, { ...fixture.dependencies, ...dependencyChange }));
    assert.equal(fixture.loaded(), 0); assert.equal(fixture.nativeCalls.length, 0);
  }
});

test("server identity and database scope are checked before each scoped write", async () => {
  for (const failure of [{ badIdentityConnection: 1 }, { badIdentityConnection: 2 }, { badIdentityConnection: 3 }, { badCurrentSchema: 2 }, { badCurrentSchema: 3 }]) {
    const fixture = workflow(failure); const receipt = await runSnapshotRehearsal(options, fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(fixture.destroyed(), fixture.connections.length);
    assert.equal(fixture.applyConnections.length, failure.badIdentityConnection === 3 || failure.badCurrentSchema === 3 ? 1 : 0);
    if (failure.badIdentityConnection === 1) { assert.equal(fixture.databases.size, 0); assert.equal(fixture.releases(), 0); }
    else assert.equal(fixture.releases(), 1);
    assert.ok(fixture.nativeCalls.every(call => path.basename(call.binary) === "mysqldump"));
  }
});

test("unsafe or nonprivate dumps refuse restore and close the private descriptor", async () => {
  for (const failure of [{ dumpBytes: Buffer.concat([dump, Buffer.from("DROP TABLE x;")]) }, { dumpMode: 0o100644 }, { shortRead: true }, { dumpBytes: Buffer.alloc(0) }]) {
    const fixture = workflow(failure); const receipt = await runSnapshotRehearsal(options, fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(fixture.nativeCalls.length, 1); assert.equal(fixture.databases.size, 1);
    assert.equal(fixture.dumpOpen(), false); assert.equal(fixture.releases(), 1);
  }
});

test("restore drift in rows, complete ledger or structure fails before idempotence apply", async () => {
  for (const mutateRestored of [value => value.rows[0].label = "drift", value => value.ledger[0].metadata = "changed",
    value => value.ledger[0].startedAt = "changed", value => value.structure.rehearsal_snapshot_items = value.structure.rehearsal_snapshot_items.replace("UNIQUE KEY", "KEY")]) {
    const fixture = workflow({ mutateRestored }); const receipt = await runSnapshotRehearsal(options, fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(fixture.applyConnections.length, 1); assert.equal(receipt.repeatAfterRestore, undefined);
    assert.doesNotMatch(JSON.stringify(receipt), /private-execution-id|中文|CREATE TABLE/);
  }
});

test("repeat drift and source mutation cannot be reported as restored successfully", async () => {
  for (const failure of [{ mutateRepeat: value => value.rows.push(clone(value.rows[0])) },
    { mutateRepeat: value => value.ledger[0].executionId = "new execution" }, { mutateSourceOnRepeat: value => value.ledger[0].metadata = "cross-schema corruption" }]) {
    const fixture = workflow(failure); const receipt = await runSnapshotRehearsal(options, fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(fixture.applyConnections.length, 2);
    assert.equal(receipt.repeatAfterRestore, undefined); assert.equal(receipt.schemaIsolation, undefined);
  }
});

test("dump, restore and lock-release failures clean up without deleting schema or leaking errors", async () => {
  for (const failure of [{ nativeFailure: "mysqldump" }, { nativeFailure: "mysql" }, { releaseFailure: true }]) {
    const fixture = workflow(failure); const receipt = await runSnapshotRehearsal(options, fixture.dependencies);
    assert.equal(receipt.status, "failed"); assert.equal(fixture.releases(), 1); assert.equal(fixture.dumpOpen(), false);
    assert.equal(fixture.destroyed(), fixture.connections.length); assert.equal(fixture.receipts.length, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /private stderr|private lock|SQL content/);
  }
});
