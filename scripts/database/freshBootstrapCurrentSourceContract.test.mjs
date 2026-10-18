// Exact public-source contracts and synthetic execution boundaries only.
// Never connects to a DB, executes SQL, runs models or grants review approval.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test, { before } from "node:test";
import { loadFreshBootstrapPlan, loadStructureContract, sha256, fingerprint, validateStructureContract } from "./freshBootstrapPlan.mjs";
import { buildFreshSourceEquivalenceEvidence } from "./freshBootstrapSourceEquivalenceEvidence.mjs";
import { CURRENT_SOURCE_CONTRACT_PATH, CURRENT_SOURCE_CONTRACT_SHA256, CURRENT_SOURCE_SELECTION,
  assertCurrentSourceReview, compileCurrentSourceContract, loadCurrentSourceContract } from "./freshBootstrapCurrentSourceContract.mjs";
import { main as currentBootstrap, parseArguments } from "../bootstrap-fresh-database-current-source.mjs";
import { main as oldBootstrap, executeFreshBootstrap } from "../bootstrap-fresh-database.mjs";

const root = new URL("../../", import.meta.url), read = path => readFileSync(new URL(path, root), "utf8");
const historicalPath = "drizzle/bootstrap/structure-contract.json", evidencePath = "scripts/database/fixtures/fresh-bootstrap-source-equivalence-20261019.json";
const immutablePaths = ["drizzle/bootstrap/manifest.json", historicalPath, evidencePath, "scripts/run-database-migrations.mjs",
  "drizzle/0230_assistant_configurations.sql", "drizzle/0231_assistant_conversations.sql", "drizzle/0309_integration_profit_analysis.sql"];
const beforeHashes = new Map(immutablePaths.map(path => [path, sha256(read(path))]));
const options = { mode: "execute", execute: true, environment: "ci", schema: "amazon_listing_ci" };
const environment = { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://synthetic:synthetic@127.0.0.1:3306/amazon_listing_ci", RUN_REAL_LLM_TESTS: "0", ALLOW_REAL_NETWORK_IN_TESTS: "0" };
const args = ["--execute", "--contract", CURRENT_SOURCE_SELECTION, "--environment", "ci", "--schema", "amazon_listing_ci"];
const code = expected => error => error.code === expected;
let inputs, compiled;
before(async () => {
  inputs = { descriptorText: read(CURRENT_SOURCE_CONTRACT_PATH), historicalText: read(historicalPath), evidenceText: read(evidencePath),
    rebuiltEvidence: await buildFreshSourceEquivalenceEvidence(), bundle: loadFreshBootstrapPlan() };
  compiled = compileCurrentSourceContract(inputs);
});

test("the independent descriptor binds all 208 current sources and the full unchanged 13-collection historical catalog", () => {
  assert.equal(sha256(inputs.descriptorText), CURRENT_SOURCE_CONTRACT_SHA256);
  assert.equal(compiled.descriptor.sources.length, 208); assert.deepEqual(compiled.descriptor.sources, inputs.bundle.manifest.sources);
  assert.equal(compiled.descriptor.executionScope, "local-or-ci-only"); assert.equal(compiled.descriptor.review.productionApproved, false);
  assert.equal(compiled.descriptor.review.sourceFile, "config/integration/reviews/20261019-current-source-local-ci.json");
  assert.equal(compiled.descriptor.review.newFeatureSchemasApproved, false); assert.equal(compiled.descriptor.review.nativeAcceptance, "not_performed");
  const old = JSON.parse(inputs.historicalText);
  assert.deepEqual(compiled.contract.catalog, old.catalog); assert.equal(Object.keys(compiled.contract.catalog).length, 13);
  assert.equal(compiled.contract.catalog.tables.length, 303); assert.equal(compiled.contract.catalog.columns.length, 5487);
  assert.equal(compiled.contract.catalog.indexes.length, 1627); assert.equal(compiled.contract.catalog.foreignKeys.length, 2);
  assert.equal(compiled.contract.planSha256, old.planSha256); assert.notEqual(compiled.contract.sourcesSha256, old.sourcesSha256);
  assert.equal(fingerprint(compiled.contract), compiled.descriptor.compiledContractSha256);
  assert.deepEqual(validateStructureContract(compiled.contract, inputs.bundle), compiled.contract);
});

test("only the ledger source identity is rebound; ordinals, defaults, source table derivations and all DDL stay unchanged", () => {
  const old = JSON.parse(inputs.historicalText), after = structuredClone(compiled.contract.derivation);
  const change = compiled.descriptor.derivationRebindings; assert.equal(change.length, 1);
  assert.equal(change[0].table, "app_schema_migrations"); assert.equal(change[0].path, "scripts/run-database-migrations.mjs");
  const ledger = after.tables.find(table => table.name === change[0].table);
  assert.equal(ledger.sources.filter(source => source.path === change[0].path).length, 1);
  ledger.sources.find(source => source.path === change[0].path).sha256 = change[0].historicalSha256;
  assert.deepEqual(after, old.derivation); assert.equal(compiled.contract.derivation.temporalDefaultOverlays.length, 176);
  assert.equal(compiled.descriptor.excludedCandidateFiles.length, 3);
  assert.ok(compiled.descriptor.excludedCandidateFiles.every(item => !item.inGeneralPlan && !item.inFreshPlan));
  assert.ok(!compiled.contract.catalog.tables.some(table => table.tableName === "emperor_assistant_configurations"));
});

test("the original entry still rejects its historical binding before loading any connector", async () => {
  assert.throws(() => loadStructureContract(inputs.bundle), code("STRUCTURE_CONTRACT_BINDING_MISMATCH"));
  let loads = 0;
  await assert.rejects(oldBootstrap(["--execute", "--environment", "ci", "--schema", "amazon_listing_ci"], {
    environment, load: async () => { loads++; throw new Error("MUST_NOT_LOAD"); },
  }), code("STRUCTURE_CONTRACT_BINDING_MISMATCH"));
  assert.equal(loads, 0);
});

test("the byte-exact compiled current contract is compatible with the unchanged original executor, not a replacement executor", async () => {
  let loads = 0;
  await assert.rejects(executeFreshBootstrap({ bundle: compiled.bundle, contract: compiled.contract, options, environment }, {
    load: async () => { loads++; throw Object.assign(new Error("SYNTHETIC_STOP_BEFORE_DB"), { code: "SYNTHETIC_STOP_BEFORE_DB" }); },
  }), code("SYNTHETIC_STOP_BEFORE_DB"));
  assert.equal(loads, 1); // No connector or SQL is created by this sentinel.
});

test("new CLI is explicit and remains closed until its independent descriptor decision is approved", async () => {
  const result = await currentBootstrap(["--plan", "--contract", CURRENT_SOURCE_SELECTION], { environment });
  assert.equal(result.databaseConnected, false); assert.equal(result.sqlExecuted, false); assert.equal(result.newFeatureSchemasApproved, false);
  assert.equal(result.reviewStatus, compiled.descriptor.review.status);
  assert.equal(result.executionPermitted, compiled.descriptor.review.status === "approved");
  let loads = 0;
  const load = async () => { loads++; throw Object.assign(new Error("SYNTHETIC_STOP_BEFORE_DB"), { code: "SYNTHETIC_STOP_BEFORE_DB" }); };
  if (compiled.descriptor.review.status === "review_required") {
    assert.throws(() => assertCurrentSourceReview(compiled.descriptor), code("CURRENT_SOURCE_CONTRACT_REVIEW_REQUIRED"));
    await assert.rejects(currentBootstrap(args, { environment, load }), code("CURRENT_SOURCE_CONTRACT_REVIEW_REQUIRED")); assert.equal(loads, 0);
  } else {
    await assert.rejects(currentBootstrap(args, { environment, load }), code("SYNTHETIC_STOP_BEFORE_DB")); assert.equal(loads, 1);
  }
});

test("descriptor changes cannot self-authorize, replace a catalog, grant feature DDL or grant production access", () => {
  for (const mutate of [value => { value.review.status = "approved"; }, value => { value.review.productionApproved = true; },
    value => { value.review.newFeatureSchemasApproved = true; }, value => { value.executionScope = "production"; },
    value => { value.historicalContract.fileSha256 = "0".repeat(64); }, value => { value.equivalence.canonicalSha256 = "0".repeat(64); },
    value => { value.sources.pop(); }, value => { value.derivationRebindings = []; }, value => { value.compiledContractSha256 = "0".repeat(64); }]) {
    const value = JSON.parse(inputs.descriptorText); mutate(value);
    const changed = `${JSON.stringify(value, null, 2)}\n`;
    if (changed !== inputs.descriptorText) assert.throws(() => compileCurrentSourceContract({ ...inputs, descriptorText: changed }), code("CURRENT_SOURCE_CONTRACT_FILE_CHANGED"));
  }
});

test("historical contract and unapproved equivalence bytes cannot be changed or rehashed into permission", () => {
  for (const key of ["historicalText", "evidenceText"]) {
    assert.throws(() => compileCurrentSourceContract({ ...inputs, [key]: inputs[key] + "\n" }), code("CURRENT_SOURCE_EVIDENCE_BYTES_CHANGED"));
    const value = JSON.parse(inputs[key]); value.sourcesSha256 = "0".repeat(64);
    assert.throws(() => compileCurrentSourceContract({ ...inputs, [key]: JSON.stringify(value) }), code("CURRENT_SOURCE_EVIDENCE_BYTES_CHANGED"));
  }
  const proof = structuredClone(inputs.rebuiltEvidence); proof.ciAdmissionGranted = true;
  assert.throws(() => compileCurrentSourceContract({ ...inputs, rebuiltEvidence: proof }));
});

test("current source vector, ordered migration SQL, checksum and flags must all match", () => {
  const mutations = [
    bundle => { bundle.manifest.sources[0].sha256 = "0".repeat(64); },
    bundle => { bundle.manifest.sources.pop(); },
    bundle => { bundle.sourcesSha256 = "0".repeat(64); },
    bundle => { bundle.plan[0].sql += "\n"; },
    bundle => { bundle.plan[0].checksum = "0".repeat(64); },
    bundle => { bundle.plan[0].official = !bundle.plan[0].official; },
    bundle => { bundle.plan.reverse(); },
    bundle => { bundle.plan.push({ ...bundle.plan[0], fileName: "0231_assistant_conversations.sql" }); },
  ];
  for (const mutate of mutations) { const bundle = structuredClone(inputs.bundle); mutate(bundle); assert.throws(() => compileCurrentSourceContract({ ...inputs, bundle })); }
});

test("candidate exclusion, reference statement order, defaults and ledger equality cannot be relaxed", () => {
  const mutations = [
    proof => { proof.freshPlan.excludedCandidateFiles[0].inFreshPlan = true; },
    proof => { proof.freshPlan.excludedCandidateFiles[1].inGeneralPlan = true; },
    proof => { proof.reference.statementSqlSequenceSha256 = "0".repeat(64); },
    proof => { proof.reference.temporalDefaultOverlaysEqual = false; },
    proof => { proof.ledger.literalBytesEqual = false; },
    proof => { proof.currentBinding.exactSourceChanges.pop(); },
  ];
  for (const mutate of mutations) { const rebuiltEvidence = structuredClone(inputs.rebuiltEvidence); mutate(rebuiltEvidence); assert.throws(() => compileCurrentSourceContract({ ...inputs, rebuiltEvidence })); }
});

test("CLI rejects implicit/free-form contract paths, hashes, production and old migration bypass options", () => {
  assert.deepEqual(parseArguments(args), options);
  for (const bad of [[], ["--plan"], ["--contract", CURRENT_SOURCE_SELECTION], ["--plan", "--contract", "/tmp/contract.json"],
    ["--plan", "--contract", CURRENT_SOURCE_SELECTION, "--contract", CURRENT_SOURCE_SELECTION],
    [...args, "--baseline"], [...args, "--retry-failed"], [...args, "--ignore-source"], [...args, "--contract-sha", "0".repeat(64)]]) assert.throws(() => parseArguments(bad));
});

test("remote, production, wrong-schema, implicit-URL and preload targets fail before dependency loading", async () => {
  let loads = 0; const load = async () => { loads++; throw new Error("MUST_NOT_LOAD"); };
  for (const change of [
    { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://synthetic@remote.invalid/amazon_listing_ci", NODE_ENV: "test" },
    { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://synthetic@localhost/amazon_listing_ci" },
    { FRESH_BOOTSTRAP_DATABASE_URL: "mysql://synthetic@127.0.0.1/production" },
    { FRESH_BOOTSTRAP_DATABASE_URL: `${environment.FRESH_BOOTSTRAP_DATABASE_URL}?x=y` },
    { NODE_ENV: "production" }, { NODE_OPTIONS: "--require unsafe" }, { DOTENV_KEY: "synthetic" },
    { DOTENV_CONFIG_PATH: ".env" }, { ALLOW_PRODUCTION_MIGRATIONS: "true" },
  ]) await assert.rejects(currentBootstrap(args, { environment: { ...environment, ...change }, load }));
  await assert.rejects(currentBootstrap(args, { environment: { DATABASE_URL: environment.FRESH_BOOTSTRAP_DATABASE_URL }, load }));
  await assert.rejects(currentBootstrap(args.map(value => value === "ci" ? "production" : value), { environment, load }));
  await assert.rejects(currentBootstrap(args.map(value => value === "amazon_listing_ci" ? "amz_listing" : value), { environment, load }));
  assert.equal(loads, 0);
});

test("local mode accepts only the existing synthetic-schema pattern, independently of NODE_ENV", async () => {
  const schema = "amazon_fresh_0123456789abcdef_synthetic", localArgs = ["--execute", "--contract", CURRENT_SOURCE_SELECTION, "--environment", "local", "--schema", schema];
  let loads = 0;
  const load = async () => { loads++; throw Object.assign(new Error("SYNTHETIC_STOP_BEFORE_DB"), { code: "SYNTHETIC_STOP_BEFORE_DB" }); };
  await assert.rejects(currentBootstrap(localArgs, { environment: { FRESH_BOOTSTRAP_DATABASE_URL: `mysql://synthetic@127.0.0.1/${schema}`, NODE_ENV: "test" }, load }),
    code(compiled.descriptor.review.status === "approved" ? "SYNTHETIC_STOP_BEFORE_DB" : "CURRENT_SOURCE_CONTRACT_REVIEW_REQUIRED"));
  assert.equal(loads, compiled.descriptor.review.status === "approved" ? 1 : 0);
});

test("module import is inert even with production-looking environment", () => {
  const url = new URL("../bootstrap-fresh-database-current-source.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url.href)}); console.log('INERT')`],
    { encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, DATABASE_URL: "mysql://synthetic@remote.invalid/production", NODE_ENV: "production" } });
  assert.equal(result.status, 0); assert.equal(result.stdout, "INERT\n"); assert.equal(result.stderr, "");
});

test("all historical pins remain untouched, and CI explicitly selects only an independently approved contract", async () => {
  const loaded = await loadCurrentSourceContract(); assert.equal(fingerprint(loaded.contract), compiled.descriptor.compiledContractSha256);
  for (const [path, hash] of beforeHashes) assert.equal(sha256(read(path)), hash, path);
  if (compiled.descriptor.review.status === "review_required") {
    assert.doesNotMatch(read(".github/workflows/qa-gate.yml"), /run: .*bootstrap-fresh-database-current-source/u);
  } else {
    const commands = [...read(".github/workflows/qa-gate.yml").matchAll(/run: (.*bootstrap-fresh-database-current-source[^\n]*)/gu)].map(match => match[1]);
    assert.deepEqual(commands, Array(2).fill("node scripts/bootstrap-fresh-database-current-source.mjs --execute --contract current-source-20261019 --environment ci --schema amazon_listing_ci"));
  }
});
