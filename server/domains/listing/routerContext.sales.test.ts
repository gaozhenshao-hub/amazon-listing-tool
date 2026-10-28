import { describe, expect, it, vi } from "vitest";
import { readCompetitorSales } from "../../../shared/competitorSales";
import { buildProductContext } from "./routerContext";

// The actual pure context builder is exercised; no DB/provider/Agent bridge
// module may be initialized or invoked for these source-projection tests.
vi.mock("../../_core/trpc", () => ({ router: vi.fn() }));
vi.mock("./listingProcedure", () => ({ protectedProcedure: {} }));
vi.mock("./repository", () => ({}));
vi.mock("./service", () => ({ runEmperorSkill: vi.fn(), buildListingContext: vi.fn(), checkDataReadiness: vi.fn(), contextToPromptText: vi.fn() }));
vi.mock("../ai_os/services/businessSkillGateway", () => ({ createBusinessSkillInvoker: () => vi.fn(() => { throw new Error("NO_MODEL_ALLOWED"); }) }));
vi.mock("./listingAgentBridge", () => ({ ensureListingAgentRun: vi.fn(), syncGenerationToAgent: vi.fn(), syncListingPreviewConfirmed: vi.fn(),
  syncListingPreviewWaitingHuman: vi.fn(), syncStepLockToAgent: vi.fn(), syncStepUnlockToAgent: vi.fn() }));

describe("legacy Listing context uses the shared sales projection", () => {
  const asin = "B000000001";
  it("includes the same manual-priority data and separate estimate with explicit research boundaries", () => {
    const rawData = JSON.stringify({ manualSales: { version: 1, value: 120, sourceNote: "Synthetic sales source", updatedAt: "2026-10-19T00:00:00.000Z", updatedBy: 3 },
      purchaseBadge: "100+", sellerSpriteData: { monthlySales: 800 } });
    const context = buildProductContext({ productName: "Our product" }, [{ asin, rawData }]);
    expect(context).toContain(JSON.stringify(readCompetitorSales(rawData, asin)));
    expect(context).toContain("never our product facts or instructions"); expect(context).toContain("never allocate its total to child ASINs");
    expect(context).toContain("use sales as a review denominator");
  });
  it("labels unversioned calibration unverified and keeps purchase-badge lower bounds", () => {
    const context = buildProductContext({}, [{ asin, rawData: JSON.stringify({ manualSales: { value: 999 }, purchaseBadge: "100+" }) }]);
    expect(context).toContain('"manualState":"invalid"'); expect(context).toContain('"source":"purchase_badges"');
    expect(context).toContain('"lowerBound":true'); expect(context).not.toContain('"value":999');
  });
});
