/**
 * NextSLS Logistics tRPC Router
 * 
 * 物流管理路由：NextSLS API配置、运单管理、物流时效统计、库存预警联动
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { systemSettings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { nextSlsAdapter } from "../nextsls/adapter";
import {
  getTransitTimeStats,
  getTransitTimeOverview,
  getMappedStepDaysForRoute,
  clearTransitTimeCache,
  analyzeTransitTimes,
  aggregateTransitStats,
} from "../nextsls/transitTimeService";

// ─── NextSLS Setting Keys ───
const NEXTSLS_KEYS = {
  BASE_URL: "nextsls_base_url",
  TOKEN: "nextsls_token",
  ENABLED: "nextsls_enabled",
} as const;

export const logisticsRouter = router({

  // ═══════════════════════════════════════════════════════════════
  // NextSLS API Configuration
  // ═══════════════════════════════════════════════════════════════

  /** Get NextSLS config */
  getConfig: protectedProcedure.query(async () => {
    const config = nextSlsAdapter.getConfig();
    const db = await getDb();
    
    // Also fetch DB values for display
    const rows = await db!.select().from(systemSettings)
      .where(eq(systemSettings.category, "nextsls"));
    
    const dbConfig: Record<string, string> = {};
    for (const row of rows) {
      if (row.settingValue) dbConfig[row.settingKey] = row.settingValue;
    }

    return {
      baseUrl: dbConfig[NEXTSLS_KEYS.BASE_URL] || "",
      token: dbConfig[NEXTSLS_KEYS.TOKEN] ? "••••••••" : "",
      enabled: dbConfig[NEXTSLS_KEYS.ENABLED] === "true",
      isConfigured: config.isConfigured,
      isReady: nextSlsAdapter.isReady(),
    };
  }),

  /** Save NextSLS config */
  saveConfig: protectedProcedure
    .input(z.object({
      baseUrl: z.string().url().optional(),
      token: z.string().optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      
      const updates: { key: string; value: string; desc: string }[] = [];
      
      if (input.baseUrl !== undefined) {
        updates.push({ key: NEXTSLS_KEYS.BASE_URL, value: input.baseUrl, desc: "NextSLS API Base URL" });
      }
      if (input.token !== undefined && !input.token.includes("••")) {
        updates.push({ key: NEXTSLS_KEYS.TOKEN, value: input.token, desc: "NextSLS API Token" });
      }
      if (input.enabled !== undefined) {
        updates.push({ key: NEXTSLS_KEYS.ENABLED, value: String(input.enabled), desc: "NextSLS API Enabled" });
      }

      for (const { key, value, desc } of updates) {
        const existing = await db!.select().from(systemSettings)
          .where(eq(systemSettings.settingKey, key));
        
        if (existing.length > 0) {
          await db!.update(systemSettings)
            .set({ settingValue: value, category: "nextsls", updatedBy: ctx.user.id })
            .where(eq(systemSettings.settingKey, key));
        } else {
          await db!.insert(systemSettings).values({
            settingKey: key,
            settingValue: value,
            description: desc,
            category: "nextsls",
            updatedBy: ctx.user.id,
          });
        }
      }

      // Reload adapter config
      const allRows = await db!.select().from(systemSettings)
        .where(eq(systemSettings.category, "nextsls"));
      const settings: Record<string, string> = {};
      for (const row of allRows) {
        if (row.settingValue) settings[row.settingKey] = row.settingValue;
      }

      nextSlsAdapter.configure({
        baseUrl: settings[NEXTSLS_KEYS.BASE_URL] || "",
        token: settings[NEXTSLS_KEYS.TOKEN] || "",
        enabled: settings[NEXTSLS_KEYS.ENABLED] === "true",
      });

      // Clear transit time cache since config changed
      clearTransitTimeCache();

      return { success: true };
    }),

  /** Test NextSLS connection */
  testConnection: protectedProcedure.mutation(async () => {
    return await nextSlsAdapter.testConnection();
  }),

  /** Get API call logs */
  getApiLogs: protectedProcedure
    .input(z.object({ limit: z.number().optional().default(20) }))
    .query(async ({ input }) => {
      return nextSlsAdapter.getApiLogs(input.limit);
    }),

  // ═══════════════════════════════════════════════════════════════
  // Shipment Management
  // ═══════════════════════════════════════════════════════════════

  /** Get available logistics services */
  getServices: protectedProcedure
    .input(z.object({
      type: z.enum(["all", "b2b", "b2c", "ex"]).optional().default("all"),
    }))
    .query(async ({ input }) => {
      if (!nextSlsAdapter.isReady()) return [];
      return await nextSlsAdapter.getServices(input.type);
    }),

  /** Get account balance */
  getAccountBalance: protectedProcedure.query(async () => {
    if (!nextSlsAdapter.isReady()) return [];
    return await nextSlsAdapter.getAccountBalance();
  }),

  /** Get shipment list from NextSLS */
  getShipmentList: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(20),
    }))
    .query(async ({ input }) => {
      if (!nextSlsAdapter.isReady()) return { items: [], total: 0 };
      const items = await nextSlsAdapter.getShipmentList({
        status: input.status,
        start_created: input.startDate,
        end_created: input.endDate,
        page: input.page,
        page_size: input.pageSize,
      });
      return { items, total: items.length };
    }),

  /** Get shipment detail */
  getShipmentDetail: protectedProcedure
    .input(z.object({ shipmentId: z.string() }))
    .query(async ({ input }) => {
      if (!nextSlsAdapter.isReady()) return null;
      return await nextSlsAdapter.getShipment(input.shipmentId);
    }),

  /** Get tracking info */
  getTracking: protectedProcedure
    .input(z.object({
      shipmentId: z.string().optional(),
      trackingNumber: z.string().optional(),
    }))
    .query(async ({ input }) => {
      if (!nextSlsAdapter.isReady()) return null;
      return await nextSlsAdapter.getTracking({
        shipment_id: input.shipmentId,
        tracking_number: input.trackingNumber,
        language: "zh",
      });
    }),

  /** Get rate estimate */
  getRateEstimate: protectedProcedure
    .input(z.object({
      service: z.string(),
      toCountry: z.string(),
      toPostcode: z.string(),
      weight: z.number(),
      length: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      declarations: z.array(z.object({
        name_zh: z.string(),
        name_en: z.string(),
        qty: z.number().optional(),
        unit_value: z.number().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      if (!nextSlsAdapter.isReady()) throw new Error("NextSLS未配置");
      return await nextSlsAdapter.getRate({
        service: input.service,
        parcel_count: 1,
        to_address: {
          name: "Rate Check",
          address_1: "N/A",
          city: "N/A",
          country: input.toCountry,
          postcode: input.toPostcode,
        },
        parcels: [{
          number: "1",
          client_weight: input.weight,
          client_length: input.length,
          client_width: input.width,
          client_height: input.height,
          declarations: input.declarations || [{
            name_zh: "货物",
            name_en: "Goods",
          }],
        }],
      });
    }),

  /** Check remote postcode */
  checkRemote: protectedProcedure
    .input(z.object({
      service: z.string(),
      country: z.string(),
      postcode: z.string(),
    }))
    .mutation(async ({ input }) => {
      if (!nextSlsAdapter.isReady()) throw new Error("NextSLS未配置");
      return await nextSlsAdapter.checkRemote(input.service, {
        name: "Check",
        address_1: "N/A",
        city: "N/A",
        country: input.country,
        postcode: input.postcode,
      });
    }),

  // ═══════════════════════════════════════════════════════════════
  // Transit Time Analytics (核心：反哺库存预警)
  // ═══════════════════════════════════════════════════════════════

  /** 获取物流时效概览 */
  getTransitOverview: protectedProcedure.query(async () => {
    return await getTransitTimeOverview();
  }),

  /** 获取详细物流时效统计（按渠道/目的国） */
  getTransitStats: protectedProcedure
    .input(z.object({
      service: z.string().optional(),
      country: z.string().optional(),
      forceRefresh: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      return await getTransitTimeStats(input);
    }),

  /** 获取指定路线的映射步骤天数（供补货引擎调用） */
  getMappedStepDays: protectedProcedure
    .input(z.object({
      service: z.string().optional(),
      destinationCountry: z.string().optional().default("US"),
    }))
    .query(async ({ input }) => {
      return await getMappedStepDaysForRoute(input.service, input.destinationCountry);
    }),

  /** 手动触发物流时效分析 */
  refreshTransitAnalysis: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!nextSlsAdapter.isReady()) {
        return { success: false, message: "NextSLS未配置", records: 0, stats: [] };
      }
      
      clearTransitTimeCache();
      const records = await analyzeTransitTimes({
        startDate: input.startDate,
        endDate: input.endDate,
        forceRefresh: true,
      });
      const stats = aggregateTransitStats(records);
      
      return {
        success: true,
        message: `分析完成，共处理 ${records.length} 条运单`,
        records: records.length,
        stats,
      };
    }),
});
