/**
 * 使用量统计中间件
 * 
 * 记录API调用、AI调用、存储使用等使用量数据
 * 按用户+日期维度聚合到 usage_stats 表
 */

import { getDb } from "./db";
import { usageStats } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// In-memory buffer for batching usage updates
interface UsageBuffer {
  [key: string]: {
    userId: number | null;
    statDate: string;
    aiCallCount: number;
    aiTokensUsed: number;
    scraperCallCount: number;
    apiCallCount: number;
    loginCount: number;
  };
}

const usageBuffer: UsageBuffer = {};
let flushTimer: ReturnType<typeof setInterval> | null = null;

function getBufferKey(userId: number | null, date: string): string {
  return `${userId || "system"}_${date}`;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * 记录API调用
 */
export function trackApiCall(userId: number | null): void {
  const date = getToday();
  const key = getBufferKey(userId, date);
  if (!usageBuffer[key]) {
    usageBuffer[key] = { userId, statDate: date, aiCallCount: 0, aiTokensUsed: 0, scraperCallCount: 0, apiCallCount: 0, loginCount: 0 };
  }
  usageBuffer[key].apiCallCount++;
}

/**
 * 记录AI调用
 */
export function trackAiCall(userId: number | null, tokensUsed: number = 0): void {
  const date = getToday();
  const key = getBufferKey(userId, date);
  if (!usageBuffer[key]) {
    usageBuffer[key] = { userId, statDate: date, aiCallCount: 0, aiTokensUsed: 0, scraperCallCount: 0, apiCallCount: 0, loginCount: 0 };
  }
  usageBuffer[key].aiCallCount++;
  usageBuffer[key].aiTokensUsed += tokensUsed;
}

/**
 * 记录爬虫调用
 */
export function trackScraperCall(userId: number | null): void {
  const date = getToday();
  const key = getBufferKey(userId, date);
  if (!usageBuffer[key]) {
    usageBuffer[key] = { userId, statDate: date, aiCallCount: 0, aiTokensUsed: 0, scraperCallCount: 0, apiCallCount: 0, loginCount: 0 };
  }
  usageBuffer[key].scraperCallCount++;
}

/**
 * 记录登录
 */
export function trackLogin(userId: number): void {
  const date = getToday();
  const key = getBufferKey(userId, date);
  if (!usageBuffer[key]) {
    usageBuffer[key] = { userId, statDate: date, aiCallCount: 0, aiTokensUsed: 0, scraperCallCount: 0, apiCallCount: 0, loginCount: 0 };
  }
  usageBuffer[key].loginCount++;
}

/**
 * 将缓冲区数据刷入数据库
 */
async function flushUsageBuffer(): Promise<void> {
  const entries = Object.entries(usageBuffer);
  if (entries.length === 0) return;

  // Clear buffer immediately to avoid double-counting
  for (const key of Object.keys(usageBuffer)) {
    delete usageBuffer[key];
  }

  try {
    const db = await getDb();
    if (!db) return;

    for (const [, data] of entries) {
      // Upsert: increment existing or insert new
      const existing = await db.select().from(usageStats)
        .where(and(
          data.userId ? eq(usageStats.userId, data.userId) : sql`${usageStats.userId} IS NULL`,
          eq(usageStats.statDate, data.statDate)
        ))
        .limit(1);

      if (existing.length > 0) {
        await db.update(usageStats)
          .set({
            aiCallCount: sql`${usageStats.aiCallCount} + ${data.aiCallCount}`,
            aiTokensUsed: sql`${usageStats.aiTokensUsed} + ${data.aiTokensUsed}`,
            scraperCallCount: sql`${usageStats.scraperCallCount} + ${data.scraperCallCount}`,
            apiCallCount: sql`${usageStats.apiCallCount} + ${data.apiCallCount}`,
            loginCount: sql`${usageStats.loginCount} + ${data.loginCount}`,
          })
          .where(eq(usageStats.id, existing[0].id));
      } else {
        await db.insert(usageStats).values({
          userId: data.userId,
          statDate: data.statDate,
          aiCallCount: data.aiCallCount,
          aiTokensUsed: data.aiTokensUsed,
          scraperCallCount: data.scraperCallCount,
          apiCallCount: data.apiCallCount,
          loginCount: data.loginCount,
        });
      }
    }
  } catch (error) {
    console.error("[UsageTracking] Flush error:", error);
    // Re-add failed entries back to buffer
    for (const [key, data] of entries) {
      if (!usageBuffer[key]) {
        usageBuffer[key] = data;
      }
    }
  }
}

/**
 * 启动定时刷入（每60秒）
 */
export function startUsageTracking(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushUsageBuffer, 60 * 1000);
  console.log("[UsageTracking] Started (flush interval: 60s)");
}

/**
 * 停止定时刷入并立即刷入剩余数据
 */
export async function stopUsageTracking(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushUsageBuffer();
  console.log("[UsageTracking] Stopped and flushed");
}

/**
 * 手动触发刷入（用于测试或紧急情况）
 */
export async function manualFlush(): Promise<void> {
  await flushUsageBuffer();
}
