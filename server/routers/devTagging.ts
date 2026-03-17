import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";
import { getDb } from "../db";
import {
  devProjectTagCategories,
  devProjectTagItems,
  devProducts,
  devProductTags,
} from "../../drizzle/schema";
import { eq, and, asc } from "drizzle-orm";

/**
 * 属性标注路由 — 与标签管理打通
 *
 * 流程：
 * 1. 读取标签管理中已确认的维度框架（devProjectTagCategories + devProjectTagItems）
 * 2. 读取项目产品数据（devProducts）
 * 3. AI按维度框架为每个ASIN打标，结果写入dev_product_tags
 * 4. 用户可手动编辑、确认/解锁
 */
export const devTaggingRouter = router({
  /**
   * 获取属性标注状态
   */
  getTaggingStatus: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { hasCategories: false, categoriesConfirmed: false, totalProducts: 0, taggedProducts: 0, confirmed: false };

      // 检查标签管理维度是否存在和确认
      const categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId));
      const confirmedCategories = categories.filter(c => c.confirmed === 1);

      // 产品数
      const products = await devDb.getDevProductsByProject(input.projectId);

      // 已打标的产品（有dev_product_tags记录的ASIN数）
      const existingTags = await db.select().from(devProductTags)
        .where(eq(devProductTags.projectId, input.projectId));
      const taggedAsins = new Set(existingTags.map(t => t.asin));

      // 确认状态
      const allConfirmed = existingTags.length > 0 && existingTags.every(t => t.confirmed === 1);

      return {
        hasCategories: categories.length > 0,
        categoriesConfirmed: confirmedCategories.length > 0,
        totalCategories: categories.length,
        confirmedCategoriesCount: confirmedCategories.length,
        totalProducts: products.length,
        taggedProducts: taggedAsins.size,
        totalTags: existingTags.length,
        confirmed: allConfirmed,
      };
    }),

  /**
   * 获取维度框架（从标签管理读取）
   */
  getDimensions: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId))
        .orderBy(asc(devProjectTagCategories.sortOrder));

      const items = await db.select().from(devProjectTagItems)
        .where(eq(devProjectTagItems.projectId, input.projectId))
        .orderBy(asc(devProjectTagItems.sortOrder));

      return categories.map(cat => ({
        id: cat.id,
        categoryKey: cat.categoryKey,
        categoryName: cat.categoryName,
        description: cat.description,
        confirmed: cat.confirmed === 1,
        items: items
          .filter(item => item.categoryId === cat.id)
          .map(item => ({
            id: item.id,
            tagName: item.tagName,
            tagValue: item.tagValue,
          })),
      }));
    }),

  /**
   * 核心：AI属性标注 — 读取标签管理维度框架，为每个ASIN打标
   */
  startTagging: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 1. 读取标签管理维度框架
      const categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId))
        .orderBy(asc(devProjectTagCategories.sortOrder));

      if (categories.length === 0) {
        throw new Error("请先在「标签管理」中生成或添加属性维度框架");
      }

      const confirmedCats = categories.filter(c => c.confirmed === 1);
      if (confirmedCats.length === 0) {
        throw new Error("请先在「标签管理」中确认至少一个属性维度");
      }

      // 读取每个维度下的可选标签值
      const items = await db.select().from(devProjectTagItems)
        .where(eq(devProjectTagItems.projectId, input.projectId))
        .orderBy(asc(devProjectTagItems.sortOrder));

      const dimensionFramework = confirmedCats.map(cat => {
        const catItems = items.filter(item => item.categoryId === cat.id);
        return {
          dimensionName: cat.categoryName,
          description: cat.description || "",
          availableValues: catItems.map(item => item.tagName),
        };
      });

      // 2. 读取产品数据
      const products = await devDb.getDevProductsByProject(input.projectId);
      if (products.length === 0) throw new Error("项目中没有产品数据");

      // 3. 构建AI提示词
      const dimensionText = dimensionFramework.map((d, i) => {
        const valuesText = d.availableValues.length > 0
          ? `可选值：[${d.availableValues.join("、")}]`
          : "（无预设值，请从产品原文中提取）";
        return `${i + 1}. ${d.dimensionName}${d.description ? `（${d.description}）` : ""}\n   ${valuesText}`;
      }).join("\n");

      const systemPrompt = `你是一个亚马逊产品属性标注专家。你的任务是根据产品的标题和五点描述，为每个产品在指定的属性维度上打标签。

## 属性维度框架（来自标签管理）：
${dimensionText}

## 严格规则：
1. **只从原文提取**：每个标签值必须有产品标题或五点描述中的原文依据，绝对禁止编造不在原文中的属性
2. **优先使用可选值**：如果维度有预设的可选值列表，优先从中选择最匹配的值；如果原文中的属性不在可选值中但确实存在，可以新增
3. **中文输出**：所有标签值必须为中文（如原文是英文，翻译为中文）
4. **无法判断时留空**：如果产品原文中没有该维度的信息，value填空字符串""，不要猜测
5. **一个维度一个值**：每个维度只输出一个最准确的值（如有多个，选最核心的）
6. **差异化特征不遗漏**：特别注意产品的独特功能、专利技术、特殊设计等差异化特征`;

      // 4. 分批处理产品（每批5个）
      const batchSize = 5;
      const allTags: Array<{
        projectId: number;
        asin: string;
        dimensionName: string;
        dimensionValue: string;
        source: "ai" | "manual" | "specification";
        confirmed: number;
      }> = [];

      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        const productData = batch.map(p => ({
          asin: p.asin || "",
          title: p.title || "",
          bulletPoints: p.bulletPoints || "",
          specifications: p.specifications || "",
        }));

        // 构建JSON schema的dimensions属性
        const dimensionProperties: Record<string, any> = {};
        const dimensionRequired: string[] = [];
        dimensionFramework.forEach((d, idx) => {
          const key = `dim_${idx}`;
          dimensionProperties[key] = {
            type: "string",
            description: `${d.dimensionName}的标签值（中文）。可选值：${d.availableValues.join("、") || "从原文提取"}。无法判断时填空字符串""`,
          };
          dimensionRequired.push(key);
        });

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `请为以下${batch.length}个产品打标签。每个产品按照维度框架输出标签值。

产品数据：
${productData.map((p, idx) => `--- 产品${idx + 1} [${p.asin}] ---
标题：${p.title}
五点描述：${p.bulletPoints}
${p.specifications ? `详细参数：${p.specifications}` : ""}`).join("\n\n")}`,
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "product_tagging",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    products: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          asin: { type: "string", description: "产品ASIN" },
                          dimensions: {
                            type: "object",
                            properties: dimensionProperties,
                            required: dimensionRequired,
                            additionalProperties: false,
                          },
                        },
                        required: ["asin", "dimensions"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["products"],
                  additionalProperties: false,
                },
              },
            },
          });

          const content = response.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content as string);
            for (const item of parsed.products || []) {
              const asin = item.asin;
              if (!asin) continue;

              dimensionFramework.forEach((d, idx) => {
                const key = `dim_${idx}`;
                const value = (item.dimensions?.[key] || "").trim();
                if (value) {
                  allTags.push({
                    projectId: input.projectId,
                    asin,
                    dimensionName: d.dimensionName,
                    dimensionValue: value,
                    source: "ai",
                    confirmed: 0,
                  });
                }
              });
            }
          }
        } catch (err) {
          console.error(`[DevTagging] Batch error at index ${i}:`, err);
        }
      }

      // 5. 写入dev_product_tags表（先清除旧的AI标签，保留手动标签）
      if (allTags.length > 0) {
        // 删除该项目所有AI来源的标签
        await db.delete(devProductTags).where(
          and(
            eq(devProductTags.projectId, input.projectId),
            eq(devProductTags.source, "ai")
          )
        );

        // 批量插入新标签
        for (let i = 0; i < allTags.length; i += 100) {
          await db.insert(devProductTags).values(allTags.slice(i, i + 100));
        }
      }

      return {
        success: true,
        tagged: new Set(allTags.map(t => t.asin)).size,
        total: products.length,
        totalTags: allTags.length,
        dimensions: dimensionFramework.length,
      };
    }),

  /**
   * 获取打标结果（按ASIN分组）
   */
  getTaggedProducts: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const products = await devDb.getDevProductsByProject(input.projectId);
      const tags = await db.select().from(devProductTags)
        .where(eq(devProductTags.projectId, input.projectId));

      // 按ASIN分组
      const tagMap = new Map<string, typeof tags>();
      for (const tag of tags) {
        if (!tagMap.has(tag.asin)) tagMap.set(tag.asin, []);
        tagMap.get(tag.asin)!.push(tag);
      }

      return products.map(p => ({
        id: p.id,
        asin: p.asin || "",
        title: p.title || "",
        brand: p.brand || "",
        tags: tagMap.get(p.asin || "") || [],
      }));
    }),

  /**
   * 更新单个标签值
   */
  updateTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      dimensionValue: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(devProductTags)
        .set({ dimensionValue: input.dimensionValue, source: "manual" })
        .where(eq(devProductTags.id, input.tagId));
      return { success: true };
    }),

  /**
   * 手动添加标签
   */
  addTag: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      asin: z.string(),
      dimensionName: z.string(),
      dimensionValue: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [result] = await db.insert(devProductTags).values({
        projectId: input.projectId,
        asin: input.asin,
        dimensionName: input.dimensionName,
        dimensionValue: input.dimensionValue,
        source: "manual",
        confirmed: 0,
      });
      return { success: true, id: result.insertId };
    }),

  /**
   * 删除单个标签
   */
  deleteTag: protectedProcedure
    .input(z.object({ tagId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(devProductTags).where(eq(devProductTags.id, input.tagId));
      return { success: true };
    }),

  /**
   * 确认所有标签
   */
  confirmAll: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await devDb.confirmAllDevProductTags(input.projectId);
      return { success: true };
    }),

  /**
   * 解锁标签（取消确认）
   */
  unlockAll: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(devProductTags)
        .set({ confirmed: 0 })
        .where(eq(devProductTags.projectId, input.projectId));
      return { success: true };
    }),

  // Legacy: Tag dimensions CRUD (kept for backward compatibility)
  getTagDimensions: protectedProcedure.query(async ({ ctx }) => {
    return devDb.getDevTagDimensions(ctx.user.id);
  }),

  addTagDimension: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.string().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return devDb.createDevTagDimension({
        userId: ctx.user.id,
        name: input.name,
        category: input.category ?? null,
        description: input.description ?? null,
      });
    }),

  deleteTagDimension: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return devDb.deleteDevTagDimension(input.id, ctx.user.id);
    }),
});
