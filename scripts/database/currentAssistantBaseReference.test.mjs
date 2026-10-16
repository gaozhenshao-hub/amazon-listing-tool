// Only pinned public text and pure plan reconstruction. No schema evaluation,
// generator CLI, database, environment loader, output directory or Git fallback.
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sha256, fingerprint, validateStructureContract } from "./freshBootstrapPlan.mjs";
import { ARTIFACT_PINS, HELPER_PINS, PINS, VERSION, buildCurrentAssistantBaseReference,
  loadCurrentAssistantBaseInputs, reconstructHistoricalSources, parseArguments, main,
  validateNewOutputPath, assertStableSourceRead } from "./currentAssistantBaseReference.mjs";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const partitionDirectory = path.join(root, "scripts/integration/fixtures/assistant-source-projection-partition-20261015");
const code = suffix => error => error.code === `CURRENT_BASE_${suffix}`;
const clone = value => structuredClone(value), encode = value => `${JSON.stringify(value, null, 2)}\n`;
const loaded = loadCurrentAssistantBaseInputs({ repoRoot: root, partitionDirectory });
const input = loaded.input, originalInput = clone(input);
const output = buildCurrentAssistantBaseReference(input);
const oldContract = JSON.parse(input.historicalContractText), manifest = JSON.parse(input.manifestText);

test("reproduces all 785 historical reference statements and the full historical contract from current public bytes", () => {
  assert.equal(output.candidate.version, VERSION);
  assert.equal(output.sourceRevalidation.comparison.referenceStatements, 785);
  assert.equal(output.sourceRevalidation.comparison.exactHistoricalContractReproduced, true);
  assert.equal(output.sourceRevalidation.comparison.temporalDefaultOverlays, 176);
  assert.equal(output.sourceRevalidation.comparison.bootstrapMigrations, 178);
  assert.equal(output.candidate.contract.derivation.tables.length, 303);
  assert.deepEqual(output.candidate.contract.catalog, oldContract.catalog);
  assert.equal(output.candidate.contract.catalogSha256, PINS.catalog);
  assert.deepEqual(input, originalInput);
});

test("new candidate uses all actual 208 pins and the real 19-source projection, not the reconstructed vector", () => {
  const { contract } = output.candidate, { sourceReview } = output.sourceRevalidation;
  assert.equal(contract.sourcesSha256, PINS.currentSources);
  assert.equal(sourceReview.currentBootstrapSources.length, 208);
  assert.deepEqual(sourceReview.currentBootstrapSources, manifest.sources);
  assert.equal(sourceReview.actualProjectionSources.length, 19);
  assert.equal(contract.derivation.projection.sourceSha256, PINS.currentProjectionSources);
  assert.equal(sourceReview.actualMetadataUsesHistoricalSourceVector, false);
  assert.equal(sourceReview.historicalViewIsCurrentWorkingTree, false);
  assert.equal(contract.derivation.publicSources.length, 198);
  assert.ok(contract.derivation.publicSources.some(item => item.path.endsWith("assistantConfigurations.ts") && item.sha256 === PINS.assistantSchema));
  assert.equal(sha256(encode(sourceReview)), output.sourceRevalidation.sourceReviewSha256);
  assert.equal(sha256(encode(output.candidate)), output.sourceRevalidation.candidateSha256);
  assert.equal(contract.derivation.sourceManifestSha256, output.sourceRevalidation.sourceReviewSha256);
});

test("only ledger table provenance is rebound, without changing the full 303-table catalog or old contract bytes", () => {
  const newTables = output.candidate.contract.derivation.tables;
  const oldTables = oldContract.derivation.tables;
  const changed = newTables.filter((item, index) => JSON.stringify(item) !== JSON.stringify(oldTables[index]));
  assert.deepEqual(changed.map(item => item.name), ["app_schema_migrations"]);
  assert.deepEqual(changed[0].sources, [{ path: "scripts/run-database-migrations.mjs", sha256: PINS.currentRunner }]);
  assert.equal(sha256(readFileSync(path.join(root, "drizzle/bootstrap/structure-contract.json"))), PINS.historicalContract);
  assert.equal(sha256(readFileSync(path.join(root, "scripts/database/freshBootstrapReference.sources.json"))), PINS.referenceManifest);
  assert.equal(sha256(readFileSync(path.join(root, "scripts/database/freshBootstrapHistoricalIndexes.sources.json"))), PINS.indexInventory);
  assert.equal(output.candidate.contract.catalog.columns.length, 5487);
  assert.equal(output.candidate.contract.catalog.indexes.length, 1627);
  assert.equal(Object.keys(output.candidate.contract.catalog).length, 13);
});

test("candidate is explicitly UNAPPROVED and is not a drop-in approved structure contract", () => {
  for (const item of [output.candidate, output.sourceRevalidation]) {
    assert.equal(item.status, "UNAPPROVED"); assert.equal(item.approvedForExecution, false);
  }
  assert.equal(output.candidate.databaseConnected, false);
  assert.equal(output.candidate.sqlExecuted, false);
  assert.equal(output.candidate.nativeExecutions, 0);
  assert.equal(output.candidate.contract.derivation.sourceRevalidation.nativeExecutions, 0);
  assert.equal(output.sourceRevalidation.comparison.oldContractFileModified, false);
  assert.throws(() => validateStructureContract(output.candidate, { planSha256: PINS.plan, sourcesSha256: PINS.currentSources }), /STRUCTURE_CONTRACT_BINDING_MISMATCH/);
  const currentBundle = { manifest, planSha256: PINS.plan, sourcesSha256: PINS.currentSources };
  assert.deepEqual(validateStructureContract(output.candidate.contract, currentBundle), output.candidate.contract);
  assert.throws(() => validateStructureContract(oldContract, currentBundle), /STRUCTURE_CONTRACT_BINDING_MISMATCH/);
});

test("exact reversal removes two export lines, the one draft registration and the one read-only loader", () => {
  const reversed = reconstructHistoricalSources({ indexSource: input.sourceTexts["drizzle/schema/index.ts"], runnerSource: input.sourceTexts["scripts/run-database-migrations.mjs"] });
  assert.equal(sha256(reversed["drizzle/schema/index.ts"]), PINS.historicalIndex);
  assert.equal(sha256(reversed["scripts/run-database-migrations.mjs"]), PINS.historicalRunner);
  assert.doesNotMatch(reversed["scripts/run-database-migrations.mjs"], /0230_assistant_configurations|loadAssistantConfigurationMigrationPlan/);
  const metadata = JSON.parse(input.partitionFiles["base/source-projection.metadata.json"]); delete metadata.partition;
  metadata.sourceFiles = metadata.sourceFiles.filter(item => item.path !== "drizzle/schema/assistantConfigurations.ts")
    .map(item => item.path === "drizzle/schema/index.ts" ? { ...item, sha256: PINS.historicalIndex } : item);
  metadata.sourceSha256 = sha256(JSON.stringify(metadata.sourceFiles));
  assert.equal(sha256(encode(metadata)), PINS.historicalMetadata);
});

test("source changes are not forgiven by a generalized historical rewrite", () => {
  for (const key of ["indexSource", "runnerSource"]) {
    const sources = { indexSource: input.sourceTexts["drizzle/schema/index.ts"], runnerSource: input.sourceTexts["scripts/run-database-migrations.mjs"] };
    sources[key] += "\n";
    assert.throws(() => reconstructHistoricalSources(sources), code("SOURCE_BYTES_CHANGED"));
  }
});

for (const key of ["manifestText", "referenceManifestText", "indexInventoryText", "historicalContractText"]) {
  test(`rejects changed ${key} without repairing its hash`, () => {
    assert.throws(() => buildCurrentAssistantBaseReference({ ...input, [key]: input[key] + "\n" }), code("SOURCE_BYTES_CHANGED"));
  });
}

test("every current 208 source is mandatory, including sources unused by individual table derivations", () => {
  const names = manifest.sources.map(item => item.path);
  for (const name of [names[0], names.at(-1), "drizzle/meta/_journal.json", "scripts/run-database-migrations.mjs", "drizzle/schema/index.ts"]) {
    const changed = { ...input, sourceTexts: { ...input.sourceTexts, [name]: input.sourceTexts[name] + "\n" } };
    assert.throws(() => buildCurrentAssistantBaseReference(changed), code("SOURCE_BYTES_CHANGED"));
    delete changed.sourceTexts[name];
    assert.throws(() => buildCurrentAssistantBaseReference(changed), code("INPUT_SHAPE_INVALID"));
  }
});

test("rejects missing, extra, accessor and repinned source maps before any plan reconstruction", () => {
  const extra = { ...input, sourceTexts: { ...input.sourceTexts, "drizzle/other.sql": "SELECT 1" } };
  assert.throws(() => buildCurrentAssistantBaseReference(extra), code("INPUT_SHAPE_INVALID"));
  const accessor = { ...input, sourceTexts: { ...input.sourceTexts } };
  Object.defineProperty(accessor.sourceTexts, "drizzle/schema/index.ts", { enumerable: true, get() { throw new Error("getter must not run"); } });
  assert.throws(() => buildCurrentAssistantBaseReference(accessor), code("INPUT_SHAPE_INVALID"));
  const changed = JSON.parse(input.manifestText); changed.sources[0].sha256 = "0".repeat(64);
  assert.throws(() => buildCurrentAssistantBaseReference({ ...input, manifestText: encode(changed) }), code("SOURCE_BYTES_CHANGED"));
  assert.throws(() => buildCurrentAssistantBaseReference({ ...input, approved: true }), code("INPUT_SHAPE_INVALID"));
  assert.throws(() => buildCurrentAssistantBaseReference({ ...input, [Symbol("extra")]: true }), code("INPUT_SHAPE_INVALID"));
});

test("the two dedicated sources remain extra reviewed inputs, never migrations in the 178 base", () => {
  for (const name of ["drizzle/schema/assistantConfigurations.ts", "drizzle/0230_assistant_configurations.sql"]) {
    assert.ok(!manifest.sources.some(item => item.path === name));
    assert.throws(() => buildCurrentAssistantBaseReference({ ...input, sourceTexts: { ...input.sourceTexts, [name]: input.sourceTexts[name] + "\n" } }), code("SOURCE_BYTES_CHANGED"));
  }
  assert.ok(output.sourceRevalidation.sourceReview.additionalDedicatedSources.every(item => !manifest.sources.some(source => source.path === item.path)));
  assert.ok(!output.candidate.contract.catalog.tables.some(item => item.tableName.startsWith("emperor_assistant_configuration")));
});

test("each of the seven exact public partition artifacts is bound, not merely the base SQL", () => {
  for (const name of Object.keys(ARTIFACT_PINS)) {
    assert.throws(() => buildCurrentAssistantBaseReference({ ...input, partitionFiles: { ...input.partitionFiles, [name]: input.partitionFiles[name] + "\n" } }), code("SOURCE_BYTES_CHANGED"));
  }
  const missing = { ...input.partitionFiles }; delete missing["partition-receipt.json"];
  assert.throws(() => buildCurrentAssistantBaseReference({ ...input, partitionFiles: missing }), code("INPUT_SHAPE_INVALID"));
});

test("all fourteen existing inert helper source bytes are pinned", () => {
  assert.equal(Object.keys(HELPER_PINS).length, 14);
  for (const name of Object.keys(HELPER_PINS)) {
    assert.equal(sha256(input.helperSourceTexts[name]), HELPER_PINS[name]);
    const changed = { ...input.helperSourceTexts, [name]: input.helperSourceTexts[name] + "\n" };
    assert.throws(() => buildCurrentAssistantBaseReference({ ...input, helperSourceTexts: changed }), code("SOURCE_BYTES_CHANGED"));
  }
});

test("reconstruction is deterministic and the two source vectors remain distinct", () => {
  assert.equal(fingerprint(manifest.sources), PINS.currentSources);
  assert.notEqual(PINS.currentSources, PINS.historicalSources);
  assert.deepEqual(buildCurrentAssistantBaseReference(input), output);
  loaded.assertUnchanged();
});

test("loader is own-checkout only and never treats another tree as historical working bytes", () => {
  assert.throws(() => loadCurrentAssistantBaseInputs({ repoRoot: path.dirname(root), partitionDirectory }), code("OWN_CHECKOUT_REQUIRED"));
  assert.throws(() => loadCurrentAssistantBaseInputs({ repoRoot: root, partitionDirectory: "relative" }), code("PARTITION_DIRECTORY_INVALID"));
  // This changes only caller memory, not any file. The independent closure
  // baseline cannot be modified through the returned input object.
  const detached = loadCurrentAssistantBaseInputs({ repoRoot: root, partitionDirectory });
  detached.input.sourceTexts["drizzle/schema/index.ts"] = "caller changed metadata";
  assert.doesNotThrow(detached.assertUnchanged);
  assert.throws(() => buildCurrentAssistantBaseReference(detached.input), code("SOURCE_BYTES_CHANGED"));
});

test("output validation refuses the checkout and existing directories without writing or removing anything", () => {
  assert.throws(() => validateNewOutputPath(root, root), code("OUTPUT_MUST_BE_OUTSIDE_CHECKOUT"));
  assert.throws(() => validateNewOutputPath(root, path.join(root, "new-output")), code("OUTPUT_MUST_BE_OUTSIDE_CHECKOUT"));
  assert.throws(() => validateNewOutputPath(root, path.dirname(root)), code("OUTPUT_ALREADY_EXISTS"));
  assert.throws(() => validateNewOutputPath(root, "relative"), code("OUTPUT_PATH_INVALID"));
});

test("CLI is explicit candidate-only; help and argument refusal do not enter the exporter", () => {
  const args = ["--repo-root", root, "--partition-directory", partitionDirectory, "--out-dir", "/tmp/fixed-unexecuted-candidate"];
  assert.deepEqual(parseArguments(args), { repoRoot: root, partitionDirectory, outputDirectory: "/tmp/fixed-unexecuted-candidate" });
  for (const invalid of [[], [...args, "--execute"], ["--apply", root, ...args.slice(2)], ["__proto__", root, ...args.slice(2)],
    ["constructor", root, ...args.slice(2)], ["--repo-root", root, "--repo-root", root, ...args.slice(4)]]) {
    assert.throws(() => parseArguments(invalid), code("CLI_ARGUMENTS_INVALID"));
    const refused = main(invalid); assert.equal(refused.exitCode, 1); assert.equal(refused.output.approvedForExecution, false);
  }
  assert.equal(main(["--help"]).exitCode, 0);
});

test("new module has no target import, database entry, environment lookup or Git subprocess fallback", () => {
  const source = readFileSync(new URL("./currentAssistantBaseReference.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bimport\s*\(|\b(?:createConnection|applyMigrations|loadReviewedProjectionInputs|exportSourceProjection|execFileSync|spawnSync)\s*\(/);
  assert.doesNotMatch(source, /process\.env|from ["'][^"']*(?:run-database-migrations|mysql2|dotenv)/);
  assert.match(source, /assembleReferencePlan\(/);
  assert.match(source, /fs\.constants\.O_EXCL/);
  assert.match(source, /fs\.fsyncSync/);
});

const sourceStat = () => ({ dev: 1n, ino: 2n, size: 123n, mtimeNs: 400n, ctimeNs: 500n,
  mode: 0o100644n, uid: 501n, gid: 20n, nlink: 1n });
test("source read permits ctime-only metadata changes without redefining content pins", () => {
  const before = sourceStat();
  assert.doesNotThrow(() => assertStableSourceRead(before, { ...before }, 123));
  assert.doesNotThrow(() => assertStableSourceRead(before, { ...before, ctimeNs: 900n }, 123));
  const name = manifest.sources[0].path;
  assert.throws(() => buildCurrentAssistantBaseReference({ ...input,
    sourceTexts: { ...input.sourceTexts, [name]: input.sourceTexts[name] + "\n" } }), code("SOURCE_BYTES_CHANGED"));
});
test("source read still rejects identity, content-boundary, mtime, permission, owner and link drift", () => {
  for (const key of ["dev", "ino", "size", "mtimeNs", "mode", "uid", "gid", "nlink"]) {
    const before = sourceStat(), after = { ...before, [key]: before[key] + 1n, ctimeNs: before.ctimeNs + 1n };
    assert.throws(() => assertStableSourceRead(before, after, 123), code("INPUT_CHANGED_DURING_READ"), key);
  }
});
test("source read rejects missing or non-bigint metadata even when both sides appear equal", () => {
  for (const key of ["dev", "ino", "size", "mtimeNs", "mode", "uid", "gid", "nlink"]) {
    const missing = sourceStat(); delete missing[key];
    assert.throws(() => assertStableSourceRead(missing, { ...missing }, 123), code("INPUT_CHANGED_DURING_READ"), key);
    const numeric = { ...sourceStat(), [key]: Number(sourceStat()[key]) };
    assert.throws(() => assertStableSourceRead(numeric, { ...numeric }, 123), code("INPUT_CHANGED_DURING_READ"), key);
  }
  for (const value of [null, undefined]) assert.throws(() => assertStableSourceRead(value, sourceStat(), 123), code("INPUT_CHANGED_DURING_READ"));
});
test("source read keeps regular-file, 8MiB, nonzero-link and exact byte-length bounds", () => {
  for (const patch of [{ mode: 0o040755n }, { mode: 0o120777n }, { size: 0n }, { size: 8n * 1024n * 1024n + 1n }, { nlink: 0n }]) {
    const stat = { ...sourceStat(), ...patch };
    assert.throws(() => assertStableSourceRead(stat, { ...stat }, Number(stat.size)), code("INPUT_CHANGED_DURING_READ"));
  }
  for (const length of [122, 124, -1, 123.5, NaN, Infinity, 123n, "123", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertStableSourceRead(sourceStat(), sourceStat(), length), code("INPUT_CHANGED_DURING_READ"));
  }
});
