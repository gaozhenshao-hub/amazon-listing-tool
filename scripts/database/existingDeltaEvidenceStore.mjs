// Inert, trusted Root-launcher filesystem adapter; not an authorization service
// or signature. No database/VM/credential/environment reads or execution entry.
// Only synthetic/private evidence explicitly supplied by the caller is stored.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const STORE_VERSION = "amazon-existing-delta-evidence-store/1";
const RECORD_VERSION = "amazon-existing-delta-evidence-record/1";
const LOCK_VERSION = "amazon-existing-delta-evidence-lock/1";
const EXECUTION_VERSION = "amazon-existing-delta-execution/1";
const SCOPE = "local-isolated-delta-evaluation-only";
const SQL_SHA256 = "5ef700e8633dc3ce638a42baf4d7df76c54ee00c393e2973ac90ba2cdaeaee75";
const MAX_ATTEMPTS = 10_000, MAX_FILE_BYTES = 64 * 1024;
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const insist = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const same = (a, b, code) => insist(isDeepStrictEqual(a, b), code);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const evidenceFingerprint = value => digest(JSON.stringify(canonical(value)));
const encode = value => Buffer.from(`${JSON.stringify(canonical(value))}\n`);
const suffix = sequence => String(sequence).padStart(6, "0");
const failure = (error, attemptedWrite = false) => Object.assign(new Error(
  /^EVIDENCE_[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : "EVIDENCE_FILESYSTEM_FAILURE"), {
  code: /^EVIDENCE_[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : "EVIDENCE_FILESYSTEM_FAILURE",
  storageOutcome: attemptedWrite ? "unknown" : "not-written", automaticRetryAllowed: false,
});

function bindingValid(binding) {
  const hashes = ["authorizationSha256", "inputsSha256", "instanceSha256", "candidateSqlSha256", "beforeFullCatalogSha256",
    "afterFullCatalogSha256", "beforeScopedCatalogSha256", "afterScopedCatalogSha256", "ledgerSnapshotSha256"];
  insist(exact(binding, ["scope", ...hashes, "schema", "ledgerFields", "ledgerRows", "fullHistoricalLedgerFieldsVerified",
    "historicalExecutionProven", "generalRunnerAdmitted", "productionApproved"])
    && binding.scope === SCOPE && hashes.every(key => hash(binding[key])) && binding.candidateSqlSha256 === SQL_SHA256
    && /^amazon_existing_[a-f0-9]{16}_synthetic$/.test(binding.schema) && binding.ledgerRows === 174
    && isDeepStrictEqual(binding.ledgerFields, ["migrationName", "checksum", "status"])
    && ["fullHistoricalLedgerFieldsVerified", "historicalExecutionProven", "generalRunnerAdmitted", "productionApproved"]
      .every(key => binding[key] === false), "EVIDENCE_BINDING_INVALID");
}

function parameters(options, opening) {
  insist(exact(options, ["directory", "operationKey", "binding", ...(opening ? ["manifestSha256"] : [])])
    && typeof options.directory === "string" && path.isAbsolute(options.directory) && path.normalize(options.directory) === options.directory
    && /^amazon-existing-delta-evidence\.[A-Za-z0-9]{6,24}$/.test(path.basename(options.directory))
    && /^existing-delta:[a-f0-9]{48}$/.test(options.operationKey)
    && (!opening || hash(options.manifestSha256)), "EVIDENCE_OPTIONS_INVALID");
  bindingValid(options.binding); return structuredClone(options);
}

function uid() {
  insist(typeof process.getuid === "function" && ["linux", "darwin"].includes(process.platform), "EVIDENCE_POSIX_REQUIRED");
  return process.getuid();
}
function directoryStat(directory, owner, mode) {
  const value = fs.lstatSync(directory);
  insist(value.isDirectory() && !value.isSymbolicLink() && value.uid === owner && (value.mode & 0o7777) === mode
    && fs.realpathSync(directory) === directory, "EVIDENCE_DIRECTORY_UNSAFE");
  return value;
}
function sameInode(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
}
function trustedParent(directory, owner) {
  const parent = path.dirname(directory), value = fs.lstatSync(parent);
  for (let current = parent; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    insist(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(current) === current
      && (stat.uid === owner || stat.uid === 0)
      && ((stat.mode & 0o022) === 0 || stat.uid === 0 && (stat.mode & 0o7777) === 0o1777), "EVIDENCE_PARENT_UNSAFE");
    if (current === path.dirname(current)) break;
  }
  return { parent, value };
}
function syncDirectory(directory, expected) {
  const before = fs.lstatSync(directory);
  insist(before.isDirectory() && !before.isSymbolicLink() && sameInode(before, expected), "EVIDENCE_DIRECTORY_DRIFT");
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { insist(sameInode(fs.fstatSync(fd), before), "EVIDENCE_DIRECTORY_DRIFT"); fs.fsyncSync(fd);
    insist(sameInode(fs.lstatSync(directory), before), "EVIDENCE_DIRECTORY_DRIFT");
  } finally { fs.closeSync(fd); }
}
function fileStat(filename, owner, allowEmpty = false) {
  const value = fs.lstatSync(filename);
  insist(value.isFile() && !value.isSymbolicLink() && value.nlink === 1 && value.uid === owner
    && (value.mode & 0o7777) === 0o600 && (allowEmpty || value.size > 0) && value.size <= MAX_FILE_BYTES, "EVIDENCE_FILE_UNSAFE");
  return value;
}
function readFile(filename, owner) {
  const parentPath = path.dirname(filename), parent = directoryStat(parentPath, owner, 0o700);
  const before = fileStat(filename, owner), fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    insist(sameInode(fs.fstatSync(fd), before), "EVIDENCE_FILE_DRIFT");
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    insist(sameInode(after, before) && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
      && sameInode(fileStat(filename, owner), before) && bytes.length === before.size
      && sameInode(directoryStat(parentPath, owner, 0o700), parent), "EVIDENCE_FILE_DRIFT");
    let content; try { content = JSON.parse(bytes.toString("utf8")); } catch { insist(false, "EVIDENCE_JSON_INVALID"); }
    insist(bytes.equals(encode(content)), "EVIDENCE_NONCANONICAL_JSON");
    return { content, sha256: digest(bytes) };
  } finally { fs.closeSync(fd); }
}
function writeNew(filename, value, owner) {
  const bytes = encode(value); insist(bytes.length <= MAX_FILE_BYTES, "EVIDENCE_FILE_TOO_LARGE");
  const parentPath = path.dirname(filename), parent = directoryStat(parentPath, owner, 0o700);
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const before = fs.fstatSync(fd);
    insist(before.isFile() && before.uid === owner && before.nlink === 1 && (before.mode & 0o7777) === 0o600, "EVIDENCE_NEW_FILE_UNSAFE");
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    const after = fs.fstatSync(fd);
    insist(sameInode(after, before) && after.nlink === 1 && after.size === bytes.length
      && sameInode(fileStat(filename, owner), before)
      && sameInode(directoryStat(parentPath, owner, 0o700), parent), "EVIDENCE_FILE_DRIFT");
  } finally { fs.closeSync(fd); }
  return digest(bytes);
}

function operationEntry(entry, options, previous) {
  insist(exact(entry, ["version", "operationKey", "sequence", "previousSha256", "binding", "status", "observation"])
    && entry.version === EXECUTION_VERSION && entry.operationKey === options.operationKey
    && entry.sequence === (previous ? 2 : 1) && entry.previousSha256 === (previous ? evidenceFingerprint(previous) : null), "EVIDENCE_OPERATION_CHAIN_INVALID");
  same(entry.binding, options.binding, "EVIDENCE_OPERATION_BINDING_CHANGED"); bindingValid(entry.binding);
  const observation = entry.observation;
  insist(exact(observation, ["ddlDispatches", "alterAcknowledged", "ledgerWrites", "lockReleased", "beforeVerified", "afterVerified", "errorCode"])
    && observation.ledgerWrites === 0 && observation.beforeVerified === true, "EVIDENCE_OPERATION_OBSERVATION_INVALID");
  const start = { ddlDispatches: 0, alterAcknowledged: false, ledgerWrites: 0, lockReleased: false,
    beforeVerified: true, afterVerified: false, errorCode: null };
  if (!previous) insist(entry.status === "started" && isDeepStrictEqual(observation, start), "EVIDENCE_STARTED_REQUIRED");
  else if (entry.status === "completed") same(observation, { ...start, ddlDispatches: 1, alterAcknowledged: true,
    afterVerified: true, lockReleased: true }, "EVIDENCE_COMPLETED_INVALID");
  else {
    insist(["failed", "unknown"].includes(entry.status) && typeof observation.lockReleased === "boolean"
      && typeof observation.alterAcknowledged === "boolean" && typeof observation.afterVerified === "boolean"
      && typeof observation.errorCode === "string"
      && /^(?:DELTA_[A-Z0-9_]{1,64}|LOCAL_DELTA_FAILED|ER_[A-Z0-9_]{1,64}|PROTOCOL_[A-Z0-9_]{1,64}|E[A-Z0-9]{1,20})$/.test(observation.errorCode)
      && (entry.status === "failed" ? observation.ddlDispatches === 0 && observation.alterAcknowledged === false && observation.afterVerified === false
        : observation.ddlDispatches === 1 && (!observation.afterVerified || observation.alterAcknowledged)), "EVIDENCE_FAILURE_INVALID");
  }
}

const AUDIT_REASONS = Object.freeze({
  refused: ["authorization-refused", "input-refused", "native-proof-refused", "schema-or-ledger-drift", "lock-refused", "receipt-refused", "core-refused", "launcher-refused"],
  unknown: ["deadline-exceeded", "execution-outcome-unknown", "receipt-durability-unknown"],
  completed: ["core-completed"], "noop-verified": ["core-noop-verified"],
});
function attemptEntry(entry) {
  insist(exact(entry, ["attemptId", "phase", "outcome", "reason", "authorizationSha256", "coreReceiptSha256", "automaticRetryAllowed"])
    && /^[a-f0-9]{32}$/.test(entry.attemptId) && ["pre-core", "core", "post-core", "adapter"].includes(entry.phase)
    && Object.hasOwn(AUDIT_REASONS, entry.outcome) && AUDIT_REASONS[entry.outcome].includes(entry.reason)
    && (entry.authorizationSha256 === null || hash(entry.authorizationSha256))
    && (entry.coreReceiptSha256 === null || hash(entry.coreReceiptSha256)) && entry.automaticRetryAllowed === false
    && (!["completed", "noop-verified"].includes(entry.outcome) || entry.phase === "post-core" && hash(entry.coreReceiptSha256))
    && (entry.phase !== "pre-core" || entry.outcome === "refused" && entry.coreReceiptSha256 === null), "EVIDENCE_ATTEMPT_INVALID");
}

/** Creates a NEW dedicated directory only; failures retain every created byte. */
export function initializeExistingDeltaEvidenceStore(requested) {
  let attempted = false;
  try {
    const options = parameters(requested, false), owner = uid(), parent = trustedParent(options.directory, owner);
    attempted = true; fs.mkdirSync(options.directory, { mode: 0o700 });
    const root = directoryStat(options.directory, owner, 0o700); syncDirectory(parent.parent, parent.value);
    const manifest = { version: STORE_VERSION, operationKey: options.operationKey, binding: options.binding,
      bindingSha256: evidenceFingerprint(options.binding) };
    const manifestSha256 = writeNew(path.join(options.directory, "store.json"), manifest, owner);
    syncDirectory(options.directory, root); syncDirectory(parent.parent, parent.value);
    return { ...options, manifestSha256 };
  } catch (error) { throw failure(error, attempted); }
}

/**
 * Return only the two operation methods to core evidenceIO; loadBoundInputs and
 * verifyLocalInstance remain separately audited launcher responsibilities.
 * appendReceipt acknowledgement sha256 is fingerprint(entry), not the JSON-file
 * hash; both hashes are preserved in independently validated on-disk envelopes.
 *
 * Launcher MUST catch ALL refusals, including pre-core validation/try-boundary
 * errors, and appendAttempt a fixed-reason sanitized audit. It must refuse
 * automatic retries. Neither a memory rerunAllowed:false nor absence of a
 * started operation proves a persistent refusal. Store failures are unknown;
 * never overwrite, delete, reset or infer that a stale lock is safe to remove.
 * The independent attempt stream remains usable if an operation lock is stale.
 *
 * Threat boundary: cooperative same-UID local launchers and a trusted private
 * filesystem with POSIX mkdir/rename/fsync semantics. This does not defend an
 * actively malicious same-UID/root actor, storage lying about fsync, or network
 * filesystem semantics. An injected connection is NOT authenticated here.
 */
export function openExistingDeltaEvidenceStore(requested) {
  try {
    const options = parameters(requested, true), owner = uid(), parent = trustedParent(options.directory, owner);
    const root = directoryStat(options.directory, owner, 0o700), manifestPath = path.join(options.directory, "store.json");
    const wantedManifest = { version: STORE_VERSION, operationKey: options.operationKey, binding: options.binding,
      bindingSha256: evidenceFingerprint(options.binding) };
    const check = () => {
      insist(sameInode(directoryStat(options.directory, owner, 0o700), root)
        && sameInode(trustedParent(options.directory, owner).value, parent.value), "EVIDENCE_DIRECTORY_DRIFT");
      const manifest = readFile(manifestPath, owner);
      insist(manifest.sha256 === options.manifestSha256, "EVIDENCE_MANIFEST_HASH_CHANGED");
      same(manifest.content, wantedManifest, "EVIDENCE_MANIFEST_CHANGED");
      const names = fs.readdirSync(options.directory);
      insist(names.length <= MAX_ATTEMPTS * 2 + 10, "EVIDENCE_DIRECTORY_TOO_LARGE");
      for (const name of names) {
        const filename = path.join(options.directory, name);
        if (name === "store.json") fileStat(filename, owner);
        else if (/^(?:operation|attempt)-\d{6}\.json$/.test(name)) fileStat(filename, owner, true);
        else if (/^(?:operation|attempt)(?:\.lock|-lock-\d{6})$/.test(name)) directoryStat(filename, owner, 0o700);
        else insist(false, "EVIDENCE_UNEXPECTED_ENTRY");
      }
      return names;
    };
    const readStream = (stream, ownsActiveLock = false) => {
      const names = check(), maximum = stream === "operation" ? 2 : MAX_ATTEMPTS;
      insist(ownsActiveLock || !names.includes(`${stream}.lock`), "EVIDENCE_LOCK_PRESENT");
      const files = names.filter(name => name.startsWith(`${stream}-`) && name.endsWith(".json")).sort();
      const archives = names.filter(name => name.startsWith(`${stream}-lock-`)).sort();
      insist(files.length <= maximum && archives.length === files.length, "EVIDENCE_STREAM_INCOMPLETE");
      const records = [], seenAttempts = new Set();
      for (const [index, name] of files.entries()) {
        const sequence = index + 1, previous = records.at(-1);
        insist(name === `${stream}-${suffix(sequence)}.json` && archives[index] === `${stream}-lock-${suffix(sequence)}`, "EVIDENCE_SEQUENCE_GAP");
        const record = readFile(path.join(options.directory, name), owner), value = record.content;
        insist(exact(value, ["version", "operationKey", "stream", "sequence", "previousContentSha256", "previousFileSha256", "contentSha256", "content"])
          && value.version === RECORD_VERSION && value.operationKey === options.operationKey && value.stream === stream && value.sequence === sequence
          && value.previousContentSha256 === (previous?.content.contentSha256 ?? null)
          && value.previousFileSha256 === (previous?.sha256 ?? null) && value.contentSha256 === evidenceFingerprint(value.content), "EVIDENCE_RECORD_CHAIN_INVALID");
        if (stream === "operation") operationEntry(value.content, options, previous?.content.content ?? null);
        else { attemptEntry(value.content); insist(!seenAttempts.has(value.content.attemptId), "EVIDENCE_ATTEMPT_DUPLICATE"); seenAttempts.add(value.content.attemptId); }
        const archive = path.join(options.directory, archives[index]);
        same(fs.readdirSync(archive), ["owner.json"], "EVIDENCE_LOCK_ARCHIVE_INVALID");
        const lock = readFile(path.join(archive, "owner.json"), owner).content;
        insist(exact(lock, ["version", "operationKey", "stream", "sequence", "token", "previousContentSha256", "contentSha256", "fileSha256"])
          && lock.version === LOCK_VERSION && lock.operationKey === options.operationKey && lock.stream === stream && lock.sequence === sequence
          && /^[a-f0-9]{32}$/.test(lock.token) && lock.previousContentSha256 === value.previousContentSha256
          && lock.contentSha256 === value.contentSha256 && lock.fileSha256 === record.sha256, "EVIDENCE_LOCK_ARCHIVE_INVALID");
        records.push(record);
      }
      return records;
    };
    const append = (stream, entry, expectedPreviousSha256) => {
      let attempted = false;
      try {
        insist(expectedPreviousSha256 === null || hash(expectedPreviousSha256), "EVIDENCE_CAS_INVALID");
        // Reject raw errors/unknown fields before creating any storage intent.
        if (stream === "attempt") attemptEntry(entry);
        check(); const lockPath = path.join(options.directory, `${stream}.lock`);
        attempted = true;
        try { fs.mkdirSync(lockPath, { mode: 0o700 }); } catch (error) {
          if (error.code === "EEXIST") insist(false, "EVIDENCE_LOCK_PRESENT"); throw error;
        }
        const lockStat = directoryStat(lockPath, owner, 0o700); syncDirectory(options.directory, root);
        const records = readStream(stream, true), previous = records.at(-1), sequence = records.length + 1;
        insist(sequence <= (stream === "operation" ? 2 : MAX_ATTEMPTS), "EVIDENCE_STREAM_COMPLETE");
        insist(expectedPreviousSha256 === (previous?.content.contentSha256 ?? null), "EVIDENCE_CAS_MISMATCH");
        if (stream === "operation") operationEntry(entry, options, previous?.content.content ?? null);
        else insist(!records.some(record => record.content.content.attemptId === entry.attemptId), "EVIDENCE_ATTEMPT_DUPLICATE");
        const content = structuredClone(entry), contentSha256 = evidenceFingerprint(content);
        const envelope = { version: RECORD_VERSION, operationKey: options.operationKey, stream, sequence,
          previousContentSha256: expectedPreviousSha256, previousFileSha256: previous?.sha256 ?? null, contentSha256, content };
        const fileSha256 = digest(encode(envelope));
        const lockValue = { version: LOCK_VERSION, operationKey: options.operationKey, stream, sequence,
          token: randomBytes(16).toString("hex"), previousContentSha256: expectedPreviousSha256, contentSha256, fileSha256 };
        writeNew(path.join(lockPath, "owner.json"), lockValue, owner);
        syncDirectory(lockPath, lockStat); syncDirectory(options.directory, root);
        const filename = path.join(options.directory, `${stream}-${suffix(sequence)}.json`);
        insist(writeNew(filename, envelope, owner) === fileSha256, "EVIDENCE_WRITE_HASH_MISMATCH");
        syncDirectory(options.directory, root);
        insist(readFile(filename, owner).sha256 === fileSha256, "EVIDENCE_WRITE_HASH_MISMATCH");
        const archive = path.join(options.directory, `${stream}-lock-${suffix(sequence)}`);
        insist(!fs.readdirSync(options.directory).includes(path.basename(archive)), "EVIDENCE_ARCHIVE_EXISTS");
        insist(sameInode(directoryStat(lockPath, owner, 0o700), lockStat), "EVIDENCE_LOCK_DRIFT");
        // Cooperative writers all hold this exact fixed directory lock. Rename
        // retains its evidence (no unlink/delete), then frees the fixed name.
        fs.renameSync(lockPath, archive); syncDirectory(options.directory, root);
        // Another cooperative writer may acquire the newly freed lock now. Do
        // not demand an idle/unchanged whole stream after releasing our lock.
        check(); insist(readFile(filename, owner).sha256 === fileSha256, "EVIDENCE_POSTWRITE_DRIFT");
        same(fs.readdirSync(archive), ["owner.json"], "EVIDENCE_LOCK_ARCHIVE_INVALID");
        same(readFile(path.join(archive, "owner.json"), owner).content, lockValue, "EVIDENCE_LOCK_ARCHIVE_INVALID");
        return { durable: true, sha256: contentSha256 };
      } catch (error) { throw failure(error, attempted); }
    };
    check();
    return Object.freeze({
      readOperation(operationKey) { try { insist(operationKey === options.operationKey, "EVIDENCE_OPERATION_KEY_CHANGED");
        return readStream("operation").map(record => structuredClone(record.content.content));
      } catch (error) { throw failure(error); } },
      appendReceipt(operationKey, entry, expectedPreviousSha256) {
        try { insist(operationKey === options.operationKey, "EVIDENCE_OPERATION_KEY_CHANGED"); }
        catch (error) { throw failure(error); }
        return append("operation", entry, expectedPreviousSha256);
      },
      readAttempts() { try { return readStream("attempt").map(record => structuredClone(record.content.content)); }
        catch (error) { throw failure(error); } },
      appendAttempt(entry, expectedPreviousSha256) { return append("attempt", entry, expectedPreviousSha256); },
    });
  } catch (error) { throw failure(error); }
}
