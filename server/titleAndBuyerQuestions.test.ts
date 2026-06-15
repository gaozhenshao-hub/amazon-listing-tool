import { describe, it, expect } from "vitest";

// ─── Two-Stage Title Validation Tests ─────────────────────────────
describe("Two-Stage Title Format", () => {
  // Simulate the validation logic from listing.ts
  function validateTwoStageTitle(title: string, itemHighlights: string) {
    const errors: string[] = [];
    if (title.length > 80) errors.push(`Title too long: ${title.length} chars (max 80)`);
    if (title.length < 20) errors.push(`Title too short: ${title.length} chars (min 20)`);
    if (itemHighlights.length > 150) errors.push(`Item Highlights too long: ${itemHighlights.length} chars (max 150)`);
    if (itemHighlights.length < 30) errors.push(`Item Highlights too short: ${itemHighlights.length} chars (min 30)`);
    // Check pipe separator not present (it's a two-field format now)
    if (title.includes("|")) errors.push("Title should not contain pipe separator");
    return { valid: errors.length === 0, errors };
  }

  it("should accept a valid two-stage title", () => {
    const title = "Brand Name Kids Watercolor Paint Set 12 Colors Non-Toxic Washable"; // 67 chars
    const itemHighlights = "Premium quality art supplies for children ages 3-12, includes brush set and mixing palette for creative fun"; // 108 chars
    const result = validateTwoStageTitle(title, itemHighlights);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject title exceeding 80 characters", () => {
    const title = "A".repeat(85);
    const itemHighlights = "Valid item highlights text that is within the character limit for testing";
    const result = validateTwoStageTitle(title, itemHighlights);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Title too long");
  });

  it("should reject item highlights exceeding 150 characters", () => {
    const title = "Brand Name Product Title";
    const itemHighlights = "A".repeat(155);
    const result = validateTwoStageTitle(title, itemHighlights);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Item Highlights too long");
  });

  it("should reject title with pipe separator", () => {
    const title = "Brand Name | Product Title";
    const itemHighlights = "Valid item highlights text that is within the character limit for testing";
    const result = validateTwoStageTitle(title, itemHighlights);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("pipe separator");
  });

  it("should reject too-short title", () => {
    const title = "Short";
    const itemHighlights = "Valid item highlights text that is within the character limit for testing";
    const result = validateTwoStageTitle(title, itemHighlights);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Title too short");
  });
});

// ─── Buyer Questions Dedup and Priority Tests ─────────────────────
describe("Buyer Questions Logic", () => {
  it("should categorize questions by priority", () => {
    const questions = [
      { id: 1, question: "Is this paint washable?", priority: "high", status: "active" },
      { id: 2, question: "What ages is this for?", priority: "high", status: "active" },
      { id: 3, question: "How many colors included?", priority: "medium", status: "active" },
      { id: 4, question: "Is it non-toxic?", priority: "low", status: "covered" },
    ];

    const activeQuestions = questions.filter(q => q.status === "active");
    const highPriority = activeQuestions.filter(q => q.priority === "high");
    const others = activeQuestions.filter(q => q.priority !== "high");

    expect(activeQuestions).toHaveLength(3);
    expect(highPriority).toHaveLength(2);
    expect(others).toHaveLength(1);
  });

  it("should build buyer questions context string correctly", () => {
    const questions = [
      { id: 1, question: "Is this paint washable?", questionCn: "这个颜料可以水洗吗？", priority: "high", status: "active" },
      { id: 2, question: "What ages is this for?", questionCn: null, priority: "medium", status: "active" },
    ];

    const highPriority = questions.filter(q => q.priority === "high");
    const others = questions.filter(q => q.priority !== "high");

    let context = "\n\n--- [买家问题库 - Buyer Questions to Address] ---";
    context += "\n以下是买家常见问题，卖点必须覆盖高优先级问题，尽量覆盖中低优先级问题：";
    if (highPriority.length > 0) {
      context += "\n【高优先级 - 必须覆盖】";
      highPriority.forEach((q, i) => {
        context += `\n  ${i + 1}. ${q.question}${q.questionCn ? ` (中: ${q.questionCn})` : ""}`;
      });
    }
    if (others.length > 0) {
      context += "\n【中/低优先级 - 尽量覆盖】";
      others.forEach((q, i) => {
        context += `\n  ${i + 1}. ${q.question}`;
      });
    }

    expect(context).toContain("Is this paint washable?");
    expect(context).toContain("这个颜料可以水洗吗？");
    expect(context).toContain("高优先级 - 必须覆盖");
    expect(context).toContain("中/低优先级 - 尽量覆盖");
    expect(context).toContain("What ages is this for?");
  });

  it("should calculate coverage stats correctly", () => {
    const questions = [
      { status: "active", priority: "high" },
      { status: "covered", priority: "high" },
      { status: "active", priority: "medium" },
      { status: "covered", priority: "medium" },
      { status: "dismissed", priority: "low" },
    ];

    const total = questions.length;
    const covered = questions.filter(q => q.status === "covered").length;
    const active = questions.filter(q => q.status === "active").length;
    const highPriorityUncovered = questions.filter(q => q.priority === "high" && q.status === "active").length;

    expect(total).toBe(5);
    expect(covered).toBe(2);
    expect(active).toBe(2);
    expect(highPriorityUncovered).toBe(1);
    expect(Math.round((covered / total) * 100)).toBe(40);
  });
});

// ─── Title Scoring Engine Tests ─────────────────────────────
describe("Title Scoring - Two Stage Format", () => {
  function scoreTitleLength(title: string, itemHighlights: string) {
    let score = 100;
    const titleLen = title.length;
    const highlightsLen = itemHighlights.length;

    // Title layer: ideal 50-75 chars
    if (titleLen > 80) score -= 20;
    else if (titleLen > 75) score -= 5;
    else if (titleLen < 30) score -= 15;

    // Item Highlights layer: ideal 80-125 chars
    if (highlightsLen > 150) score -= 20;
    else if (highlightsLen > 125) score -= 5;
    else if (highlightsLen < 50) score -= 15;

    return Math.max(0, score);
  }

  it("should give full score for optimal lengths", () => {
    const title = "Brand Kids Watercolor Paint Set 12 Colors Non-Toxic"; // 52 chars
    const highlights = "Premium quality art supplies for children ages 3-12, includes brush set and mixing palette for creative fun"; // 108 chars
    expect(scoreTitleLength(title, highlights)).toBe(100);
  });

  it("should penalize title over 80 chars", () => {
    const title = "A".repeat(85);
    const highlights = "Valid highlights text that is within the character limit for testing purposes here";
    expect(scoreTitleLength(title, highlights)).toBe(80);
  });

  it("should penalize very short item highlights", () => {
    const title = "Brand Kids Watercolor Paint Set 12 Colors Non-Toxic";
    const highlights = "Short text here"; // 15 chars
    expect(scoreTitleLength(title, highlights)).toBe(85);
  });
});
