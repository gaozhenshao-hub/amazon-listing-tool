// Read actual public bytes and exercise pure/current source plans only. No DB,
// migration execution, provider call or native acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test, { before } from "node:test";
import { loadMigrationPlan, loadExternalKnowledgeCallerBindingMigrationPlan, loadImageQualityDevelopmentMigrationPlan,
  loadImageQualityProductionMigrationPlan, loadAssistantConfigurationMigrationPlan } from "../run-database-migrations.mjs";
import { parseLiteralRegistry } from "../integration/migrationInventory.mjs";
import { buildProjection, loadReviewedProjectionInputs } from "../integration/sourceProjection.mjs";
import { loadFreshBootstrapPlan, loadStructureContract, sha256, fingerprint, validateStructureContract } from "./freshBootstrapPlan.mjs";
import { assembleReferencePlan, extractLedgerCreate } from "./freshBootstrapReference.mjs";
import { FRESH_SOURCE_EVIDENCE as pins, FRESH_DRAFT_SQL_PINS, FRESH_PARTITION_PINS,
  reviewFreshRunnerSource, bindFreshRunnerEvidence, buildFreshHistoricalReferenceInput } from "./freshBootstrapSourceEvidence.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const text = name => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const runner = text("scripts/run-database-migrations.mjs"), reviewed = reviewFreshRunnerSource(runner);
const manifestText = text("drizzle/bootstrap/manifest.json"), manifest = JSON.parse(manifestText);
const bundle = loadFreshBootstrapPlan(), clone = value => structuredClone(value);
const code = expected => error => error.code === `FRESH_SOURCE_EVIDENCE_${expected}`;
let input;
before(async () => {
  const projection = await buildProjection(await loadReviewedProjectionInputs(root));
  const config = JSON.parse(text("scripts/database/freshBootstrapReference.sources.json"));
  input = { bundle, config, projectionSql: projection.sql, projectionMetadata: projection.metadata,
    sourceTexts: Object.fromEntries([...config.sources, ...projection.metadata.sourceFiles,
      ...Object.keys(FRESH_DRAFT_SQL_PINS).map(path => ({ path }))].map(item => [item.path, text(item.path)])),
    indexInventory: JSON.parse(text("scripts/database/freshBootstrapHistoricalIndexes.sources.json")),
    partitionFiles: Object.fromEntries(Object.keys(FRESH_PARTITION_PINS).map(name => [name,
      text(`scripts/integration/fixtures/assistant-source-projection-partition-20261015/${name}`)])) };
});

test("general runner preserves every one of the 168 ordered names, SQL bytes, checksums and official flags", () => {
  const official = JSON.parse(text("drizzle/meta/_journal.json")).entries.map(entry => `${entry.tag}.sql`);
  const names = [...official, ...parseLiteralRegistry(reviewed.historical, "supplementalMigrations", true)];
  const expected = names.map((fileName, order) => ({ order, fileName, sql: text(`drizzle/${fileName}`),
    checksum: sha256(text(`drizzle/${fileName}`)), official: order < official.length }));
  assert.equal(expected.length, 168);
  assert.deepEqual(loadMigrationPlan().map(({ order, fileName, sql, checksum, official }) => ({ order, fileName, sql, checksum, official })), expected);
  assert.deepEqual(parseLiteralRegistry(runner, "supplementalMigrations", true), parseLiteralRegistry(reviewed.previous, "supplementalMigrations", true));
  assert.deepEqual(extractLedgerCreate(runner), extractLedgerCreate(reviewed.historical));
  assert.equal(bundle.plan.length, 178); assert.equal(bundle.planSha256, pins.plan);
});

test("both exact feature SQL candidates remain immutable and absent from every existing executable plan", () => {
  const candidates = Object.keys(FRESH_DRAFT_SQL_PINS).map(name => name.slice("drizzle/".length));
  for (const [path, hash] of Object.entries(FRESH_DRAFT_SQL_PINS)) assert.equal(sha256(text(path)), hash);
  for (const load of [loadMigrationPlan, loadExternalKnowledgeCallerBindingMigrationPlan, loadImageQualityDevelopmentMigrationPlan,
    loadImageQualityProductionMigrationPlan, loadAssistantConfigurationMigrationPlan]) {
    assert.ok(load().every(item => !candidates.includes(item.fileName)));
  }
  assert.ok(bundle.plan.every(item => !candidates.includes(item.fileName)));
  assert.match(runner, /Unreleased feature migration source changed/);
  assert.match(runner, /Unreleased feature migration must not be executable/);
});

test("classification reversal is byte-exact and cannot forgive an unrelated runner or permission change", () => {
  assert.equal(sha256(reviewed.previous), pins.previousRunner); assert.equal(sha256(reviewed.historical), pins.historicalRunner);
  assert.equal(reviewed.proof.executionPermissionAdded, false); assert.equal(reviewed.proof.approval, "UNAPPROVED");
  for (const altered of [runner + "\n", runner.replace("ALLOW_PRODUCTION_MIGRATIONS", "BYPASS_PRODUCTION_MIGRATIONS"),
    runner.replace("0231_assistant_conversations.sql", "unreviewed.sql"), runner.replace("!== checksum", "=== checksum"),
    runner.replace('    "0205_image_asset_policy.sql",', '    "0205_image_asset_policy.sql",\n    "0231_assistant_conversations.sql",')]) {
    assert.notEqual(altered, runner); assert.throws(() => reviewFreshRunnerSource(altered), code("SOURCE_CHANGED"));
  }
});

test("current source metadata is independently rebound without editing or granting old manifest approval", () => {
  const bound = bindFreshRunnerEvidence(manifest, runner);
  assert.equal(sha256(manifestText), pins.manifest);
  assert.equal(manifest.sources.find(item => item.path === "scripts/run-database-migrations.mjs").sha256, pins.previousRunner);
  assert.equal(bound.manifest.sources.find(item => item.path === "scripts/run-database-migrations.mjs").sha256, pins.runner);
  assert.deepEqual(bound.manifest.structureContract, manifest.structureContract);
  assert.deepEqual(bound.manifest.structureContractAdmission, manifest.structureContractAdmission);
  assert.equal(bundle.sourcesSha256, fingerprint(bound.manifest.sources));
  assert.throws(() => loadStructureContract(bundle), error => error.code === "STRUCTURE_CONTRACT_BINDING_MISMATCH");
  const changed = clone(manifest); changed.sources[0].sha256 = "0".repeat(64);
  assert.throws(() => bindFreshRunnerEvidence(changed, runner), code("SOURCE_CHANGED"));
});

test("actual complete 289-table projection becomes only the proved immutable 287-table base, with separate current evidence", () => {
  const result = buildFreshHistoricalReferenceInput(input), plan = assembleReferencePlan(result.input);
  assert.equal(result.proof.approvedForExecution, false); assert.equal(result.proof.databaseConnected, false); assert.equal(result.proof.sqlExecuted, false);
  assert.equal(input.projectionMetadata.tableCount, 289); assert.equal(result.input.projectionMetadata.tableCount, 287);
  assert.equal(result.input.projectionMetadata.ddlCount, 406);
  assert.equal(sha256(result.input.projectionSql), FRESH_PARTITION_PINS["base/source-projection.sql"]);
  assert.equal(plan.statements.length, 785); assert.equal(plan.tableNames.length, 303);
  assert.equal(plan.statementPlanSha256, "71b5280180ba62d1d226f98a635d8136b6677db0ba3722a96345a20ea51f04a6");
  const old = JSON.parse(text("drizzle/bootstrap/structure-contract.json"));
  assert.deepEqual(validateStructureContract(old, result.input.bundle), old);
  assert.throws(() => validateStructureContract(old, bundle), error => error.code === "STRUCTURE_CONTRACT_BINDING_MISMATCH");
  assert.deepEqual(result.input.bundle.plan, bundle.plan);
  assert.notEqual(result.input.bundle.sourcesSha256, result.proof.currentBootstrapSourcesSha256);
});

test("no table, raw DDL, metadata, source, candidate or plan drift is silently removed by the historical adapter", () => {
  const mutations = [
    value => { value.projectionSql += "\n"; },
    value => { value.projectionMetadata.tableNames.push("unreviewed"); },
    value => { value.projectionMetadata.tableNames.pop(); },
    value => { value.projectionMetadata.sourceFiles[0].sha256 = "0".repeat(64); },
    value => { value.projectionMetadata.sqlExecuted = true; },
    value => { value.sourceTexts["scripts/run-database-migrations.mjs"] += "\n"; },
    value => { value.sourceTexts["drizzle/schema/index.ts"] += 'export * from "./assistantConversations";\n'; },
    value => { value.sourceTexts["drizzle/0231_assistant_conversations.sql"] += "\n"; },
    value => { delete value.sourceTexts["drizzle/0309_integration_profit_analysis.sql"]; },
    value => { value.bundle.plan.reverse(); },
    value => { value.bundle.manifest.structureContract = null; },
  ];
  for (const mutate of mutations) { const changed = clone(input); mutate(changed); assert.throws(() => buildFreshHistoricalReferenceInput(changed)); }
  for (const name of Object.keys(FRESH_PARTITION_PINS)) {
    const changed = clone(input); changed.partitionFiles[name] += "\n";
    assert.throws(() => buildFreshHistoricalReferenceInput(changed), code("SOURCE_CHANGED"));
  }
});

test("only generator tool-version labels may differ while exact full/base SQL and all source identities remain bound", () => {
  const changed = clone(input); changed.projectionMetadata.versions.node = "synthetic-other-node-version";
  const result = buildFreshHistoricalReferenceInput(changed);
  assert.equal(result.proof.baseSqlSha256, FRESH_PARTITION_PINS["base/source-projection.sql"]);
  assert.notEqual(result.proof.currentProjectionMetadataSha256, buildFreshHistoricalReferenceInput(input).proof.currentProjectionMetadataSha256);
  delete changed.projectionMetadata.versions.drizzleKit;
  assert.throws(() => buildFreshHistoricalReferenceInput(changed), code("PROJECTION_METADATA_CHANGED"));
});
