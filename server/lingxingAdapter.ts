/**
 * 领星ERP开放API Adapter Layer
 * 
 * 功能：
 * 1. Token管理（获取/自动刷新/缓存）
 * 2. MD5签名生成
 * 3. 统一请求封装（QPS控制/重试/超时/响应解析）
 * 4. Mock数据模式（真实API不可用时自动降级）
 * 5. 数据缓存层（高频查询缓存）
 * 6. API调用日志
 */

import { createHash } from "crypto";
import { ENV } from "./_core/env";

// ============== Types ==============

export interface LingxingConfig {
  appId: string;
  appSecret: string;
  apiHost: string;
  useMock?: boolean;
}

export interface LingxingToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
}

export interface LingxingResponse<T = any> {
  code: string;
  msg: string;
  data: T;
  total?: number;
}

export interface LingxingRequestOptions {
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, any>;
  query?: Record<string, any>;
  timeout?: number;
  skipCache?: boolean;
  cacheKey?: string;
  cacheTTL?: number; // ms
}

// ============== Token Manager ==============

class TokenManager {
  private token: LingxingToken | null = null;
  private refreshPromise: Promise<LingxingToken> | null = null;

  constructor(private config: LingxingConfig) {}

  async getToken(): Promise<string> {
    // If we have a valid token with >60s remaining, use it
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.accessToken;
    }

    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      const t = await this.refreshPromise;
      return t.accessToken;
    }

    // Fetch new token
    this.refreshPromise = this.fetchToken();
    try {
      this.token = await this.refreshPromise;
      return this.token.accessToken;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async fetchToken(): Promise<LingxingToken> {
    const url = `${this.config.apiHost}/api/auth-server/oauth/access-token`;
    const body = new URLSearchParams({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const json = await res.json() as LingxingResponse<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>;

    if (json.code !== "200" || !json.data?.access_token) {
      throw new Error(`Lingxing token fetch failed: ${json.msg}`);
    }

    return {
      accessToken: json.data.access_token,
      refreshToken: json.data.refresh_token,
      expiresAt: Date.now() + json.data.expires_in * 1000,
    };
  }

  invalidate() {
    this.token = null;
  }
}

// ============== Signature Generator ==============

export function generateSign(appKey: string, timestamp: number, appSecret: string): string {
  const signStr = `${appKey}${timestamp}${appSecret}`;
  return createHash("md5").update(signStr).digest("hex");
}

// ============== Cache Layer ==============

interface CacheEntry {
  data: any;
  expiresAt: number;
}

class SimpleCache {
  private store = new Map<string, CacheEntry>();
  private maxSize = 500;

  get(key: string): any | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: any, ttlMs: number) {
    // Evict oldest entries if cache is full
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  clear() {
    this.store.clear();
  }
}

// ============== QPS Rate Limiter ==============

class RateLimiter {
  private queue: Array<{ resolve: () => void }> = [];
  private activeCount = 0;
  private maxConcurrent = 5; // Lingxing QPS limit
  private minInterval = 200; // ms between requests
  private lastRequestTime = 0;

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      const now = Date.now();
      const wait = Math.max(0, this.lastRequestTime + this.minInterval - now);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.lastRequestTime = Date.now();
      return;
    }

    return new Promise<void>(resolve => {
      this.queue.push({ resolve });
    });
  }

  release() {
    this.activeCount--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.activeCount++;
      this.lastRequestTime = Date.now();
      next.resolve();
    }
  }
}

// ============== API Call Logger ==============

export interface ApiCallLog {
  endpoint: string;
  method: string;
  statusCode: string;
  duration: number;
  timestamp: number;
  error?: string;
  isMock: boolean;
}

// ============== Main Adapter ==============

class LingxingAdapter {
  private tokenManager: TokenManager;
  private cache = new SimpleCache();
  private rateLimiter = new RateLimiter();
  private callLogs: ApiCallLog[] = [];
  private maxLogs = 1000;
  private useMock: boolean;

  constructor(private config: LingxingConfig) {
    this.tokenManager = new TokenManager(config);
    this.useMock = config.useMock ?? false;
  }

  setMockMode(enabled: boolean) {
    this.useMock = enabled;
  }

  isMockMode(): boolean {
    return this.useMock;
  }

  clearCache() {
    this.cache.clear();
  }

  getRecentLogs(limit = 50): ApiCallLog[] {
    return this.callLogs.slice(-limit);
  }

  /**
   * Make an API request to Lingxing
   */
  async request<T = any>(options: LingxingRequestOptions): Promise<LingxingResponse<T>> {
    const {
      path,
      method = "POST",
      body = {},
      query = {},
      timeout = 30_000,
      skipCache = false,
      cacheKey,
      cacheTTL = 5 * 60 * 1000, // 5 min default
    } = options;

    // Check cache first
    const effectiveCacheKey = cacheKey || `${path}:${JSON.stringify(body)}:${JSON.stringify(query)}`;
    if (!skipCache) {
      const cached = this.cache.get(effectiveCacheKey);
      if (cached) return cached;
    }

    // If mock mode, return mock data
    if (this.useMock) {
      const mockResult = this.getMockData<T>(path, body);
      this.logCall(path, method, "200", 0, true);
      if (!skipCache) this.cache.set(effectiveCacheKey, mockResult, cacheTTL);
      return mockResult;
    }

    // Real API call
    const startTime = Date.now();
    await this.rateLimiter.acquire();

    try {
      const accessToken = await this.tokenManager.getToken();
      const timestamp = Math.floor(Date.now() / 1000);
      const sign = generateSign(this.config.appId, timestamp, this.config.appSecret);

      const queryParams = new URLSearchParams({
        access_token: accessToken,
        sign,
        timestamp: String(timestamp),
        app_key: this.config.appId,
        ...query,
      });

      const url = `${this.config.apiHost}${path}?${queryParams.toString()}`;

      const fetchOptions: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeout),
      };

      if (method === "POST" && Object.keys(body).length > 0) {
        fetchOptions.body = JSON.stringify(body);
      }

      const res = await fetch(url, fetchOptions);
      const json = await res.json() as LingxingResponse<T>;
      const duration = Date.now() - startTime;

      this.logCall(path, method, json.code, duration, false);

      // Handle token expiry
      if (json.code === "3001003" || json.code === "3001004") {
        this.tokenManager.invalidate();
        // Retry once
        return this.request(options);
      }

      // Handle IP whitelist error - fallback to mock
      if (json.code === "3001002") {
        console.warn(`[LingxingAdapter] IP not in whitelist, falling back to mock mode for: ${path}`);
        this.logCall(path, method, json.code, duration, false, "IP not in whitelist");
        const mockResult = this.getMockData<T>(path, body);
        return mockResult;
      }

      if (!skipCache && json.code === "200") {
        this.cache.set(effectiveCacheKey, json, cacheTTL);
      }

      return json;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      this.logCall(path, method, "ERROR", duration, false, err.message);

      // Fallback to mock on network errors
      console.warn(`[LingxingAdapter] API error for ${path}, falling back to mock: ${err.message}`);
      return this.getMockData<T>(path, body);
    } finally {
      this.rateLimiter.release();
    }
  }

  private logCall(endpoint: string, method: string, statusCode: string, duration: number, isMock: boolean, error?: string) {
    if (this.callLogs.length >= this.maxLogs) {
      this.callLogs = this.callLogs.slice(-500);
    }
    this.callLogs.push({ endpoint, method, statusCode, duration, timestamp: Date.now(), error, isMock });
  }

  // ============== Mock Data ==============

  private getMockData<T>(path: string, body: Record<string, any>): LingxingResponse<T> {
    const mockMap: Record<string, () => any> = {
      // 基础数据 - 店铺列表
      "/erp/sc/data/seller/lists": () => mockSellerList(),
      // 基础数据 - 汇率
      "/erp/sc/data/exchange_rate": () => mockExchangeRates(),
      // FBA库存
      "/erp/sc/data/fba_report/inventoryAge": () => mockFbaInventory(body),
      "/erp/sc/routing/storage/fbaInventory": () => mockFbaInventory(body),
      // 本地仓库存
      "/erp/sc/routing/storage/getLocalInventory": () => mockLocalInventory(body),
      // 补货建议
      "/erp/sc/routing/storage/replenish/getReplenishmentData": () => mockReplenishmentData(body),
      // 利润报表
      "/erp/sc/data/profit/list": () => mockProfitList(body),
      "/erp/sc/data/profit/detail": () => mockProfitDetail(body),
      // 广告数据
      "/erp/sc/data/ad_manage/campaign/list": () => mockAdCampaigns(body),
      "/erp/sc/data/ad_manage/group/list": () => mockAdGroups(body),
      "/erp/sc/data/ad_manage/keyword/list": () => mockAdKeywords(body),
      "/erp/sc/data/ad_manage/searchTerm/list": () => mockSearchTerms(body),
      // 产品列表
      "/erp/sc/data/msku/list": () => mockMskuList(body),
      "/erp/sc/data/product/list": () => mockProductList(body),
      // 订单
      "/erp/sc/data/orders/list": () => mockOrderList(body),
      // 财务
      "/erp/sc/data/finance/profitAndLoss": () => mockProfitAndLoss(body),
    };

    const mockFn = mockMap[path];
    if (mockFn) {
      return { code: "200", msg: "OK (Mock)", data: mockFn() as T };
    }

    // Default empty mock
    return { code: "200", msg: "OK (Mock - no data)", data: [] as any };
  }
}

// ============== Mock Data Generators ==============

function mockSellerList() {
  return [
    { sid: 1, name: "US Store", marketplace: "US", marketplace_id: "ATVPDKIKX0DER", status: 1, region: "NA" },
    { sid: 2, name: "UK Store", marketplace: "UK", marketplace_id: "A1F83G8C2ARO7P", status: 1, region: "EU" },
    { sid: 3, name: "DE Store", marketplace: "DE", marketplace_id: "A1PA6795UKMFR9", status: 1, region: "EU" },
    { sid: 4, name: "JP Store", marketplace: "JP", marketplace_id: "A1VC38T7YXB528", status: 1, region: "FE" },
  ];
}

function mockExchangeRates() {
  return [
    { currency: "USD", rate: 1.0, target_currency: "CNY", target_rate: 7.24 },
    { currency: "GBP", rate: 1.0, target_currency: "CNY", target_rate: 9.18 },
    { currency: "EUR", rate: 1.0, target_currency: "CNY", target_rate: 7.89 },
    { currency: "JPY", rate: 100.0, target_currency: "CNY", target_rate: 4.82 },
  ];
}

function mockFbaInventory(body: Record<string, any>) {
  const items = [];
  const skus = ["SKU-A001", "SKU-A002", "SKU-B001", "SKU-B002", "SKU-C001", "SKU-C002", "SKU-D001", "SKU-D002", "SKU-E001", "SKU-E002"];
  const titles = [
    "无线蓝牙耳机 降噪版", "手机支架 桌面款", "USB-C数据线 1.5m", "便携充电宝 10000mAh",
    "硅胶手机壳 透明", "LED台灯 护眼款", "蓝牙音箱 防水版", "笔记本散热器",
    "车载手机支架 磁吸", "智能手表带 运动款"
  ];
  for (let i = 0; i < skus.length; i++) {
    const dailySales = Math.floor(Math.random() * 30) + 5;
    const available = Math.floor(Math.random() * 500) + 50;
    items.push({
      seller_sku: skus[i],
      asin: `B0${String(9000 + i).padStart(7, "0")}`,
      fnsku: `X00${String(1000 + i)}`,
      product_name: titles[i],
      afn_fulfillable_quantity: available,
      afn_inbound_working_quantity: Math.floor(Math.random() * 100),
      afn_inbound_shipped_quantity: Math.floor(Math.random() * 200),
      afn_reserved_quantity: Math.floor(Math.random() * 50),
      afn_unsellable_quantity: Math.floor(Math.random() * 10),
      avg_daily_sales_30d: dailySales,
      days_of_supply: Math.round(available / dailySales),
      inv_age_0_to_90: Math.floor(available * 0.4),
      inv_age_91_to_180: Math.floor(available * 0.3),
      inv_age_181_to_270: Math.floor(available * 0.2),
      inv_age_271_to_365: Math.floor(available * 0.1),
      inv_age_365_plus: Math.floor(Math.random() * 5),
      estimated_storage_fee: +(Math.random() * 50 + 5).toFixed(2),
      marketplace: "US",
    });
  }
  return items;
}

function mockLocalInventory(body: Record<string, any>) {
  return [
    { sku: "SKU-A001", warehouse: "深圳仓", quantity: 2000, available: 1800, reserved: 200, in_transit: 500 },
    { sku: "SKU-A002", warehouse: "深圳仓", quantity: 1500, available: 1200, reserved: 300, in_transit: 0 },
    { sku: "SKU-B001", warehouse: "义乌仓", quantity: 3000, available: 2800, reserved: 200, in_transit: 1000 },
    { sku: "SKU-C001", warehouse: "深圳仓", quantity: 800, available: 600, reserved: 200, in_transit: 0 },
  ];
}

function mockReplenishmentData(body: Record<string, any>) {
  return [
    { sku: "SKU-A001", product_name: "无线蓝牙耳机 降噪版", current_stock: 120, daily_sales: 15, days_of_supply: 8, suggested_qty: 300, urgency: "urgent", lead_time_days: 30 },
    { sku: "SKU-B001", product_name: "USB-C数据线 1.5m", current_stock: 450, daily_sales: 25, days_of_supply: 18, suggested_qty: 500, urgency: "normal", lead_time_days: 25 },
    { sku: "SKU-C001", product_name: "硅胶手机壳 透明", current_stock: 80, daily_sales: 20, days_of_supply: 4, suggested_qty: 600, urgency: "critical", lead_time_days: 20 },
    { sku: "SKU-D001", product_name: "蓝牙音箱 防水版", current_stock: 600, daily_sales: 10, days_of_supply: 60, suggested_qty: 0, urgency: "safe", lead_time_days: 35 },
    { sku: "SKU-E001", product_name: "车载手机支架 磁吸", current_stock: 200, daily_sales: 12, days_of_supply: 16, suggested_qty: 200, urgency: "normal", lead_time_days: 22 },
  ];
}

function mockProfitList(body: Record<string, any>) {
  const days = [];
  const baseDate = new Date("2026-03-01");
  for (let i = 0; i < 30; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + i);
    const revenue = +(Math.random() * 5000 + 2000).toFixed(2);
    const cost = +(revenue * (0.3 + Math.random() * 0.15)).toFixed(2);
    const adSpend = +(revenue * (0.08 + Math.random() * 0.07)).toFixed(2);
    const fbaFee = +(revenue * (0.15 + Math.random() * 0.05)).toFixed(2);
    const otherFee = +(revenue * (0.02 + Math.random() * 0.03)).toFixed(2);
    const profit = +(revenue - cost - adSpend - fbaFee - otherFee).toFixed(2);
    days.push({
      date: d.toISOString().split("T")[0],
      revenue,
      product_cost: cost,
      ad_spend: adSpend,
      fba_fee: fbaFee,
      referral_fee: +(revenue * 0.15).toFixed(2),
      other_fee: otherFee,
      profit,
      profit_margin: +((profit / revenue) * 100).toFixed(1),
      order_count: Math.floor(Math.random() * 100 + 30),
      unit_count: Math.floor(Math.random() * 150 + 50),
    });
  }
  return days;
}

function mockProfitDetail(body: Record<string, any>) {
  const skus = ["SKU-A001", "SKU-A002", "SKU-B001", "SKU-C001", "SKU-D001"];
  const titles = ["无线蓝牙耳机 降噪版", "手机支架 桌面款", "USB-C数据线 1.5m", "硅胶手机壳 透明", "蓝牙音箱 防水版"];
  return skus.map((sku, i) => {
    const revenue = +(Math.random() * 3000 + 500).toFixed(2);
    const cost = +(revenue * (0.25 + Math.random() * 0.15)).toFixed(2);
    const adSpend = +(revenue * (0.05 + Math.random() * 0.1)).toFixed(2);
    const fbaFee = +(revenue * (0.12 + Math.random() * 0.08)).toFixed(2);
    const profit = +(revenue - cost - adSpend - fbaFee).toFixed(2);
    return {
      seller_sku: sku,
      product_name: titles[i],
      asin: `B0${String(9000 + i).padStart(7, "0")}`,
      revenue,
      product_cost: cost,
      ad_spend: adSpend,
      fba_fee: fbaFee,
      referral_fee: +(revenue * 0.15).toFixed(2),
      storage_fee: +(Math.random() * 20 + 2).toFixed(2),
      other_fee: +(Math.random() * 30 + 5).toFixed(2),
      profit,
      profit_margin: +((profit / revenue) * 100).toFixed(1),
      units_sold: Math.floor(Math.random() * 200 + 20),
      return_rate: +(Math.random() * 5 + 0.5).toFixed(1),
    };
  });
}

function mockAdCampaigns(body: Record<string, any>) {
  const campaigns = [
    { campaign_id: "C001", campaign_name: "SP - 蓝牙耳机 - 自动", campaign_type: "SP", targeting_type: "auto", status: "enabled", daily_budget: 50 },
    { campaign_id: "C002", campaign_name: "SP - 蓝牙耳机 - 手动精准", campaign_type: "SP", targeting_type: "manual", status: "enabled", daily_budget: 80 },
    { campaign_id: "C003", campaign_name: "SP - 数据线 - 自动", campaign_type: "SP", targeting_type: "auto", status: "enabled", daily_budget: 30 },
    { campaign_id: "C004", campaign_name: "SB - 品牌推广", campaign_type: "SB", targeting_type: "manual", status: "enabled", daily_budget: 100 },
    { campaign_id: "C005", campaign_name: "SD - 再营销", campaign_type: "SD", targeting_type: "auto", status: "paused", daily_budget: 40 },
  ];
  return campaigns.map(c => ({
    ...c,
    impressions: Math.floor(Math.random() * 50000 + 5000),
    clicks: Math.floor(Math.random() * 500 + 50),
    spend: +(Math.random() * 200 + 20).toFixed(2),
    sales: +(Math.random() * 1000 + 100).toFixed(2),
    orders: Math.floor(Math.random() * 30 + 3),
    acos: +(Math.random() * 30 + 5).toFixed(1),
    roas: +(Math.random() * 5 + 1).toFixed(2),
    ctr: +(Math.random() * 2 + 0.1).toFixed(2),
    cvr: +(Math.random() * 15 + 2).toFixed(1),
    cpc: +(Math.random() * 1.5 + 0.2).toFixed(2),
  }));
}

function mockAdGroups(body: Record<string, any>) {
  return [
    { group_id: "G001", group_name: "蓝牙耳机-核心词", campaign_id: "C002", status: "enabled", default_bid: 1.2 },
    { group_id: "G002", group_name: "蓝牙耳机-长尾词", campaign_id: "C002", status: "enabled", default_bid: 0.8 },
    { group_id: "G003", group_name: "数据线-自动组", campaign_id: "C003", status: "enabled", default_bid: 0.5 },
  ].map(g => ({
    ...g,
    impressions: Math.floor(Math.random() * 20000 + 2000),
    clicks: Math.floor(Math.random() * 200 + 20),
    spend: +(Math.random() * 100 + 10).toFixed(2),
    sales: +(Math.random() * 500 + 50).toFixed(2),
    orders: Math.floor(Math.random() * 15 + 1),
    acos: +(Math.random() * 25 + 5).toFixed(1),
  }));
}

function mockAdKeywords(body: Record<string, any>) {
  const keywords = [
    "bluetooth earbuds", "wireless earphones", "noise cancelling earbuds",
    "bluetooth headphones", "earbuds wireless", "tws earbuds",
    "usb c cable", "type c charger", "fast charging cable",
    "phone case clear", "silicone phone case",
  ];
  return keywords.map((kw, i) => ({
    keyword_id: `KW${String(i + 1).padStart(3, "0")}`,
    keyword_text: kw,
    match_type: i % 3 === 0 ? "exact" : i % 3 === 1 ? "phrase" : "broad",
    bid: +(Math.random() * 2 + 0.3).toFixed(2),
    status: i < 9 ? "enabled" : "paused",
    impressions: Math.floor(Math.random() * 10000 + 500),
    clicks: Math.floor(Math.random() * 100 + 5),
    spend: +(Math.random() * 50 + 5).toFixed(2),
    sales: +(Math.random() * 300 + 20).toFixed(2),
    orders: Math.floor(Math.random() * 10 + 1),
    acos: +(Math.random() * 35 + 5).toFixed(1),
    ctr: +(Math.random() * 2 + 0.1).toFixed(2),
    cvr: +(Math.random() * 15 + 1).toFixed(1),
  }));
}

function mockSearchTerms(body: Record<string, any>) {
  const terms = [
    { term: "bluetooth earbuds noise cancelling", keyword: "bluetooth earbuds", match: "broad" },
    { term: "best wireless earphones 2026", keyword: "wireless earphones", match: "phrase" },
    { term: "cheap bluetooth headphones", keyword: "bluetooth headphones", match: "broad" },
    { term: "earbuds for running", keyword: "earbuds wireless", match: "broad" },
    { term: "usb c to usb c cable 6ft", keyword: "usb c cable", match: "phrase" },
    { term: "fast charging cable for samsung", keyword: "fast charging cable", match: "broad" },
    { term: "iphone 15 clear case", keyword: "phone case clear", match: "broad" },
    { term: "B09XXXXXX1", keyword: "bluetooth earbuds", match: "auto-asin" },
    { term: "B09XXXXXX2", keyword: "usb c cable", match: "auto-asin" },
    { term: "wireless earbuds with microphone", keyword: "wireless earphones", match: "broad" },
    { term: "anc earbuds under 50", keyword: "noise cancelling earbuds", match: "broad" },
    { term: "type c cable 3 pack", keyword: "type c charger", match: "phrase" },
  ];
  return terms.map((t, i) => ({
    search_term: t.term,
    keyword_text: t.keyword,
    match_type: t.match,
    impressions: Math.floor(Math.random() * 5000 + 200),
    clicks: Math.floor(Math.random() * 50 + 3),
    spend: +(Math.random() * 30 + 2).toFixed(2),
    sales: +(Math.random() * 200 + 10).toFixed(2),
    orders: Math.floor(Math.random() * 8),
    acos: +(Math.random() * 40 + 5).toFixed(1),
    ctr: +(Math.random() * 2 + 0.05).toFixed(2),
    cvr: +(Math.random() * 12 + 0.5).toFixed(1),
    is_asin_target: t.term.startsWith("B0"),
  }));
}

function mockMskuList(body: Record<string, any>) {
  return [
    { msku: "SKU-A001", asin: "B090000000", product_name: "无线蓝牙耳机 降噪版", price: 29.99, status: "active", marketplace: "US", category: "Electronics" },
    { msku: "SKU-A002", asin: "B090000001", product_name: "手机支架 桌面款", price: 12.99, status: "active", marketplace: "US", category: "Cell Phone Accessories" },
    { msku: "SKU-B001", asin: "B090000002", product_name: "USB-C数据线 1.5m", price: 8.99, status: "active", marketplace: "US", category: "Electronics" },
    { msku: "SKU-B002", asin: "B090000003", product_name: "便携充电宝 10000mAh", price: 19.99, status: "active", marketplace: "US", category: "Electronics" },
    { msku: "SKU-C001", asin: "B090000004", product_name: "硅胶手机壳 透明", price: 6.99, status: "active", marketplace: "US", category: "Cell Phone Accessories" },
  ];
}

function mockProductList(body: Record<string, any>) {
  return mockMskuList(body);
}

function mockOrderList(body: Record<string, any>) {
  const orders = [];
  for (let i = 0; i < 20; i++) {
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 30));
    orders.push({
      order_id: `111-${String(Math.floor(Math.random() * 9000000 + 1000000))}-${String(Math.floor(Math.random() * 9000000 + 1000000))}`,
      purchase_date: date.toISOString(),
      order_status: ["Shipped", "Pending", "Delivered"][Math.floor(Math.random() * 3)],
      seller_sku: ["SKU-A001", "SKU-A002", "SKU-B001", "SKU-C001"][Math.floor(Math.random() * 4)],
      quantity: Math.floor(Math.random() * 3) + 1,
      item_price: +(Math.random() * 30 + 5).toFixed(2),
      marketplace: "US",
    });
  }
  return orders;
}

function mockProfitAndLoss(body: Record<string, any>) {
  return {
    total_revenue: 156789.50,
    total_cost: 47036.85,
    total_ad_spend: 15678.95,
    total_fba_fee: 23518.43,
    total_referral_fee: 23518.43,
    total_other_fee: 4703.69,
    total_profit: 42333.15,
    profit_margin: 27.0,
    period: body.start_date ? `${body.start_date} ~ ${body.end_date}` : "2026-03",
  };
}

// ============== Singleton Instance ==============

let adapterInstance: LingxingAdapter | null = null;

export function getLingxingAdapter(): LingxingAdapter {
  if (!adapterInstance) {
    const hasCredentials = ENV.lingxingAppId && ENV.lingxingAppSecret;
    adapterInstance = new LingxingAdapter({
      appId: ENV.lingxingAppId,
      appSecret: ENV.lingxingAppSecret,
      apiHost: ENV.lingxingApiHost,
      // Start in mock mode if no credentials or for development
      useMock: !hasCredentials || true, // TODO: set to !hasCredentials when IP whitelist is stable
    });
  }
  return adapterInstance;
}

export { LingxingAdapter };
