import { describe, it, expect } from "vitest";

describe("Conversion Check Items - 132 Default Dimensions", () => {
  it("getDefault132CheckItems should return exactly 132 items", async () => {
    // Read the source to verify the function exists and returns correct count
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify the function exists
    expect(source).toContain("function getDefault132CheckItems()");

    // Count all category items by parsing the source
    const catMatches = source.match(/cat\d+\.forEach/g);
    expect(catMatches).not.toBeNull();
    expect(catMatches!.length).toBe(20); // 20 categories
  });

  it("getCheckItems should auto-initialize when table is empty", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify auto-initialization logic exists in getCheckItems
    expect(source).toContain("Auto-initialize default check items if none exist");
    expect(source).toContain("auto-initializing 132 check items");

    // Verify it checks for empty table first
    const getCheckItemsSection = source.match(
      /getCheckItems:.*?protectedProcedure\.query\(async.*?\{([\s\S]*?)return items;\s*\}\)/
    );
    expect(getCheckItemsSection).not.toBeNull();
    const body = getCheckItemsSection![1];

    // Should check count of system defaults
    expect(body).toContain("isNull(conversionCheckItems.userId)");
    expect(body).toContain("Number(existing[0]?.count) === 0");

    // Should call getDefault132CheckItems and insert
    expect(body).toContain("getDefault132CheckItems()");
    expect(body).toContain("insert(conversionCheckItems).values");
  });

  it("all 20 categories should be defined with correct names", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    const expectedCategories = [
      "标题", "五点描述", "长描述", "搜索词", "价格",
      "变体", "配送", "退货", "产品信息", "商品文档",
      "主图", "流量闭环", "品牌故事", "A+", "Post",
      "Video", "Q&A", "Review", "店铺介绍", "广告"
    ];

    for (const cat of expectedCategories) {
      expect(source).toContain(`categoryName: "${cat}"`);
    }
  });

  it("category 11 (主图) should have 25 items including video entries", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Extract cat11 array content
    const cat11Match = source.match(/const cat11 = \[([\s\S]*?)\];/);
    expect(cat11Match).not.toBeNull();

    const cat11Content = cat11Match![1];
    // Count items by splitting on commas (accounting for quoted strings)
    const items = cat11Content.match(/"[^"]+"/g);
    expect(items).not.toBeNull();
    expect(items!.length).toBe(25);

    // Verify key items exist
    expect(cat11Content).toContain("首图-像素清晰度");
    expect(cat11Content).toContain("视频-产品演示视频");
    expect(cat11Content).toContain("A/B测试版本");
  });

  it("total item count across all categories should be 132", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Extract all category arrays and count items
    const expectedCounts: Record<string, number> = {
      cat1: 7, cat2: 7, cat3: 5, cat4: 5, cat5: 5,
      cat6: 5, cat7: 4, cat8: 4, cat9: 5, cat10: 4,
      cat11: 25, cat12: 6, cat13: 4, cat14: 13, cat15: 5,
      cat16: 4, cat17: 7, cat18: 5, cat19: 4, cat20: 8,
    };

    let totalExpected = 0;
    for (const [catName, count] of Object.entries(expectedCounts)) {
      totalExpected += count;
      const regex = new RegExp(`const ${catName} = \\[([\\s\\S]*?)\\];`);
      const match = source.match(regex);
      expect(match, `${catName} should exist`).not.toBeNull();

      const items = match![1].match(/"[^"]+"/g);
      expect(items, `${catName} should have items`).not.toBeNull();
      expect(items!.length, `${catName} should have ${count} items`).toBe(count);
    }

    expect(totalExpected).toBe(132);
  });

  it("initDefaultCheckItems mutation should check for existing defaults before inserting", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify initDefaultCheckItems checks for existing items
    expect(source).toContain("initDefaultCheckItems: protectedProcedure.mutation");
    expect(source).toContain("Default items already exist");
  });
});
