// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantRuleConfirmationBridge, { type AssistantRuleConfirmationBridgeProps, type RuleConfirmationTarget } from "./AssistantRuleConfirmationBridge";
import { readRuleConfirmationPending, ruleConfirmationPendingKey, type RuleConfirmationPending } from "./AssistantRuleConfirmationDraft";
import { conversationPendingKey } from "./AssistantConversationDraft";

const owner = { userId: 7, workspaceId: 11, agentKey: "listing" as const, role: "admin", scopeKey: "7:11:admin" };
const identity = { userId: 7, workspaceId: 11, agentKey: "listing" as const };
const target = { threadId: "11111111-1111-4111-8111-111111111111", operationId: "22222222-2222-4222-8222-222222222222" };
const otherTarget = { ...target, operationId: "44444444-4444-4444-8444-444444444444" };
const confirmationId = "33333333-3333-4333-8333-333333333333", otherId = "55555555-5555-4555-8555-555555555555";
function proposal(value = target) { return { identity, threadId: value.threadId, operationId: value.operationId, proposalHash: "b".repeat(64), proposedRules: ["第一条\n保持内部换行", "第二条"], baseConfiguration: { revision: 3, hash: "a".repeat(64) }, currentConfiguration: { revision: 3, hash: "a".repeat(64) }, capability: { available: true, reasonCode: null as string | null }, sharedScope: "workspace_agent" as const }; }
function metadata(id = confirmationId): RuleConfirmationPending { return { version: 1, ...identity, ...target, confirmationId: id, baseRevision: 3, baseHash: "a".repeat(64), proposalHash: "b".repeat(64) }; }
function receipt(id: string, status: "committed" | "unknown" | "canceled", value = target) { return { identity, threadId: value.threadId, operationId: value.operationId, confirmationId: id, status, requestHash: status === "committed" ? "c".repeat(64) : null, proposalHash: status === "committed" ? "b".repeat(64) : null, configurationRevision: status === "committed" ? 4 : null, configurationHash: status === "committed" ? "d".repeat(64) : null, reasonCode: status === "committed" ? null : status === "unknown" ? "CONFIRMATION_UNKNOWN" : "CONFIRMATION_CANCELED" }; }
function api() { return { ruleProposal: { query: vi.fn().mockImplementation(async input => proposal(input)) }, confirmRules: { mutate: vi.fn().mockImplementation(async input => receipt(input.confirmationId, "committed", input)) }, checkRuleConfirmation: { query: vi.fn().mockImplementation(async input => receipt(input.confirmationId, "committed", input)) }, cancelRuleConfirmation: { mutate: vi.fn().mockImplementation(async input => receipt(input.confirmationId, "canceled", input)) } }; }
function callbacks() { return { onTargetClose: vi.fn(), onDirtyChange: vi.fn(), onDenied: vi.fn(), onSaved: vi.fn() }; }
function Host(props: Omit<AssistantRuleConfirmationBridgeProps, "target" | "onTargetClose"> & { target?: RuleConfirmationTarget | null; onTargetClose?: () => void }) {
  const [value, setValue] = useState<RuleConfirmationTarget | null>(props.target === undefined ? target : props.target);
  return <AssistantRuleConfirmationBridge {...props} target={value} onTargetClose={() => { props.onTargetClose?.(); setValue(null); }} />;
}
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(yes => { resolve = yes; }); return { promise, resolve }; }
async function ready() { await screen.findByLabelText("第 1 条规则"); }
function acknowledge() { fireEvent.click(screen.getByLabelText(/确认替换本工作区/)); }
beforeEach(() => {
  localStorage.clear(); vi.spyOn(window, "confirm").mockReturnValue(true);
  let queue = Promise.resolve(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn((_name, options, callback) => { const result = queue.then(() => { options.signal.throwIfAborted(); return callback(); }); queue = result.catch(() => undefined); return result; }) } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("private rule confirmation controller", () => {
  it("does not read a private proposal until explicitly selected", async () => {
    const client = api(); render(<Host owner={owner} api={client} {...callbacks()} target={null} />);
    await act(async () => {}); expect(client.ruleProposal.query).not.toHaveBeenCalled(); expect(client.confirmRules.mutate).not.toHaveBeenCalled();
  });
  it("saves complete edited rules using original config CAS and persisted distinct UUID before mutation", async () => {
    const client = api(), cb = callbacks(); client.confirmRules.mutate.mockImplementation(async input => { expect(readRuleConfirmationPending(owner)?.confirmationId).toBe(input.confirmationId); expect(localStorage.getItem(ruleConfirmationPendingKey(owner))).not.toContain("私有编辑"); return receipt(input.confirmationId, "committed"); });
    render(<Host owner={owner} api={client} {...cb} />); await ready();
    fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "私有编辑\n一条完整规则" } }); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "确认保存完整规则" }));
    await screen.findByText(/完整规则已保存为共享配置 v4/);
    expect(client.confirmRules.mutate.mock.calls[0][0]).toMatchObject({ expectedWorkspaceId: 11, agentKey: "listing", ...target, expectedProposalHash: "b".repeat(64), expectedConfigurationRevision: 3, expectedConfigurationHash: "a".repeat(64), rules: ["私有编辑\n一条完整规则", "第二条"], confirmSharedScope: true, confirmClearAll: false });
    expect(readRuleConfirmationPending(owner)).toBeNull(); expect(cb.onSaved).toHaveBeenCalledOnce(); expect(cb.onTargetClose).toHaveBeenCalledOnce();
  });
  it("clears all rules only with two explicit acknowledgments", async () => {
    const client = api(); render(<Host owner={owner} api={client} {...callbacks()} />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "清空完整规则列表" })); acknowledge(); expect(screen.getByRole("button", { name: "确认保存完整规则" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/明确确认清空/)); fireEvent.click(screen.getByRole("button", { name: "确认保存完整规则" }));
    await waitFor(() => expect(client.confirmRules.mutate).toHaveBeenCalledOnce()); expect(client.confirmRules.mutate.mock.calls[0][0]).toMatchObject({ rules: [], confirmClearAll: true, confirmSharedScope: true });
  });
  it("keeps invalid/blank rules as editable draft rather than removing or truncating them", async () => {
    const client = api(); render(<Host owner={owner} api={client} {...callbacks()} />); await ready();
    fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "x".repeat(501) } }); acknowledge(); expect(screen.getByRole("button", { name: "确认保存完整规则" })).toBeDisabled(); expect(screen.getByLabelText("第 1 条规则")).toHaveValue("x".repeat(501));
    fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "  " } }); expect(screen.getAllByRole("textbox")).toHaveLength(2); expect(client.confirmRules.mutate).not.toHaveBeenCalled();
  });
  it("old configuration conflict blocks save and never replaces an edited draft on re-read", async () => {
    const client = api(); render(<Host owner={owner} api={client} {...callbacks()} />); await ready(); fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "保留草稿" } });
    client.ruleProposal.query.mockResolvedValue({ ...proposal(), currentConfiguration: { revision: 4, hash: "d".repeat(64) }, capability: { available: false, reasonCode: "CONFIGURATION_CONFLICT" } });
    fireEvent.click(screen.getByRole("button", { name: "重新核对规则来源与当前版本" })); await screen.findByText(/不能自动改用新版本覆盖/);
    expect(screen.getByLabelText("第 1 条规则")).toHaveValue("保留草稿"); acknowledge(); expect(screen.getByRole("button", { name: "确认保存完整规则" })).toBeDisabled(); expect(client.confirmRules.mutate).not.toHaveBeenCalled();
  });
  it("lost ACK and unknown lookup retain original UUID; gate-off cancellation leaves conversation and draft untouched", async () => {
    const client = api(); client.confirmRules.mutate.mockRejectedValue(new Error("lost ACK")); client.checkRuleConfirmation.query.mockImplementation(async input => receipt(input.confirmationId, "unknown"));
    localStorage.setItem(conversationPendingKey(owner), "original-message"); render(<Host owner={owner} api={client} {...callbacks()} />); await ready();
    fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "保留规则" } }); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "确认保存完整规则" })); await screen.findByText(/未获得可验证的规则保存回执/);
    const id = readRuleConfirmationPending(owner)!.confirmationId; fireEvent.click(screen.getByRole("button", { name: "核对原规则确认" })); await screen.findByText(/原规则确认尚未查到/);
    expect(readRuleConfirmationPending(owner)?.confirmationId).toBe(id); client.ruleProposal.query.mockResolvedValue({ ...proposal(), capability: { available: false, reasonCode: "WRITES_DISABLED" } });
    fireEvent.click(screen.getByRole("button", { name: "重新核对规则来源与当前版本" })); await screen.findByText(/规则保存开关尚未开启/);
    fireEvent.click(screen.getByLabelText(/永久取消上述规则确认/)); fireEvent.click(screen.getByRole("button", { name: "永久取消原规则确认" })); await waitFor(() => expect(readRuleConfirmationPending(owner)).toBeNull());
    expect(client.confirmRules.mutate).toHaveBeenCalledOnce(); expect(client.cancelRuleConfirmation.mutate.mock.calls[0][0].confirmationId).toBe(id); expect(screen.getByLabelText("第 1 条规则")).toHaveValue("保留规则"); expect(localStorage.getItem(conversationPendingKey(owner))).toBe("original-message");
  });
  it("remount recovers metadata without fetching proposal or retaining private rules", async () => {
    localStorage.setItem(ruleConfirmationPendingKey(owner), JSON.stringify(metadata())); const client = api(), cb = callbacks();
    render(<Host owner={owner} api={client} {...cb} target={null} />); fireEvent.click(await screen.findByRole("button", { name: "核对原规则确认" }));
    await waitFor(() => expect(readRuleConfirmationPending(owner)).toBeNull()); expect(client.ruleProposal.query).not.toHaveBeenCalled(); expect(client.confirmRules.mutate).not.toHaveBeenCalled(); expect(cb.onSaved).toHaveBeenCalledOnce();
  });
  it.each([true, false])("cancellation cannot transfer to a different UUID (storage event %s)", async event => {
    localStorage.setItem(ruleConfirmationPendingKey(owner), JSON.stringify(metadata())); const client = api(); render(<Host owner={owner} api={client} {...callbacks()} target={null} />);
    fireEvent.click(await screen.findByLabelText(/永久取消上述规则确认/));
    act(() => { localStorage.setItem(ruleConfirmationPendingKey(owner), JSON.stringify(metadata(otherId))); if (event) window.dispatchEvent(new StorageEvent("storage", { key: ruleConfirmationPendingKey(owner) })); });
    fireEvent.click(screen.getByRole("button", { name: "永久取消原规则确认" })); expect(client.cancelRuleConfirmation.mutate).not.toHaveBeenCalled();
  });
  it.each([target, otherTarget])("foreign confirmation success keeps unsent draft for source $operationId", async source => {
    const client = api(), cb = callbacks(); render(<Host owner={owner} api={client} {...cb} target={source} />); await ready(); fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "本窗口另一个草稿" } });
    act(() => { localStorage.setItem(ruleConfirmationPendingKey(owner), JSON.stringify(metadata())); window.dispatchEvent(new StorageEvent("storage", { key: ruleConfirmationPendingKey(owner) })); });
    fireEvent.click(screen.getByRole("button", { name: "核对原规则确认" })); await waitFor(() => expect(readRuleConfirmationPending(owner)).toBeNull());
    expect(screen.getByLabelText("第 1 条规则")).toHaveValue("本窗口另一个草稿"); expect(cb.onTargetClose).not.toHaveBeenCalled(); expect(client.confirmRules.mutate).not.toHaveBeenCalled();
  });
  it("failed fresh read retains draft and dirty close guard", async () => {
    const client = api(), cb = callbacks(); render(<Host owner={owner} api={client} {...cb} />); await ready(); fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "失败仍保留" } });
    client.ruleProposal.query.mockRejectedValue(new Error("offline")); fireEvent.click(screen.getByRole("button", { name: "重新核对规则来源与当前版本" })); await screen.findByText(/候选规则或当前配置读取失败/);
    vi.mocked(window.confirm).mockReturnValue(false); fireEvent.click(screen.getByRole("button", { name: "关闭规则编辑" })); expect(cb.onTargetClose).not.toHaveBeenCalled(); expect(screen.getByLabelText("第 1 条规则")).toHaveValue("失败仍保留");
  });
  it("identity mismatch or revoked read clears private data and does not release recovery metadata", async () => {
    const client = api(), cb = callbacks(); render(<Host owner={owner} api={client} {...cb} />); await ready(); fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "私有内容" } });
    client.ruleProposal.query.mockRejectedValue(Object.assign(new Error("denied"), { data: { code: "FORBIDDEN" } })); fireEvent.click(screen.getByRole("button", { name: "重新核对规则来源与当前版本" })); await waitFor(() => expect(cb.onDenied).toHaveBeenCalledOnce()); expect(screen.queryByDisplayValue("私有内容")).not.toBeInTheDocument();
  });
  it("late private proposal from an old owner is aborted and cannot enter the new owner", async () => {
    const client = api(), late = deferred(); client.ruleProposal.query.mockReturnValueOnce(late.promise); const cb = callbacks(); const view = render(<AssistantRuleConfirmationBridge owner={owner} api={client} target={target} {...cb} />);
    const signal = client.ruleProposal.query.mock.calls[0][1].signal; client.ruleProposal.query.mockResolvedValue({ ...proposal(), identity: { ...identity, userId: 8 } });
    view.rerender(<AssistantRuleConfirmationBridge owner={{ ...owner, userId: 8 }} api={client} target={target} {...cb} />); expect(signal.aborted).toBe(true); await ready(); await act(async () => late.resolve({ ...proposal(), proposedRules: ["旧身份私有规则"] })); expect(screen.queryByDisplayValue("旧身份私有规则")).not.toBeInTheDocument();
  });
  it("invalid or wrong source receipt never releases original UUID", async () => {
    const client = api(); client.confirmRules.mutate.mockImplementation(async input => ({ ...receipt(input.confirmationId, "committed"), proposalHash: "f".repeat(64) })); render(<Host owner={owner} api={client} {...callbacks()} />); await ready(); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "确认保存完整规则" })); await screen.findByText(/未获得可验证的规则保存回执/); expect(readRuleConfirmationPending(owner)).not.toBeNull();
  });
  it("its own lost ACK can be checked once and closes only the acknowledged draft", async () => {
    const client = api(), cb = callbacks(); client.confirmRules.mutate.mockRejectedValue(new Error("lost ACK")); render(<Host owner={owner} api={client} {...cb} />); await ready();
    fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "自己已提交草稿" } }); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "确认保存完整规则" })); await screen.findByText(/未获得可验证的规则保存回执/);
    fireEvent.click(screen.getByRole("button", { name: "核对原规则确认" })); await waitFor(() => expect(cb.onTargetClose).toHaveBeenCalledOnce()); expect(client.confirmRules.mutate).toHaveBeenCalledOnce(); expect(readRuleConfirmationPending(owner)).toBeNull();
  });
  it("a late original proposal cannot replace the new target's edited draft", async () => {
    const client = api(), late = deferred(), cb = callbacks(); client.ruleProposal.query.mockReturnValueOnce(late.promise);
    const view = render(<AssistantRuleConfirmationBridge owner={owner} api={client} target={target} {...cb} />);
    view.rerender(<AssistantRuleConfirmationBridge owner={owner} api={client} target={otherTarget} {...cb} />); await ready(); fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "新目标草稿" } });
    await act(async () => late.resolve({ ...proposal(), proposedRules: ["旧目标私有候选"] })); expect(screen.getByLabelText("第 1 条规则")).toHaveValue("新目标草稿");
  });
  it("a late save acknowledgment never closes or replaces another target", async () => {
    const client = api(), late = deferred(), cb = callbacks(); client.confirmRules.mutate.mockReturnValueOnce(late.promise);
    const view = render(<AssistantRuleConfirmationBridge owner={owner} api={client} target={target} {...cb} />); await ready(); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "确认保存完整规则" })); await waitFor(() => expect(client.confirmRules.mutate).toHaveBeenCalledOnce());
    const id = readRuleConfirmationPending(owner)!.confirmationId; client.ruleProposal.query.mockResolvedValue({ ...proposal(otherTarget), proposedRules: ["另一候选完整列表"] });
    view.rerender(<AssistantRuleConfirmationBridge owner={owner} api={client} target={otherTarget} {...cb} />); await screen.findByDisplayValue("另一候选完整列表");
    await act(async () => late.resolve(receipt(id, "committed"))); expect(screen.getByLabelText("第 1 条规则")).toHaveValue("另一候选完整列表"); expect(cb.onTargetClose).not.toHaveBeenCalled(); expect(readRuleConfirmationPending(owner)).toBeNull();
  });
  it("StrictMode does not confirm automatically or accept its canceled initial read", async () => {
    const client = api(); render(<StrictMode><Host owner={owner} api={client} {...callbacks()} /></StrictMode>); await ready(); expect(client.ruleProposal.query.mock.calls[0][1].signal.aborted).toBe(true); expect(client.confirmRules.mutate).not.toHaveBeenCalled();
  });
});
