import { sql } from "drizzle-orm";
import { requireDb, closeDbConnection } from "../server/repositories/dbClient";
import { planningRows } from "../server/domains/listing/imagePlanningStore";
import { imageDocumentStatus } from "../server/domains/listing/imageDocument";
try {
  const db = await requireDb("verify image plan review");
  for (const projectId of [1, 15]) {
    const [project] = await planningRows(db, sql`SELECT userId,workspaceId FROM projects WHERE id=${projectId}`);
    if (!project) continue;
    const status = await imageDocumentStatus({ projectId, userId: Number(project.userId), workspaceId: Number(project.workspaceId) });
    console.log(JSON.stringify({ projectId, revision: status.revision, locked: status.locked,
      candidate: status.candidate ? { stale: status.candidate.stale, reason: status.candidate.staleReason, preservedImages: status.candidate.preservedImages } : null,
      planImages: status.outline.groups.flatMap(g => g.items).length }));
  }
} finally { await closeDbConnection(); }
