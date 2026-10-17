// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompetitorDeepResultReader from "./CompetitorDeepResultReader";

const state = vi.hoisted(() => {
  const query = vi.fn(), parse = vi.fn();
  return { query, parse, client: { analysis: { getCompetitorDeepResult: { query } } },
    auth: { user: { id: 1, defaultWorkspaceId: 9, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null,
      loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: state.client }) } }));
// Container tests isolate request ownership/lifecycle. The real parser and panel
// have independent contract/rendering suites and are not verified by this mock.
vi.mock("./competitorDeepResultView", () => ({ parseCompetitorDeepResultView: state.parse }));
vi.mock("./CompetitorDeepResultPanel", () => ({ default: ({ view }: { view: unknown }) => <div data-testid="deep-panel">{JSON.stringify(view)}</div> }));
const props = { projectId: 7, analysisId: 3, asin: "B000000003", revision: "a".repeat(64) };
const response = { status: "available", sourceChanged: true, reviewRequired: true, result: { label: "verified historical original" } };
const click = () => fireEvent.click(screen.getByRole("button", { name: "查看已保存的四栏结果" }));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  state.query.mockReset().mockResolvedValue(response); state.parse.mockReset().mockImplementation(value => value);
  state.auth.user = { id: 1, defaultWorkspaceId: 9, role: "admin" }; state.auth.loading = false; state.auth.error = null;
});
afterEach(cleanup);

describe("explicit saved four-column read, never generation", () => {
  it("makes no mount/StrictMode request and binds exact row version on explicit read", async () => {
    render(<StrictMode><CompetitorDeepResultReader {...props} /></StrictMode>);
    expect(state.query).not.toHaveBeenCalled(); expect(state.parse).not.toHaveBeenCalled(); click();
    expect(await screen.findByTestId("deep-panel")).toHaveTextContent("verified historical original");
    expect(state.query).toHaveBeenCalledOnce();
    expect(state.query.mock.calls[0][0]).toEqual({ projectId: 7, analysisId: 3, expectedWorkspaceId: 9, expectedRevision: props.revision });
    expect(state.query.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(state.parse).toHaveBeenCalledWith(response, { userId: 1, workspaceId: 9, ...props });
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("clears prior data before refresh and suppresses double click without polling/retry", async () => {
    render(<CompetitorDeepResultReader {...props} />); click(); await screen.findByTestId("deep-panel");
    const next = deferred<unknown>(); state.query.mockReturnValueOnce(next.promise); click(); click();
    expect(screen.queryByTestId("deep-panel")).not.toBeInTheDocument(); expect(state.query).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button")).toBeDisabled();
    await act(async () => next.resolve(response)); expect(screen.getByRole("button")).toBeEnabled();
  });
  it("distinguishes no saved result from success, failure, empty review corpus or a new analysis", async () => {
    state.query.mockResolvedValueOnce({ status: "not_available", sourceChanged: false, reviewRequired: true });
    render(<CompetitorDeepResultReader {...props} />); click();
    expect(await screen.findByText(/没有可核验的已保存四栏结果/)).toBeInTheDocument();
    expect(screen.queryByTestId("deep-panel")).not.toBeInTheDocument(); expect(state.query).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toMatch(/0 条|排队中|分析成功/);
  });
  it.each(["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED", "INTERNAL_SERVER_ERROR"])("hides prior private text on %s without reflecting backend details", async code => {
    render(<CompetitorDeepResultReader {...props} />); click(); await screen.findByTestId("deep-panel");
    state.query.mockRejectedValueOnce({ data: { code }, message: "PRIVATE source filename and text" }); click();
    expect(await screen.findByRole("alert")).toHaveTextContent("旧显示已隐藏");
    expect(screen.queryByTestId("deep-panel")).not.toBeInTheDocument(); expect(document.body.textContent).not.toContain("PRIVATE");
    expect(state.query).toHaveBeenCalledTimes(2);
  });
  it("does not render a response rejected by the real-parser boundary", async () => {
    state.parse.mockImplementationOnce(() => { throw new Error("PRIVATE malformed body"); });
    render(<CompetitorDeepResultReader {...props} />); click(); await screen.findByRole("alert");
    expect(screen.queryByTestId("deep-panel")).not.toBeInTheDocument(); expect(document.body.textContent).not.toContain("PRIVATE");
  });
  it("passes an explicit NULL workspace, not an omitted or invented default", async () => {
    state.auth.user!.defaultWorkspaceId = null; render(<CompetitorDeepResultReader {...props} />); click(); await screen.findByTestId("deep-panel");
    expect(state.query.mock.calls[0][0].expectedWorkspaceId).toBeNull();
    expect(state.parse.mock.calls[0][1].workspaceId).toBeNull();
  });
});

describe("saved result owner isolation and stale asynchronous responses", () => {
  it.each(["user", "workspace", "role", "project", "analysis", "asin", "revision"])("clears and ignores an old %s scope response", async kind => {
    const pending = deferred<unknown>(); state.query.mockReturnValueOnce(pending.promise);
    const view = render(<CompetitorDeepResultReader {...props} />); click();
    const oldSignal = state.query.mock.calls[0][1].signal as AbortSignal;
    const changed = { ...props };
    if (kind === "user") state.auth.user!.id = 2;
    if (kind === "workspace") state.auth.user!.defaultWorkspaceId = 10;
    if (kind === "role") state.auth.user!.role = "ops_specialist";
    if (kind === "project") changed.projectId = 8;
    if (kind === "analysis") changed.analysisId = 4;
    if (kind === "asin") changed.asin = "B000000004";
    if (kind === "revision") changed.revision = "b".repeat(64);
    view.rerender(<CompetitorDeepResultReader {...changed} />);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => pending.resolve(response));
    expect(state.parse).not.toHaveBeenCalled(); expect(screen.queryByTestId("deep-panel")).not.toBeInTheDocument();
    expect(state.query).toHaveBeenCalledOnce();
    click(); await screen.findByTestId("deep-panel"); expect(state.query).toHaveBeenCalledTimes(2);
  });
  it("hides already displayed data on authentication uncertainty and does not restore it on returning", async () => {
    const view = render(<CompetitorDeepResultReader {...props} />); click(); await screen.findByTestId("deep-panel");
    state.auth.loading = true; view.rerender(<CompetitorDeepResultReader {...props} />);
    expect(screen.queryByTestId("deep-panel")).not.toBeInTheDocument();
    state.auth.loading = false; view.rerender(<CompetitorDeepResultReader {...props} />);
    expect(screen.queryByTestId("deep-panel")).not.toBeInTheDocument(); expect(state.query).toHaveBeenCalledOnce();
  });
  it("does not revive a pending A result after A→B→A", async () => {
    const pending = deferred<unknown>(); state.query.mockReturnValueOnce(pending.promise);
    const view = render(<CompetitorDeepResultReader {...props} />); click();
    state.auth.user!.id = 2; view.rerender(<CompetitorDeepResultReader {...props} />);
    state.auth.user!.id = 1; view.rerender(<CompetitorDeepResultReader {...props} />);
    await act(async () => pending.resolve(response));
    expect(state.parse).not.toHaveBeenCalled(); expect(screen.queryByTestId("deep-panel")).not.toBeInTheDocument();
  });
  it("aborts on unmount and ignores a transport that nevertheless resolves", async () => {
    const pending = deferred<unknown>(); state.query.mockReturnValueOnce(pending.promise);
    const view = render(<CompetitorDeepResultReader {...props} />); click(); view.unmount();
    expect(state.query.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => pending.resolve(response)); expect(state.parse).not.toHaveBeenCalled();
  });
  it.each(["loading", "authError", "noUser", "noWorkspace", "badWorkspace", "noRole", "badUser"])("makes no request while %s", kind => {
    if (kind === "loading") state.auth.loading = true;
    if (kind === "authError") state.auth.error = new Error("PRIVATE auth error");
    if (kind === "noUser") state.auth.user = null;
    if (kind === "noWorkspace") state.auth.user!.defaultWorkspaceId = undefined;
    if (kind === "badWorkspace") state.auth.user!.defaultWorkspaceId = -1;
    if (kind === "noRole") state.auth.user!.role = "";
    if (kind === "badUser") state.auth.user!.id = 0;
    render(<CompetitorDeepResultReader {...props} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(state.query).not.toHaveBeenCalled();
  });
  it.each([{ projectId: 0 }, { analysisId: 0 }, { analysisId: NaN }, { asin: "invalid" }, { revision: "old" }])("makes no request for invalid props %j", patch => {
    render(<CompetitorDeepResultReader {...props} {...patch} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(state.query).not.toHaveBeenCalled();
  });
});
