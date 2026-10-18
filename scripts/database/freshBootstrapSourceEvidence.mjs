// Pure source evidence. Reconstructs one reviewed historical view in memory;
// never changes old pins, approves a contract, imports a runner or executes SQL.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const FRESH_SOURCE_EVIDENCE = Object.freeze({
  runner: "fb98c3b3ba6237b29bfbd5916556054a96d5fb36a25b777378609bd1bdf97e18",
  previousRunner: "3c82d1f5fd0316e7f1f6c5b3b1e80dcd8ace5041931e71b3daf303cd490ad33b",
  historicalRunner: "5ed6ad3b13e14cd7e92f32a31b8398bf83af13643ac64793fb10a2234f5cc638",
  manifest: "4d31befaf7b484899570fce1b217ea4ef72f3f653388e3c86128933f7e56bd14",
  historicalManifest: "ea280d9aee6ab88615725e46f23b1a00d3bbe5f0bd917aadb1661687dcb2bc08",
  index: "83ad4960a3116d5d8274ee4377ae42ef6f7d109c074bbddc72c1ab0534d0104c",
  historicalIndex: "e2990343f4c0ea8b16d21a78e54c696044b45a0cee5159abb7325411fe68ea29",
  currentProjectionSources: "07d0a776f5c6116256a5408bb14c66bb4e98b68f8cf06d22a57b6e2ab7b34678",
  historicalMetadata: "50b58633c982736e9210c9182cd7cbe38d5187c6dc7cb96624d85cfb38b4e85f",
  plan: "a9ef4347a1ad1dfe99b90bfa9a04b10ceb479a1e0a220dbd05634241685fa2f0",
});
export const FRESH_DRAFT_SQL_PINS = Object.freeze({
  "drizzle/0231_assistant_conversations.sql": "104137a6178b5a69ce5c849249e9c27c5c2691349fe2377ef1753657f5ac85e5",
  "drizzle/0309_integration_profit_analysis.sql": "1b681081b730fbfea014357fe11d5f4e0d440fcbc8bd29df4adb20088fd0c8c9",
});
export const FRESH_PARTITION_PINS = Object.freeze({
  "full/source-projection.sql": "6223c0db894742328c76960e9ff5a5a9b54681384df0ac04a7d1721d13ef731b",
  "full/source-projection.metadata.json": "da3637663718515c3db8d0290da4cf09a0e948901c40c891811f9e760e5e13b4",
  "base/source-projection.sql": "c2ea534b048427e7b3b464dd37ec442524cf5e8dd1ec80fac3e514259957a6aa",
  "base/source-projection.metadata.json": "aa771a42d03025adaff67ebbfc93cb6fc8ecad8421a7879447b1e395c2290dbf",
  "delta/source-projection.sql": "b5b29c48c325764949b011784c625f5eed1b33a89ca535fe73a4e3846fb81999",
  "delta/source-projection.metadata.json": "9c07ca49d061d546f2fb948dcdce39f5565f91e6c3acea72ec6afc8f9165c4cc",
});
const RUNNER = "scripts/run-database-migrations.mjs", INDEX = "drizzle/schema/index.ts";
const ASSISTANT = "drizzle/schema/assistantConfigurations.ts";
const hash = value => createHash("sha256").update(value).digest("hex");
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => hash(JSON.stringify(canonical(value)));
function insist(condition, suffix) { if (!condition) throw Object.assign(new Error(`FRESH_SOURCE_EVIDENCE_${suffix}`), { code: `FRESH_SOURCE_EVIDENCE_${suffix}` }); }
function pinned(value, expected) { insist(typeof value === "string" && hash(value) === expected, "SOURCE_CHANGED"); return value; }
function removeOnce(value, fragment) { insist(value.split(fragment).length === 2, "REVERSAL_AMBIGUOUS"); return value.replace(fragment, ""); }
const DECLARATION = '\n// Byte-reviewed feature candidates, not executable migrations. These retain\n'
  + '// their original candidate-only SQL; classification is not release approval.\n'
  + 'const unreleasedFeatureMigrationFiles = new Map([\n'
  + '  ["0231_assistant_conversations.sql", "104137a6178b5a69ce5c849249e9c27c5c2691349fe2377ef1753657f5ac85e5"],\n'
  + '  ["0309_integration_profit_analysis.sql", "1b681081b730fbfea014357fe11d5f4e0d440fcbc8bd29df4adb20088fd0c8c9"],\n'
  + ']);\n';
const CHECK = '  for (const [fileName, checksum] of unreleasedFeatureMigrationFiles) {\n'
  + '    const filePath = join(drizzleDir, fileName);\n'
  + '    if (!existsSync(filePath) || createHash("sha256").update(readFileSync(filePath)).digest("hex") !== checksum) {\n'
  + '      throw new Error(`Unreleased feature migration source changed: ${fileName}`);\n'
  + '    }\n'
  + '    if (files.includes(fileName) || dedicatedMigrationFiles.includes(fileName)\n'
  + '      || imageQualityDevelopmentMigrationFiles.includes(fileName) || imageQualityProductionMigrationFiles.includes(fileName)) {\n'
  + '      throw new Error(`Unreleased feature migration must not be executable: ${fileName}`);\n'
  + '    }\n'
  + '  }\n';

export function reviewFreshRunnerSource(source) {
  pinned(source, FRESH_SOURCE_EVIDENCE.runner);
  let previous = removeOnce(removeOnce(source, DECLARATION), CHECK);
  const filter = '      && !unreleasedDraftMigrationFiles.has(fileName)\n      && !unreleasedFeatureMigrationFiles.has(fileName));';
  insist(previous.split(filter).length === 2, "REVERSAL_AMBIGUOUS");
  previous = previous.replace(filter, '      && !unreleasedDraftMigrationFiles.has(fileName));');
  pinned(previous, FRESH_SOURCE_EVIDENCE.previousRunner);
  const historical = removeOnce(removeOnce(previous, '  "0230_assistant_configurations.sql",\n'),
    '/** Read-only plan registration; no CLI executor or default release activation. */\n'
    + 'export function loadAssistantConfigurationMigrationPlan() {\n'
    + '  return migrationEntries(["0230_assistant_configurations.sql"], 0);\n}\n\n');
  pinned(historical, FRESH_SOURCE_EVIDENCE.historicalRunner);
  return { previous, historical, proof: { version: 1, currentSha256: hash(source), previousSha256: hash(previous),
    historicalSha256: hash(historical), approval: "UNAPPROVED", executionPermissionAdded: false } };
}

/** Only the exact newly reviewed classification may differ from old manifest bytes. */
export function bindFreshRunnerEvidence(manifest, source) {
  pinned(encode(manifest), FRESH_SOURCE_EVIDENCE.manifest);
  const reviewed = reviewFreshRunnerSource(source), result = structuredClone(manifest);
  const entries = result.sources.filter(item => item.path === RUNNER);
  insist(entries.length === 1 && entries[0].sha256 === FRESH_SOURCE_EVIDENCE.previousRunner, "MANIFEST_CHANGED");
  entries[0].sha256 = hash(source);
  return { manifest: result, proof: reviewed.proof };
}

/** Explicit historical base view, not current-source approval or migration input. */
export function buildFreshHistoricalReferenceInput({ bundle, config, projectionSql, projectionMetadata, sourceTexts, indexInventory, partitionFiles }) {
  const runner = reviewFreshRunnerSource(sourceTexts[RUNNER]);
  const previousManifest = structuredClone(bundle.manifest);
  const currentRunner = previousManifest.sources.find(item => item.path === RUNNER);
  insist(currentRunner?.sha256 === FRESH_SOURCE_EVIDENCE.runner && bundle.sourcesSha256 === fingerprint(bundle.manifest.sources), "CURRENT_BINDING_CHANGED");
  currentRunner.sha256 = FRESH_SOURCE_EVIDENCE.previousRunner;
  pinned(encode(previousManifest), FRESH_SOURCE_EVIDENCE.manifest);
  insist(bundle.planSha256 === FRESH_SOURCE_EVIDENCE.plan && bundle.plan.length === 178
    && fingerprint(bundle.plan.map(item => [item.fileName, hash(item.sql)])) === FRESH_SOURCE_EVIDENCE.plan, "PLAN_CHANGED");
  for (const [name, expected] of Object.entries(FRESH_PARTITION_PINS)) pinned(partitionFiles[name], expected);
  for (const [name, expected] of Object.entries(FRESH_DRAFT_SQL_PINS)) pinned(sourceTexts[name], expected);
  pinned(projectionSql, FRESH_PARTITION_PINS["full/source-projection.sql"]);
  const expectedMetadata = JSON.parse(partitionFiles["full/source-projection.metadata.json"]);
  delete expectedMetadata.partition;
  const versions = projectionMetadata?.versions;
  insist(versions && isDeepStrictEqual(Object.keys(versions).sort(), Object.keys(expectedMetadata.versions).sort())
    && Object.values(versions).every(value => typeof value === "string" && value.length > 0 && value.length <= 100), "PROJECTION_METADATA_CHANGED");
  expectedMetadata.versions = versions;
  insist(isDeepStrictEqual(projectionMetadata, expectedMetadata), "PROJECTION_METADATA_CHANGED");
  insist(hash(JSON.stringify(projectionMetadata.sourceFiles)) === FRESH_SOURCE_EVIDENCE.currentProjectionSources, "PROJECTION_SOURCES_CHANGED");
  for (const item of projectionMetadata.sourceFiles) pinned(sourceTexts[item.path], item.sha256);
  for (const item of config.sources) pinned(sourceTexts[item.path], item.path === RUNNER ? FRESH_SOURCE_EVIDENCE.runner : item.sha256);
  let index = pinned(sourceTexts[INDEX], FRESH_SOURCE_EVIDENCE.index);
  index = removeOnce(removeOnce(index, 'export * from "./assistantConfigurations";\n'), 'export * as assistantConfigurationsSchema from "./assistantConfigurations";\n');
  pinned(index, FRESH_SOURCE_EVIDENCE.historicalIndex);
  const historicalSources = { ...sourceTexts, [RUNNER]: runner.historical, [INDEX]: index };
  const historicalManifest = structuredClone(previousManifest);
  for (const item of historicalManifest.sources) if ([RUNNER, INDEX].includes(item.path)) item.sha256 = hash(historicalSources[item.path]);
  pinned(encode(historicalManifest), FRESH_SOURCE_EVIDENCE.historicalManifest);
  const metadata = JSON.parse(partitionFiles["base/source-projection.metadata.json"]); delete metadata.partition;
  metadata.sourceFiles = projectionMetadata.sourceFiles.filter(item => item.path !== ASSISTANT)
    .map(item => item.path === INDEX ? { ...item, sha256: FRESH_SOURCE_EVIDENCE.historicalIndex } : item);
  metadata.sourceSha256 = hash(JSON.stringify(metadata.sourceFiles));
  pinned(encode(metadata), FRESH_SOURCE_EVIDENCE.historicalMetadata);
  const historicalBundle = { ...bundle, manifest: historicalManifest, sourcesSha256: fingerprint(historicalManifest.sources) };
  const proof = { version: 1, kind: "current_sources_to_unchanged_historical_base", approval: "UNAPPROVED", approvedForExecution: false,
    databaseConnected: false, sqlExecuted: false, currentBootstrapSourcesSha256: bundle.sourcesSha256,
    currentProjectionSourcesSha256: projectionMetadata.sourceSha256, currentProjectionMetadataSha256: hash(encode(projectionMetadata)),
    historicalBootstrapSourcesSha256: historicalBundle.sourcesSha256, historicalManifestSha256: hash(encode(historicalManifest)),
    baseSqlSha256: FRESH_PARTITION_PINS["base/source-projection.sql"], fullSqlSha256: hash(projectionSql),
    runner: runner.proof, candidateSql: FRESH_DRAFT_SQL_PINS, planSha256: bundle.planSha256, migrations: bundle.plan.length,
    excludedDedicatedTables: ["emperor_assistant_configuration_versions", "emperor_assistant_configurations"] };
  return { input: { bundle: historicalBundle, config, projectionSql: partitionFiles["base/source-projection.sql"], projectionMetadata: metadata,
    sourceTexts: historicalSources, indexInventory }, proof };
}
