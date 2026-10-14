// Synthetic catalog/approval only. Reads public source for immutable plan checks;
// never loads private production artifacts or contacts a database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { DDL_CATALOG } from "../integration/exportProductionDdl.mjs";
import { fingerprint, loadOfflineGeneralPlan } from "./freshBootstrapPlan.mjs";
import { assessExistingLineage, EXISTING_LINEAGE_VERSION, ADOPTION_VERSION,
  ADOPTABLE_MIGRATION, ADOPTION_TABLES, GENERAL_PLAN_SHA256 } from "./existingLineageAdmission.mjs";

const publicPlan = loadOfflineGeneralPlan(), clone = value => structuredClone(value);
const code = expected => error => error.code === expected;
const secret = "private-catalog-literal-must-not-leak";

function catalogFixture(names = ADOPTION_TABLES, schema = "synthetic_existing") {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(name => [name, []]));
  catalog.schema = [{ schemaName: schema, characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci", defaultEncryption: "NO" }];
  for (const tableName of names) {
    catalog.tables.push({ tableName, tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic",
      autoIncrement: 1, collationName: "utf8mb4_0900_ai_ci", createOptions: "", tableComment: secret });
    catalog.columns.push({ tableName, columnName: "id", ordinalPosition: 1, columnDefault: null, isNullable: "NO", dataType: "int",
      columnType: "int", characterMaximumLength: null, characterOctetLength: null, numericPrecision: 10, numericScale: 0,
      datetimePrecision: null, characterSetName: null, collationName: null, columnKey: "PRI", extra: "auto_increment",
      columnComment: "", generationExpression: "", srsId: null });
    catalog.columns.push({ ...catalog.columns.at(-1), columnName: "note", ordinalPosition: 2, columnDefault: "fixture",
      isNullable: "YES", dataType: "varchar", columnType: "varchar(40)", characterMaximumLength: 40, characterOctetLength: 160,
      numericPrecision: null, numericScale: null, characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci", columnKey: "", extra: "" });
    catalog.indexes.push({ tableName, indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", direction: "A",
      prefixLength: null, packed: null, nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES", expression: null });
    catalog.constraints.push({ tableName, constraintName: "PRIMARY", constraintType: "PRIMARY KEY", enforced: "YES" });
    catalog.keyColumns.push({ tableName, constraintName: "PRIMARY", columnName: "id", ordinalPosition: 1,
      uniqueConstraintPosition: null, referencedTableSchema: null, referencedTableName: null, referencedColumnName: null });
  }
  return catalog;
}

function fixture() {
  const rows = publicPlan.filter(item => item.fileName !== ADOPTABLE_MIGRATION.fileName)
    .map((item, index) => ({ migrationName: item.fileName, checksum: item.checksum, status: index < 43 ? "succeeded" : "baselined" }));
  // Seven outside the 168-plan, including three synthetic remote-only names.
  for (const name of ["0169_remote_only_skill.sql", "0170_remote_only_prompt.sql", "0203_remote_only_caller.sql",
    "0196_ops_ad_mcp_campaign_metadata_nullable.sql", "0197_ops_monthly_financial_profit_scope.sql",
    "0198_unified_amazon_acquisition_foundation.sql", "0202_competitor_gallery_analysis_scope.sql"])
    rows.push({ migrationName: name, checksum: "a".repeat(64), status: "succeeded" });
  return { generalPlan: clone(publicPlan), ledgerSnapshot: { present: true, rows }, currentCatalog: catalogFixture(), adoption: null };
}

function approvedFixture() {
  const input = fixture(), assessed = assessExistingLineage(input);
  input.adoption = { version: ADOPTION_VERSION, decision: "structural-adoption-for-delta-gate", approved: true,
    historicalExecutionProven: false, generalRunnerAdmitted: false, generalPlanSha256: GENERAL_PLAN_SHA256,
    migration: { ...ADOPTABLE_MIGRATION }, ledgerSnapshotSha256: assessed.ledgerSnapshotSha256,
    structureContract: { catalog: clone(input.currentCatalog), sha256: assessed.currentCatalogSha256 },
    evidence: { artifactSha256: "b".repeat(64), exportReceiptSha256: "c".repeat(64) } };
  return input;
}

function appendCatalog(target, extra) {
  for (const collection of Object.keys(DDL_CATALOG)) if (collection !== "schema") target[collection].push(...extra[collection]);
}

test("import is inert under poisoned application filesystem/environment and does not load an execution driver or runner", () => {
  const url = new URL("./existingLineageAdmission.mjs", import.meta.url);
  const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    let loaderDepth=0;
    for(const name of ['readFileSync','writeFileSync','openSync','statSync','lstatSync','realpathSync','readdirSync']) {
      const original=fs[name]; fs[name]=(...args)=>{
        if(loaderDepth || new Error().stack.split('\\n')[2]?.includes('node:internal/modules/')) {
          loaderDepth++; try { return original(...args); } finally { loaderDepth--; }
        }
        throw new Error('application-filesystem-called');
      };
    }
    syncBuiltinESMExports(); await import(${JSON.stringify(url.href)}); console.log('INERT');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000,
    env: { PATH: "/usr/bin:/bin", DATABASE_URL: secret, FRESH_BOOTSTRAP_DATABASE_URL: secret } });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "INERT\n"); assert.equal(result.stderr, "");
  const source = fs.readFileSync(url, "utf8");
  assert.doesNotMatch(source, /import.*(?:run-database-migrations|mysql2|dotenv|node:fs)|process\.|console\.|readFile|writeFile|createConnection|applyMigrations\(/);
});

test("real unchanged 168 source pins bind exactly one missing 0059 and null approval returns needs-adoption", () => {
  assert.equal(fingerprint(publicPlan.map(item => [item.fileName, item.checksum])), GENERAL_PLAN_SHA256);
  const input = fixture(), before = clone(input), result = assessExistingLineage(input);
  assert.equal(result.version, EXISTING_LINEAGE_VERSION); assert.equal(result.status, "needs-adoption");
  assert.equal(result.generalPlanEntries, 168); assert.equal(result.matchingLedgerEntries, 167);
  assert.deepEqual(result.missingExecutionProvenance, [ADOPTABLE_MIGRATION.fileName]);
  for (const key of ["deltaOnlyAdmitted", "databaseExecutionAuthorized", "generalRunnerReady", "generalRunnerAdmitted", "historicalExecutionProven"])
    assert.equal(result[key], false);
  assert.equal(result.unmanagedLedgerEntries.length, 7);
  assert.ok(result.unmanagedLedgerEntries.every(row => row.observationOnly && !row.admittedForReplay && !row.historicalExecutionProven));
  assert.deepEqual(input, before); assert.ok(!JSON.stringify(result).includes(secret));
});

test("approved exact scoped contract admits only a future delta gate, preserving inputs and visible historical provenance debt", () => {
  const input = approvedFixture(), before = clone(input), result = assessExistingLineage(input);
  assert.equal(result.status, "admitted"); assert.equal(result.deltaOnlyAdmitted, true); assert.equal(result.evaluationOnly, true);
  for (const key of ["databaseExecutionAuthorized", "generalRunnerReady", "generalRunnerAdmitted", "historicalExecutionProven"])
    assert.equal(result[key], false);
  assert.equal(result.adoptionSha256, fingerprint(input.adoption));
  assert.deepEqual(result.structuralAdoption, ADOPTABLE_MIGRATION);
  assert.deepEqual(result.missingExecutionProvenance, [ADOPTABLE_MIGRATION.fileName]);
  assert.equal(result.comparisonScope.catalogCollections, 13); assert.equal(result.comparisonScope.nonTargetTablesCompared, false);
  assert.deepEqual(input, before); assert.ok(!JSON.stringify(result).includes(secret));
});

test("plan name, full checksum, exact order and size are immutable without numeric-prefix or case repairs", () => {
  const mutations = [p => p.pop(), p => p.push(clone(p[0])), p => p.reverse(),
    p => p[59].fileName = "0059_product_weekly_ops.sql", p => p[0].checksum = "a".repeat(64),
    p => p[0].checksum = p[0].checksum.toUpperCase(), p => p[0].fileName += " "];
  for (const mutate of mutations) { const input = fixture(); mutate(input.generalPlan); assert.throws(() => assessExistingLineage(input)); }
});

test("another missing history entry, an existing 0059 ledger row or any known checksum mismatch is refused", () => {
  for (const mutate of [s => s.rows.shift(), s => s.rows.push({ migrationName: ADOPTABLE_MIGRATION.fileName,
    checksum: ADOPTABLE_MIGRATION.checksum, status: "baselined" }), s => s.rows[0].checksum = "f".repeat(64)]) {
    const input = fixture(); mutate(input.ledgerSnapshot); assert.throws(() => assessExistingLineage(input));
  }
});

test("all ledger rows including outside-plan observations reject duplicates, unsafe identity, invalid hashes and unresolved states", () => {
  const mutations = [s => s.present = false, s => s.rows.push(clone(s.rows[0])), s => s.rows.push(clone(s.rows.at(-1))),
    s => s.rows[0].migrationName = "../0059.sql", s => s.rows.at(-1).migrationName = "remote.sql ",
    s => s.rows.at(-1).checksum = "A".repeat(64), s => s.rows.at(-1).checksum = "z".repeat(64),
    s => s.rows.at(-1).checksum = "a".repeat(63), s => s.rows.at(-1).checksum += " ",
    ...["started", "failed", "adopted", "SUCCEEDED", "succeeded "].flatMap(status => [
      s => s.rows[0].status = status, s => s.rows.at(-1).status = status,
    ])];
  for (const mutate of mutations) { const input = fixture(); mutate(input.ledgerSnapshot); assert.throws(() => assessExistingLineage(input)); }
});

test("approval binds the full ledger including unmanaged observations but not incidental input order", () => {
  const input = approvedFixture(); input.ledgerSnapshot.rows.reverse();
  assert.equal(assessExistingLineage(input).status, "admitted");
  for (const mutate of [s => s.rows.at(-1).checksum = "e".repeat(64), s => s.rows.at(-1).status = "baselined",
    s => s.rows.pop(), s => s.rows.push({ migrationName: "remote_addition.sql", checksum: "f".repeat(64), status: "succeeded" })]) {
    const changed = approvedFixture(); mutate(changed.ledgerSnapshot);
    assert.throws(() => assessExistingLineage(changed), code("EXISTING_ADOPTION_LEDGER_CHANGED"));
  }
});

test("approval is only for exact 0059 structural-adoption semantics and never historical success or a wildcard baseline", () => {
  const mutations = [a => a.approved = false, a => a.historicalExecutionProven = true, a => a.generalRunnerAdmitted = true,
    a => a.decision = "baselined", a => a.version = "other", a => a.through = "0059", a => a.generalPlanSha256 = "a".repeat(64),
    a => a.migration.fileName = "0059_product_weekly_ops.sql", a => a.migration.checksum = "d".repeat(64),
    a => a.evidence.artifactSha256 = "invalid", a => a.evidence.exportReceiptSha256 = "C".repeat(64),
    a => a.structureContract.sha256 = "d".repeat(64), a => a.structureContract.catalog.tables[0].tableComment = "tampered"];
  for (const mutate of mutations) { const input = approvedFixture(); mutate(input.adoption); assert.throws(() => assessExistingLineage(input)); }
  for (const fileName of ["0019_legacy.sql", "0196_ops_ad_mcp_campaign_metadata_nullable.sql", "0201_amazon_monitor_provider_jobs.sql", "*"]) {
    const input = approvedFixture(); input.adoption.migration.fileName = fileName; assert.throws(() => assessExistingLineage(input));
  }
});

test("only schema identity, input row order and positive next counters normalize, never column auto_increment", () => {
  const input = approvedFixture(); input.currentCatalog.schema[0].schemaName = "another_copy";
  for (const table of input.currentCatalog.tables) table.autoIncrement = "98765432109876543210";
  for (const rows of Object.values(input.currentCatalog)) rows.reverse();
  assert.equal(assessExistingLineage(input).status, "admitted");
  for (const value of [0, -1, "0", "01", "__dynamic_positive_auto_increment__", null]) {
    const invalid = approvedFixture(); invalid.currentCatalog.tables[0].autoIncrement = value;
    assert.throws(() => assessExistingLineage(invalid));
  }
  const removed = approvedFixture(); removed.currentCatalog.columns[0].extra = ""; removed.currentCatalog.tables[0].autoIncrement = null;
  assert.throws(() => assessExistingLineage(removed), code("EXISTING_ADOPTION_STRUCTURE_MISMATCH"));
});

test("the complete 13-collection scoped contract refuses defaults, enums, ordinal, options, comments, constraints, index and executable-object drift", () => {
  const tableName = ADOPTION_TABLES[0];
  const mutations = [c => c.schema[0].collationName = "utf8mb4_bin", c => c.tables[0].tableComment += "changed",
    c => c.tables[0].createOptions = "stats_persistent=0", c => c.tables[0].rowFormat = "Compact",
    c => c.columns[1].columnDefault = "different", c => c.columns[1].columnType = "enum('a','b')",
    c => c.columns[1].isNullable = "NO", c => c.columns[1].collationName = "utf8mb4_bin",
    c => c.columns[1].columnComment = "different", c => c.columns[1].generationExpression = "1+1",
    c => c.columns[1].extra = "DEFAULT_GENERATED", c => c.columns[0].ordinalPosition = 2,
    c => c.indexes[0].nonUnique = 1, c => c.indexes[0].indexName = "OTHER", c => c.indexes[0].prefixLength = 1,
    c => c.indexes[0].direction = "D", c => c.indexes[0].visible = "NO", c => c.indexes[0].expression = "(id+1)",
    c => c.constraints[0].constraintName = "OTHER", c => c.keyColumns[0].columnName = "note",
    c => c.foreignKeys.push({ tableName, constraintName: "fk_internal", uniqueConstraintSchema: "synthetic_existing",
      uniqueConstraintName: "PRIMARY", referencedTableName: ADOPTION_TABLES[1], matchOption: "NONE", updateRule: "NO ACTION", deleteRule: "CASCADE" }),
    c => c.checks.push({ tableName, constraintName: "ck_id", checkClause: "id>0" }),
    c => c.partitions.push({ tableName, partitionName: "p0" }), c => c.views.push({ tableName }),
    c => c.triggers.push({ tableName, triggerName: "trigger_x" }), c => c.routines.push({ routineName: "proc_x", routineType: "PROCEDURE" }),
    c => c.events.push({ eventName: "event_x" })];
  for (const mutate of mutations) { const input = approvedFixture(); mutate(input.currentCatalog); assert.throws(() => assessExistingLineage(input)); }
  for (const collection of Object.keys(DDL_CATALOG)) {
    const input = fixture(); delete input.currentCatalog[collection]; assert.throws(() => assessExistingLineage(input));
  }
  const extraField = fixture(); extraField.currentCatalog.columns[0].unrecognizedField = "value";
  assert.throws(() => assessExistingLineage(extraField));
});

test("private approval has exactly four tables, while unrelated current tables are not silently claimed as compared", () => {
  const input = approvedFixture(); appendCatalog(input.currentCatalog, catalogFixture(["unrelated_table"]));
  assert.equal(assessExistingLineage(input).status, "admitted");
  input.currentCatalog.tables.at(-1).tableComment = "unrelated drift outside four-table scope";
  assert.equal(assessExistingLineage(input).status, "admitted");
  appendCatalog(input.adoption.structureContract.catalog, catalogFixture(["unrelated_table"]));
  assert.throws(() => assessExistingLineage(input), code("EXISTING_CONTRACT_TABLE_SCOPE_CHANGED"));
  const missing = fixture(); missing.currentCatalog = catalogFixture(ADOPTION_TABLES.slice(1));
  assert.throws(() => assessExistingLineage(missing), code("EXISTING_ADOPTION_TABLE_MISSING"));
});

test("incoming and outgoing cross-scope FKs refuse adoption instead of disappearing during table scoping", () => {
  for (const incoming of [false, true]) {
    const input = approvedFixture(); appendCatalog(input.currentCatalog, catalogFixture(["outside"]));
    input.currentCatalog.foreignKeys.push({ tableName: incoming ? "outside" : ADOPTION_TABLES[0], constraintName: "fk_boundary",
      uniqueConstraintSchema: "synthetic_existing", uniqueConstraintName: "PRIMARY",
      referencedTableName: incoming ? ADOPTION_TABLES[0] : "outside", matchOption: "NONE", updateRule: "NO ACTION", deleteRule: "CASCADE" });
    assert.throws(() => assessExistingLineage(input), code("EXISTING_CROSS_SCOPE_FOREIGN_KEY"));
  }
});

test("refusal errors and returned evidence do not disclose raw private schema text", () => {
  const input = approvedFixture(); input.currentCatalog.tables[0].tableComment += "different";
  assert.throws(() => assessExistingLineage(input), error => {
    assert.equal(error.code, "EXISTING_ADOPTION_STRUCTURE_MISMATCH");
    assert.ok(!String(error.stack).includes(secret)); assert.deepEqual(Object.keys(error), ["code"]); return true;
  });
});
