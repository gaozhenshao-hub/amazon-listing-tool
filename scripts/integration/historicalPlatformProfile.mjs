// Explicit platform profile for the isolated historical rehearsal only.
// This does not expand the general/snapshot migration runners or infer a VM.
// Import is inert: runtime and filesystem checks happen only during preflight.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  validatePaths as validateMacPaths, validateServerIdentity as validateMacServer,
  validateEnvironment,
} from "./mysqlRehearsal.mjs";
import {
  validateBinaries as validateMacBinaries, nativeArguments as macNativeArguments,
} from "./mysqlSnapshotRehearsal.mjs";

const requireSafe = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const rootPattern = /^\/tmp\/amazon-mysql8-rehearsal\.[A-Za-z0-9_-]+$/;
const schemaPattern = /^amazon_rehearsal_[a-f0-9]{16}_synthetic$/;
const osRelease = "/usr/lib/os-release";

export function validateLinuxRuntime(io = fs, runtime = { platform: process.platform, arch: process.arch }) {
  requireSafe(runtime.platform === "linux" && runtime.arch === "arm64", "ISOLATED_LINUX_ARM64_REQUIRED");
  requireSafe(io.realpathSync("/etc/os-release") === osRelease && io.realpathSync(osRelease) === osRelease,
    "UBUNTU_OS_RELEASE_PATH_REQUIRED");
  const stat = io.lstatSync(osRelease);
  requireSafe(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 8192
    && stat.uid === 0 && (stat.mode & 0o022) === 0,
    "BOUNDED_OS_RELEASE_FILE_REQUIRED");
  const content = io.readFileSync(osRelease, "utf8");
  requireSafe(typeof content === "string" && Buffer.byteLength(content) <= 8192, "BOUNDED_OS_RELEASE_FILE_REQUIRED");
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!/^(?:ID|VERSION_ID)=/.test(line)) continue;
    const match = /^(ID|VERSION_ID)=(?:"([^"\\]*)"|'([^'\\]*)'|([A-Za-z0-9._-]+))$/.exec(line);
    requireSafe(match && !values.has(match[1]), "UBUNTU_OS_RELEASE_INVALID");
    values.set(match[1], match[2] ?? match[3] ?? match[4]);
  }
  requireSafe(values.get("ID") === "ubuntu" && values.get("VERSION_ID") === "24.04", "UBUNTU_24_04_REQUIRED");
  return { platform: "linux", architecture: "arm64", distribution: "ubuntu", distributionVersion: "24.04" };
}

export function validateLinuxEnvironment(environment, argv = []) {
  validateEnvironment(environment, argv);
  for (const key of Object.keys(environment)) requireSafe(!/^(?:MYSQL_|LD_|DYLD_)/i.test(key), "UNSAFE_LINUX_INHERITED_CONFIGURATION");
}

export function validateLinuxPaths(options, io = fs, effectiveUid = process.geteuid?.()) {
  const { root, socket, datadir } = options;
  requireSafe(typeof root === "string" && rootPattern.test(root), "INVALID_LINUX_TEMPORARY_ROOT");
  const rootInfo = io.lstatSync(root);
  requireSafe(io.realpathSync(root) === root && rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), "ROOT_MUST_BE_CANONICAL_DIRECTORY");
  requireSafe(Number.isInteger(effectiveUid) && effectiveUid >= 0 && rootInfo.uid === effectiveUid
    && (rootInfo.mode & 0o777) === 0o700, "PRIVATE_OWNED_LINUX_ROOT_REQUIRED");
  requireSafe(socket !== datadir, "DISTINCT_SOCKET_AND_DATADIR_REQUIRED");
  for (const value of [socket, datadir]) {
    requireSafe(typeof value === "string" && !value.includes("\0") && path.isAbsolute(value)
      && path.normalize(value) === value && path.dirname(value) === root, "PATH_MUST_BE_DIRECT_TEMPORARY_CHILD");
    requireSafe(io.realpathSync(value) === value && !io.lstatSync(value).isSymbolicLink(), "SYMLINK_TARGET_FORBIDDEN");
  }
  requireSafe(io.lstatSync(socket).isSocket(), "UNIX_SOCKET_REQUIRED");
  requireSafe(io.lstatSync(datadir).isDirectory(), "DATA_DIRECTORY_REQUIRED");
  return { root, socket, datadir };
}

export function validateLinuxBinaries(root, bindir, io = fs) {
  requireSafe(rootPattern.test(root) && bindir === "/usr/bin", "UBUNTU_MYSQL_BINARY_DIRECTORY_REQUIRED");
  const directory = io.lstatSync(bindir);
  requireSafe(io.realpathSync(bindir) === bindir && directory.isDirectory() && !directory.isSymbolicLink()
    && directory.uid === 0 && (directory.mode & 0o022) === 0, "BINARY_DIRECTORY_MUST_BE_CANONICAL");
  return Object.fromEntries(["mysql", "mysqldump"].map(name => {
    const binary = path.join(bindir, name), stat = io.lstatSync(binary);
    requireSafe(io.realpathSync(binary) === binary && stat.isFile() && !stat.isSymbolicLink()
      && (stat.mode & 0o111) !== 0 && (stat.mode & 0o022) === 0 && stat.uid === 0,
    "ROOT_OWNED_REGULAR_UBUNTU_CLIENT_REQUIRED");
    return [name, binary];
  }));
}

export function validateLinuxServer(row, paths, io = fs) {
  // Reuse the socket/datadir equality and skip_networking checks; only this
  // explicit profile narrows version and case sensitivity to production-like 8.0.
  const identity = validateMacServer(row, paths, io);
  requireSafe(/^8\.0\.\d+(?:[-+.][A-Za-z0-9_.-]+)?$/.test(identity.version), "MYSQL_8_0_REQUIRED");
  requireSafe(row.lowerCaseTableNames === 0 || row.lowerCaseTableNames === "0", "CASE_SENSITIVE_TABLE_NAMES_REQUIRED");
  requireSafe(row.eventScheduler === "OFF" || row.eventScheduler === "DISABLED", "EVENT_SCHEDULER_MUST_BE_DISABLED");
  return { ...identity, lowerCaseTableNames: 0, eventScheduler: row.eventScheduler };
}

export function validateLinuxPluginRows(rows) {
  // skip_networking alone does not establish whether the independent X plugin
  // listens on TCP. The isolated VM must start mysqld with mysqlx disabled.
  requireSafe(Array.isArray(rows) && rows.length <= 1 && rows.every(row => row.pluginStatus === "DISABLED"),
    "MYSQLX_MUST_BE_DISABLED");
  return { mysqlxDisabled: true };
}

export function linuxNativeArguments(kind, socket, schema) {
  requireSafe(schemaPattern.test(schema), "NON_SYNTHETIC_SCHEMA_FORBIDDEN");
  requireSafe(typeof socket === "string" && !socket.includes("\0") && path.normalize(socket) === socket
    && rootPattern.test(path.dirname(socket)), "LOCAL_LINUX_SOCKET_REQUIRED");
  // Ubuntu MySQL 8.0 does not support --no-login-paths. The fixed native
  // environment below instead directs its login-file reader to /dev/null.
  const common = ["--no-defaults", "--protocol=SOCKET", `--socket=${socket}`,
    "--user=root", "--password=", "--default-character-set=utf8mb4"];
  if (kind === "dump") return [...common, "--single-transaction", "--no-tablespaces", "--set-gtid-purged=OFF",
    "--skip-add-drop-table", "--skip-comments", "--skip-dump-date", "--skip-add-locks", "--skip-triggers", schema];
  requireSafe(kind === "restore", "UNKNOWN_CLIENT_ACTION");
  return [...common, "--binary-mode=1", "--local-infile=0", "--skip-reconnect", `--database=${schema}`];
}

export function linuxNativeEnvironment(root) {
  requireSafe(rootPattern.test(root), "INVALID_LINUX_TEMPORARY_ROOT");
  return { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: root, MYSQL_TEST_LOGIN_FILE: "/dev/null" };
}

export async function runLinuxNative({ binary, args, root, outputFd, input, signal }, spawnProcess = spawn) {
  const environment = linuxNativeEnvironment(root);
  requireSafe(binary === "/usr/bin/mysql" || binary === "/usr/bin/mysqldump", "UBUNTU_NATIVE_CLIENT_REQUIRED");
  requireSafe(Array.isArray(args) && args.every(value => typeof value === "string"), "UBUNTU_NATIVE_ARGUMENTS_INVALID");
  const kind = binary.endsWith("mysqldump") ? "dump" : "restore";
  const socket = args.find(value => value.startsWith("--socket="))?.slice(9);
  requireSafe(typeof socket === "string" && path.dirname(socket) === root, "LOCAL_LINUX_SOCKET_REQUIRED");
  const schema = kind === "dump" ? args.at(-1) : args.find(value => value.startsWith("--database="))?.slice(11);
  let expected = linuxNativeArguments(kind, socket, schema);
  if (kind === "dump" && args.includes("--no-data")) expected = [...expected.slice(0, -1), "--no-data", expected.at(-1)];
  requireSafe(JSON.stringify(args) === JSON.stringify(expected), "UBUNTU_NATIVE_ARGUMENTS_INVALID");
  requireSafe(kind === "dump" ? input === undefined && Number.isInteger(outputFd) && outputFd >= 0
    : outputFd === undefined && Buffer.isBuffer(input) && input.length > 0 && input.length <= 64 * 1024 * 1024,
  "UBUNTU_NATIVE_STREAM_INVALID");
  return new Promise((resolve, reject) => {
    const child = spawnProcess(binary, args, { cwd: root, env: environment, shell: false,
      stdio: [input ? "pipe" : "ignore", outputFd ?? "ignore", "pipe"], timeout: 60_000, killSignal: "SIGKILL", signal });
    child.stderr.on("data", () => {}); // Private SQL/error text must not escape.
    const fail = () => reject(Object.assign(new Error("MYSQL_CLIENT_FAILED"), { code: "MYSQL_CLIENT_FAILED" }));
    child.on("error", fail);
    child.on("close", code => code === 0 ? resolve() : fail());
    if (input) { child.stdin.on("error", fail); child.stdin.end(input); }
  });
}

export function createHistoricalPlatformProfile(options, { io = fs,
  runtime = { platform: process.platform, arch: process.arch } } = {}) {
  requireSafe(options.linuxIsolatedVm === undefined || typeof options.linuxIsolatedVm === "boolean", "INVALID_LINUX_PROFILE_FLAG");
  if (options.linuxIsolatedVm !== true) return {
    kind: "macos-local-default", runtime: null,
    validateEnvironment,
    validatePaths: value => validateMacPaths(value, io),
    validateBinaries: (root, bindir) => validateMacBinaries(root, bindir, io),
    validateServerIdentity: (row, paths) => validateMacServer(row, paths, io),
    nativeArguments: macNativeArguments,
  };
  const identity = validateLinuxRuntime(io, runtime);
  return {
    kind: "linux-isolated-vm", runtime: identity,
    validateEnvironment: validateLinuxEnvironment,
    validatePaths: value => validateLinuxPaths(value, io, runtime.effectiveUid ?? process.geteuid?.()),
    validateBinaries: (root, bindir) => validateLinuxBinaries(root, bindir, io),
    validateServerIdentity: (row, paths) => validateLinuxServer(row, paths, io),
    nativeArguments: linuxNativeArguments,
  };
}
