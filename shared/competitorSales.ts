import { z } from "zod";

const salesValue = z.number().int().min(0).max(1_000_000_000);
const sourceNote = z.string().trim().min(1).max(500).nullable();
export const CompetitorManualSalesSchema = z.object({
  version: z.literal(1), value: salesValue, sourceNote: z.string().trim().min(1).max(500),
  updatedAt: z.string().datetime({ offset: false }).refine(value => Number.isFinite(Date.parse(value)), "Invalid UTC date"),
  updatedBy: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type CompetitorManualSales = z.infer<typeof CompetitorManualSalesSchema>;
export const CompetitorSalesCalibrationInputSchema = z.object({
  projectId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  analysisId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedWorkspaceId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  value: salesValue.nullable(), sourceNote,
}).strict().refine(input => input.value === null ? input.sourceNote === null : input.sourceNote !== null, "Calibration requires a source note; reset must not carry one");
export type CompetitorSalesCalibrationInput = z.infer<typeof CompetitorSalesCalibrationInputSchema>;
export const CompetitorSalesProjectionSchema = z.object({
  manualState: z.enum(["absent", "valid", "invalid"]), manual: CompetitorManualSalesSchema.nullable(), value: salesValue.nullable(),
  source: z.enum(["manual_calibration", "purchase_badges", "seller_sprite_estimate", "unavailable"]),
  scope: z.enum(["observed_variant_asins", "single_asin", "unavailable"]),
  lowerBound: z.boolean(), covered: z.number().int().min(0).max(10_000), total: z.number().int().min(0).max(10_000), partial: z.boolean(),
  sellerSpriteEstimate: salesValue.nullable(), issues: z.array(z.string().regex(/^[A-Z_]+$/u).max(80)).max(10),
}).strict().superRefine((value, ctx) => {
  if (value.covered > value.total || (value.total === 0 || value.covered < value.total) && !value.partial
    || value.scope === "unavailable" && (value.total !== 0 || value.covered !== 0)
    || value.scope === "single_asin" && value.total !== 1
    || value.scope === "observed_variant_asins" && value.total === 0
    || (value.manualState === "valid") !== (value.manual !== null)
    || (value.source === "manual_calibration") !== (value.manual !== null)
    || value.manual !== null && value.value !== value.manual.value
    || (value.source === "unavailable") !== (value.value === null)
    || value.source === "unavailable" && value.covered !== 0
    || value.lowerBound && value.source !== "purchase_badges"
    || value.source === "purchase_badges" && value.covered === 0
    || value.source === "purchase_badges" && value.partial && !value.lowerBound
    || value.source === "seller_sprite_estimate" && (value.sellerSpriteEstimate === null || value.value !== value.sellerSpriteEstimate || value.covered !== 0)) {
    ctx.addIssue({ code: "custom", message: "Inconsistent sales projection" });
  }
});
export type CompetitorSalesProjection = z.infer<typeof CompetitorSalesProjectionSchema>;

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const own = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key);
const asinKey = (value: unknown) => typeof value === "string" && /^[a-z0-9]{10}$/iu.test(value.trim()) ? value.trim().toUpperCase() : null;

/** A badge is an observation, never an exact market-sales claim. No coercion of
 * empty/negative/fractional badges, and no inference from arbitrary text. */
export function parseCompetitorPurchaseBadge(value: unknown): { value: number; lowerBound: boolean } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*([KM]?)\s*(\+)?(?:\s+bought\s+in\s+(?:the\s+)?past\s+month)?$/iu);
  if (!match) return null;
  const multiplier = match[3].toUpperCase() === "M" ? 1_000_000 : match[3].toUpperCase() === "K" ? 1_000 : 1;
  const fraction = match[2] ?? "", digits = `${match[1].replaceAll(",", "")}${fraction}`;
  // Exact integer arithmetic avoids accepting precision loss or underflow.
  if (digits.length > 32 || fraction.length > 12) return null;
  const numerator = BigInt(digits) * BigInt(multiplier), denominator = 10n ** BigInt(fraction.length);
  if (numerator % denominator !== 0n || numerator / denominator > 1_000_000_000n) return null;
  return { value: Number(numerator / denominator), lowerBound: !!match[4] };
}

/** Read only documented source fields; notes and raw strings are data, not instructions.
 * Legacy unversioned calibration is deliberately not promoted to a verified value. */
export function readCompetitorSales(rawData: unknown, asin: string): CompetitorSalesProjection {
  const issues: string[] = [];
  let raw: Record<string, unknown> | null = null;
  if (rawData === null || rawData === undefined || rawData === "") raw = {};
  else if (typeof rawData === "string") {
    try { raw = object(JSON.parse(rawData)); } catch { /* Invalid source stays unknown. */ }
  } else raw = object(rawData);
  if (!raw) return { manualState: "invalid", manual: null, value: null, source: "unavailable", lowerBound: false,
    scope: "unavailable", covered: 0, total: 0, partial: true, sellerSpriteEstimate: null, issues: ["RAW_DATA_INVALID"] };
  const parsedManual = own(raw, "manualSales") ? CompetitorManualSalesSchema.safeParse(raw.manualSales) : null;
  const manual = parsedManual?.success ? parsedManual.data : null;
  const manualState = parsedManual ? manual ? "valid" : "invalid" : "absent";
  if (manualState === "invalid") issues.push("MANUAL_SALES_REVIEW_REQUIRED");

  const seller = object(raw.sellerSpriteData);
  const parsedEstimate = salesValue.safeParse(seller?.monthlySales);
  const sellerSpriteEstimate = parsedEstimate.success ? parsedEstimate.data : null;
  if (seller && own(seller, "monthlySales") && sellerSpriteEstimate === null) issues.push("SELLER_SPRITE_ESTIMATE_INVALID");
  const scraped = object(raw.scrapedData), topResearch = object(raw.research);
  // A later research job receipt may occupy raw.research; it must not hide the
  // actual collected source under scrapedData.research.
  const research = topResearch && ["variants", "boughtPastMonth", "purchaseBadge"].some(key => own(topResearch, key))
    ? topResearch : object(scraped?.research);
  const variants = research?.variants;
  const hasVariants = Array.isArray(variants) && variants.length > 0;
  const badge = research?.boughtPastMonth ?? research?.purchaseBadge ?? raw.purchaseBadge;
  const entries = hasVariants ? variants : badge === undefined ? [] : [{ asin, status: "collected", boughtPastMonth: badge }];
  const unique = new Map<string, ReturnType<typeof parseCompetitorPurchaseBadge>>();
  let invalid = variants !== undefined && !Array.isArray(variants), conflict = false;
  if (entries.length > 10_000) invalid = true;
  if (!invalid) for (const entry of entries) {
    const row = object(entry), key = asinKey(row?.asin);
    if (!row || !key) { invalid = true; break; }
    const badge = row.status === "collected" ? parseCompetitorPurchaseBadge(row.boughtPastMonth) : null;
    const previous = unique.get(key);
    if (previous && badge && (previous.value !== badge.value || previous.lowerBound !== badge.lowerBound)) conflict = true;
    if (!unique.has(key) || !previous) unique.set(key, badge);
  }
  if (invalid) issues.push("PURCHASE_BADGES_INVALID");
  if (conflict) issues.push("PURCHASE_BADGES_CONFLICT");
  const observations = [...unique.values()].filter((value): value is NonNullable<typeof value> => value !== null);
  const sum = observations.reduce((value, badge) => value + badge.value, 0);
  if (!Number.isSafeInteger(sum) || sum > 1_000_000_000) { invalid = true; issues.push("PURCHASE_BADGES_OUT_OF_RANGE"); }
  const covered = invalid || conflict ? 0 : observations.length, total = invalid ? 0 : unique.size;
  const badgeValue = covered ? sum : null, partial = invalid || conflict || total === 0 || covered < total;
  return { manualState, manual, value: manual ? manual.value : badgeValue ?? sellerSpriteEstimate,
    source: manual ? "manual_calibration" : badgeValue !== null ? "purchase_badges" : sellerSpriteEstimate !== null ? "seller_sprite_estimate" : "unavailable",
    // This is only the saved observation set, never proof of an exhaustive
    // variant family. Unknown observed children make the known sum a floor.
    scope: invalid || total === 0 ? "unavailable" : hasVariants ? "observed_variant_asins" : "single_asin",
    lowerBound: !manual && badgeValue !== null && (partial || observations.some(badge => badge.lowerBound)),
    covered, total, partial, sellerSpriteEstimate, issues };
}
