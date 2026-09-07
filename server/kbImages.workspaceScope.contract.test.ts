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

  it("按当前工作空间去重并为新上传持久化对象标识", () => {
    expect(repositorySource).toContain("findImageSetByAsin(asin: string, workspaceId: number)");
    expect(repositorySource).toContain("eq(kbImageSets.workspaceId, workspaceId)");
    expect(routerSource).toContain("findImageSetByAsin(asin, ctx.workspaceId!)");
    expect(routerSource).toContain("imageUrl: storageUri");
  });

  it("列表和详情交付前动态刷新图片对象访问地址", () => {
    expect(routerSource).toContain("resolveImagesForDelivery(set.thumbnailImages)");
    expect(routerSource).toContain("resolveImagesForDelivery(await kbDb.listImagesBySetLight(set.id))");
    expect(routerSource).toContain("resolveImagesForDelivery(await kbDb.listAllImages");
  });
});
