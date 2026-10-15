// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PermissionGuard } from "./PermissionGuard";
import appSource from "../App.tsx?raw";
import { PERMISSION_ROUTE_REGISTRY } from "@shared/const";

const permissions = vi.hoisted(() => ({
  canRead: vi.fn(), canEdit: vi.fn(), canDelete: vi.fn(),
  hasModuleAccess: vi.fn(), isLoading: false,
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => permissions }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7 } }) }));
beforeEach(() => {
  vi.clearAllMocks();
  permissions.hasModuleAccess.mockReturnValue(true);
  permissions.canRead.mockReturnValue(false);
});
afterEach(cleanup);

function showRoute(path: string) {
  const location = memoryLocation({ path });
  render(<Router hook={location.hook}><Route path="/ops/read-only-overview">{() => (
    <PermissionGuard moduleId="ops" subModuleId="ops_data_import">
      <div>Read-only data</div>
    </PermissionGuard>
  )}</Route></Router>);
}

describe("operations read-only route", () => {
  it.each(["/ops/read-only-overview", "/ops/read-only-overview/", "/OPS/READ-ONLY-OVERVIEW"])(
    "requires read permission even for router variant %s", (path) => {
      showRoute(path);
      expect(screen.getByRole("heading", { name: "无访问权限" })).toBeInTheDocument();
      expect(screen.queryByText("Read-only data")).not.toBeInTheDocument();
      expect(permissions.canRead).toHaveBeenCalledWith("ops", "ops_data_import");
    },
  );
  it("admits read without asking for import/edit permission", () => {
    permissions.canRead.mockReturnValue(true);
    showRoute("/ops/read-only-overview");
    expect(screen.getByText("Read-only data")).toBeInTheDocument();
    expect(permissions.canEdit).not.toHaveBeenCalled();
  });
  it("retains the explicit guard and opt-in on the actual App route", () => {
    expect(appSource).toMatch(/MERGED_READONLY_FEATURES_ENABLED && \(\s*<Route path="\/ops\/read-only-overview">/);
    expect(appSource).toMatch(/<PermissionGuard moduleId="ops" subModuleId="ops_data_import">\s*<OperationsReadOnlyOverview\s*\/>/);
    expect(PERMISSION_ROUTE_REGISTRY["/ops/read-only-overview"]).toEqual({
      moduleId: "ops", subModuleId: "ops_data_import", enforcement: "enforced",
    });
  });
});
