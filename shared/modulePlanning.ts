import {
  imageOutlineSchema,
  makeOutlineGroup,
  type ImageOutline,
  type ImageOutlineGroup,
  type ImageOutlineItem,
} from "./imagePlanning";
import {
  emptyImageDocument,
  makeDocumentEntry,
  type ImageDocument,
  type DocumentEntry,
} from "./imageDocument";
import { documentOutlineFingerprint } from "./imageDocument";
import { acquisitionReviewHash } from "./acquisitionReview";
import { planningReferenceKey } from "./planningImageReference";

export function moduleLabels(groups: ImageOutlineGroup[]) {
  let secondary = 0,
    aplus = 0,
    story = 0;
  return groups.map(g => {
    if (g.family === "主图")
      return g.moduleType === "主图" ? "主图" : `附图${++secondary}`;
    if (g.family === "品牌故事") return `品牌故事${++story}`;
    const numbers = g.moduleNumbers?.length ? g.moduleNumbers : [aplus + 1];
    aplus = Math.max(aplus, ...numbers);
    return `A+${numbers.join("+")}`;
  });
}
const derivedGroupId = (id: string) =>
  id.slice(0, -1) + (parseInt(id.slice(-1), 16) ^ 8).toString(16);
/** Reorganize legacy group wrappers while preserving every image ID and its data. */
export function moduleOutline(input: ImageOutline): ImageOutline {
  const data = structuredClone(input),
    main = data.groups.filter(
      g => g.family === "主图" && g.moduleType === "主图"
    );
  let mainAdded = false;
  data.groups = data.groups.flatMap(g => {
    if (g.family === "主图" && g.moduleType === "主图") {
      if (mainAdded) return [];
      mainAdded = true;
      return [
        {
          ...g,
          brief: main
            .map(m => m.brief || m.title)
            .filter(Boolean)
            .join("\n"),
          items: main.flatMap(m => m.items),
        },
      ];
    }
    if (g.family === "主图" && g.moduleType === "附图" && g.items.length > 1)
      return g.items.map((item, index) => ({
        ...g,
        id: index ? derivedGroupId(item.id) : g.id,
        items: [item],
      }));
    return [g];
  });
  return imageOutlineSchema.parse(data);
}
export const moduleBrief = (g: ImageOutlineGroup) =>
  g.brief ||
  g.title ||
  g.items
    .filter(i => i.title || i.content)
    .map((i, index) => `${index + 1}. ${i.title || i.content}`)
    .join("\n");
const union = (
  items: ImageOutlineItem[],
  key: "benefitIds" | "featureIds" | "reviewIds" | "questionIds"
) => [...new Set(items.flatMap(i => i[key]))];
export function mergeAplusModules(
  outline: ImageOutline,
  leftId: string,
  rightId: string,
  layout: "full" | "carousel",
  manual = true
) {
  const next = structuredClone(outline),
    leftIndex = next.groups.findIndex(g => g.id === leftId),
    rightIndex = next.groups.findIndex(g => g.id === rightId);
  if (leftIndex < 0 || rightIndex !== leftIndex + 1)
    throw new Error("只能合并相邻的A+模块");
  const left = next.groups[leftIndex],
    right = next.groups[rightIndex];
  if (!left.family.includes("A+") || left.family !== right.family)
    throw new Error("请选择同一归属的相邻A+模块");
  if (layout === "carousel" && left.family !== "高级A+")
    throw new Error("普通A+请使用全宽图合并");
  const labels = moduleLabels(next.groups),
    numbers = (g: ImageOutlineGroup, index: number) =>
      g.moduleNumbers || [Number(labels[index].slice(2))];
  const parts = [
    ...(left.mergedParts ||
      numbers(left, leftIndex).map(number => ({
        id: left.id,
        number,
        title: left.title,
        brief: moduleBrief(left),
        moduleType: left.moduleType,
        items: left.items,
      }))),
    ...(right.mergedParts ||
      numbers(right, rightIndex).map(number => ({
        id: right.id,
        number,
        title: right.title,
        brief: moduleBrief(right),
        moduleType: right.moduleType,
        items: right.items,
      }))),
  ];
  if (parts.length > 20) throw new Error("合并模块过多，请分组规划");
  const type =
    layout === "carousel"
      ? "图片轮播"
      : left.family === "高级A+"
        ? "全宽背景图"
        : "顶部图片与文字";
  const count =
    layout === "full"
      ? 1
      : Math.min(6, Math.max(2, left.items.length, right.items.length));
  const merged = makeOutlineGroup(left.family, type, count),
    baseHeight = 600,
    baseWidth = left.family === "高级A+" ? 1464 : 970;
  merged.id = left.id;
  merged.title = `${labels[leftIndex]}＋${labels[rightIndex]}合并`;
  merged.brief = [moduleBrief(left), moduleBrief(right)]
    .filter(Boolean)
    .join("\n\n");
  merged.moduleNumbers = parts.map(p => p.number);
  merged.mergedParts = parts;
  merged.manualFields = manual
    ? ["brief", "structure"]
    : [
        ...new Set([
          ...(left.manualFields || []),
          ...(right.manualFields || []),
        ]),
      ];
  merged.items = merged.items.map((item, index) => {
    const buckets = [left, right].map(g =>
      layout === "carousel" ? [g.items[index % g.items.length]] : g.items
    );
    const sources = buckets.flat();
    return {
      ...item,
      id: item.id,
      sourceImageIds: sources.map(i => i.id),
      title: sources
        .map(i => i.title)
        .filter(Boolean)
        .join(" / ")
        .slice(0, 200),
      content: buckets
        .map((items, region) =>
          items.length
            ? `${region === 0 ? "上半部" : "下半部"}：\n${items.map(i => i.content || i.title || "待细化").join("\n")}`
            : ""
        )
        .filter(Boolean)
        .join("\n\n"),
      width: baseWidth,
      height: Math.min(20000, baseHeight * parts.length),
      mobileWidth: left.family === "高级A+" ? 600 : undefined,
      mobileHeight:
        left.family === "高级A+"
          ? Math.min(20000, 450 * parts.length)
          : undefined,
      benefitIds: union(sources, "benefitIds"),
      featureIds: union(sources, "featureIds"),
      reviewIds: union(sources, "reviewIds"),
      questionIds: union(sources, "questionIds"),
      references: [
        ...new Map(
          sources
            .flatMap(i => i.references)
            .map(r => [`${r.setId}:${r.imageId}`, r])
        ).values(),
      ].slice(0, 20),
      manualFields: manual
        ? [
            "content",
            "width",
            "height",
            "title",
            "featureIds",
            "benefitIds",
            "reviewIds",
            "questionIds",
          ]
        : [...new Set(sources.flatMap(i => i.manualFields || []))],
    };
  });
  next.groups.splice(leftIndex, 2, merged);
  return imageOutlineSchema.parse(next);
}
/** Orphaned detail documents remain available as history after module changes. */
export function documentForOutline(
  data: ImageDocument | undefined,
  outline: ImageOutline
) {
  const next = structuredClone(data || emptyImageDocument()),
    existing = new Map(next.entries.map(e => [e.imageId, e]));
  for (const group of outline.groups)
    for (const item of group.items) {
      const before = existing.get(item.id);
      if (!before) {
        const entry = makeDocumentEntry(
          item,
          !(group.family === "品牌故事" && group.moduleType === "轮播背景")
        );
        entry.outlineFingerprint = acquisitionReviewHash(
          documentOutlineFingerprint(item)
        );
        const sources = (item.sourceImageIds || [])
          .map(id => existing.get(id))
          .filter((e): e is DocumentEntry => !!e);
        if (sources.length) {
          const join = (values: string[], max = 6000) =>
            values.filter(Boolean).join("\n\n").slice(0, max);
          entry.content = join(
            sources.map(
              (e, index) => `区域${index + 1}：${e.content || e.title}`
            )
          );
          entry.layout = "二分构图";
          entry.layoutNote =
            "合并画布，上下分区。\n" +
            sources
              .map(
                (e, index) =>
                  `区域${index + 1}：${e.layoutNote || e.title || e.content}`
              )
              .join("\n")
              .slice(0, 5900);
          entry.scenes = sources
            .flatMap((e, index) =>
              e.scenes.map(scene => ({
                ...scene,
                id: crypto.randomUUID(),
                region: `区域${index + 1} · ${scene.region || scene.name}`,
              }))
            )
            .slice(0, 12);
          for (const kind of ["composition", "effect", "other"] as const) {
            const references = new Map<
              string,
              DocumentEntry["references"][typeof kind][number]
            >();
            for (const reference of sources.flatMap(e => e.references[kind])) {
              const key = planningReferenceKey(reference.reference),
                previous = references.get(key);
              references.set(
                key,
                previous
                  ? {
                      ...previous,
                      purpose: [
                        ...new Set(
                          [previous.purpose, reference.purpose].filter(Boolean)
                        ),
                      ]
                        .join("\n")
                        .slice(0, 1000),
                    }
                  : reference
              );
            }
            entry.references[kind] = [...references.values()].slice(0, 20);
          }
          entry.copy = {
            ...sources[0].copy,
            ...Object.fromEntries(
              (
                [
                  "headlinePosition",
                  "subtitlePosition",
                  "bodyPosition",
                ] as const
              ).map(key => [
                key,
                sources
                  .map((e, index) =>
                    e.copy[key] ? `区域${index + 1}：${e.copy[key]}` : ""
                  )
                  .filter(Boolean)
                  .join("；")
                  .slice(0, 300),
              ])
            ),
            headline: join(
              sources.map(e => e.copy.headline),
              500
            ),
            subtitle: join(
              sources.map(e => e.copy.subtitle),
              1000
            ),
            body: join(sources.map(e => e.copy.body)),
            annotations: join(sources.map(e => e.copy.annotations)),
            icons: sources
              .flatMap(e =>
                e.copy.icons.map(icon => ({ ...icon, id: crypto.randomUUID() }))
              )
              .slice(0, 30),
          };
          for (const key of [
            "scene",
            "product",
            "composition",
            "textIcons",
          ] as const)
            entry.prompts[key] = join(sources.map(e => e.prompts[key]));
          entry.manualFields = [
            ...new Set(sources.flatMap(e => e.manualFields || [])),
          ];
        }
        next.entries.push(entry);
        existing.set(item.id, entry);
      } else {
        const fingerprint = acquisitionReviewHash(
          documentOutlineFingerprint(item)
        );
        for (const key of ["title", "content", "width", "height"] as const) {
          const changed = before.outlineSnapshot
            ? before.outlineSnapshot[key] !== (item[key] ?? "")
            : before.outlineFingerprint !== fingerprint;
          if (changed && !before.manualFields?.includes(key))
            (before as any)[key] = item[key] ?? "";
        }
        before.outlineFingerprint = fingerprint;
      }
      existing.get(item.id)!.outlineSnapshot = {
        title: item.title || "",
        content: item.content,
        width: item.width,
        height: item.height,
      };
    }
  const active = new Set(outline.groups.flatMap(g => g.items.map(i => i.id)));
  next.entries = next.entries.filter(
    e => active.has(e.imageId) || hasDocumentDetails(e)
  );
  return next;
}
function hasDocumentDetails(e: DocumentEntry) {
  return !!(
    e.manualFields?.length ||
    e.title ||
    e.content ||
    e.layout ||
    e.framing ||
    e.layoutNote ||
    Object.values(e.references).some(r => r.length) ||
    e.scenes.some(
      s =>
        s.background ||
        s.product ||
        s.interaction ||
        s.lighting ||
        s.camera ||
        s.region
    ) ||
    e.copy.headline ||
    e.copy.subtitle ||
    e.copy.body ||
    e.copy.icons.length ||
    e.copy.annotations ||
    Object.values(e.prompts).some(Boolean)
  );
}
