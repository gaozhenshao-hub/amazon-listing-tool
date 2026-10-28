// Pure 0314 candidate planner: no connection, DDL execution, seeding, ledger
// registration, schedule changes or production authorization.
export const INVENTORY_COLLECTION_SCHEMA_CANDIDATE = "0314_integration_inventory_snapshot.sql";
const JOBS = "ops_inventory_collection_jobs", SNAPSHOTS = "ops_inventory_snapshots";
const STATUS = "enum('queued','running','succeeded','failed','cancelled')";
const SOURCE = "enum('saihu_sync','manual_collection')";
export const INVENTORY_COLLECTION_SCHEMA_DDL = [
  `CREATE TABLE ops_inventory_collection_jobs (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id INT NOT NULL, actor_user_id INT NOT NULL,
 operation_id CHAR(36) NOT NULL, request_hash CHAR(64) NULL,
 status ENUM('queued','running','succeeded','failed','cancelled') NOT NULL,
 expected_snapshot_key CHAR(64) NULL, connection_version CHAR(64) NULL, mapping_version CHAR(64) NULL,
 lease_token CHAR(64) NULL, lease_expires_at BIGINT NULL, heartbeat_at BIGINT NULL,
 progress JSON NOT NULL, failure_code VARCHAR(100) NULL,
 result_snapshot_id INT NULL, result_snapshot_key CHAR(64) NULL, collection_proof JSON NULL,
 created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
 UNIQUE KEY inventory_operation (workspace_id,operation_id),
 KEY inventory_job_queue (status,id), KEY inventory_job_scope (workspace_id,status,id),
 KEY inventory_job_actor (workspace_id,actor_user_id,id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE ops_inventory_snapshots (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id INT NOT NULL, run_id INT NOT NULL,
 run_source ENUM('saihu_sync','manual_collection') NOT NULL DEFAULT 'saihu_sync',
 captured_at BIGINT NOT NULL, payload LONGTEXT NOT NULL,
 UNIQUE KEY inventory_run_source (run_source,run_id), KEY inventory_latest (workspace_id,id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];
const fail = code => { throw new Error(`INVENTORY_SCHEMA_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const jobTypes = { id: "int", workspace_id: "int", actor_user_id: "int", operation_id: "char(36)", request_hash: "char(64)", status: STATUS,
  expected_snapshot_key: "char(64)", connection_version: "char(64)", mapping_version: "char(64)", lease_token: "char(64)", lease_expires_at: "bigint", heartbeat_at: "bigint",
  progress: "json", failure_code: "varchar(100)", result_snapshot_id: "int", result_snapshot_key: "char(64)", collection_proof: "json", created_at: "bigint", updated_at: "bigint" };
const nullable = new Set(["request_hash", "expected_snapshot_key", "connection_version", "mapping_version", "lease_token", "lease_expires_at", "heartbeat_at", "failure_code", "result_snapshot_id", "result_snapshot_key", "collection_proof"]);
const snapshotTypes = { id: "int", workspace_id: "int", run_id: "int", captured_at: "bigint", payload: "longtext" };
function structure(table) {
  requireValue(table && table.complete === true && typeof table.exists === "boolean", "INCOMPLETE");
  if (!table.exists) {
    requireValue((!own(table, "columns") || Array.isArray(table.columns) && !table.columns.length) && (!own(table, "indexes") || Array.isArray(table.indexes) && !table.indexes.length), "ABSENCE_CONFLICT");
    return null;
  }
  const allowedCollations = table.name === SNAPSHOTS ? ["utf8mb4_unicode_ci", "utf8mb4_0900_ai_ci"] : ["utf8mb4_unicode_ci"];
  requireValue(table.engine === "InnoDB" && allowedCollations.includes(table.collation), "STORAGE_INCOMPATIBLE");
  requireValue(Array.isArray(table.columns) && table.columns.length > 0 && table.columns.length <= 100 && Array.isArray(table.indexes) && table.indexes.length > 0 && table.indexes.length <= 100, "INCOMPLETE");
  const columns = new Map();
  for (const c of table.columns) {
    requireValue(c && typeof c.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(c.name) && !columns.has(c.name) && typeof c.type === "string"
      && typeof c.nullable === "boolean" && typeof c.extra === "string" && own(c, "defaultValue") && (c.defaultValue === null || typeof c.defaultValue === "string" || typeof c.defaultValue === "number" && Number.isFinite(c.defaultValue)), "COLUMN_INVALID");
    columns.set(c.name, c);
  }
  const names = new Set();
  for (const i of table.indexes) {
    requireValue(i && typeof i.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(i.name) && !names.has(i.name) && typeof i.unique === "boolean"
      && Array.isArray(i.columns) && i.columns.length > 0 && i.columns.every(c => columns.has(c)) && new Set(i.columns).size === i.columns.length
      && Array.isArray(i.prefixLengths) && i.prefixLengths.length === i.columns.length && i.prefixLengths.every(n => n === null || Number.isSafeInteger(n) && n > 0), "INDEX_INVALID");
    names.add(i.name);
  }
  return { columns, indexes: table.indexes, collation: table.collation };
}
function matches(index, fields, unique, primary = false) {
  return index.unique === unique && same(index.columns, fields) && index.prefixLengths.every(n => n === null) && (!primary || index.name === "PRIMARY");
}
function validateColumns(parsed, types, optionalNullable = new Set()) {
  for (const [name, type] of Object.entries(types)) {
    const c = parsed.columns.get(name);
    requireValue(c && c.nullable === optionalNullable.has(name) && (/^(int|bigint)$/u.test(type) ? new RegExp(`^${type}(?:\\(\\d+\\))?$`, "iu").test(c.type) : c.type.toLowerCase() === type), "COLUMN_INCOMPATIBLE");
    requireValue(c.extra.toLowerCase() === (name === "id" ? "auto_increment" : "") && c.defaultValue === (name === "run_source" ? "saihu_sync" : null), "DEFAULT_INCOMPATIBLE");
    if (/^(char|varchar|longtext|enum)/u.test(type)) requireValue(c.collation === parsed.collation, "COLUMN_COLLATION");
  }
  for (const [name, c] of parsed.columns) if (!own(types, name)) requireValue(c.nullable || c.defaultValue !== null || /generated/iu.test(c.extra), "REQUIRED_EXTENSION");
  requireValue(parsed.indexes.some(i => matches(i, ["id"], true, true)), "PRIMARY_INCOMPATIBLE");
}
function planJobs(table) {
  const p = structure(table); if (!p) return [INVENTORY_COLLECTION_SCHEMA_DDL[0]];
  validateColumns(p, jobTypes, nullable);
  const required = [[["workspace_id", "operation_id"], true], [["status", "id"], false], [["workspace_id", "status", "id"], false], [["workspace_id", "actor_user_id", "id"], false]];
  for (const [fields, unique] of required) requireValue(p.indexes.some(i => matches(i, fields, unique)), "JOB_INDEX_REQUIRED");
  requireValue(p.indexes.every(i => !i.unique || matches(i, ["id"], true, true) || matches(i, ["workspace_id", "operation_id"], true)), "EXTRA_UNIQUENESS");
  return [];
}
function planSnapshots(table) {
  const p = structure(table); if (!p) return [INVENTORY_COLLECTION_SCHEMA_DDL[1]];
  const hasSource = p.columns.has("run_source");
  validateColumns(p, { ...snapshotTypes, ...(hasSource ? { run_source: SOURCE } : {}) });
  requireValue(p.indexes.some(i => matches(i, ["workspace_id", "id"], false)), "SCOPE_INDEX_REQUIRED");
  const legacy = p.indexes.filter(i => matches(i, ["run_id"], true));
  const namespaced = p.indexes.filter(i => matches(i, ["run_source", "run_id"], true));
  requireValue(legacy.length <= 1 && namespaced.length <= 1 && legacy.length + namespaced.length >= 1, "RUN_INDEX_INCOMPATIBLE");
  requireValue(p.indexes.every(i => !i.unique || matches(i, ["id"], true, true) || legacy.includes(i) || namespaced.includes(i)), "EXTRA_UNIQUENESS");
  if (hasSource && namespaced.length && !legacy.length) return [];
  const changes = [];
  if (!hasSource) changes.push("ADD COLUMN run_source ENUM('saihu_sync','manual_collection') NOT NULL DEFAULT 'saihu_sync'");
  // Only remove the precisely inspected legacy unique index, atomically adding
  // its namespace-preserving replacement. No snapshot record is deleted.
  if (legacy.length) changes.push(`DROP INDEX \`${legacy[0].name}\``);
  if (!namespaced.length) {
    requireValue(!p.indexes.some(i => i.name === "inventory_run_source" && !legacy.includes(i)), "INDEX_NAME_CONFLICT");
    changes.push("ADD UNIQUE KEY inventory_run_source (run_source,run_id)");
  }
  return [`ALTER TABLE ops_inventory_snapshots ${changes.join(", ")}`];
}
export function planInventoryCollectionSchema(snapshot) {
  requireValue(snapshot && snapshot.complete === true && snapshot.databaseVerified === true && snapshot.reservedFile === INVENTORY_COLLECTION_SCHEMA_CANDIDATE
    && Array.isArray(snapshot.tables) && snapshot.tables.length === 2, "INCOMPLETE");
  const tables = new Map(snapshot.tables.map(t => [t?.name, t]));
  requireValue(tables.size === 2 && tables.has(JOBS) && tables.has(SNAPSHOTS), "TABLE_SET_INVALID");
  const statements = [...planJobs(tables.get(JOBS)), ...planSnapshots(tables.get(SNAPSHOTS))];
  return { candidate: INVENTORY_COLLECTION_SCHEMA_CANDIDATE, state: statements.length ? "migration_required" : "structure_ready", targetPhase: "P6",
    statements, executable: false, productionApproved: false, ledgerRegistration: "unchanged", scheduleSeeding: "none",
    remainingGates: ["Actual schema/ledger/backup and namespace migration replay on a disposable database",
      "Full vendor collection and catalog stability with authorized credentials and account identity",
      "Live transactional locking, UUID recovery, actor/permission changes, stale leases and mixed legacy writers",
      "Explicit worker deployment and off/on/shutdown checks; all supplier schedules remain disabled",
      "Lingxing planning, personal manual quantities, financial facts and historical snapshots remain unchanged"],
    rollback: "Disable ENABLE_MERGED_OPS_INVENTORY_COLLECTION. Retain jobs, proofs and snapshots including run_source; never collapse the run namespace, delete data or enable legacy scheduled seeds.",
  };
}
