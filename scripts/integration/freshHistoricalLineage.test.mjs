// Static source reads and in-memory doubles only: do not import the migration
// runner, open a database, execute SQL or change the production release policy.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALTERNATIVES, CHOSEN, CHOSEN_SHA256, FRESH_PLAN_SHA256,
  selectFreshLineage, validatePostconditions, checkPostconditions,
} from "./freshHistoricalLineage.mjs";
import { GENERAL_PLAN_SHA256, validateGeneralPlan } from "./mysqlRehearsal.mjs";
import { parseLiteralRegistry } from "./migrationInventory.mjs";
import { parseArguments } from "./historicalPrerequisiteRehearsal.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
const code = expected => error => error.code === expected;
const clone = value => structuredClone(value);
const expectedAlternatives = [
  "0191_parent_asin_weekly_mcp_source_forward_repair.sql",
  "0192_parent_asin_weekly_source_columns_forward_repair.sql",
  "0193_parent_asin_weekly_mcp_control_plane_forward_repair.sql",
];
const chosenName = "0190_parent_asin_weekly_mcp_source.sql";
const chosenHash = "18649e7c2c0f1e35a075713406497590c0cdf8e3ec3aacb5bc4d01091e7f95b0";
const freshHash = "e38996cfd68b5b1f65bd9ea2a7ce2428d81006fb150ebe818be5dd5fcb372a8a";

function checkedInPlan() {
  const runnerSource = fs.readFileSync(path.join(repo, "scripts/run-database-migrations.mjs"), "utf8");
  const journal = JSON.parse(fs.readFileSync(path.join(repo, "drizzle/meta/_journal.json"), "utf8"));
  const names = [...journal.entries.map(entry => `${entry.tag}.sql`), ...parseLiteralRegistry(runnerSource, "supplementalMigrations", true)];
  return names.map(fileName => {
    const sql = fs.readFileSync(path.join(repo, "drizzle", fileName), "utf8");
    return { fileName, sql, checksum: hash(sql) };
  });
}

function fixture() {
  return {
    ledger: new Map([[CHOSEN, { migrationName: CHOSEN, checksum: CHOSEN_SHA256, status: "succeeded" }]]),
    columns: [
      { columnName: "user_id", columnType: "int", isNullable: "YES", columnDefault: null, ordinalPosition: 6 },
      { columnName: "source_kind", columnType: "varchar(48)", isNullable: "NO", columnDefault: "uploaded_parent_asin_weekly", ordinalPosition: 7 },
      { columnName: "source_batch_id", columnType: "int", isNullable: "YES", columnDefault: null, ordinalPosition: 8 },
      { columnName: "source_trace_id", columnType: "varchar(128)", isNullable: "YES", columnDefault: null, ordinalPosition: 9 },
      { columnName: "source_schema_version", columnType: "varchar(32)", isNullable: "YES", columnDefault: null, ordinalPosition: 10 },
    ],
    indexes: [
      ["lingxing_product_weekly_source_batch_idx", ["workspaceId", "source_batch_id"]],
      ["lingxing_product_weekly_source_period_idx", ["workspaceId", "source_kind", "week_start_date", "week_end_date"]],
    ].flatMap(([indexName, names]) => names.map((columnName, index) => ({ indexName, columnName, seqInIndex: index + 1,
      nonUnique: 1, subPart: null, indexType: "BTREE", isVisible: "YES", collation: "A" }))),
  };
}

const verify = state => validatePostconditions(state.ledger, state.columns, state.indexes);

test("helper import stays inert despite a forbidden inherited database URL", () => {
  const url = new URL("./freshHistoricalLineage.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)}); console.log('IMPORT_SAFE')`],
    { encoding: "utf8", env: { PATH: "/usr/bin:/bin", DATABASE_URL: "must-not-load-or-connect" }, timeout: 10_000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, "IMPORT_SAFE\n"); assert.equal(result.stderr, "");
});

test("immutable source pins select exactly 165 of the original 168 items with three exact exclusions", () => {
  assert.equal(CHOSEN, chosenName); assert.equal(CHOSEN_SHA256, chosenHash); assert.equal(FRESH_PLAN_SHA256, freshHash);
  assert.deepEqual(ALTERNATIVES, expectedAlternatives); assert.ok(Object.isFrozen(ALTERNATIVES));
  const original = checkedInPlan(), before = clone(original);
  assert.equal(original.length, 168); assert.equal(validateGeneralPlan(original), GENERAL_PLAN_SHA256);
  const result = selectFreshLineage(original);
  assert.equal(result.count, 165); assert.equal(result.sha256, freshHash);
  assert.equal(hash(JSON.stringify(result.plan.map(item => [item.fileName, item.checksum]))), freshHash);
  assert.deepEqual(result.plan, original.filter(item => !expectedAlternatives.includes(item.fileName)));
  assert.deepEqual(result.excluded, expectedAlternatives.map(migrationName => ({ migrationName,
    checksum: original.find(item => item.fileName === migrationName).checksum,
    reason: "alternative_repair_after_0190_success_not_executed_not_ledgered" })));
  assert.equal(result.plan.filter(item => item.fileName === chosenName).length, 1);
  assert.deepEqual(original, before, "Selection must not rewrite source SQL or alter the input list");
});

test("0190 and both combined repair alternatives have identical complete trimmed DML tails", () => {
  const original = checkedInPlan();
  const marker = "UPDATE `ops_lingxing_sync_schedules`";
  const chosen = original.find(item => item.fileName === chosenName);
  const tail = sql => { assert.ok(sql.includes(marker)); return sql.slice(sql.indexOf(marker)).trim(); };
  for (const name of [expectedAlternatives[0], expectedAlternatives[2]]) {
    const alternative = original.find(item => item.fileName === name);
    assert.equal(tail(alternative.sql), tail(chosen.sql));
    assert.equal(hash(tail(alternative.sql)), hash(tail(chosen.sql)));
  }
});

test("source checksum drift, recomputed source drift and reordered lineage all fail closed", () => {
  for (const fileName of [chosenName, ...expectedAlternatives]) {
    const brokenChecksum = checkedInPlan();
    brokenChecksum.find(item => item.fileName === fileName).sql += "\n-- changed source\n";
    assert.throws(() => selectFreshLineage(brokenChecksum), code("PLAN_CHECKSUM_MISMATCH"));
    const changedSource = checkedInPlan(), item = changedSource.find(item => item.fileName === fileName);
    item.sql += "\n-- changed source\n"; item.checksum = hash(item.sql);
    assert.throws(() => selectFreshLineage(changedSource), code("GENERAL_PLAN_SNAPSHOT_CHANGED"));
  }
  const reordered = checkedInPlan(); [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => selectFreshLineage(reordered), code("GENERAL_PLAN_SNAPSHOT_CHANGED"));
});

test("missing entries, additional exclusions, extra migrations and duplicates cannot change the reviewed plan", () => {
  const original = checkedInPlan();
  for (const shortened of [original.slice(1), original.filter(item => !expectedAlternatives.includes(item.fileName)),
    original.filter(item => ![...expectedAlternatives, "0194_parent_asin_weekly_mcp_auto_apply.sql"].includes(item.fileName))]) {
    assert.throws(() => selectFreshLineage(shortened), code("GENERAL_PLAN_COUNT_CHANGED"));
  }
  assert.throws(() => selectFreshLineage([...original, { fileName: "9999_extra.sql", sql: "SELECT 1;", checksum: hash("SELECT 1;") }]), code("GENERAL_PLAN_COUNT_CHANGED"));
  const duplicated = [...original]; duplicated[1] = duplicated[0];
  assert.throws(() => selectFreshLineage(duplicated), code("DUPLICATE_GENERAL_MIGRATION"));
});

test("exact postconditions accept the four columns, both ordered nonunique full-column BTREE indexes and succeeded ledger", () => {
  const state = fixture();
  assert.deepEqual(verify(state), { chosenMigration: CHOSEN, exactSucceededChecksum: true, columnContracts: 4, indexContracts: 2,
    alternativeLedgerRows: 0, dataUpdateProof: "identical_source_DML_not_production_business_row_validation" });
  const unordered = fixture(); unordered.columns.reverse(); unordered.indexes.reverse();
  for (const column of unordered.columns) column.ordinalPosition = String(column.ordinalPosition);
  for (const index of unordered.indexes) { index.seqInIndex = String(index.seqInIndex); index.nonUnique = "1"; }
  assert.deepEqual(verify(unordered), verify(state), "Driver ordering and numeric strings do not change metadata semantics");
});

test("postconditions reject absent 0190, wrong checksum and all nonsucceeded ledger states", () => {
  const missing = fixture(); missing.ledger.delete(CHOSEN);
  assert.throws(() => verify(missing), code("CHOSEN_LINEAGE_NOT_EXACT_SUCCEEDED"));
  for (const patch of [{ checksum: hash("changed") }, { checksum: undefined },
    ...["baselined", "failed", "started", "running", "SUCCEEDED", null, undefined].map(status => ({ status }))]) {
    const state = fixture(); Object.assign(state.ledger.get(CHOSEN), patch);
    assert.throws(() => verify(state), code("CHOSEN_LINEAGE_NOT_EXACT_SUCCEEDED"));
  }
});

test("any ledger row for any of the three alternative repairs is forbidden, regardless of status", () => {
  for (const name of expectedAlternatives) for (const status of ["succeeded", "failed", "baselined", "started", undefined]) {
    const state = fixture(); state.ledger.set(name, { checksum: hash(name), status });
    assert.throws(() => verify(state), code("ALTERNATIVE_LINEAGE_ALREADY_LEDGERED"));
  }
});

test("postconditions reject incomplete, extra, duplicate or renamed columns and invalid anchor positions", () => {
  for (const update of [state => state.columns.pop(), state => state.columns.push({ ...state.columns[0], columnName: "extra" }),
    state => state.columns[4] = clone(state.columns[3])]) {
    const state = fixture(); update(state);
    assert.throws(() => verify(state), code("LINEAGE_COLUMNS_INVALID"));
  }
  for (const position of [0, -1, 1.5, "unknown", undefined, null]) {
    const state = fixture(); state.columns[0].ordinalPosition = position;
    assert.throws(() => verify(state), code("LINEAGE_COLUMN_ANCHOR_INVALID"));
  }
  const missingAnchor = fixture(); missingAnchor.columns[0].columnName = "other_anchor";
  assert.throws(() => verify(missingAnchor), code("LINEAGE_COLUMN_ANCHOR_INVALID"));
});

test("every source column enforces exact name, type, default, nullability and position immediately after user_id", () => {
  for (let index = 1; index <= 4; index++) {
    for (const patch of [{ columnName: "other_source_column" }, { columnType: "bigint" }, { columnType: "varchar(128) unsigned" },
      { isNullable: index === 1 ? "YES" : "NO" }, { columnDefault: index === 1 ? null : "unexpected" },
      { columnDefault: undefined }, { ordinalPosition: 0 }, { ordinalPosition: 20 }, { ordinalPosition: "invalid" }]) {
      const state = fixture(); Object.assign(state.columns[index], patch);
      assert.throws(() => verify(state), code("LINEAGE_COLUMN_CONTRACT_MISMATCH"));
    }
  }
  const reversed = fixture(); [reversed.columns[1].ordinalPosition, reversed.columns[2].ordinalPosition] = [8, 7];
  assert.throws(() => verify(reversed), code("LINEAGE_COLUMN_CONTRACT_MISMATCH"));
});

test("both indexes require exactly all six entries, correct name/order, nonunique and no prefix", () => {
  for (const update of [state => state.indexes.pop(), state => state.indexes.push(clone(state.indexes[0]))]) {
    const state = fixture(); update(state);
    assert.throws(() => verify(state), code("LINEAGE_INDEX_COUNT_MISMATCH"));
  }
  for (let index = 0; index < 6; index++) {
    for (const patch of [{ indexName: "other_index" }, { columnName: "other_column" }, { seqInIndex: 0 }, { seqInIndex: 9 },
      { nonUnique: 0 }, { nonUnique: null }, { subPart: 191 }, { subPart: 0 }, { subPart: undefined },
      { indexType: "HASH" }, { indexType: undefined }, { isVisible: "NO" }, { isVisible: undefined },
      { collation: "D" }, { collation: null }]) {
      const state = fixture(); Object.assign(state.indexes[index], patch);
      assert.throws(() => verify(state), code("LINEAGE_INDEX_CONTRACT_MISMATCH"));
    }
  }
  for (const offset of [0, 2]) {
    const state = fixture();
    [state.indexes[offset].columnName, state.indexes[offset + 1].columnName] = [state.indexes[offset + 1].columnName, state.indexes[offset].columnName];
    assert.throws(() => verify(state), code("LINEAGE_INDEX_CONTRACT_MISMATCH"));
    const duplicate = fixture(); duplicate.indexes[offset + 1] = clone(duplicate.indexes[offset]);
    assert.throws(() => verify(duplicate), code("LINEAGE_INDEX_CONTRACT_MISMATCH"));
  }
});

test("mocked checkPostconditions reads only current-schema metadata and requires all three evidence sources", async () => {
  for (const failAt of [null, "ledger", "columns", "indexes"]) {
    const state = fixture(), calls = [];
    if (failAt === "ledger") state.ledger.clear();
    if (failAt === "columns") state.columns = [];
    if (failAt === "indexes") state.indexes = [];
    const connection = { async query(sql) {
      calls.push(sql); assert.match(sql, /^SELECT /); assert.match(sql, /table_schema=DATABASE\(\)/);
      assert.match(sql, /table_name='lingxing_product_weekly'/); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|ALTER|CREATE|DROP|USE)\b/);
      if (sql.includes("FROM information_schema.columns")) return [state.columns];
      if (sql.includes("FROM information_schema.statistics")) return [state.indexes];
      assert.fail("Unexpected metadata query");
    } };
    const runner = { async readLedger(actual) { assert.equal(actual, connection); calls.push("readLedger"); return state.ledger; } };
    if (failAt) await assert.rejects(checkPostconditions(runner, connection));
    else assert.deepEqual(await checkPostconditions(runner, connection), verify(state));
    assert.equal(calls.length, 3); assert.equal(calls[0], "readLedger");
  }
});

test("default arguments preserve the original 168-item branch; explicit fresh flag is opt-in and cannot repeat", () => {
  const root = "/private/tmp/amazon-mysql8-rehearsal.lineage-test";
  const args = ["--execute-local", "--root", root, "--socket", `${root}/mysql.sock`, "--datadir", `${root}/data`,
    "--bindir", `${root}/mysql-8.4.11-macos15-arm64/bin`, "--output", path.join(repo, "artifacts/lineage-test.json")];
  assert.equal(parseArguments(args).freshReviewedLineage, false);
  assert.equal(parseArguments([...args, "--fresh-reviewed-lineage"]).freshReviewedLineage, true);
  assert.throws(() => parseArguments([...args, "--fresh-reviewed-lineage", "--fresh-reviewed-lineage"]), code("DUPLICATE_LINEAGE_FLAG"));
  assert.throws(() => parseArguments(["--fresh-reviewed-lineage"]), code("EXPLICIT_LOCAL_ARGUMENTS_REQUIRED"));
  const source = fs.readFileSync(path.join(repo, "scripts/integration/historicalPrerequisiteRehearsal.mjs"), "utf8");
  assert.match(source, /const lineage = options\.freshReviewedLineage === true \? selectFreshLineage\(sourcePlan\) : undefined/);
  assert.match(source, /const plan = lineage\?\.plan \?\? sourcePlan/);
  assert.equal(checkedInPlan().length, 168);
});
