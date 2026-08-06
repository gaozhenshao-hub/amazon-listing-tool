export type SummarySourceStatus = {
  key: string;
  label: string;
  status: "confirmed" | "missing";
  confirmedAt?: string | null;
};

export type InformationSummaryCompetitor = {
  productId: number;
  asin: string;
  title: string;
  variantSpec: string;
  competitorStatus: string;
  primaryTags: string[];
  priceTier: string;
  imageUrl: string;
  monthlySales: number | null;
  price: number | null;
  rating: number | null;
  reviewNotes: string;
  reviewCount: number | null;
  listingDate: string;
  fulfillment: string;
  aiRecommendedBenchmark: boolean;
  isBenchmark: boolean;
  benchmarkReason: string;
  manualNote: string;
};

export type InformationSummary = {
  schemaVersion: "1.0";
  generatedAt: string;
  executiveSummary: string;
  project: {
    productNameCn: string;
    productNameEn: string;
    selectionDate: string;
    developmentOwner: string;
    operationsOwner: string;
    reviewer: string;
    targetMarket: string;
    keywords: string[];
  };
  competitors: InformationSummaryCompetitor[];
  marketEvidence: {
    salesTrend: string;
    seasonality: string;
    benchmarkAdvantages: string[];
    benchmarkDisadvantages: string[];
    brandAnalysis: string;
  };
  productOpportunity: {
    mainFunctions: string[];
    usageScenarios: string[];
    targetAudience: string[];
    positiveSignals: string[];
    negativeSignals: string[];
    sellingPoints: Array<{ point: string; evidence: string; implementation: string }>;
    painPoints: Array<{ point: string; evidence: string; resolved: boolean; resolution: string }>;
  };
  patentRisk: {
    required: boolean;
    reportRefs: string[];
    summary: string;
    relatedPatents: string[];
    riskLevel: "未评估" | "低" | "中" | "高";
    conclusion: string;
    avoidancePlan: string;
  };
  landingPlan: {
    developmentSuggestions: string[];
    operationsSuggestions: string[];
    appearanceConcepts: string[];
    designConcept: string;
    timeline: Array<{ milestone: string; targetDate: string; note: string }>;
  };
  economics: {
    maturity: "estimate";
    currency: "USD";
    targetPrice: number | null;
    estimatedProductCost: number | null;
    moldCost: number | null;
    moldAmortizationQuantity: number | null;
    firstMileCost: number | null;
    referralFeeRate: number | null;
    fbaFee: number | null;
    cpc: number | null;
    conversionRate: number | null;
    adSalesRatio: number | null;
    returnRate: number | null;
    grossProfit: number | null;
    grossMargin: number | null;
    netProfit: number | null;
    netMargin: number | null;
    suppliers: Array<{ name: string; quote: number | null; moq: number | null; note: string }>;
    assumptions: string[];
  };
  provenance: {
    sources: SummarySourceStatus[];
    notes: string[];
  };
  completeness: {
    score: number;
    completedRequired: number;
    totalRequired: number;
    requiredMissing: string[];
    optionalMissing: string[];
  };
};

export type InformationSummaryAi = {
  executiveSummary?: string;
  benchmarkRecommendations?: Array<{ asin?: string; reason?: string }>;
  marketSynthesis?: Partial<InformationSummary["marketEvidence"]>;
  productOpportunity?: Partial<InformationSummary["productOpportunity"]>;
  landingDraft?: Partial<InformationSummary["landingPlan"]>;
  missingFields?: string[];
};

type ProjectLike = {
  name?: string | null;
  targetMarket?: string | null;
  keywords?: string | null;
  createdAt?: Date | string | null;
};

type ProductLike = {
  id: number;
  asin?: string | null;
  title?: string | null;
  price?: string | null;
  rating?: string | null;
  reviewCount?: string | null;
  monthlySales?: number | null;
  listingDate?: string | null;
  fulfillment?: string | null;
  imageUrl?: string | null;
  productSize?: string | null;
  specifications?: string | null;
  tags?: string | null;
  listingDays?: number | null;
};

type StageLike = {
  stageType?: string | null;
  status?: string | null;
  rawResult?: string | null;
  editedResult?: string | null;
  confirmedAt?: Date | string | null;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function strings(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return item.trim() ? [item.trim()] : [];
      const record = asRecord(item);
      const candidate = record.theme || record.feature || record.point || record.description || record.direction || record.reason;
      return candidate ? [String(candidate).trim()] : [];
    }).filter(Boolean);
  }
  return Object.entries(asRecord(value)).flatMap(([key, child]) => {
    if (typeof child === "string" || typeof child === "number") return [`${key}: ${child}`];
    return strings(child);
  });
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: unknown): string {
  if (!value) return "";
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function confirmedStageMap(stages: StageLike[]) {
  return new Map(stages
    .filter((stage) => stage.status === "confirmed" && stage.stageType)
    .map((stage) => {
      const result = parseJson<Record<string, any>>(stage.editedResult || stage.rawResult, {});
      return [String(stage.stageType), { stage, result }] as const;
    }));
}

function productTags(product: ProductLike): string[] {
  return strings(parseJson(product.tags, [])).slice(0, 6);
}

function variantSpec(product: ProductLike): string {
  if (product.productSize) return product.productSize;
  const specs = asRecord(parseJson(product.specifications, {}));
  return Object.entries(specs).slice(0, 4).map(([key, value]) => `${key}: ${String(value)}`).join(" | ");
}

function priceTier(price: number | null, prices: number[]): string {
  if (price === null || prices.length < 2) return "待判断";
  const sorted = [...prices].sort((a, b) => a - b);
  const low = sorted[Math.floor((sorted.length - 1) / 3)];
  const high = sorted[Math.floor(((sorted.length - 1) * 2) / 3)];
  if (price <= low) return "低";
  if (price >= high) return "高";
  return "中";
}

function productStatus(product: ProductLike, topSales: number): string {
  const labels: string[] = [];
  if (product.listingDays !== null && product.listingDays !== undefined && product.listingDays <= 180) labels.push("新品");
  if ((product.monthlySales || 0) >= topSales && topSales > 0) labels.push("头部");
  return labels.join("、") || "常规";
}

export function calculateInformationSummaryCompleteness(summary: Omit<InformationSummary, "completeness"> | InformationSummary) {
  const requiredChecks = [
    ["产品中文名称", Boolean(summary.project.productNameCn.trim())],
    ["开发负责人", Boolean(summary.project.developmentOwner.trim())],
    ["至少3个竞品", summary.competitors.length >= 3],
    ["至少1个对标竞品", summary.competitors.some((item) => item.isBenchmark)],
    ["对标竞品选取理由", summary.competitors.filter((item) => item.isBenchmark).every((item) => item.benchmarkReason.trim().length > 0)],
    ["市场趋势结论", Boolean(summary.marketEvidence.salesTrend.trim())],
    ["品牌竞争结论", Boolean(summary.marketEvidence.brandAnalysis.trim())],
    ["产品主要功能", summary.productOpportunity.mainFunctions.length > 0],
    ["核心卖点", summary.productOpportunity.sellingPoints.length > 0],
    ["专利风险结论", !summary.patentRisk.required || (summary.patentRisk.riskLevel !== "未评估" && Boolean(summary.patentRisk.conclusion.trim()))],
  ] as const;
  const optionalChecks = [
    ["产品英文名称", Boolean(summary.project.productNameEn.trim())],
    ["运营负责人", Boolean(summary.project.operationsOwner.trim())],
    ["审核人员", Boolean(summary.project.reviewer.trim())],
    ["初步目标售价", summary.economics.targetPrice !== null],
    ["初步产品成本", summary.economics.estimatedProductCost !== null],
    ["开发优化意见", summary.landingPlan.developmentSuggestions.length > 0],
    ["运营优化意见", summary.landingPlan.operationsSuggestions.length > 0],
  ] as const;
  const requiredMissing = requiredChecks.filter(([, ok]) => !ok).map(([label]) => label);
  const optionalMissing = optionalChecks.filter(([, ok]) => !ok).map(([label]) => label);
  const completedRequired = requiredChecks.length - requiredMissing.length;
  return {
    score: Math.round((completedRequired / requiredChecks.length) * 100),
    completedRequired,
    totalRequired: requiredChecks.length,
    requiredMissing,
    optionalMissing,
  };
}

export function recalculateEconomics(summary: InformationSummary): InformationSummary {
  const economics = { ...summary.economics };
  const price = economics.targetPrice;
  const productCost = economics.estimatedProductCost;
  const moldPerUnit = economics.moldCost !== null && economics.moldAmortizationQuantity
    ? economics.moldCost / economics.moldAmortizationQuantity
    : 0;
  if (price !== null && productCost !== null) {
    const referralFee = price * (economics.referralFeeRate || 0);
    const adCost = price * (economics.adSalesRatio || 0);
    const returnCost = price * (economics.returnRate || 0);
    economics.grossProfit = price - productCost - moldPerUnit - (economics.firstMileCost || 0) - referralFee - (economics.fbaFee || 0);
    economics.grossMargin = price === 0 ? null : economics.grossProfit / price;
    economics.netProfit = economics.grossProfit - adCost - returnCost;
    economics.netMargin = price === 0 ? null : economics.netProfit / price;
  } else {
    economics.grossProfit = null;
    economics.grossMargin = null;
    economics.netProfit = null;
    economics.netMargin = null;
  }
  const next = { ...summary, economics };
  return { ...next, completeness: calculateInformationSummaryCompleteness(next) };
}

export function buildInformationSummarySeed(input: {
  project: ProjectLike;
  products: ProductLike[];
  stages: StageLike[];
  ownerName?: string | null;
}): InformationSummary {
  const stageMap = confirmedStageMap(input.stages);
  const market = stageMap.get("market_overview")?.result || {};
  const attribute = stageMap.get("attribute_cross")?.result || {};
  const price = stageMap.get("price_analysis")?.result || {};
  const brand = stageMap.get("brand_competition")?.result || {};
  const review = stageMap.get("review_kano")?.result || {};
  const marketAi = asRecord(market.ai);
  const attributeAi = asRecord(attribute.ai);
  const priceAi = asRecord(price.ai);
  const brandAi = asRecord(brand.ai);
  const reviewAi = asRecord(review.ai);
  const kano = asRecord(reviewAi.kanoAnalysis);
  const prices = input.products.map((product) => numberOrNull(product.price)).filter((value): value is number => value !== null);
  const sales = input.products.map((product) => product.monthlySales || 0).sort((a, b) => b - a);
  const topSales = sales[Math.max(0, Math.floor(sales.length * 0.2) - 1)] || sales[0] || 0;
  const sourceDefinitions = [
    ["market_overview", "市场大盘"],
    ["attribute_cross", "属性交叉"],
    ["price_analysis", "价格段分析"],
    ["brand_competition", "品牌竞争"],
    ["review_kano", "评论深度"],
  ] as const;
  const result = {
    schemaVersion: "1.0" as const,
    generatedAt: new Date().toISOString(),
    executiveSummary: "",
    project: {
      productNameCn: input.project.name || "",
      productNameEn: "",
      selectionDate: dateOnly(input.project.createdAt),
      developmentOwner: input.ownerName || "",
      operationsOwner: "",
      reviewer: "",
      targetMarket: input.project.targetMarket || "US",
      keywords: parseJson<string[]>(input.project.keywords, strings(input.project.keywords)),
    },
    competitors: input.products.map((product) => {
      const parsedPrice = numberOrNull(product.price);
      return {
        productId: product.id,
        asin: product.asin || "",
        title: product.title || "",
        variantSpec: variantSpec(product),
        competitorStatus: productStatus(product, topSales),
        primaryTags: productTags(product),
        priceTier: priceTier(parsedPrice, prices),
        imageUrl: product.imageUrl || "",
        monthlySales: product.monthlySales ?? null,
        price: parsedPrice,
        rating: numberOrNull(product.rating),
        reviewNotes: "",
        reviewCount: numberOrNull(product.reviewCount),
        listingDate: product.listingDate || "",
        fulfillment: product.fulfillment || "",
        aiRecommendedBenchmark: false,
        isBenchmark: false,
        benchmarkReason: "",
        manualNote: "",
      };
    }),
    marketEvidence: {
      salesTrend: String(marketAi.growthTrend || marketAi.summary || ""),
      seasonality: String(marketAi.seasonality || ""),
      benchmarkAdvantages: strings(attributeAi.differentiationOpportunities),
      benchmarkDisadvantages: strings(attributeAi.redOceanWarnings),
      brandAnalysis: String(brandAi.summary || brandAi.competitionPattern || ""),
    },
    productOpportunity: {
      mainFunctions: Array.from(new Set(input.products.flatMap(productTags))).slice(0, 12),
      usageScenarios: [],
      targetAudience: [],
      positiveSignals: strings(kano.wowPoints),
      negativeSignals: strings(kano.painPoints),
      sellingPoints: strings(attributeAi.differentiationOpportunities).slice(0, 8).map((point) => ({ point, evidence: "属性交叉分析", implementation: "" })),
      painPoints: strings(kano.painPoints).slice(0, 12).map((point) => ({ point, evidence: "评论深度分析", resolved: false, resolution: "" })),
    },
    patentRisk: {
      required: false,
      reportRefs: [],
      summary: "",
      relatedPatents: [],
      riskLevel: "未评估" as const,
      conclusion: "",
      avoidancePlan: "",
    },
    landingPlan: {
      developmentSuggestions: [],
      operationsSuggestions: [],
      appearanceConcepts: [],
      designConcept: "",
      timeline: [],
    },
    economics: {
      maturity: "estimate" as const,
      currency: "USD" as const,
      targetPrice: numberOrNull(priceAi.bestPriceRange?.min) ?? numberOrNull(priceAi.bestPriceRange?.max),
      estimatedProductCost: null,
      moldCost: null,
      moldAmortizationQuantity: null,
      firstMileCost: null,
      referralFeeRate: 0.15,
      fbaFee: null,
      cpc: null,
      conversionRate: null,
      adSalesRatio: null,
      returnRate: null,
      grossProfit: null,
      grossMargin: null,
      netProfit: null,
      netMargin: null,
      suppliers: [],
      assumptions: ["当前为立项前预估，锁定后作为综合决策输入，不替代立项后的正式BOM与利润核算。"],
    },
    provenance: {
      sources: sourceDefinitions.map(([key, label]) => {
        const source = stageMap.get(key);
        return {
          key,
          label,
          status: source ? "confirmed" as const : "missing" as const,
          confirmedAt: source?.stage.confirmedAt ? new Date(source.stage.confirmedAt).toISOString() : null,
        };
      }),
      notes: ["系统字段来自项目、竞品全景表和已确认分析阶段；人工编辑会生成新的 Artifact 版本。"],
    },
  };
  return recalculateEconomics({ ...result, completeness: calculateInformationSummaryCompleteness(result) });
}

export function buildInformationSummaryAiContext(
  seed: InformationSummary,
  options: { maxCompetitors?: number } = {},
) {
  const maxCompetitors = Math.min(Math.max(options.maxCompetitors || 24, 5), 40);
  const competitors = [...seed.competitors]
    .sort((left, right) =>
      Number(right.isBenchmark || right.aiRecommendedBenchmark) - Number(left.isBenchmark || left.aiRecommendedBenchmark) ||
      (right.monthlySales || 0) - (left.monthlySales || 0) ||
      (right.reviewCount || 0) - (left.reviewCount || 0),
    )
    .slice(0, maxCompetitors)
    .map((competitor) => ({
      asin: competitor.asin,
      title: competitor.title.slice(0, 180),
      variantSpec: competitor.variantSpec.slice(0, 180),
      competitorStatus: competitor.competitorStatus,
      primaryTags: competitor.primaryTags.slice(0, 6),
      priceTier: competitor.priceTier,
      monthlySales: competitor.monthlySales,
      price: competitor.price,
      rating: competitor.rating,
      reviewCount: competitor.reviewCount,
      fulfillment: competitor.fulfillment,
    }));

  return {
    schemaVersion: seed.schemaVersion,
    project: seed.project,
    competitorEvidence: {
      totalCount: seed.competitors.length,
      includedCount: competitors.length,
      omittedCount: Math.max(0, seed.competitors.length - competitors.length),
      selectionRule: "人工/AI对标优先，其次按月销量和评论数排序",
      competitors,
    },
    marketEvidence: seed.marketEvidence,
    productOpportunity: seed.productOpportunity,
    provenance: seed.provenance,
  };
}

export function mergeInformationSummaryAi(seed: InformationSummary, ai: InformationSummaryAi): InformationSummary {
  const recommendations = new Map((ai.benchmarkRecommendations || [])
    .filter((item) => item.asin)
    .map((item) => [String(item.asin).toUpperCase(), item.reason || "AI建议作为对标竞品"]));
  const competitors = seed.competitors.map((competitor) => {
    const reason = recommendations.get(competitor.asin.toUpperCase());
    return reason ? { ...competitor, aiRecommendedBenchmark: true, benchmarkReason: competitor.benchmarkReason || reason } : competitor;
  });
  const marketEvidence = { ...seed.marketEvidence, ...asRecord(ai.marketSynthesis) };
  const productOpportunity = { ...seed.productOpportunity, ...asRecord(ai.productOpportunity) };
  const landingPlan = { ...seed.landingPlan, ...asRecord(ai.landingDraft) };
  const next = {
    ...seed,
    executiveSummary: ai.executiveSummary || seed.executiveSummary,
    competitors,
    marketEvidence,
    productOpportunity,
    landingPlan,
    provenance: {
      ...seed.provenance,
      notes: [...seed.provenance.notes, ...(ai.missingFields || []).map((field) => `AI识别缺失: ${field}`)],
    },
  };
  return recalculateEconomics({ ...next, completeness: calculateInformationSummaryCompleteness(next) });
}

export function validateInformationSummaryForConfirmation(value: unknown): InformationSummary {
  const summary = value as InformationSummary;
  if (!summary || summary.schemaVersion !== "1.0" || !summary.project || !Array.isArray(summary.competitors)) {
    throw new Error("信息汇总结构无效，请重新生成后再确认");
  }
  const normalized = recalculateEconomics(summary);
  if (normalized.completeness.requiredMissing.length > 0) {
    throw new Error(`信息汇总仍缺少必填项: ${normalized.completeness.requiredMissing.join("、")}`);
  }
  return normalized;
}
