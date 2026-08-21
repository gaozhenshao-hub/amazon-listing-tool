import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "client/src/pages/RoleManagement.tsx"),
  "utf8",
);

describe("权限治理中心页面契约", () => {
  it("提供单公司成员、角色模板和权限目录三个工作区", () => {
    expect(source).toContain('Tabs defaultValue="overview"');
    expect(source).toContain('TabsTrigger value="overview"');
    expect(source).toContain('TabsTrigger value="roles"');
    expect(source).toContain('TabsTrigger value="catalog"');
    expect(source).toContain("trpc.userManagement.list.useQuery");
  });

  it("明确最终权限来源与目录同步的兼容阶段", () => {
    expect(source).toContain("最终权限如何计算");
    expect(source).toContain("目录同步阶段新增的路由目前处于“仅目录”模式");
    expect(source).toContain("权限目录已统一覆盖模块、子模块、页面路由与资源映射");
  });
});
