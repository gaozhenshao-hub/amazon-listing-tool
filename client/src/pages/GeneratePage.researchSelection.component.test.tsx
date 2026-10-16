// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GeneratePage from "./GeneratePage";

const mocks = vi.hoisted(() => {
  const empty: unknown[] = [], list = vi.fn(), start = vi.fn(), noop = vi.fn(), get = vi.fn(), history = vi.fn(), facts = vi.fn(), cores = vi.fn();
  const points = Array.from({ length: 7 }, (_, index) => ({ index: index + 1, theme: `Preserved direction ${index + 1}`, themeZh: "",
    description: "An existing human draft", descriptionZh: "", fabeDirection: { feature: "", advantage: "", benefit: "", evidence: "" }, targetKeywords: [], addressesGap: "" }));
  return { enabled: true, real: false, list, start, noop, get, history, facts, cores, empty, points, prepare: vi.fn(), settle: vi.fn(), edit: vi.fn(), markDirty: vi.fn(), restore: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, owner: { key: "owned-scope" }, run: null as unknown,
    currentJob: null as { refetch: () => Promise<unknown> } | null, queryPaths: [] as string[], auth: { user: { id: 1, role: "admin", defaultWorkspaceId: 9 } as { id: number; role: string; defaultWorkspaceId: number | null } | null, loading: false, error: null as Error | null },
    client: { analysis: { listByProject: { query: list } }, listing: { getGenerationRun: { query: get }, listGenerationRuns: { query: history },
      listReviewedFacts: { query: facts }, listCurrentCores: { query: cores } } } };
});
vi.mock("@/lib/mergedListingWorkflow", () => ({ get MERGED_LISTING_WORKFLOW_ENABLED() { return mocks.enabled; } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/contexts/ProjectContext", () => ({ useProject: () => ({ selectedProjectId: 7 }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/listing/generate", mocks.noop], Link: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/components/ProjectSelector", () => ({ default: () => null }));
vi.mock("./listing/ProductProfileAttributeSource", () => ({ default: () => <div>Preserved profile source entry</div> }));
vi.mock("./listing/StepTitle", () => ({ default: () => null }));
vi.mock("./listing/StepDescription", () => ({ default: () => null }));
vi.mock("./listing/StepSearchTerms", () => ({ default: () => null }));
vi.mock("./listing/StepQA", () => ({ default: () => null }));
vi.mock("@/components/BulletChecklistPanel", () => ({ default: () => null }));
vi.mock("@/components/LockedContentBar", () => ({ default: () => null }));
vi.mock("@/components/workflow/DistillationGuidancePicker", () => ({ DistillationGuidancePicker: () => null }));
vi.mock("@/components/workflow/ListingPlanningPanel", () => ({ ListingPlanningPanel: () => null }));
vi.mock("@/components/listing/FactReviewPanel", () => ({ FactReviewPanel: () => null }));
vi.mock("@/components/listing/CoreReviewPanel", () => ({ CoreReviewPanel: () => null }));
vi.mock("@/components/listing/CandidateReviewPanel", () => ({ CandidateReviewPanel: () => null }));
vi.mock("./listing/KeywordImportDialog", () => ({ KeywordImportDialog: () => null }));
vi.mock("./listing/SellingPointPlanSummary", () => ({ SellingPointPlanSummary: ({ metadata }: { metadata: { overallStrategy?: string } }) => <div data-testid="plan-strategy">{metadata.overallStrategy}</div>, SellingPointDirectionDetails: () => null }));
vi.mock("./listing/useSellingPointPlanRecovery", async importOriginal => {
  const actual = await importOriginal<typeof import("./listing/useSellingPointPlanRecovery")>();
  return { useSellingPointPlanRecovery: (projectId: number | null) => mocks.real ? actual.useSellingPointPlanRecovery(projectId) : ({ points: mocks.points, setPoints: mocks.edit,
  metadata: {}, restore: mocks.restore, settleUnsuccessfulAttempt: mocks.settle, prepare: mocks.prepare, markDirty: mocks.markDirty, reset: mocks.noop,
  restorationVersion: 0, awaitingNewRun: false, ignoredRunId: null }) };
});
vi.mock("./listing/useListingGenerationJob", async importOriginal => {
  const actual = await importOriginal<typeof import("./listing/useListingGenerationJob")>();
  return { useListingGenerationJob: (input: Parameters<typeof actual.useListingGenerationJob>[0]) => {
    if (mocks.real) { const result = actual.useListingGenerationJob(input); mocks.currentJob = result; return result; }
    return ({ run: mocks.run, history: mocks.empty,
  isLoadingRun: false, readError: false, ownerKey: "owned-scope", responseOwner: mocks.owner, isGenerating: false, isStarting: false, isCanceling: false,
  start: mocks.start, cancel: mocks.noop, refetch: mocks.noop }); },
  useOwnedListingReviewLedger: (projectId: number) => mocks.real ? actual.useOwnedListingReviewLedger(projectId) : ({
    facts: { data: mocks.empty, isLoading: false, isError: false, error: null }, cores: { data: mocks.empty, isLoading: false, isError: false, error: null }, refetch: mocks.noop,
  }), ListingGenerationJobStatus: () => null };
});
vi.mock("@/lib/trpc", () => {
  const mutation = { mutate: mocks.noop, mutateAsync: mocks.noop, isPending: false };
  const proxy = (path: string[] = []): unknown => new Proxy({}, { get: (_, field: string) => {
    if (field === "then") return undefined;
    if (field === "useUtils") return () => ({ client: mocks.client });
    if (field === "useMutation") return () => mutation;
    if (field === "useQuery") return () => { mocks.queryPaths.push(path.join(".")); return ({ data: path.join(".") === "project.getById" ? { id: 7, name: "Synthetic target" }
      : path.join(".") === "projectFile.getAnalysisSummary" ? { productAttributes: true, fileCount: 1, hasAllFiles: true }
        : path.join(".") === "listing.getActive" ? null : path.join(".") === "keyword.stats" ? { total: 0 } : mocks.empty,
      isLoading: false, isError: false, refetch: mocks.noop }); };
    return proxy([...path, field]);
  } });
  return { trpc: proxy() };
});
const rows = [{ id: 10, projectId: 7, asin: "B000000010", title: "Scoped competitor", summaryStatus: "draft" }];
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; mocks.real = false; mocks.run = null; mocks.list.mockResolvedValue(rows); mocks.start.mockResolvedValue({ runId: "new-run" });
  mocks.queryPaths.length = 0; mocks.currentJob = null;
  mocks.auth = { user: { id: 1, role: "admin", defaultWorkspaceId: 9 }, loading: false, error: null };
  mocks.get.mockResolvedValue(null); mocks.history.mockResolvedValue([]); mocks.facts.mockResolvedValue([]); mocks.cores.mockResolvedValue([]);
});

function savedRun() {
  return { runId: "scope-a-run", module: "listing", userId: 1, workspaceId: 9, projectId: 7, status: "succeeded",
    input: { projectId: 7, nodeId: "G1", operation: "sellingPoints", scopeKey: "main" },
    output: { sellingPoints: mocks.points, overallStrategy: "Scope A saved strategy", checkListCoverage: { B4_order: "Scope A order" } } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const reviewKey = (name: string, projectId = 7) => [["listing", name], { input: { projectId }, type: "query" }] as const;
async function makeActualDirty() {
  await screen.findByText("Preserved direction 1");
  const card = screen.getByText("Preserved direction 1").parentElement!.parentElement!.parentElement!;
  fireEvent.click(card.querySelector("button")!);
  fireEvent.change(screen.getByDisplayValue("Preserved direction 1"), { target: { value: "Scope A private dirty direction" } });
  expect(screen.getByDisplayValue("Scope A private dirty direction")).toBeInTheDocument();
}

describe("real Generate recovery + owned job/review composition", () => {
  it("does not mount private recovery reads while an initial identity is still loading", () => {
    mocks.real = true; mocks.auth.loading = true; renderPage();
    expect(screen.getByText("正在确认生成页身份…")).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.facts).not.toHaveBeenCalled(); expect(mocks.cores).not.toHaveBeenCalled();
  });
  it.each(["user", "workspace", "role", "null-workspace"])("same-project %s switch removes dirty directions, metadata and stale review cache before fresh recovery", async mode => {
    mocks.real = true; mocks.get.mockResolvedValue(savedRun()); mocks.history.mockResolvedValue([savedRun()]);
    const view = renderPage(); await makeActualDirty(); expect(screen.getByTestId("plan-strategy")).toHaveTextContent("Scope A saved strategy");
    const oldJob = deferred<ReturnType<typeof savedRun>>(); mocks.get.mockReturnValueOnce(oldJob.promise);
    await act(async () => { void mocks.currentJob!.refetch(); });
    const oldActive = deferred<unknown>();
    void view.queryClient.fetchQuery({ queryKey: reviewKey("getActive"), queryFn: () => oldActive.promise }).catch(() => null);
    const oldReview = deferred<unknown[]>(); mocks.cores.mockReturnValueOnce(oldReview.promise);
    const stale = [{ coreId: "stale-core", sellingPointIndex: 0, buyerReason: "Old cached direction: Do not restore", status: "confirmed", id: 1, revision: 1, inputHash: "a".repeat(64), factRevisionIdsJson: [] }];
    view.queryClient.setQueryData(reviewKey("listCurrentCores"), stale);
    await act(async () => { void view.queryClient.invalidateQueries({ queryKey: reviewKey("listCurrentCores") }); });
    for (const name of ["listReviewedFacts", "listRawFactSuggestions", "listCandidates"]) view.queryClient.setQueryData(reviewKey(name), [{ private: "old" }]);
    view.queryClient.setQueryData(reviewKey("listCurrentCores", 8), stale);
    view.queryClient.setQueryData([["project", "getById"], { input: { id: 7 }, type: "query" }], { unrelated: "retained" });
    if (mode === "user") mocks.auth.user!.id = 2;
    if (mode === "workspace") mocks.auth.user!.defaultWorkspaceId = 11;
    if (mode === "role") mocks.auth.user!.role = "ops_specialist";
    if (mode === "null-workspace") mocks.auth.user!.defaultWorkspaceId = null;
    mocks.get.mockResolvedValue(null); mocks.history.mockResolvedValue([]); mocks.cores.mockResolvedValue([]);
    view.rerenderPage();
    expect(screen.queryByDisplayValue("Scope A private dirty direction")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.cores.mock.calls.length).toBeGreaterThanOrEqual(3));
    await act(async () => { oldReview.resolve(stale); oldJob.resolve(savedRun()); oldActive.resolve({ lockedSteps: "[1]", bulletPoints: '["Old private locked bullet"]' }); });
    expect(screen.queryByText("Preserved direction 2")).not.toBeInTheDocument(); expect(screen.queryByText(/Old cached direction/)).not.toBeInTheDocument();
    expect(screen.queryByText("Scope A saved strategy")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "确认事实与核心" })).not.toBeInTheDocument();
    for (const name of ["listCurrentCores", "listReviewedFacts", "listRawFactSuggestions", "listCandidates", "getActive"]) expect(view.queryClient.getQueryData(reviewKey(name))).toBeUndefined();
    expect(view.queryClient.getQueryData(reviewKey("listCurrentCores", 8))).toEqual(stale);
    expect(view.queryClient.getQueryData([["project", "getById"], { input: { id: 7 }, type: "query" }])).toEqual({ unrelated: "retained" });
    expect(mocks.queryPaths).not.toContain("listing.listCurrentCores"); expect(mocks.queryPaths).not.toContain("listing.listReviewedFacts");
  });
  it("same-owner background auth refresh and review invalidation retain the real dirty draft", async () => {
    mocks.real = true; mocks.get.mockResolvedValue(savedRun()); mocks.history.mockResolvedValue([savedRun()]);
    const view = renderPage(); await makeActualDirty();
    mocks.auth.loading = true; view.rerenderPage(); expect(screen.getByDisplayValue("Scope A private dirty direction")).not.toBeVisible();
    mocks.auth.loading = false; view.rerenderPage();
    await waitFor(() => expect(screen.getByDisplayValue("Scope A private dirty direction")).toBeVisible());
    const count = mocks.cores.mock.calls.length;
    view.queryClient.setQueryData(reviewKey("listCurrentCores"), []);
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: reviewKey("listCurrentCores") }); });
    await waitFor(() => expect(mocks.cores.mock.calls.length).toBeGreaterThan(count));
    expect(screen.getByDisplayValue("Scope A private dirty direction")).toHaveValue("Scope A private dirty direction");
    expect(screen.getByTestId("plan-strategy")).toHaveTextContent("Scope A saved strategy");
    const after = mocks.cores.mock.calls.length;
    view.queryClient.setQueryData(reviewKey("listCurrentCores", 8), []);
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: reviewKey("listCurrentCores", 8) }); });
    expect(mocks.cores).toHaveBeenCalledTimes(after); expect(mocks.start).not.toHaveBeenCalled();
  });
});
afterEach(cleanup);
const generate = () => screen.getByRole("button", { name: "Step 1: 生成7条卖点核心方向" });
function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const tree = () => <QueryClientProvider client={queryClient}><GeneratePage /></QueryClientProvider>;
  const view = render(tree()); return { ...view, queryClient, rerenderPage: () => view.rerender(tree()) };
}

describe("Generate research selection wiring", () => {
  it("does not prepare, clear or start the existing seven-direction draft until the scope is explicitly confirmed", async () => {
    renderPage(); await screen.findByText(/Scoped competitor/);
    fireEvent.click(generate()); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.edit).not.toHaveBeenCalled(); expect(mocks.markDirty).not.toHaveBeenCalled();
    expect(screen.getByText("Preserved direction 1")).toBeInTheDocument(); expect(screen.getByText("Preserved profile source entry")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择竞品研究 B000000010" }));
    fireEvent.click(generate()); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认使用所选 1 条研究" }));
    await act(async () => fireEvent.click(generate()));
    expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith({ emphasis: undefined, analysisIds: [10] });
  });
  it("requires explicit empty confirmation and does not dispatch twice while a request is unresolved", async () => {
    let resolve!: (value: unknown) => void; mocks.start.mockReturnValue(new Promise(yes => { resolve = yes; }));
    renderPage(); await screen.findByText(/Scoped competitor/);
    fireEvent.click(screen.getByRole("button", { name: "确认不使用竞品" })); fireEvent.click(generate()); fireEvent.click(generate());
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith({ emphasis: undefined, analysisIds: [] });
    await act(async () => resolve({ runId: "new-run" }));
  });
  it("preserves the flag-off legacy payload and displays server-derived actual scope instead of a local checkbox", async () => {
    mocks.enabled = false; mocks.run = { projectId: 7, workspaceId: 9, status: "succeeded", input: {}, output: { researchSelection: {
      version: 1, projectId: 7, workspaceId: 9, mode: "legacy_all", analysisIds: [99], sourceHash: "a".repeat(64), analyzedAsins: ["B000000099"],
    } } };
    renderPage(); expect(screen.queryByRole("region", { name: "卖点生成竞品范围" })).not.toBeInTheDocument(); expect(mocks.list).not.toHaveBeenCalled();
    expect(screen.getByText("研究 ID：99")).toBeInTheDocument(); expect(screen.getByText("实际 ASIN：B000000099")).toBeInTheDocument();
    await act(async () => fireEvent.click(generate())); expect(mocks.start).toHaveBeenCalledWith({ emphasis: undefined });
    expect(mocks.start.mock.calls[0][0]).not.toHaveProperty("analysisIds");
  });
});
