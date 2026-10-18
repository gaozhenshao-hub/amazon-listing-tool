// A separately reviewed local/CI contract. The historical approval and catalog
// remain immutable; this module never opens a database or imports the runner.
import { isDeepStrictEqual } from "node:util";
import { REPOSITORY_ROOT, buildStructureContract, fingerprint, insist, loadFreshBootstrapPlan,
  readPublicFile, sha256, validateStructureContract } from "./freshBootstrapPlan.mjs";
import { buildFreshSourceEquivalenceEvidence, verifyFreshSourceEquivalenceEvidence } from "./freshBootstrapSourceEquivalenceEvidence.mjs";

export const CURRENT_SOURCE_SELECTION = "current-source-20261019";
export const CURRENT_SOURCE_CONTRACT_PATH = "drizzle/bootstrap/current-source-contract.json";
// Root's independent review must change the decision AND this exact byte pin.
// Neither an environment variable nor a CLI path/hash can grant approval.
export const CURRENT_SOURCE_CONTRACT_SHA256 = "8115d6cff116d2675b12b5c81f8e9af2a080724e88b2044ce018b545b19430b3";
const HISTORICAL_PATH = "drizzle/bootstrap/structure-contract.json";
const EVIDENCE_PATH = "scripts/database/fixtures/fresh-bootstrap-source-equivalence-20261019.json";
const RUNNER = "scripts/run-database-migrations.mjs";
const INDEX = "drizzle/schema/index.ts";
const same = (actual, expected, code) => insist(isDeepStrictEqual(actual, expected), code);

/** Pure construction; all external bytes must match the independent descriptor.
 * A returned contract is not execution permission. The review gate is separate.
 */
export function compileCurrentSourceContract({ descriptorText, historicalText, evidenceText, rebuiltEvidence, bundle }) {
  insist(sha256(descriptorText) === CURRENT_SOURCE_CONTRACT_SHA256, "CURRENT_SOURCE_CONTRACT_FILE_CHANGED");
  const descriptor = JSON.parse(descriptorText), historical = JSON.parse(historicalText), evidence = JSON.parse(evidenceText);
  insist(descriptor.version === "amazon-fresh-current-source-contract/1" && descriptor.selection === CURRENT_SOURCE_SELECTION
    && descriptor.executionScope === "local-or-ci-only" && ["review_required", "approved"].includes(descriptor.review.status)
    && descriptor.review.productionApproved === false && descriptor.review.newFeatureSchemasApproved === false
    && descriptor.review.nativeAcceptance === "not_performed", "CURRENT_SOURCE_CONTRACT_SCOPE_INVALID");
  insist(descriptor.historicalContract.path === HISTORICAL_PATH && descriptor.equivalence.path === EVIDENCE_PATH
    && sha256(historicalText) === descriptor.historicalContract.fileSha256
    && sha256(evidenceText) === descriptor.equivalence.fileSha256
    && fingerprint(evidence) === descriptor.equivalence.canonicalSha256, "CURRENT_SOURCE_EVIDENCE_BYTES_CHANGED");
  verifyFreshSourceEquivalenceEvidence(evidence, rebuiltEvidence);
  insist(evidence.currentBinding.sourceCount === 208 && bundle.manifest.sources.length === 208
    && descriptor.sourcesSha256 === bundle.sourcesSha256 && bundle.sourcesSha256 === fingerprint(bundle.manifest.sources)
    && descriptor.sourcesSha256 === evidence.currentBinding.sourcesSha256, "CURRENT_SOURCE_VECTOR_CHANGED");
  same(descriptor.sources, bundle.manifest.sources, "CURRENT_SOURCE_VECTOR_CHANGED");
  same(descriptor.sourceChanges, evidence.currentBinding.exactSourceChanges, "CURRENT_SOURCE_REVERSAL_CHANGED");
  same(descriptor.sourceChanges.map(source => source.path), [INDEX, RUNNER], "CURRENT_SOURCE_REVERSAL_CHANGED");
  insist(bundle.plan.length === descriptor.planLength && descriptor.planLength === 178
    && bundle.planSha256 === descriptor.planSha256 && descriptor.planSha256 === evidence.freshPlan.planSha256
    && fingerprint(bundle.plan.map(item => [item.fileName, sha256(item.sql)])) === descriptor.planSha256
    && fingerprint(bundle.plan.map(({ order, fileName, sql, checksum, official }) => ({ order, fileName, sql, checksum, official })))
      === evidence.freshPlan.fullOrderedTupleSha256, "CURRENT_SOURCE_PLAN_CHANGED");
  same(descriptor.excludedCandidateFiles, evidence.freshPlan.excludedCandidateFiles, "CURRENT_SOURCE_CANDIDATE_ADMISSION_CHANGED");
  insist(descriptor.excludedCandidateFiles.length === 3 && descriptor.excludedCandidateFiles.every(item =>
    item.inFreshPlan === false && item.inGeneralPlan === false && !bundle.plan.some(entry => `drizzle/${entry.fileName}` === item.path)),
  "CURRENT_SOURCE_CANDIDATE_ADMISSION_CHANGED");

  const historicalSources = bundle.manifest.sources.map(source => {
    const change = descriptor.sourceChanges.find(item => item.path === source.path);
    if (!change) return source;
    insist(source.sha256 === change.currentSha256, "CURRENT_SOURCE_REVERSAL_CHANGED");
    return { ...source, sha256: change.historicalSha256 };
  });
  const historicalBundle = { ...bundle, sourcesSha256: fingerprint(historicalSources),
    manifest: { ...bundle.manifest, sources: historicalSources } };
  insist(historicalBundle.sourcesSha256 === descriptor.historicalContract.sourcesSha256
    && historical.catalogSha256 === descriptor.historicalContract.catalogSha256, "CURRENT_SOURCE_HISTORICAL_BINDING_CHANGED");
  validateStructureContract(historical, historicalBundle);

  const derivation = structuredClone(historical.derivation), applied = [];
  for (const table of derivation.tables) for (const source of table.sources) {
    const change = descriptor.sourceChanges.find(item => item.path === source.path);
    if (!change) continue;
    const replacement = { table: table.name, path: source.path,
      historicalSha256: source.sha256, currentSha256: change.currentSha256 };
    insist(table.name === "app_schema_migrations" && source.path === RUNNER
      && source.sha256 === change.historicalSha256, "CURRENT_SOURCE_DERIVATION_REBINDING_INVALID");
    applied.push(replacement); source.sha256 = change.currentSha256;
  }
  same(applied, descriptor.derivationRebindings, "CURRENT_SOURCE_DERIVATION_REBINDING_INVALID");
  insist(applied.length === 1 && evidence.ledger.literalBytesEqual === true, "CURRENT_SOURCE_DERIVATION_REBINDING_INVALID");
  const contract = buildStructureContract({ bundle, catalog: historical.catalog, derivation, platform: historical.platform });
  same(contract.catalog, historical.catalog, "CURRENT_SOURCE_CATALOG_CHANGED");
  insist(fingerprint(contract) === descriptor.compiledContractSha256, "CURRENT_SOURCE_COMPILED_CONTRACT_CHANGED");
  validateStructureContract(contract, bundle);
  return { descriptor, contract, bundle };
}

export function assertCurrentSourceReview(descriptor) {
  insist(descriptor.review.status === "approved", "CURRENT_SOURCE_CONTRACT_REVIEW_REQUIRED");
}

export async function loadCurrentSourceContract() {
  const bundle = loadFreshBootstrapPlan(), read = path => readPublicFile(REPOSITORY_ROOT, path);
  return compileCurrentSourceContract({ descriptorText: read(CURRENT_SOURCE_CONTRACT_PATH), historicalText: read(HISTORICAL_PATH),
    evidenceText: read(EVIDENCE_PATH), rebuiltEvidence: await buildFreshSourceEquivalenceEvidence(), bundle });
}
