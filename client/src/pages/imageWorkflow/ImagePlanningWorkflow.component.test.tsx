// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImagePlanningWorkflow from "./ImagePlanningWorkflow";
import { ImagePlanningPreviewSchema, ImagePlanningJobViewSchema, imagePlanningHash, type ImagePlanningOperationInput, type ImagePlanningApplyInput } from "@shared/imagePlanning";
import { readImagePlanningPending } from "./imagePlanningPending";
const state = vi.hoisted(() => ({ preview: vi.fn(), start: vi.fn(), check: vi.fn(), cancel: vi.fn(), history: vi.fn(), apply: vi.fn(), applyCheck: vi.fn(), applyCancel: vi.fn(), applied: vi.fn(),
  auth: { user: { id: 3, defaultWorkspaceId: 7, role: "admin" }, loading: false, error: null as Error | null }, read: true, edit: true, loading: false }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: state.loading, canRead: () => state.read, canEdit: () => state.edit }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { imageWorkflow: {
  planningPreview: { query: state.preview }, planningStart: { mutate: state.start }, planningCheck: { query: state.check }, planningCancel: { mutate: state.cancel },
  planningHistory: { query: state.history }, planningApply: { mutate: state.apply }, planningApplyCheck: { query: state.applyCheck }, planningApplyCancel: { mutate: state.applyCancel },
} } }) } }));
const identity = { userId: 3, workspaceId: 7 }, scope = { expectedWorkspaceId: 7, projectId: 8, sessionId: 9 }, context = { ...identity, projectId: 8, sessionId: 9 };
const h = "a".repeat(64), r = "b".repeat(64);
const candidate = { mainImage: { purpose: "SYNTHETIC main", contentBrief: "SYNTHETIC full main" }, secondaryImages: Array.from({ length: 6 }, (_, i) => ({ imageNumber: i + 2, purpose: "SYNTHETIC secondary", contentBrief: `Full secondary ${i}` })),
  aPlusModules: Array.from({ length: 7 }, (_, i) => ({ moduleNumber: i + 1, purpose: "SYNTHETIC A+", contentBrief: `Full module ${i}` })), brandStory: { theme: "SYNTHETIC story", contentBrief: "Full brand story" } };
function preview(input: ImagePlanningOperationInput, available = true) { return ImagePlanningPreviewSchema.parse({ identity, scope: input, sourceHash: h, sourceRevision: h, scopeRevision: 2,
  title: "SYNTHETIC PRIVATE PRODUCT", coverage: "complete_saved_project_inputs_not_exhaustive_market", counts: { confirmedSteps: 2, files: 2, competitors: 3, comparisons: 1, keywordAnalyses: 25 },
  configuration: { revision: 2, hash: h }, runtimeHash: r, skillSlug: "image.step2.outline", modelSlug: "synthetic-model", maxCostCents: 100, maxCalls: 1,
  capability: { available, reasonCode: available ? null : "EXECUTION_DISABLED" } }); }
function job(input: ImagePlanningOperationInput, status: "succeeded" | "queued" | "outcome_unknown" | "canceled" | "not_found" = "succeeded") { return ImagePlanningJobViewSchema.parse({ identity, scope: input,
  state: status, runId: status === "not_found" ? null : "synthetic-run", sourceHash: status === "not_found" ? null : h, currentSourceHash: h, sourceChanged: false,
  runtimeHash: status === "not_found" ? null : r, resultHash: status === "succeeded" ? imagePlanningHash(candidate) : null, candidate: status === "succeeded" ? candidate : null,
  configuration: { revision: 2, hash: h }, maxCostCents: 100, reasonCode: null }); }
const mount = () => render(<ImagePlanningWorkflow projectId={8} sessionId={9} onApplied={state.applied} />);
async function open() { fireEvent.click(screen.getByRole("button", { name: "读取完整来源与费用预览" })); await screen.findByText(/SYNTHETIC PRIVATE PRODUCT/); }
async function start() { await open(); fireEvent.click(screen.getByRole("checkbox", { name: /我确认本次完整来源/ })); fireEvent.click(screen.getByRole("button", { name: "明确开始一次大纲生成" })); await waitFor(() => expect(state.start).toHaveBeenCalledTimes(1)); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state.auth = { user: { id: 3, defaultWorkspaceId: 7, role: "admin" }, loading: false, error: null }; state.read = true; state.edit = true; state.loading = false;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, work) => work()) } });
  state.preview.mockImplementation(async input => preview(input)); state.start.mockImplementation(async input => job({ ...scope, operationId: input.operationId }));
  state.check.mockImplementation(async input => job(input)); state.cancel.mockImplementation(async input => job(input, "canceled"));
  state.apply.mockImplementation(async (input: ImagePlanningApplyInput) => ({ identity, scope: { ...scope, operationId: input.operationId, runOperationId: input.runOperationId }, status: "committed",
    requestHash: imagePlanningHash({ identity, request: input }), afterSourceHash: "c".repeat(64), resultHash: input.expectedResultHash, reasonCode: null }));
  state.history.mockResolvedValue({ identity, scope, complete: true, operations: [] });
});
afterEach(cleanup);
describe("original Step2 configured execution controller", () => {
  it("mount and explicit read never start a paid model or apply a result", async () => { mount(); expect(state.preview).not.toHaveBeenCalled(); await open(); expect(state.start).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled(); expect(screen.getByText(/费用授权上限 USD 1.00/)).toBeInTheDocument(); });
  it("shows default-off reason and cannot submit", async () => { state.preview.mockImplementation(async input => preview(input, false)); mount(); await open(); expect(screen.getByText("图片策划新执行或后台开关尚未启用")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "明确开始一次大纲生成" })).toBeDisabled(); });
  it("uses the preview UUID and displays all sections before a separate human apply", async () => {
    mount(); await start(); await screen.findByText("完整候选已保存，尚未应用或确认"); expect(state.start.mock.calls[0][0].operationId).toBe(state.preview.mock.calls[0][0].operationId);
    expect(screen.getByText(/Full module 6/)).toBeInTheDocument(); expect(screen.getByText(/Full brand story/)).toBeInTheDocument(); expect(state.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /已审阅完整候选/ })); fireEvent.click(screen.getByRole("button", { name: "人工应用到原大纲编辑器" }));
    await waitFor(() => expect(state.applied).toHaveBeenCalledWith(candidate)); expect(state.apply.mock.calls[0][0]).toMatchObject({ expectedSourceHash: h, expectedResultHash: imagePlanningHash(candidate), replaceDraftConfirmed: true });
    expect(state.apply.mock.calls[0][0].operationId).not.toBe(state.start.mock.calls[0][0].operationId);
  });
  it("lost start ACK preserves only metadata and explicit check never resubmits", async () => {
    state.start.mockRejectedValue(new Error("synthetic lost ACK")); mount(); await start(); await screen.findByText(/回执尚未核验/);
    const saved = readImagePlanningPending(context); expect(saved?.kind).toBe("start"); expect(JSON.stringify(saved)).not.toMatch(/SYNTHETIC PRIVATE|candidate|contentBrief/);
    state.check.mockImplementation(async input => job(input, "not_found")); fireEvent.click(screen.getByRole("button", { name: "核对原请求" }));
    await screen.findByText("暂未观察到原请求，不代表可重新提交"); expect(readImagePlanningPending(context)?.operationId).toBe(saved?.operationId); expect(state.start).toHaveBeenCalledTimes(1);
  });
  it("unknown result needs original UUID cancel even if new-write capability is off", async () => {
    state.start.mockImplementation(async input => job({ ...scope, operationId: input.operationId }, "outcome_unknown")); mount(); await start(); await screen.findByText("结果未知，只能核对或取消原请求");
    fireEvent.click(screen.getByRole("checkbox", { name: /确认永久取消此原编号/ })); fireEvent.click(screen.getByRole("button", { name: "取消原请求" }));
    await waitFor(() => expect(readImagePlanningPending(context)).toBeNull()); expect(state.cancel.mock.calls[0][0].operationId).toBe(state.start.mock.calls[0][0].operationId); expect(state.start).toHaveBeenCalledTimes(1);
  });
  it("lost apply ACK cannot write again and its original receipt must match the request hash", async () => {
    state.apply.mockRejectedValue(new Error("SYNTHETIC_LOST_ACK")); const screenRoot = mount(); await start(); await screen.findByText("完整候选已保存，尚未应用或确认");
    fireEvent.click(screen.getByRole("checkbox", { name: /已审阅完整候选/ })); fireEvent.click(screen.getByRole("button", { name: "人工应用到原大纲编辑器" })); await screen.findByText(/回执尚未核验/);
    const saved = readImagePlanningPending(context)!; expect(saved.kind).toBe("apply"); screenRoot.unmount(); mount();
    state.applyCheck.mockImplementation(async input => ({ identity, scope: input, status: "committed", requestHash: saved.requestHash, afterSourceHash: h, resultHash: saved.resultHash, reasonCode: null }));
    fireEvent.click(screen.getByRole("button", { name: "核对原请求" })); await waitFor(() => expect(state.applied).toHaveBeenCalled()); expect(state.apply).toHaveBeenCalledTimes(1);
  });
  it("keeps original-editor apply lock through a lost ACK and releases only after the original operation is terminal", async () => {
    const pending = vi.fn(); state.apply.mockRejectedValue(new Error("SYNTHETIC_LOST_ACK"));
    render(<ImagePlanningWorkflow projectId={8} sessionId={9} onApplyPendingChange={pending} />); await start(); await screen.findByText("完整候选已保存，尚未应用或确认");
    fireEvent.click(screen.getByRole("checkbox", { name: /已审阅完整候选/ })); fireEvent.click(screen.getByRole("button", { name: "人工应用到原大纲编辑器" })); await screen.findByText(/回执尚未核验/);
    expect(pending).toHaveBeenLastCalledWith(true);
    state.applyCancel.mockImplementation(async input => ({ identity, scope: input, status: "cancelled", requestHash: null, afterSourceHash: null, resultHash: null, reasonCode: "CANCELED" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /确认永久取消此原编号/ })); fireEvent.click(screen.getByRole("button", { name: "取消原请求" }));
    await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false)); expect(state.apply).toHaveBeenCalledTimes(1);
  });
  it("same-owner auth refresh hides but preserves pending operation and no extra query", async () => {
    state.start.mockRejectedValue(new Error("SYNTHETIC_LOST_ACK")); const view = mount(); await start(); await screen.findByText(/回执尚未核验/); const saved = readImagePlanningPending(context);
    state.auth.loading = true; view.rerender(<ImagePlanningWorkflow projectId={8} sessionId={9} />); expect(screen.queryByRole("button", { name: "核对原请求" })).not.toBeInTheDocument();
    state.auth.loading = false; view.rerender(<ImagePlanningWorkflow projectId={8} sessionId={9} />); expect(screen.getByRole("button", { name: "核对原请求" })).toBeInTheDocument(); expect(readImagePlanningPending(context)).toEqual(saved); expect(state.check).not.toHaveBeenCalled();
  });
  it("identity change clears old private view without deleting old owner's unresolved UUID", async () => {
    state.start.mockRejectedValue(new Error("SYNTHETIC_LOST_ACK")); const view = mount(); await start(); await screen.findByText(/回执尚未核验/); state.auth.user = { id: 4, defaultWorkspaceId: 7, role: "admin" };
    view.rerender(<ImagePlanningWorkflow projectId={8} sessionId={9} />); expect(screen.queryByText(/SYNTHETIC PRIVATE PRODUCT/)).not.toBeInTheDocument(); expect(readImagePlanningPending(context)).not.toBeNull();
  });
  it("mixed owner reply fails closed", async () => { state.preview.mockImplementation(async input => ({ ...preview(input), identity: { userId: 4, workspaceId: 7 } })); mount(); fireEvent.click(screen.getByRole("button", { name: "读取完整来源与费用预览" })); await screen.findByText(/范围或权限无法核验/); expect(screen.queryByText(/SYNTHETIC PRIVATE PRODUCT/)).not.toBeInTheDocument(); });
  it("missing Web Locks never falls back to an unsafe paid start", async () => { Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); mount(); await open(); fireEvent.click(screen.getByRole("checkbox", { name: /我确认本次完整来源/ })); fireEvent.click(screen.getByRole("button", { name: "明确开始一次大纲生成" })); await screen.findByText(/安全恢复存储或跨窗口锁不可用/); expect(state.start).not.toHaveBeenCalled(); });
  it("late private reply cannot populate a new project", async () => {
    let resolve!: (value: unknown) => void; state.preview.mockImplementation(() => new Promise(res => { resolve = res; })); const view = mount(); fireEvent.click(screen.getByRole("button", { name: "读取完整来源与费用预览" }));
    const input = state.preview.mock.calls[0][0]; view.rerender(<ImagePlanningWorkflow projectId={10} sessionId={11} />); await act(async () => resolve(preview(input)));
    expect(screen.queryByText(/SYNTHETIC PRIVATE PRODUCT/)).not.toBeInTheDocument(); expect(state.start).not.toHaveBeenCalled();
  });
});
