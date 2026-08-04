import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { router } from "../../../_core/trpc";
import { protectedProcedure } from "../workspaceProcedure";

import { getDb } from "../../../repositories/dbClient";

import { invokeLLM } from "../../../_core/llm";

import {
  inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules,
  adAnalysisTasks, adAutomationRules, searchTermActions,
  competitorMonitors, competitorSnapshots, competitorReports,
  lingxingApiLogs, userSettings, asinStatusCache, asinPermissions,
  asinTagDefinitions, asinTagAssignments, productProfiles, productVariants,
  lingxingProductWeekly, operatorNameMappings
} from "../../../../drizzle/schema";

import { eq, desc, and, sql, gte, lte, or } from "drizzle-orm";

import { MANAGER_ROLES } from "../../../../shared/const";

import { resolveDataUserId } from "../../../routers/dataImport";
import { workspaceIdFromContext } from "../../../services/securityGovernance";
import { opsWorkspaceCondition, withOpsWorkspace } from "../../../repositories/ops";
import { ContextScopedCache } from "../../../infrastructure/cache/scopedCache";
import { currentOpsCacheScope } from "../workspaceContext";

// ─── Ad Data Memory Cache ─────────────────────────────────────────────
type CacheEntry<T> = T;
const adCache = new ContextScopedCache<any>({
  namespace: "ops.advertising",
  visibility: "workspace",
  defaultTtlMs: 10 * 60 * 1000,
  maxEntries: 500,
}, () => currentOpsCacheScope("workspace"));

function cacheGet<T>(key: string): T | null {
  return adCache.get(key) as T | null;
}

function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  adCache.set(key, data, ttlMs);
}

function getCacheAge(key: string): number | null {
  return adCache.ageSeconds(key);
}

// Helper: generate date range array
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

// Marketplace ID mapping (Lingxing mid -> country code)
const MARKETPLACE_MAP: Record<number, { code: string; name: string; region: string }> = {
  1: { code: 'US', name: '美国', region: 'NA' },
  2: { code: 'CA', name: '加拿大', region: 'NA' },
  3: { code: 'MX', name: '墨西哥', region: 'NA' },
  4: { code: 'UK', name: '英国', region: 'EU' },
  5: { code: 'DE', name: '德国', region: 'EU' },
  6: { code: 'FR', name: '法国', region: 'EU' },
  7: { code: 'IT', name: '意大利', region: 'EU' },
  8: { code: 'ES', name: '西班牙', region: 'EU' },
  9: { code: 'JP', name: '日本', region: 'FE' },
  10: { code: 'AU', name: '澳大利亚', region: 'FE' },
  11: { code: 'IN', name: '印度', region: 'FE' },
  12: { code: 'AE', name: '阿联酋', region: 'ME' },
  13: { code: 'SA', name: '沙特', region: 'ME' },
  14: { code: 'SG', name: '新加坡', region: 'FE' },
  15: { code: 'NL', name: '荷兰', region: 'EU' },
  16: { code: 'SE', name: '瑞典', region: 'EU' },
  17: { code: 'PL', name: '波兰', region: 'EU' },
  18: { code: 'BR', name: '巴西', region: 'SA' },
  19: { code: 'TR', name: '土耳其', region: 'EU' },
  20: { code: 'BE', name: '比利时', region: 'EU' },
};

// Helper: Filter sids by marketplace code
function filterSidsByMarketplace(sellers: any[], marketplaceCode?: string): string[] {
  if (!marketplaceCode || marketplaceCode === 'ALL') {
    return sellers.map((s: any) => String(s.sid));
  }
  const midEntry = Object.entries(MARKETPLACE_MAP).find(([_, v]) => v.code === marketplaceCode);
  if (!midEntry) return sellers.map((s: any) => String(s.sid));
  const targetMid = Number(midEntry[0]);
  const filtered = sellers.filter((s: any) => Number(s.mid) === targetMid);
  return filtered.length > 0 ? filtered.map((s: any) => String(s.sid)) : sellers.map((s: any) => String(s.sid));
}

// Helper: Get all seller SIDs from Lingxing (with cache + retry)
// Seller SIDs - now sourced from imported data (no API calls)
async function getAllSellerSids(): Promise<{sids: string[], sellers: any[]}> {
  // Return empty - seller data now comes from Excel imports
  // Individual procedures should query the database directly
  return { sids: [], sellers: [] };
}

// Helper functions
function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

export { z, TRPCError, protectedProcedure, router, getDb, invokeLLM, inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules, adAnalysisTasks, adAutomationRules, searchTermActions, competitorMonitors, competitorSnapshots, competitorReports, lingxingApiLogs, userSettings, asinStatusCache, asinPermissions, asinTagDefinitions, asinTagAssignments, productProfiles, productVariants, lingxingProductWeekly, operatorNameMappings, eq, desc, and, sql, gte, lte, or, MANAGER_ROLES, resolveDataUserId, workspaceIdFromContext, opsWorkspaceCondition, withOpsWorkspace, CacheEntry, adCache, cacheGet, cacheSet, getCacheAge, getDateRange, MARKETPLACE_MAP, filterSidsByMarketplace, getAllSellerSids, getToday, getYesterday, getDateNDaysAgo };
