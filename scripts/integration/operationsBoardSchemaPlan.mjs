// Pure planner for the existing 0313 reservation. Importing or calling this
// module never connects, executes SQL, registers a migration or repairs data.
export const OPERATIONS_BOARD_SCHEMA_CANDIDATE = "0313_integration_ops_profit_board.sql";
export const OPERATIONS_BOARD_LEGACY_TABLES = Object.freeze([
  "ops_profit_board_state", "ops_profit_board_editions", "ops_profit_board_notes",
]);
export const OPERATIONS_BOARD_SCHEMA_DDL = Object.freeze([
  `CREATE TABLE ops_board_states (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id INT NOT NULL,
 scope_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 store_name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 country VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 current_month CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 current_edition_id INT NULL,
 version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY board_state_scope (workspace_id,scope_key)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  `CREATE TABLE ops_board_editions (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id INT NOT NULL,
 state_id INT NOT NULL,
 month CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 revision INT NOT NULL,
 version INT NOT NULL,
 kind VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 original_edition_id INT NULL,
 capture JSON NOT NULL,
 source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_by INT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 archived_at DATETIME(3) NULL,
 UNIQUE KEY board_edition_revision (workspace_id,state_id,month,revision),
 KEY board_edition_scope (workspace_id,state_id,id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  `CREATE TABLE ops_board_notes (
 edition_id INT NOT NULL,
 workspace_id INT NOT NULL,
 parent_asin VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 note TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 version INT NOT NULL,
 updated_by INT NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY (edition_id,parent_asin),
 KEY board_note_workspace (workspace_id,edition_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  `CREATE TABLE ops_board_partner_pairs (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id INT NOT NULL,
 first_user_id INT NOT NULL,
 second_user_id INT NOT NULL,
 version INT NOT NULL,
 updated_by INT NOT NULL,
 is_active TINYINT NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY board_partner_pair (workspace_id,first_user_id,second_user_id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
]);

const definitions = [
  { name: "ops_board_states", autoIncrement: "id", primary: ["id"], types: {
    id: "int", workspace_id: "int", scope_key: "char(64)", store_name: "varchar(200)", country: "varchar(50)",
    current_month: "char(7)", current_edition_id: "int", version: "int", created_at: "datetime(3)", updated_at: "datetime(3)",
  }, ascii: ["scope_key", "current_month"], nullable: ["current_edition_id"], defaults: { version: 1 },
  indexes: [{ columns: ["workspace_id", "scope_key"], unique: true }] },
  { name: "ops_board_editions", autoIncrement: "id", primary: ["id"], types: {
    id: "int", workspace_id: "int", state_id: "int", month: "char(7)", revision: "int", version: "int", kind: "varchar(20)", status: "varchar(20)",
    original_edition_id: "int", capture: "json", source_hash: "char(64)", created_by: "int", created_at: "datetime(3)", updated_at: "datetime(3)", archived_at: "datetime(3)",
  }, ascii: ["month", "kind", "status", "source_hash"], nullable: ["original_edition_id", "archived_at"], defaults: {},
  indexes: [{ columns: ["workspace_id", "state_id", "month", "revision"], unique: true }, { columns: ["workspace_id", "state_id", "id"], unique: false }] },
  { name: "ops_board_notes", autoIncrement: null, primary: ["edition_id", "parent_asin"], types: {
    edition_id: "int", workspace_id: "int", parent_asin: "varchar(500)", note: "text", version: "int", updated_by: "int", updated_at: "datetime(3)",
  }, ascii: [], nullable: [], defaults: {}, indexes: [{ columns: ["workspace_id", "edition_id"], unique: false }] },
  { name: "ops_board_partner_pairs", autoIncrement: "id", primary: ["id"], types: {
    id: "int", workspace_id: "int", first_user_id: "int", second_user_id: "int", version: "int", updated_by: "int", is_active: "tinyint", updated_at: "datetime(3)",
  }, ascii: [], nullable: [], defaults: {}, indexes: [{ columns: ["workspace_id", "first_user_id", "second_user_id"], unique: true }] },
];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = code => { throw Object.assign(new Error(`OPERATIONS_BOARD_SCHEMA_${code}`), { code: `OPERATIONS_BOARD_SCHEMA_${code}` }); };
const requireValue = (value, code) => { if (!value) fail(code); };
const identifier = value => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value);
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const fullIndex = (index, columns, unique) => index.unique === unique && same(index.columns, columns) && index.prefixLengths.every(length => length === null);
function typeMatches(actual, expected) {
  // MySQL 5.7 exposes display widths that MySQL 8 omits. Signedness and the
  // actual integer storage type must still match; INT UNSIGNED is not INT.
  if (expected === "int") return /^int(?:\(11\))?$/iu.test(actual);
  if (expected === "tinyint") return /^tinyint(?:\(4\))?$/iu.test(actual);
  return actual.toLowerCase() === expected;
}

function checkTable(table, definition) {
  requireValue(record(table) && table.name === definition.name && table.complete === true && typeof table.exists === "boolean", "INCOMPLETE");
  if (!table.exists) {
    requireValue((!own(table, "columns") || Array.isArray(table.columns) && table.columns.length === 0)
      && (!own(table, "indexes") || Array.isArray(table.indexes) && table.indexes.length === 0)
      && (!own(table, "engine") || table.engine === null) && (!own(table, "collation") || table.collation === null), "ABSENCE_CONFLICT");
    return false;
  }
  requireValue(table.engine === "InnoDB" && table.collation === "utf8mb4_bin", "STORAGE_INCOMPATIBLE");
  requireValue(Array.isArray(table.columns) && table.columns.length === Object.keys(definition.types).length
    && Array.isArray(table.indexes) && table.indexes.length > 0 && table.indexes.length <= 100, "INCOMPLETE");
  const columns = new Map();
  for (const column of table.columns) {
    requireValue(record(column) && identifier(column.name) && own(definition.types, column.name) && !columns.has(column.name)
      && typeof column.type === "string" && typeof column.nullable === "boolean" && typeof column.extra === "string" && own(column, "defaultValue")
      && (column.defaultValue === null || typeof column.defaultValue === "string" || typeof column.defaultValue === "number" && Number.isFinite(column.defaultValue)), "COLUMN_INVALID");
    columns.set(column.name, column);
  }
  for (const [name, type] of Object.entries(definition.types)) {
    const column = columns.get(name);
    requireValue(column && typeMatches(column.type, type) && column.nullable === definition.nullable.includes(name), "COLUMN_INCOMPATIBLE");
    if (/^(?:char|varchar|text)/u.test(type)) {
      requireValue(column.collation === (definition.ascii.includes(name) ? "ascii_bin" : "utf8mb4_bin"), "COLUMN_COLLATION");
    } else requireValue(!own(column, "collation") || column.collation === null, "COLUMN_COLLATION");
    const expectedDefault = own(definition.defaults, name) ? definition.defaults[name] : null;
    requireValue(column.defaultValue === expectedDefault || expectedDefault !== null && column.defaultValue === String(expectedDefault), "DEFAULT_INCOMPATIBLE");
    requireValue(column.extra.toLowerCase() === (name === definition.autoIncrement ? "auto_increment" : ""), "EXTRA_INCOMPATIBLE");
  }
  const names = new Set();
  for (const index of table.indexes) {
    requireValue(record(index) && identifier(index.name) && !names.has(index.name.toLowerCase()) && typeof index.unique === "boolean"
      && Array.isArray(index.columns) && index.columns.length > 0 && index.columns.length <= columns.size
      && index.columns.every(name => typeof name === "string" && columns.has(name)) && new Set(index.columns).size === index.columns.length
      && Array.isArray(index.prefixLengths) && index.prefixLengths.length === index.columns.length
      && index.prefixLengths.every(length => length === null || Number.isSafeInteger(length) && length > 0), "INDEX_INVALID");
    // Optional inspector metadata may not contradict the ordinary full-column
    // index represented here. Functional/hidden/fulltext indexes are not proof.
    requireValue((!own(index, "type") || index.type === "BTREE") && (!own(index, "visible") || index.visible === true), "INDEX_INCOMPATIBLE");
    names.add(index.name.toLowerCase());
  }
  requireValue(table.indexes.some(index => index.name === "PRIMARY" && fullIndex(index, definition.primary, true)), "PRIMARY_INCOMPATIBLE");
  for (const wanted of definition.indexes) {
    requireValue(table.indexes.some(index => index.name !== "PRIMARY" && fullIndex(index, wanted.columns, wanted.unique)), "REQUIRED_INDEX_MISSING");
  }
  requireValue(table.indexes.every(index => !index.unique || index.name === "PRIMARY" && fullIndex(index, definition.primary, true)
    || definition.indexes.some(wanted => wanted.unique && fullIndex(index, wanted.columns, true))), "EXTRA_UNIQUENESS");
  return true;
}

export function planOperationsBoardSchema(snapshot) {
  requireValue(record(snapshot) && snapshot.complete === true && snapshot.databaseVerified === true
    && snapshot.reservedFile === OPERATIONS_BOARD_SCHEMA_CANDIDATE && Array.isArray(snapshot.tables)
    && snapshot.tables.length === definitions.length, "INCOMPLETE");
  const tables = new Map(snapshot.tables.map(table => [table?.name, table]));
  requireValue(tables.size === definitions.length && definitions.every(definition => tables.has(definition.name)), "TABLE_SET_INVALID");
  // Validate every existing table before returning anything. One incompatible
  // table rejects the complete plan, even when other tables are absent.
  const present = definitions.map(definition => checkTable(tables.get(definition.name), definition));
  const statements = OPERATIONS_BOARD_SCHEMA_DDL.filter((_ddl, index) => !present[index]);
  return {
    candidate: OPERATIONS_BOARD_SCHEMA_CANDIDATE,
    state: statements.length ? "migration_required" : "structure_ready",
    statements, executable: false, productionApproved: false, ledgerRegistration: "unchanged",
    sourceTablesModified: false, businessRowsModified: false, scheduleSeeding: "none",
    verificationScope: "Only the supplied four-table structural snapshot; not live schema identity, data reconciliation, archive validity or production readiness.",
    legacyMigration: { status: "requires_reconciliation", tables: [...OPERATIONS_BOARD_LEGACY_TABLES], statements: [] },
    remainingGates: [
      "Current database/schema and reserved migration ledger identity, backup and disposable DDL replay; no registration or execution by this planner",
      "Explicit data reconciliation of ops_profit_board_state, ops_profit_board_editions and ops_profit_board_notes; retain original tables and never silently adopt, rewrite or discard their history",
      "Complete captured source and owner lineage, current edition links, original/revision relationships and immutable archived originals verified across the whole workspace/store/country scope",
      "Fresh numeric membership/owner/partner authorization, ordered distinct partner IDs (first_user_id < second_user_id), active values, edition kind/status and positive versions validated by the application",
      "Native transaction locks, exact scope hashes, CAS, note versions, UUID/check/cancel recovery and explicit timestamps; current_edition_id may be NULL only during same-transaction initialization",
      "All product/profit/history/notes consumers, legacy writer isolation, month-boundary behavior and approved archive/revision policy verified before explicit feature enablement",
    ],
    rollback: "Disable new operations-board writes and archiving; retain all four new tables, captures, notes, partner records and operation receipts as well as all three legacy tables. Never hard-delete, truncate, rewrite frozen history, automatically repair schema or enable scheduled jobs.",
  };
}
