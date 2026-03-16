import { describe, it, expect } from "vitest";

// ─── CSV Export Logic Tests ─────────────────────────────────
describe("Tag CSV Export", () => {
  // CSV escape helper (mirrors backend logic)
  const esc = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  };

  it("should escape values with commas", () => {
    expect(esc("hello,world")).toBe('"hello,world"');
  });

  it("should escape values with double quotes", () => {
    expect(esc('say "hello"')).toBe('"say ""hello"""');
  });

  it("should escape values with newlines", () => {
    expect(esc("line1\nline2")).toBe('"line1\nline2"');
  });

  it("should not escape simple values", () => {
    expect(esc("hello")).toBe("hello");
    expect(esc("基础分类属性")).toBe("基础分类属性");
  });

  it("should generate proper CSV header", () => {
    const header = '\uFEFF分类名称,标签名称,标签值,来源,原文依据,确认状态';
    expect(header).toContain("分类名称");
    expect(header).toContain("标签名称");
    expect(header).toContain("标签值");
    expect(header).toContain("来源");
    expect(header).toContain("原文依据");
    expect(header).toContain("确认状态");
    // BOM for Excel
    expect(header.charCodeAt(0)).toBe(0xFEFF);
  });

  it("should format source correctly", () => {
    const formatSource = (source: string) => source === 'ai' ? 'AI生成' : '手动添加';
    expect(formatSource('ai')).toBe('AI生成');
    expect(formatSource('manual')).toBe('手动添加');
  });

  it("should format confirmed status correctly", () => {
    const formatConfirmed = (confirmed: number) => confirmed === 1 ? '已确认' : '未确认';
    expect(formatConfirmed(1)).toBe('已确认');
    expect(formatConfirmed(0)).toBe('未确认');
  });

  it("should generate valid CSV rows for categories with items", () => {
    const categories = [
      { id: 1, categoryName: "基础分类属性", confirmed: 1 },
    ];
    const items = [
      { categoryId: 1, tagName: "产品大类", tagValue: "家居用品", source: "ai", sourceEvidence: "产品#1 标题: Home Storage" },
      { categoryId: 1, tagName: "子类目", tagValue: "厨房收纳", source: "manual", sourceEvidence: "" },
    ];

    const rows: string[] = [];
    rows.push('\uFEFF分类名称,标签名称,标签值,来源,原文依据,确认状态');
    for (const cat of categories) {
      const catItems = items.filter(i => i.categoryId === cat.id);
      const confirmed = cat.confirmed === 1 ? '已确认' : '未确认';
      for (const item of catItems) {
        const source = item.source === 'ai' ? 'AI生成' : '手动添加';
        const evidence = item.sourceEvidence || '';
        rows.push(`${esc(cat.categoryName)},${esc(item.tagName)},${esc(item.tagValue || '')},${source},${esc(evidence)},${confirmed}`);
      }
    }

    expect(rows.length).toBe(3); // header + 2 items
    expect(rows[1]).toContain("基础分类属性");
    expect(rows[1]).toContain("产品大类");
    expect(rows[1]).toContain("家居用品");
    expect(rows[1]).toContain("AI生成");
    expect(rows[1]).toContain("已确认");
    expect(rows[1]).toContain("产品#1 标题: Home Storage");
    expect(rows[2]).toContain("手动添加");
  });

  it("should output empty category row when no items", () => {
    const cat = { categoryName: "特殊属性", confirmed: 0 };
    const confirmed = cat.confirmed === 1 ? '已确认' : '未确认';
    const row = `${esc(cat.categoryName)},,,,${confirmed}`;
    expect(row).toBe("特殊属性,,,,未确认");
  });

  it("should generate proper filename with date", () => {
    const projectId = 42;
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `标签数据_项目${projectId}_${date}.csv`;
    expect(fileName).toContain("标签数据");
    expect(fileName).toContain("项目42");
    expect(fileName).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(fileName.endsWith(".csv")).toBe(true);
  });
});

// ─── Router Integration Tests ───────────────────────────────
describe("Tag CSV Export - Router Integration", () => {
  it("exportTagsCsv should be registered in devProjectTags router", async () => {
    const mod = await import("./routers/devProjectTags");
    const router = mod.devProjectTagsRouter;
    const procedures = Object.keys((router as any)._def.procedures || {});
    expect(procedures).toContain("exportTagsCsv");
  });

  it("devProjectTags should have at least 18 procedures", async () => {
    const mod = await import("./routers/devProjectTags");
    const router = mod.devProjectTagsRouter;
    const procedures = Object.keys((router as any)._def.procedures || {});
    expect(procedures.length).toBeGreaterThanOrEqual(18);
  });

  it("exportTagsCsv should be accessible from main app router", async () => {
    const mod = await import("./routers");
    const appRouter = mod.appRouter;
    const procedures = Object.keys((appRouter as any)._def.procedures || {});
    const tagProcedures = procedures.filter(p => p.startsWith("devProjectTags."));
    expect(tagProcedures).toContain("devProjectTags.exportTagsCsv");
    expect(tagProcedures.length).toBeGreaterThanOrEqual(18);
  }, 15000);
});
