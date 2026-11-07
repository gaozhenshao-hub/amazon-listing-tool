import { z } from "zod";
import { RESEARCH_CATEGORIES, PAGE_KEYS } from "./researchCategories";
import SHA256 from "crypto-js/sha256.js";
export const aggregationConceptKey = (
  kind: string,
  text: string,
  sentiment = ""
) =>
  kind +
  ":" +
  sentiment +
  ":" +
  SHA256(text.trim().replace(/\s+/g, "").toLowerCase()).toString();

export const SELLING_GROUPS = ["primary", "secondary",
  "necessary",
  "differentiated",
  "improve",
] as const;
export const sellingGroupLabels: Record<(typeof SELLING_GROUPS)[number], string> = {
  primary: "主要卖点", secondary: "次要卖点", differentiated: "差异化卖点", necessary: "必要卖点", improve: "待实现卖点",
};
export const FEATURE_GROUPS = [
  "quality",
  "design",
  "detail",
  "information",
  "differentiated",
  "improve",
] as const;
export const featureGroupLabels: Record<
  (typeof FEATURE_GROUPS)[number],
  string
> = {
  quality: "基础质量（核心功能）",
  design: "设计加分",
  detail: "细节把控",
  information: "必要性描述",
  differentiated: "差异化功能",
  improve: "待改进功能",
};
const text = z.string().trim().min(1).max(500);
const note = z.string().max(3000).default("");
const id = z.string().uuid();
export const aggregationEvidenceSchema = z
  .object({
    analysisId: z.number().int().positive().optional(),
    asin: z.string().max(20).optional(),
    kind: z.enum([
      "listing",
      "bullet",
      "image",
      "module",
      "video",
      "review",
      "product",
      "user",
    ]),
    sourceKey: z.string().max(220),
    quote: z.string().max(6000),
    hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    moduleId: z.string().max(80).optional(),
    blockId: z.string().max(120).optional(),
    bulletIndex: z.number().int().min(0).max(30).optional(),
    start: z.number().nonnegative().max(7200).optional(),
    end: z.number().nonnegative().max(7200).optional(),
    generatedAt: z.string().max(100).optional(),
    basis: z.enum(["direct", "inferred", "user"]).default("direct"),
  })
  .strict();
export const manualFields = {
  category: z.enum(RESEARCH_CATEGORIES).optional(),
  manual: z.boolean().optional(),
  manualFields: z.array(z.string().max(40)).max(30).optional(),
  manualChangedAt: z.string().max(40).optional(),
  differentiated: z.boolean().optional(),
  availability: z.enum(["current", "planned"]).optional(),
};
const nodeFields = {
  ...manualFields,
  evidence: z.array(aggregationEvidenceSchema).max(1000).optional(),
  badges: z.array(z.string().max(40)).max(12).optional(),
  comparisonScope: z.string().max(1000).optional(),
  manual: z.boolean().optional(),
  sourceKey: z.string().max(220).optional(),
  position: z
    .object({
      x: z.number().min(-20000).max(20000),
      y: z.number().min(-20000).max(20000),
    })
    .strict()
    .optional(),
};
export const sellingItemSchema = z.object({ id, text, note, group: z.enum(SELLING_GROUPS), ...nodeFields })
  .strict();
export const featureItemSchema = z
  .object({ id, text, note, group: z.enum(FEATURE_GROUPS), ...nodeFields })
  .strict();
export const featureBenefitLinkSchema = z
  .object({
    id,
    featureId: id,
    benefitId: id,
    note,
    manual: z.boolean().optional(),
  }).strict();
export const reviewItemSchema = z.object({ id, text, note, ...manualFields, sentiment: z.enum(["positive", "negative"]),
    count: z.number().int().nonnegative().optional(),
    sourceKey: z.string().max(220).optional(),
  percentage: z.number().min(0).max(100).nullable().default(null),
  sampleSize:z.number().int().nonnegative().nullable().default(null),
  evidence:z.array(z.object({analysisId:z.number().int().positive(),groupIndex:z.number().int().nonnegative(),generatedAt:z.string().max(100),
          }).strict()).max(500).optional(),
  status: z.enum(["unset", "covered", "not_covered", "solved", "not_solved"]).default("unset"),
  }).strict().superRefine((value, ctx) => {
    if ((value.sentiment === "positive" && ["solved", "not_solved"].includes(value.status)) ||
        (value.sentiment === "negative" && ["covered", "not_covered"].includes(value.status))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "评论状态与好评或差评不一致",
      });
    }
  });
export const originalQuestionSchema = z.object({id,text,note,...manualFields,answer:z.string().max(6000).optional(),source:z.enum(["manual","uploaded","review","listing","inferred"]).optional(),sourceKey:z.string().max(220).optional()}).strict();
export const questionItemSchema = z.object({ id, text, note, ...manualFields,
    mergedQuestionIds: z.array(id).max(1000).optional(),
    mergeInputIds: z.array(id).max(500).optional(),
    originalQuestions: z.array(originalQuestionSchema).max(1000).optional(),
    answer: z.string().max(6000).optional(),
    evidence: z.array(aggregationEvidenceSchema).max(1000).optional(),
    sourceKey: z.string().max(220).optional(), source: z.enum(["manual", "uploaded", "review", "listing", "inferred"]).default("manual"),
  }).strict();
export const competitorMarksSchema = z.object({ analysisId: z.number().int().positive(), likedAssets: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1000),
  highlights: z.array(z.object({ bulletIndex: z.number().int().min(0).max(20), start: z.number().int().nonnegative(), end: z.number().int().positive(), text: z.string().min(1).max(5000),
          }).strict()).max(500),
  edits:z.record(z.string(),z.object({original:z.string().max(30000),value:z.string().max(30000),
          }).strict()).default({}),
  }).strict();
export const listingAggregationSchema = z.object({ selling: z.array(sellingItemSchema).max(500), reviews: z.array(reviewItemSchema).max(500),
    questionMergeBase: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    reviewHistory: z.array(reviewItemSchema).max(1000).optional(),
    excludedConcepts: z.array(z.object({id,kind:z.enum(["features","selling","reviews","questions"]),text,sourceKey:z.string().max(220)}).strict()).max(2000).optional(),
    features: z.array(featureItemSchema).max(500).optional(),
    links: z.array(featureBenefitLinkSchema).max(2000).optional(),
    productNotes: z.string().max(20000).optional(),
    productPhotos: z.array(z.object({id:z.string().uuid(),name:z.string().max(200),kind:z.enum(["product","accessory"]),storageKey:z.string().max(1000),width:z.number().int().positive(),height:z.number().int().positive()}).strict()).max(30).optional(),
    planningConversation:z.object({epoch:z.string().uuid(),revision:z.number().int().nonnegative(),messages:z.array(z.object({id:z.string().uuid(),role:z.enum(["user","assistant"]),text:z.string().max(12000),createdAt:z.string().max(40)}).strict()).max(300),opened:z.boolean(),jobRunId:z.string().max(200).nullable(),error:z.string().max(500).optional()}).strict().optional(),
    pageLocks: z.object({selling:z.boolean().optional(),reviews:z.boolean().optional(),questions:z.boolean().optional(),listing:z.boolean().optional(),planning:z.boolean().optional(),outline:z.boolean().optional(),references:z.boolean().optional()}).strict().optional(),
    researchJobs:z.object({selling:z.string().max(200).optional(),reviews:z.string().max(200).optional(),questions:z.string().max(200).optional()}).strict().optional(),
    organized: z.object({selling:z.boolean().optional(),reviews:z.boolean().optional(),questions:z.boolean().optional()}).strict().optional(),
    excludedSourceKeys: z.array(z.string().max(220)).max(2000).optional(),
    excludedLinks: z.array(z.string().max(80)).max(2000).optional(),
    reviewSummary: z
      .object({
        sampleCount: z.number().int().nonnegative(),
        positive: z.number().int().nonnegative(),
        negative: z.number().int().nonnegative(),
        unrated: z.number().int().nonnegative(),
        asinCount: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    questions: z.array(questionItemSchema).max(500), marks: z.array(competitorMarksSchema).max(500).default([]),
  }).strict()
  .superRefine((value, ctx) => {
    const features = new Set((value.features || []).map(n => n.id)),
      benefits = new Set(value.selling.map(n => n.id));
    if (
      [...features].some(id=>benefits.has(id)) ||
      features.size !== (value.features || []).length ||
      benefits.size !== value.selling.length
    )
      ctx.addIssue({ code: "custom", message: "功能或卖点节点重复" });
    const pairs = new Set<string>();
    for (const link of value.links || []) {
      const pair = link.featureId + ":" + link.benefitId;
      if (
        !features.has(link.featureId) ||
        !benefits.has(link.benefitId) ||
        pairs.has(pair)
      )
        ctx.addIssue({
          code: "custom",
          message: "连线必须连接当前功能和卖点，且不能重复",
        });
      pairs.add(pair);
    }
  });
export type ListingAggregation = z.infer<typeof listingAggregationSchema>;
export type AggregationFeature = z.infer<typeof featureItemSchema>;
export type AggregationBenefit = z.infer<typeof sellingItemSchema>;
export type AggregationEvidence = z.infer<typeof aggregationEvidenceSchema>;
export const emptyListingAggregation = (): ListingAggregation => ({ selling: [], reviews: [], questions: [], marks: [],
});
