import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const routerSource = readFileSync(new URL("./routers/kbProducts.ts", import.meta.url), "utf8");
const listingRouterSource = readFileSync(new URL("./routers/kbListings.ts", import.meta.url), "utf8");
const repositorySource = readFileSync(new URL("./kbDb.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../drizzle/0148_knowledge_workspace_scope.sql", import.meta.url), "utf8");

describe("产品知识库工作空间范围契约", () => {
  it("使用公共知识库授权过程，并将请求工作空间传入读取和写入路径", () => {
    expect(routerSource).toContain('workspaceScopedProcedure("knowledge")');
    expect(routerSource).toContain("ctx.workspaceId!");
    expect(routerSource).toContain("workspaceId: ctx.workspaceId!");
  });

  it("仓储层将列表、去重与写入约束在workspaceId内", () => {
    expect(repositorySource).toContain("eq(table.workspaceId, workspaceId)");
    expect(repositorySource).toContain("eq(kbProductInnovations.workspaceId, workspaceId)");
    expect(repositorySource).toContain("eq(kbListingCopywriting.workspaceId, workspaceId)");
  });

  it("Listing文案知识库同样通过公共中间件并将异步回写绑定到请求工作空间", () => {
    expect(listingRouterSource).toContain('workspaceScopedProcedure("knowledge")');
    expect(listingRouterSource).toContain("workspaceId: ctx.workspaceId!");
    expect(listingRouterSource).toContain("updateListingCopywriting(Number(id), ctx.user.id, ctx.workspaceId!");
  });

  it("迁移为核心知识库表添加工作空间字段和索引", () => {
    expect(migrationSource).toContain("ALTER TABLE kb_product_innovations ADD COLUMN workspaceId");
    expect(migrationSource).toContain("ALTER TABLE kb_image_sets ADD COLUMN workspaceId");
    expect(migrationSource).toContain("idx_kb_product_innovations_workspace_status");
  });
});
