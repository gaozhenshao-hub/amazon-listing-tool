/** Explicit image-only narrowing of the shared, pinned business mechanics. */
import { ConfiguredBusinessSavedConfigurationSchema, ConfiguredBusinessRuntimeSnapshotSchema,
  ConfiguredBusinessDispatchReceiptSchema } from "../../ai_os/services/configuredBusinessRuntimeContract";
import { z } from "zod";
export const ImagePlanningSavedConfigurationSchema = ConfiguredBusinessSavedConfigurationSchema.refine(value => value.agentKey === "images");
export const ImagePlanningRuntimeSnapshotSchema = ConfiguredBusinessRuntimeSnapshotSchema.refine(value => value.stage === "image_outline" && value.configuration.agentKey === "images");
export const ImagePlanningDispatchReceiptSchema = ConfiguredBusinessDispatchReceiptSchema.refine(value => value.stage === "image_outline");
export type ImagePlanningSavedConfiguration = z.infer<typeof ImagePlanningSavedConfigurationSchema>;
export type ImagePlanningRuntimeSnapshot = z.infer<typeof ImagePlanningRuntimeSnapshotSchema>;
export type ImagePlanningDispatchReceipt = z.infer<typeof ImagePlanningDispatchReceiptSchema>;
