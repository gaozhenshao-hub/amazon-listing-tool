import { expect, test } from "@playwright/test";

const workflows = [
  { slug: "listing", title: "Listing 核心工作流" },
  { slug: "image", title: "图片核心工作流" },
  { slug: "ads", title: "广告核心工作流" },
  { slug: "product-development", title: "产品开发核心工作流" },
];

for (const workflow of workflows) {
  test(`${workflow.title} supports edit, version, confirmation and rerun`, async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto(`/__qa__/workflows/${workflow.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: workflow.title })).toBeVisible();
    await expect(page.getByTestId("workflow-status")).toHaveText("等待人工确认");

    const artifact = page.getByRole("textbox", { name: "节点产物内容" });
    await expect(artifact).toHaveAttribute("readonly", "");
    await page.getByRole("button", { name: "解锁编辑" }).click();
    await artifact.fill(`${workflow.title} 人工校准后的内容`);
    await page.getByRole("button", { name: "保存新版本" }).click();
    await expect(page.getByText("Artifact 版本 v2")).toBeVisible();
    await expect(artifact).toHaveAttribute("readonly", "");

    await page.getByRole("button", { name: "确认并锁定" }).click();
    await expect(page.getByTestId("workflow-status")).toHaveText("已确认锁定");

    await page.getByRole("button", { name: "重新生成" }).click();
    await expect(page.getByTestId("workflow-status")).toHaveText("生成中");
    await expect(page.getByTestId("workflow-status")).toHaveText("等待人工确认");
    expect(externalRequests).toEqual([]);
  });
}
