import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { userSettings } from "../../../../drizzle/schema";
import { protectedProcedure } from "../workspaceProcedure";
import { requireOpsDb } from "../legacy/repository";
import { opsWorkspaceCondition, withOpsWorkspace } from "../../../repositories/ops";
import { workspaceIdFromContext } from "../../../services/securityGovernance";
export const settingsProcedures = {
// ============== Marketplace & Settings ==============
  getMarketplaces: protectedProcedure.query(() => [{ code: "US", name: "美国站 · USD（合并加拿大、墨西哥）", region: "NA", sids: [] as string[], storeNames: [] as string[] }]),

getUserSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireOpsDb();
    const rows = await db!.select().from(userSettings)
      .where(opsWorkspaceCondition(userSettings, workspaceIdFromContext(ctx), eq(userSettings.userId, ctx.user.id)));
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.settingKey] = r.settingValue || '';
    }
    return result;
  }),

saveUserSetting: protectedProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const now = Date.now();
      // Upsert: try to find existing, then insert or update
      const existing = await db!.select().from(userSettings)
        .where(opsWorkspaceCondition(userSettings, workspaceIdFromContext(ctx), and(eq(userSettings.userId, ctx.user.id), eq(userSettings.settingKey, input.key))));
      if (existing.length > 0) {
        await db!.update(userSettings)
          .set({ settingValue: input.value, updatedAt: now })
          .where(opsWorkspaceCondition(userSettings, workspaceIdFromContext(ctx), eq(userSettings.id, existing[0].id)));
      } else {
        await db!.insert(userSettings).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
          userId: ctx.user.id,
          settingKey: input.key,
          settingValue: input.value,
          createdAt: now,
          updatedAt: now,
        }));
      }
      return { success: true };
    }),
};
