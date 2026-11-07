import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import {
  IMAGE_PRODUCTION_STAGES,
  emptyProductionState,
  productionStateSchema,
  productionInputHash,
  productionStageCurrent,
  productionPrompt,
  productionPromptsReady,
  type ProductionStage,
  type ProductionState,
} from "../../../shared/imageProduction";
import { readImageDocument } from "./imageDocumentStore";
import { imagePlanningSources } from "./imagePlanningSources";
import type { PlanningScope } from "./imagePlanningStore";
import {
  documentActor,
  resolveDocumentMaterials,
} from "./imageDocumentMaterials";
import { assertResourceAction } from "../../services/securityGovernance";
import {
  execute,
  transaction,
  jsonValue,
  ownAsset,
} from "../design/repository";
import { saveAsset } from "../design/assets";
import { parseStorageUri } from "../../storage";
import { verifiedLocalObjectPath } from "../../infrastructure/localObjectStorage";
import {
  assistantConfigurationService,
  skillManifestHash,
} from "../ai_os/services/assistantConfigurations";

const conflict = (message: string): never => {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
};
export async function productionSkill(
  scope: PlanningScope,
  stage: ProductionStage
) {
  const descriptor = IMAGE_PRODUCTION_STAGES.find(s => s.key === stage)!;
  const configured = await assistantConfigurationService.get(
    scope.workspaceId,
    "images"
  );
  const binding =
    configured.status === "configured" && configured.record.config.enabled
      ? configured.record.config.skills.find(
          s => s.slug === descriptor.skill && s.enabled
        )
      : null;
  const rows = await execute(
    "SELECT version,manifest FROM emperor_skills WHERE slug=? AND status='Released' AND (workspaceId=? OR (workspaceId IS NULL AND scope='global')) ORDER BY workspaceId DESC LIMIT 1",
    [descriptor.skill, scope.workspaceId]
  );
  const skill = rows[0];
  if (
    !binding ||
    !skill ||
    Number(binding.version) !== Number(skill.version) ||
    binding.manifestSha256 !== skillManifestHash(skill.manifest)
  )
    return conflict(`请先配置并启用“${descriptor.name}”技能`);
  const manifest = jsonValue<any>(skill.manifest, {});
  if (typeof manifest.implementation?.systemPrompt !== "string")
    return conflict("当前制作技能尚未就绪");
  return {
    version: Number(skill.version),
    hash: binding.manifestSha256,
    instruction:
      manifest.implementation.systemPrompt + "\n" + binding.instructions,
  };
}
async function row(
  scope: PlanningScope,
  imageId: string,
  tx?: any,
  lock = false
) {
  const rows = await execute(
    `SELECT revision,data FROM listing_image_productions WHERE project_id=? AND workspace_id=? AND user_id=? AND image_id=?${lock ? " FOR UPDATE" : ""}`,
    [scope.projectId, scope.workspaceId, scope.userId, imageId],
    tx
  );
  return rows[0]
    ? {
        revision: Number(rows[0].revision),
        data: productionStateSchema.parse(jsonValue(rows[0].data, {})),
      }
    : { revision: 0, data: emptyProductionState() };
}
async function write(
  scope: PlanningScope,
  imageId: string,
  revision: number,
  data: ProductionState,
  tx: any
) {
  if (revision)
    await execute(
      "UPDATE listing_image_productions SET data=?,revision=revision+1 WHERE project_id=? AND workspace_id=? AND user_id=? AND image_id=? AND revision=?",
      [
        JSON.stringify(data),
        scope.projectId,
        scope.workspaceId,
        scope.userId,
        imageId,
        revision,
      ],
      tx
    );
  else
    await execute(
      "INSERT INTO listing_image_productions(project_id,workspace_id,user_id,image_id,data,revision) VALUES(?,?,?,?,?,1)",
      [
        scope.projectId,
        scope.workspaceId,
        scope.userId,
        imageId,
        JSON.stringify(data),
      ],
      tx
    );
  return { revision: revision + 1, data };
}
async function inputs(scope: PlanningScope, imageId: string) {
  await assertResourceAction({
    actor: await documentActor(scope),
    resource: "project",
    action: "read",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
  });
  const document = await readImageDocument(scope);
  const entry = document.data.entries.find(e => e.imageId === imageId);
  if (!entry) return conflict("当前图位已移除，请返回套图文档核对");
  const sources = await imagePlanningSources(scope);
  return { document, entry, photos: sources.input.ownProductPhotos || [] };
}
async function checkAssets(scope: PlanningScope, ids: string[]) {
  for (const id of ids)
    if (!(await ownAsset(id, scope)))
      return conflict("参考图不存在或无权使用，请重新选择");
}
export async function productionStatus(scope: PlanningScope, imageId: string) {
  const [current, context] = await Promise.all([
    row(scope, imageId),
    inputs(scope, imageId),
  ]);
  const ready = productionPromptsReady(context.entry, context.document.data);
  return {
    ...current,
    fallbackPhotos: context.photos.map(({ storageKey: _key, ...p }) => p),
    current: Object.fromEntries(
      IMAGE_PRODUCTION_STAGES.map(s => [
        s.key,
        ready &&
          productionStageCurrent(
            context.entry,
            current.data,
            s.key,
            context.photos
          ),
      ])
    ) as Record<ProductionStage, boolean>,
  };
}
export async function saveProductionReferences(
  scope: PlanningScope,
  input: {
    imageId: string;
    revision: number;
    kind: "productAssets" | "compositionAssets";
    assets: string[];
  }
) {
  await inputs(scope, input.imageId);
  await checkAssets(scope, input.assets);
  return transaction(async tx => {
    await execute(
      "SELECT id FROM projects WHERE id=? AND workspaceId=? FOR UPDATE",
      [scope.projectId, scope.workspaceId],
      tx
    );
    const current = await row(scope, input.imageId, tx, true);
    if (current.revision !== input.revision)
      return conflict("参考图已更新，请刷新后再保存");
    const data = productionStateSchema.parse({
      ...current.data,
      [input.kind]: [...new Set(input.assets)],
    });
    return write(scope, input.imageId, current.revision, data, tx);
  });
}
async function importStored(
  scope: PlanningScope,
  storageKey: string,
  name: string
) {
  const stored = parseStorageUri(storageKey);
  if (!stored || stored.provider !== "local")
    return conflict("参考原图暂时无法读取，请重新上传图片");
  const file = await verifiedLocalObjectPath(stored.key);
  const bytes = await readFile(file);
  if (bytes.length > 10 * 1024 * 1024)
    return conflict("参考原图超过10MB，请压缩后上传");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const existing = await execute(
    "SELECT id FROM design_assets WHERE workspaceId=? AND userId=? AND sha256=? LIMIT 1",
    [scope.workspaceId, scope.userId, hash]
  );
  return existing[0]
    ? String(existing[0].id)
    : (await saveAsset(scope, bytes, name, "reference")).id;
}
export async function openProductionStep(
  scope: PlanningScope,
  imageId: string,
  stage: ProductionStage
) {
  const before = await row(scope, imageId);
  const context = await inputs(scope, imageId);
  const { entry, photos } = context;
  if (!context.document.data.organized)
    return conflict("请先确认图片内容，再生成提示词和制作图片");
  if (!entry.width || !entry.height)
    return conflict("纯文字模块不需要生成图片");
  if (!productionPromptsReady(entry, context.document.data))
    return conflict("请先一键生成并确认新版五段提示词，再按四步制作图片");
  const prompt = productionPrompt(entry, stage);
  if (!prompt.trim()) return conflict("请先生成并确认该步骤提示词");
  const index = IMAGE_PRODUCTION_STAGES.findIndex(s => s.key === stage);
  if (
    index &&
    !productionStageCurrent(
      entry,
      before.data,
      IMAGE_PRODUCTION_STAGES[index - 1].key,
      photos
    )
  )
    return conflict("请先采用上一步的最新图片");
  const inputHash = productionInputHash(entry, before.data, stage, photos);
  const skill = await productionSkill(scope, stage);
  if (
    before.data.stages[stage]?.inputHash === inputHash &&
    before.data.stages[stage]?.skillVersion === skill.version &&
    before.data.stages[stage]?.skillHash === skill.hash
  )
    return { ...before.data.stages[stage]!, stage };
  const references: string[] = [];
  const labels: string[] = [];
  if (index) {
    references.push(
      before.data.stages[IMAGE_PRODUCTION_STAGES[index - 1].key]!
        .acceptedAssetId!
    );
    labels.push("上一步已采用结果，保留未要求改变的画面");
  }
  if (stage === "composition" && before.data.compositionAssets.length) {
    references.push(...before.data.compositionAssets);
    labels.push(
      ...before.data.compositionAssets.map(
        () => "人工构图参考：只借用区域、形状、布局和比例"
      )
    );
  } else if (stage === "composition" || stage === "scene") {
    const selected =
      stage === "composition"
        ? entry.references.composition
        : entry.references.effect;
    for (const ref of selected) {
      const [material] = await resolveDocumentMaterials(
        scope,
        [ref.reference],
        { strict: true }
      );
      if (!material.storageKey) return conflict("参考原图不可用，请重新选择");
      references.push(
        await importStored(scope, material.storageKey, material.title)
      );
      labels.push(
        stage === "composition"
          ? "人工构图参考，只参考结构布局"
          : "效果参考，仅参考风格、光线、色调与质感"
      );
    }
  } else if (stage === "product") {
    if (before.data.productAssets.length) {
      references.push(...before.data.productAssets);
      labels.push(
        ...before.data.productAssets.map(
          () => "当前图位指定的本品照片：决定产品外观、结构与配件"
        )
      );
    } else {
      if (!photos.length && entry.scenes.some(s => s.productPresent))
        return conflict(
          "缺少本品参考图，请上传或粘贴；也可在本品信息补充中上传"
        );
      for (const photo of photos) {
        references.push(
          await importStored(scope, photo.storageKey, photo.name)
        );
        labels.push("本品信息补充中的照片：决定产品外观、结构与配件");
      }
    }
  }
  if (new Set(references).size !== references.length)
    return conflict("参考图片重复，请分别选择本步骤需要的素材");
  if (references.length > 16)
    return conflict("参考图片超过16张，请明确选择本次需要的图片");
  await checkAssets(scope, references);
  const combined = [
    prompt,
    "\n参考图片用途（顺序与图片编号一致）：",
    ...labels.map((label, i) => `${i + 1}. ${label}`),
  ].join("\n");
  if (combined.length > 8000)
    return conflict("本步骤提示词较长，请缩短到8000字以内再制作");
  return transaction(async tx => {
    await execute(
      "SELECT id FROM projects WHERE id=? AND workspaceId=? FOR UPDATE",
      [scope.projectId, scope.workspaceId],
      tx
    );
    const latest = await row(scope, imageId, tx, true);
    const fresh = await inputs(scope, imageId);
    if (
      latest.revision !== before.revision ||
      productionInputHash(fresh.entry, latest.data, stage, fresh.photos) !==
        inputHash
    )
      return conflict("图片方案或参考图已变化，请重新打开制作步骤");
    const step = {
      conversationId: randomUUID(),
      inputHash,
      prompt: combined,
      references,
      skillVersion: skill.version,
      skillHash: skill.hash,
    };
    await execute(
      "INSERT INTO design_conversations(id,workspaceId,userId,title,kind) VALUES(?,?,?,?,?)",
      [
        step.conversationId,
        scope.workspaceId,
        scope.userId,
        `${entry.title || "图片"} · ${IMAGE_PRODUCTION_STAGES[index].label}`.slice(
          0,
          120
        ),
        "listing",
      ],
      tx
    );
    const previous = latest.data.stages[stage];
    if (previous) latest.data.archives.push({ ...previous, stage });
    latest.data.stages[stage] = step;
    await write(scope, imageId, latest.revision, latest.data, tx);
    return { ...step, stage };
  });
}
/** Enforced again for each chat, paid generation and result adoption. */
export async function productionConversationContext(
  scope: { workspaceId: number; userId: number },
  conversationId: string
) {
  const rows = await execute(
    "SELECT project_id,image_id,data FROM listing_image_productions WHERE workspace_id=? AND user_id=? AND JSON_SEARCH(data,'one',?,NULL,'$.stages.*.conversationId') IS NOT NULL LIMIT 1",
    [scope.workspaceId, scope.userId, conversationId]
  );
  if (!rows[0])
    return conflict("该制作对话已被新版本替代，请从当前图位重新打开");
  const productionScope = { ...scope, projectId: Number(rows[0].project_id) };
  const state = productionStateSchema.parse(jsonValue(rows[0].data, {}));
  const stage = IMAGE_PRODUCTION_STAGES.find(
    s => state.stages[s.key]?.conversationId === conversationId
  )!.key;
  const context = await inputs(productionScope, String(rows[0].image_id));
  if (!productionPromptsReady(context.entry, context.document.data))
    return conflict("图片方案已变化，请先更新并确认五段提示词，再继续制作");
  const step = state.stages[stage]!;
  const index = IMAGE_PRODUCTION_STAGES.findIndex(s => s.key === stage);
  if (
    productionInputHash(context.entry, state, stage, context.photos) !==
      step.inputHash ||
    (index &&
      !productionStageCurrent(
        context.entry,
        state,
        IMAGE_PRODUCTION_STAGES[index - 1].key,
        context.photos
      ))
  )
    return conflict(
      "上游方案或参考图已更新，请从图位重新打开该步骤；已有图片和对话会保留"
    );
  const skill = await productionSkill(productionScope, stage);
  if (skill.version !== step.skillVersion || skill.hash !== step.skillHash)
    return conflict("制作方法已更新，请从当前图位重新打开该步骤");
  return {
    ...productionScope,
    imageId: String(rows[0].image_id),
    stage,
    step,
    skill,
  };
}
export async function adoptProductionImage(
  scope: PlanningScope,
  input: {
    imageId: string;
    stage: ProductionStage;
    conversationId: string;
    generationId: string;
    assetId: string;
  }
) {
  const context = await productionConversationContext(
    scope,
    input.conversationId
  );
  if (
    context.projectId !== scope.projectId ||
    context.imageId !== input.imageId ||
    context.stage !== input.stage
  )
    return conflict("图片不属于当前制作步骤");
  return transaction(async tx => {
    await execute(
      "SELECT id FROM projects WHERE id=? AND workspaceId=? FOR UPDATE",
      [scope.projectId, scope.workspaceId],
      tx
    );
    const latest = await row(scope, input.imageId, tx, true);
    const current = await inputs(scope, input.imageId);
    if (!productionPromptsReady(current.entry, current.document.data))
      return conflict("图片方案已变化，请先更新并确认五段提示词");
    const step = latest.data.stages[input.stage];
    if (
      !step ||
      step.conversationId !== input.conversationId ||
      step.inputHash !==
        productionInputHash(
          current.entry,
          latest.data,
          input.stage,
          current.photos
        )
    )
      return conflict("制作步骤已更新，请刷新后核对");
    const index = IMAGE_PRODUCTION_STAGES.findIndex(s => s.key === input.stage);
    if (
      index &&
      !productionStageCurrent(
        current.entry,
        latest.data,
        IMAGE_PRODUCTION_STAGES[index - 1].key,
        current.photos
      )
    )
      return conflict("上一步图片已变化，请先更新当前步骤");
    const generations = await execute(
      "SELECT assetIds FROM design_generations WHERE id=? AND conversationId=? AND workspaceId=? AND userId=? AND status='succeeded' AND deletedAt IS NULL",
      [
        input.generationId,
        input.conversationId,
        scope.workspaceId,
        scope.userId,
      ],
      tx
    );
    if (
      !generations[0] ||
      !jsonValue<string[]>(generations[0].assetIds, []).includes(input.assetId)
    )
      return conflict("请采用当前步骤中已经完成的图片");
    await checkAssets(scope, [input.assetId]);
    step.acceptedAssetId = input.assetId;
    step.acceptedGenerationId = input.generationId;
    return write(scope, input.imageId, latest.revision, latest.data, tx);
  });
}
