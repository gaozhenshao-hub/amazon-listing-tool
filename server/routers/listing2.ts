import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { listing2Products } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

export const listing2Router = router({
  // 获取产品列表
  listProducts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    return db
      .select()
      .from(listing2Products)
      .where(eq(listing2Products.status, "active"))
      .orderBy(desc(listing2Products.updatedAt));
  }),

  // 获取单个产品
  getProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const rows = await db
        .select()
        .from(listing2Products)
        .where(eq(listing2Products.id, input.id));
      return rows[0] ?? null;
    }),

  // 新增产品
  createProduct: protectedProcedure
    .input(z.object({
      title: z.string().min(1, "产品名称不能为空"),
      asin: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const [result] = await db.insert(listing2Products).values({
        userId: ctx.user.id,
        title: input.title,
        asin: input.asin ?? null,
        status: "active",
        currentStep: 1,
      });
      return { id: result.insertId };
    }),

  // 更新当前步骤
  updateStep: protectedProcedure
    .input(z.object({
      id: z.number(),
      currentStep: z.number().min(1).max(10),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      await db
        .update(listing2Products)
        .set({ currentStep: input.currentStep })
        .where(eq(listing2Products.id, input.id));
      return { success: true };
    }),

  // 归档产品
  archiveProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      await db
        .update(listing2Products)
        .set({ status: "archived" })
        .where(eq(listing2Products.id, input.id));
      return { success: true };
    }),
});
