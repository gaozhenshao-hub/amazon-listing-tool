import { describe, expect, it } from "vitest";
import { PERMISSION_RESOURCE_REGISTRY, SECURITY_ACTION_OPERATION, SECURITY_PERMISSION_MATRIX } from "../shared/const";

describe("whole-scope monthly-import permission catalogue", () => {
  it("keeps whole-file writes separate from ordinary operations reads and scheduled sync", () => {
    expect(PERMISSION_RESOURCE_REGISTRY.ops_monthly_import).toEqual({ moduleId: "ops", subModuleId: "ops_data_import" });
    expect(PERMISSION_RESOURCE_REGISTRY.ops_data).toEqual({ moduleId: "ops", subModuleId: "ops_dashboard" });
    for (const role of ["super_admin", "admin", "ops_manager"]) {
      expect(SECURITY_PERMISSION_MATRIX[role].ops_monthly_import).toEqual(["read", "create", "update", "delete"]);
    }
    expect(SECURITY_ACTION_OPERATION.create).toBe("edit");
    expect(SECURITY_ACTION_OPERATION.update).toBe("edit");
    expect(SECURITY_ACTION_OPERATION.delete).toBe("delete");
  });
  it("does not turn parent-level ownership or uploader status into whole-shop overwrite authority", () => {
    for (const role of ["ops_specialist", "finance", "designer", "purchaser", "product_dev"]) {
      expect(SECURITY_PERMISSION_MATRIX[role].ops_monthly_import).toBeUndefined();
    }
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist.ops_data).toEqual(["read"]);
    expect(SECURITY_PERMISSION_MATRIX.finance.ops_data).toEqual(["read", "export"]);
  });
  it("does not authorize models, task assignment, inventory synchronization or public object upload", () => {
    for (const permissions of Object.values(SECURITY_PERMISSION_MATRIX)) {
      for (const action of ["sync", "run", "invoke", "assign", "upload", "manage_secret"]) {
        expect(permissions.ops_monthly_import ?? []).not.toContain(action);
      }
    }
    expect(SECURITY_PERMISSION_MATRIX.ops_manager.ops_data).not.toContain("delete");
  });
});
