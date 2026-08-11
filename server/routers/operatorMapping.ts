import { currentOpsWorkspaceId } from "../domains/ops/workspaceContext";
import { opsWorkspaceCondition, withOpsWorkspace } from "../repositories/ops";
/**
 * Operator Name Mapping Router
 * Maps external operator names (from Lingxing/Saihu exports) to system users
 * Supports: fuzzy matching, manual confirmation, CRUD management
 */
import { z } from "zod";
import { eq, and, or } from "drizzle-orm";
import { router } from "../_core/trpc";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";
import { getDb } from "../repositories/dbClient";
import { operatorNameMappings, users, workspaceMemberships } from "../../drizzle/schema";

// ─── Fuzzy Matching Helpers ───

const OPERATOR_MATCH_THRESHOLD = 0.7;

/**
 * Calculate similarity between two strings using character overlap
 * Returns a score between 0 and 1
 */
function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1;
  // Check containment
  if (la.includes(lb) || lb.includes(la)) return 0.8;
  // Character-level Jaccard similarity
  const setA = new Set(la.split(""));
  const setB = new Set(lb.split(""));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Extract the "core name" from a Lingxing/Saihu operator string
 * Examples:
 *   "运营 超级管理员_XM-1" → "超级管理员"
 *   "张三_US-2" → "张三"
 *   "Tom Zhang" → "Tom Zhang"
 *   "运营_李四" → "李四"
 */
function extractCoreName(externalName: string): string {
  if (!externalName) return "";
  let name = externalName.trim();
  // Remove common prefixes like "运营 ", "运营_"
  name = name.replace(/^(运营|开发|财务|采购|设计|业务员?)\s*[_\s]*/i, "");
  // Remove trailing tags like "_XM-1", "_US-2", "_店铺名"
  name = name.replace(/[_\-][A-Za-z0-9\-]+$/, "");
  // Remove trailing store/country tags in Chinese
  name = name.replace(/[_\-][\u4e00-\u9fa5]+\d*$/, "");
  return name.trim();
}

function normalizeNameToken(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s·•._-]+/g, "");
}

/**
 * System user names commonly include an English alias, for example
 * "郭国远（Alan）". Treat both the Chinese name and the alias as exact-match
 * candidates while preserving the full display name in the saved mapping.
 */
function extractNameAliases(value: string): string[] {
  const displayName = value.normalize("NFKC").trim();
  if (!displayName) return [];
  const aliases = new Set<string>([normalizeNameToken(displayName)]);
  const parenthetical = [...displayName.matchAll(/\(([^()]+)\)/g)]
    .map((match) => match[1]?.trim())
    .filter((alias): alias is string => Boolean(alias));
  const baseName = displayName.replace(/\s*\([^()]+\)\s*$/g, "").trim();
  if (baseName) aliases.add(normalizeNameToken(baseName));
  for (const alias of parenthetical) aliases.add(normalizeNameToken(alias));
  return [...aliases].filter(Boolean);
}

/**
 * Try to match an external operator name against system users
 * Returns ranked matches with confidence scores
 */
function fuzzyMatchUsers(
  externalName: string,
  systemUsers: { id: number; name: string | null }[]
): { userId: number; userName: string; score: number; matchType: string }[] {
  const coreName = extractCoreName(externalName);
  const externalAliases = new Set([
    ...extractNameAliases(externalName),
    ...extractNameAliases(coreName),
  ]);
  const results: { userId: number; userName: string; score: number; matchType: string }[] = [];

  for (const user of systemUsers) {
    if (!user.name) continue;
    const userName = user.name.trim();
    const userAliases = extractNameAliases(userName);

    // 1. Exact match (full external name or core name matches user name)
    if (userAliases.some((alias) => externalAliases.has(alias))) {
      results.push({ userId: user.id, userName, score: 1.0, matchType: "exact_alias" });
      continue;
    }

    // 2. Containment match (user name contains core name or vice versa)
    if (userName.includes(coreName) || coreName.includes(userName)) {
      const score = Math.min(coreName.length, userName.length) / Math.max(coreName.length, userName.length);
      results.push({ userId: user.id, userName, score: Math.max(0.7, score * 0.9), matchType: "contains" });
      continue;
    }

    // 3. Case-insensitive containment (for English names)
    const lowerUser = userName.toLowerCase();
    const lowerCore = coreName.toLowerCase();
    if (lowerUser.includes(lowerCore) || lowerCore.includes(lowerUser)) {
      const score = Math.min(lowerCore.length, lowerUser.length) / Math.max(lowerCore.length, lowerUser.length);
      results.push({ userId: user.id, userName, score: Math.max(0.6, score * 0.85), matchType: "contains_ci" });
      continue;
    }

    // 4. Character similarity
    const sim = stringSimilarity(coreName, userName);
    if (sim >= 0.4) {
      results.push({ userId: user.id, userName, score: sim * 0.7, matchType: "similarity" });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ─── Router ───

export const operatorMappingRouter = router({
  // ─── List all mappings for the current workspace ───
  listMappings: protectedProcedure.query(async () => {
    const db = await getDb();
    const mappings = await db!.select().from(operatorNameMappings)
      .where(opsWorkspaceCondition(operatorNameMappings, currentOpsWorkspaceId()))
      .orderBy(operatorNameMappings.externalName);
    return mappings;
  }),

  // ─── Add or update a mapping ───
  upsertMapping: protectedProcedure
    .input(z.object({
      externalName: z.string().min(1),
      sourceType: z.enum(["lingxing", "saihu", "all"]).default("all"),
      systemUserName: z.string().nullable(),
      systemUserId: z.number().nullable(),
      isConfirmed: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Check if mapping already exists
      const existing = await db!.select().from(operatorNameMappings)
        .where(opsWorkspaceCondition(operatorNameMappings, currentOpsWorkspaceId(), and(
          eq(operatorNameMappings.externalName, input.externalName),
          eq(operatorNameMappings.sourceType, input.sourceType),
        )))
        .limit(1);

      if (existing.length > 0) {
        // Update existing
        await db!.update(operatorNameMappings)
          .set({
            systemUserName: input.systemUserName,
            systemUserId: input.systemUserId,
            isConfirmed: input.isConfirmed ? 1 : 0,
          })
          .where(opsWorkspaceCondition(operatorNameMappings, currentOpsWorkspaceId(), eq(operatorNameMappings.id, existing[0].id)));
        return { id: existing[0].id, action: "updated" };
      } else {
        // Insert new
        const result = await db!.insert(operatorNameMappings).values(withOpsWorkspace(currentOpsWorkspaceId(), {
          userId: ctx.user.id,
          externalName: input.externalName,
          sourceType: input.sourceType,
          systemUserName: input.systemUserName,
          systemUserId: input.systemUserId,
          isConfirmed: input.isConfirmed ? 1 : 0,
        }));
        return { id: Number(result[0].insertId), action: "created" };
      }
    }),

  // ─── Bulk upsert mappings (used after confirmation dialog) ───
  bulkUpsertMappings: protectedProcedure
    .input(z.object({
      mappings: z.array(z.object({
        externalName: z.string().min(1),
        sourceType: z.enum(["lingxing", "saihu", "all"]).default("all"),
        systemUserName: z.string().nullable(),
        systemUserId: z.number().nullable(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      let created = 0;
      let updated = 0;

      for (const m of input.mappings) {
        const existing = await db!.select().from(operatorNameMappings)
          .where(opsWorkspaceCondition(operatorNameMappings, currentOpsWorkspaceId(), and(
            eq(operatorNameMappings.externalName, m.externalName),
            or(
              eq(operatorNameMappings.sourceType, m.sourceType),
              eq(operatorNameMappings.sourceType, "all"),
            ),
          )))
          .limit(1);

        if (existing.length > 0) {
          await db!.update(operatorNameMappings)
            .set({
              systemUserName: m.systemUserName,
              systemUserId: m.systemUserId,
              isConfirmed: 1,
            })
            .where(opsWorkspaceCondition(operatorNameMappings, currentOpsWorkspaceId(), eq(operatorNameMappings.id, existing[0].id)));
          updated++;
        } else {
          await db!.insert(operatorNameMappings).values(withOpsWorkspace(currentOpsWorkspaceId(), {
            userId: ctx.user.id,
            externalName: m.externalName,
            sourceType: m.sourceType,
            systemUserName: m.systemUserName,
            systemUserId: m.systemUserId,
            isConfirmed: 1,
          }));
          created++;
        }
      }

      return { created, updated };
    }),

  // ─── Delete a mapping ───
  deleteMapping: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.delete(operatorNameMappings)
        .where(opsWorkspaceCondition(
          operatorNameMappings,
          currentOpsWorkspaceId(),
          eq(operatorNameMappings.id, input.id),
        ));
      return { deleted: true };
    }),

  // ─── Resolve operator names: given a list of external names, return mapping suggestions ───
  // This is called during import to show the confirmation dialog
  resolveOperatorNames: protectedProcedure
    .input(z.object({
      externalNames: z.array(z.string()),
      sourceType: z.enum(["lingxing", "saihu"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      // 1. Load all existing confirmed mappings for this workspace
      const existingMappings = await db!.select().from(operatorNameMappings)
        .where(opsWorkspaceCondition(
          operatorNameMappings,
          currentOpsWorkspaceId(),
          eq(operatorNameMappings.isConfirmed, 1),
        ));

      // 2. Load all active system users
      const workspaceId = currentOpsWorkspaceId();
      const systemUsers = await db!.selectDistinct({ id: users.id, name: users.name })
        .from(users)
        .leftJoin(workspaceMemberships, and(
          eq(workspaceMemberships.userId, users.id),
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.status, "active"),
        ))
        .where(and(
          eq(users.status, "active"),
          or(
            eq(users.defaultWorkspaceId, workspaceId),
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(users.id, ctx.user.id),
          ),
        ));

      // 3. For each external name, try to resolve
      const results: {
        externalName: string;
        coreName: string;
        status: "mapped" | "suggested" | "unmatched";
        mappedUserName: string | null;
        mappedUserId: number | null;
        suggestions: { userId: number; userName: string; score: number; matchType: string }[];
      }[] = [];

      // Split composite names (e.g. "裴艺翔,康凡静" → ["裴艺翔", "康凡静"]) before dedup
      const splitNames = input.externalNames
        .filter(Boolean)
        .flatMap(n => n.split(/[\/、,，]+/).map((s: string) => s.trim()).filter(Boolean));
      const uniqueNames = [...new Set(splitNames)];

      for (const extName of uniqueNames) {
        // Check existing confirmed mapping
        const existingMap = existingMappings.find(m =>
          m.externalName === extName &&
          (m.sourceType === input.sourceType || m.sourceType === "all")
        );

        if (existingMap && existingMap.systemUserName) {
          results.push({
            externalName: extName,
            coreName: extractCoreName(extName),
            status: "mapped",
            mappedUserName: existingMap.systemUserName,
            mappedUserId: existingMap.systemUserId,
            suggestions: [],
          });
          continue;
        }

        // Try fuzzy matching
        const matches = fuzzyMatchUsers(extName, systemUsers);
        if (matches.length > 0 && matches[0].score >= OPERATOR_MATCH_THRESHOLD) {
          // High confidence match - suggest as auto-mapped
          results.push({
            externalName: extName,
            coreName: extractCoreName(extName),
            status: "suggested",
            mappedUserName: matches[0].userName,
            mappedUserId: matches[0].userId,
            suggestions: matches.slice(0, 5),
          });
        } else {
          // No confident match
          results.push({
            externalName: extName,
            coreName: extractCoreName(extName),
            status: "unmatched",
            mappedUserName: null,
            mappedUserId: null,
            suggestions: matches.slice(0, 5),
          });
        }
      }

      return {
        results,
        systemUsers: systemUsers.map(u => ({ id: u.id, name: u.name || "" })),
        totalNames: uniqueNames.length,
        mappedCount: results.filter(r => r.status === "mapped").length,
        suggestedCount: results.filter(r => r.status === "suggested").length,
        unmatchedCount: results.filter(r => r.status === "unmatched").length,
      };
    }),

  // ─── Get mapped system user name for a single external name (used in display) ───
  getMappedName: protectedProcedure
    .input(z.object({
      externalName: z.string(),
      sourceType: z.enum(["lingxing", "saihu", "all"]).default("all"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const mapping = await db!.select().from(operatorNameMappings)
        .where(opsWorkspaceCondition(operatorNameMappings, currentOpsWorkspaceId(), and(
          eq(operatorNameMappings.externalName, input.externalName),
          or(
            eq(operatorNameMappings.sourceType, input.sourceType),
            eq(operatorNameMappings.sourceType, "all"),
          ),
          eq(operatorNameMappings.isConfirmed, 1),
        )))
        .limit(1);

      if (mapping.length > 0) {
        return {
          found: true,
          systemUserName: mapping[0].systemUserName,
          systemUserId: mapping[0].systemUserId,
        };
      }
      return { found: false, systemUserName: null, systemUserId: null };
    }),

  // ─── Batch get mapped names (for product list display) ───
  batchGetMappedNames: protectedProcedure
    .input(z.object({
      externalNames: z.array(z.string()),
      sourceType: z.enum(["lingxing", "saihu", "all"]).default("all"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const uniqueNames = [...new Set(input.externalNames.filter(Boolean))];
      if (uniqueNames.length === 0) return {};

      const allMappings = await db!.select().from(operatorNameMappings)
        .where(opsWorkspaceCondition(
          operatorNameMappings,
          currentOpsWorkspaceId(),
          eq(operatorNameMappings.isConfirmed, 1),
        ));

      const result: Record<string, { systemUserName: string | null; systemUserId: number | null }> = {};
      for (const name of uniqueNames) {
        const mapping = allMappings.find(m =>
          m.externalName === name &&
          (m.sourceType === input.sourceType || m.sourceType === "all")
        );
        if (mapping) {
          result[name] = {
            systemUserName: mapping.systemUserName,
            systemUserId: mapping.systemUserId,
          };
        }
      }
      return result;
    }),
});

// Export helper functions for use in other routers
export {
  OPERATOR_MATCH_THRESHOLD,
  extractCoreName,
  extractNameAliases,
  fuzzyMatchUsers,
  normalizeNameToken,
  stringSimilarity,
};
