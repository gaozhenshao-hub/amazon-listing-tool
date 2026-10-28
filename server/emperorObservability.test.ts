import fs from "fs";
import path from "path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readRepoFile(repoPath: string) {
  return fs.readFileSync(path.join(root, repoPath), "utf8");
}

describe("AI OS observability dashboard and QA gate", () => {
  it("composes dashboard data from AI OS metrics, worker health, and database baselines", () => {
    const service = readRepoFile("server/domains/ai_os/services/observability.ts");

    expect(service).toContain("buildWorkerQueueHealth");
    expect(service).toContain("buildDatabaseObservabilitySection");
    expect(service).toContain("recordDatabaseBaselineSnapshot");
    expect(service).toContain("db.table.row_count");
    expect(service).toContain("db.explain.expected_index");
    expect(service).toContain("confirmationRate");
    expect(service).toContain("humanEditRate");
    expect(service).toContain("toolFailures");
    expect(service).toContain("archiveHealth");
    expect(service).toContain("migrationRegression");
  });

  it("keeps real DB tests isolated behind QA gate scripts and CI secrets", () => {
    const pkg = JSON.parse(readRepoFile("package.json"));
    const vitestConfig = readRepoFile("vitest.config.ts");
    const workflowTemplate = readRepoFile("docs/qa-gate-ci.md");

    expect(pkg.scripts["test:unit"]).toBe("vitest run");
    expect(pkg.scripts["test:real-db"]).toBe("node scripts/test-real-database.mjs");
    expect(pkg.scripts["test:real-db"]).not.toContain("RUN_REAL_DB_TESTS=1");
    expect(pkg.scripts["qa:gate"]).toContain("pnpm check");
    expect(vitestConfig).toContain("RUN_REAL_DB_TESTS");
    expect(workflowTemplate).toContain("CI_DATABASE_URL");
    expect(workflowTemplate).toContain("pnpm qa:gate");
    expect(workflowTemplate).toContain("pnpm test:real-db");
  });

  it("an inherited real-DB flag cannot bypass the wrapper's explicit target gates", () => {
    // All cases refuse before resolving or spawning Vitest; no driver/DB is used.
    const cases = [
      { args: [], extra: {}, code: "REAL_DB_EXPLICIT_LOCAL_ENVIRONMENT_REQUIRED" },
      { args: ["--environment", "ci", "--schema", "amazon_listing_ci"], extra: {}, code: "REAL_DB_EXPLICIT_URL_REQUIRED" },
      { args: ["--environment", "ci", "--schema", "amazon_listing_ci"],
        extra: { DATABASE_URL: "synthetic-inherited-target-must-not-be-used" }, code: "REAL_DB_INHERITED_DATABASE_URL_FORBIDDEN" },
    ];
    for (const entry of cases) {
      const result = spawnSync(process.execPath, [path.join(root, "scripts/test-real-database.mjs"), ...entry.args], {
        cwd: root, encoding: "utf8", timeout: 10_000, shell: false,
        env: { PATH: "/usr/bin:/bin", NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null",
          RUN_REAL_DB_TESTS: "1", RUN_REAL_LLM_TESTS: "0", ALLOW_REAL_NETWORK_IN_TESTS: "0", ...entry.extra },
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({ ok: false, code: entry.code });
      expect(result.stderr).not.toContain("synthetic-inherited-target-must-not-be-used");
    }
  });
});
