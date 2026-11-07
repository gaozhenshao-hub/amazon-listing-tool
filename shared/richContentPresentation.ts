import { z } from "zod";
import { AmazonImageLayoutSchema } from "./amazonImageLayout";
import { isAmazonPageNavigation } from "./amazonContentText";
export const SellingPointCategoriesSchema = z
  .array(z.enum(["质量", "设计", "售后", "功能", "场景", "其他"]))
  .max(12);
const points = {
  sellingPoints: z.array(z.string().max(200)).max(12),
  sellingPointCategories: SellingPointCategoriesSchema.optional(),
};
export const ImageTextRegionSchema = z
  .object({
    source: z.string().min(1).max(8000),
    translation: z.string().min(1).max(12000),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    confidence: z.enum(["clear", "uncertain"]).default("clear"),
  })
  .refine(
    b => b.x + b.width <= 1.002 && b.y + b.height <= 1.002,
    "文字区域超出图片范围"
  );
export const ImageTranslationSchema = z
  .object({
    version: z.literal(1),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    audited: z.boolean().optional(),
    status: z.enum([
      "complete",
      "no_text",
      "partial",
      "unreadable",
      "pending",
      "failed",
      "excluded_background",
    ]),
    regions: z.array(ImageTextRegionSchema).max(160),
    notes: z.string().max(2000).default(""),
    originalRegions: z.array(ImageTextRegionSchema).max(160).optional(),
    manualEdited: z.boolean().optional(),
  })
  .superRefine((v, c) => {
    if (v.status === "complete" && !v.regions.length)
      c.addIssue({ code: "custom", message: "有文字的图片必须保存对应区域" });
    if (v.status === "no_text" && v.regions.length)
      c.addIssue({ code: "custom", message: "无文字状态不能包含译文区域" });
    if (["partial", "unreadable"].includes(v.status) && !v.notes.trim())
      c.addIssue({ code: "custom", message: "未完整识别时需要说明具体原因" });
  });
export const RichTextFindingSchema = z.object({
  id: z.string().min(1).max(120),
  source: z.string().min(1).max(20000),
  translation: z.string().min(1).max(30000),
  originalTranslation: z.string().max(30000).optional(),
  ...points,
});
export const RichModuleFindingSchema = z
  .object({
    id: z.string().regex(/^M[a-f0-9]{24}$/),
    moduleId: z.string().max(80),
    videoEvidenceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    cardIndex: z.number().int().min(0).max(59).optional(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    ...points,
  })
  .refine(
    v =>
      !v.sellingPointCategories ||
      v.sellingPoints.length === v.sellingPointCategories.length,
    "模块卖点分类数量不一致"
  );
export const RichContentPresentationSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  texts: z.array(RichTextFindingSchema).max(6000),
  images: z.array(ImageTranslationSchema).max(300),
  modulePoints: z.array(RichModuleFindingSchema).max(6000).optional(),
});
export type ImageTranslation = z.infer<typeof ImageTranslationSchema>;
export type ImageTextRegion = z.infer<typeof ImageTextRegionSchema>;
export type RichContentPresentation = z.infer<
  typeof RichContentPresentationSchema
>;
export type RichTextFinding = z.infer<typeof RichTextFindingSchema>;
/** The Brand Story shell is display-only. Its cards still receive translations. */
export function richTextSources(
  layout: unknown
): Array<{ id: string; text: string }> {
  const parsed = AmazonImageLayoutSchema.safeParse(layout);
  if (!parsed.success) return [];
  const entries = new Map<string, { id: string; text: string }>();
  for (const m of parsed.data.modules) {
    const blocks = [
      ...(m.section === "brand_story" ? [] : m.blocks || []),
      ...m.cards.flatMap(c => c.blocks || []),
      ...(m.questions || []).flatMap(q => [q.question, q.answer]),
      ...(m.hotspots || []).flatMap(h => h.blocks),
    ];
    for (const b of blocks)
      if (b.text.trim() && !isAmazonPageNavigation(b.text))
        entries.set(b.id, { id: b.id, text: b.text });
    for (const r of m.rows) {
      if (r.labelId && r.label.trim())
        entries.set(r.labelId, { id: r.labelId, text: r.label });
      r.cells.forEach((text, i) => {
        const id = r.cellIds?.[i];
        if (id && text.trim()) entries.set(id, { id, text });
      });
    }
  }
  return [...entries.values()];
}
export function brandBackgroundHashes(layout: unknown): Set<string> {
  const p = AmazonImageLayoutSchema.safeParse(layout);
  return new Set(
    p.success
      ? p.data.modules
          .filter(m => m.section === "brand_story")
          .flatMap(m => (m.background ? [m.background.hash] : []))
      : []
  );
}
export function savedImageTranslation(
  value: unknown,
  sourceHash?: string | null,
  contentHash?: string | null
): ImageTranslation | undefined {
  const p = ImageTranslationSchema.safeParse(value);
  return p.success &&
    (!sourceHash || p.data.sourceHash === sourceHash) &&
    (!contentHash || p.data.contentHash === contentHash)
    ? p.data
    : undefined;
}
/** Human corrections remain separate from generated output and only apply to the same original value. */
export function applyRichContentEdits(
  value: unknown,
  edits: Record<string, { original: string; value: string }> = {}
): RichContentPresentation | undefined {
  const parsed = RichContentPresentationSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const edited = (key: string, original: string) =>
    edits[key]?.original === original ? edits[key].value : original;
  return {
    ...parsed.data,
    modulePoints: parsed.data.modulePoints?.map(m => {
      const sellingPoints = edited(
        `module:${m.id}:sellingPoints`,
        m.sellingPoints.join("、")
      )
        .split(/[、，,\n]+/)
        .map(v => v.trim())
        .filter(Boolean);
      return {
        ...m,
        sellingPoints,
        sellingPointCategories: sellingPoints.map(
          point =>
            m.sellingPointCategories?.[m.sellingPoints.indexOf(point)] || "其他"
        ),
      };
    }),
    texts: parsed.data.texts.map(t => {
      const translation = edited(`text:${t.id}:translation`, t.translation);
      return {
        ...t,
        translation,
        ...(translation !== t.translation
          ? { originalTranslation: t.originalTranslation || t.translation }
          : {}),
        sellingPoints: edited(
          `text:${t.id}:sellingPoints`,
          t.sellingPoints.join("、")
        )
          .split(/[、，,\n]+/)
          .map(v => v.trim())
          .filter(Boolean),
      };
    }),
    images: parsed.data.images.map(i => {
      const regions = i.regions.map((r, index) => ({
          ...r,
          translation: edited(
            `region:${i.sourceHash}:${index}:translation`,
            r.translation
          ),
        })),
        changed = regions.some(
          (r, index) => r.translation !== i.regions[index].translation
        );
      return {
        ...i,
        regions,
        ...(changed
          ? {
              originalRegions: i.originalRegions || i.regions,
              manualEdited: true,
            }
          : {}),
      };
    }),
  };
}
