// Static CI/package wiring only. Never start MySQL, Vitest real tests, a model,
// a workflow or an external request. Native entry tests use an in-memory DB.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { main } from "../bootstrap-fresh-database.mjs";
import { loadFreshBootstrapPlan, loadStructureContract } from "./freshBootstrapPlan.mjs";
import { REAL_DB_TEST_FILES, buildLaunchPlan, main as runRealDb, parseArguments as parseRealDbArguments } from "../test-real-database.mjs";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const scripts = JSON.parse(read("package.json")).scripts;
const workflow = read(".github/workflows/qa-gate.yml");
const realDbFiles = [
  "server/databaseMigrationRunner.real.test.ts",
  "server/databaseMigrations.real.test.ts",
  "server/aiWorkerDatabase.real.test.ts",
];
const nativeFiles = [
  "scripts/bootstrap-fresh-database.test.mjs",
  "scripts/database/freshBootstrapPlan.test.mjs",
  "scripts/database/freshBootstrapCi.test.mjs",
  "scripts/database/freshBootstrapColumnOrder.test.mjs",
  "scripts/database/freshBootstrapReference.test.mjs",
];
const ciUrl = "mysql://root:root@127.0.0.1:3306/amazon_listing_ci";
const job = name => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `Missing job: ${name}`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
const realDbJob = job("real-db-gate");
const runs = [...realDbJob.matchAll(/^\s+(?:- )?run: (.+)$/gm)].map(match => match[1]);

test("existing migration and production launch entry points remain unchanged; fresh is explicit", () => {
  assert.equal(scripts["db:migrate"], "node scripts/run-database-migrations.mjs");
  assert.equal(scripts["db:migrate:plan"], "node scripts/run-database-migrations.mjs --plan");
  assert.equal(scripts["db:migrate:baseline"], "node scripts/run-database-migrations.mjs --baseline");
  assert.equal(scripts["db:push"], "pnpm db:migrate");
  assert.equal(scripts.start, "NODE_ENV=production node dist/index.js");
  assert.equal(scripts["db:bootstrap:fresh:plan"], "node scripts/bootstrap-fresh-database.mjs --plan");
  assert.equal(scripts["db:bootstrap:fresh"], "node scripts/bootstrap-fresh-database.mjs --execute");
});

test("real DB command names exactly three existing DB tests and forcibly disables LLM/network tests", () => {
  assert.equal(scripts["test:real-db"], "node scripts/test-real-database.mjs");
  assert.deepEqual(REAL_DB_TEST_FILES, realDbFiles);
  const launch = buildLaunchPlan({ environment: "ci", schema: "amazon_listing_ci" }, { REAL_DB_TEST_DATABASE_URL: ciUrl });
  assert.match(launch.args[0], /vitest\/vitest\.mjs$/);
  assert.deepEqual(launch.args.slice(1), ["run", ...realDbFiles]);
  assert.equal(launch.options.env.RUN_REAL_DB_TESTS, "1");
  assert.equal(launch.options.env.RUN_REAL_LLM_TESTS, "0");
  assert.equal(launch.options.env.ALLOW_REAL_NETWORK_IN_TESTS, "0");
  for (const path of realDbFiles) {
    assert.ok(statSync(new URL(path, root)).isFile(), path);
    assert.match(read(path), /\b(?:it|test)\(/, `${path} must contain tests`);
  }
  assert.doesNotMatch(scripts["test:real-db"], /passWithNoTests|[*?]|emperorSkillRunner|teamorouterConnectivity/);
});

test("QA invokes native bootstrap tests before other checks without a failure bypass", () => {
  assert.equal(scripts["test:bootstrap:fresh"],
    `RUN_REAL_LLM_TESTS=0 ALLOW_REAL_NETWORK_IN_TESTS=0 node --test ${nativeFiles.join(" ")}`);
  for (const path of nativeFiles) assert.ok(statSync(new URL(path, root)).isFile(), path);
  assert.ok(scripts["qa:gate"].startsWith("pnpm test:bootstrap:fresh && "));
  assert.doesNotMatch(scripts["qa:gate"], /\|\||;|passWithNoTests/);
  assert.match(job("unit-gate"), /^ {6}RUN_REAL_LLM_TESTS: "0"$/m);
  assert.match(job("unit-gate"), /^ {6}ALLOW_REAL_NETWORK_IN_TESTS: "0"$/m);
  assert.match(job("unit-gate"), /^ {6}- run: pnpm qa:gate$/m);
});

test("CI targets a fresh local MySQL 8.0.46 service and initializes then verifies before real DB tests", () => {
  assert.match(realDbJob, /^ {8}image: mysql:8\.0\.46$/m);
  assert.match(realDbJob, /^ {10}MYSQL_DATABASE: amazon_listing_ci$/m);
  assert.match(realDbJob, /^ {10}- 3306:3306$/m);
  assert.match(realDbJob, /^ {4}needs: unit-gate$/m);
  for (const name of ["REAL_DB_TEST_DATABASE_URL", "FRESH_BOOTSTRAP_DATABASE_URL"])
    assert.ok(realDbJob.includes(`\n      ${name}: ${ciUrl}\n`));
  assert.match(realDbJob, /^ {6}DOTENV_CONFIG_PATH: \/dev\/null$/m);
  assert.match(realDbJob, /^ {6}RUN_REAL_LLM_TESTS: "0"$/m);
  assert.match(realDbJob, /^ {6}ALLOW_REAL_NETWORK_IN_TESTS: "0"$/m);
  assert.deepEqual(runs, [
    "corepack enable", "pnpm install --frozen-lockfile", "pnpm db:bootstrap:fresh:plan",
    "pnpm db:bootstrap:fresh --environment ci --schema amazon_listing_ci",
    "pnpm db:bootstrap:fresh --environment ci --schema amazon_listing_ci",
    "pnpm test:real-db --environment ci --schema amazon_listing_ci",
  ]);
  const executable = realDbJob.replace(/^\s*#.*$/gm, "");
  assert.doesNotMatch(executable, /continue-on-error:|\bif:|\|\||db:migrate|--baseline|--retry-failed|passWithNoTests|secrets\./);
  assert.doesNotMatch(executable, /RUN_REAL_LLM_TESTS:\s*["']?1|ALLOW_REAL_NETWORK_IN_TESTS:\s*["']?1/);
  assert.doesNotMatch(executable, /^\s+DATABASE_URL:/m);
});

test("CI cannot substitute an unapproved structure contract or bypass its pre-connection gate", async () => {
  const bundle = loadFreshBootstrapPlan();
  const args = ["--execute", "--environment", "ci", "--schema", "amazon_listing_ci"];
  let loaded = 0;
  const dependencies = {
    environment: { FRESH_BOOTSTRAP_DATABASE_URL: ciUrl, RUN_REAL_LLM_TESTS: "0", ALLOW_REAL_NETWORK_IN_TESTS: "0" },
    load: async () => { loaded++; throw Object.assign(new Error("TEST_STOP_BEFORE_DB"), { code: "TEST_STOP_BEFORE_DB" }); },
  };
  if (bundle.manifest.structureContract === null) {
    await assert.rejects(main(args, dependencies), error => error.code === "FULL_STRUCTURE_CONTRACT_NOT_APPROVED");
    assert.equal(loaded, 0);
  } else {
    // A later approved pin must still validate a complete public-source contract;
    // never replace this with a count-only fixture or a candidate's observed DB.
    const contract = loadStructureContract(bundle);
    assert.equal(contract.derivation.candidateDatabaseUsed, false);
    assert.equal(contract.derivation.productionDdlUsed, false);
    assert.equal(contract.platform.mysqlMajorMinor, "8.0");
    assert.equal(contract.platform.lowerCaseTableNames, 0);
    assert.equal(contract.platform.schemaCharacterSet, "utf8mb4");
    assert.equal(contract.platform.schemaCollation, "utf8mb4_0900_ai_ci");
    await assert.rejects(main(args, dependencies), error => error.code === "TEST_STOP_BEFORE_DB");
    assert.equal(loaded, 1);
  }
});

test("real DB launch rejects implicit, production, remote, inherited or extra arguments before spawning", () => {
  const options = { environment: "ci", schema: "amazon_listing_ci" };
  const safe = { REAL_DB_TEST_DATABASE_URL: ciUrl };
  for (const args of [["--baseline"], ["--schema"], ["--schema", "a", "--schema", "b"], ["--passWithNoTests"], ["--environment", "ci", "server/emperorSkillRunner.real.test.ts"]])
    assert.throws(() => parseRealDbArguments(args));
  for (const environment of [{}, { DATABASE_URL: ciUrl }, { ...safe, DATABASE_URL: "mysql://production.example/app" },
    { ...safe, NODE_ENV: "production" }, { ...safe, NODE_OPTIONS: "--require unsafe" }, { ...safe, DOTENV_KEY: "unsafe" },
    { ...safe, DOTENV_CONFIG_PATH: ".env" }, { ...safe, ALLOW_PRODUCTION_MIGRATIONS: "true" },
    { REAL_DB_TEST_DATABASE_URL: "mysql://root@remote.example/amazon_listing_ci" },
    { REAL_DB_TEST_DATABASE_URL: "mysql://root@localhost/amazon_listing_ci" },
    { REAL_DB_TEST_DATABASE_URL: "mysql://root@127.0.0.1/production" },
    { REAL_DB_TEST_DATABASE_URL: `${ciUrl}?multipleStatements=true` }]) assert.throws(() => buildLaunchPlan(options, environment));
  for (const invalid of [{}, { environment: "production", schema: "amazon_listing_ci" }, { environment: "local", schema: "production" }])
    assert.throws(() => buildLaunchPlan(invalid, safe));
  let spawned = false;
  assert.throws(() => runRealDb([], { environment: safe, run: () => { spawned = true; } }));
  assert.equal(spawned, false);
});

test("real DB child receives only safe explicit test environment and propagates failures without shell or credentials output", () => {
  const environment = { REAL_DB_TEST_DATABASE_URL: ciUrl, OPENAI_API_KEY: "must-not-pass", MANUS_API_KEY: "must-not-pass",
    HTTPS_PROXY: "must-not-pass", NODE_PATH: "must-not-pass", RUN_REAL_LLM_TESTS: "1", ALLOW_REAL_NETWORK_IN_TESTS: "1" };
  const args = ["--environment", "ci", "--schema", "amazon_listing_ci"];
  let calls = 0;
  const run = (executable, childArgs, options) => {
    calls++;
    assert.equal(executable, process.execPath); assert.equal(options.shell, false);
    assert.deepEqual(childArgs, ["/synthetic/vitest/vitest.mjs", "run", ...realDbFiles]);
    assert.deepEqual(Object.keys(options.env).sort(), ["PATH", "NODE_ENV", "CI", "NO_COLOR", "DATABASE_URL", "DOTENV_CONFIG_PATH", "RUN_REAL_DB_TESTS", "RUN_REAL_LLM_TESTS", "ALLOW_REAL_NETWORK_IN_TESTS"].sort());
    assert.equal(options.env.DATABASE_URL, ciUrl); assert.equal(options.env.DOTENV_CONFIG_PATH, "/dev/null");
    assert.equal(options.env.RUN_REAL_LLM_TESTS, "0"); assert.equal(options.env.ALLOW_REAL_NETWORK_IN_TESTS, "0");
    return { status: 7, signal: null };
  };
  assert.equal(runRealDb(args, { environment, run, resolveVitest: () => "/synthetic/vitest/vitest.mjs" }), 7);
  assert.equal(calls, 1);
  for (const result of [{ error: new Error("private diagnostic"), status: null }, { signal: "SIGTERM", status: null }])
    assert.throws(() => runRealDb(args, { environment, run: () => result }), error => error.code === "REAL_DB_TEST_PROCESS_FAILED");
});
