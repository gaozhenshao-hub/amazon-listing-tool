import { z } from "zod";
import { acquisitionReviewHash } from "./acquisitionReview";
import type { DocumentEntry, ImageDocument } from "./imageDocument";

export function imageCopyForProduction(copy: DocumentEntry["copy"]) {
  const { headlineZh, subtitleZh, bodyZh, icons, ...target } = copy;
  return { ...target, icons: icons.map(({ labelZh, ...icon }) => icon) };
}

export function imagePromptSourceHash(
  entry: DocumentEntry,
  document: Pick<ImageDocument, "category" | "styles" | "palette">
) {
  const {
    title,
    content,
    width,
    height,
    layout,
    layoutNote,
    references,
    scenes,
    copy,
  } = entry;
  return acquisitionReviewHash(
    JSON.parse(
      JSON.stringify({
        title,
        content,
        width,
        height,
        layout,
        layoutNote,
        references,
        scenes,
        copy: imageCopyForProduction(copy),
        category: document.category,
        styles: document.styles,
        palette: document.palette,
      })
    )
  );
}
export function productionPromptsReady(
  entry: DocumentEntry,
  document: Pick<ImageDocument, "category" | "styles" | "palette">
) {
  return (
    ["composition", "scene", "product", "interaction", "textIcons"].every(key =>
      entry.prompts[key as keyof typeof entry.prompts]?.trim()
    ) && entry.promptSourceHash === imagePromptSourceHash(entry, document)
  );
}

export const IMAGE_PRODUCTION_STAGES = [
  {
    key: "composition",
    label: "生成构图",
    skill: "listing.images.production.composition.v1",
    name: "图片结构图制作",
  },
  {
    key: "scene",
    label: "场景及背景生成",
    skill: "listing.images.production.scene.v1",
    name: "图片场景背景制作",
  },
  {
    key: "product",
    label: "产品嵌入",
    skill: "listing.images.production.product.v1",
    name: "本品嵌入与交互融合",
  },
  {
    key: "textIcons",
    label: "文字和图标",
    skill: "listing.images.production.text.v1",
    name: "图片文字图标制作",
  },
] as const;
export const productionStageSchema = z.enum([
  "composition",
  "scene",
  "product",
  "textIcons",
]);
export type ProductionStage = z.infer<typeof productionStageSchema>;
export const productionStepSchema = z.object({
  conversationId: z.string().uuid(),
  inputHash: z.string(),
  prompt: z.string().max(8000),
  references: z.array(z.string().uuid()).max(16),
  acceptedAssetId: z.string().uuid().optional(),
  acceptedGenerationId: z.string().uuid().optional(),
  skillVersion: z.number(),
  skillHash: z.string(),
});
export const productionStateSchema = z.object({
  productAssets: z.array(z.string().uuid()).max(14).default([]),
  compositionAssets: z.array(z.string().uuid()).max(4).default([]),
  stages: z
    .object({
      composition: productionStepSchema.optional(),
      scene: productionStepSchema.optional(),
      product: productionStepSchema.optional(),
      textIcons: productionStepSchema.optional(),
    })
    .default({}),
  archives: z
    .array(productionStepSchema.extend({ stage: productionStageSchema }))
    .max(600)
    .default([]),
});
export type ProductionState = z.infer<typeof productionStateSchema>;
export const emptyProductionState = (): ProductionState =>
  productionStateSchema.parse({});

export function productionInputHash(
  entry: DocumentEntry,
  state: ProductionState,
  stage: ProductionStage,
  fallbackProducts: unknown[] = []
) {
  const index = IMAGE_PRODUCTION_STAGES.findIndex(s => s.key === stage);
  const previous =
    index > 0 ? state.stages[IMAGE_PRODUCTION_STAGES[index - 1].key] : null;
  return acquisitionReviewHash(
    JSON.parse(
      JSON.stringify({
        stage,
        promptSourceHash: entry.promptSourceHash,
        width: entry.width,
        height: entry.height,
        title: entry.title,
        content: entry.content,
        layout: entry.layout,
        layoutNote: entry.layoutNote,
        scenes: entry.scenes,
        copy: imageCopyForProduction(entry.copy),
        prompt: entry.prompts[stage],
        interaction:
          stage === "product" ? entry.prompts.interaction || "" : undefined,
        references:
          stage === "composition"
            ? entry.references.composition
            : stage === "scene"
              ? entry.references.effect
              : [],
        uploads:
          stage === "composition"
            ? state.compositionAssets
            : stage === "product"
              ? state.productAssets
              : [],
        fallbackProducts:
          stage === "product" && !state.productAssets.length
            ? fallbackProducts
            : [],
        previous: previous?.acceptedAssetId || null,
      })
    )
  );
}

/** A changed ancestor invalidates its dependants without deleting their history. */
export function productionStageCurrent(
  entry: DocumentEntry,
  state: ProductionState,
  stage: ProductionStage,
  fallbackProducts: unknown[] = []
): boolean {
  const index = IMAGE_PRODUCTION_STAGES.findIndex(s => s.key === stage);
  if (
    index > 0 &&
    !productionStageCurrent(
      entry,
      state,
      IMAGE_PRODUCTION_STAGES[index - 1].key,
      fallbackProducts
    )
  )
    return false;
  const step = state.stages[stage];
  return (
    !!step?.acceptedAssetId &&
    step.inputHash ===
      productionInputHash(entry, state, stage, fallbackProducts)
  );
}

export function productionPrompt(entry: DocumentEntry, stage: ProductionStage) {
  return [
    entry.prompts[stage],
    stage === "product" ? entry.prompts.interaction : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
