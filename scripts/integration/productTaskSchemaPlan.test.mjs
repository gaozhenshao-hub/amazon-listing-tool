import test from "node:test";
import assert from "node:assert/strict";
import { planProductTaskSchema, PRODUCT_TASK_ATTACHMENT_DDL } from "./productTaskSchemaPlan.mjs";
const col = (name, type = "int", nullable = false, extra = "") => ({ name, type, nullable, extra, defaultValue: null });
const primary = { name: "PRIMARY", unique: true, columns: ["id"] };
function snapshot() {
  return { complete: true, databaseVerified: true, tables: [
    { name: "team_tasks", complete: true, exists: true, engine: "InnoDB", columns: [col("id"), col("workspaceId"), col("user_id"), col("assignee_id", "int", true), col("product_profile_id")], indexes: [primary] },
    { name: "ops_task_attachments", complete: true, exists: false },
  ] };
}
function migrated() {
  const value = snapshot(); value.tables[0].columns.at(-1).nullable = true;
  value.tables[0].columns.push(col("completion_notes", "text", true), col("board_product", "json", true));
  value.tables[1] = { name: "ops_task_attachments", complete: true, exists: true, engine: "InnoDB", columns: [
    col("id", "int", false, "auto_increment"), col("workspace_id"), col("task_id"), col("file_name", "varchar(200)"),
    col("byte_size"), col("storage_ref", "text"), col("uploaded_by"), col("created_at", "timestamp"),
  ], indexes: [primary, { name: "task_workspace", unique: false, columns: ["workspace_id", "task_id"] }] };
  return value;
}
test("legacy schema creates only additive extension and nullable legitimate unlinked profile", () => {
  const result = planProductTaskSchema(snapshot());
  assert.equal(result.statements.length, 4); assert.equal(result.statements.at(-1), PRODUCT_TASK_ATTACHMENT_DDL);
  assert.equal(result.executable, false); assert.equal(result.productionApproved, false);
  assert.doesNotMatch(result.statements.join("\n"), /DROP|DELETE|TRUNCATE|UPDATE\s|INSERT\s|reminder_enabled|role_permissions/i);
});
test("existing friend structure deduplicates without replay or checksum mutation", () => {
  const result = planProductTaskSchema(migrated()); assert.deepEqual(result.statements, []);
  assert.equal(result.state, "structure_ready"); assert.equal(result.ledgerRegistration, "unchanged");
});
test("partial previous migration plans only still missing statements", () => {
  const value = snapshot(); value.tables[0].columns.at(-1).nullable = true; value.tables[0].columns.push(col("completion_notes", "text", true));
  const result = planProductTaskSchema(value); assert.equal(result.statements.length, 2); assert.match(result.statements[0], /board_product/);
});
test("missing nonunique task index is added but conflicting index is rejected", () => {
  const value = migrated(); value.tables[1].indexes.pop(); assert.deepEqual(planProductTaskSchema(value).statements, ["CREATE INDEX task_workspace ON ops_task_attachments (workspace_id, task_id)"]);
  value.tables[1].indexes.push({ name: "task_workspace", unique: true, columns: ["workspace_id", "task_id"] });
  assert.throws(() => planProductTaskSchema(value), /INDEX_CONFLICT/);
});
for (const [label, mutate] of [
  ["unverified", value => { value.databaseVerified = false; }],
  ["incomplete", value => { value.tables[0].complete = false; }],
  ["duplicate table", value => { value.tables.push(value.tables[0]); }],
  ["nontransactional", value => { value.tables[0].engine = "MyISAM"; }],
  ["profile unsigned", value => { value.tables[0].columns.find(c => c.name === "product_profile_id").type = "int unsigned"; }],
  ["profile default", value => { value.tables[0].columns.find(c => c.name === "product_profile_id").defaultValue = 0; }],
  ["wrong notes", value => { value.tables[0].columns.find(c => c.name === "completion_notes").type = "varchar(100)"; }],
  ["wrong JSON", value => { value.tables[0].columns.find(c => c.name === "board_product").nullable = false; }],
  ["duplicate column", value => { value.tables[0].columns.push(value.tables[0].columns[0]); }],
  ["missing primary", value => { value.tables[1].indexes.shift(); }],
  ["short file name", value => { value.tables[1].columns.find(c => c.name === "file_name").type = "varchar(50)"; }],
  ["required extension", value => { value.tables[1].columns.push(col("unhandled_field", "text")); }],
]) test(`fails closed on ${label}`, () => { const value = migrated(); mutate(value); assert.throws(() => planProductTaskSchema(value)); });
