// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { developmentMarketHash, type DevelopmentMarketOperation, type DevelopmentMarketApplyOperation, type DevelopmentMarketApply } from "@shared/developmentMarket";
import DevelopmentMarketWorkflow from "./DevelopmentMarketWorkflow";
import { MarketOverviewResult } from "./MarketOverviewResult";
import { developmentMarketPendingKey, readDevelopmentMarketPending } from "./developmentMarketPending";
const state = vi.hoisted(() => ({ preview: vi.fn(), start: vi.fn(), check: vi.fn(), cancel: vi.fn(), apply: vi.fn(), applyCheck: vi.fn(), applyCancel: vi.fn(), applied: vi.fn(),
  auth: { user: { id: 3, defaultWorkspaceId: 7, role: "admin" }, loading: false, error: null as Error | null }, read: true, edit: true, permissionLoading: false }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: state.permissionLoading, canRead: () => state.read, canEdit: () => state.edit }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { devAnalysis: { marketPreview: { query: state.preview }, marketStart: { mutate: state.start }, marketCheck: { query: state.check }, marketCancel: { mutate: state.cancel },
  marketApply: { mutate: state.apply }, marketApplyCheck: { query: state.applyCheck }, marketApplyCancel: { mutate: state.applyCancel } } } }) } }));
const identity = { userId: 3, workspaceId: 7 }, context = { ...identity, devProjectId: 5 }, sourceHash = "a".repeat(64), runtimeHash = "b".repeat(64), resultHash = "c".repeat(64),
  ai = { maturityLevel: null, maturityReason: "SYNTHETIC", growthTrend: null, growthRate: null, seasonality: { hasSeasonality: null, peakMonths: [], lowMonths: [], description: "UNKNOWN" }, marketCapacity: { level: null, monthlyRevenue: null, potential: "UNKNOWN" }, entryTiming: { recommendation: null, bestEntryTime: null, reason: "UNKNOWN" }, summary: "COMPLETE_SYNTHETIC_CANDIDATE", risks: [], opportunities: [] };
const preview = (scope: DevelopmentMarketOperation) => ({ identity, scope, sourceHash, title: "SYNTHETIC", productCount: 48, panoramaVersion: 2, asOf: "2026-10-18", stats: { activeAsinCount: 48 }, configuration: { revision: 2, hash: "d".repeat(64) }, runtimeHash, skillSlug: "dev.analysis.market_overview", modelSlug: "synthetic-text", maxCostCents: 100, available: true, reasonCode: null });
const view = (scope: DevelopmentMarketOperation, status = "queued", changed = false) => ({ identity, scope, runId: "synthetic-run", state: status, sourceHash, currentSourceHash: changed ? "f".repeat(64) : sourceHash, sourceChanged: changed,
  runtimeHash, configuration: { revision: 2, hash: "d".repeat(64) }, resultHash: status === "candidate" ? resultHash : null, result: status === "candidate" ? { stats: { activeAsinCount: 48 }, ai } : null, reasonCode: null, appliedOperationId: null });
const receipt = (scope: DevelopmentMarketApplyOperation, status: "committed" | "canceled" | "not_found", requestHash: string | null = null) => ({ identity, scope, status, requestHash, resultHash: status === "committed" ? resultHash : null, stageId: status === "committed" ? 6 : null, stageRevision: status === "committed" ? 3 : null, reasonCode: null });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state.auth = { user: { id: 3, defaultWorkspaceId: 7, role: "admin" }, loading: false, error: null }; state.read = state.edit = true; state.permissionLoading = false;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, body) => body({ name: "synthetic" })) } });
  state.preview.mockImplementation(async input => preview(input)); state.start.mockImplementation(async input => view({ expectedWorkspaceId: input.expectedWorkspaceId, devProjectId: input.devProjectId, operationId: input.operationId }));
  state.check.mockImplementation(async input => view(input)); state.cancel.mockImplementation(async input => view(input, "canceled"));
  state.apply.mockImplementation(async (input: DevelopmentMarketApply) => receipt({ expectedWorkspaceId: input.expectedWorkspaceId, devProjectId: input.devProjectId, operationId: input.operationId, runOperationId: input.runOperationId }, "committed", developmentMarketHash({ identity, request: input })));
  state.applyCheck.mockImplementation(async input => receipt(input, "not_found")); state.applyCancel.mockImplementation(async input => receipt(input, "canceled"));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mount = () => render(<DevelopmentMarketWorkflow projectId={5} onApplied={state.applied} />);
async function open() { fireEvent.click(screen.getByRole("button", { name: "预览受控执行与费用" })); await screen.findByText(/48 个产品/u); }
async function start() { await open(); fireEvent.click(screen.getByRole("checkbox", { name: /我确认此费用上限/u })); fireEvent.click(screen.getByRole("button", { name: "提交受控市场分析" })); await screen.findByText(/原请求：/u); }
describe("Original development market business UI", () => {
  it("original full result renderer does not relabel explicit unknown seasonality as false", () => { render(<MarketOverviewResult result={{ stats: {}, ai }} productCount={48} />); expect(screen.getByText("季节性证据不足，暂不判断")).toBeInTheDocument(); expect(screen.queryByText("无明显季节性")).not.toBeInTheDocument(); });
  it("does not run on mount/preview, requires explicit cost consent and same preview UUID", async () => {
    mount(); expect(state.preview).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled(); await open();
    expect(screen.getByRole("button", { name: "提交受控市场分析" })).toBeDisabled(); expect(state.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /我确认此费用上限/u })); fireEvent.click(screen.getByRole("button", { name: "提交受控市场分析" })); await waitFor(() => expect(state.start).toHaveBeenCalledTimes(1));
    expect(state.start.mock.calls[0][0].operationId).toBe(state.preview.mock.calls[0][0].operationId); expect(readDevelopmentMarketPending(context)?.requestHash).toHaveLength(64); expect(state.apply).not.toHaveBeenCalled();
  });
  it("lost start ACK retains original UUID, check not_found cannot blind restart, cancel fences it", async () => {
    state.start.mockRejectedValue(new Error("SYNTHETIC_ACK_LOST")); mount(); await start(); await screen.findByText(/请求未能确认/u);
    const original = readDevelopmentMarketPending(context)!; state.check.mockImplementation(async input => view(input, "not_found")); fireEvent.click(screen.getByRole("button", { name: "核对原请求与来源" }));
    await waitFor(() => expect(state.check).toHaveBeenCalledTimes(1)); expect(state.check.mock.calls[0][0].operationId).toBe(original.operationId); expect(screen.queryByRole("button", { name: "预览受控执行与费用" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消原请求（不重试）" })); await screen.findByRole("button", { name: "预览受控执行与费用" }); expect(state.start).toHaveBeenCalledTimes(1);
  });
  it("renders the full candidate and requires explicit human apply, leaving original confirmation separate", async () => {
    mount(); await start(); state.check.mockImplementation(async input => view(input, "candidate")); fireEvent.click(screen.getByRole("button", { name: "核对原请求与来源" }));
    await screen.findByText(/COMPLETE_SYNTHETIC_CANDIDATE/u); expect(screen.getByRole("button", { name: "人工应用此完整候选" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /我已核对完整候选/u })); fireEvent.click(screen.getByRole("button", { name: "人工应用此完整候选" }));
    await waitFor(() => expect(state.applied).toHaveBeenCalledTimes(1)); expect(state.apply.mock.calls[0][0]).toMatchObject({ expectedSourceHash: sourceHash, expectedResultHash: resultHash });
    expect(readDevelopmentMarketPending(context)).toBeNull(); expect(screen.getByRole("status")).toHaveTextContent("仍需原流程人工确认");
  });
  it("changed source disables apply without discarding the candidate", async () => {
    mount(); await start(); state.check.mockImplementation(async input => view(input, "candidate", true)); fireEvent.click(screen.getByRole("button", { name: "核对原请求与来源" }));
    await screen.findByText(/来源已变化/u); expect(screen.getByRole("button", { name: "人工应用此完整候选" })).toBeDisabled(); expect(state.apply).not.toHaveBeenCalled(); expect(screen.getByText(/COMPLETE_SYNTHETIC_CANDIDATE/u)).toBeInTheDocument();
  });
  it("apply ACK loss can only check/cancel its exact apply UUID, never auto-resubmits", async () => {
    state.apply.mockRejectedValue(new Error("SYNTHETIC_ACK_LOST")); mount(); await start(); state.check.mockImplementation(async input => view(input, "candidate")); fireEvent.click(screen.getByRole("button", { name: "核对原请求与来源" }));
    await screen.findByText(/COMPLETE_SYNTHETIC_CANDIDATE/u); fireEvent.click(screen.getByRole("checkbox", { name: /我已核对完整候选/u })); fireEvent.click(screen.getByRole("button", { name: "人工应用此完整候选" }));
    await screen.findByText(/请求未能确认/u); const original = readDevelopmentMarketPending(context)!; expect(original.action).toBe("apply");
    fireEvent.click(screen.getByRole("button", { name: "核对原请求与来源" })); await waitFor(() => expect(state.applyCheck).toHaveBeenCalledTimes(1)); expect(state.applyCheck.mock.calls[0][0].operationId).toBe(original.operationId); expect(state.apply).toHaveBeenCalledTimes(1);
  });
  it("read-only original check survives missing browser locks, new paid writes do not", async () => {
    mount(); await start(); Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    fireEvent.click(screen.getByRole("button", { name: "核对原请求与来源" })); await waitFor(() => expect(state.check).toHaveBeenCalledTimes(1)); expect(state.start).toHaveBeenCalledTimes(1);
  });
  it("missing approval is an unavailable explanation with no enabled paid action", async () => {
    state.preview.mockImplementation(async input => ({ ...preview(input), available: false, reasonCode: "SOURCE_UNAVAILABLE", runtimeHash: null, configuration: null, modelSlug: null, skillSlug: null, maxCostCents: null }));
    mount(); await open(); expect(screen.getByRole("button", { name: "提交受控市场分析" })).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("未调用模型");
  });
  it("identity change hides old pending/candidate and malformed local metadata stops new writes", async () => {
    const mounted = mount(); await start(); state.auth.user = { id: 99, defaultWorkspaceId: 7, role: "admin" }; mounted.rerender(<DevelopmentMarketWorkflow projectId={5} />);
    expect(screen.queryByText(/原请求：/u)).not.toBeInTheDocument(); expect(state.check).not.toHaveBeenCalled(); cleanup();
    localStorage.setItem(developmentMarketPendingKey({ userId: 99, workspaceId: 7, devProjectId: 5 }), "{broken"); render(<DevelopmentMarketWorkflow projectId={5} />);
    expect(screen.getByRole("alert")).toHaveTextContent("原请求记录不可核验"); expect(screen.getByRole("button", { name: "预览受控执行与费用" })).toBeDisabled();
  });
  it("current permission withdrawal removes private task data", async () => { const mounted = mount(); await start(); state.read = false; mounted.rerender(<DevelopmentMarketWorkflow projectId={5} />); expect(screen.queryByText(/原请求：/u)).not.toBeInTheDocument(); expect(screen.getByRole("alert")).toHaveTextContent("权限不可核验"); });
});
