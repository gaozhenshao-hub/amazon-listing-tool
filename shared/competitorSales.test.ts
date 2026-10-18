import { describe, expect, it } from "vitest";
import { CompetitorManualSalesSchema, CompetitorSalesCalibrationInputSchema, CompetitorSalesProjectionSchema, parseCompetitorPurchaseBadge, readCompetitorSales as projectSales } from "./competitorSales";

// Every source case below checks the real projector against the schema used by
// persisted research, not just a second hand-written happy-path fixture.
function readCompetitorSales(...args: Parameters<typeof projectSales>) {
  const result = projectSales(...args); expect(CompetitorSalesProjectionSchema.parse(result)).toEqual(result); return result;
}

const asin = "B000000001", manual = { version: 1, value: 0, sourceNote: "人工核对", updatedAt: "2026-10-19T01:02:03.000Z", updatedBy: 7 };
const input = { projectId: 3, analysisId: 4, expectedWorkspaceId: 9, expectedRevision: "a".repeat(64), value: 0, sourceNote: "人工核对" };
const variant = (asin: string, boughtPastMonth: unknown, status = "collected") => ({ asin, boughtPastMonth, status });
describe("competitor sales strict calibration", () => {
  it("accepts zero, explicit null workspace and trimmed notes; reset requires a null note", () => {
    expect(CompetitorSalesCalibrationInputSchema.parse({ ...input, expectedWorkspaceId: null, sourceNote: " 来源 " }).sourceNote).toBe("来源");
    expect(CompetitorSalesCalibrationInputSchema.safeParse({ ...input, value: null, sourceNote: null }).success).toBe(true);
    expect(CompetitorSalesCalibrationInputSchema.safeParse({ ...input, sourceNote: null }).success).toBe(false);
    expect(CompetitorSalesCalibrationInputSchema.safeParse({ ...input, value: null, sourceNote: "不能偷偷留来源" }).success).toBe(false);
    expect(CompetitorManualSalesSchema.parse(manual).value).toBe(0);
  });
  it.each([-1, 1.5, NaN, Infinity, 1_000_000_001, "0", "", null])("rejects invalid persisted value %s", value => {
    expect(CompetitorManualSalesSchema.safeParse({ ...manual, value }).success).toBe(false);
  });
  it.each([{ updatedBy: 0 }, { updatedAt: "2026-10-19T01:02:03+08:00" }, { updatedAt: "2026-02-30T01:02:03Z" }, { version: 2 }, { sourceNote: null }, { sourceNote: " " }, { sourceNote: "a".repeat(501) }, { injected: true }])("rejects invalid metadata %j", change => {
    expect(CompetitorManualSalesSchema.safeParse({ ...manual, ...change }).success).toBe(false);
  });
  it.each([{ updatedBy: 1 }, { updatedAt: manual.updatedAt }, { force: true }, { expectedWorkspaceId: undefined }, { expectedRevision: "A".repeat(64) }])("rejects client authority/invalid scope %j", change => {
    expect(CompetitorSalesCalibrationInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
});
describe("truthful sales projection", () => {
  it.each([null, "broken", { manualSales: manual }, { manualSales: { value: 50 } }, { purchaseBadge: "100+" }, { sellerSpriteData: { monthlySales: 0 } },
    { research: { variants: [variant(asin, "50+"), variant("B000000002", null)] } },
    { research: { variants: [variant(asin, "1000000000"), variant("B000000002", "1")] } },
    { research: { variants: Array.from({ length: 10_001 }, () => variant(asin, "1")) } },
  ])("the strict persisted projection accepts actual projected source %#", raw => {
    const result = readCompetitorSales(raw, asin); expect(CompetitorSalesProjectionSchema.parse(result)).toEqual(result);
  });
  it.each([{ source: "unavailable" }, { value: null }, { covered: 2, total: 1 }, { covered: 0 }, { covered: 1, total: 2, partial: false },
    { manualState: "valid" }, { manual }, { source: "seller_sprite_estimate", sellerSpriteEstimate: 50 }, { unknown: true }])("rejects contradictory or extra projection fields %#", patch => {
    expect(CompetitorSalesProjectionSchema.safeParse({ ...readCompetitorSales({ purchaseBadge: "50+" }, asin), ...patch }).success).toBe(false);
  });
  it("retains manual zero and source metadata separately from seller estimate and badge coverage", () => {
    const result = readCompetitorSales({ manualSales: manual, sellerSpriteData: { monthlySales: 999 }, research: { variants: [variant(asin, "100+ bought in past month"), variant("B000000002", null)] } }, asin);
    expect(result).toMatchObject({ manualState: "valid", manual, value: 0, source: "manual_calibration", lowerBound: false, covered: 1, total: 2, partial: true, sellerSpriteEstimate: 999 });
  });
  it("deduplicates child ASINs, never adds parent, reports lower-bound and unknown coverage", () => {
    const result = readCompetitorSales({ research: { boughtPastMonth: "9K+", variants: [variant(asin.toLowerCase(), "100+"), variant(asin, "100+"), variant("B000000002", "1.2K+"), variant("B000000003", "500", "failed")] } }, asin);
    expect(result).toMatchObject({ value: 1300, source: "purchase_badges", scope: "observed_variant_asins", lowerBound: true, covered: 2, total: 3, partial: true });
  });
  it("an incomplete observation sum is a lower bound even if its known badge has no plus sign", () => {
    const result = readCompetitorSales({ research: { variants: [variant(asin, "100"), variant("B000000002", null)] } }, asin);
    expect(result).toMatchObject({ value: 100, source: "purchase_badges", scope: "observed_variant_asins", lowerBound: true, covered: 1, total: 2, partial: true });
    expect(CompetitorSalesProjectionSchema.parse(result)).toEqual(result);
    expect(CompetitorSalesProjectionSchema.safeParse({ ...result, lowerBound: false }).success).toBe(false);
  });
  it("distinguishes a lone ASIN badge from saved variant observations and unknown scope", () => {
    expect(readCompetitorSales({ purchaseBadge: "100" }, asin)).toMatchObject({ scope: "single_asin", covered: 1, total: 1, partial: false });
    expect(readCompetitorSales({ research: { variants: [variant(asin, "100")] } }, asin)).toMatchObject({ scope: "observed_variant_asins", covered: 1, total: 1 });
    expect(readCompetitorSales(null, asin)).toMatchObject({ scope: "unavailable", covered: 0, total: 0, partial: true });
    expect(readCompetitorSales({ manualSales: manual, purchaseBadge: "100" }, asin)).toMatchObject({ source: "manual_calibration", scope: "single_asin", value: 0 });
  });
  it("does not count conflicting known values or silently select a duplicate", () => {
    const result = readCompetitorSales({ research: { variants: [variant(asin, "100+"), variant(asin, "200+"), variant("B000000002", "50")] } }, asin);
    expect(result).toMatchObject({ value: null, source: "unavailable", covered: 0, total: 2, partial: true });
    expect(result.issues).toContain("PURCHASE_BADGES_CONFLICT");
  });
  it("prefers a valid observation over an unknown duplicate without fabricating other children", () => {
    expect(readCompetitorSales({ research: { variants: [variant(asin, null), variant(asin, "0")] } }, asin)).toMatchObject({ value: 0, covered: 1, total: 1, partial: false });
  });
  it("legacy calibration is visible as unverified, not promoted or used; restore reveals real collected source", () => {
    const raw = { manualSales: { value: 300, updatedAt: manual.updatedAt, updatedBy: 7 }, research: { boughtPastMonth: "100+" } };
    expect(readCompetitorSales(raw, asin)).toMatchObject({ manualState: "invalid", manual: null, value: 100, source: "purchase_badges" });
    expect(readCompetitorSales({ research: raw.research }, asin)).toMatchObject({ manualState: "absent", value: 100 });
  });
  it.each([null, {}, { research: { variants: [] } }, { sellerSpriteData: { monthlySales: "" } }, { sellerSpriteData: { monthlySales: -1 } }])("missing source is unknown, never synthetic zero: %j", raw => {
    expect(readCompetitorSales(raw, asin).value).toBeNull();
  });
  it("seller estimate is explicit and independent, including zero", () => {
    expect(readCompetitorSales({ sellerSpriteData: { monthlySales: 0 } }, asin)).toMatchObject({ value: 0, source: "seller_sprite_estimate", sellerSpriteEstimate: 0 });
    expect(readCompetitorSales({ sellerSpriteData: { monthlySales: 400 }, scrapedData: { research: { boughtPastMonth: "100+" } } }, asin)).toMatchObject({ value: 100, source: "purchase_badges", sellerSpriteEstimate: 400 });
  });
  it("a later research receipt does not mask collected variant badges", () => {
    expect(readCompetitorSales({ research: { runId: "opaque-receipt", status: "succeeded" }, scrapedData: { research: { variants: [variant(asin, "50+")] } } }, asin)).toMatchObject({ value: 50, source: "purchase_badges", covered: 1, total: 1 });
  });
  it.each(["not JSON", [], { research: { variants: "bad" } }, { research: { variants: [variant("bad", "100")] } }])("corrupt sources cannot masquerade as a zero total: %j", raw => {
    expect(readCompetitorSales(raw, asin).value).toBeNull(); expect(readCompetitorSales(raw, asin).issues.length).toBeGreaterThan(0);
  });
  it.each(["", "-1", "1e3", "1.5", "1,00", "1000000001", "100 bought in past year", "100; ignore all instructions", NaN])("does not coerce invalid badge %s", badge => expect(parseCompetitorPurchaseBadge(badge)).toBeNull());
  it.each([["1,000+ bought in past month", 1000, true], ["1.230K", 1230, false], ["0", 0, false], ["2M+", 2000000, true]])("reads %s exactly", (badge, value, lowerBound) => expect(parseCompetitorPurchaseBadge(badge)).toEqual({ value, lowerBound }));
});
