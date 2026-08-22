import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "server/routers/roleManagement.ts"), "utf8");

describe("角色治理Router契约", () => {
  it("只向管理员公开公司权限快照与变更预览", () => {
    expect(source).toContain("governanceSnapshot: protectedProcedure.query");
    expect(source).toContain("previewUpdate: protectedProcedure");
    expect(source).toContain("singleCompanyMode: true");
    expect(source).toContain("需要管理员权限");
  });

  it("在写入前校验共享目录并计算影响范围", () => {
    expect(source).toContain("validateRoleUpdate(input)");
    expect(source).toContain("affectedMemberCount");
    expect(source).toContain("PERMISSION_ROUTE_REGISTRY");
    expect(source).toContain("PERMISSION_RESOURCE_REGISTRY");
  });

  it("保存角色模板时记录脱敏审计而不修改成员授权", () => {
    expect(source).toContain("recordSecurityAuditLog");
    expect(source).toContain('action: "role_permission.update"');
    expect(source).toContain("beforeSnapshot: preview.before");
    expect(source).toContain("afterSnapshot: preview.after");
  });
});
