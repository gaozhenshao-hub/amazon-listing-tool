// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PermissionGuard } from "./PermissionGuard";
import appSource from "../App.tsx?raw";

const permissions = vi.hoisted(() => ({
  canRead: vi.fn(),
  canEdit: vi.fn(),
  canDelete: vi.fn(),
  hasModuleAccess: vi.fn(),
  isLoading: false,
}));

vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => permissions }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, role: "operator" } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  permissions.hasModuleAccess.mockReturnValue(true);
  permissions.canRead.mockReturnValue(false);
});
afterEach(cleanup);

function renderLibraryRoute(path: string) {
  const location = memoryLocation({ path });
  render(<Router hook={location.hook}>
    <Route path="/emperor/agent-library">{() => (
      <PermissionGuard moduleId="emperor" subModuleId="emperor_agents">
        <div>Protected Agent library</div>
      </PermissionGuard>
    )}</Route>
  </Router>);
}

describe("Agent library explicit permission boundary", () => {
  it.each([
    "/emperor/agent-library",
    "/emperor/agent-library/",
    "/EMPEROR/AGENT-LIBRARY",
  ])("matches %s in the real router without falling back to public access", (path) => {
    renderLibraryRoute(path);
    expect(screen.getByRole("heading", { name: "无访问权限" })).toBeInTheDocument();
    expect(screen.getByText("子模块: emperor_agents")).toBeInTheDocument();
    expect(screen.queryByText("Protected Agent library")).not.toBeInTheDocument();
    expect(permissions.hasModuleAccess).toHaveBeenCalledWith("emperor");
    expect(permissions.canRead).toHaveBeenCalledWith("emperor", "emperor_agents");
  });

  it("still admits a user with the existing Agent read permission", () => {
    permissions.canRead.mockReturnValue(true);
    renderLibraryRoute("/emperor/agent-library");
    expect(screen.getByText("Protected Agent library")).toBeInTheDocument();
    expect(permissions.canRead).toHaveBeenCalledWith("emperor", "emperor_agents");
  });

  it("keeps the explicit boundary on the actual App route, not only this test fixture", () => {
    const routes = [...appSource.matchAll(/<Route\s+path="\/emperor\/agent-library">([\s\S]*?)<\/Route>/g)];
    expect(routes).toHaveLength(1);
    expect(routes[0][1]).toMatch(
      /<PermissionGuard\s+moduleId="emperor"\s+subModuleId="emperor_agents">\s*<EmperorAgentLibrary\s*\/>\s*<\/PermissionGuard>/,
    );
  });
});
