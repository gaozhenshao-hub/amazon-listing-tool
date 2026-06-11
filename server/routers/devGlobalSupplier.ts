import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as devDb from "../devDb";

/**
 * 全局供应商库路由
 * 
 * 功能:
 * 1. list - 列出当前用户的所有全局供应商
 * 2. add - 新增供应商
 * 3. update - 更新供应商
 * 4. delete - 删除供应商
 * 5. batchImport - 批量导入供应商（从前端解析的CSV/Excel数据）
 * 6. getById - 获取单个供应商详情
 */

export const devGlobalSupplierRouter = router({
  // 列出当前用户的所有全局供应商
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const suppliers = await devDb.getDevGlobalSuppliers(ctx.user.id);
      let filtered = suppliers;

      if (input?.search) {
        const q = input.search.toLowerCase();
        filtered = filtered.filter((s: any) =>
          s.name.toLowerCase().includes(q) ||
          (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q)) ||
          (s.notes && s.notes.toLowerCase().includes(q))
        );
      }

      if (input?.category) {
        filtered = filtered.filter((s: any) => {
          const cats = safeParseJson(s.categories);
          return Array.isArray(cats) && cats.includes(input.category);
        });
      }

      return filtered;
    }),

  // 获取单个供应商详情
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const suppliers = await devDb.getDevGlobalSuppliers(ctx.user.id);
      return suppliers.find((s: any) => s.id === input.id) || null;
    }),

  // 新增供应商
  add: protectedProcedure
    .input(z.object({
      name: z.string().min(1, "供应商名称不能为空"),
      contactPerson: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      categories: z.array(z.string()).optional(),
      website: z.string().optional(),
      qualityCerts: z.string().optional(),
      overallScore: z.number().min(1).max(10).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return devDb.saveDevGlobalSupplier({
        userId: ctx.user.id,
        name: input.name,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        categories: input.categories ? JSON.stringify(input.categories) : null,
        website: input.website ?? null,
        qualityCerts: input.qualityCerts ?? null,
        overallScore: input.overallScore ?? null,
        notes: input.notes ?? null,
      });
    }),

  // 更新供应商
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      contactPerson: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      categories: z.array(z.string()).optional(),
      website: z.string().optional(),
      qualityCerts: z.string().optional(),
      overallScore: z.number().min(1).max(10).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, categories, ...rest } = input;
      const updateData: any = { id, ...rest };
      if (categories !== undefined) {
        updateData.categories = JSON.stringify(categories);
      }
      return devDb.saveDevGlobalSupplier(updateData);
    }),

  // 删除供应商
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await devDb.deleteDevGlobalSupplier(input.id, ctx.user.id);
      return { success: true };
    }),

  // 批量导入供应商（前端解析CSV/Excel后传入结构化数据）
  batchImport: protectedProcedure
    .input(z.object({
      suppliers: z.array(z.object({
        name: z.string().min(1),
        contactPerson: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        address: z.string().optional(),
        categories: z.array(z.string()).optional(),
        website: z.string().optional(),
        qualityCerts: z.string().optional(),
        overallScore: z.number().optional(),
        notes: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const supplier of input.suppliers) {
        try {
          await devDb.saveDevGlobalSupplier({
            userId: ctx.user.id,
            name: supplier.name,
            contactPerson: supplier.contactPerson ?? null,
            phone: supplier.phone ?? null,
            email: supplier.email ?? null,
            address: supplier.address ?? null,
            categories: supplier.categories ? JSON.stringify(supplier.categories) : null,
            website: supplier.website ?? null,
            qualityCerts: supplier.qualityCerts ?? null,
            overallScore: supplier.overallScore ?? null,
            notes: supplier.notes ?? null,
          });
          imported++;
        } catch (err: any) {
          failed++;
          errors.push(`${supplier.name}: ${err.message}`);
        }
      }

      return { imported, failed, errors };
    }),
});

function safeParseJson(raw: any): any {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}
