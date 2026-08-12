import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Listing Agent 与新皇帝 Skill 完整性", () => {
  it("将最终预览和图片建议映射到 Listing Agent 的 O1/E1 节点", () => {
    const bridge = read("server/domains/listing/listingAgentBridge.ts");
    const generation = read("server/domains/listing/routers/generation.ts");
    const editing = read("server/domains/listing/routers/editing.ts");
    const preview = read("client/src/pages/PreviewPage.tsx");

    expect(bridge).toContain('"E1" | "O1"');
    expect(bridge).toContain("syncListingPreviewWaitingHuman");
    expect(bridge).toContain("syncListingPreviewConfirmed");
    expect(generation).toContain('nodeKey: "imageAdvice"');
    expect(editing).toContain("confirmPreview: protectedProcedure");
    expect(editing).toContain("syncListingPreviewWaitingHuman");
    expect(editing).toContain("syncListingPreviewConfirmed");
    expect(preview).toContain("trpc.listing.confirmPreview.useMutation");
    expect(preview).toContain("confirmPreview.mutate");
  });

  it("为五类 Listing 自检能力显式绑定对应的新皇帝 Skill", () => {
    const evaluation = read("server/domains/listing/routers/evaluation.ts");
    for (const skillSlug of [
      "listing.checklist.bullets",
      "listing.checklist.title",
      "listing.checklist.description",
      "listing.checklist.searchterms",
      "listing.checklist.qa",
    ]) {
      expect(evaluation).toContain(`emperorSkill: { slug: "${skillSlug}" }`);
    }
  });

  it("在人工编辑后重置下游节点，并以数据库皇帝 Prompt 作为运行时唯一来源", () => {
    const bridge = read("server/domains/listing/listingAgentBridge.ts");
    const skillRunner = read("server/domains/ai_os/services/skillRunner.ts");

    expect(bridge).toContain("resetNodeIds: descendantNodeIds(context.dag, input.nodeId)");
    expect(skillRunner).toContain("const systemPrompt = implementation.systemPrompt || input.legacySystemPrompt?.trim() || \"\";");
  });
});
