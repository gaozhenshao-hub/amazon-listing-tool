// Pure planning only. The caller must authenticate the frozen lineage approval,
// private source contract and rehearsal receipt bytes before supplying their pins.
// The planning function performs no IO, environment access, connection or execution.
// Shared validators are reused intact: their transitive CLI guards may check file
// identity with realpath when imported by a script, but do not enter their mains,
// read private contents/environment or connect to a database on this import path.
import { isDeepStrictEqual } from "node:util";
import { fingerprint, sha256, insist, validateCatalog } from "./freshBootstrapPlan.mjs";
import { EXISTING_LINEAGE_VERSION, GENERAL_PLAN_SHA256, ADOPTABLE_MIGRATION, ADOPTION_TABLES } from "./existingLineageAdmission.mjs";
import { CANDIDATE_SQL, COLUMN_CONTRACTS, TABLE_NAME } from "../integration/campaignNullabilityContract.mjs";

export const DELTA_PLAN_VERSION = "amazon-existing-delta-plan/1";
export const DELTA_DEFINITION = Object.freeze({
  version: "amazon-existing-delta-definition/1",
  deltaId: "integration/campaign-metrics-null-default-v1",
  sqlSha256: "5ef700e8633dc3ce638a42baf4d7df76c54ee00c393e2973ac90ba2cdaeaee75",
  defaultPolicy: "align-null-default",
});
export const REHEARSAL_EVIDENCE = Object.freeze({
  status: "completed",
  receiptSha256: "398ec2009c8499df39cc4345750f1f2f99a4f0bc95632ac06565716bc987c1f1",
  prerequisiteStructureReceiptSha256: "6feec1d564e76513a0ed855146961af57f754c0755c16acc3dd77c4ab974df58",
  artifactSha256: "ea0aa2020b2cce23da6dadc155afec38e6dd1f43f6603eb16aa5ee93f848f7d2",
  exportReceiptSha256: "6cb293cd6d083b55774bca13be77904527cd29d814c7021762e929c4c75315eb",
  candidateSha256: DELTA_DEFINITION.sqlSha256,
});

const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exactKeys = (object, keys) => object && typeof object === "object" && !Array.isArray(object)
  && isDeepStrictEqual(Object.keys(object).sort(), [...keys].sort());
const metricNames = new Set(COLUMN_CONTRACTS.map(column => column.name));
const targetNames = new Set(ADOPTION_TABLES);
const lineageKeys = ["version", "status", "evaluationOnly", "deltaOnlyAdmitted", "databaseExecutionAuthorized", "generalRunnerReady",
  "generalRunnerAdmitted", "historicalExecutionProven", "generalPlanSha256", "generalPlanEntries", "matchingLedgerEntries",
  "ledgerSnapshotSha256", "currentCatalogSha256", "missingExecutionProvenance", "unmanagedLedgerEntries", "comparisonScope",
  "adoptionSha256", "structuralAdoption", "evidence"];

function checkLineage(lineage, definition, evidence) {
  insist(exactKeys(definition, [...Object.keys(DELTA_DEFINITION), "lineageSha256", "sourceContractSha256"])
    && Object.entries(DELTA_DEFINITION).every(([key, value]) => definition[key] === value)
    && hash(definition.lineageSha256) && hash(definition.sourceContractSha256)
    && sha256(CANDIDATE_SQL) === DELTA_DEFINITION.sqlSha256, "DELTA_DEFINITION_CHANGED");
  insist(isDeepStrictEqual(evidence, REHEARSAL_EVIDENCE), "DELTA_REHEARSAL_EVIDENCE_CHANGED");
  insist(exactKeys(lineage, lineageKeys) && lineage.version === EXISTING_LINEAGE_VERSION && lineage.status === "admitted"
    && lineage.evaluationOnly === true && lineage.deltaOnlyAdmitted === true && lineage.databaseExecutionAuthorized === false
    && lineage.generalRunnerReady === false && lineage.generalRunnerAdmitted === false && lineage.historicalExecutionProven === false
    && lineage.generalPlanSha256 === GENERAL_PLAN_SHA256 && lineage.generalPlanEntries === 168 && lineage.matchingLedgerEntries === 167
    && hash(lineage.ledgerSnapshotSha256) && hash(lineage.currentCatalogSha256) && hash(lineage.adoptionSha256)
    && isDeepStrictEqual(lineage.structuralAdoption, ADOPTABLE_MIGRATION)
    && isDeepStrictEqual(lineage.missingExecutionProvenance, [ADOPTABLE_MIGRATION.fileName])
    && isDeepStrictEqual(lineage.comparisonScope, { tables: [...ADOPTION_TABLES], catalogCollections: 13, nonTargetTablesCompared: false,
      normalization: ["schema-identity", "positive-next-auto-increment-counter-only"] })
    && isDeepStrictEqual(lineage.evidence, { artifactSha256: evidence.artifactSha256, exportReceiptSha256: evidence.exportReceiptSha256 }),
  "DELTA_FROZEN_LINEAGE_NOT_ADMITTED");
  insist(Array.isArray(lineage.unmanagedLedgerEntries) && lineage.unmanagedLedgerEntries.every(row =>
    exactKeys(row, ["migrationName", "checksum", "status", "observationOnly", "historicalExecutionProven", "admittedForReplay"])
    && typeof row.migrationName === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/.test(row.migrationName)
    && row.migrationName.length <= 255 && hash(row.checksum) && ["succeeded", "baselined"].includes(row.status)
    && row.observationOnly === true && row.historicalExecutionProven === false && row.admittedForReplay === false)
    && new Set(lineage.unmanagedLedgerEntries.map(row => row.migrationName)).size === lineage.unmanagedLedgerEntries.length,
  "DELTA_LINEAGE_OBSERVATIONS_INVALID");
  insist(fingerprint(lineage) === definition.lineageSha256
    && lineage.currentCatalogSha256 === definition.sourceContractSha256, "DELTA_FROZEN_LINEAGE_HASH_MISMATCH");
}

function normalizeInput(catalog, names) {
  insist(catalog && Array.isArray(catalog.tables), "DELTA_FULL_CATALOG_REQUIRED");
  for (const table of catalog.tables) insist(table && (table.autoIncrement === null
    || (typeof table.autoIncrement === "string" || typeof table.autoIncrement === "number")
      && /^[1-9][0-9]*$/.test(String(table.autoIncrement))), "DELTA_COUNTER_INVALID");
  const normalized = validateCatalog(catalog, names ?? catalog.tables.map(table => table.tableName));
  for (const row of normalized.foreignKeys) insist(targetNames.has(row.tableName) === targetNames.has(row.referencedTableName), "DELTA_CROSS_SCOPE_FOREIGN_KEY");
  for (const row of normalized.keyColumns) if (row.referencedTableName !== null)
    insist(targetNames.has(row.tableName) === targetNames.has(row.referencedTableName), "DELTA_CROSS_SCOPE_FOREIGN_KEY");
  return normalized;
}

function scoped(catalog, names) {
  const wanted = new Set(names);
  return validateCatalog(Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key,
    rows.filter(row => !Object.hasOwn(row, "tableName") || wanted.has(row.tableName))])), names);
}

function metricState(catalog) {
  const columns = catalog.columns.filter(row => row.tableName === TABLE_NAME);
  insist(columns.length === 25, "DELTA_TARGET_COLUMN_SET_CHANGED");
  const states = new Set();
  for (const contract of COLUMN_CONTRACTS) {
    const column = columns.find(row => row.columnName === contract.name);
    insist(column && column.columnType === contract.columnType && column.dataType === contract.dataType
      && Number(column.ordinalPosition) === contract.position && column.extra === "" && column.columnKey === ""
      && column.columnComment === "" && column.generationExpression === ""
      && ["characterMaximumLength", "characterOctetLength", "characterSetName", "collationName", "datetimePrecision", "srsId"]
        .every(field => column[field] === null)
      && String(column.numericPrecision) === (contract.dataType === "bigint" ? "19" : contract.dataType === "int" ? "10" : "14")
      && String(column.numericScale) === (contract.dataType === "decimal" ? "2" : "0"), "DELTA_METRIC_CONTRACT_CHANGED");
    if (column.isNullable === "NO" && column.columnDefault === contract.defaultValue) states.add("old");
    else if (column.isNullable === "YES" && column.columnDefault === null) states.add("new");
    else insist(false, "DELTA_METRIC_STATE_UNREVIEWED");
  }
  insist(states.size === 1, "DELTA_MIXED_METRIC_STATE_REFUSED");
  insist(!catalog.indexes.some(row => row.tableName === TABLE_NAME && (metricNames.has(row.columnName) || row.expression !== null))
    && !catalog.keyColumns.some(row => (row.tableName === TABLE_NAME && metricNames.has(row.columnName))
      || (row.referencedTableName === TABLE_NAME && metricNames.has(row.referencedColumnName)))
    && !catalog.foreignKeys.some(row => row.tableName === TABLE_NAME || row.referencedTableName === TABLE_NAME)
    && !catalog.checks.some(row => row.tableName === TABLE_NAME), "DELTA_TARGET_DEPENDENCY_UNREVIEWED");
  return [...states][0];
}

function afterCatalog(catalog) {
  const next = structuredClone(catalog);
  for (const column of next.columns) if (column.tableName === TABLE_NAME && metricNames.has(column.columnName)) {
    column.isNullable = "YES"; column.columnDefault = null;
  }
  return next;
}

/**
 * lineage is the frozen admitted assessment of OLD source, not a re-admission
 * of the current target. definition additionally pins lineageSha256 and the
 * private four-table sourceContractSha256. sourceContract={catalog,sha256} uses
 * the raw 13-collection catalog (actual counters), never normalized sentinels.
 * The caller authenticates these inputs and fixed receipt file hash; supplied
 * shapes/hashes alone are not independent approval or production permission.
 */
export function planExistingDelta({ lineage, currentCatalog, sourceContract, definition, evidence }) {
  checkLineage(lineage, definition, evidence);
  insist(exactKeys(sourceContract, ["catalog", "sha256"]) && sourceContract.sha256 === definition.sourceContractSha256,
    "DELTA_SOURCE_CONTRACT_HASH_MISMATCH");
  const source = normalizeInput(sourceContract.catalog, ADOPTION_TABLES);
  insist(fingerprint(source) === sourceContract.sha256, "DELTA_SOURCE_CONTRACT_HASH_MISMATCH");
  insist(metricState(source) === "old", "DELTA_FROZEN_SOURCE_MUST_BE_OLD_STATE");
  const current = normalizeInput(currentCatalog), currentScoped = scoped(current, ADOPTION_TABLES), state = metricState(current);
  const expected = afterCatalog(source);
  insist(isDeepStrictEqual(currentScoped, state === "old" ? source : expected), "DELTA_UNREVIEWED_STRUCTURAL_DRIFT");
  const action = state === "old" ? "alter" : "noop", actualAfter = afterCatalog(current);
  const result = {
    version: DELTA_PLAN_VERSION, deltaId: DELTA_DEFINITION.deltaId, action, targetState: state,
    tableName: TABLE_NAME, columnNames: COLUMN_CONTRACTS.map(column => column.name), defaultPolicy: DELTA_DEFINITION.defaultPolicy,
    allowedFieldChanges: ["isNullable", "columnDefault"],
    changes: action === "alter" ? COLUMN_CONTRACTS.map(column => ({ columnName: column.name,
      before: { isNullable: "NO", columnDefault: column.defaultValue }, after: { isNullable: "YES", columnDefault: null } })) : [],
    sql: action === "alter" ? CANDIDATE_SQL : null, sqlSha256: action === "alter" ? DELTA_DEFINITION.sqlSha256 : null,
    candidateSqlSha256: DELTA_DEFINITION.sqlSha256, definitionSha256: fingerprint(definition), lineageSha256: definition.lineageSha256,
    sourceContractSha256: sourceContract.sha256, sourceTableCatalogSha256: fingerprint(scoped(source, [TABLE_NAME])),
    currentTableCatalogSha256: fingerprint(scoped(currentScoped, [TABLE_NAME])),
    expectedAfterTableCatalogSha256: fingerprint(scoped(expected, [TABLE_NAME])),
    currentScopedCatalogSha256: fingerprint(currentScoped), expectedAfterScopedCatalogSha256: fingerprint(expected),
    currentFullCatalogSha256: fingerprint(current), expectedAfterFullCatalogSha256: fingerprint(actualAfter),
    rehearsalReceiptSha256: evidence.receiptSha256, comparisonTables: [...ADOPTION_TABLES], nonTargetTablesCompared: false,
    evaluationOnly: true, databaseExecutionAuthorized: false, productionApproved: false, registeredMigration: false,
    ledgerWriteAllowed: false, generalRunnerAdmitted: false, historicalExecutionProven: false, historicalSqlChanged: false,
    missingExecutionProvenance: [...lineage.missingExecutionProvenance],
    limitations: ["Caller must authenticate frozen approval, private contract and rehearsal evidence; this pure planner does not read their files.",
      "Noop proves only the compared current structure, not execution of historical 0196 or any migration.",
      "No database execution, production backup/recovery or production ALTER lock-duration approval is granted."],
  };
  return { ...result, planSha256: fingerprint(result) };
}
