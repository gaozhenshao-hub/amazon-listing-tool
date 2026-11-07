import { z } from "zod";
export const DOCUMENT_REFERENCE_LOOKUP_LIMIT = 100;

export const planningImageRoleLabel = (role: string) =>
  ({
    main: "主图",
    secondary: "附图",
    aplus: "A+图片",
    brand_story: "品牌故事",
  })[role] || "商品图片";
const common = { label: z.string().max(300).default("") };
export const planningImageReferenceSchema = z.discriminatedUnion("source", [
  z
    .object({
      ...common,
      source: z.literal("knowledge"),
      imageId: z.number().int().positive(),
      setId: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      source: z.literal("reference"),
      imageId: z.number().int().positive(),
      setId: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...common,
      source: z.literal("competitor"),
      analysisId: z.number().int().positive(),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export type PlanningImageReference = z.infer<
  typeof planningImageReferenceSchema
>;
export function planningReferenceKey(ref: PlanningImageReference) {
  return ref.source === "competitor"
    ? `competitor:${ref.analysisId}:${ref.hash}`
    : `knowledge:${ref.imageId}`;
}
