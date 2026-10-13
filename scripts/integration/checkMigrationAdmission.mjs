#!/usr/bin/env node
// Checks a declarative review manifest only. A passing receipt never admits SQL
// to the runner and never constitutes production or database-test approval.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PINNED_REVISIONS, compareInventories, parseArguments, readPinnedSnapshot } from "./migrationInventory.mjs";

const MANIFEST = new URL("../../config/integration/migration-admission.json", import.meta.url);
const REQUIRED = Object.freeze({
  "drizzle/0202_kb_image_schema_forward_repair.sql": ["check:kb-schema"],
  "drizzle/0203_saihu_daily_import.sql": ["check:weekly-facts"],
  "drizzle/0204_ops_cost_sheets.sql": ["check:financial-facts"],
  "drizzle/0205_image_session_missing_fields.sql": ["check:image-session-schema"],
  "drizzle/0206_acquisition_job_soft_delete.sql": ["check:acquisition-schema"],
  "drizzle/0207_competitor_bilingual_text.sql": ["check:competitor-schema"],
  "drizzle/0208_image_tag_training.sql": ["check:agent-governance"],
  "drizzle/0210_agent_library.sql": ["check:agent-governance", "drizzle/0208_image_tag_training.sql"],
  "drizzle/0211_ops_monthly_profit_imports.sql": ["check:financial-facts", "check:storage"],
  "drizzle/0211_profit_analysis.sql": ["check:financial-facts", "check:agent-governance", "drizzle/0211_ops_monthly_profit_imports.sql", "drizzle/0210_agent_library.sql"],
  "drizzle/0212_saihu_api_config.sql": ["check:secret-governance"],
  "drizzle/0213_saihu_connection.sql": ["check:secret-governance", "drizzle/0212_saihu_api_config.sql"],
  "drizzle/0214_saihu_schedule.sql": ["check:scheduler-governance", "drizzle/0213_saihu_connection.sql", "drizzle/0203_saihu_daily_import.sql", "drizzle/0211_ops_monthly_profit_imports.sql"],
  "drizzle/0215_ops_profit_board.sql": ["check:financial-facts", "drizzle/0211_ops_monthly_profit_imports.sql"],
  "drizzle/0223_inventory_snapshot.sql": ["check:inventory-semantics", "drizzle/0214_saihu_schedule.sql"],
  "scripts/migrate-listing-files.cjs": ["check:listing-facts", "check:storage"],
  "scripts/migrate-ops-task-board.cjs": ["check:task-board-schema", "check:storage"],
  "scripts/repair-image-session-schema.cjs": ["check:image-session-schema", "drizzle/0205_image_session_missing_fields.sql"],
});
const COMMON = ["check:schema-ledger", "check:workspace-identity"];
const DEFERRED = new Set(["scripts/migrate-ops-task-board.cjs", "scripts/repair-image-session-schema.cjs"]);
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const sorted = values => [...new Set(values)].sort();
const sameSet = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

export function checkAdmission(manifest, baseline, source) {
  const issues = [];
  const add = (code, path) => issues.push({ code, ...(Object.hasOwn(REQUIRED, path) ? { sourcePath: path } : {}) });
  if (!manifest || manifest.schemaVersion !== 1 || manifest.mode !== "reservation-only" || manifest.reviewStage !== "P1" || manifest.productionApproved !== false || manifest.databaseVerified !== false) add("REVIEW_ONLY_BOUNDARY_REQUIRED");
  if (baseline.commit !== PINNED_REVISIONS.baseline || source.commit !== PINNED_REVISIONS.source || manifest?.sourceRevisions?.baseline !== PINNED_REVISIONS.baseline || manifest?.sourceRevisions?.source !== PINNED_REVISIONS.source) add("PINNED_REVISION_MISMATCH");
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  const checks = Array.isArray(manifest?.checks) ? manifest.checks : [];
  const expectedSql = compareInventories(baseline, source).sourceOnly;
  const expected = new Map(expectedSql.map(name => {
    const file = source.files.find(item => item.name === name);
    return [`drizzle/${name}`, { hash: file.sha256, registration: file.inGeneralPlan ? "general" : "unregistered" }];
  }));
  for (const path of Object.keys(REQUIRED).filter(path => path.startsWith("scripts/"))) {
    const warning = source.standaloneScriptWarnings.find(item => item.path === path);
    if (!warning) add("PINNED_SCRIPT_NOT_IN_INVENTORY", path);
    else expected.set(path, { hash: warning.sha256, registration: "standalone-ddl" });
  }
  // Pins and reviewed constraints must evolve together; do not invent dependencies
  // for a newly discovered SQL file and call the resulting graph verified.
  if (!sameSet([...expected.keys()], Object.keys(REQUIRED))) add("REVIEWED_SOURCE_SET_CHANGED");
  const expectedChecks = sorted([...COMMON, ...Object.values(REQUIRED).flat()].filter(ref => ref.startsWith("check:")));
  if (!sameSet(checks.map(check => check?.id), expectedChecks)) add("CHECK_CATALOG_INCOMPLETE");
  const seenChecks = new Set();
  for (const check of checks) {
    if (!check || seenChecks.has(check.id) || check.status !== "pending" || !nonempty(check.description)) add("CHECK_MUST_BE_UNIQUE_AND_PENDING");
    seenChecks.add(check?.id);
  }
  const deny = Array.isArray(manifest?.denyReplay) ? manifest.denyReplay : [];
  const historical = baseline.files.filter(file => /^(019[6-9]|020[01])_/.test(file.name) && file.memberships.includes("legacy-manually-released")).map(file => file.name);
  if (historical.length !== 6 || deny.length !== 6 || !sameSet(deny, historical)) add("HISTORICAL_REPLAY_DENYLIST_INCOMPLETE");

  const existingFiles = new Set([...baseline.files, ...source.files].map(file => file.name));
  const existingNumbers = new Set([...baseline.files, ...source.files].map(file => file.number));
  const seenPaths = new Set(), targets = new Set(), numbers = new Set();
  const byPath = new Map(entries.filter(entry => entry && typeof entry === "object").map(entry => [entry.sourcePath, entry]));
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !expected.has(entry.sourcePath)) { add("UNEXPECTED_OR_HISTORICAL_ENTRY"); continue; }
    const path = entry.sourcePath, ref = expected.get(path);
    if (seenPaths.has(path)) add("DUPLICATE_SOURCE_ENTRY", path);
    seenPaths.add(path);
    if (entry.sourceSha256 !== ref.hash) add("SOURCE_HASH_MISMATCH", path);
    if (entry.sourceRegistration !== ref.registration) add("REGISTRATION_STATUS_MISMATCH", path);
    if (!nonempty(entry.module) || !nonempty(entry.recommendation) || !nonempty(entry.dependencyBasis) || !/^P[2-6]$/.test(entry.targetPhase)) add("ENTRY_REVIEW_METADATA_REQUIRED", path);
    if (entry.structureVerification !== "pending") add("SCHEMA_MUST_REMAIN_UNVERIFIED", path);
    if (DEFERRED.has(path)) {
      if (entry.reservedFile !== null || entry.disposition !== "defer-deduplicate") add("DUPLICATE_DDL_MUST_BE_DEFERRED", path);
    } else {
      const match = typeof entry.reservedFile === "string" && /^(03\d{2})_integration_[a-z0-9_]+\.sql$/.exec(entry.reservedFile);
      if (!match) add("RESERVATION_NAME_INVALID", path);
      else {
        if (targets.has(entry.reservedFile) || numbers.has(match[1])) add("DUPLICATE_RESERVATION", path);
        if (existingFiles.has(entry.reservedFile) || existingNumbers.has(match[1])) add("RESERVATION_COLLIDES_WITH_SNAPSHOT", path);
        targets.add(entry.reservedFile); numbers.add(match[1]);
      }
    }
    const deps = Array.isArray(entry.dependsOn) ? entry.dependsOn : [];
    if (deps.length !== new Set(deps).size) add("DUPLICATE_DEPENDENCY", path);
    for (const required of [...COMMON, ...(REQUIRED[path] ?? [])]) if (!deps.includes(required)) add("REQUIRED_DEPENDENCY_MISSING", path);
    for (const dep of deps) {
      if (typeof dep !== "string" || (!seenChecks.has(dep) && !byPath.has(dep))) add("DEPENDENCY_REFERENCE_MISSING", path);
      const predecessor = byPath.get(dep);
      if (predecessor && Number(predecessor.targetPhase?.slice(1)) > Number(entry.targetPhase?.slice(1))) add("DEPENDENCY_PHASE_INVERSION", path);
    }
  }
  for (const path of expected.keys()) if (!seenPaths.has(path)) add("SOURCE_ENTRY_MISSING", path);
  for (const file of source.unregisteredSql) {
    if (byPath.get(`drizzle/${file}`)?.sourceRegistration !== "unregistered") add("UNREGISTERED_SQL_NOT_TRACKED", `drizzle/${file}`);
  }
  const active = new Set(), done = new Set();
  function visit(path) {
    if (active.has(path)) { add("DEPENDENCY_CYCLE", path); return; }
    if (done.has(path)) return;
    active.add(path);
    const dependencies = byPath.get(path)?.dependsOn;
    for (const dep of Array.isArray(dependencies) ? dependencies : []) if (byPath.has(dep)) visit(dep);
    active.delete(path); done.add(path);
  }
  // Malformed dependsOn is already rejected above; never iterate arbitrary data.
  for (const [path, entry] of byPath) if (Array.isArray(entry.dependsOn)) visit(path);
  const baselineScripts = new Map(baseline.standaloneScriptWarnings.map(item => [item.path, item.sha256]));
  const additionalStandaloneWarnings = source.standaloneScriptWarnings
    .filter(item => item.createsTables.length && baselineScripts.get(item.path) !== item.sha256 && !expected.has(item.path))
    .map(item => ({ path: item.path, sha256: item.sha256, status: "unreviewed-static-warning" }));
  if (additionalStandaloneWarnings.length) add("ADDITIONAL_STANDALONE_DDL_REVIEW_REQUIRED");
  return {
    ok: issues.length === 0, mode: "pre-migration-manifest-check", readOnly: true,
    productionApproved: false, databaseVerified: false, executableMigrations: 0,
    sourceRevisions: PINNED_REVISIONS,
    entryCount: entries.length, sqlEntryCount: expectedSql.length,
    standaloneEntryCount: [...expected.keys()].filter(path => path.startsWith("scripts/")).length,
    reservationCount: targets.size, deferredCount: entries.filter(entry => entry?.disposition === "defer-deduplicate").length,
    pendingStructureChecks: checks.length, deniedHistoricalReplayCount: deny.length,
    trackedUnregisteredSql: source.unregisteredSql,
    additionalStandaloneWarnings, issues,
    limitations: [
      "A passing manifest does not approve production, establish actual database state or register any migration.",
      "Dependencies are reviewed static observations or proposed integration prerequisites; all require schema/test-copy verification.",
      "Reserved 03xx names are suggestions only and must be reconsidered when either source snapshot or the release plan changes.",
      "Static CREATE keywords may include SHOW CREATE or comments; standalone script behavior requires source review, never execution here.",
    ],
  };
}

export async function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) return { exitCode: 0, output: { readOnly: true, usage: "node scripts/integration/checkMigrationAdmission.mjs --baseline-dir <927a5d7 checkout> --source-dir <383b69e checkout>", productionApproved: false } };
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    const [baseline, source] = await Promise.all([readPinnedSnapshot(options.baselineDirectory, "baseline"), readPinnedSnapshot(options.sourceDirectory, "source")]);
    const output = checkAdmission(manifest, baseline, source);
    return { exitCode: output.ok ? 0 : 1, output };
  } catch {
    return { exitCode: 1, output: { ok: false, readOnly: true, productionApproved: false, error: "ADMISSION_CHECK_FAILED", message: "Could not validate the manifest and pinned local snapshots; no source contents, environment or SQL are included." } };
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
