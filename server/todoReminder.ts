/**
 * Todo Reminder Service
 * 
 * Checks for upcoming and overdue todo tasks and sends in-app notifications.
 * Runs periodically (every hour by default).
 */

import { getDb } from "./db";
import { productTodos, teamTasks, notifications, productProfiles } from "../drizzle/schema";
import { eq, and, lte, gte, isNull, ne, sql } from "drizzle-orm";

// ─── Reminder Check Logic ───

/**
 * Check product todos for upcoming due dates and overdue items.
 * Creates notifications for:
 * 1. Tasks due within the next 24 hours (todo_due_soon)
 * 2. Tasks that are overdue (todo_overdue)
 */
export async function checkTodoReminders() {
  const db = await getDb();
  if (!db) return { checked: 0, notified: 0 };

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let notified = 0;

  // ─── 1. Check product_todos for due soon (due_date = tomorrow) ───
  const dueSoonTodos = await db.select({
    todo: productTodos,
    product: productProfiles,
  }).from(productTodos)
    .leftJoin(productProfiles, eq(productTodos.productId, productProfiles.id))
    .where(and(
      eq(productTodos.dueDate, tomorrow),
      ne(productTodos.status, "completed"),
    ));

  for (const row of dueSoonTodos) {
    const todo = row.todo;
    const productTitle = row.product?.title || "未知产品";

    // Check if we already sent a due_soon notification for this todo today
    const existing = await db.select().from(notifications).where(and(
      eq(notifications.type, "todo_due_soon"),
      eq(notifications.relatedType, "product_todo"),
      eq(notifications.relatedId, todo.id),
      gte(notifications.createdAt, new Date(today + "T00:00:00Z")),
    ));
    if (existing.length > 0) continue;

    await db.insert(notifications).values({
      userId: todo.userId,
      type: "todo_due_soon",
      title: "待办任务即将到期",
      content: `产品「${productTitle}」的待办任务「${todo.title}」将于明天(${tomorrow})到期，请及时处理。`,
      relatedType: "product_todo",
      relatedId: todo.id,
    });
    notified++;
  }

  // ─── 2. Check product_todos for overdue (due_date < today, not completed) ───
  const overdueTodos = await db.select({
    todo: productTodos,
    product: productProfiles,
  }).from(productTodos)
    .leftJoin(productProfiles, eq(productTodos.productId, productProfiles.id))
    .where(and(
      sql`${productTodos.dueDate} < ${today}`,
      ne(productTodos.status, "completed"),
    ));

  for (const row of overdueTodos) {
    const todo = row.todo;
    const productTitle = row.product?.title || "未知产品";

    // Check if we already sent an overdue notification for this todo today
    const existing = await db.select().from(notifications).where(and(
      eq(notifications.type, "todo_overdue"),
      eq(notifications.relatedType, "product_todo"),
      eq(notifications.relatedId, todo.id),
      gte(notifications.createdAt, new Date(today + "T00:00:00Z")),
    ));
    if (existing.length > 0) continue;

    const daysOverdue = Math.floor((Date.now() - new Date(todo.dueDate + "T00:00:00Z").getTime()) / (24 * 60 * 60 * 1000));

    await db.insert(notifications).values({
      userId: todo.userId,
      type: "todo_overdue",
      title: "待办任务已逾期",
      content: `产品「${productTitle}」的待办任务「${todo.title}」已逾期${daysOverdue}天(截止日期: ${todo.dueDate})，请尽快处理！`,
      relatedType: "product_todo",
      relatedId: todo.id,
    });
    notified++;
  }

  // ─── 3. Check team_tasks for due soon ───
  const dueSoonTeamTasks = await db.select().from(teamTasks)
    .where(and(
      eq(teamTasks.dueDate, tomorrow),
      ne(teamTasks.status, "done"),
    ));

  for (const task of dueSoonTeamTasks) {
    const existing = await db.select().from(notifications).where(and(
      eq(notifications.type, "todo_due_soon"),
      eq(notifications.relatedType, "team_task"),
      eq(notifications.relatedId, task.id),
      gte(notifications.createdAt, new Date(today + "T00:00:00Z")),
    ));
    if (existing.length > 0) continue;

    // Notify the assignee
    if (task.assigneeId) {
      await db.insert(notifications).values({
        userId: task.assigneeId,
        type: "todo_due_soon",
        title: "团队任务即将到期",
        content: `团队任务「${task.title}」将于明天(${tomorrow})到期，请及时处理。`,
        relatedType: "team_task",
        relatedId: task.id,
      });
      notified++;
    }

    // Also notify the creator if different from assignee
    if (task.userId && task.userId !== task.assigneeId) {
      await db.insert(notifications).values({
        userId: task.userId,
        type: "todo_due_soon",
        title: "团队任务即将到期",
        content: `您创建的团队任务「${task.title}」将于明天(${tomorrow})到期。`,
        relatedType: "team_task",
        relatedId: task.id,
      });
      notified++;
    }
  }

  // ─── 4. Check team_tasks for overdue ───
  const overdueTeamTasks = await db.select().from(teamTasks)
    .where(and(
      sql`${teamTasks.dueDate} < ${today}`,
      ne(teamTasks.status, "done"),
    ));

  for (const task of overdueTeamTasks) {
    const existing = await db.select().from(notifications).where(and(
      eq(notifications.type, "todo_overdue"),
      eq(notifications.relatedType, "team_task"),
      eq(notifications.relatedId, task.id),
      gte(notifications.createdAt, new Date(today + "T00:00:00Z")),
    ));
    if (existing.length > 0) continue;

    const daysOverdue = task.dueDate
      ? Math.floor((Date.now() - new Date(task.dueDate + "T00:00:00Z").getTime()) / (24 * 60 * 60 * 1000))
      : 0;

    if (task.assigneeId) {
      await db.insert(notifications).values({
        userId: task.assigneeId,
        type: "todo_overdue",
        title: "团队任务已逾期",
        content: `团队任务「${task.title}」已逾期${daysOverdue}天(截止日期: ${task.dueDate})，请尽快处理！`,
        relatedType: "team_task",
        relatedId: task.id,
      });
      notified++;
    }
  }

  const totalChecked = dueSoonTodos.length + overdueTodos.length + dueSoonTeamTasks.length + overdueTeamTasks.length;
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
