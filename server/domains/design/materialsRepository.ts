import { TRPCError } from "@trpc/server";
import { execute, type Scope } from "./repository";

export const materialMissing = () => {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "素材或项目不存在，或无权访问",
  });
};
export async function requireMaterialProject(
  projectId: string | null,
  s: Scope,
  tx?: any
) {
  if (projectId === null) return;
  const row = (
    await execute(
      "SELECT * FROM design_material_projects WHERE id=? AND workspaceId=? AND userId=?",
      [projectId, s.workspaceId, s.userId],
      tx
    )
  )[0];
  if (!row) materialMissing();
  return row;
}
export async function visibleMaterial(
  id: string,
  s: Scope,
  tx?: any,
  lock = false
) {
  const row = (
    await execute(
      `SELECT f.* FROM design_material_files f WHERE f.id=? AND f.workspaceId=? AND (f.projectId IS NULL OR EXISTS (SELECT 1 FROM design_material_projects p WHERE p.id=f.projectId AND p.workspaceId=f.workspaceId AND p.userId=?))${lock ? " FOR UPDATE" : ""}`,
      [id, s.workspaceId, s.userId],
      tx
    )
  )[0];
  if (!row) materialMissing();
  return row;
}
export function canManageMaterial(user: any, row: any) {
  return (
    Number(row.userId) === Number(user.id) ||
    (row.projectId === null && ["admin", "super_admin"].includes(user.role))
  );
}
export function checkMaterialRevision(row: any, revision: number) {
  if (Number(row.revision) !== revision)
    throw new TRPCError({
      code: "CONFLICT",
      message: "素材已被更新，请刷新后重试",
    });
}
export async function insertMaterial(
  s: Scope,
  file: {
    id: string;
    name: string;
    mime: string;
    bytes: number;
    sha256: string;
    storageName: string;
  },
  projectId: string | null,
  tx: any
) {
  await execute("SELECT id FROM users WHERE id=? FOR UPDATE", [s.userId], tx);
  await requireMaterialProject(projectId, s, tx);
  // Serialize public imports too, so simultaneous copies cannot create duplicates.
  if (projectId === null)
    await execute(
      "SELECT id FROM workspaces WHERE id=? FOR UPDATE",
      [s.workspaceId],
      tx
    );
  const duplicate = (
    await execute(
      "SELECT id FROM design_material_files WHERE workspaceId=? AND projectId <=> ? AND sha256=? AND deletedAt IS NULL LIMIT 1",
      [s.workspaceId, projectId, file.sha256],
      tx
    )
  )[0];
  if (duplicate) return { id: String(duplicate.id), duplicate: true };
  const usage = (
    await execute(
      "SELECT COALESCE(SUM(bytes),0) AS bytes FROM design_material_files WHERE workspaceId=? AND userId=?",
      [s.workspaceId, s.userId],
      tx
    )
  )[0];
  const quota = Number(
    process.env.DESIGN_MATERIAL_QUOTA_BYTES || 10 * 1024 ** 3
  );
  if (Number(usage?.bytes || 0) + file.bytes > quota)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "素材空间不足，请联系管理员扩容",
    });
  await execute(
    "INSERT INTO design_material_files(id,workspaceId,userId,projectId,name,mime,bytes,sha256,storageName) VALUES(?,?,?,?,?,?,?,?,?)",
    [
      file.id,
      s.workspaceId,
      s.userId,
      projectId,
      file.name,
      file.mime,
      file.bytes,
      file.sha256,
      file.storageName,
    ],
    tx
  );
  return { id: file.id, duplicate: false };
}
