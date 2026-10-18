import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { assertOperationsBoardSchema } from "./operationsBoardSchemaAdmission";

// The admission module imports DbExecutor as a type only. Any accidental
// runtime database import is a failure; all execution below is an SQL fixture.
vi.mock("../../repositories/dbClient", () => { throw new Error("No database connection is permitted in this test"); });

type Row = Record<string, unknown>;
const names = ["ops_board_states", "ops_board_editions", "ops_board_notes", "ops_board_partner_pairs"];
const databaseName = "synthetic_board_schema";
let databaseRows: Row[], tableRows: Row[], columnRows: Row[], indexRows: Row[];
let queries: { sql: string; params: unknown[] }[], failure: string | null;
let resultOverride: ((text: string, result: unknown) => unknown) | null;
const execute = vi.fn(async (statement: SQL): Promise<unknown> => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
  if (failure && query.sql.includes(failure)) throw new Error("synthetic secret mysql://user:password@host/private_db SELECT hidden_key");
  const rows = query.sql.includes("information_schema.TABLES") ? tableRows
    : query.sql.includes("information_schema.COLUMNS") ? columnRows
      : query.sql.includes("information_schema.STATISTICS") ? indexRows
        : query.sql === "SELECT DATABASE() AS databaseName" ? databaseRows : null;
  if (!rows) throw new Error("Unexpected nonmetadata SQL");
  const result = [structuredClone(rows), []];
  return resultOverride ? resultOverride(query.sql, result) : result;
});
const tx = { execute };
function index(tableName: string, indexName: string, columns: string[], unique = false): Row[] {
  return columns.map((columnName, i) => ({ schemaName: databaseName, tableName, indexName, nonUnique: unique ? 0 : 1,
    sequence: i + 1, columnName, prefixLength: null, indexType: "BTREE" }));
}
function metadata(version: "5.7" | "8.0" = "8.0") {
  const columns = (tableName: string, fields: [string, string, { nullable?: boolean; ascii?: boolean; auto?: boolean; defaultValue?: unknown }?][]) => fields.map(([columnName, type, options = {}], i): Row => {
    const dataType = type.match(/^[a-z]+/u)![0];
    return { schemaName: databaseName, tableName, columnName, ordinal: i + 1, dataType,
      columnType: version === "5.7" && type === "int" ? "int(11)" : version === "5.7" && type === "tinyint" ? "tinyint(4)" : type,
      isNullable: options.nullable ? "YES" : "NO", defaultValue: options.defaultValue ?? null, extra: options.auto ? "auto_increment" : "",
      collation: /^(?:char|varchar|text)$/u.test(dataType) ? options.ascii ? "ascii_bin" : "utf8mb4_bin" : null };
  });
  databaseRows = [{ databaseName }];
  tableRows = names.map(tableName => ({ schemaName: databaseName, tableName, tableType: "BASE TABLE", engine: "InnoDB", collation: "utf8mb4_bin" }));
  columnRows = [
    ...columns(names[0], [["id", "int", { auto: true }], ["workspace_id", "int"], ["scope_key", "char(64)", { ascii: true }], ["store_name", "varchar(200)"], ["country", "varchar(50)"], ["current_month", "char(7)", { ascii: true }], ["current_edition_id", "int", { nullable: true }], ["version", "int", { defaultValue: "1" }], ["created_at", "datetime(3)"], ["updated_at", "datetime(3)"]]),
    ...columns(names[1], [["id", "int", { auto: true }], ["workspace_id", "int"], ["state_id", "int"], ["month", "char(7)", { ascii: true }], ["revision", "int"], ["version", "int"], ["kind", "varchar(20)", { ascii: true }], ["status", "varchar(20)", { ascii: true }], ["original_edition_id", "int", { nullable: true }], ["capture", "json"], ["source_hash", "char(64)", { ascii: true }], ["created_by", "int"], ["created_at", "datetime(3)"], ["updated_at", "datetime(3)"], ["archived_at", "datetime(3)", { nullable: true }]]),
    ...columns(names[2], [["edition_id", "int"], ["workspace_id", "int"], ["parent_asin", "varchar(500)"], ["note", "text"], ["version", "int"], ["updated_by", "int"], ["updated_at", "datetime(3)"]]),
    ...columns(names[3], [["id", "int", { auto: true }], ["workspace_id", "int"], ["first_user_id", "int"], ["second_user_id", "int"], ["version", "int"], ["updated_by", "int"], ["is_active", "tinyint"], ["updated_at", "datetime(3)"]]),
  ];
  indexRows = [
    ...index(names[0], "PRIMARY", ["id"], true), ...index(names[0], "board_state_scope", ["workspace_id", "scope_key"], true),
    ...index(names[1], "PRIMARY", ["id"], true), ...index(names[1], "board_edition_revision", ["workspace_id", "state_id", "month", "revision"], true), ...index(names[1], "board_edition_scope", ["workspace_id", "state_id", "id"]),
    ...index(names[2], "PRIMARY", ["edition_id", "parent_asin"], true), ...index(names[2], "board_note_workspace", ["workspace_id", "edition_id"]),
    ...index(names[3], "PRIMARY", ["id"], true), ...index(names[3], "board_partner_pair", ["workspace_id", "first_user_id", "second_user_id"], true),
  ];
}
const col = (tableIndex: number, name: string) => columnRows.find(row => row.tableName === names[tableIndex] && row.columnName === name)!;
const ix = (tableIndex: number, name: string) => indexRows.filter(row => row.tableName === names[tableIndex] && row.indexName === name);
const expectFailure = (reason: string) => expect(assertOperationsBoardSchema(tx)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: `OPERATIONS_BOARD_SCHEMA_${reason}` });
beforeEach(() => { metadata(); queries = []; failure = null; resultOverride = null; execute.mockClear(); });

describe("operations-board exact structural admission", () => {
  it.each(["5.7", "8.0"] as const)("accepts complete MySQL %s metadata through the real pure planner", async version => {
    metadata(version); await expect(assertOperationsBoardSchema(tx)).resolves.toBeUndefined();
    expect(queries).toHaveLength(4);
    expect(queries[0]).toEqual({ sql: "SELECT DATABASE() AS databaseName", params: [] });
    for (const query of queries.slice(1)) {
      expect(query.sql).toContain("TABLE_SCHEMA=DATABASE()"); expect(query.params).toEqual(names);
      expect(query.sql).not.toContain(databaseName); expect(query.sql).not.toMatch(/IS_VISIBLE|ops_profit_board_/u);
      for (const table of names) expect(query.sql).not.toContain(table);
    }
    expect(queries.every(query => /^\s*SELECT\b/u.test(query.sql))).toBe(true);
    expect(queries.map(query => query.sql).join("\n")).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|TRUNCATE|USE|START TRANSACTION|COMMIT|ROLLBACK)\b/u);
  });
  it("accepts order-independent SQL row output without changing the inspected metadata", async () => {
    tableRows.reverse(); columnRows.reverse(); indexRows.reverse();
    const before = structuredClone({ tableRows, columnRows, indexRows });
    await assertOperationsBoardSchema(tx); expect({ tableRows, columnRows, indexRows }).toEqual(before);
  });
  it("accepts numeric version default and ordinary additional index", async () => {
    col(0, "version").defaultValue = 1; indexRows.push(...index(names[1], "archive_lookup", ["workspace_id", "archived_at"]));
    await expect(assertOperationsBoardSchema(tx)).resolves.toBeUndefined();
  });
  it.each(names)("rejects genuinely absent %s without executing its planned CREATE", async name => {
    tableRows = tableRows.filter(row => row.tableName !== name); columnRows = columnRows.filter(row => row.tableName !== name); indexRows = indexRows.filter(row => row.tableName !== name);
    await expectFailure("MIGRATION_REQUIRED"); expect(queries).toHaveLength(4);
  });
  it("rejects four genuinely absent tables instead of initializing a new archive", async () => {
    tableRows = []; columnRows = []; indexRows = []; await expectFailure("MIGRATION_REQUIRED");
    expect(queries.every(query => /^\s*SELECT\b/u.test(query.sql))).toBe(true);
  });
  it("does not cache readiness across requests", async () => {
    await assertOperationsBoardSchema(tx); tableRows[0].engine = "MyISAM";
    await expectFailure("INCOMPATIBLE"); expect(queries).toHaveLength(8);
  });
  it.each(["SELECT DATABASE()", "information_schema.TABLES", "information_schema.COLUMNS", "information_schema.STATISTICS"])("sanitizes %s errors without converting failure into absence", async point => {
    failure = point;
    let received: unknown; try { await assertOperationsBoardSchema(tx); } catch (error) { received = error; }
    expect(received).toMatchObject({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_SCHEMA_READ_UNAVAILABLE" });
    expect(received).toHaveProperty("cause", undefined);
    expect(JSON.stringify(received)).not.toMatch(/password|mysql:|private_db|hidden_key|SELECT/u);
  });
  it.each([null, undefined, {}, { execute: null }])("requires a caller-provided transaction executor %s", async value => {
    await expect(assertOperationsBoardSchema(value)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_SCHEMA_READ_UNAVAILABLE" });
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([null, "", " schema", "schema ", "schema.other", "schema;DROP", "a".repeat(65), 8])("rejects invalid exact database identity %s", async value => {
    databaseRows = [{ databaseName: value }]; await expectFailure("DATABASE_UNVERIFIED"); expect(queries).toHaveLength(1);
  });
  it("rejects empty database identity result", async () => { databaseRows = []; await expectFailure("DATABASE_UNVERIFIED"); });
  it("rejects duplicate database identity rows", async () => { databaseRows.push(databaseRows[0]); await expectFailure("METADATA_INVALID"); });

  const metadataCases: [string, () => void][] = [
    ["duplicate table", () => { tableRows[1] = { ...tableRows[0] }; }],
    ["unknown table", () => { tableRows[0].tableName = "users"; }],
    ["wrong-case table", () => { tableRows[0].tableName = "OPS_BOARD_STATES"; }],
    ["table from another schema", () => { tableRows[0].schemaName = "another_schema"; }],
    ["column from another schema", () => { columnRows[0].schemaName = "another_schema"; }],
    ["index from another schema", () => { indexRows[0].schemaName = "another_schema"; }],
    ["view masquerading as a table", () => { tableRows[0].tableType = "VIEW"; }],
    ["table without engine", () => { tableRows[0].engine = null; }],
    ["columns contradict absent table", () => { tableRows.shift(); indexRows = indexRows.filter(row => row.tableName !== names[0]); }],
    ["indexes contradict absent table", () => { tableRows.shift(); columnRows = columnRows.filter(row => row.tableName !== names[0]); }],
    ["columns invisible for existing table", () => { columnRows = columnRows.filter(row => row.tableName !== names[0]); }],
    ["indexes invisible for existing table", () => { indexRows = indexRows.filter(row => row.tableName !== names[0]); }],
    ["missing column leaves ordinal gap", () => { columnRows = columnRows.filter(row => row !== col(0, "scope_key")); }],
    ["duplicate column ordinal", () => { columnRows[1].ordinal = columnRows[0].ordinal; }],
    ["string column ordinal", () => { columnRows[0].ordinal = "1"; }],
    ["column type metadata contradiction", () => { col(0, "id").dataType = "bigint"; }],
    ["missing default metadata", () => { delete col(0, "id").defaultValue; }],
    ["invalid numeric default", () => { col(0, "version").defaultValue = NaN; }],
    ["unknown nullable flag", () => { col(0, "id").isNullable = "MAYBE"; }],
    ["missing collation proof", () => { delete col(0, "scope_key").collation; }],
    ["malformed extra", () => { col(0, "version").extra = null; }],
    ["index sequence gap", () => { ix(0, "board_state_scope")[1].sequence = 3; }],
    ["duplicate key sequence", () => { ix(0, "board_state_scope")[1].sequence = 1; }],
    ["missing leading key", () => { indexRows = indexRows.filter(row => row !== ix(0, "board_state_scope")[0]); }],
    ["mixed uniqueness within index", () => { ix(0, "board_state_scope")[1].nonUnique = 1; }],
    ["mixed type within index", () => { ix(0, "board_state_scope")[1].indexType = "HASH"; }],
    ["string uniqueness flag", () => { indexRows[0].nonUnique = "0"; }],
    ["functional index without column", () => { indexRows[0].columnName = null; }],
    ["unknown index table", () => { indexRows[0].tableName = "unrelated"; }],
    ["missing prefix proof", () => { delete indexRows[0].prefixLength; }],
    ["negative prefix proof", () => { indexRows[0].prefixLength = -1; }],
    ["missing index type", () => { delete indexRows[0].indexType; }],
    ["table metadata cap exceeded", () => { tableRows.push(tableRows[0]); }],
    ["column metadata cap exceeded", () => { columnRows = Array.from({ length: 401 }, () => columnRows[0]); }],
    ["index metadata cap exceeded", () => { indexRows = Array.from({ length: 6401 }, () => indexRows[0]); }],
  ];
  it.each(metadataCases)("rejects malformed complete metadata: %s", async (_name, mutate) => { mutate(); await expectFailure("METADATA_INVALID"); });

  const incompatibleCases: [string, () => void][] = [
    ["nontransactional engine", () => { tableRows[0].engine = "MyISAM"; }],
    ["case-insensitive table collation", () => { tableRows[1].collation = "utf8mb4_unicode_ci"; }],
    ["absent trailing required column", () => { columnRows = columnRows.filter(row => row !== col(2, "updated_at")); }],
    ["extra unreviewed nullable column", () => { columnRows.push({ ...col(2, "note"), columnName: "extension", ordinal: 8, isNullable: "YES" }); }],
    ["duplicate column name", () => { col(0, "workspace_id").columnName = "id"; }],
    ["unsigned ID", () => { col(0, "id").columnType = "int unsigned"; }],
    ["capture TEXT not native JSON", () => { Object.assign(col(1, "capture"), { dataType: "longtext", columnType: "longtext", collation: "utf8mb4_bin" }); }],
    ["nullable state scope", () => { col(0, "scope_key").isNullable = "YES"; }],
    ["nonnullable initial current edition", () => { col(0, "current_edition_id").isNullable = "NO"; }],
    ["wrong explicit ascii collation", () => { col(1, "source_hash").collation = "utf8mb4_bin"; }],
    ["null text collation", () => { col(2, "note").collation = null; }],
    ["short parent identity", () => { col(2, "parent_asin").columnType = "varchar(20)"; }],
    ["implicit active default", () => { col(3, "is_active").defaultValue = 1; }],
    ["missing default version", () => { col(0, "version").defaultValue = null; }],
    ["timestamp default", () => { col(0, "created_at").defaultValue = "CURRENT_TIMESTAMP(3)"; }],
    ["timestamp auto update", () => { col(1, "updated_at").extra = "DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)"; }],
    ["timestamp precision changed", () => { col(1, "archived_at").columnType = "datetime(6)"; }],
    ["hidden generated source hash", () => { col(1, "source_hash").extra = "STORED GENERATED"; }],
    ["auto increment note key", () => { col(2, "edition_id").extra = "auto_increment"; }],
    ["missing primary", () => { indexRows = indexRows.filter(row => !(row.tableName === names[0] && row.indexName === "PRIMARY")); }],
    ["prefix-only full parent primary", () => { ix(2, "PRIMARY")[1].prefixLength = 20; }],
    ["missing unique scope", () => { indexRows = indexRows.filter(row => !(row.tableName === names[0] && row.indexName === "board_state_scope")); }],
    ["nonunique scope", () => { ix(0, "board_state_scope").forEach(row => { row.nonUnique = 1; }); }],
    ["reversed note primary", () => { const entries = ix(2, "PRIMARY"); entries[0].columnName = "parent_asin"; entries[1].columnName = "edition_id"; }],
    ["unknown indexed column", () => { ix(0, "board_state_scope")[1].columnName = "missing"; }],
    ["repeated indexed column", () => { ix(0, "board_state_scope")[1].columnName = "workspace_id"; }],
    ["missing notes workspace index", () => { indexRows = indexRows.filter(row => !(row.tableName === names[2] && row.indexName === "board_note_workspace")); }],
    ["extra globally unique month", () => { indexRows.push(...index(names[1], "global_month", ["month"], true)); }],
    ["case-insensitive duplicate index names", () => { indexRows.push(...index(names[0], "BOARD_STATE_SCOPE", ["workspace_id", "scope_key"], true)); }],
    ["non-BTREE index", () => { ix(0, "board_state_scope").forEach(row => { row.indexType = "HASH"; }); }],
  ];
  it.each(incompatibleCases)("real planner rejects structural mismatch: %s", async (_name, mutate) => { mutate(); await expectFailure("INCOMPATIBLE"); });
  it.each([null, {}, [[], []], [null, []], [[null], []], [[[]], []], [[{}]], [[], [], []]])("rejects invalid driver identity result %j", async value => {
    resultOverride = (text, result) => text === "SELECT DATABASE() AS databaseName" ? value : result;
    await expect(assertOperationsBoardSchema(tx)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
