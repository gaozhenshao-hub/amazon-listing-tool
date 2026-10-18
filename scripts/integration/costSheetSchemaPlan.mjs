// Pure planning for the existing 0302 reservation. No environment, connection,
// migration registration, DDL execution or data rewrite occurs here.
export const COST_SHEET_SCHEMA_CANDIDATE = "0302_integration_ops_cost_sheets.sql";
export const COST_SHEET_SCHEMA_DDL = `CREATE TABLE ops_cost_sheets (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id INT NOT NULL,
 parent_asin VARCHAR(500) NOT NULL,
 store_name VARCHAR(200) NOT NULL,
 country VARCHAR(20) NOT NULL,
 payload JSON NOT NULL,
 version INT NOT NULL DEFAULT 1,
 updated_by INT NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uk_ops_cost_sheet_scope (workspace_id,parent_asin,store_name,country)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireValue = (value, code) => { if (!value) fail(code); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const integer = type => /^int(?:\(11\))?$/i.test(type);
const expected = { id: "int", workspace_id: "int", parent_asin: "varchar(500)", store_name: "varchar(200)",
  country: "varchar(20)", payload: "json", version: "int", updated_by: "int", updated_at: "timestamp" };
const scopeColumns = ["workspace_id", "parent_asin", "store_name", "country"];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const currentTimestamp = value => typeof value === "string" && /^current_timestamp(?:\(\))?$/i.test(value);

/** A successful result proves only the supplied complete structure matches the
 * known extension. It does not prove audit-table readiness, ownership, data
 * reconciliation, native execution, or approval to enable cost writes. */
export function planCostSheetSchema(snapshot) {
  requireValue(snapshot && snapshot.complete === true && snapshot.databaseVerified === true
    && snapshot.reservedFile === COST_SHEET_SCHEMA_CANDIDATE && Array.isArray(snapshot.tables)
    && snapshot.tables.length === 1, "COST_SCHEMA_INCOMPLETE");
  const table = snapshot.tables[0];
  requireValue(table && table.name === "ops_cost_sheets" && table.complete === true
    && typeof table.exists === "boolean", "COST_SCHEMA_INCOMPLETE");
  let statements = [];
  if (!table.exists) {
    requireValue((!own(table, "columns") || Array.isArray(table.columns) && table.columns.length === 0)
      && (!own(table, "indexes") || Array.isArray(table.indexes) && table.indexes.length === 0), "COST_SCHEMA_ABSENCE_CONFLICT");
    statements = [COST_SHEET_SCHEMA_DDL];
  } else {
    requireValue(table.engine === "InnoDB" && table.collation === "utf8mb4_unicode_ci", "COST_SCHEMA_STORAGE_INCOMPATIBLE");
    requireValue(Array.isArray(table.columns) && table.columns.length >= Object.keys(expected).length && table.columns.length <= 100
      && Array.isArray(table.indexes) && table.indexes.length > 0 && table.indexes.length <= 100, "COST_SCHEMA_INCOMPLETE");
    const columns = new Map();
    for (const column of table.columns) {
      requireValue(column && typeof column.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(column.name)
        && typeof column.type === "string" && typeof column.nullable === "boolean" && own(column, "defaultValue")
        && (column.defaultValue === null || typeof column.defaultValue === "string" || typeof column.defaultValue === "number" && Number.isFinite(column.defaultValue))
        && typeof column.extra === "string" && !columns.has(column.name), "COST_SCHEMA_COLUMN_INVALID");
      columns.set(column.name, column);
    }
    for (const [name, type] of Object.entries(expected)) {
      const column = columns.get(name);
      requireValue(column && !column.nullable && (type === "int" ? integer(column.type) : column.type.toLowerCase() === type), "COST_SCHEMA_COLUMN_INCOMPATIBLE");
      if (["parent_asin", "store_name", "country"].includes(name)) requireValue(column.collation === "utf8mb4_unicode_ci", "COST_SCHEMA_IDENTITY_COLLATION");
      if (name === "id") requireValue(column.extra.toLowerCase() === "auto_increment" && column.defaultValue === null, "COST_SCHEMA_PRIMARY_INCOMPATIBLE");
      else if (name === "updated_at") requireValue(currentTimestamp(column.defaultValue)
        && /^(?:default_generated\s+)?on update current_timestamp(?:\(\))?$/i.test(column.extra), "COST_SCHEMA_TIMESTAMP_INCOMPATIBLE");
      else requireValue(!column.extra && (name === "version" ? column.defaultValue === 1 || column.defaultValue === "1" : column.defaultValue === null), "COST_SCHEMA_DEFAULT_INCOMPATIBLE");
    }
    for (const [name, column] of columns) if (!own(expected, name)) {
      requireValue(column.nullable || column.defaultValue !== null || /generated/i.test(column.extra), "COST_SCHEMA_REQUIRED_EXTENSION");
    }
    const names = new Set();
    for (const index of table.indexes) {
      requireValue(index && typeof index.name === "string" && !names.has(index.name) && typeof index.unique === "boolean"
        && Array.isArray(index.columns) && index.columns.length > 0 && index.columns.every(name => columns.has(name))
        && Array.isArray(index.prefixLengths) && index.prefixLengths.length === index.columns.length
        && index.prefixLengths.every(length => length === null || Number.isSafeInteger(length) && length > 0), "COST_SCHEMA_INDEX_INVALID");
      names.add(index.name);
    }
    requireValue(table.indexes.some(index => index.name === "PRIMARY" && index.unique
      && same(index.columns, ["id"]) && same(index.prefixLengths, [null])), "COST_SCHEMA_PRIMARY_INCOMPATIBLE");
    requireValue(table.indexes.some(index => index.unique && same(index.columns, scopeColumns)
      && index.prefixLengths.every(length => length === null)), "COST_SCHEMA_SCOPE_UNIQUENESS_REQUIRED");
    // Do not attempt to add a unique index before reconciling actual stored rows.
    // A second constraint with different semantics can also reject valid inserts.
    requireValue(table.indexes.every(index => !index.unique || index.name === "PRIMARY" || same(index.columns, scopeColumns)
      && index.prefixLengths.every(length => length === null)), "COST_SCHEMA_EXTRA_UNIQUENESS");
  }
  return { candidate: COST_SHEET_SCHEMA_CANDIDATE, state: statements.length ? "migration_required" : "structure_ready",
    statements, executable: false, productionApproved: false, ledgerRegistration: "unchanged",
    remainingGates: ["Current database/schema ledger identity", "Canonical country aliases and collation-equivalent scope duplicates",
      "Current numeric ownership and strict role/directory permissions", "Actual transactional audit receipts and native CAS/recovery",
      "Existing financial facts and legacy cost data reconciliation"],
    rollback: "Disable ENABLE_MERGED_OPS_COST_WRITES and retain all saved costs, versions, audit receipts and structures; never drop, truncate, merge or rewrite historical costs." };
}
