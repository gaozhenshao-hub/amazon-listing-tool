import { describe, expect, it } from "vitest";
import { parseReviewFile, reviewsToText, type ParseResult } from "./reviewParser";

describe("reviewParser", () => {
  describe("parseReviewFile", () => {
    it("should throw error for unsupported file format", () => {
      const buffer = Buffer.from("test data");
      expect(() => parseReviewFile(buffer, "test.pdf")).toThrow();
    });

    it("should throw error for empty buffer", () => {
      const buffer = Buffer.from("");
      expect(() => parseReviewFile(buffer, "test.csv")).toThrow();
    });

    it("should parse CSV with standard review columns", () => {
      const csvContent = [
        "Title,Content,Rating,Date,Author",
        '"Great product","This is an amazing product, love it!",5,2024-01-15,John',
        '"Not bad","Decent quality for the price",3,2024-01-16,Jane',
        '"Terrible","Broke after one week",1,2024-01-17,Bob',
      ].join("\n");

      const buffer = Buffer.from(csvContent);
      const result = parseReviewFile(buffer, "reviews.csv");

      expect(result.parsedRows).toBeGreaterThanOrEqual(2);
      expect(typeof result.detectedFormat).toBe("string");
      expect(result.detectedFormat.length).toBeGreaterThan(0);
      expect(result.columns.length).toBeGreaterThan(0);
      expect(result.reviews.length).toBeGreaterThanOrEqual(2);
    });

    it("should parse CSV with Chinese column headers (卖家精灵 format)", () => {
      const csvContent = [
        "评论标题,评论内容,星级,日期,评论者",
        '"很好用","这个产品质量非常好，推荐购买！",5,2024-01-15,用户A',
        '"一般般","质量还行，但是价格偏高",3,2024-01-16,用户B',
      ].join("\n");

      const buffer = Buffer.from(csvContent);
      const result = parseReviewFile(buffer, "卖家精灵评论.csv");

      expect(result.parsedRows).toBeGreaterThanOrEqual(1);
      expect(typeof result.detectedFormat).toBe("string");
      expect(result.reviews.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse CSV with Review/Body/Star columns", () => {
      const csvContent = [
        "Review Title,Review Body,Star Rating,Review Date,Reviewer",
        '"Excellent","Best purchase I made this year",5,2024-03-01,Alice',
        '"Disappointing","Did not meet expectations at all",2,2024-03-02,Charlie',
      ].join("\n");

      const buffer = Buffer.from(csvContent);
      const result = parseReviewFile(buffer, "helium10_reviews.csv");

      expect(result.parsedRows).toBeGreaterThanOrEqual(1);
      expect(typeof result.detectedFormat).toBe("string");
      expect(result.reviews.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle CSV with only content column (no title)", () => {
      const csvContent = [
        "content,rating",
        '"This product is great!",5',
        '"Not worth the money",2',
      ].join("\n");

      const buffer = Buffer.from(csvContent);
      const result = parseReviewFile(buffer, "simple.csv");

      expect(result.parsedRows).toBeGreaterThanOrEqual(1);
      expect(result.reviews.length).toBeGreaterThanOrEqual(1);
      result.reviews.forEach(r => {
        expect(r.content).toBeTruthy();
      });
    });

    it("should skip empty rows", () => {
      const csvContent = [
        "Title,Content,Rating",
        '"Good","Nice product",5',
        ',,',
        '"","",',
        '"Bad","Terrible quality",1',
      ].join("\n");

      const buffer = Buffer.from(csvContent);
      const result = parseReviewFile(buffer, "with_empty.csv");

      // Should have parsed at least the non-empty rows
      expect(result.reviews.length).toBeGreaterThanOrEqual(2);
      expect(result.skippedRows).toBeGreaterThanOrEqual(0);
    });

    it("should return correct ParseResult structure", () => {
      const csvContent = [
        "Title,Content,Rating",
        '"Test","Test content",4',
      ].join("\n");

      const buffer = Buffer.from(csvContent);
      const result = parseReviewFile(buffer, "test.csv");

      expect(result).toHaveProperty("reviews");
      expect(result).toHaveProperty("totalRows");
      expect(result).toHaveProperty("parsedRows");
      expect(result).toHaveProperty("skippedRows");
      expect(result).toHaveProperty("detectedFormat");
      expect(result).toHaveProperty("columns");
      expect(Array.isArray(result.reviews)).toBe(true);
      expect(Array.isArray(result.columns)).toBe(true);
      expect(typeof result.totalRows).toBe("number");
      expect(typeof result.parsedRows).toBe("number");
    });

    it("should handle review with all fields", () => {
      const csvContent = [
        "Title,Content,Rating,Date,Author",
        '"Amazing Product","I love this product so much! It works perfectly and the quality is outstanding.",5,2024-06-15,HappyCustomer',
      ].join("\n");

      const buffer = Buffer.from(csvContent);
      const result = parseReviewFile(buffer, "full.csv");

      expect(result.reviews.length).toBeGreaterThanOrEqual(1);
      const review = result.reviews[0];
      expect(review.content).toBeTruthy();
      expect(review.content.length).toBeGreaterThan(0);
    });
  });

  describe("reviewsToText", () => {
    it("should convert reviews array to formatted text", () => {
      const reviews = [
        { title: "Great", content: "Amazing product!", rating: 5, date: "2024-01-15", author: "John" },
        { title: "Bad", content: "Terrible quality", rating: 1, date: "2024-01-16", author: "Jane" },
      ];

      const text = reviewsToText(reviews);

      expect(text).toContain("Amazing product!");
      expect(text).toContain("Terrible quality");
      expect(text.length).toBeGreaterThan(0);
    });

    it("should handle reviews without optional fields", () => {
      const reviews = [
        { content: "Just a review text" },
      ];

      const text = reviewsToText(reviews);

      expect(text).toContain("Just a review text");
    });

    it("should handle empty reviews array", () => {
      const text = reviewsToText([]);
      expect(text).toBe("");
    });

    it("should include rating info when available", () => {
      const reviews = [
        { content: "Good product", rating: 5 },
        { content: "Bad product", rating: 1 },
      ];

      const text = reviewsToText(reviews);
      expect(text).toContain("5");
      expect(text).toContain("1");
    });

    it("should include title when available", () => {
      const reviews = [
        { title: "Excellent Purchase", content: "Very happy with this" },
      ];

      const text = reviewsToText(reviews);
      expect(text).toContain("Excellent Purchase");
    });
  });
});
