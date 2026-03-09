import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replicate the importReviews input schema (simplified: only ASIN + file required)
const importReviewsSchema = z.object({
  projectId: z.number(),
  asin: z.string().min(10).max(10),
  fileBase64: z.string(),
  filename: z.string(),
  // All product info fields are optional
  analysisId: z.number().optional(),
  title: z.string().optional(),
  bulletPoints: z.string().optional(),
  price: z.string().optional(),
  rating: z.string().optional(),
  brand: z.string().optional(),
});

describe("Simplified Review Import - Input Validation", () => {
  it("accepts minimal input with only ASIN and file (no optional product info)", () => {
    const input = {
      projectId: 1,
      asin: "B0ABCDEFGH",
      fileBase64: "dGVzdA==",
      filename: "reviews.xlsx",
    };
    const result = importReviewsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts input with ASIN, file, and optional product info", () => {
    const input = {
      projectId: 1,
      asin: "B0ABCDEFGH",
      fileBase64: "dGVzdA==",
      filename: "reviews.csv",
      title: "Test Product",
      brand: "TestBrand",
      price: "$29.99",
      rating: "4.5",
    };
    const result = importReviewsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects input without ASIN", () => {
    const input = {
      projectId: 1,
      fileBase64: "dGVzdA==",
      filename: "reviews.xlsx",
    };
    const result = importReviewsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects input without file", () => {
    const input = {
      projectId: 1,
      asin: "B0ABCDEFGH",
    };
    const result = importReviewsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid ASIN (too short)", () => {
    const input = {
      projectId: 1,
      asin: "B0ABC",
      fileBase64: "dGVzdA==",
      filename: "reviews.xlsx",
    };
    const result = importReviewsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid ASIN (too long)", () => {
    const input = {
      projectId: 1,
      asin: "B0ABCDEFGHIJK",
      fileBase64: "dGVzdA==",
      filename: "reviews.xlsx",
    };
    const result = importReviewsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("Multi-ASIN Batch Import - Frontend Logic", () => {
  // Simulate the frontend validation logic
  function validateImportItems(items: Array<{ asin: string; fileBase64: string | null }>) {
    return items.filter(item => {
      const asin = item.asin.trim().toUpperCase();
      return asin.length === 10 && /^[A-Z0-9]{10}$/.test(asin) && item.fileBase64;
    });
  }

  it("validates a single valid import item", () => {
    const items = [{ asin: "B0ABCDEFGH", fileBase64: "dGVzdA==" }];
    const valid = validateImportItems(items);
    expect(valid).toHaveLength(1);
  });

  it("validates multiple valid import items", () => {
    const items = [
      { asin: "B0ABCDEFGH", fileBase64: "dGVzdA==" },
      { asin: "B0XXXXXXXX", fileBase64: "dGVzdDI=" },
      { asin: "B0YYYYYYYY", fileBase64: "dGVzdDM=" },
    ];
    const valid = validateImportItems(items);
    expect(valid).toHaveLength(3);
  });

  it("filters out items without file", () => {
    const items = [
      { asin: "B0ABCDEFGH", fileBase64: "dGVzdA==" },
      { asin: "B0XXXXXXXX", fileBase64: null },
    ];
    const valid = validateImportItems(items);
    expect(valid).toHaveLength(1);
    expect(valid[0].asin).toBe("B0ABCDEFGH");
  });

  it("filters out items with invalid ASIN", () => {
    const items = [
      { asin: "B0ABCDEFGH", fileBase64: "dGVzdA==" },
      { asin: "INVALID", fileBase64: "dGVzdDI=" },
      { asin: "", fileBase64: "dGVzdDM=" },
    ];
    const valid = validateImportItems(items);
    expect(valid).toHaveLength(1);
  });

  it("handles lowercase ASIN input (auto-uppercase)", () => {
    const items = [{ asin: "b0abcdefgh", fileBase64: "dGVzdA==" }];
    const valid = validateImportItems(items);
    expect(valid).toHaveLength(1);
  });

  it("returns empty array when all items are invalid", () => {
    const items = [
      { asin: "", fileBase64: null },
      { asin: "SHORT", fileBase64: "dGVzdA==" },
    ];
    const valid = validateImportItems(items);
    expect(valid).toHaveLength(0);
  });

  it("handles mixed valid and invalid items correctly", () => {
    const items = [
      { asin: "B0ABCDEFGH", fileBase64: "dGVzdA==" },  // valid
      { asin: "B0XXXXXXXX", fileBase64: null },          // no file
      { asin: "SHORT", fileBase64: "dGVzdDI=" },          // bad ASIN
      { asin: "B0YYYYYYYY", fileBase64: "dGVzdDM=" },  // valid
    ];
    const valid = validateImportItems(items);
    expect(valid).toHaveLength(2);
    expect(valid[0].asin).toBe("B0ABCDEFGH");
    expect(valid[1].asin).toBe("B0YYYYYYYY");
  });
});

describe("File Format Validation", () => {
  function isValidFileExtension(filename: string): boolean {
    const validExtensions = [".xlsx", ".xls", ".csv"];
    const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
    return validExtensions.includes(ext);
  }

  it("accepts .xlsx files", () => {
    expect(isValidFileExtension("reviews.xlsx")).toBe(true);
  });

  it("accepts .xls files", () => {
    expect(isValidFileExtension("data.xls")).toBe(true);
  });

  it("accepts .csv files", () => {
    expect(isValidFileExtension("export.csv")).toBe(true);
  });

  it("rejects .txt files", () => {
    expect(isValidFileExtension("notes.txt")).toBe(false);
  });

  it("rejects .pdf files", () => {
    expect(isValidFileExtension("report.pdf")).toBe(false);
  });

  it("handles case-insensitive extensions", () => {
    expect(isValidFileExtension("DATA.XLSX")).toBe(true);
    expect(isValidFileExtension("Export.CSV")).toBe(true);
  });
});
