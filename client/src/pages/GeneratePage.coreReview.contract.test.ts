import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const page = readFileSync(fileURLToPath(new URL("./GeneratePage.tsx", import.meta.url)), "utf8");
const hook = readFileSync(fileURLToPath(new URL("./listing/useListingGenerationJob.tsx", import.meta.url)), "utf8");
const worker = readFileSync(fileURLToPath(new URL("../../../server/domains/listing/services/generationJob.ts", import.meta.url)), "utf8");

describe("Listing human-approved fact/core UI contract", () => {
  it("lists source fact revisions and requires operator evidence selection before confirming a core", () => {
    expect(page).toContain("listReviewedFacts.useQuery");
    expect(page).toContain("reviewCoreMutation.mutateAsync");
    expect(page).toContain("请先在上方确认原始属性表中的本品事实，再勾选至少一条支持该卖点的证据");
    expect(page).toContain("选择本条卖点的已确认事实（必选）");
  });
  it("queues single-bullet AI and optimization with the server core id/hash, not a local boolean", () => {
    expect(page).toContain("coreRevisionId: approvedCore.id");
    expect(page).toContain("coreInputHash: approvedCore.inputHash");
    expect(page).toContain("const approvedCore = confirmedCores[idx] ? coreBinding(idx) : null");
    expect(worker).toContain("await resolveConfirmedListingCore({ projectId: input.projectId, workspaceId: job.workspaceId");
  });
  it("drops other-project async G1 output and clears selections when the current project changes", () => {
    expect(hook).toContain("fetchedRun?.projectId === input.projectId ? fetchedRun : null");
    expect(page).toContain("setCoreFactSelection({});");
    expect(page).toContain("lastCoreProjectRef.current = selectedProjectId;");
    expect(page).toContain("setGeneratedBullets({});");
  });
  it("manual core removal marks shifted bullets stale instead of transferring confirmation across indexes", () => {
    expect(page).toContain("{ ...val, staleSource: true }");
    expect(page).toContain("newConfirmed[k - 1] = false");
  });
  it("never expands keywords or queues a model through the old locked-mode FABE path", () => {
    const lockedHandler = page.split("const handleLockedAiGenerate = () => {")[1]?.split("\n  };")[0];
    expect(lockedHandler).toContain("已停用");
    expect(lockedHandler).not.toMatch(/expandKeyword|startListingJob|mutateAsync/);
  });
});
