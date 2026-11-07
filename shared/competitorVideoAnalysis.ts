import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
export const videoSourceFingerprint = (
  hash: string,
  storageKey: string,
  contentHash?: string | null
) => SHA256(JSON.stringify([hash, storageKey, contentHash || null])).toString();
export const videoMomentSchema = z
  .object({
    start: z.number().nonnegative().max(7200),
    end: z.number().positive().max(7200),
    reason: z.string().min(1).max(2000),
  })
  .refine(v => v.end > v.start, "视频片段结束时间必须晚于开始时间");
export const videoSubtitleSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(["speech", "screen"]),
    start: z.number().nonnegative().max(7200),
    end: z.number().positive().max(7200),
    source: z.string().min(1).max(6000),
    translation: z.string().min(1).max(8000),
  })
  .refine(v => v.end > v.start, "字幕结束时间必须晚于开始时间");
export const competitorVideoAnalysisSchema = z
  .object({
    version: z.literal(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: z.string(),
    status: z.literal("complete"),
    duration: z.number().positive().max(7200),
    cues: z.array(videoSubtitleSchema).max(5000),
    notes: z.string().max(4000),
    sellingPoints: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(200),
          moments: z.array(videoMomentSchema).min(1).max(30),
        })
      )
      .max(12),
  })
  .superRefine((v, c) => {
    if (new Set(v.cues.map(s => s.id)).size !== v.cues.length)
      c.addIssue({ code: "custom", message: "字幕标识重复" });
    if (
      [...v.cues, ...v.sellingPoints.flatMap(p => p.moments)].some(
        s => s.end > v.duration + 0.1
      )
    )
      c.addIssue({ code: "custom", message: "字幕或卖点证据超出视频时长" });
  });
export type CompetitorVideoAnalysis = z.infer<
  typeof competitorVideoAnalysisSchema
>;
const timestamp = (seconds: number) => {
  const ms = Math.max(0, Math.round(seconds * 1000)),
    pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    pad(Math.floor(ms / 3600000)) +
    ":" +
    pad(Math.floor(ms / 60000) % 60) +
    ":" +
    pad(Math.floor(ms / 1000) % 60) +
    "." +
    pad(ms % 1000, 3)
  );
};
export function chineseVideoVtt(cues: CompetitorVideoAnalysis["cues"]) {
  return (
    "WEBVTT\n\n" +
    [...cues]
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map(
        (cue, i) =>
          String(i + 1) +
          "\n" +
          timestamp(cue.start) +
          " --> " +
          timestamp(cue.end) +
          "\n" +
          cue.translation
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n{2,}/g, "\n") +
          "\n"
      )
      .join("\n")
  );
}
export function applyVideoEdits(
  video: CompetitorVideoAnalysis | undefined,
  edits: Record<string, { original: string; value: string }> = {}
) {
  if (!video) return undefined;
  const pointKey = "video:" + video.hash + ":sellingPoints",
    edit = edits[pointKey],
    original = video.sellingPoints.map(p => p.text).join("、");
  const sellingPoints =
    edit?.original === original
      ? edit.value
          .split(/[、，,\n]+/)
          .map(v => v.trim())
          .filter(Boolean)
          .map((text, i) => ({
            text,
            moments: video.sellingPoints.find(p => p.text === text)?.moments ||
              video.sellingPoints[i]?.moments || [
                {
                  start: 0,
                  end: video.duration,
                  reason: "用户调整后的卖点，请结合原片核对",
                },
              ],
          }))
      : video.sellingPoints;
  return {
    ...video,
    sellingPoints,
    cues: video.cues.map(c => {
      const value =
        edits["subtitle:" + video.hash + ":" + c.id + ":translation"];
      return value?.original === c.translation
        ? { ...c, translation: value.value }
        : c;
    }),
  };
}
