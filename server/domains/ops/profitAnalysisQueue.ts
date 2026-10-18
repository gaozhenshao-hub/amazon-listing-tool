import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "../../repositories/dbClient";
import { profitAnalysisJobSchemaReady, type ProfitAnalysisJobDatabase } from "./profitAnalysisJobRepository";

const id = z.number().int().safe().positive().max(2_147_483_647);
const hintSchema = z.object({
  id,
  workspaceId: id,
  userId: id,
  operationId: z.string().uuid().refine(value => value === value.toLowerCase()),
}).strict();
const inputSchema = z.object({ afterId: id.or(z.literal(0)), limit: z.number().int().min(1).max(25) }).strict();
export type ProfitAnalysisQueueHint = z.infer<typeof hintSchema>;
export const profitAnalysisWorkerEnabled = () => process.env.ENABLE_PROFIT_ANALYSIS_WRITES === "true"
  && process.env.ENABLE_PROFIT_ANALYSIS_WORKER === "true";

export class ProfitAnalysisQueueError extends Error {
  constructor(readonly code: "INVALID" | "SCHEMA_UNAVAILABLE" | "UNAVAILABLE") {
    super(`PROFIT_ANALYSIS_QUEUE_${code}`);
    this.name = "ProfitAnalysisQueueError";
  }
}

/** Internal, read-only discovery. Hints grant no financial access or execution
 * authority: a processor must reacquire current actor/workspace permissions and
 * a private lease. Only lightweight IDs are sorted/read; no snapshot or result
 * body, provider work, journal mutation, generic ai_jobs query or RPC import. */
export function createProfitAnalysisQueue(options: {
  database?: () => Promise<ProfitAnalysisJobDatabase>;
  enabled?: () => boolean;
  schemaReady?: typeof profitAnalysisJobSchemaReady;
} = {}) {
  const database = options.database ?? (async () => await requireDb("Private profit analysis queue") as unknown as ProfitAnalysisJobDatabase);
  const enabled = options.enabled ?? profitAnalysisWorkerEnabled;
  const schemaReady = options.schemaReady ?? profitAnalysisJobSchemaReady;
  return {
    async discover(input: { afterId: number; limit: number }): Promise<ProfitAnalysisQueueHint[]> {
      try {
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success) throw new ProfitAnalysisQueueError("INVALID");
        const { afterId, limit } = parsed.data;
        if (!enabled()) return [];
        const db = await database();
        if (!enabled()) return [];
        const hints = await db.transaction(async tx => {
          if (!enabled()) return [];
          const ready = await schemaReady(tx);
          if (!enabled()) return [];
          if (!ready) throw new ProfitAnalysisQueueError("SCHEMA_UNAVAILABLE");
          const raw = await tx.execute(sql`SELECT id, workspace_id AS workspaceId, user_id AS userId,
            operation_id AS operationId
            FROM ops_profit_analysis_runs
            WHERE id > ${afterId}
              AND state IN ('queued','dispatched','result_ready')
              AND (lease_expires_at IS NULL OR lease_expires_at <= NOW(3))
            ORDER BY id ASC LIMIT ${limit}`);
          if (!enabled()) return [];
          if (!Array.isArray(raw) || !Array.isArray(raw[0]) || raw[0].length > limit) throw new ProfitAnalysisQueueError("INVALID");
          const accepted = z.array(hintSchema).safeParse(raw[0]);
          if (!accepted.success) throw new ProfitAnalysisQueueError("INVALID");
          const result = accepted.data;
          if (result.some((hint, index) => hint.id <= (index ? result[index - 1].id : afterId))
            || new Set(result.map(hint => `${hint.workspaceId}:${hint.userId}:${hint.operationId}`)).size !== result.length) {
            throw new ProfitAnalysisQueueError("INVALID");
          }
          return result;
        });
        // A write-disable arriving while the read transaction finishes must not
        // hand newly discovered hints to the processor. It also checks its gate.
        return enabled() ? hints : [];
      } catch (error) {
        if (error instanceof ProfitAnalysisQueueError) throw error;
        // Never log or attach driver errors, connection strings, SQL or rows.
        throw new ProfitAnalysisQueueError("UNAVAILABLE");
      }
    },
  };
}
export const profitAnalysisQueue = createProfitAnalysisQueue();
