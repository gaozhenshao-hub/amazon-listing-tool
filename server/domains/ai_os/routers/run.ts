import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../../../_core/trpc";
import {
  normalizeSkillExecutionPreset,
  runEmperorSkill,
  type SkillExecutionPreset,
} from "../services/skillRunner";
import { rawExecute } from "../routerContext";

const executionPresetSchema = z.enum(["standard", "quality_first", "batch_background", "evaluation"]);

/**
 * The interactive Skill Library must use the same governed runner as business
 * workflows and Agents. Keeping a second direct HTTP implementation here used
 * to allow prompt, JSON-mode, model routing and human-review metadata to drift.
 */
export const emperorRunRouter = router({
  run: protectedProcedure
    .input(z.object({
      skillSlug: z.string().min(1).max(128),
      context: z.string().optional().default(""),
      emphasis: z.string().optional().default(""),
      variables: z.record(z.string(), z.unknown()).optional().default({}),
      modelOverride: z.string().min(1).max(128).optional(),
      executionPreset: executionPresetSchema.optional().default("standard"),
    }))
    .mutation(async ({ input, ctx }) => {
      const executionPreset: SkillExecutionPreset = normalizeSkillExecutionPreset(input.executionPreset);
      const result = await runEmperorSkill({
        skillSlug: input.skillSlug,
        userId: ctx.user.id,
        workspaceId: (ctx.user as any).defaultWorkspaceId ?? null,
        context: input.context,
        emphasis: input.emphasis,
        variables: input.variables,
        modelOverride: input.modelOverride,
        executionPreset,
      });
      return {
        runId: result.runId,
        status: "succeeded" as const,
        content: result.content,
        parsed: result.parsed,
        durationMs: result.durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costCents: result.costCents,
        skillVersion: Number(result.skillVersion) || 1,
        modelSlug: result.modelSlug,
        provider: result.provider,
        executionPreset: result.executionPreset,
        governance: result.governance,
      };
    }),

  history: protectedProcedure
    .input(z.object({
      skillSlug: z.string().optional(),
      status: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ input, ctx }) => {
      let sql = "SELECT id,runId,skillSlug,skillName,skillVersion,skillPromptHash,skillManifestHash,migrationSource,userId,status,errorMessage,modelSlug,provider,inputTokens,outputTokens,durationMs,costCents,startedAt,completedAt,createdAt FROM emperor_skill_runs WHERE 1=1";
      const params: unknown[] = [];
      if (input.skillSlug) { sql += " AND skillSlug = ?"; params.push(input.skillSlug); }
      if (input.status) { sql += " AND status = ?"; params.push(input.status); }
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      if (!isAdmin) { sql += " AND userId = ?"; params.push(ctx.user.id); }
      sql += " ORDER BY createdAt DESC";
      const offset = (input.page - 1) * input.pageSize;
      sql += ` LIMIT ${input.pageSize} OFFSET ${offset}`;
      const runs = await rawExecute(sql, params);
      return { runs, page: input.page, pageSize: input.pageSize };
    }),

  getDetail: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      const rows = await rawExecute("SELECT * FROM emperor_skill_runs WHERE runId = ? LIMIT 1", [input.runId]);
      const run = rows[0];
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Skill run not found" });
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      if (!isAdmin && run.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      const output = typeof run.output === "string" ? JSON.parse(run.output) : run.output;
      const inputData = typeof run.input === "string" ? JSON.parse(run.input) : run.input;
      const [rootTraceRows, ledgerTraceRows] = await Promise.all([
        rawExecute("SELECT traceId FROM emperor_run_traces WHERE rootRunId=? ORDER BY createdAt DESC LIMIT 2", [input.runId]),
        rawExecute("SELECT DISTINCT traceId FROM emperor_run_ledger_events WHERE entityType='skill_run' AND entityId=? ORDER BY traceId ASC LIMIT 2", [input.runId]),
      ]);
      const traceCandidates = Array.from(new Set([
        ...rootTraceRows.map((row: any) => String(row.traceId || "")).filter(Boolean),
        ...ledgerTraceRows.map((row: any) => String(row.traceId || "")).filter(Boolean),
      ])).slice(0, 2);
      return { ...run, output, input: inputData, traceId: traceCandidates.length === 1 ? traceCandidates[0] : null, traceCandidates };
    }),

  tokenStats: protectedProcedure
    .input(z.object({
      days: z.number().default(30),
      groupBy: z.enum(["day", "skill", "user"]).default("day"),
    }))
    .query(async ({ ctx, input }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      const userFilter = isAdmin ? "" : `AND userId = ${ctx.user.id}`;
      if (input.groupBy === "day") {
        return rawExecute(
          `SELECT DATE(createdAt) as date, SUM(inputTokens+outputTokens) as totalTokens, SUM(costCents) as costCents, SUM(status='failed') as failedRuns, COUNT(*) as runCount FROM emperor_skill_runs WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ${userFilter} GROUP BY DATE(createdAt) ORDER BY date ASC`,
          [input.days],
        );
      }
      if (input.groupBy === "skill") {
        return rawExecute(
          `SELECT skillSlug, skillName, MAX(skillVersion) as latestSkillVersion, SUM(inputTokens+outputTokens) as totalTokens, SUM(costCents) as costCents, SUM(status='failed') as failedRuns, COUNT(*) as runCount, AVG(durationMs) as avgDurationMs FROM emperor_skill_runs WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ${userFilter} GROUP BY skillSlug, skillName ORDER BY totalTokens DESC LIMIT 20`,
          [input.days],
        );
      }
      return rawExecute(
        `SELECT r.userId, u.name as userName, SUM(r.inputTokens+r.outputTokens) as totalTokens, COUNT(*) as runCount FROM emperor_skill_runs r LEFT JOIN users u ON r.userId = u.id WHERE r.createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ${userFilter} GROUP BY r.userId, u.name ORDER BY totalTokens DESC LIMIT 20`,
        [input.days],
      );
    }),
});
