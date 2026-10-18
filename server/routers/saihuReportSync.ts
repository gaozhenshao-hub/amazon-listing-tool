import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  SaihuReportPreviewInputSchema,
  SaihuReportStartInputSchema,
  SaihuReportOperationInputSchema,
  SaihuReportHistoryInputSchema,
  SaihuReportInspectInputSchema,
  SaihuReportApplyInputSchema,
  SaihuReportApplyOperationInputSchema,
} from "../../shared/saihuReportSync";
import {
  saihuReportRepository,
  saihuReportContextIdentity,
} from "../domains/ops/saihuReportRepository";
import { SaihuReportError } from "../domains/ops/saihuReportContract";

async function safe<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof SaihuReportError)
      throw new TRPCError({
        code: /DENIED|WORKSPACE/u.test(error.code)
          ? "FORBIDDEN"
          : /CHANGED|CONFLICT|PENDING|EFFECTIVE/u.test(error.code)
            ? "CONFLICT"
            : "PRECONDITION_FAILED",
        message: `SAIHU_REPORT_${error.code}`,
      });
    if (error instanceof z.ZodError)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "SAIHU_REPORT_SOURCE_INVALID",
      });
    if (
      error instanceof TRPCError &&
      ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)
    )
      throw new TRPCError({
        code: error.code,
        message: "SAIHU_REPORT_ACCESS_DENIED",
      });
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "SAIHU_REPORT_OUTCOME_UNKNOWN_CHECK_OR_CANCEL_SAME_OPERATION",
    });
  }
}
export const saihuReportSyncRouter = router({
  preview: protectedProcedure
    .input(SaihuReportPreviewInputSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.preview(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input.scope
        )
      )
    ),
  start: protectedProcedure
    .input(SaihuReportStartInputSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.start(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  check: protectedProcedure
    .input(SaihuReportOperationInputSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.check(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  cancel: protectedProcedure
    .input(SaihuReportOperationInputSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.cancel(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  history: protectedProcedure
    .input(SaihuReportHistoryInputSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.history(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input.cursor,
          input.limit
        )
      )
    ),
  inspect: protectedProcedure
    .input(SaihuReportInspectInputSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.inspect(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  applyPreview: protectedProcedure
    .input(SaihuReportApplyInputSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.apply(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  applyCheck: protectedProcedure
    .input(SaihuReportApplyOperationInputSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.applyCheck(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  applyCancel: protectedProcedure
    .input(SaihuReportApplyOperationInputSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.applyCancel(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  revoke: protectedProcedure
    .input(SaihuReportApplyInputSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.revoke(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  revokeCheck: protectedProcedure
    .input(SaihuReportApplyOperationInputSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.revokeCheck(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  revokeCancel: protectedProcedure
    .input(SaihuReportApplyOperationInputSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.revokeCancel(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  dailyOverview: protectedProcedure
    .input(
      z
        .object({
          expectedWorkspaceId: z.number().int().positive(),
          marketplace: z.string().max(50).default("ALL"),
          weeks: z.number().int().min(1).max(52).default(12),
        })
        .strict()
    )
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportRepository.dailyOverview(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input.marketplace,
          input.weeks
        )
      )
    ),
});
