import test from "node:test";
import assert from "node:assert/strict";
import { COST_SHEET_SCHEMA_CANDIDATE, COST_SHEET_SCHEMA_DDL, planCostSheetSchema } from "./costSheetSchemaPlan.mjs";
const column = (name, type = "int", changes = {}) => ({ name, type, nullable: false, defaultValue: null, extra: "", ...changes });
const index = (name, columns, unique = true) => ({ name, columns, unique, prefixLengths: columns.map(() => null) });
function snapshot(exists = true) {
  return { complete: true, databaseVerified: true, reservedFile: COST_SHEET_SCHEMA_CANDIDATE, tables: [{
    name: "ops_cost_sheets", complete: true, exists,
    ...(exists ? { engine: "InnoDB", collation: "utf8mb4_unicode_ci", columns: [
      column("id", "int", { extra: "auto_increment" }), column("workspace_id"),
      column("parent_asin", "varchar(500)", { collation: "utf8mb4_unicode_ci" }),
      column("store_name", "varchar(200)", { collation: "utf8mb4_unicode_ci" }),
      column("country", "varchar(20)", { collation: "utf8mb4_unicode_ci" }),
      column("payload", "json"), column("version", "int", { defaultValue: 1 }), column("updated_by"),
      column("updated_at", "timestamp", { defaultValue: "CURRENT_TIMESTAMP", extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP" }),
    ], indexes: [index("PRIMARY", ["id"]), index("uk_ops_cost_sheet_scope", ["workspace_id", "parent_asin", "store_name", "country"])] } : {}),
  }] };
}
test("only the existing0302 reservation proposes an explicit transactional extension", () => {
  const result = planCostSheetSchema(snapshot(false));
  assert.equal(result.candidate, "0302_integration_ops_cost_sheets.sql");
  assert.deepEqual(result.statements, [COST_SHEET_SCHEMA_DDL]);
  assert.match(COST_SHEET_SCHEMA_DDL, /ENGINE=InnoDB/);
  assert.equal(result.executable, false); assert.equal(result.productionApproved, false);
  assert.equal(result.ledgerRegistration, "unchanged");
  assert.doesNotMatch(COST_SHEET_SCHEMA_DDL, /DROP|TRUNCATE|DELETE|INSERT|UPDATE\s+(?!CURRENT_TIMESTAMP)/i);
  assert.equal(result.remainingGates.length, 5);
});
test("equivalent existing structure is deduplicated without rewriting any data", () => {
  const result = planCostSheetSchema(snapshot()); assert.equal(result.state, "structure_ready"); assert.deepEqual(result.statements, []);
  assert.equal(result.productionApproved, false); assert.match(result.rollback, /retain all saved costs/);
});
test("compatible display-width integers and nullable extra column remain readable", () => {
  const value = snapshot(); value.tables[0].columns[0].type = "int(11)";
  value.tables[0].columns.push(column("optional_note", "text", { nullable: true }));
  value.tables[0].indexes.push(index("updated_by", ["updated_by"], false));
  assert.deepEqual(planCostSheetSchema(value).statements, []);
});
for (const [name, mutate] of [
  ["unverified identity", s => { s.databaseVerified = false; }],
  ["different reservation", s => { s.reservedFile = "0317_ops_costs.sql"; }],
  ["incomplete table", s => { s.tables[0].complete = false; }],
  ["duplicate table", s => { s.tables.push(s.tables[0]); }],
  ["false absence", s => { s.tables[0].exists = false; }],
  ["nontransactional table", s => { s.tables[0].engine = "MyISAM"; }],
  ["different table collation", s => { s.tables[0].collation = "utf8mb4_bin"; }],
  ["different identity collation", s => { s.tables[0].columns[2].collation = "utf8mb4_bin"; }],
  ["missing payload", s => { s.tables[0].columns = s.tables[0].columns.filter(c => c.name !== "payload"); }],
  ["JSON nullable", s => { s.tables[0].columns[5].nullable = true; }],
  ["string payload", s => { s.tables[0].columns[5].type = "longtext"; }],
  ["short identity", s => { s.tables[0].columns[2].type = "varchar(200)"; }],
  ["unsigned version", s => { s.tables[0].columns[6].type = "int unsigned"; }],
  ["wrong default version", s => { s.tables[0].columns[6].defaultValue = 0; }],
  ["generated identity", s => { s.tables[0].columns[2].extra = "VIRTUAL GENERATED"; }],
  ["missing auto update timestamp", s => { s.tables[0].columns[8].extra = ""; }],
  ["required extra column", s => { s.tables[0].columns.push(column("unhandled", "text")); }],
  ["undefined extra default", s => { s.tables[0].columns.push(column("unhandled", "text", { defaultValue: undefined })); }],
  ["object extra default", s => { s.tables[0].columns.push(column("unhandled", "text", { defaultValue: {} })); }],
  ["duplicate columns", s => { s.tables[0].columns.push(s.tables[0].columns[0]); }],
  ["missing primary", s => { s.tables[0].indexes.shift(); }],
  ["missing scope uniqueness", s => { s.tables[0].indexes.pop(); }],
  ["prefix-only scope uniqueness", s => { s.tables[0].indexes[1].prefixLengths[1] = 20; }],
  ["missing prefix proof", s => { delete s.tables[0].indexes[1].prefixLengths; }],
  ["extra unique semantics", s => { s.tables[0].indexes.push(index("wrong_unique", ["parent_asin"])); }],
  ["duplicate index names", s => { s.tables[0].indexes.push(s.tables[0].indexes[1]); }],
]) test(`fails closed on ${name}`, () => { const value = snapshot(); mutate(value); assert.throws(() => planCostSheetSchema(value)); });
