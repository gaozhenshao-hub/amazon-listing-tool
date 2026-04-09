import { describe, it, expect } from "vitest";

// ─── Replicate the isSopContent logic from SopContentRenderer.tsx ───────────
function isSopContent(extractedContent?: string | null): boolean {
  if (!extractedContent) return false;
  try {
    const parsed = JSON.parse(extractedContent);
    return !!(parsed && parsed.title && (parsed.steps || parsed.applicableScenarios));
  } catch {
    return false;
  }
}

// ─── Replicate the sopSummaryText builder from kbIntel.ts ───────────────────
function buildSopSummary(content: {
  applicableScenarios?: string;
  preconditions?: string | string[];
  steps?: { title?: string; action?: string }[];
}): string {
  return [
    content.applicableScenarios ? `适用场景：${content.applicableScenarios}` : "",
    content.preconditions?.length
      ? `前置条件：${Array.isArray(content.preconditions) ? content.preconditions.join("；") : content.preconditions}`
      : "",
    content.steps?.length
      ? `操作步骤（共${content.steps.length}步）：${content.steps.map((s, i) => `${i + 1}.${s.title || s.action || ""}`).join("；")}`
      : "",
  ].filter(Boolean).join("\n");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("isSopContent", () => {
  it("returns true for valid SOP JSON with steps", () => {
    const sop = JSON.stringify({
      title: "亚马逊箱包类目跨境选品策略",
      businessModule: "选品分析",
      level: "L2",
      applicableScenarios: "亚马逊卖家进行箱包类目选品时",
      steps: [
        { title: "了解箱包市场整体趋势与规模", detail: "分析全球箱包市场规模" },
        { title: "细分箱包类目并分析市场需求", detail: "将箱包市场分为旅行箱、背包等" },
      ],
    });
    expect(isSopContent(sop)).toBe(true);
  });

  it("returns true for SOP JSON with applicableScenarios but no steps", () => {
    const sop = JSON.stringify({
      title: "广告投放SOP",
      applicableScenarios: "新品上架期间的广告投放",
    });
    expect(isSopContent(sop)).toBe(true);
  });

  it("returns false for plain text content", () => {
    expect(isSopContent("这是一段普通的文章内容，没有结构化数据")).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    expect(isSopContent("{invalid json}")).toBe(false);
  });

  it("returns false for null or undefined", () => {
    expect(isSopContent(null)).toBe(false);
    expect(isSopContent(undefined)).toBe(false);
    expect(isSopContent("")).toBe(false);
  });

  it("returns false for JSON without title field", () => {
    const json = JSON.stringify({ steps: [{ title: "step 1" }] });
    expect(isSopContent(json)).toBe(false);
  });

  it("returns false for JSON with title but no steps or scenarios", () => {
    const json = JSON.stringify({ title: "Some title", description: "just a description" });
    expect(isSopContent(json)).toBe(false);
  });
});

describe("buildSopSummary", () => {
  it("builds a human-readable summary from SOP content", () => {
    const content = {
      applicableScenarios: "亚马逊卖家进行箱包类目选品时",
      preconditions: ["了解亚马逊平台基础运营知识", "具备基本的市场分析能力"],
      steps: [
        { title: "了解箱包市场整体趋势与规模" },
        { title: "细分箱包类目并分析市场需求" },
        { title: "识别市场空白与差异化卖点" },
      ],
    };
    const summary = buildSopSummary(content);
    expect(summary).toContain("适用场景：亚马逊卖家进行箱包类目选品时");
    expect(summary).toContain("前置条件：了解亚马逊平台基础运营知识；具备基本的市场分析能力");
    expect(summary).toContain("操作步骤（共3步）：1.了解箱包市场整体趋势与规模；2.细分箱包类目并分析市场需求；3.识别市场空白与差异化卖点");
  });

  it("handles string preconditions (not array)", () => {
    const content = {
      applicableScenarios: "测试场景",
      preconditions: "单个前置条件",
      steps: [{ title: "步骤一" }],
    };
    const summary = buildSopSummary(content);
    expect(summary).toContain("前置条件：单个前置条件");
  });

  it("handles missing optional fields gracefully", () => {
    const content = {
      steps: [{ action: "执行操作" }],
    };
    const summary = buildSopSummary(content);
    expect(summary).toContain("操作步骤（共1步）：1.执行操作");
    expect(summary).not.toContain("适用场景");
    expect(summary).not.toContain("前置条件");
  });

  it("returns empty string when no fields provided", () => {
    const summary = buildSopSummary({});
    expect(summary).toBe("");
  });
});
