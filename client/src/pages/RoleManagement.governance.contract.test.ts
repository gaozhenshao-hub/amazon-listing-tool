import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "client/src/pages/RoleManagement.tsx"),
  "utf8",
);

describe("权限治理中心页面契约", () => {
  it("提供单公司成员、角色模板、资源动作字典和权限目录工作区", () => {
    expect(source).toContain('Tabs defaultValue="overview"');
    expect(source).toContain('TabsTrigger value="overview"');
    expect(source).toContain('TabsTrigger value="roles"');
    expect(source).toContain('TabsTrigger value="members"');
    expect(source).toContain('TabsTrigger value="resources"');
    expect(source).toContain('TabsTrigger value="catalog"');
    expect(source).toContain("trpc.userManagement.list.useQuery");
    expect(source).toContain("trpc.roleManagement.governanceSnapshot.useQuery");
  });

  it("明确最终权限来源与目录同步的兼容阶段", () => {
    expect(source).toContain("最终权限如何计算");
    expect(source).toContain("目录同步阶段新增的路由目前处于“仅目录”模式");
    expect(source).toContain("权限目录已统一覆盖模块、子模块、页面路由与资源映射");
    expect(source).toContain("目录观察态不会改变当前成员访问结果。");
  });

  it("要求先执行服务端变更预览，再保存角色模板", () => {
    expect(source).toContain("trpc.roleManagement.previewUpdate.useMutation");
    expect(source).toContain("请先查看变更影响与风险提示");
    expect(source).toContain("预览不会写入任何授权。");
    expect(source).toContain("不会自动变更成员角色、项目或ASIN范围。");
  });
});
