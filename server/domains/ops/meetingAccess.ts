import { and, eq, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { meetingRecords, users } from "../../../drizzle/schema";
import { ADMIN_ROLES } from "../../../shared/const";
import { readMeetingNotes } from "../../../shared/meetingNotes";
import { getDb } from "../../repositories/dbClient";

type Actor = { id: number; role: string };
export function canReadMeeting(
  actor: Actor,
  record: { userId: number; extractedTasks: unknown }
) {
  return (
    (ADMIN_ROLES as readonly string[]).includes(actor.role) ||
    record.userId === actor.id ||
    !!readMeetingNotes(record.extractedTasks)?.participants?.some(
      member => member.id === actor.id
    )
  );
}
export function meetingReadCondition(actor: Actor, workspaceId: number) {
  return and(
    eq(meetingRecords.workspaceId, workspaceId),
    (ADMIN_ROLES as readonly string[]).includes(actor.role)
      ? undefined
      : or(
          eq(meetingRecords.userId, actor.id),
          sql`CASE WHEN JSON_VALID(${meetingRecords.extractedTasks}) THEN JSON_CONTAINS(JSON_EXTRACT(${meetingRecords.extractedTasks}, '$.participants'), JSON_OBJECT('id', ${actor.id})) ELSE 0 END = 1`
        )
  );
}
export async function requireMeetingAccess(
  actor: Actor,
  workspaceId: number,
  id: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "会议服务暂不可用",
    });
  const [record] = await db
    .select()
    .from(meetingRecords)
    .where(
      and(meetingReadCondition(actor, workspaceId), eq(meetingRecords.id, id))
    )
    .limit(1);
  if (!record)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "会议记录不存在或无权访问",
    });
  return record;
}
export async function meetingMembers(workspaceId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "会议服务暂不可用",
    });
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.defaultWorkspaceId, workspaceId),
        eq(users.status, "active"),
        sql`${users.role} IN ('super_admin','admin','ops_manager','ops_specialist')`,
        sql`EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.userId=${users.id} AND m.workspaceId=${workspaceId} AND m.status='active')`
      )
    )
    .orderBy(users.id);
}
export async function validateMeetingParticipants(
  workspaceId: number,
  ids: number[]
) {
  const members = await meetingMembers(workspaceId);
  const selected = members.filter(m => ids.includes(m.id));
  if (!ids.length || selected.length !== ids.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "参会人员已变更，请重新选择",
    });
  return selected.map(m => ({ id: m.id, name: m.name || `成员 ${m.id}` }));
}
