import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createAssistantConversationQueue } from "./assistantConversationQueue";
import type { AssistantConversationExecutor } from "../repositories/assistantConversations";

const hint = { id: 3, workspaceId: 1, userId: 2, threadId: "a0000000-0000-4000-8000-000000000001", operationId: "a0000000-0000-4000-8000-000000000002" };
function setup(rows: unknown = [hint]) {
  let enabled = true;
  const execute = vi.fn().mockResolvedValue([rows, []]);
  const transaction = vi.fn(async <T>(callback: (tx: AssistantConversationExecutor) => Promise<T>) => callback({ execute }));
  const database = vi.fn().mockResolvedValue({ transaction }), schemaReady = vi.fn().mockResolvedValue(true);
  return { execute, transaction, database, schemaReady, setEnabled: (value: boolean) => { enabled = value; }, queue: createAssistantConversationQueue({ database, schemaReady, enabled: () => enabled }) };
}
describe("private conversation worker discovery", () => {
  it("off means no database read", async () => { const t = setup(); t.setEnabled(false); expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual([]); expect(t.database).not.toHaveBeenCalled(); });
  it("returns only validated hints and binds a bounded, fair cursor", async () => {
    const t = setup(); expect(await t.queue.discover({ afterId: 2, limit: 10 })).toEqual([hint]);
    const query = new MySqlDialect().sqlToQuery(t.execute.mock.calls[0][0]);
    expect(query.params).toEqual([2, 10]);
    expect(query.sql).toContain("lease_expires_at <= NOW(3)");
    expect(query.sql).toContain("'route_dispatched','reply_dispatched'");
    expect(query.sql).not.toMatch(/SELECT \*|request_snapshot|runtime_snapshot|original_bytes|ai_jobs|UPDATE|INSERT/i);
  });
  it("requires actual schema admission before hints", async () => { const t = setup(); t.schemaReady.mockResolvedValue(false); await expect(t.queue.discover({ afterId: 0, limit: 10 })).rejects.toThrow("SCHEMA_UNAVAILABLE"); expect(t.execute).not.toHaveBeenCalled(); });
  it("gate changes during discovery discard hints", async () => { const t = setup(); t.execute.mockImplementation(async () => { t.setEnabled(false); return [[hint], []]; }); expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual([]); });
  it.each([0, 26, -1, 1.5, NaN])("rejects limit %s", async limit => { const t = setup(); await expect(t.queue.discover({ afterId: 0, limit })).rejects.toThrow(); expect(t.database).not.toHaveBeenCalled(); });
  it.each([-1, 2.5, 2_147_483_648])("rejects cursor %s", async afterId => { const t = setup(); await expect(t.queue.discover({ afterId, limit: 1 })).rejects.toThrow(); expect(t.database).not.toHaveBeenCalled(); });
  it.each([
    [{ ...hint, id: 0 }], [{ ...hint, workspaceId: "1" }], [{ ...hint, userId: null }],
    [{ ...hint, threadId: hint.threadId.toUpperCase() }], [{ ...hint, request: "private body" }],
    [hint, hint], [{ ...hint, id: 4 }, hint], [hint, { ...hint, id: 4 }],
  ].map(rows => ({ rows })))("rejects malformed, repeated or nonmonotonic hints %#", async ({ rows }) => { const t = setup(rows); await expect(t.queue.discover({ afterId: 0, limit: 10 })).rejects.toThrow(); });
  it("rejects a stale cursor result or over-limit database response", async () => { const t = setup(); await expect(t.queue.discover({ afterId: 3, limit: 1 })).rejects.toThrow(); const other = setup([hint, { ...hint, id: 4, operationId: "a0000000-0000-4000-8000-000000000003" }]); await expect(other.queue.discover({ afterId: 0, limit: 1 })).rejects.toThrow(); });
});
