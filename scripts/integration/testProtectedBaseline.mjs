// Deliberately separate offline/mock baseline checks from DB/LLM and browser QA.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkProtectedBaseline, validateManifest, DEFAULT_MANIFEST } from "./checkProtectedBaseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const additionalTests = [
  "server/migrationSafety.test.ts",
  "server/agentLibraryContracts.test.ts",
  "server/networkEgressArchitecture.test.ts",
  "server/safeHttpClient.test.ts",
];

export function selectedTests(manifest) {
  validateManifest(manifest);
  const tests = manifest.files.filter(entry => entry.kind === "test").map(entry => entry.path);
  const browser = tests.filter(file => file.startsWith("e2e/"));
  const unit = [...new Set([...tests.filter(file => !file.startsWith("e2e/")), ...additionalTests])].sort();
  if (unit.some(file => !/^(server|client\/src)\/[A-Za-z0-9_./-]+\.(test|spec)\.tsx?$/.test(file) || file.includes(".real."))) {
    throw new Error("Only explicitly reviewed non-real baseline tests may run here");
  }
  return { unit, browserNotRun: browser };
}

export function testEnvironment(input) {
  // Do not forward DB, model/provider, storage credentials or NODE_OPTIONS.
  const env = {
    NODE_ENV: "test", RUN_REAL_DB_TESTS: "0", RUN_REAL_LLM_TESTS: "0", ALLOW_REAL_NETWORK_IN_TESTS: "0",
  };
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]) {
    if (input[name]) env[name] = input[name];
  }
  return env;
}

export function main(args) {
  if (args.length && !(args.length === 1 && args[0] === "--list")) {
    process.stderr.write("Usage: node scripts/integration/testProtectedBaseline.mjs [--list]\n");
    return 2;
  }
  const guard = checkProtectedBaseline({ root });
  if (!guard.ok) {
    process.stderr.write("Protected baseline drift: review it before running the integration gate.\n");
    return 1;
  }
  const selection = selectedTests(JSON.parse(fs.readFileSync(path.join(root, DEFAULT_MANIFEST), "utf8")));
  process.stdout.write(`${JSON.stringify(selection, null, 2)}\n`);
  if (args[0] === "--list") return 0;
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config",
    path.join(root, "scripts/integration/vitest.baseline.config.mjs"), "--maxWorkers=4", "--minWorkers=1",
  ], { cwd: root, stdio: "inherit", env: testEnvironment(process.env) });
  // A successful run does not imply the separately listed browser/DB/paid tests passed.
  if (result.error || result.signal) return 1;
  return result.status ?? 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
