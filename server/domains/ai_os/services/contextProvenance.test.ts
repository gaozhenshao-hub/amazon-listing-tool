import { describe, expect, it } from "vitest";
import { extractContextProvenanceSources } from "./contextProvenance";

describe("context provenance extraction", () => {
  it("仅从脱敏对话Manifest中稳定提取附件和知识来源", () => {
    const sources = extractContextProvenanceSources({
      context: {
        attachments: [{ attachmentId: "att_2", artifactId: "art_2", mimeType: "application/pdf", contextSummary: "摘要" }],
        knowledgeReferences: [{ referenceId: "knowledge_1", sourceKind: "emperor_memory", title: "受控知识", contextSummary: "摘要" }],
      },
    });
    expect(sources.map((item) => `${item.sourceType}:${item.sourceKey}`)).toEqual(["attachment:att_2", "knowledge:knowledge_1"]);
  });

  it("忽略缺失稳定标识的来源，避免生成不可失效的记录", () => {
    expect(extractContextProvenanceSources({ context: { attachments: [{}], knowledgeReferences: [{}] } })).toEqual([]);
  });
});
