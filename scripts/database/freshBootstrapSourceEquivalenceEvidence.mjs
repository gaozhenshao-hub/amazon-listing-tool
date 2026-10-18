// One fixed public-source comparison candidate. This is not an admission
// resolver, a migration plan, a database oracle, or permission to reuse a pin.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseLiteralRegistry } from "../integration/migrationInventory.mjs";
import { buildProjection, loadReviewedProjectionInputs } from "../integration/sourceProjection.mjs";
import { REPOSITORY_ROOT, loadFreshBootstrapPlan, loadOfflineGeneralPlan, readPublicFile,
  sha256, fingerprint, validateStructureContract, loadStructureContract } from "./freshBootstrapPlan.mjs";
import { FRESH_SOURCE_EVIDENCE, FRESH_DRAFT_SQL_PINS, FRESH_PARTITION_PINS,
  reviewFreshRunnerSource, buildFreshHistoricalReferenceInput } from "./freshBootstrapSourceEvidence.mjs";
import { assembleReferencePlan, extractLedgerCreate } from "./freshBootstrapReference.mjs";

export const EVIDENCE_PATH = "scripts/database/fixtures/fresh-bootstrap-source-equivalence-20261019.json";
const RUNNER = "scripts/run-database-migrations.mjs";
const INDEX = "drizzle/schema/index.ts";
const MANIFEST = "drizzle/bootstrap/manifest.json";
const CONTRACT = "drizzle/bootstrap/structure-contract.json";
const read = name => readPublicFile(REPOSITORY_ROOT, name);
const requireEvidence = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
const tuple = item => ({ order: item.order, fileName: item.fileName,
  sql: item.sql, checksum: item.checksum, official: item.official });
const sourceDifference = (before, after) => [...new Set([...before, ...after].map(item => item.path))]
  .map(path => ({ path, historicalSha256: before.find(item => item.path === path)?.sha256 ?? null,
    currentSha256: after.find(item => item.path === path)?.sha256 ?? null }))
  .filter(item => item.historicalSha256 !== item.currentSha256).sort((a, b) => a.path.localeCompare(b.path));
const metadataIdentity = metadata => ({ ...metadata,
  versions: Object.fromEntries(Object.keys(metadata.versions).sort().map(key => [key, "__generator_version_label__"])) });

export async function buildFreshSourceEquivalenceEvidence() {
  const manifestText = read(MANIFEST), manifest = JSON.parse(manifestText);
  const contractText = read(CONTRACT), contract = JSON.parse(contractText);
  const runnerText = read(RUNNER), reviewed = reviewFreshRunnerSource(runnerText);
  const bundle = loadFreshBootstrapPlan();
  const projection = await buildProjection(await loadReviewedProjectionInputs(REPOSITORY_ROOT));
  const config = JSON.parse(read("scripts/database/freshBootstrapReference.sources.json"));
  const input = { bundle, config, projectionSql: projection.sql, projectionMetadata: projection.metadata,
    sourceTexts: Object.fromEntries([...config.sources, ...projection.metadata.sourceFiles,
      ...Object.keys(FRESH_DRAFT_SQL_PINS).map(path => ({ path }))].map(item => [item.path, read(item.path)])),
    indexInventory: JSON.parse(read("scripts/database/freshBootstrapHistoricalIndexes.sources.json")),
    partitionFiles: Object.fromEntries(Object.keys(FRESH_PARTITION_PINS).map(name => [name,
      read(`scripts/integration/fixtures/assistant-source-projection-partition-20261015/${name}`)])) };
  const historical = buildFreshHistoricalReferenceInput(input);
  const reference = assembleReferencePlan(historical.input);
  const general = loadOfflineGeneralPlan().map(tuple);
  const official = JSON.parse(read("drizzle/meta/_journal.json")).entries.map(entry => `${entry.tag}.sql`);
  const historicalNames = [...official, ...parseLiteralRegistry(reviewed.historical, "supplementalMigrations", true)];
  const historicalGeneral = historicalNames.map((fileName, order) => {
    const sql = read(`drizzle/${fileName}`);
    return { order, fileName, sql, checksum: sha256(sql), official: order < official.length };
  });
  const exactSourceChanges = sourceDifference(historical.input.bundle.manifest.sources, bundle.manifest.sources);
  requireEvidence(isDeepStrictEqual(exactSourceChanges.map(item => item.path), [INDEX, RUNNER]), "EQUIVALENCE_SOURCE_SET_CHANGED");
  requireEvidence(general.length === 168 && isDeepStrictEqual(general, historicalGeneral), "EQUIVALENCE_GENERAL_PLAN_CHANGED");
  requireEvidence(bundle.plan.length === 178 && isDeepStrictEqual(bundle.plan, historical.input.bundle.plan), "EQUIVALENCE_FRESH_PLAN_CHANGED");
  requireEvidence(isDeepStrictEqual(extractLedgerCreate(runnerText), extractLedgerCreate(reviewed.historical)), "EQUIVALENCE_LEDGER_CHANGED");
  requireEvidence(isDeepStrictEqual(validateStructureContract(contract, historical.input.bundle), contract), "EQUIVALENCE_HISTORICAL_CONTRACT_CHANGED");
  requireEvidence(reference.statementPlanSha256 === contract.derivation.referenceStatementPlanSha256
    && reference.tableNames.length === 303 && reference.statements.length === 785, "EQUIVALENCE_REFERENCE_CHANGED");
  requireEvidence(reference.columnOrderSha256 === contract.derivation.columnOrderSha256
    && isDeepStrictEqual(reference.columnOrderChangedTables, contract.derivation.columnOrderChangedTables)
    && isDeepStrictEqual(reference.temporalDefaultOverlays, contract.derivation.temporalDefaultOverlays)
    && isDeepStrictEqual(reference.derivation.tables, contract.derivation.tables), "EQUIVALENCE_DEFAULT_ORDER_OR_DERIVATION_CHANGED");
  let admissionRejection = null;
  try { loadStructureContract(bundle); } catch (error) { admissionRejection = error.code; }
  requireEvidence(admissionRejection === "STRUCTURE_CONTRACT_BINDING_MISMATCH", "EQUIVALENCE_UNEXPECTED_ADMISSION_STATE");
  const candidates = ["0230_assistant_configurations.sql", ...Object.keys(FRESH_DRAFT_SQL_PINS).map(path => path.slice("drizzle/".length))]
    .map(fileName => ({ path: `drizzle/${fileName}`, sha256: sha256(read(`drizzle/${fileName}`)),
      inGeneralPlan: general.some(item => item.fileName === fileName), inFreshPlan: bundle.plan.some(item => item.fileName === fileName) }));
  requireEvidence(candidates.every(item => !item.inGeneralPlan && !item.inFreshPlan), "EQUIVALENCE_CANDIDATE_BECAME_EXECUTABLE");
  const ledger = extractLedgerCreate(runnerText);
  const ledgerBody = source => /export async function ensureLedger\(connection\)\s*\{\s*await connection\.query\(`([^`]+)`\);\s*\}/.exec(source)?.[1];
  requireEvidence(typeof ledgerBody(runnerText) === "string" && ledgerBody(runnerText) === ledgerBody(reviewed.historical), "EQUIVALENCE_LEDGER_LITERAL_CHANGED");
  return {
    version: "amazon-fresh-source-equivalence-candidate/1", basisCommit: "39bfe532ea388678d690f87dd977c41d73ec06b3",
    approval: "UNAPPROVED", executable: false, productionApproved: false, ciAdmissionGranted: false,
    runtimeResolver: false, databaseConnected: false, sqlExecuted: false, modelInvoked: false,
    scope: "Exact public-source evidence for the existing 178-entry fresh bootstrap only; not approval of new feature schemas or production deployment.",
    historicalApproval: { manifestPath: MANIFEST, manifestFileSha256: sha256(manifestText),
      diskManifestSourcesSha256: fingerprint(manifest.sources), structureContractPin: manifest.structureContract,
      historicalContractPath: CONTRACT, historicalContractFileSha256: sha256(contractText),
      historicalContractSourcesSha256: contract.sourcesSha256, historicalContractPlanSha256: contract.planSha256,
      admissionText: manifest.structureContractAdmission, admissionTextIsNewPermission: false },
    currentBinding: { sourcesSha256: bundle.sourcesSha256, sourceCount: bundle.manifest.sources.length,
      historicalSourcesSha256: historical.input.bundle.sourcesSha256, exactSourceChanges,
      runnerReversal: reviewed.proof, schemaIndexReversal: {
        historicalSha256: FRESH_SOURCE_EVIDENCE.historicalIndex, currentSha256: FRESH_SOURCE_EVIDENCE.index,
        removedOnlyForHistoricalComparison: ['export * from "./assistantConfigurations";',
          'export * as assistantConfigurationsSchema from "./assistantConfigurations";'] },
      currentAdmissionRejection: admissionRejection },
    generalPlan: { count: general.length, exactOrderedSqlAndFlagsEqual: true,
      fullOrderedTupleSha256: fingerprint(general), orderedNameChecksumFlagsSha256: fingerprint(general.map(({ sql, ...item }) => item)) },
    freshPlan: { count: bundle.plan.length, planSha256: bundle.planSha256, exactOrderedSqlAndFlagsEqual: true,
      fullOrderedTupleSha256: fingerprint(bundle.plan.map(tuple)), excludedCandidateFiles: candidates },
    ledger: { table: ledger.tableName, literalBytesEqual: true, literalSha256: sha256(ledgerBody(runnerText)),
      createSqlSha256: ledger.sha256, parsedCreateSha256: fingerprint(ledger),
      ledgerRowsRead: false, ledgerRowsWritten: false, existingReceiptCompatibilityProven: false },
    projection: { current: { tables: projection.metadata.tableCount, ddl: projection.metadata.ddlCount,
      sqlSha256: sha256(projection.sql), sourceSha256: projection.metadata.sourceSha256,
      metadataExceptVersionLabelsSha256: fingerprint(metadataIdentity(projection.metadata)) },
      historicalBase: { tables: historical.input.projectionMetadata.tableCount, ddl: historical.input.projectionMetadata.ddlCount,
        sqlSha256: sha256(historical.input.projectionSql), metadataSha256: sha256(`${JSON.stringify(historical.input.projectionMetadata, null, 2)}\n`) },
      exactPartitionFileSha256: FRESH_PARTITION_PINS,
      excludedFromHistoricalBase: historical.proof.excludedDedicatedTables,
      generatorVersionLabelsAreNotSourceIdentity: true },
    reference: { tables: reference.tableNames.length, statements: reference.statements.length,
      statementPlanSha256: reference.statementPlanSha256, statementSqlSequenceSha256: fingerprint(reference.statements.map(item => item.sql)),
      tableDerivationCount: reference.derivation.tables.length, tableDerivationSha256: fingerprint(reference.derivation.tables),
      tableDerivationEqual: true, expectedColumnsSha256: fingerprint(reference.expectedColumns),
      changedColumnOrderTables: reference.columnOrderChangedTables.length,
      changedColumnOrderTableNamesSha256: fingerprint(reference.columnOrderChangedTables), columnOrderSha256: reference.columnOrderSha256,
      temporalDefaultOverlayCount: reference.temporalDefaultOverlays.length,
      temporalDefaultOverlaysSha256: fingerprint(reference.temporalDefaultOverlays), temporalDefaultOverlaysEqual: true },
    historicalCatalogOnly: { catalogSha256: contract.catalogSha256, collections: Object.keys(contract.catalog).length,
      tables: contract.catalog.tables.length, columns: contract.catalog.columns.length,
      indexParts: contract.catalog.indexes.length, foreignKeys: contract.catalog.foreignKeys.length,
      reusedAsCurrentDatabaseOracle: false, newlyObservedNativeDatabase: false },
    reproduction: { verify: "node scripts/database/freshBootstrapSourceEquivalenceEvidence.mjs --verify",
      tests: "RUN_REAL_LLM_TESTS=0 ALLOW_REAL_NETWORK_IN_TESTS=0 node --test scripts/database/freshBootstrapSourceEquivalenceEvidence.test.mjs",
      printCandidate: "node scripts/database/freshBootstrapSourceEquivalenceEvidence.mjs --print-candidate",
      outputsAreNotExecutionApproval: true },
    independentAdmissionStillRequired: [
      "Review the exact two-source reversal, every ordered migration byte/checksum/official flag, and explicit exclusion of 0230/0231/0309.",
      "Review the independent public reference, complete historical catalog, all 303 derivations, ordinals, 176 temporal defaults and ledger literal; no candidate bootstrap database or production export may supply expectations.",
      "A separately recorded authorized independent decision must name exact source/evidence/contract hashes and local-or-CI-only scope; neither this file nor passing tests grants it.",
      "Any future admission change must preserve historical approval artifacts, fail before connector loading on mutation, and prove fresh initialization, zero-write repeat and actual DB tests separately.",
      "Production schema/data/worker/scheduler/cutover permission and feature migration approval are separate and are not granted by a CI-only decision."
    ]
  };
}

export function verifyFreshSourceEquivalenceEvidence(candidate, rebuilt) {
  requireEvidence(candidate?.approval === "UNAPPROVED" && candidate.executable === false
    && candidate.productionApproved === false && candidate.ciAdmissionGranted === false && candidate.runtimeResolver === false
    && candidate.databaseConnected === false && candidate.sqlExecuted === false && candidate.modelInvoked === false,
  "EQUIVALENCE_CANDIDATE_AUTHORITY_INVALID");
  requireEvidence(isDeepStrictEqual(candidate, rebuilt), "EQUIVALENCE_CANDIDATE_CHANGED");
  return { matched: true, approval: "UNAPPROVED", executable: false, productionApproved: false,
    ciAdmissionGranted: false, databaseConnected: false, sqlExecuted: false,
    evidenceSha256: fingerprint(rebuilt), currentAdmissionRejection: rebuilt.currentBinding.currentAdmissionRejection };
}

export async function main(args) {
  requireEvidence(args.length === 1 && ["--verify", "--print-candidate"].includes(args[0]), "EQUIVALENCE_ARGUMENTS_INVALID");
  const rebuilt = await buildFreshSourceEquivalenceEvidence();
  if (args[0] === "--print-candidate") return rebuilt;
  return verifyFreshSourceEquivalenceEvidence(JSON.parse(readFileSync(new URL("../../" + EVIDENCE_PATH, import.meta.url), "utf8")), rebuilt);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(JSON.stringify({ ok: false, code: /^[A-Z][A-Z0-9_]+$/.test(error.code ?? "")
    ? error.code : "EQUIVALENCE_VERIFICATION_FAILED", approval: "UNAPPROVED", executable: false })); process.exitCode = 1; }
}
