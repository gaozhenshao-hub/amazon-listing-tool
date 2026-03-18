import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { systemSettings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════
// Proxy configuration helpers
// ═══════════════════════════════════════════════════════════════════════

export const PROXY_SETTING_KEYS = {
  PROXY_ENABLED: "proxy_enabled",
  PROXY_PROVIDER: "proxy_provider", // smartproxy | oxylabs | brightdata | custom
  PROXY_URL: "proxy_url",
  PROXY_USERNAME: "proxy_username",
  PROXY_PASSWORD: "proxy_password",
  PROXY_HOST: "proxy_host",
  PROXY_PORT: "proxy_port",
  PROXY_PROTOCOL: "proxy_protocol", // http | https | socks5
  SCRAPER_MAX_RETRIES: "scraper_max_retries",
  SCRAPER_TIMEOUT: "scraper_timeout",
  SCRAPER_MIN_DELAY: "scraper_min_delay",
  SCRAPER_MAX_DELAY: "scraper_max_delay",
} as const;

/** Build a full proxy URL from individual settings */
export function buildProxyUrl(settings: Record<string, string | null>): string | undefined {
  const enabled = settings[PROXY_SETTING_KEYS.PROXY_ENABLED];
  if (enabled !== "true") return undefined;

  // If a full URL is provided directly, use it
  const directUrl = settings[PROXY_SETTING_KEYS.PROXY_URL];
  if (directUrl && directUrl.trim()) return directUrl.trim();

  // Otherwise build from components
  const protocol = settings[PROXY_SETTING_KEYS.PROXY_PROTOCOL] || "http";
  const host = settings[PROXY_SETTING_KEYS.PROXY_HOST];
  const port = settings[PROXY_SETTING_KEYS.PROXY_PORT];
  const username = settings[PROXY_SETTING_KEYS.PROXY_USERNAME];
  const password = settings[PROXY_SETTING_KEYS.PROXY_PASSWORD];

  if (!host) return undefined;

  let url = `${protocol}://`;
  if (username && password) {
    url += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  }
  url += host;
  if (port) url += `:${port}`;

  return url;
}

/** Provider presets for quick configuration */
export const PROVIDER_PRESETS: Record<string, { name: string; host: string; port: string; protocol: string; description: string }> = {
  smartproxy: {
    name: "SmartProxy",
    host: "gate.smartproxy.com",
    port: "10001",
    protocol: "http",
    description: "SmartProxy 住宅代理 - 全球4000万+ IP池",
  },
  oxylabs: {
    name: "Oxylabs",
    host: "pr.oxylabs.io",
    port: "7777",
    protocol: "http",
    description: "Oxylabs 住宅代理 - 全球1亿+ IP池",
  },
  brightdata: {
    name: "Bright Data",
    host: "brd.superproxy.io",
    port: "22225",
    protocol: "http",
    description: "Bright Data 住宅代理 - 全球7200万+ IP池",
  },
  scraperapi: {
    name: "ScraperAPI",
    host: "proxy-server.scraperapi.com",
    port: "8001",
    protocol: "http",
    description: "ScraperAPI 代理 - 自动处理CAPTCHA和封禁",
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Exported helper: get proxy config for scraper
// ═══════════════════════════════════════════════════════════════════════

export async function getScraperConfig(): Promise<{
  proxyUrl?: string;
  maxRetries?: number;
  timeout?: number;
  minRequestDelay?: number;
  maxRequestDelay?: number;
}> {
  try {
    const db = await getDb();
    if (!db) return {};
    const rows = await db.select().from(systemSettings).where(
      eq(systemSettings.category, "proxy")
    );
    const map: Record<string, string | null> = {};
    for (const row of rows) {
      map[row.settingKey] = row.settingValue;
    }

    const proxyUrl = buildProxyUrl(map);
    const maxRetries = map[PROXY_SETTING_KEYS.SCRAPER_MAX_RETRIES]
      ? parseInt(map[PROXY_SETTING_KEYS.SCRAPER_MAX_RETRIES]!, 10) : undefined;
    const timeout = map[PROXY_SETTING_KEYS.SCRAPER_TIMEOUT]
      ? parseInt(map[PROXY_SETTING_KEYS.SCRAPER_TIMEOUT]!, 10) : undefined;
    const minDelay = map[PROXY_SETTING_KEYS.SCRAPER_MIN_DELAY]
      ? parseInt(map[PROXY_SETTING_KEYS.SCRAPER_MIN_DELAY]!, 10) : undefined;
    const maxDelay = map[PROXY_SETTING_KEYS.SCRAPER_MAX_DELAY]
      ? parseInt(map[PROXY_SETTING_KEYS.SCRAPER_MAX_DELAY]!, 10) : undefined;

    return {
      proxyUrl,
      maxRetries: maxRetries && maxRetries > 0 ? maxRetries : undefined,
      timeout: timeout && timeout > 0 ? timeout : undefined,
      minRequestDelay: minDelay && minDelay > 0 ? minDelay : undefined,
      maxRequestDelay: maxDelay && maxDelay > 0 ? maxDelay : undefined,
    };
  } catch {
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════

export const systemSettingsRouter = router({
  /** Get all proxy-related settings */
  getProxyConfig: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { config: {} as Record<string, string | null>, providerPresets: PROVIDER_PRESETS };
    const rows = await db.select().from(systemSettings).where(
      eq(systemSettings.category, "proxy")
    );
    const config: Record<string, string | null> = {};
    for (const row of rows) {
      // Mask password for frontend display
      if (row.settingKey === PROXY_SETTING_KEYS.PROXY_PASSWORD && row.settingValue) {
        config[row.settingKey] = "••••••••";
      } else {
        config[row.settingKey] = row.settingValue;
      }
    }
    return { config, providerPresets: PROVIDER_PRESETS };
  }),

  /** Update proxy configuration (batch upsert) */
  updateProxyConfig: protectedProcedure
    .input(z.object({
      settings: z.record(z.string(), z.string().nullable()),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const userId = ctx.user.id;
      for (const [key, value] of Object.entries(input.settings)) {
        // Upsert: try insert, on conflict update
        const existing = await db.select().from(systemSettings).where(
          eq(systemSettings.settingKey, key)
        );
        if (existing.length > 0) {
          // Don't overwrite password with masked value
          if (key === PROXY_SETTING_KEYS.PROXY_PASSWORD && value === "••••••••") continue;
          await db.update(systemSettings)
            .set({ settingValue: value, updatedBy: userId, category: "proxy" })
            .where(eq(systemSettings.settingKey, key));
        } else {
          await db.insert(systemSettings).values({
            settingKey: key,
            settingValue: value,
            category: "proxy",
            updatedBy: userId,
          });
        }
      }
      return { success: true };
    }),

  /** Apply a provider preset */
  applyProviderPreset: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const preset = PROVIDER_PRESETS[input.provider];
      if (!preset) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown provider" });

      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const settings: Record<string, string> = {
        [PROXY_SETTING_KEYS.PROXY_PROVIDER]: input.provider,
        [PROXY_SETTING_KEYS.PROXY_HOST]: preset.host,
        [PROXY_SETTING_KEYS.PROXY_PORT]: preset.port,
        [PROXY_SETTING_KEYS.PROXY_PROTOCOL]: preset.protocol,
        // Clear direct URL when using preset
        [PROXY_SETTING_KEYS.PROXY_URL]: "",
      };

      const userId = ctx.user.id;
      for (const [key, value] of Object.entries(settings)) {
        const existing = await db2.select().from(systemSettings).where(
          eq(systemSettings.settingKey, key)
        );
        if (existing.length > 0) {
          await db2.update(systemSettings)
            .set({ settingValue: value, updatedBy: userId, category: "proxy" })
            .where(eq(systemSettings.settingKey, key));
        } else {
          await db2.insert(systemSettings).values({
            settingKey: key,
            settingValue: value,
            category: "proxy",
            updatedBy: userId,
          });
        }
      }

      return { success: true, preset };
    }),

  /** Test proxy connection */
  testProxy: protectedProcedure.mutation(async () => {
    const config = await getScraperConfig();
    if (!config.proxyUrl) {
      return { success: false, message: "代理未配置或未启用", latency: null };
    }

    try {
      const startTime = Date.now();

      // Use node-fetch or native fetch with proxy
      // We'll test by making a simple request to httpbin
      const { HttpsProxyAgent } = await import("https-proxy-agent");
      const agent = new HttpsProxyAgent(config.proxyUrl);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch("https://httpbin.org/ip", {
        agent: agent as any,
        signal: controller.signal,
      } as any);

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json() as { origin?: string };
        return {
          success: true,
          message: `代理连接成功！出口IP: ${data.origin || "未知"}`,
          latency,
          ip: data.origin || null,
        };
      } else {
        return {
          success: false,
          message: `代理响应异常: HTTP ${response.status}`,
          latency,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: `代理连接失败: ${err.message || "未知错误"}`,
        latency: null,
      };
    }
  }),

  /** Test scraping through proxy (quick Amazon test) */
  testScrape: protectedProcedure.mutation(async () => {
    const config = await getScraperConfig();

    try {
      const startTime = Date.now();
      // Import scraper and try a lightweight fetch
      const { scrapeAmazonProduct } = await import("../scraper");
      // Use a well-known ASIN for testing
      const data = await scrapeAmazonProduct("B09V3KXJPB", config);
      const latency = Date.now() - startTime;

      return {
        success: !!data.title,
        message: data.title
          ? `爬取成功！标题: ${data.title.substring(0, 60)}...`
          : "爬取失败：未获取到标题",
        latency,
        imageCount: data.images?.length || 0,
        hasAplus: data.images?.some(i => i.position === "aplus") || false,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `爬取测试失败: ${err.message || "未知错误"}`,
        latency: null,
      };
    }
  }),
});
