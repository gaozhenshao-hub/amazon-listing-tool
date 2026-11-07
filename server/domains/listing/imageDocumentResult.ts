import { z } from "zod";
import {
  applyDocumentPatches,
  documentEditableFields,
  documentSceneSchema,
  documentCopySchema,
  documentPaletteSchema,
  type ImageDocument,
  normalizedImageLayout,
  IMAGE_LAYOUTS,
} from "../../../shared/imageDocument";
const scene = documentSceneSchema.omit({ id: true }),
  copy = documentCopySchema.extend({
    icons: z
      .array(documentCopySchema.shape.icons.element.omit({ id: true }))
      .max(30),
  });
const generatedEntry = z
  .object({
    imageId: z.string().uuid(),
    title: z.string().max(200).optional(),
    content: z.string().max(6000).optional(),
    layout: z.string().max(100),
    framing: z.string().max(100),
    layoutNote: z.string().max(6000),
    scenes: z.array(scene).max(12),
    copy,
    prompts: z
      .object({
        scene: z.string().max(6000),
        product: z.string().max(6000),
        composition: z.string().max(6000),
        textIcons: z.string().max(6000),
        interaction: z.string().max(6000).default(""),
      })
      .strict(),
  })
  .strict();
type GeneratedCopy = z.infer<typeof copy>;
type CopyPolicy = { whiteMain: boolean };
const copyLines = ["headline", "subtitle", "body"] as const;

function validateCopyPolicy(
  copy: GeneratedCopy,
  entry: ImageDocument["entries"][number],
  policy: CopyPolicy
) {
  const manual = (key: string) => entry.manualFields?.includes("copy." + key);
  if (policy.whiteMain) {
    if (
      copyLines.some(key => !manual(key) && copy[key].trim()) ||
      (!manual("icons") && copy.icons.length)
    )
      throw new Error("白底主图的上图文字及图标必须留空");
    return;
  }
  if (/中文|汉语|chinese/i.test(copy.language)) return;
  for (const key of copyLines) {
    const source = manual(key) ? entry.copy[key] : copy[key];
    if (
      source.trim() &&
      !manual(key + "Zh") &&
      !/[\u3400-\u9fff]/u.test(copy[`${key}Zh`] || "")
    )
      throw new Error(
        "外文标题、短句必须填写对应的中文小字译文（headlineZh、subtitleZh、bodyZh）"
      );
  }
  if (
    !manual("icons") &&
    copy.icons.some(
      icon => icon.label.trim() && !/[\u3400-\u9fff]/u.test(icon.labelZh || "")
    )
  )
    throw new Error("每个外文图标标签需填写 labelZh 中文译文");
}

export function parseGeneratedDocument(
  raw: unknown,
  base: ImageDocument,
  imageIds: string[],
  tags: { categories: string[]; styles: string[] },
  copyPolicies?: ReadonlyMap<string, CopyPolicy>
) {
  const output = z
    .object({
      reply: z.string().max(6000),
      category: z.string().max(100),
      styles: z.array(z.string().max(100)).max(10),
      palette: documentPaletteSchema,
      entries: z.array(generatedEntry).min(1).max(3),
    })
    .strict()
    .parse(raw);
  if (
    !tags.categories.includes(output.category) ||
    output.styles.some(s => !tags.styles.includes(s))
  )
    throw new Error("类目和风格必须使用输入中的知识库标签");
  if (
    output.entries.length !== imageIds.length ||
    new Set(output.entries.map(e => e.imageId)).size !== imageIds.length ||
    output.entries.some(e => !imageIds.includes(e.imageId))
  )
    throw new Error(
      "请完整处理本批指定的每张图片，使用原imageId且每张只返回一次"
    );
  const fields = documentEditableFields(base),
    changes: Array<{ key: string; original: string; value: string }> = [],
    add = (key: string, value: unknown) => {
      if (fields[key])
        changes.push({
          key,
          original: fields[key].value,
          value: typeof value === "string" ? value : JSON.stringify(value),
        });
    };
  add("global:category", output.category);
  add("global:styles", output.styles);
  add("global:palette", output.palette);
  for (const generated of output.entries) {
    const old = base.entries.find(e => e.imageId === generated.imageId)!;
    const policy = copyPolicies?.get(generated.imageId);
    if (policy) validateCopyPolicy(generated.copy, old, policy);
    if (old.width && old.height) {
      for (const key of copyLines) {
        if (old.manualFields?.includes(`copy.${key}`)) continue;
        if (generated.copy[key] && !generated.copy[`${key}Position`]?.trim())
          throw new Error(
            "请标明每项上图文案的位置，包括主标题、副标题和必要短句"
          );
      }
      if (
        !old.manualFields?.includes("copy.icons") &&
        generated.copy.icons.some(i => !i.visual.trim() || !i.position.trim())
      )
        throw new Error("每个可视化图标都需要具体图形与摆放位置");
    }
    if (
      old.width === 0 &&
      old.height === 0 &&
      (generated.scenes.length ||
        generated.prompts.scene ||
        generated.prompts.product)
    )
      throw new Error(
        "纯文字模块不需要场景或产品嵌入，请返回空场景和空scene/product提示词"
      );
    const layout = normalizedImageLayout(generated.layout);
    if (!layout || !IMAGE_LAYOUTS.includes(layout as never))
      throw new Error(
        "构图方式请使用知识库布局标签，不要填居中或三分法等摄影构图"
      );
    add(`image:${old.imageId}:layout`, layout);
    add(`image:${old.imageId}:layoutNote`, generated.layoutNote);
    for (const key of ["title", "content"] as const)
      if (generated[key] !== undefined)
        add(`image:${old.imageId}:${key}`, generated[key]);
    // Legacy framing is retained inside scene descriptions, never a second layout choice.
    if (generated.framing)
      add(`image:${old.imageId}:framing`, generated.framing);
    add(
      `image:${old.imageId}:scenes`,
      generated.scenes.map((s, index) => ({
        ...s,
        id: old.scenes[index]?.id || crypto.randomUUID(),
      }))
    );
    const copy = policy
      ? {
          ...generated.copy,
          headlineZh: generated.copy.headlineZh ?? "",
          subtitleZh: generated.copy.subtitleZh ?? "",
          bodyZh: generated.copy.bodyZh ?? "",
        }
      : generated.copy;
    for (const [key, value] of Object.entries(copy))
      add(
        `image:${old.imageId}:copy.${key}`,
        key === "icons"
          ? generated.copy.icons.map((i, index) => ({
              ...i,
              id: old.copy.icons[index]?.id || crypto.randomUUID(),
            }))
          : value
      );
    // Content planning never overwrites prompts. They have their own reviewed step.
  }
  const result = applyDocumentPatches(base, changes);
  result.data.organized = true;
  return {
    reply: output.reply,
    data: result.data,
    protectedCount: result.protectedCount,
  };
}
export function parseAdjustedDocument(
  raw: unknown,
  base: ImageDocument,
  allowed: Record<string, { value: string; protected: boolean }>
) {
  const output = z
    .object({
      reply: z.string().min(1).max(6000),
      changes: z
        .array(
          z
            .object({
              key: z.string().max(160),
              original: z.string().max(120000),
              value: z.string().max(120000),
            })
            .strict()
        )
        .max(1000),
    })
    .strict()
    .parse(raw);
  if (output.changes.some(c => !allowed[c.key]))
    throw new Error("只能调整本次选择的图片或提示词步骤");
  const result = applyDocumentPatches(base, output.changes);
  for (const entry of result.data.entries) {
    if (!entry.width || !entry.height) continue;
    for (const key of copyLines) {
      if (
        !output.changes.some(
          c =>
            c.key === `image:${entry.imageId}:copy.${key}` &&
            !allowed[c.key]?.protected
        )
      )
        continue;
      if (entry.copy[key] && !entry.copy[`${key}Position`]?.trim())
        throw new Error("请同时补充上图文案的摆放位置");
    }
    if (
      output.changes.some(
        c =>
          c.key === `image:${entry.imageId}:copy.icons` &&
          !allowed[c.key]?.protected
      ) &&
      entry.copy.icons.some(i => !i.visual.trim() || !i.position.trim())
    )
      throw new Error("每个可视化图标都需要具体图形与摆放位置");
  }
  return { ...result, reply: output.reply };
}
