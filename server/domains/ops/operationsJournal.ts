import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { strictTaskDirectory } from "./productTaskReadRepository";
import { currentTaskPartners } from "./productTaskPartners";
import { query } from "./monthlyBoardReadCore";
import { JournalReadSchema, JournalSaveSchema, JournalContentSchema, type JournalRecord, type JournalReadResult } from "../../../shared/operationsJournal";
import { z } from "zod";
import { sql } from "drizzle-orm";

async function execute(tx: DbExecutor, text: string, values: unknown[]) {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) throw new Error("Invalid statement");
  await tx.execute(sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw("")));
}

const error = (message: string, code: "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED" = "FORBIDDEN") => new TRPCError({ code, message });
export function journalCanEdit(actorId: number, ownerId: number, admin: boolean) { return admin || actorId === ownerId; }
export function createOperationsJournalRepository(deps = { database: getDb, permission: assertResourceAction, directory: strictTaskDirectory, partners: currentTaskPartners }) {
  async function run<T>(ctx: TrpcContext, workspaceId: number, write: boolean, work: (tx: DbExecutor, userId: number, admin: boolean, members: { id: number; name: string }[]) => Promise<T>) {
    const user = ctx.user;
    if (!user || user.defaultWorkspaceId !== workspaceId || (ctx.workspaceId !== undefined && ctx.workspaceId !== workspaceId)) throw error("登录状态已变化，请重新打开页面");
    const db = await deps.database(); if (!db) throw error("暂时无法连接数据，请稍后再试", "PRECONDITION_FAILED");
    try {
      return await db.transaction(async tx => {
        const actors = await query(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [user.id]);
        const actor = actors[0];
        if (actors.length !== 1 || actor.role !== user.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) throw error("登录状态已变化，请重新打开页面");
        await deps.permission({ actor: { id: user.id, role: user.role, defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read", workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } });
        await deps.directory(tx, user.role, workspaceId, write ? "edit" : "read");
        if (write) await deps.permission({ actor: { id: user.id, role: user.role, defaultWorkspaceId: workspaceId }, resource: "ops_task", action: "update", workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } });
        const admin = ["admin", "super_admin"].includes(user.role);
        const allowed = admin ? null : (await deps.partners({ tx, identity: { userId: user.id, workspaceId }, all: false })).ids;
        const members = await query(tx, "SELECT DISTINCT u.id,u.name FROM users u JOIN workspace_memberships m ON m.userId=u.id WHERE m.workspaceId=? AND m.status='active' AND u.status='active' AND u.defaultWorkspaceId=? ORDER BY u.id", [workspaceId, workspaceId]);
        return work(tx, user.id, admin, members.filter(row => allowed === null || allowed.includes(Number(row.id))).map(row => ({ id: Number(row.id), name: String(row.name || `成员 ${row.id}`) })));
      });
    } catch (cause) {
      if (cause instanceof TRPCError) throw cause;
      throw error("暂时无法读取或保存，请刷新后重试", "PRECONDITION_FAILED");
    }
  }
  const fields = "DATE_FORMAT(period_date,'%Y-%m-%d') AS date,revision,content,last_request_id AS requestId,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i') AS updatedAt";
  function record(row: Record<string, unknown>): JournalRecord {
    return { date: String(row.date), revision: Number(row.revision), updatedAt: String(row.updatedAt), content: JournalContentSchema.parse(typeof row.content === "string" ? JSON.parse(row.content) : row.content) };
  }
  return {
    options: (ctx: TrpcContext, workspaceId: number) => run(ctx, workspaceId, false, async (_tx, userId, admin, members) => ({ userId, admin, members })),
    read: (ctx: TrpcContext, input: z.infer<typeof JournalReadSchema>): Promise<JournalReadResult> => run(ctx, input.expectedWorkspaceId, false, async (tx, userId, admin, members) => {
      if (!members.some(row => row.id === input.ownerId)) throw error("没有该运营的日报和周计划查看权限");
      const rows = await query(tx, `SELECT ${fields} FROM ops_work_journals WHERE workspace_id=? AND owner_id=? AND ((kind='daily' AND period_date BETWEEN ? AND ?) OR (kind='weekly' AND period_date=?)) ORDER BY period_date LIMIT 9`, [input.expectedWorkspaceId, input.ownerId, input.from, input.to, input.week]);
      const records = rows.map(record);
      return { ownerId: input.ownerId, canEdit: journalCanEdit(userId, input.ownerId, admin), daily: records.filter(row => row.content.kind === "daily"), weekly: records.find(row => row.content.kind === "weekly") ?? null };
    }),
    save: (ctx: TrpcContext, input: z.infer<typeof JournalSaveSchema>) => run(ctx, input.expectedWorkspaceId, true, async (tx, userId, admin, members) => {
      if (!members.some(row => row.id === input.ownerId) || !journalCanEdit(userId, input.ownerId, admin)) throw error("只能编辑自己的日报和周计划");
      const keys = [input.expectedWorkspaceId, input.ownerId, input.content.kind, input.date];
      const rows = await query(tx, `SELECT ${fields} FROM ops_work_journals WHERE workspace_id=? AND owner_id=? AND kind=? AND period_date=? FOR UPDATE`, keys);
      if (rows[0]?.requestId === input.requestId) {
        if (JSON.stringify(record(rows[0]).content) !== JSON.stringify(input.content)) throw error("上次保存仍待确认，请刷新后再编辑", "CONFLICT");
        return record(rows[0]);
      }
      if (Number(rows[0]?.revision ?? 0) !== input.expectedRevision) throw error("内容已被更新，请刷新后再编辑", "CONFLICT");
      const body = JSON.stringify(input.content);
      if (rows.length) await execute(tx, "UPDATE ops_work_journals SET content=?,revision=revision+1,last_request_id=?,updated_by=?,updated_at=CURRENT_TIMESTAMP(3) WHERE workspace_id=? AND owner_id=? AND kind=? AND period_date=?", [body, input.requestId, userId, ...keys]);
      else await execute(tx, "INSERT INTO ops_work_journals (workspace_id,owner_id,kind,period_date,content,last_request_id,updated_by) VALUES (?,?,?,?,?,?,?)", [...keys, body, input.requestId, userId]);
      const saved = await query(tx, `SELECT ${fields} FROM ops_work_journals WHERE workspace_id=? AND owner_id=? AND kind=? AND period_date=?`, keys);
      return record(saved[0]);
    }),
  };
}
export const operationsJournalRepository = createOperationsJournalRepository();
