#!/usr/bin/env node
// Source-only, UNAPPROVED evidence. No schema TS, migration runner, dotenv or
// connector is loaded. Historical views are explicit in-memory reconstructions,
// never working-tree replacements or permission to execute an old source vector.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { BOOTSTRAP_FILES, MANUAL_FRESH_FILES, sha256, fingerprint, canonical,
  buildStructureContract, validateStructureContract } from "./freshBootstrapPlan.mjs";
import { assembleReferenceDraft, assembleReferencePlan, constructReferenceContract, splitPublicStatements,
  splitDefinitionList, extractLedgerCreate } from "./freshBootstrapReference.mjs";
import { deriveHistoricalColumnOrder } from "./freshBootstrapColumnOrder.mjs";
import { parseLiteralRegistry } from "../integration/migrationInventory.mjs";
import { selectFreshLineage } from "../integration/freshHistoricalLineage.mjs";
import { validateAssistantProjectionSources, validateAssistantStatementPartition } from "../integration/assistantProjectionPartition.mjs";

export const VERSION = "current-assistant-base-reference/1";
export const PINS = Object.freeze({
  currentManifest: "4d31befaf7b484899570fce1b217ea4ef72f3f653388e3c86128933f7e56bd14",
  historicalManifest: "ea280d9aee6ab88615725e46f23b1a00d3bbe5f0bd917aadb1661687dcb2bc08",
  currentSources: "fb537531cb839f0da61f86050deeea4ea4af89c45395debc10a463ee8b0c282f",
  historicalSources: "2be14b13add4cf878e10956d764080866362a1cf5b7afe6fab6ee40e6af30f7f",
  plan: "a9ef4347a1ad1dfe99b90bfa9a04b10ceb479a1e0a220dbd05634241685fa2f0",
  currentIndex: "83ad4960a3116d5d8274ee4377ae42ef6f7d109c074bbddc72c1ab0534d0104c",
  historicalIndex: "e2990343f4c0ea8b16d21a78e54c696044b45a0cee5159abb7325411fe68ea29",
  currentRunner: "3c82d1f5fd0316e7f1f6c5b3b1e80dcd8ace5041931e71b3daf303cd490ad33b",
  historicalRunner: "5ed6ad3b13e14cd7e92f32a31b8398bf83af13643ac64793fb10a2234f5cc638",
  assistantSchema: "e07c4126be9e5152db9f28ce742291e05290006901ddb37ac2175e06eb66ae2b",
  dedicatedSql: "88b08b6852381336d06af255e25c6dd6a5ed574b7ed27c94b2b86db34fe080e8",
  referenceManifest: "d916af921bcb9ea797f88d32f077bdddd3e78f5a4053f9a65f2c3c02979d43c7",
  indexInventory: "3a0debfa05e99fb4b0b21bb2ae1cbda2d8616324186b5d5e3e752ea5570d5e84",
  historicalContract: "9323498df4ba3c0619a439f1bcf5fba5369cfe9651b1cd657e3ac2de21b2cd8c",
  catalog: "9ffd9dd86e79f9b6df78c3db8a9b12596ef2f203d1f0f3928096bebfcf793d09",
  historicalMetadata: "50b58633c982736e9210c9182cd7cbe38d5187c6dc7cb96624d85cfb38b4e85f",
  historicalProjectionSources: "7b0b730998509d2ba70dc7b771bf5a6233146c58b35d2ef83bf028945a2c1a6f",
  currentProjectionSources: "07d0a776f5c6116256a5408bb14c66bb4e98b68f8cf06d22a57b6e2ab7b34678",
  historicalStatementPlan: "71b5280180ba62d1d226f98a635d8136b6677db0ba3722a96345a20ea51f04a6",
});
export const ARTIFACT_PINS = Object.freeze({
  "partition-receipt.json": "ea10a98024de7acc9897d1da49a629353f355ebc37cd06864de1964708666e01",
  "base/source-projection.sql": "c2ea534b048427e7b3b464dd37ec442524cf5e8dd1ec80fac3e514259957a6aa",
  "base/source-projection.metadata.json": "aa771a42d03025adaff67ebbfc93cb6fc8ecad8421a7879447b1e395c2290dbf",
  "full/source-projection.sql": "6223c0db894742328c76960e9ff5a5a9b54681384df0ac04a7d1721d13ef731b",
  "full/source-projection.metadata.json": "da3637663718515c3db8d0290da4cf09a0e948901c40c891811f9e760e5e13b4",
  "delta/source-projection.sql": "b5b29c48c325764949b011784c625f5eed1b33a89ca535fe73a4e3846fb81999",
  "delta/source-projection.metadata.json": "9c07ca49d061d546f2fb948dcdce39f5565f91e6c3acea72ec6afc8f9165c4cc",
});
// Complete existing static relative-import closure. Deferred executors in these
// inert modules are never invoked. Pins are evidence/drift checks, not a sandbox.
export const HELPER_PINS = Object.freeze(Object.fromEntries([
  ["scripts/database/freshBootstrapColumnOrder.mjs", "8b5a3379fa36e40a42b207796882422bd041807bc3d9344e282ec408c0be391c"],
  ["scripts/database/freshBootstrapPlan.mjs", "c15aa5535aaed413b3f1978ca616e0f3b9ccdcf485f7d73e66e1a3efcc3182fd"],
  ["scripts/database/freshBootstrapReference.mjs", "56fda6f08b1175c7f4698060ffbce038be1a8637df7c951a4545e475b6a096e6"],
  ["scripts/integration/assistantProjectionPartition.mjs", "c03961fb937a4cf1a92041dd363254775d484bf1f44f52c5a3358d8629cfac40"],
  ["scripts/integration/exportProductionDdl.mjs", "8b76a413c0e9e125d57b179d8619373af4012d00c198bb3d4056965346c9167a"],
  ["scripts/integration/freshHistoricalLineage.mjs", "6e255c9c595c77d6308c3e3e264eaac44eac6e6392a4eef07cf7314978ba6c79"],
  ["scripts/integration/historicalPlatformProfile.mjs", "70afd82a28f9fb8172894ec9f75f9186fb32d461c26576a795aa09fcfc282efb"],
  ["scripts/integration/migrationInventory.mjs", "7a06199832cae0b6f805344b080d5c3ada603a1fdf9895813d1bf34d4efbe08b"],
  ["scripts/integration/mysqlRehearsal.mjs", "a1cb2b89e19774179a1b24b5860d7c36d43dc1f6031729b4713f1202651e91bd"],
  ["scripts/integration/mysqlSnapshotRehearsal.mjs", "efe7acdef0124c80f846cd90cef93ab314d9e28e83b6292ccd5baf4eb3d473de"],
  ["scripts/integration/productionStructureRehearsal.mjs", "a38f24787d38a8544f1b82a3801b14c27e837d5b963c4291bed1b6de883167f2"],
  ["scripts/integration/readProductionSchema.mjs", "8445a302469f9bcf622fa46f13ee325d2d4560b86b5d4d5067cd75fb787fc6d2"],
  ["scripts/integration/snapshotDdlNormalization.mjs", "5e89ce706783e7d47c9daefe357f8c887fb774886934e809a8ba8e3ff2541ede"],
  ["scripts/integration/sourceProjection.mjs", "60e61289774894d6cf4e971fdf78547cc96ead5df648289b35b6456eba107984"],
]));
const INDEX = "drizzle/schema/index.ts", RUNNER = "scripts/run-database-migrations.mjs";
const ASSISTANT = "drizzle/schema/assistantConfigurations.ts", DEDICATED = "drizzle/0230_assistant_configurations.sql";
const PUBLIC_FILES = Object.freeze({
  manifestText: ["drizzle/bootstrap/manifest.json", PINS.currentManifest],
  referenceManifestText: ["scripts/database/freshBootstrapReference.sources.json", PINS.referenceManifest],
  indexInventoryText: ["scripts/database/freshBootstrapHistoricalIndexes.sources.json", PINS.indexInventory],
  historicalContractText: ["drizzle/bootstrap/structure-contract.json", PINS.historicalContract],
});
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const fail = suffix => { throw Object.assign(new Error(`CURRENT_BASE_${suffix}`), { code: `CURRENT_BASE_${suffix}` }); };
const insist = (condition, suffix) => { if (!condition) fail(suffix); };
function exactKeys(value, keys) {
  insist(value && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => typeof key === "string")
    && isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...keys].sort())
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => d.enumerable && Object.hasOwn(d, "value")), "INPUT_SHAPE_INVALID");
}
function pinnedText(text, hash) {
  insist(typeof text === "string" && Buffer.byteLength(text) > 0 && Buffer.byteLength(text) <= 8 * 1024 * 1024
    && sha256(text) === hash, "SOURCE_BYTES_CHANGED"); return text;
}
function removeOnce(text, fragment) {
  insist(text.split(fragment).length === 2, "HISTORICAL_REVERSAL_AMBIGUOUS"); return text.replace(fragment, "");
}
export function reconstructHistoricalSources({ indexSource, runnerSource }) {
  pinnedText(indexSource, PINS.currentIndex); pinnedText(runnerSource, PINS.currentRunner);
  const index = removeOnce(removeOnce(indexSource, 'export * from "./assistantConfigurations";\n'),
    'export * as assistantConfigurationsSchema from "./assistantConfigurations";\n');
  const runner = removeOnce(removeOnce(runnerSource, '  "0230_assistant_configurations.sql",\n'),
    '/** Read-only plan registration; no CLI executor or default release activation. */\n'
    + 'export function loadAssistantConfigurationMigrationPlan() {\n'
    + '  return migrationEntries(["0230_assistant_configurations.sql"], 0);\n}\n\n');
  pinnedText(index, PINS.historicalIndex); pinnedText(runner, PINS.historicalRunner);
  insist(isDeepStrictEqual(extractLedgerCreate(runner), extractLedgerCreate(runnerSource)), "LEDGER_CREATE_CHANGED");
  return { [INDEX]: index, [RUNNER]: runner };
}

// Literal registry parsing only; mirrors the existing fresh selector and must
// recover its exact 178-file checksum vector. No runner evaluation or Git fallback.
function deriveBundle(manifest, sources) {
  const journal = JSON.parse(sources["drizzle/meta/_journal.json"]);
  const names = [...journal.entries.map(entry => `${entry.tag}.sql`), ...parseLiteralRegistry(sources[RUNNER], "supplementalMigrations", true)];
  const entry = fileName => ({ fileName, sql: sources[`drizzle/${fileName}`], checksum: sha256(sources[`drizzle/${fileName}`]), official: false });
  const selected = selectFreshLineage(names.map((name, order) => ({ ...entry(name), order, official: order < journal.entries.length })));
  const insertion = selected.plan.findIndex(item => item.fileName === "0195_parent_asin_weekly_mcp_emperor_projection.sql") + 1;
  insist(insertion > 0 && selected.plan[insertion]?.fileName === "0204_listing_revision_governance.sql", "PLAN_INSERTION_CHANGED");
  const [prerequisite, ...tail] = BOOTSTRAP_FILES.map(entry);
  const plan = [prerequisite, ...selected.plan.slice(0, insertion), ...MANUAL_FRESH_FILES.map(entry),
    ...selected.plan.slice(insertion), ...tail].map((item, order) => ({ ...item, order }));
  insist(plan.length === 178 && fingerprint(plan.map(item => [item.fileName, item.checksum])) === PINS.plan
    && manifest.planSha256 === PINS.plan, "PLAN_CHANGED");
  return { version: manifest.version, plan, planSha256: PINS.plan, sourcesSha256: fingerprint(manifest.sources), manifest, excluded: selected.excluded };
}

/** Pure core; all source/receipt inputs are bytes, not a caller-approved boolean. */
export function buildCurrentAssistantBaseReference(input) {
  exactKeys(input, [...Object.keys(PUBLIC_FILES), "sourceTexts", "helperSourceTexts", "partitionFiles"]);
  for (const [key, [, hash]] of Object.entries(PUBLIC_FILES)) pinnedText(input[key], hash);
  const manifest = JSON.parse(input.manifestText), config = JSON.parse(input.referenceManifestText);
  const inventory = JSON.parse(input.indexInventoryText), oldContract = JSON.parse(input.historicalContractText);
  insist(manifest.sources.length === 208 && fingerprint(manifest.sources) === PINS.currentSources, "CURRENT_SOURCE_VECTOR_CHANGED");
  exactKeys(input.sourceTexts, [...manifest.sources.map(item => item.path), ASSISTANT, DEDICATED]);
  for (const item of manifest.sources) pinnedText(input.sourceTexts[item.path], item.sha256);
  pinnedText(input.sourceTexts[ASSISTANT], PINS.assistantSchema); pinnedText(input.sourceTexts[DEDICATED], PINS.dedicatedSql);
  exactKeys(input.helperSourceTexts, Object.keys(HELPER_PINS));
  for (const [name, hash] of Object.entries(HELPER_PINS)) pinnedText(input.helperSourceTexts[name], hash);
  exactKeys(input.partitionFiles, Object.keys(ARTIFACT_PINS));
  for (const [name, hash] of Object.entries(ARTIFACT_PINS)) pinnedText(input.partitionFiles[name], hash);
  const receipt = JSON.parse(input.partitionFiles["partition-receipt.json"]);
  const projections = Object.fromEntries(["full", "base", "delta"].map(member => [member, {
    sql: input.partitionFiles[`${member}/source-projection.sql`], metadata: JSON.parse(input.partitionFiles[`${member}/source-projection.metadata.json`]),
  }]));
  const actualSources = projections.base.metadata.sourceFiles;
  const identity = validateAssistantProjectionSources(actualSources, { dedicatedSql: input.sourceTexts[DEDICATED], assistantSchema: input.sourceTexts[ASSISTANT], indexSource: input.sourceTexts[INDEX] });
  insist(identity.actualSourceSha256 === PINS.currentProjectionSources && isDeepStrictEqual(receipt.actualSourceFiles, actualSources), "PARTITION_SOURCE_CHANGED");
  for (const item of actualSources) pinnedText(input.sourceTexts[item.path], item.sha256);
  for (const [member, projection] of Object.entries(projections)) {
    insist(isDeepStrictEqual(projection.metadata.sourceFiles, actualSources)
      && projection.metadata.sourceSha256 === identity.actualSourceSha256
      && projection.metadata.partition.member === member && projection.metadata.partition.approvedForExecution === false,
    "PARTITION_SOURCE_CHANGED");
  }
  const vectors = validateAssistantStatementPartition(projections);
  insist(vectors.full.length === 408 && vectors.base.length === 406 && vectors.delta.length === 2, "PARTITION_COUNT_CHANGED");
  const reversed = reconstructHistoricalSources({ indexSource: input.sourceTexts[INDEX], runnerSource: input.sourceTexts[RUNNER] });
  const historicalManifest = structuredClone(manifest);
  for (const item of historicalManifest.sources) if (Object.hasOwn(reversed, item.path)) item.sha256 = sha256(reversed[item.path]);
  insist(sha256(encode(historicalManifest)) === PINS.historicalManifest && fingerprint(historicalManifest.sources) === PINS.historicalSources, "HISTORICAL_MANIFEST_CHANGED");
  const historicalTexts = { ...input.sourceTexts, ...reversed };
  for (const item of historicalManifest.sources) pinnedText(historicalTexts[item.path], item.sha256);
  const historicalMetadata = structuredClone(projections.base.metadata); delete historicalMetadata.partition;
  historicalMetadata.sourceFiles = actualSources.filter(item => item.path !== ASSISTANT)
    .map(item => item.path === INDEX ? { ...item, sha256: PINS.historicalIndex } : { ...item });
  historicalMetadata.sourceSha256 = sha256(JSON.stringify(historicalMetadata.sourceFiles));
  insist(sha256(encode(historicalMetadata)) === PINS.historicalMetadata
    && historicalMetadata.sourceSha256 === PINS.historicalProjectionSources, "HISTORICAL_METADATA_CHANGED");
  const currentBundle = deriveBundle(manifest, input.sourceTexts), historicalBundle = deriveBundle(historicalManifest, historicalTexts);
  insist(isDeepStrictEqual(currentBundle.plan, historicalBundle.plan), "HISTORICAL_PLAN_CHANGED");
  validateStructureContract(oldContract, historicalBundle);
  const historicalInput = { bundle: historicalBundle, config, projectionSql: projections.base.sql,
    projectionMetadata: historicalMetadata, sourceTexts: historicalTexts, indexInventory: inventory };
  const oldPlan = assembleReferencePlan(historicalInput);
  insist(oldPlan.statements.length === 785 && oldPlan.statementPlanSha256 === PINS.historicalStatementPlan
    && oldPlan.ordinalValidated === true && oldPlan.temporalDefaultOverlays.length === 176
    && oldPlan.tableNames.length === 303 && oldPlan.expectedIndexes.length === 905, "HISTORICAL_REFERENCE_CHANGED");
  const rebuiltOld = constructReferenceContract({ bundle: historicalBundle, plan: oldPlan, catalog: oldContract.catalog, platform: oldContract.platform });
  insist(isDeepStrictEqual(rebuiltOld, oldContract) && oldContract.catalogSha256 === PINS.catalog, "HISTORICAL_CONTRACT_NOT_REPRODUCED");

  const currentPin = source => ({ ...source, sha256: manifest.sources.find(item => item.path === source.path)?.sha256 ?? source.sha256 });
  const currentStatements = oldPlan.statements.map(statement => ({ ...statement, sources: statement.sources.map(currentPin) }));
  const executableVector = statements => statements.map(({ kind, tableName, sql, sha256: hash }) => ({ kind, tableName, sql, sha256: hash }));
  insist(isDeepStrictEqual(executableVector(currentStatements), executableVector(oldPlan.statements)), "REFERENCE_EXECUTABLE_BYTES_CHANGED");
  // The column-order proof compares against the pre-reordering projection,
  // not the already-corrected plan (which would erase changed-order evidence).
  const draft = assembleReferenceDraft(historicalInput);
  const expectedColumns = Object.fromEntries(Object.entries(draft.expectedColumns).filter(([name]) => name !== "app_schema_migrations"));
  const oldOrder = deriveHistoricalColumnOrder({ bundle: historicalBundle, expectedColumns, splitPublicStatements, splitDefinitionList });
  const currentOrder = deriveHistoricalColumnOrder({ bundle: currentBundle, expectedColumns, splitPublicStatements, splitDefinitionList });
  insist(isDeepStrictEqual({ ...currentOrder, bootstrapSourcesSha256: PINS.historicalSources }, oldOrder)
    && fingerprint(oldOrder) === oldPlan.columnOrderSha256, "COLUMN_ORDER_CHANGED");
  const sourceReview = canonical({
    version: VERSION, approval: "UNAPPROVED", currentBootstrapSources: manifest.sources,
    currentBootstrapSourcesSha256: PINS.currentSources, actualProjectionSources: actualSources,
    actualProjectionSourcesSha256: PINS.currentProjectionSources,
    additionalDedicatedSources: [{ path: ASSISTANT, sha256: PINS.assistantSchema }, { path: DEDICATED, sha256: PINS.dedicatedSql }],
    existingInertHelperSources: Object.entries(HELPER_PINS).map(([name, hash]) => ({ path: name, sha256: hash })),
    partitionArtifacts: Object.entries(ARTIFACT_PINS).map(([name, hash]) => ({ path: name, sha256: hash })),
    historical: { manifestSha256: PINS.historicalManifest, sourcesSha256: PINS.historicalSources,
      contractSha256: PINS.historicalContract, catalogSha256: PINS.catalog, referenceManifestSha256: PINS.referenceManifest,
      indexInventorySha256: PINS.indexInventory, projectionMetadataSha256: PINS.historicalMetadata,
      statementPlanSha256: PINS.historicalStatementPlan, columnOrderSha256: oldPlan.columnOrderSha256 },
    exactReversals: [
      { path: INDEX, currentSha256: PINS.currentIndex, historicalSha256: PINS.historicalIndex, removed: "exact two assistant export lines" },
      { path: RUNNER, currentSha256: PINS.currentRunner, historicalSha256: PINS.historicalRunner, removed: "exact draft registration line and read-only loader block" },
    ], historicalViewIsCurrentWorkingTree: false, actualMetadataUsesHistoricalSourceVector: false,
  });
  const sourceReviewSha256 = sha256(encode(sourceReview));
  const publicSources = [...new Map([...actualSources, ...config.sources.map(currentPin), ...inventory.inputs].map(item => [item.path, item])).values()];
  const derivation = { ...oldPlan.derivation,
    referenceVersion: VERSION, sourceManifestSha256: sourceReviewSha256,
    projection: { sqlSha256: ARTIFACT_PINS["base/source-projection.sql"], sourceSha256: PINS.currentProjectionSources,
      metadataSha256: ARTIFACT_PINS["base/source-projection.metadata.json"], tableCount: 287, ddlCount: 406 },
    publicSources, tables: oldPlan.derivation.tables.map(table => ({ ...table, sources: table.sources.map(currentPin) })),
    columnOrderSha256: fingerprint(currentOrder), referenceStatementPlanSha256: fingerprint(currentStatements),
    sourceRevalidation: { sourceReviewSha256, historicalContractSha256: PINS.historicalContract,
      historicalIndexInventoryUsedOnlyWithReconstructedHistoricalBundle: true,
      executableStatementVectorSha256: fingerprint(executableVector(currentStatements)), executableStatements: 785,
      catalogOrigin: "unchanged historical approved public-source reference; no new native observation",
      approval: "UNAPPROVED", databaseConnected: false, sqlExecuted: false, nativeExecutions: 0 },
  };
  const contract = buildStructureContract({ bundle: currentBundle, catalog: oldContract.catalog, derivation, platform: oldContract.platform });
  validateStructureContract(contract, currentBundle);
  insist(isDeepStrictEqual(contract.catalog, oldContract.catalog) && contract.catalogSha256 === PINS.catalog, "CATALOG_CHANGED");
  insist(publicSources.length === 198 && contract.derivation.tables.filter(table => table.sources.some(item => item.path === RUNNER)).length === 1,
    "CURRENT_DERIVATION_CHANGED");
  const candidate = { version: VERSION, status: "UNAPPROVED", approvedForExecution: false,
    databaseConnected: false, sqlExecuted: false, nativeExecutions: 0, contract };
  const sourceRevalidation = { version: VERSION, status: "UNAPPROVED", approvedForExecution: false,
    candidateSha256: sha256(encode(candidate)), sourceReviewSha256, sourceReview,
    comparison: { sourcePins: 208, changedSourcePins: 2, bootstrapMigrations: 178, referenceStatements: 785,
      tables: 303, columns: 5487, indexParts: 1627, temporalDefaultOverlays: 176, exactHistoricalContractReproduced: true,
      oldContractFileModified: false, all13CatalogCollectionsUnchanged: true, baseSqlWholeBytesUnchanged: true },
    limits: ["This is a candidate, not current-source native acceptance or permission to execute SQL.",
      "The historical 208-source view is never passed to a current runner or treated as current working bytes.",
      "Old manifest, contract, index inventory and default contract loader remain untouched and fail closed on current binding drift.",
      "Independent source review and explicit approval/evidence reuse are still required; 0230 remains a separate opt-in native gate.",
      "Producer byte authentication is external; the fourteen existing helper pins do not self-approve this new module.",
      "Filesystem rechecks detect drift; they are not a hostile-code import sandbox."] };
  return { candidate, sourceRevalidation };
}

// ctime also changes for filesystem hydration/metadata maintenance. It is not
// content authority here: every supplied source is whole-file hash pinned and
// independently rehashed after construction. These checks detect drift, not
// hostile swap-and-restore attacks, and do not sandbox any imported helper.
export function assertStableSourceRead(before, after, byteLength) {
  const fields = ["dev", "ino", "size", "mtimeNs", "mode", "uid", "gid", "nlink"];
  insist(before && after && fields.every(key => typeof before[key] === "bigint"
    && typeof after[key] === "bigint" && before[key] === after[key])
    && (before.mode & 0o170000n) === 0o100000n
    && before.size > 0n && before.size <= 8n * 1024n * 1024n && before.nlink > 0n
    && Number.isSafeInteger(byteLength) && byteLength >= 0 && BigInt(byteLength) === before.size,
  "INPUT_CHANGED_DURING_READ");
}
function readRegular(filename) {
  insist(path.isAbsolute(filename) && path.normalize(filename) === filename && fs.realpathSync(filename) === filename, "INPUT_PATH_INVALID");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    insist(before.isFile() && before.size > 0n && before.size <= 8n * 1024n * 1024n, "INPUT_FILE_INVALID");
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true });
    assertStableSourceRead(before, after, bytes.length);
    const text = bytes.toString("utf8"); insist(Buffer.from(text).equals(bytes), "INPUT_UTF8_INVALID"); return text;
  } finally { fs.closeSync(fd); }
}
export function loadCurrentAssistantBaseInputs({ repoRoot, partitionDirectory }) {
  const ownRoot = fs.realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
  insist(typeof repoRoot === "string" && fs.realpathSync(repoRoot) === ownRoot, "OWN_CHECKOUT_REQUIRED");
  insist(typeof partitionDirectory === "string" && path.isAbsolute(partitionDirectory)
    && path.normalize(partitionDirectory) === partitionDirectory && fs.realpathSync(partitionDirectory) === partitionDirectory
    && fs.lstatSync(partitionDirectory).isDirectory(), "PARTITION_DIRECTORY_INVALID");
  const observed = new Map();
  const read = filename => { const value = readRegular(filename); observed.set(filename, sha256(value)); return value; };
  const input = Object.fromEntries(Object.entries(PUBLIC_FILES).map(([key, [name, hash]]) => [key, pinnedText(read(path.join(ownRoot, name)), hash)]));
  const manifest = JSON.parse(input.manifestText);
  const sources = [...manifest.sources, { path: ASSISTANT, sha256: PINS.assistantSchema }, { path: DEDICATED, sha256: PINS.dedicatedSql }];
  input.sourceTexts = Object.fromEntries(sources.map(item => [item.path, pinnedText(read(path.join(ownRoot, item.path)), item.sha256)]));
  input.helperSourceTexts = Object.fromEntries(Object.entries(HELPER_PINS).map(([name, hash]) => [name, pinnedText(read(path.join(ownRoot, name)), hash)]));
  input.partitionFiles = Object.fromEntries(Object.entries(ARTIFACT_PINS).map(([name, hash]) => [name, pinnedText(read(path.join(partitionDirectory, name)), hash)]));
  read(fileURLToPath(import.meta.url));
  // The closure owns the independent baseline. No returned mutable map can
  // redefine freshness. No generation, import, SQL or write occurs in this API.
  const baseline = [...observed.entries()];
  const assertUnchanged = () => { for (const [filename, hash] of baseline) insist(sha256(readRegular(filename)) === hash, "SOURCE_CHANGED_DURING_BUILD"); };
  assertUnchanged(); return { input, assertUnchanged };
}
export function validateNewOutputPath(repoRoot, outputDirectory) {
  insist(typeof outputDirectory === "string" && path.isAbsolute(outputDirectory) && path.normalize(outputDirectory) === outputDirectory, "OUTPUT_PATH_INVALID");
  const relative = path.relative(repoRoot, outputDirectory);
  insist(relative && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), "OUTPUT_MUST_BE_OUTSIDE_CHECKOUT");
  insist(fs.realpathSync(path.dirname(outputDirectory)) === path.dirname(outputDirectory), "OUTPUT_PARENT_SYMLINK");
  insist(!fs.existsSync(outputDirectory), "OUTPUT_ALREADY_EXISTS"); return outputDirectory;
}
export function exportCurrentAssistantBaseReference({ repoRoot, partitionDirectory, outputDirectory }) {
  const root = fs.realpathSync(repoRoot), target = validateNewOutputPath(root, outputDirectory);
  const loaded = loadCurrentAssistantBaseInputs({ repoRoot: root, partitionDirectory });
  const result = buildCurrentAssistantBaseReference(loaded.input); loaded.assertUnchanged();
  fs.mkdirSync(target, { mode: 0o700 });
  const write = (name, value) => {
    const filename = path.join(target, name), bytes = encode(value);
    const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    insist(readRegular(filename) === bytes, "OUTPUT_READBACK_FAILED"); return sha256(bytes);
  };
  const candidateSha256 = write("current-base303.candidate.json", result.candidate);
  const sourceRevalidationSha256 = write("source-revalidation.json", result.sourceRevalidation);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  loaded.assertUnchanged();
  return { status: "UNAPPROVED", approvedForExecution: false, databaseConnected: false, sqlExecuted: false, nativeExecutions: 0,
    candidateSha256, sourceRevalidationSha256, catalogSha256: PINS.catalog, tables: 303, referenceStatements: 785 };
}
export function parseArguments(args) {
  if (isDeepStrictEqual(args, ["--help"])) return { help: true };
  const flags = { "--repo-root": "repoRoot", "--partition-directory": "partitionDirectory", "--out-dir": "outputDirectory" }, result = {};
  insist(Array.isArray(args) && args.length === 6, "CLI_ARGUMENTS_INVALID");
  for (let index = 0; index < args.length; index += 2) {
    const key = Object.hasOwn(flags, args[index]) ? flags[args[index]] : null, value = args[index + 1];
    insist(key && !Object.hasOwn(result, key) && typeof value === "string" && path.isAbsolute(value)
      && path.normalize(value) === value && !value.includes("\0"), "CLI_ARGUMENTS_INVALID"); result[key] = value;
  }
  return result;
}
export function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) return { exitCode: 0, output: { status: "HELP", approvedForExecution: false,
      usage: "node scripts/database/currentAssistantBaseReference.mjs --repo-root <this checkout> --partition-directory <pinned public partition> --out-dir <new directory outside checkout>" } };
    return { exitCode: 0, output: exportCurrentAssistantBaseReference(options) };
  } catch (error) {
    return { exitCode: 1, output: { status: "REFUSED_OR_INCOMPLETE", approvedForExecution: false, databaseConnected: false, sqlExecuted: false,
      error: /^CURRENT_BASE_[A-Z_]+$/.test(error?.code ?? "") ? error.code : "CURRENT_BASE_GENERATION_FAILED",
      partialOutputMayRemain: true, automaticRetryOrCleanup: false } };
  }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const result = main(process.argv.slice(2)); process.stdout.write(`${JSON.stringify(result.output)}\n`); process.exitCode = result.exitCode;
}
