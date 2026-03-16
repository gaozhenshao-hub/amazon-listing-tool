import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── AI Tag Accuracy: Anti-Hallucination Prompt Tests ─────────
describe("AI Tag Generation - Anti-Hallucination Prompts", () => {
  const routerPath = path.join(__dirname, "routers/devProjectTags.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  describe("aiGenerateTags prompt constraints", () => {
    it("should contain strict anti-fabrication instruction", () => {
      expect(routerCode).toContain("绝对禁止编造");
    });

    it("should require evidence field for each tag", () => {
      expect(routerCode).toContain("每个标签必须有原文依据");
    });

    it("should instruct to prefer missing over fabricated", () => {
      // Check that the prompt contains the concept of preferring missing over fabricated
      expect(routerCode).toContain("绝对不要编造");
    });

    it("should require two-layer extraction: common + differentiated", () => {
      expect(routerCode).toContain("通用标签");
      expect(routerCode).toContain("差异化标签");
    });

    it("should instruct to check unique features per product", () => {
      expect(routerCode).toContain("逐个产品检查");
      expect(routerCode).toContain("不能遗漏");
    });

    it("should require evidence format with product index", () => {
      expect(routerCode).toContain("产品#N");
      expect(routerCode).toContain("标题/五点");
    });
  });

  describe("aiGenerateTags JSON schema includes evidence", () => {
    it("should include evidence field in response schema for aiGenerateTags", () => {
      // The schema should require evidence as a string field
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      expect(aiGenSection).toContain('"evidence"');
      expect(aiGenSection).toContain('required: ["tagName", "tagValue", "evidence"]');
    });

    it("should include evidence field in response schema for aiGenerateCategoryTags", () => {
      const aiGenCatSection = routerCode.split("aiGenerateCategoryTags:")[1]?.split("exportTagsCsv:")[0] || "";
      expect(aiGenCatSection).toContain('"evidence"');
      expect(aiGenCatSection).toContain('required: ["tagName", "tagValue", "evidence"]');
    });
  });

  describe("Data extraction - no truncation", () => {
    it("should NOT truncate bulletPoints in aiGenerateTags", () => {
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      // Should not have .slice(0, 2000) for bulletPoints
      expect(aiGenSection).not.toContain("bulletPoints).slice(0, 2000)");
    });

    it("should NOT truncate bulletPoints in aiGenerateCategoryTags", () => {
      const aiGenCatSection = routerCode.split("aiGenerateCategoryTags:")[1]?.split("exportTagsCsv:")[0] || "";
      expect(aiGenCatSection).not.toContain("bulletPoints).slice(0, 2000)");
    });

    it("should pass full bulletPoints text", () => {
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      expect(aiGenSection).toContain("ctx.bulletPoints = String(p.bulletPoints)");
    });
  });

  describe("Evidence storage in database", () => {
    it("should store sourceEvidence when inserting AI tags in aiGenerateTags", () => {
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      expect(aiGenSection).toContain("sourceEvidence: tag.evidence");
    });

    it("should store sourceEvidence when inserting AI tags in aiGenerateCategoryTags", () => {
      const aiGenCatSection = routerCode.split("aiGenerateCategoryTags:")[1]?.split("exportTagsCsv:")[0] || "";
      expect(aiGenCatSection).toContain("sourceEvidence: tag.evidence");
    });
  });
});

// ─── Schema Tests ─────────────────────────────────────────────
describe("AI Tag Accuracy - Schema", () => {
  const schemaPath = path.join(__dirname, "../drizzle/schema.ts");
  const schemaCode = fs.readFileSync(schemaPath, "utf-8");

  it("should have sourceEvidence field in devProjectTagItems", () => {
    expect(schemaCode).toContain('sourceEvidence');
    expect(schemaCode).toContain('text("sourceEvidence")');
  });
});

// ─── CSV Export Tests ─────────────────────────────────────────
describe("AI Tag Accuracy - CSV Export includes evidence", () => {
  const routerPath = path.join(__dirname, "routers/devProjectTags.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  it("should include 原文依据 column in CSV header", () => {
    expect(routerCode).toContain("分类名称,标签名称,标签值,来源,原文依据,确认状态");
  });

  it("should include sourceEvidence in CSV row generation", () => {
    const exportSection = routerCode.split("exportTagsCsv:")[1] || "";
    expect(exportSection).toContain("sourceEvidence");
  });
});

// ─── Prompt Quality Tests ─────────────────────────────────────
describe("AI Tag Accuracy - Prompt Quality", () => {
  const routerPath = path.join(__dirname, "routers/devProjectTags.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  it("should have category-specific extraction guidelines", () => {
    expect(routerCode).toContain("基础分类属性(basic)");
    expect(routerCode).toContain("材质属性(material)");
    expect(routerCode).toContain("功能属性(function)");
    expect(routerCode).toContain("参数属性(parameter)");
    expect(routerCode).toContain("安装方式(installation)");
    expect(routerCode).toContain("认证标准(certification)");
    expect(routerCode).toContain("特殊属性(special)");
  });

  it("should instruct to return empty array when no data", () => {
    expect(routerCode).toContain("返回空数组");
  });

  it("should emphasize extracting from original text only", () => {
    expect(routerCode).toContain("只能从产品数据原文中提取");
  });

  it("should emphasize special/unique features extraction", () => {
    expect(routerCode).toContain("差异化卖点");
    expect(routerCode).toContain("独特设计");
    expect(routerCode).toContain("专利技术");
  });

  it("should use productIndex for traceability", () => {
    expect(routerCode).toContain("productIndex");
  });
});

// ─── Chinese Output & Synonym Merging Tests ─────────────
describe("AI Tag Generation - Chinese Output & Synonym Merging", () => {
  const routerPath = path.join(__dirname, "routers/devProjectTags.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  describe("aiGenerateTags Chinese output requirements", () => {
    const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";

    it("should require tagName output in Chinese", () => {
      expect(aiGenSection).toContain("tagName 必须输出中文");
    });

    it("should require tagValue output in Chinese", () => {
      expect(aiGenSection).toContain("tagValue 必须输出中文");
    });

    it("should require evidence to keep English original", () => {
      expect(aiGenSection).toContain("evidence 保留英文原文");
    });

    it("should include Chinese translation examples", () => {
      expect(aiGenSection).toContain('"Waterproof" \u2192 "防水"');
      expect(aiGenSection).toContain('"Stainless Steel" \u2192 "不锈钢"');
    });
  });

  describe("aiGenerateTags synonym merging requirements", () => {
    const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";

    it("should require merging synonymous Chinese tags", () => {
      expect(aiGenSection).toContain("合并中文含义相同的标签");
    });

    it("should provide merging examples", () => {
      expect(aiGenSection).toContain("Waterproof / Water Resistant");
      expect(aiGenSection).toContain("防水");
    });

    it("should require merged evidence to include all sources", () => {
      expect(aiGenSection).toContain("合并后的 evidence 字段应包含所有被合并标签的原文依据");
    });
  });

  describe("aiGenerateCategoryTags Chinese output requirements", () => {
    const catSection = routerCode.split("aiGenerateCategoryTags:")[1]?.split("exportTagsCsv:")[0] || "";

    it("should require Chinese output for category tags", () => {
      expect(catSection).toContain("tagName 和 tagValue 必须输出中文");
    });

    it("should require synonym merging for category tags", () => {
      expect(catSection).toContain("合并中文含义相同的标签");
    });

    it("should require evidence to keep English for category tags", () => {
      expect(catSection).toContain("evidence 保留英文原文");
    });
  });

  describe("JSON schema descriptions reflect Chinese output", () => {
    it("should describe tagName as Chinese output in aiGenerateTags schema", () => {
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      expect(aiGenSection).toContain("必须输出中文，同义英文词合并为一个中文标签");
    });

    it("should describe evidence as English original in schema", () => {
      const aiGenSection = routerCode.split("aiGenerateTags:")[1]?.split("aiGenerateCategoryTags:")[0] || "";
      expect(aiGenSection).toContain("英文原文依据");
    });
  });
});

// ─── Frontend Evidence Display Tests ──────────────────────────
describe("AI Tag Accuracy - Frontend Evidence Display", () => {
  const detailPath = path.join(__dirname, "../client/src/pages/dev/DevProjectDetail.tsx");
  const detailCode = fs.readFileSync(detailPath, "utf-8");

  it("should display sourceEvidence for AI tags", () => {
    expect(detailCode).toContain("sourceEvidence");
    expect(detailCode).toContain("原文依据");
  });

  it("should only show evidence for AI-generated tags", () => {
    expect(detailCode).toContain('item.source === "ai"');
    expect(detailCode).toContain("item.sourceEvidence");
  });
});
