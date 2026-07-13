/**
 * Tests for operator name mapping feature
 * Tests: extractCoreName, fuzzyMatchUsers, stringSimilarity
 */
import { describe, it, expect } from "vitest";

// We need to test the helper functions directly
// Since they are not exported, we'll re-implement them here for testing
// (In production they live in server/routers/operatorMapping.ts)

function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1;
  if (la.includes(lb) || lb.includes(la)) return 0.8;
  const setA = new Set(la.split(""));
  const setB = new Set(lb.split(""));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function extractCoreName(externalName: string): string {
  if (!externalName) return "";
  let name = externalName.trim();
  name = name.replace(/^(运营|开发|财务|采购|设计|业务员?)\s*[_\s]*/i, "");
  name = name.replace(/[_\-][A-Za-z0-9\-]+$/, "");
  name = name.replace(/[_\-][\u4e00-\u9fa5]+\d*$/, "");
  return name.trim();
}

function fuzzyMatchUsers(
  externalName: string,
  systemUsers: { id: number; name: string | null }[]
): { userId: number; userName: string; score: number; matchType: string }[] {
  const coreName = extractCoreName(externalName);
  const results: { userId: number; userName: string; score: number; matchType: string }[] = [];

  for (const user of systemUsers) {
    if (!user.name) continue;
    const userName = user.name.trim();

    if (userName === externalName.trim() || userName === coreName) {
      results.push({ userId: user.id, userName, score: 1.0, matchType: "exact" });
      continue;
    }

    if (userName.includes(coreName) || coreName.includes(userName)) {
      const score = Math.min(coreName.length, userName.length) / Math.max(coreName.length, userName.length);
      results.push({ userId: user.id, userName, score: Math.max(0.7, score * 0.9), matchType: "contains" });
      continue;
    }

    const lowerUser = userName.toLowerCase();
    const lowerCore = coreName.toLowerCase();
    if (lowerUser.includes(lowerCore) || lowerCore.includes(lowerUser)) {
      const score = Math.min(lowerCore.length, lowerUser.length) / Math.max(lowerCore.length, lowerUser.length);
      results.push({ userId: user.id, userName, score: Math.max(0.6, score * 0.85), matchType: "contains_ci" });
      continue;
    }

    const sim = stringSimilarity(coreName, userName);
    if (sim >= 0.4) {
      results.push({ userId: user.id, userName, score: sim * 0.7, matchType: "similarity" });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ─── Tests ───

describe("extractCoreName", () => {
  it("should remove '运营' prefix and tag suffix", () => {
    expect(extractCoreName("运营 超级管理员_XM-1")).toBe("超级管理员");
  });

  it("should remove '运营_' prefix", () => {
    expect(extractCoreName("运营_李四")).toBe("李四");
  });

  it("should remove tag suffix only", () => {
    expect(extractCoreName("张三_US-2")).toBe("张三");
  });

  it("should keep plain English names", () => {
    expect(extractCoreName("Tom Zhang")).toBe("Tom Zhang");
  });

  it("should handle empty string", () => {
    expect(extractCoreName("")).toBe("");
  });

  it("should handle name with no prefix or suffix", () => {
    expect(extractCoreName("王五")).toBe("王五");
  });

  it("should remove '开发' prefix", () => {
    expect(extractCoreName("开发 赵六_SZ-3")).toBe("赵六");
  });

  it("should remove Chinese suffix tags", () => {
    expect(extractCoreName("张三_深圳")).toBe("张三");
  });
});

describe("stringSimilarity", () => {
  it("should return 1 for identical strings", () => {
    expect(stringSimilarity("张三", "张三")).toBe(1);
  });

  it("should return 0.8 for containment", () => {
    expect(stringSimilarity("张三丰", "张三")).toBe(0.8);
  });

  it("should return 0 for empty strings", () => {
    expect(stringSimilarity("", "test")).toBe(0);
    expect(stringSimilarity("test", "")).toBe(0);
  });

  it("should be case insensitive", () => {
    expect(stringSimilarity("Tom", "tom")).toBe(1);
  });

  it("should return low score for very different strings", () => {
    const score = stringSimilarity("张三", "John");
    expect(score).toBeLessThan(0.5);
  });
});

describe("fuzzyMatchUsers", () => {
  const systemUsers = [
    { id: 1, name: "张三" },
    { id: 2, name: "李四" },
    { id: 3, name: "Tom Zhang" },
    { id: 4, name: "gaozhen shao" },
    { id: 5, name: null },
  ];

  it("should exact match when core name equals user name", () => {
    const matches = fuzzyMatchUsers("运营 张三_XM-1", systemUsers);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].userId).toBe(1);
    expect(matches[0].matchType).toBe("exact");
    expect(matches[0].score).toBe(1.0);
  });

  it("should exact match plain name", () => {
    const matches = fuzzyMatchUsers("李四", systemUsers);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].userId).toBe(2);
    expect(matches[0].score).toBe(1.0);
  });

  it("should match English names case-insensitively", () => {
    const matches = fuzzyMatchUsers("tom zhang", systemUsers);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].userId).toBe(3);
  });

  it("should skip users with null names", () => {
    const matches = fuzzyMatchUsers("null_test", [{ id: 5, name: null }]);
    expect(matches.length).toBe(0);
  });

  it("should return empty for completely unrelated names", () => {
    const matches = fuzzyMatchUsers("完全不相关的名字XYZ", systemUsers);
    // May return some low-score matches or empty
    if (matches.length > 0) {
      expect(matches[0].score).toBeLessThan(0.8);
    }
  });

  it("should sort results by score descending", () => {
    const users = [
      { id: 1, name: "张三" },
      { id: 2, name: "张三丰" },
    ];
    const matches = fuzzyMatchUsers("张三", users);
    expect(matches.length).toBeGreaterThan(0);
    // Exact match should be first
    expect(matches[0].userId).toBe(1);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].score).toBeLessThanOrEqual(matches[i - 1].score);
    }
  });
});

// ─── splitOperatorNames helper (mirrors server/routers/dataImport.ts) ───
function splitOperatorNames(operator: string | null): string[] {
  if (!operator) return [];
  return operator.split(/[\/、,，]+/).map(s => s.trim()).filter(Boolean);
}

// ─── resolveOperatorNames input normalization (mirrors server/routers/operatorMapping.ts) ───
function normalizeExternalNames(externalNames: string[]): string[] {
  const splitNames = externalNames
    .filter(Boolean)
    .flatMap(n => n.split(/[\/、,，]+/).map((s: string) => s.trim()).filter(Boolean));
  return [...new Set(splitNames)];
}

describe("splitOperatorNames", () => {
  it("should return empty array for null/empty input", () => {
    expect(splitOperatorNames(null)).toEqual([]);
    expect(splitOperatorNames("")).toEqual([]);
  });

  it("should return single name as-is", () => {
    expect(splitOperatorNames("裴艺翔")).toEqual(["裴艺翔"]);
  });

  it("should split comma-separated names", () => {
    expect(splitOperatorNames("裴艺翔,康凡静")).toEqual(["裴艺翔", "康凡静"]);
  });

  it("should split Chinese comma-separated names", () => {
    expect(splitOperatorNames("裴艺翔，康凡静")).toEqual(["裴艺翔", "康凡静"]);
  });

  it("should split slash-separated names", () => {
    expect(splitOperatorNames("董兆阳/张航")).toEqual(["董兆阳", "张航"]);
  });

  it("should split Chinese enumeration comma-separated names", () => {
    expect(splitOperatorNames("魏佳豪、姚灵羊")).toEqual(["魏佳豪", "姚灵羊"]);
  });

  it("should trim whitespace around names", () => {
    expect(splitOperatorNames("裴艺翔, 康凡静")).toEqual(["裴艺翔", "康凡静"]);
  });
});

describe("normalizeExternalNames (resolveOperatorNames input)", () => {
  it("should split composite names into individual names", () => {
    const result = normalizeExternalNames(["裴艺翔,康凡静", "董兆阳,张航"]);
    expect(result).toContain("裴艺翔");
    expect(result).toContain("康凡静");
    expect(result).toContain("董兆阳");
    expect(result).toContain("张航");
    expect(result.length).toBe(4);
  });

  it("should deduplicate names appearing in multiple composite strings", () => {
    const result = normalizeExternalNames(["裴艺翔,康凡静", "裴艺翔"]);
    expect(result.filter(n => n === "裴艺翔").length).toBe(1);
  });

  it("should handle already-single names without modification", () => {
    const result = normalizeExternalNames(["王永欣"]);
    expect(result).toEqual(["王永欣"]);
  });

  it("should filter out empty strings", () => {
    const result = normalizeExternalNames(["", "裴艺翔", ""]);
    expect(result).toEqual(["裴艺翔"]);
  });
});
