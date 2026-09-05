import { normalizeIdentityPart, normalizeMarketplaceCode } from "../../../../shared/marketplaceIdentity";

export type ParentWeeklyFact = {
  id: number;
  sourceKind: string | null;
  createdAt: Date | null;
  weekStartDate: string | null;
  weekEndDate: string | null;
  parentAsin: string | null;
  asin: string | null;
  sku: string | null;
  storeName: string | null;
  country: string | null;
  title: string | null;
  productName: string | null;
  brand: string | null;
  category1: string | null;
  operator: string | null;
  salesQty: number | null;
  orderQty: number | null;
  salesAmount: number | string | null;
  orderProfit: number | string | null;
  sessionsTotal: number | null;
  adOrders: number | null;
  organicOrders: number | null;
  adClicks: number | null;
  adImpressions: number | null;
  adSpend: number | string | null;
  adSales: number | string | null;
  returnQty: number | null;
  fbaAvailable: number | null;
  fbaInbound: number | null;
  fbaInTransit: number | null;
  fbaTotal: number | null;
  availableStock: number | null;
  fbaDaysOfSupply: number | null;
  rating: string | null;
  reviewCount: number | null;
};

export type ProductProfileSeed = {
  id: number;
  parentAsin: string;
  title: string;
  chineseName: string | null;
  brand: string | null;
  category: string | null;
  marketplace: string | null;
  imageUrl: string | null;
  status: string;
  operator: string | null;
  storeName: string | null;
  updatedAt: Date | null;
  basicInfo: {
    sellingPrice: string | null;
    breakEvenPrice: string | null;
    grossProfit: string | null;
    grossMargin: string | null;
    returnRate: string | null;
    rating: string | null;
    reviewCount: number | null;
    listingDate: string | null;
    currentStock: number | null;
    inTransitStock: number | null;
  } | null;
  monthlySummaries: Array<{
    yearMonth: string;
    financialProfit: string | null;
    orderProfitTotal: string | null;
    totalSalesQty: number | null;
    totalOrderQty: number | null;
    totalSalesAmount: string | null;
    totalAdSpend: string | null;
    avgAcos: string | null;
  }>;
  manualChildAsins: string[];
  manualSkus: string[];
};

const text = (value: string | null | undefined) => String(value || "").trim();
const normalized = normalizeIdentityPart;
const canonicalCountry = normalizeMarketplaceCode;
const numberOf = (value: string | number | null | undefined) => Number(value || 0) || 0;
const percentage = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator * 100 : null;

export function parentWeekIdentity(fact: Pick<ParentWeeklyFact, "storeName" | "country" | "parentAsin" | "weekStartDate">) {
  return [normalized(fact.storeName), canonicalCountry(fact.country), normalized(fact.parentAsin), normalized(fact.weekStartDate)].join("|");
}

function productIdentity(profile: Pick<ProductProfileSeed, "storeName" | "marketplace" | "parentAsin">) {
  return [normalized(profile.storeName), canonicalCountry(profile.marketplace), normalized(profile.parentAsin)].join("|");
}

function sourceRank(fact: ParentWeeklyFact) {
  return fact.sourceKind === "lingxing_mcp_parent_asin_weekly" ? 3 : fact.sourceKind === "internal_daily_rollup" ? 1 : 2;
}

function selectAuthoritativeParentWeeks(facts: ParentWeeklyFact[]) {
  const selected = new Map<string, ParentWeeklyFact>();
  for (const fact of facts) {
    if (!text(fact.storeName) || !text(fact.country) || !text(fact.parentAsin) || !text(fact.weekStartDate) || !text(fact.weekEndDate)) continue;
    const key = parentWeekIdentity(fact);
    const current = selected.get(key);
    if (!current || sourceRank(fact) > sourceRank(current) || (sourceRank(fact) === sourceRank(current) && String(fact.createdAt || "") > String(current.createdAt || ""))) {
      selected.set(key, fact);
    }
  }
  return [...selected.values()];
}

function childAsinsFromFacts(facts: ParentWeeklyFact[]) {
  const childAsins = new Set<string>();
  for (const fact of facts) {
    for (const asin of text(fact.asin).split(/[，,、;；\n]+/)) {
      const value = normalized(asin);
      if (value && value !== "-") childAsins.add(value);
    }
  }
  return [...childAsins].sort();
}

function calculateWeeklyRow(current: ParentWeeklyFact, previous: ParentWeeklyFact | undefined) {
  const salesQty = numberOf(current.salesQty);
  const orderQty = numberOf(current.orderQty);
  const salesAmount = numberOf(current.salesAmount);
  const orderProfit = numberOf(current.orderProfit);
  const sessionTotal = numberOf(current.sessionsTotal);
  const adOrders = numberOf(current.adOrders);
  const organicOrders = numberOf(current.organicOrders);
  const adClicks = numberOf(current.adClicks);
  const adImpressions = numberOf(current.adImpressions);
  const adSpend = numberOf(current.adSpend);
  const adSales = numberOf(current.adSales);
  const returnQty = numberOf(current.returnQty);
  const calcChange = (value: number, previousValue: string | number | null | undefined) => {
    const base = numberOf(previousValue);
    return { value, pct: base === 0 ? null : Math.round(((value - base) / Math.abs(base)) * 10_000) / 100 };
  };
  return {
    id: current.id,
    weekStartDate: current.weekStartDate!,
    weekEndDate: current.weekEndDate!,
    salesTrend: previous ? (salesQty > numberOf(previous.salesQty) ? "up" : salesQty < numberOf(previous.salesQty) ? "down" : "flat") : null,
    salesQty,
    orderQty,
    salesAmount,
    orderProfit,
    profitMargin: percentage(orderProfit, salesAmount),
    sessionTotal,
    totalCvr: percentage(orderQty, sessionTotal),
    adCvr: percentage(adOrders, adClicks),
    organicCvr: null,
    adOrders,
    organicOrders,
    adClicks,
    ctr: percentage(adClicks, adImpressions),
    adImpressions,
    cpc: adClicks > 0 ? adSpend / adClicks : null,
    adSpend,
    adSales,
    acos: percentage(adSpend, adSales),
    rating: current.rating == null || current.rating === "" ? null : numberOf(current.rating),
    reviewCount: current.reviewCount == null ? null : numberOf(current.reviewCount),
    returnRate: percentage(returnQty, salesQty),
    wow: previous ? {
      salesQty: calcChange(salesQty, previous.salesQty),
      salesAmount: calcChange(salesAmount, previous.salesAmount),
      orderProfit: calcChange(orderProfit, previous.orderProfit),
      sessionTotal: calcChange(sessionTotal, previous.sessionsTotal),
      adSpend: calcChange(adSpend, previous.adSpend),
      acos: calcChange(percentage(adSpend, adSales) ?? 0, previous.adSales && numberOf(previous.adSales) > 0 ? percentage(numberOf(previous.adSpend), numberOf(previous.adSales)) : null),
    } : null,
  };
}

export function buildParentWeeklyOverview(facts: ParentWeeklyFact[], profiles: ProductProfileSeed[], weeksToShow: number) {
  const authoritativeFacts = selectAuthoritativeParentWeeks(facts)
    .filter((fact) => fact.sourceKind === "lingxing_mcp_parent_asin_weekly");
  const profileByIdentity = new Map<string, ProductProfileSeed>();
  for (const profile of [...profiles].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || b.id - a.id)) {
    const key = productIdentity(profile);
    if (!profileByIdentity.has(key)) profileByIdentity.set(key, profile);
  }
  const factGroups = new Map<string, ParentWeeklyFact[]>();
  for (const fact of authoritativeFacts) {
    const key = [normalized(fact.storeName), canonicalCountry(fact.country), normalized(fact.parentAsin)].join("|");
    factGroups.set(key, [...(factGroups.get(key) || []), fact]);
  }
  return [...factGroups.values()].map((group) => {
    const orderedFacts = [...group].sort((a, b) => text(b.weekStartDate).localeCompare(text(a.weekStartDate)));
    const latest = orderedFacts[0];
    const profile = profileByIdentity.get([normalized(latest.storeName), canonicalCountry(latest.country), normalized(latest.parentAsin)].join("|")) || null;
    const sourceChildAsins = childAsinsFromFacts(group);
    const manualChildAsins = [...new Set((profile?.manualChildAsins || []).map(normalized).filter(Boolean))].sort();
    const childAsins = sourceChildAsins.length ? sourceChildAsins : manualChildAsins;
    const weeks = orderedFacts.slice(0, weeksToShow).map((fact, index) => calculateWeeklyRow(fact, orderedFacts[index + 1]));
    const averageDailySales7d = numberOf(latest.salesQty) / 7;
    const fbaAvailable = numberOf(latest.fbaAvailable);
    const fbaInbound = numberOf(latest.fbaInbound);
    const fbaInTransit = numberOf(latest.fbaInTransit);
    const availableStock = numberOf(latest.availableStock);
    return {
      id: profile?.id || 0,
      isManaged: Boolean(profile),
      parentAsin: latest.parentAsin!,
      title: latest.title || latest.productName || profile?.title || "",
      chineseName: latest.productName || profile?.chineseName || null,
      brand: latest.brand || profile?.brand || null,
      category: latest.category1 || profile?.category || null,
      marketplace: canonicalCountry(latest.country),
      imageUrl: profile?.imageUrl || null,
      status: profile?.status || "active",
      operator: profile?.operator || latest.operator || null,
      storeName: latest.storeName,
      variantCount: childAsins.length,
      skus: profile?.manualSkus.length ? profile.manualSkus : (latest.sku ? [latest.sku] : []),
      basicInfo: profile?.basicInfo || null,
      inventory: {
        fbaAvailable,
        fbaInbound,
        fbaInTransit,
        fbaTotal: numberOf(latest.fbaTotal),
        availableStock,
        fbaDaysOfSupply: numberOf(latest.fbaDaysOfSupply),
        stockoutDate: null,
        avgDailySales7d: Math.round(averageDailySales7d * 10) / 10,
        daysOfStock: averageDailySales7d > 0 ? Math.round(fbaAvailable / averageDailySales7d) : 0,
      },
      weeks,
      monthlySummaries: profile?.monthlySummaries || [],
    };
  });
}
