import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./EmperorHarnessGovernance.tsx", import.meta.url)), "utf8");

describe("Harness受控并行草稿前端契约", () => {
  it("必须先读取资格预览才允许创建并行草稿", () => {
    expect(source).toContain("emperor.skills.previewParallelPlan.useQuery");
    expect(source).toContain("预览并行资格");
    expect(source).toContain("disabled={!parallelPreview.data?.eligible || createParallel.isPending}");
    expect(source).toContain("不可并行，必须保持串行");
  });

  it("批准只走专用人工审批入口并明确不执行", () => {
    expect(source).toContain("emperor.skills.approveParallelPlanDraft.useMutation");
    expect(source).toContain("人工批准草稿（不执行）");
    expect(source).toContain("尚未、也不会自动调度并行分支");
    expect(source).not.toContain("executeParallel");
  });
});
