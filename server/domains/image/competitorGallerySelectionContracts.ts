import { createHash } from "node:crypto";
import { z } from "zod";

export const COMPETITOR_GALLERY_DEFAULT_ANALYSIS_ROLES = ["main", "secondary", "aplus"] as const;
export const CompetitorGalleryAssetRoleSchema = z.enum(["main", "secondary", "aplus", "brand_story"]);

export const CompetitorGallerySelectionFilterSchema = z.object({
  includedRoles: z.array(CompetitorGalleryAssetRoleSchema).max(4).default([...COMPETITOR_GALLERY_DEFAULT_ANALYSIS_ROLES]),
}).strict();

export type CompetitorGallerySelectionFilter = z.infer<typeof CompetitorGallerySelectionFilterSchema>;

type ScopedAsset = {
  id: number;
  role: string;
  positionIndex: number;
  contentHash?: string | null;
};

export function uniquePositiveGalleryAssetIds(values: number[]) {
  const ids = values.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) throw new Error("请至少选择一张安全保存的竞品图片");
  if (new Set(ids).size !== ids.length) throw new Error("同一分析范围不能重复选择图片");
  return ids;
}

export function defaultGallerySelectionAssetIds(assets: ScopedAsset[]) {
  const included = new Set<string>(COMPETITOR_GALLERY_DEFAULT_ANALYSIS_ROLES);
  return assets.filter((asset) => included.has(asset.role)).map((asset) => asset.id);
}

export function assertGallerySelectionAssets(input: { selectedAssetIds: number[]; assets: ScopedAsset[] }) {
  const selectedAssetIds = uniquePositiveGalleryAssetIds(input.selectedAssetIds);
  const available = new Set(input.assets.map((asset) => asset.id));
  if (selectedAssetIds.some((assetId) => !available.has(assetId))) {
    throw new Error("分析范围包含未确认或不属于当前竞品的图片");
  }
  return selectedAssetIds;
}

export function buildCompetitorGallerySelectionHash(input: {
  subjectId: number;
  confirmedSnapshotId: number;
  selectedAssetIds: number[];
  assets: ScopedAsset[];
  filters: CompetitorGallerySelectionFilter;
}) {
  const selectedAssetIds = assertGallerySelectionAssets({ selectedAssetIds: input.selectedAssetIds, assets: input.assets });
  const selected = new Set(selectedAssetIds);
  const filters = CompetitorGallerySelectionFilterSchema.parse(input.filters);
  const assets = input.assets
    .filter((asset) => selected.has(asset.id))
    .sort((left, right) => left.positionIndex - right.positionIndex || left.id - right.id)
    .map((asset) => ({ id: asset.id, role: asset.role, positionIndex: asset.positionIndex, contentHash: asset.contentHash || "" }));
  return createHash("sha256").update(JSON.stringify({
    subjectId: input.subjectId,
    confirmedSnapshotId: input.confirmedSnapshotId,
    filters,
    assets,
  })).digest("hex");
}

export function summarizeGallerySelectionRoles(assets: ScopedAsset[], selectedAssetIds: number[]) {
  const selected = new Set(uniquePositiveGalleryAssetIds(selectedAssetIds));
  const roleCounts: Record<string, number> = { main: 0, secondary: 0, aplus: 0, brand_story: 0 };
  for (const asset of assets) {
    if (selected.has(asset.id) && asset.role in roleCounts) roleCounts[asset.role] += 1;
  }
  return roleCounts;
}
