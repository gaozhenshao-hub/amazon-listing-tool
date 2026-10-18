import { describe, expect, it } from "vitest";
import { PERMISSION_RESOURCE_REGISTRY, SECURITY_ACTION_OPERATION, SECURITY_PERMISSION_MATRIX } from "../shared/const";
describe("manual complete inventory collection permissions", () => {
  it("keeps manager collection separate from reads, manual planning and scheduled sync", () => {
    expect(PERMISSION_RESOURCE_REGISTRY.ops_inventory_collection).toEqual({ moduleId: "ops", subModuleId: "ops_inventory" });
    for (const role of ["super_admin", "admin", "ops_manager"]) expect(SECURITY_PERMISSION_MATRIX[role].ops_inventory_collection).toEqual(["read", "create", "cancel"]);
    expect(SECURITY_ACTION_OPERATION.create).toBe("edit"); expect(SECURITY_ACTION_OPERATION.cancel).toBe("edit");
  });
  it("does not grant ordinary roles complete-workspace collection", () => {
    for (const [role, resources] of Object.entries(SECURITY_PERMISSION_MATRIX)) if (!["super_admin", "admin", "ops_manager"].includes(role)) expect(resources.ops_inventory_collection).toBeUndefined();
  });
  it("does not imply scheduler, secret, models or deletion", () => {
    for (const permissions of Object.values(SECURITY_PERMISSION_MATRIX)) for (const action of ["sync", "run", "invoke", "assign", "manage_secret", "delete", "upload", "update"]) expect(permissions.ops_inventory_collection ?? []).not.toContain(action);
  });
});
