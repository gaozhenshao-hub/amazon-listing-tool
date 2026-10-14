// Platform refusal contracts and mocked preflight only. Never starts MySQL,
// loads dotenv/the runner or connects to a guest/production database.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateLinuxRuntime, validateLinuxEnvironment, validateLinuxPaths as validateLinuxPathsImpl, validateLinuxBinaries,
  validateLinuxServer, validateLinuxPluginRows, linuxNativeArguments, createHistoricalPlatformProfile,
  linuxNativeEnvironment, runLinuxNative,
} from "./historicalPlatformProfile.mjs";
import { parseArguments, runRehearsal } from "./historicalPrerequisiteRehearsal.mjs";
import { nativeArguments, nativeEnvironment, parseArguments as parseSnapshotArgs } from "./mysqlSnapshotRehearsal.mjs";
import { parseArguments as parseGeneralArgs } from "./mysqlRehearsal.mjs";

const root = "/tmp/amazon-mysql8-rehearsal.profile-test";
const options = { executeLocal: true, root, socket: `${root}/mysql.sock`, datadir: `${root}/data`, bindir: "/usr/bin",
  output: fileURLToPath(new URL("../../artifacts/linux-profile-pure-test.json", import.meta.url)), linuxIsolatedVm: true };
const runtime = { platform: "linux", arch: "arm64", effectiveUid: 1000 };
const validateLinuxPaths = (value, io) => validateLinuxPathsImpl(value, io, 1000);
const release = 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\n';
const schema = "amazon_rehearsal_0123456789abcdef_synthetic";
const code = expected => error => error.code === expected;
const args = ["--execute-local", ...["root", "socket", "datadir", "bindir", "output"].flatMap(name => [`--${name}`, options[name]])];

function fakeFs(overrides = {}) {
  return {
    realpathSync: value => value === "/etc/os-release" ? "/usr/lib/os-release" : path.normalize(value).replace(/\/$/, ""),
    lstatSync: value => ({ size: value === "/usr/lib/os-release" ? Buffer.byteLength(release) : 100,
      mode: value === root ? 0o40700 : 0o100755, uid: value === root ? 1000 : 0,
      isDirectory: () => [root, options.datadir, "/usr/bin", path.dirname(options.output)].includes(value),
      isSocket: () => value === options.socket,
      isSymbolicLink: () => false,
      isFile: () => ["/usr/lib/os-release", "/usr/bin/mysql", "/usr/bin/mysqldump"].includes(value),
    }),
    readFileSync: filename => { assert.equal(filename, "/usr/lib/os-release"); return release; },
    existsSync: () => false,
    ...overrides,
  };
}

const serverRow = (overrides = {}) => ({ version: "8.0.46-0ubuntu0.24.04.4", skipNetworking: 1,
  socket: options.socket, datadir: `${options.datadir}/`, lowerCaseTableNames: 0, eventScheduler: "OFF", ...overrides });

test("profile import remains inert on Mac or with forbidden inherited configuration", () => {
  const url = new URL("./historicalPlatformProfile.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)}); console.log('IMPORT_SAFE')`],
    { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", DATABASE_URL: "must-not-connect" } });
  assert.equal(result.status, 0); assert.equal(result.stdout, "IMPORT_SAFE\n"); assert.equal(result.stderr, "");
});

test("only explicit historical CLI flag enables Linux; old runners reject it and repeats fail", () => {
  assert.equal(parseArguments(args).linuxIsolatedVm, false);
  assert.equal(parseArguments([...args, "--linux-isolated-vm"]).linuxIsolatedVm, true);
  assert.equal(parseArguments([...args, "--linux-isolated-vm", "--fresh-reviewed-lineage"]).freshReviewedLineage, true);
  assert.throws(() => parseArguments([...args, "--linux-isolated-vm", "--linux-isolated-vm"]), code("DUPLICATE_LINUX_PROFILE_FLAG"));
  assert.throws(() => parseArguments(["--linux-isolated-vm"]), code("EXPLICIT_LOCAL_ARGUMENTS_REQUIRED"));
  for (const additional of [["--host", "localhost"], ["--uri", "mysql://root@x/db"], ["--port", "3306"], ["--database", "amz_listing"]]) {
    assert.throws(() => parseArguments([...args, "--linux-isolated-vm", ...additional]), code("INVALID_ARGUMENTS"));
  }
  assert.throws(() => parseSnapshotArgs([...args, "--linux-isolated-vm"]), code("INVALID_ARGUMENTS"));
  assert.throws(() => parseGeneralArgs(["--execute-local", "--linux-isolated-vm"]), code("INVALID_ARGUMENTS"));
});

test("Ubuntu 24.04 arm64 identity is required before any Linux filesystem/DB action", () => {
  assert.deepEqual(validateLinuxRuntime(fakeFs(), runtime), { platform: "linux", architecture: "arm64", distribution: "ubuntu", distributionVersion: "24.04" });
  for (const wrong of [{ platform: "darwin", arch: "arm64" }, { platform: "linux", arch: "x64" }, { platform: "win32", arch: "arm64" }]) {
    assert.throws(() => validateLinuxRuntime({}, wrong), code("ISOLATED_LINUX_ARM64_REQUIRED"));
  }
  for (const content of [release.replace("ubuntu", "debian"), release.replace("24.04", "22.04"), "ID=ubuntu\n", "VERSION_ID=24.04\n"]) {
    assert.throws(() => validateLinuxRuntime(fakeFs({ readFileSync: () => content }), runtime), code("UBUNTU_24_04_REQUIRED"));
  }
  for (const content of [release + "ID=ubuntu\n", release + "VERSION_ID=24.04\n", 'ID=$(echo ubuntu)\nVERSION_ID="24.04"\n']) {
    assert.throws(() => validateLinuxRuntime(fakeFs({ readFileSync: () => content }), runtime), code("UBUNTU_OS_RELEASE_INVALID"));
  }
});

test("OS identity cannot come from a symlinked, unbounded or noncanonical substituted file", () => {
  assert.throws(() => validateLinuxRuntime(fakeFs({ realpathSync: () => "/tmp/fake-release" }), runtime), code("UBUNTU_OS_RELEASE_PATH_REQUIRED"));
  const original = fakeFs();
  for (const patch of [{ isSymbolicLink: () => true }, { isFile: () => false }, { size: 0 }, { size: 8193 }, { uid: 1000 }, { mode: 0o100666 }]) {
    assert.throws(() => validateLinuxRuntime(fakeFs({ lstatSync: value => ({ ...original.lstatSync(value), ...patch }) }), runtime), code("BOUNDED_OS_RELEASE_FILE_REQUIRED"));
  }
  assert.throws(() => validateLinuxRuntime(fakeFs({ readFileSync: () => "x".repeat(8193) }), runtime), code("BOUNDED_OS_RELEASE_FILE_REQUIRED"));
});

test("Linux paths are canonical isolated tmp root and distinct direct socket/data children only", () => {
  assert.deepEqual(validateLinuxPaths(options, fakeFs()), { root, socket: options.socket, datadir: options.datadir });
  for (const invalid of ["/tmp", "/", "/var/lib/mysql", "/tmp/amazon-mysql8-rehearsal.", "/private/tmp/amazon-mysql8-rehearsal.test", `${root}/nested`]) {
    assert.throws(() => validateLinuxPaths({ ...options, root: invalid }, fakeFs()), code("INVALID_LINUX_TEMPORARY_ROOT"));
  }
  for (const key of ["socket", "datadir"]) for (const value of [`${root}/nested/x`, `${root}/../x`, "relative", `${root}/bad\0name`]) {
    assert.throws(() => validateLinuxPaths({ ...options, [key]: value }, fakeFs()), code("PATH_MUST_BE_DIRECT_TEMPORARY_CHILD"));
  }
  assert.throws(() => validateLinuxPaths({ ...options, datadir: options.socket }, fakeFs()), code("DISTINCT_SOCKET_AND_DATADIR_REQUIRED"));
  const original = fakeFs();
  for (const patch of [{ mode: 0o40755 }, { mode: 0o40710 }, { uid: 0 }]) {
    assert.throws(() => validateLinuxPaths(options, fakeFs({ lstatSync: value => ({ ...original.lstatSync(value), ...(value === root ? patch : {}) }) })), code("PRIVATE_OWNED_LINUX_ROOT_REQUIRED"));
  }
  assert.throws(() => validateLinuxPathsImpl(options, fakeFs(), -1), code("PRIVATE_OWNED_LINUX_ROOT_REQUIRED"));
  for (const target of [root, options.socket, options.datadir]) {
    assert.throws(() => validateLinuxPaths(options, fakeFs({ realpathSync: value => value === target ? "/elsewhere" : original.realpathSync(value) })));
    assert.throws(() => validateLinuxPaths(options, fakeFs({ lstatSync: value => ({ ...original.lstatSync(value), isSymbolicLink: () => value === target }) })));
  }
  assert.throws(() => validateLinuxPaths(options, fakeFs({ lstatSync: value => ({ ...original.lstatSync(value), isSocket: () => false }) })), code("UNIX_SOCKET_REQUIRED"));
});

test("Ubuntu clients must be direct root-owned nonwritable executable regular files in /usr/bin", () => {
  assert.deepEqual(validateLinuxBinaries(root, "/usr/bin", fakeFs()), { mysql: "/usr/bin/mysql", mysqldump: "/usr/bin/mysqldump" });
  for (const bindir of ["/bin", "/usr/local/bin", `${root}/bin`, "/usr/bin/../bin"]) {
    assert.throws(() => validateLinuxBinaries(root, bindir, fakeFs()), code("UBUNTU_MYSQL_BINARY_DIRECTORY_REQUIRED"));
  }
  const original = fakeFs();
  for (const patch of [{ uid: 1000 }, { mode: 0o40775 }, { mode: 0o40757 }]) {
    assert.throws(() => validateLinuxBinaries(root, "/usr/bin", fakeFs({ lstatSync: value => ({ ...original.lstatSync(value), ...(value === "/usr/bin" ? patch : {}) }) })), code("BINARY_DIRECTORY_MUST_BE_CANONICAL"));
  }
  for (const target of ["/usr/bin/mysql", "/usr/bin/mysqldump"]) {
    for (const patch of [{ isSymbolicLink: () => true }, { isFile: () => false }, { mode: 0o100644 }, { mode: 0o100775 }, { mode: 0o100757 }, { uid: 1000 }]) {
      assert.throws(() => validateLinuxBinaries(root, "/usr/bin", fakeFs({ lstatSync: value => ({ ...original.lstatSync(value), ...(value === target ? patch : {}) }) })), code("ROOT_OWNED_REGULAR_UBUNTU_CLIENT_REQUIRED"));
    }
    assert.throws(() => validateLinuxBinaries(root, "/usr/bin", fakeFs({ realpathSync: value => value === target ? "/somewhere/mysql" : original.realpathSync(value) })), code("ROOT_OWNED_REGULAR_UBUNTU_CLIENT_REQUIRED"));
  }
});

test("Linux DB identity requires MySQL 8.0, case-sensitive names and both MySQL protocols disabled", () => {
  assert.deepEqual(validateLinuxServer(serverRow(), options, fakeFs()), { version: "8.0.46-0ubuntu0.24.04.4", networkingDisabled: true, lowerCaseTableNames: 0, eventScheduler: "OFF" });
  assert.equal(validateLinuxServer(serverRow({ eventScheduler: "DISABLED" }), options, fakeFs()).eventScheduler, "DISABLED");
  for (const eventScheduler of ["ON", undefined, null, "off", 0]) assert.throws(() => validateLinuxServer(serverRow({ eventScheduler }), options, fakeFs()), code("EVENT_SCHEDULER_MUST_BE_DISABLED"));
  assert.equal(validateLinuxServer(serverRow({ lowerCaseTableNames: "0" }), options, fakeFs()).lowerCaseTableNames, 0);
  for (const version of ["8.4.11", "9.0.1", "5.7.44", "8.0.46-MariaDB"]) assert.throws(() => validateLinuxServer(serverRow({ version }), options, fakeFs()));
  for (const lowerCaseTableNames of [1, 2, false, null, undefined]) assert.throws(() => validateLinuxServer(serverRow({ lowerCaseTableNames }), options, fakeFs()), code("CASE_SENSITIVE_TABLE_NAMES_REQUIRED"));
  assert.throws(() => validateLinuxServer(serverRow({ skipNetworking: 0 }), options, fakeFs()), code("NETWORKING_MUST_BE_DISABLED"));
  assert.throws(() => validateLinuxServer(serverRow({ socket: "/tmp/other.sock" }), options, fakeFs()), code("SERVER_SOCKET_MISMATCH"));
  assert.throws(() => validateLinuxServer(serverRow({ datadir: "/var/lib/mysql/" }), options, fakeFs()), code("SERVER_DATADIR_MISMATCH"));
  assert.deepEqual(validateLinuxPluginRows([]), { mysqlxDisabled: true });
  assert.deepEqual(validateLinuxPluginRows([{ pluginStatus: "DISABLED" }]), { mysqlxDisabled: true });
  for (const rows of [null, [{ pluginStatus: "ACTIVE" }], [{ pluginStatus: "UNKNOWN" }], [{ pluginStatus: "DISABLED" }, { pluginStatus: "DISABLED" }]]) {
    assert.throws(() => validateLinuxPluginRows(rows), code("MYSQLX_MUST_BE_DISABLED"));
  }
});

test("Linux preflight rejects inherited DB/client/preload config and native environment is allowlisted", () => {
  validateLinuxEnvironment({ PATH: "/usr/bin:/bin", DOTENV_CONFIG_PATH: "/dev/null" }, []);
  for (const name of ["DATABASE_URL", "MYSQL_PWD", "MYSQL_HOME", "MYSQL_TEST_LOGIN_FILE", "MYSQL_GROUP_SUFFIX", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS"]) {
    assert.throws(() => validateLinuxEnvironment({ [name]: "untrusted" }, []));
  }
  assert.throws(() => validateLinuxEnvironment({}, ["dotenv_config_path=/tmp/private"]), code("UNSAFE_DOTENV_ARGUMENT"));
  assert.deepEqual(nativeEnvironment(root), { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: root });
});

test("Linux native arguments preserve all no-config/no-network/no-destructive guards of Mac", () => {
  for (const kind of ["dump", "restore"]) {
    const actual = linuxNativeArguments(kind, options.socket, schema);
    const expected = nativeArguments(kind, "/private/tmp/amazon-mysql8-rehearsal.profile-test/mysql.sock", schema).filter(value => value !== "--no-login-paths")
      .map(value => value.startsWith("--socket=") ? `--socket=${options.socket}` : value);
    assert.deepEqual(actual, expected);
    assert.equal(actual.some(value => /^--(?:host|port|defaults-file|defaults-extra-file|login-path|databases|add-drop)/.test(value)), false);
  }
  for (const value of ["/tmp/mysql.sock", `${root}/nested/mysql.sock`, `${root}/../mysql.sock`, "/private/tmp/amazon-mysql8-rehearsal.x/mysql.sock", `${root}/bad\0name`]) {
    assert.throws(() => linuxNativeArguments("dump", value, schema), code("LOCAL_LINUX_SOCKET_REQUIRED"));
  }
  for (const name of ["amz_listing", "mysql", schema.replace("synthetic", "general")]) assert.throws(() => linuxNativeArguments("dump", options.socket, name), code("NON_SYNTHETIC_SCHEMA_FORBIDDEN"));
  assert.throws(() => linuxNativeArguments("unknown", options.socket, schema), code("UNKNOWN_CLIENT_ACTION"));
});

test("Linux-only native environment redirects login-file lookup, never inherits HOME or credentials", async () => {
  const env = linuxNativeEnvironment(root);
  assert.deepEqual(env, { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: root, MYSQL_TEST_LOGIN_FILE: "/dev/null" });
  assert.equal(Object.hasOwn(nativeEnvironment("/private/tmp/amazon-mysql8-rehearsal.test"), "MYSQL_TEST_LOGIN_FILE"), false);
  const args = linuxNativeArguments("restore", options.socket, schema);
  assert.equal(args[0], "--no-defaults"); assert.equal(args.includes("--no-login-paths"), false);
  await runLinuxNative({ binary: "/usr/bin/mysql", args, root, input: Buffer.from("synthetic") }, (binary, actualArgs, config) => {
    assert.equal(binary, "/usr/bin/mysql"); assert.deepEqual(actualArgs, args); assert.deepEqual(config.env, env);
    assert.equal(config.shell, false); assert.equal(config.timeout, 60_000); assert.equal(config.killSignal, "SIGKILL");
    // An actual Node child (not mysql) verifies the effective OS process env.
    // macOS may inject its CF text-encoding hint after execve; Linux has no
    // exception. All user/home/DB/preload/client configuration must be absent.
    const script = `const expected=${JSON.stringify(env)};const actual={...process.env};if(process.platform==='darwin')delete actual.__CF_USER_TEXT_ENCODING;const sort=x=>JSON.stringify(Object.entries(x).sort());if(sort(actual)!==sort(expected))process.exit(2);process.stdin.resume();`;
    return spawn(process.execPath, ["-e", script], { ...config, cwd: process.cwd() });
  });
});

test("Linux native client runner validates exact args/stream scope and sanitizes process failures", async () => {
  const call = { binary: "/usr/bin/mysqldump", args: linuxNativeArguments("dump", options.socket, schema), root, outputFd: 17 };
  for (const patch of [{ binary: "/usr/local/bin/mysql" }, { args: [...call.args, "--host=other"] },
    { args: ["--defaults-file=/tmp/private", ...call.args] }, { args: call.args.map(value => value.startsWith("--socket=") ? "--socket=/tmp/other.sock" : value) },
    { outputFd: undefined }, { input: Buffer.from("bad") }, { root: "/tmp" }]) {
    await assert.rejects(runLinuxNative({ ...call, ...patch }, () => assert.fail("must reject before spawn")));
  }
  await assert.rejects(runLinuxNative(call, () => {
    const child = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => { child.stderr.emit("data", Buffer.from("private-error-and-sql")); child.emit("close", 2); });
    return child;
  }), error => error.code === "MYSQL_CLIENT_FAILED" && !error.message.includes("private"));
  const schemaOnly = { ...call, args: [...call.args.slice(0, -1), "--no-data", call.args.at(-1)] };
  await runLinuxNative(schemaOnly, () => {
    const child = new EventEmitter(); child.stderr = new EventEmitter(); queueMicrotask(() => child.emit("close", 0)); return child;
  });
});

test("default profile never broadens Mac root or bundle acceptance and Linux requires boolean flag", () => {
  const profile = createHistoricalPlatformProfile({}, { io: fakeFs(), runtime });
  assert.equal(profile.kind, "macos-local-default"); assert.equal(profile.runtime, null);
  assert.throws(() => profile.validatePaths(options), code("INVALID_TEMPORARY_ROOT"));
  assert.throws(() => profile.validateBinaries(root, "/usr/bin"), code("OFFICIAL_LOCAL_BINARY_DIRECTORY_REQUIRED"));
  assert.throws(() => profile.nativeArguments("dump", options.socket, schema), code("LOCAL_SOCKET_REQUIRED"));
  for (const linuxIsolatedVm of ["true", 1, null]) assert.throws(() => createHistoricalPlatformProfile({ linuxIsolatedVm }, { io: {}, runtime }), code("INVALID_LINUX_PROFILE_FLAG"));
  const linux = createHistoricalPlatformProfile(options, { io: fakeFs(), runtime });
  assert.equal(linux.kind, "linux-isolated-vm"); assert.equal(linux.runtime.distributionVersion, "24.04");
});

test("historical preflight refuses wrong runtime, unsafe environment and Linux paths without flag before loader/native calls", async () => {
  let loads = 0, natives = 0;
  const base = { io: fakeFs(), environment: {}, argv: [], runtime,
    load: async () => { loads++; assert.fail("must not import DB runner"); },
    native: async () => { natives++; assert.fail("must not spawn client"); } };
  await assert.rejects(runRehearsal(options, { ...base, runtime: { platform: "darwin", arch: "arm64" } }), code("ISOLATED_LINUX_ARM64_REQUIRED"));
  await assert.rejects(runRehearsal(options, { ...base, environment: { MYSQL_HOME: "/tmp/unsafe" } }), code("UNSAFE_LINUX_INHERITED_CONFIGURATION"));
  await assert.rejects(runRehearsal({ ...options, linuxIsolatedVm: false }, base), code("INVALID_TEMPORARY_ROOT"));
  assert.equal(loads, 0); assert.equal(natives, 0);
});

test("Linux validation receipt is assigned only after completion including cleanup, retaining nonproduction limits", () => {
  const source = fs.readFileSync(new URL("./historicalPrerequisiteRehearsal.mjs", import.meta.url), "utf8");
  assert.match(source, /productionCloneValidated: false, caseSensitiveLinuxValidated: false/);
  assert.match(source, /receipt\.caseSensitiveLinuxValidated = receipt\.status === "completed" && profile\.kind === "linux-isolated-vm"/);
  assert.ok(source.indexOf("receipt.caseSensitiveLinuxValidated =") > source.indexOf("receipt.cleanupError ="));
  assert.match(source, /source-derived rehearsal only; not production baseline-copy upgrade or a production clone/);
});
