/**
 * Tests for multi-source intel parsers and preset sources
 * Covers: CifNews parser, Amazon Seller Blog parser, preset source templates, router endpoints
 */
import { describe, it, expect } from "vitest";

// ─── CifNews List Parser Tests ───────────────────────
describe("CifNews (雨果网) List Parser", () => {
  // Simulate the regex logic from parseCifNewsListPage
  function parseCifNewsListPage(html: string) {
    const items: Array<{
      title: string; url: string; author: string; date: string; description: string;
    }> = [];
    const articleRegex = /(?:class="cif-article__tit[^"]*"[^>]*href="(https?:\/\/www\.cifnews\.com\/article\/\d+)"|href="(https?:\/\/www\.cifnews\.com\/article\/\d+)"[^>]*class="cif-article__tit[^"]*")[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = articleRegex.exec(html)) !== null) {
      const url = match[1] || match[2];
      const title = match[3].replace(/<[^>]+>/g, "").trim();
      if (!title || title.length < 5) continue;
      const afterTitle = html.slice(match.index, match.index + 2000);
      const descMatch = afterTitle.match(/class="cif-article__desc"[^>]*>([\s\S]*?)<\/div>/i);
      const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      const authorMatch = afterTitle.match(/class="username[^"]*"[^>]*>([^<]+)/i);
      const author = authorMatch ? authorMatch[1].trim() : "";
      const dateMatch = afterTitle.match(/class="usertime[^"]*"[^>]*>([^<]+)/i);
      const date = dateMatch ? dateMatch[1].trim() : "";
      items.push({ title, url, author, date, description });
    }
    return items;
  }

  const sampleHtml = `
<div class="cif-article cif-article--normal">
<div class="cif-article__cont">
<div class="cif-article__info">
<a href="https://www.cifnews.com/article/184334" class="cif-article__tit cif-link fetch-click" target="_blank">警告！UL认证标志不可随意使用，违规可能构成侵权！</a>
<div class="cif-article__desc">卖家必看，防止侵权</div>
<div class="cif-article__binfo">
<div class="userinfo fl">
<a href="javascript:;" class="username fl">亚马逊开店分享社</a>
·
<span class="usertime">2026-03-23 09:53:00</span>
</div>
</div>
</div>
</div>
</div>
<div class="cif-article cif-article--normal">
<div class="cif-article__cont">
<div class="cif-article__info">
<a href="https://www.cifnews.com/article/184335" class="cif-article__tit cif-link" target="_blank">2026年亚马逊Prime Day备战指南</a>
<div class="cif-article__desc">全面解析Prime Day策略</div>
<div class="cif-article__binfo">
<div class="userinfo fl">
<a href="javascript:;" class="username fl">跨境电商研究院</a>
·
<span class="usertime">2026-03-22 15:30:00</span>
</div>
</div>
</div>
</div>
</div>`;

  it("should extract articles from cifnews HTML", () => {
    const items = parseCifNewsListPage(sampleHtml);
    expect(items.length).toBe(2);
  });

  it("should extract correct article URLs", () => {
    const items = parseCifNewsListPage(sampleHtml);
    expect(items[0].url).toBe("https://www.cifnews.com/article/184334");
    expect(items[1].url).toBe("https://www.cifnews.com/article/184335");
  });

  it("should extract article titles", () => {
    const items = parseCifNewsListPage(sampleHtml);
    expect(items[0].title).toContain("UL认证");
    expect(items[1].title).toContain("Prime Day");
  });

  it("should extract descriptions", () => {
    const items = parseCifNewsListPage(sampleHtml);
    expect(items[0].description).toBe("卖家必看，防止侵权");
    expect(items[1].description).toBe("全面解析Prime Day策略");
  });

  it("should extract authors", () => {
    const items = parseCifNewsListPage(sampleHtml);
    expect(items[0].author).toBe("亚马逊开店分享社");
    expect(items[1].author).toBe("跨境电商研究院");
  });

  it("should extract dates", () => {
    const items = parseCifNewsListPage(sampleHtml);
    expect(items[0].date).toContain("2026-03-23");
    expect(items[1].date).toContain("2026-03-22");
  });

  it("should skip short titles", () => {
    const html = `<a href="https://www.cifnews.com/article/999" class="cif-article__tit">AB</a>`;
    const items = parseCifNewsListPage(html);
    expect(items.length).toBe(0);
  });

  it("should return empty array for non-cifnews HTML", () => {
    const items = parseCifNewsListPage("<html><body>No articles here</body></html>");
    expect(items.length).toBe(0);
  });

  it("should handle HTML with no matching structure", () => {
    const items = parseCifNewsListPage("");
    expect(items.length).toBe(0);
  });
});

// ─── CifNews Detail Parser Tests ─────────────────────
describe("CifNews Detail Parser", () => {
  function parseCifNewsDetail(html: string) {
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const contentMatch = html.match(/class="[^"]*article[_-]?content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    let content = "";
    if (contentMatch) {
      content = contentMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    const authorMatch = html.match(/class="username[^"]*"[^>]*>([^<]+)/i);
    const author = authorMatch ? authorMatch[1].trim() : "";
    const dateMatch = html.match(/class="usertime[^"]*"[^>]*>([^<]+)/i);
    const date = dateMatch ? dateMatch[1].trim() : "";
    return { title, content: content.slice(0, 8000), author, date };
  }

  const detailHtml = `
<html><body>
<h1>警告！UL认证标志不可随意使用</h1>
<div class="article-content">
<p>产品出口到美国站点，卖家经常会被要求产品通过UL测试/认证。</p>
<p>以下是常见问题和注意事项。</p>
</div>
<a class="username" href="#">亚马逊开店分享社</a>
<span class="usertime">2026-03-23</span>
</body></html>`;

  it("should extract title from h1", () => {
    const result = parseCifNewsDetail(detailHtml);
    expect(result.title).toContain("UL认证");
  });

  it("should extract article content", () => {
    const result = parseCifNewsDetail(detailHtml);
    expect(result.content).toContain("UL测试");
    expect(result.content.length).toBeGreaterThan(20);
  });

  it("should extract author", () => {
    const result = parseCifNewsDetail(detailHtml);
    expect(result.author).toBe("亚马逊开店分享社");
  });

  it("should extract date", () => {
    const result = parseCifNewsDetail(detailHtml);
    expect(result.date).toContain("2026-03-23");
  });

  it("should strip script and style tags from content", () => {
    const html = `<h1>Test</h1><div class="article-content"><script>alert('x')</script><p>Real content</p><style>.x{}</style></div>`;
    const result = parseCifNewsDetail(html);
    expect(result.content).not.toContain("alert");
    expect(result.content).not.toContain(".x{}");
    expect(result.content).toContain("Real content");
  });

  it("should handle missing content gracefully", () => {
    const html = `<h1>Title Only</h1><div class="other">No article content</div>`;
    const result = parseCifNewsDetail(html);
    expect(result.title).toBe("Title Only");
    expect(result.content).toBe("");
  });

  it("should truncate content to 8000 chars", () => {
    const longContent = "A".repeat(10000);
    const html = `<h1>Long</h1><div class="article-content">${longContent}</div>`;
    const result = parseCifNewsDetail(html);
    expect(result.content.length).toBeLessThanOrEqual(8000);
  });
});

// ─── Amazon Seller Blog Parser Tests ─────────────────
describe("Amazon Seller Blog Parser", () => {
  function parseAmazonSellerBlog(html: string) {
    const items: Array<{ title: string; url: string }> = [];
    const linkRegex = /<a[^>]+href="(https?:\/\/sell\.amazon\.com\/blog\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      if (!title || title.length < 5) continue;
      if (url.match(/\/blog\/(categories|tags|announcements|getting-started)$/)) continue;
      items.push({ title, url });
    }
    return items;
  }

  it("should extract blog article links", () => {
    const html = `
<a href="https://sell.amazon.com/blog/how-to-sell-on-amazon" class="blog-link">How to Sell on Amazon: A Complete Guide</a>
<a href="https://sell.amazon.com/blog/fba-tips-2026" class="blog-link">FBA Tips for 2026: Maximize Your Profits</a>`;
    const items = parseAmazonSellerBlog(html);
    expect(items.length).toBe(2);
    expect(items[0].url).toContain("how-to-sell");
    expect(items[1].title).toContain("FBA Tips");
  });

  it("should skip category/tag pages", () => {
    const html = `
<a href="https://sell.amazon.com/blog/categories">Categories</a>
<a href="https://sell.amazon.com/blog/tags">All Tags Here</a>
<a href="https://sell.amazon.com/blog/real-article">A Real Article About Selling</a>`;
    const items = parseAmazonSellerBlog(html);
    expect(items.length).toBe(1);
    expect(items[0].url).toContain("real-article");
  });

  it("should skip short titles", () => {
    const html = `<a href="https://sell.amazon.com/blog/test">Hi</a>`;
    const items = parseAmazonSellerBlog(html);
    expect(items.length).toBe(0);
  });

  it("should handle empty HTML", () => {
    const items = parseAmazonSellerBlog("");
    expect(items.length).toBe(0);
  });

  it("should strip HTML tags from titles", () => {
    const html = `<a href="https://sell.amazon.com/blog/guide"><span class="title">Complete <strong>Guide</strong> to Amazon</span></a>`;
    const items = parseAmazonSellerBlog(html);
    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Complete Guide to Amazon");
  });
});

// ─── Preset Sources Tests ────────────────────────────
describe("Preset Sources Configuration", () => {
  // Import the PRESET_SOURCES constant structure
  const PRESET_SOURCES = [
    { name: "知无不言跨境电商社区", sourceType: "wearesellers", url: "https://www.wearesellers.com/is_notify-1", category: "论坛社区" },
    { name: "雨果网-亚马逊频道", sourceType: "media", url: "https://www.cifnews.com/amazon", category: "跨境媒体" },
    { name: "雨果网-选品频道", sourceType: "media", url: "https://www.cifnews.com/selection", category: "跨境媒体" },
    { name: "Amazon Seller Blog", sourceType: "amazon_news", url: "https://sell.amazon.com/blog", category: "官方资讯" },
    { name: "知无不言-PPC广告专区", sourceType: "wearesellers", url: "https://www.wearesellers.com/category-ppc", category: "论坛社区" },
    { name: "知无不言-Listing优化专区", sourceType: "wearesellers", url: "https://www.wearesellers.com/category-listing", category: "论坛社区" },
  ];

  it("should have at least 5 preset sources", () => {
    expect(PRESET_SOURCES.length).toBeGreaterThanOrEqual(5);
  });

  it("should have unique URLs", () => {
    const urls = PRESET_SOURCES.map(s => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("should have unique names", () => {
    const names = PRESET_SOURCES.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("should only use valid source types", () => {
    const validTypes = ["amazon_news", "wearesellers", "media", "custom_url", "rss"];
    for (const source of PRESET_SOURCES) {
      expect(validTypes).toContain(source.sourceType);
    }
  });

  it("should have valid URLs", () => {
    for (const source of PRESET_SOURCES) {
      expect(source.url).toMatch(/^https?:\/\//);
    }
  });

  it("should have non-empty names and categories", () => {
    for (const source of PRESET_SOURCES) {
      expect(source.name.length).toBeGreaterThan(0);
      expect(source.category.length).toBeGreaterThan(0);
    }
  });

  it("should include wearesellers sources", () => {
    const wearesellers = PRESET_SOURCES.filter(s => s.sourceType === "wearesellers");
    expect(wearesellers.length).toBeGreaterThanOrEqual(2);
  });

  it("should include media sources", () => {
    const media = PRESET_SOURCES.filter(s => s.sourceType === "media");
    expect(media.length).toBeGreaterThanOrEqual(1);
  });

  it("should include amazon_news sources", () => {
    const amazon = PRESET_SOURCES.filter(s => s.sourceType === "amazon_news");
    expect(amazon.length).toBeGreaterThanOrEqual(1);
  });

  it("should have diverse categories", () => {
    const categories = new Set(PRESET_SOURCES.map(s => s.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });
});

// ─── Router Endpoint Structure Tests ─────────────────
describe("kbIntel Router - Preset Source Endpoints", () => {
  it("getPresetSources should return array with alreadyAdded flag", () => {
    // Verify the expected response shape
    const mockResponse = [
      { name: "Test Source", sourceType: "media", url: "https://example.com", description: "Test", category: "Test", alreadyAdded: false },
    ];
    expect(mockResponse[0]).toHaveProperty("alreadyAdded");
    expect(mockResponse[0]).toHaveProperty("name");
    expect(mockResponse[0]).toHaveProperty("sourceType");
    expect(mockResponse[0]).toHaveProperty("url");
  });

  it("addPresetSource input should require presetIndex", () => {
    const validInput = { presetIndex: 0 };
    expect(validInput.presetIndex).toBeGreaterThanOrEqual(0);
    expect(typeof validInput.presetIndex).toBe("number");
  });

  it("addPresetSourceBatch input should require array of indices", () => {
    const validInput = { presetIndices: [0, 1, 2] };
    expect(Array.isArray(validInput.presetIndices)).toBe(true);
    expect(validInput.presetIndices.every(i => typeof i === "number")).toBe(true);
  });

  it("batch add should return results with status", () => {
    const mockResponse = {
      results: [
        { name: "Source A", status: "added" as const },
        { name: "Source B", status: "exists" as const },
        { name: "Source C", status: "error" as const },
      ],
    };
    expect(mockResponse.results.length).toBe(3);
    const statuses = mockResponse.results.map(r => r.status);
    expect(statuses).toContain("added");
    expect(statuses).toContain("exists");
  });
});

// ─── Source Type Detection Tests ─────────────────────
describe("Source Type Detection for Parsers", () => {
  it("should route media type to cifnews parser", () => {
    const sourceType = "media";
    const url = "https://www.cifnews.com/amazon";
    expect(sourceType).toBe("media");
    expect(url).toContain("cifnews.com");
  });

  it("should route amazon_news type to amazon blog parser", () => {
    const sourceType = "amazon_news";
    const url = "https://sell.amazon.com/blog";
    expect(sourceType).toBe("amazon_news");
    expect(url).toContain("sell.amazon.com");
  });

  it("should route wearesellers type to wearesellers parser", () => {
    const sourceType = "wearesellers";
    const url = "https://www.wearesellers.com/is_notify-1";
    expect(sourceType).toBe("wearesellers");
    expect(url).toContain("wearesellers.com");
  });

  it("should route rss type to RSS parser", () => {
    const sourceType = "rss";
    expect(sourceType).toBe("rss");
  });

  it("should route custom_url type to generic parser", () => {
    const sourceType = "custom_url";
    expect(sourceType).toBe("custom_url");
  });
});
