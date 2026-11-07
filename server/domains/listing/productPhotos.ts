import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  storagePut,
  resolveStoredObjectUrl,
  storageDeleteOwnedObject,
} from "../../storage";
import { readListingAggregation } from "./aggregationStore";
import { assertResearchEditable } from "./researchLocks";
import { mutateResearchManaged } from "./researchManagedStore";
import type { PlanningScope } from "./imagePlanningStore";
export const photoUploadSchema = z.object({
  projectId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["product", "accessory"]),
  base64: z
    .string()
    .min(4)
    .max(15 * 1024 * 1024),
});
export async function uploadProductPhoto(
  scope: PlanningScope,
  input: z.infer<typeof photoUploadSchema>
) {
  await assertResearchEditable(scope, "selling");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片内容无效" });
  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.length > 10 * 1024 * 1024)
    throw new TRPCError({ code: "BAD_REQUEST", message: "每张图片最大10MB" });
  let image: Buffer, metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      limitInputPixels: 40_000_000,
      animated: false,
    }).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
      throw new Error();
    image = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({
        width: 3000,
        height: 3000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请上传有效的 JPG、PNG 或 WebP 图片，像素不超过4000万",
    });
  }
  const id = randomUUID(),
    saved = await storagePut(
      `listing-product/${scope.workspaceId}/${scope.projectId}/${id}.jpg`,
      image,
      "image/jpeg"
    ),
    size = await sharp(image).metadata();
  try {
    return await mutateResearchManaged(scope, "selling", async data => {
      if ((data.productPhotos?.length || 0) >= 30)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "每个项目最多30张本品图片",
        });
      data.productPhotos = [
        ...(data.productPhotos || []),
        {
          id,
          name: input.name,
          kind: input.kind,
          storageKey: saved.storageUri,
          width: size.width!,
          height: size.height!,
        },
      ];
      return { id };
    });
  } catch (error) {
    await storageDeleteOwnedObject(saved.storageUri).catch(() => null);
    throw error;
  }
}
export async function productPhotos(scope: PlanningScope) {
  const current = await readListingAggregation(scope);
  return Promise.all(
    (current.data.productPhotos || []).map(async p => ({
      ...p,
      url: await resolveStoredObjectUrl(p.storageKey),
    }))
  );
}
export async function reorderProductPhotos(
  scope: PlanningScope,
  ids: string[],
  expectedIds: string[]
) {
  return mutateResearchManaged(scope, "selling", async data => {
    const current = data.productPhotos || [];
    if (JSON.stringify(current.map(p => p.id)) !== JSON.stringify(expectedIds))
      throw new TRPCError({
        code: "CONFLICT",
        message: "本品图片已变化，请刷新后重试",
      });
    if (
      new Set(ids).size !== ids.length ||
      ids.some(id => !current.some(p => p.id === id))
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "图片顺序无效，请刷新重试",
      });
    data.productPhotos = ids.map(id => current.find(p => p.id === id)!);
    return { saved: true };
  });
}
