import { describe, it, expect } from "vitest";

describe("Conversion Check Items - 129 Default Dimensions (Excel-based, no Post)", () => {
  it("getDefault129CheckItems should return exactly 129 items", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify the function exists
    expect(source).toContain("function getDefault129CheckItems()");

    // Count all items.push calls within the function
    const funcStart = source.indexOf("function getDefault129CheckItems()");
    const funcEnd = source.indexOf("return items;\n}", funcStart);
    const funcBody = source.substring(funcStart, funcEnd);
    const pushCalls = funcBody.match(/items\.push\(/g);
    expect(pushCalls).not.toBeNull();
    expect(pushCalls!.length).toBe(129);
  });

  it("should have exactly 18 categories (no Post category)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    const expectedCategories = [
      "标题", "五点", "标", "价格", "限购",
      "配送", "变体", "产品信息", "商品文档", "主图",
      "流量闭环", "品牌故事", "A+", "Video",
      "Q&A", "Review", "店铺介绍页面", "广告"
    ];

    for (const cat of expectedCategories) {
      expect(source).toContain(`categoryName: "${cat}"`);
    }

    // Post should NOT exist as a check item category
    expect(source).not.toContain('categoryName: "Post"');
  });

  it("each category should have correct item count", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    const funcStart = source.indexOf("function getDefault129CheckItems()");
    const funcEnd = source.indexOf("return items;\n}", funcStart);
    const funcBody = source.substring(funcStart, funcEnd);

    const expectedCounts: Record<string, number> = {
      "标题": 10, "五点": 15, "标": 6, "价格": 11, "限购": 3,
      "配送": 3, "变体": 5, "产品信息": 3, "商品文档": 2, "主图": 22,
      "流量闭环": 6, "品牌故事": 4, "A+": 13, "Video": 4,
      "Q&A": 7, "Review": 5, "店铺介绍页面": 2, "广告": 8,
    };

    let total = 0;
    for (const [catName, expectedCount] of Object.entries(expectedCounts)) {
      const escapedName = catName.replace(/[+&]/g, "\\$&");
      const regex = new RegExp(`categoryName: "${escapedName}"`, "g");
      const matches = funcBody.match(regex);
      expect(matches, `${catName} should have items`).not.toBeNull();
      expect(matches!.length, `${catName} should have ${expectedCount} items`).toBe(expectedCount);
      total += expectedCount;
    }

    expect(total).toBe(129);
  });

  it("主图 category should have 首图(6), 辅图(13), 视频(3), 季节版(1) sub-dimensions", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    const funcStart = source.indexOf("function getDefault129CheckItems()");
    const funcEnd = source.indexOf("return items;\n}", funcStart);
    const funcBody = source.substring(funcStart, funcEnd);

    // Count 首图 items within 主图 category
    const shoutuMatches = funcBody.match(/categoryName: "主图", subDimension: "首图"/g);
    expect(shoutuMatches).not.toBeNull();
    expect(shoutuMatches!.length).toBe(6);

    // Count 辅图 items
    const futuMatches = funcBody.match(/categoryName: "主图", subDimension: "辅图"/g);
    expect(futuMatches).not.toBeNull();
    expect(futuMatches!.length).toBe(12);

    // Count 视频 items
    const videoMatches = funcBody.match(/categoryName: "主图", subDimension: "视频"/g);
    expect(videoMatches).not.toBeNull();
    expect(videoMatches!.length).toBe(3);

    // Count 季节版 items
    const seasonMatches = funcBody.match(/categoryName: "主图", subDimension: "季节版、假日版、大促版"/g);
    expect(seasonMatches).not.toBeNull();
    expect(seasonMatches!.length).toBe(1);
  });

  it("价格 category should have 11 detailed items including multiple 定价策略", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    const funcStart = source.indexOf("function getDefault129CheckItems()");
    const funcEnd = source.indexOf("return items;\n}", funcStart);
    const funcBody = source.substring(funcStart, funcEnd);

    // 定价策略 should have 6 sub-items
    const pricingMatches = funcBody.match(/categoryName: "价格", subDimension: "定价策略"/g);
    expect(pricingMatches).not.toBeNull();
    expect(pricingMatches!.length).toBe(6);

    // Other price items
    expect(funcBody).toContain('subDimension: "划线价格"');
    expect(funcBody).toContain('subDimension: "价格组合"');
    expect(funcBody).toContain('subDimension: "单只价格"');
    expect(funcBody).toContain('subDimension: "购物车价格"');
    expect(funcBody).toContain('subDimension: "高/低客单价区间对价格的敏感度"');
  });

  it("getCheckItems should auto-initialize when table is empty", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify auto-initialization logic exists in getCheckItems
    expect(source).toContain("Auto-initialize default check items if none exist");

    const getCheckItemsStart = source.indexOf("getCheckItems: protectedProcedure");
    const getCheckItemsEnd = source.indexOf("initDefaultCheckItems:");
    expect(getCheckItemsStart).toBeGreaterThan(-1);
    expect(getCheckItemsEnd).toBeGreaterThan(getCheckItemsStart);
    const body = source.substring(getCheckItemsStart, getCheckItemsEnd);

    expect(body).toContain("isNull(conversionCheckItems.userId)");
    expect(body).toContain("Number(existing[0]?.count) === 0");
    expect(body).toContain("getDefault129CheckItems()");
    expect(body).toContain("insert(conversionCheckItems).values");
    expect(body).toContain("includeHidden");
    expect(body).toContain("filter(item => !item.isHidden)");
  });

  it("key check items from Excel should exist with correct standards", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify specific items from Excel
    expect(source).toContain('subDimension: "FABE法则"');
    expect(source).toContain('subDimension: "易于AI理解"');
    expect(source).toContain('subDimension: "叠加效应"');
    expect(source).toContain('subDimension: "划线价格"');
    expect(source).toContain('subDimension: "vine"');
    expect(source).toContain('subDimension: "关键数据跟踪"');

    // Verify standards contain Excel content
    expect(source).toContain("used for, capable of, is a, cause");
    expect(source).toContain("FBA优于FBM");
    
    // Verify 主图 detailed standards from Excel
    expect(source).toContain("图片像素、清晰度、留白比例");
    expect(source).toContain("一图一卖点，展示尽可能全面");
    expect(source).toContain("品牌调性一致");
  });

  it("initDefaultCheckItems mutation should check for existing defaults before inserting", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    expect(source).toContain("initDefaultCheckItems: protectedProcedure.mutation");
    expect(source).toContain("Default items already exist");
  });
});
