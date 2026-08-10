import { invokeBusinessSkill } from "../../ai_os/services/businessSkillGateway";
import type { ProductData } from "../../../devStatsEngine";

// ─── Helper Functions ────────────────────────────────────────

export function mapToProductData(p: any): ProductData {
  return {
    asin: p.asin ?? "",
    parentAsin: p.parentAsin,
    title: p.title,
    brand: p.brand,
    price: p.price,
    rating: p.rating,
    reviewCount: p.reviewCount,
    monthlySales: p.monthlySales,
    bsr: p.bsr,
    monthlyRevenue: p.monthlyRevenue,
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





  const response = await invokeBusinessSkill({
    messages: [
      { role: "system", content: "你是一个跨境电商市场分析专家。请根据提供的数据进行分析总结。" },
      { role: "user", content: `数据:\n${JSON.stringify(rawData).substring(0, 3000)}\n\n${prompt}` },
    ],
  });
  return (response.choices?.[0]?.message?.content as string) || "";

}
