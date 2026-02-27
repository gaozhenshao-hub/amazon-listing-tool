import { describe, expect, it } from "vitest";
import { z } from "zod";

// Test the manual input validation schema
const manualInputSchema = z.object({
  projectId: z.number(),
  asin: z.string().min(10).max(10),
  title: z.string().optional(),
  bulletPoints: z.string().optional(),
  price: z.string().optional(),
  rating: z.string().optional(),
  reviews: z.string().optional(),
  description: z.string().optional(),
  brand: z.string().optional(),
});

describe("Manual Analysis Input Validation", () => {
  it("accepts valid manual input with all fields", () => {
    const input = {
      projectId: 1,
      asin: "B0ABCDEFGH",
      title: "Test Product Title",
      bulletPoints: "Point 1\nPoint 2\nPoint 3",
      price: "$29.99",
      rating: "4.5",
      reviews: "Great product!\n---\nCould be better.",
      description: "A great product description",
      brand: "TestBrand",
    };
    const result = manualInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts valid manual input with only required fields", () => {
    const input = {
      projectId: 1,
      asin: "B0ABCDEFGH",
    };
    const result = manualInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects invalid ASIN (too short)", () => {
    const input = {
      projectId: 1,
      asin: "B0ABC",
    };
    const result = manualInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid ASIN (too long)", () => {
    const input = {
      projectId: 1,
      asin: "B0ABCDEFGHIJK",
    };
    const result = manualInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing projectId", () => {
    const input = {
      asin: "B0ABCDEFGH",
    };
    const result = manualInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing ASIN", () => {
    const input = {
      projectId: 1,
    };
    const result = manualInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts empty optional string fields", () => {
    const input = {
      projectId: 1,
      asin: "B0ABCDEFGH",
      title: "",
      bulletPoints: "",
      reviews: "",
    };
    const result = manualInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("Bullet Points Parsing", () => {
  it("parses bullet points from newline-separated text", () => {
    const text = "Point 1\nPoint 2\nPoint 3\nPoint 4\nPoint 5";
    const parsed = text.split("\n").filter((line: string) => line.trim().length > 0);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toBe("Point 1");
    expect(parsed[4]).toBe("Point 5");
  });

  it("filters out empty lines", () => {
    const text = "Point 1\n\nPoint 2\n\n\nPoint 3";
    const parsed = text.split("\n").filter((line: string) => line.trim().length > 0);
    expect(parsed).toHaveLength(3);
  });

  it("handles single bullet point", () => {
    const text = "Only one point";
    const parsed = text.split("\n").filter((line: string) => line.trim().length > 0);
    expect(parsed).toHaveLength(1);
  });

  it("handles empty text", () => {
    const text = "";
    const parsed = text.split("\n").filter((line: string) => line.trim().length > 0);
    expect(parsed).toHaveLength(0);
  });

  it("handles whitespace-only lines", () => {
    const text = "Point 1\n   \n  \nPoint 2";
    const parsed = text.split("\n").filter((line: string) => line.trim().length > 0);
    expect(parsed).toHaveLength(2);
  });
});

describe("Context Building from Manual Input", () => {
  it("builds context parts correctly from full input", () => {
    const input = {
      asin: "B0ABCDEFGH",
      title: "Test Product",
      brand: "TestBrand",
      bulletPoints: "Point 1\nPoint 2",
      price: "$29.99",
      rating: "4.5",
      description: "A description",
    };

    const contextParts: string[] = [];
    contextParts.push(`ASIN: ${input.asin}`);
    if (input.title) contextParts.push(`Title: ${input.title}`);
    if (input.brand) contextParts.push(`Brand: ${input.brand}`);
    if (input.bulletPoints) contextParts.push(`Bullet Points:\n${input.bulletPoints}`);
    if (input.price) contextParts.push(`Price: ${input.price}`);
    if (input.rating) contextParts.push(`Rating: ${input.rating}/5`);
    if (input.description) contextParts.push(`Description: ${input.description}`);

    expect(contextParts).toHaveLength(7);
    expect(contextParts[0]).toBe("ASIN: B0ABCDEFGH");
    expect(contextParts[1]).toBe("Title: Test Product");
    expect(contextParts[2]).toBe("Brand: TestBrand");
    expect(contextParts[3]).toContain("Bullet Points:");
    expect(contextParts[4]).toBe("Price: $29.99");
    expect(contextParts[5]).toBe("Rating: 4.5/5");
    expect(contextParts[6]).toBe("Description: A description");
  });

  it("builds context parts correctly from minimal input", () => {
    const input = {
      asin: "B0ABCDEFGH",
      title: undefined,
      brand: undefined,
      bulletPoints: undefined,
      price: undefined,
      rating: undefined,
      description: undefined,
    };

    const contextParts: string[] = [];
    contextParts.push(`ASIN: ${input.asin}`);
    if (input.title) contextParts.push(`Title: ${input.title}`);
    if (input.brand) contextParts.push(`Brand: ${input.brand}`);
    if (input.bulletPoints) contextParts.push(`Bullet Points:\n${input.bulletPoints}`);
    if (input.price) contextParts.push(`Price: ${input.price}`);
    if (input.rating) contextParts.push(`Rating: ${input.rating}/5`);
    if (input.description) contextParts.push(`Description: ${input.description}`);

    expect(contextParts).toHaveLength(1);
    expect(contextParts[0]).toBe("ASIN: B0ABCDEFGH");
  });

  it("skips empty string fields", () => {
    const input = {
      asin: "B0ABCDEFGH",
      title: "",
      brand: "",
      bulletPoints: "",
      price: "",
      rating: "",
      description: "",
    };

    const contextParts: string[] = [];
    contextParts.push(`ASIN: ${input.asin}`);
    if (input.title) contextParts.push(`Title: ${input.title}`);
    if (input.brand) contextParts.push(`Brand: ${input.brand}`);
    if (input.bulletPoints) contextParts.push(`Bullet Points:\n${input.bulletPoints}`);
    if (input.price) contextParts.push(`Price: ${input.price}`);
    if (input.rating) contextParts.push(`Rating: ${input.rating}/5`);
    if (input.description) contextParts.push(`Description: ${input.description}`);

    // Empty strings are falsy, so only ASIN should be present
    expect(contextParts).toHaveLength(1);
  });
});
