import { beforeEach, expect, it, vi } from "vitest";
import { emptyImageDocument } from "../../../shared/imageDocument";
import { blankImageOutline } from "../../../shared/imagePlanning";
import {
  emptyProductionState,
  productionInputHash,
  productionStageCurrent,
  productionPrompt,
  imagePromptSourceHash,
  productionPromptsReady,
} from "../../../shared/imageProduction";

const f = vi.hoisted(() => ({
  document: null as any,
  state: null as any,
  photos: [] as any[],
  execute: vi.fn(),
  asset: vi.fn(),
  imports: vi.fn(),
  permissions: vi.fn(),
}));
vi.mock("./imageDocumentStore", () => ({
  readImageDocument: async () => ({
    data: f.document,
    revision: 1,
    locked: false,
  }),
}));
vi.mock("./imagePlanningSources", () => ({
  imagePlanningSources: async () => ({ input: { ownProductPhotos: f.photos } }),
}));
vi.mock("./imageDocumentMaterials", () => ({
  documentActor: async () => ({ id: 2, role: "admin" }),
  resolveDocumentMaterials: async () => [],
}));
vi.mock("../../services/securityGovernance", () => ({
  assertResourceAction: (...args: any[]) => f.permissions(...args),
}));
vi.mock("../design/repository", () => ({
  execute: (...args: any[]) => f.execute(...args),
  transaction: async (fn: any) => fn({}),
  jsonValue: (v: any, fallback: any) =>
    typeof v === "string" ? JSON.parse(v) : (v ?? fallback),
  ownAsset: (...args: any[]) => f.asset(...args),
}));
vi.mock("../design/assets", () => ({
  saveAsset: (...args: any[]) => f.imports(...args),
}));
vi.mock("../ai_os/services/assistantConfigurations", () => ({
  skillManifestHash: () => "skill-hash",
  assistantConfigurationService: {
    get: async () => ({
      status: "configured",
      record: {
        config: {
          enabled: true,
          skills: ["composition", "scene", "product", "text"].map(key => ({
            slug: `listing.images.production.${key}.v1`,
            enabled: true,
            version: 1,
            manifestSha256: "skill-hash",
            instructions: "",
          })),
        },
      },
    }),
  },
}));
import {
  openProductionStep,
  saveProductionReferences,
  productionConversationContext,
  adoptProductionImage,
} from "./imageProduction";
const scope = { projectId: 1, workspaceId: 1, userId: 2 };
const asset1 = "00000000-0000-4000-8000-000000000001",
  asset2 = "00000000-0000-4000-8000-000000000002";
const conversationId = "00000000-0000-4000-8000-000000000003";
beforeEach(() => {
  vi.clearAllMocks();
  const outline = blankImageOutline();
  outline.groups = [outline.groups[0]];
  f.document = emptyImageDocument(outline);
  f.document.organized = true;
  const entry = f.document.entries[0];
  entry.prompts = {
    composition: "结构图",
    scene: "场景",
    product: "产品",
    interaction: "融合",
    textIcons: "文字",
  };
  entry.promptSourceHash = imagePromptSourceHash(entry, f.document);
  f.state = emptyProductionState();
  f.photos = [];
  f.asset.mockResolvedValue({ id: asset1 });
  f.permissions.mockResolvedValue(undefined);
  f.execute.mockImplementation(async (query: string, values: any[]) => {
    if (query.includes("JSON_SEARCH"))
      return [{ project_id: 1, image_id: entry.imageId, data: f.state }];
    if (query.startsWith("SELECT revision,data"))
      return [{ revision: 1, data: f.state }];
    if (query.includes("FROM emperor_skills"))
      return [
        {
          version: 1,
          manifest: { implementation: { systemPrompt: "实际步骤方法" } },
        },
      ];
    if (query.startsWith("UPDATE listing_image_productions")) {
      f.state = JSON.parse(values[0]);
      return { affectedRows: 1 };
    }
    return [];
  });
});
function accept(
  stage: "composition" | "scene" | "product" | "textIcons",
  asset = asset1
) {
  f.document.entries[0].promptSourceHash = imagePromptSourceHash(
    f.document.entries[0],
    f.document
  );
  const stageId =
    stage === "composition"
      ? conversationId
      : stage === "scene"
        ? "00000000-0000-4000-8000-000000000004"
        : stage === "product"
          ? "00000000-0000-4000-8000-000000000005"
          : "00000000-0000-4000-8000-000000000006";
  f.state.stages[stage] = {
    conversationId: stageId,
    inputHash: productionInputHash(
      f.document.entries[0],
      f.state,
      stage,
      f.photos
    ),
    prompt: "p",
    references: [],
    acceptedAssetId: asset,
    acceptedGenerationId: asset2,
    skillVersion: 1,
    skillHash: "skill-hash",
  };
}
it("第一步无参考图也能打开，未触发任何付费生成", async () => {
  const result = await openProductionStep(
    scope,
    f.document.entries[0].imageId,
    "composition"
  );
  expect(result.references).toEqual([]);
  expect(result.prompt).toContain("结构图");
  expect(
    f.execute.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO design_generations")
    )
  ).toBe(false);
});
it("第二步不能越过未采用的结构图", async () => {
  await expect(
    openProductionStep(scope, f.document.entries[0].imageId, "scene")
  ).rejects.toThrow("上一步");
});
it("第三步优先使用当前图位本品图，不读取补充照片", async () => {
  accept("composition");
  accept("scene", asset2);
  f.state.productAssets = [asset1];
  f.photos = [{ id: asset2, name: "补充照片", storageKey: "不可读取的路径" }];
  const result = await openProductionStep(
    scope,
    f.document.entries[0].imageId,
    "product"
  );
  expect(result.references).toEqual([asset2, asset1]);
  expect(f.imports).not.toHaveBeenCalled();
  expect(result.prompt).toContain("产品\n\n融合");
});
it("第三步缺少本品图时明确阻止，不拿效果图冒充", async () => {
  f.document.entries[0].scenes = [
    {
      id: asset1,
      name: "场景",
      region: "主1",
      background: "房间",
      productPresent: true,
      product: "产品",
      interaction: "",
      lighting: "",
      camera: "",
    },
  ];
  accept("composition");
  accept("scene");
  await expect(
    openProductionStep(scope, f.document.entries[0].imageId, "product")
  ).rejects.toThrow("缺少本品参考图");
});
it("改变结构稿后，下游保留旧图但不再有效", () => {
  accept("composition");
  accept("scene");
  accept("product");
  expect(
    productionStageCurrent(f.document.entries[0], f.state, "product")
  ).toBe(true);
  f.state.stages.composition.acceptedAssetId = asset2;
  expect(
    productionStageCurrent(f.document.entries[0], f.state, "product")
  ).toBe(false);
  expect(f.state.stages.product.acceptedAssetId).toBe(asset1);
});
it("第四步文案变动后不能继续使用旧对话生成", async () => {
  accept("composition");
  accept("scene");
  accept("product");
  accept("textIcons");
  f.document.entries[0].copy.headline = "新标题";
  await expect(
    productionConversationContext(
      scope,
      f.state.stages.textIcons.conversationId
    )
  ).rejects.toThrow("图片方案已变化");
});
it("引用图片必须属于当前用户", async () => {
  f.asset.mockResolvedValue(null);
  await expect(
    saveProductionReferences(scope, {
      imageId: f.document.entries[0].imageId,
      revision: 1,
      kind: "productAssets",
      assets: [asset1],
    })
  ).rejects.toThrow("无权");
});
it("采用接口拒绝与当前步骤不匹配的项目", async () => {
  accept("composition");
  await expect(
    adoptProductionImage(
      { ...scope, projectId: 9 },
      {
        imageId: f.document.entries[0].imageId,
        stage: "composition",
        conversationId,
        generationId: asset2,
        assetId: asset1,
      }
    )
  ).rejects.toThrow("不属于");
});
it("产品制作实际使用嵌入和交互两段提示词", () => {
  expect(productionPrompt(f.document.entries[0], "product")).toBe(
    "产品\n\n融合"
  );
});
it("五段提示词必须对应当前方案，修改配色或场景后需重新确认", () => {
  const entry = f.document.entries[0];
  expect(productionPromptsReady(entry, f.document)).toBe(true);
  entry.prompts.scene = "运营微调提示词";
  expect(productionPromptsReady(entry, f.document)).toBe(true);
  f.document.palette[0].color = "#112233";
  expect(productionPromptsReady(entry, f.document)).toBe(false);
});
it("采用成功图后保存结果，其他生成任务的图不能采用", async () => {
  accept("composition");
  const original = f.execute.getMockImplementation()!;
  f.execute.mockImplementation(async (sql: string, values: any[]) =>
    sql.startsWith("SELECT assetIds")
      ? [{ assetIds: [asset1] }]
      : original(sql, values)
  );
  const input = {
    imageId: f.document.entries[0].imageId,
    stage: "composition" as const,
    conversationId,
    generationId: asset2,
    assetId: asset1,
  };
  await adoptProductionImage(scope, input);
  expect(f.state.stages.composition.acceptedGenerationId).toBe(asset2);
  await expect(
    adoptProductionImage(scope, { ...input, assetId: asset2 })
  ).rejects.toThrow("已经完成");
});
