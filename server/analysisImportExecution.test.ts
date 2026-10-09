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
import { executeReviewImport, executeSellerSpriteImport } from "./services/analysisImportExecution";
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
