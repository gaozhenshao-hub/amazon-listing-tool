import { z } from "zod";
import { ImageTaggingTagsSchema, IMAGE_TAGGING_OPTIONS } from "./imageTagging";
import { IMAGE_BELONG_HIERARCHY } from "./imageTagConstants";

export const IMAGE_UPLOAD_LIMIT = 20 * 1024 * 1024;
export const StandaloneImageUploadSchema = z.object({
  filename: z.string().min(1).max(512),
  base64: z
    .string()
    .min(1)
    .max(Math.ceil(IMAGE_UPLOAD_LIMIT / 3) * 4),
});
export const StandaloneImageTagsSchema = z
  .object({
    tags: ImageTaggingTagsSchema,
    tagAccentColor: z
      .string()
      .refine(
        v =>
          !v || (IMAGE_TAGGING_OPTIONS.colors as readonly string[]).includes(v)
      ),
    tagImageBelong: z
      .string()
      .refine(v => !v || Object.keys(IMAGE_BELONG_HIERARCHY).includes(v)),
    tagImageBelongSub: z.string().max(30),
  })
  .superRefine((value, ctx) => {
    const subs =
      (IMAGE_BELONG_HIERARCHY as Record<string, readonly string[]>)[
        value.tagImageBelong
      ] || [];
    if (value.tagImageBelongSub && !subs.includes(value.tagImageBelongSub))
      ctx.addIssue({
        code: "custom",
        path: ["tagImageBelongSub"],
        message: "请选择对应的归属细分",
      });
  });
