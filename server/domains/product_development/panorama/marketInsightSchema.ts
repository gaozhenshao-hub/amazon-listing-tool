import { z } from "zod";

export const panoramaCompetitorAsinsSchema = z.array(
  z.string().trim().min(1).max(20).transform((asin) => asin.toUpperCase()),
).min(2, "请至少选择 2 个主要竞争对手")
  .max(4, "主要竞争对手最多选择 4 个")
  .superRefine((asins, context) => {
    if (new Set(asins).size !== asins.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "不能重复选择同一个竞争对手" });
    }
  });

export const panoramaPriceBandSchema = z.object({
  label: z.string().min(1).max(80),
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  reason: z.string().max(500).optional().default(""),
}).refine((band) => band.max >= band.min, "价格段上限不能小于下限");

export const competitorMatrixRowSchema = z.object({
  item: z.string().min(1).max(200),
  necessity: z.string().max(200).optional().default(""),
  cells: z.record(z.string(), z.string().max(2_000)).default({}),
  ours: z.string().max(2_000).optional().default(""),
  manualNote: z.string().max(2_000).optional().default(""),
});

export const competitorMatrixSectionSchema = z.object({
  key: z.enum(["selling_points", "parameters", "positive_reviews", "negative_reviews"]),
  label: z.string().min(1).max(100),
  rows: z.array(competitorMatrixRowSchema).min(1).max(30),
});

export const panoramaMarketInsightResultSchema = z.object({
  priceBands: z.array(panoramaPriceBandSchema).min(4).max(5),
  competitors: z.array(z.object({
    asin: z.string().min(1).max(20),
    name: z.string().max(300).optional().default(""),
    brand: z.string().max(255).optional().default(""),
    reason: z.string().max(1_000).optional().default(""),
  })).min(2).max(4),
  sections: z.array(competitorMatrixSectionSchema).length(4),
  summary: z.string().max(4_000).optional().default(""),
}).superRefine((result, context) => {
  const expected = ["selling_points", "parameters", "positive_reviews", "negative_reviews"];
  result.sections.forEach((section, index) => {
    if (section.key !== expected[index]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections", index, "key"],
        message: `第 ${index + 1} 个分析区块必须为 ${expected[index]}`,
      });
    }
  });
  result.priceBands.forEach((band, index) => {
    if (index > 0 && band.min <= result.priceBands[index - 1].max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priceBands", index, "min"],
        message: "价格区间不能重叠，且必须按价格升序排列",
      });
    }
  });
});

export type PanoramaMarketInsightResult = z.infer<typeof panoramaMarketInsightResultSchema>;
