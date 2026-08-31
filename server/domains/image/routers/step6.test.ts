import { describe, expect, it } from "vitest";
import { parsePromptDraft } from "./step6";

describe("图片Step6提示词草案契约", () => {
  it("仅接受含非空prompts数组的结构化对象，并标记为人工复核", () => {
    expect(parsePromptDraft({ summary: "draft", prompts: [{ target: "主图", englishPrompt: "clean product image" }] })).toMatchObject({
      schema: "image.prompt-pack/1.0",
      requiresHumanReview: true,
      prompts: [{ target: "主图" }],
    });
  });

  it("拒绝数组根节点、空提示词和非对象输出，防止无效结果写入会话", () => {
    expect(() => parsePromptDraft([])).toThrow("结构化提示词JSON对象");
    expect(() => parsePromptDraft({ prompts: [] })).toThrow("prompts数组");
    expect(() => parsePromptDraft("not-json")).toThrow("结构化提示词JSON对象");
  });
});
