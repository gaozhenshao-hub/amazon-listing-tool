/**
 * 知识库双向同步API（Express路由，系统间通信）
 * 
 * P2P对等模式：两套系统都可以上传知识库内容，互相同步
 * 仅同步已发布（visibility = 'public' 或 reviewStatus = 'approved'）的内容
 * 冲突以最后修改时间（updatedAt）为准
 * 
 * Routes:
 *   POST /api/sync/push     — 接收对端推送的变更
 *   GET  /api/sync/changes   — 返回指定时间后的本地变更
 *   POST /api/sync/pull      — 主动从对端拉取变更
 *   POST /api/sync/trigger   — 手动触发一次完整同步
 *   GET  /api/sync/status    — 查询同步状态
 *   GET  /api/sync/logs      — 查询同步日志
 *   POST /api/sync/usage-report — 接收对端使用量上报
 */

import { Router, Request, Response } from "express";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, gt, and, desc, sql, isNull, or } from "drizzle-orm";
import {
  kbProductInnovations,
  kbListingCopywriting,
  kbImageSets,
  kbOperationSkills,
  kbVideos,
  kbSyncLogs,
  remoteUsageSnapshots,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

const syncRouter = Router();

// ─── Types ──────────────────────────────────────────────────────────

type ResourceType = "kb_product" | "kb_listing" | "kb_image_set" | "kb_video" | "kb_skill";

interface SyncChange {
  resourceType: ResourceType;
  action: "create" | "update" | "delete";
  data: Record<string, unknown>;
  originId: number;
  originInstanceId: string;
  updatedAt: number; // Unix timestamp ms
}

interface PushPayload {
  apiKey: string;
  instanceId: string;
  changes: SyncChange[];
}

interface UsageReportPayload {
  apiKey: string;
  instanceId: string;
  instanceName: string;
  date: string; // YYYY-MM-DD
  stats: {
    totalUsers: number;
    activeUsers: number;
    aiCallCount: number;
    aiTokenUsage: number;
    apiCallCount: number;
    storageUsageMb: number;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  return drizzle(process.env.DATABASE_URL);
}

const TABLE_MAP: Record<ResourceType, any> = {
  kb_product: kbProductInnovations,
  kb_listing: kbListingCopywriting,
  kb_image_set: kbImageSets,
  kb_video: kbVideos,
  kb_skill: kbOperationSkills,
};

// Resource types that have an ASIN field and need dedup
const ASIN_DEDUP_TYPES: ResourceType[] = ["kb_product", "kb_listing", "kb_image_set", "kb_video"];

// Peer API key authentication middleware
function authenticatePeer(req: Request, res: Response, next: Function) {
  const apiKey = req.headers["x-sync-api-key"] as string || req.body?.apiKey;
  if (!ENV.peerApiKey || apiKey !== ENV.peerApiKey) {
    return res.status(401).json({ error: "Invalid sync API key" });
  }
  next();
}

// Get syncable columns for each table (exclude internal fields)
function getSyncableData(row: Record<string, unknown>, resourceType: ResourceType): Record<string, unknown> {
  const exclude = ["id", "originInstanceId", "remoteId", "syncVersion", "lastSyncedAt"];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!exclude.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Check if a record with the same ASIN already exists locally.
 * Returns the existing record's id if found, null otherwise.
 */
async function checkAsinDuplicate(
  db: ReturnType<typeof getDb>,
  table: any,
  resourceType: ResourceType,
  asin: unknown
): Promise<number | null> {
  if (!ASIN_DEDUP_TYPES.includes(resourceType) || !asin || typeof asin !== "string") {
    return null;
  }
  const existing = await db.select({ id: table.id })
    .from(table)
    .where(eq(table.asin, asin))
    .limit(1);
  return existing.length > 0 ? existing[0].id : null;
}

// ─── POST /api/sync/push — Receive changes from peer ────────────────

syncRouter.post("/push", authenticatePeer, async (req: Request, res: Response) => {
  try {
    const { instanceId, changes } = req.body as PushPayload;
    if (!instanceId || !changes || !Array.isArray(changes)) {
      return res.status(400).json({ error: "Missing instanceId or changes" });
    }

    const db = getDb();
    const results = { created: 0, updated: 0, skipped: 0, conflicts: 0, errors: 0 };

    for (const change of changes) {
      try {
        const table = TABLE_MAP[change.resourceType];
        if (!table) {
          results.errors++;
          continue;
        }

        if (change.action === "delete") {
          // Soft delete: mark as archived if exists
          const existing = await db.select().from(table)
            .where(and(
              eq(table.originInstanceId, change.originInstanceId),
              eq(table.remoteId, change.originId)
            ))
            .limit(1);

          if (existing.length > 0) {
            await db.update(table)
              .set({ status: "archived", lastSyncedAt: new Date() })
              .where(eq(table.id, existing[0].id));
            results.updated++;
          } else {
            results.skipped++;
          }
          continue;
        }

        // Check if this record already exists (by origin)
        const existing = await db.select().from(table)
          .where(and(
            eq(table.originInstanceId, change.originInstanceId),
            eq(table.remoteId, change.originId)
          ))
          .limit(1);

        if (existing.length > 0) {
          // Update: check for conflicts (last-write-wins)
          const localUpdatedAt = existing[0].updatedAt ? new Date(existing[0].updatedAt).getTime() : 0;
          const remoteUpdatedAt = change.updatedAt;

          if (remoteUpdatedAt > localUpdatedAt) {
            // Remote is newer, update local
            const updateData = { ...change.data };
            delete updateData.id;
            delete updateData.createdAt;
            (updateData as any).lastSyncedAt = new Date();
            (updateData as any).syncVersion = (existing[0].syncVersion || 0) + 1;

            await db.update(table)
              .set(updateData)
              .where(eq(table.id, existing[0].id));
            results.updated++;
          } else if (remoteUpdatedAt === localUpdatedAt) {
            results.skipped++;
          } else {
            // Local is newer, record conflict
            await db.insert(kbSyncLogs).values({
              syncDirection: "push",
              resourceType: change.resourceType,
              resourceId: existing[0].id,
              remoteResourceId: change.originId,
              syncStatus: "conflict",
              conflictDetail: JSON.stringify({
                localUpdatedAt,
                remoteUpdatedAt,
                remoteData: change.data,
              }),
              peerInstanceId: instanceId,
              itemCount: 1,
            });
            results.conflicts++;
          }
        } else {
          // ASIN dedup: skip if same ASIN already exists locally (any origin)
          const dupId = await checkAsinDuplicate(db, table, change.resourceType, change.data?.asin);
          if (dupId !== null) {
            await db.insert(kbSyncLogs).values({
              syncDirection: "push",
              resourceType: change.resourceType,
              resourceId: dupId,
              remoteResourceId: change.originId,
              syncStatus: "conflict",
              conflictDetail: JSON.stringify({
                reason: "asin_duplicate",
                asin: change.data.asin,
                message: `ASIN ${change.data.asin} already exists locally, skipped to prevent duplicate`,
              }),
              peerInstanceId: instanceId,
              itemCount: 1,
            });
            results.skipped++;
            continue;
          }

          // Create: insert new record
          const insertData = { ...change.data };
          delete insertData.id;
          delete insertData.createdAt;
          (insertData as any).originInstanceId = change.originInstanceId;
          (insertData as any).remoteId = change.originId;
          (insertData as any).syncVersion = 1;
          (insertData as any).lastSyncedAt = new Date();

          await db.insert(table).values(insertData as any);
          results.created++;
        }
      } catch (err) {
        console.error(`[Sync] Error processing change:`, err);
        results.errors++;
      }
    }

    // Log the sync operation
    await db.insert(kbSyncLogs).values({
      syncDirection: "push",
      resourceType: changes[0]?.resourceType || "kb_product",
      resourceId: 0,
      syncStatus: results.errors > 0 ? "failed" : "synced",
      peerInstanceId: instanceId,
      itemCount: changes.length,
      syncedAt: new Date(),
      errorDetail: results.errors > 0 ? `${results.errors} errors occurred` : null,
    });

    return res.json({ success: true, results });
  } catch (error) {
    console.error("[Sync] Push error:", error);
    return res.status(500).json({ error: "Internal sync error" });
  }
});

// ─── GET /api/sync/changes — Return local changes since timestamp ────

syncRouter.get("/changes", authenticatePeer, async (req: Request, res: Response) => {
  try {
    const since = parseInt(req.query.since as string) || 0;
    const type = req.query.type as ResourceType | undefined;
    const sinceDate = new Date(since);
    const db = getDb();

    const changes: SyncChange[] = [];
    const typesToQuery = type ? [type] : (Object.keys(TABLE_MAP) as ResourceType[]);

    for (const resourceType of typesToQuery) {
      const table = TABLE_MAP[resourceType];

      // Only sync published/approved content that originated locally
      const rows = await db.select().from(table)
        .where(and(
          gt(table.updatedAt, sinceDate),
          or(
            eq(table.visibility, "public"),
            eq(table.reviewStatus, "approved")
          ),
          or(
            isNull(table.originInstanceId),
            eq(table.originInstanceId, ENV.instanceId)
          )
        ))
        .limit(500);

      for (const row of rows) {
        changes.push({
          resourceType,
          action: row.status === "archived" ? "delete" : (row.lastSyncedAt ? "update" : "create"),
          data: getSyncableData(row as Record<string, unknown>, resourceType),
          originId: row.id,
          originInstanceId: ENV.instanceId,
          updatedAt: new Date(row.updatedAt).getTime(),
        });
      }
    }

    return res.json({
      instanceId: ENV.instanceId,
      since,
      changes,
      total: changes.length,
    });
  } catch (error) {
    console.error("[Sync] Changes error:", error);
    return res.status(500).json({ error: "Internal sync error" });
  }
});

// ─── POST /api/sync/pull — Actively pull changes from peer ──────────

syncRouter.post("/pull", authenticatePeer, async (req: Request, res: Response) => {
  try {
    if (!ENV.peerSyncEnabled || !ENV.peerApiUrl) {
      return res.status(400).json({ error: "Peer sync not configured" });
    }

    const since = parseInt(req.body?.since as string) || 0;
    const type = req.body?.type as ResourceType | undefined;

    // Fetch changes from peer
    const url = new URL("/api/sync/changes", ENV.peerApiUrl);
    url.searchParams.set("since", since.toString());
    if (type) url.searchParams.set("type", type);

    const peerResponse = await fetch(url.toString(), {
      headers: { "x-sync-api-key": ENV.peerApiKey },
    });

    if (!peerResponse.ok) {
      return res.status(502).json({ error: `Peer responded with ${peerResponse.status}` });
    }

    const peerData = await peerResponse.json() as { changes: SyncChange[]; total: number };

    if (!peerData.changes || peerData.changes.length === 0) {
      return res.json({ success: true, message: "No changes to pull", pulled: 0 });
    }

    // Process pulled changes (same logic as push receiver)
    const db = getDb();
    const results = { created: 0, updated: 0, skipped: 0, conflicts: 0, errors: 0 };

    for (const change of peerData.changes) {
      try {
        const table = TABLE_MAP[change.resourceType];
        if (!table) { results.errors++; continue; }

        if (change.action === "delete") {
          const existing = await db.select().from(table)
            .where(and(
              eq(table.originInstanceId, change.originInstanceId),
              eq(table.remoteId, change.originId)
            ))
            .limit(1);
          if (existing.length > 0) {
            await db.update(table)
              .set({ status: "archived", lastSyncedAt: new Date() })
              .where(eq(table.id, existing[0].id));
            results.updated++;
          } else {
            results.skipped++;
          }
          continue;
        }

        const existing = await db.select().from(table)
          .where(and(
            eq(table.originInstanceId, change.originInstanceId),
            eq(table.remoteId, change.originId)
          ))
          .limit(1);

        if (existing.length > 0) {
          const localUpdatedAt = existing[0].updatedAt ? new Date(existing[0].updatedAt).getTime() : 0;
          if (change.updatedAt > localUpdatedAt) {
            const updateData = { ...change.data };
            delete updateData.id;
            delete updateData.createdAt;
            (updateData as any).lastSyncedAt = new Date();
            (updateData as any).syncVersion = (existing[0].syncVersion || 0) + 1;
            await db.update(table).set(updateData).where(eq(table.id, existing[0].id));
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          // ASIN dedup: skip if same ASIN already exists locally (any origin)
          const dupId = await checkAsinDuplicate(db, table, change.resourceType, change.data?.asin);
          if (dupId !== null) {
            results.skipped++;
            continue;
          }

          const insertData = { ...change.data };
          delete insertData.id;
          delete insertData.createdAt;
          (insertData as any).originInstanceId = change.originInstanceId;
          (insertData as any).remoteId = change.originId;
          (insertData as any).syncVersion = 1;
          (insertData as any).lastSyncedAt = new Date();
          await db.insert(table).values(insertData as any);
          results.created++;
        }
      } catch (err) {
        console.error(`[Sync] Pull processing error:`, err);
        results.errors++;
      }
    }

    // Log the pull operation
    await db.insert(kbSyncLogs).values({
      syncDirection: "pull",
      resourceType: peerData.changes[0]?.resourceType || "kb_product",
      resourceId: 0,
      syncStatus: results.errors > 0 ? "failed" : "synced",
      peerInstanceId: peerData.changes[0]?.originInstanceId || "unknown",
      itemCount: peerData.changes.length,
      syncedAt: new Date(),
      errorDetail: results.errors > 0 ? `${results.errors} errors occurred` : null,
    });

    return res.json({ success: true, results, pulled: peerData.total });
  } catch (error) {
    console.error("[Sync] Pull error:", error);
    return res.status(500).json({ error: "Internal sync error" });
  }
});

// ─── POST /api/sync/trigger — Manual full sync (pull + push) ────────

syncRouter.post("/trigger", authenticatePeer, async (req: Request, res: Response) => {
  try {
    if (!ENV.peerSyncEnabled || !ENV.peerApiUrl) {
      return res.status(400).json({ error: "Peer sync not configured" });
    }

    const db = getDb();

    // Step 1: Get last sync time
    const lastSync = await db.select().from(kbSyncLogs)
      .where(eq(kbSyncLogs.syncStatus, "synced"))
      .orderBy(desc(kbSyncLogs.syncedAt))
      .limit(1);

    const lastSyncTime = lastSync.length > 0 && lastSync[0].syncedAt
      ? new Date(lastSync[0].syncedAt).getTime()
      : 0;

    // Step 2: Pull from peer
    const pullUrl = new URL("/api/sync/changes", ENV.peerApiUrl);
    pullUrl.searchParams.set("since", lastSyncTime.toString());

    const pullResponse = await fetch(pullUrl.toString(), {
      headers: { "x-sync-api-key": ENV.peerApiKey },
    });

    let pullResults = { created: 0, updated: 0, skipped: 0, conflicts: 0, errors: 0 };

    if (pullResponse.ok) {
      const pullData = await pullResponse.json() as { changes: SyncChange[] };
      if (pullData.changes && pullData.changes.length > 0) {
        // Process pulled changes
        for (const change of pullData.changes) {
          try {
            const table = TABLE_MAP[change.resourceType];
            if (!table) { pullResults.errors++; continue; }

            const existing = await db.select().from(table)
              .where(and(
                eq(table.originInstanceId, change.originInstanceId),
                eq(table.remoteId, change.originId)
              ))
              .limit(1);

            if (existing.length > 0) {
              const localUpdatedAt = existing[0].updatedAt ? new Date(existing[0].updatedAt).getTime() : 0;
              if (change.updatedAt > localUpdatedAt) {
                const updateData = { ...change.data };
                delete updateData.id;
                delete updateData.createdAt;
                (updateData as any).lastSyncedAt = new Date();
                (updateData as any).syncVersion = (existing[0].syncVersion || 0) + 1;
                await db.update(table).set(updateData).where(eq(table.id, existing[0].id));
                pullResults.updated++;
              } else {
                pullResults.skipped++;
              }
            } else {
              // ASIN dedup: skip if same ASIN already exists locally (any origin)
              const dupId = await checkAsinDuplicate(db, table, change.resourceType, change.data?.asin);
              if (dupId !== null) {
                pullResults.skipped++;
                continue;
              }

              const insertData = { ...change.data };
              delete insertData.id;
              delete insertData.createdAt;
              (insertData as any).originInstanceId = change.originInstanceId;
              (insertData as any).remoteId = change.originId;
              (insertData as any).syncVersion = 1;
              (insertData as any).lastSyncedAt = new Date();
              await db.insert(table).values(insertData as any);
              pullResults.created++;
            }
          } catch (err) {
            pullResults.errors++;
          }
        }
      }
    }

    // Step 3: Push local changes to peer
    const localChanges: SyncChange[] = [];
    for (const resourceType of Object.keys(TABLE_MAP) as ResourceType[]) {
      const table = TABLE_MAP[resourceType];
      const rows = await db.select().from(table)
        .where(and(
          gt(table.updatedAt, new Date(lastSyncTime)),
          or(
            eq(table.visibility, "public"),
            eq(table.reviewStatus, "approved")
          ),
          or(
            isNull(table.originInstanceId),
            eq(table.originInstanceId, ENV.instanceId)
          )
        ))
        .limit(500);

      for (const row of rows) {
        localChanges.push({
          resourceType,
          action: row.status === "archived" ? "delete" : "update",
          data: getSyncableData(row as Record<string, unknown>, resourceType),
          originId: row.id,
          originInstanceId: ENV.instanceId,
          updatedAt: new Date(row.updatedAt).getTime(),
        });
      }
    }

    let pushResults = { created: 0, updated: 0, skipped: 0, errors: 0 };
    if (localChanges.length > 0) {
      const pushResponse = await fetch(`${ENV.peerApiUrl}/api/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-api-key": ENV.peerApiKey,
        },
        body: JSON.stringify({
          apiKey: ENV.peerApiKey,
          instanceId: ENV.instanceId,
          changes: localChanges,
        }),
      });

      if (pushResponse.ok) {
        const pushData = await pushResponse.json() as { results: typeof pushResults };
        pushResults = pushData.results;
      }
    }

    // Log the full sync
    await db.insert(kbSyncLogs).values({
      syncDirection: "push",
      resourceType: "kb_product",
      resourceId: 0,
      syncStatus: "synced",
      peerInstanceId: ENV.instanceId,
      itemCount: localChanges.length,
      syncedAt: new Date(),
    });

    return res.json({
      success: true,
      pull: pullResults,
      push: { ...pushResults, totalPushed: localChanges.length },
      lastSyncTime,
    });
  } catch (error) {
    console.error("[Sync] Trigger error:", error);
    return res.status(500).json({ error: "Internal sync error" });
  }
});

// ─── GET /api/sync/status — Query sync status ──────────────────────

syncRouter.get("/status", authenticatePeer, async (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Last successful sync
    const lastSync = await db.select().from(kbSyncLogs)
      .where(eq(kbSyncLogs.syncStatus, "synced"))
      .orderBy(desc(kbSyncLogs.syncedAt))
      .limit(1);

    // Pending conflicts
    const conflicts = await db.select({ count: sql<number>`COUNT(*)` })
      .from(kbSyncLogs)
      .where(eq(kbSyncLogs.syncStatus, "conflict"));

    // Failed syncs in last 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failures = await db.select({ count: sql<number>`COUNT(*)` })
      .from(kbSyncLogs)
      .where(and(
        eq(kbSyncLogs.syncStatus, "failed"),
        gt(kbSyncLogs.createdAt, oneDayAgo)
      ));

    // Total synced items per type
    const syncedCounts: Record<string, number> = {};
    for (const [type, table] of Object.entries(TABLE_MAP)) {
      const result = await db.select({ count: sql<number>`COUNT(*)` })
        .from(table)
        .where(sql`${table.originInstanceId} IS NOT NULL`);
      syncedCounts[type] = Number(result[0]?.count || 0);
    }

    return res.json({
      instanceId: ENV.instanceId,
      companyName: ENV.companyName,
      peerSyncEnabled: ENV.peerSyncEnabled,
      peerApiUrl: ENV.peerApiUrl || null,
      lastSyncAt: lastSync[0]?.syncedAt || null,
      pendingConflicts: Number(conflicts[0]?.count || 0),
      failuresLast24h: Number(failures[0]?.count || 0),
      syncedItemCounts: syncedCounts,
    });
  } catch (error) {
    console.error("[Sync] Status error:", error);
    return res.status(500).json({ error: "Internal sync error" });
  }
});

// ─── GET /api/sync/logs — Query sync logs ───────────────────────────

syncRouter.get("/logs", authenticatePeer, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const logs = await db.select().from(kbSyncLogs)
      .orderBy(desc(kbSyncLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const total = await db.select({ count: sql<number>`COUNT(*)` }).from(kbSyncLogs);

    return res.json({
      logs,
      total: Number(total[0]?.count || 0),
      page,
      limit,
    });
  } catch (error) {
    console.error("[Sync] Logs error:", error);
    return res.status(500).json({ error: "Internal sync error" });
  }
});

// ─── POST /api/sync/usage-report — Receive usage report from peer ───

syncRouter.post("/usage-report", authenticatePeer, async (req: Request, res: Response) => {
  try {
    const { instanceId, instanceName, date, stats } = req.body as UsageReportPayload;
    if (!instanceId || !date || !stats) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const db = getDb();

    // Upsert: update if same instance+date exists, otherwise insert
    const existing = await db.select().from(remoteUsageSnapshots)
      .where(and(
        eq(remoteUsageSnapshots.instanceId, instanceId),
        eq(remoteUsageSnapshots.snapshotDate, date)
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.update(remoteUsageSnapshots)
        .set({
          instanceName: instanceName || instanceId,
          totalUsers: stats.totalUsers,
          activeUsers: stats.activeUsers,
          aiCallCount: stats.aiCallCount,
          aiTokensUsed: stats.aiTokenUsage,
          apiCallCount: stats.apiCallCount,
          storageUsedBytes: Math.round(stats.storageUsageMb * 1024 * 1024),
        })
        .where(eq(remoteUsageSnapshots.id, existing[0].id));
    } else {
      await db.insert(remoteUsageSnapshots).values({
        instanceId,
        instanceName: instanceName || instanceId,
        snapshotDate: date,
        totalUsers: stats.totalUsers,
        activeUsers: stats.activeUsers,
        aiCallCount: stats.aiCallCount,
        aiTokensUsed: stats.aiTokenUsage,
        apiCallCount: stats.apiCallCount,
        storageUsedBytes: Math.round(stats.storageUsageMb * 1024 * 1024),
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[Sync] Usage report error:", error);
    return res.status(500).json({ error: "Internal sync error" });
  }
});

export { syncRouter };
