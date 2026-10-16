import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ skill: vi.fn(), existing: [] as any[], save: vi.fn(), history: vi.fn(), parseProducts: vi.fn() }));
vi.mock("./repositories", () => ({
  getProjectById: vi.fn(async () => ({ id: 9, workspaceId: 2 })),
  getCompetitorAnalysesByProject: vi.fn(async () => mocks.existing),
  upsertCompetitorAnalysis: mocks.save, updateCompetitorAnalysisReviews: mocks.save,
  createReviewImport: mocks.history,
}));
vi.mock("./domains/ai_os/services/skillRunner", () => ({ runEmperorSkill: mocks.skill, safeParseSkillJSON: JSON.parse }));
vi.mock("./domains/ai_os/services/businessArtifactRegistry", () => ({ registerCompetitorAnalysisArtifact: vi.fn(async () => null) }));
vi.mock("./domains/listing/competitorHumanReview", () => ({ formatCompetitorAnalysisSummary: vi.fn(() => "summary") }));
vi.mock("./routers/sellerSpriteImporter", () => ({ parseSellerSpriteData: mocks.parseProducts }));
import { executeReviewImport, executeSellerSpriteImport, runAnalysisSkill } from "./services/analysisImportExecution";
const input = { projectId: 9, filename: "reviews.csv", fileBase64: Buffer.from("ASIN,Content\nB000000001,Good product\nB000000002,Works well").toString("base64") };
beforeEach(() => {
  vi.clearAllMocks(); mocks.existing = [];
  mocks.skill.mockResolvedValue({ parsed: { keywords: ["product"] } });
  mocks.save.mockResolvedValue({ id: 5 }); mocks.history.mockResolvedValue({ id: 6 });
  mocks.parseProducts.mockReturnValue({ success: true, products: [{ asin: "B000000001", title: "First" }, { asin: "B000000002", title: "Second" }], warnings: [] });
});
describe("import execution checkpoints", () => {
  it("skips completed reviews and forwards the worker cancellation signal", async () => {
    const sourceHash = createHash("sha256").update(Buffer.from(input.fileBase64, "base64")).digest("hex");
    mocks.existing = [{ id: 1, asin: "B000000001", reviewAnalysis: "{}", rawData: JSON.stringify({ reviewImport: { sourceHash } }) }];
    const signal = new AbortController().signal;
    const onProgress = vi.fn();
    const result = await executeReviewImport(input, 7, { signal, completedResults: [{ asin: "B000000001", status: "matched", analysisId: 1, reviewCount: 1 }], onProgress });
    expect(result.results).toHaveLength(2);
    expect(mocks.skill).toHaveBeenCalledTimes(2);
    expect(mocks.skill.mock.calls.every(([call]) => call.signal === signal && call.context.includes("B000000002"))).toBe(true);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
  it("skips successful SellerSprite rows during an explicit partial retry", async () => {
    const sourceHash = createHash("sha256").update(Buffer.from(input.fileBase64, "base64")).digest("hex");
    mocks.existing = [{ id: 1, asin: "B000000001", rawData: JSON.stringify({ sellerSpriteSourceHash: sourceHash }) }];
    const result = await executeSellerSpriteImport(input, 7, { completedResults: [{ asin: "B000000001", status: "success", analysisId: 1 }] });
    expect(result.succeeded).toBe(2);
    expect(mocks.skill).toHaveBeenCalledTimes(1);
    expect(mocks.skill.mock.calls[0][0].context).toContain("B000000002");
  });
  it("recognizes a saved review if a process died before updating job progress", async () => {
    const sourceHash = createHash("sha256").update(Buffer.from(input.fileBase64, "base64")).digest("hex");
    mocks.existing = ["B000000001", "B000000002"].map((asin, id) => ({ asin, id, reviewAnalysis: "{}", rawData: JSON.stringify({ reviewImport: { sourceHash } }) }));
    const result = await executeReviewImport(input, 7);
    expect(result.results.every(row => row.status === "matched")).toBe(true);
    expect(mocks.skill).not.toHaveBeenCalled();
  });
  it("stops before writing model output if canceled during execution", async () => {
    const controller = new AbortController();
    mocks.skill.mockImplementation(async () => { controller.abort(new Error("stop")); return { parsed: {} }; });
    await expect(executeSellerSpriteImport(input, 7, { signal: controller.signal })).rejects.toThrow("stop");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("new review upload requires its own non-empty analysis", () => {
  const single = { ...input, fileBase64: Buffer.from("ASIN,Content\nB000000001,Good product").toString("base64") };
  const previous = () => ({ id: 11, asin: "B000000001", reviewAnalysis: '{"painPoints":["Old analysis"]}',
    rawData: JSON.stringify({ reviewImport: { sourceHash: "old-upload" }, untouched: true }) });

  it.each([null, undefined, false, true, 0, 1, "", "text", [], ["review"], {}])(
    "fails the ASIN on invalid new result %j without relabeling or writing the old pair", async parsed => {
      mocks.existing = [previous()]; const before = structuredClone(mocks.existing);
      mocks.skill.mockResolvedValue({ parsed }); const progress = vi.fn();
      const result = await executeReviewImport(single, 7, { onProgress: progress });
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({ asin: "B000000001", status: "failed", failure: { code: "AI_OUTPUT_INVALID" } });
      expect(mocks.existing).toEqual(before); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
      expect(mocks.skill).toHaveBeenCalledOnce(); expect(progress).toHaveBeenCalledOnce();
    },
  );

  it.each([new Date(), new Map([["result", "value"]]), Object.create({ inherited: true })])(
    "does not accept a non-plain object or inherited-only result %#", async parsed => {
      mocks.existing = [previous()]; mocks.skill.mockResolvedValue({ parsed });
      const result = await executeReviewImport(single, 7);
      expect(result.results[0].status).toBe("failed"); expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it("does not invoke a getter to manufacture a result key", async () => {
    const getter = vi.fn(() => ["untrusted"]);
    mocks.skill.mockResolvedValue({ parsed: Object.defineProperty({}, "painPoints", { enumerable: true, get: getter }) });
    const result = await executeReviewImport(single, 7);
    expect(result.results[0].status).toBe("failed"); expect(getter).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects invalid review output before starting the new-competitor model or insert", async () => {
    mocks.skill.mockResolvedValue({ parsed: null });
    const result = await executeReviewImport(single, 7);
    expect(result.results[0].status).toBe("failed");
    expect(mocks.skill).toHaveBeenCalledOnce(); expect(mocks.skill.mock.calls[0][0].skillSlug).toBe("analysis.review.extract");
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
  });

  it.each([{ painPoints: [] }, { count: 0 }, { enabled: false }])("keeps valid object values %j without requiring truthy content", async parsed => {
    mocks.existing = [previous()]; mocks.skill.mockResolvedValue({ parsed });
    const result = await executeReviewImport(single, 7);
    expect(result.results[0].status).toBe("matched");
    expect(mocks.save).toHaveBeenCalledOnce();
    const [id, saved] = mocks.save.mock.calls[0];
    expect(id).toBe(11); expect(saved.reviewAnalysis).toBe(JSON.stringify(parsed));
    expect(JSON.parse(saved.rawData).reviewImport.sourceHash).toBe(createHash("sha256").update(Buffer.from(single.fileBase64, "base64")).digest("hex"));
    expect(mocks.history).toHaveBeenCalledOnce();
  });

  it("allows the next ASIN to succeed without retrying the failed ASIN", async () => {
    mocks.existing = [previous(), { ...previous(), id: 12, asin: "B000000002" }];
    mocks.skill.mockResolvedValueOnce({ parsed: null }).mockResolvedValueOnce({ parsed: { painPoints: ["new"] } });
    const result = await executeReviewImport(input, 7);
    expect(result.results.map(row => [row.asin, row.status])).toEqual([["B000000001", "failed"], ["B000000002", "matched"]]);
    expect(mocks.skill).toHaveBeenCalledTimes(2); expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0]).toBe(12); expect(mocks.history).toHaveBeenCalledOnce();
  });

  it("does not broaden validation for the other analysis Skills", async () => {
    mocks.skill.mockImplementation(async call => ({ parsed: call.validate("null") }));
    await expect(runAnalysisSkill({ skillSlug: "listing.competitor.analyze", userId: 7, context: "synthetic", legacySystemPrompt: "synthetic" })).resolves.toBeNull();
    await expect(runAnalysisSkill({ skillSlug: "analysis.competitor.multi", userId: 7, context: "synthetic", legacySystemPrompt: "synthetic" })).resolves.toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
