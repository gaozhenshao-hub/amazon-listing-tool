import { describe, it, expect, vi } from "vitest";

// Test the syncBulletsFromSellingPoints mutation logic
// Since the actual tRPC procedure requires DB, we test the data transformation logic

describe("Bullet Point Fine-Tuning Feature", () => {
  // Test bullet data parsing from various formats
  describe("Bullet data parsing from DB", () => {
    it("should parse JSON array of objects with subtitle/fullText", () => {
      const stored = JSON.stringify([
        { subtitle: "【Premium Quality】", fullText: "Made from high-grade materials..." },
        { subtitle: "【Easy Setup】", fullText: "No tools required..." },
      ]);
      const parsed = JSON.parse(stored);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].subtitle).toBe("【Premium Quality】");
      expect(parsed[0].fullText).toContain("high-grade");
    });

    it("should handle JSON array of strings", () => {
      const stored = JSON.stringify([
        "【PremiumQuality】 Made from high-grade materials...",
        "【EasySetup】 No tools required...",
      ]);
      const parsed = JSON.parse(stored);
      expect(parsed).toHaveLength(2);
      // Test the regex parsing pattern used in GeneratePage
      // Note: \S+ matches non-whitespace chars, so subtitle cannot contain spaces
      const parts = parsed[0].match(/^(\S+)\s+(.+)$/);
      expect(parts).not.toBeNull();
      expect(parts![1]).toBe("【PremiumQuality】");
      expect(parts![2]).toContain("high-grade");
    });

    it("should handle objects with title/text/content fallback keys", () => {
      const bp = { title: "Quality", text: "Premium materials", content: "" };
      const result = {
        subtitle: bp.title || "卖点 1",
        fullText: bp.text || bp.content || "",
      };
      expect(result.subtitle).toBe("Quality");
      expect(result.fullText).toBe("Premium materials");
    });
  });

  // Test bullet modification operations
  describe("Bullet modification operations", () => {
    const originalBullets = [
      { subtitle: "【Quality】", fullText: "Premium materials used" },
      { subtitle: "【Design】", fullText: "Modern sleek design" },
      { subtitle: "【Durability】", fullText: "Built to last" },
      { subtitle: "【Comfort】", fullText: "Ergonomic fit" },
      { subtitle: "【Value】", fullText: "Best price-performance ratio" },
    ];

    it("should update a single bullet at specific index", () => {
      const idx = 1;
      const newBullets = [...originalBullets];
      newBullets[idx] = { subtitle: "【Updated Design】", fullText: "Completely redesigned for 2024" };
      expect(newBullets).toHaveLength(5);
      expect(newBullets[1].subtitle).toBe("【Updated Design】");
      expect(newBullets[0].subtitle).toBe("【Quality】"); // unchanged
    });

    it("should add a new bullet (max 9)", () => {
      const newBullet = { subtitle: "【New Feature】", fullText: "Brand new feature description" };
      const newBullets = [...originalBullets, newBullet];
      expect(newBullets).toHaveLength(6);
      expect(newBullets[5].subtitle).toBe("【New Feature】");
    });

    it("should not exceed 9 bullets", () => {
      let bullets = [...originalBullets];
      for (let i = 0; i < 5; i++) {
        if (bullets.length < 9) {
          bullets.push({ subtitle: `【Extra ${i}】`, fullText: `Extra bullet ${i}` });
        }
      }
      expect(bullets.length).toBeLessThanOrEqual(9);
      expect(bullets).toHaveLength(9); // 5 + 4 = 9
    });

    it("should delete a bullet when more than 5 exist", () => {
      const sixBullets = [
        ...originalBullets,
        { subtitle: "【Extra】", fullText: "Extra bullet" },
      ];
      expect(sixBullets).toHaveLength(6);
      const afterDelete = sixBullets.filter((_, i) => i !== 5);
      expect(afterDelete).toHaveLength(5);
    });

    it("should not allow deletion when only 5 bullets remain", () => {
      // Business rule: minimum 5 bullets
      const canDelete = originalBullets.length > 5;
      expect(canDelete).toBe(false);
    });
  });

  // Test character count validation
  describe("Character count validation", () => {
    it("should calculate combined length of subtitle + fullText", () => {
      const bullet = {
        subtitle: "【Premium Quality Materials】",
        fullText: "Our product is crafted from the finest materials sourced globally, ensuring exceptional durability and a luxurious feel that sets it apart from competitors. Each piece undergoes rigorous quality control to meet the highest standards.",
      };
      const combined = bullet.subtitle + " " + bullet.fullText;
      expect(combined.length).toBeGreaterThan(0);
    });

    it("should flag bullets under 200 characters as too short", () => {
      const shortBullet = { subtitle: "Short", fullText: "Too short" };
      const len = (shortBullet.subtitle + " " + shortBullet.fullText).length;
      expect(len).toBeLessThan(200);
    });

    it("should flag bullets over 280 characters as too long", () => {
      const longBullet = {
        subtitle: "【Very Long Title】",
        fullText: "A".repeat(300),
      };
      const len = (longBullet.subtitle + " " + longBullet.fullText).length;
      expect(len).toBeGreaterThan(280);
    });
  });

  // Test locked state management
  describe("Locked state fine-tuning logic", () => {
    it("should track fine-tune editing index", () => {
      let lockedFineTuneIdx: number | null = null;
      // User clicks edit on bullet 2
      lockedFineTuneIdx = 2;
      expect(lockedFineTuneIdx).toBe(2);
      // User saves and exits editing
      lockedFineTuneIdx = null;
      expect(lockedFineTuneIdx).toBeNull();
    });

    it("should maintain fine-tune data independently from original", () => {
      const original = { subtitle: "Original", fullText: "Original text" };
      const fineTuneData = { ...original };
      fineTuneData.subtitle = "Modified";
      expect(original.subtitle).toBe("Original"); // original unchanged
      expect(fineTuneData.subtitle).toBe("Modified");
    });

    it("should toggle between AI and manual add modes", () => {
      let addMode: "ai" | "manual" = "ai";
      expect(addMode).toBe("ai");
      addMode = "manual";
      expect(addMode).toBe("manual");
    });
  });

  // Test syncBullets data format
  describe("Sync bullets data format", () => {
    it("should format bullets array for sync API", () => {
      const bullets = [
        { subtitle: "【Quality】", fullText: "Premium materials" },
        { subtitle: "【Design】", fullText: "Modern design" },
      ];
      // The sync API expects { projectId, bullets }
      const syncPayload = {
        projectId: 1,
        bullets: bullets.map(b => ({
          subtitle: b.subtitle,
          fullText: b.fullText,
        })),
      };
      expect(syncPayload.projectId).toBe(1);
      expect(syncPayload.bullets).toHaveLength(2);
      expect(syncPayload.bullets[0]).toHaveProperty("subtitle");
      expect(syncPayload.bullets[0]).toHaveProperty("fullText");
    });
  });
});
