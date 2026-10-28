import { randomUUID, createHash } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../../_core/trpc";
import { materialName, materialTarget } from "../../../shared/designMaterials";
import { authorizeDesign } from "./access";
import {
  execute,
  transaction,
  ownAsset,
  ownConversation,
  jsonValue,
} from "./repository";
import { assetBytes } from "./assets";
import { materialDirectory } from "./materialsStorage";
import {
  requireMaterialProject,
  visibleMaterial,
  materialMissing,
  canManageMaterial,
  checkMaterialRevision,
  insertMaterial,
} from "./materialsRepository";

const scope = (u: any, op: "read" | "edit" | "delete") =>
  authorizeDesign(u, op, "design_materials");
const identity = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
});
export const designMaterialsRouter = router({
  projects: protectedProcedure.query(async ({ ctx }) => {
    const s = await scope(ctx.user, "read");
    const rows: any[] = await execute(
      "SELECT p.id,p.name,p.updatedAt,COUNT(f.id) AS fileCount,COALESCE(SUM(f.bytes),0) AS bytes FROM design_material_projects p LEFT JOIN design_material_files f ON f.projectId=p.id AND f.workspaceId=p.workspaceId AND f.deletedAt IS NULL WHERE p.workspaceId=? AND p.userId=? GROUP BY p.id,p.name,p.updatedAt ORDER BY p.updatedAt DESC,p.id",
      [s.workspaceId, s.userId]
    );
    return rows.map(r => ({
      id: String(r.id),
      name: String(r.name),
      fileCount: Number(r.fileCount),
      bytes: Number(r.bytes),
    }));
  }),
  saveProject: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: materialName }))
    .mutation(async ({ ctx, input }) => {
      const s = await scope(ctx.user, "edit");
      return transaction(async tx => {
        await execute(
          "SELECT id FROM users WHERE id=? FOR UPDATE",
          [s.userId],
          tx
        );
        const row = (
          await execute(
            "SELECT * FROM design_material_projects WHERE id=? FOR UPDATE",
            [input.id],
            tx
          )
        )[0];
        if (row) {
          if (
            Number(row.workspaceId) !== s.workspaceId ||
            Number(row.userId) !== s.userId
          )
            materialMissing();
          await execute(
            "UPDATE design_material_projects SET name=?,updatedAt=NOW(3) WHERE id=?",
            [input.name, input.id],
            tx
          );
        } else
          await execute(
            "INSERT INTO design_material_projects(id,workspaceId,userId,name) VALUES(?,?,?,?)",
            [input.id, s.workspaceId, s.userId, input.name],
            tx
          );
        return { id: input.id };
      });
    }),
  list: protectedProcedure
    .input(
      materialTarget.extend({
        search: z.string().max(180).default(""),
        trash: z.boolean().default(false),
        offset: z.number().int().min(0).max(100000).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const s = await scope(ctx.user, "read");
      await requireMaterialProject(input.projectId, s);
      const search = input.search.trim().replace(/[!%_]/g, v => "!" + v);
      const rows: any[] = await execute(
        `SELECT f.*,u.name AS authorName FROM design_material_files f LEFT JOIN users u ON u.id=f.userId WHERE f.workspaceId=? AND f.projectId <=> ? AND f.deletedAt IS ${input.trash ? "NOT " : ""}NULL AND (?='' OR f.name LIKE ? ESCAPE '!') ORDER BY f.createdAt DESC,f.id DESC LIMIT 41 OFFSET ?`,
        [s.workspaceId, input.projectId, search, `%${search}%`, input.offset]
      );
      return {
        items: rows.slice(0, 40).map(r => ({
          id: String(r.id),
          name: String(r.name),
          bytes: Number(r.bytes),
          mime: String(r.mime),
          revision: Number(r.revision),
          authorName: r.authorName || "团队成员",
          canManage: canManageMaterial(ctx.user, r),
          createdAt: new Date(r.createdAt).toISOString(),
        })),
        hasMore: rows.length > 40,
      };
    }),
  rename: protectedProcedure
    .input(identity.extend({ name: materialName }))
    .mutation(async ({ ctx, input }) => {
      const s = await scope(ctx.user, "edit");
      return transaction(async tx => {
        const row = await visibleMaterial(input.id, s, tx, true);
        if (row.deletedAt || !canManageMaterial(ctx.user, row))
          materialMissing();
        checkMaterialRevision(row, input.revision);
        await execute(
          "UPDATE design_material_files SET name=?,revision=revision+1,updatedAt=NOW(3) WHERE id=?",
          [input.name, input.id],
          tx
        );
        return { ok: true };
      });
    }),
  trash: protectedProcedure
    .input(identity.extend({ restore: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const s = await scope(ctx.user, input.restore ? "edit" : "delete");
      return transaction(async tx => {
        // Same lock order as upload; prevents restore/upload duplicate races.
        await execute(
          "SELECT id FROM users WHERE id=? FOR UPDATE",
          [s.userId],
          tx
        );
        await execute(
          "SELECT id FROM workspaces WHERE id=? FOR UPDATE",
          [s.workspaceId],
          tx
        );
        const row = await visibleMaterial(input.id, s, tx, true);
        if (!canManageMaterial(ctx.user, row)) materialMissing();
        checkMaterialRevision(row, input.revision);
        if (input.restore) {
          const dup = await execute(
            "SELECT id FROM design_material_files WHERE workspaceId=? AND projectId <=> ? AND sha256=? AND deletedAt IS NULL AND id<>? LIMIT 1",
            [s.workspaceId, row.projectId, row.sha256, input.id],
            tx
          );
          if (dup.length)
            throw new TRPCError({
              code: "CONFLICT",
              message: "同一文件已在素材库中，无需重复恢复",
            });
        }
        await execute(
          `UPDATE design_material_files SET deletedAt=${input.restore ? "NULL" : "NOW(3)"},revision=revision+1,updatedAt=NOW(3) WHERE id=?`,
          [input.id],
          tx
        );
        return { ok: true };
      });
    }),
  saveGenerated: protectedProcedure
    .input(
      materialTarget.extend({
        generationId: z.string().uuid(),
        assetId: z.string().uuid(),
        name: materialName,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const s = await scope(ctx.user, "edit");
      await requireMaterialProject(input.projectId, s);
      const g = (
        await execute(
          "SELECT * FROM design_generations WHERE id=? AND workspaceId=? AND userId=? AND status='succeeded' AND deletedAt IS NULL",
          [input.generationId, s.workspaceId, s.userId]
        )
      )[0];
      if (
        !g ||
        !jsonValue<string[]>(g.assetIds, []).includes(input.assetId) ||
        !(await ownConversation(g.conversationId, s))
      )
        materialMissing();
      const asset = await ownAsset(input.assetId, s);
      if (!asset) materialMissing();
      const bytes = await assetBytes(asset);
      const extension = (
        {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
        } as Record<string, string>
      )[asset.mime];
      if (!extension) materialMissing();
      const name =
        input.name.replace(/\.(png|jpe?g|webp|gif)$/i, "").slice(0, 175) +
        "." +
        extension;
      const id = randomUUID(),
        storageName = id + ".blob",
        file = path.join(await materialDirectory(), storageName);
      await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
      try {
        const result = await transaction(tx =>
          insertMaterial(
            s,
            {
              id,
              name,
              mime: asset.mime,
              bytes: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              storageName,
            },
            input.projectId,
            tx
          )
        );
        if (result.duplicate) await unlink(file);
        return result;
      } catch (error) {
        await unlink(file).catch(() => {});
        throw error;
      }
    }),
});
