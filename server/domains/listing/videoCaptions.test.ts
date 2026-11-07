import { expect, it } from "vitest";
import {
  chineseVideoVtt,
  competitorVideoAnalysisSchema,
  videoSourceFingerprint,
  applyVideoEdits,
} from "../../../shared/competitorVideoAnalysis";
const hash = "a".repeat(64),
  video = {
    version: 1 as const,
    hash,
    sourceHash: "b".repeat(64),
    generatedAt: "2026-11-01T00:00:00Z",
    status: "complete" as const,
    duration: 34,
    notes: "",
    cues: [
      {
        id: "S0",
        kind: "speech" as const,
        start: 0.125,
        end: 2.5,
        source: "Protective suit",
        translation: "防护服",
      },
    ],
    sellingPoints: [
      {
        text: "全身防护",
        moments: [{ start: 2, end: 5, reason: "展示连体结构" }],
      },
    ],
  };
it("creates native timed subtitles without interpreting markup", () => {
  const vtt = chineseVideoVtt([{ ...video.cues[0], translation: "<中文>&" }]);
  expect(vtt).toContain("00:00:00.125 --> 00:00:02.500");
  expect(vtt).toContain("&lt;中文&gt;&amp;");
});
it("rejects captions and evidence beyond the actual duration", () => {
  expect(() =>
    competitorVideoAnalysisSchema.parse({
      ...video,
      cues: [{ ...video.cues[0], end: 35 }],
    })
  ).toThrow("时长");
});
it("binds precomputed findings to the stored source", () => {
  expect(videoSourceFingerprint(hash, "storage://local/a.mp4")).not.toBe(
    videoSourceFingerprint(hash, "storage://local/b.mp4")
  );
});
it("applies source-bound human subtitle and selling-point edits without changing timing", () => {
  const edited = applyVideoEdits(video, {
    ["subtitle:" + hash + ":S0:translation"]: {
      original: "防护服",
      value: "养蜂防护服",
    },
    ["video:" + hash + ":sellingPoints"]: {
      original: "全身防护",
      value: "连体防护",
    },
  })!;
  expect(edited.cues[0]).toMatchObject({
    translation: "养蜂防护服",
    start: 0.125,
    end: 2.5,
  });
  expect(edited.sellingPoints[0].moments).toEqual(
    video.sellingPoints[0].moments
  );
  expect(video.cues[0].translation).toBe("防护服");
});
