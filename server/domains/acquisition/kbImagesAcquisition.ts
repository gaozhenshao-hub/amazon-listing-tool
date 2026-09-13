import { z } from "zod";
import type { AmazonAcquisitionCapability } from "../../../shared/acquisition";

export const KB_IMAGE_IMPORT_CAPABILITIES = [
  "catalog_basic",
  "image_gallery",
  "aplus",
  "brand_story",
] as const satisfies readonly AmazonAcquisitionCapability[];

export type KbImagePosition = "main" | "secondary" | "aplus" | "brand_story";

export function kbImagesConsumerRef(asin: string): string {
  return `kb-images:US:${asin.trim().toUpperCase()}`;
}

export function parseAmazonUsAsins(raw: string): string[] {
  const values = raw.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean);
  const asins = values.map(value => {
    if (/^[A-Z0-9]{10}$/i.test(value)) return value.toUpperCase();
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("存在无法识别的亚马逊链接或ASIN");
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "amazon.com" && !hostname.endsWith(".amazon.com")) {
      throw new Error("首期仅支持Amazon美国站链接");
    }
    const match = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (!match?.[1]) throw new Error("无法从链接中提取ASIN");
    return match[1].toUpperCase();
  });
  return [...new Set(asins)];
}

export function capabilitiesForKbPositions(positions: readonly KbImagePosition[]): AmazonAcquisitionCapability[] {
  const capabilities = new Set<AmazonAcquisitionCapability>(["catalog_basic"]);
  if (positions.some(position => position === "main" || position === "secondary")) capabilities.add("image_gallery");
  if (positions.includes("aplus")) capabilities.add("aplus");
  if (positions.includes("brand_story")) capabilities.add("brand_story");
  return [...capabilities];
}

export const KbImageImportAsinSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/);
