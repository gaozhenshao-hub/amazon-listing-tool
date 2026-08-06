import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveOperationalAlerts } from "./domains/ai_os/services/operationalScheduler";
import { repoPath } from "./testPaths";

const workerHealth = {
  checkedAt: "2026-08-05T00:00:00.000Z",
  staleAfterMs: 120_000,
  healthyCount: 1,
  unhealthyCount: 0,
  staleCount: 0,
  drainingCount: 0,
  stoppedCount: 0,
  queue: [],
  deadLetters: [],
  workers: [{ effectiveStatus: "active" }],
} as any;

const archiveHealth = {
  totalRuns: 1,
  succeededRuns: 1,
  failedRuns: 0,
  dryRunCount: 0,
  successRate: 100,
  candidateCount: 0,
  archivedCount: 0,
  deletedCount: 0,
  avgDurationMs: 10,
  latestRuns: [],
} as any;

describe("AI OS operational runtime", () => {
  it("raises worker, failed job, and archive alerts with stable fingerprints", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const alerts = deriveOperationalAlerts({
      worker: {
        ...workerHealth,
        healthyCount: 0,
        staleCount: 1,
        deadLetters: [{ createdAt: "2026-08-05T11:30:00.000Z" }],
      },
      archive: {
        ...archiveHealth,
        latestRuns: [{
          status: "failed",
          policySlug: "ai_jobs.completed",
          createdAt: "2026-08-05T10:00:00.000Z",
          errorMessage: "permission denied",
        }],
      },
      now,
      requireWorker: true,
      failedJobThreshold: 1,
    });
    expect(alerts.map((item) => item.fingerprint)).toEqual([
      "worker:no-healthy-worker",
      "failed_job:recent-dead-letters",
      "archive:recent-failure",
    ]);
  });

  it("does not alert when worker and archive execution are healthy", () => {
    expect(deriveOperationalAlerts({
      worker: workerHealth,
      archive: archiveHealth,
      requireWorker: true,
    })).toEqual([]);
  });

  it("keeps recovery controls readable and hides raw Run ID inputs", () => {
    const history = fs.readFileSync(repoPath("client/src/components/workflow/AiJobHistoryPanel.tsx"), "utf8");
    const embedded = fs.readFileSync(repoPath("client/src/components/workflow/EmbeddedAgentRunPanel.tsx"), "utf8");
    const scheduler = fs.readFileSync(repoPath("server/domains/ai_os/services/operationalScheduler.ts"), "utf8");
    expect(history).toContain("恢复任务");
    expect(history).toContain("重试次数、错误详情和恢复关系");
    expect(embedded).not.toContain("输入 Agent Run ID");
    expect(scheduler).toContain("runScheduledDataLifecycleSweep");
    expect(scheduler).toContain("startAiOsOperationalScheduler");
  });
});
