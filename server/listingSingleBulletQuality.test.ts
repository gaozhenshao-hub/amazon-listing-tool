import { describe, expect, it } from "vitest";
import { validateSingleBulletQuality } from "./domains/listing/services/generationJob";

const baseInput: any = {
  sellingPoint: {
    index: 3,
    theme: "Portable protection",
    description: "Protect devices during everyday travel.",
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
  factsGrounded: true,
  lengthInRange: true,
  noKeywordStuffing: true,
  oneClearBenefit: true,
};

describe("逐条五点质量门禁", () => {
  it("接受有事实依据、目标关键词、长度和完整自检的任意序号单条候选", () => {
    const fullText = `This portable case ${"uses a padded shell to help reduce surface contact during everyday travel. ".repeat(3)}`.slice(0, 238);
    const result = validateSingleBulletQuality({
      subtitle: "Travel Protection",
      fullText,
      evidenceUsed: ["Padded shell"],
      qualityAudit: approvedAudit,
    }, baseInput);
    expect(result.valid).toBe(true);
    expect(result.characterCount).toBeGreaterThanOrEqual(200);
  });

  it("拒绝无事实依据、遗漏目标关键词、重复、分段或未完成自检的候选", () => {
    const text = `A generic promise\n${"with broad marketing language and no concrete product basis. ".repeat(4)}`.slice(0, 238);
    const result = validateSingleBulletQuality({
      subtitle: "Generic Promise",
      fullText: text,
      evidenceUsed: [],
      qualityAudit: { ...approvedAudit, factsGrounded: false },
    }, {
      ...baseInput,
      previousBullets: [{ subtitle: "Generic Promise", fullText: text }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      "与已确认卖点重复",
      "未自然使用当前卖点核心指定的目标关键词",
      "未输出可追溯的事实依据evidenceUsed",
      "qualityAudit.factsGrounded必须为true",
      "逐条精雕只能输出一条英文Bullet段落，不得分段",
    ]));
  });
});
