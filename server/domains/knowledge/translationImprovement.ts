import { skillWorkbench } from "../ai_os/services/skillWorkbench";
import { MEDIA_TRANSLATION_SKILL } from "./richContentTranslation";
import { loadAsset, type AssetScope, type LoadedAsset } from "./assetTargets";
import {
  imageTranslationsForEditing,
  contentTranslationsForEditing,
} from "../../../shared/knowledgeTranslationEdits";
import { RichContentPresentationSchema } from "../../../shared/richContentPresentation";

/** Improvement is a private workbench draft, never an automatic prompt/skill update. */
export async function createTranslationImprovement(
  scope: AssetScope,
  asset: LoadedAsset,
  feedback: string,
  edited?: Record<string, unknown>
) {
  const images = imageTranslationsForEditing(asset.unit?.images || []),
    presentation = RichContentPresentationSchema.safeParse(
      asset.set?.contentPresentation
    );
  const original = {
    images: images.map(i => ({
      ...i,
      translation: {
        ...i.translation,
        regions: i.translation.originalRegions || i.translation.regions,
      },
    })),
    texts: presentation.success
      ? presentation.data.texts.map(t => ({
          id: t.id,
          source: t.source,
          translation: t.originalTranslation || t.translation,
        }))
      : [],
  };
  const current = edited || {
    imageTranslations: images,
    contentTranslations: contentTranslationsForEditing(
      asset.set?.contentPresentation
    ),
  };
  const actor = {
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    admin: ["admin", "super_admin"].includes(scope.role || ""),
    superAdmin: scope.role === "super_admin",
  };
  const draft = await skillWorkbench.create(actor, MEDIA_TRANSLATION_SKILL);
  const context = JSON.stringify({
    businessModule: "knowledge",
    sourceResultId: String(asset.id),
    kind: asset.kind,
    input: {
      title: asset.title,
      images: (asset.unit?.images || []).map(i => ({
        imageId: i.id,
        sourceHash: i.sourceUrlHash,
        storageKey: i.imageUrl,
      })),
      texts: original.texts.map(t => ({ id: t.id, source: t.source })),
    },
    originalResult: original,
    editedResult: current,
    feedback,
    scope: "current_result",
  });
  const saved = await skillWorkbench.save(
    actor,
    draft.id,
    draft.revision,
    draft.content,
    { context, productId: null }
  );
  return saved.id;
}
export async function improveKnowledgeTranslation(
  scope: AssetScope,
  kind: "image" | "set",
  id: number,
  feedback: string
) {
  const asset = await loadAsset(scope, kind, id, { edit: true });
  return { id: await createTranslationImprovement(scope, asset, feedback) };
}
