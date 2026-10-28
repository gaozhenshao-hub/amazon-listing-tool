/** Explicit administrator backfill through the same durable queue used after acquisition. */
import { sql } from "drizzle-orm";
import { requireDb, closeDbConnection } from "../server/repositories/dbClient";
import { enqueueAutomaticTags } from "../server/domains/knowledge/automaticTagging";
const actor = Number(process.env.KNOWLEDGE_MAINTENANCE_ACTOR), workspace = Number(process.env.KNOWLEDGE_MAINTENANCE_WORKSPACE);
if (!Number.isSafeInteger(actor) || actor < 1 || !Number.isSafeInteger(workspace) || workspace < 1) throw new Error("Explicit administrator scope required");
try {
  const db = await requireDb("Queue missing knowledge tags");
  const [users] = await db.execute(sql`SELECT role FROM users WHERE id=${actor}`);
  if (!(users as unknown as Array<{role:string}>).some(user => ["admin","super_admin"].includes(user.role))) throw new Error("Administrator required");
  const [sets] = await db.execute(sql`SELECT id,userId FROM kb_image_sets WHERE workspaceId=${workspace} AND status='confirmed' AND visibility<>'private' AND origin_instance_id='unified_amazon_acquisition' ORDER BY id LIMIT 100`);
  for (const set of sets as unknown as Array<{id:number;userId:number}>) {
    const job = await enqueueAutomaticTags({ workspaceId: workspace, userId: set.userId, imageSetId: set.id });
    console.log(JSON.stringify({ imageSetId:set.id, status:job?.status ?? "complete", runId:job?.runId ?? null }));
  }
} finally { await closeDbConnection(); }
