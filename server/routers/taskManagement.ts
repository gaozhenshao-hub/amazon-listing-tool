import { meetingProcedure } from "../domains/ops/meetingProcedure";
import { meetingMembers, requireMeetingAccess, meetingReadCondition, validateMeetingParticipants } from "../domains/ops/meetingAccess";
import { meetingDateSchema, meetingTitle, meetingParticipantIdsSchema, meetingSubjectSchema } from "../../shared/meetingNotes";
import { analyzeMeetingNotes } from "../domains/ops/meetingNotes";
import { currentOpsWorkspaceId } from "../domains/ops/workspaceContext";
import { opsWorkspaceCondition } from "../repositories/ops";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";
import { getDb } from "../repositories/dbClient";
import { teamTasks, meetingRecords, users } from "../../drizzle/schema";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import { invokeBusinessSkill } from "../domains/ai_os/services/businessSkillGateway";
import { transcribeAudio } from "../_core/voiceTranscription";
import { paraformerConfig } from "../domains/ops/paraformer";
import { meetingAudioDirectory } from "../domains/ops/meetingAudioStorage";
import { resumeMeetingAudio } from "../domains/ops/meetingAudioService";

// Auxiliary meeting and reminder tools. Task reads and writes are owned by
// productTaskRead/productTaskWrite; no second task CRUD implementation.

import { ADMIN_ROLES } from "../../shared/const";
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!(ADMIN_ROLES as readonly string[]).includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "管理员工具" });
  return next();
});

export const taskManagementRouter = router({
  meetingMembers: meetingProcedure.query(() => meetingMembers(currentOpsWorkspaceId())),
  meetingAudioStatus: meetingProcedure.query(async () => {
    try { await paraformerConfig(currentOpsWorkspaceId()); await meetingAudioDirectory(); return {configured:true}; }
    catch { return {configured:false}; }
  }),
  resumeMeetingAudio: meetingProcedure.input(z.object({id:z.number().int().positive()})).mutation(async ({ctx,input})=>{ await requireMeetingAccess(ctx.user,currentOpsWorkspaceId(),input.id); return resumeMeetingAudio(currentOpsWorkspaceId(),input.id); }),
  saveMeetingNotes: meetingProcedure.input(z.object({ date: meetingDateSchema, participantIds: meetingParticipantIdsSchema, title: meetingSubjectSchema, text: z.string().trim().min(10).max(18000) })).mutation(async ({ctx,input}) => {
    const db=await getDb();
    if(!db) throw new TRPCError({code:"INTERNAL_SERVER_ERROR",message:"会议服务暂不可用"});
    const participants = await validateMeetingParticipants(currentOpsWorkspaceId(),input.participantIds);
    const [result]=await db.insert(meetingRecords).values({workspaceId:currentOpsWorkspaceId(),userId:ctx.user.id,title:meetingTitle(input.date,input.title),transcript:input.text,status:"done",extractedTasks:JSON.stringify({version:2,date:input.date,participants,titleSource:input.title ? "manual" : "auto",summary:"",tasks:[],tasksExtracted:false})});
    return {id:result.insertId};
  }),
  analyzeMeetingNotes: meetingProcedure.input(z.object({id:z.number().int().positive(),mode:z.enum(["summary","tasks"])})).mutation(async ({ctx,input}) => { await requireMeetingAccess(ctx.user,currentOpsWorkspaceId(),input.id); return analyzeMeetingNotes({userId:ctx.user.id,workspaceId:currentOpsWorkspaceId()},input.id,input.mode); }),

  createMeetingRecord: adminProcedure
    .input(z.object({
      title: z.string().optional(),
      audioUrl: z.string(), // S3 URL of uploaded audio
      duration: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const [result] = await db.insert(meetingRecords).values({
        userId: ctx.user.id,
        title: input.title || `会议录音 ${new Date().toLocaleDateString("zh-CN")}`,
        audioUrl: input.audioUrl,
        duration: input.duration,
        status: "uploading",
      });

      return { id: result.insertId };
    }),

  /** List meeting records */
  listMeetingRecords: meetingProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).optional().default(20),
      offset: z.number().min(0).optional().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const records = await db.select().from(meetingRecords)
        .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), meetingReadCondition(ctx.user, currentOpsWorkspaceId())))
        .orderBy(desc(meetingRecords.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return records;
    }),

  /** Get a single meeting record */
  getMeetingRecord: meetingProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const [record] = await db.select().from(meetingRecords)
        .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), and(meetingReadCondition(ctx.user, currentOpsWorkspaceId()), eq(meetingRecords.id, input.id))));

      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting record not found" });
      return record;
    }),

  /** Transcribe meeting audio */
  transcribeMeeting: adminProcedure
    .input(z.object({ meetingId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const [record] = await db.select().from(meetingRecords)
        .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, input.meetingId)));

      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting record not found" });
      if (!record.audioUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "No audio URL" });
      if(record.audioUrl.startsWith("meeting-audio:"))throw new TRPCError({code:"BAD_REQUEST",message:"请使用会议记录中的继续语音识别按钮"});

      // Update status to transcribing
      await db.update(meetingRecords)
        .set({ status: "transcribing" })
        .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, input.meetingId)));

      try {
        const result = await transcribeAudio({
          audioUrl: record.audioUrl,
          language: "zh",
          prompt: "这是一段亚马逊运营团队的会议录音，可能涉及产品运营、广告优化、库存管理、Listing优化等话题。请准确转录。",
        });

        if ("error" in result) {
          await db.update(meetingRecords)
            .set({ status: "error", errorMessage: result.error })
            .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, input.meetingId)));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
        }

        await db.update(meetingRecords)
          .set({ transcript: result.text, status: "extracting" })
          .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, input.meetingId)));

        return { transcript: result.text };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        await db.update(meetingRecords)
          .set({ status: "error", errorMessage: err.message })
          .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, input.meetingId)));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }
    }),

  /** Extract tasks from meeting transcript using AI */
  extractTasksFromTranscript: adminProcedure
    .input(z.object({
      meetingId: z.number().optional(),
      transcript: z.string().min(10),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Get team members for assignee matching
      const allUsers = await db.select({ id: users.id, name: users.name }).from(users)
        .where(eq(users.defaultWorkspaceId, currentOpsWorkspaceId()));
      const teamMemberNames = allUsers.map(u => u.name).filter(Boolean);

      const systemPrompt = `你是一个专业的亚马逊运营团队会议助手。你的任务是从会议记录文本中提取出具体的行动任务。

## 提取规则：
1. 每个任务必须是一个具体的、可执行的行动项
2. 尽量识别出负责人（从上下文或直接提到的人名中推断）
3. 识别任务类型/分类（如：Listing优化、广告调整、库存管理、图片更新、竞品分析、定价策略、客服处理、物流跟进等）
4. 如果提到了截止日期或时间节点，请提取出来
5. 根据紧急程度和重要性判断优先级
6. 如果提到了预估工时，请提取

## 团队成员列表（用于匹配负责人）：
${teamMemberNames.length > 0 ? teamMemberNames.join("、") : "暂无已知成员，请从文本中提取人名"}

## 输出格式要求：
返回JSON数组，每个元素包含：
- title: 任务标题（简洁明了，20字以内）
- description: 任务详细描述（包含具体要求和背景信息）
- assigneeName: 负责人姓名（如无法确定则为null）
- category: 任务分类（从以下选择：Listing优化、广告调整、库存管理、图片更新、竞品分析、定价策略、客服处理、物流跟进、数据分析、其他）
- priority: 优先级（urgent/high/medium/low）
- dueDate: 截止日期（YYYY-MM-DD格式，如无法确定则为null）
- estimatedHours: 预估工时（数字字符串，如无法确定则为null）`;

      try {
      // [Emperor] 优先调用 Emperor Skill: analysis.comparison.summary





        const response = await invokeBusinessSkill({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `请从以下会议记录中提取行动任务：\n\n${input.transcript}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "extracted_tasks",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "任务标题" },
                        description: { type: "string", description: "任务详细描述" },
                        assigneeName: { type: ["string", "null"], description: "负责人姓名" },
                        category: { type: "string", description: "任务分类" },
                        priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "优先级" },
                        dueDate: { type: ["string", "null"], description: "截止日期 YYYY-MM-DD" },
                        estimatedHours: { type: ["string", "null"], description: "预估工时" },
                      },
                      required: ["title", "description", "assigneeName", "category", "priority", "dueDate", "estimatedHours"],
                      additionalProperties: false,
                    },
                  },
                  summary: { type: "string", description: "会议摘要" },
                },
                required: ["tasks", "summary"],
                additionalProperties: false,
              },
            },
          },
        });

        const rawContent = response.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error("AI returned empty response");
        const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

        const parsed = JSON.parse(content);

        // Save extracted tasks to meeting record
        if (input.meetingId) {
          await db.update(meetingRecords)
            .set({
              extractedTasks: JSON.stringify(parsed),
              status: "done",
            })
            .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, input.meetingId)));
        }

        return parsed as {
          tasks: Array<{
            title: string;
            description: string;
            assigneeName: string | null;
            category: string;
            priority: "urgent" | "high" | "medium" | "low";
            dueDate: string | null;
            estimatedHours: string | null;
          }>;
          summary: string;
        };
      } catch (err: any) {
        if (input.meetingId) {
          await db.update(meetingRecords)
            .set({ status: "error", errorMessage: err.message })
            .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, input.meetingId)));
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI extraction failed: ${err.message}` });
            }
    }),

  /** Full pipeline: transcribe + extract in one call (for direct text input) */
  extractTasksFromText: adminProcedure
    .input(z.object({
      text: z.string().min(10),
      title: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Create a meeting record for tracking
      const [record] = await db.insert(meetingRecords).values({
        userId: ctx.user.id,
        title: input.title || `文本提取 ${new Date().toLocaleDateString("zh-CN")}`,
        transcript: input.text,
        status: "extracting",
      });
      const meetingId = record.insertId;

      // Get team members
      const allUsers = await db.select({ id: users.id, name: users.name }).from(users)
        .where(eq(users.defaultWorkspaceId, currentOpsWorkspaceId()));
      const teamMemberNames = allUsers.map(u => u.name).filter(Boolean);

      const systemPrompt = `你是一个专业的亚马逊运营团队会议助手。你的任务是从会议记录/笔记文本中提取出具体的行动任务。

## 提取规则：
1. 每个任务必须是一个具体的、可执行的行动项
2. 尽量识别出负责人（从上下文或直接提到的人名中推断）
3. 识别任务类型/分类（如：Listing优化、广告调整、库存管理、图片更新、竞品分析、定价策略、客服处理、物流跟进等）
4. 如果提到了截止日期或时间节点，请提取出来
5. 根据紧急程度和重要性判断优先级

## 团队成员列表：
${teamMemberNames.length > 0 ? teamMemberNames.join("、") : "暂无已知成员，请从文本中提取人名"}

## 输出格式要求：
返回JSON，包含tasks数组和summary摘要。`;

      try {
      // [Emperor] 优先调用 Emperor Skill: analysis.comparison.summary





        const response = await invokeBusinessSkill({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `请从以下文本中提取行动任务：\n\n${input.text}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "extracted_tasks",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        assigneeName: { type: ["string", "null"] },
                        category: { type: "string" },
                        priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
                        dueDate: { type: ["string", "null"] },
                        estimatedHours: { type: ["string", "null"] },
                      },
                      required: ["title", "description", "assigneeName", "category", "priority", "dueDate", "estimatedHours"],
                      additionalProperties: false,
                    },
                  },
                  summary: { type: "string" },
                },
                required: ["tasks", "summary"],
                additionalProperties: false,
              },
            },
          },
        });

        const rawContent = response.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error("AI returned empty response");
        const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

        const parsed = JSON.parse(content);

        await db.update(meetingRecords)
          .set({ extractedTasks: JSON.stringify(parsed), status: "done" })
          .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, meetingId)));

        return { meetingId, ...parsed };
      } catch (err: any) {
        await db.update(meetingRecords)
          .set({ status: "error", errorMessage: err.message })
          .where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, meetingId)));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI extraction failed: ${err.message}` });
            }
    }),

  /** Delete meeting record */
  deleteMeetingRecord: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      await db.delete(meetingRecords).where(opsWorkspaceCondition(meetingRecords, currentOpsWorkspaceId(), eq(meetingRecords.id, input.id)));
      return { deleted: true };
    }),

  /** Scheduled reminder execution remains available to administrators. */
  triggerReminderCheck: adminProcedure
    .mutation(async () => {
      const { checkTodoReminders } = await import("../todoReminder");
      return checkTodoReminders();
    }),

  /** Update reminder settings for a task */
  updateReminderSettings: adminProcedure
    .input(z.object({
      taskId: z.number().int().positive().max(2147483647),
      reminderEnabled: z.number().int().min(0).max(1),
      reminderDays: z.array(z.number().int().min(0).max(365)).min(1).max(30).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [task] = await db.select({ id: teamTasks.id }).from(teamTasks)
        .where(opsWorkspaceCondition(teamTasks, currentOpsWorkspaceId(), eq(teamTasks.id, input.taskId))).limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "当前工作区不存在此任务" });
      const updates: Record<string, unknown> = {
        reminderEnabled: input.reminderEnabled,
      };
      if (input.reminderDays) {
        updates.reminderDays = JSON.stringify(input.reminderDays);
      }
      await db.update(teamTasks).set(updates).where(opsWorkspaceCondition(teamTasks, currentOpsWorkspaceId(), eq(teamTasks.id, input.taskId)));
      return { updated: true };
    }),

  /** Get overdue and upcoming tasks summary for dashboard */
  getReminderSummary: adminProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const today = new Date().toISOString().slice(0, 10);
      const threeDaysLater = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const sevenDaysLater = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      // Overdue tasks (due date < today, not done)
      const overdueTasks = await db.select().from(teamTasks)
        .where(opsWorkspaceCondition(teamTasks, currentOpsWorkspaceId(), and(
          sql`${teamTasks.status} != 'done'`,
          sql`${teamTasks.dueDate} IS NOT NULL AND ${teamTasks.dueDate} != ''`,
          sql`${teamTasks.dueDate} < ${today}`,
        )))
        .orderBy(asc(sql`${teamTasks.dueDate}`));

      // Due within 3 days
      const dueSoonTasks = await db.select().from(teamTasks)
        .where(opsWorkspaceCondition(teamTasks, currentOpsWorkspaceId(), and(
          sql`${teamTasks.status} != 'done'`,
          sql`${teamTasks.dueDate} IS NOT NULL AND ${teamTasks.dueDate} != ''`,
          sql`${teamTasks.dueDate} >= ${today}`,
          sql`${teamTasks.dueDate} <= ${threeDaysLater}`,
        )))
        .orderBy(asc(sql`${teamTasks.dueDate}`));

      // Due within 7 days (but after 3 days)
      const dueThisWeekTasks = await db.select().from(teamTasks)
        .where(opsWorkspaceCondition(teamTasks, currentOpsWorkspaceId(), and(
          sql`${teamTasks.status} != 'done'`,
          sql`${teamTasks.dueDate} IS NOT NULL AND ${teamTasks.dueDate} != ''`,
          sql`${teamTasks.dueDate} > ${threeDaysLater}`,
          sql`${teamTasks.dueDate} <= ${sevenDaysLater}`,
        )))
        .orderBy(asc(sql`${teamTasks.dueDate}`));

      return {
        overdue: overdueTasks.map(t => ({
          id: t.id,
          title: t.title,
          assigneeName: t.assigneeName,
          dueDate: t.dueDate,
          priority: t.priority,
          status: t.status,
          category: t.category,
          daysOverdue: Math.floor((Date.now() - new Date(t.dueDate + "T00:00:00Z").getTime()) / 86400000),
        })),
        dueSoon: dueSoonTasks.map(t => ({
          id: t.id,
          title: t.title,
          assigneeName: t.assigneeName,
          dueDate: t.dueDate,
          priority: t.priority,
          status: t.status,
          category: t.category,
          daysUntilDue: Math.max(0, Math.floor((new Date(t.dueDate + "T00:00:00Z").getTime() - Date.now()) / 86400000)),
        })),
        dueThisWeek: dueThisWeekTasks.map(t => ({
          id: t.id,
          title: t.title,
          assigneeName: t.assigneeName,
          dueDate: t.dueDate,
          priority: t.priority,
          status: t.status,
          category: t.category,
          daysUntilDue: Math.floor((new Date(t.dueDate + "T00:00:00Z").getTime() - Date.now()) / 86400000),
        })),
        counts: {
          overdue: overdueTasks.length,
          dueSoon: dueSoonTasks.length,
          dueThisWeek: dueThisWeekTasks.length,
        },
      };
    }),

  /** Get notification history for tasks */
  getTaskNotifications: adminProcedure
    .input(z.object({
      taskId: z.number().optional(),
      limit: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { notifications } = await import("../../drizzle/schema");
      const conditions = [
        eq(notifications.userId, ctx.user.id),
        sql`${notifications.relatedType} = 'team_task'`,
      ];
      if (input?.taskId) {
        conditions.push(eq(notifications.relatedId, input.taskId));
      }
      const result = await db.select().from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(input?.limit || 20);
      return result;
    }),

});
