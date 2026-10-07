import { describe, expect, it } from "vitest";
import { validateProposedFactDecision } from "./domains/listing/services/listingFactReviewPolicy";

const source = { attributeKey: "材质", value: "不锈钢", sourceLine: 1, sourceLineHash: "a".repeat(64) };

describe("listing human fact confirmation policy", () => {
  it("accepts a real uploaded value but not an unreasoned alteration", () => {
    expect(validateProposedFactDecision({ source })).toBe("不锈钢");
    expect(() => validateProposedFactDecision({ source, correctedValue: "铝合金" })).toThrow("修改理由");
    expect(validateProposedFactDecision({ source, correctedValue: "铝合金", reviewNote: "用户核对材料证明后更正" })).toBe("铝合金");
  });
  it("does not allow unproven sensitive, template or performance claims", () => {
    expect(() => validateProposedFactDecision({ source: { ...source, attributeKey: "认证", value: "UL listed" } })).toThrow("证明文件");
    expect(() => validateProposedFactDecision({ source: { ...source, attributeKey: "保修", value: "2 year warranty" } })).toThrow("证明文件");
    expect(() => validateProposedFactDecision({ source: { ...source, attributeKey: "效率", value: "30% faster" } })).toThrow("证明文件");
    expect(() => validateProposedFactDecision({ source: { ...source, value: "[如：1200W]" } })).toThrow("模板示例");
  });
});
