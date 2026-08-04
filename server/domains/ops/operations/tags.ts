import { z, TRPCError, protectedProcedure, router, getDb, invokeLLM, inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules, adAnalysisTasks, adAutomationRules, searchTermActions, competitorMonitors, competitorSnapshots, competitorReports, lingxingApiLogs, userSettings, asinStatusCache, asinPermissions, asinTagDefinitions, asinTagAssignments, productProfiles, productVariants, lingxingProductWeekly, operatorNameMappings, eq, desc, and, sql, gte, lte, or, MANAGER_ROLES, resolveDataUserId, CacheEntry, adCache, cacheGet, cacheSet, getCacheAge, getDateRange, MARKETPLACE_MAP, filterSidsByMarketplace, getAllSellerSids, getToday, getYesterday, getDateNDaysAgo } from "./context";
import { opsWorkspaceCondition, withOpsWorkspace, workspaceIdFromContext } from "./context";

export const tagsProcedures = {
// ============== Search Term Translation ==============
  translateSearchTerms: protectedProcedure
    .input(z.object({ terms: z.array(z.string()).max(50) }))
    .mutation(async ({ input }) => {
      try {

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are a translation assistant. Translate the following English Amazon search terms to Chinese. Return a JSON object where keys are the original English terms and values are the Chinese translations. Be concise and accurate. Focus on the product/shopping intent."
            },
            {
              role: "user",
              content: `Translate these search terms to Chinese:\n${input.terms.join('\n')}`
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "translations",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  translations: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  }
                },
                required: ["translations"],
                additionalProperties: false,
              }
            }
          }
        });
        const content = response.choices?.[0]?.message?.content;
        if (content && typeof content === 'string') {
          const parsed = JSON.parse(content);
          return parsed.translations || {};
        }
        return {};
      } catch (err: any) {
        console.error(`[TranslateSearchTerms] Error: ${err.message}`);
        return {};
            }
    }),

// ============== ASIN Tag Management ==============
  listTagDefinitions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(asinTagDefinitions)
      .where(opsWorkspaceCondition(asinTagDefinitions, workspaceIdFromContext(ctx), eq(asinTagDefinitions.userId, ctx.user.id)));
  }),

createTagDefinition: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(50),
      color: z.string().default('#6366f1'),
      hideFromInventory: z.number().min(0).max(1).default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(asinTagDefinitions).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
        userId: ctx.user.id,
        name: input.name,
        color: input.color,
        hideFromInventory: input.hideFromInventory,
      }));
      return { id: result.insertId };
    }),

updateTagDefinition: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(50).optional(),
      color: z.string().optional(),
      hideFromInventory: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const updateData: any = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.color !== undefined) updateData.color = input.color;
      if (input.hideFromInventory !== undefined) updateData.hideFromInventory = input.hideFromInventory;
      await db!.update(asinTagDefinitions)
        .set(updateData)
        .where(opsWorkspaceCondition(asinTagDefinitions, workspaceIdFromContext(ctx), and(eq(asinTagDefinitions.id, input.id), eq(asinTagDefinitions.userId, ctx.user.id))));
      return { success: true };
    }),

deleteTagDefinition: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Delete all assignments first
      await db!.delete(asinTagAssignments)
        .where(opsWorkspaceCondition(asinTagAssignments, workspaceIdFromContext(ctx), and(eq(asinTagAssignments.tagId, input.id), eq(asinTagAssignments.userId, ctx.user.id))));
      // Then delete the definition
      await db!.delete(asinTagDefinitions)
        .where(opsWorkspaceCondition(asinTagDefinitions, workspaceIdFromContext(ctx), and(eq(asinTagDefinitions.id, input.id), eq(asinTagDefinitions.userId, ctx.user.id))));
      return { success: true };
    }),

listTagAssignments: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(asinTagAssignments)
      .where(opsWorkspaceCondition(asinTagAssignments, workspaceIdFromContext(ctx), eq(asinTagAssignments.userId, ctx.user.id)));
  }),

assignTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      asin: z.string(),
      msku: z.string().optional(),
      sid: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Check if already assigned
      const existing = await db!.select().from(asinTagAssignments)
        .where(opsWorkspaceCondition(asinTagAssignments, workspaceIdFromContext(ctx), and(
          eq(asinTagAssignments.userId, ctx.user.id),
          eq(asinTagAssignments.tagId, input.tagId),
          eq(asinTagAssignments.asin, input.asin),
        )));
      if (existing.length > 0) return { id: existing[0].id };
      const [result] = await db!.insert(asinTagAssignments).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
        userId: ctx.user.id,
        tagId: input.tagId,
        asin: input.asin,
        msku: input.msku,
        sid: input.sid,
      }));
      return { id: result.insertId };
    }),

removeTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      asin: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.delete(asinTagAssignments)
        .where(opsWorkspaceCondition(asinTagAssignments, workspaceIdFromContext(ctx), and(
          eq(asinTagAssignments.userId, ctx.user.id),
          eq(asinTagAssignments.tagId, input.tagId),
          eq(asinTagAssignments.asin, input.asin),
        )));
      return { success: true };
    }),

batchAssignTag: protectedProcedure
    .input(z.object({
      tagId: z.number(),
      asins: z.array(z.object({
        asin: z.string(),
        msku: z.string().optional(),
        sid: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      let count = 0;
      for (const item of input.asins) {
        const existing = await db!.select().from(asinTagAssignments)
          .where(opsWorkspaceCondition(asinTagAssignments, workspaceIdFromContext(ctx), and(
            eq(asinTagAssignments.userId, ctx.user.id),
            eq(asinTagAssignments.tagId, input.tagId),
            eq(asinTagAssignments.asin, item.asin),
          )));
        if (existing.length === 0) {
          await db!.insert(asinTagAssignments).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
            userId: ctx.user.id,
            tagId: input.tagId,
            asin: item.asin,
            msku: item.msku,
            sid: item.sid,
          }));
          count++;
        }
      }
      return { count };
    })
};
