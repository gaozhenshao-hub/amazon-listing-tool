// Pure, read-only planning. Importing this module opens no connection, loads no
// environment, registers no migration and executes no DDL. Existing structures
// must be inventoried in full before a release can promote its statements.
export const PRODUCT_TASK_SCHEMA_CANDIDATE = "0316_integration_ops_task_board.sql";
const error = code => { throw Object.assign(new Error(code), { code }); };
const required = (condition, code) => { if (!condition) error(code); };
const column = (name, type, nullable = false) => ({ name, type, nullable });
const attachmentColumns = [column("id", "int"), column("workspace_id", "int"), column("task_id", "int"),
  column("file_name", "varchar(200)"), column("byte_size", "int"), column("storage_ref", "text"),
  column("uploaded_by", "int"), column("created_at", "timestamp")];
export const PRODUCT_TASK_ATTACHMENT_DDL = `CREATE TABLE ops_task_attachments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  task_id INT NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  byte_size INT NOT NULL,
  storage_ref TEXT NOT NULL,
  uploaded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX task_workspace (workspace_id, task_id)
) ENGINE=InnoDB`;

function inspectTable(table, name, optional = false) {
  required(table && table.name === name && table.complete === true && typeof table.exists === "boolean", "TASK_SCHEMA_INCOMPLETE");
  if (!table.exists) { required(optional, "TASK_SCHEMA_BASE_TABLE_MISSING"); return null; }
  required(table.engine === "InnoDB" && Array.isArray(table.columns) && Array.isArray(table.indexes), "TASK_SCHEMA_TRANSACTIONAL_STRUCTURE_REQUIRED");
  required(table.columns.length > 0 && table.columns.length <= 200 && table.indexes.length <= 100, "TASK_SCHEMA_LIMIT");
  const columns = new Map();
  for (const item of table.columns) {
    required(item && typeof item.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name)
      && typeof item.type === "string" && typeof item.nullable === "boolean" && !columns.has(item.name), "TASK_SCHEMA_COLUMN_INVALID");
    columns.set(item.name, item);
  }
  for (const item of table.indexes) required(item && typeof item.name === "string" && typeof item.unique === "boolean"
    && Array.isArray(item.columns) && item.columns.length > 0 && item.columns.every(value => columns.has(value)), "TASK_SCHEMA_INDEX_INVALID");
  required(new Set(table.indexes.map(item => item.name)).size === table.indexes.length, "TASK_SCHEMA_DUPLICATE_INDEX");
  return columns;
}
const integer = type => /^int(?:\(11\))?$/i.test(type);
const primaryId = table => table.indexes.some(index => index.name === "PRIMARY" && index.unique && JSON.stringify(index.columns) === '["id"]');

export function planProductTaskSchema(snapshot) {
  required(snapshot && snapshot.complete === true && snapshot.databaseVerified === true && Array.isArray(snapshot.tables)
    && snapshot.tables.length === 2 && new Set(snapshot.tables.map(item => item?.name)).size === 2, "TASK_SCHEMA_INCOMPLETE");
  const team = snapshot.tables.find(table => table.name === "team_tasks"), files = snapshot.tables.find(table => table.name === "ops_task_attachments");
  const tasks = inspectTable(team, "team_tasks"), attachments = inspectTable(files, "ops_task_attachments", true), statements = [];
  const profile = tasks.get("product_profile_id");
  required(profile && integer(profile.type) && profile.defaultValue == null && !profile.extra, "TASK_SCHEMA_PROFILE_INCOMPATIBLE");
  required(primaryId(team), "TASK_SCHEMA_TASK_PRIMARY_REQUIRED");
  for (const name of ["id", "workspaceId", "user_id", "assignee_id"]) required(tasks.has(name) && integer(tasks.get(name).type), "TASK_SCHEMA_TASK_ID_INCOMPATIBLE");
  if (!profile.nullable) statements.push("ALTER TABLE team_tasks MODIFY product_profile_id INT NULL");
  for (const [name, type] of [["completion_notes", "text"], ["board_product", "json"]]) {
    const existing = tasks.get(name);
    if (existing) required(existing.type.toLowerCase() === type && existing.nullable && existing.defaultValue == null && !existing.extra, "TASK_SCHEMA_EXTENSION_INCOMPATIBLE");
    else statements.push(`ALTER TABLE team_tasks ADD COLUMN ${name} ${type.toUpperCase()} NULL`);
  }
  if (!attachments) statements.push(PRODUCT_TASK_ATTACHMENT_DDL);
  else {
    required(primaryId(files), "TASK_SCHEMA_ATTACHMENT_PRIMARY_REQUIRED");
    for (const expected of attachmentColumns) {
      const actual = attachments.get(expected.name);
      required(actual && actual.nullable === expected.nullable && (expected.type === "int" ? integer(actual.type) : actual.type.toLowerCase() === expected.type), "TASK_SCHEMA_ATTACHMENT_INCOMPATIBLE");
    }
    required(attachments.get("id").extra?.toLowerCase() === "auto_increment", "TASK_SCHEMA_ATTACHMENT_ID_INCOMPATIBLE");
    // Extra required columns could make the new insert fail even though all
    // known columns exist. Do not silently discard an incompatible extension.
    for (const actual of attachments.values()) if (!attachmentColumns.some(expected => expected.name === actual.name)) {
      required(actual.nullable || actual.defaultValue != null || actual.extra === "auto_increment", "TASK_SCHEMA_ATTACHMENT_EXTRA_REQUIRED_COLUMN");
    }
    const expectedIndex = files.indexes.find(index => index.name === "task_workspace");
    if (expectedIndex) required(!expectedIndex.unique && JSON.stringify(expectedIndex.columns) === '["workspace_id","task_id"]', "TASK_SCHEMA_ATTACHMENT_INDEX_CONFLICT");
    else statements.push("CREATE INDEX task_workspace ON ops_task_attachments (workspace_id, task_id)");
  }
  return { candidate: PRODUCT_TASK_SCHEMA_CANDIDATE, state: statements.length ? "migration_required" : "structure_ready",
    statements, executable: false, productionApproved: false, ledgerRegistration: "unchanged",
    rollback: "Disable ENABLE_MERGED_OPS_TASK_WRITES; retain nullable IDs, new columns, attachment metadata, private objects and audit receipts. Never drop or truncate saved user data." };
}
