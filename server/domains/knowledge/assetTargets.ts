import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { KbImage, KbImageSet } from "../../../drizzle/schema/image";
import { imageTaggingUnits } from "../../../shared/imageTaggingUnits";
import { IMAGE_TAGGING_TAG_FIELDS } from "../../../shared/imageTagging";
import { inheritedVideoLabels, type VideoRow } from "./videoLibrary";
import { requireDb } from "../../repositories/dbClient";

export type AssetScope = { workspaceId: number; userId: number; role?: string };
export type AssetKind = "set" | "image" | "video";
export type Executor = { execute: (query: SQL) => Promise<unknown> };
export const isLibraryAdmin = (scope: AssetScope) =>
  ["admin", "super_admin"].includes(scope.role || "");
export function requireLibraryAdmin(scope: AssetScope) {
  if (!isLibraryAdmin(scope))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只有管理员可以删除资料和管理回收站",
    });
}
export async function queryRows<T>(db: Executor, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as [T[]])[0];
}
export const notFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "资料不存在、已删除或无权访问" });
export const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "资料已经更新，请关闭对话后重新打开，避免覆盖他人的修改",
  });
export function canAccess(
  scope: AssetScope,
  row: { userId: number | null; visibility: string; status?: string },
  edit: boolean
) {
  return (
    row.userId === scope.userId ||
    ((row.visibility === "team" || row.visibility === "public") &&
      (!row.status || row.status === "confirmed") &&
      (!edit || isLibraryAdmin(scope)))
  );
}
export const imageResult = (image: KbImage, set?: KbImageSet | null) => ({
  ...Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(k => [k, image[k] || ""])),
  tagAccentColor: image.tagAccentColor || "",
  tagImageBelong: image.tagImageBelong || "",
  tagImageBelongSub: image.tagImageBelongSub || "",
  ...(set
    ? {
        tagCategory: set.setCategory || "",
        tagDesignStyleV2: set.setStyle || "",
        tagColorSchemeV2: set.setPrimaryColor || "",
        tagAccentColor: set.setAccentColor || "",
      }
    : {}),
});
export async function loadAsset(
  scope: AssetScope,
  kind: AssetKind,
  id: number,
  options: {
    db?: Executor;
    lock?: boolean;
    edit?: boolean;
    deleting?: boolean;
  } = {}
) {
  const db = options.db || (await requireDb("knowledge asset")),
    lock = options.lock ? sql` FOR UPDATE` : sql``;
  if (kind === "set") {
    const [set] = await queryRows<KbImageSet>(db, sql`SELECT * FROM kb_image_sets WHERE id=${id} AND workspaceId=${scope.workspaceId} AND recycleId IS NULL${lock}`);
    if (!set || !canAccess(scope, set, Boolean(options.edit))) throw notFound();
    const images = await queryRows<KbImage>(db, sql`SELECT * FROM kb_images WHERE imageSetId=${id} AND recycleId IS NULL ORDER BY positionIndex,id${lock}`);
    return {kind, id, set, images, video:null, unit:null, result: {
      setCategory:set.setCategory || "", setStyle:set.setStyle || "", setPrimaryColor:set.setPrimaryColor || "", setAccentColor:set.setAccentColor || "",
    } as Record<string, unknown>, title:set.productTitle || set.asin, visibility:set.visibility, ownerId:set.userId};
  }
  const table = kind === "image" ? "kb_images" : "kb_videos";
  const [identity] = await queryRows<{ imageSetId: number | null }>(
    db,
    sql`SELECT imageSetId FROM ${sql.identifier(table)} WHERE id=${id}`
  );
  if (!identity) throw notFound();
  const set = identity.imageSetId
    ? (
        await queryRows<KbImageSet>(
          db,
          sql`SELECT * FROM kb_image_sets WHERE id=${identity.imageSetId} AND workspaceId=${scope.workspaceId} AND recycleId IS NULL${lock}`
        )
      )[0]
    : null;
  if (
    identity.imageSetId &&
    (!set ||
      (!options.deleting && !canAccess(scope, set, Boolean(options.edit))))
  )
    throw notFound();
  if (options.deleting) requireLibraryAdmin(scope);
  if (kind === "video") {
    const [row] = await queryRows<VideoRow & { recycleId: string | null }>(
      db,
      sql`SELECT * FROM kb_videos WHERE id=${id} AND workspaceId=${scope.workspaceId} AND recycleId IS NULL AND status<>'archived' AND origin_instance_id='knowledge_video_v1'${lock}`
    );
    if (
      !row ||
      row.imageSetId !== identity.imageSetId ||
      (!options.deleting && !canAccess(scope, row, Boolean(options.edit)))
    )
      throw notFound();
    const video = {
      ...row,
      asin: set?.asin || null,
      setCategory: set?.setCategory || null,
      setStyle: set?.setStyle || null,
      setPrimaryColor: set?.setPrimaryColor || null,
      setAccentColor: set?.setAccentColor || null,
    };
    return {
      kind,
      id,
      set,
      video,
      images: [] as KbImage[],
      unit: null,
      result: inheritedVideoLabels(video) as Record<string, unknown> | null,
      title: row.videoTitle || "未命名视频",
      visibility: set?.visibility || row.visibility,
      ownerId: row.userId,
    };
  }
  const images = await queryRows<KbImage>(
    db,
    set
      ? sql`SELECT * FROM kb_images WHERE imageSetId=${set.id} AND recycleId IS NULL ORDER BY positionIndex,id${lock}`
      : sql`SELECT * FROM kb_images WHERE id=${id} AND imageSetId IS NULL AND workspaceId=${scope.workspaceId} AND uploadHash IS NOT NULL AND recycleId IS NULL${lock}`
  );
  const row = images.find(i => i.id === id);
  if (
    !row ||
    (!set && !options.deleting && !canAccess(scope, row, Boolean(options.edit)))
  )
    throw notFound();
  const unit = imageTaggingUnits(images, set?.sourceLayout).find(u =>
    u.images.some(i => i.id === id)
  ) || { primary: row, images: [row], complete: true };
  return {
    kind,
    id: unit.primary.id,
    set,
    video: null,
    images,
    unit,
    result: imageResult(unit.primary, set) as Record<string, unknown>,
    title: set?.productTitle || row.uploadTitle || "图片",
    visibility: set?.visibility || row.visibility,
    ownerId: set?.userId || row.userId!,
  };
}
export type LoadedAsset = Awaited<ReturnType<typeof loadAsset>>;
export function assetFingerprint(asset: LoadedAsset) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: asset.kind,
        id: asset.id,
        result: asset.result,
        set: asset.set && [asset.set.id, asset.set.sourceLayout],
        images: (asset.kind === "set" ? asset.images : asset.unit?.images)?.map(i => [
          i.id,
          i.imageUrl,
          i.labelRevision,
        ]),
        video: asset.video && [
          asset.video.videoUrl,
          asset.video.videoRole,
          asset.video.labelRevision,
        ],
      })
    )
    .digest("hex");
}
