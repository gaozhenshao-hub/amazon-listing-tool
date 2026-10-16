// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitorAnalysisSummaryEditor } from "./CompetitorAnalysisSummaryEditor";

const mocks = vi.hoisted(() => {
  const invalidate = vi.fn();
  return { save: vi.fn(), confirm: vi.fn(), unlock: vi.fn(), invalidate, utils: { analysis: { listByProject: { invalidate } } }, options: [] as unknown[],
    auth: { user: { id: 1, defaultWorkspaceId: 9, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null,
      loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => mocks.utils, analysis: {
  updateSummary: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.save }; } },
  confirmSummary: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.confirm }; } },
  unlockSummary: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.unlock }; } },
} } }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div>{children}</div> }));

const revision = "a".repeat(64), newerRevision = "b".repeat(64);
const row = { id: 3, projectId: 7, asin: "B000000003", revision, rawData: "{}", summary: "真实已保存摘要", aiSummary: "真实 AI 候选",
  summaryStatus: "draft" as "draft" | "confirmed", summaryVersion: 1, summaryConfirmedAt: null };
const editor = (analysis = row, projectId = 7) => <CompetitorAnalysisSummaryEditor projectId={projectId} analysis={analysis} />;
const draft = () => screen.getByRole("textbox", { name: "竞品摘要草稿" });
function begin(text = "本地人工编辑稿") { fireEvent.click(screen.getByRole("button", { name: "编辑" })); fireEvent.change(draft(), { target: { value: text } }); }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.options.length = 0;
  mocks.auth = { user: { id: 1, defaultWorkspaceId: 9, role: "admin" }, loading: false, error: null };
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.save.mockImplementation(input => Promise.resolve({ ...row, revision: newerRevision, summary: input.summary.trim(), summaryVersion: 2 }));
  mocks.confirm.mockImplementation(input => Promise.resolve({ ...row, revision: newerRevision, summary: input.summary.trim(), summaryStatus: "confirmed", summaryVersion: 2 }));
  mocks.unlock.mockResolvedValue({ ...row, revision: newerRevision });
});
afterEach(cleanup);

describe("competitor summary revision-bound editor", () => {
  it("saves actual draft with explicit workspace/revision and never automatically retries", async () => {
    render(editor()); begin(); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("竞品分析总结已保存");
    expect(mocks.save).toHaveBeenCalledWith({ projectId: 7, analysisId: 3, summary: "本地人工编辑稿", expectedWorkspaceId: 9, expectedRevision: revision });
    expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.options.every(value => (value as { retry?: boolean }).retry === false)).toBe(true);
    expect(mocks.invalidate).toHaveBeenCalledWith({ projectId: 7 }); expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("confirmation binds saved source revision and explicitly locks only after its owned persisted row", async () => {
    render(editor()); fireEvent.click(screen.getByRole("button", { name: "确认结果" })); await screen.findByText("竞品分析已确认并锁定");
    expect(mocks.confirm).toHaveBeenCalledWith({ projectId: 7, analysisId: 3, expectedWorkspaceId: 9, expectedRevision: revision, summary: row.summary });
    expect(screen.getByRole("button", { name: "解锁编辑" })).toBeEnabled();
  });

  it("confirmed historical record can unlock with the same scope/CAS even while confirmation is prohibited", async () => {
    const historical = { ...row, summaryStatus: "confirmed" as const, rawData: '{"analysisStale":true}' };
    mocks.unlock.mockResolvedValue({ ...historical, summaryStatus: "draft", revision: newerRevision });
    render(editor(historical)); fireEvent.click(screen.getByRole("button", { name: "解锁编辑" })); await screen.findByRole("textbox");
    expect(mocks.unlock).toHaveBeenCalledWith({ projectId: 7, analysisId: 3, expectedWorkspaceId: 9, expectedRevision: revision });
    expect(screen.getByRole("button", { name: "确认并锁定" })).toBeDisabled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("legacy NULL workspace is explicit, not an omitted or guessed scope", async () => {
    mocks.auth.user!.defaultWorkspaceId = null; render(editor()); begin(); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("竞品分析总结已保存"); expect(mocks.save.mock.calls[0][0].expectedWorkspaceId).toBeNull();
  });

  it.each(["loading", "auth-error", "anonymous", "missing-workspace", "invalid-workspace", "wrong-project"])("%s identity never enables writes", mode => {
    if (mode === "loading") mocks.auth.loading = true;
    if (mode === "auth-error") mocks.auth.error = new Error("auth unavailable");
    if (mode === "anonymous") mocks.auth.user = null;
    if (mode === "missing-workspace") mocks.auth.user!.defaultWorkspaceId = undefined;
    if (mode === "invalid-workspace") mocks.auth.user!.defaultWorkspaceId = 0;
    render(editor(row, mode === "wrong-project" ? 8 : 7)); expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.unlock).not.toHaveBeenCalled();
  });

  it.each(["", "A".repeat(64), "not-a-revision"])("invalid revision %s permits local editing but no mutation", value => {
    render(editor({ ...row, revision: value })); begin(); expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(['{"analysisStale":true}', '{"captureOnly":true}', "invalid JSON", '{"analysisStale":"true"}'])("%s cannot confirm but can preserve an explicit manual draft", async rawData => {
    mocks.save.mockImplementation(input => Promise.resolve({ ...row, rawData, summary: input.summary, revision: newerRevision }));
    render(editor({ ...row, rawData })); expect(screen.getByRole("button", { name: "确认结果" })).toBeDisabled(); begin();
    expect(screen.getByRole("button", { name: "确认并锁定" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "确认并锁定" }));
    expect(mocks.confirm).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); await screen.findByText("竞品分析总结已保存");
    expect(mocks.save.mock.calls[0][0].summary).toBe("本地人工编辑稿");
  });

  it("dirty background revision changes do not overwrite or silently rebase the draft, and conflict preserves it", async () => {
    mocks.save.mockRejectedValue({ data: { code: "CONFLICT" }, message: "private diagnostic" });
    const view = render(editor()); begin("只属于旧版本的私有编辑");
    view.rerender(editor({ ...row, revision: newerRevision, summary: "另一人保存的新摘要" }));
    expect(draft()).toHaveValue("只属于旧版本的私有编辑"); expect(screen.getByText(/起始版本已保留/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); await screen.findByText(/摘要或来源版本冲突/);
    expect(mocks.save.mock.calls[0][0].expectedRevision).toBe(revision); expect(draft()).toHaveValue("只属于旧版本的私有编辑");
    expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument(); expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("only explicit cancellation adopts a newly read row and its new revision", async () => {
    const view = render(editor()); begin(); view.rerender(editor({ ...row, revision: newerRevision, summary: "新版本真实摘要" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(screen.getByText("新版本真实摘要")).toBeInTheDocument();
    begin("新版本人工草稿"); fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); await screen.findByText("竞品分析总结已保存");
    expect(mocks.save.mock.calls[0][0].expectedRevision).toBe(newerRevision);
  });

  it("no dirty draft means a new revision may refresh the displayed source normally", async () => {
    const view = render(editor()); view.rerender(editor({ ...row, revision: newerRevision, summary: "新鲜保存摘要" }));
    expect(screen.getByText("新鲜保存摘要")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "确认结果" }));
    await screen.findByText("竞品分析已确认并锁定"); expect(mocks.confirm.mock.calls[0][0].expectedRevision).toBe(newerRevision);
  });

  it("pending dispatch is single-flight and a row change during the request cannot replace the preserved draft", async () => {
    const pending = deferred<typeof row>(); mocks.save.mockReturnValue(pending.promise);
    const view = render(editor()); begin(); const save = screen.getByRole("button", { name: "保存草稿" }); fireEvent.click(save); fireEvent.click(save);
    expect(mocks.save).toHaveBeenCalledOnce(); expect(draft()).toBeDisabled();
    view.rerender(editor({ ...row, revision: "c".repeat(64), summary: "更新的外部摘要" }));
    await act(async () => pending.resolve({ ...row, revision: newerRevision, summary: "本地人工编辑稿" }));
    expect(draft()).toHaveValue("本地人工编辑稿"); expect(screen.getByText(/本地草稿和起始版本已保留/)).toBeInTheDocument();
  });

  it.each(["user", "workspace", "null-workspace", "role", "project", "analysis"])("%s switch clears old draft and ignores late mutation callbacks", async mode => {
    const pending = deferred<typeof row>(); mocks.save.mockReturnValue(pending.promise);
    const view = render(editor()); begin("旧owner独有草稿"); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    if (mode === "user") mocks.auth.user!.id = 2;
    if (mode === "workspace") mocks.auth.user!.defaultWorkspaceId = 11;
    if (mode === "null-workspace") mocks.auth.user!.defaultWorkspaceId = null;
    if (mode === "role") mocks.auth.user!.role = "ops_specialist";
    const next = mode === "project" ? { ...row, projectId: 8 } : mode === "analysis" ? { ...row, id: 4, asin: "B000000004" } : row;
    view.rerender(editor(next, mode === "project" ? 8 : 7));
    await act(async () => pending.resolve({ ...row, revision: newerRevision, summary: "旧owner独有回执" }));
    expect(screen.queryByText("旧owner独有草稿")).not.toBeInTheDocument(); expect(screen.queryByText("旧owner独有回执")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("same-owner auth background refresh preserves its dirty draft without rebasing", async () => {
    const view = render(editor()); begin("保持此稿"); mocks.auth.loading = true; view.rerender(editor());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); mocks.auth.loading = false; view.rerender(editor());
    expect(draft()).toHaveValue("保持此稿"); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("竞品分析总结已保存"); expect(mocks.save.mock.calls[0][0].expectedRevision).toBe(revision);
  });

  it("a success callback returning another persisted row is quarantined and cannot refresh current data", async () => {
    mocks.confirm.mockResolvedValue({ ...row, projectId: 8, revision: newerRevision, summary: "foreign private row" });
    render(editor()); fireEvent.click(screen.getByRole("button", { name: "确认结果" })); await screen.findByRole("alert");
    expect(screen.queryByText("foreign private row")).not.toBeInTheDocument(); expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it.each([{ summaryStatus: "draft" }, { summary: "not the requested summary" }])("does not call an inconsistent confirmation receipt a completed lock %j", async patch => {
    mocks.confirm.mockResolvedValue({ ...row, revision: newerRevision, summaryStatus: "confirmed", ...patch });
    render(editor()); fireEvent.click(screen.getByRole("button", { name: "确认结果" })); await screen.findByRole("alert");
    expect(screen.queryByText("竞品分析已确认并锁定")).not.toBeInTheDocument(); expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("an ACK received during same-owner auth suspension preserves the draft without authorizing it with a new revision", async () => {
    const pending = deferred<typeof row>(); mocks.save.mockReturnValue(pending.promise);
    const view = render(editor()); begin("暂存旧版本稿"); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    mocks.auth.loading = true; view.rerender(editor()); await act(async () => pending.resolve({ ...row, revision: newerRevision, summary: "暂存旧版本稿" }));
    mocks.auth.loading = false; view.rerender(editor()); expect(draft()).toHaveValue("暂存旧版本稿");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled(); expect(screen.getByText(/请求结果需要重新读取核对/)).toBeInTheDocument();
    expect(mocks.invalidate).not.toHaveBeenCalled(); expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("returning from scope B to scope A cannot revive A's old pending callback", async () => {
    const pending = deferred<typeof row>(); mocks.save.mockReturnValue(pending.promise);
    const view = render(editor()); begin("旧A草稿"); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    mocks.auth.user!.defaultWorkspaceId = 11; view.rerender(editor());
    mocks.auth.user!.defaultWorkspaceId = 9; view.rerender(editor());
    await act(async () => pending.resolve({ ...row, revision: newerRevision, summary: "旧A回执" }));
    expect(screen.queryByText("旧A回执")).not.toBeInTheDocument(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("missing summaries never fabricate fallback headings or placeholders as confirmable data", () => {
    render(editor({ ...row, summary: "", aiSummary: "", rawData: '{"advantages":["raw field"]}' }));
    expect(screen.getByRole("button", { name: "确认结果" })).toBeDisabled();
    expect(screen.queryByText(/暂无明确核心卖点|请结合标题/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑" })); expect(draft()).toHaveValue("");
    expect(screen.getByRole("button", { name: "恢复 AI 原稿" })).toBeDisabled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("a refresh failure does not claim a persisted save failed or automatically submit it again", async () => {
    mocks.invalidate.mockRejectedValue(new Error("refresh failed")); render(editor()); begin(); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText(/请求已完成，但页面刷新失败/); expect(mocks.save).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });
});
