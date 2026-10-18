import test from "node:test";
import assert from "node:assert/strict";
import { MONTHLY_FINANCIAL_SCHEMA_CANDIDATE, MONTHLY_FINANCIAL_SCHEMA_DDL, planMonthlyFinancialSchema } from "./monthlyFinancialSchemaPlan.mjs";

const col = (name, type = "int", changes = {}) => ({ name, type, nullable: false, defaultValue: null, extra: "", ...(/^(?:varchar|char|text)/.test(type) ? { collation: "utf8mb4_unicode_ci" } : {}), ...changes });
const idx = (name, columns, unique = false) => ({ name, columns, unique, prefixLengths: columns.map(() => null) });
function snapshot() {
  return { complete: true, databaseVerified: true, reservedFile: MONTHLY_FINANCIAL_SCHEMA_CANDIDATE, tables: [
    { name: "ops_monthly_profit_imports", complete: true, exists: true, engine: "InnoDB", collation: "utf8mb4_unicode_ci", columns: [
      col("id", "int", { extra: "auto_increment" }), col("workspaceId"), col("userId"), col("fileName", "varchar(512)"), col("fileHash", "char(64)"), col("fileUrl", "text"),
      col("status", "varchar(20)", { defaultValue: "previewing" }), col("totalRows"), col("skippedRows", "int", { defaultValue: 0 }), col("unallocatedRows", "int", { defaultValue: 0 }),
      col("months", "json"), col("payload", "json"), col("createdAt", "datetime(3)", { defaultValue: "CURRENT_TIMESTAMP(3)", extra: "DEFAULT_GENERATED" }), col("confirmedAt", "datetime(3)", { nullable: true }),
    ], indexes: [idx("PRIMARY", ["id"], true), idx("monthly_profit_scope", ["workspaceId", "status", "id"]), idx("monthly_profit_owner", ["workspaceId", "userId", "id"])] },
    { name: "ops_monthly_import_artifacts", complete: true, exists: true, engine: "InnoDB", collation: "utf8mb4_unicode_ci", columns: [
      col("batch_id"), col("workspace_id"), col("prepared", "json"), col("payload_hash", "char(64)"), col("manifest", "json"), col("created_at", "datetime(3)", { defaultValue: "CURRENT_TIMESTAMP(3)" }),
    ], indexes: [idx("PRIMARY", ["batch_id"], true), idx("monthly_artifact_scope", ["workspace_id", "batch_id"])] },
  ] };
}
const absent = table => ({ name: table.name, complete: true, exists: false });
test("only the existing0308 reservation plans both transactional tables without execution", () => {
  const s = snapshot(); s.tables = s.tables.map(absent);
  const p = planMonthlyFinancialSchema(s);
  assert.deepEqual(p.statements, MONTHLY_FINANCIAL_SCHEMA_DDL); assert.equal(p.executable, false); assert.equal(p.productionApproved, false);
  assert.equal(p.ledgerRegistration, "unchanged"); assert.equal(p.candidate, "0308_integration_monthly_profit_imports.sql");
  for (const ddl of p.statements) { assert.match(ddl, /ENGINE=InnoDB/); assert.doesNotMatch(ddl, /DROP|TRUNCATE|DELETE|UPDATE\s|INSERT/); }
});
test("already-compatible tables need no statements and preserve original history", () => {
  const p = planMonthlyFinancialSchema(snapshot()); assert.deepEqual(p.statements, []); assert.equal(p.state, "structure_ready");
  assert.match(p.rollback, /Retain all original private files/); assert.equal(p.remainingGates.length, 5);
});
test("existing legacy batch table only requires the sidecar, not table recreation", () => {
  const s = snapshot(); s.tables[1] = absent(s.tables[1]); assert.deepEqual(planMonthlyFinancialSchema(s).statements, [MONTHLY_FINANCIAL_SCHEMA_DDL[1]]);
});
test("table order and equivalent integer display widths do not change the plan", () => {
  const s = snapshot(); s.tables[0].columns[0].type = "int(11)"; s.tables.reverse(); assert.deepEqual(planMonthlyFinancialSchema(s).statements, []);
});
test("nullable or explicitly defaulted extra fields and nonunique indexes are compatible", () => {
  const s = snapshot(); s.tables[0].columns.push(col("note", "text", { nullable: true })); s.tables[0].indexes.push(idx("note", ["note"]));
  assert.deepEqual(planMonthlyFinancialSchema(s).statements, []);
});
for (const [name, mutate] of [
  ["unverified database", s => { s.databaseVerified = false; }],
  ["different reservation", s => { s.reservedFile = "0317_monthly.sql"; }],
  ["missing sidecar proof", s => { s.tables.pop(); }],
  ["duplicate table", s => { s.tables[1] = s.tables[0]; }],
  ["unknown table", s => { s.tables[1].name = "unrelated"; }],
  ["incomplete table", s => { s.tables[0].complete = false; }],
  ["false absence", s => { s.tables[0].exists = false; }],
  ["nontransactional batch", s => { s.tables[0].engine = "MyISAM"; }],
  ["nontransactional artifact", s => { s.tables[1].engine = "MyISAM"; }],
  ["unknown collation", s => { s.tables[0].collation = "utf8mb4_bin"; }],
  ["different status collation", s => { s.tables[0].columns[6].collation = "utf8mb4_bin"; }],
  ["missing raw JSON", s => { s.tables[0].columns = s.tables[0].columns.filter(c => c.name !== "payload"); }],
  ["nullable original filename", s => { s.tables[0].columns[3].nullable = true; }],
  ["unsigned batch id", s => { s.tables[0].columns[0].type = "int unsigned"; }],
  ["auto status completed", s => { s.tables[0].columns[6].defaultValue = "completed"; }],
  ["missing skipped default", s => { s.tables[0].columns[8].defaultValue = null; }],
  ["confirmed date nonnullable", s => { s.tables[0].columns[13].nullable = false; }],
  ["changed timestamp precision", s => { s.tables[0].columns[12].type = "datetime"; }],
  ["timestamp automatic mutation", s => { s.tables[0].columns[12].extra = "on update CURRENT_TIMESTAMP(3)"; }],
  ["auto artifact id", s => { s.tables[1].columns[0].extra = "auto_increment"; }],
  ["truncated payload hash", s => { s.tables[1].columns[3].type = "char(32)"; }],
  ["text manifest", s => { s.tables[1].columns[4].type = "longtext"; }],
  ["required extra column", s => { s.tables[0].columns.push(col("unhandled", "text")); }],
  ["undefined extra default", s => { s.tables[0].columns.push(col("unhandled", "text", { defaultValue: undefined })); }],
  ["duplicate column", s => { s.tables[0].columns.push(s.tables[0].columns[0]); }],
  ["missing primary", s => { s.tables[0].indexes.shift(); }],
  ["missing owner index", s => { s.tables[0].indexes.pop(); }],
  ["prefix-only scope index", s => { s.tables[0].indexes[1].prefixLengths[1] = 3; }],
  ["missing artifact scope index", s => { s.tables[1].indexes.pop(); }],
  ["extra unique content hash", s => { s.tables[0].indexes.push(idx("file_unique", ["fileHash"], true)); }],
  ["prefix metadata omitted", s => { delete s.tables[0].indexes[1].prefixLengths; }],
  ["duplicate index", s => { s.tables[1].indexes.push(s.tables[1].indexes[1]); }],
]) test(`fails closed on ${name}`, () => { const s = snapshot(); mutate(s); assert.throws(() => planMonthlyFinancialSchema(s)); });
