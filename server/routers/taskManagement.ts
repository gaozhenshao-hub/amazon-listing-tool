import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { teamTasks, meetingRecords, users, productProfiles } from "../../drizzle/schema";
import { eq, desc, asc, and, inArray, like, or, sql, isNull } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { transcribeAudio } from "../_core/voiceTranscription";
import { storagePut } from "../storage";

// ─── Task Management Router ───
// Global task management that works with existing team_tasks table
// but provides cross-product views and AI meeting extraction

export const taskManagementRouter = router({

  // ═══════════════════════════════════════════════════════
  // ─── Global Task Queries ───
  // ═══════════════════════════════════════════════════════

  /** List all tasks across all products, with filters */
  listAllTasks: protectedProcedure
    .input(z.object({
      assigneeName: z.string().optional(),
      assigneeId: z.number().optional(),
      category: z.string().optional(),
      status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional(),
      priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
      productProfileId: z.number().optional(),
      meetingRecordId: z.number().optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(200).optional().default(100),
      offset: z.number().min(0).optional().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const conditions: any[] = [];
      if (input.assigneeName) conditions.push(eq(teamTasks.assigneeName, input.assigneeName));
      if (input.assigneeId) conditions.push(eq(teamTasks.assigneeId, input.assigneeId));
      if (input.category) conditions.push(eq(teamTasks.category, input.category));
      if (input.status) conditions.push(eq(teamTasks.status, input.status));
      if (input.priority) conditions.push(eq(teamTasks.priority, input.priority));
      if (input.productProfileId) conditions.push(eq(teamTasks.productProfileId, input.productProfileId));
      if (input.meetingRecordId) conditions.push(eq(teamTasks.meetingRecordId, input.meetingRecordId));
      if (input.search) {
        conditions.push(or(
          like(teamTasks.title, `%${input.search}%`),
          like(teamTasks.description, `%${input.search}%`),
        ));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const tasks = await db.select({
        id: teamTasks.id,
        productProfileId: teamTasks.productProfileId,
        userId: teamTasks.userId,
        title: teamTasks.title,
        description: teamTasks.description,
        status: teamTasks.status,
        priority: teamTasks.priority,
        category: teamTasks.category,
        assigneeId: teamTasks.assigneeId,
        assigneeName: teamTasks.assigneeName,
        startDate: teamTasks.startDate,
        dueDate: teamTasks.dueDate,
        completedAt: teamTasks.completedAt,
        estimatedHours: teamTasks.estimatedHours,
        actualHours: teamTasks.actualHours,
        linkedTodoId: teamTasks.linkedTodoId,
        linkedPlanActionId: teamTasks.linkedPlanActionId,
        tags: teamTasks.tags,
        sortOrder: teamTasks.sortOrder,
        reminderDays: teamTasks.reminderDays,
        reminderEnabled: teamTasks.reminderEnabled,
        lastReminderSentAt: teamTasks.lastReminderSentAt,
        meetingRecordId: teamTasks.meetingRecordId,
        createdAt: teamTasks.createdAt,
        updatedAt: teamTasks.updatedAt,
        // Joined product info
        productParentAsin: productProfiles.parentAsin,
        productTitle: productProfiles.title,
        productChineseName: productProfiles.chineseName,
        productImageUrl: productProfiles.imageUrl,
        productMarketplace: productProfiles.marketplace,
      }).from(teamTasks)
        .leftJoin(productProfiles, eq(teamTasks.productProfileId, productProfiles.id))
        .where(where)
        .orderBy(desc(teamTasks.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get total count
      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(teamTasks)
        .where(where);

      return {
        tasks,
        total: countResult?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /** Get unique assignees for filter dropdown */
  getAssignees: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const result = await db.selectDistinct({ assigneeName: teamTasks.assigneeName })
        .from(teamTasks)
        .where(sql`${teamTasks.assigneeName} IS NOT NULL AND ${teamTasks.assigneeName} != ''`);

      return result.map(r => r.assigneeName).filter(Boolean) as string[];
    }),

  /** Get unique categories for filter dropdown */
  getCategories: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const result = await db.selectDistinct({ category: teamTasks.category })
        .from(teamTasks)
        .where(sql`${teamTasks.category} IS NOT NULL AND ${teamTasks.category} != ''`);

      return result.map(r => r.category).filter(Boolean) as string[];
    }),

  /** Get task statistics summary */
  getTaskStats: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const tasks = await db.select().from(teamTasks);

      const byStatus: Record<string, number> = { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 };
      const byPriority: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
      const byAssignee: Record<string, { total: number; done: number; overdue: number }> = {};
      const byCategory: Record<string, number> = {};

      const now = new Date();
      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
        byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;

        const assignee = t.assigneeName || "未分配";
        if (!byAssignee[assignee]) byAssignee[assignee] = { total: 0, done: 0, overdue: 0 };
        byAssignee[assignee].total++;
        if (t.status === "done") byAssignee[assignee].done++;
        if (t.dueDate && new Date(t.dueDate) < now && t.status !== "done") {
          byAssignee[assignee].overdue++;
        }

        if (t.category) {
          byCategory[t.category] = (byCategory[t.category] || 0) + 1;
        }
      }

      return {
        total: tasks.length,
        byStatus,
        byPriority,
        byAssignee,
        byCategory,
        overdue: tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== "done").length,
      };
    }),

  /** Create a global task (not tied to a specific product) */
  createGlobalTask: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional().default("todo"),
      priority: z.enum(["urgent", "high", "medium", "low"]).optional().default("medium"),
      category: z.string().optional(),
      assigneeName: z.string().optional(),
      assigneeId: z.number().optional(),
      startDate: z.string().optional(),
      dueDate: z.string().optional(),
      estimatedHours: z.string().optional(),
      productProfileId: z.number().optional(),
      meetingRecordId: z.number().optional(),
      tags: z.string().optional(),
      reminderDays: z.string().optional(),
      reminderEnabled: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Use productProfileId 0 as "global" if not specified
      const profileId = input.productProfileId ?? 0;

      const [result] = await db.insert(teamTasks).values({
        productProfileId: profileId,
        userId: ctx.user.id,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        category: input.category,
        assigneeName: input.assigneeName,
        assigneeId: input.assigneeId,
        startDate: input.startDate,
        dueDate: input.dueDate,
        estimatedHours: input.estimatedHours,
        meetingRecordId: input.meetingRecordId,
        tags: input.tags,
        reminderDays: input.reminderDays ?? "[1,3]",
        reminderEnabled: input.reminderEnabled ?? 1,
      });
      return { id: result.insertId };
    }),

  /** Batch create tasks (from AI extraction) */
  batchCreateTasks: protectedProcedure
    .input(z.object({
      tasks: z.array(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional().default("todo"),
        priority: z.enum(["urgent", "high", "medium", "low"]).optional().default("medium"),
        category: z.string().optional(),
        assigneeName: z.string().optional(),
        startDate: z.string().optional(),
        dueDate: z.string().optional(),
        estimatedHours: z.string().optional(),
        productProfileId: z.number().optional(),
      })),
      meetingRecordId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const insertedIds: number[] = [];
      for (const task of input.tasks) {
        const [result] = await db.insert(teamTasks).values({
          productProfileId: task.productProfileId ?? 0,
          userId: ctx.user.id,
          title: task.title,
          description: task.description,
          status: task.status ?? "todo",
          priority: task.priority ?? "medium",
          category: task.category,
          assigneeName: task.assigneeName,
          startDate: task.startDate,
          dueDate: task.dueDate,
          estimatedHours: task.estimatedHours,
          meetingRecordId: input.meetingRecordId,
        });
        insertedIds.push(result.insertId);
      }

      return { insertedIds, count: insertedIds.length };
    }),

  // ═══════════════════════════════════════════════════════
  // ─── Meeting Records & AI Extraction ───
  // ═══════════════════════════════════════════════════════

  /** Upload audio and create meeting record */
  createMeetingRecord: protectedProcedure
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
  listMeetingRecords: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).optional().default(20),
      offset: z.number().min(0).optional().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const records = await db.select().from(meetingRecords)
        .orderBy(desc(meetingRecords.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return records;
    }),

  /** Get a single meeting record */
  getMeetingRecord: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const [record] = await db.select().from(meetingRecords)
        .where(eq(meetingRecords.id, input.id));

      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting record not found" });
      return record;
    }),

  /** Transcribe meeting audio */
  transcribeMeeting: protectedProcedure
    .input(z.object({ meetingId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const [record] = await db.select().from(meetingRecords)
        .where(eq(meetingRecords.id, input.meetingId));

      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting record not found" });
      if (!record.audioUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "No audio URL" });

      // Update status to transcribing
      await db.update(meetingRecords)
        .set({ status: "transcribing" })
        .where(eq(meetingRecords.id, input.meetingId));

      try {
        const result = await transcribeAudio({
          audioUrl: record.audioUrl,
          language: "zh",
          prompt: "这是一段亚马逊运营团队的会议录音，可能涉及产品运营、广告优化、库存管理、Listing优化等话题。请准确转录。",
        });

        if ("error" in result) {
          await db.update(meetingRecords)
            .set({ status: "error", errorMessage: result.error })
            .where(eq(meetingRecords.id, input.meetingId));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
        }

        await db.update(meetingRecords)
          .set({ transcript: result.text, status: "extracting" })
          .where(eq(meetingRecords.id, input.meetingId));

        return { transcript: result.text };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        await db.update(meetingRecords)
          .set({ status: "error", errorMessage: err.message })
          .where(eq(meetingRecords.id, input.meetingId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }
    }),

  /** Extract tasks from meeting transcript using AI */
  extractTasksFromTranscript: protectedProcedure
    .input(z.object({
      meetingId: z.number().optional(),
      transcript: z.string().min(10),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Get team members for assignee matching
      const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
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
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

        const response = await invokeLLM({
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
            .where(eq(meetingRecords.id, input.meetingId));
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
            .where(eq(meetingRecords.id, input.meetingId));
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI extraction failed: ${err.message}` });
      }
    }),

  /** Full pipeline: transcribe + extract in one call (for direct text input) */
  extractTasksFromText: protectedProcedure
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
      const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
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
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

        const response = await invokeLLM({
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
          .where(eq(meetingRecords.id, meetingId));

        return { meetingId, ...parsed };
      } catch (err: any) {
        await db.update(meetingRecords)
          .set({ status: "error", errorMessage: err.message })
          .where(eq(meetingRecords.id, meetingId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI extraction failed: ${err.message}` });
      }
    }),

  /** Delete meeting record */
  deleteMeetingRecord: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      await db.delete(meetingRecords).where(eq(meetingRecords.id, input.id));
      return { deleted: true };
    }),

    /** Get products list for task assignment */
  getProductsForAssignment: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const products = await db.select({
        id: productProfiles.id,
        parentAsin: productProfiles.parentAsin,
        title: productProfiles.title,
        chineseName: productProfiles.chineseName,
        imageUrl: productProfiles.imageUrl,
        marketplace: productProfiles.marketplace,
      }).from(productProfiles)
        .orderBy(desc(productProfiles.createdAt))
        .limit(200);
      return products;
    }),

  /** Search products by name or ASIN (parent ASIN dimension) */
  searchProducts: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(100),
      limit: z.number().min(1).max(50).optional().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const kw = `%${input.keyword}%`;
      const products = await db.select({
        id: productProfiles.id,
        parentAsin: productProfiles.parentAsin,
        title: productProfiles.title,
        chineseName: productProfiles.chineseName,
        imageUrl: productProfiles.imageUrl,
        marketplace: productProfiles.marketplace,
      }).from(productProfiles)
        .where(
          or(
            like(productProfiles.parentAsin, kw),
            like(productProfiles.title, kw),
            like(productProfiles.chineseName, kw),
          )
        )
        .orderBy(desc(productProfiles.createdAt))
        .limit(input.limit);
      return products;
    }),

  /** Get products that have tasks associated (for filter dropdown) */
  getProductsWithTasks: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      // Get distinct product IDs from tasks, then join with product info
      const products = await db.selectDistinct({
        id: productProfiles.id,
        parentAsin: productProfiles.parentAsin,
        title: productProfiles.title,
        chineseName: productProfiles.chineseName,
        imageUrl: productProfiles.imageUrl,
        marketplace: productProfiles.marketplace,
        taskCount: sql<number>`count(${teamTasks.id})`,
      }).from(teamTasks)
        .innerJoin(productProfiles, eq(teamTasks.productProfileId, productProfiles.id))
        .groupBy(productProfiles.id, productProfiles.parentAsin, productProfiles.title, productProfiles.chineseName, productProfiles.imageUrl, productProfiles.marketplace)
        .orderBy(sql`count(${teamTasks.id}) DESC`);
      return products;
    }),

  // ═══════════════════════════════════════════════════════
  // ─── Task Reminder & Notification ───
  // ═══════════════════════════════════════════════════════

  /** Manually trigger reminder check for all tasks */
  triggerReminderCheck: protectedProcedure
    .mutation(async () => {
      const { checkTodoReminders } = await import("../todoReminder");
      return checkTodoReminders();
    }),

  /** Update reminder settings for a task */
  updateReminderSettings: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      reminderEnabled: z.number().min(0).max(1),
      reminderDays: z.array(z.number().min(0)).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const updates: Record<string, unknown> = {
        reminderEnabled: input.reminderEnabled,
      };
      if (input.reminderDays) {
        updates.reminderDays = JSON.stringify(input.reminderDays);
      }
      await db.update(teamTasks).set(updates).where(eq(teamTasks.id, input.taskId));
      return { updated: true };
    }),

  /** Get overdue and upcoming tasks summary for dashboard */
  getReminderSummary: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const today = new Date().toISOString().slice(0, 10);
      const threeDaysLater = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const sevenDaysLater = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      // Overdue tasks (due date < today, not done)
      const overdueTasks = await db.select().from(teamTasks)
        .where(and(
          sql`${teamTasks.status} != 'done'`,
          sql`${teamTasks.dueDate} IS NOT NULL AND ${teamTasks.dueDate} != ''`,
          sql`${teamTasks.dueDate} < ${today}`,
        ))
        .orderBy(asc(sql`${teamTasks.dueDate}`));

      // Due within 3 days
      const dueSoonTasks = await db.select().from(teamTasks)
        .where(and(
          sql`${teamTasks.status} != 'done'`,
          sql`${teamTasks.dueDate} IS NOT NULL AND ${teamTasks.dueDate} != ''`,
          sql`${teamTasks.dueDate} >= ${today}`,
          sql`${teamTasks.dueDate} <= ${threeDaysLater}`,
        ))
        .orderBy(asc(sql`${teamTasks.dueDate}`));

      // Due within 7 days (but after 3 days)
      const dueThisWeekTasks = await db.select().from(teamTasks)
        .where(and(
          sql`${teamTasks.status} != 'done'`,
          sql`${teamTasks.dueDate} IS NOT NULL AND ${teamTasks.dueDate} != ''`,
          sql`${teamTasks.dueDate} > ${threeDaysLater}`,
          sql`${teamTasks.dueDate} <= ${sevenDaysLater}`,
        ))
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
  getTaskNotifications: protectedProcedure
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
