import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import { devProjectTagCategories, devProjectTagItems, devProducts } from "../../drizzle/schema";
import { eq, and, asc } from "drizzle-orm";

async function ensureDb() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// Default 7 tag categories
const DEFAULT_CATEGORIES = [
  { key: "basic", name: "基础分类属性", description: "产品大类、子类目、款式类型等基础分类信息", order: 1 },
  { key: "material", name: "材质属性", description: "主要材质、次要材质、表面处理工艺等", order: 2 },
  { key: "function", name: "功能属性", description: "核心功能、附加功能、智能特性等", order: 3 },
  { key: "parameter", name: "参数属性", description: "尺寸、重量、功率、容量、电压等关键参数", order: 4 },
  { key: "installation", name: "安装方式", description: "安装类型、安装难度、所需工具等", order: 5 },
  { key: "certification", name: "认证标准", description: "UL、ETL、CE、FCC、FDA等认证信息", order: 6 },
  { key: "special", name: "特殊属性", description: "专利特征、独特卖点、差异化特性等", order: 7 },
];

// Parse CSV content into rows
function parseCSV(content: string): string[][] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  return lines.map(line => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  });
}

// Auto-detect column mapping from header row
function detectColumns(headers: string[]): { categoryCol: number; nameCol: number; valueCol: number } {
  const lower = headers.map(h => h.toLowerCase().trim());
  let categoryCol = -1, nameCol = -1, valueCol = -1;

  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (categoryCol === -1 && (h.includes("分类") || h.includes("category") || h.includes("类别") || h.includes("属性类型") || h.includes("type"))) categoryCol = i;
    else if (nameCol === -1 && (h.includes("标签名") || h.includes("属性名") || h.includes("tag") || h.includes("name") || h.includes("名称"))) nameCol = i;
    else if (valueCol === -1 && (h.includes("标签值") || h.includes("属性值") || h.includes("value") || h.includes("值") || h.includes("说明"))) valueCol = i;
  }

  // Fallback: if only 2 columns, assume category + name
  if (categoryCol === -1 && nameCol === -1 && headers.length >= 2) {
    categoryCol = 0;
    nameCol = 1;
    valueCol = headers.length >= 3 ? 2 : -1;
  }
  // If only 1 column, treat as tag names (no category)
  if (categoryCol === -1 && nameCol === -1 && headers.length === 1) {
    nameCol = 0;
  }

  return { categoryCol, nameCol, valueCol };
}

export const devProjectTagsRouter = router({
  // Initialize default categories for a project
  initCategories: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      const existing = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId));
      if (existing.length > 0) return { success: true, count: existing.length, message: "已存在" };

      for (const cat of DEFAULT_CATEGORIES) {
        await db.insert(devProjectTagCategories).values({
          projectId: input.projectId,
          userId: ctx.user.id,
          categoryKey: cat.key,
          categoryName: cat.name,
          description: cat.description,
          sortOrder: cat.order,
        });
      }
      return { success: true, count: DEFAULT_CATEGORIES.length, message: "初始化完成" };
    }),

  // Get all categories with their tag items for a project
  getCategories: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await ensureDb();
      const categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId))
        .orderBy(asc(devProjectTagCategories.sortOrder));

      const items = await db.select().from(devProjectTagItems)
        .where(eq(devProjectTagItems.projectId, input.projectId))
        .orderBy(asc(devProjectTagItems.sortOrder));

      return categories.map((cat: any) => ({
        ...cat,
        items: items.filter((item: any) => item.categoryId === cat.id),
      }));
    }),

  // Update category name
  updateCategoryName: protectedProcedure
    .input(z.object({
      categoryId: z.number(),
      categoryName: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      await db.update(devProjectTagCategories)
        .set({ categoryName: input.categoryName })
        .where(eq(devProjectTagCategories.id, input.categoryId));
      return { success: true };
    }),

  // Add a new custom category
  addCategory: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      categoryName: z.string().min(1).max(100),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      const existing = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId));
      const maxOrder = Math.max(0, ...existing.map((c: any) => c.sortOrder));

      const [result] = await db.insert(devProjectTagCategories).values({
        projectId: input.projectId,
        userId: ctx.user.id,
        categoryKey: `custom_${Date.now()}`,
        categoryName: input.categoryName,
        description: input.description ?? null,
        sortOrder: maxOrder + 1,
      });
      return { success: true, id: result.insertId };
    }),

  // Delete a category and its items
  deleteCategory: protectedProcedure
    .input(z.object({ categoryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      await db.delete(devProjectTagItems).where(eq(devProjectTagItems.categoryId, input.categoryId));
      await db.delete(devProjectTagCategories).where(eq(devProjectTagCategories.id, input.categoryId));
      return { success: true };
    }),

  // Add a tag item to a category
  addTagItem: protectedProcedure
    .input(z.object({
      categoryId: z.number(),
      projectId: z.number(),
      tagName: z.string().min(1).max(255),
      tagValue: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      const existing = await db.select().from(devProjectTagItems)
        .where(eq(devProjectTagItems.categoryId, input.categoryId));
      const maxOrder = Math.max(0, ...existing.map((i: any) => i.sortOrder));

      const [result] = await db.insert(devProjectTagItems).values({
        categoryId: input.categoryId,
        projectId: input.projectId,
        tagName: input.tagName,
        tagValue: input.tagValue ?? null,
        source: "manual",
        sortOrder: maxOrder + 1,
      });
      return { success: true, id: result.insertId };
    }),

  // Update a tag item
  updateTagItem: protectedProcedure
    .input(z.object({
      itemId: z.number(),
      tagName: z.string().min(1).max(255).optional(),
      tagValue: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      const updateData: any = {};
      if (input.tagName !== undefined) updateData.tagName = input.tagName;
      if (input.tagValue !== undefined) updateData.tagValue = input.tagValue;
      await db.update(devProjectTagItems).set(updateData).where(eq(devProjectTagItems.id, input.itemId));
      return { success: true };
    }),

  // Delete a tag item
  deleteTagItem: protectedProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      await db.delete(devProjectTagItems).where(eq(devProjectTagItems.id, input.itemId));
      return { success: true };
    }),

  // Confirm a category (lock it for analysis)
  confirmCategory: protectedProcedure
    .input(z.object({ categoryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      await db.update(devProjectTagCategories).set({
        confirmed: 1,
        confirmedAt: new Date(),
      }).where(eq(devProjectTagCategories.id, input.categoryId));
      return { success: true };
    }),

  // Unconfirm a category (unlock for editing)
  unconfirmCategory: protectedProcedure
    .input(z.object({ categoryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      await db.update(devProjectTagCategories).set({
        confirmed: 0,
        confirmedAt: null,
      }).where(eq(devProjectTagCategories.id, input.categoryId));
      return { success: true };
    }),

  // Confirm all categories at once
  confirmAll: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      await db.update(devProjectTagCategories).set({
        confirmed: 1,
        confirmedAt: new Date(),
      }).where(eq(devProjectTagCategories.projectId, input.projectId));
      return { success: true };
    }),

  // Get tag confirmation status for a project
  getTagStatus: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await ensureDb();
      const categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId));
      const total = categories.length;
      const confirmed = categories.filter((c: any) => c.confirmed === 1).length;
      return {
        total,
        confirmed,
        allConfirmed: total > 0 && confirmed === total,
        initialized: total > 0,
      };
    }),

  // Parse uploaded file and return preview data
  parseImportFile: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileContent: z.string(),
      fileName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const ext = input.fileName.toLowerCase().split(".").pop();
      let rows: string[][] = [];

      if (ext === "csv" || ext === "txt") {
        rows = parseCSV(input.fileContent);
      } else {
        throw new Error("仅支持 CSV 和 TXT 格式。如需导入 Excel，请先将其另存为 CSV 格式。");
      }

      if (rows.length < 2) throw new Error("文件至少需要包含表头行和一行数据");

      const headers = rows[0];
      const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));
      const detected = detectColumns(headers);

      // Build preview
      const preview = dataRows.slice(0, 50).map(row => ({
        category: detected.categoryCol >= 0 ? (row[detected.categoryCol] || "") : "",
        tagName: detected.nameCol >= 0 ? (row[detected.nameCol] || "") : "",
        tagValue: detected.valueCol >= 0 ? (row[detected.valueCol] || "") : "",
      })).filter(r => r.tagName.trim());

      // Unique categories found
      const uniqueCategories = Array.from(new Set(preview.map(r => r.category).filter(Boolean)));

      return {
        headers,
        totalRows: dataRows.length,
        previewRows: preview,
        detectedMapping: {
          categoryCol: detected.categoryCol,
          nameCol: detected.nameCol,
          valueCol: detected.valueCol,
        },
        uniqueCategories,
      };
    }),

  // Batch import tags from parsed file data
  batchImport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      items: z.array(z.object({
        category: z.string(),
        tagName: z.string(),
        tagValue: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      if (input.items.length === 0) throw new Error("没有可导入的数据");

      // Get existing categories
      let categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId));

      // If no categories exist, initialize defaults first
      if (categories.length === 0) {
        for (const cat of DEFAULT_CATEGORIES) {
          await db.insert(devProjectTagCategories).values({
            projectId: input.projectId,
            userId: ctx.user.id,
            categoryKey: cat.key,
            categoryName: cat.name,
            description: cat.description,
            sortOrder: cat.order,
          });
        }
        categories = await db.select().from(devProjectTagCategories)
          .where(eq(devProjectTagCategories.projectId, input.projectId));
      }

      let added = 0, skipped = 0, newCategories = 0;
      const catMap = new Map(categories.map((c: any) => [c.categoryName, c]));

      // Group items by category
      const grouped = new Map<string, { tagName: string; tagValue?: string }[]>();
      for (const item of input.items) {
        const catName = item.category.trim() || "未分类";
        if (!grouped.has(catName)) grouped.set(catName, []);
        grouped.get(catName)!.push({ tagName: item.tagName.trim(), tagValue: item.tagValue?.trim() });
      }

      for (const [catName, tags] of Array.from(grouped)) {
        // Find or create category
        let category = catMap.get(catName);
        if (!category) {
          // Try fuzzy match
          for (const [existingName, existingCat] of Array.from(catMap)) {
            if (existingName.includes(catName) || catName.includes(existingName)) {
              category = existingCat;
              break;
            }
          }
        }
        if (!category) {
          // Create new category
          const maxOrder = Math.max(0, ...categories.map((c: any) => c.sortOrder));
          const [result] = await db.insert(devProjectTagCategories).values({
            projectId: input.projectId,
            userId: ctx.user.id,
            categoryKey: `import_${Date.now()}_${newCategories}`,
            categoryName: catName,
            description: "批量导入创建",
            sortOrder: maxOrder + 1 + newCategories,
          });
          category = { id: Number(result.insertId), categoryName: catName } as any;
          catMap.set(catName, category);
          newCategories++;
        }

        // Get existing tag names for dedup
        const existingItems = await db.select().from(devProjectTagItems)
          .where(eq(devProjectTagItems.categoryId, (category as any).id));
        const existingNames = new Set(existingItems.map((i: any) => i.tagName.toLowerCase()));
        const maxOrder = Math.max(0, ...existingItems.map((i: any) => i.sortOrder));

        let orderOffset = 0;
        for (const tag of tags) {
          if (!tag.tagName || existingNames.has(tag.tagName.toLowerCase())) {
            skipped++;
            continue;
          }
          await db.insert(devProjectTagItems).values({
            categoryId: (category as any).id,
            projectId: input.projectId,
            tagName: tag.tagName,
            tagValue: tag.tagValue || null,
            source: "manual",
            sortOrder: maxOrder + 1 + orderOffset,
          });
          existingNames.add(tag.tagName.toLowerCase());
          added++;
          orderOffset++;
        }

        // Reset confirmed status since tags changed
        await db.update(devProjectTagCategories).set({
          confirmed: 0,
          confirmedAt: null,
        }).where(eq(devProjectTagCategories.id, (category as any).id));
      }

      return { success: true, added, skipped, newCategories, total: input.items.length };
    }),

  // Get import template content
  getImportTemplate: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await ensureDb();
      const categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId))
        .orderBy(asc(devProjectTagCategories.sortOrder));

      const catNames = categories.length > 0
        ? categories.map((c: any) => c.categoryName)
        : DEFAULT_CATEGORIES.map(c => c.name);

      // Generate CSV template content
      let csv = "\uFEFF分类名称,标签名称,标签值(可选)\n";
      for (const name of catNames) {
        csv += `${name},示例标签1,示例值1\n`;
        csv += `${name},示例标签2,\n`;
      }
      return { csv, categories: catNames };
    }),

  // AI generate tags for all categories based on product data
  aiGenerateTags: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      const products = await db.select().from(devProducts)
        .where(eq(devProducts.projectId, input.projectId));

      if (products.length === 0) {
        throw new Error("请先导入产品数据后再生成标签");
      }

      const productContext = products.slice(0, 20).map((p: any) => ({
        title: p.title || "",
        brand: p.brand || "",
        price: p.price || "",
        bulletPoints: p.bulletPoints ? String(p.bulletPoints).slice(0, 500) : "",
        specifications: p.specifications ? String(p.specifications).slice(0, 500) : "",
        category: p.category || "",
      }));

      const categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId))
        .orderBy(asc(devProjectTagCategories.sortOrder));

      if (categories.length === 0) {
        throw new Error("请先初始化标签分类");
      }

      const categoryList = categories.map((c: any) => `- ${c.categoryKey}: ${c.categoryName} (${c.description || ""})`).join("\n");

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个亚马逊产品分析专家，擅长从产品数据中提取结构化属性标签。

你需要分析以下产品数据，为每个标签分类生成合适的标签项。标签是后续交叉分析的基础数据，请确保：
1. 每个分类下的标签应覆盖该品类中所有产品的共性和差异
2. 标签名称简洁明确，便于后续筛选和对比
3. 参数属性类标签需要包含具体数值范围
4. 标签应反映市场上该品类产品的真实属性分布

当前项目的标签分类：
${categoryList}`,
          },
          {
            role: "user",
            content: `请根据以下${products.length}个产品数据，为每个标签分类生成标签项：

${JSON.stringify(productContext, null, 2)}

请为每个分类生成5-15个标签项，格式要求：每个标签项包含tagName（标签名称）和tagValue（标签值/说明，可选）。`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "project_tags",
            strict: true,
            schema: {
              type: "object",
              properties: {
                categories: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      categoryKey: { type: "string" },
                      tags: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            tagName: { type: "string" },
                            tagValue: { type: "string" },
                          },
                          required: ["tagName", "tagValue"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["categoryKey", "tags"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["categories"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI生成失败");

      const parsed = JSON.parse(content as string);
      let totalTags = 0;

      for (const catData of parsed.categories || []) {
        const category = categories.find((c: any) => c.categoryKey === catData.categoryKey);
        if (!category) continue;

        // Clear existing AI-generated tags for this category (keep manual tags)
        const existingItems = await db.select().from(devProjectTagItems)
          .where(and(
            eq(devProjectTagItems.categoryId, category.id),
            eq(devProjectTagItems.source, "ai"),
          ));
        for (const item of existingItems) {
          await db.delete(devProjectTagItems).where(eq(devProjectTagItems.id, item.id));
        }

        // Insert new AI tags
        for (let i = 0; i < (catData.tags || []).length; i++) {
          const tag = catData.tags[i];
          await db.insert(devProjectTagItems).values({
            categoryId: category.id,
            projectId: input.projectId,
            tagName: tag.tagName,
            tagValue: tag.tagValue || null,
            source: "ai",
            sortOrder: i + 1,
          });
          totalTags++;
        }

        // Reset confirmed status since tags changed
        await db.update(devProjectTagCategories).set({
          confirmed: 0,
          confirmedAt: null,
        }).where(eq(devProjectTagCategories.id, category.id));
      }

      return { success: true, totalTags, categoriesProcessed: parsed.categories?.length || 0 };
    }),

  // AI generate tags for a single category
  aiGenerateCategoryTags: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      categoryId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await ensureDb();
      const products = await db.select().from(devProducts)
        .where(eq(devProducts.projectId, input.projectId));

      if (products.length === 0) {
        throw new Error("请先导入产品数据");
      }

      const [category] = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.id, input.categoryId));

      if (!category) throw new Error("分类不存在");

      const productContext = products.slice(0, 20).map((p: any) => ({
        title: p.title || "",
        brand: p.brand || "",
        price: p.price || "",
        bulletPoints: p.bulletPoints ? String(p.bulletPoints).slice(0, 500) : "",
        specifications: p.specifications ? String(p.specifications).slice(0, 500) : "",
      }));

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个亚马逊产品分析专家。请根据产品数据，为"${category.categoryName}"分类生成标签项。
分类说明：${category.description || "无"}
要求：
1. 生成5-15个标签，覆盖该品类产品的共性和差异
2. 标签名称简洁明确
3. 如果是参数类属性，tagValue中包含具体数值范围
4. 标签应反映市场上该品类产品的真实属性分布`,
          },
          {
            role: "user",
            content: `产品数据（共${products.length}个）：\n${JSON.stringify(productContext, null, 2)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "category_tags",
            strict: true,
            schema: {
              type: "object",
              properties: {
                tags: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      tagName: { type: "string" },
                      tagValue: { type: "string" },
                    },
                    required: ["tagName", "tagValue"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["tags"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI生成失败");

      const parsed = JSON.parse(content as string);

      // Clear existing AI tags for this category
      const existingItems = await db.select().from(devProjectTagItems)
        .where(and(
          eq(devProjectTagItems.categoryId, input.categoryId),
          eq(devProjectTagItems.source, "ai"),
        ));
      for (const item of existingItems) {
        await db.delete(devProjectTagItems).where(eq(devProjectTagItems.id, item.id));
      }

      // Insert new tags
      let count = 0;
      for (let i = 0; i < (parsed.tags || []).length; i++) {
        const tag = parsed.tags[i];
        await db.insert(devProjectTagItems).values({
          categoryId: input.categoryId,
          projectId: input.projectId,
          tagName: tag.tagName,
          tagValue: tag.tagValue || null,
          source: "ai",
          sortOrder: i + 1,
        });
        count++;
      }

      // Reset confirmed
      await db.update(devProjectTagCategories).set({
        confirmed: 0,
        confirmedAt: null,
      }).where(eq(devProjectTagCategories.id, input.categoryId));

      return { success: true, count };
    }),

  // Export all tags as CSV string
  exportTagsCsv: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await ensureDb();
      const categories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId))
        .orderBy(asc(devProjectTagCategories.sortOrder));

      const items = await db.select().from(devProjectTagItems)
        .where(eq(devProjectTagItems.projectId, input.projectId))
        .orderBy(asc(devProjectTagItems.sortOrder));

      // Build category lookup
      const catMap = new Map<number, string>();
      for (const cat of categories) {
        catMap.set(cat.id, cat.categoryName);
      }

      // CSV escape helper
      const esc = (v: string) => {
        if (v.includes(',') || v.includes('"') || v.includes('\n')) {
          return '"' + v.replace(/"/g, '""') + '"';
        }
        return v;
      };

      // Build CSV with BOM for Excel compatibility
      const rows: string[] = [];
      rows.push('\uFEFF分类名称,标签名称,标签值,来源,确认状态');

      for (const cat of categories) {
        const catItems = items.filter((item: any) => item.categoryId === cat.id);
        const confirmed = cat.confirmed === 1 ? '已确认' : '未确认';
        if (catItems.length === 0) {
          // Still output category row even if no items
          rows.push(`${esc(cat.categoryName)},,,${confirmed}`);
        } else {
          for (const item of catItems) {
            const source = (item as any).source === 'ai' ? 'AI生成' : '手动添加';
            rows.push(
              `${esc(cat.categoryName)},${esc((item as any).tagName)},${esc((item as any).tagValue || '')},${source},${confirmed}`
            );
          }
        }
      }

      return {
        csv: rows.join('\n'),
        fileName: `标签数据_项目${input.projectId}_${new Date().toISOString().slice(0, 10)}.csv`,
        totalCategories: categories.length,
        totalItems: items.length,
      };
    }),
});
