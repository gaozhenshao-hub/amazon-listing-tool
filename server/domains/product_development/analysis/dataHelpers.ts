import { invokeLLM } from "../../../_core/llm";
import type { ProductData } from "../../../devStatsEngine";

// ─── Helper Functions ────────────────────────────────────────

export function mapToProductData(p: any): ProductData {
  // 优先使用子ASIN数据（childSales/childRevenue），如果存在则覆盖父ASIN数据
  // 这确保品牌竞争分析等统计使用更精确的子体级别数据
  const effectiveSales = (p.childSales != null && p.childSales > 0) ? p.childSales : p.monthlySales;
  const effectiveRevenue = (p.childRevenue != null && parseFloat(p.childRevenue) > 0)
    ? String(p.childRevenue)
    : p.monthlyRevenue;
  return {
    asin: p.asin ?? "",
    title: p.title,
    brand: p.brand,
    price: p.price,
    rating: p.rating,
    reviewCount: p.reviewCount,
    monthlySales: effectiveSales,
    bsr: p.bsr,
    monthlyRevenue: effectiveRevenue,
    listingDate: p.listingDate,
    fulfillment: p.fulfillment,
    sellerName: p.sellerName,
    sellerLocation: p.sellerLocation,
    variantCount: p.variantCount,
    category: p.category,
    monthlySalesHistory: p.monthlySalesHistory,
    monthlyRevenueHistory: p.monthlyRevenueHistory,
    imageUrl: p.imageUrl,
    searchRank: p.searchRank,
  };
}

export async function generateExternalSummary(rawData: unknown, prompt: string): Promise<string> {
      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product





  const response = await invokeLLM({
    messages: [
      { role: "system", content: "你是一个跨境电商市场分析专家。请根据提供的数据进行分析总结。" },
      { role: "user", content: `数据:\n${JSON.stringify(rawData).substring(0, 3000)}\n\n${prompt}` },
    ],
  });
  return (response.choices?.[0]?.message?.content as string) || "";

}
