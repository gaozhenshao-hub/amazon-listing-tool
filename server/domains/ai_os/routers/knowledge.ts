import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../../../_core/trpc";
import { rawExecute } from "../routerContext";

export const emperorKnowledgeRouter = router({
  list: protectedProcedure
    .input(z.object({
      memoryType: z.enum(["feedback","fact","project","reference"]).optional(),
      search: z.string().optional(),
      projectId: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ input, ctx }) => {
      let sql = "SELECT id,user_id,project_id,title,content,memory_type,source,tags,is_active,confidence,created_at,updated_at FROM emperor_knowledge WHERE is_active=1";
      const params: any[] = [];
      if (input.memoryType) { sql += " AND memory_type=?"; params.push(input.memoryType); }
      if (input.projectId) { sql += " AND project_id=?"; params.push(input.projectId); }
      if (input.search) { sql += " AND (title LIKE ? OR content LIKE ?)"; params.push(`%${input.search}%`, `%${input.search}%`); }
      sql += " ORDER BY updated_at DESC";
      const offset = (input.page - 1) * input.pageSize;
      sql += ` LIMIT ${input.pageSize} OFFSET ${offset}`;
      const rows = await rawExecute(sql, params);
      const items = rows.map((r: any) => ({
        ...r,
        tags: typeof r.tags === "string" ? JSON.parse(r.tags) : (r.tags ?? []),
        is_active: !!r.is_active,
      }));

      let countSql = "SELECT COUNT(*) as cnt FROM emperor_knowledge WHERE is_active=1";
      const countParams: any[] = [];
      if (input.memoryType) { countSql += " AND memory_type=?"; countParams.push(input.memoryType); }
      if (input.projectId) { countSql += " AND project_id=?"; countParams.push(input.projectId); }
      if (input.search) { countSql += " AND (title LIKE ? OR content LIKE ?)"; countParams.push(`%${input.search}%`, `%${input.search}%`); }
      const countRows = await rawExecute(countSql, countParams);
      return { items, total: countRows[0]?.cnt || 0, page: input.page, pageSize: input.pageSize };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_knowledge WHERE id=? LIMIT 1", [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const r = rows[0];
      return { ...r, tags: typeof r.tags === "string" ? JSON.parse(r.tags) : (r.tags ?? []), is_active: !!r.is_active };
    }),

  upsert: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      title: z.string().min(1).max(500),
      content: z.string().min(1),
      memoryType: z.enum(["feedback","fact","project","reference"]).default("fact"),
      source: z.string().optional(),
      tags: z.array(z.string()).optional().default([]),
      projectId: z.string().optional(),
      confidence: z.number().min(0).max(1).optional().default(1.0),
    }))
    .mutation(async ({ input, ctx }) => {
      const now = Date.now();
      if (input.id) {
        await rawExecute(
          "UPDATE emperor_knowledge SET title=?,content=?,memory_type=?,source=?,tags=?,project_id=?,confidence=?,updated_at=? WHERE id=? AND user_id=?",
          [input.title, input.content, input.memoryType, input.source||null, JSON.stringify(input.tags), input.projectId||null, input.confidence, now, input.id, ctx.user.id]
        );
        return { success: true, id: input.id };
      } else {
        const result = await rawExecute(
          "INSERT INTO emperor_knowledge (user_id,project_id,title,content,memory_type,source,tags,is_active,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)",
          [ctx.user.id, input.projectId||null, input.title, input.content, input.memoryType, input.source||null, JSON.stringify(input.tags), input.confidence, now, now]
        );
        return { success: true, id: (result as any).insertId };
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      if (isAdmin) {
        await rawExecute("UPDATE emperor_knowledge SET is_active=0 WHERE id=?", [input.id]);
      } else {
        await rawExecute("UPDATE emperor_knowledge SET is_active=0 WHERE id=? AND user_id=?", [input.id, ctx.user.id]);
      }
      return { success: true };
    }),

  stats: protectedProcedure.query(async () => {
    const rows = await rawExecute(
      "SELECT memory_type, COUNT(*) as cnt FROM emperor_knowledge WHERE is_active=1 GROUP BY memory_type"
    );
    const result: Record<string, number> = { feedback: 0, fact: 0, project: 0, reference: 0 };
    for (const r of rows) { result[r.memory_type as string] = Number(r.cnt); }
    return result;
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Observability Router
// ─────────────────────────────────────────────────────────────────────────────
