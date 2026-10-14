// Pure, narrow assessment of the observed existing lineage. No file/environment
// reads, database access, ledger writes, SQL execution or migration-runner import.
// The caller supplies any sensitive catalog/approval from PRIVATE storage and
// verifies its provenance. This function never publishes the catalog or proves
// that a historical migration ran, and its result is not execution permission.
import { fingerprint, insist, validateCatalog } from "./freshBootstrapPlan.mjs";

export const EXISTING_LINEAGE_VERSION = "amazon-existing-lineage-admission/1";
export const ADOPTION_VERSION = "amazon-existing-lineage-structural-adoption/1";
export const GENERAL_PLAN_SHA256 = "084b92aaec180ba8110801b5cee4c68355eba56a2f01c028e3ed72cde8e67614";
export const ADOPTABLE_MIGRATION = Object.freeze({
  fileName: "0059_ops_ad_mcp_facts.sql",
  checksum: "5f0b2b40f2cfaddc0a5d4156376ea89d274c7ce3c790cc97c651dd5196af1008",
});
export const ADOPTION_TABLES = Object.freeze([
  "ops_ad_mcp_campaign_daily_facts", "ops_ad_mcp_fact_revisions",
  "ops_ad_mcp_product_daily_facts", "ops_ad_mcp_profiles",
]);

const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exactKeys = (object, keys) => object && typeof object === "object" && !Array.isArray(object)
  && JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());
const migrationName = value => typeof value === "string" && value.length <= 255
  && /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*\.sql$/.test(value)
  && value.split("/").every(part => part !== "." && part !== "..");

function checkGeneralPlan(plan) {
  insist(Array.isArray(plan) && plan.length === 168 && plan.every(item => item
    && migrationName(item.fileName) && hash(item.checksum))
    && new Set(plan.map(item => item.fileName)).size === 168, "EXISTING_GENERAL_PLAN_INVALID");
  insist(fingerprint(plan.map(item => [item.fileName, item.checksum])) === GENERAL_PLAN_SHA256,
    "EXISTING_GENERAL_PLAN_CHANGED");
  const migration = plan.find(item => item.fileName === ADOPTABLE_MIGRATION.fileName);
  insist(migration?.checksum === ADOPTABLE_MIGRATION.checksum, "EXISTING_ADOPTABLE_MIGRATION_CHANGED");
  return new Map(plan.map(item => [item.fileName, item.checksum]));
}

function checkLedger(snapshot, plan) {
  insist(exactKeys(snapshot, ["present", "rows"]) && snapshot.present === true
    && Array.isArray(snapshot.rows) && snapshot.rows.length <= 100_000, "EXISTING_LEDGER_SNAPSHOT_INVALID");
  const seen = new Set(), rows = [], unmanaged = [];
  for (const row of snapshot.rows) {
    insist(exactKeys(row, ["migrationName", "checksum", "status"]) && migrationName(row.migrationName)
      && hash(row.checksum) && !seen.has(row.migrationName), "EXISTING_LEDGER_ROW_INVALID");
    insist(row.status === "succeeded" || row.status === "baselined", "EXISTING_LEDGER_STATUS_REFUSED");
    seen.add(row.migrationName); rows.push({ ...row });
    if (plan.has(row.migrationName)) insist(row.checksum === plan.get(row.migrationName), "EXISTING_LEDGER_CHECKSUM_MISMATCH");
    else unmanaged.push({ ...row, observationOnly: true, historicalExecutionProven: false, admittedForReplay: false });
  }
  const missing = [...plan.keys()].filter(name => !seen.has(name));
  insist(missing.length === 1 && missing[0] === ADOPTABLE_MIGRATION.fileName, "EXISTING_EXPECTED_SINGLE_GAP_CHANGED");
  const order = (a, b) => a.migrationName < b.migrationName ? -1 : a.migrationName > b.migrationName ? 1 : 0;
  rows.sort(order); unmanaged.sort(order);
  return { sha256: fingerprint({ present: true, rows }), unmanaged };
}

function scopeCatalog(catalog, exactScope) {
  // Validate the complete supplied catalog before selecting tables; do not hide
  // malformed collections/fields or silently discard executable object rows.
  insist(catalog && Array.isArray(catalog.tables), "EXISTING_CATALOG_INVALID");
  const names = catalog.tables.map(item => item?.tableName), targets = new Set(ADOPTION_TABLES);
  if (exactScope) insist(JSON.stringify([...names].sort()) === JSON.stringify(ADOPTION_TABLES), "EXISTING_CONTRACT_TABLE_SCOPE_CHANGED");
  // Inputs must contain actual counters, not the normalization sentinel. Only
  // validateCatalog's output may contain that sentinel. Column extra survives.
  for (const table of catalog.tables) insist(table && (table.autoIncrement === null
    || (typeof table.autoIncrement === "string" || typeof table.autoIncrement === "number")
      && /^[1-9][0-9]*$/.test(String(table.autoIncrement))), "EXISTING_CATALOG_COUNTER_INVALID");
  const checked = validateCatalog(catalog, names);
  insist(ADOPTION_TABLES.every(name => names.includes(name)), "EXISTING_ADOPTION_TABLE_MISSING");
  // An incoming or outgoing FK crossing this four-table boundary requires an
  // explicitly reviewed wider contract, not implicit adoption of a dependency.
  for (const row of checked.foreignKeys) insist(targets.has(row.tableName) === targets.has(row.referencedTableName),
    "EXISTING_CROSS_SCOPE_FOREIGN_KEY");
  for (const row of checked.keyColumns) if (row.referencedTableName !== null)
    insist(targets.has(row.tableName) === targets.has(row.referencedTableName), "EXISTING_CROSS_SCOPE_FOREIGN_KEY");
  const scoped = Object.fromEntries(Object.entries(checked).map(([collection, rows]) => [collection,
    rows.filter(row => !Object.hasOwn(row, "tableName") || targets.has(row.tableName))]));
  return validateCatalog(scoped, ADOPTION_TABLES);
}

/**
 * generalPlan: ordered {fileName,checksum,...} entries for the unchanged 168 plan.
 * ledgerSnapshot: {present:true,rows:[{migrationName,checksum,status}]} (all rows).
 * currentCatalog: all 13 DDL_CATALOG collections, with original positive counters.
 * adoption: null, or an explicit private approval with the exact shape below.
 * structureContract.catalog contains exactly the four tables and all 13 arrays;
 * sha256 is fingerprint(validateCatalog(catalog, ADOPTION_TABLES)). No raw schema
 * values are returned, even when the approval or structural comparison fails.
 */
export function assessExistingLineage({ generalPlan, ledgerSnapshot, currentCatalog, adoption = null }) {
  const plan = checkGeneralPlan(generalPlan), ledger = checkLedger(ledgerSnapshot, plan);
  const actual = scopeCatalog(currentCatalog, false), catalogSha256 = fingerprint(actual);
  const result = {
    version: EXISTING_LINEAGE_VERSION, status: "needs-adoption", evaluationOnly: true,
    deltaOnlyAdmitted: false, databaseExecutionAuthorized: false,
    generalRunnerReady: false, generalRunnerAdmitted: false, historicalExecutionProven: false,
    generalPlanSha256: GENERAL_PLAN_SHA256, generalPlanEntries: 168, matchingLedgerEntries: 167,
    ledgerSnapshotSha256: ledger.sha256, currentCatalogSha256: catalogSha256,
    missingExecutionProvenance: [ADOPTABLE_MIGRATION.fileName], unmanagedLedgerEntries: ledger.unmanaged,
    comparisonScope: { tables: [...ADOPTION_TABLES], catalogCollections: 13, nonTargetTablesCompared: false,
      normalization: ["schema-identity", "positive-next-auto-increment-counter-only"] },
  };
  if (adoption === null) return result;
  insist(exactKeys(adoption, ["version", "decision", "approved", "historicalExecutionProven", "generalRunnerAdmitted",
    "generalPlanSha256", "migration", "ledgerSnapshotSha256", "structureContract", "evidence"])
    && adoption.version === ADOPTION_VERSION && adoption.decision === "structural-adoption-for-delta-gate"
    && adoption.approved === true && adoption.historicalExecutionProven === false && adoption.generalRunnerAdmitted === false,
  "EXISTING_ADOPTION_NOT_APPROVED");
  insist(adoption.generalPlanSha256 === GENERAL_PLAN_SHA256
    && exactKeys(adoption.migration, ["fileName", "checksum"])
    && adoption.migration.fileName === ADOPTABLE_MIGRATION.fileName
    && adoption.migration.checksum === ADOPTABLE_MIGRATION.checksum, "EXISTING_ADOPTION_TARGET_CHANGED");
  insist(adoption.ledgerSnapshotSha256 === ledger.sha256, "EXISTING_ADOPTION_LEDGER_CHANGED");
  insist(exactKeys(adoption.evidence, ["artifactSha256", "exportReceiptSha256"])
    && hash(adoption.evidence.artifactSha256) && hash(adoption.evidence.exportReceiptSha256), "EXISTING_ADOPTION_EVIDENCE_INVALID");
  insist(exactKeys(adoption.structureContract, ["catalog", "sha256"])
    && hash(adoption.structureContract.sha256), "EXISTING_ADOPTION_CONTRACT_INVALID");
  const expected = scopeCatalog(adoption.structureContract.catalog, true);
  insist(fingerprint(expected) === adoption.structureContract.sha256, "EXISTING_ADOPTION_CONTRACT_HASH_MISMATCH");
  insist(catalogSha256 === adoption.structureContract.sha256, "EXISTING_ADOPTION_STRUCTURE_MISMATCH");
  return { ...result, status: "admitted", deltaOnlyAdmitted: true,
    adoptionSha256: fingerprint(adoption), structuralAdoption: { ...ADOPTABLE_MIGRATION },
    evidence: { ...adoption.evidence } };
}
