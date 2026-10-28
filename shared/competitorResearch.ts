import { z } from "zod";
export const CompetitorReviewSchema = z.object({
  id: z.string().min(1).max(200), title: z.string().max(1000), body: z.string().min(1).max(8000),
  rating: z.number().min(0).max(5).nullable(), date: z.string().max(200).nullable(),
  variant: z.string().max(500).nullable(), verifiedPurchase: z.boolean(),
  source: z.literal('browser_paste').optional(), importedAt: z.string().optional(),
});
export const ReviewSupplementSchema = z.object({reviews:z.array(CompetitorReviewSchema).max(20)});
export type CompetitorReview = z.infer<typeof CompetitorReviewSchema>;
export function mergeReviewSamples(base: CompetitorReview[], extra: CompetitorReview[]) {
  const result = [...base];
  const key = (r: CompetitorReview) => JSON.stringify([r.title,r.body,r.date,r.variant,r.rating].map(v=>typeof v === 'string' ? v.replace(/\s+/g,' ').trim() : v));
  const ids = new Set(base.map(r=>r.id)), values = new Set(base.map(key));
  for (const review of extra) {
    if (ids.has(review.id) || values.has(key(review))) continue;
    result.push(review); ids.add(review.id); values.add(key(review));
  }
  return result;
}
export const CompetitorResearchSchema = z.object({
  deliveryLocation: z.string().max(160).nullable().optional(),
  dateFirstAvailable: z.string().max(160).nullable(),
  boughtPastMonth: z.string().max(200).nullable(),
  customersSay: z.object({
    summary: z.string().max(8000), source: z.literal('amazon_ai_review_summary'),
    aspects: z.array(z.object({ label: z.string().max(200), mentions: z.number().int().nonnegative().nullable(), sentiment: z.enum(['positive', 'mixed', 'negative', 'unknown']) })).max(30),
  }).nullable().optional(),
  variants: z.array(z.object({
    asin: z.string().regex(/^[A-Z0-9]{10}$/),
    attributes: z.array(z.string().max(200)).max(20),
    boughtPastMonth: z.string().max(200).nullable(),
    dateFirstAvailable: z.string().max(160).nullable(),
    status: z.enum(["collected", "not_fetched", "unavailable"]),
  })).max(100),
  reviews: z.array(CompetitorReviewSchema).max(20),
  reviewCoverage: z.enum(["product_page_sample", "public_page_sample"]),
  reviewFetchStatus: z.enum(["collected", "not_returned", "login_required", "blocked", "request_failed"]).optional(),
  fetchedAt: z.string(),
  attempts: z.number().int().min(1).max(3),
  collectionMethod: z.enum(['http','browser']).optional(),
});
export type CompetitorResearch = z.infer<typeof CompetitorResearchSchema>;
