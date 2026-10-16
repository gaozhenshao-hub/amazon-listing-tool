// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductProfileAttributeSource from "./ProductProfileAttributeSource";
import type { ProfileImportJobView } from "@shared/profileImportJob";

const mocks = vi.hoisted(() => {
  const invalidations = {
    listByType: vi.fn(), listByProject: vi.fn(), getAnalysisSummary: vi.fn(), listRawFactSuggestions: vi.fn(), listReviewedFacts: vi.fn(),
  };
  const list = vi.fn(), preview = vi.fn(), listJobs = vi.fn(), getJob = vi.fn();
  const utils = { client: { projectAssignment: { listImportableDevProjects: { query: list }, getDevProjectProfile: { query: preview } },
    projectFile: { listProfileImportJobs: { query: listJobs }, getProfileImportJob: { query: getJob } } },
    projectFile: { listByType: { invalidate: invalidations.listByType }, listByProject: { invalidate: invalidations.listByProject },
      getAnalysisSummary: { invalidate: invalidations.getAnalysisSummary } },
    listing: { listRawFactSuggestions: { invalidate: invalidations.listRawFactSuggestions }, listReviewedFacts: { invalidate: invalidations.listReviewedFacts } } };
  return { list, preview, listJobs, getJob, mutate: vi.fn(), resume: vi.fn(), legacy: vi.fn(), utils, invalidations, options: [] as unknown[],
    auth: { user: { id: 1, defaultWorkspaceId: 9, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null,
      loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => mocks.utils,
  projectFile: { startProfileImportJob: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.mutate }; } },
    resumeProfileImportJob: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.resume }; } },
    importFromProfile: { useMutation: () => ({ mutateAsync: mocks.legacy }) } },
} }));

const sourceHash = "a".repeat(64);
function job(patch: Partial<ProfileImportJobView> = {}): ProfileImportJobView {
  return { runId: "profile-job-1", listingProjectId: 7, workspaceId: 9, userId: 1, devProjectId: 10, sourceHash,
    status: "succeeded", stage: "file_committed", fileId: 300, progress: 100, canResume: false, message: "已保存",
    createdAt: new Date("2026-10-16T00:00:00Z"), ...patch };
}
const projects = [{ id: 10, name: "Source Alpha", targetMarket: "US", status: "active" }, { id: 20, name: "Source Beta", targetMarket: "CA", status: "active" }];
const preview = (id = 10, overrides: Record<string, unknown> = {}) => ({ project: { id, name: id === 10 ? "Source Alpha" : "Source Beta" },
  profile: { projectId: id, mainFunctions: ["Verified width: 20cm"], appearanceAiSuggestion: ["unconfirmed silver suggestion"] }, sourceHash, ...overrides });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function openAndSelect(id = "10") {
  fireEvent.click(screen.getByRole("button", { name: "选择产品画像" }));
  await screen.findByRole("option", { name: "Source Alpha · US" });
  fireEvent.change(screen.getByRole("combobox", { name: "产品画像来源项目" }), { target: { value: id } });
}
const confirm = () => screen.getByRole("button", { name: "确认生成属性表" });

beforeEach(() => {
  vi.clearAllMocks(); mocks.options.length = 0;
  mocks.auth = { user: { id: 1, defaultWorkspaceId: 9, role: "admin" }, loading: false, error: null };
  mocks.list.mockResolvedValue(projects); mocks.preview.mockImplementation(({ devProjectId }: { devProjectId: number }) => Promise.resolve(preview(devProjectId)));
  mocks.listJobs.mockResolvedValue([]); mocks.getJob.mockResolvedValue(job());
  mocks.mutate.mockImplementation(input => Promise.resolve(job({ devProjectId: input.devProjectId, workspaceId: input.expectedWorkspaceId, sourceHash: input.expectedSourceHash })));
  mocks.resume.mockResolvedValue(job());
  for (const invalidate of Object.values(mocks.invalidations)) invalidate.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("product profile attribute source ownership", () => {
  it("recovers jobs on mount without opening the private directory/preview, and binds all reads to workspace", async () => {
    render(<ProductProfileAttributeSource projectId={7} />);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.listJobs).toHaveBeenCalledWith({ listingProjectId: 7, expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    expect(mocks.list).toHaveBeenCalledWith({ expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    expect(mocks.preview).toHaveBeenCalledWith({ devProjectId: 10, expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    expect(screen.getByText(/Verified width: 20cm/)).toBeInTheDocument();
    expect(screen.getByText(/AI 建议（仅供参考，不参与本次生成）/)).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("preserves the legacy NULL workspace path and explicitly binds both reads and import to null", async () => {
    mocks.auth.user!.defaultWorkspaceId = null; mocks.mutate.mockResolvedValue(job({ workspaceId: null }));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    expect(mocks.list).toHaveBeenCalledWith({ expectedWorkspaceId: null }, { signal: expect.any(AbortSignal) });
    expect(mocks.preview).toHaveBeenCalledWith({ devProjectId: 10, expectedWorkspaceId: null }, { signal: expect.any(AbortSignal) });
    fireEvent.click(confirm()); await screen.findByText(/属性表已生成，请在生成页审核本品事实/);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith({ listingProjectId: 7, devProjectId: 10, expectedWorkspaceId: null, expectedSourceHash: sourceHash });
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects undefined/invalid workspace %s rather than treating it as legacy null", value => {
    mocks.auth.user!.defaultWorkspaceId = value; render(<ProductProfileAttributeSource projectId={7} />);
    expect(screen.queryByRole("button", { name: "选择产品画像" })).not.toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("uses explicit confirmation, exact preview hash and retry:false; double click dispatches once", async () => {
    const pending = deferred<ProfileImportJobView>(); mocks.mutate.mockReturnValue(pending.promise);
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    const button = confirm(); fireEvent.click(button); fireEvent.click(button);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith({ listingProjectId: 7, devProjectId: 10, expectedWorkspaceId: 9, expectedSourceHash: sourceHash });
    expect(mocks.options.every(value => (value as { retry?: boolean }).retry === false)).toBe(true);
    expect(screen.getByRole("combobox")).toBeDisabled(); expect(screen.getByRole("button", { name: "关闭选择" })).toBeDisabled();
    await act(async () => pending.resolve(job()));
    await screen.findByText(/属性表已生成，请在生成页审核本品事实/);
    expect(mocks.invalidations.listByType).toHaveBeenCalledWith({ projectId: 7, fileType: "product_attributes" });
    for (const key of ["listByProject", "getAnalysisSummary", "listRawFactSuggestions", "listReviewedFacts"] as const)
      expect(mocks.invalidations[key]).toHaveBeenCalledWith({ projectId: 7 });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "查看当前属性及版本历史" })).toHaveAttribute("href", "/listing/data-files#product-attributes-source-history");
  });

  it.each(["loading", "anonymous", "auth-error", "missing-workspace", "invalid-project"])("%s identity never privately reads", mode => {
    if (mode === "loading") mocks.auth.loading = true;
    if (mode === "anonymous") mocks.auth.user = null;
    if (mode === "auth-error") mocks.auth.error = new Error("synthetic auth unavailable");
    if (mode === "missing-workspace") mocks.auth.user!.defaultWorkspaceId = 0;
    render(<ProductProfileAttributeSource projectId={mode === "invalid-project" ? 0 : 7} />);
    expect(screen.queryByRole("button", { name: "选择产品画像" })).not.toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each([null, "", "not-a-hash", "A".repeat(64)])("missing/invalid source hash %s cannot import", async value => {
    mocks.preview.mockResolvedValue(preview(10, { sourceHash: value })); render(<ProductProfileAttributeSource projectId={7} />);
    await openAndSelect(); await screen.findByRole("alert"); expect(confirm()).toBeDisabled(); fireEvent.click(confirm());
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("handles failed, missing and empty profiles truthfully without an enabled submit", async () => {
    mocks.preview.mockRejectedValue(new Error("private diagnostic must not render"));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await screen.findByText(/画像预览读取失败/);
    expect(confirm()).toBeDisabled(); expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
    mocks.preview.mockResolvedValue(preview(20, { profile: null, sourceHash: null }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "20" } }); await screen.findByText("该项目尚无产品画像。");
    expect(confirm()).toBeDisabled();
    mocks.preview.mockResolvedValue(preview(10, { profile: { projectId: 10 } }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "10" } }); await screen.findByText(/画像尚无可转换的内容/);
    expect(confirm()).toBeDisabled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("refuses a successful preview whose returned project/profile belongs to another selection", async () => {
    mocks.preview.mockResolvedValue(preview(20)); render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect();
    await screen.findByText(/画像预览读取失败/); expect(confirm()).toBeDisabled();
    expect(screen.queryByRole("region", { name: "所选产品画像预览" })).not.toBeInTheDocument();
  });

  it.each([null, "", "null", "{}", "[]", '{"unset":null}', '[null,{},[]]', '{"unset":{"items":[null,{},[]]}}'])("AI suggestions cannot replace empty entered source %s", async value => {
    mocks.preview.mockResolvedValue(preview(10, { profile: { projectId: 10, mainFunctions: value, functionsAiSuggestion: "AI-only source" } }));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect();
    await screen.findByText(/画像尚无人工填写内容/); expect(confirm()).toBeDisabled();
    expect(screen.getByText("AI-only source")).toBeInTheDocument(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each(["0", "false"])("preserves entered JSON scalar %s instead of falling back to AI suggestions", async value => {
    mocks.preview.mockResolvedValue(preview(10, { profile: { projectId: 10, mainFunctions: value, functionsAiSuggestion: "AI-only source" } }));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    expect(screen.getByText(value)).toBeInTheDocument(); expect(screen.queryByText("AI-only source")).not.toBeInTheDocument();
  });

  it("renders untrusted profile text as inert text without interpreting markup", async () => {
    const content = '<img src=x onerror="alert(1)"><script>secret()</script>';
    mocks.preview.mockResolvedValue(preview(10, { profile: { projectId: 10, mainFunctions: content } }));
    const view = render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    expect(screen.getByText(content)).toBeInTheDocument(); expect(view.container.querySelector("img,script")).toBeNull();
  });

  it("late source previews cannot replace a newer selected source", async () => {
    const old = deferred<ReturnType<typeof preview>>();
    mocks.preview.mockImplementation(({ devProjectId }: { devProjectId: number }) => devProjectId === 10 ? old.promise : Promise.resolve(preview(20)));
    render(<StrictMode><ProductProfileAttributeSource projectId={7} /></StrictMode>); await openAndSelect();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "20" } });
    await waitFor(() => expect(confirm()).toBeEnabled());
    await act(async () => old.resolve(preview(10, { profile: { projectId: 10, mainFunctions: ["late old secret"] } })));
    expect(screen.queryByText(/late old secret/)).not.toBeInTheDocument();
    fireEvent.click(confirm()); await screen.findByText(/属性表已生成/);
    expect(mocks.mutate.mock.calls[0][0].devProjectId).toBe(20);
  });

  it.each(["user", "workspace", "role", "project"])("%s switch clears private state and ignores pending import callbacks", async mode => {
    const pending = deferred<ProfileImportJobView>(); mocks.mutate.mockReturnValue(pending.promise);
    const view = render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm());
    if (mode === "user") mocks.auth.user = { id: 2, defaultWorkspaceId: 9, role: "admin" };
    if (mode === "workspace") mocks.auth.user = { id: 1, defaultWorkspaceId: 11, role: "admin" };
    if (mode === "role") mocks.auth.user = { id: 1, defaultWorkspaceId: 9, role: "user" };
    view.rerender(<ProductProfileAttributeSource projectId={mode === "project" ? 8 : 7} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "选择产品画像" })).toBeInTheDocument();
    await act(async () => pending.resolve(job()));
    expect(screen.queryByText(/属性表已生成/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it("late previews after target-project change are discarded and closed state does not query", async () => {
    const pending = deferred<ReturnType<typeof preview>>(); mocks.preview.mockReturnValue(pending.promise);
    const view = render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect();
    view.rerender(<ProductProfileAttributeSource projectId={8} />);
    await act(async () => pending.resolve(preview(10, { profile: { projectId: 10, mainFunctions: ["old project source"] } })));
    expect(screen.queryByText(/old project source/)).not.toBeInTheDocument(); expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("closing discards a pending preview and reopening always starts a fresh directory read", async () => {
    const pending = deferred<ReturnType<typeof preview>>(); mocks.preview.mockReturnValue(pending.promise);
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect();
    fireEvent.click(screen.getByRole("button", { name: "关闭选择" }));
    await act(async () => pending.resolve(preview(10, { profile: { projectId: 10, mainFunctions: ["closed preview secret"] } })));
    expect(screen.queryByText(/closed preview secret/)).not.toBeInTheDocument(); expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选择产品画像" })); await screen.findByRole("combobox");
    expect(mocks.list).toHaveBeenCalledTimes(2); expect(screen.getByRole("combobox")).toHaveValue(""); expect(confirm()).toBeDisabled();
  });

  it("ignores an old directory reply after workspace changes and rereads only the new scope", async () => {
    const old = deferred<typeof projects>(); mocks.list.mockReturnValueOnce(old.promise);
    const view = render(<ProductProfileAttributeSource projectId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "选择产品画像" }));
    mocks.auth.user = { id: 1, defaultWorkspaceId: 11, role: "admin" }; view.rerender(<ProductProfileAttributeSource projectId={7} />);
    await act(async () => old.resolve([{ ...projects[0], name: "old directory secret" }]));
    expect(screen.queryByText(/old directory secret/)).not.toBeInTheDocument(); expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择产品画像" })); await screen.findByRole("combobox");
    expect(mocks.list.mock.calls[1][0]).toEqual({ expectedWorkspaceId: 11 }); expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("shows source-version conflicts as a reread requirement and still never retries", async () => {
    mocks.mutate.mockRejectedValue({ data: { code: "CONFLICT" }, message: "private source detail" });
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled()); fireEvent.click(confirm());
    await screen.findByText(/画像或任务状态已变化/); expect(confirm()).toBeDisabled();
    expect(mocks.mutate).toHaveBeenCalledTimes(1); expect(screen.queryByText(/private source detail/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it("an unacknowledged submission blocks repeats and never automatically retries or exposes raw errors", async () => {
    mocks.mutate.mockRejectedValue(new Error("sensitive backend diagnostic")); render(<ProductProfileAttributeSource projectId={7} />);
    await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled()); fireEvent.click(confirm());
    await screen.findByText(/提交结果尚未确认，正在核对原任务/); expect(confirm()).toBeDisabled(); expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/sensitive backend diagnostic/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it("a refresh failure after a successful save does not claim import failure or invite repeat submission", async () => {
    mocks.invalidations.getAnalysisSummary.mockRejectedValue(new Error("refresh only")); render(<ProductProfileAttributeSource projectId={7} />);
    await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled()); fireEvent.click(confirm());
    await screen.findByText(/属性表已生成，但页面刷新失败/); expect(confirm()).toBeDisabled(); expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("an import returning a different target scope cannot refresh or reveal its response", async () => {
    mocks.mutate.mockResolvedValue(job({ listingProjectId: 8, workspaceId: 11 })); render(<ProductProfileAttributeSource projectId={7} />);
    await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled()); fireEvent.click(confirm());
    await screen.findByText(/已隐藏旧任务/); for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not turn a failed directory read into cached projects or auto-dispatch", async () => {
    mocks.list.mockRejectedValue(new Error("directory denied")); render(<ProductProfileAttributeSource projectId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "选择产品画像" })); await screen.findByText(/产品开发项目读取失败/);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); expect(confirm()).toBeDisabled(); expect(mocks.preview).not.toHaveBeenCalled();
  });
});

describe("durable product profile task recovery", () => {
  const flush = () => act(async () => {});
  const resumeButton = () => screen.getByRole("button", { name: "确认恢复属性任务" });
  async function selectWithTimers(id = "10") {
    fireEvent.click(screen.getByRole("button", { name: "选择产品画像" })); await flush();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: id } }); await flush();
  }

  it("acknowledges a queued task without waiting for a model, and closing never cancels or reissues it", async () => {
    mocks.mutate.mockResolvedValue(job({ status: "queued", stage: "reserved", fileId: null, progress: 0, message: "等待执行" }));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm()); await screen.findByText(/任务已记录，可离开页面/);
    expect(screen.queryByText(/属性表已生成/)).not.toBeInTheDocument(); expect(confirm()).toBeDisabled();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭选择" }));
    expect(screen.getByRole("article", { name: "属性任务 profile-job-1" })).toBeInTheDocument();
    expect(mocks.mutate).toHaveBeenCalledTimes(1); expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it("recovers on mount, polls the exact run with expected workspace, and refreshes only once after committed proof", async () => {
    vi.useFakeTimers();
    mocks.listJobs.mockResolvedValue([job({ status: "running", stage: "model_dispatched", fileId: null, progress: 40, message: "正在分析" })]);
    render(<ProductProfileAttributeSource projectId={7} />); await flush();
    expect(screen.getByText(/正在生成 · 40%/)).toBeInTheDocument();
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.getJob).toHaveBeenCalledWith({ listingProjectId: 7, runId: "profile-job-1", expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    expect(screen.getByText(/属性表已生成，请在生成页审核本品事实/)).toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).toHaveBeenCalledTimes(1);
    mocks.listJobs.mockResolvedValue([job()]); fireEvent.click(screen.getByRole("button", { name: "重新读取属性任务" })); await flush();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("leaving and returning recovers the server task rather than starting or canceling a replacement", async () => {
    const recorded = job({ status: "queued", stage: "reserved", fileId: null, progress: 0 }); mocks.listJobs.mockResolvedValue([recorded]);
    const first = render(<ProductProfileAttributeSource projectId={7} />); await screen.findByRole("article"); first.unmount();
    render(<ProductProfileAttributeSource projectId={7} />); await screen.findByRole("article");
    expect(mocks.listJobs).toHaveBeenCalledTimes(2); expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("lost start ACK is recovered only by the exact source operation, without another paid dispatch", async () => {
    mocks.listJobs.mockResolvedValueOnce([]).mockResolvedValue([job({ status: "queued", stage: "reserved", fileId: null })]);
    mocks.mutate.mockRejectedValue(new Error("connection reset after dispatch"));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm()); await screen.findByText(/已找到原任务/);
    expect(confirm()).toBeDisabled(); expect(mocks.mutate).toHaveBeenCalledTimes(1); expect(mocks.resume).not.toHaveBeenCalled();
    expect(screen.queryByText(/connection reset/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(["unrelated", "ambiguous", "empty", "unreadable"])("lost ACK never guesses a replacement from %s task reads", async mode => {
    const records = mode === "unrelated" ? [job({ devProjectId: 20 })]
      : mode === "ambiguous" ? [job({ status: "queued", stage: "reserved", fileId: null }), job({ runId: "second", status: "queued", stage: "reserved", fileId: null })] : [];
    mocks.listJobs.mockResolvedValueOnce([]);
    if (mode === "unreadable") mocks.listJobs.mockRejectedValue(new Error("read disconnected")); else mocks.listJobs.mockResolvedValue(records);
    mocks.mutate.mockRejectedValue(new Error("ACK lost"));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm()); await screen.findByText(/提交结果尚未确认，正在核对原任务/);
    expect(screen.queryByText(/已找到原任务/)).not.toBeInTheDocument(); expect(confirm()).toBeDisabled();
    fireEvent.click(confirm()); expect(mocks.mutate).toHaveBeenCalledTimes(1); expect(mocks.resume).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", "reserved"], ["failed", "analysis_ready"], ["canceled", "reserved"], ["canceled", "analysis_ready"],
  ] as const)("a matching %s / %s receipt directs explicit fresh-preview resume, not start", async (status, stage) => {
    mocks.listJobs.mockResolvedValue([job({ status, stage, fileId: null, canResume: true, message: "可恢复" })]);
    const pending = deferred<ProfileImportJobView>(); mocks.resume.mockReturnValue(pending.promise);
    render(<ProductProfileAttributeSource projectId={7} />); await screen.findByRole("button", { name: "确认恢复属性任务" });
    expect(resumeButton()).toBeDisabled(); await openAndSelect(); await waitFor(() => expect(resumeButton()).toBeEnabled());
    expect(confirm()).toBeDisabled(); fireEvent.click(confirm()); expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(resumeButton()); fireEvent.click(resumeButton()); expect(mocks.resume).toHaveBeenCalledTimes(1);
    expect(mocks.resume).toHaveBeenCalledWith({ listingProjectId: 7, runId: "profile-job-1", expectedWorkspaceId: 9, expectedSourceHash: sourceHash });
    expect(mocks.options.every(value => (value as { retry?: boolean }).retry === false)).toBe(true);
    await act(async () => pending.resolve(job({ status: "running", stage: "model_dispatched", fileId: null })));
    expect(screen.getByText(/任务已记录，可离开页面/)).toBeInTheDocument(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("a failure learned after preview cannot reuse that older preview to resume", async () => {
    vi.useFakeTimers(); mocks.listJobs.mockResolvedValue([job({ status: "running", stage: "model_dispatched", fileId: null })]);
    mocks.getJob.mockResolvedValue(job({ status: "failed", stage: "analysis_ready", fileId: null, canResume: true }));
    render(<ProductProfileAttributeSource projectId={7} />); await flush(); await selectWithTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(resumeButton()).toBeDisabled(); fireEvent.click(resumeButton()); expect(mocks.resume).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "20" } }); await flush();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "10" } }); await flush();
    expect(resumeButton()).toBeEnabled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("does not turn server rejection of a canceled parent's resume into success or an automatic retry", async () => {
    mocks.listJobs.mockResolvedValue([job({ status: "canceled", stage: "analysis_ready", canResume: true, fileId: null })]);
    mocks.resume.mockRejectedValue({ data: { code: "CONFLICT" }, message: "PROFILE_IMPORT_AGENT_CANCELED" });
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(resumeButton()).toBeEnabled());
    fireEvent.click(resumeButton()); await screen.findByText(/画像或任务状态已变化/);
    expect(mocks.resume).toHaveBeenCalledTimes(1); expect(mocks.mutate).not.toHaveBeenCalled();
    expect(resumeButton()).toBeDisabled(); expect(confirm()).toBeDisabled();
    expect(screen.queryByText(/PROFILE_IMPORT_AGENT_CANCELED/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([
    { status: "failed", stage: "reserved", canResume: false }, { status: "failed", stage: "model_dispatched", canResume: true },
    { status: "failed", stage: "model_result_unknown", canResume: true }, { status: "canceled", stage: "reserved", canResume: false },
    { status: "canceled", stage: "model_result_unknown", canResume: true },
  ] as const)("does not resume or restart unsafe terminal receipt %j", async state => {
    mocks.listJobs.mockResolvedValue([job({ ...state, fileId: null })]);
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await screen.findByText(/Verified width/);
    expect(confirm()).toBeDisabled(); expect(screen.queryByRole("button", { name: "确认恢复属性任务" })).not.toBeInTheDocument();
    fireEvent.click(confirm()); expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("unknown forbids only the same source operation, not an explicitly previewed new source version", async () => {
    mocks.listJobs.mockResolvedValue([job({ status: "failed", stage: "model_result_unknown", fileId: null, message: "unknown" })]);
    mocks.mutate.mockResolvedValue(job({ runId: "new-source-job", sourceHash: "b".repeat(64), status: "queued", stage: "reserved", fileId: null }));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await screen.findByText(/Verified width/);
    expect(confirm()).toBeDisabled(); expect(screen.getByText(/此画像版本不能再次生成/)).toBeInTheDocument();
    mocks.preview.mockResolvedValue(preview(10, { sourceHash: "b".repeat(64) }));
    fireEvent.click(screen.getByRole("button", { name: "重新读取画像来源" })); await screen.findByRole("combobox");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "10" } }); await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm()); await screen.findByRole("article", { name: "属性任务 new-source-job" });
    expect(mocks.mutate).toHaveBeenCalledWith({ listingProjectId: 7, devProjectId: 10, expectedWorkspaceId: 9, expectedSourceHash: "b".repeat(64) });
    expect(screen.getByRole("article", { name: "属性任务 profile-job-1" })).toBeInTheDocument(); expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("a fresh preview of a different hash cannot resume a failed older source", async () => {
    mocks.listJobs.mockResolvedValue([job({ status: "failed", stage: "analysis_ready", canResume: true, fileId: null })]);
    mocks.preview.mockResolvedValue(preview(10, { sourceHash: "b".repeat(64) }));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    expect(resumeButton()).toBeDisabled(); fireEvent.click(resumeButton()); expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each([{ stage: "analysis_ready", fileId: 300 }, { stage: "file_committed", fileId: null }] as const)("success without complete commit proof %j never refreshes facts", async proof => {
    mocks.listJobs.mockResolvedValue([job(proof)]); render(<ProductProfileAttributeSource projectId={7} />);
    await screen.findByText(/尚无完整的保存凭据/); expect(screen.queryByText(/属性表已生成，请在生成页/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("status polling cannot replace the currently selected preview or adopt its source hash", async () => {
    vi.useFakeTimers(); mocks.listJobs.mockResolvedValue([job({ devProjectId: 20, status: "queued", stage: "reserved", fileId: null })]);
    mocks.getJob.mockResolvedValue(job({ devProjectId: 20, status: "running", stage: "model_dispatched", fileId: null }));
    render(<ProductProfileAttributeSource projectId={7} />); await flush(); await selectWithTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByRole("combobox")).toHaveValue("10"); expect(mocks.preview).toHaveBeenCalledTimes(1); expect(confirm()).toBeEnabled();
    fireEvent.click(confirm()); await flush();
    expect(mocks.mutate.mock.calls[0][0]).toEqual({ listingProjectId: 7, devProjectId: 10, expectedWorkspaceId: 9, expectedSourceHash: sourceHash });
  });

  it("same-owner auth refresh hides but preserves the preview and clears pending after an ACK arrives while suspended", async () => {
    const pending = deferred<ProfileImportJobView>(); mocks.mutate.mockReturnValue(pending.promise);
    const view = render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm()); mocks.auth.loading = true; view.rerender(<ProductProfileAttributeSource projectId={7} />);
    await act(async () => pending.resolve(job({ status: "queued", stage: "reserved", fileId: null })));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    mocks.listJobs.mockResolvedValue([job({ status: "queued", stage: "reserved", fileId: null })]);
    mocks.auth.loading = false; view.rerender(<ProductProfileAttributeSource projectId={7} />);
    await screen.findByRole("article"); expect(screen.getByRole("combobox")).toHaveValue("10");
    expect(screen.getByRole("button", { name: "关闭选择" })).toBeEnabled(); expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledTimes(1); expect(mocks.resume).not.toHaveBeenCalled();
  });

  it.each(["lost", "received"])("retains an unconfirmed operation when its %s ACK settles during same-owner auth refresh and the new list is empty", async ack => {
    const pending = deferred<ProfileImportJobView>(); mocks.mutate.mockReturnValue(pending.promise);
    const view = render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm()); mocks.auth.loading = true; view.rerender(<ProductProfileAttributeSource projectId={7} />);
    await act(async () => {
      if (ack === "lost") pending.reject(new Error("private transport ACK lost"));
      else pending.resolve(job({ status: "queued", stage: "reserved", fileId: null }));
    });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    mocks.auth.loading = false; view.rerender(<ProductProfileAttributeSource projectId={7} />);
    await screen.findByText(/当前范围尚无已记录的属性任务/);
    expect(screen.getByRole("combobox")).toHaveValue("10");
    expect(screen.getByText(/此画像版本的提交结果尚未确认/)).toBeInTheDocument();
    expect(confirm()).toBeDisabled(); fireEvent.click(confirm());
    expect(mocks.mutate).toHaveBeenCalledTimes(1); expect(mocks.resume).not.toHaveBeenCalled();
    expect(screen.queryByText(/private transport/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
    mocks.listJobs.mockResolvedValue([job({ status: "queued", stage: "reserved", fileId: null })]);
    fireEvent.click(screen.getByRole("button", { name: "重新读取属性任务" })); await screen.findByRole("article");
    expect(screen.queryByText(/此画像版本的提交结果尚未确认/)).not.toBeInTheDocument();
    expect(confirm()).toBeDisabled(); expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("never redispatches committed refreshes that settle while same-owner authentication is suspended", async () => {
    const refresh = deferred<void>();
    for (const invalidate of Object.values(mocks.invalidations)) invalidate.mockReturnValue(refresh.promise);
    mocks.listJobs.mockResolvedValue([job()]);
    const view = render(<ProductProfileAttributeSource projectId={7} />); await screen.findByRole("article");
    await waitFor(() => { for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).toHaveBeenCalledTimes(1); });
    mocks.auth.loading = true; view.rerender(<ProductProfileAttributeSource projectId={7} />);
    await act(async () => refresh.resolve());
    mocks.auth.loading = false; view.rerender(<ProductProfileAttributeSource projectId={7} />);
    await screen.findByRole("article"); await act(async () => {});
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
  });

  it.each(["user", "workspace", "null-workspace", "role", "project"])("late task-list replies cannot survive %s change", async mode => {
    const old = deferred<ProfileImportJobView[]>(); mocks.listJobs.mockReturnValueOnce(old.promise).mockResolvedValue([]);
    const view = render(<ProductProfileAttributeSource projectId={7} />);
    if (mode === "user") mocks.auth.user = { id: 2, defaultWorkspaceId: 9, role: "admin" };
    if (mode === "workspace") mocks.auth.user!.defaultWorkspaceId = 11;
    if (mode === "null-workspace") mocks.auth.user!.defaultWorkspaceId = null;
    if (mode === "role") mocks.auth.user!.role = "user";
    view.rerender(<ProductProfileAttributeSource projectId={mode === "project" ? 8 : 7} />);
    await act(async () => old.resolve([job({ message: "old private task" })]));
    expect(screen.queryByText(/old private task/)).not.toBeInTheDocument(); expect(screen.queryByRole("article")).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("scope A to B to A still rejects an old A status callback", async () => {
    vi.useFakeTimers(); const old = deferred<ProfileImportJobView>();
    mocks.listJobs.mockResolvedValueOnce([job({ status: "running", stage: "model_dispatched", fileId: null })]).mockResolvedValue([]);
    mocks.getJob.mockReturnValue(old.promise); const view = render(<ProductProfileAttributeSource projectId={7} />); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    mocks.auth.user!.defaultWorkspaceId = 11; view.rerender(<ProductProfileAttributeSource projectId={7} />); await flush();
    mocks.auth.user!.defaultWorkspaceId = 9; view.rerender(<ProductProfileAttributeSource projectId={7} />); await flush();
    await act(async () => old.resolve(job()));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(["run", "source", "owner"])("wrong %s returned by a status read is quarantined rather than merged", async mismatch => {
    vi.useFakeTimers(); mocks.listJobs.mockResolvedValue([job({ status: "running", stage: "model_dispatched", fileId: null })]);
    mocks.getJob.mockResolvedValue(job(mismatch === "run" ? { runId: "other-run" } : mismatch === "source" ? { sourceHash: "b".repeat(64) } : { userId: 2 }));
    render(<ProductProfileAttributeSource projectId={7} />); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByText(/已隐藏旧任务/)).toBeInTheDocument(); expect(screen.queryByRole("article")).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it("revoked source access clears old jobs and preview, and parallel late preview cannot restore them", async () => {
    const old = deferred<ReturnType<typeof preview>>();
    mocks.listJobs.mockResolvedValueOnce([job({ status: "failed", stage: "model_result_unknown", fileId: null })]).mockRejectedValue({ data: { code: "FORBIDDEN" } });
    mocks.preview.mockReturnValue(old.promise); render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect();
    fireEvent.click(screen.getByRole("button", { name: "重新读取属性任务" })); await screen.findByText(/已隐藏旧任务/);
    await act(async () => old.resolve(preview(10, { profile: { projectId: 10, mainFunctions: "revoked secret" } })));
    expect(screen.queryByRole("article")).not.toBeInTheDocument(); expect(screen.queryByText(/revoked secret/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "所选产品画像预览" })).not.toBeInTheDocument(); expect(confirm()).toBeDisabled();
  });

  it("transient task-read failure keeps prior status explicitly stale, not a false empty state or permission to start", async () => {
    mocks.listJobs.mockResolvedValueOnce([job({ status: "queued", stage: "reserved", fileId: null })]).mockRejectedValue(new Error("offline"));
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await screen.findByText(/Verified width/);
    fireEvent.click(screen.getByRole("button", { name: "重新读取属性任务" })); await screen.findByText(/任务状态读取失败/);
    expect(screen.getByRole("article")).toBeInTheDocument(); expect(confirm()).toBeDisabled();
    expect(screen.queryByText(/当前范围尚无已记录/)).not.toBeInTheDocument(); expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
