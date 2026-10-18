// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssistantRuleConfirmationPanel, { type AssistantRuleConfirmationPanelProps } from "./AssistantRuleConfirmationPanel";

afterEach(cleanup);
function props(): AssistantRuleConfirmationPanelProps {
  return { open: true, loading: false, error: null, notice: "", proposal: { baseRevision: 3, currentRevision: 3, rules: ["第一条\n同一条第二行", "<script>原文</script>"], canConfirm: true, reason: null, conflict: false }, draft: ["第一条\n同一条第二行", "<script>原文</script>"], dirty: true, busy: false, pending: null, storageError: false, locksAvailable: true, sharedAcknowledged: false, emptyAcknowledged: false, cancelAcknowledged: false, validationError: null,
    onClose: vi.fn(), onReload: vi.fn(), onSave: vi.fn(), onRule: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onClear: vi.fn(), onSharedAcknowledged: vi.fn(), onEmptyAcknowledged: vi.fn(), onCheck: vi.fn(), onCancel: vi.fn(), onCancelAcknowledged: vi.fn() };
}
describe("complete candidate rules confirmation presentation", () => {
  it("keeps multiline rules as distinct fields and source text escaped", () => {
    const value = props(), { container } = render(<AssistantRuleConfirmationPanel {...value} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(2); expect(screen.getByLabelText("第 1 条规则")).toHaveValue("第一条\n同一条第二行"); expect(container.querySelector("script")).toBeNull();
    fireEvent.change(screen.getByLabelText("第 1 条规则"), { target: { value: "编辑\n仍一条" } }); expect(value.onRule).toHaveBeenCalledWith(0, "编辑\n仍一条");
    expect(screen.getByText(/其他成员今后的对话也会受影响/)).toBeVisible(); expect(screen.getByRole("button", { name: "确认保存完整规则" })).toBeDisabled();
  });
  it("requires both workspace replacement and separate empty-list acknowledgment", () => {
    const value = props(), view = render(<AssistantRuleConfirmationPanel {...value} draft={[]} sharedAcknowledged />);
    expect(screen.getByRole("button", { name: "确认保存完整规则" })).toBeDisabled(); expect(screen.getByLabelText(/明确确认清空/)).toBeVisible();
    view.rerender(<AssistantRuleConfirmationPanel {...value} draft={[]} sharedAcknowledged emptyAcknowledged />); expect(screen.getByRole("button", { name: "确认保存完整规则" })).toBeEnabled();
  });
  it("does not offer rebasing or saving a stale proposal even after all confirmations", () => {
    const value = props(); render(<AssistantRuleConfirmationPanel {...value} proposal={{ ...value.proposal!, currentRevision: 4, conflict: true }} sharedAcknowledged />);
    expect(screen.getByRole("button", { name: "确认保存完整规则" })).toBeDisabled(); expect(screen.getByText(/不能自动改用新版本覆盖/)).toBeVisible();
  });
  it("keeps check and fenced cancel separate from the original message when writes are disabled", () => {
    const value = props(); render(<AssistantRuleConfirmationPanel {...value} open={false} proposal={null} pending={{ version: 1, userId: 7, workspaceId: 11, agentKey: "listing", threadId: "11111111-1111-4111-8111-111111111111", operationId: "22222222-2222-4222-8222-222222222222", confirmationId: "33333333-3333-4333-8333-333333333333", baseRevision: 3, baseHash: "a".repeat(64), proposalHash: "b".repeat(64) }} />);
    expect(screen.getByRole("button", { name: "核对原规则确认" })).toBeEnabled(); expect(screen.getByRole("button", { name: "永久取消原规则确认" })).toBeDisabled(); expect(screen.getByText(/取消规则确认不会取消原对话/)).toBeVisible();
  });
});
