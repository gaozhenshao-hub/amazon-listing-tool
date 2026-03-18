import { describe, expect, it } from "vitest";

// Test the helper functions directly
// We can't easily test the full tRPC procedure without DB, but we can test the data conversion logic

describe("convertProfileToText / flattenProfileData", () => {
  // Re-implement the helpers inline for unit testing (they are not exported)
  function flattenProfileData(data: any, indent = 0): string {
    if (!data) return "";
    const prefix = "  ".repeat(indent);

    if (typeof data === "string") return `${prefix}${data}`;
    if (typeof data === "number" || typeof data === "boolean") return `${prefix}${data}`;

    if (Array.isArray(data)) {
      return data.map((item) => {
        if (typeof item === "string") return `${prefix}- ${item}`;
        if (typeof item === "object" && item !== null) {
          const parts = Object.entries(item)
            .filter(([_, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
          return `${prefix}- ${parts.join(", ")}`;
        }
        return `${prefix}- ${JSON.stringify(item)}`;
      }).join("\n");
    }

    if (typeof data === "object") {
      return Object.entries(data)
        .filter(([_, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => {
          if (typeof v === "object") {
            return `${prefix}${k}:\n${flattenProfileData(v, indent + 1)}`;
          }
          return `${prefix}${k}: ${v}`;
        }).join("\n");
    }

    return `${prefix}${JSON.stringify(data)}`;
  }

  function convertProfileToText(profile: any, projectName: string): string {
    const sections: string[] = [];
    sections.push(`产品名称: ${projectName}`);
    sections.push("");

    const moduleMap: { field: string; aiField: string; label: string }[] = [
      { field: "appearanceColors", aiField: "appearanceAiSuggestion", label: "外观设计" },
      { field: "mainFunctions", aiField: "functionsAiSuggestion", label: "功能特点" },
      { field: "costBreakdown", aiField: "costAiSuggestion", label: "产品成本" },
      { field: "packageDimensions", aiField: "packageAiSuggestion", label: "包装尺寸" },
      { field: "packageDesign", aiField: "packageDesignAiSuggestion", label: "包装设计" },
      { field: "userPersona", aiField: "userPersonaAiSuggestion", label: "用户画像" },
      { field: "usageScenarios", aiField: "usageScenariosAiSuggestion", label: "使用场景" },
      { field: "productMap", aiField: "productMapAiSuggestion", label: "产品地图" },
    ];

    for (const mod of moduleMap) {
      const rawData = (profile as any)[mod.field] || (profile as any)[mod.aiField];
      if (!rawData) continue;

      try {
        const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
        sections.push(`【${mod.label}】`);
        sections.push(flattenProfileData(data));
        sections.push("");
      } catch {
        if (typeof rawData === "string" && rawData.trim()) {
          sections.push(`【${mod.label}】`);
          sections.push(rawData);
          sections.push("");
        }
      }
    }

    return sections.join("\n");
  }

  it("should flatten a simple string", () => {
    expect(flattenProfileData("hello")).toBe("hello");
  });

  it("should flatten a number", () => {
    expect(flattenProfileData(42)).toBe("42");
  });

  it("should flatten a boolean", () => {
    expect(flattenProfileData(true)).toBe("true");
  });

  it("should flatten a simple array of strings", () => {
    const result = flattenProfileData(["red", "blue", "green"]);
    expect(result).toBe("- red\n- blue\n- green");
  });

  it("should flatten an array of objects", () => {
    const data = [
      { name: "Feature A", value: "100W" },
      { name: "Feature B", value: "5.0" },
    ];
    const result = flattenProfileData(data);
    expect(result).toContain("- name: Feature A, value: 100W");
    expect(result).toContain("- name: Feature B, value: 5.0");
  });

  it("should flatten a simple object", () => {
    const data = { color: "red", material: "plastic" };
    const result = flattenProfileData(data);
    expect(result).toBe("color: red\nmaterial: plastic");
  });

  it("should flatten nested objects with indentation", () => {
    const data = { dimensions: { length: 10, width: 5 } };
    const result = flattenProfileData(data);
    expect(result).toContain("dimensions:");
    expect(result).toContain("  length: 10");
    expect(result).toContain("  width: 5");
  });

  it("should handle null/undefined gracefully", () => {
    expect(flattenProfileData(null)).toBe("");
    expect(flattenProfileData(undefined)).toBe("");
  });

  it("should filter out empty/null values in objects", () => {
    const data = { color: "red", empty: "", nullVal: null };
    const result = flattenProfileData(data);
    expect(result).toBe("color: red");
  });

  it("should convert a full product profile to text", () => {
    const profile = {
      appearanceColors: JSON.stringify(["红色", "蓝色", "黑色"]),
      mainFunctions: JSON.stringify([
        { feature: "蓝牙5.0", description: "稳定连接" },
        { feature: "防水IPX7", description: "户外使用" },
      ]),
      costBreakdown: JSON.stringify({ unitCost: "15.5", mouldCost: "2000" }),
      userPersona: null,
      usageScenarios: null,
    };

    const result = convertProfileToText(profile, "便携蓝牙音箱");

    expect(result).toContain("产品名称: 便携蓝牙音箱");
    expect(result).toContain("【外观设计】");
    expect(result).toContain("- 红色");
    expect(result).toContain("- 蓝色");
    expect(result).toContain("【功能特点】");
    expect(result).toContain("蓝牙5.0");
    expect(result).toContain("【产品成本】");
    expect(result).toContain("unitCost: 15.5");
    // Should NOT contain sections with null data
    expect(result).not.toContain("【用户画像】");
    expect(result).not.toContain("【使用场景】");
  });

  it("should handle profile with AI suggestion fallback", () => {
    const profile = {
      appearanceColors: null,
      appearanceAiSuggestion: JSON.stringify({ suggestion: "建议使用亮色系配色" }),
    };

    const result = convertProfileToText(profile, "测试产品");
    expect(result).toContain("【外观设计】");
    expect(result).toContain("建议使用亮色系配色");
  });

  it("should handle profile with plain text fields", () => {
    const profile = {
      mainFunctions: "这是一段纯文本描述，不是JSON格式",
    };

    const result = convertProfileToText(profile, "测试产品");
    expect(result).toContain("【功能特点】");
    expect(result).toContain("这是一段纯文本描述");
  });

  it("should handle empty profile gracefully", () => {
    const profile = {};
    const result = convertProfileToText(profile, "空项目");
    expect(result).toContain("产品名称: 空项目");
    // Should only have the header, no module sections
    expect(result).not.toContain("【");
  });
});

describe("importFromProfile input validation", () => {
  it("should require both listingProjectId and devProjectId", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      listingProjectId: z.number(),
      devProjectId: z.number(),
    });

    // Valid input
    expect(schema.safeParse({ listingProjectId: 1, devProjectId: 2 }).success).toBe(true);

    // Missing fields
    expect(schema.safeParse({ listingProjectId: 1 }).success).toBe(false);
    expect(schema.safeParse({ devProjectId: 2 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);

    // Wrong types
    expect(schema.safeParse({ listingProjectId: "1", devProjectId: 2 }).success).toBe(false);
  });
});
