import { currentOpsWorkspaceId } from "../workspaceContext";
import { opsWorkspaceCondition } from "../../../repositories/ops";
import * as shared from "../routerContext";
import type { CheckItemScore, ConversionCrawlData, ImportResult, ScoringProgress, SellerSpriteProductData } from "../routerContext";

const {
  MARKETPLACE_MID_MAP,
  SELLER_CACHE_TTL,
  TRPCError,
  _productOpsSellerCache,
  and,
  asc,
  buildCrawlDataFromSellerSprite,
  checkItemOverrides,
  collectConversionData,
  collectMultipleAsins,
  competitorMonitors,
  competitorSnapshots,
  conversionCheckItems,
  conversionComparisons,
  conversionScores,
  conversionSuggestions,
  desc,
  eq,
  executionReviews,
  findMatchedSid,
  generateMockCrawlData,
  getCachedSellers,
  getDateNDaysAgo,
  getDefault129CheckItems,
  getToday,
  getYesterday,
  inArray,
  invokeLLM,
  isNull,
  keywordMonitors,
  keywordSnapshots,
  lingxingProductWeekly,
  mergeSellerSpriteWithCrawlData,
  operatorNameMappings,
  opsImportHistory,
  opsPlanActions,
  opsPlanSummaries,
  opsPlans,
  or,
  parseSellerSpriteData,
  parseSellerSpriteXlsx,
  productBasicInfo,
  productLogs,
  productMonthlySummary,
  productProfiles,
  productTodos,
  productVariants,
  productWeeklyOps,
  protectedProcedure,
  resolveDataUserId,
  round2,
  router,
  scoreAllCheckItems,
  scoringProgressMap,
  sql,
  teamTasks,
  users,
  z,
} = shared;
const getDb = (...args: Parameters<typeof shared.getDb>) => shared.getDb(...args);

export const opsProductProcedures = {


  // ─── Product Profiles CRUD ───

  listProducts: protectedProcedure
    .input(z.object({
      period: z.enum(["day", "week", "month"]).default("month"),
      marketplace: z.string().default("US"),
      statusFilter: z.enum(["active", "inactive", "discontinued", "all"]).default("active"),
    }).optional())
    .query(async ({ ctx, input }) => {
    const period = input?.period || "month";
    const marketplace = input?.marketplace || "US";
    const statusFilter = input?.statusFilter || "active";
    const db = await getDb();

    // Resolve effective userId and role-based filtering
    const { MANAGER_ROLES } = await import("../../../../shared/const");
    const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
    const effectiveUserId = await resolveDataUserId(db!, ctx.user);

    // Build where conditions
    const conditions: any[] = [eq(productProfiles.userId, effectiveUserId)];
    if (marketplace !== "all") {
      conditions.push(eq(productProfiles.marketplace, marketplace));
    }
    if (statusFilter !== "all") {
      conditions.push(eq(productProfiles.status, statusFilter as any));
    }

    let products = await db!.select().from(productProfiles)
      .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(...conditions)))
      .orderBy(desc(productProfiles.updatedAt));

    // Non-manager users: filter by operator field (supports multi-operator like "张三/李四")
    if (!isManagerOrAbove && ctx.user.name) {
      const userName = ctx.user.name;
      products = products.filter(p => {
        if (!p.operator) return false;
        const names = p.operator.split(/[\/、,，]+/).map((s: string) => s.trim()).filter(Boolean);
        return names.includes(userName);
      });
    }

    // For each product, get variant count, pending todo count, and first child ASIN
    const enriched = await Promise.all(products.map(async (p) => {
      const [variants, todos, firstVariant] = await Promise.all([
        db!.select({ count: sql<number>`count(*)` }).from(productVariants)
          .where(opsWorkspaceCondition(productVariants, currentOpsWorkspaceId(), eq(productVariants.productId, p.id))),
        db!.select({ count: sql<number>`count(*)` }).from(productTodos)
          .where(opsWorkspaceCondition(productTodos, currentOpsWorkspaceId(), and(eq(productTodos.productId, p.id), sql`${productTodos.status} != 'completed'`))),
        db!.select({ childAsin: productVariants.childAsin }).from(productVariants)
          .where(opsWorkspaceCondition(productVariants, currentOpsWorkspaceId(), eq(productVariants.productId, p.id)))
          .limit(1),
      ]);
      return {
        ...p,
        variantCount: Number(variants[0]?.count ?? 0),
        pendingTodoCount: Number(todos[0]?.count ?? 0),
        firstChildAsin: firstVariant[0]?.childAsin || null,
      };
    }));

    // Fetch profit data from Lingxing MSKU profit API
    const now = new Date();
    const periodDays = period === 'day' ? 1 : period === 'week' ? 7 : 30;
    const startDate = new Date(now.getTime() - periodDays * 86400000).toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    // Build dual maps: parentAsin -> sales, asin (child) -> sales
    type SalesInfo = { sales: number; revenue: number; profit: number; profitRate: number };
    const parentAsinMap = new Map<string, SalesInfo>();
    const childAsinMap = new Map<string, SalesInfo>();
    try {
      const profitRes = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      const profitRaw = profitRes.data || [];
      const profitList = Array.isArray(profitRaw) ? profitRaw : (profitRaw as any).records || (profitRaw as any).list || [];

      for (const item of profitList) {
        const pAsin = String(item.parentAsin || item.parent_asin || "").toUpperCase();
        const cAsin = String(item.asin || "").toUpperCase();
        const qty = Number(item.totalSalesQuantity || item.totalFbaAndFbmQuantity || 0);
        const rev = Number(item.totalSalesAmount || item.totalFbaAndFbmAmount || 0);
        const profit = Number(item.grossProfit || 0);
        const rate = rev > 0 ? Math.round((profit / rev) * 10000) / 100 : 0;

        // Map by parent ASIN (aggregate)
        if (pAsin) {
          const existing = parentAsinMap.get(pAsin) || { sales: 0, revenue: 0, profit: 0, profitRate: 0 };
          existing.sales += qty;
          existing.revenue += rev;
          existing.profit += profit;
          parentAsinMap.set(pAsin, existing);
        }
        // Map by child ASIN (aggregate)
        if (cAsin) {
          const existing = childAsinMap.get(cAsin) || { sales: 0, revenue: 0, profit: 0, profitRate: 0 };
          existing.sales += qty;
          existing.revenue += rev;
          existing.profit += profit;
          childAsinMap.set(cAsin, existing);
        }
      }

      // Recalculate profit rates after aggregation
      parentAsinMap.forEach((info) => {
        info.profitRate = info.revenue > 0 ? Math.round((info.profit / info.revenue) * 10000) / 100 : 0;
      });
      childAsinMap.forEach((info) => {
        info.profitRate = info.revenue > 0 ? Math.round((info.profit / info.revenue) * 10000) / 100 : 0;
      });

      console.log(`[listProducts] Fetched profit data: ${profitList.length} items, parentAsinMap=${parentAsinMap.size}, childAsinMap=${childAsinMap.size}`);
    } catch (err: any) {
      console.warn(`[listProducts] Profit fetch error: ${err.message}`);
    }

    // Merge sales data: triple matching strategy
    const emptyInfo: SalesInfo = { sales: 0, revenue: 0, profit: 0, profitRate: 0 };
    let matchedCount = 0;
    const withSales = enriched.map(p => {
      const dbAsin = (p.parentAsin || "").toUpperCase();
      const childAsin = (p.firstChildAsin || "").toUpperCase();
      // Strategy: 1) parentAsinMap by DB parentAsin, 2) childAsinMap by DB parentAsin,
      // 3) parentAsinMap by firstChildAsin, 4) childAsinMap by firstChildAsin
      const info = parentAsinMap.get(dbAsin) || childAsinMap.get(dbAsin)
        || (childAsin ? (parentAsinMap.get(childAsin) || childAsinMap.get(childAsin)) : null)
        || emptyInfo;
      if (info !== emptyInfo) matchedCount++;
      return {
        ...p,
        salesQty: info.sales,
        salesRevenue: Math.round(info.revenue * 100) / 100,
        salesProfit: Math.round(info.profit * 100) / 100,
        profitRate: info.profitRate,
      };
    });
    console.log(`[listProducts] Matched ${matchedCount}/${withSales.length} products with sales data (parentAsinMap=${parentAsinMap.size}, childAsinMap=${childAsinMap.size})`);
    return withSales;
  }),


  getProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [product] = await db!.select().from(productProfiles)
        .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(eq(productProfiles.id, input.id), eq(productProfiles.userId, ctx.user.id))));
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });

      const variants = await db!.select().from(productVariants)
        .where(opsWorkspaceCondition(productVariants, currentOpsWorkspaceId(), eq(productVariants.productId, input.id)))
        .orderBy(asc(productVariants.createdAt));

      return { ...product, variants };
    }),


  createProduct: protectedProcedure
    .input(z.object({
      parentAsin: z.string().min(1).max(20),
      title: z.string().min(1).max(500),
      brand: z.string().optional(),
      category: z.string().optional(),
      marketplace: z.string().optional().default("US"),
      imageUrl: z.string().optional(),
      budgetRevenue: z.string().optional(),
      budgetProfit: z.string().optional(),
      budgetAcos: z.string().optional(),
      notes: z.string().optional(),
      operator: z.string().optional(),
      storeName: z.string().optional(),
      variants: z.array(z.object({
        childAsin: z.string().min(1).max(20),
        sku: z.string().optional(),
        title: z.string().optional(),
        price: z.string().optional(),
        variationAttributes: z.record(z.string(), z.string()).optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(productProfiles).values({
        userId: ctx.user.id,
        parentAsin: input.parentAsin,
        title: input.title,
        brand: input.brand || undefined,
        category: input.category || undefined,
        marketplace: input.marketplace,
        imageUrl: input.imageUrl || undefined,
        budgetRevenue: input.budgetRevenue || undefined,
        budgetProfit: input.budgetProfit || undefined,
        budgetAcos: input.budgetAcos || undefined,
        notes: input.notes || undefined,
        operator: input.operator || undefined,
        storeName: input.storeName || undefined,
      });
      const productId = result.insertId;

      if (input.variants?.length) {
        await db!.insert(productVariants).values(
          input.variants.map(v => ({
            productId,
            childAsin: v.childAsin,
            sku: v.sku,
            title: v.title,
            price: v.price,
            variationAttributes: v.variationAttributes,
          }))
        );
      }
      return { id: productId };
    }),


  updateProduct: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      brand: z.string().optional(),
      category: z.string().optional(),
      marketplace: z.string().optional(),
      imageUrl: z.string().optional(),
      status: z.enum(["active", "inactive", "discontinued"]).optional(),
      budgetRevenue: z.string().optional(),
      budgetProfit: z.string().optional(),
      budgetAcos: z.string().optional(),
      notes: z.string().optional(),
      chineseName: z.string().optional(),
      operator: z.string().optional(),
      storeName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...updates } = input;
      // Filter out undefined values
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      if (Object.keys(cleanUpdates).length > 0) {
        await db!.update(productProfiles).set(cleanUpdates)
          .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(eq(productProfiles.id, id), eq(productProfiles.userId, ctx.user.id))));
      }
      return { updated: true };
    }),


  deleteProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Delete related data first
      await db!.delete(productVariants).where(opsWorkspaceCondition(productVariants, currentOpsWorkspaceId(), eq(productVariants.productId, input.id)));
      await db!.delete(productTodos).where(opsWorkspaceCondition(productTodos, currentOpsWorkspaceId(), eq(productTodos.productId, input.id)));
      await db!.delete(productLogs).where(opsWorkspaceCondition(productLogs, currentOpsWorkspaceId(), eq(productLogs.productId, input.id)));
      // Delete keyword monitors and their snapshots
      const monitors = await db!.select({ id: keywordMonitors.id }).from(keywordMonitors)
        .where(opsWorkspaceCondition(keywordMonitors, currentOpsWorkspaceId(), eq(keywordMonitors.productId, input.id)));
      for (const m of monitors) {
        await db!.delete(keywordSnapshots).where(opsWorkspaceCondition(keywordSnapshots, currentOpsWorkspaceId(), eq(keywordSnapshots.keywordMonitorId, m.id)));
      }
      await db!.delete(keywordMonitors).where(opsWorkspaceCondition(keywordMonitors, currentOpsWorkspaceId(), eq(keywordMonitors.productId, input.id)));
      // Delete the product itself
      await db!.delete(productProfiles)
        .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(eq(productProfiles.id, input.id), eq(productProfiles.userId, ctx.user.id))));
      return { deleted: true };
    }),


  // ─── Product Variants ───

  addVariant: protectedProcedure
    .input(z.object({
      productId: z.number(),
      childAsin: z.string().min(1).max(20),
      sku: z.string().optional(),
      title: z.string().optional(),
      price: z.string().optional(),
      variationAttributes: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [result] = await db!.insert(productVariants).values({
        productId: input.productId,
        childAsin: input.childAsin,
        sku: input.sku,
        title: input.title,
        price: input.price,
        variationAttributes: input.variationAttributes,
      });
      return { id: result.insertId };
    }),


  removeVariant: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db!.delete(productVariants).where(opsWorkspaceCondition(productVariants, currentOpsWorkspaceId(), eq(productVariants.id, input.id)));
      return { deleted: true };
    }),


  // ─── 批量分配运营负责人 ───
  batchAssignOperator: protectedProcedure
    .input(z.object({
      productIds: z.array(z.number()).min(1),
      operator: z.string().min(1),
      mode: z.enum(["replace", "add", "remove"]).default("replace"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { MANAGER_ROLES } = await import("../../../../shared/const");
      const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      const effectiveUserId = isManagerOrAbove ? await resolveDataUserId(db!, ctx.user) : ctx.user.id;
      const now = new Date();
      let updated = 0;
      for (const pid of input.productIds) {
        if (input.mode === "replace") {
          await db!.update(productProfiles)
            .set({ operator: input.operator, updatedAt: now })
            .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(eq(productProfiles.id, pid), eq(productProfiles.userId, effectiveUserId))));
        } else {
          // add or remove: read current value first
          const [current] = await db!.select({ operator: productProfiles.operator })
            .from(productProfiles)
            .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(eq(productProfiles.id, pid), eq(productProfiles.userId, effectiveUserId))));
          if (!current) continue;
          const existing = (current.operator || "").split(/[\/、,，]+/).map((s: string) => s.trim()).filter(Boolean);
          let newNames: string[];
          if (input.mode === "add") {
            newNames = existing.includes(input.operator) ? existing : [...existing, input.operator];
          } else {
            // remove
            newNames = existing.filter((n: string) => n !== input.operator);
          }
          const newOperator = newNames.join("/") || null;
          await db!.update(productProfiles)
            .set({ operator: newOperator, updatedAt: now })
            .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(eq(productProfiles.id, pid), eq(productProfiles.userId, effectiveUserId))));
        }
        updated++;
      }
      return { updated, operator: input.operator };
    }),


  // ─── 获取所有运营人员列表（已分配过的 + 团队成员） ───
  listOperators: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    // 1. 已分配过的运营名称
    const assigned = await db!.selectDistinct({ operator: productProfiles.operator })
      .from(productProfiles)
      .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(
        eq(productProfiles.userId, ctx.user.id),
        sql`${productProfiles.operator} IS NOT NULL AND ${productProfiles.operator} != ''`
      )));
    const assignedNames = assigned.map(r => r.operator).filter(Boolean) as string[];

    // 2. 团队成员名称（活跃用户）
    const teamMembers = await db!.select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.status, 'active'));
    const memberNames = teamMembers.map(u => u.name).filter(Boolean) as string[];

    // 3. 合并去重
    const allNames = Array.from(new Set([...memberNames, ...assignedNames]));
    return allNames;
  }),


  // ─── 获取团队成员详情列表 ───
  listTeamMembers: protectedProcedure.query(async () => {
    const db = await getDb();
    const members = await db!.select({
      id: users.id,
      name: users.name,
      role: users.role,
      department: users.department,
      jobTitle: users.jobTitle,
    }).from(users).where(eq(users.status, 'active'));
    return members;
  }),
};