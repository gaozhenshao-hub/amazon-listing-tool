// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MergedOperationsMenuEntry, { type MergedOperationsMenuEntryProps } from "./MergedOperationsMenuEntry";

const controls = vi.hoisted(() => ({
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() }, authHook: vi.fn(), permissionHook: vi.fn(), businessQuery: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => { controls.authHook(); return controls.auth; } }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => { controls.permissionHook(); return controls.permissions; } }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: controls.businessQuery } }));
beforeEach(() => {
  vi.clearAllMocks(); controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  controls.permissions.isLoading = false; controls.permissions.canRead.mockReturnValue(true);
});
afterEach(cleanup);
function Entry({ directory = "ops_data_import" }: { directory?: MergedOperationsMenuEntryProps["directory"] }) {
  return <MergedOperationsMenuEntry directory={directory}><a href="/ops/profit-board">SYNTHETIC merged entry</a></MergedOperationsMenuEntry>;
}
describe("merged operations menu entry", () => {
  it.each(["ops_tasks", "ops_data_import"] as const)("allows %s only after both read directories are approved", directory => {
    render(<Entry directory={directory} />); expect(screen.getByRole("link")).toHaveAttribute("href", "/ops/profit-board");
    expect(controls.permissions.canRead.mock.calls).toEqual([["ops", "ops_dashboard"], ["ops", directory]]); expect(controls.businessQuery).not.toHaveBeenCalled();
  });
  it.each([
    ["auth loading", () => { controls.auth.loading = true; }], ["auth error", () => { controls.auth.error = new Error("SYNTHETIC private error"); }],
    ["logout", () => { controls.auth.user = null; }], ["invalid user", () => { controls.auth.user!.id = 0; }],
    ["fractional user", () => { controls.auth.user!.id = 7.5; }], ["oversized user", () => { controls.auth.user!.id = 2147483648; }],
    ["missing workspace", () => { controls.auth.user!.defaultWorkspaceId = null; }], ["invalid workspace", () => { controls.auth.user!.defaultWorkspaceId = -1; }],
    ["oversized workspace", () => { controls.auth.user!.defaultWorkspaceId = 2147483648; }], ["missing role", () => { controls.auth.user!.role = ""; }],
    ["whitespace role", () => { controls.auth.user!.role = " "; }], ["permissions loading", () => { controls.permissions.isLoading = true; }],
  ] as const)("hides without directory reads while %s", (_label, arrange) => {
    arrange(); const ui = render(<Entry />); expect(ui.container).toBeEmptyDOMElement(); expect(controls.permissions.canRead).not.toHaveBeenCalled(); expect(controls.businessQuery).not.toHaveBeenCalled();
  });
  it.each(["ops_tasks", "ops_data_import"] as const)("%s alone cannot bypass the dashboard gate", directory => {
    controls.permissions.canRead.mockImplementation((_module, requested) => requested === directory); const ui = render(<Entry directory={directory} />);
    expect(ui.container).toBeEmptyDOMElement(); expect(controls.permissions.canRead.mock.calls).toEqual([["ops", "ops_dashboard"]]);
  });
  it.each(["ops_tasks", "ops_data_import"] as const)("dashboard approval alone cannot bypass %s", directory => {
    controls.permissions.canRead.mockImplementation((_module, requested) => requested === "ops_dashboard"); const ui = render(<Entry directory={directory} />); expect(ui.container).toBeEmptyDOMElement();
  });
  it("task permission does not display the financial entry", () => {
    controls.permissions.canRead.mockImplementation((_module, requested) => requested === "ops_dashboard" || requested === "ops_tasks");
    const ui = render(<Entry directory="ops_tasks" />); expect(screen.getByRole("link")).toBeInTheDocument(); ui.rerender(<Entry directory="ops_data_import" />); expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it.each(["actor", "workspace", "role", "auth pending", "auth error", "permission pending", "permission revoked"] as const)("re-evaluates %s changes without retaining previously visible children", kind => {
    const ui = render(<Entry />); expect(screen.getByRole("link")).toBeInTheDocument();
    if (kind === "actor") { controls.auth.user!.id = 8; controls.permissions.isLoading = true; }
    if (kind === "workspace") { controls.auth.user!.defaultWorkspaceId = 12; controls.permissions.isLoading = true; }
    if (kind === "role") { controls.auth.user!.role = "ops_specialist"; controls.permissions.canRead.mockReturnValue(false); }
    if (kind === "auth pending") controls.auth.loading = true; if (kind === "auth error") controls.auth.error = new Error("SYNTHETIC private error");
    if (kind === "permission pending") controls.permissions.isLoading = true; if (kind === "permission revoked") controls.permissions.canRead.mockReturnValue(false);
    ui.rerender(<Entry />); expect(ui.container).toBeEmptyDOMElement(); expect(controls.businessQuery).not.toHaveBeenCalled();
  });
  it("can display a newly verified identity only once fresh permission loading has ended", () => {
    const ui = render(<Entry />); controls.auth.user!.id = 8; controls.permissions.isLoading = true; ui.rerender(<Entry />); expect(ui.container).toBeEmptyDOMElement();
    controls.permissions.isLoading = false; controls.permissions.canRead.mockReturnValue(true); ui.rerender(<Entry />); expect(screen.getByRole("link")).toBeInTheDocument();
  });
  it("does not affect legacy siblings or call its hooks when an outer feature flag omits it", () => {
    const enabled = false; render(<nav><a href="/ops/dashboard-upgrade">Legacy entry</a>{enabled && <Entry />}</nav>);
    expect(screen.getByRole("link", { name: "Legacy entry" })).toBeInTheDocument(); expect(controls.authHook).not.toHaveBeenCalled(); expect(controls.permissionHook).not.toHaveBeenCalled(); expect(controls.businessQuery).not.toHaveBeenCalled();
  });
});
