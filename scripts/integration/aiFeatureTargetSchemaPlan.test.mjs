import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AI_FEATURE_TARGET_SOURCES, AI_FEATURE_TARGET_TABLES, AiFeatureTargetSchemaError,
  deriveAiFeatureTargetDefinitions, planAiFeatureTargetSchema,
} from "./aiFeatureTargetSchemaPlan.mjs";

const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const sources = AI_FEATURE_TARGET_SOURCES.map(source => ({ fileName: source.fileName, sql: readFileSync(new URL(`../../drizzle/${source.fileName}`, import.meta.url), "utf8") }));
const definitions = deriveAiFeatureTargetDefinitions(sources);
const CONFIG = "emperor_assistant_configurations", TURNS = "assistant_conversation_turns", RUNS = "ops_profit_analysis_runs", SAVES = "ops_profit_analysis_save_operations";
const textField = (key, value) => ({ [key]: value, [`${key}Bytes`]: value === null ? null : Buffer.byteLength(value) });

// Synthetic information_schema projections, never a native/production claim.
// Specs come from the actual pinned SQL, while tests below independently assert
// nullable tombstones, UUID indexes and mutation/refusal behavior.
function columnRow(tableName, spec, index) {
  const length = /^(?:var)?char\((\d+)\)$/u.exec(spec.type);
  const isEnum = spec.type.startsWith("enum(");
  const text = length || isEnum;
  return {
    tableName, columnName: spec.name, ordinalPosition: index + 1, dataType: spec.type.split("(")[0], ...textField("columnType", spec.type),
    isNullable: spec.nullable ? "YES" : "NO", ...textField("columnDefault", spec.timestampDefault ? "CURRENT_TIMESTAMP" : null),
    extra: spec.auto ? "auto_increment" : spec.timestampDefault ? `DEFAULT_GENERATED${spec.timestampUpdate ? " on update CURRENT_TIMESTAMP" : ""}` : "",
    characterMaximumLength: length ? Number(length[1]) : isEnum ? Math.max(...[...spec.type.matchAll(/'([a-z_]+)'/gu)].map(match => match[1].length)) : spec.type === "mediumblob" ? 16777215 : null,
    numericPrecision: spec.type === "int" ? 10 : null, numericScale: spec.type === "int" ? 0 : null,
    datetimePrecision: spec.type === "timestamp" ? 0 : spec.type === "datetime(3)" ? 3 : null,
    characterSetName: text ? "utf8mb4" : null, collationName: text ? "utf8mb4_bin" : null,
    columnKey: spec.name === "id" ? "PRI" : "", ...textField("generationExpression", ""),
  };
}
function seal(receipt) {
  const raw = receipt.observation.metadata;
  receipt.observation.metadataBudgets = Object.fromEntries(["columns", "indexes"].map(key => [key, { rowCount: raw[key].length, estimatedBytes: raw[key].length * 1024 }]));
  receipt.hashes = [hash(receipt.observation), hash(receipt.observation)];
  receipt.counts = { requestedTables: receipt.tableNames.length, existingTables: raw.tables.length, absentTables: receipt.observation.absent.length, columns: raw.columns.length, indexRows: raw.indexes.length };
  return receipt;
}
function fixture(present = AI_FEATURE_TARGET_TABLES) {
  const metadata = { schema: [{ schemaName: "amz_listing", characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci" }], tables: [], columns: [], indexes: [] };
  for (const definition of definitions.filter(item => present.includes(item.name))) {
    metadata.tables.push({ tableName: definition.name, tableType: "BASE TABLE", engine: "InnoDB", collationName: "utf8mb4_bin", rowFormat: "Dynamic", createOptions: "" });
    metadata.columns.push(...definition.columns.map((spec, index) => columnRow(definition.name, spec, index)));
    for (const index of definition.indexes) for (const [i, name] of index.columns.entries()) metadata.indexes.push({ tableName: definition.name, indexName: index.name, nonUnique: index.unique ? 0 : 1, sequence: i + 1, columnName: name,
      direction: "A", prefixLength: null, nullable: definition.columns.find(column => column.name === name).nullable ? "YES" : "", indexType: "BTREE", visible: "YES", ...textField("expression", null) });
  }
  return seal({ schema: "amazon-main-feature-metadata/v1", database: "amz_listing", tableNames: [...AI_FEATURE_TARGET_TABLES], status: "completed", complete: true, stable: true,
    readOnly: true, databaseWrites: false, businessRowsRead: false, migrationLedgerRead: false, credentialsReturned: false,
    observation: { identity: { schemaName: "amz_listing", version: "8.0.46-0ubuntu0.24.04.4", lowerCaseTableNames: 0, sqlMode: "ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION" }, metadata,
      absent: AI_FEATURE_TARGET_TABLES.filter(name => !present.includes(name)).map(tableName => ({ tableName, confirmation: "ER_NO_SUCH_TABLE", errno: 1146 })) } });
}
function objectFacts(receipt) {
  return { schema: "ai-feature-target-objects/v1", database: "amz_listing", metadataObservationSha256: receipt.hashes[0], complete: true, tableNames: [...AI_FEATURE_TARGET_TABLES],
    coverage: { triggers: "all_target_tables", foreignKeys: "inbound_and_outbound", checks: "all_target_tables", partitions: "all_target_tables" }, triggers: [], foreignKeys: [], checks: [], partitions: [] };
}
const plan = (receipt = fixture(), withObjects = true) => planAiFeatureTargetSchema({ metadataReceipt: receipt, sources, ...(withObjects ? { objectEvidence: objectFacts(receipt) } : {}) });
function expectError(fn, code) { assert.throws(fn, error => error instanceof AiFeatureTargetSchemaError && error.code === `AI_FEATURE_TARGET_${code}`); }
function conflict(mutate, tableName = TURNS, reason = "columns_defaults_or_nullability") {
  const receipt = fixture(); mutate(receipt.observation.metadata, receipt); seal(receipt);
  const result = plan(receipt); assert.equal(result.state, "conflict"); assert.ok(result.tables.find(table => table.name === tableName).reasons.includes(reason)); assert.equal(result.executable, false); return result;
}

test("actual three sources produce exactly eight pinned table definitions without IO in planner", () => {
  assert.deepEqual(definitions.map(item => item.name), AI_FEATURE_TARGET_TABLES);
  assert.deepEqual(definitions.map(item => item.columns.length), [9, 9, 12, 29, 12, 12, 23, 14]);
  assert.equal(definitions.reduce((sum, item) => sum + item.columns.length, 0), 120);
  for (const definition of definitions) {
    assert.equal(hash(definition.sql), definition.statementSha256);
    assert.match(definition.sql, /^CREATE TABLE /u);
    assert.doesNotMatch(definition.sql, /IF NOT EXISTS|ALTER TABLE|INSERT INTO|DROP TABLE|TRUNCATE/u);
  }
  const module = readFileSync(new URL("./aiFeatureTargetSchemaPlan.mjs", import.meta.url), "utf8");
  assert.deepEqual([...module.matchAll(/^import .+ from "([^"]+)"/gmu)].map(match => match[1]), ["node:crypto"]);
  assert.doesNotMatch(module, /process\.env|readFile|createConnection|\.query\(/u);
});
test("all absent yields exact source CREATE proposals, never approval or ledger adoption", () => {
  const result = plan(fixture([]));
  assert.equal(result.state, "absent"); assert.equal(result.statements.length, 8); assert.equal(result.executionEligibility, "not_approved");
  assert.deepEqual(result.statements.map(item => item.sql), definitions.map(item => item.sql));
  for (const flag of ["executable", "productionApproved", "databaseExecutionAuthorized", "provenanceAuthenticated", "historicalReferenceChanged"]) assert.equal(result[flag], false);
  assert.equal(result.ledgerRegistration, "unchanged");
});
test("compatible exact structures never produce CREATE/adoption or require empty rows", () => {
  const result = plan(); assert.equal(result.state, "compatible"); assert.equal(result.tables.length, 8); assert.deepEqual(result.statements, []);
  assert.equal(result.executionEligibility, "not_approved");
});
test("partial families retain only wholly absent table CREATE proposals", () => {
  const result = plan(fixture([CONFIG, TURNS, SAVES])); assert.equal(result.state, "partial");
  assert.equal(result.statements.length, 5); assert.ok(result.statements.every(item => ![CONFIG, TURNS, SAVES].includes(item.tableName)));
});
test("metadata-only R2 remains useful: missing object facts never hide absent CREATE proposals or approve", () => {
  const result = plan(fixture([]), false); assert.equal(result.state, "evidence_required"); assert.equal(result.structureState, "absent");
  assert.equal(result.statements.length, 8); assert.equal(result.executionEligibility, "evidence_required");
  assert.deepEqual(result.objectEvidence.blockers, ["target_trigger_fk_check_partition_evidence_missing"]);
  assert.ok(result.remainingGates.some(text => text.includes("not atomic DDL snapshots")));
});
test("accepts an eight-table subset of a synthetic 52-table R2-shaped receipt, never trusts simplified plannerSnapshot", () => {
  const receipt = fixture();
  for (let i = 0; i < 44; i++) { const name = `synthetic_unrelated_${i}`; receipt.tableNames.push(name); receipt.observation.absent.push({ tableName: name, confirmation: "ER_NO_SUCH_TABLE", errno: 1146 }); }
  receipt.plannerSnapshot = { complete: false, tables: [] }; seal(receipt);
  assert.equal(receipt.tableNames.length, 52); assert.equal(plan(receipt).state, "compatible");
});
test("source changes, alternate filenames and duplicates cannot become new reviewed DDL", () => {
  for (const mutate of [files => { files[0].sql += "\n"; }, files => { files[1].fileName = "new.sql"; }, files => { files[2] = files[1]; }]) {
    const changed = clone(sources); mutate(changed); assert.throws(() => deriveAiFeatureTargetDefinitions(changed), AiFeatureTargetSchemaError);
  }
});
test("input objects cannot execute hooks/getters or hide undefined/sparse content during hashing", () => {
  let called = false; const receipt = fixture(); Object.defineProperty(receipt, "trap", { enumerable: true, get() { called = true; return 1; } });
  expectError(() => plan(receipt, false), "INPUT_JSON"); assert.equal(called, false);
  for (const value of [undefined, new Date(), () => 1, NaN, new Array(1)]) { const changed = fixture(); changed.untrusted = value; assert.throws(() => plan(changed, false), AiFeatureTargetSchemaError); }
});
for (const [label, mutate, code] of [
  ["wrong connected database", r => { r.observation.identity.schemaName = "another"; }, "DATABASE_IDENTITY"],
  ["wrong receipt database", r => { r.database = "another"; }, "METADATA_INCOMPLETE"],
  ["non-MySQL engine", r => { r.observation.identity.version = "10.11.4-MariaDB"; }, "DATABASE_IDENTITY"],
  ["case-folded table platform", r => { r.observation.identity.lowerCaseTableNames = 1; }, "DATABASE_IDENTITY"],
  ["non-strict SQL mode", r => { r.observation.identity.sqlMode = ""; }, "DATABASE_IDENTITY"],
  ["partial capture", r => { r.complete = false; }, "METADATA_INCOMPLETE"],
  ["unstable capture", r => { r.stable = false; }, "METADATA_INCOMPLETE"],
  ["ledger reading differs from metadata-only contract", r => { r.migrationLedgerRead = true; }, "METADATA_INCOMPLETE"],
  ["cleanup failed", r => { r.cleanupError = { code: "ROLLBACK_FAILED" }; }, "METADATA_INCOMPLETE"],
  ["missing table from requested coverage", r => { r.tableNames.pop(); }, "TABLE_COVERAGE"],
  ["duplicate requested table", r => { r.tableNames.push(CONFIG); }, "TABLE_COVERAGE"],
  ["absence not explicitly probed", r => { r.observation.absent[0].errno = 1142; }, "METADATA_COVERAGE"],
  ["unobserved target", r => { r.observation.absent.pop(); }, "METADATA_COVERAGE"],
  ["orphan column for absent table", r => { r.observation.metadata.columns.push({ tableName: CONFIG }); }, "METADATA_COVERAGE"],
]) test(`refuses ${label}`, () => { const receipt = fixture([]); mutate(receipt); seal(receipt); expectError(() => plan(receipt, false), code); });
test("tampered or stale hashes and row counts fail without candidates", () => {
  const receipt = fixture(); receipt.observation.metadata.columns[0].columnType = "int unsigned";
  expectError(() => plan(receipt, false), "METADATA_HASH_CHANGED");
  for (const mutate of [r => { r.counts.columns--; }, r => { r.observation.metadataBudgets.columns.rowCount--; r.hashes = [hash(r.observation), hash(r.observation)]; }]) {
    const changed = fixture(); mutate(changed); expectError(() => plan(changed, false), "METADATA_COUNT");
  }
});
for (const [label, mutate] of [
  ["unsigned id", row => Object.assign(row, textField("columnType", "int unsigned"))],
  ["missing auto increment", row => { row.extra = ""; }],
  ["non-null numeric default", row => Object.assign(row, textField("columnDefault", "0"))],
  ["missing default evidence", row => { delete row.columnDefault; }],
  ["generated expression", row => Object.assign(row, textField("generationExpression", "1 + 2"))],
  ["default byte mismatch", row => { row.columnDefaultBytes = 0; }],
  ["type byte mismatch", row => { row.columnTypeBytes++; }],
]) test(`existing table refuses ${label}`, () => conflict(raw => mutate(raw.columns.find(row => row.tableName === TURNS && row.columnName === "id")))) ;
for (const [label, mutate] of [
  ["MyISAM", row => { row.engine = "MyISAM"; }],
  ["VIEW", row => { row.tableType = "VIEW"; }],
  ["case-insensitive collation", row => { row.collationName = "utf8mb4_unicode_ci"; }],
  ["partition table option", row => { row.createOptions = "partitioned"; }],
]) test(`existing table refuses ${label}`, () => conflict(raw => mutate(raw.tables.find(row => row.tableName === TURNS)), TURNS, "table_storage_or_options"));
test("unknown nullable/generated columns still conflict: exact private schema is not extended silently", () => {
  conflict(raw => raw.columns.push({ ...raw.columns.find(row => row.tableName === TURNS), columnName: "unexpected", ordinalPosition: 30, isNullable: "YES" }));
});
test("all nullable canceled conversation and profit tombstone fields remain nullable", () => {
  const mandatoryNullable = {
    [TURNS]: ["sequence", "expected_thread_version", "request_hash", "snapshot_hash", "mode", "request_snapshot", "configuration_snapshot", "runtime_snapshot"],
    [RUNS]: ["request_hash", "snapshot_hash", "request_snapshot", "snapshot", "dispatch_receipt", "result_snapshot", "result_hash"],
    [SAVES]: ["run_operation_id", "request_hash", "request_snapshot", "report_version", "result_hash", "saved_at"],
  };
  for (const [tableName, names] of Object.entries(mandatoryNullable)) for (const name of names) {
    assert.equal(definitions.find(item => item.name === tableName).columns.find(column => column.name === name).nullable, true);
    conflict(raw => { raw.columns.find(row => row.tableName === tableName && row.columnName === name).isNullable = "NO"; }, tableName);
  }
});
test("enum order, unknown states, widths, timestamp precision and column collation cannot drift", () => {
  for (const [name, patch] of [
    ["state", textField("columnType", "enum('queued','failed')")], ["mode", textField("columnType", "enum('coach','work')")],
    ["operation_id", { characterMaximumLength: 35 }], ["operation_id", { collationName: "utf8mb4_general_ci" }],
    ["created_at", { datetimePrecision: 6 }], ["created_at", { ...textField("columnType", "timestamp"), dataType: "timestamp" }],
    ["created_at", { extra: "DEFAULT_GENERATED", ...textField("columnDefault", "CURRENT_TIMESTAMP(3)") }],
  ]) conflict(raw => Object.assign(raw.columns.find(row => row.tableName === TURNS && row.columnName === name), patch));
});
test("0230 timestamp defaults and ON UPDATE exact semantics are required; native optional parentheses accepted", () => {
  const receipt = fixture();
  for (const row of receipt.observation.metadata.columns.filter(row => row.dataType === "timestamp")) {
    Object.assign(row, textField("columnDefault", "CURRENT_TIMESTAMP()")); if (row.columnName === "updatedAt") row.extra = "DEFAULT_GENERATED on update CURRENT_TIMESTAMP()";
  }
  seal(receipt); assert.equal(plan(receipt).state, "compatible");
  conflict(raw => { raw.columns.find(row => row.tableName === CONFIG && row.columnName === "updatedAt").extra = "DEFAULT_GENERATED"; }, CONFIG);
  conflict(raw => Object.assign(raw.columns.find(row => row.tableName === CONFIG && row.columnName === "createdAt"), textField("columnDefault", null)), CONFIG);
});
for (const [label, mutate, reason] of [
  ["prefix unique", row => { row.prefixLength = 8; }, "index_features_or_shape"],
  ["functional index", row => { row.columnName = null; Object.assign(row, textField("expression", "lower(operation_id)")); }, "index_features_or_shape"],
  ["invisible index", row => { row.visible = "NO"; }, "index_features_or_shape"],
  ["descending index", row => { row.direction = "D"; }, "index_features_or_shape"],
  ["non-BTREE index", row => { row.indexType = "HASH"; }, "index_features_or_shape"],
  ["duplicate sequence", row => { row.sequence = 2; }, "index_sequence_or_duplicates"],
]) test(`refuses ${label}`, () => conflict(raw => mutate(raw.indexes.find(row => row.tableName === TURNS && row.indexName === "uq_assistant_turn_operation")), TURNS, reason));
test("private run/report/save each retain their own complete owner-bound unique identity", () => {
  const wanted = {
    ops_profit_analysis_reports: ["workspace_id", "user_id", "scope_hash"],
    [RUNS]: ["workspace_id", "user_id", "operation_id"], [SAVES]: ["workspace_id", "user_id", "save_operation_id"],
  };
  for (const [name, fields] of Object.entries(wanted)) {
    assert.ok(definitions.find(item => item.name === name).indexes.some(index => index.unique && JSON.stringify(index.columns) === JSON.stringify(fields)));
    conflict(raw => { raw.indexes = raw.indexes.filter(row => !(row.tableName === name && row.columnName === "user_id")); }, name, "required_complete_index_missing");
  }
});
test("extra uniqueness refuses but ordinary nonunique indexes and equivalent renamed indexes are harmless", () => {
  conflict(raw => raw.indexes.push({ ...raw.indexes.find(row => row.tableName === TURNS && row.indexName === "PRIMARY"), indexName: "unreviewed_unique", columnName: "thread_id" }), TURNS, "extra_uniqueness");
  const receipt = fixture();
  const row = receipt.observation.metadata.indexes.find(item => item.tableName === TURNS && item.indexName === "PRIMARY");
  receipt.observation.metadata.indexes.push({ ...row, indexName: "extra_nonunique", nonUnique: 1 });
  for (const index of receipt.observation.metadata.indexes) if (index.indexName === "uq_profit_save_operation") index.indexName = "renamed_same_scope";
  seal(receipt); assert.equal(plan(receipt).state, "compatible");
});
test("conflicting existing table never receives ALTER but independent absent proposals remain visible", () => {
  const receipt = fixture([CONFIG]); receipt.observation.metadata.tables[0].engine = "MyISAM"; seal(receipt);
  const result = plan(receipt); assert.equal(result.state, "conflict"); assert.equal(result.statements.length, 7);
  assert.ok(result.statements.every(item => item.tableName !== CONFIG)); assert.equal(result.executionEligibility, "conflict");
});
for (const kind of ["triggers", "foreignKeys", "checks", "partitions"]) test(`observed ${kind} block execution eligibility without changing or suppressing source proposals`, () => {
  const receipt = fixture([]), objects = objectFacts(receipt);
  objects[kind].push(kind === "foreignKeys" ? { tableName: "other_table", referencedTableName: CONFIG } : { tableName: CONFIG });
  const result = planAiFeatureTargetSchema({ metadataReceipt: receipt, sources, objectEvidence: objects });
  assert.equal(result.state, "conflict"); assert.equal(result.statements.length, 8); assert.equal(result.executable, false);
});
test("object evidence cannot use booleans, unrelated hashes, missing coverage or outbound-only FK claims", () => {
  const receipt = fixture();
  for (const mutate of [object => { object.complete = false; }, object => { object.metadataObservationSha256 = "0".repeat(64); }, object => { object.coverage.foreignKeys = "outbound_only"; }, object => { object.tableNames.pop(); }]) {
    const objects = objectFacts(receipt); mutate(objects);
    expectError(() => planAiFeatureTargetSchema({ metadataReceipt: receipt, sources, objectEvidence: objects }), "OBJECT_EVIDENCE_INCOMPLETE");
  }
  expectError(() => planAiFeatureTargetSchema({ metadataReceipt: receipt, sources, objectEvidence: true }), "OBJECT_EVIDENCE_INCOMPLETE");
});
test("input metadata is not mutated by index sorting or planning", () => {
  const receipt = fixture(), before = JSON.stringify(receipt); plan(receipt); assert.equal(JSON.stringify(receipt), before);
});
