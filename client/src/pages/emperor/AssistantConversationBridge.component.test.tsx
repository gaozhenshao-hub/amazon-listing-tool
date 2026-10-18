// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantConversationController } from "./AssistantConversationBridge";
import { conversationPendingKey, readConversationPending, type ConversationPending } from "./AssistantConversationDraft";
import type { AssistantConversationOptionsResult, AssistantConversationPublicThread, AssistantConversationPublicTurn } from "@shared/assistantConversationRead";
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: {} }) } }));
const owner = { userId: 7, workspaceId: 11, agentKey: "listing" as const, role: "admin", scopeKey: "7:11:admin" };
const identity = { userId: 7, workspaceId: 11, agentKey: "listing" as const };
const threadId = "22222222-2222-4222-8222-222222222222", otherThreadId = "33333333-3333-4333-8333-333333333333", operationId = "11111111-1111-4111-8111-111111111111", otherOperationId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-10-18 15:00:00.000000";
function thread(id = threadId, version = 1, activeOperationId: string | null = null): AssistantConversationPublicThread { return { threadId: id, title: id === threadId ? "私人项目" : "另一项目", version, activeOperationId, createdAt: timestamp, updatedAt: timestamp }; }
function options(enabled = true): AssistantConversationOptionsResult {
  return { identity, configuration: { revision: 3, hash: "a".repeat(64), name: "合成助手", enabled: true, modelSlug: "synthetic", modelName: "合成模型", vision: true }, skills: [{ slug: "listing.copy", name: "Listing 文案", version: 7 }], capabilities: { create: { available: enabled, reasonCode: enabled ? null : "WRITES_DISABLED" }, submit: { available: enabled, reasonCode: enabled ? null : "WRITES_DISABLED" }, cancel: { available: true, reasonCode: null }, upload: { available: enabled, reasonCode: null }, download: { available: false, reasonCode: "NOT_CONNECTED" }, confirmRules: { available: false, reasonCode: "NOT_CONNECTED" } }, executionKind: "conversation_only", businessExecutionAvailable: false, runtimeEnabled: enabled };
}
function turn(id = operationId, sequence = 1): AssistantConversationPublicTurn { return { operationId: id, threadId, sequence, mode: "work", message: `私有问题 ${sequence}`, reply: `私有回复 ${sequence}`, state: "succeeded", errorCode: null, selectedSkillSlug: null, configurationRevision: 3, configurationHash: "a".repeat(64), attachments: [], proposedRules: null, createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp }; }
function operation(state: AssistantConversationPublicTurn["state"] | null, id = operationId, enabled = true) { return { identity, thread: thread(threadId, state === "queued" ? 2 : 3, state === "queued" ? id : null), operation: state ? { ...turn(id), state, reply: state === "succeeded" ? "真实合成完成" : null, completedAt: ["succeeded", "failed", "canceled", "unknown"].includes(state) ? timestamp : null } : null, reasonCode: state === null ? "OPERATION_UNKNOWN" : null, runtimeEnabled: enabled }; }
function metadata(id = operationId): ConversationPending { return { version: 1, ...identity, threadId, operationId: id, expectedThreadVersion: 1, configurationRevision: 3 }; }
function api() {
  return { options: { query: vi.fn().mockResolvedValue(options()) }, threads: { query: vi.fn().mockResolvedValue({ identity, items: [thread(), thread(otherThreadId)], nextBeforeId: null }) },
    history: { query: vi.fn().mockImplementation(async input => ({ identity, thread: thread(input.threadId), items: [], nextBeforeSequence: null, runtimeEnabled: true })) },
    createThread: { mutate: vi.fn().mockImplementation(async input => ({ identity, thread: { ...thread(input.threadId), title: input.title } })) },
    submit: { mutate: vi.fn().mockImplementation(async input => operation("queued", input.operationId)) },
    check: { query: vi.fn().mockImplementation(async input => operation("succeeded", input.operationId)) },
    cancel: { mutate: vi.fn().mockImplementation(async input => operation("canceled", input.operationId, false)) },
  };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function select() { await screen.findByRole("option", { name: "私人项目" }); fireEvent.change(screen.getByLabelText("私有项目会话"), { target: { value: threadId } }); await screen.findByText(/此会话尚无消息/); }
beforeEach(() => {
  localStorage.clear(); vi.spyOn(window, "confirm").mockReturnValue(true);
  let queue = Promise.resolve(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn((_name, options, callback) => { const next = queue.then(() => { if (options.signal.aborted) throw new Error("aborted"); return callback(); }); queue = next.catch(() => undefined); return next; }) } });
  URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("private conversation owned bridge", () => {
  it("reads options and private lists only until explicit selection and send", async () => {
    const client = api(); render(<AssistantConversationController owner={owner} api={client} />);
    await screen.findByRole("option", { name: "私人项目" });
    expect(client.options.query).toHaveBeenCalledWith({ expectedWorkspaceId: 11, agentKey: "listing" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(client.history.query).not.toHaveBeenCalled(); expect(client.submit.mutate).not.toHaveBeenCalled(); expect(client.createThread.mutate).not.toHaveBeenCalled();
  });
  it("reserves metadata before submit, binds work/explicit/config and clears only its acknowledged draft", async () => {
    const client = api(); client.submit.mutate.mockImplementation(async input => { expect(readConversationPending(owner)?.operationId).toBe(input.operationId); return operation("queued", input.operationId); });
    render(<AssistantConversationController owner={owner} api={client} />); await select();
    fireEvent.change(screen.getByLabelText("给助手的消息"), { target: { value: "私有正文不进入localStorage" } });
    fireEvent.change(screen.getByLabelText("本次上下文 Skill"), { target: { value: "listing.copy" } }); fireEvent.click(screen.getByRole("button", { name: "发送对话" }));
    await waitFor(() => expect(client.submit.mutate).toHaveBeenCalledOnce());
    expect(client.submit.mutate.mock.calls[0][0]).toMatchObject({ expectedWorkspaceId: 11, agentKey: "listing", threadId, expectedThreadVersion: 1, expectedConfiguration: { revision: 3, hash: "a".repeat(64) }, mode: "work", selection: { kind: "explicit", skillSlug: "listing.copy" }, message: "私有正文不进入localStorage", files: [] });
    await waitFor(() => expect(screen.getByLabelText("给助手的消息")).toHaveValue(""));
    expect(localStorage.getItem(conversationPendingKey(owner))).not.toContain("私有正文");
    expect(screen.getByRole("button", { name: "发送对话" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "核对原对话" })); await waitFor(() => expect(readConversationPending(owner)).toBeNull());
    expect(client.submit.mutate).toHaveBeenCalledOnce();
  });
  it("lost ACK keeps draft and UUID; unknown lookup cannot release; gate-off cancel fences it", async () => {
    const client = api(); client.submit.mutate.mockRejectedValue(new Error("lost ACK")); client.check.query.mockImplementation(async input => operation(null, input.operationId, false));
    render(<AssistantConversationController owner={owner} api={client} />); await select(); fireEvent.change(screen.getByLabelText("给助手的消息"), { target: { value: "保留草稿" } }); fireEvent.click(screen.getByRole("button", { name: "发送对话" }));
    await screen.findByText(/未获得可验证的提交回执/); const id = readConversationPending(owner)!.operationId;
    expect(screen.getByLabelText("给助手的消息")).toHaveValue("保留草稿");
    client.options.query.mockResolvedValue(options(false)); fireEvent.click(screen.getByRole("button", { name: "刷新对话状态" })); await screen.findByText(/对话执行开关关闭/);
    fireEvent.click(screen.getByRole("button", { name: "核对原对话" })); await screen.findByText(/原 UUID 尚未查到/); expect(readConversationPending(owner)?.operationId).toBe(id);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "永久取消原对话" })); await waitFor(() => expect(readConversationPending(owner)).toBeNull());
    expect(client.cancel.mutate).toHaveBeenCalledWith({ expectedWorkspaceId: 11, agentKey: "listing", threadId, operationId: id }); expect(client.submit.mutate).toHaveBeenCalledOnce(); expect(screen.getByLabelText("给助手的消息")).toHaveValue("保留草稿");
  });
  it("a remounted owner can recover only stored UUID without resending absent content", async () => {
    localStorage.setItem(conversationPendingKey(owner), JSON.stringify(metadata())); const client = api(); client.options.query.mockResolvedValue(options(false));
    render(<AssistantConversationController owner={owner} api={client} />); await screen.findByText(/对话执行开关关闭/);
    fireEvent.click(screen.getByRole("button", { name: "核对原对话" })); await waitFor(() => expect(readConversationPending(owner)).toBeNull()); expect(client.submit.mutate).not.toHaveBeenCalled();
  });
  it("foreign completed operation preserves this component's unsent draft", async () => {
    const client = api(); render(<AssistantConversationController owner={owner} api={client} />); await select(); fireEvent.change(screen.getByLabelText("给助手的消息"), { target: { value: "本窗口未发送" } });
    act(() => { localStorage.setItem(conversationPendingKey(owner), JSON.stringify(metadata())); window.dispatchEvent(new StorageEvent("storage", { key: conversationPendingKey(owner) })); });
    fireEvent.click(screen.getByRole("button", { name: "核对原对话" })); await waitFor(() => expect(readConversationPending(owner)).toBeNull()); expect(screen.getByLabelText("给助手的消息")).toHaveValue("本窗口未发送");
  });
  it("restores a server-owned pending turn from history on a new device without creating a new UUID", async () => {
    const client = api(); client.options.query.mockResolvedValue(options(false)); client.history.query.mockResolvedValue({ identity, thread: thread(threadId, 2, operationId), items: [{ ...turn(), state: "reply_dispatched", reply: null, completedAt: null }], nextBeforeSequence: null, runtimeEnabled: false });
    render(<AssistantConversationController owner={owner} api={client} />); await screen.findByRole("option", { name: "私人项目" }); fireEvent.change(screen.getByLabelText("私有项目会话"), { target: { value: threadId } });
    fireEvent.click(await screen.findByRole("button", { name: "管理第 1 轮原对话" })); await waitFor(() => expect(readConversationPending(owner)).toMatchObject({ operationId, threadId, expectedThreadVersion: null }));
    fireEvent.click(screen.getByRole("button", { name: "核对原对话" })); await waitFor(() => expect(readConversationPending(owner)).toBeNull()); expect(client.submit.mutate).not.toHaveBeenCalled();
  });
  it.each([true, false])("cancel confirmation never transfers to a replaced UUID (storage event %s)", async dispatch => {
    localStorage.setItem(conversationPendingKey(owner), JSON.stringify(metadata())); const client = api(); render(<AssistantConversationController owner={owner} api={client} />);
    await screen.findByText("合成助手"); fireEvent.click(screen.getByRole("checkbox")); expect(screen.getByRole("button", { name: "永久取消原对话" })).toBeEnabled();
    act(() => { localStorage.setItem(conversationPendingKey(owner), JSON.stringify(metadata(otherOperationId))); if (dispatch) window.dispatchEvent(new StorageEvent("storage", { key: conversationPendingKey(owner) })); });
    fireEvent.click(screen.getByRole("button", { name: "永久取消原对话" })); expect(client.cancel.mutate).not.toHaveBeenCalled();
  });
  it("thread switch requires explicit discard and preserves rejected drafts", async () => {
    const client = api(); render(<AssistantConversationController owner={owner} api={client} />); await select(); fireEvent.change(screen.getByLabelText("给助手的消息"), { target: { value: "不要丢失" } });
    vi.mocked(window.confirm).mockReturnValue(false); fireEvent.change(screen.getByLabelText("私有项目会话"), { target: { value: otherThreadId } }); expect(screen.getByLabelText("给助手的消息")).toHaveValue("不要丢失"); expect(client.history.query).toHaveBeenCalledTimes(1);
    vi.mocked(window.confirm).mockReturnValue(true); fireEvent.change(screen.getByLabelText("私有项目会话"), { target: { value: otherThreadId } }); await waitFor(() => expect(client.history.query).toHaveBeenCalledTimes(2)); expect(screen.getByLabelText("给助手的消息")).toHaveValue("");
  });
  it("history pagination keeps all messages but rejects version mixing", async () => {
    const client = api(); client.history.query.mockResolvedValueOnce({ identity, thread: thread(), items: [turn(operationId, 2)], nextBeforeSequence: 2, runtimeEnabled: true }).mockResolvedValueOnce({ identity, thread: thread(threadId, 2), items: [turn(otherOperationId, 1)], nextBeforeSequence: null, runtimeEnabled: true });
    render(<AssistantConversationController owner={owner} api={client} />); await screen.findByRole("option", { name: "私人项目" }); fireEvent.change(screen.getByLabelText("私有项目会话"), { target: { value: threadId } }); await screen.findByText("私有回复 2");
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" })); await screen.findByText(/未拼接旧页/); expect(screen.queryByText("私有回复 2")).not.toBeInTheDocument(); expect(screen.queryByText("私有回复 1")).not.toBeInTheDocument();
  });
  it("loads every authorized history page in sequence without duplicate or dropped messages", async () => {
    const client = api(); client.history.query.mockResolvedValueOnce({ identity, thread: thread(), items: [turn(otherOperationId, 3), turn(operationId, 2)], nextBeforeSequence: 2, runtimeEnabled: true }).mockResolvedValueOnce({ identity, thread: thread(), items: [turn("55555555-5555-4555-8555-555555555555", 1)], nextBeforeSequence: null, runtimeEnabled: true });
    render(<AssistantConversationController owner={owner} api={client} />); await screen.findByRole("option", { name: "私人项目" }); fireEvent.change(screen.getByLabelText("私有项目会话"), { target: { value: threadId } }); await screen.findByText("私有回复 3");
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" })); await screen.findByText("私有回复 1");
    expect(screen.getAllByRole("article").map(item => item.getAttribute("aria-label"))).toEqual(["第 1 轮对话", "第 2 轮对话", "第 3 轮对话"]);
    expect(client.history.query.mock.calls[1][0]).toMatchObject({ expectedWorkspaceId: 11, agentKey: "listing", threadId, beforeSequence: 2, limit: 10 });
  });
  it("thread pagination refuses duplicate identities instead of silently dropping a thread", async () => {
    const client = api(); client.threads.query.mockResolvedValueOnce({ identity, items: [thread()], nextBeforeId: 10 }).mockResolvedValueOnce({ identity, items: [thread()], nextBeforeId: null });
    render(<AssistantConversationController owner={owner} api={client} />); await screen.findByRole("option", { name: "私人项目" }); fireEvent.click(screen.getByRole("button", { name: "加载更多会话" }));
    await screen.findByText(/会话列表读取失败或分页内容不一致/); expect(screen.queryByRole("option", { name: "私人项目" })).not.toBeInTheDocument();
  });
  it("fresh 403 clears loaded private history and draft and ignores subsequent responses", async () => {
    const client = api(); render(<AssistantConversationController owner={owner} api={client} />); await select(); fireEvent.change(screen.getByLabelText("给助手的消息"), { target: { value: "私有草稿" } });
    client.options.query.mockRejectedValue(Object.assign(new Error("revoked"), { data: { code: "FORBIDDEN" } })); fireEvent.click(screen.getByRole("button", { name: "刷新对话状态" }));
    await screen.findByText(/私有记录和草稿已清除/); expect(screen.queryByDisplayValue("私有草稿")).not.toBeInTheDocument(); expect(client.submit.mutate).not.toHaveBeenCalled();
  });
  it("cannot submit files when only text submission is authorized", async () => {
    const client = api(), capability = options(); capability.capabilities.upload = { available: false, reasonCode: "UPLOAD_DISABLED" }; client.options.query.mockResolvedValue(capability);
    render(<AssistantConversationController owner={owner} api={client} />); await select(); fireEvent.change(screen.getByLabelText("给助手的消息"), { target: { value: "附文档" } });
    fireEvent.change(screen.getByLabelText("选择对话附件"), { target: { files: [new File(["private"], "document.txt")] } }); await screen.findByText(/当前附件提交能力不可用/);
    expect(screen.getByRole("button", { name: "发送对话" })).toBeDisabled(); expect(client.submit.mutate).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
  });
  it("requires server-confirmed vision before sending image drafts", async () => {
    const client = api(), capability = options(); capability.configuration!.vision = false; client.options.query.mockResolvedValue(capability);
    render(<AssistantConversationController owner={owner} api={client} />); await select(); fireEvent.change(screen.getByLabelText("给助手的消息"), { target: { value: "分析图片" } });
    fireEvent.change(screen.getByLabelText("选择对话附件"), { target: { files: [new File(["synthetic"], "image.png")] } }); await screen.findByText(/当前模型视觉能力未确认/);
    expect(screen.getByRole("button", { name: "发送对话" })).toBeDisabled(); expect(client.submit.mutate).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
  });
  it("releases image previews on removal and owner unmount without persisting attachment bytes", async () => {
    const client = api(); const view = render(<AssistantConversationController owner={owner} api={client} />); await select();
    fireEvent.change(screen.getByLabelText("选择对话附件"), { target: { files: [new File(["synthetic"], "one.png")] } }); await screen.findByAltText("one.png 附件预览");
    fireEvent.click(screen.getByRole("button", { name: "移除 one.png" })); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("选择对话附件"), { target: { files: [new File(["synthetic"], "two.png")] } }); await screen.findByAltText("two.png 附件预览"); view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2); expect(localStorage.length).toBe(0);
  });
  it("strict owner response mismatch quarantines all private content", async () => {
    const client = api(), late = deferred<unknown>(); client.options.query.mockReturnValue(late.promise); client.threads.query.mockResolvedValue({ identity: { ...identity, userId: 99 }, items: [thread()], nextBeforeId: null });
    render(<AssistantConversationController owner={owner} api={client} />); await screen.findByText(/私有记录和草稿已清除/); await act(async () => late.resolve(options()));
    expect(screen.queryByRole("option", { name: "私人项目" })).not.toBeInTheDocument(); expect(screen.queryByLabelText("给助手的消息")).not.toBeInTheDocument();
  });
  it("role/identity remount aborts old reads and never fills the new owner with late output", async () => {
    const client = api(), late = deferred<unknown>(); client.options.query.mockReturnValueOnce(late.promise); const { rerender } = render(<AssistantConversationController owner={owner} api={client} />);
    const signal = client.options.query.mock.calls[0][1].signal; const next = { ...owner, userId: 8, scopeKey: "8:11:admin" }; client.options.query.mockResolvedValue({ ...options(), identity: { ...identity, userId: 8 } }); client.threads.query.mockResolvedValue({ identity: { ...identity, userId: 8 }, items: [], nextBeforeId: null });
    rerender(<AssistantConversationController owner={next} api={client} />); expect(signal.aborted).toBe(true); await act(async () => late.resolve(options())); expect(screen.queryByRole("option", { name: "私人项目" })).not.toBeInTheDocument();
  });
  it("StrictMode keeps only fresh read generations and never creates a turn", async () => {
    const client = api(); render(<StrictMode><AssistantConversationController owner={owner} api={client} /></StrictMode>); await screen.findByRole("option", { name: "私人项目" });
    expect(client.options.query.mock.calls[0][1].signal.aborted).toBe(true); expect(client.submit.mutate).not.toHaveBeenCalled();
  });
  it("unknown create uses same thread UUID/title on explicit retry and invokes no model", async () => {
    const client = api(); client.createThread.mutate.mockRejectedValueOnce(new Error("lost ACK")); render(<AssistantConversationController owner={owner} api={client} />); await screen.findByRole("option", { name: "私人项目" });
    fireEvent.change(screen.getByLabelText("新会话名称"), { target: { value: "完整会话名称" } }); fireEvent.click(screen.getByRole("button", { name: "创建私有会话" })); await screen.findByText(/新会话创建结果尚未确认/);
    expect(screen.getByLabelText("新会话名称")).toBeDisabled(); expect(screen.getByLabelText("给助手的消息")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "同 UUID 重试创建会话" })); await screen.findByText(/私有会话已创建/);
    expect(client.createThread.mutate.mock.calls[1][0]).toEqual(client.createThread.mutate.mock.calls[0][0]); expect(client.submit.mutate).not.toHaveBeenCalled();
  });
});
