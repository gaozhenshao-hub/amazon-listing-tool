/**
 * Unit tests for SOP Summary Migration / Regeneration logic
 */
import { describe, it, expect } from "vitest";

// ─── Format Detection Logic ────────────────────────────────────────────────
describe("SOP aiSummary Format Detection", () => {
  function isOldFormat(aiSummary: string | null | undefined): boolean {
    if (!aiSummary) return true;
    try {
      const parsed = JSON.parse(aiSummary);
      return !parsed.briefSummary || !parsed.actionSteps || !parsed.applicableScenarios;
    } catch {
      return true; // Unparseable JSON — needs regeneration
    }
  }

  it("should detect null aiSummary as old format", () => {
    expect(isOldFormat(null)).toBe(true);
    expect(isOldFormat(undefined)).toBe(true);
    expect(isOldFormat("")).toBe(true);
  });

  it("should detect unparseable JSON as old format", () => {
    expect(isOldFormat("not json")).toBe(true);
    expect(isOldFormat("{broken}")).toBe(true);
  });

  it("should detect JSON missing briefSummary as old format", () => {
    const oldFormat = JSON.stringify({
      title: "广告投放SOP",
      summary: "核心摘要",
      keyPoints: ["要点1", "要点2"],
      // Missing: briefSummary, actionSteps, applicableScenarios
    });
    expect(isOldFormat(oldFormat)).toBe(true);
  });

  it("should detect JSON missing actionSteps as old format", () => {
    const partial = JSON.stringify({
      title: "广告投放SOP",
      briefSummary: "一句话摘要",
      summary: "核心摘要",
      keyPoints: ["要点1"],
      // Missing: actionSteps, applicableScenarios
    });
    expect(isOldFormat(partial)).toBe(true);
  });

  it("should detect JSON missing applicableScenarios as old format", () => {
    const partial = JSON.stringify({
      title: "广告投放SOP",
      briefSummary: "一句话摘要",
      summary: "核心摘要",
      keyPoints: ["要点1"],
      actionSteps: ["步骤1"],
      // Missing: applicableScenarios
    });
    expect(isOldFormat(partial)).toBe(true);
  });

  it("should recognize complete new format", () => {
    const newFormat = JSON.stringify({
      title: "广告投放SOP",
      briefSummary: "一句话摘要（50字以内）",
      summary: "核心内容摘要（200字以内）",
      keyPoints: ["关键要点1", "关键要点2"],
      actionSteps: ["操作步骤1", "操作步骤2"],
      applicableScenarios: ["新品上架期", "大促活动期"],
      difficultyLevel: "中级",
      categories: ["广告投放"],
      tags: ["SP广告", "竞价策略"],
      practicalityScore: 8,
    });
    expect(isOldFormat(newFormat)).toBe(false);
  });

  it("should handle empty arrays as valid (not old format)", () => {
    const withEmptyArrays = JSON.stringify({
      title: "测试SOP",
      briefSummary: "摘要",
      summary: "内容",
      keyPoints: [],
      actionSteps: [],
      applicableScenarios: [],
      difficultyLevel: "初级",
      categories: [],
      tags: [],
      practicalityScore: 5,
    });
    expect(isOldFormat(withEmptyArrays)).toBe(false);
  });
});

// ─── Batch Processing Logic ────────────────────────────────────────────────
describe("Batch Regeneration Logic", () => {
  type Skill = { id: number; title: string; aiSummary: string | null; extractedContent: string | null };

  function filterNeedsMigration(skills: Skill[]): Skill[] {
    return skills.filter(s => {
      if (!s.aiSummary) return true;
      try {
        const parsed = JSON.parse(s.aiSummary);
        return !parsed.briefSummary || !parsed.actionSteps || !parsed.applicableScenarios;
      } catch {
        return true;
      }
    });
  }

  function canProcess(skill: Skill): boolean {
    const content = skill.extractedContent || "";
    return !(!content || content.startsWith("["));
  }

  it("should identify correct items for migration", () => {
    const newFmt = JSON.stringify({ briefSummary: "x", actionSteps: ["a"], applicableScenarios: ["s"] });
    const skills: Skill[] = [
      { id: 1, title: "Old 1", aiSummary: null, extractedContent: "content" },
      { id: 2, title: "Old 2", aiSummary: '{"summary":"old"}', extractedContent: "content" },
      { id: 3, title: "New 1", aiSummary: newFmt, extractedContent: "content" },
      { id: 4, title: "Old 3", aiSummary: "invalid json", extractedContent: "content" },
    ];
    const toMigrate = filterNeedsMigration(skills);
    expect(toMigrate).toHaveLength(3);
    expect(toMigrate.map(s => s.id)).toEqual([1, 2, 4]);
  });

  it("should skip image-only items (no extractable text)", () => {
    const skills: Skill[] = [
      { id: 1, title: "Image only", aiSummary: null, extractedContent: "[图片文件 - 需要视觉AI分析]" },
      { id: 2, title: "Parse failed", aiSummary: null, extractedContent: "[文件解析失败: error]" },
      { id: 3, title: "Valid text", aiSummary: null, extractedContent: "这是有效的文档内容" },
    ];
    expect(canProcess(skills[0])).toBe(false);
    expect(canProcess(skills[1])).toBe(false);
    expect(canProcess(skills[2])).toBe(true);
  });

  it("should limit batch to 20 items", () => {
    const skills: Skill[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1, title: `Skill ${i + 1}`, aiSummary: null, extractedContent: "content",
    }));
    const batch = skills.slice(0, 20);
    expect(batch).toHaveLength(20);
    const hasMore = skills.length > 20;
    const remainingCount = Math.max(0, skills.length - 20);
    expect(hasMore).toBe(true);
    expect(remainingCount).toBe(30);
  });

  it("should return correct stats after processing", () => {
    const results = [
      { id: 1, title: "A", success: true },
      { id: 2, title: "B", success: true },
      { id: 3, title: "C", success: false, error: "无可用文本内容" },
    ];
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    expect(succeeded).toBe(2);
    expect(failed).toBe(1);
  });

  it("should return hasMore=false when all items processed in one batch", () => {
    const total = 5;
    const batchSize = 20;
    const hasMore = total > batchSize;
    expect(hasMore).toBe(false);
  });

  it("should return hasMore=true when items exceed batch size", () => {
    const total = 35;
    const batchSize = 20;
    const hasMore = total > batchSize;
    const remainingCount = Math.max(0, total - batchSize);
    expect(hasMore).toBe(true);
    expect(remainingCount).toBe(15);
  });
});

// ─── New Format Prompt Validation ─────────────────────────────────────────
describe("New aiSummary Format Validation", () => {
  const REQUIRED_FIELDS = ["title", "briefSummary", "summary", "keyPoints", "actionSteps", "applicableScenarios", "difficultyLevel", "categories", "tags", "practicalityScore"];

  it("should have all required fields in new format", () => {
    const newFormat = {
      title: "广告投放SOP",
      briefSummary: "一句话摘要",
      summary: "核心内容摘要",
      keyPoints: ["关键要点1"],
      actionSteps: ["操作步骤1"],
      applicableScenarios: ["新品上架期"],
      difficultyLevel: "中级",
      categories: ["广告投放"],
      tags: ["SP广告"],
      practicalityScore: 8,
    };
    for (const field of REQUIRED_FIELDS) {
      expect(newFormat).toHaveProperty(field);
    }
  });

  it("should validate practicalityScore range 1-10", () => {
    const validScores = [1, 5, 10];
    const invalidScores = [0, 11, -1];
    validScores.forEach(s => expect(s >= 1 && s <= 10).toBe(true));
    invalidScores.forEach(s => expect(s >= 1 && s <= 10).toBe(false));
  });

  it("should validate difficultyLevel enum", () => {
    const valid = ["初级", "中级", "高级"];
    const invalid = ["easy", "hard", "medium"];
    valid.forEach(l => expect(["初级", "中级", "高级"].includes(l)).toBe(true));
    invalid.forEach(l => expect(["初级", "中级", "高级"].includes(l)).toBe(false));
  });

  it("should correctly count migration stats", () => {
    const newFmt = JSON.stringify({ briefSummary: "x", actionSteps: ["a"], applicableScenarios: ["s"] });
    const items = [
      { aiSummary: null },
      { aiSummary: '{"summary":"old"}' },
      { aiSummary: newFmt },
      { aiSummary: newFmt },
    ];
    const needsMigration = items.filter(i => {
      if (!i.aiSummary) return true;
      try {
        const p = JSON.parse(i.aiSummary);
        return !p.briefSummary || !p.actionSteps || !p.applicableScenarios;
      } catch { return true; }
    }).length;
    const alreadyMigrated = items.length - needsMigration;
    expect(needsMigration).toBe(2);
    expect(alreadyMigrated).toBe(2);
  });
});
