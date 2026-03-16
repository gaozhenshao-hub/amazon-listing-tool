/**
 * Dev Stats Engine - Pure data statistics calculations (no AI dependency)
 * Handles market overview, price analysis, brand analysis, attribute cross-analysis
 */

// ─── Types ────────────────────────────────────────────────────

export interface ProductData {
  asin: string;
  title: string | null;
  brand: string | null;
  price: string | null;
  rating: string | null;
  reviewCount: string | null;
  monthlySales: number | null;
  bsr: number | null;
  monthlyRevenue: string | null;
  listingDate: string | null;
  fulfillment: string | null;
  sellerName: string | null;
  sellerLocation: string | null;
  variantCount: number | null;
  category: string | null;
  monthlySalesHistory: string | null;
  monthlyRevenueHistory: string | null;
  imageUrl: string | null;
  searchRank: number | null;
}

export interface TagData {
  asin: string;
  dimensionName: string;
  dimensionValue: string;
}

export interface ReviewData {
  asin: string;
  rating: number | null;
  content: string | null;
  title: string | null;
  reviewDate: string | null;
  isVP: number | null;
  isVine: number | null;
  variant: string | null;
  helpfulCount: number | null;
  hasImage: number | null;
  hasVideo: number | null;
}

// ─── Market Overview Stats ────────────────────────────────────

export interface MarketOverviewStats {
  totalRevenue: number;
  totalSales: number;
  activeAsinCount: number;
  totalAsinCount: number;
  avgPrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  avgRating: number;
  avgReviewCount: number;
  medianMonthlySales: number;
  medianMonthlyRevenue: number;
  avgMonthlySalesPerAsin: number;
  brandCount: number;
  top10SalesShare: number;
  newProductRatio: number; // products listed < 12 months
  fbaRatio: number;
  monthlyTrend: Array<{ month: string; sales: number; revenue: number }>;
  seasonalityIndex: Array<{ month: string; index: number }>;
  priceDistribution: Array<{ range: string; count: number; min: number; max: number }>;
  priceSalesScatter: Array<{ asin: string; price: number; sales: number; rating: number; reviews: number; brand: string }>;
  newVsOldComparison: { newCount: number; oldCount: number; newAvgSales: number; oldAvgSales: number; newAvgPrice: number; oldAvgPrice: number; newAvgRating: number; oldAvgRating: number };
}

export function calcMarketOverview(products: ProductData[]): MarketOverviewStats {
  const prices = products.map(p => parseFloat(p.price || "0")).filter(p => p > 0);
  const ratings = products.map(p => parseFloat(p.rating || "0")).filter(r => r > 0);
  const reviewCounts = products.map(p => parseInt(p.reviewCount || "0", 10)).filter(r => r >= 0);
  const sales = products.map(p => p.monthlySales || 0);
  const revenues = products.map(p => parseFloat(p.monthlyRevenue || "0"));

  const totalRevenue = revenues.reduce((s, v) => s + v, 0);
  const totalSales = sales.reduce((s, v) => s + v, 0);
  const activeAsinCount = products.filter(p => (p.monthlySales || 0) > 0).length;

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const medianPrice = sortedPrices.length > 0
    ? sortedPrices.length % 2 === 0
      ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
      : sortedPrices[Math.floor(sortedPrices.length / 2)]
    : 0;

  // New product ratio (listed < 12 months)
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const newProducts = products.filter(p => {
    if (!p.listingDate) return false;
    const d = new Date(p.listingDate);
    return d > twelveMonthsAgo;
  });
  const newProductRatio = products.length > 0 ? newProducts.length / products.length : 0;

  // FBA ratio
  const fbaCount = products.filter(p => p.fulfillment?.toUpperCase()?.includes("FBA")).length;
  const fbaRatio = products.length > 0 ? fbaCount / products.length : 0;

  // Monthly trend from history data
  const monthlyTrend = calcMonthlyTrend(products);

  // Seasonality index
  const seasonalityIndex = calcSeasonalityIndex(monthlyTrend);

  // Price distribution (auto-generate 6 ranges)
  const priceDistribution = calcPriceDistribution(prices);

  // Median monthly sales
  const sortedSales = [...sales].filter(s => s > 0).sort((a, b) => a - b);
  const medianMonthlySales = sortedSales.length > 0
    ? sortedSales.length % 2 === 0
      ? (sortedSales[sortedSales.length / 2 - 1] + sortedSales[sortedSales.length / 2]) / 2
      : sortedSales[Math.floor(sortedSales.length / 2)]
    : 0;

  // Median monthly revenue
  const sortedRevenues = [...revenues].filter(r => r > 0).sort((a, b) => a - b);
  const medianMonthlyRevenue = sortedRevenues.length > 0
    ? sortedRevenues.length % 2 === 0
      ? (sortedRevenues[sortedRevenues.length / 2 - 1] + sortedRevenues[sortedRevenues.length / 2]) / 2
      : sortedRevenues[Math.floor(sortedRevenues.length / 2)]
    : 0;

  // Avg monthly sales per ASIN
  const avgMonthlySalesPerAsin = products.length > 0 ? totalSales / products.length : 0;

  // Brand count
  const brandSet = new Set(products.map(p => p.brand || "Unknown").filter(b => b !== "Unknown"));
  const brandCount = brandSet.size;

  // Top 10 sales share
  const sortedBySales = [...products].sort((a, b) => (b.monthlySales || 0) - (a.monthlySales || 0));
  const top10Sales = sortedBySales.slice(0, 10).reduce((s, p) => s + (p.monthlySales || 0), 0);
  const top10SalesShare = totalSales > 0 ? round2(top10Sales / totalSales) : 0;

  // Price-Sales scatter data
  const priceSalesScatter = products
    .filter(p => parseFloat(p.price || "0") > 0)
    .map(p => ({
      asin: p.asin,
      price: parseFloat(p.price || "0"),
      sales: p.monthlySales || 0,
      rating: parseFloat(p.rating || "0"),
      reviews: parseInt(p.reviewCount || "0", 10),
      brand: p.brand || "Unknown",
    }));

  // New vs Old product comparison
  const oldProducts = products.filter(p => {
    if (!p.listingDate) return true;
    const d = new Date(p.listingDate);
    return d <= twelveMonthsAgo;
  });
  const newPrices = newProducts.map(p => parseFloat(p.price || "0")).filter(p => p > 0);
  const oldPrices = oldProducts.map(p => parseFloat(p.price || "0")).filter(p => p > 0);
  const newRatings = newProducts.map(p => parseFloat(p.rating || "0")).filter(r => r > 0);
  const oldRatings = oldProducts.map(p => parseFloat(p.rating || "0")).filter(r => r > 0);
  const newVsOldComparison = {
    newCount: newProducts.length,
    oldCount: oldProducts.length,
    newAvgSales: round2(avg(newProducts.map(p => p.monthlySales || 0))),
    oldAvgSales: round2(avg(oldProducts.map(p => p.monthlySales || 0))),
    newAvgPrice: round2(avg(newPrices)),
    oldAvgPrice: round2(avg(oldPrices)),
    newAvgRating: round2(avg(newRatings)),
    oldAvgRating: round2(avg(oldRatings)),
  };

  return {
    totalRevenue: round2(totalRevenue),
    totalSales,
    activeAsinCount,
    totalAsinCount: products.length,
    avgPrice: round2(avg(prices)),
    medianPrice: round2(medianPrice),
    minPrice: round2(Math.min(...prices, 0)),
    maxPrice: round2(Math.max(...prices, 0)),
    avgRating: round2(avg(ratings)),
    avgReviewCount: Math.round(avg(reviewCounts)),
    medianMonthlySales: Math.round(medianMonthlySales),
    medianMonthlyRevenue: round2(medianMonthlyRevenue),
    avgMonthlySalesPerAsin: Math.round(avgMonthlySalesPerAsin),
    brandCount,
    top10SalesShare,
    newProductRatio: round2(newProductRatio),
    fbaRatio: round2(fbaRatio),
    monthlyTrend,
    seasonalityIndex,
    priceDistribution,
    priceSalesScatter,
    newVsOldComparison,
  };
}

function calcMonthlyTrend(products: ProductData[]): Array<{ month: string; sales: number; revenue: number }> {
  const monthMap = new Map<string, { sales: number; revenue: number }>();

  for (const p of products) {
    try {
      const salesHistory = p.monthlySalesHistory ? JSON.parse(p.monthlySalesHistory) : {};
      const revenueHistory = p.monthlyRevenueHistory ? JSON.parse(p.monthlyRevenueHistory) : {};
      for (const [month, val] of Object.entries(salesHistory)) {
        const existing = monthMap.get(month) || { sales: 0, revenue: 0 };
        existing.sales += Number(val) || 0;
        monthMap.set(month, existing);
      }
      for (const [month, val] of Object.entries(revenueHistory)) {
        const existing = monthMap.get(month) || { sales: 0, revenue: 0 };
        existing.revenue += Number(val) || 0;
        monthMap.set(month, existing);
      }
    } catch { /* skip invalid JSON */ }
  }

  return Array.from(monthMap.entries())
    .map(([month, data]) => ({ month, sales: data.sales, revenue: round2(data.revenue) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function calcSeasonalityIndex(trend: Array<{ month: string; sales: number }>): Array<{ month: string; index: number }> {
  if (trend.length === 0) return [];
  const avgSales = avg(trend.map(t => t.sales));
  if (avgSales === 0) return trend.map(t => ({ month: t.month, index: 1 }));
  return trend.map(t => ({ month: t.month, index: round2(t.sales / avgSales) }));
}

function calcPriceDistribution(prices: number[]): Array<{ range: string; count: number; min: number; max: number }> {
  if (prices.length === 0) return [];
  const min = Math.floor(Math.min(...prices));
  const max = Math.ceil(Math.max(...prices));
  const step = Math.max(1, Math.ceil((max - min) / 6));
  const ranges: Array<{ range: string; count: number; min: number; max: number }> = [];

  for (let start = min; start < max; start += step) {
    const end = Math.min(start + step, max);
    const count = prices.filter(p => p >= start && p < end).length;
    ranges.push({ range: `$${start}-$${end}`, count, min: start, max: end });
  }
  // Include last range boundary
  if (ranges.length > 0) {
    const lastRange = ranges[ranges.length - 1];
    lastRange.count += prices.filter(p => p === max).length;
  }
  return ranges;
}

// ─── Price Segment Analysis ───────────────────────────────────

export interface PriceSegment {
  range: string;
  min: number;
  max: number;
  asinCount: number;
  totalSales: number;
  totalRevenue: number;
  avgRating: number;
  avgReviewCount: number;
  salesShare: number;
  revenueShare: number;
}

export function calcPriceSegments(products: ProductData[], customRanges?: Array<{ min: number; max: number }>): PriceSegment[] {
  const prices = products.map(p => parseFloat(p.price || "0")).filter(p => p > 0);
  if (prices.length === 0) return [];

  const ranges = customRanges || autoGeneratePriceRanges(prices);
  const totalSalesAll = products.reduce((s, p) => s + (p.monthlySales || 0), 0);
  const totalRevenueAll = products.reduce((s, p) => s + parseFloat(p.monthlyRevenue || "0"), 0);

  return ranges.map(({ min, max }) => {
    const inRange = products.filter(p => {
      const price = parseFloat(p.price || "0");
      return price >= min && price < max;
    });
    const totalSales = inRange.reduce((s, p) => s + (p.monthlySales || 0), 0);
    const totalRevenue = inRange.reduce((s, p) => s + parseFloat(p.monthlyRevenue || "0"), 0);
    const ratings = inRange.map(p => parseFloat(p.rating || "0")).filter(r => r > 0);
    const reviews = inRange.map(p => parseInt(p.reviewCount || "0", 10));

    return {
      range: `$${min}-$${max}`,
      min,
      max,
      asinCount: inRange.length,
      totalSales,
      totalRevenue: round2(totalRevenue),
      avgRating: round2(avg(ratings)),
      avgReviewCount: Math.round(avg(reviews)),
      salesShare: totalSalesAll > 0 ? round2(totalSales / totalSalesAll) : 0,
      revenueShare: totalRevenueAll > 0 ? round2(totalRevenue / totalRevenueAll) : 0,
    };
  });
}

function autoGeneratePriceRanges(prices: number[]): Array<{ min: number; max: number }> {
  const sorted = [...prices].sort((a, b) => a - b);
  const min = Math.floor(sorted[0]);
  const max = Math.ceil(sorted[sorted.length - 1]);
  const step = Math.max(1, Math.ceil((max - min) / 7));
  const ranges: Array<{ min: number; max: number }> = [];
  for (let start = min; start < max; start += step) {
    ranges.push({ min: start, max: Math.min(start + step, max + 1) });
  }
  return ranges;
}

// ─── Brand Competition Analysis ───────────────────────────────

export interface BrandStats {
  brand: string;
  asinCount: number;
  totalSales: number;
  totalRevenue: number;
  avgPrice: number;
  avgRating: number;
  avgReviewCount: number;
  salesShare: number;
  revenueShare: number;
  topProducts: Array<{ asin: string; title: string; sales: number; price: number }>;
}

export interface BrandCompetitionStats {
  brands: BrandStats[];
  cr3: number;
  cr5: number;
  cr10: number;
  chinaSellerShare: number;
  nonChinaSellerShare: number;
  brandMonthlyTrend: Array<{ month: string; brands: Record<string, number> }>;
}

export function calcBrandCompetition(products: ProductData[]): BrandCompetitionStats {
  const brandMap = new Map<string, ProductData[]>();
  for (const p of products) {
    const brand = p.brand || "Unknown";
    const list = brandMap.get(brand) || [];
    list.push(p);
    brandMap.set(brand, list);
  }

  const totalSalesAll = products.reduce((s, p) => s + (p.monthlySales || 0), 0);
  const totalRevenueAll = products.reduce((s, p) => s + parseFloat(p.monthlyRevenue || "0"), 0);

  const brands: BrandStats[] = Array.from(brandMap.entries()).map(([brand, prods]) => {
    const totalSales = prods.reduce((s, p) => s + (p.monthlySales || 0), 0);
    const totalRevenue = prods.reduce((s, p) => s + parseFloat(p.monthlyRevenue || "0"), 0);
    const prices = prods.map(p => parseFloat(p.price || "0")).filter(p => p > 0);
    const ratings = prods.map(p => parseFloat(p.rating || "0")).filter(r => r > 0);
    const reviews = prods.map(p => parseInt(p.reviewCount || "0", 10));

    const topProducts = prods
      .sort((a, b) => (b.monthlySales || 0) - (a.monthlySales || 0))
      .slice(0, 5)
      .map(p => ({
        asin: p.asin,
        title: p.title || "",
        sales: p.monthlySales || 0,
        price: parseFloat(p.price || "0"),
      }));

    return {
      brand,
      asinCount: prods.length,
      totalSales,
      totalRevenue: round2(totalRevenue),
      avgPrice: round2(avg(prices)),
      avgRating: round2(avg(ratings)),
      avgReviewCount: Math.round(avg(reviews)),
      salesShare: totalSalesAll > 0 ? round2(totalSales / totalSalesAll) : 0,
      revenueShare: totalRevenueAll > 0 ? round2(totalRevenue / totalRevenueAll) : 0,
      topProducts,
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  // CR3, CR5, CR10
  const topBrandRevenues = brands.map(b => b.revenueShare);
  const cr3 = round2(topBrandRevenues.slice(0, 3).reduce((s, v) => s + v, 0));
  const cr5 = round2(topBrandRevenues.slice(0, 5).reduce((s, v) => s + v, 0));
  const cr10 = round2(topBrandRevenues.slice(0, 10).reduce((s, v) => s + v, 0));

  // China seller share
  const chinaKeywords = ["china", "cn", "中国", "shenzhen", "guangzhou", "shanghai", "beijing", "hangzhou", "yiwu", "dongguan", "hong kong", "hk"];
  const chinaProducts = products.filter(p => {
    const loc = (p.sellerLocation || "").toLowerCase();
    return chinaKeywords.some(k => loc.includes(k));
  });
  const chinaSales = chinaProducts.reduce((s, p) => s + (p.monthlySales || 0), 0);
  const chinaSellerShare = totalSalesAll > 0 ? round2(chinaSales / totalSalesAll) : 0;

  // Brand monthly trend (top 5 brands)
  const top5Brands = brands.slice(0, 5).map(b => b.brand);
  const brandMonthlyTrend = calcBrandMonthlyTrend(products, top5Brands);

  return {
    brands,
    cr3,
    cr5,
    cr10,
    chinaSellerShare,
    nonChinaSellerShare: round2(1 - chinaSellerShare),
    brandMonthlyTrend,
  };
}

function calcBrandMonthlyTrend(products: ProductData[], topBrands: string[]): Array<{ month: string; brands: Record<string, number> }> {
  const monthMap = new Map<string, Record<string, number>>();

  for (const p of products) {
    const brand = p.brand || "Unknown";
    if (!topBrands.includes(brand)) continue;
    try {
      const history = p.monthlySalesHistory ? JSON.parse(p.monthlySalesHistory) : {};
      for (const [month, val] of Object.entries(history)) {
        const existing = monthMap.get(month) || {};
        existing[brand] = (existing[brand] || 0) + (Number(val) || 0);
        monthMap.set(month, existing);
      }
    } catch { /* skip */ }
  }

  return Array.from(monthMap.entries())
    .map(([month, brands]) => ({ month, brands }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// ─── Attribute Cross Analysis ─────────────────────────────────

export interface SingleDimensionStats {
  dimensionName: string;
  values: Array<{
    value: string;
    asinCount: number;
    totalSales: number;
    totalRevenue: number;
    avgPrice: number;
    avgRating: number;
    salesShare: number;
  }>;
}

export interface CrossAnalysisCell {
  dim1Value: string;
  dim2Value: string;
  asinCount: number;
  totalSales: number;
  totalRevenue: number;
  avgPrice: number;
}

export interface CrossAnalysisResult {
  dim1Name: string;
  dim2Name: string;
  dim1Values: string[];
  dim2Values: string[];
  matrix: CrossAnalysisCell[];
  hotCombinations: Array<{ combo: string; sales: number; revenue: number; asinCount: number }>;
  blueOcean: Array<{ combo: string; asinCount: number; avgSales: number; opportunity: string }>;
}

export function calcSingleDimensionStats(
  products: ProductData[],
  tags: TagData[],
  dimensionName: string
): SingleDimensionStats {
  const totalSalesAll = products.reduce((s, p) => s + (p.monthlySales || 0), 0);
  const productMap = new Map(products.map(p => [p.asin, p]));
  const valueMap = new Map<string, Set<string>>();

  for (const tag of tags) {
    if (tag.dimensionName !== dimensionName) continue;
    const set = valueMap.get(tag.dimensionValue) || new Set();
    set.add(tag.asin);
    valueMap.set(tag.dimensionValue, set);
  }

  const values = Array.from(valueMap.entries()).map(([value, asins]) => {
    const prods = Array.from(asins).map(a => productMap.get(a)).filter(Boolean) as ProductData[];
    const totalSales = prods.reduce((s, p) => s + (p.monthlySales || 0), 0);
    const totalRevenue = prods.reduce((s, p) => s + parseFloat(p.monthlyRevenue || "0"), 0);
    const prices = prods.map(p => parseFloat(p.price || "0")).filter(p => p > 0);
    const ratings = prods.map(p => parseFloat(p.rating || "0")).filter(r => r > 0);

    return {
      value,
      asinCount: prods.length,
      totalSales,
      totalRevenue: round2(totalRevenue),
      avgPrice: round2(avg(prices)),
      avgRating: round2(avg(ratings)),
      salesShare: totalSalesAll > 0 ? round2(totalSales / totalSalesAll) : 0,
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  return { dimensionName, values };
}

export function calcCrossAnalysis(
  products: ProductData[],
  tags: TagData[],
  dim1Name: string,
  dim2Name: string
): CrossAnalysisResult {
  const productMap = new Map(products.map(p => [p.asin, p]));

  // Build asin -> dimension value maps
  const dim1Map = new Map<string, string[]>();
  const dim2Map = new Map<string, string[]>();
  for (const tag of tags) {
    if (tag.dimensionName === dim1Name) {
      const list = dim1Map.get(tag.asin) || [];
      list.push(tag.dimensionValue);
      dim1Map.set(tag.asin, list);
    }
    if (tag.dimensionName === dim2Name) {
      const list = dim2Map.get(tag.asin) || [];
      list.push(tag.dimensionValue);
      dim2Map.set(tag.asin, list);
    }
  }

  const dim1Values = Array.from(new Set(tags.filter(t => t.dimensionName === dim1Name).map(t => t.dimensionValue)));
  const dim2Values = Array.from(new Set(tags.filter(t => t.dimensionName === dim2Name).map(t => t.dimensionValue)));

  // Build cross matrix
  const matrix: CrossAnalysisCell[] = [];
  for (const v1 of dim1Values) {
    for (const v2 of dim2Values) {
      const matchingAsins = products.filter(p => {
        const d1 = dim1Map.get(p.asin) || [];
        const d2 = dim2Map.get(p.asin) || [];
        return d1.includes(v1) && d2.includes(v2);
      });
      const totalSales = matchingAsins.reduce((s, p) => s + (p.monthlySales || 0), 0);
      const totalRevenue = matchingAsins.reduce((s, p) => s + parseFloat(p.monthlyRevenue || "0"), 0);
      const prices = matchingAsins.map(p => parseFloat(p.price || "0")).filter(p => p > 0);

      matrix.push({
        dim1Value: v1,
        dim2Value: v2,
        asinCount: matchingAsins.length,
        totalSales,
        totalRevenue: round2(totalRevenue),
        avgPrice: round2(avg(prices)),
      });
    }
  }

  // Hot combinations (sorted by revenue)
  const hotCombinations = matrix
    .filter(c => c.asinCount > 0)
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 10)
    .map(c => ({
      combo: `${c.dim1Value} × ${c.dim2Value}`,
      sales: c.totalSales,
      revenue: c.totalRevenue,
      asinCount: c.asinCount,
    }));

  // Blue ocean: low ASIN count but decent sales per ASIN
  const avgSalesPerAsin = matrix.filter(c => c.asinCount > 0).map(c => c.totalSales / c.asinCount);
  const overallAvgSalesPerAsin = avg(avgSalesPerAsin);

  const blueOcean = matrix
    .filter(c => c.asinCount > 0 && c.asinCount <= 3 && (c.totalSales / c.asinCount) > overallAvgSalesPerAsin)
    .sort((a, b) => (b.totalSales / b.asinCount) - (a.totalSales / a.asinCount))
    .slice(0, 5)
    .map(c => ({
      combo: `${c.dim1Value} × ${c.dim2Value}`,
      asinCount: c.asinCount,
      avgSales: round2(c.totalSales / c.asinCount),
      opportunity: c.asinCount <= 1 ? "高机会" : c.asinCount <= 2 ? "中机会" : "低机会",
    }));

  return { dim1Name, dim2Name, dim1Values, dim2Values, matrix, hotCombinations, blueOcean };
}

// ─── Review Analysis Stats ────────────────────────────────────

export interface ReviewStats {
  totalReviews: number;
  avgRating: number;
  ratingDistribution: Array<{ stars: number; count: number; percentage: number }>;
  vpRatio: number;
  vineRatio: number;
  withImageRatio: number;
  withVideoRatio: number;
  monthlyReviewTrend: Array<{ month: string; count: number; avgRating: number }>;
}

export function calcReviewStats(reviews: ReviewData[]): ReviewStats {
  const totalReviews = reviews.length;
  const ratings = reviews.map(r => r.rating || 0).filter(r => r > 0);

  const ratingDistribution = [1, 2, 3, 4, 5].map(stars => {
    const count = ratings.filter(r => r === stars).length;
    return { stars, count, percentage: totalReviews > 0 ? round2(count / totalReviews) : 0 };
  });

  const vpCount = reviews.filter(r => r.isVP === 1).length;
  const vineCount = reviews.filter(r => r.isVine === 1).length;
  const imageCount = reviews.filter(r => r.hasImage === 1).length;
  const videoCount = reviews.filter(r => r.hasVideo === 1).length;

  // Monthly trend
  const monthMap = new Map<string, { count: number; totalRating: number }>();
  for (const r of reviews) {
    if (!r.reviewDate) continue;
    const month = r.reviewDate.substring(0, 7); // YYYY-MM
    const existing = monthMap.get(month) || { count: 0, totalRating: 0 };
    existing.count++;
    existing.totalRating += r.rating || 0;
    monthMap.set(month, existing);
  }

  const monthlyReviewTrend = Array.from(monthMap.entries())
    .map(([month, data]) => ({
      month,
      count: data.count,
      avgRating: round2(data.totalRating / data.count),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totalReviews,
    avgRating: round2(avg(ratings)),
    ratingDistribution,
    vpRatio: totalReviews > 0 ? round2(vpCount / totalReviews) : 0,
    vineRatio: totalReviews > 0 ? round2(vineCount / totalReviews) : 0,
    withImageRatio: totalReviews > 0 ? round2(imageCount / totalReviews) : 0,
    withVideoRatio: totalReviews > 0 ? round2(videoCount / totalReviews) : 0,
    monthlyReviewTrend,
  };
}

// ─── Utility Functions ────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
