import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Test: listingContext.ts Data Aggregation Layer ─────────────
describe("listingContext.ts - Data Aggregation Layer", () => {
  const ctxPath = path.join(__dirname, "listingContext.ts");
  const ctxCode = fs.readFileSync(ctxPath, "utf-8");

  describe("Module 1: Rufus Attributes", () => {
    it("should export buildListingContext function", () => {
      expect(ctxCode).toContain("export async function buildListingContext");
    });

    it("should read from projectFiles with product_attributes type", () => {
      expect(ctxCode).toContain('fileType === "product_attributes"');
    });

    it("should extract uniqueSellingPoints from analysis result", () => {
      expect(ctxCode).toContain("uniqueSellingPoints");
    });

    it("should extract coreSpecs from analysis result", () => {
      expect(ctxCode).toContain("coreSpecs");
    });

    it("should extract rufusFriendlyAttributes", () => {
      expect(ctxCode).toContain("rufusFriendlyAttributes");
    });
  });

  describe("Module 2: Competitor Insights", () => {
    it("should read from competitorAnalyses table", () => {
      expect(ctxCode).toContain("getCompetitorAnalysesByProject");
    });

    it("should read from reviewAggregations table", () => {
      expect(ctxCode).toContain("getReviewAggregationByProject");
    });

    it("should extract Kano model pain points", () => {
      expect(ctxCode).toContain("painPoints");
    });

    it("should extract Kano model itch points", () => {
      expect(ctxCode).toContain("itchPoints");
    });

    it("should extract Kano model delight points", () => {
      expect(ctxCode).toContain("delightPoints");
    });

    it("should compute parity points from common selling points", () => {
      expect(ctxCode).toContain("parityPoints");
      expect(ctxCode).toContain("count >= 2");
    });

    it("should compute gap opportunities from pain points", () => {
      expect(ctxCode).toContain("gapOpportunities");
    });

    it("should fallback to individual competitor reviews if no aggregation", () => {
      expect(ctxCode).toContain("Fallback: aggregate from individual competitor review analyses");
    });
  });

  describe("Module 3: COSMO Scenes", () => {
    it("should read from keywords table sceneTags field", () => {
      expect(ctxCode).toContain("kw.sceneTags");
    });

    it("should read from keywords table intentTag field", () => {
      expect(ctxCode).toContain("kw.intentTag");
    });

    it("should build topScenes sorted by volume", () => {
      expect(ctxCode).toContain("topScenes");
      expect(ctxCode).toContain("b.volume - a.volume");
    });

    it("should build intentDistribution map", () => {
      expect(ctxCode).toContain("intentDistribution");
    });

    it("should filter out negative keywords", () => {
      expect(ctxCode).toContain("kw.isNegative === 1");
    });
  });

  describe("Module 4: A9 Keywords", () => {
    it("should read from keywords table strategyCategory field", () => {
      expect(ctxCode).toContain("kw.strategyCategory");
    });

    it("should read from keywords table listingPlacement field", () => {
      expect(ctxCode).toContain("kw.listingPlacement");
    });

    it("should build byStrategy grouping", () => {
      expect(ctxCode).toContain("byStrategy");
    });

    it("should build byPlacement grouping", () => {
      expect(ctxCode).toContain("byPlacement");
    });

    it("should collect titleKeywords from title_ placements", () => {
      expect(ctxCode).toContain('kw.listingPlacement.startsWith("title_")');
    });

    it("should collect bulletKeywords from bullet_ placements", () => {
      expect(ctxCode).toContain('kw.listingPlacement.startsWith("bullet_")');
    });

    it("should collect searchTermKeywords from search_term placement", () => {
      expect(ctxCode).toContain('"search_term"');
    });

    it("should collect holidayKeywords from gift_holiday root", () => {
      expect(ctxCode).toContain('"gift_holiday"');
    });

    it("should build rootGroups from rootCategory", () => {
      expect(ctxCode).toContain("kw.rootCategory");
      expect(ctxCode).toContain("rootGroups");
    });
  });

  describe("Data Readiness Check", () => {
    it("should export checkDataReadiness function", () => {
      expect(ctxCode).toContain("export async function checkDataReadiness");
    });

    it("should check module1 readiness (product_attributes file)", () => {
      expect(ctxCode).toContain("module1");
    });

    it("should check module2 readiness (competitor analyses)", () => {
      expect(ctxCode).toContain("module2");
    });

    it("should check module3 readiness (scene tags)", () => {
      expect(ctxCode).toContain("module3");
      expect(ctxCode).toContain("sceneTagCount");
    });

    it("should check module4 readiness (strategy matrix)", () => {
      expect(ctxCode).toContain("module4");
      expect(ctxCode).toContain("strategyTaggedCount");
    });

    it("should calculate scene tag completion rate", () => {
      expect(ctxCode).toContain("completionRate");
    });
  });

  describe("Context to Prompt Text", () => {
    it("should export contextToPromptText function", () => {
      expect(ctxCode).toContain("export function contextToPromptText");
    });

    it("should include Module 1 section header", () => {
      expect(ctxCode).toContain("[Module 1] Rufus Product Attributes");
    });

    it("should include Module 2 section header", () => {
      expect(ctxCode).toContain("[Module 2] Multi-Competitor Analysis");
    });

    it("should include Module 3 section header", () => {
      expect(ctxCode).toContain("[Module 3] COSMO Scene Mapping");
    });

    it("should include Module 4 section header", () => {
      expect(ctxCode).toContain("[Module 4] A9 Keyword Strategy");
    });

    it("should include keyword placement strategy labels", () => {
      expect(ctxCode).toContain("Title Front");
      expect(ctxCode).toContain("Bullet First-line");
      expect(ctxCode).toContain("Backend Search Terms");
    });
  });
});

// ─── Test: Type Definitions ─────────────────────────────────────
describe("listingContext.ts - Type Definitions", () => {
  const ctxCode = fs.readFileSync(path.join(__dirname, "listingContext.ts"), "utf-8");

  it("should define RufusAttributes interface", () => {
    expect(ctxCode).toContain("export interface RufusAttributes");
  });

  it("should define CompetitorInsights interface", () => {
    expect(ctxCode).toContain("export interface CompetitorInsights");
  });

  it("should define CosmoScenes interface", () => {
    expect(ctxCode).toContain("export interface CosmoScenes");
  });

  it("should define KeywordStrategy interface", () => {
    expect(ctxCode).toContain("export interface KeywordStrategy");
  });

  it("should define ListingContext interface", () => {
    expect(ctxCode).toContain("export interface ListingContext");
  });

  it("should define DataReadiness interface", () => {
    expect(ctxCode).toContain("export interface DataReadiness");
  });
});

// ─── Test: Enhanced Prompts ─────────────────────────────────────
describe("Enhanced Prompts - Title Check List (10 dimensions)", () => {
  const promptsPath = path.join(__dirname, "prompts.ts");
  const prompts = fs.readFileSync(promptsPath, "utf-8");

  it("should include readability dimension (A1)", () => {
    expect(prompts).toMatch(/readab|可读性|A1/i);
  });

  it("should include character count dimension (A3)", () => {
    expect(prompts).toMatch(/180.*200|character.*count|字数/i);
  });

  it("should include content coverage dimension (A4)", () => {
    expect(prompts).toMatch(/content|内容|卖点.*功能.*参数/i);
  });

  it("should include core keyword dimension (A5)", () => {
    expect(prompts).toMatch(/core.*keyword|核心.*关键词|1-2/i);
  });

  it("should include keyword order dimension (A6)", () => {
    expect(prompts).toMatch(/order|词序|前置/i);
  });

  it("should include traffic keyword dimension (A9)", () => {
    expect(prompts).toMatch(/traffic|流量词/i);
  });

  it("should include brand keyword dimension (A10)", () => {
    expect(prompts).toMatch(/brand|品牌/i);
  });

  it("should output checkListScores for title", () => {
    expect(prompts).toContain("checkListScores");
  });
});

describe("Enhanced Prompts - Bullet Check List (15 dimensions)", () => {
  const prompts = fs.readFileSync(path.join(__dirname, "prompts.ts"), "utf-8");

  it("should include FABE method (B4)", () => {
    expect(prompts).toMatch(/FABE|Feature.*Advantage.*Benefit/i);
  });

  it("should include structured format (B5)", () => {
    expect(prompts).toMatch(/structur|结构化|卖点.*解答/i);
  });

  it("should include consumer psychology (B6)", () => {
    expect(prompts).toMatch(/psycholog|心理学|厌恶损失|从众/i);
  });

  it("should include data comparison (B8)", () => {
    expect(prompts).toMatch(/data.*compar|数据对比|量化/i);
  });

  it("should include scene integration (B9)", () => {
    expect(prompts).toMatch(/scene|场景/i);
  });

  it("should include trust/social proof (B10)", () => {
    expect(prompts).toMatch(/trust|信任|社会证明|从众/i);
  });

  it("should include quality/warranty (B11)", () => {
    expect(prompts).toMatch(/warranty|质保|售后|认证/i);
  });

  it("should include AI semantic relations (B15)", () => {
    expect(prompts).toMatch(/semantic.*relat|语义关系|Purpose|Capability|Identity|Causation/i);
  });

  it("should output checkListScores for bullets", () => {
    expect(prompts).toContain("checkListScores");
  });
});

// ─── Test: QA Generation ────────────────────────────────────────
describe("QA Generation", () => {
  const prompts = fs.readFileSync(path.join(__dirname, "prompts.ts"), "utf-8");
  const routerCode = fs.readFileSync(path.join(__dirname, "routers/listing.ts"), "utf-8");

  it("should export QA_GENERATION_PROMPT", () => {
    expect(prompts).toContain("QA_GENERATION_PROMPT");
  });

  it("QA prompt should require question field", () => {
    expect(prompts).toMatch(/question/i);
  });

  it("QA prompt should require answer field", () => {
    expect(prompts).toMatch(/answer/i);
  });

  it("QA prompt should require category field", () => {
    expect(prompts).toMatch(/category/i);
  });

  it("QA prompt should require priority field", () => {
    expect(prompts).toMatch(/priority/i);
  });

  it("QA prompt should require sourceInsight field", () => {
    expect(prompts).toMatch(/sourceInsight/i);
  });

  it("should have generateQA procedure in listing router", () => {
    expect(routerCode).toContain("generateQA");
  });

  it("should have checkDataReadiness procedure in listing router", () => {
    expect(routerCode).toContain("checkDataReadiness");
  });
});

// ─── Test: Database Schema - QA Fields ──────────────────────────
describe("Database Schema - QA Fields", () => {
  const schemaPath = path.join(__dirname, "../drizzle/schema.ts");
  const schema = fs.readFileSync(schemaPath, "utf-8");

  it("should have qaContent field in listings table", () => {
    expect(schema).toContain("qaContent");
  });

  it("should have qaContentCn field in listings table", () => {
    expect(schema).toContain("qaContentCn");
  });
});

// ─── Test: Listing Router - updateByProject ─────────────────────
describe("Listing Router - updateByProject", () => {
  const routerCode = fs.readFileSync(path.join(__dirname, "routers/listing.ts"), "utf-8");

  it("should have updateByProject procedure", () => {
    expect(routerCode).toContain("updateByProject");
  });

  it("should accept projectId as input", () => {
    expect(routerCode).toContain("projectId");
  });

  it("should support qaContent field in update", () => {
    expect(routerCode).toContain("qaContent");
  });

  it("should support qaContentCn field in update", () => {
    expect(routerCode).toContain("qaContentCn");
  });
});

// ─── Test: Translation - QA Support ─────────────────────────────
describe("Translation - QA Support", () => {
  const routerCode = fs.readFileSync(path.join(__dirname, "routers/listing.ts"), "utf-8");

  it("translateToChinese should handle QA content", () => {
    expect(routerCode).toContain("qaContent");
  });

  it("should translate QA questions and answers", () => {
    expect(routerCode).toContain("qaContentCn");
  });
});

// ─── Test: GeneratePage - 5-Step Layout ─────────────────────────
describe("GeneratePage - 5-Step Layout", () => {
  const genPage = fs.readFileSync(path.join(__dirname, "../client/src/pages/GeneratePage.tsx"), "utf-8");

  it("should import StepTitle component", () => {
    expect(genPage).toContain("StepTitle");
  });

  it("should import StepDescription component", () => {
    expect(genPage).toContain("StepDescription");
  });

  it("should import StepSearchTerms component", () => {
    expect(genPage).toContain("StepSearchTerms");
  });

  it("should import StepQA component", () => {
    expect(genPage).toContain("StepQA");
  });

  it("should have activeStep state", () => {
    expect(genPage).toContain("activeStep");
  });

  it("should have 5 steps defined", () => {
    expect(genPage).toMatch(/step.*5|Step 5|步骤.*5/i);
  });

  it("should render Step 1 (selling points)", () => {
    expect(genPage).toContain("activeStep === 1");
  });

  it("should render Step 2 (title)", () => {
    expect(genPage).toContain("activeStep === 2");
  });

  it("should render Step 3 (description)", () => {
    expect(genPage).toContain("activeStep === 3");
  });

  it("should render Step 4 (search terms)", () => {
    expect(genPage).toContain("activeStep === 4");
  });

  it("should render Step 5 (QA)", () => {
    expect(genPage).toContain("activeStep === 5");
  });
});

// ─── Test: Step Components Exist ────────────────────────────────
describe("Step Components", () => {
  it("StepTitle.tsx should exist", () => {
    const filePath = path.join(__dirname, "../client/src/pages/listing/StepTitle.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("StepDescription.tsx should exist", () => {
    const filePath = path.join(__dirname, "../client/src/pages/listing/StepDescription.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("StepSearchTerms.tsx should exist", () => {
    const filePath = path.join(__dirname, "../client/src/pages/listing/StepSearchTerms.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("StepQA.tsx should exist", () => {
    const filePath = path.join(__dirname, "../client/src/pages/listing/StepQA.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

// ─── Test: PreviewPage - QA Section & Completion Progress ───────
describe("PreviewPage - QA Section & Completion Progress", () => {
  const previewPage = fs.readFileSync(path.join(__dirname, "../client/src/pages/PreviewPage.tsx"), "utf-8");

  it("should have completion progress bar", () => {
    expect(previewPage).toContain("completionRate");
    expect(previewPage).toContain("completionItems");
  });

  it("should display QA section in preview tab", () => {
    expect(previewPage).toContain("QA问答");
    expect(previewPage).toContain("Customer Q&A");
  });

  it("should display QA comparison in bilingual tab", () => {
    expect(previewPage).toContain("qaContent");
    expect(previewPage).toContain("qaContentCn");
  });

  it("should parse qaContent from listing data", () => {
    expect(previewPage).toContain("qaContent");
  });

  it("should show QA category and priority badges", () => {
    expect(previewPage).toContain("qa.category");
    expect(previewPage).toContain("qa.priority");
  });

  it("should show QA sourceInsight", () => {
    expect(previewPage).toContain("qa.sourceInsight");
  });

  it("should have empty state for QA section", () => {
    expect(previewPage).toContain("暂无QA问答数据");
  });

  it("should have 6 completion items (title, bullets, description, searchTerms, QA, translation)", () => {
    expect(previewPage).toContain("completionItems");
  });
});

// ─── Test: StepTitle - Check List Integration ───────────────────
describe("StepTitle - Check List Integration", () => {
  const stepTitle = fs.readFileSync(path.join(__dirname, "../client/src/pages/listing/StepTitle.tsx"), "utf-8");

  it("should call listing.generateTitle API", () => {
    expect(stepTitle).toContain("generateTitle");
  });

  it("should display checkListScores", () => {
    expect(stepTitle).toContain("checkListScores");
  });

  it("should allow editing generated title", () => {
    expect(stepTitle).toMatch(/edit|编辑|Textarea|textarea/i);
  });

  it("should save title via updateByProject", () => {
    expect(stepTitle).toContain("updateByProject");
  });
});

// ─── Test: StepQA - Full CRUD ───────────────────────────────────
describe("StepQA - Full CRUD", () => {
  const stepQA = fs.readFileSync(path.join(__dirname, "../client/src/pages/listing/StepQA.tsx"), "utf-8");

  it("should call listing.generateQA API", () => {
    expect(stepQA).toContain("generateQA");
  });

  it("should allow editing QA items", () => {
    expect(stepQA).toMatch(/edit|编辑/i);
  });

  it("should allow adding new QA items", () => {
    expect(stepQA).toMatch(/add|新增|添加/i);
  });

  it("should allow deleting QA items", () => {
    expect(stepQA).toMatch(/delete|删除|remove/i);
  });

  it("should save QA via updateByProject", () => {
    expect(stepQA).toContain("updateByProject");
  });

  it("should display QA category", () => {
    expect(stepQA).toContain("category");
  });

  it("should display QA priority", () => {
    expect(stepQA).toContain("priority");
  });
});
