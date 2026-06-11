/**
 * NextSLS (知己云星管家) 物流API v5 Adapter Layer
 *
 * 功能：
 * 1. Bearer Token 鉴权
 * 2. 统一请求封装（重试/超时/响应解析）
 * 3. API调用日志
 * 4. 配置管理（从DB加载/更新）
 */

// ============== Types ==============

export interface NextSlsConfig {
  baseUrl: string;      // e.g. https://zjyxgj.nextsls.com
  token: string;        // Bearer access token
  enabled: boolean;
}

export interface NextSlsResponse<T = any> {
  status: number;       // 1=success, 0=failure
  info: string;
  time?: number;
  data?: T;
}

export interface NextSlsRequestOptions {
  path: string;
  body?: Record<string, any>;
  timeout?: number;
}

// ─── Shipment Types ───

export interface NextSlsAddress {
  name: string;
  company?: string;
  tel?: string;
  mobile?: string;
  address_1: string;
  address_2?: string;
  address_3?: string;
  city: string;
  state?: string;
  state_code?: string;
  country: string;
  postcode: string;
  email?: string;
  ext?: { identity_card_no?: string };
}

export interface NextSlsDeclaration {
  sku?: string;
  name_zh: string;
  name_en: string;
  unit_value?: number;
  qty?: number;
  material?: string;
  usage?: string;
  brand?: string;
  brand_type?: string;
  model?: string;
  sale_price?: number;
  purchase_price?: number;
  sale_url?: string;
  asin?: string;
  fnsku?: string;
  weight?: number;
  size?: string;
  photo_url?: string;
  hscode?: string | number;
  duty_rate?: number;
  origin?: string;
  photos?: string;
  is_battery?: number;
  is_magnetic?: number;
  battery_label?: string;
  battery_description?: string;
  title?: string;
  description?: string;
  platform?: string;
  amazon_ref_id?: string;
  unit?: string;
}

export interface NextSlsParcel {
  number: string | number;
  reference?: string;
  client_weight?: number;
  client_length?: number;
  client_width?: number;
  client_height?: number;
  declarations: NextSlsDeclaration[];
}

export interface NextSlsCreateShipmentInput {
  service: string;
  store_id?: string;
  client_reference?: string;
  reference_1?: string;
  reference_2?: string;
  parcel_count: number;
  taxwith?: number;
  deliverywith?: string;
  exportwith?: number;
  importwith?: number;
  attrs?: string[];
  vat_number?: string;
  ioss?: string;
  expected_arrived_time?: number | string;
  eori?: string;
  cod_amount?: string;
  cod_currency?: string;
  declaration_currency?: string;
  amazon_ref_id?: string;
  to_warehouse_code?: string;
  to_address: NextSlsAddress;
  from_address?: NextSlsAddress;
  parcels: NextSlsParcel[];
  signature?: number;
  depot?: string;
  remark?: string;
}

export interface NextSlsService {
  code: string;
  name: string;
  type: string;
  volume_weight_radix?: string;
  label_code?: string;
}

export interface NextSlsAccount {
  name: string;
  currency: string;
  balance: string;
  arrears: string;
}

export interface NextSlsTraceItem {
  info: string;
  time: number;
  location?: string;
}

export interface NextSlsShipmentListItem {
  shipment_id: string;
  store_id?: string;
  service?: string;
  client_reference?: string;
  status: string;
  parcel_count: number;
  attrs?: string[];
  to_address?: NextSlsAddress;
  parcels?: any[];
  remark?: string;
  created?: string;
  def_fields_1?: string;
  def_fields_2?: string;
  def_fields_3?: string;
  def_fields_4?: string;
  def_fields_5?: string;
}

export interface NextSlsChargeItem {
  invoice_time: number;
  charge_type: string;
  currency: string;
  charge: string;
  unit: string;
  unit_price: string;
}

// ─── API Call Log ───

export interface NextSlsApiLog {
  timestamp: number;
  endpoint: string;
  status: "success" | "error";
  responseCode?: number;
  responseInfo?: string;
  latencyMs: number;
}

// ============== Adapter Class ==============

class NextSlsAdapter {
  private config: NextSlsConfig = {
    baseUrl: "",
    token: "",
    enabled: false,
  };

  private apiLogs: NextSlsApiLog[] = [];
  private readonly MAX_LOGS = 100;

  // ─── Configuration ───

  configure(config: Partial<NextSlsConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): NextSlsConfig & { isConfigured: boolean } {
    return {
      ...this.config,
      token: this.config.token ? "••••••••" : "",
      isConfigured: !!(this.config.baseUrl && this.config.token),
    };
  }

  getFullConfig(): NextSlsConfig {
    return { ...this.config };
  }

  isReady(): boolean {
    return this.config.enabled && !!this.config.baseUrl && !!this.config.token;
  }

  // ─── API Logs ───

  getApiLogs(limit = 20): NextSlsApiLog[] {
    return this.apiLogs.slice(-limit).reverse();
  }

  private addLog(log: NextSlsApiLog) {
    this.apiLogs.push(log);
    if (this.apiLogs.length > this.MAX_LOGS) {
      this.apiLogs = this.apiLogs.slice(-this.MAX_LOGS);
    }
  }

  // ─── Core Request ───

  private async request<T = any>(options: NextSlsRequestOptions): Promise<NextSlsResponse<T>> {
    const { path, body = {}, timeout = 30000 } = options;
    const url = `${this.config.baseUrl}${path}`;
    const startTime = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Language": "zh-CN",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      const data = await response.json() as NextSlsResponse<T>;

      this.addLog({
        timestamp: Date.now(),
        endpoint: path.replace("/api/v5/shipment/", "").replace("/api/v5/user/", ""),
        status: data.status === 1 ? "success" : "error",
        responseCode: data.status,
        responseInfo: data.info,
        latencyMs,
      });

      return data;
    } catch (err: any) {
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      this.addLog({
        timestamp: Date.now(),
        endpoint: path.replace("/api/v5/shipment/", "").replace("/api/v5/user/", ""),
        status: "error",
        responseInfo: err.message || "Request failed",
        latencyMs,
      });
      throw new Error(`NextSLS API error: ${err.message}`);
    }
  }

  // ─── API Methods ───

  /** Test connection by fetching account balance */
  async testConnection(): Promise<{ success: boolean; message: string; data?: any }> {
    if (!this.config.baseUrl || !this.config.token) {
      return { success: false, message: "未配置API地址或Token" };
    }
    try {
      const res = await this.request({ path: "/api/v5/shipment/get_account", body: {} });
      if (res.status === 1) {
        return { success: true, message: "连接成功", data: res.data };
      }
      return { success: false, message: res.info || "连接失败" };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /** 10. Get available services */
  async getServices(type: "all" | "b2b" | "b2c" | "ex" = "all"): Promise<NextSlsService[]> {
    const res = await this.request<{ services: NextSlsService[] }>({
      path: "/api/v5/shipment/get_services",
      body: { services: { type } },
    });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.services || [];
  }

  /** 11. Get account balance */
  async getAccountBalance(): Promise<NextSlsAccount[]> {
    const res = await this.request<{ account: NextSlsAccount[] }>({
      path: "/api/v5/shipment/get_account",
      body: {},
    });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.account || [];
  }

  /** 2. Create shipment */
  async createShipment(shipment: NextSlsCreateShipmentInput): Promise<{ shipment_id: string; relabel?: number; parcels?: any[] }> {
    const res = await this.request<{ shipment: any }>({
      path: "/api/v5/shipment/create",
      body: { shipment },
      timeout: 60000,
    });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment;
  }

  /** 3. Get labels */
  async getLabels(shipmentId?: string, clientReference?: string): Promise<any> {
    const body: any = { shipment: {} };
    if (shipmentId) body.shipment.shipment_id = shipmentId;
    if (clientReference) body.shipment.client_reference = clientReference;
    const res = await this.request({ path: "/api/v5/shipment/get_labels", body });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment;
  }

  /** 4. Get tracking numbers */
  async getTrackingNumbers(shipmentId?: string, clientReference?: string): Promise<any> {
    const body: any = { shipment: {} };
    if (shipmentId) body.shipment.shipment_id = shipmentId;
    if (clientReference) body.shipment.client_reference = clientReference;
    const res = await this.request({ path: "/api/v5/shipment/get_tracking_numbers", body });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment;
  }

  /** 5. Cancel shipment */
  async cancelShipment(shipmentId?: string, clientReference?: string): Promise<any> {
    const body: any = { shipment: {} };
    if (shipmentId) body.shipment.shipment_id = shipmentId;
    if (clientReference) body.shipment.client_reference = clientReference;
    const res = await this.request({ path: "/api/v5/shipment/void", body });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment;
  }

  /** 6. Get tracking / route info */
  async getTracking(params: {
    shipment_id?: string;
    client_reference?: string;
    tracking_number?: string;
    parcel_number?: string;
    waybill_number?: string;
    language?: "zh" | "en";
  }): Promise<{ shipment_id: string; status: string; carrier_code: string; tracking_number: string; traces: NextSlsTraceItem[] }> {
    const res = await this.request({
      path: "/api/v5/shipment/get_tracking",
      body: { shipment: params },
    });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment;
  }

  /** 7. Update weight/dimensions */
  async updateWeight(shipmentId: string, parcels: { number: string; client_weight: string; client_length?: string; client_width?: string; client_height?: string }[], clientReference?: string): Promise<any> {
    const body: any = { shipment: { shipment_id: shipmentId, parcels } };
    if (clientReference) body.shipment.client_reference = clientReference;
    const res = await this.request({ path: "/api/v5/shipment/update_weight", body });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment;
  }

  /** 8. Update declarations */
  async updateDeclarations(shipmentId: string, parcels: any[], clientReference?: string): Promise<any> {
    const body: any = { shipment: { shipment_id: shipmentId, parcels } };
    if (clientReference) body.shipment.client_reference = clientReference;
    const res = await this.request({ path: "/api/v5/shipment/update_declarations", body });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment;
  }

  /** 9. Get shipment detail */
  async getShipment(shipmentId?: string, clientReference?: string): Promise<any> {
    const body: any = { shipment: {} };
    if (shipmentId) body.shipment.shipment_id = shipmentId;
    if (clientReference) body.shipment.client_reference = clientReference;
    const res = await this.request({ path: "/api/v5/shipment/get_shipment", body });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment;
  }

  /** 12. Get rate estimate */
  async getRate(shipment: NextSlsCreateShipmentInput): Promise<{ charge?: string; currency?: string; info?: string }> {
    const res = await this.request<{ charge?: string; currency?: string; info?: string }>({
      path: "/api/v5/shipment/get_rate",
      body: { shipment },
      timeout: 60000,
    });
    if (res.status !== 1) throw new Error(res.info);
    return res.data || {};
  }

  /** 13. Get address library */
  async getAddresses(params?: { code?: string; service?: string; page?: number; page_size?: number }): Promise<{ addresses: NextSlsAddress[]; pagination?: any }> {
    const res = await this.request<{ address: NextSlsAddress[]; pagination?: any }>({
      path: "/api/v5/shipment/address",
      body: { address: params || {} },
    });
    if (res.status !== 1) throw new Error(res.info);
    return { addresses: res.data?.address || [], pagination: res.data?.pagination };
  }

  /** 14. Get shipment list */
  async getShipmentList(params?: {
    shipment_id?: string;
    client_reference?: string;
    status?: string;
    start_created?: string;
    end_created?: string;
    start_updated?: string;
    end_updated?: string;
    page?: number;
    page_size?: number;
  }): Promise<NextSlsShipmentListItem[]> {
    const res = await this.request<{ shipment: NextSlsShipmentListItem[] }>({
      path: "/api/v5/shipment/list",
      body: { shipment: params || {} },
    });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.shipment || [];
  }

  /** 15. Get login URL */
  async getLoginUrl(): Promise<string> {
    const res = await this.request<{ url: string }>({
      path: "/api/v5/user/login_url",
      body: {},
    });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.url || "";
  }

  /** 16. Check remote postcode */
  async checkRemote(service: string, toAddress: NextSlsAddress): Promise<boolean> {
    const res = await this.request<{ remote: number }>({
      path: "/api/v5/shipment/check_remote",
      body: { shipment: { service, to_address: toAddress } },
    });
    if (res.status !== 1) throw new Error(res.info);
    return res.data?.remote === 1;
  }
}

// ============== Singleton ==============

export const nextSlsAdapter = new NextSlsAdapter();

// ============== DB Init Helper ==============

/**
 * Load NextSLS config from database on server startup
 */
export async function initNextSlsAdapterFromDb() {
  try {
    const { getDb } = await import("../db");
    const { systemSettings } = await import("../../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) return;

    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.category, "nextsls"));

    const settings: Record<string, string> = {};
    for (const row of rows) {
      if (row.settingValue) settings[row.settingKey] = row.settingValue;
    }

    if (settings["nextsls_base_url"] && settings["nextsls_token"]) {
      nextSlsAdapter.configure({
        baseUrl: settings["nextsls_base_url"],
        token: settings["nextsls_token"],
        enabled: settings["nextsls_enabled"] === "true",
      });
      console.log(`[NextSLS] Loaded config from DB: ${settings["nextsls_base_url"]} (enabled: ${settings["nextsls_enabled"] === "true"})`);
    }
  } catch (err) {
    console.warn("[NextSLS] Failed to load config from DB:", err);
  }
}
