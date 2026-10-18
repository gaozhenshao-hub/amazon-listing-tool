import {
  SAIHU_REPORT_KIND,
  SaihuReportIdentitySchema,
  SaihuReportUuid,
} from "../../../shared/saihuReportSync";
import { saihuReportRows, type SaihuReportExecutor } from "./saihuReportStore";
import { saihuReportFail } from "./saihuReportContract";

/** Group before LIMIT. A workspace with a large old queue cannot hide every
 * other workspace. Last-served comes from committed claim timestamps, so it
 * survives process restarts and is shared by all workers. LIMIT is one work
 * quantum, not a claim that the complete queue has been enumerated. */
export async function discoverSaihuReportCaptures(
  tx: SaihuReportExecutor,
  limit = 20
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    saihuReportFail("DISCOVERY_LIMIT_INVALID");
  const rows = await saihuReportRows(
    tx,
    "SELECT j.id,j.workspaceId,j.userId,JSON_UNQUOTE(JSON_EXTRACT(j.input,'$.operationId')) AS operationId FROM ai_jobs j JOIN (SELECT workspaceId,MIN(id) AS firstId FROM ai_jobs WHERE kind=? AND projectId IS NULL AND (status='queued' OR (status='running' AND leaseUntil<CURRENT_TIMESTAMP)) GROUP BY workspaceId) ready ON ready.workspaceId=j.workspaceId AND ready.firstId=j.id LEFT JOIN (SELECT workspaceId,MAX(startedAt) AS lastServed FROM ai_jobs WHERE kind=? AND projectId IS NULL GROUP BY workspaceId) served ON served.workspaceId=j.workspaceId WHERE j.kind=? AND j.projectId IS NULL ORDER BY served.lastServed IS NOT NULL,served.lastServed,j.id LIMIT ?",
    [SAIHU_REPORT_KIND, SAIHU_REPORT_KIND, SAIHU_REPORT_KIND, limit],
    limit
  );
  const seen = new Set<number>();
  return rows.map(row => {
    const identity = SaihuReportIdentitySchema.parse({
      workspaceId: row.workspaceId,
      userId: row.userId,
    });
    const operationId = SaihuReportUuid.parse(row.operationId);
    if (
      typeof row.id !== "number" ||
      !Number.isSafeInteger(row.id) ||
      row.id < 1 ||
      seen.has(identity.workspaceId)
    )
      saihuReportFail("DISCOVERY_RESPONSE_INVALID");
    seen.add(identity.workspaceId);
    return { identity, operationId };
  });
}
