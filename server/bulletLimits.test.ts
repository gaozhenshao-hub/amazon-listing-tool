import { describe, expect, it } from "vitest";

// We need to test the truncateBullet and enforceBulletLimits functions
// Since they're not exported, we'll replicate the logic for testing

function truncateBullet(subtitle: string, fullText: string, maxLen: number): { subtitle: string; fullText: string } {
  const combined = `${subtitle} ${fullText}`;
  if (combined.length <= maxLen) return { subtitle, fullText };
  
  const availableForText = maxLen - subtitle.length - 1;
  if (availableForText <= 0) {
    return { subtitle: subtitle.substring(0, maxLen - 3) + '】', fullText: '' };
  }
  
  let truncated = fullText.substring(0, availableForText);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastComma = truncated.lastIndexOf(',');
  const lastSpace = truncated.lastIndexOf(' ');
  const cutPoint = Math.max(lastPeriod, lastComma, lastSpace);
  if (cutPoint > availableForText * 0.7) {
    truncated = truncated.substring(0, cutPoint + 1).trim();
  } else {
    truncated = truncated.trim();
  }
  
  return { subtitle, fullText: truncated };
}

function enforceBulletLimits(bulletData: any): any {
  if (!bulletData?.bulletPoints || !Array.isArray(bulletData.bulletPoints)) return bulletData;
  
  let totalCount = 0;
  for (const bp of bulletData.bulletPoints) {
    const fullBullet = bp.subtitle && bp.fullText
      ? `${bp.subtitle} ${bp.fullText}`
      : bp.fullText || bp.subtitle || '';
    
    if (fullBullet.length > 280) {
      const { subtitle, fullText } = truncateBullet(
        bp.subtitle || '',
        bp.fullText || fullBullet,
        280
      );
      bp.subtitle = subtitle;
      bp.fullText = fullText;
      const newFull = subtitle ? `${subtitle} ${fullText}` : fullText;
      bp.actualCharacterCount = newFull.length;
      bp.characterCount = newFull.length;
      bp.inRange = newFull.length >= 200 && newFull.length <= 280;
      bp.wasTruncated = true;
    } else {
      bp.actualCharacterCount = fullBullet.length;
      bp.characterCount = fullBullet.length;
      bp.inRange = fullBullet.length >= 200 && fullBullet.length <= 280;
    }
    totalCount += bp.actualCharacterCount;
  }
  bulletData.totalCharacterCount = totalCount;
  return bulletData;
}

describe("truncateBullet", () => {
  it("returns unchanged if within limit", () => {
    const result = truncateBullet("【Test】", "Short text here.", 280);
    expect(result.subtitle).toBe("【Test】");
    expect(result.fullText).toBe("Short text here.");
  });

  it("truncates fullText when combined exceeds maxLen", () => {
    const longText = "A".repeat(300);
    const result = truncateBullet("【Test】", longText, 280);
    const combined = `${result.subtitle} ${result.fullText}`;
    expect(combined.length).toBeLessThanOrEqual(280);
  });

  it("truncates at word boundary when possible", () => {
    const text = "This is a long sentence that goes on and on with many words and details about the product features and benefits that customers will enjoy when they purchase this amazing item from our store today. Extra padding text here to make it longer than needed for the test.";
    const result = truncateBullet("【Quality】", text, 280);
    const combined = `${result.subtitle} ${result.fullText}`;
    expect(combined.length).toBeLessThanOrEqual(280);
    // Should not end mid-word
    expect(result.fullText).not.toMatch(/[a-zA-Z]$/);
  });

  it("handles very long subtitle gracefully", () => {
    const longSubtitle = "【" + "A".repeat(290) + "】";
    const result = truncateBullet(longSubtitle, "text", 280);
    const combined = `${result.subtitle} ${result.fullText}`;
    expect(combined.length).toBeLessThanOrEqual(280);
  });
});

describe("enforceBulletLimits", () => {
  it("returns data unchanged if no bulletPoints", () => {
    const data = { someField: "value" };
    const result = enforceBulletLimits(data);
    expect(result).toEqual(data);
  });

  it("returns data unchanged if bulletPoints is not an array", () => {
    const data = { bulletPoints: "not an array" };
    const result = enforceBulletLimits(data);
    expect(result).toEqual(data);
  });

  it("does not modify bullets within range (200-280)", () => {
    const text240 = "A".repeat(230); // subtitle(~8) + space(1) + 230 = ~239
    const data = {
      bulletPoints: [
        { subtitle: "【Test】", fullText: text240 },
      ],
    };
    const result = enforceBulletLimits(data);
    expect(result.bulletPoints[0].fullText).toBe(text240);
    expect(result.bulletPoints[0].wasTruncated).toBeUndefined();
  });

  it("truncates bullets exceeding 280 characters", () => {
    const longText = "A".repeat(300);
    const data = {
      bulletPoints: [
        { subtitle: "【Test】", fullText: longText },
      ],
    };
    const result = enforceBulletLimits(data);
    const combined = `${result.bulletPoints[0].subtitle} ${result.bulletPoints[0].fullText}`;
    expect(combined.length).toBeLessThanOrEqual(280);
    expect(result.bulletPoints[0].wasTruncated).toBe(true);
  });

  it("marks short bullets as not in range", () => {
    const data = {
      bulletPoints: [
        { subtitle: "【Test】", fullText: "Short" },
      ],
    };
    const result = enforceBulletLimits(data);
    expect(result.bulletPoints[0].inRange).toBe(false);
    expect(result.bulletPoints[0].actualCharacterCount).toBeLessThan(200);
  });

  it("correctly calculates totalCharacterCount", () => {
    const text1 = "A".repeat(230);
    const text2 = "B".repeat(230);
    const data = {
      bulletPoints: [
        { subtitle: "【One】", fullText: text1 },
        { subtitle: "【Two】", fullText: text2 },
      ],
    };
    const result = enforceBulletLimits(data);
    const expected = result.bulletPoints.reduce((sum: number, bp: any) => sum + bp.actualCharacterCount, 0);
    expect(result.totalCharacterCount).toBe(expected);
  });

  it("handles mixed bullets - some within range, some exceeding", () => {
    const normalText = "A".repeat(230);
    const longText = "B".repeat(350);
    const data = {
      bulletPoints: [
        { subtitle: "【OK】", fullText: normalText },
        { subtitle: "【Long】", fullText: longText },
      ],
    };
    const result = enforceBulletLimits(data);
    
    // First bullet should be unchanged
    expect(result.bulletPoints[0].fullText).toBe(normalText);
    expect(result.bulletPoints[0].wasTruncated).toBeUndefined();
    
    // Second bullet should be truncated
    const combined2 = `${result.bulletPoints[1].subtitle} ${result.bulletPoints[1].fullText}`;
    expect(combined2.length).toBeLessThanOrEqual(280);
    expect(result.bulletPoints[1].wasTruncated).toBe(true);
  });

  it("enforces 280 hard ceiling on all 5 bullets", () => {
    const data = {
      bulletPoints: Array.from({ length: 5 }, (_, i) => ({
        subtitle: `【Point ${i + 1}】`,
        fullText: "X".repeat(300), // All exceed 280
      })),
    };
    const result = enforceBulletLimits(data);
    for (const bp of result.bulletPoints) {
      const combined = `${bp.subtitle} ${bp.fullText}`;
      expect(combined.length).toBeLessThanOrEqual(280);
      expect(bp.wasTruncated).toBe(true);
    }
  });
});
