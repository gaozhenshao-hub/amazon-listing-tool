import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import {
  imageDocumentSchema,
  type ImageDocument,
} from "../../../shared/imageDocument";
import { documentModelSources } from "./imageDocumentFacts";

const hash = (value: unknown) =>
  acquisitionReviewHash(JSON.parse(JSON.stringify(value)));
// Guidance and edit markers are provenance, rather than product fact changes.
function factSnapshot(value: any): any {
  if (Array.isArray(value)) return value.map(factSnapshot);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            "planningDefaults",
            "contentRules",
            "factRules",
            "manualFields",
            "manualChangedAt",
          ].includes(key)
      )
      .map(([key, item]) => [key, factSnapshot(item)])
  );
}
const sameFacts = (left: unknown, right: unknown) =>
  hash(factSnapshot(left)) === hash(factSnapshot(right));
const outlineItem = (i: any) =>
  Object.fromEntries(
    [
      "id",
      "title",
      "content",
      "width",
      "height",
      "family",
      "moduleType",
      "featureIds",
      "benefitIds",
      "reviewIds",
      "questionIds",
      "references",
    ].map(k => [k, i[k] ?? (k.endsWith("Ids") || k === "references" ? [] : "")])
  );

/** A revision also changes when locking. Configuration updates are provenance,
 * not a reason to discard an already reviewed output. Actual changed sources
 * still require a new explicit AI task. Manual edits win at whole-image level
 * so layout, scene and copy cannot become a mismatched combination. */
export function reviewDocumentCandidate(
  draft: {
    source_hash: string;
    original: ImageDocument;
    data: ImageDocument;
    input_data: unknown;
  },
  current: ImageDocument,
  context: {
    sourceHash: string;
    sources: { input: any };
    plan: { data: any };
    tags: { categories: string[]; styles: string[] };
    referenceSets: unknown[];
    materials: Array<{ key: string; version: string }>;
  }
) {
  let requests: any;
  try {
    requests =
      typeof draft.input_data === "string"
        ? JSON.parse(draft.input_data)
        : draft.input_data;
  } catch {
    requests = null;
  }
  if (draft.source_hash !== context.sourceHash) {
    if (!Array.isArray(requests) || !requests.length)
      return {
        stale: true,
        reason:
          "本品资料、大纲或参考素材已有更新，请说明改进意见，基于最新资料重新生成。",
        data: draft.data,
        preservedImages: 0,
      };
    const entries = context.plan.data.groups.flatMap((g: any) =>
      g.items.map((i: any) => ({
        ...i,
        family: g.family,
        moduleType: g.moduleType,
      }))
    );
    const input = documentModelSources(context.sources.input);
    const equivalent =
      Array.isArray(requests) &&
      requests.length > 0 &&
      requests.every(
        (r: any) =>
          r.upstream &&
          sameFacts(r.upstream, input) &&
          Array.isArray(r.outline) &&
          r.outline.every((i: any) => {
            const now = entries.find((e: any) => e.id === i.id);
            return now && hash(outlineItem(i)) === hash(outlineItem(now));
          }) &&
          hash(r.selectedReferenceSets || []) === hash(context.referenceSets) &&
          (r.materials || []).every((m: any) =>
            context.materials.some(
              n => n.key === m.key && n.version === m.version
            )
          )
      );
    if (!equivalent) {
      const labels: Record<string, string> = {
        product: "本品基础资料",
        productNotes: "本品补充信息",
        ownProductPhotos: "本品照片",
        planningDialogue: "图片策划对话",
        selling: "用户获益",
        features: "产品功能",
        links: "功能与获益关联",
        reviews: "好差评",
        reviewSummary: "评论汇总",
        questions: "买家问题",
        competitors: "竞品来源",
      };
      const changed = new Set<string>();
      for (const request of requests) {
        for (const [key, label] of Object.entries(labels))
          if (!sameFacts(request.upstream?.[key] ?? null, input[key] ?? null))
            changed.add(label);
        if (
          (request.outline || []).some((i: any) => {
            const now = entries.find((e: any) => e.id === i.id);
            return !now || hash(outlineItem(i)) !== hash(outlineItem(now));
          })
        )
          changed.add("当前图片大纲");
        if (
          hash(request.selectedReferenceSets || []) !==
          hash(context.referenceSets)
        )
          changed.add("参考套图");
        if (
          (request.materials || []).some(
            (m: any) =>
              !context.materials.some(
                n => n.key === m.key && n.version === m.version
              )
          )
        )
          changed.add("已选参考图片");
      }
      return {
        stale: true,
        reason: `已变化：${[...changed].join("、") || "候选来源快照"}。点击“按最新资料更新候选”，保留人工修改并重新核对后确认。`,
        data: draft.data,
        preservedImages: 0,
      };
    }
  }
  const next = structuredClone(draft.data);
  if (
    (!!next.category && !context.tags.categories.includes(next.category)) ||
    next.styles.some(s => !context.tags.styles.includes(s))
  )
    return {
      stale: true,
      reason: "预览使用的类目或风格标签已变更，请改进后重新生成。",
      data: next,
      preservedImages: 0,
    };
  let preservedImages = 0;
  for (const key of ["category", "styles", "palette"] as const)
    if (
      current.manualFields?.includes(key) ||
      hash(current[key]) !== hash(draft.original[key])
    )
      (next as any)[key] = current[key];
  next.manualFields = current.manualFields;
  const allowed = new Set(
    context.plan.data.groups.flatMap((g: any) => g.items.map((i: any) => i.id))
  );
  next.entries = next.entries.filter(
    e =>
      allowed.has(e.imageId) ||
      current.entries.some(c => c.imageId === e.imageId)
  );
  for (const entry of current.entries) {
    const original = draft.original.entries.find(
      e => e.imageId === entry.imageId
    );
    if (!original || hash(entry) !== hash(original)) {
      const index = next.entries.findIndex(e => e.imageId === entry.imageId);
      if (index >= 0) next.entries[index] = structuredClone(entry);
      else next.entries.push(structuredClone(entry));
      preservedImages++;
    }
  }
  return {
    stale: false,
    reason: "",
    data: imageDocumentSchema.parse(next),
    preservedImages,
  };
}
