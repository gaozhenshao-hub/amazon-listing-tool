// Pure candidate contract for a future explicitly approved isolated-local step.
// No filesystem, connector, execution, historical migration edit or ledger write.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const requireSafe = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const hash = value => createHash("sha256").update(value).digest("hex");
const jsonHash = value => hash(JSON.stringify(value));
const schemaPattern = /^amazon_rehearsal_[a-f0-9]{16}_synthetic$/;
export const TABLE_NAME = "ops_ad_mcp_campaign_daily_facts";
export const SOURCE_EVIDENCE_PINS = Object.freeze({
  "drizzle/0059_ops_ad_mcp_facts.sql": "5f0b2b40f2cfaddc0a5d4156376ea89d274c7ce3c790cc97c651dd5196af1008",
  "drizzle/0196_ops_ad_mcp_campaign_metadata_nullable.sql": "2359096ae0aa5ee0c0a058f7a47201e6ef55e9f94a23fa7af82e03098307d999",
  "drizzle/schema/ads.ts": "257b12961beb58ab5627a08999efadfee9a2067ec4dc5ffc2525fd6c9cf394a0",
  "server/domains/ops/adMcpApply.ts": "3cd2951156fa6fa4d69a48d15e3fc2eac80ccf8c3554023293f6055753002f59",
});
export const COLUMN_CONTRACTS = Object.freeze([
  { name: "impressions", columnType: "bigint", dataType: "bigint", position: 15, defaultValue: "0" },
  { name: "clicks", columnType: "bigint", dataType: "bigint", position: 16, defaultValue: "0" },
  { name: "spend", columnType: "decimal(14,2)", dataType: "decimal", position: 17, defaultValue: "0.00" },
  { name: "sales", columnType: "decimal(14,2)", dataType: "decimal", position: 18, defaultValue: "0.00" },
  { name: "orders", columnType: "int", dataType: "int", position: 19, defaultValue: "0" },
].map(Object.freeze));
const metricNames = new Set(COLUMN_CONTRACTS.map(column => column.name));
// Intentionally data-only: no import of the exporter or its filesystem/client
// dependencies. Tests bind this projection to the reviewed DDL_CATALOG shape.
const catalogFields = {
  schema: "schemaName characterSetName collationName defaultEncryption",
  tables: "tableName tableType engine version rowFormat autoIncrement collationName createOptions tableComment",
  columns: "tableName columnName ordinalPosition columnDefault isNullable dataType columnType characterMaximumLength characterOctetLength numericPrecision numericScale datetimePrecision characterSetName collationName columnKey extra columnComment generationExpression srsId",
  indexes: "tableName indexName nonUnique sequence columnName direction prefixLength packed nullable indexType comment indexComment visible expression",
  constraints: "tableName constraintName constraintType enforced",
  keyColumns: "tableName constraintName columnName ordinalPosition uniqueConstraintPosition referencedTableSchema referencedTableName referencedColumnName",
  foreignKeys: "tableName constraintName uniqueConstraintSchema uniqueConstraintName referencedTableName matchOption updateRule deleteRule",
  checks: "tableName constraintName checkClause",
  partitions: "tableName partitionName",
  views: "tableName",
  triggers: "triggerName tableName",
  routines: "routineName routineType",
  events: "eventName",
};
const catalogCollections = Object.keys(catalogFields);
export const CANDIDATE_SQL = `ALTER TABLE \`ops_ad_mcp_campaign_daily_facts\`
  MODIFY COLUMN \`impressions\` bigint NULL DEFAULT NULL,
  MODIFY COLUMN \`clicks\` bigint NULL DEFAULT NULL,
  MODIFY COLUMN \`spend\` decimal(14,2) NULL DEFAULT NULL,
  MODIFY COLUMN \`sales\` decimal(14,2) NULL DEFAULT NULL,
  MODIFY COLUMN \`orders\` int NULL DEFAULT NULL;`;

function validateCatalogScope(catalog) {
  requireSafe(catalog && Object.keys(catalog).length === catalogCollections.length
    && catalogCollections.every(name => Array.isArray(catalog[name])), "NULLABILITY_FULL_CATALOG_REQUIRED");
  for (const [name, fieldNames] of Object.entries(catalogFields)) {
    const fields = fieldNames.split(" ");
    requireSafe(catalog[name].length <= 100_000 && catalog[name].every(row => row && !Array.isArray(row)
      && Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field)
        && (row[field] === null || typeof row[field] === "string" || typeof row[field] === "boolean"
          || (typeof row[field] === "number" && Number.isFinite(row[field]))))), "NULLABILITY_CATALOG_SHAPE_INVALID");
  }
  requireSafe(catalog.schema.length === 1 && schemaPattern.test(catalog.schema[0]?.schemaName), "NULLABILITY_ISOLATED_SCHEMA_REQUIRED");
  const tableNames = new Set(catalog.tables.map(table => table.tableName));
  requireSafe(tableNames.size === catalog.tables.length && ["columns", "indexes", "constraints", "keyColumns", "foreignKeys", "checks"]
    .every(name => catalog[name].every(row => tableNames.has(row.tableName))), "NULLABILITY_CATALOG_TABLE_SCOPE_INVALID");
  const tables = catalog.tables.filter(table => table.tableName === TABLE_NAME);
  requireSafe(tables.length === 1 && tables[0].tableType === "BASE TABLE" && tables[0].engine === "InnoDB", "NULLABILITY_TABLE_SCOPE_INVALID");
  const targetColumns = catalog.columns.filter(column => column.tableName === TABLE_NAME);
  requireSafe(targetColumns.length >= 19 && new Set(targetColumns.map(column => column.columnName)).size === targetColumns.length,
    "NULLABILITY_COLUMN_SET_INVALID");
  const ordered = [...targetColumns].sort((a, b) => Number(a.ordinalPosition) - Number(b.ordinalPosition));
  requireSafe(ordered.every((column, index) => Number(column.ordinalPosition) === index + 1), "NULLABILITY_COLUMN_ORDER_INVALID");
  for (const column of COLUMN_CONTRACTS) {
    const actual = targetColumns.find(value => value.columnName === column.name);
    requireSafe(actual && actual.columnType === column.columnType && actual.dataType === column.dataType
      && Number(actual.ordinalPosition) === column.position
      && ((actual.isNullable === "NO" && actual.columnDefault === column.defaultValue)
        || (actual.isNullable === "YES" && actual.columnDefault === null))
      && actual.characterSetName === null && actual.collationName === null && actual.extra === ""
      && actual.generationExpression === "" && actual.columnComment === "" && actual.columnKey === ""
      && actual.characterMaximumLength === null && actual.characterOctetLength === null
      && actual.datetimePrecision === null && actual.srsId === null
      && String(actual.numericPrecision) === (column.dataType === "bigint" ? "19" : column.dataType === "int" ? "10" : "14")
      && String(actual.numericScale) === (column.dataType === "decimal" ? "2" : "0"),
    "NULLABILITY_COLUMN_CONTRACT_MISMATCH");
  }
  requireSafe(!catalog.indexes.some(index => index.tableName === TABLE_NAME
    && (metricNames.has(index.columnName) || (index.expression !== null && index.expression !== undefined && index.expression !== ""))),
  "NULLABILITY_INDEX_DEPENDENCY_UNREVIEWED");
  requireSafe(!catalog.keyColumns.some(key => (key.tableName === TABLE_NAME && metricNames.has(key.columnName))
    || (key.referencedTableName === TABLE_NAME && metricNames.has(key.referencedColumnName))), "NULLABILITY_KEY_DEPENDENCY_UNREVIEWED");
  requireSafe(!catalog.checks.some(check => check.tableName === TABLE_NAME), "NULLABILITY_CHECK_DEPENDENCY_UNREVIEWED");
  requireSafe(!catalog.triggers.some(trigger => trigger.tableName === TABLE_NAME), "NULLABILITY_TRIGGER_DEPENDENCY_UNREVIEWED");
  return targetColumns.filter(column => metricNames.has(column.columnName));
}

function expectedCatalog(before, action) {
  const after = structuredClone(before);
  if (action === "alter") for (const column of after.columns) {
    if (column.tableName === TABLE_NAME && metricNames.has(column.columnName)) {
      column.isNullable = "YES"; column.columnDefault = null;
    }
  }
  return after;
}

export function planCampaignNullability(catalog, options = {}) {
  // Root explicitly chose parity with current application/0196 target semantics:
  // both nullability AND omitted-value defaults change. Never infer this policy.
  requireSafe(options.scope === "isolated-local-only" && options.defaultPolicy === "align-null-default", "NULLABILITY_EXPLICIT_LOCAL_POLICY_REQUIRED");
  const columns = validateCatalogScope(catalog), states = new Set(columns.map(column => column.isNullable));
  requireSafe(states.size === 1, "NULLABILITY_PARTIAL_STATE_REFUSED");
  const action = states.has("NO") ? "alter" : "noop", sql = action === "alter" ? CANDIDATE_SQL : null;
  return { formatVersion: 1, kind: "local-forward-nullability-candidate-not-registered-migration", action,
    tableName: TABLE_NAME, columnNames: COLUMN_CONTRACTS.map(column => column.name), defaultPolicy: "align-null-default",
    allowedFieldChanges: ["isNullable", "columnDefault"],
    changes: action === "alter" ? COLUMN_CONTRACTS.map(column => ({ columnName: column.name,
      before: { isNullable: "NO", columnDefault: column.defaultValue }, after: { isNullable: "YES", columnDefault: null } })) : [],
    sql, sqlSha256: sql === null ? null : hash(sql), beforeCatalogSha256: jsonHash(catalog), expectedAfterCatalogSha256: jsonHash(expectedCatalog(catalog, action)),
    productionApproved: false, registeredMigration: false, historicalSqlChanged: false, ledgerWriteAllowed: false,
    defaultSemantics: "Explicit semantic change: known zero defaults become NULL defaults, and NOT NULL becomes nullable. Omitted metrics must not be fabricated as measured zero. Historical 0196 is reference only, not replayed.",
  };
}

export function verifyCampaignNullabilityTransition(before, after, candidate, options = {}) {
  const expectedCandidate = planCampaignNullability(before, options);
  requireSafe(isDeepStrictEqual(candidate, expectedCandidate), "NULLABILITY_CANDIDATE_CHANGED");
  validateCatalogScope(after);
  requireSafe(isDeepStrictEqual(after, expectedCatalog(before, candidate.action)), "NULLABILITY_UNAPPROVED_CATALOG_CHANGE");
  requireSafe(jsonHash(after) === candidate.expectedAfterCatalogSha256, "NULLABILITY_AFTER_HASH_MISMATCH");
  return { verified: true, action: candidate.action, changedColumns: candidate.changes.length,
    allOtherCatalogFieldsEqual: true, alignedNullDefaults: true, allowedFieldChanges: ["isNullable", "columnDefault"],
    productionApproved: false, ledgerWriteAllowed: false,
    beforeCatalogSha256: candidate.beforeCatalogSha256, afterCatalogSha256: candidate.expectedAfterCatalogSha256 };
}
