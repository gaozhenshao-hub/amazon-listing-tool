// Inert, narrowly scoped LOCAL evaluation core. No connector, environment/file
// reader, migration runner, ledger writer, baseline or production entrypoint.
// The injected connection and evidenceIO are TRUSTED caller interfaces, not
// signatures or independent authorization. A separately reviewed root launcher
// must authenticate private evidence, native process/socket identity, dependency
// bytes, credentials and durable receipt storage before calling this module.
import { isDeepStrictEqual } from "node:util";
import { fingerprint, insist, validateCatalog } from "./freshBootstrapPlan.mjs";
import { assessExistingLineage, ADOPTION_TABLES } from "./existingLineageAdmission.mjs";
import { planExistingDelta, DELTA_DEFINITION } from "./existingDeltaPlan.mjs";
import { CANDIDATE_SQL, COLUMN_CONTRACTS, TABLE_NAME } from "../integration/campaignNullabilityContract.mjs";
import { DDL_CATALOG } from "../integration/exportProductionDdl.mjs";

export const EXECUTION_SCOPE = "local-isolated-delta-evaluation-only";
export const EXECUTION_VERSION = "amazon-existing-delta-execution/1";
export const IDENTITY_SQL = "SELECT DATABASE() AS schemaName, CONNECTION_ID() AS connectionId, @@version AS version, @@lower_case_table_names AS lowerCaseTableNames, @@skip_networking AS skipNetworking, @@port AS port, @@socket AS socket, @@datadir AS datadir, @@pid_file AS pidFile, @@server_uuid AS serverUuid, @@event_scheduler AS eventScheduler, (SELECT PLUGIN_STATUS FROM information_schema.PLUGINS WHERE PLUGIN_NAME='mysqlx') AS mysqlX";
export const LEDGER_SQL = "SELECT migrationName, checksum, status FROM app_schema_migrations ORDER BY BINARY migrationName LIMIT 175";
export const LOCK_SQL = "SELECT GET_LOCK(?, 0) AS acquired";
export const UNLOCK_SQL = "SELECT RELEASE_LOCK(?) AS released";
const SESSIONS = Object.freeze(["SET SESSION information_schema_stats_expiry=0", "SET SESSION lock_wait_timeout=5"]);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (object, keys) => object && typeof object === "object" && !Array.isArray(object)
  && isDeepStrictEqual(Object.keys(object).sort(), [...keys].sort());
const equal = (a, b, code) => insist(isDeepStrictEqual(a, b), code);
const clone = value => structuredClone(value);
const safeCode = error => /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code ?? "") ? error.code : "LOCAL_DELTA_FAILED";

// Lazy work factory: no query may start after the deadline. Timeout destroys the
// connection; it CANNOT roll back an implicit-commit ALTER or prove its outcome.
export function createExecutionDeadline(milliseconds = 180_000) {
  insist(Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= 180_000, "DELTA_DEADLINE_INVALID");
  const until = Date.now() + milliseconds;
  return async (work, maximum, abort = () => {}) => {
    const remaining = until - Date.now(); insist(remaining > 0, "DELTA_DEADLINE_EXCEEDED");
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
        timer = setTimeout(() => { try { abort(); } catch { /* Destruction must not suppress timeout. */ }
          reject(Object.assign(new Error("DELTA_DEADLINE_EXCEEDED"), { code: "DELTA_DEADLINE_EXCEEDED" }));
        }, Math.min(remaining, maximum));
      })]);
    } finally { clearTimeout(timer); }
  };
}

function checkAuthorization(value) {
  insist(exact(value, ["version", "scope", "executeLocalIsolatedDelta", "schema", "instance", "inputsSha256"])
    && value.version === EXECUTION_VERSION && value.scope === EXECUTION_SCOPE && value.executeLocalIsolatedDelta === true
    && /^amazon_existing_[a-f0-9]{16}_synthetic$/.test(value.schema) && hash(value.inputsSha256), "DELTA_LOCAL_AUTHORIZATION_REQUIRED");
  const instance = value.instance;
  insist(exact(instance, ["platform", "version", "root", "socket", "datadir", "pidFile", "pid", "startTime", "serverUuid", "nativeProofSha256"])
    && instance.platform === "linux" && instance.version === "8.0.46-0ubuntu0.24.04.4"
    && /^\/tmp\/amazon-existing-mysql8\.[A-Za-z0-9]{6,24}$/.test(instance.root)
    && instance.socket === `${instance.root}/mysql.sock` && instance.datadir === `${instance.root}/data/`
    && instance.pidFile === `${instance.root}/mysqld.pid` && Number.isSafeInteger(instance.pid) && instance.pid > 1
    && /^[1-9][0-9]*$/.test(instance.startTime) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(instance.serverUuid)
    && hash(instance.nativeProofSha256), "DELTA_LOCAL_INSTANCE_BINDING_INVALID");
  return clone(value);
}

function checkTransport(connection, authorization) {
  insist(connection && typeof connection.query === "function" && typeof connection.destroy === "function", "DELTA_TRUSTED_CONNECTION_REQUIRED");
  equal(connection.transport, { socketPath: authorization.instance.socket, database: authorization.schema,
    multipleStatements: false, rowsAsArray: false, host: null, port: null }, "DELTA_SOCKET_TRANSPORT_REQUIRED");
}

function canonicalLedger(snapshot) {
  insist(exact(snapshot, ["present", "rows"]) && snapshot.present === true && Array.isArray(snapshot.rows)
    && snapshot.rows.length === 174, "DELTA_174_OBSERVATION_ROWS_REQUIRED");
  const rows = snapshot.rows.map(row => {
    insist(exact(row, ["migrationName", "checksum", "status"]) && typeof row.migrationName === "string"
      && /^[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/.test(row.migrationName) && row.migrationName.length <= 255
      && hash(row.checksum) && ["succeeded", "baselined"].includes(row.status), "DELTA_LEDGER_OBSERVATION_INVALID");
    return { ...row };
  }).sort((a, b) => a.migrationName < b.migrationName ? -1 : a.migrationName > b.migrationName ? 1 : 0);
  insist(new Set(rows.map(row => row.migrationName)).size === 174, "DELTA_LEDGER_OBSERVATION_DUPLICATE");
  return { present: true, rows };
}

function fullCatalog(catalog, names, schema) {
  insist(catalog?.tables?.length === 312 && catalog.schema?.[0]?.schemaName === schema, "DELTA_FULL_312_SCHEMA_REQUIRED");
  for (const table of catalog.tables) insist(table.autoIncrement === null
    || /^(?:[1-9][0-9]*)$/.test(String(table.autoIncrement)), "DELTA_RAW_COUNTER_REQUIRED");
  return validateCatalog(catalog, names);
}

function expectedAfter(raw) {
  const result = clone(raw), names = new Set(COLUMN_CONTRACTS.map(column => column.name));
  for (const column of result.columns) if (column.tableName === TABLE_NAME && names.has(column.columnName)) {
    column.isNullable = "YES"; column.columnDefault = null;
  }
  return result;
}

function validateInputs(inputs, authorization) {
  insist(exact(inputs, ["generalPlan", "ledgerSnapshot", "fullSourceCatalog", "sourceContract", "adoption", "lineage", "definition", "evidence"])
    && fingerprint(inputs) === authorization.inputsSha256, "DELTA_PRIVATE_INPUT_BINDING_CHANGED");
  const ledger = canonicalLedger(inputs.ledgerSnapshot), names = inputs.fullSourceCatalog?.tables?.map(table => table.tableName);
  insist(Array.isArray(names) && names.includes("app_schema_migrations"), "DELTA_LEDGER_TABLE_MISSING");
  const full = fullCatalog(inputs.fullSourceCatalog, names, inputs.fullSourceCatalog.schema?.[0]?.schemaName);
  const admitted = assessExistingLineage({ generalPlan: inputs.generalPlan, ledgerSnapshot: ledger,
    currentCatalog: inputs.fullSourceCatalog, adoption: inputs.adoption });
  equal(admitted, inputs.lineage, "DELTA_ADMISSION_CHANGED");
  const plan = planExistingDelta({ ...inputs, currentCatalog: inputs.fullSourceCatalog });
  insist(plan.action === "alter" && plan.sql === CANDIDATE_SQL && plan.sqlSha256 === DELTA_DEFINITION.sqlSha256
    && plan.currentFullCatalogSha256 === fingerprint(full), "DELTA_FROZEN_OLD_SOURCE_REQUIRED");
  return { ledger, names, plan };
}

// mysql2 3.15.1 text_parser: LONGLONG + supportBigNumbers/bigNumberStrings
// returns a decimal string, whereas LONG/TINY return numbers. Normalize ONLY
// four identity integers and two lock results, never catalog/ledger metadata.
export function canonicalControlInteger(value) {
  insist(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
    || typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)
      && Number.isSafeInteger(Number(value)), "DELTA_IDENTITY_INTEGER_INVALID");
  return Number(value);
}

function liveIdentity(rows, authorization) {
  insist(Array.isArray(rows) && rows.length === 1, "DELTA_IDENTITY_INVALID");
  const row = clone(rows[0]), { instance, schema } = authorization;
  insist(exact(row, ["schemaName", "connectionId", "version", "lowerCaseTableNames", "skipNetworking", "port", "socket", "datadir", "pidFile", "serverUuid", "eventScheduler", "mysqlX"]), "DELTA_IDENTITY_INVALID");
  for (const name of ["connectionId", "lowerCaseTableNames", "skipNetworking", "port"]) row[name] = canonicalControlInteger(row[name]);
  insist(row.connectionId > 0, "DELTA_IDENTITY_INVALID");
  equal({ ...row, connectionId: 0 }, { schemaName: schema, connectionId: 0, version: instance.version,
    lowerCaseTableNames: 0, skipNetworking: 1, port: 0, socket: instance.socket, datadir: instance.datadir,
    pidFile: instance.pidFile, serverUuid: instance.serverUuid, eventScheduler: "OFF", mysqlX: "DISABLED" }, "DELTA_LIVE_ISOLATION_MISMATCH");
  return clone(row);
}

function bindingFor(authorization, checked) {
  return { scope: EXECUTION_SCOPE, authorizationSha256: fingerprint(authorization), inputsSha256: authorization.inputsSha256,
    instanceSha256: fingerprint(authorization.instance), schema: authorization.schema, candidateSqlSha256: DELTA_DEFINITION.sqlSha256,
    beforeFullCatalogSha256: checked.plan.currentFullCatalogSha256, afterFullCatalogSha256: checked.plan.expectedAfterFullCatalogSha256,
    beforeScopedCatalogSha256: checked.plan.currentScopedCatalogSha256, afterScopedCatalogSha256: checked.plan.expectedAfterScopedCatalogSha256,
    ledgerSnapshotSha256: fingerprint(checked.ledger), ledgerFields: ["migrationName", "checksum", "status"], ledgerRows: 174,
    fullHistoricalLedgerFieldsVerified: false, historicalExecutionProven: false, generalRunnerAdmitted: false, productionApproved: false };
}

function receipt(operationKey, binding, status, previous, observation) {
  return { version: EXECUTION_VERSION, operationKey, sequence: previous ? 2 : 1, previousSha256: previous ? fingerprint(previous) : null,
    binding: clone(binding), status, observation: { ddlDispatches: 0, alterAcknowledged: false, ledgerWrites: 0,
      lockReleased: false, beforeVerified: false, afterVerified: false, errorCode: null, ...observation } };
}

function inspectJournal(journal, operationKey, binding) {
  insist(Array.isArray(journal) && journal.length <= 2, "DELTA_OPERATION_JOURNAL_INVALID");
  if (!journal.length) return false;
  for (const [index, entry] of journal.entries()) {
    insist(exact(entry, ["version", "operationKey", "sequence", "previousSha256", "binding", "status", "observation"])
      && entry.version === EXECUTION_VERSION && entry.operationKey === operationKey && entry.sequence === index + 1
      && entry.previousSha256 === (index ? fingerprint(journal[0]) : null), "DELTA_OPERATION_JOURNAL_INVALID");
    equal(entry.binding, binding, "DELTA_OPERATION_BINDING_CHANGED");
  }
  const started = receipt(operationKey, binding, "started", null, { beforeVerified: true });
  equal(journal[0], started, "DELTA_OPERATION_JOURNAL_INVALID");
  insist(journal.length === 2 && journal[1].status === "completed", "DELTA_PRIOR_OUTCOME_REQUIRES_REVIEW");
  equal(journal[1], receipt(operationKey, binding, "completed", started,
    { ddlDispatches: 1, alterAcknowledged: true, beforeVerified: true, afterVerified: true, lockReleased: true }), "DELTA_OPERATION_JOURNAL_INVALID");
  return true;
}

/**
 * evidenceIO (trusted root launcher, not a cryptographic authority):
 * loadBoundInputs() -> the private immutable input object authenticated by
 * authorization.inputsSha256; verifyLocalInstance(instance) -> EXACT instance
 * after real Linux/native/PID-birth/socket/no-forward verification each time;
 * readOperation(key) -> [] or complete append-only journal;
 * appendReceipt(key, entry, expectedPreviousSha256) -> {durable:true,sha256}.
 * appendReceipt MUST atomically compare-and-append + fsync private external
 * storage. It must never write MySQL, invent history, or overwrite a receipt.
 * Timeouts can leave a durable started record and/or committed ALTER. Never
 * retry automatically or delete/reset that record to admit another attempt.
 * No business rows/full historical ledger metadata are read or certified here.
 */
export async function executeExistingDelta({ authorization: requested, connection, evidenceIO }) {
  const bound = createExecutionDeadline(), authorization = checkAuthorization(requested);
  checkTransport(connection, authorization);
  insist(exact(evidenceIO, ["loadBoundInputs", "verifyLocalInstance", "readOperation", "appendReceipt"])
    && Object.values(evidenceIO).every(fn => typeof fn === "function"), "DELTA_PRIVATE_EVIDENCE_IO_REQUIRED");
  const external = work => bound(work, 5000);
  const inputs = clone(await external(() => evidenceIO.loadBoundInputs()));
  const checked = validateInputs(inputs, authorization), binding = bindingFor(authorization, checked);
  // Stable per physical server/schema/delta, NOT per approval/proof timestamp or
  // hash. Refreshing evidence must not obtain a different lock/journal namespace.
  const operationKey = `existing-delta:${fingerprint({ schema: authorization.schema,
    serverUuid: authorization.instance.serverUuid, sql: DELTA_DEFINITION.sqlSha256 }).slice(0, 48)}`;
  let lockHeld = false, lockReleased = false, releaseAttempted = false, destroyed = false, ddlDispatches = 0, alterAcknowledged = false;
  let started = null, phase = "checks", priorCompleted = false, beforeVerified = false, afterVerified = false;
  const destroy = () => { destroyed = true; connection.destroy(); };
  const query = async (sql, values = []) => {
    checkTransport(connection, authorization);
    const catalog = Object.values(DDL_CATALOG).find(definition => definition.sql === sql);
    const permitted = catalog ? isDeepStrictEqual(values, Array((sql.match(/\?/g) ?? []).length).fill(authorization.schema))
      : [LOCK_SQL, UNLOCK_SQL].includes(sql) ? isDeepStrictEqual(values, [operationKey])
        : [IDENTITY_SQL, LEDGER_SQL, ...SESSIONS].includes(sql) ? values.length === 0
          : sql === CANDIDATE_SQL && phase === "alter" && lockHeld && started !== null && ddlDispatches === 0 && values.length === 0;
    insist(permitted && !destroyed, "DELTA_SQL_OUT_OF_SCOPE");
    return bound(() => {
      if (sql === CANDIDATE_SQL) ddlDispatches++;
      return connection.query({ sql, timeout: sql === CANDIDATE_SQL ? 60_000 : 5000 }, values);
    }, sql === CANDIDATE_SQL ? 60_000 : 5000, destroy);
  };
  const native = async () => equal(await external(() => evidenceIO.verifyLocalInstance(clone(authorization.instance))),
    authorization.instance, "DELTA_NATIVE_INSTANCE_CHANGED");
  const readState = async () => {
    await native(); const [identityRows] = await query(IDENTITY_SQL), identity = liveIdentity(identityRows, authorization);
    const [ledgerRows] = await query(LEDGER_SQL), ledger = canonicalLedger({ present: true, rows: ledgerRows });
    equal(ledger, checked.ledger, "DELTA_LEDGER_OBSERVATIONS_CHANGED");
    const raw = {};
    for (const [name, definition] of Object.entries(DDL_CATALOG)) {
      const [rows] = await query(definition.sql, Array((definition.sql.match(/\?/g) ?? []).length).fill(authorization.schema)); raw[name] = clone(rows);
    }
    const catalog = fullCatalog(raw, checked.names, authorization.schema), plan = planExistingDelta({ ...inputs, currentCatalog: raw });
    insist(fingerprint(catalog) === (plan.action === "alter" ? binding.beforeFullCatalogSha256 : binding.afterFullCatalogSha256), "DELTA_FULL_SOURCE_DRIFT");
    const [identityAgain] = await query(IDENTITY_SQL); equal(liveIdentity(identityAgain, authorization), identity, "DELTA_CONNECTION_CHANGED");
    return { raw, catalog, ledger, identity, plan };
  };
  const append = async entry => {
    const result = await external(() => evidenceIO.appendReceipt(operationKey, clone(entry), entry.previousSha256));
    equal(result, { durable: true, sha256: fingerprint(entry) }, "DELTA_DURABLE_RECEIPT_NOT_CONFIRMED");
  };
  const release = async () => {
    if (!lockHeld || releaseAttempted || destroyed) return;
    releaseAttempted = true;
    // Bounded cleanup is allowed even when the work deadline expired. No ALTER
    // or other work is admitted through this separate release-only budget.
    const cleanup = createExecutionDeadline(5000);
    const [rows] = await cleanup(() => connection.query({ sql: UNLOCK_SQL, timeout: 5000 }, [operationKey]), 5000, destroy);
    insist(Array.isArray(rows) && rows.length === 1 && exact(rows[0], ["released"])
      && canonicalControlInteger(rows[0].released) === 1, "DELTA_LOCK_RELEASE_FAILED");
    lockHeld = false; lockReleased = true;
  };
  try {
    await native();
    const [entryRows] = await query(IDENTITY_SQL), entryIdentity = liveIdentity(entryRows, authorization);
    for (const sql of SESSIONS) await query(sql);
    const initial = await readState(); equal(initial.identity, entryIdentity, "DELTA_CONNECTION_CHANGED");
    try {
      const [lockRows] = await query(LOCK_SQL, [operationKey]);
      insist(Array.isArray(lockRows) && lockRows.length === 1 && exact(lockRows[0], ["acquired"])
        && canonicalControlInteger(lockRows[0].acquired) === 1, "DELTA_LOCK_NOT_ACQUIRED");
    } catch (error) {
      // The server might hold the lock even when its reply was lost/malformed.
      // Close this dedicated caller connection; never infer successful release.
      try { destroy(); } catch { /* Keep the original refusal. */ }
      throw error;
    }
    lockHeld = true;
    const before = await readState(); equal(before, initial, "DELTA_LOCK_WINDOW_DRIFT"); beforeVerified = true;
    equal(await external(() => evidenceIO.loadBoundInputs()), inputs, "DELTA_PRIVATE_INPUT_DRIFT");
    priorCompleted = inspectJournal(await external(() => evidenceIO.readOperation(operationKey)), operationKey, binding);
    if (before.plan.action === "noop") insist(priorCompleted, "DELTA_NEW_STATE_WITHOUT_COMPLETED_RECEIPT");
    else insist(!priorCompleted, "DELTA_COMPLETED_RECEIPT_BUT_OLD_STATE");
    if (!priorCompleted) {
      started = receipt(operationKey, binding, "started", null, { beforeVerified: true });
      await append(started);
      equal(await external(() => evidenceIO.loadBoundInputs()), inputs, "DELTA_PRIVATE_INPUT_DRIFT"); await native();
      phase = "alter";
      await query(CANDIDATE_SQL); alterAcknowledged = true; phase = "checks";
    }
    const after = await readState(), again = await readState();
    equal(after, again, "DELTA_POSTCHECK_UNSTABLE"); equal(after.identity, before.identity, "DELTA_CONNECTION_CHANGED");
    equal(after.ledger, before.ledger, "DELTA_LEDGER_OBSERVATIONS_CHANGED");
    equal(after.raw, priorCompleted ? before.raw : expectedAfter(before.raw), "DELTA_NON_TARGET_OR_METADATA_DRIFT");
    insist(after.plan.action === "noop" && after.plan.currentFullCatalogSha256 === binding.afterFullCatalogSha256
      && after.plan.currentScopedCatalogSha256 === binding.afterScopedCatalogSha256, "DELTA_EXPECTED_TRANSITION_NOT_OBSERVED");
    afterVerified = true;
    equal(await external(() => evidenceIO.loadBoundInputs()), inputs, "DELTA_PRIVATE_INPUT_DRIFT"); await native();
    await release();
    if (!priorCompleted) await append(receipt(operationKey, binding, "completed", started,
      { ddlDispatches, alterAcknowledged, beforeVerified, afterVerified, lockReleased }));
    return { version: EXECUTION_VERSION, scope: EXECUTION_SCOPE, status: priorCompleted ? "noop-verified" : "completed",
      operationKey, binding, ddlDispatches, ledgerWrites: 0, lockReleased, comparedTables: 312, comparedCatalogCollections: 13,
      comparedAdoptionTables: [...ADOPTION_TABLES], changedFields: priorCompleted ? 0 : 10,
      historicalExecutionProven: false, generalRunnerAdmitted: false, productionApproved: false,
      fullHistoricalLedgerFieldsVerified: false, implicitCommitRollbackClaimed: false };
  } catch (error) {
    const code = safeCode(error); let receiptPersisted = false;
    try { await release(); } catch { try { destroy(); } catch { /* No success or release claim. */ } }
    if (lockHeld && !lockReleased && !destroyed) try { destroy(); } catch { /* Preserve ambiguous lock receipt. */ }
    if (started && !priorCompleted) {
      const failed = receipt(operationKey, binding, ddlDispatches ? "unknown" : "failed", started,
        { ddlDispatches, alterAcknowledged, beforeVerified, afterVerified, lockReleased, errorCode: code });
      try { await append(failed); receiptPersisted = true; } catch { /* Started/ambiguous journal is retained; never overwrite. */ }
    }
    throw Object.assign(new Error(code), { code, receipt: { version: EXECUTION_VERSION, scope: EXECUTION_SCOPE,
      status: ddlDispatches ? "unknown-requires-review" : "failed", operationKey, ddlDispatches, alterAcknowledged,
      ledgerWrites: 0, lockReleased, receiptPersisted, implicitCommitRollbackClaimed: false, rerunAllowed: false,
      historicalExecutionProven: false, productionApproved: false } });
  }
}
