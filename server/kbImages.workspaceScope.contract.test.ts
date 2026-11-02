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
    expect(repositorySource).toContain("imageSetScopeCondition(userId, workspaceId, scope)");
    expect(repositorySource).toContain("eq(kbImageSets.workspaceId, workspaceId)");
    expect(repositorySource).toContain("imageSetIdsMatching(imageSetScopeCondition(userId, workspaceId, scope))");
  });

  it("所有图片知识库接口均经过knowledge工作空间授权", () => {
    for (const endpoint of [
      "listSets", "getSet", "getImageAnalysis", "listAllImages", "importByAsin", "batchImportAsins", "importByLink",
      "confirmImageTags", "confirmSetAnalysis", "updateImageScore", "reCrawlByPosition", "uploadImages", "deleteImage",
      "reorderImages", "reAnalyze", "reAnalyzeSummaryOnly", "deleteSet", "updateSetStyle", "createSetFromUpload",
    ]) {
      expect(routerSource).toContain(`${endpoint}: workspaceScopedProcedure(\"knowledge\")`);
    }
  });

  it("详情和单图分析只允许当前工作空间内的所有者或非私有已确认共享集合", () => {
    expect(routerSource).toContain("getReadableImageSet(input.id, ctx.user.id, ctx.workspaceId!)");
    expect(routerSource).toContain("getReadableImageWithAnalysis(input.imageId, ctx.user.id, ctx.workspaceId!)");
    expect(repositorySource).toContain("eq(kbImageSets.status, \"confirmed\"), ne(kbImageSets.visibility, \"private\")");
    expect(repositorySource).toContain("imageInReadableSetCondition(imageId, userId, workspaceId)");
  });

  it("跨租户图片写操作使用 imageId、setId、owner 和 workspace 的复合SQL谓词", () => {
    expect(repositorySource).toContain("function imageInOwnedSetCondition(imageId: number, imageSetId: number, userId: number, workspaceId: number)");
    expect(repositorySource).toContain("eq(kbImages.id, imageId)");
    expect(repositorySource).toContain("eq(kbImages.imageSetId, imageSetId)");
    expect(repositorySource).toContain("ownedImageSetCondition(imageSetId, userId, workspaceId)");
    expect(repositorySource).toContain("deleteImageInOwnedSet(imageId: number, imageSetId: number, userId: number, workspaceId: number)");
    expect(repositorySource).toContain("reorderImagesInOwnedSet(imageSetId: number, userId: number, workspaceId: number");
    expect(routerSource).toContain("getImageInOwnedSet(input.imageId, set.id, ctx.user.id, ctx.workspaceId!)");
    expect(routerSource).toContain("reorderImagesInOwnedSet(set.id, ctx.user.id, ctx.workspaceId!, input.imageOrders)");
  });

  it("删除集合在删子图前先校验当前工作空间所有权，子图删除也带同一复合谓词", () => {
    expect(routerSource).toContain("getOwnedImageSet(input.id, ctx.user.id, ctx.workspaceId!)");
    expect(routerSource).toContain("deleteOwnedImageSet(input.id, ctx.user.id, ctx.workspaceId!)");
    expect(repositorySource).toContain("const rows = await _d.select({ id: kbImageSets.id }).from(kbImageSets).where(condition).limit(1)");
    expect(repositorySource).toContain("await _d.delete(kbImages).where(and(eq(kbImages.imageSetId, id), imageSetIdsMatching(condition)))");
  });

  it("刷新、上传、确认、风格与重分析均不会越过当前工作空间", () => {
    expect(routerSource).toContain("getOwnedImageSet(input.setId, ctx.user.id, ctx.workspaceId!)");
    expect(routerSource).toContain("updateOwnedImageSet(set.id, ctx.user.id, ctx.workspaceId!, { status: \"analyzing\" })");
    expect(routerSource).toContain("getOwnedImage(imageId, ctx.user.id, ctx.workspaceId!)");
    expect(routerSource).toContain("updateOwnedImage(imageId, ctx.user.id, ctx.workspaceId!");
    expect(routerSource).toContain("updateOwnedImageSet(id, ctx.user.id, ctx.workspaceId!, update)");
    expect(repositorySource).toContain("imageInOwnedWorkspaceCondition(imageId, userId, workspaceId)");
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

  it("Amazon导入通过统一采集Job且刷新确认前保留旧图片", () => {
    expect(routerSource).toContain("startAmazonAcquisitionJob");
    expect(routerSource).toContain('consumerType: "kb_images"');
    expect(routerSource).toContain('cachePolicy: "refresh"');
    const importSection = routerSource.slice(routerSource.indexOf("importByAsin:"), routerSource.indexOf("confirmImageTags:"));
    expect(importSection).not.toContain("processImport(");
    const refreshSection = routerSource.slice(routerSource.indexOf("reCrawlByPosition:"), routerSource.indexOf("uploadImages:"));
    expect(refreshSection).not.toContain("processPartialReCrawl(");
    expect(refreshSection).not.toContain("deleteImagesByPosition");
  });
});
