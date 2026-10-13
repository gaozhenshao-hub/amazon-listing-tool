import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { checkAdmission, main } from "./checkMigrationAdmission.mjs";
import { PINNED_REVISIONS } from "./migrationInventory.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../config/integration/migration-admission.json", import.meta.url), "utf8"));
const clone = value => structuredClone(value);
function fixture() {
  const plan = clone(manifest);
  const file = (name, memberships, sha256 = "a".repeat(64)) => ({ name, number: /^(\d{4}[a-z]?)_/.exec(name)?.[1], memberships, inGeneralPlan: memberships.includes("general"), sha256 });
  const historical = plan.denyReplay.map(name => file(name, ["legacy-manually-released"]));
  const baseline = { commit: PINNED_REVISIONS.baseline, files: historical, standaloneScriptWarnings: [] };
  const source = {
    commit: PINNED_REVISIONS.source,
    files: [...historical.map(item => ({ ...item, memberships: ["general"], inGeneralPlan: true })),
      ...plan.entries.filter(entry => entry.sourcePath.startsWith("drizzle/")).map(entry => file(entry.sourcePath.slice(8), entry.sourceRegistration === "general" ? ["general"] : [], entry.sourceSha256))],
    unregisteredSql: plan.entries.filter(entry => entry.sourceRegistration === "unregistered").map(entry => entry.sourcePath.slice(8)),
    standaloneScriptWarnings: plan.entries.filter(entry => entry.sourcePath.startsWith("scripts/")).map(entry => ({ path: entry.sourcePath, sha256: entry.sourceSha256, createsTables: ["synthetic_table"] })),
  };
  return { plan, baseline, source };
}
function runMutated(mutate) {
  const data = fixture(); mutate(data);
  const result = checkAdmission(data.plan, data.baseline, data.source);
  assert.equal(result.ok, false);
  assert.equal(result.productionApproved, false);
  assert.equal(result.databaseVerified, false);
  assert.equal(result.executableMigrations, 0);
  return result.issues.map(issue => issue.code);
}

test("complete declarative plan covers 15 SQL and 3 standalone scripts without granting approval", () => {
  const { plan, baseline, source } = fixture();
  const result = checkAdmission(plan, baseline, source);
  assert.equal(result.ok, true);
  assert.equal(result.entryCount, 18);
  assert.equal(result.sqlEntryCount, 15);
  assert.equal(result.standaloneEntryCount, 3);
  assert.equal(result.reservationCount, 16);
  assert.equal(result.deferredCount, 2);
  assert.equal(result.trackedUnregisteredSql.length, 6);
  assert.equal(result.productionApproved, false);
  assert.equal(result.databaseVerified, false);
  assert.equal(result.executableMigrations, 0);
});

test("missing SQL and missing standalone DDL entries fail", () => {
  for (const path of ["drizzle/0211_profit_analysis.sql", "scripts/migrate-listing-files.cjs", "scripts/repair-image-session-schema.cjs"]) {
    const codes = runMutated(({ plan }) => { plan.entries = plan.entries.filter(entry => entry.sourcePath !== path); });
    assert.ok(codes.includes("SOURCE_ENTRY_MISSING"));
  }
});

test("duplicate source entries and destination file/number reservations fail", () => {
  assert.ok(runMutated(({ plan }) => plan.entries.push(clone(plan.entries[0]))).includes("DUPLICATE_SOURCE_ENTRY"));
  assert.ok(runMutated(({ plan }) => { plan.entries[1].reservedFile = plan.entries[0].reservedFile; }).includes("DUPLICATE_RESERVATION"));
  assert.ok(runMutated(({ plan }) => { plan.entries[1].reservedFile = "0300_integration_different.sql"; }).includes("DUPLICATE_RESERVATION"));
});

test("reservations cannot collide with existing snapshot names or numbers", () => {
  assert.ok(runMutated(({ plan, baseline, source }) => {
    const existing = { name: plan.entries[0].reservedFile, number: "0300", sha256: "f".repeat(64), memberships: ["general"], inGeneralPlan: true };
    baseline.files.push(existing); source.files.push(existing);
  }).includes("RESERVATION_COLLIDES_WITH_SNAPSHOT"));
  assert.ok(runMutated(({ plan }) => { plan.entries[0].reservedFile = "0202_some_other.sql"; }).includes("RESERVATION_NAME_INVALID"));
});

test("same numeric prefix is not an interchangeable source identity", () => {
  assert.ok(runMutated(({ plan }) => { plan.entries[0].sourcePath = "drizzle/0202_competitor_gallery_analysis_scope.sql"; }).includes("UNEXPECTED_OR_HISTORICAL_ENTRY"));
});

test("known SQL and runtime dependency omissions fail", () => {
  for (const [path, required] of [
    ["drizzle/0213_saihu_connection.sql", "drizzle/0212_saihu_api_config.sql"],
    ["drizzle/0223_inventory_snapshot.sql", "drizzle/0214_saihu_schedule.sql"],
    ["drizzle/0210_agent_library.sql", "drizzle/0208_image_tag_training.sql"],
    ["scripts/migrate-listing-files.cjs", "check:storage"],
  ]) {
    assert.ok(runMutated(({ plan }) => {
      const item = plan.entries.find(entry => entry.sourcePath === path);
      item.dependsOn = item.dependsOn.filter(dep => dep !== required);
    }).includes("REQUIRED_DEPENDENCY_MISSING"));
  }
});

test("undefined, duplicated and cyclical dependency references fail", () => {
  assert.ok(runMutated(({ plan }) => plan.entries[0].dependsOn.push("check:missing")).includes("DEPENDENCY_REFERENCE_MISSING"));
  assert.ok(runMutated(({ plan }) => plan.entries[0].dependsOn.push("check:schema-ledger")).includes("DUPLICATE_DEPENDENCY"));
  assert.ok(runMutated(({ plan }) => plan.entries[0].dependsOn.push(plan.entries[0].sourcePath)).includes("DEPENDENCY_CYCLE"));
  assert.ok(runMutated(({ plan }) => { plan.entries[0].dependsOn = 123; }).includes("REQUIRED_DEPENDENCY_MISSING"));
});

test("future phase dependencies cannot be silently promoted to earlier activation", () => {
  assert.ok(runMutated(({ plan }) => {
    plan.entries.find(entry => entry.sourcePath === "drizzle/0223_inventory_snapshot.sql").targetPhase = "P2";
  }).includes("DEPENDENCY_PHASE_INVERSION"));
});

test("historical manual releases require a complete replay denylist and cannot be admitted", () => {
  assert.ok(runMutated(({ plan }) => plan.denyReplay.pop()).includes("HISTORICAL_REPLAY_DENYLIST_INCOMPLETE"));
  assert.ok(runMutated(({ plan }) => plan.entries.push({ ...plan.entries[0], sourcePath: `drizzle/${plan.denyReplay[0]}` })).includes("UNEXPECTED_OR_HISTORICAL_ENTRY"));
});

test("all six unregistered files are explicitly tracked, not silently treated as registered", () => {
  assert.ok(runMutated(({ plan }) => {
    plan.entries.find(entry => entry.sourceRegistration === "unregistered").sourceRegistration = "general";
  }).includes("UNREGISTERED_SQL_NOT_TRACKED"));
});

test("fixed source revisions and per-file hashes detect drift", () => {
  assert.ok(runMutated(({ plan }) => { plan.sourceRevisions.source = "0".repeat(40); }).includes("PINNED_REVISION_MISMATCH"));
  assert.ok(runMutated(({ source }) => { source.commit = "0".repeat(40); }).includes("PINNED_REVISION_MISMATCH"));
  assert.ok(runMutated(({ plan }) => { plan.entries[0].sourceSha256 = "0".repeat(64); }).includes("SOURCE_HASH_MISMATCH"));
});

test("pending verification and review-only flags cannot be used to claim database approval", () => {
  assert.ok(runMutated(({ plan }) => { plan.productionApproved = true; }).includes("REVIEW_ONLY_BOUNDARY_REQUIRED"));
  assert.ok(runMutated(({ plan }) => { plan.databaseVerified = true; }).includes("REVIEW_ONLY_BOUNDARY_REQUIRED"));
  assert.ok(runMutated(({ plan }) => { plan.entries[0].structureVerification = "passed"; }).includes("SCHEMA_MUST_REMAIN_UNVERIFIED"));
  assert.ok(runMutated(({ plan }) => { plan.checks[0].status = "passed"; }).includes("CHECK_MUST_BE_UNIQUE_AND_PENDING"));
  assert.ok(runMutated(({ plan }) => plan.checks.pop()).includes("CHECK_CATALOG_INCOMPLETE"));
});

test("duplicate repair scripts stay deferred without fabricated extra migrations", () => {
  assert.ok(runMutated(({ plan }) => {
    plan.entries.find(entry => entry.sourcePath === "scripts/repair-image-session-schema.cjs").reservedFile = "0316_integration_duplicate_repair.sql";
  }).includes("DUPLICATE_DDL_MUST_BE_DEFERRED"));
});

test("additional standalone static DDL warnings cannot be omitted from review", () => {
  assert.ok(runMutated(({ source }) => source.standaloneScriptWarnings.push({ path: "scripts/new-ddl.cjs", sha256: "f".repeat(64), createsTables: ["new_table"] })).includes("ADDITIONAL_STANDALONE_DDL_REVIEW_REQUIRED"));
});

test("malformed or sensitive manifest input is not dumped into errors", () => {
  const secret = "synthetic-secret-never-emit";
  const data = fixture();
  data.plan.entries[0].sourcePath = secret;
  data.plan.entries[1].sourceSha256 = secret;
  const output = checkAdmission(data.plan, data.baseline, data.source);
  assert.equal(output.ok, false);
  assert.equal(JSON.stringify(output).includes(secret), false);
});

test("CLI has no apply mode and returns sanitized failure", async () => {
  const result = await main(["--apply", "synthetic-secret"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.output.productionApproved, false);
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
});

test("CLI direct and symlink help paths produce JSON only, without reading DB configuration", t => {
  const directory = mkdtempSync(join(tmpdir(), "migration-admission-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("./checkMigrationAdmission.mjs", import.meta.url));
  const link = join(directory, "admission-link.mjs"); symlinkSync(script, link);
  for (const path of [script, link]) {
    const output = execFileSync(process.execPath, [path, "--help"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "synthetic-secret" } });
    assert.equal(JSON.parse(output).productionApproved, false);
    assert.equal(output.includes("synthetic-secret"), false);
  }
});
