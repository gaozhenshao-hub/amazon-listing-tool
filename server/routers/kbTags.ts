import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { eq, and, desc, asc, sql, like, or, inArray } from "drizzle-orm";
import { kbTagDefinitions, kbImageSets, kbImages } from "../../drizzle/schema";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// Dimension definitions for the tag system
const DIMENSIONS = [
  { key: "category", label: "产品类目", level: "set", hasParent: false },
  { key: "color", label: "颜色标签", level: "both", hasParent: false },
  { key: "style", label: "设计风格", level: "set", hasParent: false },
  { key: "imageType", label: "图片类型", level: "image", hasParent: true },
  { key: "sellingPoint", label: "卖点分类", level: "image", hasParent: true },
  { key: "composition", label: "构图类型", level: "image", hasParent: false },
  { key: "imageBelong", label: "图片归属", level: "image", hasParent: true },
] as const;

export const kbTagsRouter = router({
  // Get all dimension definitions
  getDimensions: protectedProcedure.query(() => {
    return DIMENSIONS;
  }),

  // List tags by dimension (with optional parent filter for hierarchical tags)
  listByDimension: protectedProcedure
    .input(z.object({
      dimension: z.string(),
      parentValue: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const d = await db();
      const conditions = [eq(kbTagDefinitions.dimension, input.dimension)];
      if (input.parentValue !== undefined) {
        conditions.push(eq(kbTagDefinitions.parentValue, input.parentValue));
      }
      const tags = await d.select().from(kbTagDefinitions)
        .where(and(...conditions))
        .orderBy(asc(kbTagDefinitions.sortOrder), asc(kbTagDefinitions.id));
      return tags;
    }),

  // List all tags for a dimension (including all parent groups for hierarchical)
  listAllForDimension: protectedProcedure
    .input(z.object({ dimension: z.string() }))
    .query(async ({ input }) => {
      const d = await db();
      const tags = await d.select().from(kbTagDefinitions)
        .where(eq(kbTagDefinitions.dimension, input.dimension))
        .orderBy(asc(kbTagDefinitions.parentValue), asc(kbTagDefinitions.sortOrder), asc(kbTagDefinitions.id));
      return tags;
    }),

  // Create a new tag (admin for system tags, any user for custom tags)
  create: protectedProcedure
    .input(z.object({
      dimension: z.string(),
      parentValue: z.string().optional(),
      value: z.string().min(1).max(200),
      isSystem: z.boolean().default(false),
      metadata: z.string().optional(), // JSON string for style params
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const user = ctx.user;
      // Only admin/super_admin can create system tags
      if (input.isSystem && !["admin", "super_admin"].includes(user.role)) {
        throw new Error("只有管理员可以创建系统标签");
      }
      // Get max sortOrder for this dimension+parent
      const existing = await d.select({ maxSort: sql<number>`MAX(${kbTagDefinitions.sortOrder})` })
        .from(kbTagDefinitions)
        .where(and(
          eq(kbTagDefinitions.dimension, input.dimension),
          input.parentValue ? eq(kbTagDefinitions.parentValue, input.parentValue) : sql`${kbTagDefinitions.parentValue} IS NULL`
        ));
      const nextSort = (existing[0]?.maxSort ?? -1) + 1;

      const result = await d.insert(kbTagDefinitions).values({
        userId: user.id,
        dimension: input.dimension,
        parentValue: input.parentValue || null,
        value: input.value,
        sortOrder: nextSort,
        isSystem: input.isSystem ? 1 : 0,
        metadata: input.metadata || null,
      });
      return { id: result[0].insertId };
    }),

  // Update a tag value or metadata
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      value: z.string().min(1).max(200).optional(),
      metadata: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const user = ctx.user;
      // Check if tag exists and permissions
      const [tag] = await d.select().from(kbTagDefinitions).where(eq(kbTagDefinitions.id, input.id));
      if (!tag) throw new Error("标签不存在");
      if (tag.isSystem && !["admin", "super_admin"].includes(user.role)) {
        throw new Error("只有管理员可以编辑系统标签");
      }
      if (!tag.isSystem && tag.userId !== user.id && !["admin", "super_admin"].includes(user.role)) {
        throw new Error("只能编辑自己创建的标签");
      }
      const updates: Record<string, any> = {};
      if (input.value !== undefined) updates.value = input.value;
      if (input.metadata !== undefined) updates.metadata = input.metadata;
      if (Object.keys(updates).length > 0) {
        await d.update(kbTagDefinitions).set(updates).where(eq(kbTagDefinitions.id, input.id));
      }
      return { success: true };
    }),

  // Delete a tag (only if usageCount is 0 or admin force delete)
  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
      force: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const user = ctx.user;
      const [tag] = await d.select().from(kbTagDefinitions).where(eq(kbTagDefinitions.id, input.id));
      if (!tag) throw new Error("标签不存在");
      if (tag.isSystem && !["admin", "super_admin"].includes(user.role)) {
        throw new Error("只有管理员可以删除系统标签");
      }
      if (!tag.isSystem && tag.userId !== user.id && !["admin", "super_admin"].includes(user.role)) {
        throw new Error("只能删除自己创建的标签");
      }
      if (tag.usageCount > 0 && !input.force) {
        throw new Error(`该标签已被 ${tag.usageCount} 张图片/套图引用，无法删除。如需强制删除请确认。`);
      }
      await d.delete(kbTagDefinitions).where(eq(kbTagDefinitions.id, input.id));
      return { success: true };
    }),

  // Reorder tags within a dimension
  reorder: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()), // ordered list of tag IDs
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const user = ctx.user;
      // Only admin can reorder system tags
      for (let i = 0; i < input.ids.length; i++) {
        await d.update(kbTagDefinitions)
          .set({ sortOrder: i })
          .where(eq(kbTagDefinitions.id, input.ids[i]));
      }
      return { success: true };
    }),

  // Get usage statistics for all dimensions
  getUsageStats: protectedProcedure.query(async () => {
    const d = await db();
    // Count images per dimension value
    const stats: Record<string, { total: number; labeled: number; topValues: { value: string; count: number }[] }> = {};

    // Category (set-level)
    const catCounts = await d.select({
      value: kbImageSets.setCategory,
      count: sql<number>`COUNT(*)`
    }).from(kbImageSets)
      .where(sql`${kbImageSets.setCategory} IS NOT NULL AND ${kbImageSets.setCategory} != ''`)
      .groupBy(kbImageSets.setCategory)
      .orderBy(desc(sql`COUNT(*)`));
    const totalSets = await d.select({ count: sql<number>`COUNT(*)` }).from(kbImageSets);
    stats.category = {
      total: totalSets[0]?.count || 0,
      labeled: catCounts.reduce((sum, c) => sum + c.count, 0),
      topValues: catCounts.slice(0, 10).map(c => ({ value: c.value || "", count: c.count })),
    };

    // Primary Color (set-level)
    const colorCounts = await d.select({
      value: kbImageSets.setPrimaryColor,
      count: sql<number>`COUNT(*)`
    }).from(kbImageSets)
      .where(sql`${kbImageSets.setPrimaryColor} IS NOT NULL AND ${kbImageSets.setPrimaryColor} != ''`)
      .groupBy(kbImageSets.setPrimaryColor)
      .orderBy(desc(sql`COUNT(*)`));
    stats.color = {
      total: totalSets[0]?.count || 0,
      labeled: colorCounts.reduce((sum, c) => sum + c.count, 0),
      topValues: colorCounts.slice(0, 10).map(c => ({ value: c.value || "", count: c.count })),
    };

    // Style (set-level)
    const styleCounts = await d.select({
      value: kbImageSets.setStyle,
      count: sql<number>`COUNT(*)`
    }).from(kbImageSets)
      .where(sql`${kbImageSets.setStyle} IS NOT NULL AND ${kbImageSets.setStyle} != ''`)
      .groupBy(kbImageSets.setStyle)
      .orderBy(desc(sql`COUNT(*)`));
    stats.style = {
      total: totalSets[0]?.count || 0,
      labeled: styleCounts.reduce((sum, c) => sum + c.count, 0),
      topValues: styleCounts.slice(0, 10).map(c => ({ value: c.value || "", count: c.count })),
    };

    // Image Type (image-level)
    const totalImages = await d.select({ count: sql<number>`COUNT(*)` }).from(kbImages);
    const typeCounts = await d.select({
      value: kbImages.tagImageTypeMain,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagImageTypeMain} IS NOT NULL AND ${kbImages.tagImageTypeMain} != ''`)
      .groupBy(kbImages.tagImageTypeMain)
      .orderBy(desc(sql`COUNT(*)`));
    stats.imageType = {
      total: totalImages[0]?.count || 0,
      labeled: typeCounts.reduce((sum, c) => sum + c.count, 0),
      topValues: typeCounts.slice(0, 10).map(c => ({ value: c.value || "", count: c.count })),
    };

    // Selling Point (image-level)
    const spCounts = await d.select({
      value: kbImages.tagSellingPointCategory,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagSellingPointCategory} IS NOT NULL AND ${kbImages.tagSellingPointCategory} != ''`)
      .groupBy(kbImages.tagSellingPointCategory)
      .orderBy(desc(sql`COUNT(*)`));
    stats.sellingPoint = {
      total: totalImages[0]?.count || 0,
      labeled: spCounts.reduce((sum, c) => sum + c.count, 0),
      topValues: spCounts.slice(0, 10).map(c => ({ value: c.value || "", count: c.count })),
    };

    // Composition (image-level)
    const compCounts = await d.select({
      value: kbImages.tagComposition,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagComposition} IS NOT NULL AND ${kbImages.tagComposition} != ''`)
      .groupBy(kbImages.tagComposition)
      .orderBy(desc(sql`COUNT(*)`));
    stats.composition = {
      total: totalImages[0]?.count || 0,
      labeled: compCounts.reduce((sum, c) => sum + c.count, 0),
      topValues: compCounts.slice(0, 10).map(c => ({ value: c.value || "", count: c.count })),
    };

    // Image Belong (image-level)
    const belongCounts = await d.select({
      value: kbImages.tagImageBelong,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagImageBelong} IS NOT NULL AND ${kbImages.tagImageBelong} != ''`)
      .groupBy(kbImages.tagImageBelong)
      .orderBy(desc(sql`COUNT(*)`));
    stats.imageBelong = {
      total: totalImages[0]?.count || 0,
      labeled: belongCounts.reduce((sum, c) => sum + c.count, 0),
      topValues: belongCounts.slice(0, 10).map(c => ({ value: c.value || "", count: c.count })),
    };

    return stats;
  }),

  // Get live tag counts from actual image/set data (for filter dropdown suffixes)
  getTagCountsLive: protectedProcedure.query(async () => {
    const d = await db();
    const counts: Record<string, number> = {};

    // Style counts (set-level: setStyle)
    const styleCounts = await d.select({
      value: kbImageSets.setStyle,
      count: sql<number>`COUNT(*)`
    }).from(kbImageSets)
      .where(sql`${kbImageSets.setStyle} IS NOT NULL AND ${kbImageSets.setStyle} != ''`)
      .groupBy(kbImageSets.setStyle);
    for (const r of styleCounts) if (r.value) counts[`style:${r.value}`] = r.count;

    // Category counts (set-level: setCategory)
    const catCounts = await d.select({
      value: kbImageSets.setCategory,
      count: sql<number>`COUNT(*)`
    }).from(kbImageSets)
      .where(sql`${kbImageSets.setCategory} IS NOT NULL AND ${kbImageSets.setCategory} != ''`)
      .groupBy(kbImageSets.setCategory);
    for (const r of catCounts) if (r.value) counts[`category:${r.value}`] = r.count;

    // Primary Color counts (set-level: setPrimaryColor)
    const colorCounts = await d.select({
      value: kbImageSets.setPrimaryColor,
      count: sql<number>`COUNT(*)`
    }).from(kbImageSets)
      .where(sql`${kbImageSets.setPrimaryColor} IS NOT NULL AND ${kbImageSets.setPrimaryColor} != ''`)
      .groupBy(kbImageSets.setPrimaryColor);
    for (const r of colorCounts) if (r.value) counts[`color:${r.value}`] = r.count;

    // Accent Color counts (set-level: setAccentColor)
    const accentCounts = await d.select({
      value: kbImageSets.setAccentColor,
      count: sql<number>`COUNT(*)`
    }).from(kbImageSets)
      .where(sql`${kbImageSets.setAccentColor} IS NOT NULL AND ${kbImageSets.setAccentColor} != ''`)
      .groupBy(kbImageSets.setAccentColor);
    for (const r of accentCounts) if (r.value) counts[`accentColor:${r.value}`] = r.count;

    // Image Belong counts (image-level: tagImageBelong)
    const belongCounts = await d.select({
      value: kbImages.tagImageBelong,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagImageBelong} IS NOT NULL AND ${kbImages.tagImageBelong} != ''`)
      .groupBy(kbImages.tagImageBelong);
    for (const r of belongCounts) if (r.value) counts[`imageBelong:${r.value}`] = r.count;

    // Image Type Main counts (image-level)
    const typeCounts = await d.select({
      value: kbImages.tagImageTypeMain,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagImageTypeMain} IS NOT NULL AND ${kbImages.tagImageTypeMain} != ''`)
      .groupBy(kbImages.tagImageTypeMain);
    for (const r of typeCounts) if (r.value) counts[`imageType:${r.value}`] = r.count;

    // Image Type Sub counts (image-level)
    const typeSubCounts = await d.select({
      value: kbImages.tagImageTypeSub,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagImageTypeSub} IS NOT NULL AND ${kbImages.tagImageTypeSub} != ''`)
      .groupBy(kbImages.tagImageTypeSub);
    for (const r of typeSubCounts) if (r.value) counts[`imageType:${r.value}`] = r.count;

    // Selling Point Category counts (image-level)
    const spCounts = await d.select({
      value: kbImages.tagSellingPointCategory,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagSellingPointCategory} IS NOT NULL AND ${kbImages.tagSellingPointCategory} != ''`)
      .groupBy(kbImages.tagSellingPointCategory);
    for (const r of spCounts) if (r.value) counts[`sellingPoint:${r.value}`] = r.count;

    // Composition counts (image-level)
    const compCounts = await d.select({
      value: kbImages.tagComposition,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagComposition} IS NOT NULL AND ${kbImages.tagComposition} != ''`)
      .groupBy(kbImages.tagComposition);
    for (const r of compCounts) if (r.value) counts[`composition:${r.value}`] = r.count;

    // Design Style V2 counts (image-level, for individual images)
    const imgStyleCounts = await d.select({
      value: kbImages.tagDesignStyleV2,
      count: sql<number>`COUNT(*)`
    }).from(kbImages)
      .where(sql`${kbImages.tagDesignStyleV2} IS NOT NULL AND ${kbImages.tagDesignStyleV2} != ''`)
      .groupBy(kbImages.tagDesignStyleV2);
    for (const r of imgStyleCounts) if (r.value) {
      // Merge with set-level style counts
      counts[`style:${r.value}`] = (counts[`style:${r.value}`] || 0) + r.count;
    }

    return counts;
  }),

  // Initialize system tags from constants (admin only)
  initSystemTags: adminProcedure
    .mutation(async ({ ctx }) => {
      const d = await db();
      const userId = ctx.user.id;

      // Import constants
      const {
        CATEGORY_OPTIONS, COLOR_TAG_OPTIONS, IMAGE_STYLES,
        IMAGE_TYPE_HIERARCHY, SELLING_POINT_HIERARCHY,
        COMPOSITION_OPTIONS, IMAGE_BELONG_HIERARCHY
      } = await import("../constants/imageTagConstants");

      let inserted = 0;

      // Helper to upsert
      async function upsertTag(dimension: string, value: string, parentValue?: string, metadata?: string) {
        const existing = await d.select().from(kbTagDefinitions).where(and(
          eq(kbTagDefinitions.dimension, dimension),
          parentValue ? eq(kbTagDefinitions.parentValue, parentValue) : sql`${kbTagDefinitions.parentValue} IS NULL`,
          eq(kbTagDefinitions.value, value)
        ));
        if (existing.length === 0) {
          const maxSort = await d.select({ m: sql<number>`MAX(${kbTagDefinitions.sortOrder})` })
            .from(kbTagDefinitions)
            .where(and(
              eq(kbTagDefinitions.dimension, dimension),
              parentValue ? eq(kbTagDefinitions.parentValue, parentValue) : sql`${kbTagDefinitions.parentValue} IS NULL`
            ));
          await d.insert(kbTagDefinitions).values({
            userId, dimension, parentValue: parentValue || null,
            value, sortOrder: (maxSort[0]?.m ?? -1) + 1,
            isSystem: 1, metadata: metadata || null,
          });
          inserted++;
        }
      }

      // Category
      for (const cat of CATEGORY_OPTIONS) {
        await upsertTag("category", cat);
      }
      // Color
      for (const color of COLOR_TAG_OPTIONS) {
        await upsertTag("color", color);
      }
      // Style (with metadata)
      for (const style of IMAGE_STYLES) {
        await upsertTag("style", style.name, undefined, JSON.stringify({
          lightType: style.lightType,
          colorTemp: style.colorTemp,
          materialKeywords: style.materialKeywords,
          tabooElements: style.tabooElements,
          refBrands: style.refBrands,
          aiKeywords: style.aiKeywords,
        }));
      }
      // Image Type (hierarchical)
      for (const [main, subs] of Object.entries(IMAGE_TYPE_HIERARCHY)) {
        await upsertTag("imageType", main); // parent entry
        for (const sub of subs) {
          await upsertTag("imageType", sub, main); // child entry
        }
      }
      // Selling Point (hierarchical)
      for (const [main, subs] of Object.entries(SELLING_POINT_HIERARCHY)) {
        await upsertTag("sellingPoint", main); // parent entry
        for (const sub of subs) {
          await upsertTag("sellingPoint", sub, main); // child entry
        }
      }
      // Composition
      for (const comp of COMPOSITION_OPTIONS) {
        await upsertTag("composition", comp);
      }
      // Image Belong (hierarchical - A+ has sub-modules)
      for (const [belong, subs] of Object.entries(IMAGE_BELONG_HIERARCHY)) {
        await upsertTag("imageBelong", belong); // parent entry
        for (const sub of subs as string[]) {
          await upsertTag("imageBelong", sub, belong); // child entry
        }
      }

      return { inserted, message: `成功初始化 ${inserted} 个系统标签` };
    }),

  // Batch create tags (for parent group creation in hierarchical dimensions)
  batchCreate: adminProcedure
    .input(z.object({
      dimension: z.string(),
      parentValue: z.string().optional(),
      values: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const userId = ctx.user.id;
      let inserted = 0;
      for (let i = 0; i < input.values.length; i++) {
        const existing = await d.select().from(kbTagDefinitions).where(and(
          eq(kbTagDefinitions.dimension, input.dimension),
          input.parentValue ? eq(kbTagDefinitions.parentValue, input.parentValue) : sql`${kbTagDefinitions.parentValue} IS NULL`,
          eq(kbTagDefinitions.value, input.values[i])
        ));
        if (existing.length === 0) {
          await d.insert(kbTagDefinitions).values({
            userId, dimension: input.dimension,
            parentValue: input.parentValue || null,
            value: input.values[i], sortOrder: i,
            isSystem: 1, metadata: null,
          });
          inserted++;
        }
      }
      return { inserted };
    }),
});
