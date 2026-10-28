import { parseKnowledgeAsins } from "../../../shared/knowledgeCollection";
import { z } from "zod";
import type { AmazonAcquisitionCapability } from "../../../shared/acquisition";

export const KB_IMAGE_IMPORT_CAPABILITIES = [
  "catalog_basic",
  "image_gallery",
  "aplus",
  "brand_story",
] as const satisfies readonly AmazonAcquisitionCapability[];

/**
 * Default ASIN/link/batch import requests all currently qualified image
 * capabilities. The Provider Profile remains the runtime authority and rejects
 * a request if a later capability is not actively qualified.
 */
export type KbImageAcquisitionCapability = AmazonAcquisitionCapability;

export type KbImagePosition = "main" | "secondary" | "aplus" | "brand_story";

export function kbImagesConsumerRef(asin: string): string {
  return `kb-images:US:${asin.trim().toUpperCase()}`;
}

export function parseAmazonUsAsins(raw: string): string[] {
  const result = parseKnowledgeAsins(raw);
  if (result.invalid.length) throw new Error("存在无法识别的美国站链接或 ASIN，请检查后重试");
  return result.asins;
}

export function capabilitiesForKbPositions(positions: readonly KbImagePosition[]): AmazonAcquisitionCapability[] {
  const capabilities = new Set<AmazonAcquisitionCapability>(["catalog_basic"]);
  if (positions.some(position => position === "main" || position === "secondary")) capabilities.add("image_gallery");
  if (positions.includes("aplus")) capabilities.add("aplus");
  if (positions.includes("brand_story")) capabilities.add("brand_story");
  return [...capabilities];
}

export const KbImageImportAsinSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/);
