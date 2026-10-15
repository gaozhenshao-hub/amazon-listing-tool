// Pure candidate planning only. No connector, environment consumption, execution,
// ledger write or approval factory. Shared inert validators retain their own CLI
// identity guards (which may realpath the calling script on import), not their
// executable mains. Snapshot/receipt inputs must be
// independently authenticated by a future trusted local launcher. Passing this
// checker is NOT native provenance, permission, or approval to execute SQL.
import { isDeepStrictEqual } from "node:util";
import { fingerprint, sha256, insist, validateCatalog } from "./freshBootstrapPlan.mjs";
import { splitDefinitionList, splitPublicStatements } from "./freshBootstrapReference.mjs";
import { validateTableDdl } from "../integration/exportProductionDdl.mjs";
import { validateExecutedLedger } from "../bootstrap-fresh-database.mjs";

export const ASSISTANT_MIGRATION_PLAN_VERSION = "assistant-configuration-migration-candidate/1";
export const ASSISTANT_MIGRATION_PINS = Object.freeze({
  fileName: "0230_assistant_configurations.sql",
  sqlSha256: "88b08b6852381336d06af255e25c6dd6a5ed574b7ed27c94b2b86db34fe080e8",
  schemaSha256: "e07c4126be9e5152db9f28ce742291e05290006901ddb37ac2175e06eb66ae2b",
  baseContractSha256: "9323498df4ba3c0619a439f1bcf5fba5369cfe9651b1cd657e3ac2de21b2cd8c",
  historicalPlanSha256: "a9ef4347a1ad1dfe99b90bfa9a04b10ceb479a1e0a220dbd05634241685fa2f0",
  historicalSourcesSha256: "2be14b13add4cf878e10956d764080866362a1cf5b7afe6fab6ee40e6af30f7f",
});
export const ASSISTANT_MIGRATION_TABLES = Object.freeze([
  "emperor_assistant_configuration_versions", "emperor_assistant_configurations",
]);
export const ASSISTANT_NATIVE_PLATFORM = Object.freeze({
  mysqlVersion: "8.0.46-0ubuntu0.24.04.4", lowerCaseTableNames: 0,
  explicitDefaultsForTimestamp: 1, defaultRowFormat: "dynamic",
});
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const same = (a, b, code) => insist(isDeepStrictEqual(a, b), `ASSISTANT_MIGRATION_${code}`);
const check = (condition, code) => insist(condition, `ASSISTANT_MIGRATION_${code}`);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const schemaName = value => typeof value === "string" && /^amazon_(?:fresh|rehearsal)_[a-f0-9]{16}_synthetic$/.test(value);
const sorted = values => [...values].sort();
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const ZERO_ROWS_SHA256 = fingerprint([]);
const LEDGER_FIELDS = Object.freeze("migrationName checksum status executionId startedAt finishedAt error metadata createdAt updatedAt".split(" "));

export function deriveAssistantConfigurationDelta({ sql, schemaSource }) {
  check(typeof sql === "string" && sha256(sql) === ASSISTANT_MIGRATION_PINS.sqlSha256
    && typeof schemaSource === "string" && sha256(schemaSource) === ASSISTANT_MIGRATION_PINS.schemaSha256, "SOURCE_PIN_CHANGED");
  const statements = splitPublicStatements(sql).map((text, index) => {
    const tableName = /^CREATE TABLE `([A-Za-z_][A-Za-z0-9_]*)` \(/.exec(text)?.[1];
    check(tableName === ["emperor_assistant_configurations", "emperor_assistant_configuration_versions"][index], "STATEMENT_SCOPE_CHANGED");
    return { index, tableName, sql: text, sha256: sha256(text) };
  });
  check(statements.length === 2, "STATEMENT_SCOPE_CHANGED");
  const candidate = { version: ASSISTANT_MIGRATION_PLAN_VERSION, status: "source-derived-pending-native",
    sourceSql: sql, schemaSource, statements, tableNames: [...ASSISTANT_MIGRATION_TABLES],
    sqlSha256: ASSISTANT_MIGRATION_PINS.sqlSha256, schemaSha256: ASSISTANT_MIGRATION_PINS.schemaSha256,
    databaseExecutionAuthorized: false, nativeApprovalGranted: false };
  return freeze({ ...candidate, definitionSha256: fingerprint(candidate) });
}

function definitionChecked(definition) {
  check(definition && typeof definition === "object", "DEFINITION_INVALID");
  const rebuilt = deriveAssistantConfigurationDelta({ sql: definition.sourceSql, schemaSource: definition.schemaSource });
  same(definition, rebuilt, "DEFINITION_CHANGED"); return rebuilt;
}

function rawCatalog(catalog, names, schema) {
  check(catalog?.schema?.[0]?.schemaName === schema, "SNAPSHOT_SCHEMA_CHANGED");
  // Shared validation checks every field and rejects executable objects. Its
  // counter/schema normalization is NOT used for raw preservation comparisons.
  validateCatalog(catalog, names);
  for (const row of catalog.tables) check(row.autoIncrement === null || typeof row.autoIncrement === "string"
    && /^[1-9][0-9]*$/.test(row.autoIncrement), "RAW_COUNTER_REQUIRED");
  return catalog;
}
function showChecked(rows, names) {
  check(Array.isArray(rows), "SHOW_INVALID");
  same(rows.map(row => row.tableName), sorted(names), "SHOW_TABLE_SET_CHANGED");
  for (const row of rows) {
    check(exact(row, ["tableName", "ddl", "sha256"]) && hash(row.sha256) && sha256(row.ddl) === row.sha256, "SHOW_HASH_CHANGED");
    validateTableDdl(row.ddl, row.tableName);
  }
}
function dataChecked(rows, names) {
  check(Array.isArray(rows), "DATA_INVALID");
  same(rows.map(row => row.tableName), sorted(names), "DATA_TABLE_SET_CHANGED");
  for (const row of rows) check(exact(row, ["tableName", "rowCount", "rowsSha256"])
    && typeof row.rowCount === "string" && /^(?:0|[1-9][0-9]*)$/.test(row.rowCount) && hash(row.rowsSha256), "DATA_INVALID");
}
function ledgerChecked(rows) {
  check(Array.isArray(rows), "LEDGER_INVALID");
  for (const row of rows) check(exact(row, LEDGER_FIELDS) && typeof row.migrationName === "string"
    && hash(row.checksum) && ["started", "succeeded", "failed", "baselined"].includes(row.status)
    && (row.executionId === null || typeof row.executionId === "string")
    && ["startedAt", "finishedAt", "createdAt", "updatedAt"].every(key => row[key] === null || typeof row[key] === "string")
    && (row.error === null || typeof row.error === "string") && (row.metadata === null || typeof row.metadata === "string"), "LEDGER_INVALID");
  same(rows.map(row => row.migrationName), sorted(rows.map(row => row.migrationName)), "LEDGER_ORDER_CHANGED");
  check(new Set(rows.map(row => row.migrationName)).size === rows.length, "LEDGER_DUPLICATE");
}
function snapshotChecked(value, names) {
  check(exact(value, ["schema", "catalog", "showCreate", "ledger", "tableData"]) && schemaName(value.schema), "SNAPSHOT_INVALID");
  rawCatalog(value.catalog, names, value.schema); showChecked(value.showCreate, names); dataChecked(value.tableData, names); ledgerChecked(value.ledger);
  const ledgerData = value.tableData.find(row => row.tableName === "app_schema_migrations");
  check(ledgerData?.rowCount === String(value.ledger.length) && ledgerData.rowsSha256 === fingerprint(value.ledger), "LEDGER_DATA_HASH_CHANGED");
}
const scopeCatalog = (catalog, names) => {
  const set = new Set(names);
  return Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key,
    rows.filter(row => !Object.hasOwn(row, "tableName") || set.has(row.tableName))]));
};
const semanticNumber = (value, expected) => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value === expected
  || typeof value === "string" && String(expected) === value;
function expectFields(row, expected, numbers = []) {
  for (const [key, value] of Object.entries(expected)) check(numbers.includes(key) ? semanticNumber(row[key], value) : row[key] === value, "NATIVE_MODEL_MISMATCH");
}
function deltaShowMatchesSource(rows, definition) {
  for (const row of rows) {
    const source = definition.statements.find(item => item.tableName === row.tableName).sql;
    const prefix = `CREATE TABLE \`${row.tableName}\` (`;
    const suffix = " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin";
    check(source.startsWith(prefix) && source.endsWith(`)${suffix}`), "SOURCE_SHOW_FRAMING_CHANGED");
    const match = /^([\s\S]+)\) ENGINE=InnoDB(?: AUTO_INCREMENT=([1-9][0-9]*))? DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin$/.exec(row.ddl);
    check(match && match[1].startsWith(prefix) && (match[2] === undefined || match[2] === "1"), "NATIVE_SHOW_MODEL_MISMATCH");
    // This source has no string literals in its definitions. Admit only the
    // known native optional per-column COLLATE declaration and whitespace;
    // every column/key/default/extra remains bound to the exact reviewed SQL.
    const sourceParts = splitDefinitionList(source.slice(prefix.length, -suffix.length - 1));
    const actualParts = splitDefinitionList(match[1].slice(prefix.length));
    same(actualParts.map(part => part.replace(/\s+/g, " ").replace(
      /^(`(?:agentKey|configHash)` (?:varchar\(32\)|char\(64\))) COLLATE utf8mb4_bin /, "$1 ")),
    sourceParts.map(part => part.replace(/\s+/g, " ")), "NATIVE_SHOW_MODEL_MISMATCH");
  }
}

/** Validate an observed reference against source semantics, not its provenance.
 * Root must independently create/authenticate the native reference and retain
 * raw SHOW/catalog hashes. Source-generated or test fixtures do not become
 * accepted native evidence merely by satisfying this function. */
export function validateAssistantNativeDelta(snapshot, requestedDefinition) {
  const definition = definitionChecked(requestedDefinition);
  check(exact(snapshot, ["schema", "catalog", "showCreate", "tableData", "platform"]) && schemaName(snapshot.schema), "NATIVE_SNAPSHOT_INVALID");
  same(snapshot.platform, ASSISTANT_NATIVE_PLATFORM, "NATIVE_PLATFORM_CHANGED");
  rawCatalog(snapshot.catalog, ASSISTANT_MIGRATION_TABLES, snapshot.schema);
  showChecked(snapshot.showCreate, ASSISTANT_MIGRATION_TABLES); dataChecked(snapshot.tableData, ASSISTANT_MIGRATION_TABLES);
  expectFields(snapshot.catalog.schema[0], { characterSetName: "utf8mb4" });
  check(["utf8mb4_bin", "utf8mb4_0900_ai_ci"].includes(snapshot.catalog.schema[0].collationName)
    && ["NO", "N"].includes(snapshot.catalog.schema[0].defaultEncryption), "NATIVE_SCHEMA_PLATFORM_CHANGED");
  deltaShowMatchesSource(snapshot.showCreate, definition);
  for (const tableName of ASSISTANT_MIGRATION_TABLES) {
    const current = tableName === "emperor_assistant_configurations";
    const table = snapshot.catalog.tables.find(row => row.tableName === tableName);
    expectFields(table, { tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic", autoIncrement: "1",
      collationName: "utf8mb4_bin", createOptions: "", tableComment: "" }, ["version"]);
    const specs = [["id", "int"], ["workspaceId", "int"], ["agentKey", "varchar"], ["revision", "int"], ["config", "json"], ["configHash", "char"],
      ...(current ? [["updatedBy", "int"], ["createdAt", "timestamp"], ["updatedAt", "timestamp"]]
        : [["sourceRevision", "int"], ["createdBy", "int"], ["createdAt", "timestamp"]])];
    const columns = snapshot.catalog.columns.filter(row => row.tableName === tableName);
    same(columns.map(row => row.columnName), specs.map(([name]) => name), "NATIVE_COLUMN_SET_CHANGED");
    specs.forEach(([name, type], index) => {
      const text = ["varchar", "char"].includes(type), length = type === "char" ? 64 : 32, timestamp = type === "timestamp";
      const expected = { ordinalPosition: index + 1, columnDefault: timestamp ? "CURRENT_TIMESTAMP" : null,
        isNullable: name === "sourceRevision" ? "YES" : "NO", dataType: type,
        columnType: text ? `${type}(${length})` : type, characterMaximumLength: text ? length : null,
        characterOctetLength: text ? length * 4 : null, numericPrecision: type === "int" ? 10 : null,
        numericScale: type === "int" ? 0 : null, datetimePrecision: timestamp ? 0 : null,
        characterSetName: text ? "utf8mb4" : null, collationName: text ? "utf8mb4_bin" : null,
        columnKey: name === "id" ? "PRI" : name === "workspaceId" ? "MUL" : "",
        extra: name === "id" ? "auto_increment" : timestamp ? `DEFAULT_GENERATED${name === "updatedAt" ? " on update CURRENT_TIMESTAMP" : ""}` : "",
        columnComment: "", generationExpression: "", srsId: null };
      expectFields(columns[index], expected, Object.entries(expected).filter(([, value]) => typeof value === "number").map(([key]) => key));
    });
    const name = current ? "uq_assistant_configuration_scope" : "uq_assistant_configuration_version_scope";
    const definitions = [{ name: "PRIMARY", columns: ["id"] }, { name, columns: current ? ["workspaceId", "agentKey"] : ["workspaceId", "agentKey", "revision"] }];
    const indexes = snapshot.catalog.indexes.filter(row => row.tableName === tableName);
    const constraints = snapshot.catalog.constraints.filter(row => row.tableName === tableName);
    const keys = snapshot.catalog.keyColumns.filter(row => row.tableName === tableName);
    check(indexes.length === definitions.reduce((sum, item) => sum + item.columns.length, 0) && constraints.length === 2 && keys.length === indexes.length, "NATIVE_INDEX_SET_CHANGED");
    for (const item of definitions) {
      const parts = indexes.filter(row => row.indexName === item.name), keyParts = keys.filter(row => row.constraintName === item.name);
      same(parts.map(row => row.columnName), item.columns, "NATIVE_INDEX_SET_CHANGED");
      same(keyParts.map(row => row.columnName), item.columns, "NATIVE_INDEX_SET_CHANGED");
      const constraint = constraints.filter(row => row.constraintName === item.name);
      check(constraint.length === 1, "NATIVE_INDEX_SET_CHANGED");
      expectFields(constraint[0], { constraintType: item.name === "PRIMARY" ? "PRIMARY KEY" : "UNIQUE", enforced: "YES" });
      parts.forEach((part, index) => expectFields(part, { nonUnique: 0, sequence: index + 1, direction: "A", prefixLength: null, packed: null,
        nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES", expression: null }, ["nonUnique", "sequence"]));
      keyParts.forEach((part, index) => expectFields(part, { ordinalPosition: index + 1, uniqueConstraintPosition: null,
        referencedTableSchema: null, referencedTableName: null, referencedColumnName: null }, ["ordinalPosition"]));
    }
    const data = snapshot.tableData.find(row => row.tableName === tableName);
    check(data.rowCount === "0" && data.rowsSha256 === ZERO_ROWS_SHA256, "NEW_TABLE_NOT_EMPTY");
  }
  for (const key of ["foreignKeys", "checks", "partitions", "views", "triggers", "routines", "events"]) check(snapshot.catalog[key].length === 0, "NATIVE_EXTRA_OBJECT");
  return { definitionSha256: definition.definitionSha256, snapshotSha256: fingerprint(snapshot),
    rawCatalogSha256: fingerprint(snapshot.catalog), tables: 2, columns: 18, indexParts: 7,
    sourceModelMatched: true, nativeProvenanceAuthenticated: false, nativeApprovalGranted: false, databaseExecutionAuthorized: false };
}

function baseChecked({ baseContractText, historicalPlan, baseSnapshot }) {
  check(typeof baseContractText === "string" && sha256(baseContractText) === ASSISTANT_MIGRATION_PINS.baseContractSha256, "BASE_CONTRACT_CHANGED");
  const contract = JSON.parse(baseContractText), names = contract.catalog.tables.map(row => row.tableName).sort();
  check(names.length === 303 && contract.sourcesSha256 === ASSISTANT_MIGRATION_PINS.historicalSourcesSha256, "BASE_CONTRACT_CHANGED");
  check(Array.isArray(historicalPlan) && historicalPlan.length === 178, "HISTORICAL_PLAN_CHANGED");
  historicalPlan.forEach((item, order) => check(exact(item, ["fileName", "checksum", "order"]) && item.order === order && hash(item.checksum), "HISTORICAL_PLAN_CHANGED"));
  check(fingerprint(historicalPlan.map(item => [item.fileName, item.checksum])) === ASSISTANT_MIGRATION_PINS.historicalPlanSha256, "HISTORICAL_PLAN_CHANGED");
  snapshotChecked(baseSnapshot, names);
  check(fingerprint(validateCatalog(baseSnapshot.catalog, names)) === contract.catalogSha256, "BASE_CATALOG_CHANGED");
  const receipt = validateExecutedLedger(baseSnapshot.ledger, { plan: historicalPlan, planSha256: ASSISTANT_MIGRATION_PINS.historicalPlanSha256,
    sourcesSha256: ASSISTANT_MIGRATION_PINS.historicalSourcesSha256 }, baseSnapshot.schema);
  check(receipt.structure.catalogSha256 === contract.catalogSha256, "BASE_RECEIPT_CHANGED");
  return { names, contract };
}

/** Complete externally durable journal shape for a verified repeat only. This
 * checks supplied evidence consistency, not filesystem fsync/native authority. */
function completedOperation(operation, definition, baseSnapshot, reference, ledgerRow) {
  check(exact(operation, ["version", "status", "schema", "migrationName", "sqlSha256", "baseSnapshotSha256", "deltaReferenceSha256", "executionId", "statements", "ledgerRowSha256", "lockReleased"])
    && operation.version === ASSISTANT_MIGRATION_PLAN_VERSION && operation.status === "completed" && operation.schema === baseSnapshot.schema
    && operation.migrationName === ASSISTANT_MIGRATION_PINS.fileName && operation.sqlSha256 === definition.sqlSha256
    && operation.baseSnapshotSha256 === fingerprint(baseSnapshot) && operation.deltaReferenceSha256 === fingerprint(reference)
    && /^assistant-migration-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operation.executionId ?? "") && operation.executionId === ledgerRow.executionId
    && operation.ledgerRowSha256 === fingerprint(ledgerRow) && operation.lockReleased === true, "COMPLETED_PROOF_REQUIRED");
  same(operation.statements, definition.statements.map(item => ({ index: item.index, sha256: item.sha256, dispatched: true, acknowledged: true, warningStatus: 0 })), "COMPLETED_PROOF_REQUIRED");
  let metadata;
  try { metadata = JSON.parse(ledgerRow.metadata); } catch { check(false, "LEDGER_PROOF_INVALID"); }
  same(metadata, { assistantConfigurationMigration: { version: ASSISTANT_MIGRATION_PLAN_VERSION,
    sqlSha256: definition.sqlSha256, definitionSha256: definition.definitionSha256,
    baseSnapshotSha256: fingerprint(baseSnapshot), deltaReferenceSha256: fingerprint(reference),
    statementSha256: definition.statements.map(item => item.sha256) } }, "LEDGER_PROOF_INVALID");
  const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value.replace(" ", "T") + "Z"))
    && new Date(value.replace(" ", "T") + "Z").toISOString().slice(0, 19).replace("T", " ") === value;
  check(ledgerRow.status === "succeeded" && ledgerRow.checksum === definition.sqlSha256 && ledgerRow.error === null
    && ["startedAt", "finishedAt", "createdAt", "updatedAt"].every(key => timestamp(ledgerRow[key]))
    && ledgerRow.startedAt <= ledgerRow.finishedAt && ledgerRow.createdAt === ledgerRow.startedAt
    && ledgerRow.updatedAt === ledgerRow.finishedAt, "LEDGER_PROOF_INVALID");
}

export function planAssistantConfigurationMigration(input) {
  check(exact(input, ["definition", "baseContractText", "historicalPlan", "baseSnapshot", "currentSnapshot", "deltaReference", "operation"]), "PLAN_INPUT_INVALID");
  const definition = definitionChecked(input.definition), { names } = baseChecked(input), { baseSnapshot: base, currentSnapshot: current, deltaReference: reference, operation } = input;
  check(current?.schema === base.schema, "SNAPSHOT_SCHEMA_CHANGED");
  const actualNames = current?.catalog?.tables?.map(row => row.tableName);
  check(Array.isArray(actualNames), "SNAPSHOT_INVALID");
  const added = actualNames.filter(name => !names.includes(name));
  check(added.every(name => ASSISTANT_MIGRATION_TABLES.includes(name)), "UNEXPECTED_TABLE");
  check(added.length === 0 || added.length === 2, "PARTIAL_DDL_REQUIRES_RECOVERY");
  snapshotChecked(current, sorted([...names, ...added]));
  same(scopeCatalog(current.catalog, names), base.catalog, "BASE_RAW_CATALOG_DRIFT");
  same(current.showCreate.filter(row => names.includes(row.tableName)), base.showCreate, "BASE_SHOW_DRIFT");
  const originalLedger = current.ledger.filter(row => row.migrationName !== ASSISTANT_MIGRATION_PINS.fileName);
  same(originalLedger, base.ledger, "HISTORICAL_LEDGER_DRIFT");
  same(current.tableData.filter(row => names.includes(row.tableName) && row.tableName !== "app_schema_migrations"),
    base.tableData.filter(row => row.tableName !== "app_schema_migrations"), "BASE_DATA_DRIFT");
  const ownRow = current.ledger.find(row => row.migrationName === ASSISTANT_MIGRATION_PINS.fileName);
  if (ownRow) check(ownRow.status === "succeeded" && ownRow.checksum === definition.sqlSha256, "PRIOR_OUTCOME_REQUIRES_REVIEW");
  let action;
  if (!added.length) {
    check(!ownRow && operation === null, "PRIOR_OUTCOME_REQUIRES_REVIEW");
    same(current, base, "PRISTINE_BASE_REQUIRED"); action = "create-two-tables-candidate";
    if (reference !== null) {
      validateAssistantNativeDelta(reference, definition);
      same({ ...reference.catalog.schema[0], schemaName: base.schema }, base.catalog.schema[0], "DELTA_SCHEMA_PLATFORM_CHANGED");
    }
  } else {
    check(ownRow && reference !== null && operation !== null, "COMPLETED_PROOF_REQUIRED");
    validateAssistantNativeDelta(reference, definition);
    const delta = { schema: current.schema, catalog: scopeCatalog(current.catalog, ASSISTANT_MIGRATION_TABLES),
      showCreate: current.showCreate.filter(row => added.includes(row.tableName)), tableData: current.tableData.filter(row => added.includes(row.tableName)), platform: reference.platform };
    const rebound = structuredClone(reference); rebound.schema = current.schema; rebound.catalog.schema[0].schemaName = current.schema;
    same(delta, rebound, "DELTA_REFERENCE_MISMATCH");
    completedOperation(operation, definition, base, reference, ownRow); action = "noop-verified-candidate";
  }
  return freeze({ version: ASSISTANT_MIGRATION_PLAN_VERSION, action, status: "pending-native-approval-and-execution-core",
    migrationName: ASSISTANT_MIGRATION_PINS.fileName, definitionSha256: definition.definitionSha256,
    baseSnapshotSha256: fingerprint(base), currentSnapshotSha256: fingerprint(current),
    deltaReferenceSha256: reference === null ? null : fingerprint(reference),
    statements: action === "create-two-tables-candidate" ? definition.statements : [],
    expectedTableCount: 305, expectedHistoricalLedgerRows: 178, expectedLedgerRows: 179,
    baseRawCatalogShowDataAndFullLedgerCompared: true,
    nativeReferenceSourceModelChecked: reference !== null, nativeProvenanceAuthenticated: false,
    nativeApprovalGranted: false, databaseExecutionAuthorized: false, productionApproved: false,
    automaticRetryAllowed: false, sqlExecuted: false, ledgerWritten: false,
    limitations: ["Pure supplied-snapshot consistency only; actual full rows/SHOW/catalog collection and durable/native authentication remain launcher duties.",
      "No execution, resume, retry, DROP, implicit-commit rollback or database recovery is performed.",
      "Original fresh303 contract/history and current-source binding refusal remain unchanged; this is not current-source bootstrap approval."] });
}
