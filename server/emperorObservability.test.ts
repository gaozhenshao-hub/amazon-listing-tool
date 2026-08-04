import fs from "fs";
import path from "path";
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

  it("exposes operational observability routes under Emperor", () => {
    const router = readRepoFile("server/domains/ai_os/routers/observability.ts");
    const appRouterTest = readRepoFile("server/emperorAgentRunner.test.ts");

    expect(router).toContain("dashboard");
    expect(router).toContain("workerHealth");
    expect(router).toContain("databaseBaseline");
    expect(router).toContain("recordDatabaseBaselineSnapshot");
    expect(router).toContain("database_baseline.snapshot");
    expect(appRouterTest).toContain("emperor.observability.dashboard");
  });

  it("adds a first-class Emperor observability page without replacing existing pages", () => {
    const app = readRepoFile("client/src/App.tsx");
    const layout = readRepoFile("client/src/components/DashboardLayout.tsx");
    const page = readRepoFile("client/src/pages/emperor/EmperorObservability.tsx");

    expect(app).toContain("EmperorObservability");
    expect(app).toContain('/emperor/observability');
    expect(layout).toContain("可观测看板");
    expect(page).toContain("trpc.emperor.observability.dashboard.useQuery");
    expect(page).toContain("recordDatabaseBaselineSnapshot.useMutation");
    expect(page).toContain("Worker 队列健康");
    expect(page).toContain("慢查询与 EXPLAIN 基线");
    expect(page).toContain("归档任务健康");
  });

  it("keeps real DB tests isolated behind QA gate scripts and CI secrets", () => {
    const pkg = JSON.parse(readRepoFile("package.json"));
    const vitestConfig = readRepoFile("vitest.config.ts");
    const workflowTemplate = readRepoFile("docs/qa-gate-ci.md");

    expect(pkg.scripts["test:unit"]).toBe("vitest run");
    expect(pkg.scripts["test:real-db"]).toContain("RUN_REAL_DB_TESTS=1");
    expect(pkg.scripts["qa:gate"]).toContain("pnpm check");
    expect(vitestConfig).toContain("RUN_REAL_DB_TESTS");
    expect(workflowTemplate).toContain("CI_DATABASE_URL");
    expect(workflowTemplate).toContain("pnpm qa:gate");
    expect(workflowTemplate).toContain("pnpm test:real-db");
  });
});
