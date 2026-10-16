// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ListingResearchSelection, { ListingResearchRunSummary, useListingResearchSelection } from "./ListingResearchSelection";
import { actualResearchSelection, confirmedResearchPayload, listingOwnerKey, listingRequestOwner } from "./listingResearchSelectionState";

const mocks = vi.hoisted(() => {
  const list = vi.fn();
  return { list, client: { analysis: { listByProject: { query: list } } },
    auth: { user: { id: 1, defaultWorkspaceId: 9, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null,
      loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: mocks.client }) } }));
const rows = [{ id: 10, projectId: 7, asin: "B000000010", title: "Research Alpha", summaryStatus: "draft" },
  { id: 20, projectId: 7, asin: "B000000020", title: "Research Beta", summaryStatus: "confirmed" }];
const binding = { version: 1, projectId: 7, workspaceId: 9, mode: "explicit", analysisIds: [20], sourceHash: "a".repeat(64) };
function Harness({ projectId = 7, enabled = true, disabled = false }) {
  const selection = useListingResearchSelection(projectId, enabled);
  return <><ListingResearchSelection selection={selection} disabled={disabled} /><output data-testid="payload">{JSON.stringify(selection.payload)}</output></>;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { vi.clearAllMocks(); mocks.auth = { user: { id: 1, defaultWorkspaceId: 9, role: "admin" }, loading: false, error: null }; mocks.list.mockResolvedValue(rows); });
afterEach(cleanup);

describe("explicit Listing research scope", () => {
  it("uses a fresh workspace-bound read, defaults to no confirmation, and requires a separate empty-selection confirmation", async () => {
    render(<Harness />); await screen.findByText(/Research Alpha/);
    expect(mocks.list).toHaveBeenCalledWith({ projectId: 7, expectedWorkspaceId: 9 }, { signal: expect.any(AbortSignal) });
    expect(screen.getByTestId("payload")).toHaveTextContent("null");
    expect(screen.getByRole("checkbox", { name: "选择竞品研究 B000000010" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "确认不使用竞品" }));
    expect(screen.getByTestId("payload")).toHaveTextContent('{"analysisIds":[]}');
    expect(screen.getByText(/已确认下一次不使用竞品/)).toBeInTheDocument();
  });
  it("sends only explicitly confirmed IDs; any checkbox change or reread revokes confirmation", async () => {
    render(<Harness />); await screen.findByText(/Research Alpha/);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择竞品研究 B000000020" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择竞品研究 B000000010" }));
    expect(screen.getByTestId("payload")).toHaveTextContent("null");
    fireEvent.click(screen.getByRole("button", { name: "确认使用所选 2 条研究" }));
    expect(screen.getByTestId("payload")).toHaveTextContent('{"analysisIds":[10,20]}');
    fireEvent.click(screen.getByRole("checkbox", { name: "选择竞品研究 B000000010" })); expect(screen.getByTestId("payload")).toHaveTextContent("null");
    fireEvent.click(screen.getByRole("button", { name: "确认使用所选 1 条研究" }));
    fireEvent.click(screen.getByRole("button", { name: "重新读取竞品研究" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); await screen.findByText(/Research Alpha/);
    expect(screen.getByTestId("payload")).toHaveTextContent("null"); expect(screen.getByRole("checkbox", { name: "选择竞品研究 B000000020" })).not.toBeChecked();
  });
  it("a disabled feature makes no private request and omits analysisIds for the legacy call", () => {
    render(<Harness enabled={false} />); expect(mocks.list).not.toHaveBeenCalled(); expect(screen.getByTestId("payload")).toHaveTextContent("{}");
  });
  it.each(["user", "role", "workspace", "null-workspace", "project"])("%s scope changes discard late records and old confirmation", async mode => {
    const old = deferred<typeof rows>(); mocks.list.mockReturnValueOnce(old.promise);
    const view = render(<StrictMode><Harness /></StrictMode>);
    if (mode === "user") mocks.auth.user!.id = 2;
    if (mode === "role") mocks.auth.user!.role = "ops_specialist";
    if (mode === "workspace") mocks.auth.user!.defaultWorkspaceId = 11;
    if (mode === "null-workspace") mocks.auth.user!.defaultWorkspaceId = null;
    mocks.list.mockResolvedValue(mode === "project" ? rows.map(row => ({ ...row, projectId: 8 })) : rows);
    view.rerender(<StrictMode><Harness projectId={mode === "project" ? 8 : 7} /></StrictMode>);
    await screen.findByText(/Research Alpha/);
    await act(async () => old.resolve([{ ...rows[0], title: "old scope secret" }]));
    expect(screen.queryByText(/old scope secret/)).not.toBeInTheDocument(); expect(screen.getByTestId("payload")).toHaveTextContent("null");
  });
  it("supports a legitimate null workspace but refuses undefined identities", async () => {
    mocks.auth.user!.defaultWorkspaceId = null; const view = render(<Harness />); await screen.findByText(/Research Alpha/);
    expect(mocks.list.mock.calls[0][0]).toEqual({ projectId: 7, expectedWorkspaceId: null });
    mocks.auth.user!.defaultWorkspaceId = undefined; view.rerender(<Harness />);
    expect(screen.queryByText(/Research Alpha/)).not.toBeInTheDocument(); expect(screen.getByTestId("payload")).toHaveTextContent("null");
  });
  it.each(["error", "foreign", "duplicate"])("%s directory is not usable or silently interpreted as empty", async kind => {
    if (kind === "error") mocks.list.mockRejectedValue(new Error("private diagnostic"));
    else mocks.list.mockResolvedValue(kind === "foreign" ? [{ ...rows[0], projectId: 8 }] : [rows[0], rows[0]]);
    render(<Harness />); await screen.findByText(/竞品研究读取失败/); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认不使用竞品" })).not.toBeInTheDocument(); expect(screen.getByTestId("payload")).toHaveTextContent("null");
  });
  it("disables editing and confirmation while the parent task is pending", async () => {
    render(<Harness disabled />); await screen.findByText(/Research Alpha/);
    expect(screen.getByRole("checkbox", { name: "选择竞品研究 B000000010" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "确认不使用竞品" })).toBeDisabled();
  });
});

describe("actual research receipts are not current checkboxes", () => {
  it("distinguishes frozen input from actual server output and displays actual IDs/ASINs", () => {
    const run = { projectId: 7, workspaceId: 9, status: "succeeded", input: { researchBinding: binding },
      output: { researchSelection: { ...binding, analyzedAsins: ["B000000020"] } } };
    const view = render(<ListingResearchRunSummary run={run} />);
    expect(screen.getByText(/本任务实际采用范围/)).toBeInTheDocument(); expect(screen.getByText("研究 ID：20")).toBeInTheDocument();
    expect(screen.getByText("实际 ASIN：B000000020")).toBeInTheDocument(); expect(screen.queryByText("研究 ID：10")).not.toBeInTheDocument();
    view.rerender(<ListingResearchRunSummary run={{ ...run, output: null }} />);
    expect(screen.getByText(/本任务已冻结范围/)).toBeInTheDocument(); expect(screen.getByText("研究 ID：20")).toBeInTheDocument();
    expect(screen.queryByText(/实际 ASIN/)).not.toBeInTheDocument();
  });
  it("never guesses an old or malformed receipt from current selection", () => {
    const view = render(<ListingResearchRunSummary run={{ projectId: 7, workspaceId: 9, output: {} }} />);
    expect(screen.getByText(/不能从当前勾选推断/)).toBeInTheDocument();
    view.rerender(<ListingResearchRunSummary run={{ projectId: 8, workspaceId: 9, input: { researchBinding: binding } }} />);
    expect(screen.getByText(/不能从当前勾选推断/)).toBeInTheDocument();
    view.rerender(<ListingResearchRunSummary run={{ projectId: 7, workspaceId: 9, status: "succeeded", input: { researchBinding: binding },
      output: { researchSelection: { ...binding, analysisIds: [10], analyzedAsins: ["B000000010"] } } }} />);
    expect(screen.getByText(/不能从当前勾选推断/)).toBeInTheDocument();
  });
  it("validates safe IDs and distinguishes empty explicit selection from legacy omission", () => {
    expect(confirmedResearchPayload(false, null)).toEqual({}); expect(confirmedResearchPayload(true, null)).toBeNull();
    expect(confirmedResearchPayload(true, [])).toEqual({ analysisIds: [] });
    for (const ids of [[1, 1], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array.from({ length: 1001 }, (_, index) => index + 1)]) expect(confirmedResearchPayload(true, ids)).toBeNull();
    expect(actualResearchSelection({ projectId: 7, workspaceId: 9, input: { researchBinding: { ...binding, analysisIds: [20, 10] } } })).toBeNull();
    expect(listingRequestOwner({ id: 1, role: "admin", defaultWorkspaceId: undefined }, 7)).toBeNull();
    expect(listingOwnerKey(listingRequestOwner({ id: 1, role: "admin", defaultWorkspaceId: null }, 7))).not.toBeNull();
  });
});
