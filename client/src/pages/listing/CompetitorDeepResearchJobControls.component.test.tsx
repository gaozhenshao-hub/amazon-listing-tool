// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompetitorDeepResearchJobControls from "./CompetitorDeepResearchJobControls";
import { competitorDeepPendingKey, readCompetitorDeepPending, reserveCompetitorDeepPending, type CompetitorDeepPending } from "./competitorDeepPending";
import { canonicalCompetitorResearchEvidence as canonical } from "@shared/competitorResearchEvidence";
import type { CompetitorDeepJobView, CompetitorDeepOptionsResult } from "@shared/competitorDeepExecutionJob";

const state = vi.hoisted(() => ({
  options: vi.fn(), start: vi.fn(), check: vi.fn(), cancel: vi.fn(),
  auth: { user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null; role: string } | null, loading: false, error: null as Error | null },
  permitted: true, permissionsLoading: false,
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: state.permissionsLoading, canRead: () => state.permitted }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { analysis: {
  competitorDeepOptions: { query: state.options }, startCompetitorDeepResearch: { mutate: state.start },
  checkCompetitorDeepResearch: { query: state.check }, cancelCompetitorDeepResearch: { mutate: state.cancel },
} } }) } }));
const props = { projectId: 3, analysisId: 8, asin: "B000000008", revision: "a".repeat(64) };
const context = { userId: 7, workspaceId: 11, projectId: 3, analysisId: 8, asin: props.asin };
const operationId = "11111111-1111-4111-8111-111111111111", secondId = "22222222-2222-4222-8222-222222222222";
const original: CompetitorDeepPending = { version: 1, context, operationId, expectedRevision: props.revision, expectedEvidenceHash: "b".repeat(64) };
function options(patch: Partial<CompetitorDeepOptionsResult> = {}): CompetitorDeepOptionsResult {
  return { identity: { userId: 7, workspaceId: 11 }, projectId: 3, analysisId: 8, revision: props.revision, evidenceHash: original.expectedEvidenceHash,
    capability: { available: true, reasonCode: null }, workerEnabled: true, reviewRequired: true, ...patch };
}
function job(patch: Partial<CompetitorDeepJobView> = {}): CompetitorDeepJobView {
  return { identity: { userId: 7, workspaceId: 11 }, projectId: 3, analysisId: 8, operationId, runId: "deep_" + "c".repeat(64),
    status: "queued", stage: "title", progress: 0, sourceRevision: props.revision, evidenceHash: original.expectedEvidenceHash,
    sourceChanged: false, canCancel: true, reviewRequired: true, deepResearchComplete: false, committedRevision: null, reasonCode: null, ...patch };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
async function prepare() { click("核对四栏研究条件"); await screen.findByText("当前资料和后台条件允许提交研究"); }
async function submit() { await prepare(); fireEvent.click(screen.getByRole("checkbox", { name: /我确认分析此版本/ })); click("提交四栏后台研究"); }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key: string, _options: unknown, work: () => Promise<unknown>) => work()) } });
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
  state.auth = { user: { id: 7, defaultWorkspaceId: 11, role: "admin" }, loading: false, error: null };
  state.permitted = true; state.permissionsLoading = false;
  state.options.mockReset().mockResolvedValue(options()); state.start.mockReset().mockResolvedValue(job());
  state.check.mockReset().mockResolvedValue(job({ status: "unknown", progress: null })); state.cancel.mockReset().mockResolvedValue(job({ status: "canceled", progress: null, canCancel: false }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("explicit four-column generation and original UUID recovery", () => {
  it("does not read or charge on mount and does not imply full review/image/Q&A coverage", () => {
    render(<StrictMode><CompetitorDeepResearchJobControls {...props} /></StrictMode>);
    expect(state.options).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled(); expect(state.check).not.toHaveBeenCalled();
    expect(screen.getByText(/图片 \/ OCR、问答暂未纳入/)).toBeInTheDocument(); expect(document.querySelector('input[type="file"]')).toBeNull();
  });
  it("shows default-off conditions without offering an enabled generation action", async () => {
    state.options.mockResolvedValue(options({ capability: { available: false, reasonCode: "DEEP_WRITES_DISABLED" }, workerEnabled: false }));
    render(<CompetitorDeepResearchJobControls {...props} />); click("核对四栏研究条件");
    await screen.findByText("四栏研究写入开关尚未启用"); expect(screen.getByRole("button", { name: "提交四栏后台研究" })).toBeDisabled(); expect(state.start).not.toHaveBeenCalled();
  });
  it("explains the production service reason codes in Chinese instead of presenting an English unavailable code", async () => {
    const cases = [
      ["WRITES_DISABLED", "四栏研究写入开关尚未启用"], ["WORKER_DISABLED", "四栏后台执行器尚未启用"],
      ["WORKSPACE_REQUIRED", "请先选择明确的工作区"], ["RECORD_CONFIRMED", "此竞品摘要已经确认"],
      ["RUN_NOT_AUTHORIZED", "当前身份没有此研究任务的访问权限"], ["SOURCE_CHANGED", "竞品原资料已变化"],
      ["EVIDENCE_CHANGED", "本次研究依据已变化"],
    ];
    for (const [reasonCode, text] of cases) {
      state.options.mockResolvedValue(options({ capability: { available: false, reasonCode }, workerEnabled: false }));
      const view = render(<CompetitorDeepResearchJobControls {...props} />); click("核对四栏研究条件");
      await screen.findByText(new RegExp(text)); expect(document.body.textContent).not.toContain(reasonCode);
      expect(screen.getByRole("button", { name: "提交四栏后台研究" })).toBeDisabled(); view.unmount();
    }
    expect(state.start).not.toHaveBeenCalled();
  });
  it("requires explicit consent, freezes exact evidence and starts once", async () => {
    render(<CompetitorDeepResearchJobControls {...props} />); await prepare();
    expect(screen.getByRole("button", { name: "提交四栏后台研究" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /我确认分析此版本/ })); click("提交四栏后台研究");
    await screen.findByText("后台排队中"); expect(state.start).toHaveBeenCalledOnce();
    expect(state.start.mock.calls[0][0]).toEqual({ projectId: 3, analysisId: 8, expectedWorkspaceId: 11, expectedRevision: props.revision, expectedEvidenceHash: original.expectedEvidenceHash, operationId });
    expect(readCompetitorDeepPending(context)).toEqual(original); expect(screen.queryByRole("button", { name: "提交四栏后台研究" })).toBeNull();
  });
  it("polls only original check and publishes the new committed revision for manual review", async () => {
    const completed = vi.fn(); render(<CompetitorDeepResearchJobControls {...props} onCompleted={completed} />); await submit(); await screen.findByText("后台排队中");
    vi.useFakeTimers();
    // Re-read replaces the timer with one controlled by the synthetic clock.
    state.check.mockResolvedValueOnce(job({ status: "running", progress: 25 })); click("核对原四栏请求"); await act(async () => {});
    state.check.mockResolvedValueOnce(job({ status: "succeeded", progress: 100, canCancel: false, committedRevision: "d".repeat(64) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(state.start).toHaveBeenCalledOnce(); expect(state.check).toHaveBeenCalledTimes(2); expect(state.check.mock.calls[1][0]).toEqual({ projectId: 3, analysisId: 8, expectedWorkspaceId: 11, operationId });
    expect(completed).toHaveBeenCalledOnce(); expect(completed).toHaveBeenCalledWith("d".repeat(64)); expect(readCompetitorDeepPending(context)).toBeNull();
    expect(screen.getByText(/请查看完整结果并人工确认摘要/)).toBeInTheDocument();
  });
  it("retains lost submit ACK and not_found instead of automatically issuing another start", async () => {
    state.start.mockRejectedValue(new Error("PRIVATE timeout")); state.check.mockResolvedValue(job({ status: "not_found", runId: null, progress: null, sourceRevision: null, evidenceHash: null }));
    render(<CompetitorDeepResearchJobControls {...props} />); await submit(); await screen.findByText(/未取得可核验结果/);
    expect(readCompetitorDeepPending(context)).toEqual(original); click("核对原四栏请求"); await screen.findByText("尚未查到原请求，不能视为提交失败");
    expect(readCompetitorDeepPending(context)).toEqual(original); expect(state.start).toHaveBeenCalledOnce(); expect(document.body.textContent).not.toContain("PRIVATE");
  });
  it("restores pending under a newer source version and cancels exact original UUID without options or feature enablement", async () => {
    reserveCompetitorDeepPending(context, original);
    render(<CompetitorDeepResearchJobControls {...props} revision={"d".repeat(64)} />);
    expect(screen.getByText(/当前资料版本已变化/)).toBeInTheDocument(); expect(state.check).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "取消原四栏请求" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "确认永久取消此原请求" })); click("取消原四栏请求");
    await screen.findByText("原请求已取消"); expect(state.options).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled();
    expect(state.cancel.mock.calls[0][0]).toEqual({ projectId: 3, analysisId: 8, expectedWorkspaceId: 11, operationId }); expect(readCompetitorDeepPending(context)).toBeNull();
  });
  it.each(["operation", "source", "evidence", "user", "workspace", "project", "analysis", "extra"])("does not release a pending request after mismatched %s receipt", async kind => {
    reserveCompetitorDeepPending(context, original);
    const response = job({ status: "succeeded", progress: 100, canCancel: false, committedRevision: "d".repeat(64) });
    if (kind === "operation") response.operationId = secondId;
    if (kind === "source") response.sourceRevision = "e".repeat(64);
    if (kind === "evidence") response.evidenceHash = "e".repeat(64);
    if (kind === "user") response.identity.userId = 8;
    if (kind === "workspace") response.identity.workspaceId = 12;
    if (kind === "project") response.projectId = 4;
    if (kind === "analysis") response.analysisId = 9;
    if (kind === "extra") Object.assign(response, { prompt: "PRIVATE" });
    state.check.mockResolvedValue(response); const completed = vi.fn(); render(<CompetitorDeepResearchJobControls {...props} onCompleted={completed} />);
    click("核对原四栏请求"); await screen.findByText(/未取得可核验结果/); expect(readCompetitorDeepPending(context)).toEqual(original); expect(completed).not.toHaveBeenCalled();
  });
  it("refuses unavailable Web Locks without starting or silently downgrading persistence", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    render(<CompetitorDeepResearchJobControls {...props} />); await submit(); await screen.findByText(/未取得可核验结果/);
    expect(state.start).not.toHaveBeenCalled(); expect(readCompetitorDeepPending(context)).toBeNull();
  });
  it("does not use confirmation for UUID A to cancel UUID B before a storage event arrives", async () => {
    reserveCompetitorDeepPending(context, original); render(<CompetitorDeepResearchJobControls {...props} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "确认永久取消此原请求" }));
    localStorage.setItem(competitorDeepPendingKey(context), canonical({ ...original, operationId: secondId })); click("取消原四栏请求");
    await waitFor(() => expect(screen.getByText(new RegExp(secondId))).toBeInTheDocument());
    expect(state.cancel).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "取消原四栏请求" })).toBeDisabled();
  });
  it("clears old private progress and cancellation consent on cross-tab UUID changes", async () => {
    reserveCompetitorDeepPending(context, original); render(<CompetitorDeepResearchJobControls {...props} />);
    click("核对原四栏请求"); await screen.findByText("执行结果尚未确认"); fireEvent.click(screen.getByRole("checkbox", { name: "确认永久取消此原请求" }));
    act(() => { localStorage.setItem(competitorDeepPendingKey(context), canonical({ ...original, operationId: secondId })); window.dispatchEvent(new StorageEvent("storage", { key: competitorDeepPendingKey(context) })); });
    expect(screen.queryByText("执行结果尚未确认")).toBeNull(); expect(screen.getByRole("button", { name: "取消原四栏请求" })).toBeDisabled(); expect(state.start).not.toHaveBeenCalled();
  });
});

describe("fresh identity and scope boundaries", () => {
  it.each(["user", "workspace", "role", "project", "revision", "permission", "loading"])("aborts %s late responses without publishing old candidates", async kind => {
    reserveCompetitorDeepPending(context, original); const deferredResponse = deferred<CompetitorDeepJobView>(); state.check.mockReturnValue(deferredResponse.promise);
    const completed = vi.fn(), view = render(<CompetitorDeepResearchJobControls {...props} onCompleted={completed} />); click("核对原四栏请求");
    await waitFor(() => expect(state.check).toHaveBeenCalledOnce()); const signal = state.check.mock.calls[0][1].signal as AbortSignal;
    const changed = { ...props };
    if (kind === "user") state.auth.user!.id = 8;
    if (kind === "workspace") state.auth.user!.defaultWorkspaceId = 12;
    if (kind === "role") state.auth.user!.role = "ops_specialist";
    if (kind === "project") changed.projectId = 4;
    if (kind === "revision") changed.revision = "e".repeat(64);
    if (kind === "permission") state.permitted = false;
    if (kind === "loading") state.permissionsLoading = true;
    view.rerender(<CompetitorDeepResearchJobControls {...changed} onCompleted={completed} />);
    await act(async () => deferredResponse.resolve(job({ status: "succeeded", progress: 100, canCancel: false, committedRevision: "d".repeat(64) })));
    expect(signal.aborted).toBe(true); expect(completed).not.toHaveBeenCalled(); expect(readCompetitorDeepPending(context)).toEqual(original);
  });
  it.each(["auth", "permission", "noUser", "loading"])("does not mount request controls while %s is unavailable", kind => {
    if (kind === "auth") state.auth.error = new Error("PRIVATE");
    if (kind === "permission") state.permitted = false;
    if (kind === "noUser") state.auth.user = null;
    if (kind === "loading") state.permissionsLoading = true;
    render(<CompetitorDeepResearchJobControls {...props} />); expect(screen.queryByRole("button")).toBeNull(); expect(state.options).not.toHaveBeenCalled();
  });
});
