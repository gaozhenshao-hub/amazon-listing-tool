import { it, expect } from "vitest";
import { blankImageOutline } from "../../../shared/imagePlanning";
import {
  emptyImageDocument,
  recordManualDocument,
} from "../../../shared/imageDocument";
import {
  assertDocumentProductClaims,
  documentModelSources,
  documentGenerationReply,
} from "./imageDocumentFacts";
const setup = () => {
  const base = emptyImageDocument(blankImageOutline());
  return {
    base,
    next: structuredClone(base),
    input: {
      productNotes: "",
      features: [
        {
          text: "YKK金属拉链",
          note: "顺滑闭合",
          evidence: [{ quote: "Competitor antique brass zipper" }],
        },
      ],
      selling: [],
    },
    ids: [base.entries[0].imageId],
  };
};
it("旧大纲、历史建议和竞品原句不能把已确认金属升级成黄铜", () => {
  const { base, next, input, ids } = setup();
  next.entries[0].prompts.product = "high quality antique brass YKK zipper";
  expect(() => assertDocumentProductClaims(next, input, base, ids)).toThrow(
    "不包含黄铜材质"
  );
  next.entries[0].prompts.product = "metal YKK zipper";
  expect(() =>
    assertDocumentProductClaims(next, input, base, ids)
  ).not.toThrow();
});
it("其他产品明确确认的黄铜材质仍可使用", () => {
  const { base, next, input, ids } = setup();
  input.features[0].text = "黄铜泵体";
  next.entries[0].prompts.product = "brass pump body";
  expect(() =>
    assertDocumentProductClaims(next, input, base, ids)
  ).not.toThrow();
});
it("否定材质的人工说明不能反向授权该材质", () => {
  const { base, next, input, ids } = setup();
  input.productNotes = "本品不是黄铜";
  next.entries[0].prompts.product = "brass zipper";
  expect(() => assertDocumentProductClaims(next, input, base, ids)).toThrow(
    "黄铜材质"
  );
});
it("人工确认的新材质优先，并保留已保护的字段", () => {
  const { base, next, input, ids } = setup();
  next.entries[0].scenes[0].product = "本品黄铜泵体";
  const manual = recordManualDocument(base, next),
    generated = structuredClone(manual);
  generated.entries[0].prompts.product = "brass pump body";
  expect(() =>
    assertDocumentProductClaims(generated, input, manual, ids)
  ).not.toThrow();
});
it("禁止添加材质的负面约束不误判成正向声明", () => {
  const { base, next, input, ids } = setup();
  next.entries[0].prompts.product =
    "Use metal YKK zipper. No brass material. 不要写黄铜。";
  expect(() =>
    assertDocumentProductClaims(next, input, base, ids)
  ).not.toThrow();
});
it("厚实面料不能自动升级成防火或阻燃", () => {
  const { base, next, input, ids } = setup();
  next.entries[0].prompts.product = "flame-resistant thick fabric";
  expect(() => assertDocumentProductClaims(next, input, base, ids)).toThrow(
    "防火或阻燃"
  );
});
it("不改历史大纲，但会拦截新扩展或调整中的无据材料", () => {
  const { base, next, input, ids } = setup();
  base.entries[0].content = next.entries[0].content = "旧AI大纲写黄铜";
  next.entries[0].prompts.product = "metal zipper";
  expect(() =>
    assertDocumentProductClaims(next, input, base, ids)
  ).not.toThrow();
  next.entries[0].title = "新黄铜拉链特写";
  expect(() => assertDocumentProductClaims(next, input, base, ids)).toThrow(
    "黄铜"
  );
});
it("文档输入使用三项已形成研究，竞品只保留来源锚点", () => {
  const source = documentModelSources({
    product: { name: "产品" },
    productNotes: "本品六口袋",
    features: [
      {
        id: "f",
        text: "六口袋",
        evidence: [{ analysisId: 3, quote: "Competitor has eight pockets" }],
      },
    ],
    selling: [],
    reviews: [{ id: "r", text: "拉链易坏" }],
    questions: [{ id: "q", text: "如何选码", answer: "参考六组尺码" }],
    competitors: [
      {
        analysisId: 3,
        asin: "B000000003",
        title: "竞品",
        bullets: "eight pockets",
      },
    ],
    ownProductPhotos: [{ id: "p", name: "正面", storageKey: "private-path" }],
  });
  expect(source.features[0].text).toBe("六口袋");
  expect(JSON.stringify(source.features[0].evidence)).not.toContain(
    "eight pockets"
  );
  expect(JSON.stringify(source.competitors)).not.toContain("eight pockets");
  expect(source.questions[0].answer).toBe("参考六组尺码");
  expect(JSON.stringify(source.ownProductPhotos)).not.toContain("private-path");
});
it("整套预览用简短摘要，不累加十段模型说明或内部标识", () => {
  const { base } = setup();
  const reply = documentGenerationReply(
    28,
    base,
    base.entries.map(e => e.imageId)
  );
  expect(reply).toContain("28个图位");
  expect(reply.length).toBeLessThan(180);
  expect(reply).not.toContain(base.entries[0].imageId);
});
