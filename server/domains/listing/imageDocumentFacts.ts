import {
  documentEditableFields,
  type ImageDocument,
} from "../../../shared/imageDocument";
import { planningModelSources } from "./imagePlanningContext";

/** This step uses completed research. Raw competitor parameters remain source
 * evidence in the project, rather than becoming a second product fact sheet. */
export function documentModelSources(input: any) {
  const source = planningModelSources(input);
  const formed = (nodes: any[] | undefined) =>
    (nodes || []).map(node => ({
      ...node,
      evidence: node.evidence?.map(
        ({ quote: _quote, ...anchor }: any) => anchor
      ),
    }));
  return {
    ...source,
    features: formed(source.features),
    selling: formed(source.selling),
    reviews: formed(source.reviews),
    questions: formed(source.questions),
    competitors: (source.competitors || []).map((c: any) => ({
      analysisId: c.analysisId,
      asin: c.asin,
      title: c.title,
      note: "竞品仅用于来源追溯；本品参数以已形成的功能、获益及人工修改为准。",
    })),
    ownProductPhotos: (source.ownProductPhotos || []).map(
      ({ storageKey: _key, ...photo }: any) => photo
    ),
  };
}
const claims = [
  {
    name: "黄铜材质",
    pattern: /黄铜|\bbrass\b/i,
    negative:
      /\b(?:no|not|never|without|avoid|exclude)\s+(?:\w+\s+){0,3}brass\b|(?:禁止|不得|不要|未确认|不宣称|不能|不是|不含|不采用|未采用|非)[^。；\n]{0,18}黄铜/gi,
  },
  {
    name: "防火或阻燃能力",
    pattern: /阻燃|防火|\bfireproof\b|\bflame[- ](?:retardant|resistant)\b/i,
    negative:
      /\b(?:no|not|never|without|avoid|exclude)\s+(?:\w+\s+){0,3}(?:fireproof|flame[- ](?:retardant|resistant))\b|(?:禁止|不得|不要|未确认|不宣称|不能|不是|不含|不采用|未采用|非)[^。；\n]{0,18}(?:阻燃|防火)/gi,
  },
];
export function assertDocumentProductClaims(
  data: ImageDocument,
  input: any,
  base: ImageDocument,
  imageIds: string[]
) {
  const confirmed = [
    input.productNotes || "",
    ...(input.features || [])
      .filter((n: any) => n.availability !== "planned" && n.group !== "improve")
      .map((n: any) => `${n.text}\n${n.note || ""}`),
    ...(input.selling || [])
      .filter((n: any) => n.availability !== "planned" && n.group !== "improve")
      .map((n: any) => `${n.text}\n${n.note || ""}`),
    ...(input.questions || [])
      .filter((q: any) => q.manualFields?.includes("answer"))
      .map((q: any) => q.answer || ""),
    ...base.entries.filter(entry => imageIds.includes(entry.imageId)).flatMap(entry =>
      ([["scenes", entry.scenes], ["copy.icons", entry.copy.icons]] as const)
        .flatMap(([path, items]) => items.flatMap(item =>
          Object.entries(item)
            .filter(([key]) => entry.manualFields?.includes(`${path}.${item.id}.${key}`))
            .map(([, value]) => String(value))
        ))
    ),
    ...Object.entries(documentEditableFields(base))
      .filter(
        ([key, field]) =>
          field.protected && imageIds.some(id => key.startsWith(`image:${id}:`))
      )
      .map(([, field]) => field.value),
  ].join("\n");
  const fields = documentEditableFields(data),
    before = documentEditableFields(base);
  for (const [key, field] of Object.entries(fields)) {
    if (
      before[key]?.protected ||
      !imageIds.some(id => key.startsWith(`image:${id}:`)) ||
      (!/:(?:scenes|copy\.|prompts\.|layoutNote)/.test(key) &&
        !(
          /:(?:title|content)$/.test(key) && before[key]?.value !== field.value
        ))
    )
      continue;
    for (const claim of claims)
      if (
        !claim.pattern.test(confirmed.replace(claim.negative, "")) &&
        claim.pattern.test(field.value.replace(claim.negative, ""))
      )
        throw new Error(
          `本品已确认资料不包含${claim.name}。不要沿用竞品、旧大纲或历史AI建议中的该项能力；请改用已确认的材质与功能重新返回。`
        );
  }
}
export function documentGenerationReply(
  count: number,
  data: ImageDocument,
  imageIds: string[],
  preserveManual = true
) {
  const entries = data.entries.filter(e => imageIds.includes(e.imageId));
  return `已完成${count}个图位的套图文档，包含整体版式、画面构图、${entries.reduce((sum, e) => sum + e.scenes.length, 0)}个场景的拆解、展示文案与图标。${preserveManual ? "已保留人工修改和参考用途。" : "已保留所选参考图及其用途。"}请核对画面、产品结构及展示文案，确认后再一键生成AI提示词。`;
}
