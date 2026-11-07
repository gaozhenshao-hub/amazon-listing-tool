// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { emptyImageDocument } from "@shared/imageDocument";
import { blankImageOutline } from "@shared/imagePlanning";
import {
  emptyProductionState,
  imagePromptSourceHash,
} from "@shared/imageProduction";
const f = vi.hoisted(() => ({
  status: null as any,
  save: vi.fn(),
  open: vi.fn(),
  chat: vi.fn(),
  generate: vi.fn(),
  adopt: vi.fn(),
  refetch: vi.fn(),
  history: null as any,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      imageProduction: { get: { invalidate: f.refetch } },
      designStudio: { history: { invalidate: f.refetch } },
    }),
    imageProduction: {
      get: { useQuery: () => ({ data: f.status, refetch: f.refetch }) },
      saveReferences: { useMutation: () => ({ mutateAsync: f.save }) },
      open: { useMutation: () => ({ mutateAsync: f.open }) },
      adopt: { useMutation: () => ({ mutateAsync: f.adopt }) },
    },
    designStudio: {
      history: { useQuery: () => ({ data: f.history }) },
      chat: { useMutation: () => ({ mutateAsync: f.chat }) },
      generate: { useMutation: () => ({ mutateAsync: f.generate }) },
      check: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
import { ImageProductionWorkspace } from "./ImageProductionWorkspace";
const onSave = vi.fn(),
  onPrompts = vi.fn(),
  onChange = vi.fn();
let document: ReturnType<typeof emptyImageDocument>;
beforeEach(() => {
  vi.clearAllMocks();
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  document = emptyImageDocument(outline);
  document.organized = true;
  document.entries[0].prompts.composition = "生成结构图";
  document.entries[0].prompts.interaction = "处理接触与光影融合";
  document.entries[0].prompts.scene = "场景背景";
  document.entries[0].prompts.product = "产品嵌入";
  document.entries[0].prompts.textIcons = "文字图标";
  document.entries[0].promptSourceHash = imagePromptSourceHash(
    document.entries[0],
    document
  );
  f.status = {
    revision: 1,
    data: emptyProductionState(),
    fallbackPhotos: [{ id: crypto.randomUUID(), name: "本品正面.jpg" }],
    current: {
      composition: false,
      scene: false,
      product: false,
      textIcons: false,
    },
  };
  f.history = { chats: [], items: [] };
  onSave.mockResolvedValue(true);
  f.open.mockResolvedValue({
    conversationId: crypto.randomUUID(),
    stage: "composition",
    prompt: "自动带入的构图提示词",
    references: [],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function show() {
  render(
    <ImageProductionWorkspace
      projectId={1}
      document={document}
      locked={false}
      busy={false}
      onSave={onSave}
      onPrompts={onPrompts}
      onEntryChange={onChange}
    />
  );
}
it("浏览不自动调用AI，提供五段提示词和按依赖开启的四个按钮", () => {
  show();
  expect(f.open).not.toHaveBeenCalled();
  expect(f.chat).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "1. 生成构图" })).toBeEnabled();
  for (const name of ["2. 场景及背景生成", "3. 产品嵌入", "4. 文字和图标"])
    expect(screen.getByRole("button", { name })).toBeDisabled();
  expect(
    screen.getByRole("textbox", { name: "④ 交互与光影融合制作提示词" })
  ).toBeVisible();
});
it("无指定本品图时清楚显示补充照片来源", () => {
  show();
  expect(screen.getByText("本品正面.jpg")).toBeVisible();
  expect(screen.getByText(/将使用“本品信息补充”的 1 张照片/)).toBeVisible();
});
it("图片方案变化后四步制作停止，已有提示词仍然可见", () => {
  document.entries[0].content = "更新方案";
  show();
  expect(screen.getByRole("button", { name: "1. 生成构图" })).toBeDisabled();
  expect(
    screen.getByRole("textbox", { name: "① 整体构图制作提示词" })
  ).toHaveValue("生成结构图");
});
it("打开第一步只准备对话，运营发送后才调用模型", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "1. 生成构图" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "图片制作对话" })).toHaveValue(
      "自动带入的构图提示词"
    )
  );
  expect(onSave).toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "发送给美工助手" }));
  await waitFor(() =>
    expect(f.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "自动带入的构图提示词",
        references: [],
        referenceMode: "replace",
      })
    )
  );
});
it("一键生成提示词单独触发，不自动提交生图", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "一键生成 AI 提示词" }));
  expect(onPrompts).toHaveBeenCalledOnce();
  expect(f.generate).not.toHaveBeenCalled();
});
it("支持粘贴本品图并保存到当前图位", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "00000000-0000-4000-8000-000000000009" }),
    })
  );
  show();
  const file = new File(["image"], "本品.png", { type: "image/png" });
  fireEvent.paste(screen.getByRole("region", { name: "本品参考图上传区" }), {
    clipboardData: { files: [file] },
  });
  await waitFor(() =>
    expect(f.save).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        imageId: document.entries[0].imageId,
        kind: "productAssets",
        assets: ["00000000-0000-4000-8000-000000000009"],
      })
    )
  );
});
