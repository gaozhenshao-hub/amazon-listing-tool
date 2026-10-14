// Real filesystem, wholly synthetic temporary directories. No private export,
// credential, environment configuration, VM, driver or database is read.
// Preserve these tiny test artifacts (including deliberately damaged examples).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { initializeExistingDeltaEvidenceStore, openExistingDeltaEvidenceStore, evidenceFingerprint } from "./existingDeltaEvidenceStore.mjs";
import { fingerprint } from "./freshBootstrapPlan.mjs";

const clone = value => structuredClone(value), code = expected => error => error.code === expected;
const key = `existing-delta:${"a".repeat(48)}`, hash = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])])) : value;
const bytes = value => `${JSON.stringify(canonical(value))}\n`;
function bindingFixture() {
  return { scope: "local-isolated-delta-evaluation-only", authorizationSha256: "a".repeat(64), inputsSha256: "b".repeat(64),
    instanceSha256: "c".repeat(64), schema: "amazon_existing_0123456789abcdef_synthetic",
    candidateSqlSha256: "5ef700e8633dc3ce638a42baf4d7df76c54ee00c393e2973ac90ba2cdaeaee75",
    beforeFullCatalogSha256: "d".repeat(64), afterFullCatalogSha256: "e".repeat(64), beforeScopedCatalogSha256: "f".repeat(64),
    afterScopedCatalogSha256: "1".repeat(64), ledgerSnapshotSha256: "2".repeat(64), ledgerFields: ["migrationName", "checksum", "status"],
    ledgerRows: 174, fullHistoricalLedgerFieldsVerified: false, historicalExecutionProven: false, generalRunnerAdmitted: false, productionApproved: false };
}
const newDirectory = () => path.join(fs.realpathSync(os.tmpdir()), `amazon-existing-delta-evidence.${randomBytes(8).toString("hex")}`);
function fixture() {
  const options = initializeExistingDeltaEvidenceStore({ directory: newDirectory(), operationKey: key, binding: bindingFixture() });
  const started = { version: "amazon-existing-delta-execution/1", operationKey: key, sequence: 1, previousSha256: null,
    binding: clone(options.binding), status: "started", observation: { ddlDispatches: 0, alterAcknowledged: false, ledgerWrites: 0,
      lockReleased: false, beforeVerified: true, afterVerified: false, errorCode: null } };
  const completed = { ...clone(started), sequence: 2, previousSha256: fingerprint(started), status: "completed",
    observation: { ...clone(started.observation), ddlDispatches: 1, alterAcknowledged: true, lockReleased: true, afterVerified: true } };
  return { options, directory: options.directory, started, completed, store: openExistingDeltaEvidenceStore(options) };
}
const audit = (overrides = {}) => ({ attemptId: randomBytes(16).toString("hex"), phase: "pre-core", outcome: "refused",
  reason: "authorization-refused", authorizationSha256: null, coreReceiptSha256: null, automaticRetryAllowed: false, ...overrides });
function inventory(directory) {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename);
    return stat.isDirectory() ? [{ name, mode: stat.mode & 0o7777 }, ...inventory(filename).map(item => ({ ...item, name: `${name}/${item.name}` }))]
      : [{ name, mode: stat.mode & 0o7777, sha256: hash(fs.readFileSync(filename)), ino: stat.ino }];
  });
}

test("import is inert; store has no connector, credentials, environment reader, delete or auto-execution path", () => {
  const url = new URL("./existingDeltaEvidenceStore.mjs", import.meta.url);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url.href)}); console.log('INERT')`], {
    encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", DATABASE_URL: "mysql://not-used" } });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, "INERT\n");
  const source = fs.readFileSync(url, "utf8");
  assert.doesNotMatch(source, /process\.env|mysql2|dotenv|execFile|spawn\(|\.(?:unlink|rmSync|rmdir|chmodSync|chownSync)\b|setTimeout/);
  assert.equal(evidenceFingerprint({ b: [3, { x: 1 }], a: 2 }), fingerprint({ a: 2, b: [3, { x: 1 }] }));
});

test("exclusive initialization pins canonical manifest, binding and 0700/0600 ownership; reopen does not write", () => {
  const f = fixture(); assert.equal(fs.statSync(f.directory).mode & 0o7777, 0o700);
  assert.equal(fs.statSync(path.join(f.directory, "store.json")).mode & 0o7777, 0o600);
  assert.equal(f.options.manifestSha256, hash(fs.readFileSync(path.join(f.directory, "store.json"))));
  const before = inventory(f.directory); assert.deepEqual(f.store.readOperation(key), []); assert.deepEqual(f.store.readAttempts(), []);
  assert.deepEqual(openExistingDeltaEvidenceStore(f.options).readOperation(key), []); assert.deepEqual(inventory(f.directory), before);
  const { manifestSha256: _ignored, ...creation } = f.options;
  assert.throws(() => initializeExistingDeltaEvidenceStore(creation), code("EVIDENCE_FILESYSTEM_FAILURE"));
  assert.deepEqual(inventory(f.directory), before);
  assert.throws(() => openExistingDeltaEvidenceStore({ ...f.options, manifestSha256: "0".repeat(64) }), code("EVIDENCE_MANIFEST_HASH_CHANGED"));
  assert.throws(() => openExistingDeltaEvidenceStore({ ...f.options, binding: { ...f.options.binding, productionApproved: true } }), code("EVIDENCE_BINDING_INVALID"));
  assert.throws(() => initializeExistingDeltaEvidenceStore({ ...creation, directory: fs.realpathSync(os.tmpdir()) }), code("EVIDENCE_OPTIONS_INVALID"));
});

test("durable compare-and-append preserves content/file hash chains and both successful lock directories", () => {
  const f = fixture(), beforeManifest = fs.readFileSync(path.join(f.directory, "store.json"));
  assert.deepEqual(f.store.appendReceipt(key, f.started, null), { durable: true, sha256: fingerprint(f.started) });
  const firstBytes = fs.readFileSync(path.join(f.directory, "operation-000001.json"));
  assert.deepEqual(f.store.appendReceipt(key, f.completed, fingerprint(f.started)), { durable: true, sha256: fingerprint(f.completed) });
  assert.deepEqual(f.store.readOperation(key), [f.started, f.completed]);
  const second = JSON.parse(fs.readFileSync(path.join(f.directory, "operation-000002.json"), "utf8"));
  assert.equal(second.previousContentSha256, fingerprint(f.started)); assert.equal(second.previousFileSha256, hash(firstBytes));
  assert.deepEqual(fs.readFileSync(path.join(f.directory, "operation-000001.json")), firstBytes);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, "store.json")), beforeManifest);
  assert.equal(fs.existsSync(path.join(f.directory, "operation.lock")), false);
  for (const item of inventory(f.directory)) assert.equal(item.mode, item.sha256 ? 0o600 : 0o700);
  const beforeRead = inventory(f.directory); f.store.readOperation(key); assert.deepEqual(inventory(f.directory), beforeRead);
});

test("actual fsync ordering covers file data, containing directories and final lock-rename parent before durable acknowledgment", () => {
  const f = fixture(), events = [], sync = fs.fsyncSync, rename = fs.renameSync;
  fs.fsyncSync = fd => { events.push(fs.fstatSync(fd).isDirectory() ? "directory" : "file"); return sync(fd); };
  fs.renameSync = (...args) => { events.push("rename"); return rename(...args); };
  try { assert.equal(f.store.appendReceipt(key, f.started, null).durable, true); }
  finally { fs.fsyncSync = sync; fs.renameSync = rename; }
  assert.deepEqual(events, ["directory", "file", "directory", "directory", "file", "directory", "rename", "directory"]);
});

test("wrong key never writes; CAS mismatch retains its stale lock and cannot overwrite or auto-retry", () => {
  const f = fixture(), untouched = inventory(f.directory);
  assert.throws(() => f.store.appendReceipt(`existing-delta:${"b".repeat(48)}`, f.started, null), code("EVIDENCE_OPERATION_KEY_CHANGED"));
  assert.deepEqual(inventory(f.directory), untouched);
  f.store.appendReceipt(key, f.started, null); const original = fs.readFileSync(path.join(f.directory, "operation-000001.json"));
  assert.throws(() => f.store.appendReceipt(key, f.completed, null), error => {
    assert.equal(error.code, "EVIDENCE_CAS_MISMATCH"); assert.equal(error.storageOutcome, "unknown"); assert.equal(error.automaticRetryAllowed, false); return true;
  });
  assert.equal(fs.existsSync(path.join(f.directory, "operation.lock")), true);
  assert.throws(() => f.store.appendReceipt(key, f.completed, fingerprint(f.started)), code("EVIDENCE_LOCK_PRESENT"));
  assert.throws(() => f.store.readOperation(key), code("EVIDENCE_LOCK_PRESENT"));
  assert.deepEqual(fs.readFileSync(path.join(f.directory, "operation-000001.json")), original);
  const refusal = audit({ phase: "adapter", reason: "receipt-refused" });
  f.store.appendAttempt(refusal, null); assert.deepEqual(f.store.readAttempts(), [refusal]);
});

test("two separate processes race on a real directory: exactly one immutable started record, no duplicate or overwrite", async () => {
  const f = fixture(), moduleUrl = new URL("./existingDeltaEvidenceStore.mjs", import.meta.url).href;
  const script = `import {openExistingDeltaEvidenceStore} from ${JSON.stringify(moduleUrl)};
    try { const store=openExistingDeltaEvidenceStore(${JSON.stringify(f.options)});
      store.appendReceipt(${JSON.stringify(key)},${JSON.stringify(f.started)},null);console.log('APPENDED');
    } catch(error) { console.log(error.code); }`;
  const launch = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("synthetic child deadline")); }, 10_000);
    child.stdout.on("data", value => output += value); child.stderr.on("data", value => errors += value); child.on("error", reject);
    child.on("close", status => { clearTimeout(timer); assert.equal(status, 0, errors); assert.equal(errors, ""); resolve(output.trim()); });
  });
  const results = await Promise.all([launch(), launch()]); assert.equal(results.filter(value => value === "APPENDED").length, 1);
  assert.ok(results.every(value => ["APPENDED", "EVIDENCE_LOCK_PRESENT", "EVIDENCE_CAS_MISMATCH"].includes(value)), results.join(","));
  const value = JSON.parse(fs.readFileSync(path.join(f.directory, "operation-000001.json"), "utf8")); assert.deepEqual(value.content, f.started);
  assert.equal(fs.existsSync(path.join(f.directory, "operation-000002.json")), false);
  if (fs.existsSync(path.join(f.directory, "operation.lock"))) assert.throws(() => f.store.readOperation(key), code("EVIDENCE_LOCK_PRESENT"));
  else assert.deepEqual(f.store.readOperation(key), [f.started]);
});

test("operation accepts exact terminal states only, max two entries, with no invented historical success or raw data", () => {
  for (const status of ["failed", "unknown"]) {
    const f = fixture(); f.store.appendReceipt(key, f.started, null);
    const terminal = { ...clone(f.completed), status, observation: { ...clone(f.started.observation),
      ddlDispatches: status === "unknown" ? 1 : 0, errorCode: "DELTA_DEADLINE_EXCEEDED" } };
    f.store.appendReceipt(key, terminal, fingerprint(f.started)); assert.deepEqual(f.store.readOperation(key), [f.started, terminal]);
    assert.throws(() => f.store.appendReceipt(key, f.completed, fingerprint(terminal)), code("EVIDENCE_STREAM_COMPLETE"));
    assert.equal(fs.existsSync(path.join(f.directory, "operation-000003.json")), false);
  }
  for (const mutate of [entry => entry.extraSql = "SELECT secret", entry => entry.binding.historicalExecutionProven = true,
    entry => entry.observation.ledgerWrites = 1, entry => entry.status = "baselined", entry => entry.observation.beforeVerified = false]) {
    const f = fixture(), bad = clone(f.started); mutate(bad); assert.throws(() => f.store.appendReceipt(key, bad, null));
    assert.equal(fs.existsSync(path.join(f.directory, "operation-000001.json")), false);
  }
});

test("sanitized audit covers pre-core refusals with its own CAS/hash chain and never accepts error/message/SQL fields", () => {
  const f = fixture(), first = audit(), second = audit({ phase: "adapter", outcome: "unknown", reason: "receipt-durability-unknown" });
  assert.deepEqual(f.store.appendAttempt(first, null), { durable: true, sha256: fingerprint(first) });
  f.store.appendAttempt(second, fingerprint(first)); assert.deepEqual(f.store.readAttempts(), [first, second]);
  assert.deepEqual(f.store.readOperation(key), []);
  for (const bad of [{ ...audit(), rawError: "mysql://password" }, { ...audit(), reason: "SQL SELECT secret" },
    { ...audit(), message: "credential" }, { ...audit(), automaticRetryAllowed: true },
    audit({ outcome: "completed", reason: "core-completed" }), { ...audit(), authorizationSha256: "raw-secret" }]) {
    const g = fixture(), before = inventory(g.directory); assert.throws(() => g.store.appendAttempt(bad, null), code("EVIDENCE_ATTEMPT_INVALID"));
    assert.deepEqual(inventory(g.directory), before);
  }
});

test("symlinks, hardlinks, directory/file permission drift and fixed-lock substitution fail closed", () => {
  const symlink = fixture(), alias = newDirectory(); fs.symlinkSync(symlink.directory, alias);
  assert.throws(() => openExistingDeltaEvidenceStore({ ...symlink.options, directory: alias }), code("EVIDENCE_DIRECTORY_UNSAFE"));
  const linked = fixture(), manifest = path.join(linked.directory, "store.json"); fs.linkSync(manifest, `${linked.directory}.hardlink`);
  assert.throws(() => linked.store.readOperation(key), code("EVIDENCE_FILE_UNSAFE"));
  const fileMode = fixture(); fs.chmodSync(path.join(fileMode.directory, "store.json"), 0o644);
  assert.throws(() => fileMode.store.readOperation(key), code("EVIDENCE_FILE_UNSAFE"));
  const dirMode = fixture(); fs.chmodSync(dirMode.directory, 0o755);
  assert.throws(() => dirMode.store.readOperation(key), code("EVIDENCE_DIRECTORY_UNSAFE"));
  const lock = fixture(); fs.symlinkSync(os.tmpdir(), path.join(lock.directory, "operation.lock"));
  assert.throws(() => lock.store.appendReceipt(key, lock.started, null), code("EVIDENCE_DIRECTORY_UNSAFE"));
  const fileLink = fixture(), original = path.join(fileLink.directory, "store.json"), preserved = `${fileLink.directory}.manifest`;
  fs.renameSync(original, preserved); fs.symlinkSync(preserved, original);
  assert.throws(() => fileLink.store.readOperation(key), code("EVIDENCE_FILE_UNSAFE"));
  const archiveLink = fixture(); archiveLink.store.appendReceipt(key, archiveLink.started, null);
  const archive = path.join(archiveLink.directory, "operation-lock-000001"), moved = `${archiveLink.directory}.archive`;
  fs.renameSync(archive, moved); fs.symlinkSync(moved, archive);
  assert.throws(() => archiveLink.store.readOperation(key), code("EVIDENCE_DIRECTORY_UNSAFE"));
});

test("unprotected ancestor directories are refused even when the immediate parent is private", () => {
  const ancestor = newDirectory(); fs.mkdirSync(ancestor, { mode: 0o700 });
  const parent = path.join(ancestor, "private-parent"); fs.mkdirSync(parent, { mode: 0o700 }); fs.chmodSync(ancestor, 0o777);
  const directory = path.join(parent, path.basename(newDirectory()));
  assert.throws(() => initializeExistingDeltaEvidenceStore({ directory, operationKey: key, binding: bindingFixture() }), code("EVIDENCE_PARENT_UNSAFE"));
  assert.equal(fs.existsSync(directory), false);
});

test("inode/UID drift at reopen and between file descriptor read and path validation is detected", () => {
  const f = fixture(), read = fs.readFileSync, filename = path.join(f.directory, "store.json"); let changed = false;
  fs.readFileSync = (...args) => {
    const result = read(...args);
    if (!changed && typeof args[0] === "number") {
      changed = true; fs.renameSync(filename, `${f.directory}.old-manifest`); fs.writeFileSync(filename, result, { flag: "wx", mode: 0o600 });
    }
    return result;
  };
  try { assert.throws(() => f.store.readOperation(key), code("EVIDENCE_FILE_DRIFT")); } finally { fs.readFileSync = read; }
  const g = fixture(), lstat = fs.lstatSync;
  fs.lstatSync = (...args) => {
    const value = lstat(...args); if (args[0] === path.join(g.directory, "store.json")) value.uid += 1; return value;
  };
  try { assert.throws(() => g.store.readOperation(key), code("EVIDENCE_FILE_UNSAFE")); } finally { fs.lstatSync = lstat; }
});

test("content/file hash chain, missing records, canonical bytes and lock archive damage are rejected", () => {
  for (const mutate of [value => value.previousFileSha256 = "0".repeat(64), value => value.content.observation.ledgerWrites = 1,
    value => value.contentSha256 = "f".repeat(64)]) {
    const f = fixture(); f.store.appendReceipt(key, f.started, null); f.store.appendReceipt(key, f.completed, fingerprint(f.started));
    const filename = path.join(f.directory, "operation-000002.json"), value = JSON.parse(fs.readFileSync(filename, "utf8"));
    mutate(value); fs.writeFileSync(filename, bytes(value)); assert.throws(() => f.store.readOperation(key));
  }
  const gap = fixture(); gap.store.appendReceipt(key, gap.started, null);
  fs.renameSync(path.join(gap.directory, "operation-000001.json"), `${gap.directory}.preserved-record`);
  assert.throws(() => gap.store.readOperation(key), code("EVIDENCE_STREAM_INCOMPLETE"));
  const malformed = fixture(); malformed.store.appendReceipt(key, malformed.started, null);
  fs.appendFileSync(path.join(malformed.directory, "operation-000001.json"), " ");
  assert.throws(() => malformed.store.readOperation(key), code("EVIDENCE_NONCANONICAL_JSON"));
  const lock = fixture(); lock.store.appendReceipt(key, lock.started, null);
  const owner = path.join(lock.directory, "operation-lock-000001", "owner.json"), value = JSON.parse(fs.readFileSync(owner, "utf8"));
  value.fileSha256 = "0".repeat(64); fs.writeFileSync(owner, bytes(value));
  assert.throws(() => lock.store.readOperation(key), code("EVIDENCE_LOCK_ARCHIVE_INVALID"));
});

test("file fsync failure retains data and fixed lock; independent sanitized audit can record unknown durability", () => {
  const f = fixture(), sync = fs.fsyncSync; let fileSyncs = 0;
  fs.fsyncSync = fd => { if (fs.fstatSync(fd).isFile() && ++fileSyncs === 2) throw Object.assign(new Error("DO_NOT_LEAK_RAW_ERROR"), { code: "EIO" }); return sync(fd); };
  try { assert.throws(() => f.store.appendReceipt(key, f.started, null), error => {
    assert.equal(error.message, "EVIDENCE_FILESYSTEM_FAILURE"); assert.equal(error.storageOutcome, "unknown"); assert.equal(error.automaticRetryAllowed, false); return true;
  }); } finally { fs.fsyncSync = sync; }
  assert.equal(fs.existsSync(path.join(f.directory, "operation-000001.json")), true);
  assert.equal(fs.existsSync(path.join(f.directory, "operation.lock", "owner.json")), true);
  assert.throws(() => f.store.readOperation(key), code("EVIDENCE_LOCK_PRESENT"));
  const unknown = audit({ phase: "adapter", outcome: "unknown", reason: "receipt-durability-unknown" });
  f.store.appendAttempt(unknown, null); assert.deepEqual(f.store.readAttempts(), [unknown]);
});

test("partial record writes remain untouched and do not prevent independent attempt audit", () => {
  const f = fixture(), write = fs.writeFileSync; let count = 0;
  fs.writeFileSync = (fd, value, ...rest) => {
    if (typeof fd === "number" && ++count === 2) { fs.writeSync(fd, value.subarray(0, 7)); throw new Error("synthetic partial write"); }
    return write(fd, value, ...rest);
  };
  try { assert.throws(() => f.store.appendReceipt(key, f.started, null), code("EVIDENCE_FILESYSTEM_FAILURE")); } finally { fs.writeFileSync = write; }
  assert.equal(fs.statSync(path.join(f.directory, "operation-000001.json")).size, 7);
  const unknown = audit({ phase: "adapter", outcome: "unknown", reason: "receipt-durability-unknown" });
  f.store.appendAttempt(unknown, null); assert.deepEqual(f.store.readAttempts(), [unknown]);
  assert.equal(fs.statSync(path.join(f.directory, "operation-000001.json")).size, 7);
});

test("failure after lock rename but before final parent fsync returns unknown, preserves all evidence, never retries", () => {
  const f = fixture(), sync = fs.fsyncSync, rename = fs.renameSync; let renamed = false, injected = false;
  fs.renameSync = (...args) => { const result = rename(...args); renamed = true; return result; };
  fs.fsyncSync = fd => { if (renamed && !injected && fs.fstatSync(fd).isDirectory()) { injected = true; throw new Error("synthetic final directory fsync failure"); } return sync(fd); };
  try { assert.throws(() => f.store.appendReceipt(key, f.started, null), error => error.storageOutcome === "unknown" && error.automaticRetryAllowed === false); }
  finally { fs.fsyncSync = sync; fs.renameSync = rename; }
  assert.equal(fs.existsSync(path.join(f.directory, "operation.lock")), false);
  assert.equal(fs.existsSync(path.join(f.directory, "operation-lock-000001", "owner.json")), true);
  assert.deepEqual(f.store.readOperation(key), [f.started]); // visibility is NOT durability acknowledgement.
  const unknown = audit({ phase: "adapter", outcome: "unknown", reason: "receipt-durability-unknown" });
  f.store.appendAttempt(unknown, null); assert.deepEqual(f.store.readAttempts(), [unknown]);
});
