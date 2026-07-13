/**
 * Ad Deep Analysis Router - 6 Sub-modules AI Analysis Engines
 * Module 1: Product Stage Diagnosis (产品周期诊断)
 * Module 2: Keyword Tier Management (关键词结构管理)
 * Module 3: Cross-Report Diagnosis (多报表串联诊断)
 * Module 4: Five Reports Independent Analysis (五大报表独立深度分析)
 * Module 5: SOP Task Board (SOP执行看板)
 * Module 6: AI Clinic (疑难杂症AI诊所)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import {
  adDailyPlacementReports,
  adDailySearchTermReports,
  adDailyImpressionShareReports,
  adDailySbBenchmarkReports,
  adDailyBusinessReports,
  adProductStages,
  adKeywordTiers,
  adDiagnoses,
  adReportAnalysisRecords,
  adSopTasks,
  adClinicRecords,
} from "../../drizzle/schema";
import { eq, and, inArray, gte, lte, desc, sql } from "drizzle-orm";
import { diagnoseAdViaEmperor, adviseAdSearchTermsViaEmperor, generateAdNegativeViaEmperor, allocateAdBudgetViaEmperor, generateAdStructureViaEmperor, suggestAdDaypartingViaEmperor } from "../emperorClient";

async function getDbInstance() {
  const d = await getDb();
  if (!d) throw new Error("数据库未连接");
  return d;
}

function n(v: any): number { return Number(v) || 0; }
function safePct(num: number, den: number): number {
  return den > 0 ? Math.round(num / den * 10000) / 100 : 0;
}

// ═══════════════════════════════════════════════════════════════
// Module 1: Product Stage Diagnosis (产品周期诊断)
// ═══════════════════════════════════════════════════════════════
const STAGE_DIAGNOSIS_PROMPT = `你是一位资深亚马逊广告运营专家。请根据以下每日广告数据，判断该产品当前所处的广告运营阶段。

## 三大阶段定义

### 止血期（Emergency）
- 特征：ACoS远超目标（>50%），花费高但转化极低，大量无效搜索词
- 核心任务：立即止损，否定无效词，降低竞价，收缩匹配范围
- 关键指标：ACoS>50%, CVR<5%, 大量0转化高花费词

### 稳结构期（Stabilize）
- 特征：ACoS在目标范围附近波动（20-40%），有一定转化但不稳定
- 核心任务：优化关键词结构，分层管理，稳定核心词表现
- 关键指标：ACoS 20-40%, CVR 5-15%, 有明确的核心转化词

### 放量期（Scale）
- 特征：ACoS稳定在目标以下（<25%），转化稳定，自然排名上升
- 核心任务：扩大覆盖，提升预算，拓展新词，提高市场份额
- 关键指标：ACoS<25%, CVR>15%, 自然单占比上升

## 输出要求（严格JSON格式）
{
  "stage": "止血期|稳结构期|放量期",
  "confidence": 0-100,
  "evidence": ["证据1", "证据2", "证据3"],
  "red_flags": ["风险信号1", "风险信号2"],
  "daily_highlights": [{"date": "YYYY-MM-DD", "event": "事件描述", "impact": "正面|负面|中性"}],
  "strategy": {
    "core_action": "核心操作建议",
    "keyword_strategy": "关键词策略",
    "budget_strategy": "预算策略",
    "bid_strategy": "竞价策略",
    "dont_do": ["不要做的事1", "不要做的事2"]
  },
  "transition_signals": ["向下一阶段过渡的信号1", "信号2"]
}`;

// ═══════════════════════════════════════════════════════════════
// Module 2: Keyword Tier Management (关键词结构管理)
// ═══════════════════════════════════════════════════════════════
const KEYWORD_TIER_PROMPT = `你是一位资深亚马逊广告关键词策略专家。请根据以下每日搜索词数据，对关键词进行分级管理。

## 关键词分级标准

### 核心词（Tier 1）
- 日均曝光>500，有稳定转化（CVR>10%），贡献主要销售额
- 角色：结构支点 / 输出核心
- 策略：精确匹配高竞价，确保TOS位置

### 腰部词（Tier 2）
- 日均曝光100-500，有一定转化（CVR 5-10%），潜力词
- 角色：流量补充 / 转化辅助
- 策略：词组匹配中等竞价，观察趋势

### 长尾词（Tier 3）
- 日均曝光<100，转化不稳定但CPC低
- 角色：覆盖拓展 / 低成本获客
- 策略：广泛匹配低竞价，批量管理

## 输出要求（严格JSON数组格式）
[
  {
    "keyword": "关键词",
    "tier": "核心词|腰部词|长尾词",
    "role": "结构支点|输出核心|修复核心|流量补充|转化辅助|覆盖拓展|低成本获客",
    "current_performance": "优秀|良好|待优化|需止血",
    "daily_trend": "上升|稳定|下降|波动",
    "anomaly_dates": ["YYYY-MM-DD"],
    "action": "具体操作建议",
    "bid_suggestion": "竞价建议（如：提高20%到$1.5）",
    "priority": "高|中|低",
    "reason": "分级理由"
  }
]

注意：最多输出前30个最重要的关键词，按优先级排序。`;

// ═══════════════════════════════════════════════════════════════
// Module 3: Cross-Report Diagnosis (多报表串联诊断)
// ═══════════════════════════════════════════════════════════════
const CROSS_DIAGNOSIS_PROMPT = `你是一位资深亚马逊广告诊断专家。请综合分析以下5份每日报告数据，进行多维度串联诊断。

## 诊断框架（5步法）

### Step 1: 流量健康度
- 广告位分布是否合理？TOS占比是否过低？
- 展示量份额趋势？是否被竞品挤压？

### Step 2: 转化效率
- 搜索词转化率趋势？高花费低转化词占比？
- 业务报告的Session转化率与广告CVR对比

### Step 3: 成本控制
- ACoS/TACOS趋势？预算利用效率？
- CPC波动是否异常？

### Step 4: 竞争态势
- 展示量份额变化？竞品动作信号？
- SB Benchmark对比差距？

### Step 5: 自然流量贡献
- 自然单占比趋势？广告是否在蚕食自然流量？
- 总订单增长是否与广告投入匹配？

## 输出要求（严格JSON格式）
{
  "diagnosis_steps": [
    {"step": "流量健康度", "score": 0-100, "findings": ["发现1"], "issues": ["问题1"]},
    {"step": "转化效率", "score": 0-100, "findings": ["发现1"], "issues": ["问题1"]},
    {"step": "成本控制", "score": 0-100, "findings": ["发现1"], "issues": ["问题1"]},
    {"step": "竞争态势", "score": 0-100, "findings": ["发现1"], "issues": ["问题1"]},
    {"step": "自然流量贡献", "score": 0-100, "findings": ["发现1"], "issues": ["问题1"]}
  ],
  "overall_verdict": "综合诊断结论",
  "priority_actions": [
    {"action": "操作建议", "urgency": "立即|本周|下周", "expected_impact": "预期效果"}
  ],
  "warning": "风险预警信息"
}`;

// ═══════════════════════════════════════════════════════════════
// Module 4: Five Reports Independent Analysis Prompts
// ═══════════════════════════════════════════════════════════════
const PLACEMENT_ANALYSIS_PROMPT = `你是一位资深亚马逊广告位优化专家。请根据以下每日广告位数据，进行深度分析。

## 分析规则
P-1: 找出连续3天在Top of Search转化率远高于其他位置的广告活动→建议设置TOS溢价20-50%
P-2: 找出Product Pages花费占比>40%但CVR<3%的活动→建议降低Product Pages竞价或排除
P-3: 找出Rest of Search CPC异常偏高（>均值1.5倍）的活动→建议检查是否被竞品恶意点击

## 输出要求（严格JSON格式）
{
  "placement_trends": [
    {"placement": "Top of Search|Rest of Search|Product Pages", "avg_ctr": 0.05, "avg_cvr": 0.12, "spend_share": 0.35, "trend": "上升|稳定|下降"}
  ],
  "action_items": [
    {"rule": "P-1|P-2|P-3", "campaign": "活动名", "finding": "发现描述", "action": "操作建议", "priority": "高|中|低", "expected_impact": "预期效果"}
  ],
  "daily_anomalies": [
    {"date": "YYYY-MM-DD", "anomaly": "异常描述", "affected_campaigns": ["活动名"]}
  ],
  "summary": "总体分析总结"
}`;

const SEARCH_TERM_ANALYSIS_PROMPT = `你是一位资深亚马逊搜索词优化专家。请根据以下每日搜索词数据，进行深度分析。

## 分析规则
ST-1: 连续3天花费>$5但0转化的搜索词→加入否定词列表
ST-2: 单日花费突增>200%但转化率不变的词→检查是否被恶意点击
ST-3: 连续5天CVR>15%且CPC<均值的词→标记为"养词"目标，逐步提高竞价
ST-4: 新出现的高转化搜索词（前7天未出现，近3天CVR>10%）→建议开启精确匹配活动

## 输出要求（严格JSON格式）
{
  "negative_candidates": [
    {"search_term": "词", "reason": "ST-1|ST-2", "total_spend": 15.5, "days_no_conversion": 3}
  ],
  "nurture_candidates": [
    {"search_term": "词", "avg_cvr": 0.18, "avg_cpc": 0.85, "suggested_bid": 1.2, "reason": "ST-3|ST-4"}
  ],
  "anomaly_alerts": [
    {"date": "YYYY-MM-DD", "search_term": "词", "anomaly_type": "花费突增|CTR骤降|新词爆发", "detail": "描述"}
  ],
  "top_performers": [
    {"search_term": "词", "total_orders": 10, "avg_acos": 0.15, "trend": "稳定|上升"}
  ],
  "summary": "总体分析总结"
}`;

const IMPRESSION_SHARE_ANALYSIS_PROMPT = `你是一位资深亚马逊竞争分析专家。请根据以下每日展示量份额数据，进行竞争格局分析。

## 分析规则
IS-1: 核心词展示份额连续3天下降>5%→预警竞品加大投入，建议提高竞价
IS-2: 展示排名从Top 3跌出Top 5→建议检查竞价和Listing质量
IS-3: 新竞品ASIN首次出现在Top 3→标记为新威胁，建议监控
IS-4: 自身份额>30%的词→标记为防守词，设置竞价保护

## 输出要求（严格JSON格式）
{
  "market_position": {
    "avg_share": 0.15,
    "share_trend": "上升|稳定|下降",
    "top_keywords_count": 5,
    "at_risk_keywords": 3
  },
  "competitive_alerts": [
    {"rule": "IS-1|IS-2|IS-3|IS-4", "keyword": "词", "current_share": 0.12, "change": -0.05, "competitor_asin": "B0xxx", "action": "操作建议"}
  ],
  "defense_keywords": [
    {"keyword": "词", "share": 0.35, "strategy": "防守策略"}
  ],
  "budget_reallocation": [
    {"from_keyword": "词A", "to_keyword": "词B", "reason": "原因", "amount_suggestion": "$5/day"}
  ],
  "summary": "竞争格局总结"
}`;

const SB_BENCHMARK_ANALYSIS_PROMPT = `你是一位资深亚马逊品牌广告(SB)优化专家。请根据以下每日SB Benchmark数据，进行品牌广告分析。

## 分析规则
SB-1: CTR低于类目基准>30%→建议优化创意素材（图片/标题）
SB-2: New-to-brand率高于基准→品牌拉新效果好，建议加大预算
SB-3: DPV率低于基准→着陆页体验差，建议优化Store页面
SB-4: 连续5天ROAS高于基准150%→建议固化当前素材，停止A/B测试

## 输出要求（严格JSON格式）
{
  "benchmark_comparison": {
    "ctr_vs_benchmark": "+15%|-20%",
    "acos_vs_benchmark": "+5%|-10%",
    "ntb_vs_benchmark": "+25%|-5%",
    "dpv_vs_benchmark": "+10%|-15%"
  },
  "creative_recommendations": [
    {"rule": "SB-1|SB-2|SB-3|SB-4", "campaign": "活动名", "finding": "发现", "action": "操作建议", "priority": "高|中|低"}
  ],
  "brand_health": {
    "ntb_trend": "上升|稳定|下降",
    "brand_search_impact": "描述品牌搜索变化",
    "store_traffic_quality": "高|中|低"
  },
  "ab_test_suggestions": [
    {"element": "标题|图片|视频|着陆页", "current": "当前版本描述", "suggested": "建议测试方向"}
  ],
  "summary": "品牌广告总结"
}`;

const BUSINESS_CROSS_ANALYSIS_PROMPT = `你是一位资深亚马逊运营数据分析专家。请根据以下每日业务报告和广告数据的交叉对比，分析自然流量与广告流量的关系。

## 分析规则
BR-1: 每日记录自然单占比。健康放量期，自然单占比应呈上升趋势
BR-2: 广告花费增加但总订单量未增加（广告单吃掉自然单）→立即停止加价，适当降低竞价
BR-3: TACOS连续3天上升>20%→预警广告效率下降，检查是否需要优化
BR-4: Session增长但转化率下降→可能是流量质量问题，检查搜索词相关性

## 输出要求（严格JSON格式）
{
  "daily_metrics": [
    {"date": "YYYY-MM-DD", "total_orders": 50, "ad_orders": 20, "organic_orders": 30, "organic_ratio": 0.6, "tacos": 0.12, "session_cvr": 0.15}
  ],
  "trend_analysis": {
    "organic_ratio_trend": "上升|稳定|下降",
    "tacos_trend": "上升|稳定|下降",
    "ad_dependency": "高|中|低",
    "health_score": 0-100
  },
  "alerts": [
    {"rule": "BR-1|BR-2|BR-3|BR-4", "date": "YYYY-MM-DD", "finding": "发现", "action": "操作建议", "urgency": "立即|本周|观察"}
  ],
  "recommendations": [
    {"category": "预算|竞价|关键词|Listing", "action": "具体建议", "expected_impact": "预期效果"}
  ],
  "summary": "自然流量与广告关系总结"
}`;

// ═══════════════════════════════════════════════════════════════
// Module 5: SOP Task Generation Prompt
// ═══════════════════════════════════════════════════════════════
const SOP_GENERATION_PROMPT = `你是一位资深亚马逊广告运营SOP专家。请根据以下分析结果，生成结构化的SOP任务清单。

## 任务分类
- 止血：紧急止损操作（否词、降价、暂停）
- 优化：常规优化操作（调价、调匹配、优化素材）
- 拓展：扩量操作（新词、新活动、提预算）
- 监控：观察类任务（追踪指标、验证效果）

## 输出要求（严格JSON数组格式）
[
  {
    "period": "daily|weekly|monthly",
    "category": "止血|优化|拓展|监控",
    "title": "任务标题",
    "description": "详细描述",
    "evidence": "数据依据",
    "priority": "高|中|低",
    "due_date": "YYYY-MM-DD或空"
  }
]

注意：最多输出20个最重要的任务，按优先级和紧急程度排序。`;

// ═══════════════════════════════════════════════════════════════
// Module 6: AI Clinic Diagnosis Prompt
// ═══════════════════════════════════════════════════════════════
const CLINIC_DIAGNOSIS_PROMPT = `你是一位资深亚马逊广告"医生"。用户描述了一个广告运营问题，请像医生问诊一样进行诊断。

## 诊断流程
1. 症状确认：确认用户描述的症状
2. 数据检查：分析相关数据指标
3. 根因分析：找出问题根本原因
4. 治疗方案：给出具体操作步骤
5. 预后评估：预期恢复时间和效果

## 输出要求（严格JSON格式）
{
  "symptom_confirmed": "确认的症状描述",
  "vital_signs": [
    {"metric": "指标名", "current": "当前值", "healthy_range": "健康范围", "status": "正常|异常|危险"}
  ],
  "root_cause": "根本原因分析",
  "contributing_factors": ["诱因1", "诱因2"],
  "prescription": [
    {"step": 1, "action": "操作步骤", "timing": "立即|24h内|本周", "expected_effect": "预期效果"}
  ],
  "prognosis": {
    "recovery_time": "预计恢复时间",
    "success_probability": "高|中|低",
    "monitoring_metrics": ["需要监控的指标"]
  },
  "prevention": ["预防建议1", "预防建议2"]
}`;

// ═══════════════════════════════════════════════════════════════
// Helper: Aggregate daily data for AI input
// ═══════════════════════════════════════════════════════════════
function summarizePlacementData(data: any[]): string {
  if (!data.length) return "无广告位数据";
  const byDate: Record<string, any[]> = {};
  data.forEach(r => {
    const d = r.reportDate || "unknown";
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });
  const dates = Object.keys(byDate).sort();
  let summary = `日期范围: ${dates[0]} ~ ${dates[dates.length - 1]}, 共${dates.length}天数据\n`;
  summary += `总行数: ${data.length}\n\n`;
  // Aggregate by placement
  const byPlacement: Record<string, { impressions: number; clicks: number; spend: number; sales: number; orders: number }> = {};
  data.forEach(r => {
    const p = r.placement || "Other";
    if (!byPlacement[p]) byPlacement[p] = { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
    byPlacement[p].impressions += n(r.impressions);
    byPlacement[p].clicks += n(r.clicks);
    byPlacement[p].spend += n(r.spend);
    byPlacement[p].sales += n(r.sales);
    byPlacement[p].orders += n(r.orders);
  });
  summary += "各广告位汇总:\n";
  Object.entries(byPlacement).forEach(([p, v]) => {
    const ctr = safePct(v.clicks, v.impressions);
    const cvr = safePct(v.orders, v.clicks);
    const acos = v.sales > 0 ? safePct(v.spend, v.sales) : 0;
    summary += `  ${p}: 曝光${v.impressions} 点击${v.clicks} CTR${ctr}% 花费$${v.spend.toFixed(2)} 销售$${v.sales.toFixed(2)} 订单${v.orders} CVR${cvr}% ACoS${acos}%\n`;
  });
  // Daily trend (last 7 days)
  const recentDates = dates.slice(-7);
  summary += "\n最近7天每日趋势:\n";
  recentDates.forEach(d => {
    const dayData = byDate[d];
    const totalSpend = dayData.reduce((s: number, r: any) => s + n(r.spend), 0);
    const totalSales = dayData.reduce((s: number, r: any) => s + n(r.sales), 0);
    const totalOrders = dayData.reduce((s: number, r: any) => s + n(r.orders), 0);
    summary += `  ${d}: 花费$${totalSpend.toFixed(2)} 销售$${totalSales.toFixed(2)} 订单${totalOrders}\n`;
  });
  return summary;
}

function summarizeSearchTermData(data: any[]): string {
  if (!data.length) return "无搜索词数据";
  const totalSpend = data.reduce((s, r) => s + n(r.spend), 0);
  const totalSales = data.reduce((s, r) => s + n(r.sales), 0);
  const totalOrders = data.reduce((s, r) => s + n(r.orders), 0);
  const totalClicks = data.reduce((s, r) => s + n(r.clicks), 0);
  
  // Group by search term
  const byTerm: Record<string, { impressions: number; clicks: number; spend: number; sales: number; orders: number; days: Set<string> }> = {};
  data.forEach(r => {
    const term = r.searchTerm || "unknown";
    if (!byTerm[term]) byTerm[term] = { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, days: new Set() };
    byTerm[term].impressions += n(r.impressions);
    byTerm[term].clicks += n(r.clicks);
    byTerm[term].spend += n(r.spend);
    byTerm[term].sales += n(r.sales);
    byTerm[term].orders += n(r.orders);
    if (r.reportDate) byTerm[term].days.add(r.reportDate);
  });

  let summary = `总花费: $${totalSpend.toFixed(2)}, 总销售: $${totalSales.toFixed(2)}, 总订单: ${totalOrders}, 总点击: ${totalClicks}\n`;
  summary += `不同搜索词数: ${Object.keys(byTerm).length}\n\n`;

  // Top 20 by spend
  const sorted = Object.entries(byTerm).sort((a, b) => b[1].spend - a[1].spend).slice(0, 20);
  summary += "花费Top20搜索词:\n";
  sorted.forEach(([term, v]) => {
    const cvr = safePct(v.orders, v.clicks);
    const acos = v.sales > 0 ? safePct(v.spend, v.sales) : 999;
    summary += `  "${term}": 花费$${v.spend.toFixed(2)} 订单${v.orders} CVR${cvr}% ACoS${acos}% 活跃天数${v.days.size}\n`;
  });

  // Zero-conversion high-spend terms
  const zeroConv = Object.entries(byTerm).filter(([_, v]) => v.orders === 0 && v.spend > 3).sort((a, b) => b[1].spend - a[1].spend).slice(0, 10);
  if (zeroConv.length > 0) {
    summary += "\n0转化高花费词(花费>$3):\n";
    zeroConv.forEach(([term, v]) => {
      summary += `  "${term}": 花费$${v.spend.toFixed(2)} 点击${v.clicks} 天数${v.days.size}\n`;
    });
  }
  return summary;
}

function summarizeImpressionShareData(data: any[]): string {
  if (!data.length) return "无展示量份额数据";
  let summary = `共${data.length}条记录\n\n`;
  // Group by search term
  const byTerm: Record<string, { shares: number[]; ranks: number[]; impressions: number }> = {};
  data.forEach(r => {
    const term = r.searchTerm || r.targeting || "unknown";
    if (!byTerm[term]) byTerm[term] = { shares: [], ranks: [], impressions: 0 };
    if (n(r.impressionShare)) byTerm[term].shares.push(n(r.impressionShare));
    if (n(r.impressionRank)) byTerm[term].ranks.push(n(r.impressionRank));
    byTerm[term].impressions += n(r.impressions);
  });
  const sorted = Object.entries(byTerm).sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 15);
  summary += "Top15关键词展示份额:\n";
  sorted.forEach(([term, v]) => {
    const avgShare = v.shares.length > 0 ? (v.shares.reduce((a, b) => a + b, 0) / v.shares.length * 100).toFixed(1) : "N/A";
    const avgRank = v.ranks.length > 0 ? (v.ranks.reduce((a, b) => a + b, 0) / v.ranks.length).toFixed(1) : "N/A";
    summary += `  "${term}": 平均份额${avgShare}% 平均排名${avgRank} 总曝光${v.impressions}\n`;
  });
  return summary;
}

function summarizeSbBenchmarkData(data: any[]): string {
  if (!data.length) return "无SB Benchmark数据";
  const totalSpend = data.reduce((s, r) => s + n(r.spend), 0);
  const totalSales = data.reduce((s, r) => s + n(r.sales), 0);
  const totalNtb = data.reduce((s, r) => s + n(r.newToBrandOrders), 0);
  const totalOrders = data.reduce((s, r) => s + n(r.orders), 0);
  
  let summary = `总花费: $${totalSpend.toFixed(2)}, 总销售: $${totalSales.toFixed(2)}, 总订单: ${totalOrders}, 新客订单: ${totalNtb}\n`;
  summary += `新客率: ${safePct(totalNtb, totalOrders)}%\n\n`;

  // Benchmark comparison
  const withBenchmark = data.filter(r => n(r.benchmarkCtr) > 0);
  if (withBenchmark.length > 0) {
    const avgCtr = withBenchmark.reduce((s, r) => s + n(r.ctr), 0) / withBenchmark.length;
    const avgBenchCtr = withBenchmark.reduce((s, r) => s + n(r.benchmarkCtr), 0) / withBenchmark.length;
    const avgAcos = withBenchmark.reduce((s, r) => s + n(r.acos), 0) / withBenchmark.length;
    const avgBenchAcos = withBenchmark.reduce((s, r) => s + n(r.benchmarkAcos), 0) / withBenchmark.length;
    summary += `CTR对比: 自身${(avgCtr * 100).toFixed(2)}% vs 基准${(avgBenchCtr * 100).toFixed(2)}%\n`;
    summary += `ACoS对比: 自身${(avgAcos * 100).toFixed(2)}% vs 基准${(avgBenchAcos * 100).toFixed(2)}%\n`;
  }
  return summary;
}

function summarizeBusinessCrossData(businessData: any[], adData: any[]): string {
  if (!businessData.length) return "无业务报告数据";
  // Group business data by date
  const bizByDate: Record<string, { sessions: number; orders: number; sales: number }> = {};
  businessData.forEach(r => {
    const d = r.reportDate || "unknown";
    if (!bizByDate[d]) bizByDate[d] = { sessions: 0, orders: 0, sales: 0 };
    bizByDate[d].sessions += n(r.sessions);
    bizByDate[d].orders += n(r.unitsOrdered);
    bizByDate[d].sales += n(r.orderedProductSales);
  });
  // Group ad data by date
  const adByDate: Record<string, { spend: number; orders: number; sales: number }> = {};
  adData.forEach(r => {
    const d = r.reportDate || "unknown";
    if (!adByDate[d]) adByDate[d] = { spend: 0, orders: 0, sales: 0 };
    adByDate[d].spend += n(r.spend);
    adByDate[d].orders += n(r.orders);
    adByDate[d].sales += n(r.sales);
  });

  let summary = "每日业务×广告交叉数据:\n";
  const dates = Object.keys(bizByDate).sort().slice(-14); // Last 14 days
  dates.forEach(d => {
    const biz = bizByDate[d] || { sessions: 0, orders: 0, sales: 0 };
    const ad = adByDate[d] || { spend: 0, orders: 0, sales: 0 };
    const organicOrders = Math.max(0, biz.orders - ad.orders);
    const organicRatio = biz.orders > 0 ? safePct(organicOrders, biz.orders) : 0;
    const tacos = biz.sales > 0 ? safePct(ad.spend, biz.sales) : 0;
    summary += `  ${d}: 总订单${biz.orders} 广告订单${ad.orders} 自然订单${organicOrders} 自然占比${organicRatio}% TACOS${tacos}% 广告花费$${ad.spend.toFixed(2)} 总销售$${biz.sales.toFixed(2)}\n`;
  });
  return summary;
}

// ═══════════════════════════════════════════════════════════════
// Router Definition
// ═══════════════════════════════════════════════════════════════
export const adDeepAnalysisRouter = router({
  // ─── Module 1: Product Stage Diagnosis ──────────────────────
  diagnoseProductStage: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      // Fetch placement + search term data for stage diagnosis
      const placementData = await d.select().from(adDailyPlacementReports).where(
        and(eq(adDailyPlacementReports.userId, ctx.user.id), inArray(adDailyPlacementReports.portfolioName, input.portfolioNames), gte(adDailyPlacementReports.reportDate, input.dateStart), lte(adDailyPlacementReports.reportDate, input.dateEnd))
      );
      const searchTermData = await d.select().from(adDailySearchTermReports).where(
        and(eq(adDailySearchTermReports.userId, ctx.user.id), inArray(adDailySearchTermReports.portfolioName, input.portfolioNames), gte(adDailySearchTermReports.reportDate, input.dateStart), lte(adDailySearchTermReports.reportDate, input.dateEnd))
      );

      const dataSummary = `## 广告位数据\n${summarizePlacementData(placementData)}\n\n## 搜索词数据\n${summarizeSearchTermData(searchTermData)}`;

      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STAGE_DIAGNOSIS_PROMPT },
          { role: "user", content: `请分析以下数据并判断产品阶段:\n\n${dataSummary}` },
        ],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(String(response.choices[0].message.content) || "{}");

      // Save to DB
      const [insertResult] = await d.insert(adProductStages).values({
        userId: ctx.user.id,
        portfolioNames: JSON.stringify(input.portfolioNames),
        dateRangeStart: input.dateStart,
        dateRangeEnd: input.dateEnd,
        stage: result.stage || "稳结构期",
        confidence: result.confidence || 50,
        evidence: JSON.stringify(result.evidence || []),
        redFlags: JSON.stringify(result.red_flags || []),
        dailyHighlights: JSON.stringify(result.daily_highlights || []),
        strategy: JSON.stringify(result.strategy || {}),
        transitionSignals: JSON.stringify(result.transition_signals || []),
        status: "draft",
      });

      return { id: (insertResult as any).insertId, ...result };
    }),

  // ─── Module 2: Keyword Tier Analysis ────────────────────────
  analyzeKeywordTiers: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const searchTermData = await d.select().from(adDailySearchTermReports).where(
        and(eq(adDailySearchTermReports.userId, ctx.user.id), inArray(adDailySearchTermReports.portfolioName, input.portfolioNames), gte(adDailySearchTermReports.reportDate, input.dateStart), lte(adDailySearchTermReports.reportDate, input.dateEnd))
      );

      const dataSummary = summarizeSearchTermData(searchTermData);

      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) { /* Emperor result, continue with DB save */ }
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: KEYWORD_TIER_PROMPT },
          { role: "user", content: `请分析以下搜索词数据并进行关键词分级:\n\n${dataSummary}` },
        ],
        response_format: { type: "json_object" },
      });

      let keywords: any[] = [];
      try {
        const parsed = JSON.parse(String(response.choices[0].message.content) || "[]");
        keywords = Array.isArray(parsed) ? parsed : (parsed.keywords || []);
      } catch { keywords = []; }

      // Generate batch ID
      const batchId = Date.now();
      // Save keywords to DB
      for (const kw of keywords) {
        await d.insert(adKeywordTiers).values({
          userId: ctx.user.id,
          portfolioNames: JSON.stringify(input.portfolioNames),
          dateRangeStart: input.dateStart,
          dateRangeEnd: input.dateEnd,
          keyword: kw.keyword || "",
          tier: kw.tier || "长尾词",
          role: kw.role || null,
          currentPerformance: kw.current_performance || null,
          dailyTrend: kw.daily_trend || null,
          anomalyDates: JSON.stringify(kw.anomaly_dates || []),
          action: kw.action || null,
          bidSuggestion: kw.bid_suggestion || null,
          priority: kw.priority || "中",
          reason: kw.reason || null,
          batchId,
          status: "pending",
        });
      }

      return { batchId, keywords };
    }),

  // ─── Module 3: Cross-Report Diagnosis ───────────────────────
  crossReportDiagnosis: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const [placementData, searchTermData, impressionData, sbData, businessData] = await Promise.all([
        d.select().from(adDailyPlacementReports).where(and(eq(adDailyPlacementReports.userId, ctx.user.id), inArray(adDailyPlacementReports.portfolioName, input.portfolioNames), gte(adDailyPlacementReports.reportDate, input.dateStart), lte(adDailyPlacementReports.reportDate, input.dateEnd))),
        d.select().from(adDailySearchTermReports).where(and(eq(adDailySearchTermReports.userId, ctx.user.id), inArray(adDailySearchTermReports.portfolioName, input.portfolioNames), gte(adDailySearchTermReports.reportDate, input.dateStart), lte(adDailySearchTermReports.reportDate, input.dateEnd))),
        d.select().from(adDailyImpressionShareReports).where(and(eq(adDailyImpressionShareReports.userId, ctx.user.id), inArray(adDailyImpressionShareReports.portfolioName, input.portfolioNames), gte(adDailyImpressionShareReports.reportDate, input.dateStart), lte(adDailyImpressionShareReports.reportDate, input.dateEnd))),
        d.select().from(adDailySbBenchmarkReports).where(and(eq(adDailySbBenchmarkReports.userId, ctx.user.id), gte(adDailySbBenchmarkReports.reportDate, input.dateStart), lte(adDailySbBenchmarkReports.reportDate, input.dateEnd))),
        d.select().from(adDailyBusinessReports).where(and(eq(adDailyBusinessReports.userId, ctx.user.id), gte(adDailyBusinessReports.reportDate, input.dateStart), lte(adDailyBusinessReports.reportDate, input.dateEnd))),
      ]);

      const dataSummary = `## 广告位数据\n${summarizePlacementData(placementData)}\n\n## 搜索词数据\n${summarizeSearchTermData(searchTermData)}\n\n## 展示量份额数据\n${summarizeImpressionShareData(impressionData)}\n\n## SB Benchmark数据\n${summarizeSbBenchmarkData(sbData)}\n\n## 业务×广告交叉数据\n${summarizeBusinessCrossData(businessData, searchTermData)}`;

      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: CROSS_DIAGNOSIS_PROMPT },
          { role: "user", content: `请综合分析以下5份报告数据:\n\n${dataSummary}` },
        ],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(String(response.choices[0].message.content) || "{}");

      const [insertResult] = await d.insert(adDiagnoses).values({
        userId: ctx.user.id,
        portfolioNames: JSON.stringify(input.portfolioNames),
        dateRangeStart: input.dateStart,
        dateRangeEnd: input.dateEnd,
        diagnosisResult: JSON.stringify(result.diagnosis_steps || []),
        overallVerdict: result.overall_verdict || "",
        priorityActions: JSON.stringify(result.priority_actions || []),
        warning: result.warning || "",
        status: "draft",
      });

      return { id: (insertResult as any).insertId, ...result };
    }),

  // ─── Module 4: Five Reports Independent Analysis ────────────
  analyzePlacementReport: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const data = await d.select().from(adDailyPlacementReports).where(
        and(eq(adDailyPlacementReports.userId, ctx.user.id), inArray(adDailyPlacementReports.portfolioName, input.portfolioNames), gte(adDailyPlacementReports.reportDate, input.dateStart), lte(adDailyPlacementReports.reportDate, input.dateEnd))
      );
      const dataSummary = summarizePlacementData(data);
      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [{ role: "system", content: PLACEMENT_ANALYSIS_PROMPT }, { role: "user", content: `请分析以下广告位数据:\n\n${dataSummary}` }],
        response_format: { type: "json_object" },
      });
      const result = JSON.parse(String(response.choices[0].message.content) || "{}");
      const [insertResult] = await d.insert(adReportAnalysisRecords).values({
        userId: ctx.user.id, reportType: "placement", portfolioNames: JSON.stringify(input.portfolioNames),
        dateRangeStart: input.dateStart, dateRangeEnd: input.dateEnd,
        analysisResult: JSON.stringify(result), actionItems: JSON.stringify(result.action_items || []), status: "draft",
      });
      return { id: (insertResult as any).insertId, ...result };
    }),

  analyzeSearchTermReport: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const data = await d.select().from(adDailySearchTermReports).where(
        and(eq(adDailySearchTermReports.userId, ctx.user.id), inArray(adDailySearchTermReports.portfolioName, input.portfolioNames), gte(adDailySearchTermReports.reportDate, input.dateStart), lte(adDailySearchTermReports.reportDate, input.dateEnd))
      );
      const dataSummary = summarizeSearchTermData(data);
      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [{ role: "system", content: SEARCH_TERM_ANALYSIS_PROMPT }, { role: "user", content: `请分析以下搜索词数据:\n\n${dataSummary}` }],
        response_format: { type: "json_object" },
      });
      const result = JSON.parse(String(response.choices[0].message.content) || "{}");
      const [insertResult] = await d.insert(adReportAnalysisRecords).values({
        userId: ctx.user.id, reportType: "search_term", portfolioNames: JSON.stringify(input.portfolioNames),
        dateRangeStart: input.dateStart, dateRangeEnd: input.dateEnd,
        analysisResult: JSON.stringify(result), actionItems: JSON.stringify(result.negative_candidates || []), status: "draft",
      });
      return { id: (insertResult as any).insertId, ...result };
    }),

  analyzeImpressionShareReport: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const data = await d.select().from(adDailyImpressionShareReports).where(
        and(eq(adDailyImpressionShareReports.userId, ctx.user.id), inArray(adDailyImpressionShareReports.portfolioName, input.portfolioNames), gte(adDailyImpressionShareReports.reportDate, input.dateStart), lte(adDailyImpressionShareReports.reportDate, input.dateEnd))
      );
      const dataSummary = summarizeImpressionShareData(data);
      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [{ role: "system", content: IMPRESSION_SHARE_ANALYSIS_PROMPT }, { role: "user", content: `请分析以下展示量份额数据:\n\n${dataSummary}` }],
        response_format: { type: "json_object" },
      });
      const result = JSON.parse(String(response.choices[0].message.content) || "{}");
      const [insertResult] = await d.insert(adReportAnalysisRecords).values({
        userId: ctx.user.id, reportType: "impression_share", portfolioNames: JSON.stringify(input.portfolioNames),
        dateRangeStart: input.dateStart, dateRangeEnd: input.dateEnd,
        analysisResult: JSON.stringify(result), actionItems: JSON.stringify(result.competitive_alerts || []), status: "draft",
      });
      return { id: (insertResult as any).insertId, ...result };
    }),

  analyzeSbBenchmarkReport: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const data = await d.select().from(adDailySbBenchmarkReports).where(
        and(eq(adDailySbBenchmarkReports.userId, ctx.user.id), gte(adDailySbBenchmarkReports.reportDate, input.dateStart), lte(adDailySbBenchmarkReports.reportDate, input.dateEnd))
      );
      const dataSummary = summarizeSbBenchmarkData(data);
      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [{ role: "system", content: SB_BENCHMARK_ANALYSIS_PROMPT }, { role: "user", content: `请分析以下SB Benchmark数据:\n\n${dataSummary}` }],
        response_format: { type: "json_object" },
      });
      const result = JSON.parse(String(response.choices[0].message.content) || "{}");
      const [insertResult] = await d.insert(adReportAnalysisRecords).values({
        userId: ctx.user.id, reportType: "sb_benchmark", portfolioNames: JSON.stringify(input.portfolioNames),
        dateRangeStart: input.dateStart, dateRangeEnd: input.dateEnd,
        analysisResult: JSON.stringify(result), actionItems: JSON.stringify(result.creative_recommendations || []), status: "draft",
      });
      return { id: (insertResult as any).insertId, ...result };
    }),

  analyzeBusinessCrossReport: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const [businessData, adData] = await Promise.all([
        d.select().from(adDailyBusinessReports).where(and(eq(adDailyBusinessReports.userId, ctx.user.id), gte(adDailyBusinessReports.reportDate, input.dateStart), lte(adDailyBusinessReports.reportDate, input.dateEnd))),
        d.select().from(adDailySearchTermReports).where(and(eq(adDailySearchTermReports.userId, ctx.user.id), inArray(adDailySearchTermReports.portfolioName, input.portfolioNames), gte(adDailySearchTermReports.reportDate, input.dateStart), lte(adDailySearchTermReports.reportDate, input.dateEnd))),
      ]);
      const dataSummary = summarizeBusinessCrossData(businessData, adData);
      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [{ role: "system", content: BUSINESS_CROSS_ANALYSIS_PROMPT }, { role: "user", content: `请分析以下业务×广告交叉数据:\n\n${dataSummary}` }],
        response_format: { type: "json_object" },
      });
      const result = JSON.parse(String(response.choices[0].message.content) || "{}");
      const [insertResult] = await d.insert(adReportAnalysisRecords).values({
        userId: ctx.user.id, reportType: "business_cross", portfolioNames: JSON.stringify(input.portfolioNames),
        dateRangeStart: input.dateStart, dateRangeEnd: input.dateEnd,
        analysisResult: JSON.stringify(result), actionItems: JSON.stringify(result.alerts || []), status: "draft",
      });
      return { id: (insertResult as any).insertId, ...result };
    }),

  // ─── Module 4: Get analysis history ─────────────────────────
  getAnalysisHistory: protectedProcedure
    .input(z.object({
      reportType: z.string().optional(),
      limit: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adReportAnalysisRecords.userId, ctx.user.id)];
      if (input.reportType) conditions.push(eq(adReportAnalysisRecords.reportType, input.reportType));
      return d.select().from(adReportAnalysisRecords).where(and(...conditions)).orderBy(desc(adReportAnalysisRecords.createdAt)).limit(input.limit);
    }),

  // ─── Module 4: Update analysis (user edits) ─────────────────
  updateAnalysisRecord: protectedProcedure
    .input(z.object({
      id: z.number(),
      userEdits: z.string(),
      status: z.enum(["draft", "confirmed", "archived"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const updates: any = { userEdits: input.userEdits };
      if (input.status) updates.status = input.status;
      await d.update(adReportAnalysisRecords).set(updates).where(and(eq(adReportAnalysisRecords.id, input.id), eq(adReportAnalysisRecords.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── Module 5: Generate SOP Tasks ──────────────────────────
  generateSopTasks: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
      sourceAnalysisIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      // Gather recent analysis results as context
      const recentAnalyses = await d.select().from(adReportAnalysisRecords).where(
        and(eq(adReportAnalysisRecords.userId, ctx.user.id), eq(adReportAnalysisRecords.status, "confirmed"))
      ).orderBy(desc(adReportAnalysisRecords.createdAt)).limit(5);

      const recentDiagnoses = await d.select().from(adDiagnoses).where(
        and(eq(adDiagnoses.userId, ctx.user.id))
      ).orderBy(desc(adDiagnoses.createdAt)).limit(3);

      let context = "## 最近确认的分析结果:\n";
      recentAnalyses.forEach(a => {
        context += `- [${a.reportType}] ${a.dateRangeStart}~${a.dateRangeEnd}: ${(a.actionItems || "").substring(0, 200)}\n`;
      });
      recentDiagnoses.forEach(d => {
        context += `- [串联诊断] ${d.dateRangeStart}~${d.dateRangeEnd}: ${(d.overallVerdict || "").substring(0, 200)}\n`;
      });

      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) { /* Emperor result, continue with DB save */ }
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: SOP_GENERATION_PROMPT },
          { role: "user", content: `请根据以下分析结果生成SOP任务清单:\n\n${context}` },
        ],
        response_format: { type: "json_object" },
      });

      let tasks: any[] = [];
      try {
        const parsed = JSON.parse(String(response.choices[0].message.content) || "[]");
        tasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
      } catch { tasks = []; }

      // Save tasks to DB
      for (const task of tasks) {
        await d.insert(adSopTasks).values({
          userId: ctx.user.id,
          portfolioNames: JSON.stringify(input.portfolioNames),
          period: task.period || "weekly",
          category: task.category || "优化",
          title: task.title || "",
          description: task.description || "",
          evidence: task.evidence || "",
          priority: task.priority || "中",
          dueDate: task.due_date || null,
          sourceModule: "ai_generated",
          status: "pending",
        });
      }

      return { tasks };
    }),

  // ─── Module 5: List SOP Tasks ──────────────────────────────
  listSopTasks: protectedProcedure
    .input(z.object({
      status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(),
      period: z.enum(["daily", "weekly", "monthly"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adSopTasks.userId, ctx.user.id)];
      if (input.status) conditions.push(eq(adSopTasks.status, input.status));
      if (input.period) conditions.push(eq(adSopTasks.period, input.period));
      return d.select().from(adSopTasks).where(and(...conditions)).orderBy(desc(adSopTasks.createdAt)).limit(100);
    }),

  // ─── Module 5: Update SOP Task Status ──────────────────────
  updateSopTask: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "in_progress", "completed", "skipped"]),
      completedNote: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const updates: any = { status: input.status };
      if (input.status === "completed") updates.completedAt = new Date();
      if (input.completedNote) updates.completedNote = input.completedNote;
      await d.update(adSopTasks).set(updates).where(and(eq(adSopTasks.id, input.id), eq(adSopTasks.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── Module 6: AI Clinic - Start Consultation ──────────────
  startClinicConsultation: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()),
      dateStart: z.string().optional(),
      dateEnd: z.string().optional(),
      symptomCategory: z.string(),
      symptomDescription: z.string(),
      additionalContext: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      // Gather relevant data based on symptom
      let dataContext = "";
      if (input.dateStart && input.dateEnd && input.portfolioNames.length > 0) {
        const [placementData, searchTermData] = await Promise.all([
          d.select().from(adDailyPlacementReports).where(and(eq(adDailyPlacementReports.userId, ctx.user.id), inArray(adDailyPlacementReports.portfolioName, input.portfolioNames), gte(adDailyPlacementReports.reportDate, input.dateStart!), lte(adDailyPlacementReports.reportDate, input.dateEnd!))),
          d.select().from(adDailySearchTermReports).where(and(eq(adDailySearchTermReports.userId, ctx.user.id), inArray(adDailySearchTermReports.portfolioName, input.portfolioNames), gte(adDailySearchTermReports.reportDate, input.dateStart!), lte(adDailySearchTermReports.reportDate, input.dateEnd!))),
        ]);
        dataContext = `\n\n## 相关数据\n### 广告位数据\n${summarizePlacementData(placementData)}\n\n### 搜索词数据\n${summarizeSearchTermData(searchTermData)}`;
      }

      // Emperor Skill 优先 - 广告深度分析
      try {
        const emperorRes = await diagnoseAdViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] adDeepAnalysis fallback:", e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: CLINIC_DIAGNOSIS_PROMPT },
          { role: "user", content: `## 患者症状\n类别: ${input.symptomCategory}\n描述: ${input.symptomDescription}\n${input.additionalContext ? `补充信息: ${input.additionalContext}` : ""}${dataContext}` },
        ],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(String(response.choices[0].message.content) || "{}");

      const [insertResult] = await d.insert(adClinicRecords).values({
        userId: ctx.user.id,
        portfolioNames: JSON.stringify(input.portfolioNames),
        dateRangeStart: input.dateStart || null,
        dateRangeEnd: input.dateEnd || null,
        symptomCategory: input.symptomCategory,
        symptomDescription: input.symptomDescription,
        additionalContext: input.additionalContext || null,
        diagnosis: JSON.stringify(result),
        prescription: JSON.stringify(result.prescription || []),
        status: "diagnosed",
      });

      return { id: (insertResult as any).insertId, ...result };
    }),

  // ─── Module 6: List Clinic Records ─────────────────────────
  listClinicRecords: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      return d.select().from(adClinicRecords).where(eq(adClinicRecords.userId, ctx.user.id)).orderBy(desc(adClinicRecords.createdAt)).limit(input.limit);
    }),

  // ─── Module 6: Update Clinic Record ────────────────────────
  updateClinicRecord: protectedProcedure
    .input(z.object({
      id: z.number(),
      userEdits: z.string().optional(),
      status: z.enum(["consulting", "diagnosed", "treating", "resolved", "archived"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const updates: any = {};
      if (input.userEdits) updates.userEdits = input.userEdits;
      if (input.status) updates.status = input.status;
      await d.update(adClinicRecords).set(updates).where(and(eq(adClinicRecords.id, input.id), eq(adClinicRecords.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── Module 1: Get stage history ───────────────────────────
  getStageHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      return d.select().from(adProductStages).where(eq(adProductStages.userId, ctx.user.id)).orderBy(desc(adProductStages.createdAt)).limit(input.limit);
    }),

  // ─── Module 1: Update stage record ─────────────────────────
  updateStageRecord: protectedProcedure
    .input(z.object({
      id: z.number(),
      userEdits: z.string().optional(),
      status: z.enum(["draft", "confirmed", "archived"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const updates: any = {};
      if (input.userEdits) updates.userEdits = input.userEdits;
      if (input.status) updates.status = input.status;
      await d.update(adProductStages).set(updates).where(and(eq(adProductStages.id, input.id), eq(adProductStages.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── Module 2: Get keyword tier history ────────────────────
  getKeywordTierHistory: protectedProcedure
    .input(z.object({ batchId: z.number().optional(), limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adKeywordTiers.userId, ctx.user.id)];
      if (input.batchId) conditions.push(eq(adKeywordTiers.batchId, input.batchId));
      return d.select().from(adKeywordTiers).where(and(...conditions)).orderBy(desc(adKeywordTiers.createdAt)).limit(input.limit);
    }),

  // ─── Module 2: Update keyword tier ─────────────────────────
  updateKeywordTier: protectedProcedure
    .input(z.object({
      id: z.number(),
      userAction: z.string().optional(),
      status: z.enum(["pending", "confirmed", "ignored"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const updates: any = { userEdited: 1 };
      if (input.userAction) updates.userAction = input.userAction;
      if (input.status) updates.status = input.status;
      await d.update(adKeywordTiers).set(updates).where(and(eq(adKeywordTiers.id, input.id), eq(adKeywordTiers.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── Module 3: Get diagnosis history ───────────────────────
  getDiagnosisHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      return d.select().from(adDiagnoses).where(eq(adDiagnoses.userId, ctx.user.id)).orderBy(desc(adDiagnoses.createdAt)).limit(input.limit);
    }),

  // ─── Confirm Analysis (batch confirm action items) ─────────
  confirmAnalysis: protectedProcedure
    .input(z.object({
      id: z.number(),
      confirmedActions: z.string(), // JSON array of confirmed action items with user edits
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      await d.update(adReportAnalysisRecords).set({
        actionItems: input.confirmedActions,
        userEdits: input.confirmedActions,
        status: "confirmed",
      }).where(and(eq(adReportAnalysisRecords.id, input.id), eq(adReportAnalysisRecords.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── Get Analysis Detail ───────────────────────────────────
  getAnalysisDetail: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const [record] = await d.select().from(adReportAnalysisRecords).where(
        and(eq(adReportAnalysisRecords.id, input.id), eq(adReportAnalysisRecords.userId, ctx.user.id))
      ).limit(1);
      return record || null;
    }),

  // ─── Archive Analysis ──────────────────────────────────────
  archiveAnalysis: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      await d.update(adReportAnalysisRecords).set({ status: "archived" })
        .where(and(eq(adReportAnalysisRecords.id, input.id), eq(adReportAnalysisRecords.userId, ctx.user.id)));
      return { success: true };
    }),
});
