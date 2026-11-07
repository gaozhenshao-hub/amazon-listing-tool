import { z } from "zod";
import { moduleSpec, type ImageFamily } from "./imageModuleSpecs";
const id = z.string().uuid();
const dimension = z.number().int().min(0).max(20000);
export const imageOutlineItemSchema = z
  .object({
    id,
    manualFields: z.array(z.string().max(40)).max(20).optional(),
    manualChangedAt: z.string().optional(),
    sourceImageIds: z.array(id).max(100).optional(),
    title: z.string().max(200).optional(),
    content: z.string().max(6000),
    width: dimension,
    height: dimension,
    mobileWidth: dimension.optional(),
    mobileHeight: dimension.optional(),
    benefitIds: z.array(id).max(100),
    featureIds: z.array(id).max(100),
    reviewIds: z.array(id).max(100),
    questionIds: z.array(id).max(100),
    references: z
      .array(
        z
          .object({
            setId: z.number().int().positive(),
            imageId: z.number().int().positive(),
          })
          .strict()
      )
      .max(20)
      .default([]),
  })
  .strict();
export const imageOutlineGroupSchema = z
  .object({
    id,
    family: z.enum(["主图", "普通A+", "高级A+", "品牌故事"]),
    moduleType: z.string().min(1).max(30),
    title: z.string().max(200),
    brief: z.string().max(6000).optional(),
    manualFields: z.array(z.string().max(40)).max(20).optional(),
    moduleNumbers: z.array(z.number().int().positive()).max(20).optional(),
    mergedParts: z
      .array(
        z
          .object({
            id,
            number: z.number().int().positive(),
            title: z.string().max(200),
            brief: z.string().max(6000),
            moduleType: z.string().max(30),
            items: z.array(imageOutlineItemSchema).max(20),
          })
          .strict()
      )
      .max(20)
      .optional(),
    items: z.array(imageOutlineItemSchema).min(1).max(20),
  })
  .strict();
export const imageOutlineSchema = z
  .object({
    groups: z.array(imageOutlineGroupSchema).max(100),
    referenceSlots: z.number().int().min(3).max(5).default(3),
    referenceSets: z.array(z.number().int().positive()).max(5).default([]),
    pendingAsins: z
      .array(z.string().regex(/^[A-Z0-9]{10}$/))
      .max(5)
      .default([]),
    sourceRevision: z.number().int().nonnegative().default(0),
    sourceHash: z.string().max(100).optional(),
    manualTrackingVersion: z.literal(1).optional(),
    activeVersionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    let aplusNumber = 0;
    const occupied = new Set<number>();
    for (const group of data.groups.filter(g => g.family.includes("A+"))) {
      const numbers = group.moduleNumbers?.length
        ? group.moduleNumbers
        : [aplusNumber + 1];
      for (const number of numbers) {
        if (occupied.has(number))
          ctx.addIssue({
            code: "custom",
            message: "A+模块位序号重复，请检查合并范围",
          });
        occupied.add(number);
      }
      aplusNumber = Math.max(aplusNumber, ...numbers);
    }
    const ids = [
      ...data.groups.map(g => g.id),
      ...data.groups.flatMap(g => g.items.map(i => i.id)),
    ];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "图片或模块重复" });
    if (
      new Set(data.referenceSets).size !== data.referenceSets.length ||
      new Set(data.pendingAsins).size !== data.pendingAsins.length ||
      data.referenceSets.length + data.pendingAsins.length > data.referenceSlots
    )
      ctx.addIssue({ code: "custom", message: "参考套图重复或超过位置数量" });
    if (data.groups.reduce((n, g) => n + g.items.length, 0) > 300)
      ctx.addIssue({ code: "custom", message: "大纲最多300个内容格子" });
    for (const [index, g] of data.groups.entries()) {
      const spec = moduleSpec(g.family, g.moduleType);
      if (!spec) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "moduleType"],
          message: "请选择对应归属的官方模块",
        });
        continue;
      }
      if (
        g.moduleNumbers &&
        new Set(g.moduleNumbers).size !== g.moduleNumbers.length
      )
        ctx.addIssue({ code: "custom", message: "合并模块序号重复" });
      if (
        (g.mergedParts?.length || (g.moduleNumbers?.length || 0) > 1) &&
        (!g.family.includes("A+") ||
          ![
            "全宽背景图",
            "全宽背景图文",
            "顶部图片与文字",
            "图片轮播",
            "导航轮播",
            "流程轮播",
          ].includes(g.moduleType))
      )
        ctx.addIssue({
          code: "custom",
          message: "合并A+只能使用全宽图或图片轮播",
        });
      const count = g.items.length;
      const validCount =
        g.family === "主图"
          ? count <= 10
          : count >= Math.max(1, spec.min) && count <= Math.max(1, spec.max);
      if (!validCount)
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "items"],
          message: "图片数量与模块不匹配",
        });
      for (const item of g.items) {
        if (spec.media !== "text" && (!item.width || !item.height))
          ctx.addIssue({ code: "custom", message: "图片宽高必须大于零" });
        if (
          (item.mobileWidth !== undefined && !item.mobileWidth) ||
          (item.mobileHeight !== undefined && !item.mobileHeight)
        )
          ctx.addIssue({ code: "custom", message: "移动端图片宽高必须大于零" });
        if (item.references.some(r => !data.referenceSets.includes(r.setId)))
          ctx.addIssue({
            code: "custom",
            message: "图片参考不属于已选择的套图",
          });
      }
    }
  });
export type ImageOutline = z.infer<typeof imageOutlineSchema>;
export type ImageOutlineGroup = z.infer<typeof imageOutlineGroupSchema>;
export type ImageOutlineItem = z.infer<typeof imageOutlineItemSchema>;

export const mainImageAssociationFields = ["featureIds", "benefitIds", "reviewIds", "questionIds"] as const;

export function isWhiteBackgroundMain(group: Pick<ImageOutlineGroup, "family" | "moduleType">) {
  return group.family === "主图" && group.moduleType === "主图";
}

export function clearMainImageAssociations(outline: ImageOutline): ImageOutline {
  if (!outline.groups.some(group => isWhiteBackgroundMain(group) &&
    group.items.some(item => mainImageAssociationFields.some(key => item[key].length))))
    return outline;
  return {
    ...outline,
    groups: outline.groups.map(group => isWhiteBackgroundMain(group) ? {
      ...group,
      items: group.items.map(item => ({ ...item, featureIds: [], benefitIds: [], reviewIds: [], questionIds: [] })),
    } : group),
  };
}

export const emptyImageOutline = (): ImageOutline => ({
  groups: [],
  referenceSlots: 3,
  referenceSets: [],
  pendingAsins: [],
  sourceRevision: 0,
});
export function makeOutlineItem(
  family: string,
  type: string
): ImageOutlineItem {
  const spec = moduleSpec(family, type);
  if (!spec) throw new Error("请选择图片模块");
  return {
    id: crypto.randomUUID(),
    content: "",
    width: spec.width,
    height: spec.height,
    mobileWidth: spec.mobileWidth,
    mobileHeight: spec.mobileHeight,
    benefitIds: [],
    featureIds: [],
    reviewIds: [],
    questionIds: [],
    references: [],
  };
}
export function makeOutlineGroup(
  family: ImageFamily,
  type: string,
  count?: number
): ImageOutlineGroup {
  const spec = moduleSpec(family, type);
  if (!spec) throw new Error("请选择图片模块");
  return {
    id: crypto.randomUUID(),
    family,
    moduleType: type,
    title: "",
    items: Array.from(
      { length: count ?? Math.max(1, spec.defaultCount) },
      (_, index) => ({
        ...makeOutlineItem(family, type),
        ...(type === "图片与侧栏" && index === 1
          ? { width: 300, height: 175 }
          : {}),
        ...((type === "热点图片" || type === "热点图文") && index > 0
          ? { width: 600, height: 450 }
          : {}),
      })
    ),
  };
}
/** Keep content and manual dimensions when changing the number of slots. When
 * changing layout, carry content/references forward and adopt the new sizes. */
export function resizeOutlineGroup(
  group: ImageOutlineGroup,
  family: ImageFamily,
  type: string,
  count: number
): ImageOutlineGroup {
  const next = makeOutlineGroup(family, type, count),
    changed = group.family !== family || group.moduleType !== type;
  return {
    ...group,
    ...next,
    id: group.id,
    title: group.title,
    ...(group.family !== family
      ? { moduleNumbers: undefined, mergedParts: undefined }
      : {}),
    items: next.items.map((item, index) => {
      const old = group.items[index],
        units = group.family === family ? group.moduleNumbers?.length || 1 : 1;
      if (units > 1) {
        item.height *= units;
        if (item.mobileHeight) item.mobileHeight *= units;
      }
      return old
        ? {
            ...old,
            ...(changed
              ? {
                  width: item.width,
                  height: item.height,
                  mobileWidth: item.mobileWidth,
                  mobileHeight: item.mobileHeight,
                }
              : {}),
          }
        : item;
    }),
  };
}
export function blankImageOutline(): ImageOutline {
  return {
    ...emptyImageOutline(),
    groups: [
      makeOutlineGroup("主图", "主图", 3),
      ...Array.from({ length: 7 }, () => makeOutlineGroup("主图", "附图", 1)),
      ...Array.from({ length: 7 }, () =>
        makeOutlineGroup("高级A+", "全宽背景图")
      ),
      makeOutlineGroup("品牌故事", "轮播背景"),
      ...Array.from({ length: 4 }, () =>
        makeOutlineGroup("品牌故事", "品牌焦点图片")
      ),
    ],
  };
}
export const outlineHistorySchema = z
  .array(
    z
      .object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(6000),
      })
      .strict()
  )
  .max(40);
export const outlineSelectionSchema = z
  .object({ groupId: id, itemId: id })
  .strict();
