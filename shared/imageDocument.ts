import { z } from "zod";
import type { ImageOutline } from "./imagePlanning";
import { COMPOSITION_OPTIONS } from "./imageTagConstants";
import {
  planningImageReferenceSchema,
  planningReferenceKey,
} from "./planningImageReference";
const id = z.string().uuid(),
  text = z.string().max(6000),
  short = z.string().max(300);
export const IMAGE_LAYOUTS = COMPOSITION_OPTIONS;
export function normalizedImageLayout(value: string) {
  if (IMAGE_LAYOUTS.includes(value as never)) return value;
  if (/一拖三/.test(value)) return "一拖三";
  if (/一拖二/.test(value)) return "一拖二";
  if (/一拖一/.test(value)) return "一拖一";
  if (/一主多辅|一拖多/.test(value)) return "一拖多";
  if (/三分屏|三分构图/.test(value)) return "三分构图";
  if (/四分|多分/.test(value)) return "多分构图";
  if (/二分|分屏|两分/.test(value)) return "二分构图";
  if (/单画面|一分/.test(value)) return "一分构图";
  return "";
}
export const FRAME_COMPOSITIONS = [
  "居中构图",
  "三分法构图",
  "对称构图",
  "对角线构图",
  "俯视平铺",
  "主体偏左留白",
  "主体偏右留白",
  "自定义构图",
] as const;
export const PROMPT_STAGES = [
  {
    key: "composition",
    name: "① 整体构图",
    description: "先确定画面分区、比例、形状，以及产品、场景和文案位置。",
  },
  {
    key: "scene",
    name: "② 背景与场景",
    description: "依据结构稿生成背景，保留产品与文字的位置。",
  },
  {
    key: "product",
    name: "③ 产品嵌入",
    description: "使用本品参考图，确定外观、角度、比例和配件。",
  },
  {
    key: "interaction",
    name: "④ 交互与光影融合",
    description: "与产品嵌入一起执行，处理接触、遮挡、透视、阴影和色温。",
  },
  {
    key: "textIcons",
    name: "⑤ 文字与可视化图标",
    description: "最后加入定稿文案、图标及辅助标注。",
  },
] as const;
export type PromptStage = (typeof PROMPT_STAGES)[number]["key"];
export const documentSceneSchema = z
  .object({
    id,
    name: short,
    region: short,
    background: text,
    productPresent: z.boolean(),
    product: text,
    interaction: text,
    lighting: text,
    camera: short,
  })
  .strict();
export const documentCopySchema = z
  .object({
    language: z.string().max(50),
    headline: z.string().max(500),
    headlinePosition: short.optional(),
    headlineZh: z.string().max(500).optional(),
    subtitle: z.string().max(1000),
    subtitlePosition: short.optional(),
    subtitleZh: z.string().max(1000).optional(),
    body: text,
    bodyPosition: short.optional(),
    bodyZh: text.optional(),
    icons: z
      .array(
        z
          .object({
            id,
            label: short,
            labelZh: short.optional(),
            visual: z.string().max(1000),
            position: short,
          })
          .strict()
      )
      .max(30),
    annotations: text,
  })
  .strict();
export const documentReferenceSchema = z
  .object({
    reference: planningImageReferenceSchema,
    purpose: z.string().max(1000),
  })
  .strict();
export const documentEntrySchema = z
  .object({
    imageId: id,
    outlineFingerprint: z.string().max(100),
    outlineSnapshot: z
      .object({
        title: z.string().max(200),
        content: text,
        width: z.number(),
        height: z.number(),
      })
      .optional(),
    title: z.string().max(200),
    content: text,
    width: z.number().int().min(0).max(20000),
    height: z.number().int().min(0).max(20000),
    layout: z.string().max(100),
    framing: z.string().max(100),
    layoutNote: text,
    promptSourceHash: z.string().max(100).optional(),
    references: z
      .object({
        composition: z.array(documentReferenceSchema).max(20),
        effect: z.array(documentReferenceSchema).max(20),
        other: z.array(documentReferenceSchema).max(20),
      })
      .strict(),
    scenes: z.array(documentSceneSchema).max(12),
    copy: documentCopySchema,
    prompts: z
      .object({
        scene: text,
        product: text,
        composition: text,
        textIcons: text,
        interaction: text.default(""),
      })
      .strict(),
    manualFields: z.array(z.string().max(100)).max(300).optional(),
    manualChangedAt: z.string().optional(),
  })
  .strict();
export const documentPaletteSchema = z
  .array(
    z
      .object({
        role: z.enum(["main", "secondary", "accent", "background"]),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        note: z.string().max(300),
      })
      .strict()
  )
  .length(4);
export const imageDocumentSchema = z
  .object({
    version: z.literal(1),
    category: z.string().max(100),
    styles: z.array(z.string().max(100)).max(10),
    palette: documentPaletteSchema,
    sourceOutlineHash: z.string().max(100),
    sourceContextHash: z.string().max(100).optional(),
    entries: z.array(documentEntrySchema).max(600),
    manualFields: z.array(z.string().max(100)).max(20).optional(),
    organized: z.boolean().default(false),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (new Set(data.entries.map(e => e.imageId)).size !== data.entries.length)
      ctx.addIssue({ code: "custom", message: "每张图只能有一份套图文档" });
    if (new Set(data.palette.map(p => p.role)).size !== data.palette.length)
      ctx.addIssue({ code: "custom", message: "配色色卡角色重复" });
    for (const entry of data.entries) {
      for (const list of Object.values(entry.references))
        if (
          new Set(list.map(r => planningReferenceKey(r.reference))).size !==
          list.length
        )
          ctx.addIssue({
            code: "custom",
            message: "同一用途的参考图片不能重复",
          });
      if (
        new Set(entry.scenes.map(s => s.id)).size !== entry.scenes.length ||
        new Set(entry.copy.icons.map(i => i.id)).size !==
          entry.copy.icons.length
      )
        ctx.addIssue({ code: "custom", message: "场景或图标重复" });
    }
  });
export type ImageDocument = z.infer<typeof imageDocumentSchema>;
export type DocumentEntry = z.infer<typeof documentEntrySchema>;
export type DocumentReference = z.infer<typeof documentReferenceSchema>;
export function blankDocumentScene(productPresent = true) {
  return {
    id: crypto.randomUUID(),
    name: "场景1",
    region: "",
    background: "",
    productPresent,
    product: "",
    interaction: "",
    lighting: "",
    camera: "",
  };
}
export const documentOutlineFingerprint = (item: {
  title?: string;
  content: string;
  width: number;
  height: number;
}) => JSON.stringify([item.title || "", item.content, item.width, item.height]);
// Fingerprints are hashes supplied by the server; the shared string above is only a comparison source.
export function makeDocumentEntry(
  item: ImageOutline["groups"][number]["items"][number],
  productPresent = true
): DocumentEntry {
  return {
    imageId: item.id,
    outlineFingerprint: "",
    title: item.title || "",
    content: item.content,
    width: item.width,
    height: item.height,
    layout: "",
    framing: "",
    layoutNote: "",
    references: {
      composition: item.references.map(reference => ({
        reference: {
          source: "reference" as const,
          ...reference,
          label: "大纲已选参考图",
        },
        purpose: "继承大纲中运营选择的构图参考",
      })),
      effect: [],
      other: [],
    },
    manualFields: [],
    scenes:
      item.width || item.height
        ? [{ ...blankDocumentScene(productPresent), id: item.id }]
        : [],
    copy: {
      language: "英语",
      headline: "",
      subtitle: "",
      body: "",
      icons: [],
      annotations: "",
    },
    prompts: {
      scene: "",
      product: "",
      composition: "",
      interaction: "",
      textIcons: "",
    },
  };
}
export function emptyImageDocument(outline?: ImageOutline): ImageDocument {
  return {
    version: 1,
    category: "",
    styles: [],
    palette: [
      { role: "main", color: "#334155", note: "" },
      { role: "secondary", color: "#CBD5E1", note: "" },
      { role: "accent", color: "#F59E0B", note: "" },
      { role: "background", color: "#FFFFFF", note: "" },
    ],
    sourceOutlineHash: "",
    entries:
      outline?.groups.flatMap(g =>
        g.items.map(i =>
          makeDocumentEntry(
            i,
            !(g.family === "品牌故事" && g.moduleType === "轮播背景")
          )
        )
      ) || [],
    organized: false,
  };
}
export function documentEditableFields(data: ImageDocument) {
  const fields: Record<string, { value: string; protected: boolean }> = {};
  for (const key of ["category", "styles", "palette"] as const)
    fields[`global:${key}`] = {
      value:
        typeof data[key] === "string" ? data[key] : JSON.stringify(data[key]),
      protected: !!data.manualFields?.includes(key),
    };
  for (const entry of data.entries) {
    const add = (key: string, value: unknown) => {
      fields[`image:${entry.imageId}:${key}`] = {
        value:
          value == null
            ? ""
            : typeof value === "string"
              ? value
              : JSON.stringify(value),
        protected: !!entry.manualFields?.includes(key),
      };
    };
    for (const key of [
      "title",
      "content",
      "width",
      "height",
      "layout",
      "framing",
      "layoutNote",
      "scenes",
    ] as const)
      add(key, entry[key]);
    for (const key of [
      "language",
      "headline",
      "headlinePosition",
      "headlineZh",
      "subtitle",
      "subtitlePosition",
      "subtitleZh",
      "body",
      "bodyPosition",
      "bodyZh",
      "icons",
      "annotations",
    ] as const)
      add("copy." + key, entry.copy[key]);
    for (const { key } of PROMPT_STAGES)
      add("prompts." + key, entry.prompts[key]);
  }
  return fields;
}
type CollectionItem = { id: string };

function manualCollectionPaths(path: string, before: string, after: string) {
  const previous = JSON.parse(before) as CollectionItem[];
  const next = JSON.parse(after) as CollectionItem[];
  if (
    JSON.stringify(previous.map(item => item.id)) !==
    JSON.stringify(next.map(item => item.id))
  )
    return [path];
  return next.flatMap((item, index) =>
    Object.entries(item)
      .filter(
        ([key, value]) =>
          key !== "id" && value !== previous[index][key as keyof CollectionItem]
      )
      .map(([key]) => `${path}.${item.id}.${key}`)
  );
}

function preserveCollectionFields<T extends CollectionItem>(
  previous: T[],
  proposed: T[],
  path: string,
  manualFields: string[] = []
) {
  const next = [...proposed];
  for (const [index, item] of previous.entries()) {
    const prefix = `${path}.${item.id}.`;
    const keys = manualFields
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length) as keyof T);
    if (!keys.length) continue;
    const position = next.findIndex(candidate => candidate.id === item.id);
    if (position < 0) next.splice(index, 0, item);
    else
      next[position] = {
        ...next[position],
        ...Object.fromEntries(keys.map(key => [key, item[key]])),
      };
  }
  return next;
}

export function recordManualDocument(
  before: ImageDocument,
  incoming: ImageDocument
) {
  const next = structuredClone(incoming),
    old = documentEditableFields(before),
    fields = documentEditableFields(next);
  next.manualFields = [
    ...new Set([...(before.manualFields || []), ...(next.manualFields || [])]),
  ];
  for (const [key, field] of Object.entries(fields))
    if (old[key]?.value !== field.value) {
      const [kind, id, path] = key.split(":");
      if (kind === "global") next.manualFields.push(id);
      else {
        const entry = next.entries.find(e => e.imageId === id)!;
        entry.manualFields = [
          ...new Set([
            ...(entry.manualFields || []),
            ...(before.entries.find(e => e.imageId === id)?.manualFields || []),
            ...(old[key] && (path === "scenes" || path === "copy.icons")
              ? manualCollectionPaths(path, old[key].value, field.value)
              : [path]),
          ]),
        ];
        entry.manualChangedAt = new Date().toISOString();
      }
    }
  for (const entry of next.entries) {
    const previous = before.entries.find(e => e.imageId === entry.imageId);
    entry.manualFields = [
      ...new Set([
        ...(previous?.manualFields || []),
        ...(entry.manualFields || []),
      ]),
    ];
    for (const kind of ["composition", "effect", "other"] as const)
      if (
        JSON.stringify(previous?.references[kind]) !==
        JSON.stringify(entry.references[kind])
      )
        entry.manualFields.push("references." + kind);
    entry.manualFields = [...new Set(entry.manualFields)];
  }
  next.manualFields = [...new Set(next.manualFields)];
  return imageDocumentSchema.parse(next);
}
export function applyDocumentPatches(
  data: ImageDocument,
  changes: Array<{ key: string; original: string; value: string }>,
  protectManual = true
) {
  const fields = documentEditableFields(data),
    next = structuredClone(data),
    seen = new Set<string>();
  let protectedCount = 0;
  for (const change of changes) {
    const field = fields[change.key];
    if (!field || field.value !== change.original || seen.has(change.key))
      throw new Error("文档内容已变化，请基于当前结果重新调整");
    seen.add(change.key);
    if (protectManual && field.protected) {
      protectedCount++;
      continue;
    }
    const [kind, id, path] = change.key.split(":");
    if (kind === "global")
      (next as any)[id] =
        id === "category" ? change.value : JSON.parse(change.value);
    else {
      const entry = next.entries.find(e => e.imageId === id)!;
      if (path === "scenes" || path === "copy.icons") {
        const manualFields = protectManual ? entry.manualFields : [];
        protectedCount +=
          manualFields?.filter(key => key.startsWith(path + ".")).length ?? 0;
        if (path === "scenes")
          entry.scenes = preserveCollectionFields(
            entry.scenes,
            JSON.parse(change.value),
            path,
            manualFields
          );
        else
          entry.copy.icons = preserveCollectionFields(
            entry.copy.icons,
            JSON.parse(change.value),
            path,
            manualFields
          );
      } else if (path.startsWith("copy."))
        (entry.copy as any)[path.slice(5)] = change.value;
      else if (path.startsWith("prompts."))
        (entry.prompts as any)[path.slice(8)] = change.value;
      else
        (entry as any)[path] = ["width", "height"].includes(path)
          ? JSON.parse(change.value)
          : change.value;
    }
  }
  return { data: imageDocumentSchema.parse(next), protectedCount };
}
