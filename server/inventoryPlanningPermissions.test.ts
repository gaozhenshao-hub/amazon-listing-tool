import { describe, expect, it } from "vitest";
import { PERMISSION_RESOURCE_REGISTRY, SECURITY_ACTION_OPERATION, SECURITY_PERMISSION_MATRIX } from "../shared/const";

describe("per-user inventory planning write permissions", () => {
  it("binds a separate exact resource to the existing inventory directory", () => {
    expect(PERMISSION_RESOURCE_REGISTRY.ops_inventory_planning).toEqual({ moduleId: "ops", subModuleId: "ops_inventory" });
    for (const role of ["super_admin", "admin", "ops_manager"]) expect(SECURITY_PERMISSION_MATRIX[role].ops_inventory_planning).toEqual(["read", "update", "cancel"]);
    expect(SECURITY_ACTION_OPERATION.update).toBe("edit");
    expect(SECURITY_ACTION_OPERATION.cancel).toBe("edit");
  });
  it("does not silently expand specialist or finance manual-write access", () => {
    for (const [role, permissions] of Object.entries(SECURITY_PERMISSION_MATRIX)) if (!["super_admin", "admin", "ops_manager"].includes(role)) expect(permissions.ops_inventory_planning).toBeUndefined();
  });
  it("does not imply collection, scheduler, models, secrets or deletion", () => {
    for (const permissions of Object.values(SECURITY_PERMISSION_MATRIX)) for (const action of ["create", "sync", "run", "invoke", "assign", "manage_secret", "delete", "upload"]) expect(permissions.ops_inventory_planning ?? []).not.toContain(action);
  });
});
