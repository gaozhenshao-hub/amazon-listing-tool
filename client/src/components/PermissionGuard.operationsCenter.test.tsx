// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PermissionGuard } from "./PermissionGuard";
import appSource from "../App.tsx?raw";
import layoutSource from "./DashboardLayout.tsx?raw";
import { PERMISSION_ROUTE_REGISTRY } from "@shared/const";

const permissions = vi.hoisted(() => ({
  canRead: vi.fn(), canEdit: vi.fn(), canDelete: vi.fn(),
  hasModuleAccess: vi.fn(), isLoading: false,
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => permissions }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7 } }) }));
beforeEach(() => {
  vi.clearAllMocks();
  permissions.isLoading = false;
  permissions.hasModuleAccess.mockReturnValue(true);
  permissions.canRead.mockReturnValue(false);
});
afterEach(cleanup);
const routes = [
  { path: "/ops/product-board", panel: "products", directory: "ops_data_import" },
  { path: "/ops/profit-board", panel: "profit", directory: "ops_data_import" },
  { path: "/ops/product-tasks", panel: "tasks", directory: "ops_tasks" },
] as const;
function showRoute(route: typeof routes[number], path = route.path, enabled = true) {
  const location = memoryLocation({ path });
  render(<Router hook={location.hook}>{enabled && <Route path={route.path}>{() => (
    <PermissionGuard moduleId="ops" subModuleId={route.directory}>
      <div>Selected private panel</div>
    </PermissionGuard>
  )}</Route>}</Router>);
}

describe.each(routes)("formal operations route $path", route => {
  it.each(["exact", "trailing-slash", "uppercase"])("rejects missing permission for %s", variant => {
    const path = variant === "exact" ? route.path : variant === "trailing-slash" ? route.path + "/" : route.path.toUpperCase();
    showRoute(route, path as typeof route.path);
    expect(screen.getByRole("heading", { name: "无访问权限" })).toBeInTheDocument();
    expect(screen.queryByText("Selected private panel")).not.toBeInTheDocument();
    expect(permissions.canRead).toHaveBeenCalledWith("ops", route.directory);
  });
  it("allows read without edit/delete grants", () => {
    permissions.canRead.mockReturnValue(true);
    showRoute(route);
    expect(screen.getByText("Selected private panel")).toBeInTheDocument();
    expect(permissions.canEdit).not.toHaveBeenCalled();
    expect(permissions.canDelete).not.toHaveBeenCalled();
  });
  it("does not mount a route with the integration flag off", () => {
    showRoute(route, route.path, false);
    expect(screen.queryByText("Selected private panel")).not.toBeInTheDocument();
    expect(permissions.canRead).not.toHaveBeenCalled();
  });
  it("does not mount while permission is loading", () => {
    permissions.isLoading = true;
    showRoute(route);
    expect(screen.queryByText("Selected private panel")).not.toBeInTheDocument();
  });
  it("rejects module access independently of directory read", () => {
    permissions.hasModuleAccess.mockReturnValue(false);
    permissions.canRead.mockReturnValue(true);
    showRoute(route);
    expect(screen.getByRole("heading", { name: "无访问权限" })).toBeInTheDocument();
  });
  it("binds the actual App route, registry and flagged sidebar to the same directory", () => {
    const escapedPath = route.path.replaceAll("/", "\\/");
    expect(appSource).toContain(`<Route path="${route.path}">`);
    expect(appSource.replace(/\s+/g, " ")).toContain(`<PermissionGuard moduleId="ops" subModuleId="${route.directory}"><OperationsCenter initialPanel="${route.panel}" />`);
    expect(PERMISSION_ROUTE_REGISTRY[route.path]).toEqual({ moduleId: "ops", subModuleId: route.directory, enforcement: "enforced" });
    const flagStart = layoutSource.lastIndexOf("...(MERGED_READONLY_FEATURES_ENABLED", layoutSource.indexOf(`path: "${route.path}"`));
    const flagEnd = layoutSource.indexOf(": []),", flagStart);
    expect(layoutSource).toContain(`path: "${route.path}", requiredOpsDirectory: "${route.directory}"`);
    expect(layoutSource).toContain('<MergedOperationsMenuEntry key={entry.path} directory={entry.requiredOpsDirectory}>{button}</MergedOperationsMenuEntry>');
  });
});
it("redirects duplicate centers and tasks while preserving products and diagnostic access", () => {
  expect(appSource).not.toContain('<Route path="/ops/dashboard-upgrade">');
  expect(appSource).toContain('<Route path="/ops/tasks">{() => <Redirect to={`/ops/product-tasks${window.location.search}`} />}</Route>');
  expect(appSource).not.toContain('import("./pages/ops/OpsTaskManagement")');
  for (const [path, component] of [["/ops/products", "OpsProducts"]]) {
    expect(appSource).toContain(`<Route path="${path}">{() => <PermissionGuard><${component} /></PermissionGuard>}</Route>`);
    expect(layoutSource).toContain(`path: "${path}"`);
  }
  expect(appSource).not.toContain('<OperationsReadOnlyOverview />');
  expect(layoutSource).not.toContain('path: "/ops/read-only-overview"');
});
