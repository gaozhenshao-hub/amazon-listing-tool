import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  shippingBatches, batchStepConfigs, batchProducts, batchLogs,
  stepTimeHistory, replenishmentPredictions, stepTimeTemplates
} from "../../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

// ─── 9步流程定义 ───
export const SHIPPING_STEPS = [
  { number: 1, name: "准备中", key: "preparing", requiredFields: [] },
  { number: 2, name: "采购中", key: "purchasing", requiredFields: [] },
  { number: 3, name: "准备寄出", key: "readyToShip", requiredFields: [] },
  { number: 4, name: "已寄出", key: "shipped", requiredFields: ["trackingNumber"] },
  { number: 5, name: "国内运输中", key: "domesticTransit", requiredFields: [] },
  { number: 6, name: "已到仓", key: "arrivedWarehouse", requiredFields: [] },
  { number: 7, name: "国际物流运输中", key: "internationalTransit", requiredFields: ["internationalTrackingNumber"] },
  { number: 8, name: "接收中", key: "receiving", requiredFields: [] },
  { number: 9, name: "已到亚马逊仓", key: "arrivedAmazon", requiredFields: [] },
] as const;

// Default step days by shipping method
const DEFAULT_STEP_DAYS: Record<string, number[]> = {
  "海运": [3, 14, 3, 1, 3, 2, 35, 7, 3],
  "空运": [3, 14, 2, 1, 1, 1, 7, 5, 2],
  "快递": [3, 14, 1, 1, 1, 1, 5, 3, 1],
  "铁路": [3, 14, 3, 1, 2, 2, 25, 7, 3],
  "default": [3, 14, 3, 1, 3, 2, 30, 7, 3],
};

export const shippingBatchRouter = router({
  // ─── 获取批次列表 ───
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["active", "completed", "cancelled", "paused", "all"]).optional().default("all"),
      storeName: z.string().optional(),
      shippingMethod: z.string().optional(),
      search: z.string().optional(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const conditions: any[] = [eq(shippingBatches.userId, String(ctx.user.id))];
      if (input.status !== "all") {
        conditions.push(eq(shippingBatches.status, input.status));
      }
      if (input.storeName) {
        conditions.push(eq(shippingBatches.storeName, input.storeName));
      }
      if (input.shippingMethod) {
        conditions.push(eq(shippingBatches.shippingMethod, input.shippingMethod));
      }

      const allBatches = await db.select().from(shippingBatches)
        .where(and(...conditions))
        .orderBy(desc(shippingBatches.createdAt));

      let filtered = allBatches;
      if (input.search) {
        const s = input.search.toLowerCase();
        filtered = allBatches.filter(b =>
          b.batchName.toLowerCase().includes(s) ||
          (b.trackingNumber && b.trackingNumber.toLowerCase().includes(s)) ||
          (b.internationalTrackingNumber && b.internationalTrackingNumber.toLowerCase().includes(s))
        );
      }

      const total = filtered.length;
      const offset = (input.page - 1) * input.pageSize;
      const items = filtered.slice(offset, offset + input.pageSize);

      // Status summary
      const statusCounts = {
        active: allBatches.filter(b => b.status === "active").length,
        completed: allBatches.filter(b => b.status === "completed").length,
        cancelled: allBatches.filter(b => b.status === "cancelled").length,
        paused: allBatches.filter(b => b.status === "paused").length,
      };

      // Step distribution
      const stepDistribution = SHIPPING_STEPS.map(step => ({
        step: step.number,
        name: step.name,
        count: allBatches.filter(b => b.currentStep === step.number && b.status === "active").length,
      }));

      return { items, total, statusCounts, stepDistribution, page: input.page, pageSize: input.pageSize };
    }),

  // ─── 获取批次详情 ───
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const [batch] = await db.select().from(shippingBatches)
        .where(and(eq(shippingBatches.id, input.id), eq(shippingBatches.userId, String(ctx.user.id))));
      if (!batch) throw new Error("批次不存在");

      const steps = await db.select().from(batchStepConfigs)
        .where(eq(batchStepConfigs.batchId, input.id))
        .orderBy(batchStepConfigs.stepNumber);

      const products = await db.select().from(batchProducts)
        .where(eq(batchProducts.batchId, input.id));

      const logs = await db.select().from(batchLogs)
        .where(eq(batchLogs.batchId, input.id))
        .orderBy(desc(batchLogs.createdAt));

      // Calculate loss rates
      const lossRates = {
        domesticLoss: batch.shippedQuantity > 0
          ? ((batch.shippedQuantity - batch.warehouseReceivedQuantity) / batch.shippedQuantity * 100).toFixed(1)
          : "0.0",
        internationalLoss: batch.internationalShippedQuantity > 0
          ? ((batch.internationalShippedQuantity - batch.amazonReceivedQuantity) / batch.internationalShippedQuantity * 100).toFixed(1)
          : "0.0",
        totalLoss: batch.plannedQuantity > 0
          ? ((batch.plannedQuantity - batch.amazonStockedQuantity) / batch.plannedQuantity * 100).toFixed(1)
          : "0.0",
      };

      // Calculate step timeout warnings
      const now = Date.now();
      const stepsWithWarnings = steps.map(step => {
        let isOverdue = false;
        let overdueBy = 0;
        if (step.status === "active" && step.actualStartAt) {
          const elapsed = Math.floor((now - step.actualStartAt) / (1000 * 60 * 60 * 24));
          if (elapsed > step.expectedDays) {
            isOverdue = true;
            overdueBy = elapsed - step.expectedDays;
          }
        }
        return { ...step, isOverdue, overdueBy };
      });

      // Total expected days & elapsed
      const totalExpectedDays = steps.reduce((sum, s) => sum + s.expectedDays, 0);
      const firstActiveStep = steps.find(s => s.status === "active");
      const completedSteps = steps.filter(s => s.status === "completed");
      const totalActualDays = completedSteps.reduce((sum, s) => sum + (s.actualDays || 0), 0);

      return {
        batch,
        steps: stepsWithWarnings,
        products,
        logs,
        lossRates,
        totalExpectedDays,
        totalActualDays,
        stepsDefinition: SHIPPING_STEPS,
      };
    }),

  // ─── 创建批次 ───
  create: protectedProcedure
    .input(z.object({
      batchName: z.string().min(1),
      storeName: z.string().optional(),
      sourceWarehouse: z.string().optional(),
      transitWarehouse: z.string().optional(),
      destinationWarehouse: z.string().optional(),
      shippingMethod: z.string().optional(),
      currency: z.string().optional().default("USD"),
      amazonCommissionRate: z.number().optional(),
      batchOwner: z.string().optional(),
      logisticsOwner: z.string().optional(),
      templateId: z.number().optional(),
      customStepDays: z.array(z.number()).optional(),
      products: z.array(z.object({
        sku: z.string(),
        asin: z.string().optional(),
        productName: z.string().optional(),
        quantity: z.number().default(0),
        unitCost: z.number().optional(),
        weight: z.number().optional(),
        volume: z.number().optional(),
        fnsku: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const now = Date.now();
      const userId = String(ctx.user.id);

      // Get next batch number
      const [maxBatch] = await db.select({ maxNum: sql<number>`COALESCE(MAX(batch_number), 0)` })
        .from(shippingBatches)
        .where(eq(shippingBatches.userId, userId));
      const batchNumber = (maxBatch?.maxNum || 0) + 1;

      // Calculate total planned quantity
      const totalQuantity = input.products?.reduce((sum, p) => sum + p.quantity, 0) || 0;

      // Insert batch
      const [result] = await db.insert(shippingBatches).values({
        userId,
        batchName: input.batchName,
        batchNumber,
        storeName: input.storeName || null,
        sourceWarehouse: input.sourceWarehouse || null,
        transitWarehouse: input.transitWarehouse || null,
        destinationWarehouse: input.destinationWarehouse || null,
        shippingMethod: input.shippingMethod || null,
        currentStep: 1,
        status: "active",
        currency: input.currency || "USD",
        amazonCommissionRate: input.amazonCommissionRate ? String(input.amazonCommissionRate) : null,
        batchOwner: input.batchOwner || null,
        logisticsOwner: input.logisticsOwner || null,
        plannedQuantity: totalQuantity,
        createdAt: now,
        updatedAt: now,
      });
      const batchId = result.insertId;

      // Determine step days
      let stepDays: number[];
      if (input.customStepDays && input.customStepDays.length === 9) {
        stepDays = input.customStepDays;
      } else if (input.templateId) {
        const [template] = await db.select().from(stepTimeTemplates)
          .where(eq(stepTimeTemplates.id, input.templateId));
        if (template) {
          stepDays = [template.step1Days, template.step2Days, template.step3Days, template.step4Days,
            template.step5Days, template.step6Days, template.step7Days, template.step8Days, template.step9Days];
        } else {
          stepDays = DEFAULT_STEP_DAYS[input.shippingMethod || "default"] || DEFAULT_STEP_DAYS["default"];
        }
      } else {
        stepDays = DEFAULT_STEP_DAYS[input.shippingMethod || "default"] || DEFAULT_STEP_DAYS["default"];
      }

      // Create step configs
      for (let i = 0; i < 9; i++) {
        await db.insert(batchStepConfigs).values({
          batchId,
          stepNumber: i + 1,
          stepName: SHIPPING_STEPS[i].name,
          expectedDays: stepDays[i],
          status: i === 0 ? "active" : "pending",
          actualStartAt: i === 0 ? now : null,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Create products
      if (input.products && input.products.length > 0) {
        for (const p of input.products) {
          const totalCost = p.unitCost ? (p.quantity * p.unitCost) : 0;
          await db.insert(batchProducts).values({
            batchId,
            sku: p.sku,
            asin: p.asin || null,
            productName: p.productName || null,
            quantity: p.quantity,
            unitCost: p.unitCost ? String(p.unitCost) : "0",
            totalCost: String(totalCost),
            weight: p.weight ? String(p.weight) : null,
            volume: p.volume ? String(p.volume) : null,
            fnsku: p.fnsku || null,
            createdAt: now,
          });
        }
      }

      // Log creation
      await db.insert(batchLogs).values({
        batchId,
        userId,
        userName: ctx.user.name || "Unknown",
        action: "创建批次",
        toStep: 1,
        details: `创建批次 #${batchNumber}: ${input.batchName}，包含 ${input.products?.length || 0} 个产品，总数量 ${totalQuantity}`,
        createdAt: now,
      });

      return { id: batchId, batchNumber };
    }),

  // ─── 推进步骤 ───
  advanceStep: protectedProcedure
    .input(z.object({
      batchId: z.number(),
      // Required for step 4 (已寄出)
      trackingNumber: z.string().optional(),
      vehiclePlate: z.string().optional(),
      carrierName: z.string().optional(),
      // Required for step 7 (国际物流运输中)
      internationalTrackingNumber: z.string().optional(),
      internationalCarrier: z.string().optional(),
      // Quantity updates
      quantityUpdate: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const now = Date.now();
      const userId = String(ctx.user.id);

      const [batch] = await db.select().from(shippingBatches)
        .where(and(eq(shippingBatches.id, input.batchId), eq(shippingBatches.userId, userId)));
      if (!batch) throw new Error("批次不存在");
      if (batch.status !== "active") throw new Error("批次状态不允许推进");
      if (batch.currentStep >= 9) throw new Error("已是最后一步");

      const currentStep = batch.currentStep;
      const nextStep = currentStep + 1;
      const stepDef = SHIPPING_STEPS[currentStep - 1];

      // Validation: Step 4 requires tracking number or vehicle plate
      if (currentStep === 3) { // advancing from 准备寄出 to 已寄出
        if (!input.trackingNumber && !input.vehiclePlate) {
          throw new Error("推进到「已寄出」需要填写物流单号或车牌号");
        }
      }

      // Validation: Step 7 requires international tracking number
      if (currentStep === 6) { // advancing from 已到仓 to 国际物流运输中
        if (!input.internationalTrackingNumber) {
          throw new Error("推进到「国际物流运输中」需要填写国际物流单号");
        }
      }

      // Complete current step
      const [currentStepConfig] = await db.select().from(batchStepConfigs)
        .where(and(eq(batchStepConfigs.batchId, input.batchId), eq(batchStepConfigs.stepNumber, currentStep)));

      if (currentStepConfig) {
        const actualDays = currentStepConfig.actualStartAt
          ? Math.max(1, Math.ceil((now - currentStepConfig.actualStartAt) / (1000 * 60 * 60 * 24)))
          : 0;

        await db.update(batchStepConfigs)
          .set({ status: "completed", actualEndAt: now, actualDays, notes: input.notes || null, updatedAt: now })
          .where(eq(batchStepConfigs.id, currentStepConfig.id));

        // Record time history for AI learning
        await db.insert(stepTimeHistory).values({
          userId,
          batchId: input.batchId,
          stepNumber: currentStep,
          shippingMethod: batch.shippingMethod || null,
          carrierName: batch.carrierName || null,
          route: `${batch.sourceWarehouse || ""}-${batch.destinationWarehouse || ""}`,
          expectedDays: currentStepConfig.expectedDays,
          actualDays,
          monthOfYear: new Date().getMonth() + 1,
          createdAt: now,
        });
      }

      // Activate next step
      await db.update(batchStepConfigs)
        .set({ status: "active", actualStartAt: now, updatedAt: now })
        .where(and(eq(batchStepConfigs.batchId, input.batchId), eq(batchStepConfigs.stepNumber, nextStep)));

      // Update batch
      const updateData: any = { currentStep: nextStep, updatedAt: now };

      if (input.trackingNumber) updateData.trackingNumber = input.trackingNumber;
      if (input.vehiclePlate) updateData.vehiclePlate = input.vehiclePlate;
      if (input.carrierName) updateData.carrierName = input.carrierName;
      if (input.internationalTrackingNumber) updateData.internationalTrackingNumber = input.internationalTrackingNumber;
      if (input.internationalCarrier) updateData.internationalCarrier = input.internationalCarrier;

      // Update quantity based on step
      if (input.quantityUpdate !== undefined) {
        const qtyField = [
          null, // step 1 - no qty update
          "orderedQuantity",
          "shippedQuantity",
          "shippedQuantity",
          "shippedQuantity",
          "warehouseReceivedQuantity",
          "internationalShippedQuantity",
          "amazonReceivedQuantity",
          "amazonStockedQuantity",
        ][currentStep];
        if (qtyField) {
          (updateData as any)[qtyField] = input.quantityUpdate;
        }
      }

      // If reaching step 9, mark as completed
      if (nextStep === 9) {
        // Don't auto-complete, user needs to confirm amazon inventory
      }

      await db.update(shippingBatches).set(updateData).where(eq(shippingBatches.id, input.batchId));

      // Log
      await db.insert(batchLogs).values({
        batchId: input.batchId,
        userId,
        userName: ctx.user.name || "Unknown",
        action: "推进步骤",
        fromStep: currentStep,
        toStep: nextStep,
        details: `从「${SHIPPING_STEPS[currentStep - 1].name}」推进到「${SHIPPING_STEPS[nextStep - 1].name}」${input.notes ? ` - ${input.notes}` : ""}`,
        createdAt: now,
      });

      return { success: true, currentStep: nextStep };
    }),

  // ─── 更新批次信息 ───
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      batchName: z.string().optional(),
      storeName: z.string().optional(),
      sourceWarehouse: z.string().optional(),
      transitWarehouse: z.string().optional(),
      destinationWarehouse: z.string().optional(),
      shippingMethod: z.string().optional(),
      currency: z.string().optional(),
      amazonCommissionRate: z.number().optional(),
      batchOwner: z.string().optional(),
      logisticsOwner: z.string().optional(),
      trackingNumber: z.string().optional(),
      vehiclePlate: z.string().optional(),
      carrierName: z.string().optional(),
      internationalTrackingNumber: z.string().optional(),
      internationalCarrier: z.string().optional(),
      totalProductCost: z.number().optional(),
      totalShippingCost: z.number().optional(),
      totalOtherCost: z.number().optional(),
      // Amazon inventory sync
      amazonTotalInventory: z.number().optional(),
      amazonAvailableInventory: z.number().optional(),
      amazonReservedInventory: z.number().optional(),
      amazonInboundInventory: z.number().optional(),
      amazonUnfulfillableInventory: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const { id, ...data } = input;
      const now = Date.now();
      const updateData: any = { updatedAt: now };

      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          if (typeof value === "number" && ["totalProductCost", "totalShippingCost", "totalOtherCost", "amazonCommissionRate"].includes(key)) {
            updateData[key] = String(value);
          } else {
            updateData[key] = value;
          }
        }
      }

      await db.update(shippingBatches).set(updateData)
        .where(and(eq(shippingBatches.id, id), eq(shippingBatches.userId, String(ctx.user.id))));

      // Log
      await db.insert(batchLogs).values({
        batchId: id,
        userId: String(ctx.user.id),
        userName: ctx.user.name || "Unknown",
        action: "更新批次信息",
        details: `更新字段: ${Object.keys(data).filter(k => (data as any)[k] !== undefined).join(", ")}`,
        createdAt: now,
      });

      return { success: true };
    }),

  // ─── 更新库存数量 ───
  updateQuantity: protectedProcedure
    .input(z.object({
      batchId: z.number(),
      field: z.enum([
        "plannedQuantity", "orderedQuantity", "shippedQuantity",
        "warehouseReceivedQuantity", "internationalShippedQuantity",
        "amazonReceivedQuantity", "amazonStockedQuantity",
      ]),
      value: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const now = Date.now();
      await db.update(shippingBatches)
        .set({ [input.field]: input.value, updatedAt: now })
        .where(and(eq(shippingBatches.id, input.batchId), eq(shippingBatches.userId, String(ctx.user.id))));

      await db.insert(batchLogs).values({
        batchId: input.batchId,
        userId: String(ctx.user.id),
        userName: ctx.user.name || "Unknown",
        action: "更新库存数量",
        details: `${input.field} → ${input.value}`,
        createdAt: now,
      });

      return { success: true };
    }),

  // ─── 完成批次 ───
  completeBatch: protectedProcedure
    .input(z.object({ batchId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const now = Date.now();
      const userId = String(ctx.user.id);

      // Complete last step
      await db.update(batchStepConfigs)
        .set({ status: "completed", actualEndAt: now, updatedAt: now })
        .where(and(eq(batchStepConfigs.batchId, input.batchId), eq(batchStepConfigs.stepNumber, 9)));

      await db.update(shippingBatches)
        .set({ status: "completed", updatedAt: now })
        .where(and(eq(shippingBatches.id, input.batchId), eq(shippingBatches.userId, userId)));

      await db.insert(batchLogs).values({
        batchId: input.batchId,
        userId,
        userName: ctx.user.name || "Unknown",
        action: "完成批次",
        details: "批次已标记为完成",
        createdAt: now,
      });

      return { success: true };
    }),

  // ─── 暂停/恢复/取消批次 ───
  updateStatus: protectedProcedure
    .input(z.object({
      batchId: z.number(),
      status: z.enum(["active", "paused", "cancelled"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const now = Date.now();
      await db.update(shippingBatches)
        .set({ status: input.status, updatedAt: now })
        .where(and(eq(shippingBatches.id, input.batchId), eq(shippingBatches.userId, String(ctx.user.id))));

      const actionMap = { active: "恢复批次", paused: "暂停批次", cancelled: "取消批次" };
      await db.insert(batchLogs).values({
        batchId: input.batchId,
        userId: String(ctx.user.id),
        userName: ctx.user.name || "Unknown",
        action: actionMap[input.status],
        details: `状态变更为: ${input.status}`,
        createdAt: now,
      });

      return { success: true };
    }),

  // ─── 添加日志 ───
  addLog: protectedProcedure
    .input(z.object({
      batchId: z.number(),
      action: z.string(),
      details: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      await db.insert(batchLogs).values({
        batchId: input.batchId,
        userId: String(ctx.user.id),
        userName: ctx.user.name || "Unknown",
        action: input.action,
        details: input.details || null,
        createdAt: Date.now(),
      });
      return { success: true };
    }),

  // ─── 管理批次产品 ───
  addProduct: protectedProcedure
    .input(z.object({
      batchId: z.number(),
      sku: z.string(),
      asin: z.string().optional(),
      productName: z.string().optional(),
      quantity: z.number().default(0),
      unitCost: z.number().optional(),
      weight: z.number().optional(),
      volume: z.number().optional(),
      fnsku: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const { batchId, ...productData } = input;
      const totalCost = productData.unitCost ? (productData.quantity * productData.unitCost) : 0;
      await db.insert(batchProducts).values({
        batchId,
        sku: productData.sku,
        asin: productData.asin || null,
        productName: productData.productName || null,
        quantity: productData.quantity,
        unitCost: productData.unitCost ? String(productData.unitCost) : "0",
        totalCost: String(totalCost),
        weight: productData.weight ? String(productData.weight) : null,
        volume: productData.volume ? String(productData.volume) : null,
        fnsku: productData.fnsku || null,
        createdAt: Date.now(),
      });

      // Update batch total planned quantity
      const products = await db.select().from(batchProducts).where(eq(batchProducts.batchId, batchId));
      const totalQty = products.reduce((sum, p) => sum + p.quantity, 0);
      await db.update(shippingBatches).set({ plannedQuantity: totalQty, updatedAt: Date.now() })
        .where(eq(shippingBatches.id, batchId));

      return { success: true };
    }),

  removeProduct: protectedProcedure
    .input(z.object({ productId: z.number(), batchId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      await db.delete(batchProducts).where(eq(batchProducts.id, input.productId));

      const products = await db.select().from(batchProducts).where(eq(batchProducts.batchId, input.batchId));
      const totalQty = products.reduce((sum, p) => sum + p.quantity, 0);
      await db.update(shippingBatches).set({ plannedQuantity: totalQty, updatedAt: Date.now() })
        .where(eq(shippingBatches.id, input.batchId));

      return { success: true };
    }),

  // ─── 更新步骤配置 ───
  updateStepConfig: protectedProcedure
    .input(z.object({
      batchId: z.number(),
      stepNumber: z.number(),
      expectedDays: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const updateData: any = { updatedAt: Date.now() };
      if (input.expectedDays !== undefined) updateData.expectedDays = input.expectedDays;
      if (input.notes !== undefined) updateData.notes = input.notes;

      await db.update(batchStepConfigs).set(updateData)
        .where(and(eq(batchStepConfigs.batchId, input.batchId), eq(batchStepConfigs.stepNumber, input.stepNumber)));

      return { success: true };
    }),

  // ─── 步骤时间模板管理 ───
  listTemplates: protectedProcedure.query(async ({ ctx }) => {
      const db = (await getDb())!;
    return db.select().from(stepTimeTemplates)
      .where(eq(stepTimeTemplates.userId, String(ctx.user.id)))
      .orderBy(desc(stepTimeTemplates.createdAt));
  }),

  createTemplate: protectedProcedure
    .input(z.object({
      templateName: z.string(),
      shippingMethod: z.string(),
      stepDays: z.array(z.number()).length(9),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const now = Date.now();
      const userId = String(ctx.user.id);

      if (input.isDefault) {
        await db.update(stepTimeTemplates).set({ isDefault: 0, updatedAt: now })
          .where(eq(stepTimeTemplates.userId, userId));
      }

      await db.insert(stepTimeTemplates).values({
        userId,
        templateName: input.templateName,
        shippingMethod: input.shippingMethod,
        step1Days: input.stepDays[0],
        step2Days: input.stepDays[1],
        step3Days: input.stepDays[2],
        step4Days: input.stepDays[3],
        step5Days: input.stepDays[4],
        step6Days: input.stepDays[5],
        step7Days: input.stepDays[6],
        step8Days: input.stepDays[7],
        step9Days: input.stepDays[8],
        isDefault: input.isDefault ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });

      return { success: true };
    }),

  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      await db.delete(stepTimeTemplates)
        .where(and(eq(stepTimeTemplates.id, input.id), eq(stepTimeTemplates.userId, String(ctx.user.id))));
      return { success: true };
    }),

  // ─── 全链路库存流水线看板 ───
  getInventoryPipeline: protectedProcedure.query(async ({ ctx }) => {
      const db = (await getDb())!;
    const userId = String(ctx.user.id);
    const activeBatches = await db.select().from(shippingBatches)
      .where(and(eq(shippingBatches.userId, userId), eq(shippingBatches.status, "active")));

    const pipeline = SHIPPING_STEPS.map(step => {
      const batchesAtStep = activeBatches.filter(b => b.currentStep === step.number);
      const totalQuantity = batchesAtStep.reduce((sum, b) => {
        // Use the appropriate quantity field based on step
        const qtyFields = [
          b.plannedQuantity, b.orderedQuantity, b.shippedQuantity, b.shippedQuantity,
          b.shippedQuantity, b.warehouseReceivedQuantity, b.internationalShippedQuantity,
          b.amazonReceivedQuantity, b.amazonStockedQuantity
        ];
        return sum + (qtyFields[step.number - 1] || 0);
      }, 0);

      return {
        step: step.number,
        name: step.name,
        batchCount: batchesAtStep.length,
        totalQuantity,
        batches: batchesAtStep.map(b => ({
          id: b.id,
          name: b.batchName,
          batchNumber: b.batchNumber,
          storeName: b.storeName,
          shippingMethod: b.shippingMethod,
        })),
      };
    });

    // In-transit inventory (steps 4-8)
    const inTransitBatches = activeBatches.filter(b => b.currentStep >= 4 && b.currentStep <= 8);
    const totalInTransit = inTransitBatches.reduce((sum, b) => sum + b.shippedQuantity, 0);

    return { pipeline, totalInTransit, totalActiveBatches: activeBatches.length };
  }),

  // ─── 获取步骤时间历史（AI学习用） ───
  getStepTimeStats: protectedProcedure
    .input(z.object({
      shippingMethod: z.string().optional(),
      stepNumber: z.number().optional(),
    }))
    .query(async ({ ctx }) => {
      const db = (await getDb())!;
      const history = await db.select().from(stepTimeHistory)
        .where(eq(stepTimeHistory.userId, String(ctx.user.id)))
        .orderBy(desc(stepTimeHistory.createdAt));

      // Group by step and shipping method
      const stats: Record<string, { avgDays: number; count: number; minDays: number; maxDays: number }> = {};
      for (const h of history) {
        if (!h.actualDays) continue;
        const key = `${h.stepNumber}-${h.shippingMethod || "unknown"}`;
        if (!stats[key]) stats[key] = { avgDays: 0, count: 0, minDays: Infinity, maxDays: 0 };
        stats[key].count++;
        stats[key].avgDays += h.actualDays;
        stats[key].minDays = Math.min(stats[key].minDays, h.actualDays);
        stats[key].maxDays = Math.max(stats[key].maxDays, h.actualDays);
      }

      for (const key of Object.keys(stats)) {
        stats[key].avgDays = Math.round(stats[key].avgDays / stats[key].count);
        if (stats[key].minDays === Infinity) stats[key].minDays = 0;
      }

      return { history: history.slice(0, 100), stats };
    }),

  // ─── 删除批次 ───
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const userId = String(ctx.user.id);
      await db.delete(batchLogs).where(eq(batchLogs.batchId, input.id));
      await db.delete(batchProducts).where(eq(batchProducts.batchId, input.id));
      await db.delete(batchStepConfigs).where(eq(batchStepConfigs.batchId, input.id));
      await db.delete(shippingBatches)
        .where(and(eq(shippingBatches.id, input.id), eq(shippingBatches.userId, userId)));
      return { success: true };
    }),

  // ─── AI Replenishment Prediction ───

  runPredictions: protectedProcedure.mutation(async ({ ctx }) => {
    const { runReplenishmentPredictions } = await import("../replenishmentEngine");
    const results = await runReplenishmentPredictions(String(ctx.user.id));
    return results;
  }),

  getPredictions: protectedProcedure.query(async ({ ctx }) => {
    const { getSavedPredictions } = await import("../replenishmentEngine");
    return await getSavedPredictions(String(ctx.user.id));
  }),

  confirmPrediction: protectedProcedure
    .input(z.object({ sku: z.string(), confirmed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.update(replenishmentPredictions)
        .set({ userConfirmed: input.confirmed ? 1 : 0, updatedAt: Date.now() })
        .where(and(
          eq(replenishmentPredictions.userId, String(ctx.user.id)),
          eq(replenishmentPredictions.sku, input.sku),
        ));
      return { success: true };
    }),

  // ─── AI Step Time Learning ───

  getAIDurations: protectedProcedure
    .input(z.object({ shippingMethod: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { getAIRecommendedDurations } = await import("../replenishmentEngine");
      return await getAIRecommendedDurations(String(ctx.user.id), input.shippingMethod || 'sea');
    }),

  getInventoryPipelineSummary: protectedProcedure.query(async ({ ctx }) => {
    const { getInventoryPipelineSummary } = await import("../replenishmentEngine");
    return await getInventoryPipelineSummary(String(ctx.user.id));
  }),

  // ─── Step Time Templates ───

  getStepTemplates: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return await db!.select().from(stepTimeTemplates)
      .where(eq(stepTimeTemplates.userId, String(ctx.user.id)))
      .orderBy(desc(stepTimeTemplates.updatedAt));
  }),

  saveStepTemplate: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      templateName: z.string(),
      shippingMethod: z.string(),
      stepDays: z.array(z.number()).length(9),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const userId = String(ctx.user.id);
      const stepData = {
        templateName: input.templateName,
        shippingMethod: input.shippingMethod,
        step1Days: input.stepDays[0],
        step2Days: input.stepDays[1],
        step3Days: input.stepDays[2],
        step4Days: input.stepDays[3],
        step5Days: input.stepDays[4],
        step6Days: input.stepDays[5],
        step7Days: input.stepDays[6],
        step8Days: input.stepDays[7],
        step9Days: input.stepDays[8],
        updatedAt: Date.now(),
      };
      if (input.id) {
        await db!.update(stepTimeTemplates)
          .set(stepData)
          .where(and(eq(stepTimeTemplates.id, input.id), eq(stepTimeTemplates.userId, userId)));
      } else {
        await db!.insert(stepTimeTemplates).values({
          ...stepData,
          userId,
          createdAt: Date.now(),
        });
      }
      return { success: true };
    }),

  deleteStepTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.delete(stepTimeTemplates)
        .where(and(eq(stepTimeTemplates.id, input.id), eq(stepTimeTemplates.userId, String(ctx.user.id))));
      return { success: true };
    }),

  // ─── Lingxing API Data ───

  getLingxingDeliveryOrders: protectedProcedure.query(async () => {
    const lingxing = (await import("../lingxingAdapter")).getLingxingAdapter();
    const res = await lingxing.request({ path: '/erp/sc/routing/shipment/deliveryOrderList', body: {} });
    return Array.isArray(res.data) ? res.data : [];
  }),

  getLingxingLogisticsChannels: protectedProcedure.query(async () => {
    const lingxing = (await import("../lingxingAdapter")).getLingxingAdapter();
    const res = await lingxing.request({ path: '/erp/sc/routing/logistic/channelList', body: {} });
    return Array.isArray(res.data) ? res.data : [];
  }),

  getLingxingFbaInventory: protectedProcedure.query(async () => {
    const lingxing = (await import("../lingxingAdapter")).getLingxingAdapter();
    const res = await lingxing.request({ path: '/erp/sc/routing/storage/fbaInventoryV2', body: {} });
    return Array.isArray(res.data) ? res.data : [];
  }),

  getLingxingPurchaseOrders: protectedProcedure.query(async () => {
    const lingxing = (await import("../lingxingAdapter")).getLingxingAdapter();
    const res = await lingxing.request({ path: '/erp/sc/routing/purchase/orderList', body: {} });
    return Array.isArray(res.data) ? res.data : [];
  }),
});
