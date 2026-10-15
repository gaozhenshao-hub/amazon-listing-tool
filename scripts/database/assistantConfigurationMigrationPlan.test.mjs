// Public immutable source inputs and synthetic in-memory snapshots only. These
// tests never collect a native reference, connect, execute SQL or grant approval.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DDL_CATALOG } from "../integration/exportProductionDdl.mjs";
import { parseLiteralRegistry } from "../integration/migrationInventory.mjs";
import { BOOTSTRAP_FILES, MANUAL_FRESH_FILES, RECEIPT_MIGRATION, fingerprint, sha256 } from "./freshBootstrapPlan.mjs";
import { EMPTY_ALIGNMENT_MIGRATION, EMPTY_ALIGNMENT_TABLES, ledgerExecutionHash } from "../bootstrap-fresh-database.mjs";
import { ASSISTANT_MIGRATION_PINS, ASSISTANT_MIGRATION_PLAN_VERSION, ASSISTANT_MIGRATION_TABLES, ASSISTANT_NATIVE_PLATFORM,
  deriveAssistantConfigurationDelta, planAssistantConfigurationMigration, validateAssistantNativeDelta } from "./assistantConfigurationMigrationPlan.mjs";

const clone = value => structuredClone(value), code = expected => error => error.code === `ASSISTANT_MIGRATION_${expected}`;
const publicText = name => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const sql = publicText("drizzle/0230_assistant_configurations.sql"), schemaSource = publicText("drizzle/schema/assistantConfigurations.ts");
const definition = deriveAssistantConfigurationDelta({ sql, schemaSource });
const baseContractText = publicText("drizzle/bootstrap/structure-contract.json"), contract = JSON.parse(baseContractText);
const manifest = JSON.parse(publicText("drizzle/bootstrap/manifest.json"));
const journal = JSON.parse(publicText("drizzle/meta/_journal.json"));
const generalNames = [...journal.entries.map(entry => `${entry.tag}.sql`),
  ...parseLiteralRegistry(publicText("scripts/run-database-migrations.mjs"), "supplementalMigrations", true)]
  .filter(name => !["0191_parent_asin_weekly_mcp_source_forward_repair.sql", "0192_parent_asin_weekly_source_columns_forward_repair.sql",
    "0193_parent_asin_weekly_mcp_control_plane_forward_repair.sql"].includes(name));
const insertion = generalNames.indexOf("0195_parent_asin_weekly_mcp_emperor_projection.sql") + 1;
const sourcePins = new Map(manifest.sources.map(item => [item.path, item.sha256]));
// Reconstruct only the historical ordered name/checksum vector from public
// literal registries and pins; do not load/execute the historical SQL files.
const historicalPlan = [BOOTSTRAP_FILES[0], ...generalNames.slice(0, insertion), ...MANUAL_FRESH_FILES,
  ...generalNames.slice(insertion), ...BOOTSTRAP_FILES.slice(1)].map((fileName, order) => ({ fileName, order,
  checksum: sourcePins.get(`drizzle/${fileName}`) }));
const targetSchema = "amazon_fresh_0123456789abcdef_synthetic", referenceSchema = "amazon_rehearsal_fedcba9876543210_synthetic";
const stamp = "2026-10-15 12:00:00", zeroHash = fingerprint([]), runId = "01234567-89ab-4def-8123-456789abcdef";
const names = contract.catalog.tables.map(row => row.tableName).sort();
const row = (collection, values) => ({ ...Object.fromEntries(DDL_CATALOG[collection].fields.map(field => [field, null])), ...values });
const show = (tableName, ddl) => ({ tableName, ddl, sha256: sha256(ddl) });
const sortBy = key => (a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
const updateLedgerData = snapshot => {
  snapshot.ledger.sort(sortBy("migrationName"));
  Object.assign(snapshot.tableData.find(item => item.tableName === "app_schema_migrations"), {
    rowCount: String(snapshot.ledger.length), rowsSha256: fingerprint(snapshot.ledger),
  });
};

function baseFixture() {
  const catalog = clone(contract.catalog); catalog.schema[0].schemaName = targetSchema;
  for (const item of catalog.tables) if (item.autoIncrement !== null) item.autoIncrement = "1";
  for (const item of catalog.keyColumns) if (item.referencedTableSchema !== null) item.referencedTableSchema = targetSchema;
  for (const item of catalog.foreignKeys) item.uniqueConstraintSchema = targetSchema;
  const receipt = { version: manifest.version, runId, schema: targetSchema, planSha256: manifest.planSha256,
    sourcesSha256: ASSISTANT_MIGRATION_PINS.historicalSourcesSha256, stage: "completed", completedAt: stamp,
    originalEmpty: { schema: targetSchema, checkedAt: stamp, identity: { schema: targetSchema, mysqlVersion: ASSISTANT_NATIVE_PLATFORM.mysqlVersion,
      lowerCaseTableNames: 0 }, objects: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0 } },
    structure: { catalogSha256: contract.catalogSha256 } };
  const ledger = historicalPlan.map(item => {
    const proof = item.fileName === RECEIPT_MIGRATION ? { ...receipt, sequence: item.order }
      : { version: manifest.version, runId, schema: targetSchema, planSha256: manifest.planSha256,
        sourcesSha256: ASSISTANT_MIGRATION_PINS.historicalSourcesSha256, sequence: item.order };
    if (item.fileName === EMPTY_ALIGNMENT_MIGRATION) proof.emptyAlignment = { migrationName: item.fileName,
      tables: [...EMPTY_ALIGNMENT_TABLES], checkedAt: stamp };
    return { migrationName: item.fileName, checksum: item.checksum, status: "succeeded", executionId: `migration-${runId}`,
      startedAt: stamp, finishedAt: stamp, error: null, metadata: JSON.stringify({ freshBootstrap: proof }), createdAt: stamp, updatedAt: stamp };
  }).sort(sortBy("migrationName"));
  const original = ledger.find(item => item.migrationName === RECEIPT_MIGRATION), metadata = JSON.parse(original.metadata);
  metadata.freshBootstrap.ledgerExecutionSha256 = ledgerExecutionHash(ledger); original.metadata = JSON.stringify(metadata);
  const snapshot = { schema: targetSchema, catalog,
    // These are visibly synthetic valid SHOW strings, not claimed native SHOW.
    showCreate: names.map(name => show(name, `CREATE TABLE \`${name}\` (\n  \`synthetic_fixture\` int NOT NULL\n) ENGINE=InnoDB`)),
    ledger, tableData: names.map(tableName => ({ tableName, rowCount: "0", rowsSha256: zeroHash })) };
  updateLedgerData(snapshot); return snapshot;
}

function nativeFixture() {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(key => [key, []]));
  catalog.schema = [row("schema", { schemaName: referenceSchema, characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci", defaultEncryption: "NO" })];
  for (const tableName of ASSISTANT_MIGRATION_TABLES) {
    const current = tableName === "emperor_assistant_configurations";
    catalog.tables.push(row("tables", { tableName, tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic",
      autoIncrement: "1", collationName: "utf8mb4_bin", createOptions: "", tableComment: "" }));
    const columns = [["id", "int"], ["workspaceId", "int"], ["agentKey", "varchar"], ["revision", "int"], ["config", "json"], ["configHash", "char"],
      ...(current ? [["updatedBy", "int"], ["createdAt", "timestamp"], ["updatedAt", "timestamp"]]
        : [["sourceRevision", "int"], ["createdBy", "int"], ["createdAt", "timestamp"]])];
    for (const [position, [columnName, dataType]] of columns.entries()) {
      const text = dataType === "varchar" || dataType === "char", length = dataType === "char" ? 64 : 32, timestamp = dataType === "timestamp";
      catalog.columns.push(row("columns", { tableName, columnName, ordinalPosition: position + 1,
        columnDefault: timestamp ? "CURRENT_TIMESTAMP" : null, isNullable: columnName === "sourceRevision" ? "YES" : "NO",
        dataType, columnType: text ? `${dataType}(${length})` : dataType,
        characterMaximumLength: text ? length : null, characterOctetLength: text ? length * 4 : null,
        numericPrecision: dataType === "int" ? 10 : null, numericScale: dataType === "int" ? 0 : null, datetimePrecision: timestamp ? 0 : null,
        characterSetName: text ? "utf8mb4" : null, collationName: text ? "utf8mb4_bin" : null,
        columnKey: columnName === "id" ? "PRI" : columnName === "workspaceId" ? "MUL" : "",
        extra: columnName === "id" ? "auto_increment" : timestamp ? `DEFAULT_GENERATED${columnName === "updatedAt" ? " on update CURRENT_TIMESTAMP" : ""}` : "",
        columnComment: "", generationExpression: "", srsId: null }));
    }
    const indexes = [["PRIMARY", ["id"]], [current ? "uq_assistant_configuration_scope" : "uq_assistant_configuration_version_scope",
      current ? ["workspaceId", "agentKey"] : ["workspaceId", "agentKey", "revision"]]];
    for (const [indexName, columns] of indexes) {
      catalog.constraints.push(row("constraints", { tableName, constraintName: indexName, constraintType: indexName === "PRIMARY" ? "PRIMARY KEY" : "UNIQUE", enforced: "YES" }));
      for (const [position, columnName] of columns.entries()) {
        catalog.indexes.push(row("indexes", { tableName, indexName, nonUnique: 0, sequence: position + 1, columnName,
          direction: "A", nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES" }));
        catalog.keyColumns.push(row("keyColumns", { tableName, constraintName: indexName, columnName, ordinalPosition: position + 1 }));
      }
    }
  }
  return { schema: referenceSchema, catalog,
    showCreate: ASSISTANT_MIGRATION_TABLES.map(name => show(name, definition.statements.find(item => item.tableName === name).sql)),
    tableData: ASSISTANT_MIGRATION_TABLES.map(tableName => ({ tableName, rowCount: "0", rowsSha256: zeroHash })), platform: clone(ASSISTANT_NATIVE_PLATFORM) };
}

function fixture() {
  const baseSnapshot = baseFixture();
  return { definition, baseContractText, historicalPlan: clone(historicalPlan), baseSnapshot,
    currentSnapshot: clone(baseSnapshot), deltaReference: null, operation: null };
}
function completeFixture() {
  const input = fixture(), reference = nativeFixture(), current = input.currentSnapshot;
  input.deltaReference = reference;
  for (const [collection, rows] of Object.entries(reference.catalog)) if (collection !== "schema") current.catalog[collection].push(...clone(rows));
  current.showCreate.push(...clone(reference.showCreate)); current.showCreate.sort(sortBy("tableName"));
  current.tableData.push(...clone(reference.tableData)); current.tableData.sort(sortBy("tableName"));
  const own = { migrationName: ASSISTANT_MIGRATION_PINS.fileName, checksum: definition.sqlSha256, status: "succeeded",
    executionId: `assistant-migration-${runId}`, startedAt: stamp, finishedAt: stamp, createdAt: stamp, updatedAt: stamp, error: null,
    metadata: JSON.stringify({ assistantConfigurationMigration: { version: ASSISTANT_MIGRATION_PLAN_VERSION, sqlSha256: definition.sqlSha256,
      definitionSha256: definition.definitionSha256, baseSnapshotSha256: fingerprint(input.baseSnapshot), deltaReferenceSha256: fingerprint(reference),
      statementSha256: definition.statements.map(item => item.sha256) } }) };
  current.ledger.push(own); updateLedgerData(current);
  input.operation = { version: ASSISTANT_MIGRATION_PLAN_VERSION, status: "completed", schema: targetSchema,
    migrationName: ASSISTANT_MIGRATION_PINS.fileName, sqlSha256: definition.sqlSha256, baseSnapshotSha256: fingerprint(input.baseSnapshot),
    deltaReferenceSha256: fingerprint(reference), executionId: own.executionId, statements: definition.statements.map(item => ({ index: item.index,
      sha256: item.sha256, dispatched: true, acknowledged: true, warningStatus: 0 })), ledgerRowSha256: fingerprint(own), lockReleased: true };
  return input;
}

test("public pins derive exactly two immutable source statements, without native or execution approval", () => {
  assert.equal(sha256(baseContractText), ASSISTANT_MIGRATION_PINS.baseContractSha256);
  assert.equal(fingerprint(historicalPlan.map(item => [item.fileName, item.checksum])), ASSISTANT_MIGRATION_PINS.historicalPlanSha256);
  assert.equal(historicalPlan.length, 178); assert.equal(names.length, 303);
  assert.equal(definition.status, "source-derived-pending-native"); assert.equal(definition.statements.length, 2);
  assert.deepEqual(definition.statements.map(item => item.tableName), [...ASSISTANT_MIGRATION_TABLES].reverse());
  for (const item of definition.statements) assert.equal(item.sha256, sha256(item.sql));
  assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.statements) && Object.isFrozen(definition.statements[0]));
  assert.equal(definition.databaseExecutionAuthorized, false); assert.equal(definition.nativeApprovalGranted, false);
  for (const change of [{ sql: `${sql}\n`, schemaSource }, { sql: sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"), schemaSource },
    { sql, schemaSource: `${schemaSource}\n` }, { sql: `${sql}\nDROP TABLE users;`, schemaSource }]) {
    assert.throws(() => deriveAssistantConfigurationDelta(change), code("SOURCE_PIN_CHANGED"));
  }
});

test("pristine exact303 base plans separate0230 only and never mutates or approves supplied snapshots", () => {
  const input = fixture(), before = fingerprint(input), result = planAssistantConfigurationMigration(input);
  assert.equal(result.action, "create-two-tables-candidate"); assert.equal(result.expectedTableCount, 305);
  assert.equal(result.expectedHistoricalLedgerRows, 178); assert.equal(result.expectedLedgerRows, 179);
  assert.equal(result.statements.length, 2); assert.equal(result.deltaReferenceSha256, null);
  assert.equal(result.baseRawCatalogShowDataAndFullLedgerCompared, true);
  for (const key of ["databaseExecutionAuthorized", "nativeApprovalGranted", "nativeProvenanceAuthenticated", "productionApproved",
    "automaticRetryAllowed", "sqlExecuted", "ledgerWritten"]) assert.equal(result[key], false);
  assert.equal(result.status, "pending-native-approval-and-execution-core"); assert.equal(fingerprint(input), before);
});

test("source-matching synthetic native fixture proves18columns/7parts only, never native provenance", () => {
  const snapshot = nativeFixture(), before = fingerprint(snapshot), result = validateAssistantNativeDelta(snapshot, definition);
  assert.equal(result.tables, 2); assert.equal(result.columns, 18); assert.equal(result.indexParts, 7);
  assert.equal(snapshot.catalog.indexes.length, 7); assert.equal(snapshot.catalog.constraints.length, 4); assert.equal(snapshot.catalog.keyColumns.length, 7);
  assert.equal(result.sourceModelMatched, true);
  for (const key of ["nativeProvenanceAuthenticated", "nativeApprovalGranted", "databaseExecutionAuthorized"]) assert.equal(result[key], false);
  assert.equal(fingerprint(snapshot), before);
  const input = fixture(); input.deltaReference = snapshot;
  assert.equal(planAssistantConfigurationMigration(input).nativeReferenceSourceModelChecked, true);
});

test("native model rejects changed char64, defaults, generated extras, columns, indexes and object scope", () => {
  for (const mutate of [s => s.catalog.columns.find(item => item.columnName === "configHash").columnType = "varchar(64)",
    s => s.catalog.columns.find(item => item.columnName === "updatedAt").extra = "DEFAULT_GENERATED",
    s => s.catalog.columns.find(item => item.columnName === "sourceRevision").isNullable = "NO",
    s => s.catalog.columns.find(item => item.columnName === "agentKey").characterOctetLength = 32,
    s => s.catalog.columns[0].columnDefault = "0", s => s.catalog.columns.pop(), s => s.catalog.indexes.pop(),
    s => s.catalog.indexes[1].visible = "NO", s => s.catalog.constraints[0].enforced = "NO",
    s => s.catalog.keyColumns[1].ordinalPosition = 2,
    s => s.catalog.checks.push(row("checks", { tableName: ASSISTANT_MIGRATION_TABLES[0], constraintName: "unexpected", checkClause: "id > 0" })),
    s => s.platform.explicitDefaultsForTimestamp = 0]) {
    const snapshot = nativeFixture(); mutate(snapshot); assert.throws(() => validateAssistantNativeDelta(snapshot, definition));
  }
});

test("native fixture requires exact empty hashes and raw string counters equal1", () => {
  for (const value of [1, "01", "0", "2", "__dynamic_positive_auto_increment__", null]) {
    const snapshot = nativeFixture(); snapshot.catalog.tables[0].autoIncrement = value;
    assert.throws(() => validateAssistantNativeDelta(snapshot, definition));
  }
  for (const mutate of [s => s.tableData[0].rowCount = "1", s => s.tableData[0].rowsSha256 = fingerprint([[1]]),
    s => s.tableData[0].rowCount = 0, s => s.tableData[0].rowCount = "00"]) {
    const snapshot = nativeFixture(); mutate(snapshot); assert.throws(() => validateAssistantNativeDelta(snapshot, definition));
  }
});

test("self-hashed SHOW cannot contradict source columns, engine, counter, keys or defaults", () => {
  for (const change of [ddl => ddl.replace("`id` int", "`id` bigint"),
    ddl => `CREATE TABLE \`${ASSISTANT_MIGRATION_TABLES[0]}\` (\n  \`id\` int NOT NULL\n) ENGINE=InnoDB`,
    ddl => ddl.replace("ENGINE=InnoDB", "ENGINE=MyISAM"),
    ddl => ddl.replace("ENGINE=InnoDB", "ENGINE=InnoDB AUTO_INCREMENT=99"),
    ddl => ddl.replace("char(64)", "varchar(64)"),
    ddl => ddl.replace("DEFAULT CURRENT_TIMESTAMP", "DEFAULT '2000-01-01 00:00:00'"),
    ddl => ddl.replace("(`workspaceId`,`agentKey`,`revision`)", "(`agentKey`,`workspaceId`,`revision`)"),
    ddl => ddl.replace("DEFAULT CHARSET=utf8mb4", "DEFAULT CHARSET=latin1")]) {
    const snapshot = nativeFixture(), item = snapshot.showCreate[0];
    item.ddl = change(item.ddl); item.sha256 = sha256(item.ddl);
    assert.throws(() => validateAssistantNativeDelta(snapshot, definition));
  }
});

test("reviewed native SHOW whitespace, optional text COLLATE and explicit initial counter remain source-equivalent", () => {
  const snapshot = nativeFixture();
  for (const item of snapshot.showCreate) {
    item.ddl = item.ddl.replace("varchar(32) NOT NULL", "varchar(32) COLLATE utf8mb4_bin NOT NULL")
      .replace("char(64) NOT NULL", "char(64) COLLATE utf8mb4_bin NOT NULL")
      .replace("ENGINE=InnoDB DEFAULT", "ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT").replaceAll("\n  ", "\n    ");
    item.sha256 = sha256(item.ddl);
  }
  assert.equal(validateAssistantNativeDelta(snapshot, definition).sourceModelMatched, true);
});

test("native schema platform is explicit and a pristine reference must inherit the base schema defaults", () => {
  for (const mutate of [s => s.catalog.schema[0].characterSetName = "latin1",
    s => s.catalog.schema[0].collationName = "latin1_swedish_ci", s => s.platform.mysqlVersion = "8.0.47",
    s => s.platform.lowerCaseTableNames = "0", s => s.platform.defaultRowFormat = "compact"]) {
    const snapshot = nativeFixture(); mutate(snapshot); assert.throws(() => validateAssistantNativeDelta(snapshot, definition));
  }
  const input = fixture(); input.deltaReference = nativeFixture(); input.deltaReference.catalog.schema[0].collationName = "utf8mb4_bin";
  assert.throws(() => planAssistantConfigurationMigration(input));
});

test("strict source, historical plan and definition identities cannot be replaced with matching-looking inputs", () => {
  for (const mutate of [i => i.baseContractText += "\n", i => i.historicalPlan[0].checksum = "a".repeat(64),
    i => i.historicalPlan[0].order = 1, i => i.historicalPlan.pop(), i => i.historicalPlan[0].extra = true,
    i => i.definition = { ...definition, nativeApprovalGranted: true }, i => i.extra = true]) {
    const input = fixture(); mutate(input); assert.throws(() => planAssistantConfigurationMigration(input));
  }
});

test("partial one-table DDL refuses regardless of a purported completion operation", () => {
  for (const name of ASSISTANT_MIGRATION_TABLES) {
    const input = completeFixture(), removed = ASSISTANT_MIGRATION_TABLES.find(item => item !== name);
    for (const [key, rows] of Object.entries(input.currentSnapshot.catalog)) if (key !== "schema") input.currentSnapshot.catalog[key] = rows.filter(item => item.tableName !== removed);
    input.currentSnapshot.showCreate = input.currentSnapshot.showCreate.filter(item => item.tableName !== removed);
    input.currentSnapshot.tableData = input.currentSnapshot.tableData.filter(item => item.tableName !== removed);
    assert.throws(() => planAssistantConfigurationMigration(input), code("PARTIAL_DDL_REQUIRES_RECOVERY"));
  }
});

test("raw base counters, SHOW bytes and row hashes cannot drift even when normalized catalog still matches", () => {
  for (const mutate of [i => i.currentSnapshot.catalog.tables.find(item => item.autoIncrement !== null).autoIncrement = "2",
    i => { const item = i.currentSnapshot.showCreate[0]; item.ddl += " "; item.sha256 = sha256(item.ddl); },
    i => i.currentSnapshot.tableData.find(item => item.tableName !== "app_schema_migrations").rowsSha256 = fingerprint([["changed"]]),
    i => i.currentSnapshot.tableData.find(item => item.tableName !== "app_schema_migrations").rowCount = "1",
    i => i.currentSnapshot.schema = referenceSchema]) {
    const input = fixture(); mutate(input); assert.throws(() => planAssistantConfigurationMigration(input));
  }
  const input = fixture(); input.baseSnapshot.catalog.tables.find(item => item.autoIncrement !== null).autoIncrement = 1;
  assert.throws(() => planAssistantConfigurationMigration(input), code("RAW_COUNTER_REQUIRED"));
});

test("existing positive raw counters need not equal1, but both authenticated base and current must retain their exact value", () => {
  const input = fixture(), base = input.baseSnapshot.catalog.tables.find(item => item.autoIncrement !== null);
  base.autoIncrement = "209";
  const current = input.currentSnapshot.catalog.tables.find(item => item.tableName === base.tableName); current.autoIncrement = "209";
  assert.equal(planAssistantConfigurationMigration(input).action, "create-two-tables-candidate");
  current.autoIncrement = "210";
  assert.throws(() => planAssistantConfigurationMigration(input), code("BASE_RAW_CATALOG_DRIFT"));
});

test("base303 needs the original completed178 execution provenance, not structural count or baselined history", () => {
  for (const mutate of [s => s.ledger[0].status = "baselined", s => s.ledger[0].executionId = null,
    s => { const item = s.ledger.find(row => row.migrationName === RECEIPT_MIGRATION), metadata = JSON.parse(item.metadata);
      metadata.freshBootstrap.stage = "failed"; item.metadata = JSON.stringify(metadata); },
    s => { const item = s.ledger.find(row => row.migrationName === RECEIPT_MIGRATION), metadata = JSON.parse(item.metadata);
      metadata.freshBootstrap.originalEmpty.objects.tables = 1; item.metadata = JSON.stringify(metadata); },
    s => s.ledger[0].metadata = "{}", s => s.ledger.pop()]) {
    const input = fixture(); mutate(input.baseSnapshot); updateLedgerData(input.baseSnapshot);
    input.currentSnapshot = clone(input.baseSnapshot);
    assert.throws(() => planAssistantConfigurationMigration(input));
  }
});

test("all10 historical ledger fields are preserved; rehashing tableData cannot conceal their drift", () => {
  for (const field of ["migrationName", "checksum", "status", "executionId", "startedAt", "finishedAt", "error", "metadata", "createdAt", "updatedAt"]) {
    const input = fixture(), item = input.currentSnapshot.ledger[0];
    item[field] = field === "checksum" ? "b".repeat(64) : field === "status" ? "baselined" : `${item[field]}-changed`;
    updateLedgerData(input.currentSnapshot);
    assert.throws(() => planAssistantConfigurationMigration(input), code("HISTORICAL_LEDGER_DRIFT"), field);
  }
});

test("ledger/tableData mismatch, malformed fields and hidden duplicates are rejected", () => {
  for (const mutate of [i => i.currentSnapshot.ledger[0].createdAt = new Date(), i => delete i.currentSnapshot.ledger[0].updatedAt,
    i => i.currentSnapshot.ledger[0].extra = "not-projected", i => i.currentSnapshot.ledger.reverse(),
    i => { i.currentSnapshot.ledger.push(clone(i.currentSnapshot.ledger[0])); updateLedgerData(i.currentSnapshot); },
    i => i.currentSnapshot.tableData.find(item => item.tableName === "app_schema_migrations").rowsSha256 = zeroHash,
    i => i.currentSnapshot.showCreate[0].sha256 = "c".repeat(64), i => i.currentSnapshot.tableData.pop()]) {
    const input = fixture(); mutate(input); assert.throws(() => planAssistantConfigurationMigration(input));
  }
});

test("existing started/failed/baselined or wrong-checksum0230 rows never admit retry", () => {
  for (const status of ["started", "failed", "baselined", "succeeded"]) {
    const input = completeFixture(), own = input.currentSnapshot.ledger.find(item => item.migrationName === ASSISTANT_MIGRATION_PINS.fileName);
    own.status = status; if (status === "succeeded") own.checksum = "d".repeat(64);
    updateLedgerData(input.currentSnapshot);
    assert.throws(() => planAssistantConfigurationMigration(input), code("PRIOR_OUTCOME_REQUIRES_REVIEW"));
  }
  const input = fixture(); input.operation = { status: "started" };
  assert.throws(() => planAssistantConfigurationMigration(input), code("PRIOR_OUTCOME_REQUIRES_REVIEW"));
});

test("two present tables without ledger, native reference or completed evidence are not proof of execution", () => {
  for (const mutate of [i => i.operation = null, i => i.deltaReference = null,
    i => { i.currentSnapshot.ledger = i.currentSnapshot.ledger.filter(item => item.migrationName !== ASSISTANT_MIGRATION_PINS.fileName); updateLedgerData(i.currentSnapshot); }]) {
    const input = completeFixture(); mutate(input);
    assert.throws(() => planAssistantConfigurationMigration(input), code("COMPLETED_PROOF_REQUIRED"));
  }
  const input = fixture(), own = completeFixture().currentSnapshot.ledger.find(item => item.migrationName === ASSISTANT_MIGRATION_PINS.fileName);
  input.currentSnapshot.ledger.push(own); updateLedgerData(input.currentSnapshot);
  assert.throws(() => planAssistantConfigurationMigration(input), code("PRIOR_OUTCOME_REQUIRES_REVIEW"));
});

test("only exact305 plus bound completed journal and actual succeeded179 ledger plans zero-statement repeat", () => {
  const input = completeFixture(), before = fingerprint(input), result = planAssistantConfigurationMigration(input);
  assert.equal(result.action, "noop-verified-candidate"); assert.deepEqual(result.statements, []);
  assert.equal(input.currentSnapshot.catalog.tables.length, 305); assert.equal(input.currentSnapshot.ledger.length, 179);
  assert.equal(result.currentSnapshotSha256, fingerprint(input.currentSnapshot)); assert.equal(fingerprint(input), before);
  assert.equal(result.nativeProvenanceAuthenticated, false); assert.equal(result.databaseExecutionAuthorized, false);
});

test("completed journal requires every dispatch/ACK/no-warning binding and cannot manufacture approval", () => {
  for (const mutate of [i => i.operation.status = "started", i => i.operation.lockReleased = false,
    i => i.operation.statements[0].acknowledged = false, i => i.operation.statements[0].dispatched = false,
    i => i.operation.statements[0].warningStatus = 1, i => i.operation.statements.reverse(),
    i => i.operation.executionId = `assistant-migration-${"f".repeat(36)}`,
    i => i.operation.baseSnapshotSha256 = "e".repeat(64), i => i.operation.deltaReferenceSha256 = "f".repeat(64),
    i => i.operation.ledgerRowSha256 = "a".repeat(64), i => i.operation.extraAuthority = true]) {
    const input = completeFixture(); mutate(input);
    assert.throws(() => planAssistantConfigurationMigration(input), code("COMPLETED_PROOF_REQUIRED"));
  }
});

test("own succeeded row requires exact metadata and valid timestamp evidence even if journal row hash is rebound", () => {
  for (const mutate of [r => r.metadata = "{}", r => r.metadata = "not-json", r => r.error = "native failure",
    r => r.finishedAt = null, r => r.updatedAt = "invalid"]) {
    const input = completeFixture(), own = input.currentSnapshot.ledger.find(item => item.migrationName === ASSISTANT_MIGRATION_PINS.fileName);
    mutate(own); input.operation.ledgerRowSha256 = fingerprint(own); updateLedgerData(input.currentSnapshot);
    assert.throws(() => planAssistantConfigurationMigration(input), code("LEDGER_PROOF_INVALID"));
  }
});

test("completed own ledger cannot reverse time, substitute date syntax or use non-v4 execution identities", () => {
  for (const mutate of [r => { r.finishedAt = "2026-10-15 11:59:59"; r.updatedAt = r.finishedAt; }, r => r.createdAt = "2026-10-15 11:59:59",
    r => r.updatedAt = "2026-10-15 12:00:01", r => r.startedAt = "2026-10-15T12:00:00Z",
    r => Object.assign(r, { startedAt: "2026-02-30 12:00:00", finishedAt: "2026-02-30 12:00:00",
      createdAt: "2026-02-30 12:00:00", updatedAt: "2026-02-30 12:00:00" }), r => r.executionId = `assistant-migration-${"-".repeat(36)}`,
    r => r.executionId = "assistant-migration-01234567-89ab-1def-8123-456789abcdef",
    r => r.executionId = "assistant-migration-01234567-89ab-4def-0123-456789abcdef"]) {
    const input = completeFixture(), own = input.currentSnapshot.ledger.find(item => item.migrationName === ASSISTANT_MIGRATION_PINS.fileName);
    mutate(own); input.operation.executionId = own.executionId; input.operation.ledgerRowSha256 = fingerprint(own); updateLedgerData(input.currentSnapshot);
    assert.throws(() => planAssistantConfigurationMigration(input));
  }
});

test("repeat compares exact reference raw types/counters/SHOW and forbids unknown third tables", () => {
  for (const mutate of [i => i.currentSnapshot.catalog.tables.find(item => item.tableName === ASSISTANT_MIGRATION_TABLES[0]).autoIncrement = "2",
    i => { const item = i.currentSnapshot.showCreate.find(item => item.tableName === ASSISTANT_MIGRATION_TABLES[0]); item.ddl += " "; item.sha256 = sha256(item.ddl); },
    i => i.currentSnapshot.catalog.columns.find(item => item.tableName === ASSISTANT_MIGRATION_TABLES[0]).numericPrecision = "10",
    i => i.currentSnapshot.catalog.tables.push({ ...clone(i.currentSnapshot.catalog.tables[0]), tableName: "unreviewed_extra" })]) {
    const input = completeFixture(); mutate(input); assert.throws(() => planAssistantConfigurationMigration(input));
  }
});
