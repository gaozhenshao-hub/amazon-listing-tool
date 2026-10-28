import { z } from "zod";

export const VIDEO_TYPES = ["口播", "故事片", "产品展示（侧重外观）", "产品展示（侧重场景）", "产品展示（侧重安操）"] as const;
export const VIDEO_TYPE_DESCRIPTIONS: Record<typeof VIDEO_TYPES[number], string> = {
  "口播": "以人的讲解或测评串联产品卖点，可穿插特写、操作和场景画面。",
  "故事片": "以人物、情境和情节推进为主，不要求画外音。",
  "产品展示（侧重外观）": "主要展示造型、材质、工艺和结构细节。",
  "产品展示（侧重场景）": "主要展示产品用于什么情境、满足什么需求、产生什么效果。",
  "产品展示（侧重安操）": "安操指安装和操作，主要教人组装、连接、设置、调整和具体使用步骤。",
};
// User-owned vocabulary: do not rename these to a model's preferred synonyms.
export const VIDEO_CONTENT_TAGS = [
  "钩子",
  "开箱清单",
  "尺寸规格",
  "安装上手",
  "核心使用",
  "卖点证明",
  "使用场景",
  "外观展示",
  "细节特写",
  "信任背书",
] as const;
export const VideoSegmentSchema = z
  .object({
    label: z.enum(VIDEO_CONTENT_TAGS),
    start: z.number().finite().min(0),
    end: z.number().finite().positive(),
    description: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(v => v.end > v.start, "结束时间必须晚于开始时间");
export const VideoLabelsSchema = z
  .object({
    type: z.enum(VIDEO_TYPES),
    category: z.string().max(128).default(""),
    style: z.string().max(60).default(""),
    primaryColor: z.string().max(30).default(""),
    accentColor: z.string().max(30).default(""),
    summary: z.string().max(1000),
    segments: z.array(VideoSegmentSchema).max(80),
  })
  .strict();
export type VideoLabels = z.infer<typeof VideoLabelsSchema>;
export type VideoSegment = z.infer<typeof VideoSegmentSchema>;
export function validateVideoLabels(
  value: unknown,
  duration: number
): VideoLabels {
  const labels = VideoLabelsSchema.parse(value);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    labels.segments.some(s => s.end > duration + 0.05)
  )
    throw new Error("标签时间段超出视频时长");
  return {
    ...labels,
    segments: [...labels.segments].sort(
      (a, b) => a.start - b.start || a.end - b.end
    ),
  };
}
export function readVideoLabels(value: unknown): VideoLabels | null {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value && typeof value === "object" ? {...value} : value;
    // Preserve previous results during reclassification. New writes use only the five-type schema.
    if (raw && typeof raw === "object" && "displayTags" in raw) {
      if (raw.type === "解说展示") raw.type = "口播";
      if (raw.type === "产品展示") raw.type = raw.displayTags?.includes("场景展示") ? "产品展示（侧重场景）" : raw.displayTags?.includes("安装使用") ? "产品展示（侧重安操）" : "产品展示（侧重外观）";
      delete raw.displayTags;
    }
    const result = VideoLabelsSchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function videoTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
export const KNOWLEDGE_VIDEO_SKILL = "knowledge.videos.tag";
export const KNOWLEDGE_VIDEO_LIMIT = 100 * 1024 * 1024;
export const KNOWLEDGE_VIDEO_SECONDS = 600;
