// Public source plus wholly synthetic private-contract fixtures. No DB/VM or
// real private artifact/receipt reads, and no actual approval or registration.
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DDL_CATALOG } from "../integration/exportProductionDdl.mjs";
import { COLUMN_CONTRACTS, CANDIDATE_SQL, TABLE_NAME, planCampaignNullability } from "../integration/campaignNullabilityContract.mjs";
import { fingerprint, sha256, loadOfflineGeneralPlan } from "./freshBootstrapPlan.mjs";
import { assessExistingLineage, ADOPTION_VERSION, ADOPTION_TABLES, ADOPTABLE_MIGRATION, GENERAL_PLAN_SHA256 } from "./existingLineageAdmission.mjs";
import { planExistingDelta, DELTA_DEFINITION, REHEARSAL_EVIDENCE } from "./existingDeltaPlan.mjs";

const clone = value => structuredClone(value), code = expected => error => error.code === expected;
const publicPlan = loadOfflineGeneralPlan(), secret = "synthetic-private-comment-not-for-output";
const row = (collection, values) => ({ ...Object.fromEntries(DDL_CATALOG[collection].fields.map(name => [name, null])), ...values });
const columnNames = ["workspaceId", "id", "user_id", "profile_id", "source_store_id", "country", "report_date", "ad_type", "campaign_id",
  "campaign_name", "campaign_status", "bidding_strategy", "budget", "currency", "impressions", "clicks", "spend", "sales", "orders",
  "source_batch_id", "source_row_hash", "source_payload_hash", "version", "created_at", "updated_at"];

function catalogFixture(names = ADOPTION_TABLES) {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(name => [name, []]));
  catalog.schema = [row("schema", { schemaName: "existing_fixture", characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci", defaultEncryption: "NO" })];
  for (const tableName of names) {
    catalog.tables.push(row("tables", { tableName, tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic",
      autoIncrement: 10, collationName: "utf8mb4_0900_ai_ci", createOptions: "", tableComment: secret }));
    for (const [index, columnName] of (tableName === TABLE_NAME ? columnNames : ["id"]).entries()) {
      const metric = COLUMN_CONTRACTS.find(column => column.name === columnName), dataType = metric?.dataType ?? "int";
      catalog.columns.push(row("columns", { tableName, columnName, ordinalPosition: index + 1,
        columnDefault: metric?.defaultValue ?? null, isNullable: "NO", dataType, columnType: metric?.columnType ?? "int",
        numericPrecision: dataType === "bigint" ? "19" : dataType === "decimal" ? "14" : "10",
        numericScale: dataType === "decimal" ? "2" : "0", columnKey: columnName === "id" ? "PRI" : "",
        extra: columnName === "id" ? "auto_increment" : "", columnComment: "", generationExpression: "" }));
    }
    catalog.indexes.push(row("indexes", { tableName, indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", direction: "A",
      nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES" }));
    catalog.constraints.push(row("constraints", { tableName, constraintName: "PRIMARY", constraintType: "PRIMARY KEY", enforced: "YES" }));
    catalog.keyColumns.push(row("keyColumns", { tableName, constraintName: "PRIMARY", columnName: "id", ordinalPosition: 1 }));
  }
  return catalog;
}

function fixture() {
  const currentCatalog = catalogFixture(), ledgerSnapshot = { present: true, rows: publicPlan
    .filter(item => item.fileName !== ADOPTABLE_MIGRATION.fileName)
    .map(item => ({ migrationName: item.fileName, checksum: item.checksum, status: "baselined" })) };
  const needs = assessExistingLineage({ generalPlan: publicPlan, currentCatalog, ledgerSnapshot, adoption: null });
  const sourceContract = { catalog: clone(currentCatalog), sha256: needs.currentCatalogSha256 };
  const adoption = { version: ADOPTION_VERSION, decision: "structural-adoption-for-delta-gate", approved: true,
    historicalExecutionProven: false, generalRunnerAdmitted: false, generalPlanSha256: GENERAL_PLAN_SHA256,
    migration: { ...ADOPTABLE_MIGRATION }, ledgerSnapshotSha256: needs.ledgerSnapshotSha256, structureContract: sourceContract,
    evidence: { artifactSha256: REHEARSAL_EVIDENCE.artifactSha256, exportReceiptSha256: REHEARSAL_EVIDENCE.exportReceiptSha256 } };
  const lineage = assessExistingLineage({ generalPlan: publicPlan, currentCatalog, ledgerSnapshot, adoption });
  return { lineage, currentCatalog, sourceContract,
    definition: { ...DELTA_DEFINITION, lineageSha256: fingerprint(lineage), sourceContractSha256: sourceContract.sha256 },
    evidence: { ...REHEARSAL_EVIDENCE } };
}

function fulfilled(catalog) {
  const result = clone(catalog);
  for (const column of result.columns) if (column.tableName === TABLE_NAME && COLUMN_CONTRACTS.some(metric => metric.name === column.columnName)) {
    column.isNullable = "YES"; column.columnDefault = null;
  }
  return result;
}
const metric = (catalog, name = "impressions") => catalog.columns.find(column => column.tableName === TABLE_NAME && column.columnName === name);

test("node-e import does not enter CLI mains; candidate contract keeps its isolated-only guard", () => {
  // This node-e context has no script entry path. Ordinary script imports may
  // perform shared CLI-guard realpath identity checks; this test does not claim
  // every import entrypoint is entirely filesystem-free.
  const moduleUrl = new URL("./existingDeltaPlan.mjs", import.meta.url);
  const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; let loaderDepth=0;
    for(const name of ['readFileSync','writeFileSync','openSync','statSync','lstatSync','realpathSync','readdirSync']) {
      const original=fs[name]; fs[name]=(...args)=>{
        if(loaderDepth || new Error().stack.split('\\n')[2]?.includes('node:internal/modules/')) {
          loaderDepth++; try{return original(...args)}finally{loaderDepth--}
        } throw new Error('application-filesystem-called');
      };
    } syncBuiltinESMExports(); await import(${JSON.stringify(moduleUrl.href)}); console.log('INERT');`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000,
    env: { PATH: "/usr/bin:/bin", DATABASE_URL: "mysql://must-not-connect", MYSQL_HOST: "must-not-connect" } });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, "INERT\n"); assert.equal(child.stderr, "");
  const source = fs.readFileSync(moduleUrl, "utf8");
  assert.doesNotMatch(source, /import.*(?:Rehearsal|run-database-migrations|mysql2|dotenv|node:fs)|process\.|mapCatalogSchema|planCampaignNullability\(/);
  const constantSource = fs.readFileSync(new URL("../integration/campaignNullabilityContract.mjs", import.meta.url), "utf8");
  assert.deepEqual([...constantSource.matchAll(/^import .+ from "([^"]+)";/gm)].map(match => match[1]), ["node:crypto", "node:util"]);
  assert.throws(() => planCampaignNullability(catalogFixture(), { scope: "isolated-local-only", defaultPolicy: "align-null-default" }),
    code("NULLABILITY_ISOLATED_SCHEMA_REQUIRED"));
});

test("old state plans exactly the five reviewed clauses under a new explicit ID and leaves all inputs untouched", () => {
  const input = fixture(), before = clone(input), plan = planExistingDelta(input);
  assert.equal(plan.action, "alter"); assert.equal(plan.targetState, "old"); assert.equal(plan.deltaId, DELTA_DEFINITION.deltaId);
  assert.equal(plan.sql, CANDIDATE_SQL); assert.equal(plan.sqlSha256, sha256(CANDIDATE_SQL));
  assert.equal(plan.sqlSha256, "5ef700e8633dc3ce638a42baf4d7df76c54ee00c393e2973ac90ba2cdaeaee75");
  assert.equal(plan.changes.length, 5); assert.deepEqual(plan.allowedFieldChanges, ["isNullable", "columnDefault"]);
  assert.deepEqual(plan.changes.map(change => change.before.columnDefault), ["0", "0", "0.00", "0.00", "0"]);
  assert.equal(plan.defaultPolicy, "align-null-default");
  const { planSha256, ...body } = plan; assert.equal(planSha256, fingerprint(body));
  for (const field of ["databaseExecutionAuthorized", "productionApproved", "registeredMigration", "ledgerWriteAllowed",
    "generalRunnerAdmitted", "historicalExecutionProven", "historicalSqlChanged"]) assert.equal(plan[field], false);
  assert.deepEqual(input, before); assert.ok(!JSON.stringify(plan).includes(secret));
  assert.ok(!plan.deltaId.includes("0196")); assert.ok(!plan.deltaId.endsWith(".sql"));
});

test("all-new state is noop using the same frozen OLD lineage rather than requiring target to equal old adoption", () => {
  const input = fixture(), first = planExistingDelta(input), frozenLineage = clone(input.lineage);
  input.currentCatalog = fulfilled(input.currentCatalog);
  const next = planExistingDelta(input);
  assert.equal(next.action, "noop"); assert.equal(next.sql, null); assert.equal(next.sqlSha256, null); assert.deepEqual(next.changes, []);
  assert.equal(next.candidateSqlSha256, DELTA_DEFINITION.sqlSha256);
  assert.equal(next.currentScopedCatalogSha256, first.expectedAfterScopedCatalogSha256);
  assert.equal(next.currentTableCatalogSha256, first.expectedAfterTableCatalogSha256);
  assert.equal(next.currentFullCatalogSha256, next.expectedAfterFullCatalogSha256);
  assert.equal(next.lineageSha256, first.lineageSha256); assert.deepEqual(input.lineage, frozenLineage);
  assert.notEqual(next.currentScopedCatalogSha256, input.lineage.currentCatalogSha256);
  assert.equal(next.historicalExecutionProven, false); assert.equal(next.databaseExecutionAuthorized, false);
  assert.match(next.limitations.join(" "), /not execution of historical 0196/);
  // A newly self-consistent approval of the NEW target is still not the pinned
  // OLD source prerequisite; noop must not silently replace that source.
  input.sourceContract = { catalog: clone(input.currentCatalog), sha256: next.currentScopedCatalogSha256 };
  input.lineage.currentCatalogSha256 = next.currentScopedCatalogSha256;
  input.definition.sourceContractSha256 = next.currentScopedCatalogSha256;
  input.definition.lineageSha256 = fingerprint(input.lineage);
  assert.throws(() => planExistingDelta(input), code("DELTA_FROZEN_SOURCE_MUST_BE_OLD_STATE"));
});

test("lineage must have the exact admitted evaluation-only shape; a matching replacement hash does not permit changed authority", () => {
  const mutations = [l => l.status = "needs-adoption", l => l.status = "completed", l => l.deltaOnlyAdmitted = false,
    l => l.evaluationOnly = false, l => l.databaseExecutionAuthorized = true, l => l.generalRunnerReady = true,
    l => l.generalRunnerAdmitted = true, l => l.historicalExecutionProven = true, l => l.generalPlanEntries = 167,
    l => l.matchingLedgerEntries = 168, l => l.structuralAdoption.fileName = "0196_history.sql",
    l => l.evidence.artifactSha256 = "a".repeat(64), l => l.missingExecutionProvenance = [], l => l.extraAuthority = true,
    l => l.unmanagedLedgerEntries.push({ migrationName: "x.sql", checksum: "a".repeat(64), status: "failed",
      observationOnly: true, historicalExecutionProven: false, admittedForReplay: false })];
  for (const mutate of mutations) { const input = fixture(); mutate(input.lineage); input.definition.lineageSha256 = fingerprint(input.lineage);
    assert.throws(() => planExistingDelta(input)); }
  const changedHash = fixture(); changedHash.lineage.adoptionSha256 = "f".repeat(64);
  assert.throws(() => planExistingDelta(changedHash), code("DELTA_FROZEN_LINEAGE_HASH_MISMATCH"));
});

test("fixed definition, semantic policy, rehearsal pins and private source hash may not be silently substituted", () => {
  for (const mutate of [d => d.deltaId = "0196_ops_ad_mcp_campaign_metadata_nullable.sql", d => d.defaultPolicy = "preserve-zero",
    d => d.sqlSha256 = "a".repeat(64), d => d.version = "other", d => d.sql = "ALTER TABLE other",
    d => d.sourceContractSha256 = "f".repeat(64), d => d.lineageSha256 = "a".repeat(64)]) {
    const input = fixture(); mutate(input.definition); assert.throws(() => planExistingDelta(input));
  }
  for (const key of Object.keys(REHEARSAL_EVIDENCE)) {
    const input = fixture(); input.evidence[key] = key === "status" ? "failed" : "a".repeat(64);
    assert.throws(() => planExistingDelta(input), code("DELTA_REHEARSAL_EVIDENCE_CHANGED"));
  }
  const source = fixture(); source.sourceContract.catalog.tables[0].tableComment = "tampered";
  assert.throws(() => planExistingDelta(source), code("DELTA_SOURCE_CONTRACT_HASH_MISMATCH"));
  const same = fixture(); same.sourceContract.sha256 = "f".repeat(64);
  assert.throws(() => planExistingDelta(same), code("DELTA_SOURCE_CONTRACT_HASH_MISMATCH"));
});

test("each mixed state and nullable/default mismatch refuses partial repair", () => {
  for (const column of COLUMN_CONTRACTS) {
    const input = fixture(); Object.assign(metric(input.currentCatalog, column.name), { isNullable: "YES", columnDefault: null });
    assert.throws(() => planExistingDelta(input), code("DELTA_MIXED_METRIC_STATE_REFUSED"));
    for (const value of [{ isNullable: "YES", columnDefault: column.defaultValue }, { isNullable: "NO", columnDefault: null },
      { isNullable: "NO", columnDefault: 0 }, { isNullable: "NO", columnDefault: "1" }]) {
      const invalid = fixture(); Object.assign(metric(invalid.currentCatalog, column.name), value);
      assert.throws(() => planExistingDelta(invalid), code("DELTA_METRIC_STATE_UNREVIEWED"));
    }
  }
});

test("full source/target fingerprints retain types, ordinals, precision, default expressions, comments, indexes and all four tables", () => {
  const mutations = [c => metric(c).columnType = "bigint unsigned", c => metric(c).numericPrecision = 20,
    c => metric(c).columnComment = secret, c => metric(c).generationExpression = "1+1", c => metric(c).extra = "INVISIBLE",
    c => c.columns.find(column => column.tableName === TABLE_NAME && column.columnName === "workspaceId").columnDefault = "7",
    c => c.columns.find(column => column.tableName === TABLE_NAME && column.columnName === "workspaceId").columnType = "bigint",
    c => c.tables.find(table => table.tableName === TABLE_NAME).tableComment = "changed",
    c => c.tables.find(table => table.tableName !== TABLE_NAME).tableComment = "other adopted table drift",
    c => c.indexes[0].indexName = "different", c => c.indexes[0].prefixLength = 1,
    c => c.constraints[0].constraintName = "different", c => c.schema[0].collationName = "utf8mb4_bin"];
  for (const state of ["old", "new"]) for (const mutate of mutations) {
    const input = fixture(); if (state === "new") input.currentCatalog = fulfilled(input.currentCatalog);
    mutate(input.currentCatalog); assert.throws(() => planExistingDelta(input));
  }
  for (const collection of Object.keys(DDL_CATALOG)) {
    const input = fixture(); delete input.currentCatalog[collection]; assert.throws(() => planExistingDelta(input));
  }
});

test("dependencies or extra physical fields cannot disappear while scoping the target", () => {
  const input = fixture(); input.currentCatalog.indexes[0].columnName = "impressions";
  assert.throws(() => planExistingDelta(input), code("DELTA_TARGET_DEPENDENCY_UNREVIEWED"));
  const functional = fixture(); functional.currentCatalog.indexes[0].expression = "(impressions+1)";
  assert.throws(() => planExistingDelta(functional), code("DELTA_TARGET_DEPENDENCY_UNREVIEWED"));
  const foreign = fixture();
  for (const [key, rows] of Object.entries(catalogFixture(["outside"]))) if (key !== "schema") foreign.currentCatalog[key].push(...rows);
  foreign.currentCatalog.foreignKeys.push(row("foreignKeys", { tableName: "outside", constraintName: "fk_incoming",
    uniqueConstraintSchema: "existing_fixture", uniqueConstraintName: "PRIMARY", referencedTableName: TABLE_NAME,
    matchOption: "NONE", updateRule: "NO ACTION", deleteRule: "CASCADE" }));
  assert.throws(() => planExistingDelta(foreign), code("DELTA_CROSS_SCOPE_FOREIGN_KEY"));
  const extra = fixture(); metric(extra.currentCatalog).unreviewedAttribute = true; assert.throws(() => planExistingDelta(extra));
});

test("schema and valid counter normalization does not erase auto_increment column attributes or representation drift", () => {
  const input = fixture(), first = planExistingDelta(input); input.currentCatalog.schema[0].schemaName = "different_instance";
  for (const table of input.currentCatalog.tables) table.autoIncrement = "99999999999999999999";
  for (const rows of Object.values(input.currentCatalog)) rows.reverse();
  const second = planExistingDelta(input); assert.equal(second.currentFullCatalogSha256, first.currentFullCatalogSha256);
  for (const value of [0, -1, "__dynamic_positive_auto_increment__", null]) {
    const changed = fixture(); changed.currentCatalog.tables[0].autoIncrement = value; assert.throws(() => planExistingDelta(changed));
  }
  const id = fixture(); id.currentCatalog.columns.find(column => column.tableName === TABLE_NAME && column.columnName === "id").extra = "";
  id.currentCatalog.tables.find(table => table.tableName === TABLE_NAME).autoIncrement = null;
  assert.throws(() => planExistingDelta(id), code("DELTA_UNREVIEWED_STRUCTURAL_DRIFT"));
  const number = fixture(); metric(number.currentCatalog).numericPrecision = 19;
  assert.throws(() => planExistingDelta(number), code("DELTA_UNREVIEWED_STRUCTURAL_DRIFT"));
});

test("additional unrelated tables are explicitly outside comparison but are bound into the supplied full-catalog pre/post hashes", () => {
  const input = fixture(), small = planExistingDelta(input);
  for (const [key, rows] of Object.entries(catalogFixture(["outside"]))) if (key !== "schema") input.currentCatalog[key].push(...rows);
  const wide = planExistingDelta(input);
  assert.equal(wide.currentTableCatalogSha256, small.currentTableCatalogSha256);
  assert.equal(wide.currentScopedCatalogSha256, small.currentScopedCatalogSha256);
  assert.notEqual(wide.currentFullCatalogSha256, small.currentFullCatalogSha256); assert.equal(wide.nonTargetTablesCompared, false);
  assert.ok(!JSON.stringify(wide).includes(secret));
});
