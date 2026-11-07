import { MysqlLeaderLock } from "../../_core/leaderLock";
import { rawExecute } from "../ai_os/routerContext";
import * as repository from "../../repositories";
import { hasCompetitorCapacity } from "../../../shared/competitorLimit";
import { TRPCError } from "@trpc/server";

/** Serialize admissions so simultaneous submissions cannot exceed the project cap. */
export async function withCompetitorCaptureAdmission<T>(scope: { workspaceId: number; projectId: number; asin: string }, work: () => Promise<T>): Promise<T> {
  const lock = new MysqlLeaderLock(`listing-capture:${scope.workspaceId}:${scope.projectId}`, "listing-capture");
  try {
    if (!(await lock.acquire(15)).acquired) throw new TRPCError({ code: "CONFLICT", message: "竞品采集正在提交，请稍后重试" });
    const records = await repository.getCompetitorAnalysesByProject(scope.projectId);
    const jobs = await rawExecute(`SELECT DISTINCT asin FROM acquisition_jobs WHERE workspace_id=? AND consumer_type='project_competitor' AND consumer_ref LIKE ? AND deleted_at IS NULL AND status IN ('queued','running','review_required')`,
      [scope.workspaceId, `project-competitor:${scope.projectId}:%`]);
    if (!hasCompetitorCapacity([...records.map(row => row.asin), ...jobs.map(row => String(row.asin))], scope.asin)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "每个项目最多采集 5 个竞品，请先移除不需要的竞品。" });
    }
    return await work();
  } finally {
    await lock.release();
  }
}
