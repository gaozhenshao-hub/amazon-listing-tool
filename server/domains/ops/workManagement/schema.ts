import { z } from "zod";

export const productIdInput = z.object({ productId: z.number() });
export const idInput = z.object({ id: z.number() });
export const productProfileIdInput = z.object({ productProfileId: z.number() });
export const taskIdInput = z.object({ taskId: z.number() });

export const createTodoInput = z.object({
  productId: z.number(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
  dueDate: z.string().optional(),
  assignee: z.string().optional(),
  reminderDays: z.string().optional(),
  reminderEnabled: z.number().optional().default(1),
});
export const updateTodoInput = z.object({
  id: z.number(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
  dueDate: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  reminderDays: z.string().nullable().optional(),
  reminderEnabled: z.number().optional(),
});
export const createLogInput = z.object({
  productId: z.number(),
  content: z.string().min(1),
  logType: z.enum(["operation", "note", "issue", "decision", "milestone"]).optional().default("note"),
});
export const createTeamTaskInput = z.object({
  productProfileId: z.number(),
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
  linkedTodoId: z.number().optional(),
  linkedPlanActionId: z.number().optional(),
  tags: z.string().optional(),
  reminderDays: z.string().optional(),
  reminderEnabled: z.number().optional().default(1),
});
export const updateTeamTaskInput = z.object({
  taskId: z.number(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  category: z.string().optional(),
  assigneeName: z.string().nullable().optional(),
  assigneeId: z.number().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  estimatedHours: z.string().nullable().optional(),
  actualHours: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  tags: z.string().nullable().optional(),
  reminderDays: z.string().nullable().optional(),
  reminderEnabled: z.number().optional(),
});
export const moveTeamTaskInput = z.object({
  taskId: z.number(),
  newStatus: z.enum(["backlog", "todo", "in_progress", "review", "done"]),
});
export const addKeywordMonitorInput = z.object({
  productId: z.number(),
  keyword: z.string().min(1),
  keywordCn: z.string().optional(),
  targetAsin: z.string().optional(),
  marketplace: z.string().optional().default("US"),
  matchType: z.enum(["exact", "phrase", "broad"]).optional().default("exact"),
  monitorFrequency: z.enum(["daily", "weekly", "manual"]).optional().default("daily"),
});
export const addKeywordSnapshotInput = z.object({
  keywordMonitorId: z.number(),
  snapshotDate: z.string(),
  organicRank: z.number().nullable().optional(),
  adRank: z.number().nullable().optional(),
  searchVolume: z.number().nullable().optional(),
  pageNumber: z.number().nullable().optional(),
  totalResults: z.number().nullable().optional(),
});
