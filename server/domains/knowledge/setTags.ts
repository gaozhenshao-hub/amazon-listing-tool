import { sql } from "drizzle-orm";
import { requireDb } from "../../repositories/dbClient";
import {
  loadAsset,
  assetFingerprint,
  conflict,
  type AssetScope,
} from "./assetTargets";
import { ImageSetTagsCandidateSchema } from "./classifyImageSet";

export const SetTagsSchema = ImageSetTagsCandidateSchema.omit({
  evidence: true,
});
export async function getSetTags(scope: AssetScope, id: number) {
  const asset = await loadAsset(scope, "set", id, { edit: true });
  return { tags: asset.result!, version: assetFingerprint(asset) };
}
export async function saveSetTags(
  scope: AssetScope,
  id: number,
  version: string,
  tags: unknown
) {
  const value = SetTagsSchema.parse(tags);
  return (await requireDb()).transaction(async tx => {
    const asset = await loadAsset(scope, "set", id, {
      edit: true,
      lock: true,
      db: tx,
    });
    if (assetFingerprint(asset) !== version) throw conflict();
    await tx.execute(
      sql`UPDATE kb_image_sets SET setCategory=${value.setCategory},setStyle=${value.setStyle},setPrimaryColor=${value.setPrimaryColor},setAccentColor=${value.setAccentColor} WHERE id=${id} AND workspaceId=${scope.workspaceId}`
    );
    return { saved: true };
  });
}
