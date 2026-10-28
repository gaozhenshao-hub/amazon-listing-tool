import { describe, expect, it } from "vitest";
import { parseVideoTaggingResult } from "./videoTaggingResult";

const labels = {
  type: "产品展示（侧重场景）",
  category: "大小家电",
  style: "大厂工业极简风",
  primaryColor: "蓝色",
  accentColor: "白色",
  summary: "展示扫地机器人越过地毯边缘",
  segments: [{ label: "卖点证明", start: 7, end: 20, description: "越过地毯边缘" }],
};

describe("video tagging model responses", () => {
  it("accepts ordinary labels and a known conversation envelope without its improvement", () => {
    expect(parseVideoTaggingResult(JSON.stringify(labels), 27)).toEqual(labels);
    const wrapped = { reply: "已重新核对", result: labels, improvement: "不要自动应用到技能" };
    expect(parseVideoTaggingResult("```json\n" + JSON.stringify(wrapped) + "\n```", 27)).toEqual(labels);
  });
  it("still rejects invalid content labels, types and times inside an envelope", () => {
    for (const result of [
      { ...labels, type: "解说展示" },
      { ...labels, segments: [{ ...labels.segments[0], label: "自定义类别" }] },
      { ...labels, segments: [{ ...labels.segments[0], end: 40 }] },
      { ...labels, segments: [{ ...labels.segments[0], start: 21 }] },
    ]) expect(() => parseVideoTaggingResult(JSON.stringify({ reply: "已核对", result }), 27)).toThrow();
  });
  it("does not silently drop unknown envelope fields or an ambiguous flat result", () => {
    expect(() => parseVideoTaggingResult(JSON.stringify({ reply: "已核对", result: labels, execute: true }), 27)).toThrow();
    expect(() => parseVideoTaggingResult(JSON.stringify({ ...labels, result: labels }), 27)).toThrow();
  });
});
