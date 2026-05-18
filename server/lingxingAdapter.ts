/**
 * Lingxing API Adapter - DEPRECATED STUB
 * 
 * This module has been deprecated. All data is now imported via Excel uploads.
 * This stub file exists only to prevent import errors from files that still reference it.
 * All methods return safe defaults or mock data.
 */

function getMockData(path: string): any {
  if (path.includes("returnAnalysis")) {
    return { overall_return_rate: 0, total_returns: 0, total_orders: 0, by_asin: [], trend: [], reasons: [] };
  }
  if (path.includes("reviewReport")) {
    return { list: [], total: 0 };
  }
  if (path.includes("mail/lists")) {
    return { list: [], total: 0 };
  }
  if (path.includes("performance")) {
    return { list: [], total: 0 };
  }
  if (path.includes("competitor")) {
    return { list: [], price_history: [], review_history: [], bsr_history: [] };
  }
  return {};
}

class LingxingAdapterStub {
  async request(_opts: any): Promise<any> {
    return { code: "200", data: getMockData(_opts?.path || ""), _meta: { source: "stub", reason: "领星API已停用" } };
  }
  async requestWithMockFallback(_opts: any): Promise<any> {
    return { code: "200", data: getMockData(_opts?.path || ""), _meta: { source: "mock_fallback", reason: "领星API已停用，请使用Excel上传导入数据" } };
  }
  async proxyRequest(_path: string, _body: any): Promise<any> {
    return { code: "200", data: getMockData(_path || "") };
  }
  isReady(): boolean {
    return false;
  }
  isMockMode(): boolean {
    return true;
  }
  isProxyEnabled(): boolean {
    return false;
  }
  getRecentLogs(): any[] {
    return [];
  }
  setMockMode(_val: boolean): void {
    // no-op - lingxing API deprecated
  }
  getConfig(): any {
    return { appId: "", appSecret: "", apiHost: "", useMock: true };
  }
  updateConfig(_config: any): void {
    // no-op - lingxing API deprecated
  }
  async testConnection(): Promise<any> {
    return { success: false, message: "领星API已停用，请使用Excel上传导入数据" };
  }
  updateProxyConfig(_config: any): void {
    // no-op - lingxing API deprecated
  }
  async testProxyOnly(): Promise<any> {
    return { success: false, message: "领星API已停用" };
  }
}

const stubInstance = new LingxingAdapterStub();

export function getLingxingAdapter() {
  return stubInstance;
}

export function initLingxingAdapterFromDb() {
  console.log("[LingxingAdapter] DEPRECATED - Lingxing API integration has been removed. Data is now imported via Excel.");
}

export { LingxingAdapterStub as LingxingAdapter };
