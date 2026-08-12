import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("Step4 参考图与方案版本保留", () => {
  const references = fs.readFileSync(path.join(root, "server/domains/image/routers/references.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "client/src/pages/imageWorkflow/ReferenceImagesStep.tsx"), "utf8");

  it("提供非破坏性解锁和草稿保存接口", () => {
    expect(references).toContain("saveStep4Draft: protectedProcedure");
    expect(references).toContain("unlockStep4ForEditing: protectedProcedure");
    expect(references).toContain("mergeStep4DraftVersions(session.step4UserEdit, session.step4AiResult)");
    expect(references).toContain("step4Confirmed: 0");
  });

  it("单图重新优化会保存完整合并结果，而非只返回内存对象", () => {
    expect(references).toContain("const updatedResult = { ...(currentStep4 || {}), imageReferences: updatedRefs };");
    expect(references).toContain("step4UserEdit: JSON.stringify(updatedResult)");
    expect(references).toContain("compositionRefImageUrl: existingRef?.compositionRefImageUrl");
    expect(references).toContain("kbReferenceImages: existingRef?.kbReferenceImages");
  });

  it("前台解锁、上传、选图和优化后都会保存草稿", () => {
    expect(page).toContain("trpc.imageWorkflow.unlockStep4ForEditing.useMutation()");
    expect(page).toContain("trpc.imageWorkflow.saveStep4Draft.useMutation()");
    expect(page).toContain("已解锁，已保留当前方案与参考图");
    expect(page.match(/await persistStep4Draft\(/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
