import { expect, test, type Page } from "@playwright/test";
import { installRealPageFixtures } from "./trpcMock";

// Synthetic records only: every tRPC call is fulfilled locally; no server or model runs.
const failedJob = {
  runId: "synthetic-inventory-failed",
  module: "operations",
  kind: "ops.replenishmentPlan",
  skillSlug: "SYNTHETIC 失败补货建议",
  procedure: null,
  status: "failed",
  progress: 35,
  attempt: 1,
  maxAttempts: 3,
  timeoutSeconds: 300,
  queueName: "synthetic-operations",
  error: "SYNTHETIC 原任务错误需人工核对",
  createdAt: "2026-10-18T01:00:00.000Z",
  startedAt: "2026-10-18T01:00:01.000Z",
  completedAt: "2026-10-18T01:00:02.000Z",
  nextRunAt: null,
  recoveryOfRunId: null,
  recoveryReason: null,
  output: null,
};
const runningJob = {
  ...failedJob,
  runId: "synthetic-inventory-running",
  skillSlug: "SYNTHETIC 执行中补货建议",
  status: "running",
  error: null,
  completedAt: null,
};

function observeSafety(page: Page) {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  const mutations: Array<{ procedure: string; input: unknown }> = [];
  const telemetryMutations: Array<{ procedure: string; input: unknown }> = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    if (request.method() !== "POST" || !url.pathname.includes("/api/trpc/")) return;
    const procedures = decodeURIComponent(url.pathname.split("/api/trpc/")[1]).split(",");
    const body = request.postDataJSON();
    procedures.forEach((procedure, index) => {
      const call = { procedure, input: body[String(index)]?.json };
      // The real application's ambient vitals POST is fulfilled by the same
      // local fixture. Separate exactly that known telemetry procedure; every
      // business/model mutation still needs an explicit matching user action.
      if (procedure === "performance.recordVitals") telemetryMutations.push(call);
      else mutations.push(call);
    });
  });
  return { pageErrors, externalRequests, mutations, telemetryMutations };
}

const jobFixtures = {
  "aiJobs.list": [failedJob, runningJob],
  "aiJobs.get": failedJob,
  "aiJobs.retry": { ...runningJob, runId: "synthetic-inventory-recovery", recoveryOfRunId: failedJob.runId },
  "aiJobs.cancel": { ...runningJob, status: "canceled" },
};

test("默认领星库存规划保留历史、显式恢复和取消，刷新不自动重跑", async ({ page }) => {
  const safety = observeSafety(page);
  await installRealPageFixtures(page, jobFixtures);
  await page.goto("/ops/inventory");
  await expect(page.getByRole("heading", { name: "库存规划工作台", exact: true })).toBeVisible();
  await expect(page.getByText("唯一数据源：产品总览已上传的领星 ASIN 日粒度数据。", { exact: false })).toBeVisible();
  await expect(page.getByText("子 ASIN 库存规划表", { exact: true })).toBeVisible();
  await expect(page.getByText("月度采购表与资金规划", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "库存预警中心", exact: true })).toHaveCount(0);

  const history = page.getByTestId("ai-job-history");
  await expect(history).toHaveCount(1);
  await history.getByRole("button", { name: /运营后台任务历史/ }).click();
  await expect(history.getByText("恢复会新建关联任务，可能重新调用AI产生费用，不是原回执查询。", { exact: true })).toBeVisible();
  await expect(history.getByText(failedJob.skillSlug, { exact: true })).toBeVisible();
  await expect(history.getByText(runningJob.skillSlug, { exact: true })).toBeVisible();
  await history.getByRole("button", { name: "详情", exact: true }).first().click();
  await expect(history.getByText(failedJob.error, { exact: true })).toBeVisible();
  expect(safety.mutations).toEqual([]);

  await history.getByRole("button", { name: "恢复任务", exact: true }).click();
  await expect(page.getByText("已创建恢复任务，原失败记录仍会保留", { exact: true })).toBeVisible();
  await expect(history.getByText(failedJob.skillSlug, { exact: true })).toBeVisible();
  await history.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByText("任务已取消", { exact: true })).toBeVisible();
  expect(safety.mutations).toEqual([
    { procedure: "aiJobs.retry", input: { runId: failedJob.runId, reason: "用户从任务历史恢复" } },
    { procedure: "aiJobs.cancel", input: { runId: runningJob.runId, reason: "用户从任务历史取消" } },
  ]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "库存规划工作台", exact: true })).toBeVisible();
  await history.getByRole("button", { name: /运营后台任务历史/ }).click();
  await expect(history.getByText(failedJob.skillSlug, { exact: true })).toBeVisible();
  expect(safety.mutations).toHaveLength(2);
  await expect(page.getByPlaceholder("输入 Agent Run ID")).toHaveCount(0);
  await expect(history).not.toContainText(failedJob.runId);
  await expect(history).not.toContainText(runningJob.runId);
  expect(safety.pageErrors).toEqual([]);
  expect(safety.externalRequests).toEqual([]);
});

test("库存来源读取失败仍可查看独立任务历史，不将失败伪装零库存", async ({ page }) => {
  const safety = observeSafety(page);
  await installRealPageFixtures(page, jobFixtures, {
    "dataImport.getInventoryPlanningFromImport": {
      message: "SYNTHETIC planning source unavailable",
      code: -32012,
      data: { code: "PRECONDITION_FAILED", httpStatus: 412 },
    },
  });
  await page.goto("/ops/inventory");
  await expect(page.getByRole("alert")).toContainText("库存规划或人工参数来源不可读", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "重新读取库存规划", exact: true })).toBeVisible();
  await expect(page.getByText("ASIN 计划数", { exact: true })).toHaveCount(0);
  const history = page.getByTestId("ai-job-history");
  await expect(history).toHaveCount(1);
  await history.getByRole("button", { name: /运营后台任务历史/ }).click();
  await expect(history.getByRole("button", { name: "恢复任务", exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "取消", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("输入 Agent Run ID")).toHaveCount(0);
  expect(safety.mutations).toEqual([]);
  expect(safety.pageErrors).toEqual([]);
  expect(safety.externalRequests).toEqual([]);
});

test("显式旧诊断仍保留补货预测与后台历史，不取代默认领星规划", async ({ page }) => {
  const safety = observeSafety(page);
  await installRealPageFixtures(page);
  await page.goto("/ops/inventory?legacyInventoryDiagnostics=1&tab=predictions");
  await expect(page.getByRole("heading", { name: "库存预警中心", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "AI补货预测", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("运营补货 Agent Run / Checkpoint", { exact: true })).toBeVisible();
  const history = page.getByTestId("ai-job-history");
  await expect(history).toHaveCount(1);
  await history.getByRole("button", { name: /运营后台任务历史/ }).click();
  await expect(history.getByText("暂无后台任务记录", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("输入 Agent Run ID")).toHaveCount(0);
  expect(safety.mutations).toEqual([]);
  expect(safety.pageErrors).toEqual([]);
  expect(safety.externalRequests).toEqual([]);
});

test("任务历史RPC失败不能显示暂无任务或开放恢复取消", async ({ page }) => {
  const safety = observeSafety(page);
  await installRealPageFixtures(page, {}, {
    "aiJobs.list": {
      message: "SYNTHETIC job history unavailable",
      code: -32603,
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
    },
  });
  await page.goto("/ops/inventory");
  await expect(page.getByRole("heading", { name: "库存规划工作台", exact: true })).toBeVisible();
  const history = page.getByTestId("ai-job-history");
  await history.getByRole("button", { name: /运营后台任务历史/ }).click();
  await expect(history.getByRole("alert")).toContainText("任务历史读取失败", { timeout: 15_000 });
  await expect(history.getByText("暂无后台任务记录", { exact: true })).toHaveCount(0);
  await expect(history.getByRole("button", { name: "恢复任务", exact: true })).toHaveCount(0);
  await expect(history.getByRole("button", { name: "取消", exact: true })).toHaveCount(0);
  await history.getByTitle("刷新任务历史").click();
  await expect(history.getByRole("alert")).toContainText("任务历史读取失败");
  await expect(page.getByPlaceholder("输入 Agent Run ID")).toHaveCount(0);
  expect(safety.mutations).toEqual([]);
  expect(safety.pageErrors).toEqual([]);
  expect(safety.externalRequests).toEqual([]);
});

for (const action of [
  { procedure: "aiJobs.retry", button: "恢复任务", runId: failedJob.runId, reason: "用户从任务历史恢复" },
  { procedure: "aiJobs.cancel", button: "取消", runId: runningJob.runId, reason: "用户从任务历史取消" },
]) {
  test(`${action.button}响应可重试错误时仍只发一次，禁止应用全局自动重放`, async ({ page }) => {
    const safety = observeSafety(page);
    const message = `SYNTHETIC ${action.procedure} retryable failure`;
    await installRealPageFixtures(page, jobFixtures, {
      [action.procedure]: {
        message,
        code: -32603,
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, appCode: "INTERNAL_ERROR", retryable: true },
      },
    });
    await page.goto("/ops/inventory");
    await expect(page.getByRole("heading", { name: "库存规划工作台", exact: true })).toBeVisible();
    const history = page.getByTestId("ai-job-history");
    await history.getByRole("button", { name: /运营后台任务历史/ }).click();
    await expect(history.getByRole("button", { name: action.button, exact: true })).toBeVisible();
    expect(safety.mutations).toEqual([]);
    const firstRequest = page.waitForRequest(request => request.method() === "POST" && request.url().includes(action.procedure));
    await history.getByRole("button", { name: action.button, exact: true }).click();
    await firstRequest;
    // Real main.tsx config retries at 1.5s and another 3s; observe beyond both windows.
    await page.waitForTimeout(5_100);
    expect(safety.mutations).toEqual([
      { procedure: action.procedure, input: { runId: action.runId, reason: action.reason } },
    ]);
    await expect(page.getByPlaceholder("输入 Agent Run ID")).toHaveCount(0);
    expect(safety.pageErrors).toEqual([]);
    expect(safety.externalRequests).toEqual([]);
  });
}
