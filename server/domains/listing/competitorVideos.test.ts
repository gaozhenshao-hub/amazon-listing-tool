import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  project: vi.fn(),
  record: vi.fn(),
  media: vi.fn(),
  config: vi.fn(),
  submit: vi.fn(),
  poll: vi.fn(),
}));
vi.mock("../../repositories", () => ({
  getProjectById: f.project,
  getPersistedCompetitorAnalysisById: f.record,
}));
vi.mock("../../repositories/dbClient", () => ({ requireDb: vi.fn() }));
vi.mock("../knowledge/videoMedia", () => ({ prepareVideoEvidence: f.media }));
vi.mock("../../infrastructure/localObjectStorage", () => ({
  verifiedLocalObjectPath: vi.fn().mockResolvedValue("/safe/video.mp4"),
}));
vi.mock("../ops/paraformer", () => ({
  paraformerConfig: f.config,
  submitSpeech: f.submit,
  pollSpeech: f.poll,
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: vi.fn(),
  startRegisteredAiJob: vi.fn(),
  getAiJobRun: vi.fn(),
  updateAiJobProgress: vi.fn(),
}));
vi.mock("../ai_os/services/skillRunner", () => ({
  safeParseSkillJSON: JSON.parse,
  runEmperorSkill: vi.fn(),
  getEmperorSkillRuntimeSnapshot: vi.fn(),
}));
import {
  analyzeCompetitorVideo,
  competitorVideoSource,
  validateVideoFinding,
} from "./competitorVideos";
const hash = "a".repeat(64),
  scope = { projectId: 1, analysisId: 1, userId: 2, workspaceId: 1 };
const raw = () => ({
  comparisonAnalysis: {},
  videos: [
    {
      hash,
      role: "main",
      moduleId: null,
      title: "Video",
      position: 0,
      duration: 34,
    },
  ],
  imageAssets: [
    {
      role: "video",
      sourceUrlHash: hash,
      moduleClass: null,
      storageKey: "storage://local/acquisition/1/snapshots/1/video.mp4",
      contentHash: "b".repeat(64),
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  f.project.mockResolvedValue({ workspaceId: 1 });
  f.config.mockResolvedValue({ id: 1 });
  f.media.mockResolvedValue({
    duration: 34,
    audio: Buffer.from("audio"),
    sheets: [],
    interval: 1,
  });
});
it("rejects fabricated speech IDs, missing translations and out-of-range screen text", () => {
  const value = {
    speechTranslations: [],
    screenTexts: [],
    sellingPoints: [],
    notes: "",
  };
  expect(() =>
    validateVideoFinding(JSON.stringify(value), 34, [
      { id: "S0", start: 0, end: 1, text: "Hello" },
    ])
  ).toThrow("不完整");
  expect(() =>
    validateVideoFinding(
      JSON.stringify({
        ...value,
        screenTexts: [
          { start: 33, end: 40, source: "Text", translation: "文字" },
        ],
      }),
      34,
      []
    )
  ).toThrow("时间");
});
it("reuses a source-matched preparation without another speech or model request", async () => {
  const value = raw(),
    source = competitorVideoSource(value, hash);
  Object.assign(value.comparisonAnalysis, {
    videoAnalyses: [
      {
        version: 1,
        hash,
        sourceHash: source.sourceHash,
        generatedAt: "2026-11-01T00:00:00Z",
        status: "complete",
        duration: 34,
        cues: [],
        sellingPoints: [],
        notes: "无讲解",
      },
    ],
  });
  f.record.mockResolvedValue({ projectId: 1, rawData: JSON.stringify(value) });
  const result = await analyzeCompetitorVideo(
    scope,
    hash,
    new AbortController().signal
  );
  expect(result.notes).toBe("无讲解");
  expect(f.media).not.toHaveBeenCalled();
  expect(f.submit).not.toHaveBeenCalled();
});
it("does not resubmit a paid speech task when its acknowledgement was lost", async () => {
  const value = raw(),
    source = competitorVideoSource(value, hash);
  Object.assign(value, {
    videoProcessing: {
      [hash]: { sourceHash: source.sourceHash, speechState: "submitting" },
    },
  });
  f.record.mockResolvedValue({ projectId: 1, rawData: JSON.stringify(value) });
  await expect(
    analyzeCompetitorVideo(scope, hash, new AbortController().signal)
  ).rejects.toThrow("待核对");
  expect(f.submit).not.toHaveBeenCalled();
  expect(f.poll).not.toHaveBeenCalled();
});
it("cannot prepare another project's record", async () => {
  f.record.mockResolvedValue({ projectId: 99, rawData: JSON.stringify(raw()) });
  await expect(
    analyzeCompetitorVideo(scope, hash, new AbortController().signal)
  ).rejects.toThrow("竞品不存在");
  expect(f.media).not.toHaveBeenCalled();
});
