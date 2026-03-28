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
 * 7. HTTP/HTTPS/SOCKS5 代理支持（解决IP白名单问题）
 */

import { createHash } from "crypto";
import CryptoJS from "crypto-js";
import { ENV } from "./_core/env";

// ============== Types ==============

export interface LingxingConfig {
  appId: string;
  appSecret: string;
  apiHost: string;
  useMock?: boolean;
}

export interface LingxingProxyConfig {
  enabled: boolean;
  protocol: string;  // http | https | socks5
  host: string;
  port: string;
  username?: string;
  password?: string;
  directUrl?: string; // Full proxy URL (takes priority)
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
  /** Meta info about data source, injected by adapter */
  _meta?: {
    source: 'real' | 'mock_mode' | 'mock_fallback';
    reason?: string; // e.g. "IP whitelist", "network error", "token expired"
  };
}

/**
 * Normalize Lingxing API response to internal format.
 * The real Lingxing API returns:
 *   { code: 0, message: "success", data: [...] }  (code is number, field is "message")
 * But our internal format uses:
 *   { code: "200", msg: "OK", data: [...] }  (code is string, field is "msg")
 * 
 * This function bridges the gap so all downstream code works consistently.
 */
function normalizeLingxingResponse<T = any>(raw: any): LingxingResponse<T> {
  // If already in our internal format (e.g., from mock data)
  if (typeof raw.code === 'string') {
    return raw as LingxingResponse<T>;
  }
  
  // Real Lingxing API format: code is number, message field
  const rawCode = raw.code;
  const rawMsg = raw.message || raw.msg || '';
  
  // Map Lingxing success code (0) to our internal "200"
  let normalizedCode: string;
  if (rawCode === 0) {
    normalizedCode = '200';
  } else {
    normalizedCode = String(rawCode);
  }
  
  return {
    code: normalizedCode,
    msg: rawMsg,
    data: raw.data,
    total: raw.total,
  };
}

export interface LingxingRequestOptions {
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, any>;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  timeout?: number;
  skipCache?: boolean;
  cacheKey?: string;
  cacheTTL?: number; // ms
}

// ============== Token Manager ==============

class TokenManager {
  private token: LingxingToken | null = null;
  private refreshPromise: Promise<LingxingToken> | null = null;

  constructor(
    private config: LingxingConfig,
    private getProxyUrl: () => string | null,
  ) {}

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
    const bodyStr = new URLSearchParams({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    }).toString();

    const proxyUrl = this.getProxyUrl();
    let json: LingxingResponse<{ access_token: string; refresh_token: string; expires_in: number }>;

    if (proxyUrl) {
      // Use native CONNECT tunnel for correct proxy IP
      const res = await fetchViaProxy(url, proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyStr,
        timeout: 15_000,
      });
      json = normalizeLingxingResponse(await res.json());
    } else {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyStr,
        signal: AbortSignal.timeout(15_000),
      });
      json = normalizeLingxingResponse(await res.json());
    }

    if (json.code !== "200" || !json.data?.access_token) {
      throw new Error(`Lingxing token fetch failed: ${json.msg} (code: ${json.code})`);
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

/**
 * Generate Lingxing API sign following the official 7-step algorithm:
 * 1. Parse business params JSON
 * 2. Add fixed params (access_token, app_key, timestamp)
 * 3. Sort all params by key ASCII order
 * 4. Concatenate as key1=value1&key2=value2 (skip empty values, keep null)
 * 5. MD5 hash (32-bit uppercase)
 * 6. AES/ECB/PKCS5Padding encrypt with AppId as key
 * 7. URL encode the result
 */
export function generateSign(
  appId: string,
  accessToken: string,
  timestamp: number,
  bodyParams: Record<string, any> = {},
): string {
  // Step 1: Flatten business params (objects/arrays → JSON.stringify, others → String)
  const allParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(bodyParams)) {
    if (value === undefined || value === '') continue; // skip empty
    if (typeof value === 'object' && value !== null) {
      allParams[key] = JSON.stringify(value);
    } else {
      allParams[key] = String(value);
    }
  }

  // Step 2: Add fixed params & remove sign/api_code
  allParams['access_token'] = accessToken;
  allParams['app_key'] = appId;
  allParams['timestamp'] = String(timestamp);
  delete allParams['sign'];
  delete allParams['api_code'];

  // Step 3: Sort by key ASCII
  const sortedKeys = Object.keys(allParams).sort();

  // Step 4: Concatenate key=value pairs (trim values)
  const parts: string[] = [];
  for (const k of sortedKeys) {
    const v = allParams[k];
    if (v !== '' && v !== undefined) {
      parts.push(`${k}=${String(v).trim()}`);
    }
  }
  const paramStr = parts.join('&');

  // Step 5: MD5 uppercase
  const md5Hash = createHash('md5').update(paramStr, 'utf8').digest('hex').toUpperCase();

  // Step 6: AES/ECB/PKCS5Padding with AppId as key
  // IMPORTANT: Must use crypto-js (not Node.js crypto) to match Lingxing's browser-based
  // CryptoJS behavior. CryptoJS handles non-standard key lengths (e.g., 12 bytes)
  // differently from Node.js crypto which requires exactly 16/24/32 bytes.
  const key = CryptoJS.enc.Utf8.parse(appId);
  const encrypted = CryptoJS.AES.encrypt(md5Hash, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  // Step 7: Return the base64 AES result
  // Note: URL encoding is handled by URLSearchParams when building the query string
  return encrypted.toString();
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
  usedProxy: boolean;
}

// ============== Proxy Helper ==============

/**
 * Build proxy URL from LingxingProxyConfig
 */
export function buildLingxingProxyUrl(proxy: LingxingProxyConfig): string | undefined {
  if (!proxy.enabled) return undefined;

  // Direct URL takes priority
  if (proxy.directUrl && proxy.directUrl.trim()) return proxy.directUrl.trim();

  // Build from components
  if (!proxy.host) return undefined;
  const protocol = proxy.protocol || "http";
  let url = `${protocol}://`;
  if (proxy.username && proxy.password) {
    url += `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`;
  }
  url += proxy.host;
  if (proxy.port) url += `:${proxy.port}`;
  return url;
}

/**
 * Parse a proxy URL into components
 */
function parseProxyUrl(proxyUrl: string): {
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
} {
  const url = new URL(proxyUrl);
  return {
    protocol: url.protocol.replace(':', ''),
    host: url.hostname,
    port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

/**
 * Create an HTTP agent from proxy URL (supports http/https/socks5)
 * For HTTP/HTTPS proxies, uses Node.js native CONNECT tunnel to ensure
 * the exit IP matches the proxy server IP (fixes https-proxy-agent bug).
 */
async function createProxyAgent(proxyUrl: string): Promise<any> {
  if (proxyUrl.startsWith("socks")) {
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    return new SocksProxyAgent(proxyUrl);
  } else {
    // Use tunnel-agent for correct CONNECT tunnel behavior
    const tunnel = await import("tunnel");
    const parsed = parseProxyUrl(proxyUrl);
    const proxyOpts: any = {
      host: parsed.host,
      port: parsed.port,
    };
    if (parsed.username && parsed.password) {
      proxyOpts.proxyAuth = `${parsed.username}:${parsed.password}`;
    }
    return tunnel.httpsOverHttp({ proxy: proxyOpts });
  }
}

/**
 * Make a proxied fetch request using Node.js native CONNECT tunnel.
 * This ensures the exit IP is the proxy server's IP, not a random IP
 * from the proxy provider's pool (which happens with https-proxy-agent).
 * 
 * Uses Node.js native https.request over the CONNECT socket so that
 * HTTP response parsing (chunked encoding, gzip, etc.) is handled
 * automatically by Node.js instead of manual string parsing.
 */
async function fetchViaProxy(
  targetUrl: string,
  proxyUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number } = {},
): Promise<{ status: number; ok: boolean; json: () => Promise<any>; text: () => Promise<string> }> {
  const http = await import("http");
  const https = await import("https");
  const tls = await import("tls");
  const proxy = parseProxyUrl(proxyUrl);
  const target = new URL(targetUrl);
  const isHttps = target.protocol === 'https:';
  const targetPort = target.port || (isHttps ? '443' : '80');
  const timeoutMs = options.timeout || 30_000;

  return new Promise((resolve, reject) => {
    const connectHeaders: Record<string, string> = {};
    if (proxy.username && proxy.password) {
      connectHeaders['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
    }

    const connectReq = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: connectHeaders,
    });

    const timer = setTimeout(() => {
      connectReq.destroy();
      reject(new Error(`Proxy CONNECT timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    connectReq.on('connect', (connectRes, socket) => {
      if (connectRes.statusCode !== 200) {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed: HTTP ${connectRes.statusCode}`));
        return;
      }

      // Build request headers
      const reqHeaders: Record<string, string> = {
        Host: target.hostname,
        ...(options.headers || {}),
      };
      if (options.body) {
        reqHeaders['Content-Length'] = String(Buffer.byteLength(options.body));
      }

      if (isHttps) {
        // For HTTPS: TLS-upgrade the CONNECT socket, then use http.request over it
        const tlsSocket = tls.connect({
          socket: socket as any,
          servername: target.hostname,
        }, () => {
          const req = http.request({
            hostname: target.hostname,
            port: String(targetPort),
            path: target.pathname + target.search,
            method: options.method || 'GET',
            headers: reqHeaders,
            createConnection: () => tlsSocket as any,
            timeout: timeoutMs,
          }, (res) => {
            clearTimeout(timer);
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const bodyStr = Buffer.concat(chunks).toString('utf-8');
              const status = res.statusCode || 0;
              resolve({
                status,
                ok: status >= 200 && status < 300,
                json: async () => JSON.parse(bodyStr),
                text: async () => bodyStr,
              });
            });
            res.on('error', (e) => reject(e));
          });

          req.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });

          if (options.body) {
            req.write(options.body);
          }
          req.end();
        });

        tlsSocket.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      } else {
        // For HTTP: use http.request with the CONNECT tunnel socket
        const req = http.request({
          hostname: target.hostname,
          port: parseInt(String(targetPort)),
          path: target.pathname + target.search,
          method: options.method || 'GET',
          headers: reqHeaders,
          createConnection: () => socket as any,
          timeout: timeoutMs,
        }, (res) => {
          clearTimeout(timer);
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const bodyStr = Buffer.concat(chunks).toString('utf-8');
            const status = res.statusCode || 0;
            resolve({
              status,
              ok: status >= 200 && status < 300,
              json: async () => JSON.parse(bodyStr),
              text: async () => bodyStr,
            });
          });
          res.on('error', (e) => reject(e));
        });

        req.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });

        if (options.body) {
          req.write(options.body);
        }
        req.end();
      }
    });

    connectReq.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });

    connectReq.end();
  });
}

// ============== Main Adapter ==============

class LingxingAdapter {
  private tokenManager: TokenManager;
  private cache = new SimpleCache();
  private rateLimiter = new RateLimiter();
  private callLogs: ApiCallLog[] = [];
  private maxLogs = 1000;
  private useMock: boolean;
  private proxyConfig: LingxingProxyConfig = {
    enabled: false,
    protocol: "http",
    host: "",
    port: "",
  };

  constructor(private config: LingxingConfig) {
    this.tokenManager = new TokenManager(config, () => this.getActiveProxyUrl());
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

  /** Update proxy configuration */
  updateProxyConfig(newProxy: Partial<LingxingProxyConfig>) {
    if (newProxy.enabled !== undefined) this.proxyConfig.enabled = newProxy.enabled;
    if (newProxy.protocol !== undefined) this.proxyConfig.protocol = newProxy.protocol;
    if (newProxy.host !== undefined) this.proxyConfig.host = newProxy.host;
    if (newProxy.port !== undefined) this.proxyConfig.port = newProxy.port;
    if (newProxy.username !== undefined) this.proxyConfig.username = newProxy.username;
    if (newProxy.password !== undefined) this.proxyConfig.password = newProxy.password;
    if (newProxy.directUrl !== undefined) this.proxyConfig.directUrl = newProxy.directUrl;
    // Invalidate token when proxy changes (new IP = new auth)
    this.tokenManager.invalidate();
    this.cache.clear();
    console.log(`[LingxingAdapter] Proxy config updated: enabled=${this.proxyConfig.enabled}, host=${this.proxyConfig.host || "(direct URL)"}`);
  }

  getProxyConfig(): LingxingProxyConfig {
    return { ...this.proxyConfig };
  }

  isProxyEnabled(): boolean {
    return this.proxyConfig.enabled && !!(this.proxyConfig.host || this.proxyConfig.directUrl);
  }

  /** Get active proxy URL (synchronous, for TokenManager) */
  private getActiveProxyUrl(): string | null {
    if (!this.isProxyEnabled()) return null;
    return buildLingxingProxyUrl(this.proxyConfig) || null;
  }

  /** Get proxy agent for fetch calls (legacy, used for SOCKS5 only) */
  private async getProxyAgent(): Promise<any> {
    if (!this.isProxyEnabled()) return null;
    const proxyUrl = buildLingxingProxyUrl(this.proxyConfig);
    if (!proxyUrl) return null;
    return createProxyAgent(proxyUrl);
  }

  /** Reload config from DB settings (called when user updates settings page) */
  updateConfig(newConfig: Partial<LingxingConfig>) {
    if (newConfig.appId !== undefined) this.config.appId = newConfig.appId;
    if (newConfig.appSecret !== undefined) this.config.appSecret = newConfig.appSecret;
    if (newConfig.apiHost !== undefined) this.config.apiHost = newConfig.apiHost;
    if (newConfig.useMock !== undefined) this.useMock = newConfig.useMock;
    // Reset token manager with new config
    this.tokenManager = new TokenManager(this.config, () => this.getActiveProxyUrl());
    this.cache.clear();
  }

  getConfig() {
    return {
      appId: this.config.appId || '',
      appSecret: this.config.appSecret ? '••••••••' : '',
      apiHost: this.config.apiHost,
      useMock: this.useMock,
      proxyEnabled: this.isProxyEnabled(),
    };
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
      mockResult._meta = { source: 'mock_mode', reason: '已启用模拟数据模式' };
      this.logCall(path, method, "200", 0, true, false);
      if (!skipCache) this.cache.set(effectiveCacheKey, mockResult, cacheTTL);
      return mockResult;
    }

    // Real API call
    const startTime = Date.now();
    await this.rateLimiter.acquire();
    const usingProxy = this.isProxyEnabled();

    try {
      const accessToken = await this.tokenManager.getToken();
      const timestamp = Math.floor(Date.now() / 1000);
      const sign = generateSign(this.config.appId, accessToken, timestamp, body);

      const queryParams = new URLSearchParams({
        access_token: accessToken,
        sign,
        timestamp: String(timestamp),
        app_key: this.config.appId,
        ...query,
      });

      const url = `${this.config.apiHost}${path}?${queryParams.toString()}`;
      const bodyStr = (method === "POST" && Object.keys(body).length > 0) ? JSON.stringify(body) : undefined;
      const proxyUrl = this.getActiveProxyUrl();

      let json: LingxingResponse<T>;

      // Merge custom headers (e.g., X-API-VERSION for ad APIs)
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      };

      if (proxyUrl && !proxyUrl.startsWith('socks')) {
        // Use native CONNECT tunnel for HTTP/HTTPS proxies (correct exit IP)
        const res = await fetchViaProxy(url, proxyUrl, {
          method,
          headers: requestHeaders,
          body: bodyStr,
          timeout,
        });
        const rawText = await res.text();
        console.log(`[LingxingAdapter] Proxy response for ${path}: status=${res.status}, bodyLen=${rawText.length}, preview=${rawText.substring(0, 200)}`);
        try {
          json = normalizeLingxingResponse(JSON.parse(rawText));
        } catch (parseErr: any) {
          console.error(`[LingxingAdapter] JSON parse error for ${path}: ${parseErr.message}, raw=${rawText.substring(0, 500)}`);
          throw new Error(`JSON parse error: ${parseErr.message}`);
        }
      } else {
        // Direct fetch or SOCKS5 proxy (uses agent)
        const fetchOptions: any = {
          method,
          headers: requestHeaders,
          signal: AbortSignal.timeout(timeout),
        };
        if (proxyUrl) {
          const agent = await this.getProxyAgent();
          if (agent) fetchOptions.agent = agent;
        }
        if (bodyStr) fetchOptions.body = bodyStr;
        const res = await fetch(url, fetchOptions);
        json = normalizeLingxingResponse(await res.json());
      }
      const duration = Date.now() - startTime;

      this.logCall(path, method, json.code, duration, false, usingProxy);

      // Handle token expiry
      if (json.code === "3001003" || json.code === "3001004") {
        this.tokenManager.invalidate();
        // Retry once
        return this.request(options);
      }

      // Handle IP whitelist error - throw error instead of falling back to mock
      if (json.code === "3001002") {
        const errMsg = usingProxy
          ? `IP not in whitelist (proxy IP). Check proxy or whitelist config.`
          : `IP not in whitelist. Configure a proxy with whitelisted IP.`;
        console.warn(`[LingxingAdapter] ${errMsg} path: ${path}`);
        this.logCall(path, method, json.code, duration, false, usingProxy, errMsg);
        // Do NOT fallback to mock - throw error so caller knows data is unavailable
        throw new Error(`[LingxingAPI] ${errMsg} (path: ${path})`);
      }

      if (!skipCache && json.code === "200") {
        this.cache.set(effectiveCacheKey, json, cacheTTL);
      }

      json._meta = { source: 'real' };
      return json;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      this.logCall(path, method, "ERROR", duration, false, usingProxy, err.message);

      // Do NOT fallback to mock on network errors - propagate error
      console.warn(`[LingxingAdapter] API error for ${path}: ${err.message}`);
      throw err;
    } finally {
      this.rateLimiter.release();
    }
  }

  private logCall(endpoint: string, method: string, statusCode: string, duration: number, isMock: boolean, usedProxy: boolean, error?: string) {
    if (this.callLogs.length >= this.maxLogs) {
      this.callLogs = this.callLogs.slice(-500);
    }
    this.callLogs.push({ endpoint, method, statusCode, duration, timestamp: Date.now(), isMock, usedProxy, error });
  }

  /**
   * Test connection to Lingxing API (used by settings page)
   * Returns detailed diagnostics
   */
  async testConnection(): Promise<{
    success: boolean;
    message: string;
    latency: number | null;
    ip?: string | null;
    sellerCount?: number;
    usedProxy: boolean;
  }> {
    const usingProxy = this.isProxyEnabled();

    // Step 1: Test proxy connectivity (if enabled)
    if (usingProxy) {
      try {
        const proxyUrl = buildLingxingProxyUrl(this.proxyConfig);
        if (!proxyUrl) {
          return { success: false, message: "代理配置不完整", latency: null, usedProxy: true };
        }
        // Use native CONNECT tunnel for accurate IP detection
        const ipRes = await fetchViaProxy("https://httpbin.org/ip", proxyUrl, { timeout: 10_000 });
        if (ipRes.ok) {
          const ipData = await ipRes.json() as { origin?: string };
          console.log(`[LingxingAdapter] Proxy IP (CONNECT tunnel): ${ipData.origin}`);
        }
      } catch (err: any) {
        return {
          success: false,
          message: `代理连接失败: ${err.message}`,
          latency: null,
          usedProxy: true,
        };
      }
    }

    // Step 2: Test Lingxing API
    try {
      const startTime = Date.now();
      // Invalidate token to force fresh auth
      this.tokenManager.invalidate();
      const res = await this.request({
        path: "/erp/sc/data/seller/lists",
        skipCache: true,
      });
      const latency = Date.now() - startTime;

      if (res.code === "200") {
        const count = Array.isArray(res.data) ? res.data.length : 0;
        return {
          success: true,
          message: `连接成功！获取到 ${count} 个卖家账号${usingProxy ? "（通过代理）" : ""}`,
          latency,
          sellerCount: count,
          usedProxy: usingProxy,
        };
      } else {
        return {
          success: false,
          message: `API返回错误: ${res.msg} (code: ${res.code})`,
          latency,
          usedProxy: usingProxy,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: `连接失败: ${err.message}`,
        latency: null,
        usedProxy: usingProxy,
      };
    }
  }

  /**
   * Test proxy only (check IP and connectivity)
   * Uses native CONNECT tunnel to ensure correct exit IP detection.
   */
  async testProxyOnly(): Promise<{
    success: boolean;
    message: string;
    latency: number | null;
    ip?: string | null;
  }> {
    if (!this.isProxyEnabled()) {
      return { success: false, message: "领星API代理未启用", latency: null };
    }

    const proxyUrl = buildLingxingProxyUrl(this.proxyConfig);
    if (!proxyUrl) {
      return { success: false, message: "代理配置不完整", latency: null };
    }

    try {
      const startTime = Date.now();
      // Use native CONNECT tunnel for accurate IP detection
      const res = await fetchViaProxy("https://httpbin.org/ip", proxyUrl, { timeout: 10_000 });
      const latency = Date.now() - startTime;

      if (res.ok) {
        const data = await res.json() as { origin?: string };
        return {
          success: true,
          message: `代理连接成功！出口IP: ${data.origin || "未知"}`,
          latency,
          ip: data.origin || null,
        };
      } else {
        return {
          success: false,
          message: `代理响应异常: HTTP ${res.status}`,
          latency,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: `代理连接失败: ${err.message}`,
        latency: null,
      };
    }
  }

  // ============== Mock Data ==============

  private getMockData<T>(path: string, body: Record<string, any>): LingxingResponse<T> {
    const mockMap: Record<string, () => any> = {
      // 基础数据 - 店铺列表
      "/erp/sc/data/seller/lists": () => mockSellerList(),
      // 基础数据 - 汇率
      "/erp/sc/data/exchange_rate": () => mockExchangeRates(),
      // FBA库存 (v2 API)
      "/erp/sc/data/fba/FbaStockLists": () => mockFbaInventory(body),
      "/erp/sc/routing/fba/fbaStock/fbaList": () => mockFbaInventory(body),
      "/erp/sc/data/fba_report/inventoryAge": () => mockFbaInventory(body),
      // 本地仓库存
      "/erp/sc/routing/storage/getLocalInventory": () => mockLocalInventory(body),
      // 补货建议
      "/erp/sc/routing/restocking/analysis/getSummaryList": () => mockReplenishmentData(body),
      // 利润报表
      "/bd/profit/report/open/report/msku/list": () => mockProfitList(body),
      "/bd/profit/report/open/report/asin/list": () => mockProfitDetail(body),
      // 广告数据 (小时数据 API)
      "/ph/openaps/newad/spAdvertiseHourData": () => mockProductAdReports(body),
      "/pb/openaps/newad/spCampaignHourData": () => mockAdCampaigns(body),
      "/pb/openapi/newad/spAdGroupHourData": () => mockAdGroups(body),
      "/pb/openapi/newad/spCampaigns": () => mockAdCampaigns(body),
      "/pb/openapi/newad/spCampaignReports": () => mockAdCampaigns(body),
      "/pb/openapi/newad/spProductAdReports": () => mockProductAdReports(body),
      "/pb/openapi/newad/spAdGroups": () => mockAdGroups(body),
      "/pb/openapi/newad/spKeywords": () => mockAdKeywords(body),
      "/pb/openapi/newad/queryWordReports": () => mockSearchTerms(body),
      // ASIN 360小时数据
      "/basicOpen/salesAnalysis/productPerformance/performanceTrendByHour": () => mockProfitDetail(body),
      // 产品列表
      "/erp/sc/routing/data/local_inventory/productList": () => mockMskuList(body),
      "/erp/sc/data/mws/listing": () => mockProductList(body),
      // 订单
      "/erp/sc/data/mws/orders": () => mockOrderList(body),
      // 财务
      "/erp/sc/data/finance/profitAndLoss": () => mockProfitAndLoss(body),
      // 采购模块
      "/erp/sc/routing/data/local_inventory/purchasePlanList": () => mockPurchasePlanList(body),
      "/erp/sc/routing/data/local_inventory/purchaseOrderList": () => mockPurchaseOrderList(body),
      // FBA发货单
      "/erp/sc/routing/storage/shipment/getInboundShipmentList": () => mockDeliveryOrderList(body),
      "/erp/sc/data/fba_report/shipmentList": () => mockDeliveryOrderDetail(body),
      // 头程物流
      "/erp/sc/data/local_inventory/channelList": () => mockLogisticsChannelList(),
      "/erp/sc/routing/tms/FirstVessel/addProviders": () => mockLogisticsProviderList(),
      // 收货单
      "/erp/sc/routing/wms/receipt/list": () => mockReceiptList(body),
      // 仓库库存明细
      "/erp/sc/routing/storage/warehouseInventory": () => mockWarehouseInventory(body),
      // FBA库存v2
      "/basicOpen/openapi/storage/fbaWarehouseDetail": () => mockFbaInventoryV2(body),
      // AWD库存
      "/erp/sc/routing/storage/awdInventory": () => mockAwdInventory(body),
      "/erp/sc/data/fba/awdStockLists": () => mockAwdInventory(body),
      // 本地仓库存明细
      "/erp/sc/data/inventory/getWarehouseStockDetail": () => mockLocalWarehouseDetail(body),
      // 补货建议图表
      "/erp/sc/data/fba/replenish/chart": () => mockReplenishChart(body),
      // 补货建议 - 未来销量预测
      "/erp/sc/data/replenish/salesForecast": () => mockSalesForecast(body),
      // DSP广告报告
      "/basicopen/dapReport/order/list": () => mockDspOrderReport(body),
      // 父ASIN利润报表
      "/bd/profit/report/open/report/parent/asin/list": () => mockParentAsinProfit(body),
      // 财务流水
      "/erp/finance/data/inventory/getInventoryStatementList": () => mockFinanceStatement(body),
      // SB广告活动小时数据
      "/pb/openaps/newad/sbCampaignHourData": () => mockSbCampaignHourData(body),
      // SD广告活动小时数据
      "/pb/openaps/newad/sdCampaignHourData": () => mockSdCampaignHourData(body),
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
  // If keyword/ASIN is provided, generate matching data
  const keyword = body.keyword || body.search || body.asin || '';
  const skus = ["SKU-A001", "SKU-A002", "SKU-B001", "SKU-B002", "SKU-C001", "SKU-C002", "SKU-D001", "SKU-D002", "SKU-E001", "SKU-E002"];
  const titles = [
    "无线蓝牙耳机 降噪版", "手机支架 桌面款", "USB-C数据线 1.5m", "便携充电宝 10000mAh",
    "硅胶手机壳 透明", "LED台灯 护眼款", "蓝牙音箱 防水版", "笔记本散热器",
    "车载手机支架 磁吸", "智能手表带 运动款"
  ];
  
  // If searching for a specific ASIN, generate matching inventory item first
  if (keyword && keyword.startsWith('B0')) {
    const dailySales = Math.floor(Math.random() * 30) + 5;
    const available = Math.floor(Math.random() * 500) + 50;
    items.push({
      seller_sku: `SKU-${keyword}`,
      asin: keyword,
      fnsku: `X00${keyword.slice(-4)}`,
      product_name: `Product ${keyword}`,
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
  // Use the ASIN from request body to generate matching mock data
  const requestAsin = body.asin || body.parentAsin || 'B0UNKNOWN';
  const revenue = +(Math.random() * 3000 + 500).toFixed(2);
  const cost = +(revenue * (0.25 + Math.random() * 0.15)).toFixed(2);
  const adSpend = +(revenue * (0.05 + Math.random() * 0.1)).toFixed(2);
  const fbaFee = +(revenue * (0.12 + Math.random() * 0.08)).toFixed(2);
  const referralFee = +(revenue * 0.15).toFixed(2);
  const storageFee = +(Math.random() * 20 + 2).toFixed(2);
  const profit = +(revenue - cost - adSpend - fbaFee - referralFee).toFixed(2);
  return [{
    seller_sku: `SKU-${requestAsin}`,
    product_name: `Product ${requestAsin}`,
    asin: requestAsin,
    parentAsin: requestAsin,
    revenue,
    totalFbaAndFbmAmount: revenue,
    platformIncome: revenue,
    product_cost: cost,
    cgPriceTotal: cost,
    ad_spend: adSpend,
    totalAdsCost: adSpend,
    fba_fee: fbaFee,
    totalFbaDeliveryFee: fbaFee,
    referral_fee: referralFee,
    platformFee: referralFee,
    storage_fee: storageFee,
    totalStorageFee: storageFee,
    other_fee: +(Math.random() * 30 + 5).toFixed(2),
    profit,
    grossProfit: profit,
    totalProfit: profit,
    profit_margin: +((profit / revenue) * 100).toFixed(1),
    units_sold: Math.floor(Math.random() * 200 + 20),
    totalFbaAndFbmQuantity: Math.floor(Math.random() * 200 + 20),
    totalSalesQuantity: Math.floor(Math.random() * 50 + 5),
    return_rate: +(Math.random() * 5 + 0.5).toFixed(1),
    cgTransportCostsTotal: +(Math.random() * 100 + 10).toFixed(2),
  }];
}

function mockProductAdReports(body: Record<string, any>) {
  // Generate product-level ad report data matching the requested ASIN
  const asin = body.asin || body.advertised_asin || 'B0UNKNOWN';
  const impressions = Math.floor(Math.random() * 30000 + 5000);
  const clicks = Math.floor(Math.random() * 300 + 50);
  const spend = +(Math.random() * 150 + 20).toFixed(2);
  const sales = +(Math.random() * 800 + 100).toFixed(2);
  const orders = Math.floor(Math.random() * 20 + 3);
  return [{
    asin,
    advertised_asin: asin,
    sku: `SKU-${asin}`,
    impressions,
    clicks,
    cost: spend,
    spend,
    sales,
    attributed_sales: sales,
    orders,
    attributed_orders: orders,
    acos: sales > 0 ? +(spend / sales * 100).toFixed(1) : 0,
    roas: spend > 0 ? +(sales / spend).toFixed(2) : 0,
    ctr: impressions > 0 ? +(clicks / impressions * 100).toFixed(2) : 0,
    cvr: clicks > 0 ? +(orders / clicks * 100).toFixed(1) : 0,
  }];
}

function mockAdCampaigns(body: Record<string, any>) {
  // Use ASIN from body context to make campaign names match product filtering
  const asin = body.asin || '';
  const campaigns = [
    { campaign_id: "C001", campaign_name: `SP - ${asin || '蓝牙耳机'} - 自动`, campaign_type: "SP", targeting_type: "auto", status: "enabled", daily_budget: 50 },
    { campaign_id: "C002", campaign_name: `SP - ${asin || '蓝牙耳机'} - 手动精准`, campaign_type: "SP", targeting_type: "manual", status: "enabled", daily_budget: 80 },
    { campaign_id: "C003", campaign_name: `SP - ${asin || '数据线'} - 自动`, campaign_type: "SP", targeting_type: "auto", status: "enabled", daily_budget: 30 },
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
    { group_id: "G001", group_name: "蓝牙耳机-核心词", campaign_id: "C002", status: "enabled", bid: 1.2, impressions: 15000, clicks: 200, spend: 240, sales: 800, acos: 30 },
    { group_id: "G002", group_name: "蓝牙耳机-长尾词", campaign_id: "C002", status: "enabled", bid: 0.8, impressions: 8000, clicks: 120, spend: 96, sales: 500, acos: 19.2 },
  ];
}

function mockAdKeywords(body: Record<string, any>) {
  return [
    { keyword_id: "K001", keyword: "bluetooth earbuds", match_type: "exact", bid: 1.5, impressions: 5000, clicks: 80, spend: 120, sales: 400, acos: 30, group_id: "G001" },
    { keyword_id: "K002", keyword: "wireless earphones", match_type: "phrase", bid: 1.2, impressions: 3000, clicks: 50, spend: 60, sales: 250, acos: 24, group_id: "G001" },
    { keyword_id: "K003", keyword: "noise cancelling earbuds", match_type: "broad", bid: 0.9, impressions: 8000, clicks: 100, spend: 90, sales: 350, acos: 25.7, group_id: "G002" },
  ];
}

function mockSearchTerms(body: Record<string, any>) {
  return [
    { search_term: "bluetooth earbuds with microphone", impressions: 2000, clicks: 40, spend: 48, sales: 200, orders: 5, acos: 24, keyword: "bluetooth earbuds" },
    { search_term: "wireless earbuds for iphone", impressions: 1500, clicks: 30, spend: 36, sales: 150, orders: 3, acos: 24, keyword: "wireless earphones" },
    { search_term: "best noise cancelling earbuds 2026", impressions: 3000, clicks: 60, spend: 54, sales: 300, orders: 8, acos: 18, keyword: "noise cancelling earbuds" },
    { search_term: "cheap bluetooth headphones", impressions: 5000, clicks: 80, spend: 64, sales: 100, orders: 2, acos: 64, keyword: "bluetooth earbuds" },
  ];
}

function mockMskuList(body: Record<string, any>) {
  return [
    { msku: "SKU-A001", asin: "B009000000", fnsku: "X001000", product_name: "无线蓝牙耳机 降噪版", status: "active", marketplace: "US", price: 29.99 },
    { msku: "SKU-A002", asin: "B009000001", fnsku: "X001001", product_name: "手机支架 桌面款", status: "active", marketplace: "US", price: 12.99 },
    { msku: "SKU-B001", asin: "B009000002", fnsku: "X001002", product_name: "USB-C数据线 1.5m", status: "active", marketplace: "US", price: 8.99 },
  ];
}

function mockProductList(body: Record<string, any>) {
  return [
    { product_id: 1, title: "无线蓝牙耳机 降噪版", asin: "B009000000", sku: "SKU-A001", brand: "TechPro", category: "Electronics", price: 29.99, status: "active" },
    { product_id: 2, title: "手机支架 桌面款", asin: "B009000001", sku: "SKU-A002", brand: "PhoneGear", category: "Cell Phone Accessories", price: 12.99, status: "active" },
  ];
}

function mockOrderList(body: Record<string, any>) {
  const orders = [];
  for (let i = 0; i < 20; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    orders.push({
      order_id: `111-${String(1000000 + i)}`,
      purchase_date: d.toISOString(),
      seller_sku: ["SKU-A001", "SKU-A002", "SKU-B001"][i % 3],
      quantity: Math.floor(Math.random() * 3) + 1,
      item_price: +(Math.random() * 30 + 8).toFixed(2),
      status: ["Shipped", "Pending", "Delivered"][i % 3],
      marketplace: "US",
    });
  }
  return orders;
}

function mockProfitAndLoss(body: Record<string, any>) {
  return {
    total_revenue: 125000,
    total_cost: 45000,
    total_ad_spend: 15000,
    total_fba_fee: 20000,
    total_referral_fee: 18750,
    total_other_fee: 5000,
    total_profit: 21250,
    profit_margin: 17.0,
  };
}

function mockPurchasePlanList(body: Record<string, any>) {
  return [
    { plan_id: "PP001", sku: "SKU-A001", product_name: "无线蓝牙耳机 降噪版", quantity: 500, status: "pending", created_at: "2026-03-01", supplier: "深圳科技有限公司" },
    { plan_id: "PP002", sku: "SKU-B001", product_name: "USB-C数据线 1.5m", quantity: 1000, status: "approved", created_at: "2026-03-05", supplier: "义乌电子配件厂" },
  ];
}

function mockPurchaseOrderList(body: Record<string, any>) {
  return [
    { po_id: "PO001", plan_id: "PP001", sku: "SKU-A001", quantity: 500, unit_price: 35.5, total: 17750, status: "shipped", supplier: "深圳科技有限公司", eta: "2026-03-20" },
    { po_id: "PO002", plan_id: "PP002", sku: "SKU-B001", quantity: 1000, unit_price: 3.2, total: 3200, status: "in_production", supplier: "义乌电子配件厂", eta: "2026-04-01" },
  ];
}

function mockDeliveryOrderList(body: Record<string, any>) {
  return [
    { delivery_id: "FBA001", shipment_id: "FBA15ABC123", status: "SHIPPED", destination: "PHX6", sku_count: 3, total_units: 500, created_at: "2026-03-10" },
    { delivery_id: "FBA002", shipment_id: "FBA15DEF456", status: "RECEIVING", destination: "ONT8", sku_count: 2, total_units: 300, created_at: "2026-03-12" },
  ];
}

function mockDeliveryOrderDetail(body: Record<string, any>) {
  return {
    delivery_id: body.delivery_id || "FBA001",
    shipment_id: "FBA15ABC123",
    status: "SHIPPED",
    destination: "PHX6",
    items: [
      { sku: "SKU-A001", fnsku: "X001000", quantity_shipped: 200, quantity_received: 0 },
      { sku: "SKU-A002", fnsku: "X001001", quantity_shipped: 150, quantity_received: 0 },
      { sku: "SKU-B001", fnsku: "X001002", quantity_shipped: 150, quantity_received: 0 },
    ],
  };
}

function mockLogisticsChannelList() {
  return [
    { channel_id: 1, channel_name: "海运整柜-美西", transport_type: "sea", avg_days: 25, cost_per_kg: 8.5 },
    { channel_id: 2, channel_name: "海运拼柜-美西", transport_type: "sea", avg_days: 30, cost_per_kg: 6.0 },
    { channel_id: 3, channel_name: "空运-美国", transport_type: "air", avg_days: 7, cost_per_kg: 35.0 },
    { channel_id: 4, channel_name: "快递-DHL", transport_type: "express", avg_days: 5, cost_per_kg: 55.0 },
    { channel_id: 5, channel_name: "海运-欧洲", transport_type: "sea", avg_days: 35, cost_per_kg: 9.0 },
  ];
}

function mockLogisticsProviderList() {
  return [
    { provider_id: 1, name: "递四方", contact: "张经理", phone: "13800138001", services: ["sea", "air"] },
    { provider_id: 2, name: "纵腾集团", contact: "李经理", phone: "13800138002", services: ["sea", "express"] },
    { provider_id: 3, name: "燕文物流", contact: "王经理", phone: "13800138003", services: ["air", "express"] },
  ];
}

function mockReceiptList(body: Record<string, any>) {
  return [
    { receipt_id: "R001", po_id: "PO001", warehouse: "深圳仓", status: "completed", received_qty: 500, expected_qty: 500, received_at: "2026-03-18" },
    { receipt_id: "R002", po_id: "PO002", warehouse: "义乌仓", status: "partial", received_qty: 800, expected_qty: 1000, received_at: "2026-03-20" },
  ];
}

function mockWarehouseInventory(body: Record<string, any>) {
  return [
    { sku: "SKU-A001", warehouse: "深圳仓", total: 1800, available: 1500, reserved: 200, damaged: 100, in_transit: 500 },
    { sku: "SKU-B001", warehouse: "义乌仓", total: 2800, available: 2500, reserved: 200, damaged: 100, in_transit: 1000 },
  ];
}

function mockFbaInventoryV2(body: Record<string, any>) {
  return mockFbaInventory(body).map(item => ({
    ...item,
    sellable: item.afn_fulfillable_quantity,
    unsellable: item.afn_unsellable_quantity,
    reserved: item.afn_reserved_quantity,
    inbound: item.afn_inbound_shipped_quantity + item.afn_inbound_working_quantity,
  }));
}

function mockAwdInventory(body: Record<string, any>) {
  const skus = ["SKU-A001", "SKU-B001", "SKU-C001", "SKU-D001", "SKU-E001"];
  return skus.map((sku, i) => ({
    sku,
    asin: `B0${String(1000 + i).padStart(7, '0')}`,
    product_name: `产品${String.fromCharCode(65 + i)} - 美国站`,
    awd_quantity: Math.floor(Math.random() * 800 + 100),
    awd_warehouse: `AWD-US-${i + 1}`,
    awd_inbound_quantity: Math.floor(Math.random() * 200),
    awd_reserved_quantity: Math.floor(Math.random() * 50),
    status: ["available", "in_transit", "processing"][i % 3],
    last_updated: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString().split('T')[0],
  }));
}

function mockLocalWarehouseDetail(body: Record<string, any>) {
  const skus = ["SKU-A001", "SKU-B001", "SKU-C001", "SKU-D001"];
  return skus.map((sku, i) => ({
    sku,
    asin: `B0${String(1000 + i).padStart(7, '0')}`,
    product_name: `产品${String.fromCharCode(65 + i)}`,
    warehouse_name: ["深圳仓", "义乌仓", "广州仓", "上海仓"][i % 4],
    available_qty: Math.floor(Math.random() * 500 + 50),
    reserved_qty: Math.floor(Math.random() * 100),
    defective_qty: Math.floor(Math.random() * 20),
    total_qty: 0,
    batch_no: `BATCH-2026${String(i + 1).padStart(4, '0')}`,
    unit_cost: +(Math.random() * 50 + 10).toFixed(2),
    total_value: 0,
  })).map(item => ({ ...item, total_qty: item.available_qty + item.reserved_qty + item.defective_qty, total_value: +(item.total_qty * item.unit_cost).toFixed(2) }));
}

function mockReplenishChart(body: Record<string, any>) {
  const days = 60;
  const data = [];
  let stock = Math.floor(Math.random() * 500 + 200);
  const dailySales = Math.floor(Math.random() * 15 + 5);
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() + i * 86400000).toISOString().split('T')[0];
    stock = Math.max(0, stock - dailySales + (i === 20 ? 300 : 0) + (i === 40 ? 200 : 0));
    data.push({
      date,
      projected_stock: stock,
      safety_stock: dailySales * 14,
      reorder_point: dailySales * 21,
      daily_sales_forecast: dailySales + Math.floor(Math.random() * 5 - 2),
    });
  }
  return { chart_data: data, restock_events: [
    { date: data[20]?.date, qty: 300, method: "海运" },
    { date: data[40]?.date, qty: 200, method: "空运" },
  ]};
}

function mockSalesForecast(body: Record<string, any>) {
  const forecasts = [];
  for (let i = 1; i <= 10; i++) {
    const dailySales = +(Math.random() * 30 + 5).toFixed(1);
    forecasts.push({
      sku: body.sku || `SKU-${String(i).padStart(3, '0')}`,
      asin: body.asin || `B0${String(Math.random()).slice(2, 10)}`,
      store_name: 'Ace Select US',
      daily_sales_7d: +(dailySales * (0.9 + Math.random() * 0.2)).toFixed(1),
      daily_sales_30d: +dailySales.toFixed(1),
      forecast_7d: Math.floor(dailySales * 7 * (0.95 + Math.random() * 0.1)),
      forecast_14d: Math.floor(dailySales * 14 * (0.9 + Math.random() * 0.2)),
      forecast_30d: Math.floor(dailySales * 30 * (0.85 + Math.random() * 0.3)),
      forecast_60d: Math.floor(dailySales * 60 * (0.8 + Math.random() * 0.4)),
      trend: ['up', 'stable', 'down'][Math.floor(Math.random() * 3)],
      seasonality_factor: +(0.8 + Math.random() * 0.4).toFixed(2),
    });
  }
  return forecasts;
}

// ============== DSP / Profit / SB / SD Mock Data Generators ==============

function mockDspOrderReport(body: Record<string, any>) {
  const orders = [];
  const orderNames = [
    'Brand Awareness - Electronics', 'Retargeting - Earbuds', 'Audience - In-Market',
    'Competitor Conquest - Audio', 'Lifestyle - Fitness', 'Seasonal - Holiday',
    'Lookalike - High Value', 'Cross-sell - Accessories'
  ];
  for (let i = 0; i < orderNames.length; i++) {
    const budget = +(Math.random() * 5000 + 1000).toFixed(2);
    const spends = +(budget * (0.3 + Math.random() * 0.6)).toFixed(2);
    const impressions = Math.floor(Math.random() * 500000 + 50000);
    const viewableImpressions = Math.floor(impressions * (0.5 + Math.random() * 0.3));
    const clicks = Math.floor(impressions * (0.001 + Math.random() * 0.003));
    const dpv = Math.floor(clicks * (0.3 + Math.random() * 0.5));
    const addToCart = Math.floor(dpv * (0.1 + Math.random() * 0.2));
    const orderCount = Math.floor(addToCart * (0.3 + Math.random() * 0.4));
    const sales = +(orderCount * (15 + Math.random() * 50)).toFixed(2);
    orders.push({
      profile_id: `PF${1000 + i}`,
      order_id: `DSP-${2000 + i}`,
      order_name: orderNames[i],
      advertiser_id: `ADV-${100 + i}`,
      advertiser_name: 'TechPro Brand',
      order_budget: budget,
      spends, sales, orders: orderCount,
      impressions, viewable_impressions: viewableImpressions,
      clicks, dpv, total_add_to_cart: addToCart,
      ad_units: Math.floor(Math.random() * 5 + 1),
      start_date: '2026-03-01', end_date: '2026-03-31',
    });
  }
  return orders;
}

function mockParentAsinProfit(body: Record<string, any>) {
  const parentAsins = ['B009000000', 'B009100000', 'B009200000'];
  return parentAsins.map((pa, i) => ({
    parent_asin: pa,
    child_asin_count: Math.floor(Math.random() * 5 + 1),
    totalSalesAmount: +(Math.random() * 20000 + 5000).toFixed(2),
    totalSalesQuantity: Math.floor(Math.random() * 500 + 100),
    totalProfit: +(Math.random() * 5000 + 500).toFixed(2),
    profitRate: +(Math.random() * 30 + 5).toFixed(2),
    totalAdsCost: +(Math.random() * 3000 + 200).toFixed(2),
    totalFbaDeliveryFee: +(Math.random() * 2000 + 300).toFixed(2),
    totalStorageFee: +(Math.random() * 500 + 50).toFixed(2),
    totalCommission: +(Math.random() * 3000 + 500).toFixed(2),
    cgPriceTotal: +(Math.random() * 5000 + 1000).toFixed(2),
    cgTransportCostsTotal: +(Math.random() * 1500 + 200).toFixed(2),
    totalRefund: +(Math.random() * 500 + 50).toFixed(2),
  }));
}

function mockFinanceStatement(body: Record<string, any>) {
  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push({
      id: i + 1,
      batch_no: `BATCH-${2026}${String(i + 1).padStart(3, '0')}`,
      sku: `SKU-${['A', 'B', 'C', 'D'][i % 4]}001`,
      asin: `B00${9 + Math.floor(i / 5)}${String(i % 5).padStart(5, '0')}`,
      type: ['purchase', 'shipping', 'fba_fee', 'storage_fee', 'refund'][i % 5],
      amount: +(Math.random() * 2000 - 500).toFixed(2),
      currency: 'USD',
      description: ['采购入库', '头程运费', 'FBA配送费', '仓储费', '退款'][i % 5],
      created_at: new Date(Date.now() - i * 86400000 * 3).toISOString().slice(0, 10),
    });
  }
  return items;
}

function mockSbCampaignHourData(body: Record<string, any>) {
  const campaigns = [];
  const names = ['SB-Brand Video', 'SB-Store Spotlight', 'SB-Product Collection'];
  for (let i = 0; i < names.length; i++) {
    const impressions = Math.floor(Math.random() * 30000 + 5000);
    const clicks = Math.floor(impressions * (0.003 + Math.random() * 0.005));
    const cost = +(clicks * (0.5 + Math.random() * 1.5)).toFixed(2);
    const sales = +(cost * (1.5 + Math.random() * 3)).toFixed(2);
    const orders = Math.floor(sales / (20 + Math.random() * 30));
    campaigns.push({
      campaign_id: `SB-C${100 + i}`, campaign_name: names[i],
      impressions, clicks, cost, sales, orders,
      campaign_type: 'SB', status: 'enabled',
    });
  }
  return campaigns;
}

function mockSdCampaignHourData(body: Record<string, any>) {
  const campaigns = [];
  const names = ['SD-Product Targeting', 'SD-Audience Retargeting', 'SD-Views Remarketing'];
  for (let i = 0; i < names.length; i++) {
    const impressions = Math.floor(Math.random() * 50000 + 10000);
    const clicks = Math.floor(impressions * (0.002 + Math.random() * 0.004));
    const cost = +(clicks * (0.3 + Math.random() * 1.0)).toFixed(2);
    const sales = +(cost * (1.0 + Math.random() * 2.5)).toFixed(2);
    const orders = Math.floor(sales / (25 + Math.random() * 35));
    campaigns.push({
      campaign_id: `SD-C${200 + i}`, campaign_name: names[i],
      impressions, clicks, cost, sales, orders,
      campaign_type: 'SD', status: 'enabled',
    });
  }
  return campaigns;
}

// ============== Singleton Instance ==============

let adapterInstance: LingxingAdapter | null = null;

export function getLingxingAdapter(): LingxingAdapter {
  if (!adapterInstance) {
    const hasCredentials = !!(ENV.lingxingAppId && ENV.lingxingAppSecret);
    adapterInstance = new LingxingAdapter({
      appId: ENV.lingxingAppId,
      appSecret: ENV.lingxingAppSecret,
      apiHost: ENV.lingxingApiHost,
      // Default to mock only if no credentials are configured
      useMock: !hasCredentials,
    });
  }
  return adapterInstance;
}

/**
 * Initialize adapter from DB settings (called on server startup)
 */
export async function initLingxingAdapterFromDb(): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const { systemSettings } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) return;

    // Load lingxing config
    const lingxingRows = await db.select().from(systemSettings).where(
      eq(systemSettings.category, "lingxing")
    );
    const lxMap: Record<string, string | null> = {};
    for (const row of lingxingRows) {
      lxMap[row.settingKey] = row.settingValue;
    }

    const adapter = getLingxingAdapter();

    // Apply DB config if available
    if (lxMap["lingxing_app_id"] || lxMap["lingxing_app_secret"]) {
      adapter.updateConfig({
        appId: lxMap["lingxing_app_id"] || undefined,
        appSecret: lxMap["lingxing_app_secret"] || undefined,
        apiHost: lxMap["lingxing_api_host"] || undefined,
        useMock: lxMap["lingxing_use_mock"] === "true",
      });
    }

    // Load lingxing proxy config
    const proxyRows = await db.select().from(systemSettings).where(
      eq(systemSettings.category, "lingxing_proxy")
    );
    const pxMap: Record<string, string | null> = {};
    for (const row of proxyRows) {
      pxMap[row.settingKey] = row.settingValue;
    }

    if (pxMap["lx_proxy_enabled"] === "true") {
      adapter.updateProxyConfig({
        enabled: true,
        protocol: pxMap["lx_proxy_protocol"] || "http",
        host: pxMap["lx_proxy_host"] || "",
        port: pxMap["lx_proxy_port"] || "",
        username: pxMap["lx_proxy_username"] || undefined,
        password: pxMap["lx_proxy_password"] || undefined,
        directUrl: pxMap["lx_proxy_url"] || undefined,
      });
    }

    console.log(`[LingxingAdapter] Initialized from DB: mock=${adapter.isMockMode()}, proxy=${adapter.isProxyEnabled()}`);
  } catch (err: any) {
    console.warn(`[LingxingAdapter] Failed to init from DB: ${err.message}`);
  }
}

export { LingxingAdapter };
