import type { DocumentEntry } from "../../../shared/imageDocument";
import { normalizedImageLayout } from "../../../shared/imageDocument";
import { listAllImages } from "../../kbDb";
import { assertResourceAction } from "../../services/securityGovernance";
import {
  documentActor,
  resolveDocumentMaterials,
} from "./imageDocumentMaterials";
import type { PlanningScope } from "./imagePlanningStore";
export async function selectCompositionReference(
  scope: PlanningScope,
  entry: DocumentEntry,
  referenceSetIds: number[],
  category: string
) {
  if (
    entry.references.composition.length &&
    entry.manualFields?.includes("references.composition")
  )
    return;
  const layout = normalizedImageLayout(entry.layout);
  if (!layout) return;
  try {
    await assertResourceAction({
      actor: await documentActor(scope),
      resource: "knowledge",
      workspaceId: scope.workspaceId,
      action: "read",
    });
    const images = await listAllImages(scope.userId, scope.workspaceId, "all", {
      tagComposition: layout,
      page: 1,
    });
    const ranked = images.sort(
      (a, b) =>
        Number(referenceSetIds.includes(b.imageSetId || 0)) -
          Number(referenceSetIds.includes(a.imageSetId || 0)) ||
        Number(b.tagCategory === category) - Number(a.tagCategory === category)
    );
    for (const image of ranked.slice(0, 12))
      try {
        const reference =
          image.imageSetId && referenceSetIds.includes(image.imageSetId)
            ? {
                source: "reference" as const,
                imageId: image.id,
                setId: image.imageSetId,
                label: `${image.asin || image.productTitle || "知识库"} · ${layout}`,
              }
            : {
                source: "knowledge" as const,
                imageId: image.id,
                ...(image.imageSetId ? { setId: image.imageSetId } : {}),
                label: `${image.asin || image.productTitle || "知识库"} · ${layout}`,
              };
        const materials = await resolveDocumentMaterials(scope, [reference], {
          strict: true,
          referenceSetIds,
        });
        if (materials[0]?.imageUrl) {
          entry.references.composition = [
            {
              reference,
              purpose:
                `参考${layout}的主辅区域分配与信息层级。${entry.layoutNote}`.slice(
                  0,
                  1000
                ),
            },
          ];
          return;
        }
      } catch {
        /* Try the next currently accessible complete image unit. */
      }
  } catch {
    /* No readable layout match; an Image 2.5 sketch can supply the layout. */
  }
  if (!entry.manualFields?.includes("references.composition"))
    entry.references.composition = [];
}
