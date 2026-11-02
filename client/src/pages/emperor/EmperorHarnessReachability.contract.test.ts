import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../../components/DashboardLayout.tsx", import.meta.url), "utf8");
const permissionSource = readFileSync(new URL("../../../../shared/const.ts", import.meta.url), "utf8");

describe("皇帝Harness P0前台可达性契约", () => {
  it("为质量门禁和治理中心注册受权限守卫的懒加载路由", () => {
    expect(appSource).toContain('lazy(() => import("./pages/emperor/EmperorQualityGates"))');
    expect(appSource).toContain('lazy(() => import("./pages/emperor/EmperorHarnessGovernance"))');
    expect(appSource).toContain('<Route path="/emperor/quality">{() => <PermissionGuard><EmperorQualityGates /></PermissionGuard>}</Route>');
    expect(appSource).toContain('<Route path="/emperor/governance">{() => <PermissionGuard><EmperorHarnessGovernance /></PermissionGuard>}</Route>');
  });

  it("将两项页面纳入统一权限目录与皇帝侧边栏", () => {
    expect(permissionSource).toContain("{ id: 'emperor_quality', label: '质量门禁' }");
    expect(permissionSource).toContain("{ id: 'emperor_governance', label: 'Harness治理' }");
    expect(permissionSource).toContain("'/emperor/quality': { moduleId: 'emperor', subModuleId: 'emperor_quality', enforcement: 'catalog_only' }");
    expect(permissionSource).toContain("'/emperor/governance': { moduleId: 'emperor', subModuleId: 'emperor_governance', enforcement: 'catalog_only' }");
    expect(sidebarSource).toContain('{ icon: ClipboardCheck, label: "质量门禁", path: "/emperor/quality" }');
    expect(sidebarSource).toContain('{ icon: Shield, label: "Harness 治理", path: "/emperor/governance" }');
  });
});
