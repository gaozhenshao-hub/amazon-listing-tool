import { z } from "zod";

export const IMAGE_COPY_LIMIT_FIELDS = {
  headline: "主标题",
  subtitle: "副标题",
  bodyLine: "正文每行",
  iconLabel: "图标标签",
} as const;

export type ImageCopyLimitField = keyof typeof IMAGE_COPY_LIMIT_FIELDS;
const limit = z.number().int().min(1).max(500).optional();
export const imageCopyLimitsSchema = z.object({
  headline: limit,
  subtitle: limit,
  bodyLine: limit,
  iconLabel: limit,
  excludedImageIds: z.array(z.string().uuid()).max(600),
}).strict().refine(rules => Object.keys(IMAGE_COPY_LIMIT_FIELDS).some(
  field => rules[field as ImageCopyLimitField] !== undefined
), "请至少填写一项文案长度上限");

export type ImageCopyLimits = z.infer<typeof imageCopyLimitsSchema>;

export const DEFAULT_IMAGE_COPY_LIMITS: ImageCopyLimits = {
  headline: 8,
  subtitle: 14,
  bodyLine: 18,
  iconLabel: 4,
  excludedImageIds: [],
};
