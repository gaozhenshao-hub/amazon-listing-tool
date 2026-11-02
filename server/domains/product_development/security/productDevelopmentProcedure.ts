import { protectedProcedure as baseProtectedProcedure } from "../../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
  devBomItems,
  devManualAssets,
  devOffsiteAnalyses,
  devProductTags,
  devProducts,
  devProjectTagCategories,
  devProjectTagItems,
  devSuppliers,
} from "../../../../drizzle/schema";
import { getDb } from "../../../repositories/dbClient";
import { resolveDevProjectAccess } from "./productDevelopmentAccess";
import { workspaceScopedProcedure } from "../../ai_os/workspaceScopedProcedure";
import {
  actorFromContext,
  assertResourceAction,
  type SecurityAction,
  workspaceIdFromContext,
} from "../../../services/securityGovernance";

function projectIdFromInput(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const projectId = (input as Record<string, unknown>).projectId;
  return typeof projectId === "number" && Number.isInteger(projectId) && projectId > 0
    ? projectId
    : null;
}

async function indirectProjectId(path: string, input: Record<string, unknown>) {
  const lookup = async (table: any, idColumn: any, projectColumn: any, id: unknown) => {
    if (typeof id !== "number") return null;
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    const rows = await db.select({ projectId: projectColumn }).from(table).where(eq(idColumn, id)).limit(1);
    return rows[0]?.projectId ?? null;
  };

  if (typeof input.productId === "number") {
    return { recognized: true, projectId: await lookup(devProducts, devProducts.id, devProducts.projectId, input.productId) };
  }
  if (typeof input.tagId === "number") {
    return { recognized: true, projectId: await lookup(devProductTags, devProductTags.id, devProductTags.projectId, input.tagId) };
  }
  if (typeof input.categoryId === "number") {
    return { recognized: true, projectId: await lookup(devProjectTagCategories, devProjectTagCategories.id, devProjectTagCategories.projectId, input.categoryId) };
  }
  if (typeof input.itemId === "number") {
    return { recognized: true, projectId: await lookup(devProjectTagItems, devProjectTagItems.id, devProjectTagItems.projectId, input.itemId) };
  }
  if (typeof input.id !== "number") return { recognized: false, projectId: null };
  if (path.startsWith("devProject.")) return { recognized: true, projectId: input.id };
  if (path.startsWith("offsiteAnalysis.")) {
    return { recognized: true, projectId: await lookup(devOffsiteAnalyses, devOffsiteAnalyses.id, devOffsiteAnalyses.projectId, input.id) };
  }
  if (path === "devManual.deleteManualAsset") {
    return { recognized: true, projectId: await lookup(devManualAssets, devManualAssets.id, devManualAssets.projectId, input.id) };
  }
  if (path === "devBom.update" || path === "devBom.delete") {
    return { recognized: true, projectId: await lookup(devBomItems, devBomItems.id, devBomItems.projectId, input.id) };
  }
  if (path === "devBom.updateSupplier" || path === "devBom.deleteSupplier") {
    return { recognized: true, projectId: await lookup(devSuppliers, devSuppliers.id, devSuppliers.projectId, input.id) };
  }
  return { recognized: false, projectId: null };
}

export function productDevelopmentActionFromProcedure(
  path: string,
  type: "query" | "mutation" | "subscription",
): SecurityAction {
  if (type === "query") return "read";
  const operation = path.split(".").at(-1)?.toLowerCase() || "";
  if (operation.includes("delete") || operation.includes("remove")) return "delete";
  if (operation.startsWith("create") || operation.startsWith("add")) return "create";
  if (operation.includes("upload")) return "upload";
  if (operation.includes("import")) return "import";
  if (operation.includes("export") || operation.includes("download")) return "export";
  if (
    operation.includes("confirm") ||
    operation.includes("unlock") ||
    operation.includes("lock") ||
    operation.includes("approve") ||
    operation.includes("revoke")
  ) return "confirm";
  if (
    operation.includes("generate") ||
    operation.includes("analyze") ||
    operation.includes("regenerate") ||
    operation.includes("reanalyze") ||
    operation.startsWith("ai") ||
    operation.startsWith("run")
  ) return "run";
  return "update";
}

// Scope direct project IDs and recognized child records before a resolver can
// read or mutate product-development data.
export const protectedProcedure = workspaceScopedProcedure("product_development").use(async ({ ctx, next, path, type, getRawInput }) => {
  const input = await getRawInput();
  const action = productDevelopmentActionFromProcedure(path, type);
  let projectId = projectIdFromInput(input);
  if (input && typeof input === "object") {
    const indirect = await indirectProjectId(path, input as Record<string, unknown>);
    if (indirect.recognized && !indirect.projectId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "产品开发记录不存在" });
    }
    if (projectId && indirect.projectId && projectId !== indirect.projectId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "记录不属于当前产品开发项目" });
    }
    projectId = projectId || indirect.projectId;
  }
  if (projectId) {
    await resolveDevProjectAccess(projectId, ctx, action);
  } else {
    await assertResourceAction({
      actor: actorFromContext(ctx),
      resource: "product_development",
      action,
      workspaceId: workspaceIdFromContext(ctx),
    });
  }
  return next();
});
