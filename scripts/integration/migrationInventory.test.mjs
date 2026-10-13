import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PINNED_REVISIONS, assertPinnedHead, compareInventories, inventorySnapshot,
  main, parseArguments, parseLiteralRegistry, staticScriptWarnings,
} from "./migrationInventory.mjs";

const runnerPath = "scripts/run-database-migrations.mjs";
const journalPath = "drizzle/meta/_journal.json";
const secretMarker = "synthetic-secret-must-never-appear-in-report";
function fixture({ supplemental = [], retired = [], extra = "", sql = {}, scripts = {}, tags = [] } = {}) {
  return {
    [runnerPath]: `throw new Error("${secretMarker}: never execute this runner");
const supplementalMigrations = ${JSON.stringify(supplemental)};
const retiredMigrationFiles = new Set(${JSON.stringify(retired)});
${extra}`,
    [journalPath]: JSON.stringify({ entries: tags.map(tag => ({ tag })) }),
    ...Object.fromEntries(Object.entries(sql).map(([name, content]) => [`drizzle/${name}`, content])),
    ...scripts,
  };
}
const snapshot = options => inventorySnapshot(fixture(options), "synthetic-test-commit");

test("reads literal arrays/Sets while ignoring line and block comments", () => {
  const source = `/* const supplementalMigrations = ['9999_ignored.sql']; */
const supplementalMigrations = [
  "0001_first.sql", // '0002_ignored.sql'
  /* ignored */ '0003_third.sql',
];
const retiredMigrationFiles = new Set(["0004_retired.sql"]);`;
  assert.deepEqual(parseLiteralRegistry(source, "supplementalMigrations", true), ["0001_first.sql", "0003_third.sql"]);
  assert.deepEqual(parseLiteralRegistry(source, "retiredMigrationFiles", true), ["0004_retired.sql"]);
  assert.deepEqual(parseLiteralRegistry(source, "dedicatedMigrationFiles"), []);
});

test("fails closed for missing, duplicate, computed or unsafe registry declarations", () => {
  for (const body of ["[...other]", "makePlan()", "['../secret.sql']", "['0001_safe.sql' + suffix]", "[`0001_safe.sql`]", "[process.env.DATABASE_URL]", "['0001_safe.sql'].concat(extra)"]) {
    assert.throws(() => parseLiteralRegistry(`const supplementalMigrations = ${body};`, "supplementalMigrations", true));
  }
  assert.throws(() => parseLiteralRegistry("// absent", "supplementalMigrations", true), { code: "REGISTRY_MISSING" });
  assert.throws(() => parseLiteralRegistry("const supplementalMigrations=[];\nconst supplementalMigrations=[];", "supplementalMigrations"), { code: "REGISTRY_AMBIGUOUS" });
  assert.throws(() => parseLiteralRegistry("", "arbitraryInjectedName"), { code: "UNKNOWN_REGISTRY" });
});

test("parses metadata without evaluating source code or emitting SQL", () => {
  const result = snapshot({ supplemental: ["0200_safe.sql"], sql: { "0200_safe.sql": `SELECT '${secretMarker}';` } });
  assert.equal(result.files[0].sha256, createHash("sha256").update(`SELECT '${secretMarker}';`).digest("hex"));
  assert.equal(result.files[0].inGeneralPlan, true);
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
  assert.equal(JSON.stringify(result).includes("SELECT"), false);
});

test("journal and supplemental membership determine general order; duplicate complete names are reported", () => {
  const result = snapshot({ tags: ["0001_first"], supplemental: ["0002_second.sql", "0001_first.sql"], sql: { "0001_first.sql": "A", "0002_second.sql": "B" } });
  assert.deepEqual(result.generalPlan, [
    { name: "0001_first.sql", order: 1 }, { name: "0002_second.sql", order: 2 }, { name: "0001_first.sql", order: 3 },
  ]);
  assert.deepEqual(result.duplicateGeneralPlanFiles, ["0001_first.sql"]);
  assert.deepEqual(result.files.find(file => file.name === "0001_first.sql").memberships, ["journal", "general"]);
});

test("retired, legacy, dedicated and unreleased files are not mistaken for unregistered SQL", () => {
  const result = snapshot({ retired: ["0000_retired.sql"], extra: `
const dedicatedMigrationFiles = ['0203_dedicated.sql'];
const unreleasedDraftMigrationFiles = new Set(['0206_draft.sql']);
const imageQualityDevelopmentMigrationFiles = ['0206_draft.sql'];
const imageQualityProductionMigrationFiles = ['0206_draft.sql'];
const legacyManuallyReleasedMigrationFiles = new Set(['0196_manual.sql']);`,
    sql: { "0000_retired.sql": "A", "0203_dedicated.sql": "B", "0206_draft.sql": "C", "0196_manual.sql": "D", "0210_unregistered.sql": "E" },
  });
  assert.deepEqual(result.unregisteredSql, ["0210_unregistered.sql"]);
  const draft = result.files.find(file => file.name === "0206_draft.sql");
  assert.equal(draft.executionBlocked, true);
  assert.equal(draft.inGeneralPlan, false);
  assert.deepEqual(draft.memberships, ["unreleased-draft", "dedicated-development", "dedicated-production"]);
});

test("reports missing registered files, nested SQL outside runner, and blocked files accidentally put in plan", () => {
  const result = snapshot({ supplemental: ["0001_missing.sql", "0196_manual.sql"], extra: "const legacyManuallyReleasedMigrationFiles = new Set(['0196_manual.sql']);", sql: { "0196_manual.sql": "A", "nested/0210_not_general.sql": "B" } });
  assert.deepEqual(result.missingRegisteredSql, ["0001_missing.sql"]);
  assert.deepEqual(result.blockedFilesInGeneralPlan, ["0196_manual.sql"]);
  assert.deepEqual(result.nestedSqlOutsideRunner, ["drizzle/nested/0210_not_general.sql"]);
});

test("same file name/hash, changed bytes and exclusive file names are distinguished", () => {
  const baseline = snapshot({ sql: { "0001_same.sql": "same", "0002_changed.sql": "SQL\n", "0003_old.sql": "old" } });
  const source = snapshot({ sql: { "0001_same.sql": "same", "0002_changed.sql": "SQL\r\n", "0004_new.sql": "new" } });
  const comparison = compareInventories(baseline, source);
  assert.equal(comparison.sameNameSameHashCount, 1);
  assert.equal(comparison.sameNameDifferentHash.length, 1);
  assert.equal(comparison.sameNameDifferentHash[0].name, "0002_changed.sql");
  assert.notEqual(comparison.sameNameDifferentHash[0].baselineSha256, comparison.sameNameDifferentHash[0].sourceSha256);
  assert.deepEqual(comparison.baselineOnly, ["0003_old.sql"]);
  assert.deepEqual(comparison.sourceOnly, ["0004_new.sql"]);
});

test("number reuse is a review warning, not an assertion of ledger overwrite", () => {
  const baseline = snapshot({ sql: { "0202_old.sql": "A", "0102_jobs.sql": "B", "0102a_registry.sql": "C" } });
  const source = snapshot({ sql: { "0202_new.sql": "A", "0211_one.sql": "B", "0211_two.sql": "C", "0102_jobs.sql": "B", "0102a_registry.sql": "C" } });
  const result = compareInventories(baseline, source);
  assert.deepEqual(result.numberCollisions.map(group => group.number), ["0202", "0211"]);
  assert.ok(result.numberCollisions.every(group => group.ledgerOverwriteImplied === false));
  assert.deepEqual(result.duplicateNumbersWithinRepository.source, [{ number: "0211", files: ["0211_one.sql", "0211_two.sql"] }]);
  assert.deepEqual(result.duplicateNumbersWithinRepository.baseline, []);
});

test("historical 0196–0201 reintroduction is explicit without claiming an applied production migration", () => {
  const names = ["0196_manual.sql", "0197_manual.sql", "0198_manual.sql", "0199_manual.sql", "0200_manual.sql", "0201_manual.sql"];
  const sql = Object.fromEntries(names.map(name => [name, "historical"]));
  const baseline = snapshot({ sql, extra: `const legacyManuallyReleasedMigrationFiles = new Set(${JSON.stringify(names)});` });
  const source = snapshot({ sql, supplemental: names });
  const result = compareInventories(baseline, source).historical0196To0201;
  assert.equal(result.length, 6);
  assert.ok(result.every(file => file.reintroducedToGeneralPlan && file.databaseAppliedState === "not-inspected"));
});

test("static standalone script warnings reveal only paths, table names and referenced SQL names", () => {
  const result = staticScriptWarnings({
    "scripts/migrate-files.cjs": `const password = '${secretMarker}'; db.query(\`CREATE TABLE IF NOT EXISTS listing_uploaded_files (privatePayload TEXT)\`);`,
    "scripts/configure-agent.ts": `await readFile('drizzle/0210_agent_library.sql');`,
    "scripts/ordinary.ts": `console.log('${secretMarker}');`,
    [runnerPath]: "CREATE TABLE migration_ledger (secret TEXT)",
    "scripts/ignored.test.mjs": "CREATE TABLE fixture (x TEXT)",
  });
  assert.equal(result.length, 2);
  assert.deepEqual(result.find(item => item.path.endsWith("migrate-files.cjs")).createsTables, ["listing_uploaded_files"]);
  assert.deepEqual(result.find(item => item.path.endsWith("configure-agent.ts")).referencedSqlFiles, ["0210_agent_library.sql"]);
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
  assert.equal(JSON.stringify(result).includes("privatePayload"), false);
});

test("malformed metadata and unsafe journal tags fail closed", () => {
  assert.throws(() => inventorySnapshot({}, "test"), { code: "METADATA_MISSING" });
  for (const journal of ["not json", "{}", JSON.stringify({ entries: [{ tag: "../../secret" }] })]) {
    assert.throws(() => inventorySnapshot({ ...fixture(), [journalPath]: journal }, "test"), { code: "JOURNAL_INVALID" });
  }
});

test("revision pins are fixed and require the complete exact SHA for the correct role", () => {
  assert.equal(Object.isFrozen(PINNED_REVISIONS), true);
  assertPinnedHead("baseline", "927a5d71f43e6a35e04c1fbd7a82a48244ab4141");
  assertPinnedHead("source", "383b69e6bc9d8b3d2f1d380422390ea200541628");
  assert.throws(() => assertPinnedHead("source", PINNED_REVISIONS.baseline), { code: "SOURCE_SHA_MISMATCH" });
  assert.throws(() => assertPinnedHead("source", "383b69e6"), { code: "SOURCE_SHA_MISMATCH" });
  assert.throws(() => assertPinnedHead("anything", PINNED_REVISIONS.source), { code: "UNKNOWN_SOURCE_ROLE" });
});

test("CLI requires explicit source directories and has no apply, baseline or SHA override switch", () => {
  assert.deepEqual(parseArguments(["--help"]), { help: true });
  assert.equal(parseArguments(["--baseline-dir", "/tmp/baseline with spaces", "--source-dir", "/tmp/source"]).sourceDirectory, "/tmp/source");
  for (const args of [[], ["--baseline-dir", "/tmp/b"], ["--apply"], ["--expected-sha", "arbitrary"], ["--baseline-dir", "/tmp/b", "--source-dir", "/tmp/f", "--source-dir", "/tmp/other"]]) {
    assert.throws(() => parseArguments(args), { code: "CLI_ARGUMENTS_INVALID" });
  }
});

test("CLI emits JSON only and never prints inherited credentials on help or errors", async () => {
  const script = fileURLToPath(new URL("./migrationInventory.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [script, "--help"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: secretMarker } });
  assert.equal(JSON.parse(output).readOnly, true);
  assert.equal(output.includes(secretMarker), false);
  const error = await main(["--source-dir", secretMarker]);
  assert.equal(error.exitCode, 1);
  assert.equal(JSON.stringify(error).includes(secretMarker), false);
});

test("invalid local Git paths give sanitized errors, not stderr, SQL, environment or path values", async () => {
  const result = await main(["--baseline-dir", `/nonexistent/${secretMarker}`, "--source-dir", `/nonexistent/${secretMarker}`]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.output.error.code, "GIT_READ_FAILED");
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
});

test("CLI invoked through a symbolic link still returns a JSON receipt", t => {
  const directory = mkdtempSync(join(tmpdir(), "migration-inventory-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("./migrationInventory.mjs", import.meta.url));
  const link = join(directory, "inventory-link.mjs");
  symlinkSync(script, link);
  const output = execFileSync(process.execPath, [link, "--help"], { encoding: "utf8" });
  assert.equal(JSON.parse(output).readOnly, true);
});
