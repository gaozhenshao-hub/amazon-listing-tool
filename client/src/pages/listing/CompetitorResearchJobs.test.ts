// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorResearchJobView } from "@shared/competitorResearchJob";
import CompetitorResearchJobs, { eligibleResearchTargets } from "./CompetitorResearchJobs";

const mocks = vi.hoisted(() => {
  const list = vi.fn();
  return { list, start: vi.fn(), resume: vi.fn(), cancel: vi.fn(), completed: vi.fn(), options: [] as unknown[],
    utils: { client: { analysis: { listResearchJobs: { query: list } } } },
    auth: { user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null,
      loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => mocks.utils, analysis: {
  startResearchJob: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.start }; } },
  resumeResearchJob: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.resume }; } },
  cancelResearchJob: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.cancel }; } },
} } }));
const analysis = (id: number, patch = {}) => ({ id, asin: "B" + String(id).padStart(9, "0"), revision: String(id).repeat(64).slice(0, 64), summaryStatus: "draft", ...patch });
function job(patch: Partial<CompetitorResearchJobView> = {}): CompetitorResearchJobView {
  return { runId: "research-1", userId: 7, workspaceId: 11, projectId: 1, analysisId: 1, asin: analysis(1).asin,
    sourceHash: "a".repeat(64), status: "queued", stage: "reserved", progress: 0, canResume: false, canCancel: true,
    sourceChanged: false, message: "等待后台分析", createdAt: new Date("2026-10-16T00:00:00Z"), ...patch };
}
type Props = Parameters<typeof CompetitorResearchJobs>[0];
function view(patch: Partial<Props> = {}) {
  return createElement(CompetitorResearchJobs, { projectId: 1, workspaceId: 11, analyses: [analysis(1), analysis(2), analysis(3, { summaryStatus: "confirmed" })],
    selectedIds: [2], onCompleted: mocks.completed, ...patch });
}
const selected = () => screen.getByRole("button", { name: /分析选中竞品/ });
const all = () => screen.getByRole("button", { name: /分析全部可分析竞品/ });
const refresh = () => screen.getByRole("button", { name: "重新读取分析任务" });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.options.length = 0;
  mocks.auth = { user: { id: 7, defaultWorkspaceId: 11, role: "admin" }, loading: false, error: null };
  mocks.list.mockResolvedValue([]);
  mocks.start.mockImplementation(input => Promise.resolve(job({ runId: "research-" + input.analysisId, analysisId: input.analysisId,
    asin: analysis(input.analysisId).asin, workspaceId: input.expectedWorkspaceId })));
  mocks.resume.mockResolvedValue(job({ status: "running", stage: "analysis_ready", canResume: false }));
  mocks.cancel.mockResolvedValue(job({ status: "canceled", canCancel: false }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("explicit saved-competitor research submissions", () => {
  it("reads only owned durable tasks on mount, never starts paid work automatically", async () => {
    render(view()); await waitFor(() => expect(selected()).toBeEnabled());
    expect(mocks.list).toHaveBeenCalledWith({ projectId: 1, expectedWorkspaceId: 11 }, { signal: expect.any(AbortSignal) });
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
    expect(screen.getByText(/分析范围为已保存的文字资料和二级评论分析/)).toBeInTheDocument();
    expect(screen.getByText(/未读取的评论原文、图片内容不作为已验证证据/)).toBeInTheDocument();
    expect(screen.getByText(/最近100条任务，不代表完整历史/)).toBeInTheDocument();
  });
  it("submits only the selected valid unlocked record, explicitly scoped and revision-bound with retry false", async () => {
    render(view()); await waitFor(() => expect(selected()).toBeEnabled()); fireEvent.click(selected());
    await screen.findByRole("article"); expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith({ projectId: 1, expectedWorkspaceId: 11, analysisId: 2, expectedRevision: analysis(2).revision });
    expect(mocks.options.every(option => (option as { retry?: boolean }).retry === false)).toBe(true); expect(mocks.completed).not.toHaveBeenCalled();
  });
  it("all means every eligible project record, not the checked subset; confirmed records are never auto-unlocked", async () => {
    render(view()); await waitFor(() => expect(all()).toBeEnabled()); fireEvent.click(all());
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    expect(mocks.start.mock.calls.map(([input]) => input.analysisId)).toEqual([1, 2]); expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("freezes all explicit revisions before the first request even if selection/props refetch changes during submission", async () => {
    const first = deferred<CompetitorResearchJobView>(); mocks.start.mockReturnValueOnce(first.promise);
    const mounted = render(view()); await waitFor(() => expect(all()).toBeEnabled()); fireEvent.click(all()); fireEvent.click(all());
    expect(mocks.start).toHaveBeenCalledOnce();
    mounted.rerender(view({ selectedIds: [1], analyses: [analysis(1, { revision: "c".repeat(64) }), analysis(2, { revision: "d".repeat(64) })] }));
    await act(async () => first.resolve(job())); await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    expect(mocks.start.mock.calls[1][0]).toEqual({ projectId: 1, expectedWorkspaceId: 11, analysisId: 2, expectedRevision: analysis(2).revision });
  });
  it("keeps per-item refusal and success independent, without automatic failed-item retry", async () => {
    mocks.start.mockRejectedValueOnce({ data: { code: "CONFLICT" }, message: "PRIVATE_SOURCE_DIAGNOSTIC" });
    render(view()); await waitFor(() => expect(all()).toBeEnabled()); fireEvent.click(all());
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2)); await screen.findByText(/此次提交未完成/);
    expect(screen.getByText(/任务已记录，以下方任务状态/)).toBeInTheDocument(); expect(screen.queryByText(/PRIVATE_SOURCE/)).not.toBeInTheDocument();
  });
  it("lost ACK reads the list but never guesses that a same-id older source was this request or auto resends", async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValue([job({ analysisId: 2, asin: analysis(2).asin, sourceHash: "b".repeat(64), sourceChanged: true })]);
    mocks.start.mockRejectedValue(new Error("PRIVATE_TRANSPORT_DIAGNOSTIC"));
    render(view()); await waitFor(() => expect(selected()).toBeEnabled()); fireEvent.click(selected());
    await screen.findByText(/提交回执未确认/); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.start).toHaveBeenCalledOnce(); expect(screen.queryByText(/任务已记录，以下方任务状态/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_TRANSPORT/)).not.toBeInTheDocument();
  });
  it("queued receipt releases the chooser immediately and does not claim analysis has finished", async () => {
    render(view()); await waitFor(() => expect(selected()).toBeEnabled()); fireEvent.click(selected());
    await screen.findByText(/排队中 · 0%/); expect(screen.queryByText(/已保存资料分析结果，仍须/)).not.toBeInTheDocument();
    expect(mocks.completed).not.toHaveBeenCalled();
  });
  it("explicit legacy null workspace is valid while undefined/foreign scopes never fall back", async () => {
    mocks.auth.user!.defaultWorkspaceId = null; render(view({ workspaceId: null })); await waitFor(() => expect(selected()).toBeEnabled());
    fireEvent.click(selected()); await screen.findByRole("article"); expect(mocks.start.mock.calls[0][0].expectedWorkspaceId).toBeNull();
    expect(mocks.list.mock.calls[0][0].expectedWorkspaceId).toBeNull();
  });
  it.each(["loading", "error", "anonymous", "undefined", "foreign", "invalid"])("%s admission has zero private reads or writes", mode => {
    if (mode === "loading") mocks.auth.loading = true;
    if (mode === "error") mocks.auth.error = new Error("auth unavailable");
    if (mode === "anonymous") mocks.auth.user = null;
    if (mode === "undefined") mocks.auth.user!.defaultWorkspaceId = undefined;
    if (mode === "foreign") mocks.auth.user!.defaultWorkspaceId = 12;
    if (mode === "invalid") mocks.auth.user!.defaultWorkspaceId = 0;
    render(view()); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("eligibility refuses malformed identities, revisions and duplicate ids without inventing source data", () => {
    expect(eligibleResearchTargets([analysis(1), analysis(2, { summaryStatus: "confirmed" }), analysis(3, { revision: "bad" }),
      analysis(4, { asin: "bad" }), analysis(5), analysis(5)])).toEqual([analysis(1)]);
  });
});

describe("durable task status and explicit controls", () => {
  it("mount recovery and read-only polling publish committed success once, independent of callback identity", async () => {
    vi.useFakeTimers(); mocks.list.mockResolvedValueOnce([job()]).mockResolvedValue([job({ status: "succeeded", stage: "analysis_committed", progress: 100, canCancel: false })]);
    const mounted = render(view()); await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.completed).toHaveBeenCalledOnce(); expect(mocks.start).not.toHaveBeenCalled();
    mounted.rerender(view({ onCompleted: () => mocks.completed() })); fireEvent.click(refresh()); await act(async () => {});
    expect(mocks.completed).toHaveBeenCalledOnce(); expect(screen.getByText(/仍须人工审核摘要/)).toBeInTheDocument();
  });
  it.each(["reserved", "analysis_ready"] as const)("explicit %s recovery uses the original run and exact authenticated scope", async stage => {
    mocks.list.mockResolvedValue([job({ status: "failed", stage, canResume: true, canCancel: false })]);
    render(view()); const button = await screen.findByRole("button", { name: "恢复原分析任务" }); fireEvent.click(button); fireEvent.click(button);
    await screen.findByText(/原任务恢复请求已记录/); expect(mocks.resume).toHaveBeenCalledOnce();
    expect(mocks.resume).toHaveBeenCalledWith({ projectId: 1, expectedWorkspaceId: 11, runId: "research-1" }); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("cancel is explicit and states the model billing limitation instead of promising provider cancellation", async () => {
    mocks.list.mockResolvedValue([job({ status: "running", stage: "model_dispatched" })]); render(view());
    expect(await screen.findByText(/不能保证停止服务商计费/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "取消此分析任务" }); fireEvent.click(button); fireEvent.click(button);
    await screen.findByText(/已读取取消处理结果/); expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledWith({ projectId: 1, expectedWorkspaceId: 11, runId: "research-1" }); expect(mocks.completed).not.toHaveBeenCalled();
  });
  it("unknown model outcome is not resumable or automatically restarted; old result remains a parent-owned card", async () => {
    mocks.list.mockResolvedValue([job({ status: "failed", stage: "model_result_unknown", canResume: true, canCancel: false })]);
    render(view({ selectedIds: [1] })); await screen.findByText(/模型结果未可靠保存/);
    expect(selected()).toBeDisabled(); expect(screen.queryByRole("button", { name: "恢复原分析任务" })).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("source change is explicit and allows a newly revised source while never resuming the old binding", async () => {
    mocks.list.mockResolvedValue([job({ status: "failed", stage: "analysis_ready", sourceChanged: true, canResume: true, canCancel: false })]);
    render(view({ selectedIds: [1] })); await waitFor(() => expect(selected()).toBeEnabled());
    expect(screen.getByText(/此任务绑定旧来源/)).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "恢复原分析任务" })).not.toBeInTheDocument();
  });
  it("succeeded without analysis_committed proof never invokes completed refresh", async () => {
    mocks.list.mockResolvedValue([job({ status: "succeeded", stage: "analysis_ready", canCancel: false })]); render(view());
    await screen.findByText(/尚无完整的分析保存凭据/); expect(mocks.completed).not.toHaveBeenCalled();
  });
  it("permission loss clears old rows and forbids controls instead of preserving a private stale task list", async () => {
    mocks.list.mockResolvedValueOnce([job()]).mockRejectedValue({ data: { code: "FORBIDDEN" } });
    render(view()); await screen.findByRole("article"); fireEvent.click(refresh()); await screen.findByText(/旧任务已隐藏/);
    expect(screen.queryByRole("article")).not.toBeInTheDocument(); expect(selected()).toBeDisabled(); expect(all()).toBeDisabled();
  });
  it("transient read failure is not a false empty state or permission to create another task", async () => {
    mocks.list.mockResolvedValueOnce([job()]).mockRejectedValue(new Error("offline")); render(view()); await screen.findByRole("article");
    fireEvent.click(refresh()); await screen.findByText(/任务读取失败/); expect(screen.getByRole("article")).toBeInTheDocument(); expect(all()).toBeDisabled();
    expect(screen.queryByText(/当前范围尚无/)).not.toBeInTheDocument();
  });
  it.each(["user", "workspace", "project", "duplicate"])("invalid %s list reply is quarantined", async field => {
    const row = job(field === "user" ? { userId: 8 } : field === "workspace" ? { workspaceId: 12 } : field === "project" ? { projectId: 2 } : {});
    mocks.list.mockResolvedValue(field === "duplicate" ? [row, row] : [row]); render(view()); await screen.findByText(/旧任务已隐藏/);
    expect(screen.queryByRole("article")).not.toBeInTheDocument(); expect(mocks.completed).not.toHaveBeenCalled();
  });
  it.each(["user", "workspace", "role", "project"])("%s switch drops late start response and stops the undispatched batch remainder", async field => {
    const first = deferred<CompetitorResearchJobView>(); mocks.start.mockReturnValue(first.promise);
    const mounted = render(view()); await waitFor(() => expect(all()).toBeEnabled()); fireEvent.click(all());
    if (field === "user") mocks.auth.user!.id = 8;
    if (field === "workspace") mocks.auth.user!.defaultWorkspaceId = 12;
    if (field === "role") mocks.auth.user!.role = "ops_specialist";
    const next = field === "project" ? { projectId: 2 } : field === "workspace" ? { workspaceId: 12 } : {};
    mounted.rerender(view(next)); await act(async () => first.resolve(job({ status: "succeeded", stage: "analysis_committed", message: "old private result" })));
    expect(mocks.start).toHaveBeenCalledOnce(); expect(mocks.completed).not.toHaveBeenCalled(); expect(screen.queryByText(/old private result/)).not.toBeInTheDocument();
  });
  it("late old-scope list cannot repopulate after A to B to A", async () => {
    const old = deferred<CompetitorResearchJobView[]>(); mocks.list.mockReturnValueOnce(old.promise).mockResolvedValue([]);
    const mounted = render(view()); mocks.auth.user!.defaultWorkspaceId = 12; mounted.rerender(view({ workspaceId: 12 }));
    mocks.auth.user!.defaultWorkspaceId = 11; mounted.rerender(view());
    await act(async () => old.resolve([job({ status: "succeeded", stage: "analysis_committed" })]));
    expect(screen.queryByRole("article")).not.toBeInTheDocument(); expect(mocks.completed).not.toHaveBeenCalled();
  });
});
