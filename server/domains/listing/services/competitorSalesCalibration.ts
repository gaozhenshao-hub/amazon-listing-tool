import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import { CompetitorManualSalesSchema, CompetitorSalesCalibrationInputSchema, type CompetitorSalesCalibrationInput } from "../../../../shared/competitorSales";
import { calibrateCompetitorSales } from "../../../repositories/project/projectAssetRepository";
import { competitorReviewWorkspace, competitorWithRevision } from "./competitorSummaryReview";

export function salesCalibrationWritable(): boolean { return process.env.ENABLE_LISTING_SALES_CALIBRATION_WRITES === "true"; }

/** Human-only mutation; actor/time cannot be supplied by the client. The
 * repository owns the real project/row locks, complete CAS and invalidation. */
export function createCompetitorSalesCalibrationService(dependencies: {
  save?: typeof calibrateCompetitorSales; enabled?: () => boolean; now?: () => Date;
} = {}) {
  const save = dependencies.save ?? calibrateCompetitorSales, enabled = dependencies.enabled ?? salesCalibrationWritable, now = dependencies.now ?? (() => new Date());
  return { async calibrate(ctx: TrpcContext, raw: CompetitorSalesCalibrationInput) {
    const input = CompetitorSalesCalibrationInputSchema.parse(raw), workspaceId = competitorReviewWorkspace(ctx);
    if (workspaceId !== input.expectedWorkspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "COMPETITOR_SALES_WORKSPACE_CHANGED" });
    if (!enabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "COMPETITOR_SALES_WRITES_DISABLED" });
    const manual = input.value === null ? null : CompetitorManualSalesSchema.parse({ version: 1, value: input.value, sourceNote: input.sourceNote,
      updatedAt: now().toISOString(), updatedBy: ctx.user!.id });
    const saved = await save(input.analysisId, manual, { projectId: input.projectId, expectedRevision: input.expectedRevision, userId: ctx.user!.id, workspaceId });
    return { ...competitorWithRevision(saved), salesCalibrationWritable: enabled(), identity: { userId: ctx.user!.id, workspaceId } };
  } };
}
export const competitorSalesCalibration = createCompetitorSalesCalibrationService();
