import { describe, expect, it } from "vitest";
import {
  createPickSheet,
  initialPickProfit,
  pickStatusAfterReview,
  type PickCompetitor,
} from "../../../shared/productSelection";
import {
  chartPickParents,
  pickAge,
  pickAnalysis,
  summarizePickRows,
} from "../../../shared/productSelectionAnalysis";
import { calculatePickProfit } from "../../../shared/productSelectionProfit";

function row(
  asin: string,
  parentAsin: string,
  parentSales: number | null,
  childSales: number | null
): PickCompetitor {
  return {
    asin,
    parentAsin,
    parentSales,
    childSales,
    title: "Bee suit",
    brand: "A",
    sku: "",
    spec: "",
    image: "",
    category: "",
    rank: null,
    price: 20,
    rating: 4,
    reviews: 10,
    listedOn: null,
    sellerCountry: "",
    fulfillment: "",
    fbaFee: null,
    packageCm: null,
    packageKg: null,
    productCm: null,
    productKg: null,
    sizeTier: "",
    badges: [],
    listing: [],
  };
}

describe("selection analysis", () => {
  it("takes the monthly maximum and deduplicates parents even after child-level filtering", () => {
    const sheet = createPickSheet("Bee suit", "");
    sheet.imported.rows = [
      row("B000000001", "B000000009", 12, null),
      row("B000000002", "B000000009", 11, null),
      row("B000000003", "B000000010", 0, 0),
      row("B000000004", "B000000011", null, null),
    ];
    sheet.imported.historyRows = [
      {
        asin: "B000000001",
        parentAsin: "B000000009",
        values: { "2026-09": 10, "2026-10": 14 },
      },
      {
        asin: "B000000002",
        parentAsin: "B000000009",
        values: { "2026-09": 11, "2026-10": 0 },
      },
      {
        asin: "B000000003",
        parentAsin: "B000000010",
        values: { "2026-10": 0 },
      },
    ];
    sheet.manualSales["B000000001"] = 0;
    const { rows, months } = pickAnalysis(sheet, "2026-11-07");
    expect(months.at(-1)).toBe("2026-10");
    expect(rows[0].trend.slice(-2)).toEqual([11, 14]);
    expect(rows[1].childSales).toBeNull();
    expect(rows[0].childSales).toBe(0);
    expect(summarizePickRows(rows, "parent").sales).toEqual({
      total: 12,
      known: 2,
      missing: 1,
    });
    expect(summarizePickRows(rows, "child").sales).toEqual({
      total: 0,
      known: 2,
      missing: 2,
    });
    const filtered = chartPickParents(rows.slice(1), months);
    expect(filtered.trend.at(-1)).toMatchObject({
      total: 14,
      known: 2,
      missing: 1,
    });
    expect(filtered.brands).toEqual([{ brand: "A", sales: 12 }]);
    expect(filtered.trend[0].total).toBeNull();
  });

  it("uses calendar boundaries for listing age", () => {
    expect(pickAge("2026-01-31", "2026-04-30")).toBe("纯新");
    expect(pickAge("2026-01-31", "2026-05-01")).toBe("新");
    expect(pickAge("2024-11-07", "2026-11-07")).toBe("老品");
    expect(pickAge("2024-11-06", "2026-11-07")).toBe("很老");
  });

  it("keeps the four review outcomes distinct", () => {
    expect(
      ["approve", "reject", "pass", "hold"].map(action =>
        pickStatusAfterReview(
          action as Parameters<typeof pickStatusAfterReview>[0]
        )
      )
    ).toEqual(["approved", "draft", "passed", "pending"]);
  });
});

describe("selection profit", () => {
  const sample = {
    ...initialPickProfit,
    price: 30,
    packageLength: 30,
    packageWidth: 20,
    packageHeight: 4,
    packageKg: 0.25,
    purchaseCny: 70,
  };
  it("separates seasonal delivery from storage and treats returned stock as a loss", () => {
    const result = calculatePickProfit(sample, 7)!;
    const noReturns = calculatePickProfit({ ...sample, returnRate: 0 }, 7)!;
    const allReturned = calculatePickProfit({ ...sample, returnRate: 100 }, 7)!;
    expect(result.commission).toBe(4.5);
    expect(result.refundFee).toBe(0.9);
    expect(result.inbound).toBe(3);
    expect(result.ordinary.fulfillment).toBe(5.22);
    expect(result.ordinary.usd).toBeLessThan(noReturns.ordinary.usd!);
    expect(allReturned.expectedRevenue).toBe(0);
    expect(allReturned.ordinary.usd).toBeCloseTo(
      -0.9 -
        allReturned.ordinary.fulfillment -
        allReturned.ordinary.storage -
        73 / 7
    );
    expect(result.januaryPeak.fulfillment).toBe(result.peak.fulfillment);
    expect(result.januaryPeak.storage).toBe(result.ordinary.storage);
    expect(result.octoberOrdinary.fulfillment).toBe(
      result.ordinary.fulfillment
    );
    expect(result.octoberOrdinary.storage).toBe(result.peak.storage);
  });
  it("uses category thresholds and does not assume a rate if none is available", () => {
    const result = calculatePickProfit(
      { ...sample, category: "apparel", price: 20 },
      null
    )!;
    expect(result.commission).toBe(2);
    expect(result.ordinary.usd).toBeNull();
    expect(
      calculatePickProfit({ ...sample, category: "apparel", price: 20.01 }, 7)!
        .commission
    ).toBe(3.4);
  });
});
