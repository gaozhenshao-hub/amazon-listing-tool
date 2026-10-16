// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductProfileAttributeSource from "./ProductProfileAttributeSource";

const mocks = vi.hoisted(() => {
  const invalidations = {
    listByType: vi.fn(), listByProject: vi.fn(), getAnalysisSummary: vi.fn(), listRawFactSuggestions: vi.fn(), listReviewedFacts: vi.fn(),
  };
  const list = vi.fn(), preview = vi.fn();
  const utils = { client: { projectAssignment: { listImportableDevProjects: { query: list }, getDevProjectProfile: { query: preview } } },
    projectFile: { listByType: { invalidate: invalidations.listByType }, listByProject: { invalidate: invalidations.listByProject },
      getAnalysisSummary: { invalidate: invalidations.getAnalysisSummary } },
    listing: { listRawFactSuggestions: { invalidate: invalidations.listRawFactSuggestions }, listReviewedFacts: { invalidate: invalidations.listReviewedFacts } } };
  return { list, preview, mutate: vi.fn(), utils, invalidations, options: [] as unknown[],
    auth: { user: { id: 1, defaultWorkspaceId: 9, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null,
      loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => mocks.utils,
  projectFile: { importFromProfile: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.mutate }; } } },
} }));

const sourceHash = "a".repeat(64);
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
  mocks.mutate.mockResolvedValue({ id: 300, projectId: 7, workspaceId: 9 });
  for (const invalidate of Object.values(mocks.invalidations)) invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("product profile attribute source ownership", () => {
  it("does not query before opening, and passes expected workspace to both fresh reads", async () => {
    render(<ProductProfileAttributeSource projectId={7} />);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
    await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    expect(mocks.list).toHaveBeenCalledWith({ expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    expect(mocks.preview).toHaveBeenCalledWith({ devProjectId: 10, expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    expect(screen.getByText(/Verified width: 20cm/)).toBeInTheDocument();
    expect(screen.getByText(/AI 建议（仅供参考，不参与本次生成）/)).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("preserves the legacy NULL workspace path and explicitly binds both reads and import to null", async () => {
    mocks.auth.user!.defaultWorkspaceId = null; mocks.mutate.mockResolvedValue({ id: 300, projectId: 7, workspaceId: null });
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
    const pending = deferred<{ id: number; projectId: number; workspaceId: number }>(); mocks.mutate.mockReturnValue(pending.promise);
    render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    const button = confirm(); fireEvent.click(button); fireEvent.click(button);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith({ listingProjectId: 7, devProjectId: 10, expectedWorkspaceId: 9, expectedSourceHash: sourceHash });
    expect(mocks.options.every(value => (value as { retry?: boolean }).retry === false)).toBe(true);
    expect(screen.getByRole("combobox")).toBeDisabled(); expect(screen.getByRole("button", { name: "关闭选择" })).toBeDisabled();
    await act(async () => pending.resolve({ id: 300, projectId: 7, workspaceId: 9 }));
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
    const pending = deferred<{ id: number; projectId: number; workspaceId: number }>(); mocks.mutate.mockReturnValue(pending.promise);
    const view = render(<ProductProfileAttributeSource projectId={7} />); await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm());
    if (mode === "user") mocks.auth.user = { id: 2, defaultWorkspaceId: 9, role: "admin" };
    if (mode === "workspace") mocks.auth.user = { id: 1, defaultWorkspaceId: 11, role: "admin" };
    if (mode === "role") mocks.auth.user = { id: 1, defaultWorkspaceId: 9, role: "user" };
    view.rerender(<ProductProfileAttributeSource projectId={mode === "project" ? 8 : 7} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "选择产品画像" })).toBeInTheDocument();
    await act(async () => pending.resolve({ id: 300, projectId: 7, workspaceId: 9 }));
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
    await screen.findByText("画像内容已变化，请重新选择并预览后再生成。"); expect(confirm()).toBeDisabled();
    expect(mocks.mutate).toHaveBeenCalledTimes(1); expect(screen.queryByText(/private source detail/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it("submission failure requires a new preview and never automatically retries or exposes raw errors", async () => {
    mocks.mutate.mockRejectedValue(new Error("sensitive backend diagnostic")); render(<ProductProfileAttributeSource projectId={7} />);
    await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled()); fireEvent.click(confirm());
    await screen.findByText(/生成结果尚未确认/); expect(confirm()).toBeDisabled(); expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/sensitive backend diagnostic/)).not.toBeInTheDocument();
    for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it("a refresh failure after a successful save does not claim import failure or invite repeat submission", async () => {
    mocks.invalidations.getAnalysisSummary.mockRejectedValue(new Error("refresh only")); render(<ProductProfileAttributeSource projectId={7} />);
    await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled()); fireEvent.click(confirm());
    await screen.findByText(/属性表已生成，但页面刷新失败/); expect(confirm()).toBeDisabled(); expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("an import returning a different target scope cannot refresh or reveal its response", async () => {
    mocks.mutate.mockResolvedValue({ id: 400, projectId: 8, workspaceId: 11 }); render(<ProductProfileAttributeSource projectId={7} />);
    await openAndSelect(); await waitFor(() => expect(confirm()).toBeEnabled()); fireEvent.click(confirm());
    await screen.findByText(/生成结果尚未确认/); for (const invalidate of Object.values(mocks.invalidations)) expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not turn a failed directory read into cached projects or auto-dispatch", async () => {
    mocks.list.mockRejectedValue(new Error("directory denied")); render(<ProductProfileAttributeSource projectId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "选择产品画像" })); await screen.findByText(/产品开发项目读取失败/);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); expect(confirm()).toBeDisabled(); expect(mocks.preview).not.toHaveBeenCalled();
  });
});
