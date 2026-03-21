import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// ─── Mock kbIntel router input schemas ───────────────────────
describe("kbIntel Router", () => {
  describe("Input Validation", () => {
    const addSourceSchema = z.object({
      name: z.string().min(1).max(100),
      sourceType: z.enum(["amazon_news", "wearesellers", "media", "custom_url", "rss"]),
      url: z.string().url().optional(),
      crawlFrequency: z.enum(["manual", "daily", "weekly"]).default("manual"),
      qualityThreshold: z.number().min(0).max(10).default(6),
    });

    it("should validate addSource with valid input", () => {
      const input = {
        name: "亚马逊新闻",
        sourceType: "amazon_news" as const,
        url: "https://example.com/feed",
        crawlFrequency: "daily" as const,
        qualityThreshold: 7,
      };
      const result = addSourceSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject addSource with empty name", () => {
      const input = {
        name: "",
        sourceType: "custom_url" as const,
        url: "https://example.com",
      };
      const result = addSourceSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject addSource with invalid sourceType", () => {
      const input = {
        name: "Test",
        sourceType: "invalid_type",
      };
      const result = addSourceSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should default crawlFrequency to manual", () => {
      const input = {
        name: "Test Source",
        sourceType: "rss" as const,
      };
      const result = addSourceSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.crawlFrequency).toBe("manual");
      }
    });

    it("should default qualityThreshold to 6", () => {
      const input = {
        name: "Test Source",
        sourceType: "media" as const,
      };
      const result = addSourceSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.qualityThreshold).toBe(6);
      }
    });

    it("should reject qualityThreshold out of range", () => {
      const input = {
        name: "Test",
        sourceType: "rss" as const,
        qualityThreshold: 15,
      };
      const result = addSourceSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("triggerCrawl Input Validation", () => {
    const triggerCrawlSchema = z.object({
      sourceId: z.number(),
      articles: z.array(z.object({
        title: z.string().min(1),
        originalUrl: z.string().url(),
        rawContent: z.string().min(10),
        author: z.string().optional(),
      })).min(1).max(20),
    });

    it("should validate triggerCrawl with valid articles", () => {
      const input = {
        sourceId: 1,
        articles: [{
          title: "亚马逊FBA新政策解读",
          originalUrl: "https://example.com/article/1",
          rawContent: "这是一篇关于亚马逊FBA新政策的详细解读文章，包含了最新的费用变化和操作指南...",
          author: "张三",
        }],
      };
      const result = triggerCrawlSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject empty articles array", () => {
      const input = {
        sourceId: 1,
        articles: [],
      };
      const result = triggerCrawlSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject articles with too short rawContent", () => {
      const input = {
        sourceId: 1,
        articles: [{
          title: "Test",
          originalUrl: "https://example.com/1",
          rawContent: "短内容",
        }],
      };
      const result = triggerCrawlSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject more than 20 articles", () => {
      const articles = Array.from({ length: 21 }, (_, i) => ({
        title: `Article ${i}`,
        originalUrl: `https://example.com/${i}`,
        rawContent: "这是一篇足够长的文章内容，用于测试批量提交限制功能。",
      }));
      const input = { sourceId: 1, articles };
      const result = triggerCrawlSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("adoptItem Input Validation", () => {
    const adoptItemSchema = z.object({
      itemId: z.number(),
      targetKbType: z.enum(["sop", "listing", "product", "image", "video"]),
      editedContent: z.record(z.string(), z.unknown()).optional(),
    });

    it("should validate adoptItem with valid input", () => {
      const input = {
        itemId: 42,
        targetKbType: "sop" as const,
        editedContent: {
          title: "FBA发货操作指南",
          steps: [{ stepNo: 1, title: "准备", description: "准备发货清单" }],
        },
      };
      const result = adoptItemSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate adoptItem without editedContent", () => {
      const input = {
        itemId: 42,
        targetKbType: "listing" as const,
      };
      const result = adoptItemSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject invalid targetKbType", () => {
      const input = {
        itemId: 42,
        targetKbType: "invalid",
      };
      const result = adoptItemSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("listItems Input Validation", () => {
    const listItemsSchema = z.object({
      status: z.enum(["pending", "recommended", "adopted", "ignored", "expired", "bookmarked"]).optional(),
      sourceId: z.number().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
    });

    it("should validate listItems with defaults", () => {
      const input = {};
      const result = listItemsSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(20);
      }
    });

    it("should validate listItems with all filters", () => {
      const input = {
        status: "recommended" as const,
        sourceId: 5,
        page: 2,
        pageSize: 10,
      };
      const result = listItemsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject pageSize > 50", () => {
      const input = { pageSize: 100 };
      const result = listItemsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("AI Quality Evaluation Logic", () => {
    it("should calculate weighted score correctly", () => {
      const scores = {
        relevance: { score: 8, reason: "高度相关" },
        accuracy: { score: 7, reason: "基本准确" },
        actionability: { score: 9, reason: "可操作性强" },
        timeliness: { score: 6, reason: "时效性一般" },
        depth: { score: 7, reason: "深度适中" },
      };

      const weights: Record<string, number> = {
        relevance: 0.3,
        accuracy: 0.25,
        actionability: 0.2,
        timeliness: 0.15,
        depth: 0.1,
      };

      const weightedTotal = Object.entries(scores).reduce((sum, [key, val]) => {
        return sum + val.score * (weights[key] || 0);
      }, 0);

      // 8*0.3 + 7*0.25 + 9*0.2 + 6*0.15 + 7*0.1 = 2.4+1.75+1.8+0.9+0.7 = 7.55
      expect(weightedTotal).toBeCloseTo(7.55, 1);
    });

    it("should filter items below quality threshold", () => {
      const threshold = 6;
      const items = [
        { id: 1, score: 8.5, status: "recommended" },
        { id: 2, score: 4.2, status: "pending" },
        { id: 3, score: 6.0, status: "recommended" },
        { id: 4, score: 5.9, status: "pending" },
      ];

      const recommended = items.filter(i => i.score >= threshold);
      expect(recommended).toHaveLength(2);
      expect(recommended.map(i => i.id)).toEqual([1, 3]);
    });
  });

  describe("SOP Format Structure", () => {
    it("should validate SOP format structure", () => {
      const sopSchema = z.object({
        title: z.string(),
        level: z.enum(["beginner", "intermediate", "advanced"]),
        businessModule: z.string(),
        applicableScene: z.string(),
        prerequisites: z.string(),
        steps: z.array(z.object({
          stepNo: z.number(),
          title: z.string(),
          description: z.string(),
          tips: z.string().optional(),
        })),
        keyMetrics: z.array(z.string()),
        faq: z.array(z.object({
          question: z.string(),
          answer: z.string(),
        })),
        referenceSource: z.string().optional(),
        referenceUrl: z.string().optional(),
      });

      const validSop = {
        title: "FBA发货操作指南",
        level: "beginner" as const,
        businessModule: "物流管理",
        applicableScene: "首次使用FBA发货的卖家",
        prerequisites: "已注册亚马逊卖家账户，已创建商品listing",
        steps: [
          { stepNo: 1, title: "创建发货计划", description: "登录卖家后台，选择库存管理", tips: "建议提前准备好SKU清单" },
          { stepNo: 2, title: "打印标签", description: "下载并打印FNSKU标签", tips: "使用热敏打印机效果更好" },
        ],
        keyMetrics: ["发货时效", "库存周转率", "IPI分数"],
        faq: [
          { question: "FBA费用怎么计算？", answer: "FBA费用包括配送费和仓储费..." },
        ],
        referenceSource: "亚马逊官方文档",
        referenceUrl: "https://sellercentral.amazon.com",
      };

      const result = sopSchema.safeParse(validSop);
      expect(result.success).toBe(true);
    });
  });

  describe("Source Type Mapping", () => {
    const SOURCE_TYPE_LABELS: Record<string, string> = {
      amazon_news: "亚马逊官方",
      wearesellers: "知无不言",
      media: "行业媒体",
      custom_url: "自定义URL",
      rss: "RSS订阅",
    };

    it("should have labels for all source types", () => {
      const types = ["amazon_news", "wearesellers", "media", "custom_url", "rss"];
      types.forEach(type => {
        expect(SOURCE_TYPE_LABELS[type]).toBeDefined();
        expect(SOURCE_TYPE_LABELS[type].length).toBeGreaterThan(0);
      });
    });
  });

  describe("KB Type Mapping", () => {
    const KB_TYPE_LABELS: Record<string, string> = {
      sop: "运营SOP库",
      listing: "Listing文案库",
      product: "产品创意库",
      image: "图片知识库",
      video: "视频知识库",
    };

    it("should have labels for all KB types", () => {
      const types = ["sop", "listing", "product", "image", "video"];
      types.forEach(type => {
        expect(KB_TYPE_LABELS[type]).toBeDefined();
      });
    });

    it("should map adopt target types correctly", () => {
      expect(KB_TYPE_LABELS["sop"]).toBe("运营SOP库");
      expect(KB_TYPE_LABELS["listing"]).toBe("Listing文案库");
      expect(KB_TYPE_LABELS["product"]).toBe("产品创意库");
    });
  });
});
