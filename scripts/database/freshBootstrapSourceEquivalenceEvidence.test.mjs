// Actual public-source reconstruction plus negative candidate checks. No DB,
// provider, CI write, SQL execution or execution approval.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test, { before } from "node:test";
import { sha256, loadFreshBootstrapPlan, loadStructureContract, fingerprint } from "./freshBootstrapPlan.mjs";
import { main as bootstrap } from "../bootstrap-fresh-database.mjs";
import { EVIDENCE_PATH, buildFreshSourceEquivalenceEvidence, verifyFreshSourceEquivalenceEvidence,
  main } from "./freshBootstrapSourceEquivalenceEvidence.mjs";

const root = new URL("../../", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");
const fixture = JSON.parse(read(EVIDENCE_PATH));
const manifestBefore = sha256(read("drizzle/bootstrap/manifest.json"));
const contractBefore = sha256(read("drizzle/bootstrap/structure-contract.json"));
const code = expected => error => error.code === expected;
let rebuilt;
before(async () => { rebuilt = await buildFreshSourceEquivalenceEvidence(); });

test("explicit offline reconstruction exactly reproduces the immutable unapproved candidate", () => {
  assert.deepEqual(rebuilt, fixture);
  assert.deepEqual(verifyFreshSourceEquivalenceEvidence(fixture, rebuilt), {
    matched: true, approval: "UNAPPROVED", executable: false, productionApproved: false,
    ciAdmissionGranted: false, databaseConnected: false, sqlExecuted: false,
    evidenceSha256: fingerprint(rebuilt), currentAdmissionRejection: "STRUCTURE_CONTRACT_BINDING_MISMATCH",
  });
});

test("only the two exact source identities differ and all three feature SQL files remain outside both plans", () => {
  assert.deepEqual(rebuilt.currentBinding.exactSourceChanges.map(item => item.path), [
    "drizzle/schema/index.ts", "scripts/run-database-migrations.mjs",
  ]);
  assert.equal(rebuilt.currentBinding.sourceCount, 208);
  assert.equal(rebuilt.currentBinding.runnerReversal.executionPermissionAdded, false);
  assert.equal(rebuilt.generalPlan.count, 168);
  assert.equal(rebuilt.freshPlan.count, 178);
  assert.equal(rebuilt.generalPlan.exactOrderedSqlAndFlagsEqual, true);
  assert.equal(rebuilt.freshPlan.exactOrderedSqlAndFlagsEqual, true);
  assert.deepEqual(rebuilt.freshPlan.excludedCandidateFiles.map(item => item.path), [
    "drizzle/0230_assistant_configurations.sql", "drizzle/0231_assistant_conversations.sql",
    "drizzle/0309_integration_profit_analysis.sql",
  ]);
  assert.ok(rebuilt.freshPlan.excludedCandidateFiles.every(item => !item.inGeneralPlan && !item.inFreshPlan));
  assert.equal(rebuilt.ledger.literalBytesEqual, true);
  assert.equal(rebuilt.ledger.ledgerRowsRead, false);
  assert.equal(rebuilt.ledger.ledgerRowsWritten, false);
  assert.equal(rebuilt.ledger.existingReceiptCompatibilityProven, false);
});

test("all 785 reference statements, 303 derivations, ordinals and 176 temporal defaults are separately hashed", () => {
  assert.equal(rebuilt.reference.statements, 785);
  assert.equal(rebuilt.reference.tables, 303);
  assert.equal(rebuilt.reference.tableDerivationCount, 303);
  assert.equal(rebuilt.reference.changedColumnOrderTables, 159);
  assert.equal(rebuilt.reference.temporalDefaultOverlayCount, 176);
  assert.equal(rebuilt.reference.tableDerivationEqual, true);
  assert.equal(rebuilt.reference.temporalDefaultOverlaysEqual, true);
  for (const [key, value] of Object.entries(rebuilt.reference)) if (key.endsWith("Sha256")) assert.match(value, /^[a-f0-9]{64}$/);
  assert.equal(rebuilt.projection.current.tables, 289);
  assert.equal(rebuilt.projection.historicalBase.tables, 287);
  assert.deepEqual(rebuilt.projection.excludedFromHistoricalBase, [
    "emperor_assistant_configuration_versions", "emperor_assistant_configurations",
  ]);
  assert.equal(rebuilt.historicalCatalogOnly.newlyObservedNativeDatabase, false);
  assert.equal(rebuilt.historicalCatalogOnly.reusedAsCurrentDatabaseOracle, false);
});

test("every authority escalation is refused even when the candidate's remaining hashes match", () => {
  for (const [key, value] of [["approval", "APPROVED"], ["executable", true], ["productionApproved", true],
    ["ciAdmissionGranted", true], ["runtimeResolver", true], ["databaseConnected", true], ["sqlExecuted", true], ["modelInvoked", true]]) {
    const candidate = structuredClone(fixture); candidate[key] = value;
    assert.throws(() => verifyFreshSourceEquivalenceEvidence(candidate, rebuilt), code("EQUIVALENCE_CANDIDATE_AUTHORITY_INVALID"), key);
  }
});

test("source, SQL, ledger, order, defaults, derivation, catalog and omitted-field mutations cannot be hash-refreshed into a match", () => {
  const mutations = [
    candidate => candidate.currentBinding.exactSourceChanges.pop(),
    candidate => candidate.currentBinding.exactSourceChanges[0].currentSha256 = "0".repeat(64),
    candidate => candidate.currentBinding.sourcesSha256 = candidate.currentBinding.historicalSourcesSha256,
    candidate => candidate.generalPlan.fullOrderedTupleSha256 = "0".repeat(64),
    candidate => candidate.freshPlan.fullOrderedTupleSha256 = "0".repeat(64),
    candidate => candidate.freshPlan.excludedCandidateFiles[0].inFreshPlan = true,
    candidate => candidate.ledger.literalSha256 = "0".repeat(64),
    candidate => candidate.ledger.existingReceiptCompatibilityProven = true,
    candidate => candidate.reference.statementSqlSequenceSha256 = "0".repeat(64),
    candidate => candidate.reference.tableDerivationSha256 = "0".repeat(64),
    candidate => candidate.reference.columnOrderSha256 = "0".repeat(64),
    candidate => candidate.reference.temporalDefaultOverlaysSha256 = "0".repeat(64),
    candidate => candidate.projection.excludedFromHistoricalBase.pop(),
    candidate => candidate.historicalCatalogOnly.catalogSha256 = "0".repeat(64),
    candidate => delete candidate.independentAdmissionStillRequired,
    candidate => candidate.unreviewedField = true,
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(fixture); mutate(candidate);
    assert.throws(() => verifyFreshSourceEquivalenceEvidence(candidate, rebuilt), code("EQUIVALENCE_CANDIDATE_CHANGED"));
  }
});

test("import is inert with production-looking environment and never starts evidence generation", () => {
  const moduleUrl = new URL("./freshBootstrapSourceEquivalenceEvidence.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(moduleUrl.href)}); console.log('INERT')`],
    { encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH,
      DATABASE_URL: "mysql://synthetic-secret@remote.invalid/production", NODE_ENV: "production" } });
  assert.equal(result.status, 0); assert.equal(result.stdout, "INERT\n"); assert.equal(result.stderr, "");
});

test("the candidate grants no admission: original initialization still refuses before loading a connector", async () => {
  const bundle = loadFreshBootstrapPlan();
  assert.throws(() => loadStructureContract(bundle), code("STRUCTURE_CONTRACT_BINDING_MISMATCH"));
  let loaded = 0;
  await assert.rejects(bootstrap(["--execute", "--environment", "ci", "--schema", "amazon_listing_ci"], {
    environment: { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://root:root@127.0.0.1:3306/amazon_listing_ci" },
    load: async () => { loaded++; throw new Error("MUST_NOT_LOAD"); },
  }), code("STRUCTURE_CONTRACT_BINDING_MISMATCH"));
  assert.equal(loaded, 0);
  assert.equal(sha256(read("drizzle/bootstrap/manifest.json")), manifestBefore);
  assert.equal(sha256(read("drizzle/bootstrap/structure-contract.json")), contractBefore);
});

test("CLI accepts only explicit verify or print, and verification cannot mutate approval files", async () => {
  for (const args of [[], ["--execute"], ["--approve"], ["--verify", "--execute"], ["--production"], ["--output", "anywhere"]])
    await assert.rejects(main(args), code("EQUIVALENCE_ARGUMENTS_INVALID"));
  const result = await main(["--verify"]);
  assert.equal(result.matched, true); assert.equal(result.executable, false); assert.equal(result.productionApproved, false);
  assert.equal(sha256(read("drizzle/bootstrap/manifest.json")), manifestBefore);
  assert.equal(sha256(read("drizzle/bootstrap/structure-contract.json")), contractBefore);
});
