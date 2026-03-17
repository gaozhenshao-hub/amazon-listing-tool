import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { devModuleLocks } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

const moduleNames = ["profile", "bom", "manual", "test", "profit"] as const;

export const devModuleLockRouter = router({
  // Get all module lock statuses for a project
  getAll: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const locks = await db!
        .select()
        .from(devModuleLocks)
        .where(eq(devModuleLocks.projectId, input.projectId));

      // Build a map with defaults for modules that don't have records yet
      const lockMap: Record<string, { isLocked: boolean; lockedAt: Date | null; unlockedAt: Date | null }> = {};
      for (const m of moduleNames) {
        lockMap[m] = { isLocked: false, lockedAt: null, unlockedAt: null };
      }
      for (const lock of locks) {
        lockMap[lock.moduleName] = {
          isLocked: lock.isLocked,
          lockedAt: lock.lockedAt,
          unlockedAt: lock.unlockedAt,
        };
      }
      return lockMap;
    }),

  // Toggle lock status for a specific module
  toggle: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      moduleName: z.enum(moduleNames),
      lock: z.boolean(), // true = lock, false = unlock
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const existing = await db
        .select()
        .from(devModuleLocks)
        .where(
          and(
            eq(devModuleLocks.projectId, input.projectId),
            eq(devModuleLocks.moduleName, input.moduleName)
          )
        );

      const now = new Date();

      if (existing.length > 0) {
        await db
          .update(devModuleLocks)
          .set({
            isLocked: input.lock,
            lockedAt: input.lock ? now : existing[0].lockedAt,
            unlockedAt: !input.lock ? now : existing[0].unlockedAt,
          })
          .where(eq(devModuleLocks.id, existing[0].id));
      } else {
        await db.insert(devModuleLocks).values({
          projectId: input.projectId,
          userId: ctx.user.id,
          moduleName: input.moduleName,
          isLocked: input.lock,
          lockedAt: input.lock ? now : null,
          unlockedAt: null,
        });
      }

      return { success: true, moduleName: input.moduleName, isLocked: input.lock };
    }),

  // Batch toggle multiple modules
  batchToggle: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      modules: z.array(z.object({
        moduleName: z.enum(moduleNames),
        lock: z.boolean(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!;
      const results: { moduleName: string; isLocked: boolean }[] = [];
      const now = new Date();

      for (const mod of input.modules) {
        const existing = await db
          .select()
          .from(devModuleLocks)
          .where(
            and(
              eq(devModuleLocks.projectId, input.projectId),
              eq(devModuleLocks.moduleName, mod.moduleName)
            )
          );

        if (existing.length > 0) {
          await db
            .update(devModuleLocks)
            .set({
              isLocked: mod.lock,
              lockedAt: mod.lock ? now : existing[0].lockedAt,
              unlockedAt: !mod.lock ? now : existing[0].unlockedAt,
            })
            .where(eq(devModuleLocks.id, existing[0].id));
        } else {
          await db.insert(devModuleLocks).values({
            projectId: input.projectId,
            userId: ctx.user.id,
            moduleName: mod.moduleName,
            isLocked: mod.lock,
            lockedAt: mod.lock ? now : null,
            unlockedAt: null,
          });
        }
        results.push({ moduleName: mod.moduleName, isLocked: mod.lock });
      }

      return { success: true, results };
    }),
});
