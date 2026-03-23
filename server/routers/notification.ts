import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const notificationRouter = router({
  // Manually trigger todo reminder check
  checkTodoReminders: protectedProcedure.mutation(async () => {
    const { checkTodoReminders } = await import("../todoReminder");
    return checkTodoReminders();
  }),

  // Get notifications for current user
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      return db.getNotificationsByUser(ctx.user.id, input?.limit || 50);
    }),

  // Get unread count
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return db.getUnreadNotificationCount(ctx.user.id);
  }),

  // Mark single notification as read
  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.markNotificationRead(input.id, ctx.user.id);
      return { success: true };
    }),

  // Mark all as read
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await db.markAllNotificationsRead(ctx.user.id);
    return { success: true };
  }),
});

// Helper: send review notifications
export async function sendReviewSubmittedNotification(
  submitterId: number,
  submitterName: string,
  kbType: string,
  itemId: number,
  itemTitle: string
) {
  const KB_TYPE_LABELS: Record<string, string> = {
    product: "产品创意", listing: "Listing文案", image: "图片",
    video: "视频", skill: "运营技能",
  };
  const typeLabel = KB_TYPE_LABELS[kbType] || kbType;

  // Notify all admin/manager users
  const admins = await db.getAdminUsers();
  const items = admins
    .filter(a => a.id !== submitterId) // Don't notify self
    .map(admin => ({
      userId: admin.id,
      type: "review_submitted" as const,
      title: `知识库内容待审核`,
      content: `${submitterName} 提交了${typeLabel}知识库内容「${itemTitle}」，请前往审核中心处理。`,
      relatedType: `kb_${kbType}`,
      relatedId: itemId,
      createdBy: submitterId,
    }));

  if (items.length > 0) {
    await db.createBulkNotifications(items);
  }
}

export async function sendReviewResultNotification(
  reviewerId: number,
  reviewerName: string,
  submitterId: number,
  kbType: string,
  itemId: number,
  itemTitle: string,
  approved: boolean,
  reviewNote?: string
) {
  const KB_TYPE_LABELS: Record<string, string> = {
    product: "产品创意", listing: "Listing文案", image: "图片",
    video: "视频", skill: "运营技能",
  };
  const typeLabel = KB_TYPE_LABELS[kbType] || kbType;
  const status = approved ? "已通过" : "已驳回";

  await db.createNotification({
    userId: submitterId,
    type: approved ? "review_approved" : "review_rejected",
    title: `审核${status}`,
    content: `您提交的${typeLabel}知识库内容「${itemTitle}」${status}。${
      reviewNote ? `审核意见：${reviewNote}` : ""
    }（审核人：${reviewerName}）`,
    relatedType: `kb_${kbType}`,
    relatedId: itemId,
    createdBy: reviewerId,
  });
}
