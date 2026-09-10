export type AdProductDailyFact = {
  profileId: string;
  reportDate: string;
  adType: string;
  campaignId: string;
  campaignName?: string | null;
  adGroupId: string;
  adId: string;
  advertisedAsin: string;
  impressions: number | string | null;
  clicks: number | string | null;
  spend: number | string | null;
  sales: number | string | null;
  orders: number | string | null;
};

export type AdCampaignDailyFact = {
  profileId: string;
  reportDate: string;
  adType: string;
  campaignId: string;
  campaignName?: string | null;
  campaignStatus?: string | null;
  biddingStrategy?: string | null;
  budget?: number | string | null;
  currency?: string | null;
};

const asNumber = (input: unknown) => {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
};
const round = (input: number, scale = 2) => Number(input.toFixed(scale));
const rate = (numerator: number, denominator: number, scale = 2) => denominator > 0 ? round((numerator / denominator) * 100, scale) : null;
const campaignKey = (input: Pick<AdProductDailyFact, "profileId" | "adType" | "campaignId">) => [input.profileId, input.adType, input.campaignId].join("|");

export function isCompleteNaturalWeek(startDate: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start.getUTCDay() === 1 && end.getTime() - start.getTime() === 6 * 86_400_000;
}

/**
 * 产品广告KPI只汇总广告商品事实。活动日报可能覆盖多个子ASIN，故只以其最新状态/预算补充活动列表，绝不相加到KPI。
 */
export function summarizeParentAsinAdMcpWeek(input: { products: AdProductDailyFact[]; campaigns: AdCampaignDailyFact[]; weekStartDate: string; weekEndDate: string }) {
  if (!isCompleteNaturalWeek(input.weekStartDate, input.weekEndDate)) throw new Error("广告周度查询仅接受周一至周日完整自然周");
  const products = input.products.filter((fact) => fact.reportDate >= input.weekStartDate && fact.reportDate <= input.weekEndDate);
  const impressions = products.reduce((sum, fact) => sum + asNumber(fact.impressions), 0);
  const clicks = products.reduce((sum, fact) => sum + asNumber(fact.clicks), 0);
  const spend = products.reduce((sum, fact) => sum + asNumber(fact.spend), 0);
  const sales = products.reduce((sum, fact) => sum + asNumber(fact.sales), 0);
  const orders = products.reduce((sum, fact) => sum + asNumber(fact.orders), 0);
  const linkedCampaigns = new Map<string, { profileId: string; adType: string; campaignId: string; campaignName: string | null; childAsins: Set<string>; productFactCount: number }>();
  for (const fact of products) {
    const key = campaignKey(fact);
    const campaign = linkedCampaigns.get(key) || { profileId: fact.profileId, adType: fact.adType, campaignId: fact.campaignId, campaignName: fact.campaignName || null, childAsins: new Set<string>(), productFactCount: 0 };
    campaign.childAsins.add(fact.advertisedAsin);
    campaign.productFactCount += 1;
    linkedCampaigns.set(key, campaign);
  }
  const latestCampaigns = new Map<string, AdCampaignDailyFact>();
  for (const fact of input.campaigns) {
    const key = campaignKey(fact);
    if (!linkedCampaigns.has(key) || fact.reportDate < input.weekStartDate || fact.reportDate > input.weekEndDate) continue;
    const current = latestCampaigns.get(key);
    if (!current || fact.reportDate > current.reportDate) latestCampaigns.set(key, fact);
  }
  const campaigns = [...linkedCampaigns.entries()].map(([key, linked]) => {
    const latest = latestCampaigns.get(key);
    return {
      profileId: linked.profileId,
      adType: linked.adType,
      campaignId: linked.campaignId,
      campaignName: latest?.campaignName || linked.campaignName,
      campaignStatus: latest?.campaignStatus || null,
      biddingStrategy: latest?.biddingStrategy || null,
      budget: latest?.budget === null || latest?.budget === undefined ? null : asNumber(latest.budget),
      currency: latest?.currency || null,
      latestReportDate: latest?.reportDate || null,
      linkedChildAsins: [...linked.childAsins].sort(),
      productFactCount: linked.productFactCount,
      statusAvailable: Boolean(latest),
    };
  }).sort((left, right) => left.campaignName?.localeCompare(right.campaignName || "") || left.campaignId.localeCompare(right.campaignId));
  return {
    weekStartDate: input.weekStartDate,
    weekEndDate: input.weekEndDate,
    summary: {
      impressions,
      clicks,
      spend: round(spend),
      sales: round(sales),
      orders,
      ctr: rate(clicks, impressions, 4),
      cpc: clicks > 0 ? round(spend / clicks) : null,
      acos: rate(spend, sales, 4),
      cvr: rate(orders, clicks, 4),
      roas: spend > 0 ? round(sales / spend, 4) : null,
      advertisedAsinCount: new Set(products.map((fact) => fact.advertisedAsin)).size,
      productFactCount: products.length,
      source: "ad_product_mcp",
      sourceDescription: "广告商品日事实按父ASIN自然周聚合；活动数据未计入KPI",
    },
    campaigns,
  };
}
