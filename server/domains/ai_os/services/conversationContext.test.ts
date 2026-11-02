import { describe, expect, it } from "vitest";
import { compileConversationContext } from "./conversationContext";

describe("对话上下文编译器", () => {
  it("仅汇编受控附件/知识摘要并按稳定标识排序", () => {
    const result = compileConversationContext({
      goal: "规划库存风险分析",
      attachments: [
        { attachmentId: "att_b", artifactId: "artifact_b", fileName: "b.csv", mimeType: "text/csv", contextPolicy: "extracted_text", contextSummary: "B摘要" },
        { attachmentId: "att_a", artifactId: "artifact_a", fileName: "a.png", mimeType: "image/png", contextPolicy: "image_vision", contextSummary: "A摘要" },
      ],
      knowledgeReferences: [
        { referenceId: "kref_b", sourceKind: "amz_ops_skill", title: "B知识", contextSummary: "B知识摘要", tags: ["库存", "采购"] },
        { referenceId: "kref_a", sourceKind: "emperor_memory", title: "A知识", contextSummary: "A知识摘要", tags: "[\"补货\"]" },
      ],
    });
    const context = result.context as any;
    expect(context.attachments.map((item: any) => item.attachmentId)).toEqual(["att_a", "att_b"]);
    expect(context.knowledgeReferences.map((item: any) => item.referenceId)).toEqual(["kref_a", "kref_b"]);
    expect(result.sourceCount).toBe(4);
    expect(result.manifest).not.toHaveProperty("publicUrl");
    expect(result.contextText).not.toContain("https://");
  });

  it("在预算内裁剪超长输入并保留策略指纹", () => {
    const result = compileConversationContext({
      goal: "目标".repeat(5_000),
      explicitContext: "上下文".repeat(5_000),
      attachments: [{ attachmentId: "att_1", fileName: "large.txt", mimeType: "text/plain", contextPolicy: "extracted_text", contextSummary: "摘要".repeat(5_000) }],
      maxTokens: 1_000,
    });
    expect(result.estimatedTokens).toBeLessThanOrEqual(result.maxTokens);
    expect(result.policyHash).toHaveLength(64);
    expect((result.manifest as any).truncatedFields.length + (result.manifest as any).summarizedFields.length).toBeGreaterThan(0);
  });
});
