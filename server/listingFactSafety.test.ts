import { describe, expect, it } from "vitest";
import { containsRawExampleValue, containsTemplateFactInFreeText, excludeRawExamplesFromFactTree, isTemplateOrEmptyFact, rawAttributeExampleValues, sanitizeListingFactTree, sanitizeListingProjectFacts, sanitizeSelectedSellingPoint } from "../shared/listingFactSafety";

describe("Listing单条事实安全合同", () => {
  it("把空白/待填/示例行与示例括号判为非事实", () => {
    for (const value of ["", " ", "[ ]", "（ ）", "待填写", "暂无", "N/A", "TBD",
      "功率：[如：1200W]", "容量：[例如：2L]", "颜色：(e.g. Blue)", "规格：Example: 12 in",
      "[示例值: 30 oz]", "功能：例如：防水", "规格：请填写后确认", "Power: 1200W sample", "Power: e.g., 1200W"])
      expect(isTemplateOrEmptyFact(value), value).toBe(true);
  });

  it("保留明确真实的事实与普通括号用法，不凭数字或括号一律屏蔽", () => {
    for (const value of ["12 in", "35.274 oz (1000 g)", "Black (matte finish)", "316 stainless steel", "Works from -10 °C to 50 °C",
      "The product includes an example value card", "Use a sample value to calibrate"])
      expect(isTemplateOrEmptyFact(value), value).toBe(false);
  });

  it("只剔除不可信片段，保留同一核心内可核验事实供人工决定是否继续", () => {
    const source = { index: 2, theme: "Protective shell", description: "功率：[如：1200W]",
      fabeDirection: { feature: "Padded shell", advantage: "", benefit: "", evidence: "[ ]" },
      targetKeywords: ["protective case", "[如：portable case]"], addressesGap: "" };
    const result = sanitizeSelectedSellingPoint(source);
    expect(result).toMatchObject({ canGenerate: true, excludedFields: ["description", "fabeDirection.evidence", "targetKeywords.1"],
      point: { description: "", fabeDirection: { feature: "Padded shell", evidence: "" }, targetKeywords: ["protective case"] } });
    expect(source.description).toBe("功率：[如：1200W]");
    expect(sanitizeSelectedSellingPoint({ ...source, fabeDirection: undefined }).canGenerate).toBe(false);
    expect(sanitizeSelectedSellingPoint({ ...source, theme: "[ ]" }).canGenerate).toBe(false);
  });

  it("皇帝手动试写的自由文本里只要出现模板事实就提示先补齐，不抹去用户内容", () => {
    expect(containsTemplateFactInFreeText("Feature: padded shell\nPower: [e.g. 1200W]")).toBe(true);
    expect(containsTemplateFactInFreeText("Power: N/A")).toBe(true);
    expect(containsTemplateFactInFreeText("Feature: padded shell\nWeight: 12 oz")).toBe(false);
    expect(containsTemplateFactInFreeText("Easy Storage:\nOther supported benefit")).toBe(false);
    expect(containsTemplateFactInFreeText("Power:")).toBe(true);
  });

  it("已分析的属性树不把占位行保留成可供模型引用的产品参数", () => {
    const source = { coreSpecs: [
      { attribute: "Power", value: "[如：1200W]" }, { attribute: "Width", value: "12 in" },
    ], uniqueSellingPoints: ["暂无", "Padded shell"] };
    const result = sanitizeListingFactTree(source, "productAttributes");
    expect(result.value).toEqual({ coreSpecs: [{ attribute: "Width", value: "12 in" }], uniqueSellingPoints: ["Padded shell"] });
    expect(result.excludedFields).toContain("productAttributes.coreSpecs.0.value");
    expect(source.coreSpecs[0].value).toBe("[如：1200W]");
  });

  it("项目基本信息与规格JSON只过滤示例，不影响数据库原对象及其他真实参数", () => {
    const original = { productName: "Travel Case", brand: "[示例：My Brand]", productFeatures: JSON.stringify(["Padded shell", "Power: [如：1200W]"]),
      productSpecs: JSON.stringify({ width: "12 in", wattage: "[example: 1200W]" }) };
    const { project, excludedFields } = sanitizeListingProjectFacts(original);
    expect(project).toMatchObject({ productName: "Travel Case", brand: null,
      productFeatures: JSON.stringify(["Padded shell"]), productSpecs: JSON.stringify({ width: "12 in" }) });
    expect(excludedFields).toEqual(expect.arrayContaining(["brand", "productFeatures.1", "productSpecs.wattage"]));
    expect(original.brand).toBe("[示例：My Brand]");
  });

  it("即使AI提取剥掉示例标签，也可从同一份原始上传阻断示例规格进入G1核心上下文", () => {
    const examples = rawAttributeExampleValues("功率：[如：1200W]\n颜色：(e.g. Blue)\n尺寸：12 in");
    expect(examples).toEqual(expect.arrayContaining(["1200w", "blue"]));
    expect(containsRawExampleValue("1200W motor", examples)).toBe(true);
    expect(containsRawExampleValue("blueprint", examples)).toBe(false);
    const analysis = { coreSpecs: [
      { attribute: "Power", value: "1200W" }, { attribute: "Size", value: "12 in" },
    ], uniqueSellingPoints: ["1200W power", "Padded shell"] };
    expect(excludeRawExamplesFromFactTree(analysis, examples).value).toEqual({
      coreSpecs: [{ attribute: "Size", value: "12 in" }], uniqueSellingPoints: ["Padded shell"],
    });
    expect(analysis.coreSpecs[0].value).toBe("1200W");
  });
  it("原文尾随(example)/sample和提取器裸数字均不得成为证据，单位不同的真实规格不凭裸数字误删", () => {
    const examples = rawAttributeExampleValues("Power: 1200W (example)\nCapacity: 32 oz sample\nWidth: 12 in");
    expect(examples).toEqual(expect.arrayContaining(["1200w", "32 oz"]));
    expect(containsRawExampleValue(1200, examples)).toBe(true);
    expect(containsRawExampleValue("1200", examples)).toBe(true);
    expect(containsRawExampleValue("1200 oz", examples)).toBe(false);
    const source = { coreSpecs: [
      { attribute: "Power", value: 1200 }, { attribute: "Capacity", value: "32 oz" },
      { attribute: "Width", value: "12 in" },
    ] };
    expect(excludeRawExamplesFromFactTree(source, examples).value).toEqual({ coreSpecs: [{ attribute: "Width", value: "12 in" }] });
  });
});
