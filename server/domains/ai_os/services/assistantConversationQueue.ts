import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "../../../repositories/dbClient";
import { assistantConversationSchemaReady, type AssistantConversationDatabase } from "../repositories/assistantConversations";

const id = z.number().int().positive().max(2_147_483_647);
const hintSchema = z.object({
  id, workspaceId: id, userId: id,
  threadId: z.string().uuid().refine(value => value === value.toLowerCase()),
  operationId: z.string().uuid().refine(value => value === value.toLowerCase()),
}).strict();
export type AssistantConversationQueueHint = z.infer<typeof hintSchema>;
export const assistantConversationWorkerEnabled = () => process.env.ENABLE_ASSISTANT_CONVERSATION_WRITES === "true"
  && process.env.ENABLE_ASSISTANT_CONVERSATION_WORKER === "true";

/** Internal worker discovery only. These identifiers grant no access to a body,
 * attachment or provider; the processor must reacquire current authority and a
 * private lease for each hint. No RPC imports or generic ai_jobs integration. */
export function createAssistantConversationQueue(options: {
  database?: () => Promise<AssistantConversationDatabase>;
  enabled?: () => boolean;
  schemaReady?: typeof assistantConversationSchemaReady;
} = {}) {
  const database = options.database ?? (async () => await requireDb("Private assistant queue") as unknown as AssistantConversationDatabase);
  const enabled = options.enabled ?? assistantConversationWorkerEnabled;
  const schemaReady = options.schemaReady ?? assistantConversationSchemaReady;
  return {
    async discover(input: { afterId: number; limit: number }): Promise<AssistantConversationQueueHint[]> {
      const { afterId, limit } = z.object({ afterId: id.or(z.literal(0)), limit: z.number().int().min(1).max(25) }).strict().parse(input);
      if (!enabled()) return [];
      const db = await database();
      return db.transaction(async tx => {
        if (!enabled()) return [];
        if (!await schemaReady(tx)) throw new Error("ASSISTANT_CONVERSATION_SCHEMA_UNAVAILABLE");
        const raw = await tx.execute(sql`SELECT id, workspace_id AS workspaceId, user_id AS userId,
          thread_id AS threadId, operation_id AS operationId
          FROM assistant_conversation_turns
          WHERE id > ${afterId}
            AND state IN ('queued','route_ready','reply_ready','route_dispatched','reply_dispatched')
            AND (lease_expires_at IS NULL OR lease_expires_at <= NOW(3))
          ORDER BY id ASC LIMIT ${limit}`);
        if (!Array.isArray(raw) || !Array.isArray(raw[0]) || raw[0].length > limit) throw new Error("ASSISTANT_CONVERSATION_QUEUE_INVALID");
        const result = z.array(hintSchema).parse(raw[0]);
        if (result.some((hint, index) => hint.id <= (index ? result[index - 1].id : afterId))
          || new Set(result.map(hint => `${hint.workspaceId}:${hint.userId}:${hint.operationId}`)).size !== result.length) {
          throw new Error("ASSISTANT_CONVERSATION_QUEUE_INVALID");
        }
        return enabled() ? result : [];
      });
    },
  };
}
export const assistantConversationQueue = createAssistantConversationQueue();
