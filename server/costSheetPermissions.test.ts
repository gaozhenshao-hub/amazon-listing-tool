import { describe, expect, it } from "vitest";
import { PERMISSION_RESOURCE_REGISTRY, SECURITY_ACTION_OPERATION, SECURITY_PERMISSION_MATRIX } from "../shared/const";

describe("cost-sheet-specific permission catalogue", () => {
  it("grants only scoped read/save without broadening operations-data authority", () => {
    expect(PERMISSION_RESOURCE_REGISTRY.ops_cost_sheet).toEqual({ moduleId: "ops", subModuleId: "ops_data_import" });
    expect(PERMISSION_RESOURCE_REGISTRY.ops_data).toEqual({ moduleId: "ops", subModuleId: "ops_dashboard" });
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist.ops_data).toEqual(["read"]);
    for (const role of ["super_admin", "admin", "ops_manager", "ops_specialist"]) {
      expect(SECURITY_PERMISSION_MATRIX[role].ops_cost_sheet).toEqual(["read", "update"]);
    }
    expect(SECURITY_ACTION_OPERATION.update).toBe("edit");
  });
  it("does not grant import, synchronization, deletion, model execution or task assignment", () => {
    for (const permissions of Object.values(SECURITY_PERMISSION_MATRIX)) {
      for (const action of ["delete", "import", "sync", "run", "invoke", "assign", "upload"]) {
        expect(permissions.ops_cost_sheet ?? []).not.toContain(action);
      }
    }
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist.ops_task).not.toContain("assign");
  });
  it("does not enable writes for unrelated roles", () => {
    for (const role of ["finance", "designer", "purchaser", "product_dev"]) {
      expect(SECURITY_PERMISSION_MATRIX[role].ops_cost_sheet).toBeUndefined();
    }
    expect(SECURITY_PERMISSION_MATRIX.finance.ops_data).toEqual(["read", "export"]);
  });
});
