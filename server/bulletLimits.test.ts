import { describe, expect, it } from "vitest";

// Test the validateBullets logic (replicated from listing.ts since not exported)
function validateBullets(bulletData: any): { valid: boolean; issues: string[] } {
  if (!bulletData?.bulletPoints || !Array.isArray(bulletData.bulletPoints)) {
    return { valid: false, issues: ["No bullet points found"] };
  }
  const issues: string[] = [];
  for (let i = 0; i < bulletData.bulletPoints.length; i++) {
    const bp = bulletData.bulletPoints[i];
    const combined = bp.subtitle && bp.fullText
      ? `${bp.subtitle} ${bp.fullText}`
      : bp.fullText || bp.subtitle || '';
    bp.actualCharacterCount = combined.length;
    bp.characterCount = combined.length;
    bp.inRange = combined.length >= 200 && combined.length <= 280;
    if (combined.length > 280) {
      issues.push(`Bullet ${i + 1} is ${combined.length} chars (max 280)`);
    } else if (combined.length < 200) {
      issues.push(`Bullet ${i + 1} is only ${combined.length} chars (min 200)`);
    }
  }
  bulletData.totalCharacterCount = bulletData.bulletPoints.reduce(
    (sum: number, bp: any) => sum + (bp.actualCharacterCount || 0), 0
  );
  return { valid: issues.length === 0, issues };
}

function validateTitles(titleData: any): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (titleData.titles && Array.isArray(titleData.titles)) {
    for (let i = 0; i < titleData.titles.length; i++) {
      const t = titleData.titles[i];
      t.actualCharacterCount = t.title ? t.title.length : 0;
      t.characterCount = t.actualCharacterCount;
      t.inRange = t.actualCharacterCount >= 180 && t.actualCharacterCount <= 200;
      if (t.actualCharacterCount > 200) {
        issues.push(`Title ${i + 1} is ${t.actualCharacterCount} chars (max 200)`);
      } else if (t.actualCharacterCount < 180) {
        issues.push(`Title ${i + 1} is only ${t.actualCharacterCount} chars (min 180)`);
      }
    }
  }
  if (titleData.recommendedTitle) {
    titleData.recommendedTitleCharCount = titleData.recommendedTitle.length;
    titleData.recommendedTitleInRange = titleData.recommendedTitle.length >= 180 && titleData.recommendedTitle.length <= 200;
  }
  return { valid: issues.length === 0, issues };
}

describe("validateBullets", () => {
  it("returns invalid if no bulletPoints", () => {
    const result = validateBullets({ someField: "value" });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("No bullet points found");
  });

  it("returns invalid if bulletPoints is not an array", () => {
    const result = validateBullets({ bulletPoints: "not an array" });
    expect(result.valid).toBe(false);
  });

  it("returns valid for bullets within 200-280 range", () => {
    const text230 = "A".repeat(222); // subtitle(~8) + space(1) + 222 = ~231
    const data = {
      bulletPoints: [
        { subtitle: "【Test】", fullText: text230 },
      ],
    };
    const result = validateBullets(data);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(data.bulletPoints[0].inRange).toBe(true);
  });

  it("reports issue for bullets exceeding 280 chars (no truncation)", () => {
    const longText = "A".repeat(300);
    const data = {
      bulletPoints: [
        { subtitle: "【Test】", fullText: longText },
      ],
    };
    const result = validateBullets(data);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toContain("max 280");
    // Verify NO truncation happened - text should remain unchanged
    expect(data.bulletPoints[0].fullText).toBe(longText);
    expect(data.bulletPoints[0].fullText.length).toBe(300);
  });

  it("reports issue for bullets under 200 chars (no padding)", () => {
    const data = {
      bulletPoints: [
        { subtitle: "【Test】", fullText: "Short text" },
      ],
    };
    const result = validateBullets(data);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("min 200");
    // Verify NO modification happened
    expect(data.bulletPoints[0].fullText).toBe("Short text");
  });

  it("correctly calculates totalCharacterCount", () => {
    const text1 = "A".repeat(222);
    const text2 = "B".repeat(222);
    const data = {
      bulletPoints: [
        { subtitle: "【One】", fullText: text1 },
        { subtitle: "【Two】", fullText: text2 },
      ],
    };
    validateBullets(data);
    const expected = data.bulletPoints.reduce((sum: number, bp: any) => sum + bp.actualCharacterCount, 0);
    expect(data.totalCharacterCount).toBe(expected);
  });

  it("handles mixed bullets - reports only out-of-range ones", () => {
    const normalText = "A".repeat(222); // ~231 total with subtitle
    const longText = "B".repeat(350);
    const shortText = "C".repeat(10);
    const data = {
      bulletPoints: [
        { subtitle: "【OK】", fullText: normalText },
        { subtitle: "【Long】", fullText: longText },
        { subtitle: "【Short】", fullText: shortText },
      ],
    };
    const result = validateBullets(data);
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(2); // long and short
    // Original text should be UNCHANGED
    expect(data.bulletPoints[1].fullText).toBe(longText);
    expect(data.bulletPoints[2].fullText).toBe(shortText);
  });

  it("validates all 5 bullets correctly when all in range", () => {
    const makeText = (len: number) => "X".repeat(len);
    const data = {
      bulletPoints: Array.from({ length: 5 }, (_, i) => ({
        subtitle: `【P${i + 1}】`,
        fullText: makeText(230), // ~235 total
      })),
    };
    const result = validateBullets(data);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("validates 7 bullets (AI generated) correctly when all in range", () => {
    const makeText = (len: number) => "X".repeat(len);
    const data = {
      bulletPoints: Array.from({ length: 7 }, (_, i) => ({
        subtitle: `【P${i + 1}】`,
        fullText: makeText(230),
      })),
    };
    const result = validateBullets(data);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("validates 9 bullets (7 AI + 2 manual) correctly when all in range", () => {
    const makeText = (len: number) => "X".repeat(len);
    const data = {
      bulletPoints: Array.from({ length: 9 }, (_, i) => ({
        subtitle: `【P${i + 1}】`,
        fullText: makeText(230),
      })),
    };
    const result = validateBullets(data);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe("validateTitles", () => {
  it("returns valid for titles within 180-200 range", () => {
    const title190 = "A".repeat(190);
    const data = {
      titles: [{ title: title190 }],
      recommendedTitle: title190,
    };
    const result = validateTitles(data);
    expect(result.valid).toBe(true);
    expect(data.titles[0].inRange).toBe(true);
    expect(data.recommendedTitleInRange).toBe(true);
  });

  it("reports issue for titles exceeding 200 chars (no truncation)", () => {
    const longTitle = "A".repeat(220);
    const data = {
      titles: [{ title: longTitle }],
    };
    const result = validateTitles(data);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("max 200");
    // Verify NO truncation
    expect(data.titles[0].title).toBe(longTitle);
  });

  it("reports issue for titles under 180 chars (no padding)", () => {
    const shortTitle = "A".repeat(100);
    const data = {
      titles: [{ title: shortTitle }],
    };
    const result = validateTitles(data);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("min 180");
    expect(data.titles[0].title).toBe(shortTitle);
  });

  it("handles multiple titles with mixed validity", () => {
    const data = {
      titles: [
        { title: "A".repeat(190) }, // valid
        { title: "B".repeat(210) }, // too long
        { title: "C".repeat(150) }, // too short
      ],
    };
    const result = validateTitles(data);
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(data.titles[0].inRange).toBe(true);
    expect(data.titles[1].inRange).toBe(false);
    expect(data.titles[2].inRange).toBe(false);
  });

  it("sets recommendedTitle metadata correctly", () => {
    const data = {
      titles: [{ title: "A".repeat(190) }],
      recommendedTitle: "B".repeat(195),
    };
    validateTitles(data);
    expect(data.recommendedTitleCharCount).toBe(195);
    expect(data.recommendedTitleInRange).toBe(true);
  });
});
