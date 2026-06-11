/**
 * Todo Reminder Service
 * 
 * Checks for upcoming and overdue todo tasks and sends in-app notifications.
 * Supports custom reminder days (e.g. remind 1, 3, 7 days before due date).
 * Runs periodically (every hour by default).
 */

import { getDb } from "./db";
import { productTodos, teamTasks, notifications, productProfiles } from "../drizzle/schema";
import { eq, and, lte, gte, isNull, ne, sql } from "drizzle-orm";

// ─── Default reminder presets ───
export const REMINDER_PRESETS = [
  { label: "到期当天", value: 0 },
  { label: "提前1天", value: 1 },
  { label: "提前2天", value: 2 },
  { label: "提前3天", value: 3 },
  { label: "提前5天", value: 5 },
  { label: "提前1周", value: 7 },
  { label: "提前2周", value: 14 },
  { label: "提前1个月", value: 30 },
] as const;

export const DEFAULT_REMINDER_DAYS = [1]; // default: remind 1 day before

/**
 * Parse reminderDays from DB (stored as JSON string like "[1,3,7]")
 */
function parseReminderDays(raw: string | null | undefined): number[] {
  if (!raw) return DEFAULT_REMINDER_DAYS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(n => typeof n === "number" && n >= 0)) {
      return parsed.sort((a, b) => a - b);
    }
  } catch {}
  return DEFAULT_REMINDER_DAYS;
}

/**
 * Calculate which reminder days should trigger today for a given due date.
 * Returns the matching reminder day values (e.g. [1] if task is due tomorrow and reminderDays includes 1).
 */
function getMatchingReminderDays(dueDate: string, reminderDays: number[]): number[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffMs = due.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

  // Only match if diffDays is in the reminderDays list
  return reminderDays.filter(d => d === diffDays);
}

/**
 * Check product todos for upcoming due dates and overdue items.
 * Creates notifications based on custom reminder day settings.
 */
export async function checkTodoReminders() {
  const db = await getDb();
  if (!db) return { checked: 0, notified: 0 };

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  let notified = 0;

  // ─── 1. Check product_todos with custom reminder days ───
  // Get all non-completed todos that have a due date and reminders enabled
  const pendingTodos = await db.select({
    todo: productTodos,
    product: productProfiles,
  }).from(productTodos)
    .leftJoin(productProfiles, eq(productTodos.productId, productProfiles.id))
    .where(and(
      ne(productTodos.status, "completed"),
      sql`${productTodos.dueDate} IS NOT NULL AND ${productTodos.dueDate} != ''`,
      sql`(${productTodos.reminderEnabled} = 1 OR ${productTodos.reminderEnabled} IS NULL)`,
    ));

  for (const row of pendingTodos) {
    const todo = row.todo;
    const productTitle = row.product?.title || "未知产品";
    const reminderDays = parseReminderDays(todo.reminderDays);
    const dueDate = todo.dueDate!;

    // Check if task is overdue
    if (dueDate < today) {
      const daysOverdue = Math.floor((Date.now() - new Date(dueDate + "T00:00:00Z").getTime()) / (24 * 60 * 60 * 1000));

      // Check if we already sent an overdue notification today
      const existing = await db.select().from(notifications).where(and(
        eq(notifications.type, "todo_overdue"),
        eq(notifications.relatedType, "product_todo"),
        eq(notifications.relatedId, todo.id),
        gte(notifications.createdAt, new Date(today + "T00:00:00Z")),
      ));
      if (existing.length > 0) continue;

      await db.insert(notifications).values({
        userId: todo.userId,
        type: "todo_overdue",
        title: "待办任务已逾期",
        content: `产品「${productTitle}」的待办任务「${todo.title}」已逾期${daysOverdue}天(截止日期: ${dueDate})，请尽快处理！`,
        relatedType: "product_todo",
        relatedId: todo.id,
      });
      notified++;
      continue;
    }

    // Check if any reminder day matches today
    const matchingDays = getMatchingReminderDays(dueDate, reminderDays);
    if (matchingDays.length === 0) continue;

    for (const daysBefore of matchingDays) {
      // Check if we already sent a reminder for this specific day offset today
      const existing = await db.select().from(notifications).where(and(
        eq(notifications.type, "todo_due_soon"),
        eq(notifications.relatedType, "product_todo"),
        eq(notifications.relatedId, todo.id),
        gte(notifications.createdAt, new Date(today + "T00:00:00Z")),
      ));
      if (existing.length > 0) continue;

      const timeLabel = daysBefore === 0 ? "今天" : `${daysBefore}天后`;
      await db.insert(notifications).values({
        userId: todo.userId,
        type: "todo_due_soon",
        title: "待办任务即将到期",
        content: `产品「${productTitle}」的待办任务「${todo.title}」将于${timeLabel}(${dueDate})到期，请及时处理。`,
        relatedType: "product_todo",
        relatedId: todo.id,
      });
      notified++;
    }

    // Update lastReminderSentAt
    await db.update(productTodos)
      .set({ lastReminderSentAt: new Date() })
      .where(eq(productTodos.id, todo.id));
  }

  // ─── 2. Check team_tasks with custom reminder days ───
  const pendingTeamTasks = await db.select().from(teamTasks)
    .where(and(
      ne(teamTasks.status, "done"),
      sql`${teamTasks.dueDate} IS NOT NULL AND ${teamTasks.dueDate} != ''`,
      sql`(${teamTasks.reminderEnabled} = 1 OR ${teamTasks.reminderEnabled} IS NULL)`,
    ));

  for (const task of pendingTeamTasks) {
    const reminderDays = parseReminderDays(task.reminderDays);
    const dueDate = task.dueDate!;

    // Check if task is overdue
    if (dueDate < today) {
      const daysOverdue = Math.floor((Date.now() - new Date(dueDate + "T00:00:00Z").getTime()) / (24 * 60 * 60 * 1000));

      const existing = await db.select().from(notifications).where(and(
        eq(notifications.type, "todo_overdue"),
        eq(notifications.relatedType, "team_task"),
        eq(notifications.relatedId, task.id),
        gte(notifications.createdAt, new Date(today + "T00:00:00Z")),
      ));
      if (existing.length > 0) continue;

      if (task.assigneeId) {
        await db.insert(notifications).values({
          userId: task.assigneeId,
          type: "todo_overdue",
          title: "团队任务已逾期",
          content: `团队任务「${task.title}」已逾期${daysOverdue}天(截止日期: ${dueDate})，请尽快处理！`,
          relatedType: "team_task",
          relatedId: task.id,
        });
        notified++;
      }
      continue;
    }

    // Check if any reminder day matches today
    const matchingDays = getMatchingReminderDays(dueDate, reminderDays);
    if (matchingDays.length === 0) continue;

    for (const daysBefore of matchingDays) {
      const existing = await db.select().from(notifications).where(and(
        eq(notifications.type, "todo_due_soon"),
        eq(notifications.relatedType, "team_task"),
        eq(notifications.relatedId, task.id),
        gte(notifications.createdAt, new Date(today + "T00:00:00Z")),
      ));
      if (existing.length > 0) continue;

      const timeLabel = daysBefore === 0 ? "今天" : `${daysBefore}天后`;

      // Notify assignee
      if (task.assigneeId) {
        await db.insert(notifications).values({
          userId: task.assigneeId,
          type: "todo_due_soon",
          title: "团队任务即将到期",
          content: `团队任务「${task.title}」将于${timeLabel}(${dueDate})到期，请及时处理。`,
          relatedType: "team_task",
          relatedId: task.id,
        });
        notified++;
      }

      // Also notify creator if different
      if (task.userId && task.userId !== task.assigneeId) {
        await db.insert(notifications).values({
          userId: task.userId,
          type: "todo_due_soon",
          title: "团队任务即将到期",
          content: `您创建的团队任务「${task.title}」将于${timeLabel}(${dueDate})到期。`,
          relatedType: "team_task",
          relatedId: task.id,
        });
        notified++;
      }
    }

    // Update lastReminderSentAt
    await db.update(teamTasks)
      .set({ lastReminderSentAt: new Date() })
      .where(eq(teamTasks.id, task.id));
  }

  const totalChecked = pendingTodos.length + pendingTeamTasks.length;
  console.log(`[TodoReminder] Checked ${totalChecked} tasks, sent ${notified} notifications`);
  return { checked: totalChecked, notified };
}

// ─── Scheduler ───

let reminderInterval: ReturnType<typeof setInterval> | null = null;

export function startTodoReminderScheduler(intervalMs: number = 60 * 60 * 1000) {
  if (reminderInterval) {
    clearInterval(reminderInterval);
  }

  // Run immediately on start
  checkTodoReminders().catch(err => {
    console.error("[TodoReminder] Error on initial check:", err);
  });

  // Then run periodically
  reminderInterval = setInterval(() => {
    checkTodoReminders().catch(err => {
      console.error("[TodoReminder] Error:", err);
    });
  }, intervalMs);

  console.log(`[TodoReminder] Scheduler started (interval: ${intervalMs / 1000}s)`);
}

export function stopTodoReminderScheduler() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}
