// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssistantConversationPanel, { type AssistantConversationPanelProps } from "./AssistantConversationPanel";

afterEach(cleanup);
const threadId = "22222222-2222-4222-8222-222222222222", operationId = "11111111-1111-4111-8111-111111111111";
function props(): AssistantConversationPanelProps {
  return {
    options: { status: "ready", value: { title: "合成助手", model: "合成模型", configurationRevision: 3, createAvailable: true, submitAvailable: true, cancelAvailable: true, uploadAvailable: true, reason: null, skills: [{ slug: "listing.copy", name: "Listing 文案", version: 7 }] } },
    threads: { status: "ready", value: [{ threadId, title: "私人项目", version: 1, activeOperationId: null }] }, nextThreadPage: false,
    selectedThread: { threadId, title: "私人项目", version: 1, activeOperationId: null },
    history: { status: "ready", value: [] }, nextHistoryPage: false,
    mode: "work", skillSlug: "", message: "请分析", title: "新项目", files: [], readingFiles: false, busy: false,
    pending: null, pendingState: null, cancelAcknowledged: false, storageError: false, locksAvailable: true, notice: "", denied: false,
    onReload: vi.fn(), onSelectThread: vi.fn(), onLoadThreads: vi.fn(), onLoadHistory: vi.fn(), onCreateThread: vi.fn(), onTitle: vi.fn(), onMode: vi.fn(), onSkill: vi.fn(), onMessage: vi.fn(), onFiles: vi.fn(), onRemoveFile: vi.fn(), onSend: vi.fn(), onCheck: vi.fn(), onCancel: vi.fn(), onCancelAcknowledged: vi.fn(),
  };
}
describe("source-faithful private conversation presentation", () => {
  it("retains work/coach, automatic/explicit skill, named threads and keyboard send", () => {
    const value = props(); render(<AssistantConversationPanel {...value} />);
    fireEvent.change(screen.getByLabelText("对话模式"), { target: { value: "coach" } }); expect(value.onMode).toHaveBeenCalledWith("coach");
    fireEvent.change(screen.getByLabelText("本次上下文 Skill"), { target: { value: "listing.copy" } }); expect(value.onSkill).toHaveBeenCalledWith("listing.copy");
    fireEvent.keyDown(screen.getByLabelText("给助手的消息"), { key: "Enter", ctrlKey: true }); expect(value.onSend).toHaveBeenCalledOnce();
    expect(screen.getByText(/不代表执行了业务 Skill/)).toBeVisible();
    expect(screen.getByText(/历史图片须重传/)).toBeVisible();
  });
  it("exposes both pagination directions without truncating an arbitrary first page", () => {
    const value = props(); render(<AssistantConversationPanel {...value} nextThreadPage nextHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "加载更多会话" })); fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
    expect(value.onLoadThreads).toHaveBeenCalledOnce(); expect(value.onLoadHistory).toHaveBeenCalledOnce();
  });
  it("shows escaped complete replies, attachment coverage and multiline candidate rules without save fiction", () => {
    const value = props(); value.history = { status: "ready", value: [{ operationId, sequence: 1, mode: "coach", message: "<script>private</script>", reply: "完整回复\n第二行", state: "succeeded", errorCode: null, selectedSkillSlug: "listing.copy", configurationRevision: 3, createdAt: "2026-10-18", attachments: [{ name: "a.pdf", sizeBytes: 400, image: false, coverage: "仅前 30 / 31 页", warnings: ["未读取第 31 页"] }], proposedRules: ["规则第一行\n同一条第二行", "规则二"] }] };
    const { container } = render(<AssistantConversationPanel {...value} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>private</script>")).toBeVisible();
    expect(screen.getByText("仅前 30 / 31 页")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/候选规则确认尚未接通/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /保存.*规则/ })).not.toBeInTheDocument();
  });
  it("keeps unknown check/cancel visible with submit disabled after server gate-off", () => {
    const value = props(); if (value.options.status === "ready") { value.options.value.submitAvailable = false; value.options.value.reason = "执行开关关闭"; }
    value.pending = { version: 1, userId: 7, workspaceId: 11, agentKey: "listing", threadId, operationId, expectedThreadVersion: 1, configurationRevision: 3 }; value.pendingState = "unknown";
    render(<AssistantConversationPanel {...value} />);
    expect(screen.getByRole("button", { name: "发送对话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对原对话" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "永久取消原对话" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); expect(value.onCancelAcknowledged).toHaveBeenCalledWith(true);
    expect(screen.getByText(/结果未知：不会重复调用/)).toBeVisible();
  });
  it.each(["storageError", "busy", "readingFiles"] as const)("does not send through keyboard while %s", key => {
    const value = props(); value[key] = true; render(<AssistantConversationPanel {...value} />);
    fireEvent.keyDown(screen.getByLabelText("给助手的消息"), { key: "Enter", metaKey: true }); expect(value.onSend).not.toHaveBeenCalled();
  });
  it("clears private presentation on denied state", () => {
    const value = props(); render(<AssistantConversationPanel {...value} denied />);
    expect(screen.queryByLabelText("给助手的消息")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("私有项目会话")).not.toBeInTheDocument();
    expect(screen.getByText(/私有记录和草稿已清除/)).toBeVisible();
  });
  it("passes pasted images and file selections to bounded draft handling", () => {
    const value = props(); render(<AssistantConversationPanel {...value} />); const file = new File(["synthetic"], "a.png");
    fireEvent.paste(screen.getByLabelText("给助手的消息"), { clipboardData: { files: [file] } });
    expect(value.onFiles).toHaveBeenCalledWith([file]);
    fireEvent.change(screen.getByLabelText("选择对话附件"), { target: { files: [file] } }); expect(value.onFiles).toHaveBeenCalledTimes(2);
  });
});
