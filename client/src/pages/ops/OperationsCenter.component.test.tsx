// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OperationsCenter, { type OperationsCenterPanel } from "./OperationsCenter";

const controls = vi.hoisted(() => ({
  enabled: true,
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() },
  mounted: vi.fn(), unmounted: vi.fn(), readFinancial: vi.fn(), callModel: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/mergedReadOnlyFeatures", () => ({ get MERGED_READONLY_FEATURES_ENABLED() { return controls.enabled; } }));
function MockPage({ panel }: { panel: OperationsCenterPanel }) {
  const [draft, setDraft] = useState("");
  useEffect(() => { controls.mounted(panel); return () => { controls.unmounted(panel); }; }, [panel]);
  return <section aria-label={`SYNTHETIC ${panel}`}><input aria-label={`${panel} draft`} value={draft} onChange={event => setDraft(event.currentTarget.value)} /><button onClick={() => controls.readFinancial(panel)}>显式读取 {panel}</button><button onClick={() => controls.callModel(panel)}>显式生成 {panel}</button></section>;
}
vi.mock("./OpsDashboardUpgrade", () => ({ default: () => <MockPage panel="legacy" /> }));
vi.mock("./ProductTasksReadOnly", () => ({ default: () => <MockPage panel="tasks" /> }));
vi.mock("./ProfitBoardReadOnly", () => ({ default: () => <MockPage panel="profit" /> }));
vi.mock("./ProductBoardReadOnly", () => ({ default: () => <MockPage panel="products" /> }));
beforeEach(() => {
  vi.clearAllMocks(); controls.enabled = true;
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  controls.permissions.isLoading = false; controls.permissions.canRead.mockReturnValue(true);
});
afterEach(cleanup);
const page = (panel: OperationsCenterPanel) => screen.findByRole("region", { name: `SYNTHETIC ${panel}` });
describe("formal operations center routes", () => {
  it.each([undefined, "legacy", "tasks", "profit", "products"] as const)("feature off preserves only the legacy page for prop %s", async initialPanel => {
    controls.enabled = false; controls.auth.loading = true; controls.permissions.isLoading = true;
    render(<OperationsCenter initialPanel={initialPanel} />); await page("legacy");
    expect(controls.mounted.mock.calls).toEqual([["legacy"]]); expect(screen.queryByRole("navigation")).not.toBeInTheDocument(); expect(controls.permissions.canRead).not.toHaveBeenCalled();
  });
  it("defaults the old route to the old center and shows four ordinary navigation links", async () => {
    render(<OperationsCenter />); await page("legacy");
    const nav = within(screen.getByRole("navigation", { name: "运营中心页面" }));
    expect(nav.getAllByRole("link")).toHaveLength(4);
    for (const [name, href] of [["运营任务", "/ops/product-tasks"], ["利润看板", "/ops/profit-board"], ["产品看板", "/ops/product-board"], ["原运营中心", "/ops/dashboard-upgrade"]]) expect(nav.getByRole("link", { name })).toHaveAttribute("href", href);
    expect(nav.getByRole("link", { name: "原运营中心" })).toHaveAttribute("aria-current", "page"); expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation")).toHaveClass("overflow-x-auto", "min-w-0", "max-w-full");
  });
  it.each(["tasks", "profit", "products"] as const)("mounts only the explicitly selected %s pane without automatically reading or generating", async initialPanel => {
    render(<OperationsCenter initialPanel={initialPanel} />); await page(initialPanel);
    expect(controls.mounted.mock.calls).toEqual([[initialPanel]]); expect(controls.readFinancial).not.toHaveBeenCalled(); expect(controls.callModel).not.toHaveBeenCalled();
    expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_dashboard"); expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", initialPanel === "tasks" ? "ops_tasks" : "ops_data_import");
    expect(screen.getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  });
  it("the selected route prop wins over query string and local storage", async () => {
    window.history.replaceState(null, "", "/ops/product-board?panel=tasks"); window.localStorage.setItem("operations-center-panel", "profit");
    try { render(<OperationsCenter initialPanel="products" />); await page("products"); expect(controls.mounted.mock.calls).toEqual([["products"]]); }
    finally { window.history.replaceState(null, "", "/"); window.localStorage.removeItem("operations-center-panel"); }
  });
  it("navigation uses a link; the host selects the next pane without mounting hidden panes or making business calls", async () => {
    const ui = render(<OperationsCenter initialPanel="products" />); await page("products");
    const link = screen.getByRole("link", { name: "利润看板" }); link.addEventListener("click", event => event.preventDefault()); fireEvent.click(link);
    expect(controls.mounted.mock.calls).toEqual([["products"]]); ui.rerender(<OperationsCenter initialPanel="profit" />); await page("profit");
    expect(controls.unmounted).toHaveBeenCalledWith("products"); expect(controls.mounted.mock.calls).toEqual([["products"], ["profit"]]);
    expect(controls.readFinancial).not.toHaveBeenCalled(); expect(controls.callModel).not.toHaveBeenCalled();
  });
  it("does not silently redirect an invalid panel to the legacy page", () => {
    render(<OperationsCenter initialPanel={"invalid" as OperationsCenterPanel} />); expect(screen.getByRole("alert")).toHaveTextContent("选择不合法"); expect(controls.mounted).not.toHaveBeenCalled();
  });
});
describe("new pane identity and permission isolation", () => {
  it.each([
    ["auth loading", () => { controls.auth.loading = true; }], ["auth error", () => { controls.auth.error = new Error("SYNTHETIC_PRIVATE_ERROR"); }],
    ["logout", () => { controls.auth.user = null; }], ["invalid user", () => { controls.auth.user!.id = 0; }],
    ["invalid workspace", () => { controls.auth.user!.defaultWorkspaceId = null; }], ["oversized workspace", () => { controls.auth.user!.defaultWorkspaceId = 2147483648; }],
    ["missing role", () => { controls.auth.user!.role = " "; }], ["permissions loading", () => { controls.permissions.isLoading = true; }],
  ] as const)("does not mount new children or expose their links during %s", (_label, arrange) => {
    arrange(); render(<OperationsCenter initialPanel="profit" />); expect(controls.mounted).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link")).toHaveLength(1); expect(screen.getByRole("link", { name: "原运营中心" })).toBeInTheDocument();
    expect(screen.queryByText("SYNTHETIC_PRIVATE_ERROR")).not.toBeInTheDocument(); expect(controls.readFinancial).not.toHaveBeenCalled(); expect(controls.callModel).not.toHaveBeenCalled();
  });
  it.each(["tasks", "profit", "products"] as const)("requires dashboard permission as well as the %s directory and never falls back", async panel => {
    controls.permissions.canRead.mockImplementation((_module, directory) => directory !== "ops_dashboard");
    render(<OperationsCenter initialPanel={panel} />); expect(screen.getByRole("alert")).toHaveTextContent("没有所选运营页面"); expect(controls.mounted).not.toHaveBeenCalled(); expect(screen.getAllByRole("link")).toHaveLength(1);
  });
  it("hides denied task navigation without hiding allowed financial panes", async () => {
    controls.permissions.canRead.mockImplementation((_module, directory) => directory !== "ops_tasks"); render(<OperationsCenter initialPanel="profit" />); await page("profit");
    expect(screen.queryByRole("link", { name: "运营任务" })).not.toBeInTheDocument(); expect(screen.getByRole("link", { name: "产品看板" })).toBeInTheDocument();
  });
  it("task permission does not grant financial panels or finance links", async () => {
    controls.permissions.canRead.mockImplementation((_module, directory) => directory === "ops_dashboard" || directory === "ops_tasks");
    const ui = render(<OperationsCenter initialPanel="tasks" />); await page("tasks"); expect(screen.queryByRole("link", { name: "利润看板" })).not.toBeInTheDocument(); expect(screen.queryByRole("link", { name: "产品看板" })).not.toBeInTheDocument();
    ui.rerender(<OperationsCenter initialPanel="products" />); expect(screen.getByRole("alert")).toHaveTextContent("没有所选运营页面"); expect(screen.queryByRole("region", { name: "SYNTHETIC tasks" })).not.toBeInTheDocument(); expect(controls.mounted.mock.calls).toEqual([["tasks"]]);
  });
  it.each(["actor", "workspace", "role"] as const)("%s changes unmount the previous private pane and its local state", async kind => {
    const ui = render(<OperationsCenter initialPanel="profit" />); await page("profit"); fireEvent.change(screen.getByLabelText("profit draft"), { target: { value: "SYNTHETIC private draft" } });
    if (kind === "actor") controls.auth.user!.id = 8; if (kind === "workspace") controls.auth.user!.defaultWorkspaceId = 12; if (kind === "role") controls.auth.user!.role = "ops_manager";
    ui.rerender(<OperationsCenter initialPanel="profit" />); await page("profit"); expect(screen.getByLabelText("profit draft")).toHaveValue(""); expect(controls.unmounted).toHaveBeenCalledWith("profit"); expect(controls.mounted).toHaveBeenCalledTimes(2);
  });
  it.each(["auth loading", "auth error", "logout", "permission loading", "permission denied"] as const)("%s after a successful render immediately unmounts old private content", async kind => {
    const ui = render(<OperationsCenter initialPanel="products" />); await page("products");
    if (kind === "auth loading") controls.auth.loading = true; if (kind === "auth error") controls.auth.error = new Error("SYNTHETIC_PRIVATE_ERROR"); if (kind === "logout") controls.auth.user = null; if (kind === "permission loading") controls.permissions.isLoading = true; if (kind === "permission denied") controls.permissions.canRead.mockReturnValue(false);
    ui.rerender(<OperationsCenter initialPanel="products" />); expect(screen.queryByRole("region", { name: "SYNTHETIC products" })).not.toBeInTheDocument(); expect(controls.unmounted).toHaveBeenCalledWith("products"); expect(controls.mounted).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "SYNTHETIC legacy" })).not.toBeInTheDocument();
  });
  it("legacy selection keeps the old page behavior while new navigation remains denied", async () => {
    controls.auth.error = new Error("SYNTHETIC auth error"); controls.permissions.canRead.mockReturnValue(false);
    render(<OperationsCenter />); await page("legacy"); expect(controls.mounted.mock.calls).toEqual([["legacy"]]); expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
