import { TRPCError } from "@trpc/server";
import type { ImageOutline } from "../../../shared/imagePlanning";
import { loadAsset } from "../knowledge/assetTargets";
import type { PlanningScope } from "./imagePlanningStore";
export async function validatePlanningReferences(
  scope: PlanningScope,
  data: ImageOutline,
  baseline?: ImageOutline
) {
  const previous = new Map(baseline?.groups.flatMap(group => group.items).map(item => [item.id, item.references]));
  const pending = data.groups.flatMap(group => group.items).flatMap(item =>
    item.references.filter(reference => !previous.get(item.id)?.some(old => old.setId === reference.setId && old.imageId === reference.imageId))
  );
  const ids = new Set([...data.referenceSets.filter(id => !baseline?.referenceSets.includes(id)), ...pending.map(reference => reference.setId)]);
  const assets = await Promise.all([...ids].map(id => loadAsset(scope, "set", id)));
  if (assets.some(a => a.set?.status !== "confirmed"))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "参考套图尚未采集完成，请完成入库后选择",
    });
  for (const reference of pending)
      if (
        !assets
          .find(a => a.id === reference.setId)
          ?.images.some(i => i.id === reference.imageId)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "参考图片已删除或不属于选中的套图",
        });
}
