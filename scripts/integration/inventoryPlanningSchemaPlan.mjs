// Pure actor-aware index extension planning for the existing0142/0143/0145/0146
// tables. No migration number is allocated;0314 remains inventory collection.
export const INVENTORY_PLANNING_INDEX_CANDIDATE = "unassigned_inventory_planning_actor_indexes";
export const INVENTORY_PLANNING_INDEX_REQUIREMENTS = [
  { table: "ops_local_inventory_adjustments", name: "idx_inventory_local_actor_scope", columns: ["workspaceId", "user_id", "asin", "store_name", "country", "status", "effective_date"] },
  { table: "ops_inventory_planning_parameters", name: "idx_inventory_parameter_actor_scope", columns: ["workspaceId", "user_id", "scope_type", "asin", "store_name", "country", "is_active"] },
  { table: "ops_inventory_planning_parameters", name: "idx_inventory_parameter_actor_parent", columns: ["workspaceId", "user_id", "scope_type", "parent_asin", "store_name", "country", "is_active"] },
];
const allowedCollations = new Set(["utf8mb4_general_ci", "utf8mb4_unicode_ci", "utf8mb4_0900_ai_ci", "utf8mb4_bin", "utf8mb4_0900_bin"]);
const baseTypes = { id: "int", workspaceId: "int", user_id: "int", asin: "varchar(20)", store_name: "varchar(200)", country: "varchar(50)" };
const types = {
  ops_local_inventory_adjustments: { ...baseTypes, effective_date: "varchar(10)", status: "enum('draft','confirmed','superseded')", local_qty: "int", reason: "varchar(500)", confirmed_by: "int", confirmed_at: "timestamp", superseded_by_id: "int", created_at: "timestamp", updated_at: "timestamp" },
  ops_inventory_planning_parameters: { ...baseTypes, scope_type: "enum('workspace','store_country','parent_asin','asin')", parent_asin: "varchar(20)", production_days: "int", shipping_days: "int", buffer_days: "int", target_cover_days: "int", moq: "int", pack_size: "int", is_active: "boolean_int", product_cost: "decimal(10,2)", estimated_first_leg_cost: "decimal(10,2)", actual_first_leg_cost: "decimal(10,2)", estimated_fba_fee: "decimal(10,2)", actual_fba_fee: "decimal(10,2)", selling_price: "decimal(10,2)", estimated_dimensions: "varchar(120)", actual_dimensions: "varchar(120)", estimated_weight: "decimal(10,3)", actual_weight: "decimal(10,3)", dimension_unit: "varchar(12)", weight_unit: "varchar(12)", currency: "varchar(8)", created_at: "timestamp", updated_at: "timestamp" },
};
const nullable = {
  ops_local_inventory_adjustments: new Set(["workspaceId", "reason", "confirmed_by", "confirmed_at", "superseded_by_id"]),
  ops_inventory_planning_parameters: new Set(["workspaceId", "asin", "parent_asin", "store_name", "country", "product_cost", "estimated_first_leg_cost", "actual_first_leg_cost", "estimated_fba_fee", "actual_fba_fee", "selling_price", "estimated_dimensions", "actual_dimensions", "estimated_weight", "actual_weight"]),
};
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const fail = code => { throw new Error(`INVENTORY_PLANNING_SCHEMA_${code}`); };
const check = (condition,code) => { if (!condition) fail(code); };
const name = value => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function typeMatches(actual, expected) {
  if (expected === "int") return /^int(?:\(\d+\))?$/iu.test(actual);
  if (expected === "boolean_int") return /^(?:tinyint|int)(?:\(\d+\))?$/iu.test(actual);
  return actual.toLowerCase() === expected;
}
function parseTable(table) {
  check(table && table.complete === true && own(types,table.name) && table.exists === true, "EXISTING_BASELINE_REQUIRED");
  check(table.engine === "InnoDB" && allowedCollations.has(table.collation), "STORAGE_INCOMPATIBLE");
  check(Array.isArray(table.columns) && table.columns.length > 0 && table.columns.length <= 150 && Array.isArray(table.indexes) && table.indexes.length > 0 && table.indexes.length <= 100, "INCOMPLETE");
  const columns = new Map();
  for (const column of table.columns) {
    check(column && name(column.name) && !columns.has(column.name) && typeof column.type === "string" && typeof column.nullable === "boolean" && typeof column.extra === "string"
      && own(column,"defaultValue") && (column.defaultValue === null || typeof column.defaultValue === "string" || typeof column.defaultValue === "number" && Number.isFinite(column.defaultValue)), "COLUMN_INVALID");
    columns.set(column.name,column);
  }
  for (const [key,type] of Object.entries(types[table.name])) {
    const c = columns.get(key);
    check(c && typeMatches(c.type,type), "COLUMN_INCOMPATIBLE");
    // workspaceId can have been safely tightened separately; no planner
    // changes nullable historical workspace rows or assigns them to an actor.
    check(key === "workspaceId" || c.nullable === nullable[table.name].has(key), "NULLABILITY_INCOMPATIBLE");
    if (/^(?:varchar|enum)/u.test(type)) check(allowedCollations.has(c.collation), "COLLATION_INCOMPATIBLE");
    check(!/VIRTUAL GENERATED|STORED GENERATED/iu.test(c.extra), "GENERATED_BUSINESS_COLUMN");
    if (key === "id") check(c.extra.toLowerCase() === "auto_increment" && c.defaultValue === null, "PRIMARY_INCOMPATIBLE");
  }
  for (const [key,c] of columns) if (!own(types[table.name],key)) check(c.nullable || c.defaultValue !== null || /generated/iu.test(c.extra), "REQUIRED_EXTENSION");
  const names = new Set();
  for (const index of table.indexes) {
    check(index && name(index.name) && !names.has(index.name) && typeof index.unique === "boolean" && Array.isArray(index.columns) && index.columns.length > 0
      && index.columns.every(c=>columns.has(c)) && new Set(index.columns).size === index.columns.length
      && Array.isArray(index.prefixLengths) && index.prefixLengths.length === index.columns.length && index.prefixLengths.every(n=>n === null || Number.isSafeInteger(n) && n > 0), "INDEX_INVALID");
    names.add(index.name);
  }
  check(table.indexes.some(i=>i.name === "PRIMARY" && i.unique && same(i.columns,["id"]) && same(i.prefixLengths,[null])), "PRIMARY_INCOMPATIBLE");
  // A nullable scope UNIQUE neither enforces canonical identity nor preserves
  // the append-only local history. Never invent or silently accept one here.
  check(table.indexes.every(i=>!i.unique || i.name === "PRIMARY"), "UNREVIEWED_UNIQUENESS");
  return table;
}
export function planInventoryPlanningSchema(snapshot) {
  check(snapshot && snapshot.complete === true && snapshot.databaseVerified === true && snapshot.candidate === INVENTORY_PLANNING_INDEX_CANDIDATE && Array.isArray(snapshot.tables) && snapshot.tables.length === 2, "INCOMPLETE");
  const tables = new Map(snapshot.tables.map(table=>[table?.name,parseTable(table)]));
  check(tables.size === 2 && Object.keys(types).every(t=>tables.has(t)), "TABLE_SET_INVALID");
  const statements=[];
  for (const wanted of INVENTORY_PLANNING_INDEX_REQUIREMENTS) {
    const table=tables.get(wanted.table);
    const present=table.indexes.some(i=>!i.unique && wanted.columns.every((c,n)=>i.columns[n] === c && i.prefixLengths[n] === null));
    if (present) continue;
    check(!table.indexes.some(i=>i.name === wanted.name), "INDEX_NAME_CONFLICT");
    statements.push(`ALTER TABLE \`${wanted.table}\` ADD INDEX \`${wanted.name}\` (${wanted.columns.map(c=>`\`${c}\``).join(",")})`);
  }
  return { candidate: INVENTORY_PLANNING_INDEX_CANDIDATE, migrationNumber: null, state: statements.length ? "index_extension_required" : "actor_indexes_ready", statements,
    executable:false, productionApproved:false, ledgerRegistration:"unchanged", sourceTablesModified:false, businessRowsModified:false,
    verificationScope:"Only the supplied existing manual-table structural/index compatibility; not current database, complete runtime schema, historical data or production readiness.",
    remainingGates:["Assign a separate reviewed migration number;0314 stays reserved for independent collection", "Actual source/audit/authorization table schemas and full auditId uniqueness", "Actor-private historical rows, scope duplicates, country aliases and actual collation-equivalent identities", "Native transactional CAS, readback, UUID cancellation and unknown-commit recovery", "Drain incompatible legacy writers before feature enablement and verify both UI entrances", "Production backup/rollback and all original plan release gates"],
    rollback:"Disable ENABLE_MERGED_OPS_INVENTORY_PLANNING_WRITES, retain manual rows and operation audit receipts. Do not delete history, collapse identities, rewrite units or remove indexes automatically." };
}
