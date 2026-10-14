// Only consumed by the disposable-local rehearsal. Never a production runner policy.
import { createHash } from "node:crypto";
import { validateGeneralPlan, GENERAL_PLAN_SHA256 } from "./mysqlRehearsal.mjs";
const digest = value => createHash("sha256").update(value).digest("hex");
const requireSafe = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
export const CHOSEN = "0190_parent_asin_weekly_mcp_source.sql";
export const CHOSEN_SHA256 = "18649e7c2c0f1e35a075713406497590c0cdf8e3ec3aacb5bc4d01091e7f95b0";
export const FRESH_PLAN_SHA256 = "e38996cfd68b5b1f65bd9ea2a7ce2428d81006fb150ebe818be5dd5fcb372a8a";
export const ALTERNATIVES = Object.freeze([
  "0191_parent_asin_weekly_mcp_source_forward_repair.sql",
  "0192_parent_asin_weekly_source_columns_forward_repair.sql",
  "0193_parent_asin_weekly_mcp_control_plane_forward_repair.sql",
]);

export function selectFreshLineage(sourcePlan) {
  requireSafe(validateGeneralPlan(sourcePlan) === GENERAL_PLAN_SHA256, "GENERAL_PLAN_SNAPSHOT_CHANGED");
  const chosen = sourcePlan.find(item => item.fileName === CHOSEN);
  requireSafe(chosen?.checksum === CHOSEN_SHA256, "CHOSEN_LINEAGE_SOURCE_CHANGED");
  const marker = "UPDATE `ops_lingxing_sync_schedules`";
  const tail = sql => sql.slice(sql.indexOf(marker)).trim();
  requireSafe(chosen.sql.includes(marker), "CHOSEN_LINEAGE_DML_MISSING");
  for (const name of [ALTERNATIVES[0], ALTERNATIVES[2]]) {
    const alternative = sourcePlan.find(item => item.fileName === name);
    requireSafe(alternative?.sql.includes(marker) && tail(alternative.sql) === tail(chosen.sql), "ALTERNATIVE_HAS_DIFFERENT_DML");
  }
  const plan = sourcePlan.filter(item => !ALTERNATIVES.includes(item.fileName));
  requireSafe(plan.length === 165 && digest(JSON.stringify(plan.map(item => [item.fileName, item.checksum]))) === FRESH_PLAN_SHA256,
    "FRESH_LINEAGE_PLAN_CHANGED");
  return { plan, count: plan.length, sha256: FRESH_PLAN_SHA256,
    excluded: ALTERNATIVES.map(name => ({ migrationName: name, checksum: sourcePlan.find(item => item.fileName === name).checksum,
      reason: "alternative_repair_after_0190_success_not_executed_not_ledgered" })) };
}

export function validatePostconditions(ledger, columns, indexes) {
  const chosen = ledger.get(CHOSEN);
  requireSafe(chosen?.checksum === CHOSEN_SHA256 && chosen.status === "succeeded", "CHOSEN_LINEAGE_NOT_EXACT_SUCCEEDED");
  requireSafe(ALTERNATIVES.every(name => !ledger.has(name)), "ALTERNATIVE_LINEAGE_ALREADY_LEDGERED");
  const expected = [
    ["source_kind", "varchar(48)", "NO", "uploaded_parent_asin_weekly"],
    ["source_batch_id", "int", "YES", null],
    ["source_trace_id", "varchar(128)", "YES", null],
    ["source_schema_version", "varchar(32)", "YES", null],
  ];
  requireSafe(columns.length === 5 && new Set(columns.map(row => row.columnName)).size === 5, "LINEAGE_COLUMNS_INVALID");
  const byName = new Map(columns.map(row => [row.columnName, row]));
  const start = Number(byName.get("user_id")?.ordinalPosition);
  requireSafe(Number.isInteger(start) && start > 0, "LINEAGE_COLUMN_ANCHOR_INVALID");
  for (const [offset, [name, type, nullable, defaultValue]] of expected.entries()) {
    const column = byName.get(name);
    requireSafe(column && column.columnType === type && column.isNullable === nullable
      && column.columnDefault === defaultValue && Number(column.ordinalPosition) === start + offset + 1,
    "LINEAGE_COLUMN_CONTRACT_MISMATCH");
  }
  const expectedIndexes = [
    ["lingxing_product_weekly_source_batch_idx", ["workspaceId", "source_batch_id"]],
    ["lingxing_product_weekly_source_period_idx", ["workspaceId", "source_kind", "week_start_date", "week_end_date"]],
  ];
  requireSafe(indexes.length === 6, "LINEAGE_INDEX_COUNT_MISMATCH");
  for (const [name, names] of expectedIndexes) {
    const entries = indexes.filter(row => row.indexName === name).sort((a, b) => Number(a.seqInIndex) - Number(b.seqInIndex));
    requireSafe(entries.length === names.length && entries.every((row, index) => row.columnName === names[index]
      && Number(row.seqInIndex) === index + 1 && Number(row.nonUnique) === 1 && row.subPart === null && row.indexType === "BTREE"
      && row.isVisible === "YES" && row.collation === "A"),
    "LINEAGE_INDEX_CONTRACT_MISMATCH");
  }
  return { chosenMigration: CHOSEN, exactSucceededChecksum: true, columnContracts: 4, indexContracts: 2,
    alternativeLedgerRows: 0, dataUpdateProof: "identical_source_DML_not_production_business_row_validation" };
}

export async function checkPostconditions(runner, connection) {
  const ledger = await runner.readLedger(connection);
  const [columns] = await connection.query("SELECT column_name AS columnName,column_type AS columnType,is_nullable AS isNullable,column_default AS columnDefault,ordinal_position AS ordinalPosition FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lingxing_product_weekly' AND column_name IN ('user_id','source_kind','source_batch_id','source_trace_id','source_schema_version')");
  const [indexes] = await connection.query("SELECT index_name AS indexName,column_name AS columnName,seq_in_index AS seqInIndex,non_unique AS nonUnique,sub_part AS subPart,index_type AS indexType,is_visible AS isVisible,collation AS collation FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='lingxing_product_weekly' AND index_name IN ('lingxing_product_weekly_source_period_idx','lingxing_product_weekly_source_batch_idx')");
  return validatePostconditions(ledger, columns, indexes);
}
