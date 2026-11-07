// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { emptyImageDocument } from "@shared/imageDocument";
import { blankImageOutline } from "@shared/imagePlanning";
import { emptyListingAggregation } from "@shared/listingAggregation";
const f = vi.hoisted(() => ({
  status: null as any,
  save: vi.fn(),
  lock: vi.fn(),
  start: vi.fn(),
  confirm: vi.fn(),
  dismiss: vi.fn(),
  sync: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ imageDocument: { get: { invalidate: f.invalidate } } }),
    imageDocument: {
      get: { useQuery: () => ({ data: f.status, refetch: f.refetch }) },
      references: { useQuery: () => ({ data: [] }) },
      save: { useMutation: () => ({ mutateAsync: f.save }) },
      lock: { useMutation: () => ({ mutateAsync: f.lock }) },
      start: { useMutation: () => ({ mutateAsync: f.start }) },
      confirm: { useMutation: () => ({ mutateAsync: f.confirm }) },
      dismiss: { useMutation: () => ({ mutateAsync: f.dismiss }) },
      sync: { useMutation: () => ({ mutateAsync: f.sync }) },
    },
  },
}));
vi.mock("./PlanningAssetPicker", () => ({ default: () => null }));
import ImageDocumentEditor from "./ImageDocumentEditor";
beforeEach(() => {
  vi.clearAllMocks();
  const outline = blankImageOutline();
  outline.groups = outline.groups.slice(0, 1);
  outline.groups[0].items = outline.groups[0].items.slice(0, 1);
  outline.groups[0].items[0].title = "防护结构展示";
  outline.groups[0].items[0].content = "展示本品与六个口袋";
  f.status = {
    data: emptyImageDocument(outline),
    outline,
    revision: 1,
    locked: false,
    materials: [],
    upstream: emptyListingAggregation(),
    tags: { categories: ["农业品"], styles: ["田园自然风"] },
    job: null,
    candidate: null,
    outlineChanged: false,
  };
  f.save.mockImplementation(async (input: any) => ({
    data: input.data,
    revision: input.revision + 1,
  }));
  f.lock.mockResolvedValue({ revision: 3 });
  f.refetch.mockResolvedValue({ data: f.status });
  f.start.mockResolvedValue({ runId: "run" });
});
afterEach(cleanup);
it("打开和浏览不触发AI，首次点击才创建文档任务", async () => {
  render(<ImageDocumentEditor projectId={1} />);
  expect(screen.getByText("防护结构展示")).toBeInTheDocument();
  expect(f.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看与编辑文档" }));
  expect(
    screen.getByRole("button", { name: "分步提示词" })
  ).toBeInTheDocument();
  expect(f.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "一键制作套图文档" }));
  await waitFor(() =>
    expect(f.start).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, mode: "generate", revision: 1 })
    )
  );
});
it("锁定先保存人工修改，再锁定；编辑不会自动重做AI", async () => {
  render(<ImageDocumentEditor projectId={1} />);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "农业品" },
  });
  fireEvent.click(screen.getByRole("button", { name: "已解锁，可编辑" }));
  await waitFor(() =>
    expect(f.lock).toHaveBeenCalledWith({
      projectId: 1,
      revision: 2,
      locked: true,
    })
  );
  expect(f.save.mock.calls[0][0].data).toMatchObject({
    category: "农业品",
    manualFields: ["category"],
  });
  expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(
    f.lock.mock.invocationCallOrder[0]
  );
  expect(f.start).not.toHaveBeenCalled();
});
it("重新整理先收集改进意见，未提交不触发", async () => {
  f.status.data.organized = true;
  render(<ImageDocumentEditor projectId={1} />);
  fireEvent.click(screen.getByRole("button", { name: "重新整理套图文档" }));
  expect(f.start).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "重新整理改进意见" }), {
    target: { value: "减少文案，强调六口袋实拍" },
  });
  fireEvent.click(screen.getByRole("button", { name: "开始重新整理" }));
  await waitFor(() =>
    expect(f.start).toHaveBeenCalledWith(
      expect.objectContaining({ message: "减少文案，强调六口袋实拍" })
    )
  );
});
it("取消预览只放弃候选，不保存或覆盖原文档", async () => {
  f.status.candidate = {
    id: crypto.randomUUID(),
    data: f.status.data,
    reply: "这是候选",
    history: [],
    stale: false,
  };
  render(<ImageDocumentEditor projectId={1} />);
  fireEvent.click(screen.getByRole("button", { name: "套图文档结果预览" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(f.dismiss).toHaveBeenCalledOnce());
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("有待确认结果时，原任务按钮变为预览，不重复提供制作按钮", () => {
  f.status.candidate = {
    id: crypto.randomUUID(),
    data: f.status.data,
    reply: "这是候选",
    history: [],
    stale: false,
  };
  render(<ImageDocumentEditor projectId={1} />);
  expect(
    screen.getByRole("button", { name: "套图文档结果预览" })
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "一键制作套图文档" })
  ).not.toBeInTheDocument();
  expect(f.start).not.toHaveBeenCalled();
});
it("新空项目保持正常结构，提示返回大纲，且不运行AI", () => {
  f.status.outline.groups = [];
  f.status.data = emptyImageDocument();
  render(<ImageDocumentEditor projectId={14} />);
  expect(
    screen.getByText(/完成图片大纲后，每张图会显示在这里/)
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "一键制作套图文档" })
  ).toBeDisabled();
  expect(f.start).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("锁定时只浏览，不能修改文档或触发AI", () => {
  f.status.locked = true;
  render(<ImageDocumentEditor projectId={1} />);
  expect(screen.getByRole("button", { name: "已锁定，仅浏览" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "一键制作套图文档" })
  ).toBeDisabled();
  expect(screen.getByRole("combobox")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "查看与编辑文档" }));
  expect(screen.getByRole("button", { name: "调整结果（AI）" })).toBeDisabled();
  expect(f.start).not.toHaveBeenCalled();
});
