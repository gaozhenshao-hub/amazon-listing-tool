import { and, eq } from "drizzle-orm";
import { devPanoramaMarketInsights } from "../../../../drizzle/schema";
import { getDb } from "../../../repositories/dbClient";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export async function getMarketInsight(projectId: number) {
  const db = await database();
  const rows = await db.select().from(devPanoramaMarketInsights)
    .where(eq(devPanoramaMarketInsights.projectId, projectId)).limit(1);
  return rows[0] || null;
}

export async function claimMarketInsightRun(input: {
  workspaceId?: number | null;
  projectId: number;
  userId: number;
  runId: string;
}) {
  const db = await database();
  await db.insert(devPanoramaMarketInsights).values({
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId,
    userId: input.userId,
    status: "queued",
    runId: input.runId,
    runProgress: 5,
    runError: null,
    runStartedAt: new Date(),
    runCompletedAt: null,
    confirmedAt: null,
    confirmedBy: null,
  }).onDuplicateKeyUpdate({
    set: {
      workspaceId: input.workspaceId ?? null,
      userId: input.userId,
      status: "queued",
      runId: input.runId,
      runProgress: 5,
      runError: null,
      runStartedAt: new Date(),
      runCompletedAt: null,
      confirmedAt: null,
      confirmedBy: null,
    },
  });
  return getMarketInsight(input.projectId);
}

export async function updateMarketInsightForRun(
  projectId: number,
  runId: string,
  values: Partial<typeof devPanoramaMarketInsights.$inferInsert>,
) {
  const db = await database();
  const result = await db.update(devPanoramaMarketInsights).set(values).where(and(
    eq(devPanoramaMarketInsights.projectId, projectId),
    eq(devPanoramaMarketInsights.runId, runId),
  ));
  return Number((result as any)?.[0]?.affectedRows ?? (result as any)?.rowsAffected ?? 0) > 0;
}

export async function updateMarketInsight(
  projectId: number,
  values: Partial<typeof devPanoramaMarketInsights.$inferInsert>,
) {
  const db = await database();
  await db.update(devPanoramaMarketInsights).set(values)
    .where(eq(devPanoramaMarketInsights.projectId, projectId));
  return getMarketInsight(projectId);
}
