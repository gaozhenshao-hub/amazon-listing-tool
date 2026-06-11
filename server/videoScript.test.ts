import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the LLM to avoid real API calls
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          sections: [
            {
              section_code: "S01",
              section_name: "开场展示",
              section_name_en: "Opening",
              shooting_method: "live_action",
              duration_budget: 8,
              sort_order: 1,
            },
          ],
        }),
      },
    }],
  }),
}));

// Mock kbContextEngine to avoid real DB calls in KB injection
vi.mock("./kbContextEngine", () => ({
  getL1Index: vi.fn().mockResolvedValue([]),
  getL2Summary: vi.fn().mockResolvedValue([]),
  formatForPrompt: vi.fn().mockReturnValue(""),
  logKbCallBatch: vi.fn().mockResolvedValue(undefined),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("videoScript router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    const ctx = createAuthContext();
    caller = appRouter.createCaller(ctx);
  });

  describe("CRUD operations", () => {
    it("should create a video script project", async () => {
      const result = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Test Video Script",
        videoType: "main_video",
        targetDuration: 60,
      });

      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
      expect(result.spec).toBeDefined();
    });

    it("should create with style preset", async () => {
      const result = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Styled Script",
        videoType: "ad_spv",
        stylePreset: "tech_dark",
        targetDuration: 30,
      });

      expect(result.id).toBeGreaterThan(0);

      const script = await caller.videoScript.getById({ id: result.id });
      expect(script).toBeDefined();
      expect((script as any).stylePreset).toBe("tech_dark");
    });

    it("should list video scripts by project", async () => {
      await caller.videoScript.create({
        projectId: 998,
        scriptName: "List Test Script",
        videoType: "ad_spv",
        targetDuration: 30,
      });

      const list = await caller.videoScript.list({ projectId: 998 });
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0].scriptName).toBe("List Test Script");
    });

    it("should get a video script by id", async () => {
      const created = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Get By ID Test",
        videoType: "main_video",
        targetDuration: 45,
      });

      const script = await caller.videoScript.getById({ id: created.id });
      expect(script).toBeDefined();
      expect(script!.scriptName).toBe("Get By ID Test");
      expect(script!.currentStage).toBe("stage_0a");
    });

    it("should update a video script", async () => {
      const created = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Update Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      const result = await caller.videoScript.update({
        id: created.id,
        scriptName: "Updated Name",
        videoType: "ad_sbv",
        stylePreset: "lifestyle_warm",
      });

      expect(result.success).toBe(true);

      const updated = await caller.videoScript.getById({ id: created.id });
      expect(updated!.scriptName).toBe("Updated Name");
      expect(updated!.videoType).toBe("ad_sbv");
      expect((updated as any).stylePreset).toBe("lifestyle_warm");
    });

    it("should delete a video script", async () => {
      const created = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Delete Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      const result = await caller.videoScript.delete({ id: created.id });
      expect(result.success).toBe(true);

      const deleted = await caller.videoScript.getById({ id: created.id });
      expect(deleted).toBeNull();
    });
  });

  describe("Stage 0A: Competitor Scripts", () => {
    it("should add a competitor script", async () => {
      const script = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Competitor Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      const result = await caller.videoScript.addCompetitorScript({
        videoScriptId: script.id,
        competitorName: "Competitor A",
        competitorAsin: "B0XXXXXXXX",
        inputType: "excel_upload",
        rawContent: "Scene 1: Product overview\nScene 2: Feature demo",
      });

      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
    });

    it("should list competitor scripts", async () => {
      const script = await caller.videoScript.create({
        projectId: 1,
        scriptName: "List Competitors Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      await caller.videoScript.addCompetitorScript({
        videoScriptId: script.id,
        competitorName: "Comp A",
        inputType: "listing_extract",
        rawContent: "Product features...",
      });

      const competitors = await caller.videoScript.getCompetitorScripts({
        videoScriptId: script.id,
      });

      expect(Array.isArray(competitors)).toBe(true);
      expect(competitors.length).toBeGreaterThanOrEqual(1);
      expect(competitors[0].competitorName).toBe("Comp A");
    });

    it("should delete a competitor script", async () => {
      const script = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Delete Competitor Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      const comp = await caller.videoScript.addCompetitorScript({
        videoScriptId: script.id,
        competitorName: "To Delete",
        inputType: "video_url",
        rawContent: "Some content",
      });

      const result = await caller.videoScript.deleteCompetitorScript({ id: comp.id });
      expect(result.success).toBe(true);
    });
  });

  describe("Stage advancement & confirmation", () => {
    it("should advance from stage_0a to stage_0b", async () => {
      const script = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Advance Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      const result = await caller.videoScript.advanceStage({
        videoScriptId: script.id,
        fromStage: "stage_0a",
        toStage: "stage_0b",
      });

      expect(result.success).toBe(true);

      const updated = await caller.videoScript.getById({ id: script.id });
      expect(updated!.currentStage).toBe("stage_0b");
    });

    it("should advance through multiple stages", async () => {
      const script = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Multi Advance Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      await caller.videoScript.advanceStage({
        videoScriptId: script.id,
        fromStage: "stage_0a",
        toStage: "stage_0b",
      });

      await caller.videoScript.advanceStage({
        videoScriptId: script.id,
        fromStage: "stage_0b",
        toStage: "stage_1",
      });

      const updated = await caller.videoScript.getById({ id: script.id });
      expect(updated!.currentStage).toBe("stage_1");
    });

    it("should confirm a stage", async () => {
      const script = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Confirm Stage Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      const result = await caller.videoScript.confirmStage({
        videoScriptId: script.id,
        stage: "stage_0a",
      });

      expect(result.success).toBe(true);

      const updated = await caller.videoScript.getById({ id: script.id });
      const stageStatus = JSON.parse((updated as any).stageStatus || "{}");
      expect(stageStatus.stage_0a).toBe("confirmed");
    });
  });

  describe("Video type specs & style presets", () => {
    it("should return video type specs", async () => {
      const result = await caller.videoScript.getVideoTypeSpecs();
      expect(result).toBeDefined();
      expect(result.specs).toBeDefined();
      expect(result.presets).toBeDefined();
      expect(result.specs.main_video).toBeDefined();
      expect(result.specs.ad_spv).toBeDefined();
      expect(result.specs.ad_sbv).toBeDefined();
      expect(result.specs.aplus_video).toBeDefined();
    });

    it("should return a specific video type spec", async () => {
      const spec = await caller.videoScript.getVideoTypeSpec({ videoType: "main_video" });
      expect(spec).toBeDefined();
      expect(spec.maxDuration).toBeDefined();
      expect(spec.recommendedDuration).toBeDefined();
    });
  });

  describe("Version management", () => {
    it("should create a version snapshot", async () => {
      const script = await caller.videoScript.create({
        projectId: 1,
        scriptName: "Version Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      const version = await caller.videoScript.createVersion({
        videoScriptId: script.id,
        versionNote: "Initial version",
      });

      expect(version).toBeDefined();
      expect(version.version).toBe(1);
    });

    it("should list versions for a script", async () => {
      const script = await caller.videoScript.create({
        projectId: 1,
        scriptName: "List Versions Test",
        videoType: "main_video",
        targetDuration: 60,
      });

      await caller.videoScript.createVersion({
        videoScriptId: script.id,
        versionNote: "v1",
      });

      await caller.videoScript.createVersion({
        videoScriptId: script.id,
        versionNote: "v2",
      });

      const versions = await caller.videoScript.getVersions({ videoScriptId: script.id });
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThanOrEqual(2);
    });
  });
});
