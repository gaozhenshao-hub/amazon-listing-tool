import { describe, expect, it } from "vitest";
import {
  filterReadGroups,
  financialReadGroups,
  formatReadAmount,
  inventoryReadGroups,
  readAmount,
  readGroupPage,
  type InventoryReadRecord,
} from "./operationsReadOnlyModel";

const inventory = (
  changes: Partial<InventoryReadRecord> = {}
): InventoryReadRecord => ({
  parentAsin: "B0PARENT001",
  asin: "B0CHILD001",
  storeName: "Store A",
  country: "US",
  sku: "sku-a",
  productName: "原品名",
  operator: "Alice",
  totalInventory: 12,
  localInventory: 2,
  currency: "USD",
  productCost: null,
  ...changes,
});
const financial = (changes = {}) => ({
  id: 1,
  parentAsin: "B0PARENT001",
  storeName: "Store A",
  country: "US",
  yearMonth: "2026-09",
  financialProfit: "12.34",
  ...changes,
});

describe("existing operations read projections", () => {
  it.each([
    null,
    undefined,
    "",
    " ",
    false,
    "-",
    "NaN",
    NaN,
    Infinity,
    "1e10",
    "1,000",
    "9007199254740993",
  ])("does not turn missing or unsupported %s into zero", value => {
    expect(readAmount(value)).toBeNull();
  });
  it("retains reported zero, negative profit and valid decimal strings", () => {
    expect(readAmount(0)).toBe(0);
    expect(readAmount("0.00")).toBe(0);
    expect(readAmount("-120.50")).toBe(-120.5);
    expect(formatReadAmount(null)).toBe("—");
  });
  it("groups only an exact parent/store/site and retains composite child identities", () => {
    const groups = inventoryReadGroups([
      inventory(),
      inventory({ asin: "B0CHILD002" }),
      inventory({ country: "CA" }),
      inventory({ storeName: "Store B" }),
    ]);
    expect(groups).toHaveLength(3);
    const us = groups.find(
      group => group.storeName === "Store A" && group.country === "US"
    )!;
    expect(us.rows).toHaveLength(2);
    expect(us.totalInventory).toBe(24);
    expect(
      new Set(groups.flatMap(group => group.rows.map(row => row.key))).size
    ).toBe(4);
    expect(us.rows[0].productCost).toBeNull();
  });
  it("does not infer store aliases, site aliases, or missing parents", () => {
    const groups = inventoryReadGroups([
      inventory({ storeName: "Store a" }),
      inventory(),
      inventory({ country: "美国" }),
      inventory({ parentAsin: null }),
      inventory({ parentAsin: null, asin: "B0CHILD002" }),
    ]);
    expect(groups).toHaveLength(5);
    expect(groups.filter(group => !group.completeScope)).toHaveLength(2);
    expect(
      groups
        .filter(group => !group.completeScope)
        .every(group => group.totalInventory === null)
    ).toBe(true);
  });
  it("retains duplicate and conflicting child records without choosing a winner or summing", () => {
    const groups = inventoryReadGroups([
      inventory(),
      inventory(),
      inventory({ parentAsin: "B0PARENT002" }),
    ]);
    expect(groups.flatMap(group => group.rows)).toHaveLength(3);
    expect(groups.every(group => group.totalInventory === null)).toBe(true);
    expect(
      groups
        .flatMap(group => group.rows)
        .every(row => row.issues.some(issue => issue.includes("重复")))
    ).toBe(true);
  });
  it("retains each cost currency without conversion or valuation and never treats a missing confirmation as proven zero", () => {
    const groups = inventoryReadGroups([
      inventory({ localInventory: 0 }),
      inventory({
        asin: "B0CHILD002",
        currency: "CNY",
        productCost: 5,
        localInventoryConfirmedAt: "2026-10-01T00:00:00Z",
      }),
    ]);
    expect(groups[0].rows.map(row => row.currency)).toEqual(["USD", "CNY"]);
    expect(groups[0].rows[0].localConfirmed).toBe(false);
    expect(groups[0].rows[1].localConfirmed).toBe(true);
    expect(groups[0]).not.toHaveProperty("inventoryValue");
  });
  it("does not aggregate negative, non-finite or unsafe inventory quantities", () => {
    expect(
      inventoryReadGroups([inventory({ totalInventory: -1 })])[0].totalInventory
    ).toBeNull();
    expect(
      inventoryReadGroups([inventory({ totalInventory: Infinity })])[0]
        .totalInventory
    ).toBeNull();
    expect(
      inventoryReadGroups([
        inventory({ totalInventory: Number.MAX_SAFE_INTEGER }),
        inventory({ asin: "B0CHILD002", totalInventory: 1 }),
      ])[0].totalInventory
    ).toBeNull();
  });
  it("does not mutate API records or arrays", () => {
    const row = Object.freeze(inventory());
    const records = Object.freeze([row]);
    expect(inventoryReadGroups(records)[0].rows[0].productName).toBe("原品名");
    expect(row).not.toHaveProperty("issues");
  });
  it("keeps scoped, old NULL and incomplete financial records separate without automatic attribution", () => {
    const groups = financialReadGroups([
      financial(),
      financial({ id: 2, storeName: null, country: null }),
      financial({ id: 3, storeName: "", country: "" }),
      financial({ id: 4, storeName: "Store A", country: null }),
      financial({ id: 5, country: "CA" }),
    ]);
    expect(groups).toHaveLength(5);
    expect(groups.filter(group => group.scopeKind === "legacy")).toHaveLength(
      1
    );
    expect(
      groups.filter(group => group.scopeKind === "incomplete")
    ).toHaveLength(2);
    expect(groups.flatMap(group => group.rows)).toHaveLength(5);
  });
  it("does not overwrite or add duplicate financial months, including old NULL scope", () => {
    const groups = financialReadGroups([
      financial({ financialProfit: "0.00" }),
      financial({ id: 2, financialProfit: "-8.50" }),
    ]);
    expect(groups[0].rows.map(row => row.financialProfit).sort()).toEqual([
      -8.5, 0,
    ]);
    expect(
      groups[0].rows.every(row =>
        row.issues.some(issue => issue.includes("多条"))
      )
    ).toBe(true);
    expect(groups[0]).not.toHaveProperty("totalProfit");
    const legacy = financialReadGroups([
      financial({ storeName: null, country: null }),
      financial({ id: 2, storeName: null, country: null }),
    ]);
    expect(legacy[0].rows).toHaveLength(2);
  });
  it("reports malformed months and missing amounts rather than inventing full financial details", () => {
    const row = financialReadGroups([
      financial({ yearMonth: "2026-13", financialProfit: "" }),
    ])[0].rows[0];
    expect(row.financialProfit).toBeNull();
    expect(row.issues).toHaveLength(2);
    expect(row).not.toHaveProperty("fees");
    expect(row).not.toHaveProperty("adOrders");
  });
  it("searches explicit display fields and keeps matching siblings together", () => {
    const groups = inventoryReadGroups([
      inventory(),
      inventory({ asin: "B0CHILD002", productName: "另一个子体" }),
    ]);
    expect(filterReadGroups(groups, "b0child002")[0].rows).toHaveLength(2);
    expect(filterReadGroups(groups, "alice")).toHaveLength(1);
    expect(filterReadGroups(groups, "unknown:no-source")).toEqual([]);
  });
  it("paginates whole parent groups and clamps after filtering or deletion", () => {
    const groups = inventoryReadGroups(
      Array.from({ length: 7 }, (_, index) =>
        inventory({ parentAsin: `parent-${index}`, asin: `child-${index}` })
      )
    );
    expect(readGroupPage(groups, 1).groups).toHaveLength(6);
    expect(readGroupPage(groups, 2).groups).toHaveLength(1);
    expect(readGroupPage(groups.slice(0, 1), 9).page).toBe(1);
    expect(readGroupPage([], NaN)).toEqual({
      page: 1,
      pageCount: 1,
      groups: [],
    });
  });
});
