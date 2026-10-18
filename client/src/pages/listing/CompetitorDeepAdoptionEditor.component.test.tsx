// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { competitorDeepAdoptionHash as hash, type CompetitorDeepAdoptionInput } from "@shared/competitorDeepAdoption";
import CompetitorDeepAdoptionEditor from "./CompetitorDeepAdoptionEditor";
import { deepAdoptionPendingKey, readDeepAdoptionPending, reserveDeepAdoptionPending } from "./competitorDeepAdoptionPending";
const state = vi.hoisted(() => ({ options: vi.fn(), submit: vi.fn(), check: vi.fn(), cancel: vi.fn(), parser: vi.fn(), saved: vi.fn(), dirty: vi.fn(),
  auth: { user: { id: 7, defaultWorkspaceId: 11 as number | null, role: "admin" }, loading: false, error: null as Error | null } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { analysis: { deepAdoptionOptions: { query: state.options },
  adoptDeepResult: { mutate: state.submit }, checkDeepAdoption: { query: state.check }, cancelDeepAdoption: { mutate: state.cancel } } } }) } }));
// The source-aware parser and complete pure Panel retain their separate suites.
vi.mock("./competitorDeepResultView", () => ({ parseCompetitorDeepResultView: state.parser }));
vi.mock("./CompetitorDeepResultPanel", () => ({ default: ({ view }: { view: { result: { summaryText: string } } }) => <article aria-label="完整四栏候选">{view.result.summaryText}</article> }));
const props = { projectId: 5, analysisId: 3, asin: "B000000003", revision: "a".repeat(64) };
const context = { userId: 7, workspaceId: 11, projectId: 5, analysisId: 3, asin: props.asin };
const candidate = () => ({ status: "available", currentRevision: props.revision, sourceChanged: false, result: { summaryText: "完整候选摘要",
  resultHash: "b".repeat(64), source: { jobRunId: "synthetic-job", evidenceHash: "c".repeat(64) } } });
const options = (available = true) => ({ candidate: candidate(), capability: { available, reasonCode: available ? null : "WRITES_DISABLED" }, currentAdoptionValid: false, activeAdoption: null, currentSummary: null as string | null });
function committed(input: CompetitorDeepAdoptionInput) {
  return { version: 1, identity: { userId: 7, workspaceId: 11 }, projectId: 5, analysisId: 3, jobRunId: input.jobRunId, operationId: input.operationId,
    status: "committed", requestHash: hash({ identity: { userId: 7, workspaceId: 11 }, request: input }), committedRevision: "d".repeat(64),
    ref: { version: 1, kind: "competitor_deep_adoption", artifactId: "deep_adopt_" + "e".repeat(64), operationId: input.operationId, jobRunId: input.jobRunId,
      resultHash: input.expectedResultHash, evidenceHash: input.expectedEvidenceHash, sourceFingerprint: "f".repeat(64), projectionHash: "f".repeat(64),
      summaryHash: hash(input.summary), summaryVersion: 2, adoptedBy: 7, adoptedAt: "2026-10-19T01:00:00.000Z" }, reasonCode: null,
    currentRevision: "d".repeat(64), currentActive: true };
}
function terminal(status: "unknown" | "cancelled") { const operation = readDeepAdoptionPending(context)!.operation;
  return { version: 1, identity: { userId: 7, workspaceId: 11 }, projectId: 5, analysisId: 3, jobRunId: operation.jobRunId, operationId: operation.operationId,
    status, requestHash: null, ref: null, committedRevision: null, currentRevision: null, currentActive: false, reasonCode: status === "unknown" ? "OPERATION_UNKNOWN" : "OPERATION_CANCELLED" }; }
const mount = (patch = {}) => render(<CompetitorDeepAdoptionEditor {...props} {...patch} onAdopted={state.saved} onDirtyChange={state.dirty} />);
async function open() { fireEvent.click(screen.getByRole("button", { name: "审阅并采纳四栏候选" })); await screen.findByRole("textbox", { name: "人工正式摘要" }); }
function edit() { fireEvent.change(screen.getByRole("textbox", { name: "人工正式摘要" }), { target: { value: "人工核对的私有摘要" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /我已核对标题/ })); }
const save = () => fireEvent.click(screen.getByRole("button", { name: "确认并保存正式研究" }));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state.auth = { user: { id: 7, defaultWorkspaceId: 11, role: "admin" }, loading: false, error: null };
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, work) => work()) } });
  state.options.mockReset().mockResolvedValue(options()); state.parser.mockReset().mockImplementation(value => value);
  state.submit.mockReset().mockImplementation(input => Promise.resolve(committed(input))); state.check.mockReset(); state.cancel.mockReset();
  state.saved.mockResolvedValue(undefined); vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("explicit source-bound human adoption", () => {
  it("does no IO on mount and requires explicit source acknowledgement before one no-model save", async () => {
    mount(); expect(state.options).not.toHaveBeenCalled(); expect(state.submit).not.toHaveBeenCalled(); await open();
    expect(state.options).toHaveBeenCalledWith({ projectId: 5, analysisId: 3, expectedWorkspaceId: 11, expectedRevision: props.revision }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole("button", { name: "确认并保存正式研究" })).toBeDisabled(); edit(); save(); save();
    await waitFor(() => expect(state.saved).toHaveBeenCalledOnce()); expect(state.submit).toHaveBeenCalledOnce();
    expect(state.submit.mock.calls[0][0]).toMatchObject({ expectedRevision: props.revision, expectedResultHash: "b".repeat(64), expectedEvidenceHash: "c".repeat(64), summary: "人工核对的私有摘要", confirmLimitations: true });
    expect(readDeepAdoptionPending(context)).toBeNull(); expect(state.check).not.toHaveBeenCalled();
  });
  it("default-off retains full review but cannot write", async () => {
    state.options.mockResolvedValue(options(false)); mount(); await open(); edit(); expect(screen.getByRole("article", { name: "完整四栏候选" })).toBeInTheDocument();
    expect(screen.getByText(/人工采纳写入尚未启用/)).toBeInTheDocument(); save(); expect(state.submit).not.toHaveBeenCalled();
  });
  it("prefers the current human summary over the AI candidate on first review and after explicitly discarding a local draft", async () => {
    const value = options(); value.currentSummary = "  已保存的人工摘要\n保留人工原文  "; state.options.mockResolvedValue(value);
    mount(); await open(); expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue(value.currentSummary);
    expect(screen.getByRole("article", { name: "完整四栏候选" })).toHaveTextContent("完整候选摘要");
    edit(); fireEvent.click(screen.getByRole("button", { name: /^关闭$/ })); expect(window.confirm).toHaveBeenCalledOnce();
    await open(); expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue(value.currentSummary);
    expect(state.submit).not.toHaveBeenCalled();
  });
  it("does not replace an unsent local draft with a newly read current human summary", async () => {
    mount(); await open(); edit(); const value = options(); value.currentSummary = "服务端后来保存的人工摘要"; state.options.mockResolvedValue(value);
    fireEvent.click(screen.getByRole("button", { name: "重新读取采纳依据" })); await screen.findByRole("button", { name: "采用此读取版本，保留人工摘要" });
    expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要");
    fireEvent.click(screen.getByRole("button", { name: "采用此读取版本，保留人工摘要" }));
    expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要"); expect(state.submit).not.toHaveBeenCalled();
  });
  it("preserves a historical summary longer than the submission limit without truncation or AI replacement", async () => {
    const value = options(); value.currentSummary = "文".repeat(20_001); state.options.mockResolvedValue(value); mount(); await open();
    expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue(value.currentSummary);
    fireEvent.click(screen.getByRole("checkbox", { name: /我已核对标题/ })); expect(screen.getByRole("button", { name: "确认并保存正式研究" })).toBeDisabled();
    expect(screen.getByText(/超过 20,000 字提交上限/)).toBeInTheDocument(); expect(state.submit).not.toHaveBeenCalled();
  });
  it("server capability permits a verified same-candidate re-adoption despite publication sourceChanged", async () => {
    const value = options(); value.candidate.sourceChanged = true; state.options.mockResolvedValue(value); mount(); await open(); edit(); save();
    await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
  });
  it("after unlock/edit a fresh server-approved same candidate can be adopted with a new UUID without generation", async () => {
    const view = mount(); await open(); edit(); save(); await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
    const original = state.submit.mock.calls[0][0], revision = "f".repeat(64); view.rerender(<CompetitorDeepAdoptionEditor {...props} revision={revision} onAdopted={state.saved} />);
    const updated = { ...options(), currentAdoptionValid: false, activeAdoption: null, currentSummary: "解锁后重新编辑的人工摘要" };
    updated.candidate.currentRevision = revision; updated.candidate.sourceChanged = true; expect(updated.capability.available).toBe(true); state.options.mockResolvedValue(updated);
    await open(); expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue(updated.currentSummary);
    fireEvent.click(screen.getByRole("checkbox", { name: /我已核对标题/ })); save(); await waitFor(() => expect(state.saved).toHaveBeenCalledTimes(2));
    const next = state.submit.mock.calls[1][0]; expect(next.operationId).not.toBe(original.operationId); expect(next.jobRunId).toBe(original.jobRunId);
    expect(next.expectedRevision).toBe(revision); expect(next.summary).toBe(updated.currentSummary); expect(readDeepAdoptionPending(context)).toBeNull();
  });
  it("lost ACK persists metadata only and restores by the same UUID even when writes are disabled", async () => {
    state.submit.mockRejectedValueOnce(new Error("lost ACK")); const view = mount(); await open(); edit(); save(); await screen.findByText(/结果尚未核验/);
    const input = state.submit.mock.calls[0][0], stored = localStorage.getItem(deepAdoptionPendingKey(context))!;
    expect(stored).not.toContain("人工核对的私有摘要"); expect(readDeepAdoptionPending(context)?.operation.operationId).toBe(input.operationId);
    view.unmount(); state.options.mockResolvedValue(options(false)); state.check.mockResolvedValue(committed(input)); mount();
    fireEvent.click(screen.getByRole("button", { name: "核对原采纳请求" })); await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
    expect(state.submit).toHaveBeenCalledOnce(); expect(state.check.mock.calls[0][0]).toMatchObject({ operationId: input.operationId, jobRunId: input.jobRunId }); expect(readDeepAdoptionPending(context)).toBeNull();
  });
  it("unknown is retained until explicit acknowledged cancellation, without another submit", async () => {
    state.submit.mockRejectedValueOnce(new Error("lost ACK")); mount(); await open(); edit(); save(); await screen.findByText(/结果尚未核验/);
    state.check.mockImplementation(() => Promise.resolve(terminal("unknown"))); fireEvent.click(screen.getByRole("button", { name: "核对原采纳请求" })); await screen.findByText(/原采纳请求结果未知/);
    expect(readDeepAdoptionPending(context)).not.toBeNull(); state.cancel.mockImplementation(() => Promise.resolve(terminal("cancelled")));
    fireEvent.click(screen.getByRole("checkbox", { name: /确认取消此原请求/ })); fireEvent.click(screen.getByRole("button", { name: "取消原采纳请求" })); await screen.findByText(/原采纳请求已确认取消/);
    expect(readDeepAdoptionPending(context)).toBeNull(); expect(state.submit).toHaveBeenCalledOnce(); expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要");
  });
  it("a foreign-tab UUID swap cannot inherit old cancel confirmation or be canceled by the old UI", async () => {
    state.submit.mockRejectedValueOnce(new Error("lost ACK")); mount(); await open(); edit(); save(); await screen.findByText(/结果尚未核验/);
    fireEvent.click(screen.getByRole("checkbox", { name: /确认取消此原请求/ }));
    const original = readDeepAdoptionPending(context)!;
    // Replace storage before its browser StorageEvent arrives: action-time comparison is still required.
    const other = { ...original, operation: { ...original.operation, operationId: "22222222-2222-4222-8222-222222222222" } };
    const originalRaw = localStorage.getItem(deepAdoptionPendingKey(context))!;
    localStorage.setItem(deepAdoptionPendingKey(context), originalRaw.replace(original.operation.operationId, other.operation.operationId));
    fireEvent.click(screen.getByRole("button", { name: "取消原采纳请求" })); await waitFor(() => expect(screen.getByRole("button", { name: "取消原采纳请求" })).toBeEnabled());
    expect(state.cancel).not.toHaveBeenCalled(); expect(readDeepAdoptionPending(context)?.operation.operationId).toBe(other.operation.operationId);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: deepAdoptionPendingKey(context) })));
    expect(screen.getByRole("button", { name: "取消原采纳请求" })).toBeDisabled(); expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要");
  });
  it("a foreign completed operation refreshes sources but does not clear this component's unsent draft", async () => {
    mount(); await open(); edit();
    const input = { projectId: 5, analysisId: 3, expectedWorkspaceId: 11, jobRunId: "synthetic-job", operationId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: props.revision, expectedResultHash: "b".repeat(64), expectedEvidenceHash: "c".repeat(64), summary: "另一窗口提交", confirmLimitations: true as const };
    act(() => reserveDeepAdoptionPending(context, { version: 1, context,
      operation: { projectId: 5, analysisId: 3, expectedWorkspaceId: 11, jobRunId: input.jobRunId, operationId: input.operationId }, expectedRevision: props.revision,
      expectedResultHash: input.expectedResultHash, expectedEvidenceHash: input.expectedEvidenceHash, summaryHash: hash(input.summary), requestHash: committed(input).requestHash }));
    state.check.mockResolvedValue(committed(input)); fireEvent.click(screen.getByRole("button", { name: "核对原采纳请求" })); await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要"); expect(screen.getByRole("button", { name: "确认并保存正式研究" })).toBeDisabled();
    expect(state.submit).not.toHaveBeenCalled();
  });
  it("source revision changes during an unknown operation do not clear its dirty draft after check", async () => {
    state.submit.mockRejectedValueOnce(new Error("lost ACK")); const view = mount(); await open(); edit(); save(); await screen.findByText(/结果尚未核验/);
    const input = state.submit.mock.calls[0][0]; view.rerender(<CompetitorDeepAdoptionEditor {...props} revision={"f".repeat(64)} onAdopted={state.saved} />);
    state.check.mockResolvedValue({ ...committed(input), currentActive: false }); fireEvent.click(screen.getByRole("button", { name: "核对原采纳请求" })); await screen.findByText(/不再生效/);
    expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要"); expect(readDeepAdoptionPending(context)).toBeNull();
  });
  it.each(["identity", "scope", "operation", "summary", "result", "request"])("a forged %s receipt hides private content and retains the unresolved UUID", async kind => {
    state.submit.mockImplementation(input => { const value = committed(input);
      if (kind === "identity") value.identity.userId = 8; if (kind === "scope") value.analysisId = 4; if (kind === "operation") value.operationId = "22222222-2222-4222-8222-222222222222";
      if (kind === "summary") value.ref.summaryHash = "1".repeat(64); if (kind === "result") value.ref.resultHash = "2".repeat(64); if (kind === "request") value.requestHash = "3".repeat(64); return Promise.resolve(value); });
    mount(); await open(); edit(); save(); await screen.findByText(/回执无法核验/); expect(screen.queryByDisplayValue("人工核对的私有摘要")).not.toBeInTheDocument();
    expect(readDeepAdoptionPending(context)).not.toBeNull(); expect(state.saved).not.toHaveBeenCalled();
  });
  it.each(["auth", "source"])("same-owner %s suspension hides the dialog without losing the draft", async kind => {
    const view = mount(); await open(); edit(); if (kind === "auth") state.auth.loading = true;
    view.rerender(<CompetitorDeepAdoptionEditor {...props} suspended={kind === "source"} onAdopted={state.saved} />); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    state.auth.loading = false; view.rerender(<CompetitorDeepAdoptionEditor {...props} onAdopted={state.saved} />);
    expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要"); expect(state.submit).not.toHaveBeenCalled();
  });
  it("revision change requires explicit rebase and retains edited summary", async () => {
    const view = mount(); await open(); edit(); const revision = "f".repeat(64); view.rerender(<CompetitorDeepAdoptionEditor {...props} revision={revision} />);
    expect(screen.getByRole("button", { name: "确认并保存正式研究" })).toBeDisabled(); const value = options(); value.candidate.currentRevision = revision; state.options.mockResolvedValue(value);
    fireEvent.click(screen.getByRole("button", { name: "重新读取采纳依据" })); await screen.findByRole("button", { name: "采用此读取版本，保留人工摘要" });
    fireEvent.click(screen.getByRole("button", { name: "采用此读取版本，保留人工摘要" })); expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要");
    expect(screen.getByRole("button", { name: "确认并保存正式研究" })).toBeDisabled();
  });
  it.each(["user", "workspace", "role", "analysis"])("%s change clears old draft and ignores a late submission", async kind => {
    const pending = deferred<unknown>(); state.submit.mockReturnValue(pending.promise); const view = mount(); await open(); edit(); save(); await waitFor(() => expect(state.submit).toHaveBeenCalledOnce());
    const input = state.submit.mock.calls[0][0]; if (kind === "user") state.auth.user.id = 8; if (kind === "workspace") state.auth.user.defaultWorkspaceId = 12; if (kind === "role") state.auth.user.role = "member";
    view.rerender(<CompetitorDeepAdoptionEditor {...props} analysisId={kind === "analysis" ? 4 : props.analysisId} onAdopted={state.saved} />);
    await act(async () => pending.resolve(committed(input))); expect(screen.queryByDisplayValue("人工核对的私有摘要")).not.toBeInTheDocument(); expect(state.saved).not.toHaveBeenCalled();
    expect(readDeepAdoptionPending(context)).not.toBeNull();
  });
  it("requires dirty-close confirmation and does not clear a rejected close", async () => {
    mount(); await open(); edit(); vi.mocked(window.confirm).mockReturnValue(false); fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    expect(screen.getByRole("textbox", { name: "人工正式摘要" })).toHaveValue("人工核对的私有摘要"); expect(state.dirty).toHaveBeenLastCalledWith(true);
  });
  it("unsupported Web Locks prevents any mutation or UUID reservation", async () => {
    mount(); await open(); edit(); Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); save(); await screen.findByText(/结果尚未核验/);
    expect(state.submit).not.toHaveBeenCalled(); expect(readDeepAdoptionPending(context)).toBeNull();
  });
});
