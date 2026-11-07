import { z } from "zod";

const image = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), alt: z.string().max(600).default("") });
export const AmazonTextBlockSchema=z.object({id:z.string().min(1).max(120),text:z.string().min(1).max(20000),kind:z.enum(['heading','paragraph','list_item','caption','navigation','question','answer','label','link']).default('paragraph'),level:z.number().int().min(1).max(6).optional()});
const card = z.object({ images: z.array(image).max(24), title: z.string().max(500).default(""), text: z.string().max(120000).default(""),
  id:z.string().max(100).optional(),blocks:z.array(AmazonTextBlockSchema).max(600).optional(),subtype:z.string().max(64).optional(),navText:z.string().max(1000).optional(),videoHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20).optional() });
export const AmazonImageModuleSchema = z.object({
  id: z.string().max(80), section: z.enum(["aplus", "brand_story"]),
  kind: z.enum(["image", "grid", "carousel", "comparison", "brand_story", "video", "text", "faq", "specifications", "hotspots", "unknown"]),
  sourceType:z.string().max(100).optional(),sourceClass:z.string().max(500).optional(),
  variant:z.object({imagePosition:z.enum(['left','right']).optional(),theme:z.enum(['light','dark']).optional(),columns:z.number().int().min(1).max(4).optional(),quadrant:z.boolean().optional()}).optional(),
  videoHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20).optional(),
  subtype: z.string().max(64).optional(),
  title: z.string().max(500).default(""), background: image.nullable().default(null),
  cards: z.array(card).max(60),blocks:z.array(AmazonTextBlockSchema).max(600).optional(),
  questions:z.array(z.object({question:AmazonTextBlockSchema,answer:AmazonTextBlockSchema})).max(100).optional(),
  hotspots:z.array(z.object({id:z.string().max(100),x:z.number().min(0).max(1).optional(),y:z.number().min(0).max(1).optional(),blocks:z.array(AmazonTextBlockSchema).max(100)})).max(50).optional(),
  rows: z.array(z.object({ label: z.string().max(20000), cells: z.array(z.string().max(20000)).max(40),labelId:z.string().max(120).optional(),cellIds:z.array(z.string().max(120)).max(40).optional() })).max(200).default([]),
  warnings:z.array(z.string().max(300)).max(30).optional(),
});
export const AmazonImageLayoutSchema = z.object({ version: z.union([z.literal(1),z.literal(2)]), modules: z.array(AmazonImageModuleSchema).max(100),warnings:z.array(z.string().max(300)).max(100).optional() });
export type AmazonImageLayout = z.infer<typeof AmazonImageLayoutSchema>;
export type AmazonImageModule = z.infer<typeof AmazonImageModuleSchema>;
export type AmazonTextBlock = z.infer<typeof AmazonTextBlockSchema>;
