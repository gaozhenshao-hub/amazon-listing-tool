/**
 * AI Replenishment Prediction Engine
 * 
 * Based on V2 architecture document:
 * - Calculates optimal replenishment timing using historical step durations
 * - AI learns from past batch lead times (by shipping method, route, season, carrier)
 * - 4-level alert system: urgent(红), warning(橙), advance(黄), sufficient(绿)
 * - Generates structured replenishment suggestions via LLM
 */

import { getDb } from "./db";
import { shippingBatches, batchStepConfigs, stepTimeHistory, replenishmentPredictions, batchProducts } from "../drizzle/schema";
import { eq, and, sql, desc, gte, isNotNull } from "drizzle-orm";
// Lingxing API removed - inventory data now comes from Excel uploads
import { invokeLLM } from "./_core/llm";
import { getMappedStepDaysForRoute, type MappedStepDays } from "./nextsls/transitTimeService";
import { nextSlsAdapter } from "./nextsls/adapter";

// ============== Types ==============

interface StepDuration {
  stepNumber: number;
  expectedDays: number;
  actualDays: number | null;
  weightedAvgDays: number;
}

interface ReplenishmentInput {
  sku: string;
  asin?: string;
  storeName: string;
  currentAvailableInventory: number;
  reservedInventory: number;
  inboundInventory: number;
  unfulfillableInventory: number;
  dailySales7d: number;
  dailySales30d: number;
  forecast30d: number;
  inTransitDomestic: number;
  inTransitInternational: number;
  historicalLeadTimes: StepDuration[];
  shippingMethod?: string;
}

interface ReplenishmentResult {
  sku: string;
  asin?: string;
  storeName: string;
  currentAvailableInventory: number;
  dailySalesAvg: number;
  daysOfStockRemaining: number;
  fullCycleDays: number;
  alertLevel: 'urgent' | 'warning' | 'advance' | 'sufficient';
  recommendedQuantity: number;
  recommendedOrderDate: number; // timestamp
  recommendedShippingMethod: string;
  estimatedArrivalDate: number; // timestamp
  confidence: number;
  aiSuggestion: any;
  riskFactors: string[];
  alternativePlans: any[];
  /** 时效数据来源: nextsls=真实物流数据, historical=历史批次, default=默认值 */
  transitDataSource?: 'nextsls' | 'historical' | 'default';
}

// ============== Step Names ==============

const STEP_NAMES = [
  '', // index 0 unused
  '准备中',
  '采购中',
  '准备寄出',
  '已寄出',
  '国内运输中',
  '已到仓',
  '国际物流运输中',
  '接收中',
  '已到亚马逊仓',
  '上架可售',
];

// Default step durations by shipping method (days)
const DEFAULT_STEP_DAYS: Record<string, number[]> = {
  sea:     [0, 3, 14, 3, 1, 3, 2, 30, 7, 3, 1], // total ~67 days
  air:     [0, 3, 14, 2, 1, 2, 1, 7, 3, 2, 1],  // total ~36 days
  express: [0, 2, 7, 1, 1, 1, 1, 5, 2, 1, 1],   // total ~22 days
  rail:    [0, 3, 14, 3, 1, 3, 2, 20, 5, 3, 1],  // total ~55 days
};

// ============== Core Engine ==============

/**
 * Calculate weighted average step duration from historical data
 * More recent batches get higher weight
 */
async function getWeightedStepDuration(
  userId: string,
  stepNumber: number,
  shippingMethod?: string,
  carrierName?: string,
  route?: string,
): Promise<number | null> {
  const db = await getDb();
  
  // Build query conditions
  const conditions = [
    eq(stepTimeHistory.userId, userId),
    eq(stepTimeHistory.stepNumber, stepNumber),
    isNotNull(stepTimeHistory.actualDays),
  ];
  
  if (shippingMethod) {
    conditions.push(eq(stepTimeHistory.shippingMethod, shippingMethod));
  }

  const history = await db!.select()
    .from(stepTimeHistory)
    .where(and(...conditions))
    .orderBy(desc(stepTimeHistory.createdAt))
    .limit(20);

  if (history.length === 0) return null;

  // Weighted moving average: newer records get higher weight
  // Weight = 1/(position+1), so most recent = 1, second = 0.5, third = 0.33...
  let totalWeight = 0;
  let weightedSum = 0;
  
  // Apply seasonal factor for current month
  const currentMonth = new Date().getMonth() + 1;
  
  history.forEach((record, index) => {
    const weight = 1 / (index + 1);
    const actualDays = record.actualDays || record.expectedDays || 0;
    
    // Seasonal adjustment: if same month, boost weight by 50%
    const seasonalBoost = record.monthOfYear === currentMonth ? 1.5 : 1.0;
    const adjustedWeight = weight * seasonalBoost;
    
    weightedSum += actualDays * adjustedWeight;
    totalWeight += adjustedWeight;
  });

  // Remove outliers (values > 2x median)
  const sortedDays = history.map(r => r.actualDays || 0).sort((a, b) => a - b);
  const median = sortedDays[Math.floor(sortedDays.length / 2)];
  
  const filteredHistory = history.filter(r => (r.actualDays || 0) <= median * 2.5);
  
  if (filteredHistory.length > 0 && filteredHistory.length < history.length) {
    // Recalculate with filtered data
    totalWeight = 0;
    weightedSum = 0;
    filteredHistory.forEach((record, index) => {
      const weight = 1 / (index + 1);
      const actualDays = record.actualDays || record.expectedDays || 0;
      const seasonalBoost = record.monthOfYear === currentMonth ? 1.5 : 1.0;
      const adjustedWeight = weight * seasonalBoost;
      weightedSum += actualDays * adjustedWeight;
      totalWeight += adjustedWeight;
    });
  }

  return Math.round(weightedSum / totalWeight);
}

/**
 * Calculate full supply chain cycle time for a given shipping method
 * 改造：优先使用NextSLS真实物流时效数据，其次使用历史批次加权平均，最后回退到默认值
 */
async function calculateFullCycleDays(
  userId: string,
  shippingMethod: string = 'sea',
  destinationCountry: string = 'US',
): Promise<{ totalDays: number; stepBreakdown: StepDuration[]; dataSource: 'nextsls' | 'historical' | 'default' }> {
  const defaults = DEFAULT_STEP_DAYS[shippingMethod] || DEFAULT_STEP_DAYS.sea;
  const stepBreakdown: StepDuration[] = [];
  let totalDays = 0;
  let dataSource: 'nextsls' | 'historical' | 'default' = 'default';

  // ① 尝试从NextSLS真实物流数据获取映射步骤天数
  let nextSlsMapped: MappedStepDays | null = null;
  if (nextSlsAdapter.isReady()) {
    try {
      nextSlsMapped = await getMappedStepDaysForRoute(undefined, destinationCountry);
      if (nextSlsMapped) {
        dataSource = 'nextsls';
      }
    } catch (err) {
      console.warn('[ReplenishmentEngine] NextSLS transit time fetch failed, falling back:', err);
    }
  }

  // 步骤天数映射表（NextSLS mapped step key -> step number）
  const nextSlsStepMap: Record<number, keyof MappedStepDays> = {
    1: 'step1_preparing',
    2: 'step2_purchasing',
    3: 'step3_readyToShip',
    4: 'step4_shipped',
    5: 'step5_domesticTransit',
    6: 'step6_arrivedWarehouse',
    7: 'step7_internationalTransit',
    8: 'step8_receiving',
    9: 'step9_arrivedAmazon',
  };

  for (let step = 1; step <= 9; step++) {
    const defaultDays = defaults[step] || 3;
    
    // 优先级：NextSLS真实数据 > 历史批次加权 > 默认值
    let effectiveDays = defaultDays;
    let actualDays: number | null = null;

    // ① NextSLS真实数据（仅对物流相关步骤 4-8 使用）
    if (nextSlsMapped && step >= 4 && step <= 8) {
      const mappedKey = nextSlsStepMap[step];
      const nextSlsDays = nextSlsMapped[mappedKey] as number;
      if (nextSlsDays > 0) {
        effectiveDays = nextSlsDays;
        actualDays = nextSlsDays;
      }
    }

    // ② 如果NextSLS没有数据，回退到历史批次加权平均
    if (actualDays === null) {
      const weightedAvg = await getWeightedStepDuration(userId, step, shippingMethod);
      if (weightedAvg !== null) {
        effectiveDays = weightedAvg;
        actualDays = weightedAvg;
        if (dataSource === 'default') dataSource = 'historical';
      }
    }
    
    stepBreakdown.push({
      stepNumber: step,
      expectedDays: defaultDays,
      actualDays,
      weightedAvgDays: effectiveDays,
    });
    
    totalDays += effectiveDays;
  }

  return { totalDays, stepBreakdown, dataSource };
}

/**
 * Determine alert level based on days of stock vs full cycle
 */
function determineAlertLevel(
  daysOfStock: number,
  fullCycleDays: number,
): 'urgent' | 'warning' | 'advance' | 'sufficient' {
  if (daysOfStock < fullCycleDays * 0.5) return 'urgent';
  if (daysOfStock < fullCycleDays * 1.0) return 'warning';
  if (daysOfStock < fullCycleDays * 1.5) return 'advance';
  return 'sufficient';
}

/**
 * Get in-transit inventory for a SKU from active batches
 */
async function getInTransitInventory(userId: string, sku?: string): Promise<{
  domestic: number;
  international: number;
  receiving: number;
  total: number;
}> {
  const db = await getDb();
  
  // Get all active batches
  const batches = await db!.select()
    .from(shippingBatches)
    .where(and(
      eq(shippingBatches.userId, userId),
      eq(shippingBatches.status, 'active'),
    ));

  let domestic = 0;
  let international = 0;
  let receiving = 0;

  for (const batch of batches) {
    const step = batch.currentStep;
    // Steps 4-5: domestic in-transit
    if (step >= 4 && step <= 5) {
      domestic += batch.shippedQuantity || 0;
    }
    // Step 6: at warehouse (ready for international)
    if (step === 6) {
      domestic += batch.warehouseReceivedQuantity || 0;
    }
    // Step 7: international in-transit
    if (step === 7) {
      international += batch.internationalShippedQuantity || 0;
    }
    // Step 8: receiving at Amazon
    if (step === 8) {
      receiving += batch.amazonReceivedQuantity || 0;
    }
  }

  return {
    domestic,
    international,
    receiving,
    total: domestic + international + receiving,
  };
}

/**
 * Generate AI replenishment suggestion using LLM
 */
async function generateAISuggestion(input: ReplenishmentInput): Promise<any> {
  const historicalLeadTimesStr = input.historicalLeadTimes
    .map(s => `  步骤${s.stepNumber}(${STEP_NAMES[s.stepNumber]}): 预计${s.expectedDays}天, AI加权平均${s.weightedAvgDays}天${s.actualDays !== null ? `, 历史实际${s.actualDays}天` : ''}`)
    .join('\n');

  const prompt = `你是一位资深的亚马逊FBA库存管理专家。根据以下数据，为运营人员提供精准的补货建议：

【当前库存状态】
- 亚马逊可售库存: ${input.currentAvailableInventory}
- 亚马逊预留库存: ${input.reservedInventory}
- 亚马逊入库中库存: ${input.inboundInventory}
- 亚马逊不可售库存: ${input.unfulfillableInventory}
- 国内在途库存: ${input.inTransitDomestic}
- 国际在途库存: ${input.inTransitInternational}
- 日均销量（近7天）: ${input.dailySales7d}
- 日均销量（近30天）: ${input.dailySales30d}
- 领星销量预测（未来30天）: ${input.forecast30d}

【历史补货数据 - 各阶段耗时】
${historicalLeadTimesStr}

【约束条件】
- 当前运输方式: ${input.shippingMethod || '海运'}
- 安全库存天数: 30天
- SKU: ${input.sku}
- 店铺: ${input.storeName}

请输出：
1. 建议补货数量（考虑安全库存天数30天和在途库存）
2. 建议下单日期
3. 推荐运输方式（含成本对比）
4. 预计到货日期
5. 风险因素评估
6. 备选方案（至少2个）

输出格式为JSON，所有数值保留整数，日期格式YYYY-MM-DD。`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "你是一位资深的亚马逊FBA库存管理专家。请以JSON格式输出补货建议。" },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "replenishment_suggestion",
          strict: true,
          schema: {
            type: "object",
            properties: {
              recommended_quantity: { type: "integer", description: "建议补货数量" },
              recommended_order_date: { type: "string", description: "建议下单日期 YYYY-MM-DD" },
              recommended_shipping_method: { type: "string", description: "推荐运输方式" },
              estimated_arrival_date: { type: "string", description: "预计到货日期 YYYY-MM-DD" },
              confidence: { type: "number", description: "置信度 0-1" },
              reasoning: { type: "string", description: "推理过程简述" },
              risk_factors: {
                type: "array",
                items: { type: "string" },
                description: "风险因素列表",
              },
              alternative_plans: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    method: { type: "string", description: "运输方式" },
                    quantity: { type: "integer", description: "建议数量" },
                    arrival_date: { type: "string", description: "预计到货日期" },
                    cost_comparison: { type: "string", description: "成本对比说明" },
                  },
                  required: ["method", "quantity", "arrival_date", "cost_comparison"],
                  additionalProperties: false,
                },
                description: "备选方案",
              },
            },
            required: [
              "recommended_quantity",
              "recommended_order_date",
              "recommended_shipping_method",
              "estimated_arrival_date",
              "confidence",
              "reasoning",
              "risk_factors",
              "alternative_plans",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content && typeof content === 'string') {
      return JSON.parse(content);
    }
    return null;
  } catch (err) {
    console.error('[ReplenishmentEngine] LLM call failed:', err);
    return null;
  }
}

/**
 * Run prediction for a single SKU
 */
async function predictForSku(
  userId: string,
  input: ReplenishmentInput,
): Promise<ReplenishmentResult> {
  // Calculate weighted daily sales (7d has higher weight for recent trend)
  const dailySalesAvg = input.dailySales7d * 0.6 + input.dailySales30d * 0.4;
  
  // Days of stock remaining
  const effectiveInventory = input.currentAvailableInventory + input.inTransitDomestic + input.inTransitInternational;
  const daysOfStockRemaining = dailySalesAvg > 0 ? Math.floor(effectiveInventory / dailySalesAvg) : 999;
  
  // Calculate full cycle days (now with NextSLS real transit data support)
  const { totalDays: fullCycleDays, stepBreakdown, dataSource } = await calculateFullCycleDays(
    userId,
    input.shippingMethod || 'sea',
    'US', // TODO: derive from store/marketplace
  );
  
  // Determine alert level
  const alertLevel = determineAlertLevel(daysOfStockRemaining, fullCycleDays);
  
  // Calculate recommended quantity (target: cover full cycle + 30 days safety stock)
  const targetDays = fullCycleDays + 30;
  const targetInventory = Math.ceil(dailySalesAvg * targetDays);
  const recommendedQuantity = Math.max(0, targetInventory - effectiveInventory);
  
  // Calculate dates
  const now = Date.now();
  const triggerDate = now + (daysOfStockRemaining - fullCycleDays) * 86400000;
  const recommendedOrderDate = Math.max(now, triggerDate);
  const estimatedArrivalDate = recommendedOrderDate + fullCycleDays * 86400000;
  
  // Generate AI suggestion for urgent/warning levels
  let aiSuggestion = null;
  let riskFactors: string[] = [];
  let alternativePlans: any[] = [];
  
  if (alertLevel === 'urgent' || alertLevel === 'warning') {
    aiSuggestion = await generateAISuggestion({
      ...input,
      historicalLeadTimes: stepBreakdown,
    });
    
    if (aiSuggestion) {
      riskFactors = aiSuggestion.risk_factors || [];
      alternativePlans = aiSuggestion.alternative_plans || [];
    }
  }
  
  // Default risk factors if AI didn't generate them
  if (riskFactors.length === 0) {
    if (alertLevel === 'urgent') riskFactors.push('库存即将断货，需紧急补货');
    if (input.shippingMethod === 'sea') riskFactors.push('海运周期较长，旺季可能延迟');
    const currentMonth = new Date().getMonth() + 1;
    if (currentMonth >= 10 || currentMonth <= 1) riskFactors.push('旺季物流拥堵风险');
  }
  
  // Default alternative plans
  if (alternativePlans.length === 0) {
    if (input.shippingMethod === 'sea' || !input.shippingMethod) {
      alternativePlans = [
        { method: '空运（紧急）', quantity: Math.ceil(recommendedQuantity * 0.3), arrival_date: new Date(now + 14 * 86400000).toISOString().split('T')[0], cost_comparison: '成本约为海运的3-5倍，但时效快20天以上' },
        { method: '空运+海运组合', quantity: recommendedQuantity, arrival_date: `空运${new Date(now + 14 * 86400000).toISOString().split('T')[0]}, 海运${new Date(estimatedArrivalDate).toISOString().split('T')[0]}`, cost_comparison: '30%空运+70%海运，平衡成本和时效' },
      ];
    }
  }

  return {
    sku: input.sku,
    asin: input.asin,
    storeName: input.storeName,
    currentAvailableInventory: input.currentAvailableInventory,
    dailySalesAvg: +dailySalesAvg.toFixed(1),
    daysOfStockRemaining,
    fullCycleDays,
    alertLevel,
    recommendedQuantity,
    recommendedOrderDate,
    recommendedShippingMethod: aiSuggestion?.recommended_shipping_method || input.shippingMethod || '海运',
    estimatedArrivalDate,
    confidence: aiSuggestion?.confidence || 0.75,
    aiSuggestion,
    riskFactors,
    alternativePlans,
    transitDataSource: dataSource,
  };
}

/**
 * Record step time when a batch advances to the next step
 */
export async function recordStepTime(
  userId: string,
  batchId: number,
  stepNumber: number,
  expectedDays: number,
  actualDays: number,
  shippingMethod?: string,
  carrierName?: string,
  route?: string,
) {
  const db = await getDb();
  await db!.insert(stepTimeHistory).values({
    userId,
    batchId,
    stepNumber,
    shippingMethod: shippingMethod || null,
    carrierName: carrierName || null,
    route: route || null,
    expectedDays,
    actualDays,
    monthOfYear: new Date().getMonth() + 1,
    createdAt: Date.now(),
  });
}

/**
 * Run full replenishment prediction for all SKUs
 */
export async function runReplenishmentPredictions(userId: string): Promise<ReplenishmentResult[]> {
  const db = await getDb();
  
  // Lingxing API removed - FBA inventory data now comes from Excel uploads
  // TODO: Read inventory data from lingxingProductWeekly or other imported tables
  const fbaItems: any[] = [];
  const forecastMap = new Map<string, any>();
  
  // Get in-transit inventory from shipping batches
  const inTransit = await getInTransitInventory(userId);
  
  // 4. Run prediction for each SKU
  const results: ReplenishmentResult[] = [];
  
  for (const item of fbaItems) {
    const forecast = forecastMap.get(item.sku) as any;
    
    const input: ReplenishmentInput = {
      sku: item.sku,
      asin: item.asin,
      storeName: item.store_name || 'Unknown',
      currentAvailableInventory: item.fulfillable_quantity || 0,
      reservedInventory: item.reserved_quantity || 0,
      inboundInventory: (item.inbound_working_quantity || 0) + (item.inbound_shipped_quantity || 0) + (item.inbound_receiving_quantity || 0),
      unfulfillableInventory: item.unfulfillable_quantity || 0,
      dailySales7d: forecast?.daily_sales_7d || item.daily_sales_avg || 0,
      dailySales30d: forecast?.daily_sales_30d || item.daily_sales_avg || 0,
      forecast30d: forecast?.forecast_30d || 0,
      inTransitDomestic: inTransit.domestic,
      inTransitInternational: inTransit.international,
      historicalLeadTimes: [],
      shippingMethod: 'sea',
    };
    
    const result = await predictForSku(userId, input);
    results.push(result);
    
    // Save prediction to DB
    try {
      // Check if prediction exists for this SKU
      const existing = await db!.select()
        .from(replenishmentPredictions)
        .where(and(
          eq(replenishmentPredictions.userId, userId),
          eq(replenishmentPredictions.sku, item.sku),
        ))
        .limit(1);
      
      const predictionData = {
        userId,
        sku: item.sku,
        asin: item.asin || null,
        storeName: item.store_name || null,
        currentAvailableInventory: result.currentAvailableInventory,
        dailySalesAvg: String(result.dailySalesAvg),
        daysOfStockRemaining: result.daysOfStockRemaining,
        fullCycleDays: result.fullCycleDays,
        recommendedQuantity: result.recommendedQuantity,
        recommendedOrderDate: result.recommendedOrderDate,
        recommendedShippingMethod: result.recommendedShippingMethod,
        estimatedArrivalDate: result.estimatedArrivalDate,
        confidence: String(result.confidence),
        aiSuggestion: result.aiSuggestion ? JSON.stringify(result.aiSuggestion) : null,
        riskFactors: JSON.stringify(result.riskFactors),
        alternativePlans: JSON.stringify(result.alternativePlans),
        alertLevel: result.alertLevel,
        alertSentAt: null,
        userConfirmed: 0,
        predictedAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      if (existing.length > 0) {
        await db!.update(replenishmentPredictions)
          .set(predictionData)
          .where(eq(replenishmentPredictions.id, existing[0].id));
      } else {
        await db!.insert(replenishmentPredictions).values(predictionData);
      }
    } catch (err) {
      console.error(`[ReplenishmentEngine] Failed to save prediction for ${item.sku}:`, err);
    }
  }
  
  // Sort by alert level priority
  const alertPriority = { urgent: 0, warning: 1, advance: 2, sufficient: 3 };
  results.sort((a, b) => alertPriority[a.alertLevel] - alertPriority[b.alertLevel]);
  
  return results;
}

/**
 * Get saved predictions from DB
 */
export async function getSavedPredictions(userId: string): Promise<any[]> {
  const db = await getDb();
  const predictions = await db!.select()
    .from(replenishmentPredictions)
    .where(eq(replenishmentPredictions.userId, userId))
    .orderBy(desc(replenishmentPredictions.predictedAt));
  
  return predictions.map(p => ({
    ...p,
    aiSuggestion: p.aiSuggestion ? JSON.parse(p.aiSuggestion as string) : null,
    riskFactors: p.riskFactors ? JSON.parse(p.riskFactors as string) : [],
    alternativePlans: p.alternativePlans ? JSON.parse(p.alternativePlans as string) : [],
  }));
}

/**
 * Get AI-recommended step durations based on historical data
 */
export async function getAIRecommendedDurations(
  userId: string,
  shippingMethod: string = 'sea',
): Promise<{ step: number; name: string; defaultDays: number; aiDays: number | null; dataPoints: number }[]> {
  const db = await getDb();
  const defaults = DEFAULT_STEP_DAYS[shippingMethod] || DEFAULT_STEP_DAYS.sea;
  const result = [];
  
  for (let step = 1; step <= 9; step++) {
    // Count data points for this step
    const countResult = await db!.select({ count: sql<number>`count(*)` })
      .from(stepTimeHistory)
      .where(and(
        eq(stepTimeHistory.userId, userId),
        eq(stepTimeHistory.stepNumber, step),
        shippingMethod ? eq(stepTimeHistory.shippingMethod, shippingMethod) : sql`1=1`,
      ));
    
    const dataPoints = Number(countResult[0]?.count || 0);
    const aiDays = await getWeightedStepDuration(userId, step, shippingMethod);
    
    result.push({
      step,
      name: STEP_NAMES[step],
      defaultDays: defaults[step] || 3,
      aiDays: dataPoints >= 3 ? aiDays : null, // Only recommend if enough data
      dataPoints,
    });
  }
  
  return result;
}

/**
 * Get inventory pipeline summary across all active batches
 */
export async function getInventoryPipelineSummary(userId: string) {
  const db = await getDb();
  
  const batches = await db!.select()
    .from(shippingBatches)
    .where(and(
      eq(shippingBatches.userId, userId),
      eq(shippingBatches.status, 'active'),
    ));
  
  const pipeline = {
    planned: 0,        // Step 1
    purchasing: 0,     // Step 2-3
    domesticTransit: 0, // Step 4-5
    warehouse: 0,      // Step 6
    internationalTransit: 0, // Step 7
    receiving: 0,      // Step 8
    amazonStocked: 0,  // Step 9
    availableForSale: 0, // Step 10
    totalInTransit: 0,
    totalAll: 0,
    batchCount: batches.length,
    stepDistribution: Array(11).fill(0), // count of batches per step (0-10)
  };
  
  for (const batch of batches) {
    const step = batch.currentStep;
    pipeline.stepDistribution[step]++;
    
    switch (step) {
      case 1:
        pipeline.planned += batch.plannedQuantity || 0;
        break;
      case 2:
      case 3:
        pipeline.purchasing += batch.orderedQuantity || batch.plannedQuantity || 0;
        break;
      case 4:
      case 5:
        pipeline.domesticTransit += batch.shippedQuantity || 0;
        break;
      case 6:
        pipeline.warehouse += batch.warehouseReceivedQuantity || 0;
        break;
      case 7:
        pipeline.internationalTransit += batch.internationalShippedQuantity || 0;
        break;
      case 8:
        pipeline.receiving += batch.amazonReceivedQuantity || 0;
        break;
      case 9:
        pipeline.amazonStocked += batch.amazonStockedQuantity || 0;
        break;
      case 10:
        pipeline.availableForSale += batch.amazonStockedQuantity || 0;
        break;
    }
  }
  
  pipeline.totalInTransit = pipeline.domesticTransit + pipeline.internationalTransit + pipeline.receiving;
  pipeline.totalAll = pipeline.planned + pipeline.purchasing + pipeline.domesticTransit + pipeline.warehouse + pipeline.internationalTransit + pipeline.receiving + pipeline.amazonStocked + pipeline.availableForSale;
  
  return pipeline;
}

export {
  calculateFullCycleDays,
  determineAlertLevel,
  getInTransitInventory,
  STEP_NAMES,
  DEFAULT_STEP_DAYS,
};
