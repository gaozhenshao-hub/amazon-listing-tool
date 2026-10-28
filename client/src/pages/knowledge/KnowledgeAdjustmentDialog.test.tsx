// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
const mocks = vi.hoisted(() => ({
  data: {} as any,
  send: vi.fn(),
  discard: vi.fn(),
  confirm: vi.fn(),
  refresh: vi.fn(),
  close: vi.fn(),
  saved: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      knowledgeAssets: { adjustment: { invalidate: mocks.refresh } },
    }),
    knowledgeAssets: {
      adjustment: { useQuery: () => ({ data: mocks.data }) },
      sendAdjustment: { useMutation: () => ({ mutate: mocks.send }) },
      discardAdjustment: { useMutation: () => ({ mutate: mocks.discard }) },
      confirmAdjustment: { useMutation: () => ({ mutate: mocks.confirm }) },
    },
  },
}));
import KnowledgeAdjustmentDialog from "./KnowledgeAdjustmentDialog";
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mocks.data = {
    id: "draft",
    revision: 2,
    state: "open",
    kind: "image",
    messages: [
      { role: "user", text: "按两块信息区域判断" },
      { role: "assistant", text: "已调整为二分构图，请核对" },
    ],
    result: { tagComposition: "二分构图" },
    changes: [
      {
        key: "tagComposition",
        label: "构图",
        before: "一分构图",
        after: "二分构图",
      },
    ],
    improvement: "按独立信息区域判断构图，不按产品数量判断。",
    improvementScope: "当前团队的后续打标",
    sharedSet: false,
  };
});
afterEach(cleanup);
const open = () =>
  render(
    <KnowledgeAdjustmentDialog
      id="draft"
      onClose={mocks.close}
      onSaved={mocks.saved}
    />
  );
describe("knowledge adjustment confirmation", () => {
  it("supports another message without implicitly saving the current result", () => {
    open();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "右侧还包含一个特写，解释一下" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(mocks.send).toHaveBeenCalledWith({
      id: "draft",
      revision: 2,
      text: "右侧还包含一个特写，解释一下",
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("saves this result alone when requested", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "确认本次调整" }));
    expect(mocks.confirm).toHaveBeenCalledWith({
      id: "draft",
      revision: 2,
      improve: false,
    });
  });
  it("previews exact improvement and scope before the second confirmation", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "确认并用于改进" }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "按独立信息区域判断构图"
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("当前团队");
    fireEvent.click(screen.getByRole("button", { name: "确认保存并改进" }));
    expect(mocks.confirm).toHaveBeenCalledWith({
      id: "draft",
      revision: 2,
      improve: true,
    });
  });
  it("keeps unsaved discussion on cancel and discards only after explicit exit", () => {
    open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("尚未保存");
    fireEvent.click(screen.getByRole("button", { name: "继续调整" }));
    expect(mocks.discard).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "放弃并退出" }));
    expect(mocks.discard).toHaveBeenCalledWith({ id: "draft" });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
