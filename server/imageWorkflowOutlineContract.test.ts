import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTLINE_APLUS_MODULE_ID,
  IMAGE_WORKFLOW_SECONDARY_IMAGE_NUMBERS,
  normalizeImageOutline,
} from "@shared/imageWorkflow";
import {
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP2_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP4_REFERENCE_PROMPT,
  STEP5_FINAL_SUGGESTION_PROMPT,
  STEP6_AI_PROMPT_GENERATION,
} from "./imageWorkflowPrompts";
import { repoPath } from "./testPaths";

describe("image workflow outline contract", () => {
  it("normalizes legacy outlines to secondary images 2 through 7", () => {
    const result = normalizeImageOutline({
      secondaryImages: [2, 3, 4, 5, 6].map((imageNumber) => ({ imageNumber, purpose: `image-${imageNumber}` })),
      aPlusModules: [],
    });

    expect(result.secondaryImages.map((image: any) => image.imageNumber)).toEqual(
      IMAGE_WORKFLOW_SECONDARY_IMAGE_NUMBERS,
    );
    expect(result.secondaryImages[5]).toMatchObject({ imageNumber: 7, purpose: "" });
  });

  it("recovers a near-valid five-image AI result without changing normal edit validation", () => {
    const source = {
      secondaryImages: [2, 3, 4, 5, 6].map((imageNumber) => ({
        imageNumber,
        purpose: `image-${imageNumber}`,
        contentBrief: `content-${imageNumber}`,
        expressionType: "直接展示",
        whyThisWay: `reason-${imageNumber}`,
        sellingPointRefs: [`core-${imageNumber}`],
      })),
      aPlusModules: [],
    };

    const recovered = normalizeImageOutline(source, { recoverMissingSecondaryContent: true });
    const normalEdit = normalizeImageOutline(source);

    expect(recovered.secondaryImages[5]).toMatchObject({
      imageNumber: 7,
      contractRecovered: true,
      expressionType: "直接展示",
    });
    expect(recovered.secondaryImages[5].purpose).not.toBe("");
    expect(recovered.secondaryImages[5].contentBrief).not.toBe("");
    expect(normalEdit.secondaryImages[5]).toMatchObject({ imageNumber: 7, purpose: "", contentBrief: "" });
  });

  it("forces every newly generated A+ module to the full-width default", () => {
    const result = normalizeImageOutline({
      secondaryImages: [],
      aPlusModules: [
        { moduleNumber: 1, selectedModuleType: "premium_nav_carousel" },
        { moduleNumber: 2 },
      ],
    }, { forceDefaultAplus: true });

    expect(result.aPlusModules).toHaveLength(2);
    expect(result.aPlusModules.every((module: any) => module.selectedModuleType === DEFAULT_OUTLINE_APLUS_MODULE_ID)).toBe(true);
    expect(result.aPlusModules[0].selectedModuleStructure).toBe("单张全宽大图");
  });

  it("preserves a user-selected module after its dedicated re-optimization", () => {
    const result = normalizeImageOutline({
      secondaryImages: [],
      aPlusModules: [{ moduleNumber: 1, selectedModuleType: "premium_four_image_text" }],
    });

    expect(result.aPlusModules[0]).toMatchObject({
      selectedModuleType: "premium_four_image_text",
      selectedModuleStructure: "4张子图，适合拆分卖点或步骤",
    });
  });

  it("keeps the six-secondary-image requirement in every downstream prompt", () => {
    expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("2、3、4、5、6、7");
    expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("premium_full_image");
    expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("图片大纲可靠性约束 v3");
    expect(STEP2_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("只重新优化这一个模块");
    expect(STEP4_REFERENCE_PROMPT).toContain("辅图2-7");
    expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain("imageNumber依次且仅为2、3、4、5、6、7");
    expect(STEP6_AI_PROMPT_GENERATION).toContain("辅图2-7");
  });

  it("routes Step 2 and A+ re-optimization through explicit Emperor Skills", () => {
    const backend = fs.readFileSync(repoPath("server/domains/image/routers/workflowSteps.ts"), "utf8");
    const worker = fs.readFileSync(repoPath("server/domains/image/services/stepGenerationJob.ts"), "utf8");
    const frontend = fs.readFileSync(repoPath("client/src/pages/imageWorkflow/ImageOutlineStep.tsx"), "utf8");
    const gateway = fs.readFileSync(repoPath("server/services/emperorInvocationGateway.ts"), "utf8");

    expect(backend).toContain("startImageStepGenerationForUser");
    expect(worker).toContain('skillSlug: "image.step2.outline"');
    expect(backend).toContain('skillSlug: "image.step2.aplus.single.optimize"');
    expect(frontend).toContain("optimizeStep2AplusModule");
    expect(frontend).toContain("皇帝 Skill 正在按新模块结构重新优化");
    expect(gateway).toContain('callerFile.includes("/domains/image/")');
  });

  it("ships the Emperor database migration and its prompt contracts", () => {
    const migration = fs.readFileSync(repoPath("drizzle/0120_image_workflow_outline_contract.sql"), "utf8");
    const reliabilityMigration = fs.readFileSync(repoPath("drizzle/0122_image_outline_reliability.sql"), "utf8");
    const migrationRunner = fs.readFileSync(repoPath("scripts/run-database-migrations.mjs"), "utf8");
    expect(migration).toContain("image.step2.outline");
    expect(migration).toContain("image.step2.aplus.single.optimize");
    expect(migration).toContain("image.step5.final.suggestion");
    expect(migration).toContain("JSON_ARRAY(2,3,4,5,6,7)");
    expect(migration).toContain("premium_full_image");
    expect(reliabilityMigration).toContain("图片大纲可靠性约束 v3");
    expect(reliabilityMigration).toContain("image.step2.outline");
    expect(migrationRunner).toContain("0122_image_outline_reliability.sql");
  });
});
