// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildFullPlanContent } from "./exportContent";

const hostile = '</div><script>alert(1)</script><img src=x onerror="alert(2)">';
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("图片Step0–6批准成果HTML离线打开安全", () => {
  it("支持Store从JSON列解析出的七段对象正文并保留确认文字", () => {
    const approvedSections = [
      { step: 0, content: { summary: "竞品研究洞察" } },
      { step: 1, content: { coreSellingPoints: [{ point: "可信主卖点" }] } },
      { step: 2, content: { images: [{ imageLabel: "主图", content: "场景大纲" }] } },
      { step: 3, content: { selectedStyles: [{ name: "风格方向" }] } },
      { step: 4, content: { imageReferences: [{ imageLabel: "主图", designNotes: "设计注意事项" }] } },
      { step: 5, content: { mainImage: { title: "成稿建议" } } },
      { step: 6, content: { summary: "作图提示词包" } },
    ];
    const html = buildFullPlanContent(Object.fromEntries(approvedSections.map(({ step, content }) => [`step${step}UserEdit`, content])));
    const text = parse(html).body.textContent || "";
    for (const expected of ["竞品研究洞察", "可信主卖点", "场景大纲", "风格方向", "设计注意事项", "成稿建议", "作图提示词包"]) {
      expect(text).toContain(expected);
    }
  });

  it("逐步人工/AI文字保留可读内容但不得作为脚本或元素注入", () => {
    const session = {
      step0UserEdit: JSON.stringify({ summary: hostile }),
      step1UserEdit: JSON.stringify({ coreSellingPoints: [{ point: hostile }] }),
      step2UserEdit: JSON.stringify({ brandStory: hostile }),
      step3UserEdit: JSON.stringify({ selectedStyles: [{ name: hostile, description: hostile }] }),
      step4UserEdit: JSON.stringify({ imageReferences: [{ imageLabel: hostile, designNotes: hostile }] }),
      step5UserEdit: JSON.stringify({ mainImage: { title: hostile, concept: hostile }, designGuidelines: { brandTone: hostile } }),
      step6UserEdit: JSON.stringify({ summary: hostile }),
    };
    const html = buildFullPlanContent(session);
    const doc = parse(html);
    expect(doc.body.textContent).toContain(hostile);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("img[onerror]")).toBeNull();
    expect(doc.querySelector("img[src=x]")).toBeNull();
  });

  it("拒绝不可控URL协议，仅接受HTTPS图片资源且转义属性", () => {
    const html = buildFullPlanContent({ step0UserEdit: JSON.stringify({ summary: "review" }) }, undefined, undefined, {
      expressionGroups: [{ expressionName: "研究图", images: [
        { imageUrl: 'javascript:alert(1)' },
        { imageUrl: 'data:image/svg+xml,<svg onload="alert(2)">' },
        { imageUrl: 'https://assets.example.test/a.jpg?x=1&y=2' },
      ] }],
    });
    const images = [...parse(html).querySelectorAll("img")];
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("https://assets.example.test/a.jpg?x=1&y=2");
  });
});
