export type MarketMetricProduct = {
  asin?: string | null;
  parentAsin?: string | null;
  monthlySales?: number | null;
  monthlyRevenue?: string | number | null;
  monthlySalesHistory?: string | null;
  monthlyRevenueHistory?: string | null;
  listingDate?: string | null;
  listingDays?: number | null;
  price?: string | number | null;
  searchRank?: number | null;
  id?: number | null;
};

export type ListingAgeLabel = "6个月以内" | "6–12个月" | "12–24个月" | "24个月以上" | "未知";
export type SalesTier = "头部" | "腰部" | "尾部" | "暂无销量";

export type PanoramaPriceBand = {
  label: string;
  min: number;
  max: number;
  reason?: string;
};

export type NormalizedMarketProduct<T extends MarketMetricProduct> = T & {
  marketParentAsin: string;
  parentSalesRepresentative: boolean;
  listingAgeLabel: ListingAgeLabel;
  salesTier: SalesTier;
  priceBandLabel: string;
};

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getMarketParentKey(product: MarketMetricProduct) {
  return String(product.parentAsin || product.asin || "")
    .trim()
    .toUpperCase();
}

export function getListingAgeLabel(product: MarketMetricProduct, now = new Date()): ListingAgeLabel {
  const listedDays = Number(product.listingDays);
  let days: number | null = Number.isFinite(listedDays) && product.listingDays !== null && product.listingDays !== undefined && listedDays >= 0
    ? listedDays
    : null;
  if (days === null && product.listingDate) {
    const listedAt = new Date(product.listingDate);
    if (!Number.isNaN(listedAt.getTime())) {
      days = Math.max(0, Math.floor((now.getTime() - listedAt.getTime()) / 86_400_000));
    }
  }
  if (days === null) return "未知";
  if (days <= 183) return "6个月以内";
  if (days <= 365) return "6–12个月";
  if (days <= 730) return "12–24个月";
  return "24个月以上";
}

export function buildAdaptivePriceBands(products: MarketMetricProduct[], preferredBandCount = 5): PanoramaPriceBand[] {
  const prices = products
    .map((product) => finiteNumber(product.price))
    .filter((price) => price > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) return [];

  const bandCount = Math.min(Math.max(preferredBandCount, 4), 5);
  const uniquePrices = new Set(prices.map((price) => price.toFixed(2)));
  if (uniquePrices.size < bandCount) {
    const observedMin = prices[0];
    const observedMax = prices[prices.length - 1];
    const padding = observedMax > observedMin ? 0 : Math.max(observedMin * 0.2, 4);
    const lower = Math.max(0, observedMin - padding / 2);
    const upper = observedMax + padding / 2;
    const step = (upper - lower) / bandCount;
    const equalBands: PanoramaPriceBand[] = [];
    for (let index = 0; index < bandCount; index += 1) {
      const min = index === 0 ? Number(lower.toFixed(2)) : Number((equalBands[index - 1].max + 0.01).toFixed(2));
      const max = index === bandCount - 1
        ? Number(upper.toFixed(2))
        : Number((lower + step * (index + 1)).toFixed(2));
      equalBands.push({
        label: `$${min.toFixed(2)}–$${Math.max(min, max).toFixed(2)}`,
        min,
        max: Math.max(min, max),
        reason: "有效价格样本较少，按观测价格范围等距划分",
      });
    }
    return equalBands;
  }

  const boundaries = [prices[0]];
  for (let index = 1; index < bandCount; index += 1) {
    const position = Math.min(Math.ceil((prices.length * index) / bandCount) - 1, prices.length - 1);
    boundaries.push(prices[position]);
  }
  boundaries.push(prices[prices.length - 1]);

  const bands: PanoramaPriceBand[] = [];
  for (let index = 0; index < bandCount; index += 1) {
    const min = index === 0 ? boundaries[index] : Math.max(boundaries[index], bands[index - 1].max + 0.01);
    const max = Math.max(min, boundaries[index + 1]);
    bands.push({
      label: `$${min.toFixed(2)}–$${max.toFixed(2)}`,
      min,
      max,
      reason: "按当前市场有效价格的分位点划分",
    });
  }
  return bands;
}

export function sanitizePriceBands(value: unknown, fallback: PanoramaPriceBand[] = []): PanoramaPriceBand[] {
  if (!Array.isArray(value)) return fallback;
  const bands = value
    .map((item: any) => ({
      label: String(item?.label || "").trim(),
      min: finiteNumber(item?.min),
      max: finiteNumber(item?.max),
      reason: item?.reason ? String(item.reason).trim() : undefined,
    }))
    .filter((band) => band.label && band.min >= 0 && band.max >= band.min)
    .sort((a, b) => a.min - b.min);
  const overlaps = bands.some((band, index) => index > 0 && band.min <= bands[index - 1].max);
  return bands.length >= 4 && bands.length <= 5 && !overlaps ? bands : fallback;
}

export function matchPriceBand(price: unknown, bands: PanoramaPriceBand[]) {
  const numericPrice = finiteNumber(price);
  if (numericPrice <= 0) return "未知";
  if (bands.length === 0) return "未分段";
  if (numericPrice <= bands[0].max) return bands[0].label;
  const match = bands.find((band) => numericPrice >= band.min && numericPrice <= band.max);
  if (match) return match.label;
  const nextBand = bands.find((band) => numericPrice < band.min);
  return nextBand?.label || bands[bands.length - 1].label;
}

/**
 * Amazon child rows commonly repeat parent-level sales. Keep only the row with
 * the strongest reported parent sales and never fall back to child sales fields.
 */
export function normalizeParentMarketMetrics<T extends MarketMetricProduct>(
  products: T[],
  options: { now?: Date; priceBands?: PanoramaPriceBand[] } = {},
): Array<NormalizedMarketProduct<T>> {
  const groups = new Map<string, Array<{ product: T; index: number }>>();
  products.forEach((product, index) => {
    const key = getMarketParentKey(product) || `ROW_${index}`;
    const group = groups.get(key) || [];
    group.push({ product, index });
    groups.set(key, group);
  });

  const representatives = new Map<string, number>();
  const parentSales = new Map<string, number>();
  for (const [key, group] of groups) {
    const sorted = [...group].sort((left, right) => {
      const salesDiff = finiteNumber(right.product.monthlySales) - finiteNumber(left.product.monthlySales);
      if (salesDiff !== 0) return salesDiff;
      const revenueDiff = finiteNumber(right.product.monthlyRevenue) - finiteNumber(left.product.monthlyRevenue);
      if (revenueDiff !== 0) return revenueDiff;
      const rankDiff = finiteNumber(left.product.searchRank) - finiteNumber(right.product.searchRank);
      if (rankDiff !== 0) return rankDiff;
      return left.index - right.index;
    });
    representatives.set(key, sorted[0].index);
    parentSales.set(key, Math.max(0, finiteNumber(sorted[0].product.monthlySales)));
  }

  const rankedParents = [...parentSales.entries()]
    .filter(([, sales]) => sales > 0)
    .sort((left, right) => right[1] - left[1]);
  const totalSales = rankedParents.reduce((sum, [, sales]) => sum + sales, 0);
  const tiers = new Map<string, SalesTier>();
  let cumulativeSales = 0;
  for (const [key, sales] of rankedParents) {
    const shareBefore = totalSales > 0 ? cumulativeSales / totalSales : 1;
    tiers.set(key, shareBefore < 0.7 ? "头部" : shareBefore < 0.9 ? "腰部" : "尾部");
    cumulativeSales += sales;
  }

  const priceBands = options.priceBands || buildAdaptivePriceBands(products);
  return products.map((product, index) => {
    const key = getMarketParentKey(product) || `ROW_${index}`;
    const representative = representatives.get(key) === index;
    return {
      ...product,
      monthlySales: representative ? Math.max(0, finiteNumber(product.monthlySales)) : 0,
      monthlyRevenue: representative ? String(Math.max(0, finiteNumber(product.monthlyRevenue))) : "0",
      monthlySalesHistory: representative ? product.monthlySalesHistory ?? null : null,
      monthlyRevenueHistory: representative ? product.monthlyRevenueHistory ?? null : null,
      marketParentAsin: key,
      parentSalesRepresentative: representative,
      listingAgeLabel: getListingAgeLabel(product, options.now),
      salesTier: tiers.get(key) || "暂无销量",
      priceBandLabel: matchPriceBand(product.price, priceBands),
    };
  });
}
