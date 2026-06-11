import { describe, expect, it } from "vitest";
import {
  KEYWORD_SEMANTIC_FILTER_PROMPT,
  KEYWORD_SCENE_TAG_PROMPT,
  KEYWORD_ROOT_CLASSIFY_PROMPT,
  KEYWORD_STRATEGY_MATRIX_PROMPT,
  KEYWORD_LISTING_LAYOUT_PROMPT,
} from "./keywordPrompts";
import { AD_STRUCTURE_PROMPT } from "./adStructurePrompt";

describe("Keyword prompts must preserve original English keywords", () => {
  it("KEYWORD_SEMANTIC_FILTER_PROMPT contains no-translate instruction", () => {
    expect(KEYWORD_SEMANTIC_FILTER_PROMPT).toContain("Do NOT translate");
    expect(KEYWORD_SEMANTIC_FILTER_PROMPT).toContain("exact original English keyword");
  });

  it("KEYWORD_SCENE_TAG_PROMPT contains no-translate instruction", () => {
    expect(KEYWORD_SCENE_TAG_PROMPT).toContain("Do NOT translate");
    expect(KEYWORD_SCENE_TAG_PROMPT).toContain("exact original English keyword");
  });

  it("KEYWORD_SCENE_TAG_PROMPT uses English scene tag examples", () => {
    // Scene tag examples should be in English, not Chinese
    expect(KEYWORD_SCENE_TAG_PROMPT).not.toContain("送礼");
    expect(KEYWORD_SCENE_TAG_PROMPT).not.toContain("户外旅行");
    expect(KEYWORD_SCENE_TAG_PROMPT).not.toContain("办公桌面");
    expect(KEYWORD_SCENE_TAG_PROMPT).toContain("gift giving");
    expect(KEYWORD_SCENE_TAG_PROMPT).toContain("outdoor travel");
  });

  it("KEYWORD_ROOT_CLASSIFY_PROMPT contains no-translate instruction", () => {
    expect(KEYWORD_ROOT_CLASSIFY_PROMPT).toContain("Do NOT translate");
    expect(KEYWORD_ROOT_CLASSIFY_PROMPT).toContain("exact original English keyword");
    expect(KEYWORD_ROOT_CLASSIFY_PROMPT).toContain("rootWord");
  });

  it("KEYWORD_STRATEGY_MATRIX_PROMPT contains no-translate instruction", () => {
    expect(KEYWORD_STRATEGY_MATRIX_PROMPT).toContain("Do NOT translate");
    expect(KEYWORD_STRATEGY_MATRIX_PROMPT).toContain("exact original English keyword");
  });

  it("AD_STRUCTURE_PROMPT contains no-translate instruction for keywords", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("严禁将英文关键词翻译成中文");
    expect(AD_STRUCTURE_PROMPT).toContain("严禁翻译成中文");
    // JSON example should use English placeholders, not Chinese
    expect(AD_STRUCTURE_PROMPT).toContain('"keyword": "english keyword here"');
    expect(AD_STRUCTURE_PROMPT).toContain('"keyword": "english core keyword"');
    // Should NOT have Chinese keyword placeholders
    expect(AD_STRUCTURE_PROMPT).not.toMatch(/"keyword":\s*"关键词"/);
    expect(AD_STRUCTURE_PROMPT).not.toMatch(/"keyword":\s*"核心关键词"/);
  });

  it("AD_STRUCTURE_PROMPT negative keyword examples are in English", () => {
    expect(AD_STRUCTURE_PROMPT).toContain('"english negative keyword"');
    expect(AD_STRUCTURE_PROMPT).toContain('"english exact negative keyword"');
    // Should NOT have Chinese negative keyword placeholders
    expect(AD_STRUCTURE_PROMPT).not.toMatch(/"否定词\d+"/);
    expect(AD_STRUCTURE_PROMPT).not.toMatch(/"已投放精准词\d+"/);
  });
});
