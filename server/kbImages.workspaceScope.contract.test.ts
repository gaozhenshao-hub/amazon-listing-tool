import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const routerSource = readFileSync(new URL("./routers/kbImages.ts", import.meta.url), "utf8");
const repositorySource = readFileSync(new URL("./kbDb.ts", import.meta.url), "utf8");
const exportRouterSource = readFileSync(new URL("./domains/image/routers/knowledgeExport.ts", import.meta.url), "utf8");

describe("图片知识库工作空间范围契约", () => {
  it("图片集和瀑布流读取将当前请求工作空间传给仓储层", () => {
    expect(routerSource).toContain("listImageSetsWithThumbnails(ctx.user.id, ctx.workspaceId!");
    expect(routerSource).toContain("listAllImages(ctx.user.id, ctx.workspaceId!");
    expect(exportRouterSource).toContain("listAllImages(ctx.user.id, ctx.workspaceId!");
  });

  it("仓储层将图片集与图片范围同时约束在workspaceId内", () => {
    expect(repositorySource).toContain("scopeCondition(kbImageSets, userId, workspaceId, scope)");
    expect(repositorySource).toContain("workspaceId = ${workspaceId}");
    expect(repositorySource).toContain("WHERE userId = ${userId} AND workspaceId = ${workspaceId}");
  });
});
