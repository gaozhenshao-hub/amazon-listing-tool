import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { retiredFeatureError } from "@shared/_core/errors";

/**
 * 仅为历史代码与导入兼容保留键名。A8之后不再读取、展示或写入这些配置，
 * 也不会把它们作为受控Provider失败后的降级路径。
 */
export const PROXY_SETTING_KEYS = {
  PROXY_ENABLED: "proxy_enabled",
  PROXY_PROVIDER: "proxy_provider",
  PROXY_URL: "proxy_url",
  PROXY_USERNAME: "proxy_username",
  PROXY_PASSWORD: "proxy_password",
  PROXY_HOST: "proxy_host",
  PROXY_PORT: "proxy_port",
  PROXY_PROTOCOL: "proxy_protocol",
  SCRAPER_MAX_RETRIES: "scraper_max_retries",
  SCRAPER_TIMEOUT: "scraper_timeout",
  SCRAPER_MIN_DELAY: "scraper_min_delay",
  SCRAPER_MAX_DELAY: "scraper_max_delay",
} as const;

export const PROVIDER_PRESETS = {} as const;

export function buildProxyUrl(_settings: Record<string, string | null>): undefined {
  return undefined;
}

export async function getScraperConfig(): Promise<never> {
  throw retiredFeatureError("旧内嵌Amazon爬虫配置", "crawler.getProviderReadiness", {
    replacementProcedure: "crawler.getProviderReadiness",
  });
}

const retiredCrawlerConfig = () => retiredFeatureError(
  "旧代理/UA/重试与即时抓取设置",
  "crawler.getProviderReadiness",
  { replacementProcedure: "crawler.getProviderReadiness" },
);

export const systemSettingsRouter = router({
  getLingxingConfig: protectedProcedure.query(() => {
    throw retiredFeatureError("领星 API 配置", "dataImport.uploadAndParse", { replacementProcedure: "dataImport.uploadAndParse" });
  }),
  updateLingxingConfig: protectedProcedure.mutation(() => {
    throw retiredFeatureError("领星 API 集成", "dataImport.uploadAndParse", { replacementProcedure: "dataImport.uploadAndParse" });
  }),
  testLingxingConnection: protectedProcedure.mutation(() => {
    throw retiredFeatureError("领星 API 集成", "dataImport.getHistory", { replacementProcedure: "dataImport.getHistory" });
  }),
  getLingxingProxyConfig: protectedProcedure.query(() => {
    throw retiredFeatureError("领星专用代理配置", "dataImport.uploadAndParse", { replacementProcedure: "dataImport.uploadAndParse" });
  }),
  updateLingxingProxyConfig: protectedProcedure.mutation(() => {
    throw retiredFeatureError("领星 API 集成", "dataImport.uploadAndParse", { replacementProcedure: "dataImport.uploadAndParse" });
  }),
  testLingxingProxy: protectedProcedure.mutation(() => {
    throw retiredFeatureError("领星 API 集成", "dataImport.getHistory", { replacementProcedure: "dataImport.getHistory" });
  }),
  testLingxingPaths: protectedProcedure.mutation(() => {
    throw retiredFeatureError("领星 API 集成", "dataImport.getHistory", { replacementProcedure: "dataImport.getHistory" });
  }),
  getLingxingApiLogs: protectedProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(() => {
    throw retiredFeatureError("领星 API 日志", "dataImport.getHistory", { replacementProcedure: "dataImport.getHistory" });
  }),

  getProxyConfig: protectedProcedure.query(() => ({
    retired: true as const,
    config: {} as Record<string, string | null>,
    providerPresets: PROVIDER_PRESETS,
    replacement: {
      procedure: "crawler.getProviderReadiness",
      page: "/ops/crawler",
      message: "旧代理、User-Agent、重试和即时抓取配置已退役。Amazon数据统一使用受控Provider、持久化Job/Run与人工审核。",
    },
  })),
  updateProxyConfig: protectedProcedure.input(z.object({ settings: z.record(z.string(), z.string().nullable()) })).mutation(() => { throw retiredCrawlerConfig(); }),
  applyProviderPreset: protectedProcedure.input(z.object({ provider: z.string() })).mutation(() => { throw retiredCrawlerConfig(); }),
  testProxy: protectedProcedure.mutation(() => { throw retiredCrawlerConfig(); }),
  testScrape: protectedProcedure.mutation(() => { throw retiredCrawlerConfig(); }),
});
