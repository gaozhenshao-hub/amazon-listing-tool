// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const f = vi.hoisted(() => ({
  adjust: vi.fn(),
  confirm: vi.fn(),
  invalidate: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      analysis: {
        getAggregation: { invalidate: f.invalidate },
        listByProject: { invalidate: f.invalidate },
      },
    }),
    analysis: {
      adjustCompetitor: {
        useMutation: () => ({ mutateAsync: f.adjust, isPending: false }),
      },
      confirmCompetitorAdjustment: {
        useMutation: () => ({ mutateAsync: f.confirm, isPending: false }),
      },
    },
  },
}));
import CompetitorAdjustmentDialog from "./CompetitorAdjustmentDialog";
const key = "module:M" + "a".repeat(24) + ":sellingPoints";
const baseline = { sourceHash: "b".repeat(64), revision: 3 };
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  f.adjust.mockResolvedValue({
    reply: "已把重复项合并，请查看预览",
    changes: [{ key, original: "", value: "防蜂间距5毫米" }],
    baseline,
  });
  f.confirm.mockResolvedValue({ saved: true });
  f.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);
const open = () =>
  render(
    <CompetitorAdjustmentDialog
      projectId={1}
      analysisId={1}
      target="translation"
      fieldKeys={[key]}
      label="当前 A+ 模块"
      study={{}}
      layout={null}
      onClose={f.close}
    />
  );
async function converse() {
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "合并重复的防护卖点" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("已把重复项合并，请查看预览");
}
it("starts with a single conversation and only saves after confirmation", async () => {
  open();
  expect(f.adjust).not.toHaveBeenCalled();
  expect(f.confirm).not.toHaveBeenCalled();
  await converse();
  expect(f.confirm).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "确认本次调整" })
  );
  await waitFor(() => expect(f.close).toHaveBeenCalledOnce());
  expect(f.confirm.mock.calls[0][0]).toMatchObject({
    improve: false,
    baseline,
    proposed: [{ key, value: "防蜂间距5毫米" }],
  });
});
it("previews the correction before explicitly saving it as an improvement", async () => {
  open();
  await converse();
  fireEvent.click(
    screen.getByRole("button", { name: "确认并用于改进" })
  );
  expect(f.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("独立改进草稿");
  fireEvent.click(
    screen.getByRole("button", { name: "确认保存并改进" })
  );
  await waitFor(() => expect(f.confirm).toHaveBeenCalledOnce());
  expect(f.confirm.mock.calls[0][0]).toMatchObject({
    improve: true,
    fieldKeys: [key],
  });
});
it("keeps the last proposal during another turn and requires unsent notes to be sent before saving", async () => {
  open();
  await converse();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "保留这个尺寸，解释一下依据" },
  });
  expect(
    screen.getByRole("button", { name: "确认本次调整" })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(f.adjust).toHaveBeenCalledTimes(2));
  expect(f.adjust.mock.calls[1][0].proposed).toEqual([
    { key, original: "", value: "防蜂间距5毫米" },
  ]);
  expect(f.confirm).not.toHaveBeenCalled();
});
it("keeps an unsaved discussion until the user explicitly exits", async () => {
  open();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "尚未发送的意见" },
  });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toHaveTextContent("尚未保存");
  fireEvent.click(
    screen.getByRole("button", { name: "继续调整" })
  );
  expect(f.close).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox")).toHaveValue("尚未发送的意见");
});
