import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { customDashboards, dashboardWidgets, lingxingProductWeekly } from "../../drizzle/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";

function getDateNDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Widget data fetchers - now reads from imported Excel data in DB
async function fetchWidgetData(dataSource: string, _config: any) {
  const db = await getDb();
  if (!db) return { items: [] };

  switch (dataSource) {
    case 'sales': {
      const rows = await db.select().from(lingxingProductWeekly)
        .where(gte(lingxingProductWeekly.weekStartDate, getDateNDaysAgo(30)))
        .orderBy(desc(lingxingProductWeekly.weekStartDate))
        .limit(50);
      const totalRevenue = rows.reduce((s, r) => s + Number(r.salesAmount || 0), 0);
      const totalProfit = rows.reduce((s, r) => s + Number(r.orderProfit || 0), 0);
      const totalOrders = rows.reduce((s, r) => s + Number(r.orderQty || 0), 0);
      return { totalRevenue, totalProfit, totalOrders, items: rows.slice(0, 20) };
    }
    case 'ads_sp': {
      // Read from imported ad data
      const rows = await db.select().from(lingxingProductWeekly)
        .where(gte(lingxingProductWeekly.weekStartDate, getDateNDaysAgo(30)))
        .orderBy(desc(lingxingProductWeekly.weekStartDate))
        .limit(50);
      const totalSpend = rows.reduce((s, r) => s + Number(r.adSpend || 0), 0);
      const totalSales = rows.reduce((s, r) => s + Number(r.adSales || 0), 0);
      return { totalSpend, totalSales, items: rows.slice(0, 20) };
    }
    case 'inventory': {
      const rows = await db.select().from(lingxingProductWeekly)
        .orderBy(desc(lingxingProductWeekly.weekStartDate))
        .limit(200);
      // Deduplicate by parentAsin to get latest inventory per product
      const seen = new Set<string>();
      const unique = rows.filter(r => {
        if (seen.has(r.parentAsin || "")) return false;
        seen.add(r.parentAsin || "");
        return true;
      });
      return {
        totalSkus: unique.length,
        lowStock: unique.filter(i => Number(i.availableStock || 0) < 50).length,
        overstock: unique.filter(i => Number(i.availableStock || 0) > 500).length,
        items: unique.slice(0, 20),
      };
    }
    case 'profit': {
      const rows = await db.select().from(lingxingProductWeekly)
        .where(gte(lingxingProductWeekly.weekStartDate, getDateNDaysAgo(30)))
        .orderBy(desc(lingxingProductWeekly.weekStartDate))
        .limit(50);
      return { items: rows.slice(0, 20) };
    }
    case 'reviews': {
      // Reviews data not available from weekly imports - return empty
      return { items: [], total: 0 };
    }
    default:
      return { items: [] };
  }
}

// Dashboard templates
const TEMPLATES: Record<string, { name: string; description: string; widgets: Array<{ widgetType: string; title: string; dataSource: string; config: any; position: any }> }> = {
  ad_manager: {
    name: '广告经理看板',
    description: '聚焦广告投放效果、ACoS趋势和关键词表现',
    widgets: [
      { widgetType: 'kpi_card', title: '广告花费', dataSource: 'ads_sp', config: { metric: 'spend' }, position: { x: 0, y: 0, w: 3, h: 2 } },
      { widgetType: 'kpi_card', title: '广告销售额', dataSource: 'ads_sp', config: { metric: 'sales' }, position: { x: 3, y: 0, w: 3, h: 2 } },
      { widgetType: 'kpi_card', title: 'ACoS', dataSource: 'ads_sp', config: { metric: 'acos' }, position: { x: 6, y: 0, w: 3, h: 2 } },
      { widgetType: 'line_chart', title: '广告趋势', dataSource: 'ads_sp', config: { metrics: ['spend', 'sales'] }, position: { x: 0, y: 2, w: 6, h: 4 } },
      { widgetType: 'table', title: '广告活动列表', dataSource: 'ads_sp', config: {}, position: { x: 6, y: 2, w: 6, h: 4 } },
    ]
  },
  ops_director: {
    name: '运营总监看板',
    description: '全局视角：销售、利润、库存、广告一览',
    widgets: [
      { widgetType: 'kpi_card', title: '30天销售额', dataSource: 'sales', config: { metric: 'revenue' }, position: { x: 0, y: 0, w: 3, h: 2 } },
      { widgetType: 'kpi_card', title: '30天利润', dataSource: 'sales', config: { metric: 'profit' }, position: { x: 3, y: 0, w: 3, h: 2 } },
      { widgetType: 'kpi_card', title: '低库存SKU', dataSource: 'inventory', config: { metric: 'lowStock' }, position: { x: 6, y: 0, w: 3, h: 2 } },
      { widgetType: 'kpi_card', title: '广告ACoS', dataSource: 'ads_sp', config: { metric: 'acos' }, position: { x: 9, y: 0, w: 3, h: 2 } },
      { widgetType: 'line_chart', title: '销售趋势', dataSource: 'sales', config: {}, position: { x: 0, y: 2, w: 6, h: 4 } },
      { widgetType: 'pie_chart', title: '库存分布', dataSource: 'inventory', config: {}, position: { x: 6, y: 2, w: 6, h: 4 } },
      { widgetType: 'ai_summary', title: 'AI运营摘要', dataSource: 'sales', config: {}, position: { x: 0, y: 6, w: 12, h: 3 } },
    ]
  },
  inventory_manager: {
    name: '库存经理看板',
    description: '聚焦库存健康、补货预警和仓储成本',
    widgets: [
      { widgetType: 'kpi_card', title: '总SKU数', dataSource: 'inventory', config: { metric: 'total' }, position: { x: 0, y: 0, w: 3, h: 2 } },
      { widgetType: 'kpi_card', title: '低库存', dataSource: 'inventory', config: { metric: 'lowStock' }, position: { x: 3, y: 0, w: 3, h: 2 } },
      { widgetType: 'kpi_card', title: '超库存', dataSource: 'inventory', config: { metric: 'overstock' }, position: { x: 6, y: 0, w: 3, h: 2 } },
      { widgetType: 'bar_chart', title: '库存天数分布', dataSource: 'inventory', config: {}, position: { x: 0, y: 2, w: 6, h: 4 } },
      { widgetType: 'table', title: '库存明细', dataSource: 'inventory', config: {}, position: { x: 6, y: 2, w: 6, h: 4 } },
    ]
  },
};

export const customDashboardRouter = router({
  // List user's dashboards
  listDashboards: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error('DB not available');
    const dashboards = await db.select().from(customDashboards)
      .where(eq(customDashboards.userId, ctx.user.id))
      .orderBy(desc(customDashboards.updatedAt));
    return dashboards;
  }),

  // Get single dashboard with widgets
  getDashboard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error('DB not available');
      const [dashboard] = await db.select().from(customDashboards)
        .where(and(eq(customDashboards.id, input.id), eq(customDashboards.userId, ctx.user.id)));
      if (!dashboard) return null;
      const widgets = await db.select().from(dashboardWidgets)
        .where(eq(dashboardWidgets.dashboardId, input.id));
      return { ...dashboard, widgets };
    }),

  // Create dashboard (empty or from template)
  createDashboard: protectedProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      template: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error('DB not available');
      const [result] = await db.insert(customDashboards).values({
        userId: ctx.user.id,
        name: input.name,
        description: input.description || null,
        template: input.template || null,
      });
      const dashboardId = result.insertId;

      // If template, create widgets
      if (input.template && TEMPLATES[input.template]) {
        const tmpl = TEMPLATES[input.template];
        for (const w of tmpl.widgets) {
          await db.insert(dashboardWidgets).values({
            dashboardId: Number(dashboardId),
            widgetType: w.widgetType as any,
            title: w.title,
            dataSource: w.dataSource,
            config: w.config,
            position: w.position,
          });
        }
      }
      return { id: Number(dashboardId) };
    }),

  // Update dashboard
  updateDashboard: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      layout: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error('DB not available');
      const updates: any = {};
      if (input.name) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.layout !== undefined) updates.layout = input.layout;
      await db.update(customDashboards).set(updates)
        .where(and(eq(customDashboards.id, input.id), eq(customDashboards.userId, ctx.user.id)));
      return { success: true };
    }),

  // Delete dashboard
  deleteDashboard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error('DB not available');
      await db.delete(dashboardWidgets).where(eq(dashboardWidgets.dashboardId, input.id));
      await db.delete(customDashboards)
        .where(and(eq(customDashboards.id, input.id), eq(customDashboards.userId, ctx.user.id)));
      return { success: true };
    }),

  // Add widget
  addWidget: protectedProcedure
    .input(z.object({
      dashboardId: z.number(),
      widgetType: z.enum(["kpi_card", "line_chart", "bar_chart", "pie_chart", "heatmap", "table", "ai_summary", "calendar", "radar_chart"]),
      title: z.string(),
      dataSource: z.string(),
      config: z.any().optional(),
      position: z.any().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error('DB not available');
      const [result] = await db.insert(dashboardWidgets).values({
        dashboardId: input.dashboardId,
        widgetType: input.widgetType,
        title: input.title,
        dataSource: input.dataSource,
        config: input.config || {},
        position: input.position || { x: 0, y: 0, w: 6, h: 4 },
      });
      return { id: Number(result.insertId) };
    }),

  // Update widget
  updateWidget: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      config: z.any().optional(),
      position: z.any().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error('DB not available');
      const updates: any = {};
      if (input.title) updates.title = input.title;
      if (input.config !== undefined) updates.config = input.config;
      if (input.position !== undefined) updates.position = input.position;
      await db.update(dashboardWidgets).set(updates).where(eq(dashboardWidgets.id, input.id));
      return { success: true };
    }),

  // Delete widget
  deleteWidget: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error('DB not available');
      await db.delete(dashboardWidgets).where(eq(dashboardWidgets.id, input.id));
      return { success: true };
    }),

  // Batch update widget positions (for drag & drop)
  batchUpdatePositions: protectedProcedure
    .input(z.object({
      updates: z.array(z.object({ id: z.number(), position: z.any() })),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error('DB not available');
      for (const u of input.updates) {
        await db.update(dashboardWidgets).set({ position: u.position }).where(eq(dashboardWidgets.id, u.id));
      }
      return { success: true };
    }),

  // Fetch widget data
  getWidgetData: protectedProcedure
    .input(z.object({ dataSource: z.string(), config: z.any().optional() }))
    .query(async ({ input }) => {
      return fetchWidgetData(input.dataSource, input.config || {});
    }),

  // Get available templates
  getTemplates: protectedProcedure.query(() => {
    return Object.entries(TEMPLATES).map(([key, tmpl]) => ({
      key,
      name: tmpl.name,
      description: tmpl.description,
      widgetCount: tmpl.widgets.length,
    }));
  }),
});
