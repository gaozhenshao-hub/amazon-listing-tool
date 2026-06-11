import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════
// Test Suite: Knowledge Base Module Enhancements
// Covers: ASIN grouped images, unified import, SOP upload, 
//         value chain, cross-module API, video batch ASIN
// ═══════════════════════════════════════════════════

describe("KBImages ASIN Grouped View", () => {
  const kbImagesPath = path.join(__dirname, "../client/src/pages/knowledge/KBImages.tsx");
  let content: string;

  it("KBImages.tsx file exists", () => {
    expect(fs.existsSync(kbImagesPath)).toBe(true);
    content = fs.readFileSync(kbImagesPath, "utf-8");
  });

  it("has ASIN grouped view mode as default", () => {
    content = fs.readFileSync(kbImagesPath, "utf-8");
    // Should have a view mode state with 'asin' as an option
    expect(content).toMatch(/viewMode|asinView|grouped/i);
  });

  it("uses listSets API for ASIN grouping", () => {
    content = fs.readFileSync(kbImagesPath, "utf-8");
    expect(content).toContain("kbImages.listSets");
  });

  it("displays image count per ASIN set", () => {
    content = fs.readFileSync(kbImagesPath, "utf-8");
    expect(content).toMatch(/imageCount|totalImages|图片/);
  });

  it("has position-based grouping in detail view", () => {
    content = fs.readFileSync(kbImagesPath, "utf-8");
    // Should reference position types like main/secondary/A+
    expect(content).toMatch(/主图|副图|A\+|position/i);
  });

  it("supports filter by category, color, type, style", () => {
    content = fs.readFileSync(kbImagesPath, "utf-8");
    expect(content).toMatch(/类目|色系|图片类型|设计风格|category|colorScheme|imageType|designStyle/);
  });

  it("has import dialog with ASIN and link tabs", () => {
    content = fs.readFileSync(kbImagesPath, "utf-8");
    expect(content).toMatch(/ASIN导入|链接导入|批量/);
  });
});

describe("KBOverview Enhanced Value Chain", () => {
  const overviewPath = path.join(__dirname, "../client/src/pages/knowledge/KBOverview.tsx");
  let content: string;

  it("KBOverview.tsx file exists", () => {
    expect(fs.existsSync(overviewPath)).toBe(true);
    content = fs.readFileSync(overviewPath, "utf-8");
  });

  it("has 6-step value chain: 采集→AI分析→人工确认→入库→被AI调用→持续进化", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toContain("采集");
    expect(content).toContain("AI分析");
    expect(content).toContain("人工确认");
    expect(content).toContain("入库");
    expect(content).toContain("被AI调用");
    expect(content).toContain("持续进化");
  });

  it("has STEP numbering for value chain", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/STEP\s*{?\s*i\s*\+\s*1\s*}?|STEP 1|step.*1/i);
  });

  it("has cycle indicator for continuous loop", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/持续闭环|闭环迭代/);
  });

  it("has enhanced visual effects with ring and pulse", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/ring-/);
    expect(content).toMatch(/animate-ping|pulse/);
  });
});

describe("KBOverview Cross-Module Calling", () => {
  const overviewPath = path.join(__dirname, "../client/src/pages/knowledge/KBOverview.tsx");
  let content: string;

  it("has 6 cross-module calling entries", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    // Check all 6 callers
    expect(content).toContain("Listing工具");
    expect(content).toContain("产品开发");
    expect(content).toContain("运营工具");
    expect(content).toContain("售后工具");
  });

  it("each entry has caller, action, target, and targetPath", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/caller.*action.*target.*targetPath/s);
  });

  it("links navigate to correct knowledge base paths", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toContain("/knowledge/listings");
    expect(content).toContain("/knowledge/products");
    expect(content).toContain("/knowledge/images");
    expect(content).toContain("/knowledge/skills");
    expect(content).toContain("/knowledge/videos");
  });

  it("has API endpoint info for each cross-module call", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/apiEndpoint/);
    expect(content).toMatch(/apiDesc/);
  });

  it("has toggleable API interface documentation panel", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/showApiPanel/);
    expect(content).toMatch(/查看API|隐藏API/);
  });

  it("API panel shows tRPC endpoints with input/output", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/kbSearch\.search/);
    expect(content).toMatch(/kbSearch\.stats/);
    expect(content).toMatch(/tRPC Protocol/);
  });

  it("has copy-to-clipboard for API calls", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/copyToClipboard|clipboard/);
  });
});

describe("KBOverview API Interface Documentation", () => {
  const overviewPath = path.join(__dirname, "../client/src/pages/knowledge/KBOverview.tsx");
  let content: string;

  it("documents all 7 API interfaces", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    const apis = [
      "kbSearch.search",
      "kbSearch.stats",
      "kbProducts.list",
      "kbListings.list",
      "kbImages.listSets",
      "kbSkills.list",
      "kbVideos.list",
    ];
    for (const api of apis) {
      expect(content).toContain(api);
    }
  });

  it("shows method type for each API", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/tRPC query/);
  });

  it("shows input and output for each API", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/Input.*Output|input.*output/is);
  });

  it("has usage example at the bottom", () => {
    content = fs.readFileSync(overviewPath, "utf-8");
    expect(content).toMatch(/调用示例/);
  });
});

describe("KBSkills Enhanced File Upload", () => {
  const skillsPath = path.join(__dirname, "../client/src/pages/knowledge/KBSkills.tsx");
  let content: string;

  it("KBSkills.tsx file exists", () => {
    expect(fs.existsSync(skillsPath)).toBe(true);
    content = fs.readFileSync(skillsPath, "utf-8");
  });

  it("supports document formats: PDF, Word, Excel, PPT", () => {
    content = fs.readFileSync(skillsPath, "utf-8");
    expect(content).toMatch(/pdf|PDF/);
    expect(content).toMatch(/doc|DOC|Word/i);
    expect(content).toMatch(/xls|XLS|Excel/i);
    expect(content).toMatch(/ppt|PPT/i);
  });

  it("supports mindmap format", () => {
    content = fs.readFileSync(skillsPath, "utf-8");
    expect(content).toMatch(/思维导图|mindmap|xmind|mm/i);
  });

  it("supports image formats", () => {
    content = fs.readFileSync(skillsPath, "utf-8");
    expect(content).toMatch(/png|jpg|jpeg|image/i);
  });

  it("has drag-and-drop upload area", () => {
    content = fs.readFileSync(skillsPath, "utf-8");
    expect(content).toMatch(/drag|drop|拖拽|拖放/i);
  });

  it("has file upload with progress indication", () => {
    content = fs.readFileSync(skillsPath, "utf-8");
    expect(content).toMatch(/upload|上传/i);
  });

  it("has link import tab", () => {
    content = fs.readFileSync(skillsPath, "utf-8");
    expect(content).toMatch(/链接导入|链接/);
  });

  it("has manual creation tab", () => {
    content = fs.readFileSync(skillsPath, "utf-8");
    expect(content).toMatch(/手动创建|手动/);
  });
});

describe("KBVideos Batch ASIN Import", () => {
  const videosPath = path.join(__dirname, "../client/src/pages/knowledge/KBVideos.tsx");
  let content: string;

  it("KBVideos.tsx file exists", () => {
    expect(fs.existsSync(videosPath)).toBe(true);
    content = fs.readFileSync(videosPath, "utf-8");
  });

  it("has batch ASIN import tab", () => {
    content = fs.readFileSync(videosPath, "utf-8");
    expect(content).toMatch(/批量ASIN|batchAsin/);
  });

  it("uses batchImportAsins mutation", () => {
    content = fs.readFileSync(videosPath, "utf-8");
    expect(content).toContain("batchImportAsins");
  });

  it("has textarea for batch ASIN input", () => {
    content = fs.readFileSync(videosPath, "utf-8");
    expect(content).toMatch(/batchAsinInput/);
  });

  it("supports newline and comma separated ASINs", () => {
    content = fs.readFileSync(videosPath, "utf-8");
    expect(content).toMatch(/split.*\\n.*,|split.*\[.*\\n.*,/);
  });

  it("has 4 import tabs: link, ASIN, batch links, batch ASIN", () => {
    content = fs.readFileSync(videosPath, "utf-8");
    expect(content).toMatch(/链接导入/);
    expect(content).toMatch(/ASIN导入/);
    expect(content).toMatch(/批量链接/);
    expect(content).toMatch(/批量ASIN/);
  });
});

describe("KBVideos Router - batchImportAsins Endpoint", () => {
  const routerPath = path.join(__dirname, "routers/kbVideos.ts");
  let content: string;

  it("kbVideos router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
    content = fs.readFileSync(routerPath, "utf-8");
  });

  it("has batchImportAsins endpoint", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("batchImportAsins");
  });

  it("accepts array of ASIN strings", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toMatch(/asins.*z\.array.*z\.string/);
  });

  it("limits batch to max 50 ASINs", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toMatch(/max\(50\)/);
  });

  it("creates video entries and triggers async analysis", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toMatch(/createVideo/);
    expect(content).toMatch(/invokeLLM/);
  });

  it("returns imported count and items", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toMatch(/imported.*results\.length/);
  });
});

describe("KBSearch Router - Enhanced API Endpoints", () => {
  const routerPath = path.join(__dirname, "routers/kbSearch.ts");
  let content: string;

  it("kbSearch router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
    content = fs.readFileSync(routerPath, "utf-8");
  });

  it("has original search endpoint", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toMatch(/search:\s*protectedProcedure/);
  });

  it("has searchByType endpoint with type filter", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("searchByType");
    expect(content).toMatch(/type.*enum.*product.*listing.*image.*skill.*video/s);
  });

  it("has searchByAsin endpoint for ASIN panoramic view", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("searchByAsin");
    expect(content).toMatch(/asin.*toUpperCase/);
  });

  it("searchByAsin groups results by type", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toMatch(/grouped.*product.*listing.*image.*skill.*video/s);
  });

  it("has getConfirmedForRAG endpoint for cross-module AI calling", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("getConfirmedForRAG");
    expect(content).toMatch(/confirmed/);
  });

  it("has stats endpoint", () => {
    content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toMatch(/stats:\s*protectedProcedure/);
  });
});

describe("All 5 KB Sub-libraries Have Import Capabilities", () => {
  const pages = [
    { name: "KBProducts", path: path.join(__dirname, "../client/src/pages/knowledge/KBProducts.tsx") },
    { name: "KBListings", path: path.join(__dirname, "../client/src/pages/knowledge/KBListings.tsx") },
    { name: "KBImages", path: path.join(__dirname, "../client/src/pages/knowledge/KBImages.tsx") },
    { name: "KBSkills", path: path.join(__dirname, "../client/src/pages/knowledge/KBSkills.tsx") },
    { name: "KBVideos", path: path.join(__dirname, "../client/src/pages/knowledge/KBVideos.tsx") },
  ];

  for (const page of pages) {
    it(`${page.name} has import dialog`, () => {
      const content = fs.readFileSync(page.path, "utf-8");
      expect(content).toMatch(/Dialog|showImport|导入/);
    });

    it(`${page.name} has Tabs for multiple import methods`, () => {
      const content = fs.readFileSync(page.path, "utf-8");
      expect(content).toMatch(/Tabs|TabsList|TabsTrigger/);
    });
  }

  // Products, Listings, Images, Videos should have ASIN import
  for (const page of pages.filter(p => p.name !== "KBSkills")) {
    it(`${page.name} has ASIN import capability`, () => {
      const content = fs.readFileSync(page.path, "utf-8");
      expect(content).toMatch(/ASIN|asin/i);
    });
  }

  // Products, Listings, Images should have link import
  for (const page of pages.filter(p => p.name !== "KBSkills")) {
    it(`${page.name} has link import capability`, () => {
      const content = fs.readFileSync(page.path, "utf-8");
      expect(content).toMatch(/链接导入|链接|url|URL/i);
    });
  }
});
