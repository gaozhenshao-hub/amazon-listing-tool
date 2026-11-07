import { z } from "zod";
import {
  IMAGE_COPY_LIMIT_FIELDS,
  type ImageCopyLimitField,
  type ImageCopyLimits,
} from "../../../shared/imageCopyLimits";
import {
  imageDocumentSchema,
  type DocumentEntry,
  type ImageDocument,
} from "../../../shared/imageDocument";

const chinese = /中文|汉语|chinese/i;
const han = /\p{Script=Han}/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

function copyLength(value: string) {
  let count = 0;
  for (const { segment, isWordLike } of segmenter.segment(value)) {
    if (isWordLike) count += han.test(segment) ? [...segment].length : 1;
  }
  return count;
}

type CopyRepair = {
  key: string;
  imageId: string;
  field: ImageCopyLimitField;
  index?: number;
  text: string;
  language: string;
  actual: number;
  limit: number;
  translationNeeded: boolean;
};

export function findCopyRepairs(
  data: ImageDocument,
  imageIds: readonly string[],
  rules: ImageCopyLimits
) {
  const repairs: CopyRepair[] = [];
  for (const entry of data.entries) {
    if (!imageIds.includes(entry.imageId) || rules.excludedImageIds.includes(entry.imageId)) continue;
    const manual = (path: string) => entry.manualFields?.includes(path);
    const { copy } = entry;
    const add = (
      field: ImageCopyLimitField,
      text: string,
      source: string,
      translation: string,
      index?: number
    ) => {
      const limit = rules[field];
      if (limit === undefined || manual(source)) return;
      const actual = copyLength(text);
      if (actual > limit) repairs.push({
        key: [entry.imageId, field, index].filter(part => part !== undefined).join(":"),
        imageId: entry.imageId,
        field,
        index,
        text,
        language: copy.language,
        actual,
        limit,
        translationNeeded: !chinese.test(copy.language) && !manual(translation),
      });
    };
    for (const field of ["headline", "subtitle"] as const)
      add(field, copy[field], `copy.${field}`, `copy.${field}Zh`);
    copy.body.split("\n").forEach((line, index) =>
      add("bodyLine", line, "copy.body", "copy.bodyZh", index));
    if (!manual("copy.icons")) copy.icons.forEach((icon, index) =>
      add("iconLabel", icon.label, `copy.icons.${icon.id}.label`, `copy.icons.${icon.id}.labelZh`, index));
  }
  return repairs;
}

function needsBodyTranslation(entry: DocumentEntry) {
  return entry.copy.body.split("\n").length !== (entry.copy.bodyZh || "").split("\n").length;
}

export function copyRepairRequest(data: ImageDocument, repairs: CopyRepair[]) {
  const bodyTranslations = data.entries
    .filter(entry => repairs.some(repair => repair.imageId === entry.imageId &&
      repair.field === "bodyLine" && repair.translationNeeded) && needsBodyTranslation(entry))
    .map(entry => ({ imageId: entry.imageId, originalBody: entry.copy.body }));
  return { repairs, bodyTranslations };
}

const repairOutput = z.object({
  changes: z.array(z.object({
    key: z.string(),
    text: z.string().trim().min(1).max(6000),
    translation: z.string().trim().max(6000).default(""),
  }).strict()),
  bodyTranslations: z.array(z.object({
    imageId: z.string().uuid(),
    translation: z.string().trim().min(1).max(6000),
  }).strict()).default([]),
}).strict();

export function applyCopyRepairs(
  raw: unknown,
  data: ImageDocument,
  request: ReturnType<typeof copyRepairRequest>
) {
  const output = repairOutput.parse(raw);
  const changes = new Map(output.changes.map(change => [change.key, change]));
  const bodyTranslations = new Map(output.bodyTranslations.map(item => [item.imageId, item.translation]));
  if (changes.size !== output.changes.length || changes.size !== request.repairs.length ||
      bodyTranslations.size !== output.bodyTranslations.length ||
      bodyTranslations.size !== request.bodyTranslations.length)
    throw new Error("请且仅返回每个需要返修的字段一次");
  const next = structuredClone(data);
  for (const repair of request.repairs) {
    const change = changes.get(repair.key);
    const { field, index, translationNeeded } = repair;
    const wholeBody = request.bodyTranslations.some(item => item.imageId === repair.imageId);
    if (!change || /[\r\n]/.test(change.text) || !copyLength(change.text) ||
        copyLength(change.text) > repair.limit)
      throw new ImageCopyLimitError(repair);
    if (translationNeeded && (field !== "bodyLine" || !wholeBody) &&
        (!han.test(change.translation) || /[\r\n]/.test(change.translation)))
      throw new Error(`${IMAGE_COPY_LIMIT_FIELDS[field]}需要对应的一行中文译文`);
    const { copy } = next.entries.find(entry => entry.imageId === repair.imageId)!;
    switch (field) {
      case "headline":
      case "subtitle":
        copy[field] = change.text;
        if (translationNeeded) copy[`${field}Zh`] = change.translation;
        break;
      case "iconLabel":
        copy.icons[index!].label = change.text;
        if (translationNeeded) copy.icons[index!].labelZh = change.translation;
        break;
      case "bodyLine": {
        const lines = copy.body.split("\n");
        lines[index!] = change.text + (lines[index!].endsWith("\r") ? "\r" : "");
        copy.body = lines.join("\n");
        if (translationNeeded && !wholeBody) {
          const translated = (copy.bodyZh || "").split("\n");
          translated[index!] = change.translation + (translated[index!].endsWith("\r") ? "\r" : "");
          copy.bodyZh = translated.join("\n");
        }
        break;
      }
    }
  }
  for (const { imageId } of request.bodyTranslations) {
    const entry = next.entries.find(item => item.imageId === imageId)!;
    const translation = bodyTranslations.get(imageId);
    const lines = translation?.split("\n");
    if (!lines || lines.length !== entry.copy.body.split("\n").length ||
        lines.some((line, index) => entry.copy.body.split("\n")[index].trim() && !han.test(line)))
      throw new Error("正文中文译文需要和返修后的原文逐行对应");
    entry.copy.bodyZh = translation;
  }
  return imageDocumentSchema.parse(next);
}

const publicIssueSchema = z.object({
  imageId: z.string().uuid(),
  field: z.enum(["headline", "subtitle", "bodyLine", "iconLabel"]),
  index: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(500),
});
const errorMarker = "IMAGE_COPY_LIMIT ";

export class ImageCopyLimitError extends Error {
  constructor({ imageId, field, index, limit }: CopyRepair) {
    super(errorMarker + JSON.stringify({ imageId, field, index, limit }));
  }
}

export function imageCopyLimitIssue(message: string | null | undefined) {
  const payload = message?.match(/^(?:\[(?:unknown|provider)\] )?IMAGE_COPY_LIMIT (\{[^\n]*\})$/)?.[1];
  if (!payload) return null;
  try {
    return publicIssueSchema.parse(JSON.parse(payload));
  } catch {
    return null;
  }
}
