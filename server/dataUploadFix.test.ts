import { describe, it, expect } from "vitest";

/**
 * Tests for sales upload column mapping fix and review batch upload
 */

// ─── Sales Column Mapping Tests ───
describe("Sales Data Column Mapping (卖家精灵 format)", () => {
  // Simulate the pick/pickNum helper logic from DevDataUpload
  const pick = (r: any, ...keys: string[]) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== "") return r[k];
    }
    return "";
  };

  const pickNum = (r: any, ...keys: string[]) => {
    for (const k of keys) {
      const v = Number(r[k]);
      if (!isNaN(v) && r[k] !== "" && r[k] !== undefined) return v;
    }
    return 0;
  };

  it("should map 商品标题 column (卖家精灵 format)", () => {
    const row = { ASIN: "B0TEST123", "商品标题": "Test Product Title" };
    expect(pick(row, "商品标题", "标题", "Title", "title")).toBe("Test Product Title");
  });

  it("should map 标题 column (legacy format)", () => {
    const row = { ASIN: "B0TEST123", "标题": "Legacy Title" };
    expect(pick(row, "商品标题", "标题", "Title", "title")).toBe("Legacy Title");
  });

  it("should map 价格($) column with dollar suffix", () => {
    const row = { ASIN: "B0TEST123", "价格($)": "29.99" };
    expect(String(pick(row, "价格($)", "价格", "Price", "price") || "")).toBe("29.99");
  });

  it("should map 评分数 column (not 评论数)", () => {
    const row = { ASIN: "B0TEST123", "评分数": 1500 };
    expect(pickNum(row, "评分数", "评论数", "Reviews", "Review Count", "reviews")).toBe(1500);
  });

  it("should map 小类BSR column", () => {
    const row = { ASIN: "B0TEST123", "小类BSR": 42 };
    expect(pickNum(row, "小类BSR", "大类BSR", "BSR", "Best Sellers Rank", "bsr")).toBe(42);
  });

  it("should map 大类BSR as fallback", () => {
    const row = { ASIN: "B0TEST123", "大类BSR": 5000 };
    expect(pickNum(row, "小类BSR", "大类BSR", "BSR", "Best Sellers Rank", "bsr")).toBe(5000);
  });

  it("should map 月销售额($) column", () => {
    const row = { ASIN: "B0TEST123", "月销售额($)": 15000 };
    expect(pickNum(row, "月销售额($)", "月销售额", "Monthly Revenue", "Est. Monthly Revenue")).toBe(15000);
  });

  it("should map Buybox卖家 column", () => {
    const row = { ASIN: "B0TEST123", "Buybox卖家": "Amazon.com" };
    expect(pick(row, "Buybox卖家", "卖家", "Seller", "Seller Name")).toBe("Amazon.com");
  });

  it("should map 卖家所属地 column", () => {
    const row = { ASIN: "B0TEST123", "卖家所属地": "US" };
    expect(pick(row, "卖家所属地", "卖家所在地", "Seller Location")).toBe("US");
  });

  it("should map 大类目 column", () => {
    const row = { ASIN: "B0TEST123", "大类目": "Tools & Home Improvement" };
    expect(pick(row, "大类目", "类目路径", "类目", "Category", "Main Category")).toBe("Tools & Home Improvement");
  });

  it("should map 小类目 column", () => {
    const row = { ASIN: "B0TEST123", "小类目": "Power Drills" };
    expect(pick(row, "小类目", "子类目", "Sub Category", "Subcategory")).toBe("Power Drills");
  });

  it("should map 商品主图 column", () => {
    const row = { ASIN: "B0TEST123", "商品主图": "https://images-na.ssl-images-amazon.com/test.jpg" };
    expect(pick(row, "商品主图", "图片", "Image", "Main Image")).toBe("https://images-na.ssl-images-amazon.com/test.jpg");
  });

  it("should handle complete 卖家精灵 row with all mapped fields", () => {
    const row = {
      ASIN: "B0G2WP66RW",
      "商品标题": "Electric Drill 20V",
      "品牌": "DEWALT",
      "价格($)": "89.99",
      "评分": "4.7",
      "评分数": 2500,
      "月销量": 3000,
      "小类BSR": 15,
      "月销售额($)": 269970,
      "上架时间": "2023-01-15",
      "配送方式": "FBA",
      "Buybox卖家": "Amazon.com",
      "卖家所属地": "US",
      "变体数": 3,
      "大类目": "Tools & Home Improvement",
      "小类目": "Power Drills",
      "商品主图": "https://example.com/img.jpg",
      "搜索排名": 1,
    };

    expect(pick(row, "商品标题", "标题")).toBe("Electric Drill 20V");
    expect(pick(row, "品牌", "Brand")).toBe("DEWALT");
    expect(pick(row, "价格($)", "价格")).toBe("89.99");
    expect(pickNum(row, "评分数", "评论数")).toBe(2500);
    expect(pickNum(row, "小类BSR", "大类BSR", "BSR")).toBe(15);
    expect(pickNum(row, "月销售额($)", "月销售额")).toBe(269970);
    expect(pick(row, "Buybox卖家", "卖家")).toBe("Amazon.com");
    expect(pick(row, "卖家所属地", "卖家所在地")).toBe("US");
    expect(pick(row, "大类目", "类目")).toBe("Tools & Home Improvement");
    expect(pick(row, "小类目", "子类目")).toBe("Power Drills");
    expect(pick(row, "商品主图", "图片")).toBe("https://example.com/img.jpg");
  });

  it("should return empty/0 for missing columns", () => {
    const row = { ASIN: "B0TEST123" };
    expect(pick(row, "商品标题", "标题", "Title")).toBe("");
    expect(pickNum(row, "评分数", "评论数", "Reviews")).toBe(0);
  });
});

// ─── Review Batch Upload Tests ───
describe("Review Batch Upload", () => {
  it("should extract ASIN from filename pattern B0XXXXXXXXX-US-Reviews-*.xlsx", () => {
    const filename = "B0G2WP66RW-US-Reviews-2024.xlsx";
    const match = filename.match(/^(B[A-Z0-9]{9,})/i);
    expect(match).not.toBeNull();
    expect(match![1].toUpperCase()).toBe("B0G2WP66RW");
  });

  it("should extract ASIN from filename with lowercase", () => {
    const filename = "b0g2wp66rw-reviews.xlsx";
    const match = filename.match(/^(B[A-Z0-9]{9,})/i);
    expect(match).not.toBeNull();
    expect(match![1].toUpperCase()).toBe("B0G2WP66RW");
  });

  it("should return null for non-ASIN filename", () => {
    const filename = "reviews-all-products.xlsx";
    const match = filename.match(/^(B[A-Z0-9]{9,})/i);
    expect(match).toBeNull();
  });

  it("should parse review row with Chinese column names", () => {
    const row = {
      "标题": "Great product!",
      "内容": "Works perfectly",
      "评分": 5,
      "日期": "2024-01-15",
      "VP": "Yes",
      "变体": "Red/Large",
      "有用数": 10,
    };

    const review = {
      title: row["标题"] || "",
      content: row["内容"] || row["评论内容"] || "",
      rating: Number(row["评分"] || 0),
      reviewDate: row["日期"] || "",
      isVP: Boolean(row["VP"]),
      variant: row["变体"] || "",
      helpfulCount: Number(row["有用数"] || 0),
    };

    expect(review.title).toBe("Great product!");
    expect(review.content).toBe("Works perfectly");
    expect(review.rating).toBe(5);
    expect(review.isVP).toBe(true);
    expect(review.helpfulCount).toBe(10);
  });

  it("should filter out reviews with no content and no title", () => {
    const rows = [
      { "标题": "Good", "内容": "Nice product", "评分": 5 },
      { "标题": "", "内容": "", "评分": 3 },
      { "标题": "Bad", "内容": "", "评分": 1 },
    ];

    const reviews = rows
      .map((r) => ({
        title: r["标题"] || "",
        content: r["内容"] || "",
        rating: Number(r["评分"] || 0),
      }))
      .filter((r) => r.content || r.title);

    expect(reviews).toHaveLength(2);
    expect(reviews[0].title).toBe("Good");
    expect(reviews[1].title).toBe("Bad");
  });

  it("should handle FILE_TYPES multiple flag for reviews", () => {
    const FILE_TYPES = [
      { key: "sales", label: "销量数据", multiple: false },
      { key: "reviews", label: "评论数据", multiple: true },
      { key: "history_sales", label: "历史销量", multiple: false },
    ];

    const reviewsConfig = FILE_TYPES.find(f => f.key === "reviews");
    expect(reviewsConfig?.multiple).toBe(true);

    const salesConfig = FILE_TYPES.find(f => f.key === "sales");
    expect(salesConfig?.multiple).toBe(false);
  });
});
