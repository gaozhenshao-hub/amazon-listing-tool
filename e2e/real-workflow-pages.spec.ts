import { expect, test } from "@playwright/test";
import { installRealPageFixtures } from "./trpcMock";

const pages = [
  { name: "产品开发", path: "/dev/project/1/analysis", heading: "市场分析工作台" },
  { name: "Listing", path: "/listing/canvas", heading: "工作流画布" },
  { name: "图片", path: "/listing/image-workflow", heading: "智能图片建议" },
  { name: "广告", path: "/ops/ads", heading: "广告智能分析" },
  { name: "运营", path: "/ops/inventory", heading: "库存预警中心" },
  { name: "视频", path: "/listing/video-script", heading: "视频脚本生成" },
];

for (const workflow of pages) {
  test(`${workflow.name}真实业务页面可恢复并查看后台任务`, async ({ page }) => {
    const pageErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });
    await installRealPageFixtures(page);
    await page.goto(workflow.path);
    await expect(page.getByRole("heading", { name: workflow.heading, exact: true })).toBeVisible({ timeout: 15_000 });
    const history = page.getByTestId("ai-job-history");
    await expect(history).toBeVisible();
    await history.getByRole("button").first().click();
    await expect(history.getByText("暂无后台任务记录")).toBeVisible();
    await expect(page.getByPlaceholder("输入 Agent Run ID")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}
