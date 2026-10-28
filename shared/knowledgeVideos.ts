import { z } from "zod";

export const AmazonVideoReferenceSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  role: z.enum(["main", "aplus"]),
  position: z.number().int().min(0).max(100),
  moduleId: z.string().max(80).nullable(),
  title: z.string().max(500).default(""),
  duration: z.number().min(0).max(7200).nullable().default(null),
});
export type AmazonVideoReference = z.infer<typeof AmazonVideoReferenceSchema>;
export const StoredKnowledgeVideoSchema = AmazonVideoReferenceSchema.extend({
  videoUrl: z.string().max(2048).nullable(),
  posterUrl: z.string().max(2048).nullable(),
  status: z.enum(["ready", "failed"]),
});
export const StoredKnowledgeVideosSchema = z.array(StoredKnowledgeVideoSchema).max(21);
export type KnowledgeVideo = z.infer<typeof StoredKnowledgeVideoSchema>;
export const videoRoleLabel = (role: KnowledgeVideo["role"]) => role === "main" ? "主图视频" : "A+ 视频";
