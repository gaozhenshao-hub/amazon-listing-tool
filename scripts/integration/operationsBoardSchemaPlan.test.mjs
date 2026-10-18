import test from "node:test";
import assert from "node:assert/strict";
import { OPERATIONS_BOARD_SCHEMA_CANDIDATE, OPERATIONS_BOARD_SCHEMA_DDL, OPERATIONS_BOARD_LEGACY_TABLES, planOperationsBoardSchema } from "./operationsBoardSchemaPlan.mjs";

const col = (name, type = "int", changes = {}) => ({ name, type, nullable: false, defaultValue: null, extra: "",
  ...(/^(?:char|varchar|text)/u.test(type) ? { collation: "utf8mb4_bin" } : {}), ...changes });
const ascii = (name, type) => col(name, type, { collation: "ascii_bin" });
const idx = (name, columns, unique = false) => ({ name, columns, unique, prefixLengths: columns.map(() => null) });
const table = (name, columns, indexes) => ({ name, complete: true, exists: true, engine: "InnoDB", collation: "utf8mb4_bin", columns, indexes });
function snapshot() {
  return { complete: true, databaseVerified: true, reservedFile: OPERATIONS_BOARD_SCHEMA_CANDIDATE, tables: [
    table("ops_board_states", [
      col("id", "int", { extra: "auto_increment" }), col("workspace_id"), ascii("scope_key", "char(64)"), col("store_name", "varchar(200)"), col("country", "varchar(50)"),
      ascii("current_month", "char(7)"), col("current_edition_id", "int", { nullable: true }), col("version", "int", { defaultValue: 1 }), col("created_at", "datetime(3)"), col("updated_at", "datetime(3)"),
    ], [idx("PRIMARY", ["id"], true), idx("board_state_scope", ["workspace_id", "scope_key"], true)]),
    table("ops_board_editions", [
      col("id", "int", { extra: "auto_increment" }), col("workspace_id"), col("state_id"), ascii("month", "char(7)"), col("revision"), col("version"),
      ascii("kind", "varchar(20)"), ascii("status", "varchar(20)"), col("original_edition_id", "int", { nullable: true }), col("capture", "json"), ascii("source_hash", "char(64)"),
      col("created_by"), col("created_at", "datetime(3)"), col("updated_at", "datetime(3)"), col("archived_at", "datetime(3)", { nullable: true }),
    ], [idx("PRIMARY", ["id"], true), idx("board_edition_revision", ["workspace_id", "state_id", "month", "revision"], true), idx("board_edition_scope", ["workspace_id", "state_id", "id"])]),
    table("ops_board_notes", [
      col("edition_id"), col("workspace_id"), col("parent_asin", "varchar(500)"), col("note", "text"), col("version"), col("updated_by"), col("updated_at", "datetime(3)"),
    ], [idx("PRIMARY", ["edition_id", "parent_asin"], true), idx("board_note_workspace", ["workspace_id", "edition_id"])]),
    table("ops_board_partner_pairs", [
      col("id", "int", { extra: "auto_increment" }), col("workspace_id"), col("first_user_id"), col("second_user_id"), col("version"), col("updated_by"), col("is_active", "tinyint"), col("updated_at", "datetime(3)"),
    ], [idx("PRIMARY", ["id"], true), idx("board_partner_pair", ["workspace_id", "first_user_id", "second_user_id"], true)]),
  ] };
}
const absent = value => ({ name: value.name, complete: true, exists: false });
const column = (s, tableIndex, name) => s.tables[tableIndex].columns.find(item => item.name === name);
const rejects = (mutate, code) => {
  const value = snapshot(); mutate(value);
  assert.throws(() => planOperationsBoardSchema(value), error => error.code === `OPERATIONS_BOARD_SCHEMA_${code}` && error.message === error.code);
};

test("all four absent tables plan only CREATE under the unchanged 0313 reservation", () => {
  const value = snapshot(); value.tables = value.tables.map(absent);
  const plan = planOperationsBoardSchema(value);
  assert.equal(plan.candidate, "0313_integration_ops_profit_board.sql");
  assert.equal(plan.state, "migration_required");
  assert.deepEqual(plan.statements, OPERATIONS_BOARD_SCHEMA_DDL);
  assert.equal(plan.executable, false); assert.equal(plan.productionApproved, false);
  assert.equal(plan.ledgerRegistration, "unchanged"); assert.equal(plan.scheduleSeeding, "none");
  assert.equal(plan.sourceTablesModified, false); assert.equal(plan.businessRowsModified, false);
  assert.equal(plan.statements.length, 4);
  for (const [index, ddl] of plan.statements.entries()) {
    assert.ok(ddl.startsWith(`CREATE TABLE ${snapshot().tables[index].name} (`));
    assert.match(ddl, /ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin$/u);
    assert.doesNotMatch(ddl, /\b(?:ALTER|DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE|IF NOT EXISTS)\b/iu);
    assert.doesNotMatch(ddl, /CURRENT_TIMESTAMP|ON UPDATE|FOREIGN KEY/iu);
  }
});
test("exact compatible structure returns no SQL and never claims historical data is migrated", () => {
  const plan = planOperationsBoardSchema(snapshot());
  assert.equal(plan.state, "structure_ready"); assert.deepEqual(plan.statements, []);
  assert.deepEqual(plan.legacyMigration, { status: "requires_reconciliation", tables: ["ops_profit_board_state", "ops_profit_board_editions", "ops_profit_board_notes"], statements: [] });
  assert.deepEqual(plan.legacyMigration.tables, OPERATIONS_BOARD_LEGACY_TABLES);
  assert.match(plan.verificationScope, /not live schema identity, data reconciliation, archive validity or production readiness/u);
  assert.match(plan.remainingGates.join("\n"), /first_user_id < second_user_id/u);
  assert.match(plan.remainingGates.join("\n"), /same-transaction initialization/u);
  assert.match(plan.remainingGates.join("\n"), /UUID\/check\/cancel/u);
  assert.match(plan.rollback, /all three legacy tables/u);
  assert.match(plan.rollback, /Never hard-delete, truncate, rewrite frozen history/u);
});
for (let missing = 0; missing < 4; missing++) test(`only absent table ${missing} is proposed, with no rebuild or index repair`, () => {
  const value = snapshot(); value.tables[missing] = absent(value.tables[missing]);
  assert.deepEqual(planOperationsBoardSchema(value).statements, [OPERATIONS_BOARD_SCHEMA_DDL[missing]]);
});
test("table/column/index order, integer display widths and number-string default are compatible", () => {
  const value = snapshot();
  for (const t of value.tables) {
    t.columns.reverse(); t.indexes.reverse();
    for (const c of t.columns) {
      if (c.type === "int") c.type = "INT(11)";
      if (c.type === "tinyint") c.type = "TINYINT(4)";
      if (c.defaultValue === 1) c.defaultValue = "1";
    }
  }
  value.tables.reverse(); assert.deepEqual(planOperationsBoardSchema(value).statements, []);
});
test("equivalent named required indexes and verified additional nonunique indexes are harmless", () => {
  const value = snapshot();
  for (const t of value.tables) for (const i of t.indexes) if (i.name !== "PRIMARY") { i.name = `renamed_${i.name}`; i.type = "BTREE"; i.visible = true; }
  value.tables[1].indexes.push(idx("archive_lookup", ["workspace_id", "archived_at"]));
  assert.deepEqual(planOperationsBoardSchema(value).statements, []);
});
test("explicit empty/null absence metadata is accepted", () => {
  const value = snapshot(); value.tables = value.tables.map(t => ({ ...absent(t), engine: null, collation: null, columns: [], indexes: [] }));
  assert.deepEqual(planOperationsBoardSchema(value).statements, OPERATIONS_BOARD_SCHEMA_DDL);
});
test("planner neither mutates its complete snapshot nor leaks input metadata into DDL", () => {
  const value = snapshot(), before = structuredClone(value);
  const freeze = item => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } return item; };
  const first = planOperationsBoardSchema(freeze(value)); first.legacyMigration.tables.push("changed_response_only");
  assert.deepEqual(value, before);
  assert.equal(planOperationsBoardSchema(value).legacyMigration.tables.length, 3);
  assert.equal(Object.isFrozen(OPERATIONS_BOARD_SCHEMA_DDL), true);
});
test("a broken existing table rejects the entire plan even when the other three are absent", () => {
  const value = snapshot(); value.tables = value.tables.map((t, index) => index === 3 ? t : absent(t));
  value.tables[3].indexes.pop();
  assert.throws(() => planOperationsBoardSchema(value), { code: "OPERATIONS_BOARD_SCHEMA_REQUIRED_INDEX_MISSING" });
});
test("DDL preserves explicit timestamp CAS and complete composite keys/text collations", () => {
  const all = OPERATIONS_BOARD_SCHEMA_DDL.join("\n");
  assert.equal((all.match(/DATETIME\(3\)/gu) ?? []).length, 7);
  assert.equal((all.match(/DEFAULT /gu) ?? []).length, 1);
  assert.match(all, /version INT NOT NULL DEFAULT 1/u);
  assert.match(OPERATIONS_BOARD_SCHEMA_DDL[2], /PRIMARY KEY \(edition_id,parent_asin\)/u);
  assert.match(OPERATIONS_BOARD_SCHEMA_DDL[2], /parent_asin VARCHAR\(500\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin/u);
  assert.match(OPERATIONS_BOARD_SCHEMA_DDL[2], /note TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/u);
  assert.match(OPERATIONS_BOARD_SCHEMA_DDL[1], /UNIQUE KEY board_edition_revision \(workspace_id,state_id,month,revision\)/u);
  assert.match(OPERATIONS_BOARD_SCHEMA_DDL[3], /UNIQUE KEY board_partner_pair \(workspace_id,first_user_id,second_user_id\)/u);
});

for (const [name, mutate, code] of [
  ["incomplete snapshot", s => { s.complete = false; }, "INCOMPLETE"],
  ["database not verified", s => { s.databaseVerified = false; }, "INCOMPLETE"],
  ["wrong reservation", s => { s.reservedFile = "0313_new_name.sql"; }, "INCOMPLETE"],
  ["missing table", s => { s.tables.pop(); }, "INCOMPLETE"],
  ["unknown extra legacy table", s => { s.tables.push(absent({ name: "ops_profit_board_notes" })); }, "INCOMPLETE"],
  ["duplicate table", s => { s.tables[1] = s.tables[0]; }, "TABLE_SET_INVALID"],
  ["legacy table substituted", s => { s.tables[0].name = "ops_profit_board_state"; }, "TABLE_SET_INVALID"],
  ["table proof incomplete", s => { s.tables[2].complete = false; }, "INCOMPLETE"],
  ["missing exists proof", s => { delete s.tables[0].exists; }, "INCOMPLETE"],
  ["absence contradicts columns", s => { s.tables[0].exists = false; }, "ABSENCE_CONFLICT"],
  ["absence contradicts engine", s => { s.tables[0] = { ...absent(s.tables[0]), engine: "InnoDB" }; }, "ABSENCE_CONFLICT"],
  ["absence contradicts collation", s => { s.tables[0] = { ...absent(s.tables[0]), collation: "utf8mb4_bin" }; }, "ABSENCE_CONFLICT"],
  ["absence undefined columns", s => { s.tables[0] = { ...absent(s.tables[0]), columns: undefined }; }, "ABSENCE_CONFLICT"],
  ["additional nullable column unreviewed", s => { s.tables[0].columns.push(col("extension", "text", { nullable: true })); }, "INCOMPLETE"],
  ["required column omitted", s => { s.tables[1].columns.pop(); }, "INCOMPLETE"],
  ["column duplicate replaces source hash", s => { s.tables[1].columns[10] = s.tables[1].columns[0]; }, "COLUMN_INVALID"],
  ["unknown column replaces source hash", s => { column(s, 1, "source_hash").name = "unknown_hash"; }, "COLUMN_INVALID"],
  ["default metadata omitted", s => { delete column(s, 0, "version").defaultValue; }, "COLUMN_INVALID"],
  ["undefined default", s => { column(s, 0, "version").defaultValue = undefined; }, "COLUMN_INVALID"],
  ["nonfinite default", s => { column(s, 0, "version").defaultValue = NaN; }, "COLUMN_INVALID"],
  ["malformed nullable flag", s => { column(s, 0, "version").nullable = 0; }, "COLUMN_INVALID"],
  ["unsigned workspace", s => { column(s, 0, "workspace_id").type = "int unsigned"; }, "COLUMN_INCOMPATIBLE"],
  ["bigint identity", s => { column(s, 0, "id").type = "bigint"; }, "COLUMN_INCOMPATIBLE"],
  ["capture substituted text", s => { column(s, 1, "capture").type = "longtext"; }, "COLUMN_INCOMPATIBLE"],
  ["enumerated status instead of agreed varchar", s => { column(s, 1, "status").type = "enum('current','archived')"; }, "COLUMN_INCOMPATIBLE"],
  ["truncated parent identity", s => { column(s, 2, "parent_asin").type = "varchar(20)"; }, "COLUMN_INCOMPATIBLE"],
  ["integer boolean instead of tinyint", s => { column(s, 3, "is_active").type = "int"; }, "COLUMN_INCOMPATIBLE"],
  ["numeric nonnull collation", s => { column(s, 0, "id").collation = "ascii_bin"; }, "COLUMN_COLLATION"],
  ["default version missing", s => { column(s, 0, "version").defaultValue = null; }, "DEFAULT_INCOMPATIBLE"],
  ["implicit edition version", s => { column(s, 1, "version").defaultValue = 1; }, "DEFAULT_INCOMPATIBLE"],
  ["implicit active pair", s => { column(s, 3, "is_active").defaultValue = 1; }, "DEFAULT_INCOMPATIBLE"],
  ["implicit current edition status", s => { column(s, 1, "status").defaultValue = "current"; }, "DEFAULT_INCOMPATIBLE"],
  ["state id not automatic", s => { column(s, 0, "id").extra = ""; }, "EXTRA_INCOMPATIBLE"],
  ["automatic note edition id", s => { column(s, 2, "edition_id").extra = "auto_increment"; }, "EXTRA_INCOMPATIBLE"],
  ["generated source hash", s => { column(s, 1, "source_hash").extra = "STORED GENERATED"; }, "EXTRA_INCOMPATIBLE"],
  ["no indexes", s => { s.tables[0].indexes = []; }, "INCOMPLETE"],
  ["missing primary", s => { s.tables[0].indexes.shift(); }, "PRIMARY_INCOMPATIBLE"],
  ["nonunique primary", s => { s.tables[0].indexes[0].unique = false; }, "PRIMARY_INCOMPATIBLE"],
  ["reversed note primary", s => { s.tables[2].indexes[0].columns.reverse(); }, "PRIMARY_INCOMPATIBLE"],
  ["truncated primary parent", s => { s.tables[2].indexes[0].prefixLengths[1] = 20; }, "PRIMARY_INCOMPATIBLE"],
  ["missing compound scope unique", s => { s.tables[0].indexes.pop(); }, "REQUIRED_INDEX_MISSING"],
  ["reversed scope unique", s => { s.tables[0].indexes[1].columns.reverse(); }, "REQUIRED_INDEX_MISSING"],
  ["scope unique excludes workspace", s => { s.tables[0].indexes[1] = idx("board_state_scope", ["scope_key"], true); }, "REQUIRED_INDEX_MISSING"],
  ["prefix-only scope hash unique", s => { s.tables[0].indexes[1].prefixLengths[1] = 32; }, "REQUIRED_INDEX_MISSING"],
  ["wrong edition revision unique", s => { s.tables[1].indexes[1].unique = false; }, "REQUIRED_INDEX_MISSING"],
  ["missing edition scope index", s => { s.tables[1].indexes.pop(); }, "REQUIRED_INDEX_MISSING"],
  ["missing notes workspace index", s => { s.tables[2].indexes.pop(); }, "REQUIRED_INDEX_MISSING"],
  ["partner unique missing second member", s => { s.tables[3].indexes[1] = idx("board_partner_pair", ["workspace_id", "first_user_id"], true); }, "REQUIRED_INDEX_MISSING"],
  ["extra global month uniqueness", s => { s.tables[1].indexes.push(idx("global_month", ["month"], true)); }, "EXTRA_UNIQUENESS"],
  ["extra source hash uniqueness", s => { s.tables[1].indexes.push(idx("source_unique", ["source_hash"], true)); }, "EXTRA_UNIQUENESS"],
  ["duplicate index name", s => { s.tables[0].indexes.push(s.tables[0].indexes[1]); }, "INDEX_INVALID"],
  ["case-insensitive duplicate index name", s => { s.tables[0].indexes.push({ ...s.tables[0].indexes[1], name: "BOARD_STATE_SCOPE" }); }, "INDEX_INVALID"],
  ["index prefix proof omitted", s => { delete s.tables[0].indexes[1].prefixLengths; }, "INDEX_INVALID"],
  ["index prefix count incomplete", s => { s.tables[0].indexes[1].prefixLengths.pop(); }, "INDEX_INVALID"],
  ["invalid prefix length", s => { s.tables[0].indexes[1].prefixLengths[1] = 0; }, "INDEX_INVALID"],
  ["unknown index column", s => { s.tables[0].indexes[1].columns[1] = "unknown"; }, "INDEX_INVALID"],
  ["repeated index column", s => { s.tables[0].indexes[1].columns[1] = "workspace_id"; }, "INDEX_INVALID"],
  ["functional index", s => { s.tables[0].indexes[1].columns[1] = null; }, "INDEX_INVALID"],
  ["nonboolean uniqueness", s => { s.tables[0].indexes[1].unique = 1; }, "INDEX_INVALID"],
  ["hidden scope index", s => { s.tables[0].indexes[1].visible = false; }, "INDEX_INCOMPATIBLE"],
  ["non-BTREE index", s => { s.tables[2].indexes[1].type = "FULLTEXT"; }, "INDEX_INCOMPATIBLE"],
  ["unsafe index identifier", s => { s.tables[0].indexes[1].name = "danger;DROP TABLE x"; }, "INDEX_INVALID"],
]) test(`fails closed on ${name}`, () => rejects(mutate, code));

for (const [ti, t] of snapshot().tables.entries()) {
  test(`rejects nontransactional ${t.name}`, () => rejects(s => { s.tables[ti].engine = "MyISAM"; }, "STORAGE_INCOMPATIBLE"));
  test(`rejects case-insensitive table collation ${t.name}`, () => rejects(s => { s.tables[ti].collation = "utf8mb4_unicode_ci"; }, "STORAGE_INCOMPATIBLE"));
  for (const c of t.columns) {
    test(`exact nullability required for ${t.name}.${c.name}`, () => rejects(s => { column(s, ti, c.name).nullable = !c.nullable; }, "COLUMN_INCOMPATIBLE"));
    if (c.collation) test(`explicit exact collation required for ${t.name}.${c.name}`, () => {
      rejects(s => { delete column(s, ti, c.name).collation; }, "COLUMN_COLLATION");
      rejects(s => { column(s, ti, c.name).collation = c.collation === "ascii_bin" ? "utf8mb4_bin" : "utf8mb4_0900_bin"; }, "COLUMN_COLLATION");
    });
    if (c.type === "datetime(3)") test(`timestamp precision/default/automatic mutation rejected for ${t.name}.${c.name}`, () => {
      rejects(s => { column(s, ti, c.name).type = "datetime"; }, "COLUMN_INCOMPATIBLE");
      rejects(s => { column(s, ti, c.name).defaultValue = "CURRENT_TIMESTAMP(3)"; }, "DEFAULT_INCOMPATIBLE");
      rejects(s => { column(s, ti, c.name).extra = "on update CURRENT_TIMESTAMP(3)"; }, "EXTRA_INCOMPATIBLE");
    });
  }
}
for (const value of [null, undefined, [], "complete", 1, true]) test(`rejects malformed snapshot ${JSON.stringify(value)}`, () => {
  assert.throws(() => planOperationsBoardSchema(value), { code: "OPERATIONS_BOARD_SCHEMA_INCOMPLETE" });
});
