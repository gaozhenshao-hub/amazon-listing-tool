import { loadAsset } from "../knowledge/assetTargets";
import { documentActor } from "./imageDocumentMaterials";
import { assertResourceAction } from "../../services/securityGovernance";
import { taggingUnitPreview } from "../knowledge/taggingUnitPreview";
import type { PlanningScope } from "./imagePlanningStore";
import type { MessageContent } from "../../_core/llm";
export async function selectedPlanningReferences(
  scope: PlanningScope,
  ids: number[]
) {
  const sets: Array<Record<string, unknown>> = [],
    attachments: MessageContent[] = [],
    attachedImages: Array<{
      setId: number;
      imageId: number;
      attachmentIndex: number;
    }> = [];
  if (!ids.length) return { sets, attachments, attachedImages };
  try {
    await assertResourceAction({
      actor: await documentActor(scope),
      resource: "knowledge",
      workspaceId: scope.workspaceId,
      action: "read",
    });
  } catch {
    return {
      sets: [{ note: "当前账号无法读取知识库参考套图" }],
      attachments,
      attachedImages,
    };
  }
  for (const id of ids)
    try {
      const asset = await loadAsset(scope, "set", id),
        images = asset.images
          .filter(i => i.imagePosition !== "brand_story")
          .slice(0, 6);
      sets.push({
        setId: id,
        asin: asset.set?.asin,
        title: asset.title,
        tags: asset.result,
        images: images.map(i => ({
          imageId: i.id,
          role: i.imagePosition,
          composition: i.tagComposition,
          belong: i.tagImageBelongSub,
        })),
      });
      for (const image of images.slice(0, 2))
        try {
          const bytes = await taggingUnitPreview({
            primary: image,
            images: [image],
            complete: true,
          });
          attachedImages.push({
            setId: id,
            imageId: image.id,
            attachmentIndex: attachments.length,
          });
          attachments.push({
            type: "image_url",
            image_url: {
              url: "data:image/jpeg;base64," + bytes.toString("base64"),
            },
          });
        } catch {
          /* Text metadata still identifies the operator-selected source. */
        }
    } catch {
      sets.push({ setId: id, note: "参考套图已选，原件暂不可读取" });
    }
  return { sets, attachments, attachedImages };
}
