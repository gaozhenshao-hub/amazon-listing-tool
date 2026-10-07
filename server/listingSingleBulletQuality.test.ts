import { describe, expect, it } from "vitest";
import { validateSingleBulletQuality } from "./domains/listing/services/generationJob";

const baseInput: any = {
  sellingPoint: {
    index: 3,
    theme: "Portable protection",
    description: "Protect devices during everyday travel",
    fabeDirection: {
      feature: "Padded shell",
      advantage: "reduces surface contact",
      benefit: "helps protect a device in transit",
      evidence: "Padded shell",
    },
    targetKeywords: ["portable case"],
  },
  previousBullets: [],
};

const approvedAudit = {
  factsGrounded: true, lengthInRange: true, noKeywordStuffing: true, oneClearBenefit: true,
  subtitleBodyPunctuationCorrect: true, americanEnglishNatural: true,
  grammarAndParallelismCorrect: true, noUnsupportedClaims: true,
  distinctFromPrevious: true, amazonBulletStyleCompliant: true,
};
const validBullet = {
  subtitle: "Everyday Travel Protection:",
  fullText: "This portable case has a padded shell to help reduce surface contact as you carry a device during everyday travel, giving you one simple way to keep it separate from the other items in your bag while moving between stops",
  evidenceUsed: ["Padded shell"],
  keywordsUsed: ["portable case"],
  distinctFromPrevious: "Focuses on reducing surface contact in transit",
  qualityAudit: approvedAudit,
};

describe("逐条卖点v6事实与格式门禁", () => {
  it("接受有单一事实、正确冒号和200–280字符的英文草案", () => {
    const result = validateSingleBulletQuality(validBullet, baseInput);
    expect(result).toEqual({ valid: true, issues: [], characterCount: expect.any(Number) });
    expect(result.characterCount).toBeGreaterThanOrEqual(200);
    expect(result.characterCount).toBeLessThanOrEqual(280);
  });

  it("不强迫添加关键词或完整FABE四段", () => {
    const withoutKeyword = { ...validBullet, fullText: validBullet.fullText.replace("portable case", "padded case"), keywordsUsed: [] };
    expect(validateSingleBulletQuality(withoutKeyword, baseInput).valid).toBe(true);
  });

  it("拒绝冒号缺失、复述标题、意外多段和正文尾句号", () => {
    const candidate = { ...validBullet, subtitle: "Everyday Travel Protection", fullText: `Everyday Travel Protection ${validBullet.fullText}\n` };
    const result = validateSingleBulletQuality(candidate, baseInput);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      "逐条精雕只能输出一条英文Bullet段落，不得分段",
      "小标题必须为2–8词的Title Case且以单个英文冒号结尾",
    ]));
    expect(validateSingleBulletQuality({ ...validBullet, fullText: `${validBullet.fullText}.` }, baseInput).valid).toBe(false);
  });

  it("拒绝无依据数字、价格与输入范围外的关键词，不阻止人工编辑", () => {
    expect(validateSingleBulletQuality({ ...validBullet, fullText: `${validBullet.fullText} 99%` }, baseInput).issues)
      .toContain("数字/规格必须能从当前已确认卖点核心和evidenceUsed逐字追溯");
    expect(validateSingleBulletQuality({ ...validBullet, keywordsUsed: ["unverified keyword"] }, baseInput).issues)
      .toContain("关键词只能来自当前卖点且每个词最多使用一次");
    expect(validateSingleBulletQuality({ ...validBullet, fullText: validBullet.fullText.replace("padded shell", "$10 padded shell") }, baseInput).valid)
      .toBe(false);
  });

  it("拒绝虽在属性中存在但未在当前卖点证据中引用的数值或材质", () => {
    const withProductFacts = { ...baseInput, sellingPoint: { ...baseInput.sellingPoint, description: "Stainless steel shell, 10 oz" } };
    expect(validateSingleBulletQuality({ ...validBullet, fullText: validBullet.fullText.replace("padded shell", "stainless steel shell") }, withProductFacts).issues)
      .toContain("材料、认证或保修声明必须能从当前已确认产品事实和evidenceUsed逐字追溯");
    expect(validateSingleBulletQuality({ ...validBullet, fullText: validBullet.fullText.replace("padded shell", "10 oz padded shell") }, withProductFacts).issues)
      .toContain("数字/规格必须能从当前已确认卖点核心和evidenceUsed逐字追溯");
  });

  it("拒绝无依据的竞品比较和兼容性声明", () => {
    const unsupported = validBullet.fullText.replace("padded shell", "padded shell that works with iPhone 15");
    expect(validateSingleBulletQuality({ ...validBullet, fullText: unsupported }, baseInput).issues)
      .toContain("竞品比较或兼容性声明必须完整引用当前已确认事实和evidenceUsed");
    expect(validateSingleBulletQuality({ ...validBullet, fullText: validBullet.fullText.replace("padded shell", "padded shell better than competitor cases") }, baseInput).issues)
      .toContain("竞品比较或兼容性声明必须完整引用当前已确认事实和evidenceUsed");
  });

  it("绝不把模板中的示例数值当成可追溯的商品事实", () => {
    const example = { ...baseInput, sellingPoint: { ...baseInput.sellingPoint,
      description: "功率：[如：1200W]", fabeDirection: { ...baseInput.sellingPoint.fabeDirection, evidence: "[如：1200W]" },
    } };
    const candidate = { ...validBullet,
      fullText: validBullet.fullText.replace("padded shell", "1200W padded shell"),
      evidenceUsed: ["[如：1200W]"],
    };
    expect(validateSingleBulletQuality(candidate, example).issues).toContain("示例或空白字段不能作为卖点事实依据");
    const noNumber = { ...validBullet, fullText: validBullet.fullText.replace("padded shell", "padded shell with an unspecified wattage") };
    expect(validateSingleBulletQuality(noNumber, example).issues).toContain("示例或空白字段不能作为卖点事实依据");
  });

  it("识别换词后仍沿用同一开头与购买理由的卖点", () => {
    const previousBullets = [{ subtitle: "Travel Guard:", fullText: validBullet.fullText.replace("portable case", "travel case") }];
    expect(validateSingleBulletQuality(validBullet, { ...baseInput, previousBullets }).issues)
      .toContain("与已确认卖点的开头句式或核心表达高度重复，请改用不同的买家角度");
  });

  it("拒绝重复卖点、旧自评结构和遗漏的证据字段", () => {
    const result = validateSingleBulletQuality({ ...validBullet, evidenceUsed: [], qualityAudit: { factsGrounded: true } }, {
      ...baseInput, previousBullets: [{ subtitle: validBullet.subtitle, fullText: validBullet.fullText }],
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      "与已确认卖点重复", "未输出可追溯的事实依据evidenceUsed",
      "qualityAudit.americanEnglishNatural必须为true",
    ]));
  });
});
