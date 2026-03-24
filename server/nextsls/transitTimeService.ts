/**
 * NextSLS Transit Time Analytics Service
 * 
 * 核心功能：
 * 1. 从NextSLS历史运单中提取物流轨迹时间节点
 * 2. 按渠道/目的国/路线统计平均运输时效
 * 3. 将真实时效数据映射到9步补货流程
 * 4. 为库存预警模块提供动态头程天数
 * 5. 缓存时效数据，定期刷新
 */

import { nextSlsAdapter, type NextSlsTraceItem } from "./adapter";

// ============== Types ==============

/** 物流时效统计记录 */
export interface TransitTimeRecord {
  shipmentId: string;
  service: string;           // 物流渠道名称
  destinationCountry: string;
  destinationState?: string;
  /** 各阶段耗时（天） */
  pickupToWarehouseDays: number | null;    // 揽收→到仓
  warehouseProcessDays: number | null;     // 仓库处理
  internationalTransitDays: number | null; // 国际运输
  customsClearanceDays: number | null;     // 清关
  lastMileDeliveryDays: number | null;     // 末端派送
  totalTransitDays: number | null;         // 总运输天数
  createdAt: number;
  deliveredAt: number | null;
}

/** 按渠道/目的国聚合的时效统计 */
export interface TransitTimeStats {
  service: string;
  destinationCountry: string;
  sampleCount: number;
  avgTotalDays: number;
  minTotalDays: number;
  maxTotalDays: number;
  medianTotalDays: number;
  p90TotalDays: number;       // 90%分位数
  /** 各阶段平均天数 */
  avgPickupToWarehouse: number;
  avgWarehouseProcess: number;
  avgInternationalTransit: number;
  avgCustomsClearance: number;
  avgLastMileDelivery: number;
  /** 映射到9步流程的天数 */
  mappedStepDays: MappedStepDays;
  lastUpdated: number;
  confidence: 'high' | 'medium' | 'low';
}

/** 映射到9步补货流程的天数 */
export interface MappedStepDays {
  step1_preparing: number;         // 准备中（不变，用默认值）
  step2_purchasing: number;        // 采购中（不变，用默认值）
  step3_readyToShip: number;       // 准备寄出（不变，用默认值）
  step4_shipped: number;           // 已寄出 → 对应 pickupToWarehouse
  step5_domesticTransit: number;   // 国内运输中 → 对应 warehouseProcess
  step6_arrivedWarehouse: number;  // 已到仓 → 对应 warehouseProcess
  step7_internationalTransit: number; // 国际物流运输中 → 对应 internationalTransit + customs
  step8_receiving: number;         // 接收中 → 对应 lastMileDelivery
  step9_arrivedAmazon: number;     // 已到亚马逊仓 → 最终确认
  totalDays: number;
}

// ============== Cache ==============

interface CacheEntry {
  stats: TransitTimeStats[];
  timestamp: number;
}

const statsCache = new Map<string, CacheEntry>();
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// ============== Trace Parsing ==============

/**
 * 从NextSLS物流轨迹中提取关键时间节点
 * 轨迹信息通常包含：揽收、入仓、出仓、航班起飞、航班到达、清关、派送、签收等
 */
function parseTraceTimeline(traces: NextSlsTraceItem[]): {
  pickupTime: number | null;
  warehouseInTime: number | null;
  warehouseOutTime: number | null;
  departureTime: number | null;
  arrivalTime: number | null;
  customsClearTime: number | null;
  deliveryTime: number | null;
} {
  let pickupTime: number | null = null;
  let warehouseInTime: number | null = null;
  let warehouseOutTime: number | null = null;
  let departureTime: number | null = null;
  let arrivalTime: number | null = null;
  let customsClearTime: number | null = null;
  let deliveryTime: number | null = null;

  // Sort traces by time ascending
  const sorted = [...traces].sort((a, b) => a.time - b.time);

  for (const trace of sorted) {
    const info = trace.info.toLowerCase();
    
    // 揽收/取件
    if (!pickupTime && (info.includes('揽收') || info.includes('取件') || info.includes('pickup') || info.includes('collected'))) {
      pickupTime = trace.time;
    }
    // 入仓
    if (!warehouseInTime && (info.includes('入仓') || info.includes('到达仓库') || info.includes('warehouse') || info.includes('received at'))) {
      warehouseInTime = trace.time;
    }
    // 出仓/发出
    if (!warehouseOutTime && (info.includes('出仓') || info.includes('发出') || info.includes('dispatched') || info.includes('departed'))) {
      warehouseOutTime = trace.time;
    }
    // 航班起飞/出发
    if (!departureTime && (info.includes('起飞') || info.includes('航班') || info.includes('出发') || info.includes('depart') || info.includes('flight'))) {
      departureTime = trace.time;
    }
    // 到达目的国
    if (!arrivalTime && (info.includes('到达目的') || info.includes('arrived') || info.includes('到港'))) {
      arrivalTime = trace.time;
    }
    // 清关
    if (!customsClearTime && (info.includes('清关') || info.includes('customs') || info.includes('通关') || info.includes('released'))) {
      customsClearTime = trace.time;
    }
    // 签收/派送完成
    if (info.includes('签收') || info.includes('delivered') || info.includes('妥投') || info.includes('completed')) {
      deliveryTime = trace.time;
    }
  }

  return { pickupTime, warehouseInTime, warehouseOutTime, departureTime, arrivalTime, customsClearTime, deliveryTime };
}

/**
 * 计算两个时间戳之间的天数
 */
function daysBetween(start: number | null, end: number | null): number | null {
  if (!start || !end || end <= start) return null;
  return Math.round((end - start) / (86400 * 1000));
}

// ============== Core Service ==============

/**
 * 从NextSLS获取历史运单并分析物流时效
 */
export async function analyzeTransitTimes(options?: {
  startDate?: string;
  endDate?: string;
  service?: string;
  forceRefresh?: boolean;
}): Promise<TransitTimeRecord[]> {
  if (!nextSlsAdapter.isReady()) {
    return [];
  }

  const records: TransitTimeRecord[] = [];

  try {
    // 获取已完成的运单列表
    const shipments = await nextSlsAdapter.getShipmentList({
      status: 'delivered',
      start_created: options?.startDate,
      end_created: options?.endDate,
      page_size: 100,
    });

    for (const shipment of shipments) {
      try {
        // 获取每个运单的物流轨迹
        const tracking = await nextSlsAdapter.getTracking({
          shipment_id: shipment.shipment_id,
          language: 'zh',
        });

        if (!tracking?.traces || tracking.traces.length === 0) continue;

        const timeline = parseTraceTimeline(tracking.traces);
        const toAddress = shipment.to_address;

        const record: TransitTimeRecord = {
          shipmentId: shipment.shipment_id,
          service: shipment.service || 'unknown',
          destinationCountry: toAddress?.country || 'US',
          destinationState: toAddress?.state_code || toAddress?.state,
          pickupToWarehouseDays: daysBetween(timeline.pickupTime, timeline.warehouseInTime),
          warehouseProcessDays: daysBetween(timeline.warehouseInTime, timeline.warehouseOutTime || timeline.departureTime),
          internationalTransitDays: daysBetween(timeline.departureTime || timeline.warehouseOutTime, timeline.arrivalTime),
          customsClearanceDays: daysBetween(timeline.arrivalTime, timeline.customsClearTime),
          lastMileDeliveryDays: daysBetween(timeline.customsClearTime || timeline.arrivalTime, timeline.deliveryTime),
          totalTransitDays: daysBetween(
            timeline.pickupTime || tracking.traces[0]?.time || null,
            timeline.deliveryTime
          ),
          createdAt: tracking.traces[0]?.time || Date.now(),
          deliveredAt: timeline.deliveryTime,
        };

        records.push(record);
      } catch (err) {
        // Skip individual shipment errors
        console.warn(`[TransitTime] Failed to get tracking for ${shipment.shipment_id}:`, err);
      }
    }
  } catch (err) {
    console.error('[TransitTime] Failed to analyze transit times:', err);
  }

  return records;
}

/**
 * 聚合统计：按渠道/目的国计算平均时效
 */
export function aggregateTransitStats(records: TransitTimeRecord[]): TransitTimeStats[] {
  // Group by service + country
  const groups = new Map<string, TransitTimeRecord[]>();
  
  for (const record of records) {
    if (record.totalTransitDays === null) continue;
    const key = `${record.service}|${record.destinationCountry}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(record);
  }

  const stats: TransitTimeStats[] = [];

  for (const [key, group] of Array.from(groups.entries())) {
    const [service, country] = key.split('|');
    if (group.length === 0) continue;

    // Calculate statistics
    const totalDays = group.map((r: TransitTimeRecord) => r.totalTransitDays!).sort((a: number, b: number) => a - b);
    const avg = (arr: (number | null)[]): number => {
      const valid = arr.filter((v): v is number => v !== null);
      return valid.length > 0 ? Math.round(valid.reduce((s: number, v: number) => s + v, 0) / valid.length) : 0;
    };
    const percentile = (arr: number[], p: number): number => {
      const idx = Math.ceil(arr.length * p / 100) - 1;
      return arr[Math.max(0, idx)];
    };

    const avgPickup = avg(group.map((r: TransitTimeRecord) => r.pickupToWarehouseDays));
    const avgWarehouse = avg(group.map((r: TransitTimeRecord) => r.warehouseProcessDays));
    const avgIntl = avg(group.map((r: TransitTimeRecord) => r.internationalTransitDays));
    const avgCustoms = avg(group.map((r: TransitTimeRecord) => r.customsClearanceDays));
    const avgLastMile = avg(group.map((r: TransitTimeRecord) => r.lastMileDeliveryDays));
    const avgTotal = avg(group.map((r: TransitTimeRecord) => r.totalTransitDays));

    // Map to 9-step process
    const mappedStepDays: MappedStepDays = {
      step1_preparing: 3,           // 默认值：准备阶段
      step2_purchasing: 14,         // 默认值：采购阶段
      step3_readyToShip: 2,         // 默认值：准备寄出
      step4_shipped: avgPickup || 1,                    // NextSLS: 揽收→到仓
      step5_domesticTransit: Math.max(1, Math.ceil((avgWarehouse || 2) / 2)),  // NextSLS: 仓库处理前半
      step6_arrivedWarehouse: Math.max(1, Math.ceil((avgWarehouse || 2) / 2)), // NextSLS: 仓库处理后半
      step7_internationalTransit: (avgIntl || 20) + (avgCustoms || 3),         // NextSLS: 国际运输+清关
      step8_receiving: avgLastMile || 5,                // NextSLS: 末端派送
      step9_arrivedAmazon: 2,       // 默认值：最终确认
      totalDays: 0,
    };
    mappedStepDays.totalDays = Object.values(mappedStepDays).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0) - mappedStepDays.totalDays;

    const confidence: 'high' | 'medium' | 'low' = 
      group.length >= 10 ? 'high' : group.length >= 5 ? 'medium' : 'low';

    stats.push({
      service,
      destinationCountry: country,
      sampleCount: group.length,
      avgTotalDays: avgTotal,
      minTotalDays: totalDays[0],
      maxTotalDays: totalDays[totalDays.length - 1],
      medianTotalDays: totalDays[Math.floor(totalDays.length / 2)],
      p90TotalDays: percentile(totalDays, 90),
      avgPickupToWarehouse: avgPickup,
      avgWarehouseProcess: avgWarehouse,
      avgInternationalTransit: avgIntl,
      avgCustomsClearance: avgCustoms,
      avgLastMileDelivery: avgLastMile,
      mappedStepDays,
      lastUpdated: Date.now(),
      confidence,
    });
  }

  // Sort by sample count descending
  stats.sort((a, b) => b.sampleCount - a.sampleCount);
  return stats;
}

/**
 * 获取物流时效统计（带缓存）
 */
export async function getTransitTimeStats(options?: {
  service?: string;
  country?: string;
  forceRefresh?: boolean;
}): Promise<TransitTimeStats[]> {
  const cacheKey = `${options?.service || 'all'}|${options?.country || 'all'}`;
  
  // Check cache
  if (!options?.forceRefresh) {
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.stats;
    }
  }

  // Fetch and analyze
  const records = await analyzeTransitTimes({
    service: options?.service,
  });
  
  let stats = aggregateTransitStats(records);
  
  // Filter by country if specified
  if (options?.country) {
    stats = stats.filter(s => s.destinationCountry === options.country);
  }

  // Update cache
  statsCache.set(cacheKey, { stats, timestamp: Date.now() });
  
  return stats;
}

/**
 * 获取指定渠道/目的国的映射步骤天数（供补货引擎调用）
 * 这是库存预警模块的核心接口
 */
export async function getMappedStepDaysForRoute(
  service?: string,
  destinationCountry: string = 'US',
): Promise<MappedStepDays | null> {
  const stats = await getTransitTimeStats({ service, country: destinationCountry });
  
  if (stats.length === 0) return null;
  
  // If specific service matched, use it; otherwise use the one with most samples
  const matched = service 
    ? stats.find(s => s.service === service) 
    : stats[0];
  
  return matched?.mappedStepDays || null;
}

/**
 * 获取所有可用渠道的时效概览（用于前端展示）
 */
export async function getTransitTimeOverview(): Promise<{
  totalShipments: number;
  channels: { service: string; country: string; avgDays: number; sampleCount: number; confidence: string }[];
  lastUpdated: number;
  isNextSlsConfigured: boolean;
}> {
  const isConfigured = nextSlsAdapter.isReady();
  
  if (!isConfigured) {
    return {
      totalShipments: 0,
      channels: [],
      lastUpdated: Date.now(),
      isNextSlsConfigured: false,
    };
  }

  const stats = await getTransitTimeStats();
  
  return {
    totalShipments: stats.reduce((s, st) => s + st.sampleCount, 0),
    channels: stats.map(s => ({
      service: s.service,
      country: s.destinationCountry,
      avgDays: s.avgTotalDays,
      sampleCount: s.sampleCount,
      confidence: s.confidence,
    })),
    lastUpdated: Date.now(),
    isNextSlsConfigured: true,
  };
}

/**
 * 清除缓存（配置变更时调用）
 */
export function clearTransitTimeCache() {
  statsCache.clear();
}
