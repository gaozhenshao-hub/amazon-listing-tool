import { describe, it, expect } from "vitest";

describe("PreviewPage Unicode and legacy export closure", () => {
  it("should retain UTF-8 Chinese UI text and explain that legacy CSV/report downloads are paused", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    // Check that common Chinese UI strings are present as actual characters
    expect(content).toContain("结果预览");
    expect(content).toContain("工作台步骤锁定状态");
    expect(content).toContain("已锁定");
    expect(content).toContain("待完善");
    expect(content).toContain("直接下载报告/CSV与旧产物指针选版已暂停");
    // Should not have excessive unicode escapes (a few for special chars like ✓ are OK)
    const unicodeEscapes = content.match(/\\u[0-9a-fA-F]{4}/g) || [];
    // Allow some for special symbols, but should be less than 20
    expect(unicodeEscapes.length).toBeLessThan(20);
  });
});

describe("Legacy browser export is closed", () => {
  it("should not expose the retired browser Listing-pack export", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(content).not.toContain("handleExportListingPack");
    expect(content).not.toContain("导出Listing包");
    expect(content).toContain("旧报告与浏览器本地CSV无法验证当前完整人审快照，暂不提供下载");
  });

  it("should not retain browser CSV/BOM generation after export closure", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(content).not.toContain("text/csv;charset=utf-8");
    expect(content).not.toContain("Listing_Pack_");
    expect(content).not.toContain("\\uFEFF");
  });
});

describe("Preview Listing content display", () => {
  it("should render all Listing sections: title, bullets, description, searchTerms, QA", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(content).toContain("Title");
    expect(content).toContain("Bullet Point");
    expect(content).toContain("Description");
    expect(content).toContain("Search Terms");
    expect(content).toContain("Q&A");
  });

  it("should render both EN and CN Listing content", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(content).toContain("EN");
    expect(content).toContain("CN");
    expect(content).toContain("listing.titleCn");
    expect(content).toContain("bulletPointsCnArray");
    expect(content).toContain("qaContentCn");
  });
});

describe("Step 1 Locked Content Display from DB", () => {
  it("should load bullet content from activeListing when generatedBullets is empty", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/GeneratePage.tsx", "utf-8");
    // Should have fallback to activeListing.bulletPoints
    expect(content).toContain("activeListing?.bulletPoints");
    expect(content).toContain("savedBullets");
    // Should handle both string and object bullet formats
    expect(content).toContain("typeof bp === \"string\"");
    expect(content).toContain("typeof bp === \"object\"");
  });

  it("should show bullet count from saved data", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/GeneratePage.tsx", "utf-8");
    expect(content).toContain("savedBullets.length");
    expect(content).toContain("条卖点已同步到预览页");
  });

  it("should show fallback message when no bullets available", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/GeneratePage.tsx", "utf-8");
    expect(content).toContain("卖点数据已同步到预览页");
  });
});

describe("Step 2-5 Unlock Auto-Fill", () => {
  it("StepTitle should auto-fill editing area on unlock", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/listing/StepTitle.tsx", "utf-8");
    expect(content).toContain("savedContent");
    expect(content).toContain("setEditingTitle(savedContent)");
    expect(content).toContain("setCandidates");
  });

  it("StepDescription should auto-fill on unlock", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/listing/StepDescription.tsx", "utf-8");
    expect(content).toContain("savedContent");
    expect(content).toContain("setDescription(savedContent)");
    expect(content).toContain("setGenerated(true)");
  });

  it("StepSearchTerms should auto-fill on unlock", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/listing/StepSearchTerms.tsx", "utf-8");
    expect(content).toContain("savedContent");
    expect(content).toContain("setSearchTerms(savedContent)");
    expect(content).toContain("setGenerated(true)");
  });

  it("StepQA should auto-fill on unlock", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/listing/StepQA.tsx", "utf-8");
    expect(content).toContain("savedQaItems");
    expect(content).toContain("setQaItems(savedQaItems)");
    expect(content).toContain("setGenerated(true)");
  });
});

describe("Preview Page Lock Progress Bar", () => {
  it("should display step lock progress bar", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(content).toContain("工作台步骤锁定状态");
    expect(content).toContain("lockedCount");
    expect(content).toContain("allLocked");
    expect(content).toContain("STEP_LABELS");
  });

  it("should show jump link for unlocked steps", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(content).toContain("/listing/generate");
    expect(content).toContain("ArrowUpRight");
  });
});

describe("Defensive JSON Parsing", () => {
  it("should have Array.isArray checks for imageAdvice parsing", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    // imageAdvice should check it's an object, not array
    expect(content).toContain("Array.isArray(parsed)");
    expect(content).toContain("typeof parsed !== 'object'");
  });

  it("should have Array.isArray checks for qaContent parsing", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    expect(content).toContain("Array.isArray(parsed) ? parsed : null");
  });

  it("should guard array property accesses with Array.isArray", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/PreviewPage.tsx", "utf-8");
    // Check for defensive guards on nested array properties
    expect(content).toContain("Array.isArray");
  });
});
