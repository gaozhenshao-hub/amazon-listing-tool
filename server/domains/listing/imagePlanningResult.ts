import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  clearMainImageAssociations,
  imageOutlineSchema,
  imageOutlineItemSchema,
  type ImageOutline,
  resizeOutlineGroup,
  makeOutlineGroup,
} from "../../../shared/imagePlanning";
import type { ListingAggregation } from "../../../shared/listingAggregation";
import { validateOutlineLinks } from "./imagePlanningSources";
import {
  moduleSpec,
  AMAZON_MODULE_CATALOG,
} from "../../../shared/imageModuleSpecs";
import {
  applyOutlineRefinement,
  recordManualOutline,
} from "../../../shared/imageOutlineEditing";
import {
  mergeAplusModules,
  moduleOutline,
} from "../../../shared/modulePlanning";
const withoutManagedFields = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const {
    id: _id,
    references: _references,
    manualFields: _manual,
    manualChangedAt: _changed,
    sourceImageIds: _sources,
    ...item
  } = value as Record<string, unknown>;
  for (const field of ["mobileWidth", "mobileHeight"])
    if (item[field] === null) delete item[field];
  return item;
};
const itemOutput = z.preprocess(
  withoutManagedFields,
  imageOutlineItemSchema
    .omit({ id: true, references: true })
    .extend({ content: z.string().trim().min(1).max(6000) })
);
const groupOutput = z.preprocess(
  withoutManagedFields,
  z
    .object({
      family: z.enum(["主图", "普通A+", "高级A+", "品牌故事"]),
      moduleType: z.string().max(30),
      title: z.string().max(200),
      brief: z.string().max(6000).optional(),
      moduleNumbers: z.array(z.number().int().positive()).max(20).optional(),
      items: z.array(itemOutput).min(1).max(20),
    })
    .strict()
);
export const outlinePartRules = {
  主图: "只返回主图家族。第一组是主图模块，含同一首图的3个独立方案；后续是7个附图模块，各含1张图。共8组。",
  "高级A+":
    "只返回高级A+家族。按顺序规划7个高级A+模块位，通常7组。需要合并时仅按连续moduleNumbers合并，合计覆盖1至7。每组严格用catalog规定的图数。",
  品牌故事:
    "只返回品牌故事家族。第1组是轮播背景，后面4组是独立的卡片，共5组。按catalog选择卡片，无品牌素材时注明待提供，可用4张独立的品牌焦点图片占位。",
} as const;
export type ImageOutlinePart = keyof typeof outlinePartRules;

export function parseImagePlanningResult(
  raw: unknown,
  mode: "generate" | "adjust" | "refine",
  base: ImageOutline,
  upstream: ListingAggregation,
  sourceRevision: number,
  selection?: { groupId: string; itemId: string },
  sourceHash?: string,
  part?: ImageOutlinePart
) {
  if (mode === "refine") {
    const value = z.union([
      z.string().max(6000),
      z.number().int().min(0).max(20000),
      z.array(z.string().uuid()).max(100),
    ]);
    const operation = z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("merge"),
          leftId: z.string().uuid(),
          rightId: z.string().uuid(),
          layout: z.enum(["full", "carousel"]),
        })
        .strict(),
      z
        .object({
          kind: z.literal("layout"),
          groupId: z.string().uuid(),
          moduleType: z.string().max(30),
          count: z.number().int().min(1).max(20),
        })
        .strict(),
      z.object({ kind: z.literal("append"), group: groupOutput }).strict(),
    ]);
    const output = z
      .object({
        reply: z.string().min(1).max(6000),
        changes: z
          .array(z.object({ key: z.string().max(100), original: value, value }))
          .max(3000),
        structureChanges: z.array(operation).max(30).optional(),
      })
      .strict()
      .parse(raw);
    const result = applyOutlineRefinement(base, output.changes);
    for (const change of output.structureChanges || []) {
      if (change.kind === "merge") {
        const groups = [change.leftId, change.rightId].map(id =>
          result.data.groups.find(g => g.id === id)
        );
        if (
          groups.some(g =>
            g?.manualFields?.some(k =>
              ["structure", "moduleType", "family"].includes(k)
            )
          )
        ) {
          result.protectedCount++;
          continue;
        }
        result.data = mergeAplusModules(
          result.data,
          change.leftId,
          change.rightId,
          change.layout,
          false
        );
      } else if (change.kind === "layout") {
        const group = result.data.groups.find(g => g.id === change.groupId);
        if (!group) throw new Error("模块已更新，请基于当前模块调整");
        if (
          group.manualFields?.some(k =>
            ["structure", "moduleType", "family"].includes(k)
          ) ||
          group.items
            .slice(change.count)
            .some(i => i.manualFields?.length || i.references.length)
        ) {
          result.protectedCount++;
          continue;
        }
        result.data.groups = result.data.groups.map(g =>
          g.id === group.id
            ? resizeOutlineGroup(
                group,
                group.family,
                change.moduleType,
                change.count
              )
            : g
        );
      } else {
        const group = makeOutlineGroup(
          change.group.family,
          change.group.moduleType,
          change.group.items.length
        );
        result.data.groups.push({
          ...group,
          ...change.group,
          id: group.id,
          items: change.group.items.map((item, index) => ({
            ...item,
            id: group.items[index].id,
            references: [],
          })),
        });
      }
    }
    result.data.sourceRevision = sourceRevision;
    result.data.sourceHash = sourceHash;
    result.data = clearMainImageAssociations(result.data);
    validateOutlineLinks(result.data, upstream);
    return {
      reply:
        output.reply +
        (result.protectedCount ? "\n人工修改字段已保留，本次未覆盖。" : ""),
      data: imageOutlineSchema.parse(result.data),
    };
  }
  const output =
    mode === "generate"
      ? z
          .object({
            reply: z.string().max(6000),
            groups: z.array(groupOutput).min(1).max(100),
          })
          .parse(raw)
      : z
          .object({ reply: z.string().max(6000), item: itemOutput.nullable() })
          .parse(raw);
  let data: ImageOutline;
  if ("groups" in output) {
    data = {
      ...base,
      sourceRevision,
      sourceHash,
      groups: output.groups.flatMap(original => {
        // Models sometimes wrap the whole Brand Story in one collection. Its
        // uniquely documented image slots still identify each child exactly.
        const expanded: typeof output.groups = [];
        if (
          original.family === "品牌故事" &&
          original.moduleType === "品牌故事"
        ) {
          for (let index = 0; index < original.items.length; ) {
            const item = original.items[index];
            const matches = AMAZON_MODULE_CATALOG.filter(
              s =>
                s.family === "品牌故事" &&
                s.width === item.width &&
                s.height === item.height
            );
            const spec = matches.length === 1 ? matches[0] : null;
            const count = spec ? Math.max(1, spec.defaultCount) : 0;
            const items = original.items.slice(index, index + count);
            if (
              !spec ||
              items.length !== count ||
              items.some(
                i => i.width !== spec.width || i.height !== spec.height
              )
            )
              throw new Error(
                "品牌故事需要分别规划轮播背景与卡片；请为每组使用官方子类型和对应图数"
              );
            expanded.push({ ...original, moduleType: spec.name, items });
            index += count;
          }
        } else expanded.push(original);
        return expanded.flatMap(g => {
          const spec = moduleSpec(g.family, g.moduleType);
          if (spec?.media === "text" && g.items.length > 1) {
            const ids = (
              key: "featureIds" | "benefitIds" | "reviewIds" | "questionIds"
            ) => [...new Set(g.items.flatMap(i => i[key]))];
            g = {
              ...g,
              items: [
                {
                  ...g.items[0],
                  content: g.items.map(i => i.content).join("\n\n"),
                  width: 0,
                  height: 0,
                  mobileWidth: undefined,
                  mobileHeight: undefined,
                  featureIds: ids("featureIds"),
                  benefitIds: ids("benefitIds"),
                  reviewIds: ids("reviewIds"),
                  questionIds: ids("questionIds"),
                },
              ],
            };
          }
          // Brand cards are siblings within one overall Brand Story section.
          const groups =
            g.family === "品牌故事" &&
            g.moduleType !== "轮播背景" &&
            spec?.max === 1 &&
            g.items.length > 1
              ? g.items.map(item => ({ ...g, items: [item] }))
              : [g];
          return groups.map(group => ({
            ...group,
            id: randomUUID(),
            items: group.items.map(i => ({
              ...i,
              id: randomUUID(),
              references: [],
            })),
          }));
        });
      }),
    };
    data = imageOutlineSchema.parse(data);
    if (part && data.groups.some(group => group.family !== part))
      throw new Error(outlinePartRules[part]);
    if (part === "主图") data = moduleOutline(data);
    const primary = data.groups.filter(
        g => g.family === "主图" && g.moduleType === "主图"
      ),
      secondary = data.groups.filter(
        g => g.family === "主图" && g.moduleType === "附图"
      );
    const primaryCount = primary.reduce(
      (count, group) => count + group.items.length,
      0
    );
    const secondaryCount = secondary.reduce(
      (count, group) => count + group.items.length,
      0
    );
    const aplus = data.groups.filter(group => group.family === "高级A+");
    const brand = data.groups.filter(group => group.family === "品牌故事");
    const brandBackgrounds = brand.filter(
      group => group.moduleType === "轮播背景"
    );
    const strictModules =
      !!part || output.groups.every(group => group.brief !== undefined);
    if (data.groups.some(group => group.family === "普通A+"))
      throw new Error("请使用高级A+模块");
    if (
      (!part || part === "主图") &&
      (primaryCount !== 3 ||
        secondaryCount !== 7 ||
        (strictModules && (primary.length !== 1 || secondary.length !== 7)))
    )
      throw new Error(
        `${outlinePartRules.主图} 当前主图${primaryCount}个方案、${primary.length}组，附图${secondaryCount}张、${secondary.length}组。`
      );
    if (!part || part === "高级A+") {
      const positions: number[] = [];
      for (const group of aplus)
        positions.push(...(group.moduleNumbers || [positions.length + 1]));
      if (
        positions.length !== 7 ||
        positions.some((position, index) => position !== index + 1)
      )
        throw new Error(
          `${outlinePartRules["高级A+"]} 当前模块位：${positions.join("、") || "无"}。`
        );
    }
    if (
      (!part || part === "品牌故事") &&
      (brandBackgrounds.length !== 1 ||
        brand.length < 2 ||
        (strictModules &&
          (brand.length !== 5 ||
            (!!part && brand[0]?.moduleType !== "轮播背景"))))
    )
      throw new Error(
        `${outlinePartRules.品牌故事} 当前有${brandBackgrounds.length}个轮播背景和${brand.length - brandBackgrounds.length}个卡片。`
      );
  } else {
    data = structuredClone(base);
    const group = data.groups.find(g => g.id === selection?.groupId),
      index = group?.items.findIndex(i => i.id === selection?.itemId) ?? -1;
    if (!group || index < 0)
      throw new Error("当前图片已变化，请重新打开调整对话");
    if (output.item)
      group.items[index] = {
        ...output.item,
        id: group.items[index].id,
        references: group.items[index].references,
      };
  }
  data = imageOutlineSchema.parse(data);
  data = clearMainImageAssociations(data);
  validateOutlineLinks(data, upstream);
  data = imageOutlineSchema.parse(data);
  if (mode === "adjust" && "item" in output && output.item)
    data = recordManualOutline(base, data);
  return { reply: output.reply, data };
}
