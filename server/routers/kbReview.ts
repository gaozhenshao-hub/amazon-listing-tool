import { z } from "zod";
import { protectedProcedure, managerProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { sendReviewSubmittedNotification, sendReviewResultNotification } from "./notification";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  kbProductInnovations,
  kbListingCopywriting,
  kbImageSets,
  kbOperationSkills,
  kbVideos,
  users,
} from "../../drizzle/schema";

// ═══════════════════════════════════════════════════════════════
// KB type → table mapping
// ═══════════════════════════════════════════════════════════════
const KB_TABLES = {
  product: kbProductInnovations,
  listing: kbListingCopywriting,
  image: kbImageSets,
  skill: kbOperationSkills,
  video: kbVideos,
} as const;

type KbType = keyof typeof KB_TABLES;

const kbTypeEnum = z.enum(["product", "listing", "image", "skill", "video"]);

// Helper: get table by type
function getTable(type: KbType) {
  return KB_TABLES[type];
}

// ═══════════════════════════════════════════════════════════════
// Review Router
// ═══════════════════════════════════════════════════════════════
export const kbReviewRouter = router({
  // ─── Submit for review (specialist → pending_review) ───
  submitForReview: protectedProcedure
    .input(z.object({
      type: kbTypeEnum,
      id: z.number(),
      visibility: z.enum(["private", "team", "public"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const table = getTable(input.type);

      // Verify ownership
      const rows = await db.select().from(table).where(
        and(eq((table as any).id, input.id), eq((table as any).userId, ctx.user.id))
      );
      if (!rows.length) throw new Error("知识库内容不存在或无权操作");

      const item = rows[0] as any;
      if (item.reviewStatus === "pending_review") {
        throw new Error("该内容已在审核中");
      }

      const updateData: any = {
        reviewStatus: "pending_review",
        submittedAt: new Date(),
      };
      if (input.visibility) {
        updateData.visibility = input.visibility;
      }

      await db.update(table).set(updateData).where(eq((table as any).id, input.id));
      // Send notification to reviewers
      try {
        const itemTitle = item.title || item.productTitle || item.videoTitle || item.asin || `#${input.id}`;
        await sendReviewSubmittedNotification(
          ctx.user.id, ctx.user.name || '未命名用户',
          input.type, input.id, itemTitle
        );
      } catch (e) { console.warn('[Notification] submit notify failed:', e); }
      return { success: true };
    }),

  // ─── Batch submit for review ───
  batchSubmitForReview: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        type: kbTypeEnum,
        id: z.number(),
      })).min(1).max(100),
      visibility: z.enum(["private", "team", "public"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      let successCount = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const table = getTable(item.type);
          const rows = await db.select().from(table).where(
            and(eq((table as any).id, item.id), eq((table as any).userId, ctx.user.id))
          );
          if (!rows.length) {
            errors.push(`${item.type}#${item.id}: 不存在或无权操作`);
            continue;
          }
          const updateData: any = {
            reviewStatus: "pending_review",
            submittedAt: new Date(),
          };
          if (input.visibility) updateData.visibility = input.visibility;
          await db.update(table).set(updateData).where(eq((table as any).id, item.id));
          successCount++;
        } catch (e: any) {
          errors.push(`${item.type}#${item.id}: ${e.message}`);
        }
      }

      return { successCount, errorCount: errors.length, errors };
    }),

  // ─── Approve (manager/admin) ───
  approve: managerProcedure
    .input(z.object({
      type: kbTypeEnum,
      id: z.number(),
      reviewNote: z.string().optional(),
      visibility: z.enum(["private", "team", "public"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const table = getTable(input.type);

      const rows = await db.select().from(table).where(eq((table as any).id, input.id));
      if (!rows.length) throw new Error("知识库内容不存在");

      const item = rows[0] as any;
      if (item.reviewStatus !== "pending_review") {
        throw new Error("该内容不在待审核状态");
      }

      const updateData: any = {
        reviewStatus: "approved",
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
      };
      if (input.reviewNote) updateData.reviewNote = input.reviewNote;
      if (input.visibility) updateData.visibility = input.visibility;

      await db.update(table).set(updateData).where(eq((table as any).id, input.id));
      // Notify submitter of approval
      try {
        const itemTitle = item.title || item.productTitle || item.videoTitle || item.asin || `#${input.id}`;
        await sendReviewResultNotification(
          ctx.user.id, ctx.user.name || '未命名',
          item.userId, input.type, input.id, itemTitle, true, input.reviewNote
        );
      } catch (e) { console.warn('[Notification] approve notify failed:', e); }
      return { success: true };
    }),

  // ─── Reject (manager/admin) ───
  reject: managerProcedure
    .input(z.object({
      type: kbTypeEnum,
      id: z.number(),
      reviewNote: z.string().min(1, "请填写驳回原因"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const table = getTable(input.type);

      const rows = await db.select().from(table).where(eq((table as any).id, input.id));
      if (!rows.length) throw new Error("知识库内容不存在");

      const item = rows[0] as any;
      if (item.reviewStatus !== "pending_review") {
        throw new Error("该内容不在待审核状态");
      }

      await db.update(table).set({
        reviewStatus: "rejected",
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote,
      } as any).where(eq((table as any).id, input.id));
      // Notify submitter of rejection
      try {
        const itemTitle = item.title || item.productTitle || item.videoTitle || item.asin || `#${input.id}`;
        await sendReviewResultNotification(
          ctx.user.id, ctx.user.name || '未命名',
          item.userId, input.type, input.id, itemTitle, false, input.reviewNote
        );
      } catch (e) { console.warn('[Notification] reject notify failed:', e); }
      return { success: true };
    }),

  // ─── Batch approve ───
  batchApprove: managerProcedure
    .input(z.object({
      items: z.array(z.object({
        type: kbTypeEnum,
        id: z.number(),
      })).min(1).max(100),
      reviewNote: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      let successCount = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const table = getTable(item.type);
          await db.update(table).set({
            reviewStatus: "approved",
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNote: input.reviewNote || null,
          } as any).where(
            and(
              eq((table as any).id, item.id),
              eq((table as any).reviewStatus, "pending_review")
            )
          );
          successCount++;
        } catch (e: any) {
          errors.push(`${item.type}#${item.id}: ${e.message}`);
        }
      }

      return { successCount, errorCount: errors.length, errors };
    }),

  // ─── Batch reject ───
  batchReject: managerProcedure
    .input(z.object({
      items: z.array(z.object({
        type: kbTypeEnum,
        id: z.number(),
      })).min(1).max(100),
      reviewNote: z.string().min(1, "请填写驳回原因"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      let successCount = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const table = getTable(item.type);
          await db.update(table).set({
            reviewStatus: "rejected",
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNote: input.reviewNote,
          } as any).where(
            and(
              eq((table as any).id, item.id),
              eq((table as any).reviewStatus, "pending_review")
            )
          );
          successCount++;
        } catch (e: any) {
          errors.push(`${item.type}#${item.id}: ${e.message}`);
        }
      }

      return { successCount, errorCount: errors.length, errors };
    }),

  // ─── Review center: list all pending reviews ───
  listPending: managerProcedure
    .input(z.object({
      type: kbTypeEnum.optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 20;
      const offset = (page - 1) * pageSize;

      // Build queries for each type
      const buildQuery = async (type: KbType) => {
        const table = getTable(type);
        const titleField = type === "skill"
          ? (table as typeof kbOperationSkills).title
          : type === "video"
            ? (table as typeof kbVideos).videoTitle
            : (table as any).productTitle;
        const asinField = type === "skill" ? sql<string>`''` : type === "video" ? sql`COALESCE(${(table as typeof kbVideos).asin}, '')` : (table as any).asin;

        const rows = await db.select({
          id: (table as any).id,
          type: sql<string>`${type}`,
          title: titleField,
          asin: asinField,
          userId: (table as any).userId,
          reviewStatus: (table as any).reviewStatus,
          visibility: (table as any).visibility,
          submittedAt: (table as any).submittedAt,
          reviewNote: (table as any).reviewNote,
          reviewedBy: (table as any).reviewedBy,
          reviewedAt: (table as any).reviewedAt,
          updatedAt: (table as any).updatedAt,
        }).from(table).where(eq((table as any).reviewStatus, "pending_review"));

        return rows;
      };

      let allPending: any[] = [];
      if (input?.type) {
        allPending = await buildQuery(input.type);
      } else {
        const results = await Promise.all(
          (Object.keys(KB_TABLES) as KbType[]).map(t => buildQuery(t))
        );
        allPending = results.flat();
      }

      // Sort by submittedAt desc
      allPending.sort((a, b) => {
        const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return tb - ta;
      });

      // Enrich with user info
      const userIds = Array.from(new Set(allPending.map(i => i.userId)));
      let userMap: Record<number, { name: string }> = {};
      if (userIds.length > 0) {
        const userRows = await db.select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, userIds));
        userMap = Object.fromEntries(userRows.map(u => [u.id, { name: u.name || '未知' }]));
      }

      const total = allPending.length;
      const items = allPending.slice(offset, offset + pageSize).map(item => ({
        ...item,
        submitterName: userMap[item.userId]?.name || "未知用户",
      }));

      return { items, total, page, pageSize };
    }),

  // ─── Review history: list reviewed items ───
  listReviewed: managerProcedure
    .input(z.object({
      type: kbTypeEnum.optional(),
      status: z.enum(["approved", "rejected"]).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 20;
      const offset = (page - 1) * pageSize;

      const buildQuery = async (type: KbType) => {
        const table = getTable(type);
        const titleField = type === "skill"
          ? (table as typeof kbOperationSkills).title
          : type === "video"
            ? (table as typeof kbVideos).videoTitle
            : (table as any).productTitle;

        const conditions: any[] = [];
        if (input?.status) {
          conditions.push(eq((table as any).reviewStatus, input.status));
        } else {
          conditions.push(
            sql`${(table as any).reviewStatus} IN ('approved', 'rejected')`
          );
        }

        const rows = await db.select({
          id: (table as any).id,
          type: sql<string>`${type}`,
          title: titleField,
          userId: (table as any).userId,
          reviewStatus: (table as any).reviewStatus,
          visibility: (table as any).visibility,
          reviewNote: (table as any).reviewNote,
          reviewedBy: (table as any).reviewedBy,
          reviewedAt: (table as any).reviewedAt,
        }).from(table).where(and(...conditions));

        return rows;
      };

      let allReviewed: any[] = [];
      if (input?.type) {
        allReviewed = await buildQuery(input.type);
      } else {
        const results = await Promise.all(
          (Object.keys(KB_TABLES) as KbType[]).map(t => buildQuery(t))
        );
        allReviewed = results.flat();
      }

      allReviewed.sort((a, b) => {
        const ta = a.reviewedAt ? new Date(a.reviewedAt).getTime() : 0;
        const tb = b.reviewedAt ? new Date(b.reviewedAt).getTime() : 0;
        return tb - ta;
      });

      // Enrich with user info
      const allUserIds = Array.from(new Set([
        ...allReviewed.map(i => i.userId),
        ...allReviewed.filter(i => i.reviewedBy).map(i => i.reviewedBy),
      ]));
      let userMap: Record<number, { name: string }> = {};
      if (allUserIds.length > 0) {
        const userRows = await db.select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, allUserIds));
        userMap = Object.fromEntries(userRows.map(u => [u.id, { name: u.name || '未知' }]));
      }

      const total = allReviewed.length;
      const items = allReviewed.slice(offset, offset + pageSize).map(item => ({
        ...item,
        submitterName: userMap[item.userId]?.name || "未知用户",
        reviewerName: item.reviewedBy ? (userMap[item.reviewedBy]?.name || "未知") : null,
      }));

      return { items, total, page, pageSize };
    }),

  // ─── Review stats (for dashboard) ───
  stats: managerProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const countByStatus = async (type: KbType) => {
      const table = getTable(type);
      const rows = await db.select({
        status: (table as any).reviewStatus,
        count: sql<number>`count(*)`,
      }).from(table).groupBy((table as any).reviewStatus);

      const result: Record<string, number> = { draft: 0, pending_review: 0, approved: 0, rejected: 0 };
      for (const row of rows) {
        result[row.status as string] = row.count;
      }
      return result;
    };

    const [product, listing, image, skill, video] = await Promise.all([
      countByStatus("product"),
      countByStatus("listing"),
      countByStatus("image"),
      countByStatus("skill"),
      countByStatus("video"),
    ]);

    return {
      product, listing, image, skill, video,
      totalPending: product.pending_review + listing.pending_review + image.pending_review + skill.pending_review + video.pending_review,
      totalApproved: product.approved + listing.approved + image.approved + skill.approved + video.approved,
      totalRejected: product.rejected + listing.rejected + image.rejected + skill.rejected + video.rejected,
    };
  }),

  // ─── Update visibility (owner or admin) ───
  updateVisibility: protectedProcedure
    .input(z.object({
      type: kbTypeEnum,
      id: z.number(),
      visibility: z.enum(["private", "team", "public"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const table = getTable(input.type);

      // Check ownership or admin
      const rows = await db.select().from(table).where(eq((table as any).id, input.id));
      if (!rows.length) throw new Error("内容不存在");

      const item = rows[0] as any;
      const isOwner = item.userId === ctx.user.id;
      const isAdmin = ["super_admin", "admin", "ops_manager"].includes(ctx.user.role);
      if (!isOwner && !isAdmin) throw new Error("无权修改可见性");

      await db.update(table).set({ visibility: input.visibility } as any)
        .where(eq((table as any).id, input.id));
      return { success: true };
    }),

  // ─── My submissions: list items I submitted for review ───
  mySubmissions: protectedProcedure
    .input(z.object({
      type: kbTypeEnum.optional(),
      status: z.enum(["pending_review", "approved", "rejected"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const buildQuery = async (type: KbType) => {
        const table = getTable(type);
        const titleField = type === "skill"
          ? (table as typeof kbOperationSkills).title
          : type === "video"
            ? (table as typeof kbVideos).videoTitle
            : (table as any).productTitle;

        const conditions: any[] = [
          eq((table as any).userId, ctx.user.id),
          sql`${(table as any).reviewStatus} != 'draft'`,
        ];
        if (input?.status) {
          conditions.push(eq((table as any).reviewStatus, input.status));
        }

        return db.select({
          id: (table as any).id,
          type: sql<string>`${type}`,
          title: titleField,
          reviewStatus: (table as any).reviewStatus,
          reviewNote: (table as any).reviewNote,
          visibility: (table as any).visibility,
          submittedAt: (table as any).submittedAt,
          reviewedAt: (table as any).reviewedAt,
        }).from(table).where(and(...conditions));
      };

      let allItems: any[] = [];
      if (input?.type) {
        allItems = await buildQuery(input.type);
      } else {
        const results = await Promise.all(
          (Object.keys(KB_TABLES) as KbType[]).map(t => buildQuery(t))
        );
        allItems = results.flat();
      }

      allItems.sort((a, b) => {
        const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return tb - ta;
      });

      return allItems;
    }),
});
