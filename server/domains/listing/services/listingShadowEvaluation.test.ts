import { describe, expect, it } from "vitest";
import { buildShadowBulletInput, extractShadowFacts, parseOldShadowBullets, redactShadowText, selectShadowFacts, SHADOW_SENSITIVE_VALUE, shadowSourceHash } from "./listingShadowEvaluation";

describe("Listing v6 历史数据隔离影子评估输入", () => {
  it("只提取原始属性表可引用的单项事实，不把竞品、ASIN、AI分析或模板占位用作依据", () => {
    const raw = [
      "ASIN：B012345678",
      "尺寸：12 in",
      "材质：stainless steel",
      "认证标准：UL certified",
      "卖点1：适合旅行携带",
      "卖点2：暂无",
      "AI分析-功能：可能防水",
      "功能：sk_live_example_key_12345678",
      "功能：客服电话 13800138000",
      "容量：[ ]",
      "功率：[如：1200W]",
      "与竞品A的区别：更轻",
      "适用场景：公路旅行",
      "产品名称：测试产品",
    ].join("\n");
    const facts = extractShadowFacts(raw);
    expect(facts.map((fact) => fact.label)).toEqual(["尺寸", "材质", "适用场景"]);
    expect(facts[0]).toMatchObject({ quote: "尺寸：12 in", line: 2 });
    expect(JSON.stringify(facts)).not.toContain("B012345678");
  });

  it("选择上传的显式卖点或保守事实，无法对应时拒绝生成", () => {
    const facts = extractShadowFacts("尺寸：12 in\n材质：stainless steel\n卖点1：旅行便携");
    expect(selectShadowFacts(facts, 0)[0].quote).toBe("尺寸：12 in");
    expect(selectShadowFacts(facts, 1)[0].quote).toBe("材质：stainless steel");
    expect(selectShadowFacts(facts, 2)).toEqual([]);
    expect(() => buildShadowBulletInput(2, [])).toThrow();
    const point = buildShadowBulletInput(0, selectShadowFacts(facts, 0));
    expect(point.targetKeywords).toEqual([]);
    expect(point.description).toContain("12 in");
  });

  it("旧文案只读取字符串且限制五条；源哈希可检测旧版内容变化", () => {
    expect(parseOldShadowBullets(JSON.stringify(["old", { fullText: "fake" }, "more"]))).toEqual(["old", "more"]);
    expect(parseOldShadowBullets("not json")).toEqual([]);
    expect(shadowSourceHash("尺寸：12 in", "old")).not.toBe(shadowSourceHash("尺寸：13 in", "old"));
  });

  it("旧版主题先遮蔽商品标识、密钥、URL和价格；模型候选中的敏感内容拒绝", () => {
    const redacted=redactShadowText("B012345678 costs $19.99, https://example.org/a, sk_live_example_key_1234");
    expect(redacted).not.toMatch(/B012345678|19\.99|example\.org|sk_live_/);
    expect(SHADOW_SENSITIVE_VALUE.test("功能：Bearer abcdefghijklmnopqrst")).toBe(true);
    expect(SHADOW_SENSITIVE_VALUE.test("the item costs $19.99")).toBe(true);
    expect(SHADOW_SENSITIVE_VALUE.test("SKU: ZX-9 and amazon.com/dp/ZX-9")).toBe(true);
    expect(SHADOW_SENSITIVE_VALUE.test("请联系 13800138000")).toBe(true);
  });
});
