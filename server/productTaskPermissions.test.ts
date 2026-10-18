import { describe, expect, it } from "vitest";
import { PERMISSION_RESOURCE_REGISTRY, SECURITY_ACTION_OPERATION, SECURITY_PERMISSION_MATRIX } from "../shared/const";

describe("task-specific permission catalogue", () => {
  it("does not reuse the financial resource or grant specialists financial mutations", () => {
    expect(PERMISSION_RESOURCE_REGISTRY.ops_task).toEqual({ moduleId: "ops", subModuleId: "ops_tasks" });
    expect(PERMISSION_RESOURCE_REGISTRY.ops_data.subModuleId).toBe("ops_dashboard");
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist.ops_data).toEqual(["read"]);
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist.ops_task).toEqual(["read", "create", "update", "upload", "export", "delete"]);
  });
  it("keeps numeric assignment privileged and does not introduce scheduler or AI actions", () => {
    for (const role of ["admin", "super_admin", "ops_manager"]) expect(SECURITY_PERMISSION_MATRIX[role].ops_task).toContain("assign");
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist.ops_task).not.toContain("assign");
    for (const grants of Object.values(SECURITY_PERMISSION_MATRIX)) {
      expect(grants.ops_task ?? []).not.toContain("sync");
      expect(grants.ops_task ?? []).not.toContain("run");
      expect(grants.ops_task ?? []).not.toContain("invoke");
    }
  });
  it("does not newly enable task writes for financial, design, purchasing or development roles", () => {
    for (const role of ["finance", "designer", "purchaser", "product_dev"]) expect(SECURITY_PERMISSION_MATRIX[role].ops_task).toBeUndefined();
    expect(SECURITY_ACTION_OPERATION.delete).toBe("delete");
    expect(SECURITY_ACTION_OPERATION.upload).toBe("edit");
    expect(SECURITY_ACTION_OPERATION.export).toBe("read");
  });
});
