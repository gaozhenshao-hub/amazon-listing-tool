#!/usr/bin/env node
// Explicit disposable-local/CI DB tests only. No .env, application imports,
// inherited DATABASE_URL, provider credentials, shell or user-selected tests.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
export const REAL_DB_TEST_FILES = Object.freeze([
  "server/databaseMigrationRunner.real.test.ts",
  "server/databaseMigrations.real.test.ts",
  "server/aiWorkerDatabase.real.test.ts",
]);
const insist = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    insist(["--environment", "--schema"].includes(key) && !Object.hasOwn(options, key.slice(2)), "REAL_DB_ARGUMENTS_INVALID");
    const value = args[++index];
    insist(typeof value === "string" && value.length > 0 && !value.startsWith("--"), "REAL_DB_ARGUMENTS_INVALID");
    options[key.slice(2)] = value;
  }
  return options;
}

export function buildLaunchPlan(options, environment, { resolveVitest = () => require.resolve("vitest/vitest.mjs") } = {}) {
  insist(["local", "ci"].includes(options.environment), "REAL_DB_EXPLICIT_LOCAL_ENVIRONMENT_REQUIRED");
  insist(options.environment === "ci" ? options.schema === "amazon_listing_ci"
    : /^amazon_fresh_[a-f0-9]{16}_synthetic$/.test(options.schema ?? ""), "REAL_DB_SCHEMA_NOT_ALLOWED");
  insist(!environment.DATABASE_URL, "REAL_DB_INHERITED_DATABASE_URL_FORBIDDEN");
  insist(environment.NODE_ENV !== "production" && !environment.NODE_OPTIONS && !environment.DOTENV_KEY
    && !Object.keys(environment).some(key => /^ALLOW_.*PRODUCTION/.test(key) && environment[key] === "true"), "REAL_DB_PRODUCTION_OR_PRELOAD_FORBIDDEN");
  for (const key of Object.keys(environment)) if (/^DOTENV_CONFIG_/i.test(key)) {
    insist(key === "DOTENV_CONFIG_PATH" && environment[key] === "/dev/null", "REAL_DB_DOTENV_CONFIGURATION_FORBIDDEN");
  }
  insist(typeof environment.REAL_DB_TEST_DATABASE_URL === "string", "REAL_DB_EXPLICIT_URL_REQUIRED");
  let url;
  try { url = new URL(environment.REAL_DB_TEST_DATABASE_URL); } catch { insist(false, "REAL_DB_URL_INVALID"); }
  insist(url.protocol === "mysql:" && ["127.0.0.1", "[::1]"].includes(url.hostname)
    && url.pathname === `/${options.schema}` && !url.search && !url.hash
    && (url.port === "" || Number(url.port) > 0), "REAL_DB_LOCAL_TARGET_REQUIRED");
  for (const file of REAL_DB_TEST_FILES) insist(statSync(new URL(`../${file}`, import.meta.url)).isFile(), "REAL_DB_TEST_FILE_MISSING");
  return {
    executable: process.execPath,
    args: [resolveVitest(), "run", ...REAL_DB_TEST_FILES],
    options: {
      cwd: root, shell: false, stdio: "inherit", timeout: 20 * 60_000,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: "test", CI: "true", NO_COLOR: "1",
        DATABASE_URL: url.href, DOTENV_CONFIG_PATH: "/dev/null",
        RUN_REAL_DB_TESTS: "1", RUN_REAL_LLM_TESTS: "0", ALLOW_REAL_NETWORK_IN_TESTS: "0",
      },
    },
  };
}

export function main(args, { environment = process.env, run = spawnSync, resolveVitest } = {}) {
  const plan = buildLaunchPlan(parseArguments(args), environment, { resolveVitest });
  const result = run(plan.executable, plan.args, plan.options);
  insist(!result.error && !result.signal && Number.isInteger(result.status), "REAL_DB_TEST_PROCESS_FAILED");
  return result.status;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    // Do not print the URL, environment or subprocess error payload.
    console.error(JSON.stringify({ ok: false, code: /^[A-Z][A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "REAL_DB_TEST_LAUNCH_FAILED" }));
    process.exitCode = 1;
  }
}
