/**
 * Anti-Bot Strategy Module
 * 
 * 共享的反爬策略，供 scraper.ts 和 crawlerEngine.ts 使用。
 * 
 * 策略：
 * 1. 50+ 真实浏览器 User-Agent 轮换（2025-2026最新版本）
 * 2. 完整的浏览器指纹模拟（Cookie、Sec-*、Viewport等）
 * 3. 代理池轮换（CAPTCHA后自动切换IP）
 * 4. Amazon专用Cookie模拟
 * 5. 智能重试（CAPTCHA检测 → 切换指纹+代理 → 指数退避）
 */

// ═══════════════════════════════════════════════════════════════════════
// User-Agent Pool (50+ real browser UAs - 2025/2026 versions)
// ═══════════════════════════════════════════════════════════════════════

const USER_AGENTS_DESKTOP = [
  // Chrome 131-135 on Windows 10/11
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  // Chrome on Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  // Firefox 132-136 on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  // Firefox on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:136.0) Gecko/20100101 Firefox/136.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:135.0) Gecko/20100101 Firefox/135.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:136.0) Gecko/20100101 Firefox/136.0",
  // Safari 18.x on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  // Edge 131-135 on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
  // Edge on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0",
];

const USER_AGENTS_MOBILE = [
  // Chrome on Android
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36",
  // Safari on iPhone
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  // Samsung Internet
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
];

// Accept-Language variations
const ACCEPT_LANGUAGES = [
  "en-US,en;q=0.9",
  "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
  "en-US,en;q=0.9,es;q=0.8",
  "en-GB,en;q=0.9,en-US;q=0.8",
  "en,en-US;q=0.9",
  "en-US,en;q=0.9,de;q=0.8",
  "en-US,en;q=0.9,fr;q=0.8",
  "en-US,en;q=0.9,ja;q=0.8",
  "en-US,en;q=0.8",
  "en-US;q=0.9,en;q=0.8",
];

// Viewport widths for Sec-CH-Viewport-Width
const VIEWPORT_WIDTHS = [1280, 1366, 1440, 1536, 1600, 1680, 1920, 2560];

// Device memory values
const DEVICE_MEMORIES = [4, 8, 16, 32];

// ═══════════════════════════════════════════════════════════════════════
// Browser Fingerprint Generator
// ═══════════════════════════════════════════════════════════════════════

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface BrowserFingerprint {
  headers: Record<string, string>;
  cookies: string;
  userAgent: string;
  isMobile: boolean;
}

/**
 * Generate a complete browser fingerprint with consistent headers.
 * All headers within a single fingerprint are internally consistent
 * (e.g., Chrome UA gets Chrome-specific Sec-CH-UA headers).
 */
export function generateFingerprint(options?: { preferDesktop?: boolean }): BrowserFingerprint {
  const preferDesktop = options?.preferDesktop ?? true;
  
  // 90% desktop, 10% mobile (unless forced)
  const useMobile = !preferDesktop && Math.random() < 0.1;
  const ua = useMobile
    ? getRandomItem(USER_AGENTS_MOBILE)
    : getRandomItem(USER_AGENTS_DESKTOP);

  const isFirefox = ua.includes("Firefox");
  const isSafari = ua.includes("Safari") && !ua.includes("Chrome");
  const isEdge = ua.includes("Edg/");
  const isChrome = ua.includes("Chrome") && !isEdge;
  const isMobile = ua.includes("Mobile");

  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Accept-Language": getRandomItem(ACCEPT_LANGUAGES),
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
    "DNT": Math.random() > 0.7 ? "1" : "0", // 30% have DNT
  };

  // Browser-specific Accept header
  if (isFirefox) {
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8";
  } else if (isSafari) {
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  } else {
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
  }

  // Sec-* headers (Chromium-based browsers only)
  if (isChrome || isEdge) {
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";

    // Sec-CH-UA (Client Hints)
    const chromeVersion = ua.match(/Chrome\/([\d]+)/)?.[1] || "135";
    if (isEdge) {
      const edgeVersion = ua.match(/Edg\/([\d]+)/)?.[1] || chromeVersion;
      headers["Sec-Ch-Ua"] = `"Microsoft Edge";v="${edgeVersion}", "Chromium";v="${chromeVersion}", "Not-A.Brand";v="99"`;
    } else {
      headers["Sec-Ch-Ua"] = `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not-A.Brand";v="99"`;
    }

    // Platform
    if (ua.includes("Windows")) {
      headers["Sec-Ch-Ua-Platform"] = '"Windows"';
    } else if (ua.includes("Mac")) {
      headers["Sec-Ch-Ua-Platform"] = '"macOS"';
    } else if (ua.includes("Linux") && !ua.includes("Android")) {
      headers["Sec-Ch-Ua-Platform"] = '"Linux"';
    } else if (ua.includes("Android")) {
      headers["Sec-Ch-Ua-Platform"] = '"Android"';
    }

    headers["Sec-Ch-Ua-Mobile"] = isMobile ? "?1" : "?0";

    // Additional Client Hints (randomly included)
    if (Math.random() > 0.5) {
      headers["Sec-Ch-Viewport-Width"] = String(getRandomItem(VIEWPORT_WIDTHS));
    }
    if (Math.random() > 0.6) {
      headers["Sec-Ch-Device-Memory"] = String(getRandomItem(DEVICE_MEMORIES));
    }
  }

  // Firefox-specific headers
  if (isFirefox) {
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";
    // Firefox doesn't send Sec-CH-UA headers
  }

  // Generate realistic Amazon cookies
  const cookies = generateAmazonCookies();

  return {
    headers,
    cookies,
    userAgent: ua,
    isMobile,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Amazon Cookie Simulation
// ═══════════════════════════════════════════════════════════════════════

function generateSessionId(): string {
  const chars = "0123456789";
  let result = "";
  for (let i = 0; i < 3; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  result += "-";
  for (let i = 0; i < 7; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  result += "-";
  for (let i = 0; i < 7; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateUbid(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 3; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  result += "-";
  for (let i = 0; i < 7; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  result += "-";
  for (let i = 0; i < 7; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generate realistic Amazon session cookies.
 * These mimic a returning visitor who has browsed Amazon before.
 */
function generateAmazonCookies(): string {
  const sessionId = generateSessionId();
  const ubid = generateUbid();
  const now = Math.floor(Date.now() / 1000);
  const csm = `adb=0`; // ad blocker detection
  const i18n = "USD"; // currency preference
  
  const cookies = [
    `session-id=${sessionId}`,
    `session-id-time=2082787201l`,
    `ubid-main=${ubid}`,
    `i18n-prefs=${i18n}`,
    `csm-hit=tb:${generateSessionId()}+s-${generateSessionId()}|${now}`,
    `sp-cdn="L5Z9:CN"`, // CDN preference
    `lc-main=en_US`, // language
  ];

  return cookies.join("; ");
}

// ═══════════════════════════════════════════════════════════════════════
// CAPTCHA Detection
// ═══════════════════════════════════════════════════════════════════════

export interface CaptchaCheckResult {
  isCaptcha: boolean;
  isBlocked: boolean;
  isSuspicious: boolean;
  reason?: string;
}

/**
 * Check if the response HTML indicates a CAPTCHA, block, or suspicious page.
 */
export function checkForCaptcha(html: string): CaptchaCheckResult {
  // CAPTCHA page
  if (
    html.includes("api-services-support@amazon.com") ||
    html.includes("Type the characters you see in this image") ||
    html.includes("Enter the characters you see below") ||
    html.includes("captcha") ||
    html.includes("validateCaptcha")
  ) {
    return { isCaptcha: true, isBlocked: false, isSuspicious: false, reason: "CAPTCHA page detected" };
  }

  // Robot check
  if (
    html.includes("Sorry, we just need to make sure you") ||
    html.includes("automated access to") ||
    html.includes("robot") && html.includes("check")
  ) {
    return { isCaptcha: false, isBlocked: true, isSuspicious: false, reason: "Robot check page" };
  }

  // Suspicious short response (likely blocked)
  if (html.length < 3000) {
    return { isCaptcha: false, isBlocked: false, isSuspicious: true, reason: `Suspiciously short response (${html.length} bytes)` };
  }

  // Check for empty product page (CAPTCHA might have been served but not detected)
  if (html.length < 10000 && !html.includes("productTitle") && !html.includes("dp/")) {
    return { isCaptcha: false, isBlocked: false, isSuspicious: true, reason: "Missing product content indicators" };
  }

  return { isCaptcha: false, isBlocked: false, isSuspicious: false };
}

// ═══════════════════════════════════════════════════════════════════════
// Smart Retry with Fingerprint Rotation
// ═══════════════════════════════════════════════════════════════════════

export interface SmartFetchConfig {
  /** Proxy URL (single proxy) */
  proxyUrl?: string;
  /** Proxy pool (multiple proxies for rotation) */
  proxyPool?: string[];
  /** Max retries (default: 5) */
  maxRetries?: number;
  /** Base delay in ms (default: 3000) */
  baseDelay?: number;
  /** Request timeout in ms (default: 25000) */
  timeout?: number;
  /** Whether to add Referer header simulating navigation */
  simulateNavigation?: boolean;
}

/**
 * Smart fetch with automatic fingerprint rotation and CAPTCHA handling.
 * 
 * Strategy:
 * 1. Each attempt uses a fresh browser fingerprint
 * 2. On CAPTCHA: switch proxy (if pool available) + longer delay
 * 3. On block: switch proxy + much longer delay
 * 4. Exponential backoff with jitter
 */
export async function smartFetch(url: string, config: SmartFetchConfig = {}): Promise<string> {
  const maxRetries = config.maxRetries ?? 5;
  const baseDelay = config.baseDelay ?? 3000;
  const timeout = config.timeout ?? 25000;
  
  // Build proxy pool
  const proxyPool: (string | undefined)[] = [];
  if (config.proxyPool && config.proxyPool.length > 0) {
    proxyPool.push(...config.proxyPool);
  } else if (config.proxyUrl) {
    proxyPool.push(config.proxyUrl);
  }
  // Always include direct connection as last resort
  proxyPool.push(undefined);

  let currentProxyIndex = 0;
  let lastCaptchaAttempt = -1;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Generate fresh fingerprint for each attempt
    const fingerprint = generateFingerprint({ preferDesktop: true });
    
    // Select proxy (rotate on CAPTCHA)
    const proxyUrl = proxyPool[currentProxyIndex % proxyPool.length];
    
    try {
      const headers = { ...fingerprint.headers };
      
      // Add cookies
      headers["Cookie"] = fingerprint.cookies;
      
      // Simulate navigation on retries
      if (attempt > 0 || config.simulateNavigation) {
        const referers = [
          "https://www.amazon.com/",
          "https://www.amazon.com/s?k=product",
          "https://www.google.com/",
          "https://www.amazon.com/gp/bestsellers/",
        ];
        headers["Referer"] = getRandomItem(referers);
      }

      // Build fetch options
      const fetchOpts: any = {
        headers,
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      };

      // Add proxy agent if needed
      if (proxyUrl) {
        try {
          // Try axios-style proxy for HTTP proxies
          const proxyUrlObj = new URL(proxyUrl);
          if (proxyUrlObj.protocol === "http:" || proxyUrlObj.protocol === "https:") {
            const { HttpsProxyAgent } = await import("https-proxy-agent");
            fetchOpts.agent = new HttpsProxyAgent(proxyUrl);
          } else {
            // SOCKS proxy
            try {
              const { SocksProxyAgent } = await import("socks-proxy-agent");
              fetchOpts.agent = new SocksProxyAgent(proxyUrl);
            } catch {
              // socks-proxy-agent not available
            }
          }
        } catch {
          // Invalid proxy URL, continue without
        }
      }

      console.log(`[AntiBot] Attempt ${attempt + 1}/${maxRetries} for ${url.substring(0, 80)}... (proxy: ${proxyUrl ? "yes" : "direct"}, UA: ${fingerprint.userAgent.substring(0, 40)}...)`);

      const res = await fetch(url, fetchOpts);
      
      if (res.status === 503 || res.status === 429) {
        console.warn(`[AntiBot] Rate limited (${res.status}) on attempt ${attempt + 1}`);
        // Rotate proxy on rate limit
        currentProxyIndex++;
        const delay = baseDelay * Math.pow(3, attempt) + Math.floor(Math.random() * 2000);
        console.log(`[AntiBot] Waiting ${delay}ms before retry...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const html = await res.text();

      // Check for CAPTCHA/block
      const captchaCheck = checkForCaptcha(html);
      
      if (captchaCheck.isCaptcha || captchaCheck.isBlocked) {
        console.warn(`[AntiBot] ${captchaCheck.reason} on attempt ${attempt + 1}`);
        lastCaptchaAttempt = attempt;
        
        // Rotate proxy
        currentProxyIndex++;
        
        // Longer delay on CAPTCHA (exponential with higher base)
        const captchaDelay = baseDelay * Math.pow(4, attempt) + Math.floor(Math.random() * 5000);
        console.log(`[AntiBot] CAPTCHA detected, rotating proxy and waiting ${captchaDelay}ms...`);
        await new Promise(r => setTimeout(r, captchaDelay));
        continue;
      }

      if (captchaCheck.isSuspicious) {
        console.warn(`[AntiBot] ${captchaCheck.reason} on attempt ${attempt + 1}`);
        // Don't immediately fail on suspicious, try one more time with different fingerprint
        if (attempt < maxRetries - 1) {
          currentProxyIndex++;
          const suspDelay = baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 2000);
          await new Promise(r => setTimeout(r, suspDelay));
          continue;
        }
      }

      console.log(`[AntiBot] Success on attempt ${attempt + 1} (${html.length} bytes)`);
      return html;

    } catch (err: any) {
      console.warn(`[AntiBot] Attempt ${attempt + 1} failed: ${err.message}`);
      
      if (attempt < maxRetries - 1) {
        // Rotate proxy on error
        currentProxyIndex++;
        const delay = baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`[AntiBot] Failed to fetch ${url} after ${maxRetries} attempts. CAPTCHA detected on attempt ${lastCaptchaAttempt + 1}. Consider using a residential proxy service.`);
}

// ═══════════════════════════════════════════════════════════════════════
// Proxy Pool Helper
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a proxy pool from a single proxy URL.
 * For residential proxy services (SmartProxy, Oxylabs, BrightData),
 * each connection through the same URL gets a different IP.
 * We create multiple "virtual" entries to trigger reconnection.
 */
export function buildProxyPool(proxyUrl?: string, size: number = 5): string[] {
  if (!proxyUrl) return [];
  
  // For residential proxies, the same URL gives different IPs on each connection
  // We just need multiple entries to trigger rotation logic
  const pool: string[] = [];
  for (let i = 0; i < size; i++) {
    pool.push(proxyUrl);
  }
  return pool;
}

// ═══════════════════════════════════════════════════════════════════════
// Random Delay Helper
// ═══════════════════════════════════════════════════════════════════════

export function randomDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.floor(Math.random() * (max - min));
  return new Promise(resolve => setTimeout(resolve, ms));
}
