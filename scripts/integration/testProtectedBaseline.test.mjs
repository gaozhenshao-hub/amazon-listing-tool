import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { selectedTests, testEnvironment } from "./testProtectedBaseline.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../../config/integration/protected-baseline.json", import.meta.url), "utf8"));

test("baseline runner includes every protected unit test but reports browser tests separately", () => {
  const selection = selectedTests(manifest);
  for (const item of manifest.files.filter(entry => entry.kind === "test")) {
    assert.ok((item.path.startsWith("e2e/") ? selection.browserNotRun : selection.unit).includes(item.path));
  }
  assert.ok(selection.unit.includes("server/migrationSafety.test.ts"));
  assert.ok(selection.unit.includes("server/agentLibraryContracts.test.ts"));
  assert.equal(selection.unit.length, new Set(selection.unit).size);
});

test("baseline runner refuses real tests even if a future manifest includes them", () => {
  const next = structuredClone(manifest);
  next.files.find(entry => entry.kind === "test").path = "server/unsafe.real.test.ts";
  assert.throws(() => selectedTests(next), /non-real/);
});

test("exact test include does not match unreviewed nested names or glob expansions", () => {
  const selection = selectedTests(manifest);
  const target = "server/aiJobRunner.test.ts";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-include-test-"));
  try {
    for (const file of [target, `server/copied/${target}`]) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      fs.writeFileSync(path.join(directory, file), "");
    }
    assert.deepEqual(fs.globSync(selection.unit, { cwd: directory }), [target]);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
  const next = structuredClone(manifest);
  next.files.find(entry => entry.kind === "test").path = "server/*/copied.test.ts";
  assert.throws(() => selectedTests(next), /non-real/);
  const config = fs.readFileSync(new URL("./vitest.baseline.config.mjs", import.meta.url), "utf8");
  assert.ok(config.includes("include: selectedTests(manifest).unit"));
});

test("baseline runner strips inherited service credentials and real-test opt-ins", () => {
  const env = testEnvironment({ PATH: "/synthetic/bin", DATABASE_URL: "do-not-forward", JWT_SECRET: "secret",
    BUILT_IN_FORGE_API_KEY: "secret", RUN_REAL_DB_TESTS: "1", RUN_REAL_LLM_TESTS: "1",
    ALLOW_REAL_NETWORK_IN_TESTS: "1", NODE_OPTIONS: "--require unsafe", TMPDIR: "/tmp" });
  assert.deepEqual(env, { NODE_ENV: "test", RUN_REAL_DB_TESTS: "0", RUN_REAL_LLM_TESTS: "0",
    ALLOW_REAL_NETWORK_IN_TESTS: "0", PATH: "/synthetic/bin", TMPDIR: "/tmp" });
});
