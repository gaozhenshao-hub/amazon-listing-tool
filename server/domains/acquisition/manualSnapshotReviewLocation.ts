import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { getDb } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { AcquisitionReviewLocationInputSchema, AcquisitionReviewLocationResultSchema,
  type AcquisitionReviewLocationInput } from "../../../shared/acquisitionReviewLocation";
import { parseLegacySnapshotConsumerRef } from "./legacyConsumerContracts";
import { parseImageWorkflowConsumerRef } from "./imageWorkflowProjection";

type Row = Record<string, unknown>;
function fail(reason: string, code: "NOT_FOUND" | "FORBIDDEN" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `ACQUISITION_REVIEW_LOCATION_${reason}` });
}
function statement(text: string, values: unknown[]) {
  const parts = text.split("?"); if (parts.length !== values.length + 1) fail("QUERY_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
/** Metadata-only exact-ID resolver. It neither opens an arbitrary source nor
 * creates a job, a review revision, a signature, or a billable operation. */
export function createManualSnapshotReviewLocation(dependencies: {
  database?: typeof getDb; permission?: typeof assertResourceAction;
} = {}) {
  return { async read(ctx: TrpcContext, raw: AcquisitionReviewLocationInput) {
    try {
      const input = AcquisitionReviewLocationInputSchema.parse(raw), userId = ctx.user?.id;
      if (!Number.isSafeInteger(userId) || !userId || ctx.workspaceId !== input.expectedWorkspaceId) fail("IDENTITY_CHANGED", "FORBIDDEN");
      const workspaceId = input.expectedWorkspaceId, db = await (dependencies.database ?? getDb)();
      if (!db || typeof db.transaction !== "function") fail("TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        async function rows(text: string, values: unknown[]): Promise<Row[]> {
          const result = await tx.execute(statement(text, values));
          if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 2
            || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("READ_INVALID", "INTERNAL_SERVER_ERROR");
          return result[0];
        }
        // Same first lock as manual writers. Holding actor first could deadlock
        // against a writer holding workspace and waiting for that actor.
        const workspaces = await rows("SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [workspaceId]);
        const users = await rows("SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [userId]);
        const actor = users[0];
        if (users.length !== 1 || actor.id !== userId || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId
          || typeof actor.role !== "string" || !actor.role.trim()) fail("IDENTITY_CHANGED", "FORBIDDEN");
        const members = await rows("SELECT userId,workspaceId,status FROM workspace_memberships WHERE userId=? AND workspaceId=? LIMIT 2 FOR SHARE", [userId, workspaceId]);
        if (workspaces.length !== 1 || workspaces[0].id !== workspaceId || workspaces[0].status !== "active"
          || members.length !== 1 || members[0].userId !== userId || members[0].workspaceId !== workspaceId || members[0].status !== "active") fail("MEMBERSHIP_CHANGED", "FORBIDDEN");
        let source: Row | undefined;
        if ("snapshotId" in input) {
          const found = await rows("SELECT id,workspace_id AS workspaceId,job_id AS jobId,asin,marketplace FROM acquisition_source_snapshots WHERE id=? AND workspace_id=? LIMIT 2", [input.snapshotId, workspaceId]);
          if (found.length !== 1) fail("SNAPSHOT_UNAVAILABLE", "NOT_FOUND"); source = found[0];
          if (source.id !== input.snapshotId || source.workspaceId !== workspaceId || !Number.isSafeInteger(source.jobId)) fail("SNAPSHOT_UNAVAILABLE", "NOT_FOUND");
        }
        const jobId = "jobId" in input ? input.jobId : source!.jobId;
        const jobQuery = "SELECT id,workspace_id AS workspaceId,requested_by AS requestedBy,consumer_type AS consumerType,consumer_ref AS consumerRef,asin,marketplace,status,cache_hit_snapshot_id AS cacheHitSnapshotId FROM acquisition_jobs WHERE id=? AND workspace_id=? LIMIT 2";
        const jobs = await rows(jobQuery, [jobId, workspaceId]);
        const job = jobs[0];
        if (jobs.length !== 1 || job.id !== jobId || job.workspaceId !== workspaceId || job.requestedBy !== userId
          || typeof job.consumerRef !== "string" || typeof job.asin !== "string" || !/^[A-Z0-9]{10}$/u.test(job.asin) || job.marketplace !== "US") fail("JOB_UNAVAILABLE", "NOT_FOUND");
        let projectId: number | null = null;
        if (job.consumerType === "project_competitor") {
          const target = parseLegacySnapshotConsumerRef("project_competitor", job.consumerRef);
          if (target.type !== "project_competitor" || target.asin !== job.asin) fail("TARGET_INVALID"); projectId = target.projectId;
        } else if (job.consumerType === "image_workflow") projectId = parseImageWorkflowConsumerRef(job.consumerRef).projectId;
        else if (!["kb_images", "kb_listing", "kb_product", "conversion_collector", "competitor_monitor"].includes(String(job.consumerType))) fail("TARGET_INVALID");
        if (projectId !== null) {
          const parents = await rows("SELECT id,userId,workspaceId FROM projects WHERE id=? FOR SHARE", [projectId]);
          if (parents.length !== 1 || parents[0].id !== projectId || parents[0].userId !== userId || parents[0].workspaceId !== workspaceId) fail("PROJECT_UNAVAILABLE", "NOT_FOUND");
        }
        const lockedJobs = await rows(`${jobQuery} FOR SHARE`, [jobId, workspaceId]);
        if (lockedJobs.length !== 1 || Object.keys(job).some(key => job[key] !== lockedJobs[0][key])) fail("JOB_CHANGED");
        if (source) {
          const locked = await rows("SELECT id,workspace_id AS workspaceId,job_id AS jobId,asin,marketplace FROM acquisition_source_snapshots WHERE id=? AND workspace_id=? LIMIT 2 FOR SHARE", [source.id, workspaceId]);
          if (locked.length !== 1 || Object.keys(source).some(key => source![key] !== locked[0][key])) fail("SNAPSHOT_CHANGED");
        }
        const permission = dependencies.permission ?? assertResourceAction;
        await permission({ actor: { id: userId, role: actor.role, defaultWorkspaceId: workspaceId },
          resource: projectId === null ? "knowledge" : "project", action: "read", workspaceId, projectId,
          resourceId: projectId ?? (job.id as number), ownerUserId: userId,
          authorizationRead: { executor: tx, strict: true, lock: true, lockMode: "share" } });
        if (!source && !["queued", "running"].includes(String(job.status))) {
          if (job.cacheHitSnapshotId !== null) {
            // Cached sources belong to their original consumer. Reuse is not
            // permission to edit a snapshot for a different target or owner.
            const confirmed = await rows("SELECT id,snapshot_id AS snapshotId FROM acquisition_confirmed_snapshots WHERE id=? AND workspace_id=? LIMIT 2 FOR SHARE", [job.cacheHitSnapshotId, workspaceId]);
            if (confirmed.length !== 1 || confirmed[0].id !== job.cacheHitSnapshotId) fail("SNAPSHOT_UNAVAILABLE", "NOT_FOUND");
            const found = await rows("SELECT id,workspace_id AS workspaceId,job_id AS jobId,asin,marketplace FROM acquisition_source_snapshots WHERE id=? AND workspace_id=? LIMIT 2 FOR SHARE", [confirmed[0].snapshotId, workspaceId]);
            if (found.length !== 1) fail("SNAPSHOT_UNAVAILABLE", "NOT_FOUND"); source = found[0];
            const originals = await rows("SELECT id,workspace_id AS workspaceId,requested_by AS requestedBy,consumer_type AS consumerType,consumer_ref AS consumerRef FROM acquisition_jobs WHERE id=? AND workspace_id=? LIMIT 2 FOR SHARE", [source.jobId, workspaceId]);
            if (originals.length !== 1 || originals[0].id !== source.jobId || originals[0].requestedBy !== userId || originals[0].workspaceId !== workspaceId
              || originals[0].consumerType !== job.consumerType || originals[0].consumerRef !== job.consumerRef) fail("CACHE_TARGET_DIFFERS", "FORBIDDEN");
          } else {
            const found = await rows("SELECT id,workspace_id AS workspaceId,job_id AS jobId,asin,marketplace FROM acquisition_source_snapshots WHERE job_id=? AND workspace_id=? ORDER BY id DESC LIMIT 1 FOR SHARE", [job.id, workspaceId]);
            if (found.length > 1) fail("READ_INVALID", "INTERNAL_SERVER_ERROR"); source = found[0];
          }
        }
        if (source && (source.workspaceId !== workspaceId || source.asin !== job.asin || source.marketplace !== job.marketplace)) fail("SNAPSHOT_UNAVAILABLE", "NOT_FOUND");
        return AcquisitionReviewLocationResultSchema.parse({ identity: { userId, workspaceId }, jobId: job.id, status: job.status,
          snapshotId: ["queued", "running"].includes(String(job.status)) ? null : source?.id ?? null, projectId });
      });
    } catch (error) {
      if (error instanceof TRPCError && /^ACQUISITION_REVIEW_LOCATION_[A-Z_]+$/u.test(error.message)) throw error;
      if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("ACCESS_DENIED", "FORBIDDEN");
      fail("READ_FAILED", "INTERNAL_SERVER_ERROR");
    }
  } };
}
export const manualSnapshotReviewLocation = createManualSnapshotReviewLocation();
