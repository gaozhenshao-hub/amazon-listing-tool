import test from "node:test";
import assert from "node:assert/strict";
import { INVENTORY_COLLECTION_SCHEMA_CANDIDATE, INVENTORY_COLLECTION_SCHEMA_DDL, planInventoryCollectionSchema } from "./inventoryCollectionSchemaPlan.mjs";
const col = (name, type, nullable = false, more = {}) => ({ name, type, nullable, defaultValue: null, extra: name === "id" ? "auto_increment" : "", ...(/^(char|varchar|enum|longtext)/.test(type) ? { collation: "utf8mb4_unicode_ci" } : {}), ...more });
const idx = (name, columns, unique = false) => ({ name, columns, unique, prefixLengths: columns.map(() => null) });
function fixture() {
  return { complete: true, databaseVerified: true, reservedFile: INVENTORY_COLLECTION_SCHEMA_CANDIDATE, tables: [
    { name: "ops_inventory_collection_jobs", complete: true, exists: true, engine: "InnoDB", collation: "utf8mb4_unicode_ci", columns: [
      ...["id", "workspace_id", "actor_user_id"].map(n => col(n, "int")), col("operation_id", "char(36)"), col("status", "enum('queued','running','succeeded','failed','cancelled')"),
      ...["request_hash", "expected_snapshot_key", "connection_version", "mapping_version", "lease_token", "result_snapshot_key"].map(n => col(n, "char(64)", true)),
      ...["lease_expires_at", "heartbeat_at"].map(n => col(n, "bigint", true)), ...["created_at", "updated_at"].map(n => col(n, "bigint")),
      col("progress", "json"), col("failure_code", "varchar(100)", true), col("result_snapshot_id", "int", true), col("collection_proof", "json", true),
    ], indexes: [idx("PRIMARY", ["id"], true), idx("inventory_operation", ["workspace_id", "operation_id"], true), idx("inventory_job_queue", ["status", "id"]), idx("inventory_job_scope", ["workspace_id", "status", "id"]), idx("inventory_job_actor", ["workspace_id", "actor_user_id", "id"])] },
    { name: "ops_inventory_snapshots", complete: true, exists: true, engine: "InnoDB", collation: "utf8mb4_unicode_ci", columns: [col("id", "int"), col("workspace_id", "int"), col("run_id", "int"), col("run_source", "enum('saihu_sync','manual_collection')", false, { defaultValue: "saihu_sync" }), col("captured_at", "bigint"), col("payload", "longtext")], indexes: [idx("PRIMARY", ["id"], true), idx("inventory_run_source", ["run_source", "run_id"], true), idx("inventory_latest", ["workspace_id", "id"])] },
  ] };
}
const absent = t => ({ name: t.name, complete: true, exists: false });
test("plans new tables but keeps P6, no execution/registration/seeding", () => { const s = fixture(); s.tables = s.tables.map(absent); const p = planInventoryCollectionSchema(s); assert.deepEqual(p.statements, INVENTORY_COLLECTION_SCHEMA_DDL); assert.equal(p.targetPhase, "P6"); assert.equal(p.executable, false); assert.equal(p.productionApproved, false); assert.equal(p.ledgerRegistration, "unchanged"); assert.equal(p.scheduleSeeding, "none"); for (const ddl of p.statements) assert.doesNotMatch(ddl, /schedules|sync_runs|INSERT|DELETE|TRUNCATE|DROP/); });
test("new compatible schema has no DDL", () => { const p = planInventoryCollectionSchema(fixture()); assert.deepEqual(p.statements, []); assert.equal(p.state, "structure_ready"); assert.match(p.rollback, /never collapse/); });
test("legacy namespace preserves all existing rows and old program default", () => {
  const s = fixture(); s.tables[1].columns = s.tables[1].columns.filter(c => c.name !== "run_source"); s.tables[1].indexes[1] = idx("inventory_run", ["run_id"], true);
  const p = planInventoryCollectionSchema(s); assert.deepEqual(p.statements, ["ALTER TABLE ops_inventory_snapshots ADD COLUMN run_source ENUM('saihu_sync','manual_collection') NOT NULL DEFAULT 'saihu_sync', DROP INDEX `inventory_run`, ADD UNIQUE KEY inventory_run_source (run_source,run_id)"]);
});
test("explicit partial namespace migration resumes without duplicate ADD COLUMN", () => { const s = fixture(); s.tables[1].indexes[1] = idx("inventory_run", ["run_id"], true); const sql = planInventoryCollectionSchema(s).statements[0]; assert.doesNotMatch(sql, /ADD COLUMN/); assert.match(sql, /DROP INDEX `inventory_run`/); });
test("legacy uniqueness left alongside namespace is precisely removed", () => { const s = fixture(); s.tables[1].indexes.push(idx("inventory_run", ["run_id"], true)); assert.deepEqual(planInventoryCollectionSchema(s).statements, ["ALTER TABLE ops_inventory_snapshots DROP INDEX `inventory_run`"]); });
test("nullable extension and alternate int display widths preserve schema", () => { const s = fixture(); s.tables[0].columns[0].type = "int(11)"; s.tables[0].columns.push(col("note", "longtext", true)); s.tables.reverse(); assert.deepEqual(planInventoryCollectionSchema(s).statements, []); });
for (const [name, change] of [
  ["unverified", s => { s.databaseVerified = false; }], ["wrong reservation", s => { s.reservedFile = "new.sql"; }], ["missing table", s => { s.tables.pop(); }], ["duplicate table", s => { s.tables[1] = s.tables[0]; }],
  ["false absence", s => { s.tables[0].exists = false; }], ["incomplete table", s => { s.tables[0].complete = false; }], ["nontransactional", s => { s.tables[0].engine = "MyISAM"; }], ["collation", s => { s.tables[1].collation = "utf8mb4_bin"; }],
  ["nullable actor", s => { s.tables[0].columns[2].nullable = true; }], ["unsigned id", s => { s.tables[0].columns[0].type = "int unsigned"; }], ["auto queued default", s => { s.tables[0].columns.find(c => c.name === "status").defaultValue = "queued"; }],
  ["missing proof", s => { s.tables[0].columns = s.tables[0].columns.filter(c => c.name !== "collection_proof"); }], ["required request hash blocks cancel", s => { s.tables[0].columns.find(c => c.name === "request_hash").nullable = false; }],
  ["snapshot default changed", s => { s.tables[1].columns.find(c => c.name === "run_source").defaultValue = "manual_collection"; }], ["missing primary", s => { s.tables[0].indexes.shift(); }], ["missing queue", s => { s.tables[0].indexes.splice(2, 1); }],
  ["missing operation uniqueness", s => { s.tables[0].indexes[1].unique = false; }], ["prefix only UUID", s => { s.tables[0].indexes[1].prefixLengths[1] = 12; }], ["duplicate index", s => { s.tables[0].indexes.push(s.tables[0].indexes[0]); }],
  ["extra business uniqueness", s => { s.tables[0].indexes.push(idx("hash_unique", ["request_hash"], true)); }], ["missing snapshot scope", s => { s.tables[1].indexes.pop(); }], ["missing namespace unique", s => { s.tables[1].indexes.splice(1, 1); }],
  ["duplicate legacy unique", s => { s.tables[1].indexes.push(idx("old1", ["run_id"], true), idx("old2", ["run_id"], true)); }], ["required extension", s => { s.tables[0].columns.push(col("unhandled", "longtext")); }],
  ["duplicate column", s => { s.tables[0].columns.push(s.tables[0].columns[0]); }], ["undefined default", s => { delete s.tables[0].columns[0].defaultValue; }], ["malicious index name", s => { s.tables[1].indexes[1].name = "index` DROP TABLE x"; }],
]) test(`rejects ${name}`, () => { const s = fixture(); change(s); assert.throws(() => planInventoryCollectionSchema(s)); });
