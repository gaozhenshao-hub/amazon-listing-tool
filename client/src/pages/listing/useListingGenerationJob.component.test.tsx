// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListingGenerationJob } from "./useListingGenerationJob";

const mocks = vi.hoisted(() => {
  const get = vi.fn(), history = vi.fn();
  return { get, history, start: vi.fn(), cancel: vi.fn(), succeeded: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, options: [] as unknown[],
    client: { listing: { getGenerationRun: { query: get }, listGenerationRuns: { query: history } } },
    auth: { user: { id: 1, role: "admin", defaultWorkspaceId: 9 } as { id: number; role: string; defaultWorkspaceId: number | null | undefined } | null, loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ client: mocks.client }),
  listing: { startGenerationJob: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.start }; } },
    cancelGenerationJob: { useMutation: (options: unknown) => { mocks.options.push(options); return { mutateAsync: mocks.cancel }; } } },
} }));
const job = (patch: Record<string, unknown> = {}) => ({ runId: "run-1", module: "listing", userId: 1, workspaceId: 9, projectId: 7,
  status: "queued", input: { projectId: 7, nodeId: "G1", operation: "sellingPoints", scopeKey: "main" }, output: null, ...patch });
const hookInput = (projectId = 7) => ({ projectId, nodeId: "G1" as const, operation: "sellingPoints" as const, includeHistory: true, onSucceeded: mocks.succeeded });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.options.length = 0; mocks.auth = { user: { id: 1, role: "admin", defaultWorkspaceId: 9 }, loading: false, error: null };
  mocks.get.mockResolvedValue(null); mocks.history.mockResolvedValue([]); mocks.start.mockResolvedValue(job()); mocks.cancel.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("owned Listing task recovery and writes", () => {
  it("reads fresh run/history with expected workspace and preserves successful task recovery exactly once", async () => {
    const complete = job({ status: "succeeded", output: { sellingPoints: [{ theme: "saved" }] } }); mocks.get.mockResolvedValue(complete); mocks.history.mockResolvedValue([complete]);
    const { result } = renderHook(() => useListingGenerationJob(hookInput())); await waitFor(() => expect(result.current.isLoadingRun).toBe(false));
    expect(mocks.get).toHaveBeenCalledWith({ projectId: 7, nodeId: "G1", scopeKey: "main", expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    expect(mocks.history).toHaveBeenCalledWith({ projectId: 7, nodeId: "G1", expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    expect(mocks.succeeded).toHaveBeenCalledTimes(1); expect(result.current.history).toEqual([complete]);
    await act(async () => { await result.current.refetch(); }); expect(mocks.succeeded).toHaveBeenCalledTimes(1);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("retains old batch/main recovery for downstream nodes", async () => {
    const complete = job({ status: "succeeded", input: { projectId: 7, nodeId: "G1", operation: "batch", scopeKey: "main" }, output: { title: "old saved title" } });
    mocks.get.mockResolvedValue(complete);
    const { result } = renderHook(() => useListingGenerationJob({ projectId: 7, nodeId: "G2", operation: "title", onSucceeded: mocks.succeeded }));
    await waitFor(() => expect(result.current.isLoadingRun).toBe(false)); expect(mocks.succeeded).toHaveBeenCalledWith(complete.output, complete);
    expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("preserves a server-bound explicit empty array, disables automatic retries, and blocks synchronous double start", async () => {
    const pending = deferred<ReturnType<typeof job>>(); mocks.start.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useListingGenerationJob(hookInput())); await waitFor(() => expect(result.current.isLoadingRun).toBe(false));
    let first!: Promise<unknown>; act(() => { first = result.current.start({ analysisIds: [], emphasis: "" }); });
    await act(async () => { expect(await result.current.start({ analysisIds: [] })).toBeNull(); });
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.start).toHaveBeenCalledWith({ analysisIds: [], emphasis: "", projectId: 7, nodeId: "G1", operation: "sellingPoints", scopeKey: "main", expectedWorkspaceId: 9 });
    await act(async () => { pending.resolve(job()); await first; });
    expect(mocks.options.every(value => (value as { retry: boolean }).retry === false)).toBe(true);
  });
  it.each(["projectId", "nodeId", "operation", "scopeKey", "workspaceId", "userId", "expectedWorkspaceId", "agentRunId", "agentNodeId", "researchBinding", "distillationBinding"])("rejects payload authority override %s before a write", async key => {
    const { result } = renderHook(() => useListingGenerationJob(hookInput())); await waitFor(() => expect(result.current.isLoadingRun).toBe(false));
    await act(async () => { expect(await result.current.start({ [key]: "forged" })).toBeNull(); });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([{ ids: [1, 1] }, { ids: [0] }, { ids: [-1] }, { ids: [1.5] }, { ids: [Number.MAX_SAFE_INTEGER + 1] },
    { ids: Array.from({ length: 1001 }, (_, index) => index + 1) }])("rejects invalid analysis IDs %j without dispatch", async ({ ids }) => {
    const { result } = renderHook(() => useListingGenerationJob(hookInput())); await waitFor(() => expect(result.current.isLoadingRun).toBe(false));
    await act(async () => { expect(await result.current.start({ analysisIds: ids })).toBeNull(); }); expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["user", "workspace", "role", "project", "away-and-back"])("late start from old %s scope cannot mutate or toast in the current scope", async mode => {
    const pending = deferred<ReturnType<typeof job>>(); mocks.start.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ projectId }) => useListingGenerationJob(hookInput(projectId)), { initialProps: { projectId: 7 } });
    await waitFor(() => expect(result.current.isLoadingRun).toBe(false)); let first!: Promise<unknown>;
    act(() => { first = result.current.start({ analysisIds: [] }); });
    if (mode === "user") mocks.auth.user!.id = 2;
    if (mode === "workspace") mocks.auth.user!.defaultWorkspaceId = 11;
    if (mode === "role") mocks.auth.user!.role = "ops_specialist";
    rerender({ projectId: mode === "project" || mode === "away-and-back" ? 8 : 7 });
    if (mode === "away-and-back") rerender({ projectId: 7 });
    await waitFor(() => expect(result.current.isLoadingRun).toBe(false)); const reads = mocks.get.mock.calls.length;
    await act(async () => { pending.resolve(job({ status: "succeeded", output: { secret: "old" } })); expect(await first).toBeNull(); });
    expect(result.current.run).toBeNull(); expect(mocks.succeeded).not.toHaveBeenCalled(); expect(mocks.get).toHaveBeenCalledTimes(reads);
    expect(result.current.isStarting).toBe(false); expect(result.current.isCanceling).toBe(false);
    expect(mocks.toast.success).not.toHaveBeenCalled(); expect(mocks.toast.error).not.toHaveBeenCalled();
  });
  it("late history/read replies cannot restore after identity switches", async () => {
    const old = deferred<ReturnType<typeof job> | null>(), oldHistory = deferred<ReturnType<typeof job>[]>();
    mocks.get.mockReturnValueOnce(old.promise); mocks.history.mockReturnValueOnce(oldHistory.promise);
    const { result, rerender } = renderHook(() => useListingGenerationJob(hookInput()));
    mocks.auth.user!.id = 2; rerender(); await waitFor(() => expect(result.current.isLoadingRun).toBe(false));
    await act(async () => { const value = job({ status: "succeeded", output: { secret: "old" } }); old.resolve(value); oldHistory.resolve([value]); });
    expect(result.current.run).toBeNull(); expect(result.current.history).toEqual([]); expect(mocks.succeeded).not.toHaveBeenCalled();
  });
  it.each([{ userId: 2 }, { workspaceId: 11 }, { projectId: 8 }, { input: { projectId: 7, nodeId: "G1", operation: "singleBullet", scopeKey: "bullet-0" } }])("refuses a cross-scope successful task %j", async patch => {
    mocks.get.mockResolvedValue(job({ ...patch, status: "succeeded", output: { secret: "foreign" } }));
    const { result } = renderHook(() => useListingGenerationJob(hookInput())); await waitFor(() => expect(result.current.isLoadingRun).toBe(false));
    expect(result.current.run).toBeNull(); expect(result.current.readError).toBe(true); expect(mocks.succeeded).not.toHaveBeenCalled();
  });
  it("uses explicit NULL workspace on reads/start/cancel while undefined/anonymous contexts do no I/O", async () => {
    mocks.auth.user!.defaultWorkspaceId = null; mocks.start.mockResolvedValue(job({ workspaceId: null }));
    const { result, rerender } = renderHook(() => useListingGenerationJob(hookInput())); await waitFor(() => expect(result.current.isLoadingRun).toBe(false));
    await act(async () => { await result.current.start(); }); await act(async () => { await result.current.cancel(); });
    expect(mocks.get.mock.calls[0][0].expectedWorkspaceId).toBeNull(); expect(mocks.start.mock.calls[0][0].expectedWorkspaceId).toBeNull(); expect(mocks.cancel.mock.calls[0][0].expectedWorkspaceId).toBeNull();
    const reads = mocks.get.mock.calls.length; mocks.auth.user!.defaultWorkspaceId = undefined; rerender();
    await act(async () => { expect(await result.current.start()).toBeNull(); }); expect(mocks.get).toHaveBeenCalledTimes(reads);
    mocks.auth.user = null; rerender(); expect(result.current.run).toBeNull(); expect(mocks.get).toHaveBeenCalledTimes(reads);
  });
  it.each(["FORBIDDEN", "PRECONDITION_FAILED"])("keeps the last run on transport failure, but clears it on permission/workspace error %s", async code => {
    mocks.get.mockResolvedValue(job({ status: "succeeded", output: {} }));
    const { result } = renderHook(() => useListingGenerationJob(hookInput())); await waitFor(() => expect(result.current.isLoadingRun).toBe(false));
    mocks.get.mockRejectedValue(new Error("network")); await act(async () => { await result.current.refetch(); });
    expect(result.current.run?.runId).toBe("run-1"); expect(result.current.readError).toBe(true);
    mocks.get.mockRejectedValue({ data: { code } }); await act(async () => { await result.current.refetch(); });
    expect(result.current.run).toBeNull(); expect(result.current.history).toEqual([]);
  });
  it("polls an existing active task to successful recovery without creating another job", async () => {
    vi.useFakeTimers();
    const queued = job(), complete = job({ status: "succeeded", output: { sellingPoints: [{ theme: "saved" }] } });
    mocks.get.mockResolvedValueOnce(queued).mockResolvedValue(complete);
    const { result } = renderHook(() => useListingGenerationJob(hookInput()));
    await act(async () => {}); expect(result.current.run?.status).toBe("queued"); expect(result.current.isGenerating).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.run?.status).toBe("succeeded"); expect(mocks.succeeded).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.get).toHaveBeenCalledTimes(2); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("StrictMode aborts the old read generation and recovers the latest successful run only once", async () => {
    const complete = job({ status: "succeeded", output: { sellingPoints: [{ theme: "saved" }] } }); mocks.get.mockResolvedValue(complete);
    const { result } = renderHook(() => useListingGenerationJob(hookInput()), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.isLoadingRun).toBe(false)); expect(result.current.run?.runId).toBe("run-1");
    expect(mocks.get.mock.calls.length).toBeGreaterThanOrEqual(2); expect(mocks.succeeded).toHaveBeenCalledTimes(1); expect(mocks.start).not.toHaveBeenCalled();
  });
});
