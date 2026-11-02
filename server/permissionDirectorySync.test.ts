import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PERMISSION_RESOURCE_REGISTRY,
  PERMISSION_MODULES,
  PERMISSION_ROUTE_REGISTRY,
  SECURITY_RESOURCE_MODULES,
  SUB_MODULES,
} from "@shared/const";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("统一权限目录同步", () => {
  it("让每一个模块目录都拥有子模块定义，并让每条注册路由指向有效目录", () => {
    const moduleIds = new Set(PERMISSION_MODULES.map((module) => module.id));
    const subModuleIds = new Set(Object.values(SUB_MODULES).flat().map((subModule) => subModule.id));

    expect(moduleIds).toEqual(new Set(Object.keys(SUB_MODULES)));
    for (const rule of Object.values(PERMISSION_ROUTE_REGISTRY)) {
      expect(moduleIds.has(rule.moduleId)).toBe(true);
      if (rule.subModuleId) expect(subModuleIds.has(rule.subModuleId)).toBe(true);
    }
  });

  it("覆盖站外和皇帝子模块，并在角色编辑、前台守卫中使用同一目录", () => {
    expect(PERMISSION_MODULES.map((module) => module.id)).toContain("offsite");
    expect(PERMISSION_MODULES.map((module) => module.id)).toContain("emperor");
    expect(PERMISSION_ROUTE_REGISTRY["/offsite/analytics"]?.subModuleId).toBe("offsite_analytics");
    expect(PERMISSION_ROUTE_REGISTRY["/emperor/skills"]?.subModuleId).toBe("emperor_skills");

    expect(source("server/routers/roleManagement.ts")).toContain("PERMISSION_MODULES");
    expect(source("client/src/components/PermissionGuard.tsx")).toContain("PERMISSION_ROUTE_REGISTRY");
    expect(source("client/src/components/PermissionGuard.tsx")).toContain('routeMatch?.enforcement === "catalog_only"');
  });

  it("从同一资源目录派生后端资源级授权映射，并覆盖站外和皇帝资源", () => {
    expect(SECURITY_RESOURCE_MODULES).toBe(PERMISSION_RESOURCE_REGISTRY);
    expect(PERMISSION_RESOURCE_REGISTRY.offsite_campaign).toEqual({
      moduleId: "offsite",
      subModuleId: "offsite_campaigns",
    });
    expect(PERMISSION_RESOURCE_REGISTRY.emperor_skill).toEqual({
      moduleId: "emperor",
      subModuleId: "emperor_skills",
    });
    expect(source("server/services/securityGovernance.ts")).toContain("SECURITY_RESOURCE_MODULES");
  });
});
