// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import {
  blankImageOutline,
  emptyImageOutline,
  makeOutlineGroup,
} from "@shared/imagePlanning";
import { emptyImageDocument } from "@shared/imageDocument";
import { emptyListingAggregation } from "@shared/listingAggregation";
const f = vi.hoisted(() => ({
  query: null as any,
  plan: null as any,
  save: vi.fn(),
  lock: vi.fn(),
  outline: vi.fn(),
  content: vi.fn(),
  confirm: vi.fn(),
  dismiss: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      imageDocument: {
        get: { invalidate: f.invalidate },
        sketches: { invalidate: f.invalidate },
      },
      imagePlanning: { get: { invalidate: f.invalidate } },
      analysis: { researchLocks: { invalidate: f.invalidate } },
    }),
    imageDocument: {
      get: { useQuery: () => ({ data: f.query }) },
      sketches: { useQuery: () => ({ data: [] }) },
      references: { useQuery: () => ({ data: [] }) },
      sketch: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      checkSketch: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      saveWorkspace: { useMutation: () => ({ mutateAsync: f.save }) },
      lock: { useMutation: () => ({ mutateAsync: f.lock }) },
      start: { useMutation: () => ({ mutateAsync: f.content }) },
      confirm: { useMutation: () => ({ mutateAsync: f.confirm }) },
      dismiss: { useMutation: () => ({ mutateAsync: f.dismiss }) },
    },
    imagePlanning: {
      get: { useQuery: () => ({ data: f.plan }) },
      generate: { useMutation: () => ({ mutateAsync: f.outline }) },
      confirm: { useMutation: () => ({ mutateAsync: f.confirm }) },
      dismiss: { useMutation: () => ({ mutateAsync: f.dismiss }) },
    },
  },
}));
vi.mock("./ImageProductionWorkspace", () => ({
  ImageProductionWorkspace: ({ onPrompts, promptPreviewReady }: any) => <button onClick={onPrompts}>{promptPreviewReady ? "AI提示词结果预览" : "一键生成 AI 提示词"}</button>,
}));
vi.mock("./PlanningAssetPicker", () => ({ default: ({ onConfirm }: any) => (
  <button onClick={() => onConfirm({ images: [{ source: "knowledge", imageId: 18, label: "测试参考" }] })}>确认选图</button>
) }));
vi.mock("./AggregationSourceEvidence", () => ({ default: () => null }));
vi.mock("./ReviewEvidenceDialog", () => ({
  AggregationReviewEvidenceDialog: () => null,
}));
import SuiteDocumentWorkspace from "./SuiteDocumentWorkspace";
const register = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  const outline = emptyImageOutline();
  f.query = {
    outline,
    data: emptyImageDocument(),
    revision: 0,
    outlineRevision: 0,
    locked: false,
    upstream: emptyListingAggregation(),
    materials: [],
    tags: { categories: ["农业品"], styles: ["田园自然风"] },
    job: null,
    candidate: null,
  };
  f.plan = {
    data: outline,
    revision: 0,
    sourceHash: "source",
    job: null,
    candidate: null,
  };
  f.save.mockImplementation(async (input: any) => ({
    data: input.data,
    outline: input.outline,
    revision: input.revision + 1,
    outlineRevision: input.outlineRevision + 1,
  }));
  f.outline.mockResolvedValue({});
  f.content.mockResolvedValue({});
  f.lock.mockResolvedValue({ revision: 2 });
});
afterEach(cleanup);
it("套图文档只提供图片内容生成，图位链接打开第四步", () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  outline.groups[0].items[0].content = "卧室安静场景";
  f.query.outline = outline;
  f.query.data = emptyImageDocument(outline);
  const openProduction = vi.fn();
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} onProduction={openProduction} />);
  expect(screen.queryByRole("button", { name: "一键生成图片大纲" })).toBeNull();
  expect(screen.queryByRole("button", { name: "一键生成 AI 提示词" })).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "提示词与图片制作" })[0]);
  expect(openProduction).toHaveBeenCalledWith(outline.groups[0].items[0].id);
});
it("空白项目完整呈现模块规格但不自动保存、生成大纲或图片内容", () => {
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  const tableRegion = screen.getByRole("region", { name: "套图文档表格" });
  expect(within(tableRegion).getByRole("columnheader", { name: "模块与内容" })).toBeVisible();
  expect(within(tableRegion).getAllByRole("columnheader")).toHaveLength(7);
  const moduleContent = within(tableRegion).getByRole("textbox", { name: "主图模块内容" });
  expect(moduleContent).toHaveValue("");
  expect(moduleContent.closest("td")).toHaveTextContent("3个图位");
  expect(within(tableRegion).getByRole("button", { name: "主图下移" }).closest("td")).toBe(moduleContent.closest("td"));
  expect(screen.queryByRole("region", { name: "表格左右滚动" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "附图7模块内容" })).toHaveValue(
    ""
  );
  expect(
    screen.getByRole("textbox", { name: "品牌故事5模块内容" })
  ).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "一键生成图片内容" })
  ).toBeDisabled();
  expect(f.outline).not.toHaveBeenCalled();
  expect(f.content).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("内容生成可留空要求，默认保留人工修改并可取消勾选", async () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  outline.groups[0].items[0].content = "卧室安静场景";
  f.query.outline = outline;
  f.query.data = { ...emptyImageDocument(outline), organized: true };
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  fireEvent.click(screen.getByRole("button", { name: "一键生成图片内容" }));
  const preserve = screen.getByRole("checkbox", { name: "保留人工修改的内容" });
  expect(preserve).toBeChecked();
  fireEvent.click(preserve);
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() =>
    expect(f.content).toHaveBeenCalledWith(expect.objectContaining({
      mode: "generate", message: "", preserveManual: false,
    }))
  );
});
it("锁定文档的内容预览只有两个决定，放弃后恢复生成按钮", async () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  outline.groups[0].items[0].content = "原图内容";
  f.query.outline = outline;
  f.query.data = emptyImageDocument(outline);
  f.query.locked = true;
  const candidateId = crypto.randomUUID();
  f.query.candidate = {
    id: candidateId, data: f.query.data, mode: "generate", reply: "候选内容",
  };
  const view = render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  fireEvent.click(screen.getByRole("button", { name: "图片内容结果预览" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "确认本次结果" })).toBeEnabled();
  expect(within(dialog).queryByRole("button", { name: "改进" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "放弃本次结果" }));
  await waitFor(() => expect(f.dismiss).toHaveBeenCalledWith({ projectId: 1, candidateId }));
  f.query = { ...f.query, candidate: null };
  view.rerender(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  expect(screen.getByRole("button", { name: "一键生成图片内容" })).toBeEnabled();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.lock).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("解锁编辑独立调用文档锁，成功刷新后允许修改，不触发AI", async () => {
  f.query.locked = true;
  f.query.revision = 1;
  const view = render(
    <SuiteDocumentWorkspace projectId={1} registerSave={register} />
  );
  expect(screen.getByRole("textbox", { name: "主图模块内容" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "已锁定，仅浏览" }));
  await waitFor(() =>
    expect(f.lock).toHaveBeenCalledWith({
      projectId: 1,
      revision: 1,
      locked: false,
    })
  );
  f.query = { ...f.query, locked: false, revision: 2 };
  view.rerender(
    <SuiteDocumentWorkspace projectId={1} registerSave={register} />
  );
  expect(
    screen.getByRole("textbox", { name: "主图模块内容" })
  ).not.toBeDisabled();
  expect(f.outline).not.toHaveBeenCalled();
  expect(f.content).not.toHaveBeenCalled();
});
it("相邻A+合并同步高度与内容，原始细节可回看", async () => {
  const a = makeOutlineGroup("高级A+", "全宽背景图"),
    b = makeOutlineGroup("高级A+", "全宽背景图");
  a.items[0].content = "静音场景";
  b.items[0].content = "静音电机原理";
  f.query.outline = { ...emptyImageOutline(), groups: [a, b] };
  f.query.data = emptyImageDocument(f.query.outline);
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  fireEvent.click(screen.getAllByRole("button", { name: "合并模块" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "与A+2合并" }));
  expect(
    screen.getByRole("textbox", { name: "A+1+2模块内容" })
  ).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "A+1+2图1高度" })).toHaveValue(
    1200
  );
  expect(screen.getByText("已保留的历史图片文档")).toBeInTheDocument();
  expect(f.content).not.toHaveBeenCalled();
});

it("图片方案三栏展开显示，主副标题位置及具体图标不藏在折叠项里", () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  f.query.outline = outline;
  f.query.data = emptyImageDocument(outline);
  Object.assign(f.query.data.entries[0].copy, {
    headline: "Stay Comfortable",
    headlineZh: "保持舒适",
    headlinePosition: "主1左上",
    subtitle: "Move freely",
    subtitlePosition: "主标题下方",
    icons: [
      {
        id: crypto.randomUUID(),
        label: "Airflow",
        labelZh: "气流",
        visual: "三道气流箭头",
        position: "右下",
      },
    ],
  });
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  expect(screen.getAllByTestId("image-plan-columns")[0]).toHaveClass(
    "grid-cols-[1fr_1.1fr_1fr]"
  );
  expect(screen.getByText("Stay Comfortable")).toBeVisible();
  expect(screen.getByText("保持舒适").closest("small")).toBeVisible();
  expect(screen.getByText("气流").closest("small")).toBeVisible();
  expect(screen.getByText("位置：主1左上")).toBeVisible();
  expect(screen.getByText("三道气流箭头")).toBeVisible();
});
it("锁定且资料变化时仍能直接采用所见预览和人工高亮", async () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  f.query.outline = outline;
  f.query.data = emptyImageDocument(outline);
  f.query.revision = 3;
  f.query.locked = true;
  const data = structuredClone(f.query.data);
  data.entries[0].content = "人工画面内容";
  data.entries[0].manualFields = ["content"];
  const candidateId = crypto.randomUUID();
  f.query.candidate = { id: candidateId, data, mode: "generate", reply: "新方案", stale: true };
  f.confirm.mockResolvedValue({ data, revision: 4 });
  const view = render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  fireEvent.click(screen.getByRole("button", { name: "图片内容结果预览" }));
  expect(screen.getByTestId("preview-actions")).toHaveClass("shrink-0");
  const tableRegion = within(screen.getByRole("dialog")).getByRole("region", { name: "套图文档表格" });
  expect(within(tableRegion).getByRole("columnheader", { name: "模块与内容" })).toBeVisible();
  expect(within(screen.getByRole("dialog")).queryByRole("region", { name: "表格左右滚动" })).toBeNull();
  expect(within(screen.getByRole("dialog")).getByText("人工画面内容").tagName).toBe("MARK");
  fireEvent.click(screen.getByRole("button", { name: "确认本次结果" }));
  await waitFor(() => expect(f.confirm).toHaveBeenCalledWith({ projectId: 1, candidateId, improve: false }));
  f.query = { ...f.query, candidate: null, data, revision: 4 };
  view.rerender(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  expect(screen.getByRole("button", { name: "一键生成图片内容" })).toBeInTheDocument();
  expect(screen.getByText("人工画面内容").tagName).toBe("MARK");
  expect(f.lock).not.toHaveBeenCalled();
  expect(f.content).not.toHaveBeenCalled();
});


it("提示词候选展示五段内容，过期更新只生成提示词", async () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  f.query.outline = outline;
  f.query.data = emptyImageDocument(outline);
  f.query.data.organized = true;
  f.query.data.entries[0].prompts.scene = "只生成卧室背景，保留中央产品位置";
  f.query.candidate = {
    id: crypto.randomUUID(),
    data: f.query.data,
    mode: "promptSuite",
    reply: "提示词已生成",
    stale: true,
    history: [],
  };
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} production />);
  fireEvent.click(screen.getByRole("button", { name: "AI提示词结果预览" }));
  expect(
    screen.getByRole("dialog", { name: "AI提示词结果预览" })
  ).toBeVisible();
  expect(screen.getByText("只生成卧室背景，保留中央产品位置")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "按最新内容生成提示词" }));
  await waitFor(() =>
    expect(f.content).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "promptSuite" })
    )
  );
});

it("解锁的在用图位可编辑，即使另有待确认结果", () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  const item = outline.groups[0].items[0];
  item.content = "原画面";
  f.query.outline = outline;
  f.query.data = emptyImageDocument(outline);
  f.query.candidate = { id: crypto.randomUUID(), data: f.query.data, mode: "generate", reply: "待确认" };
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  fireEvent.click(screen.getAllByRole("button", { name: "编辑图片方案" })[0]);
  const sheet = screen.getByRole("dialog");
  expect(within(sheet).getByText("主图 · 主图 · 图片1")).toBeVisible();
  const content = within(sheet).getByRole("textbox", { name: "画面内容" });
  expect(content).toBeEnabled();
  fireEvent.change(content, { target: { value: "已编辑" } });
  expect(content).toHaveValue("已编辑");
  fireEvent.click(within(sheet).getByRole("button", { name: "参考与构图" }));
  expect(within(sheet).getByRole("heading", { name: "构图参考" })).toBeVisible();
  expect(within(sheet).queryByRole("heading", { name: "其他参考" })).toBeNull();
});

it("确认效果图选图立即保存并显示图片", async () => {
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  f.query.outline = outline;
  f.query.data = emptyImageDocument(outline);
  f.query.materials = [{ key: "knowledge:18", imageUrl: "/reference.png", title: "测试参考" }];
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  fireEvent.click(screen.getAllByRole("button", { name: "选择效果图参考" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "确认选图" }));
  await waitFor(() => expect(f.save).toHaveBeenCalled());
  expect(f.save.mock.calls[0][0].data.entries[0].references.effect[0].reference.imageId).toBe(18);
  expect(screen.getByRole("img", { name: "测试参考" })).toHaveAttribute("src", "/reference.png");
});

it("按覆盖数量排列图位，五类统计跳过白底主图", () => {
  const outline = blankImageOutline();
  const main = outline.groups[0];
  const detail = makeOutlineGroup("主图", "附图");
  const onlyMain = crypto.randomUUID(), withDetail = crypto.randomUUID();
  main.items[0].featureIds = [onlyMain, withDetail];
  detail.items[0].featureIds = [withDetail];
  outline.groups = [main, detail];
  f.query.outline = outline;
  f.query.data = emptyImageDocument(outline);
  f.query.upstream.features = [
    { id: withDetail, text: "副图覆盖功能", note: "", group: "quality" },
    { id: onlyMain, text: "仅主图关联功能", note: "", group: "quality" },
  ];
  render(<SuiteDocumentWorkspace projectId={1} registerSave={register} />);
  fireEvent.click(screen.getByRole("button", { name: "一键展开卖点覆盖度" }));
  const dialog = screen.getByRole("dialog", { name: "卖点覆盖度" });
  const rows = within(within(dialog).getByRole("region", { name: "功能" })).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("仅主图关联功能0 个图位");
  expect(rows[2]).toHaveTextContent("副图覆盖功能1 个图位");
});
