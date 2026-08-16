import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./domains/ai_os/workspaceScopedProcedure.ts", import.meta.url), "utf8");
const resources = readFileSync(new URL("../shared/const.ts", import.meta.url), "utf8");
const productDevelopmentProcedure = readFileSync(new URL("./domains/product_development/security/productDevelopmentProcedure.ts", import.meta.url), "utf8");

describe("公共工作空间授权过程契约", () => {
  it("拒绝未绑定工作空间的请求，并在执行前校验资源动作", () => {
    expect(source).toContain("当前用户尚未绑定工作空间");
    expect(source).toContain("assertResourceAction");
    expect(source).toContain("workspaceId");
  });

  it("为知识库提供独立的模块权限映射", () => {
    expect(resources).toContain("'knowledge'");
    expect(resources).toContain("knowledge: { moduleId: 'knowledge' }");
  });

  it("产品开发在公共工作空间授权之后继续执行项目级访问解析", () => {
    expect(productDevelopmentProcedure).toContain('workspaceScopedProcedure("product_development")');
    expect(productDevelopmentProcedure).toContain("resolveDevProjectAccess(projectId, ctx, action)");
  });
});
