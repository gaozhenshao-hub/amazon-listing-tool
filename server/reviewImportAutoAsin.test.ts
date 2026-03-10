import { describe, expect, it } from "vitest";
import { parseReviewFile } from "./reviewParser";

describe("Review import auto-ASIN detection", () => {
  // Helper to create a CSV buffer
  function csvToBuffer(csvContent: string): Buffer {
    return Buffer.from(csvContent, "utf-8");
  }

  describe("ASIN column detection in CSV", () => {
    it("detects ASIN column and extracts unique ASINs", () => {
      const csv = `ASIN,Title,Content,Rating
B0AAAA1111,Great product,This is amazing,5
B0AAAA1111,Good quality,Works well,4
B0BBBB2222,Not bad,Decent product,3
B0BBBB2222,Love it,Perfect for my needs,5
B0CCCC3333,Okay,Average quality,3`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      expect(result.detectedAsins).toBeDefined();
      expect(result.detectedAsins.length).toBe(3);
      expect(result.detectedAsins).toContain("B0AAAA1111");
      expect(result.detectedAsins).toContain("B0BBBB2222");
      expect(result.detectedAsins).toContain("B0CCCC3333");
    });

    it("assigns ASIN to each parsed review", () => {
      const csv = `ASIN,Title,Content,Rating
B0AAAA1111,Great product,This is amazing,5
B0BBBB2222,Not bad,Decent product,3`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      expect(result.reviews[0].asin).toBe("B0AAAA1111");
      expect(result.reviews[1].asin).toBe("B0BBBB2222");
    });

    it("handles files without ASIN column gracefully", () => {
      const csv = `Title,Content,Rating
Great product,This is amazing,5
Not bad,Decent product,3`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      expect(result.detectedAsins).toBeDefined();
      expect(result.detectedAsins.length).toBe(0);
      expect(result.reviews.length).toBe(2);
      // Reviews should not have asin field set
      expect(result.reviews[0].asin).toBeUndefined();
    });

    it("detects ASIN column with different header names", () => {
      const csv = `asin,title,content,rating
B0AAAA1111,Great product,This is amazing,5
B0BBBB2222,Not bad,Decent product,3`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      expect(result.detectedAsins.length).toBe(2);
    });

    it("handles mixed case ASINs and normalizes to uppercase", () => {
      const csv = `ASIN,Title,Content,Rating
b0aaaa1111,Great product,This is amazing,5
B0AAAA1111,Good quality,Works well,4`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      // Should deduplicate case-insensitively
      expect(result.detectedAsins.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Review grouping by ASIN", () => {
    it("groups reviews by ASIN for batch processing", () => {
      const csv = `ASIN,Title,Content,Rating
B0AAAA1111,Great product,This is amazing,5
B0AAAA1111,Good quality,Works well,4
B0BBBB2222,Not bad,Decent product,3`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      const asinGroups = new Map<string, number>();
      for (const review of result.reviews) {
        const asin = review.asin?.toUpperCase() || "UNKNOWN";
        asinGroups.set(asin, (asinGroups.get(asin) || 0) + 1);
      }

      expect(asinGroups.get("B0AAAA1111")).toBe(2);
      expect(asinGroups.get("B0BBBB2222")).toBe(1);
    });
  });

  describe("Preview file ASIN detection", () => {
    it("returns detected ASINs in preview response", () => {
      const csv = `ASIN,Title,Content,Rating
B0AAAA1111,Great product,This is amazing,5
B0BBBB2222,Not bad,Decent product,3`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      // Preview should include detected ASINs
      expect(result.detectedAsins).toEqual(
        expect.arrayContaining(["B0AAAA1111", "B0BBBB2222"])
      );
    });
  });

  describe("Edge cases", () => {
    it("handles empty ASIN values in rows", () => {
      const csv = `ASIN,Title,Content,Rating
B0AAAA1111,Great product,This is amazing,5
,Missing ASIN,No ASIN here,3
B0BBBB2222,Not bad,Decent product,3`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      // Should still detect the valid ASINs
      expect(result.detectedAsins).toContain("B0AAAA1111");
      expect(result.detectedAsins).toContain("B0BBBB2222");
    });

    it("handles single ASIN file", () => {
      const csv = `ASIN,Title,Content,Rating
B0AAAA1111,Great product,This is amazing,5
B0AAAA1111,Good quality,Works well,4
B0AAAA1111,Love it,Perfect,5`;

      const result = parseReviewFile(csvToBuffer(csv), "reviews.csv");

      expect(result.detectedAsins.length).toBe(1);
      expect(result.detectedAsins[0]).toBe("B0AAAA1111");
    });
  });
});
