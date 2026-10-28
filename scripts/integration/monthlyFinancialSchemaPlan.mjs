// Pure planner for the existing 0308 reservation. Never opens a connection,
// registers a migration, mutates the ledger, executes DDL or rewrites rows.
export const MONTHLY_FINANCIAL_SCHEMA_CANDIDATE = "0308_integration_monthly_profit_imports.sql";
export const MONTHLY_FINANCIAL_SCHEMA_DDL = [
  `CREATE TABLE ops_monthly_profit_imports (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspaceId INT NOT NULL,
 userId INT NOT NULL,
 fileName VARCHAR(512) NOT NULL,
 fileHash CHAR(64) NOT NULL,
 fileUrl TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'previewing',
 totalRows INT NOT NULL,
 skippedRows INT NOT NULL DEFAULT 0,
 unallocatedRows INT NOT NULL DEFAULT 0,
 months JSON NOT NULL,
 payload JSON NOT NULL,
 createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 confirmedAt DATETIME(3) NULL,
 KEY monthly_profit_scope (workspaceId,status,id),
 KEY monthly_profit_owner (workspaceId,userId,id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE ops_monthly_import_artifacts (
 batch_id INT NOT NULL PRIMARY KEY,
 workspace_id INT NOT NULL,
 prepared JSON NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 manifest JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY monthly_artifact_scope (workspace_id,batch_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireValue = (value, code) => { if (!value) fail(code); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const definitions = [
  { name: "ops_monthly_profit_imports", primary: "id", autoIncrement: true, created: "createdAt", types: {
    id: "int", workspaceId: "int", userId: "int", fileName: "varchar(512)", fileHash: "char(64)", fileUrl: "text",
    status: "varchar(20)", totalRows: "int", skippedRows: "int", unallocatedRows: "int", months: "json", payload: "json", createdAt: "datetime(3)", confirmedAt: "datetime(3)",
  }, requiredIndexes: [["workspaceId", "status", "id"], ["workspaceId", "userId", "id"]] },
  { name: "ops_monthly_import_artifacts", primary: "batch_id", autoIncrement: false, created: "created_at", types: {
    batch_id: "int", workspace_id: "int", prepared: "json", payload_hash: "char(64)", manifest: "json", created_at: "datetime(3)",
  }, requiredIndexes: [["workspace_id", "batch_id"]] },
];

function checkTable(table, definition) {
  requireValue(table && table.name === definition.name && table.complete === true && typeof table.exists === "boolean", "MONTHLY_SCHEMA_INCOMPLETE");
  if (!table.exists) {
    requireValue((!own(table, "columns") || Array.isArray(table.columns) && !table.columns.length)
      && (!own(table, "indexes") || Array.isArray(table.indexes) && !table.indexes.length), "MONTHLY_SCHEMA_ABSENCE_CONFLICT");
    return false;
  }
  // Qingdao's existing MySQL 8 reports use 0900. Preserve that table's
  // comparison semantics; the additive artifact table keeps its own contract.
  const allowedCollations = definition.name === "ops_monthly_profit_imports"
    ? ["utf8mb4_unicode_ci", "utf8mb4_0900_ai_ci"] : ["utf8mb4_unicode_ci"];
  requireValue(table.engine === "InnoDB" && allowedCollations.includes(table.collation), "MONTHLY_SCHEMA_STORAGE_INCOMPATIBLE");
  requireValue(Array.isArray(table.columns) && table.columns.length >= Object.keys(definition.types).length && table.columns.length <= 100
    && Array.isArray(table.indexes) && table.indexes.length > 0 && table.indexes.length <= 100, "MONTHLY_SCHEMA_INCOMPLETE");
  const columns = new Map();
  for (const column of table.columns) {
    requireValue(column && typeof column.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(column.name)
      && typeof column.type === "string" && typeof column.nullable === "boolean" && own(column, "defaultValue")
      && (column.defaultValue === null || typeof column.defaultValue === "string" || typeof column.defaultValue === "number" && Number.isFinite(column.defaultValue))
      && typeof column.extra === "string" && !columns.has(column.name), "MONTHLY_SCHEMA_COLUMN_INVALID");
    columns.set(column.name, column);
  }
  for (const [name, type] of Object.entries(definition.types)) {
    const column = columns.get(name);
    requireValue(column && column.nullable === (name === "confirmedAt")
      && (type === "int" ? /^int(?:\(11\))?$/i.test(column.type) : column.type.toLowerCase() === type), "MONTHLY_SCHEMA_COLUMN_INCOMPATIBLE");
    if (/^(?:varchar|char|text)/.test(type)) requireValue(column.collation === table.collation, "MONTHLY_SCHEMA_COLUMN_COLLATION");
    if (name === definition.primary && definition.autoIncrement) {
      requireValue(column.extra.toLowerCase() === "auto_increment" && column.defaultValue === null, "MONTHLY_SCHEMA_PRIMARY_INCOMPATIBLE");
    } else if (name === definition.created) {
      requireValue(typeof column.defaultValue === "string" && /^current_timestamp\(3\)$/i.test(column.defaultValue)
        && /^(?:DEFAULT_GENERATED)?$/i.test(column.extra), "MONTHLY_SCHEMA_TIMESTAMP_INCOMPATIBLE");
    } else {
      const defaultMatches = name === "status" ? column.defaultValue === "previewing"
        : ["skippedRows", "unallocatedRows"].includes(name) ? column.defaultValue === 0 || column.defaultValue === "0"
          : column.defaultValue === null;
      requireValue(!column.extra && defaultMatches, "MONTHLY_SCHEMA_DEFAULT_INCOMPATIBLE");
    }
  }
  for (const [name, column] of columns) if (!own(definition.types, name)) {
    requireValue(column.nullable || column.defaultValue !== null || /generated/i.test(column.extra), "MONTHLY_SCHEMA_REQUIRED_EXTENSION");
  }
  const names = new Set();
  for (const index of table.indexes) {
    requireValue(index && typeof index.name === "string" && !names.has(index.name) && typeof index.unique === "boolean"
      && Array.isArray(index.columns) && index.columns.length > 0 && index.columns.every(name => columns.has(name))
      && Array.isArray(index.prefixLengths) && index.prefixLengths.length === index.columns.length
      && index.prefixLengths.every(length => length === null || Number.isSafeInteger(length) && length > 0), "MONTHLY_SCHEMA_INDEX_INVALID");
    names.add(index.name);
  }
  requireValue(table.indexes.some(index => index.name === "PRIMARY" && index.unique
    && same(index.columns, [definition.primary]) && same(index.prefixLengths, [null])), "MONTHLY_SCHEMA_PRIMARY_INCOMPATIBLE");
  for (const required of definition.requiredIndexes) {
    requireValue(table.indexes.some(index => same(index.columns, required) && !index.unique
      && index.prefixLengths.every(length => length === null)), "MONTHLY_SCHEMA_SCOPE_INDEX_REQUIRED");
  }
  // A file's content hash is not operation identity: two deliberate uploads of
  // the same file may be different versions. No hidden extra unique constraint.
  requireValue(table.indexes.every(index => !index.unique || index.name === "PRIMARY"), "MONTHLY_SCHEMA_EXTRA_UNIQUENESS");
  return true;
}

export function planMonthlyFinancialSchema(snapshot) {
  requireValue(snapshot && snapshot.complete === true && snapshot.databaseVerified === true
    && snapshot.reservedFile === MONTHLY_FINANCIAL_SCHEMA_CANDIDATE && Array.isArray(snapshot.tables)
    && snapshot.tables.length === definitions.length, "MONTHLY_SCHEMA_INCOMPLETE");
  const tables = new Map(snapshot.tables.map(table => [table?.name, table]));
  requireValue(tables.size === definitions.length && definitions.every(definition => tables.has(definition.name)), "MONTHLY_SCHEMA_TABLE_SET_INVALID");
  const statements = definitions.flatMap((definition, index) => checkTable(tables.get(definition.name), definition) ? [] : [MONTHLY_FINANCIAL_SCHEMA_DDL[index]]);
  return {
    candidate: MONTHLY_FINANCIAL_SCHEMA_CANDIDATE, state: statements.length ? "migration_required" : "structure_ready", statements,
    executable: false, productionApproved: false, ledgerRegistration: "unchanged",
    remainingGates: ["Current database/schema ledger identity and complete historical batch reconciliation",
      "Transactional workspace/actor locks, auditId uniqueness and actual native UUID/CAS recovery",
      "Private S3/OSS originals, bounded GET digest verification and current manager/directory permissions",
      "Whole month/store/country replacement, fallback and all three financial consumers",
      "Legacy writer coexistence, archived edition policy and future AI source invalidation"],
    rollback: "Disable ENABLE_MERGED_OPS_MONTHLY_WRITES. Retain all original private files, batches, artifacts and audit receipts; never hard-delete, truncate, rewrite historical reports or daily/weekly data.",
  };
}
