import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  SaihuReportScheduleReadInputSchema,
  SaihuReportScheduleSaveInputSchema,
  SaihuReportSchedulePauseInputSchema,
  SaihuReportScheduleActivateInputSchema,
  SaihuReportScheduleOperationSchema,
  SaihuReportScheduleReceiptSchema,
  SaihuReportScheduleViewSchema,
  SaihuReportScheduleActivationSchema,
  SaihuReportScheduleSourceInputSchema,
  SaihuReportScheduleSourceSchema,
  SaihuReportScheduleListInputSchema,
  SaihuReportScheduleListSchema,
} from "../../shared/saihuReportSchedule";
import { saihuReportScheduleRepository } from "../domains/ops/saihuReportScheduleRepository";
import { saihuReportContextIdentity } from "../domains/ops/saihuReportRepository";
import { SaihuReportError } from "../domains/ops/saihuReportContract";
async function safe<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof SaihuReportError)
      throw new TRPCError({
        code: /DENIED|WORKSPACE/u.test(error.code)
          ? "FORBIDDEN"
          : /CHANGED|CONFLICT/u.test(error.code)
            ? "CONFLICT"
            : "PRECONDITION_FAILED",
        message: `SAIHU_REPORT_${error.code}`,
      });
    if (
      error instanceof TRPCError &&
      ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)
    )
      throw error;
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        error instanceof z.ZodError
          ? "SAIHU_REPORT_SCHEDULE_INVALID"
          : "SAIHU_REPORT_SCHEDULE_OUTCOME_UNKNOWN_CHECK_OR_CANCEL_SAME_OPERATION",
    });
  }
}
export const saihuReportScheduleRouter = router({
  list: protectedProcedure
    .input(SaihuReportScheduleListInputSchema)
    .output(SaihuReportScheduleListSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.list(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  sourceOptions: protectedProcedure
    .input(SaihuReportScheduleSourceInputSchema)
    .output(SaihuReportScheduleSourceSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.sourceOptions(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  read: protectedProcedure
    .input(SaihuReportScheduleReadInputSchema)
    .output(SaihuReportScheduleViewSchema.nullable())
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.read(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  activationPreview: protectedProcedure
    .input(SaihuReportScheduleReadInputSchema)
    .output(SaihuReportScheduleActivationSchema)
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.activationPreview(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  save: protectedProcedure
    .input(SaihuReportScheduleSaveInputSchema)
    .output(SaihuReportScheduleReceiptSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.save(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  pause: protectedProcedure
    .input(SaihuReportSchedulePauseInputSchema)
    .output(SaihuReportScheduleReceiptSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.pause(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  activate: protectedProcedure
    .input(SaihuReportScheduleActivateInputSchema)
    .output(SaihuReportScheduleReceiptSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.activate(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  check: protectedProcedure
    .input(SaihuReportScheduleOperationSchema)
    .output(SaihuReportScheduleReceiptSchema.nullable())
    .query(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.check(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
  cancel: protectedProcedure
    .input(SaihuReportScheduleOperationSchema)
    .output(SaihuReportScheduleReceiptSchema)
    .mutation(({ ctx, input }) =>
      safe(() =>
        saihuReportScheduleRepository.cancel(
          saihuReportContextIdentity(ctx, input.expectedWorkspaceId),
          input
        )
      )
    ),
});
