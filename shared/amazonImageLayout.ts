import { z } from "zod";

const image = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), alt: z.string().max(600).default("") });
const card = z.object({ images: z.array(image).max(24), title: z.string().max(500).default(""), text: z.string().max(2000).default("") });
export const AmazonImageModuleSchema = z.object({
  id: z.string().max(80), section: z.enum(["aplus", "brand_story"]),
  kind: z.enum(["image", "grid", "carousel", "comparison", "brand_story", "video"]),
  videoHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20).optional(),
  subtype: z.string().max(30).optional(),
  title: z.string().max(500).default(""), background: image.nullable().default(null),
  cards: z.array(card).max(40),
  rows: z.array(z.object({ label: z.string().max(300), cells: z.array(z.string().max(1000)).max(40) })).max(60).default([]),
});
export const AmazonImageLayoutSchema = z.object({ version: z.literal(1), modules: z.array(AmazonImageModuleSchema).max(100) });
export type AmazonImageLayout = z.infer<typeof AmazonImageLayoutSchema>;
export type AmazonImageModule = z.infer<typeof AmazonImageModuleSchema>;
