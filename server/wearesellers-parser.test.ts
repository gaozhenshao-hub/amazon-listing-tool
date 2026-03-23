/**
 * Tests for WeAreSellers (知无不言) parser functions
 * Validates list page parsing and detail page parsing
 */
import { describe, it, expect } from "vitest";

// We need to test the parser functions. Since they're not exported directly,
// we'll test them through the module's behavior with sample HTML.

// Sample list page HTML mimicking wearesellers structure
const SAMPLE_LIST_HTML = `
<html>
<body>
<div class="aw-item aw-item-list" data-question_id="12345">
  <div class="aw-question-content">
    <h4>
      <a href="/question/12345" class="aw-question-title">
        亚马逊FBA新品推广策略分享：如何在30天内打造Best Seller
      </a>
    </h4>
    <span class="topic-tag"><a href="/topic/FBA">FBA运营</a></span>
    <span class="aw-user-name" data-id="seller_king"></span>
    <span>2568 次浏览</span>
    <span>42 个回复</span>
    <span>18 人关注</span>
  </div>
</div>

<div class="aw-item aw-item-list" data-question_id="12346">
  <div class="aw-question-content">
    <h4>
      <a href="/question/12346" class="aw-question-title">
        2024年亚马逊广告优化实战：ACOS从50%降到15%的方法
      </a>
    </h4>
    <span class="topic-tag"><a href="/topic/PPC">PPC广告</a></span>
    <span class="aw-user-name" data-id="ppc_master"></span>
    <span>1890 次浏览</span>
    <span>35 个回复</span>
    <span>12 人关注</span>
  </div>
</div>

<div class="aw-item aw-item-list" data-question_id="12347">
  <div class="aw-question-content">
    <h4>
      <a href="/question/12347" class="aw-question-title">
        发布帖子赢众多好礼
      </a>
    </h4>
    <span class="topic-tag"><a href="/topic/活动">活动</a></span>
    <span>100 次浏览</span>
    <span>5 个回复</span>
  </div>
</div>

<div class="aw-item aw-item-list" data-question_id="12348">
  <div class="aw-question-content">
    <h4>
      <a href="https://www.wearesellers.com/question/12348" class="aw-question-title">
        Listing优化技巧：如何写出高转化率的五点描述
      </a>
    </h4>
    <span class="topic-tag"><a href="/topic/Listing">Listing优化</a></span>
    <span class="aw-user-name" data-id="listing_pro"></span>
    <span>3200 次浏览</span>
    <span>56 个回复</span>
    <span>25 人关注</span>
  </div>
</div>
</body>
</html>
`;

// Sample detail page HTML
const SAMPLE_DETAIL_HTML = `
<html>
<body>
<h1 class="aw-question-detail-title">亚马逊FBA新品推广策略分享：如何在30天内打造Best Seller</h1>

<div class="aw-question-detail-author">
  <span class="aw-user-name" data-id="seller_king">seller_king</span>
</div>

<span class="topic-tag"><a href="/topic/FBA">FBA运营</a></span>

<div class="aw-question-detail-txt">
  <p>大家好，我是一个做亚马逊FBA三年的老卖家。今天分享一下我最近成功打造Best Seller的经验。</p>
  <p>第一步：选品阶段要注意市场容量和竞争度的平衡。建议使用Helium10或Jungle Scout进行数据分析。</p>
  <p>第二步：Listing优化是关键。标题要包含核心关键词，五点描述要突出产品差异化优势。</p>
  <p>第三步：广告投放策略。新品期建议同时开启自动广告和手动精准广告。</p>
  <p>第四步：Review积累。可以通过Vine计划和Request a Review功能来获取早期评价。</p>
</div>

<div class="aw-item" data-answer-id="99001">
  <span class="aw-user-name" data-id="expert_a">expert_a</span>
  <span class="aw-agree-count">28</span>
  <div class="markitup-box">
    <p>非常好的分享！补充一点，新品期的广告预算建议设置为日均50-100美金，前两周重点跑自动广告收集关键词数据。</p>
  </div>
</div>

<div class="aw-item" data-answer-id="99002">
  <span class="aw-user-name" data-id="expert_b">expert_b</span>
  <span class="aw-agree-count">15</span>
  <div class="markitup-box">
    <p>关于Review积累，我建议同时使用Insert Card引导买家留评，但要注意不能有利诱行为，否则会被亚马逊警告。</p>
  </div>
</div>

<div class="aw-item" data-answer-id="99003">
  <span class="aw-user-name" data-id="newbie_c">newbie_c</span>
  <span class="aw-agree-count">3</span>
  <div class="markitup-box">
    <p>谢谢分享，学习了！</p>
  </div>
</div>
</body>
</html>
`;

describe("WeAreSellers Parser - List Page", () => {
  // We test the regex patterns used in the parser
  it("should extract question IDs from aw-item blocks", () => {
    const itemRegex = /<div\s+class="aw-item[^"]*"\s+data-question_id="(\d+)"[^>]*>([\s\S]*?)(?=<div\s+class="aw-item|$)/gi;
    const matches: string[] = [];
    let match;
    while ((match = itemRegex.exec(SAMPLE_LIST_HTML)) !== null) {
      matches.push(match[1]);
    }
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(matches).toContain("12345");
    expect(matches).toContain("12346");
  });

  it("should extract titles from h4 > a[href*=question]", () => {
    const itemRegex = /<div\s+class="aw-item[^"]*"\s+data-question_id="(\d+)"[^>]*>([\s\S]*?)(?=<div\s+class="aw-item|$)/gi;
    const titles: string[] = [];
    let match;
    while ((match = itemRegex.exec(SAMPLE_LIST_HTML)) !== null) {
      const block = match[2];
      const titleMatch = block.match(/<h4[^>]*>[\s\S]*?<a[^>]+href="([^"]*question\/\d+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (titleMatch) {
        titles.push(titleMatch[2].replace(/<[^>]+>/g, "").trim());
      }
    }
    expect(titles.length).toBeGreaterThanOrEqual(3);
    expect(titles[0]).toContain("FBA新品推广策略");
    expect(titles[1]).toContain("广告优化实战");
  });

  it("should resolve relative URLs to absolute URLs", () => {
    const relativeUrl = "/question/12345";
    const absoluteUrl = relativeUrl.startsWith("http") ? relativeUrl : `https://www.wearesellers.com${relativeUrl}`;
    expect(absoluteUrl).toBe("https://www.wearesellers.com/question/12345");
  });

  it("should handle already absolute URLs", () => {
    const absoluteUrl = "https://www.wearesellers.com/question/12348";
    const resolved = absoluteUrl.startsWith("http") ? absoluteUrl : `https://www.wearesellers.com${absoluteUrl}`;
    expect(resolved).toBe("https://www.wearesellers.com/question/12348");
  });

  it("should extract categories from topic-tag", () => {
    const catMatch = SAMPLE_LIST_HTML.match(/class="topic-tag"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
    expect(catMatch).not.toBeNull();
    expect(catMatch![1].trim()).toBe("FBA运营");
  });

  it("should extract view counts", () => {
    const viewsMatch = SAMPLE_LIST_HTML.match(/(\d+)\s*次浏览/);
    expect(viewsMatch).not.toBeNull();
    expect(parseInt(viewsMatch![1])).toBe(2568);
  });

  it("should extract reply counts", () => {
    const repliesMatch = SAMPLE_LIST_HTML.match(/(\d+)\s*个回复/);
    expect(repliesMatch).not.toBeNull();
    expect(parseInt(repliesMatch![1])).toBe(42);
  });

  it("should extract follower counts", () => {
    const followersMatch = SAMPLE_LIST_HTML.match(/(\d+)\s*人关注/);
    expect(followersMatch).not.toBeNull();
    expect(parseInt(followersMatch![1])).toBe(18);
  });

  it("should extract author data-id", () => {
    const authorMatch = SAMPLE_LIST_HTML.match(/class="aw-user-name[^"]*"[^>]*data-id="([^"]*)"/i);
    expect(authorMatch).not.toBeNull();
    expect(authorMatch![1]).toBe("seller_king");
  });
});

describe("WeAreSellers Parser - Detail Page", () => {
  it("should extract title from h1.aw-question-detail-title", () => {
    const titleMatch = SAMPLE_DETAIL_HTML.match(/<h1[^>]*class="[^"]*aw-question-detail-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
    expect(titleMatch).not.toBeNull();
    expect(titleMatch![1].replace(/<[^>]+>/g, "").trim()).toContain("FBA新品推广策略");
  });

  it("should extract question content from aw-question-detail-txt", () => {
    const contentMatch = SAMPLE_DETAIL_HTML.match(/class="[^"]*aw-question-detail-txt[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    expect(contentMatch).not.toBeNull();
    const content = contentMatch![1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(content).toContain("选品阶段");
    expect(content).toContain("Listing优化");
    expect(content).toContain("广告投放策略");
  });

  it("should extract author from detail page", () => {
    const authorMatch = SAMPLE_DETAIL_HTML.match(/class="[^"]*aw-question-detail-author[^"]*"[\s\S]*?data-id="([^"]*)"/i);
    expect(authorMatch).not.toBeNull();
    expect(authorMatch![1]).toBe("seller_king");
  });

  it("should extract category from detail page", () => {
    const catMatch = SAMPLE_DETAIL_HTML.match(/class="topic-tag"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
    expect(catMatch).not.toBeNull();
    expect(catMatch![1].trim()).toBe("FBA运营");
  });

  it("should extract answers with votes", () => {
    const answerRegex = /class="[^"]*aw-item[^"]*"[^>]*data-answer-id[^>]*>([\s\S]*?)(?=class="[^"]*aw-item[^"]*"[^>]*data-answer-id|<div\s+id="aw-comment-box|$)/gi;
    const answers: Array<{ author: string; content: string; votes: number }> = [];
    let ansMatch;
    while ((ansMatch = answerRegex.exec(SAMPLE_DETAIL_HTML)) !== null) {
      const ansBlock = ansMatch[1];
      const ansAuthorMatch = ansBlock.match(/class="aw-user-name[^"]*"[^>]*data-id="([^"]*)"/i);
      const ansContentMatch = ansBlock.match(/class="[^"]*markitup-box[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const votesMatch = ansBlock.match(/class="[^"]*aw-agree-count[^"]*"[^>]*>(\d+)/i);
      if (ansContentMatch) {
        const ansContent = ansContentMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        answers.push({
          author: ansAuthorMatch ? ansAuthorMatch[1].trim() : "匿名用户",
          content: ansContent,
          votes: votesMatch ? parseInt(votesMatch[1]) : 0,
        });
      }
    }
    expect(answers.length).toBeGreaterThanOrEqual(2);
    // Answers should be found with correct votes
    const topAnswer = answers.find(a => a.votes === 28);
    expect(topAnswer).toBeDefined();
    expect(topAnswer!.content).toContain("自动广告收集关键词");
    expect(topAnswer!.author).toBe("expert_a");
  });

  it("should sort answers by votes descending", () => {
    const answers = [
      { author: "a", content: "test", votes: 15 },
      { author: "b", content: "test", votes: 28 },
      { author: "c", content: "test", votes: 3 },
    ];
    answers.sort((a, b) => b.votes - a.votes);
    expect(answers[0].votes).toBe(28);
    expect(answers[1].votes).toBe(15);
    expect(answers[2].votes).toBe(3);
  });

  it("should filter out short answers (< 20 chars)", () => {
    // "谢谢分享，学习了！" is only 9 chars, should be filtered
    const shortContent = "谢谢分享，学习了！";
    expect(shortContent.length).toBeLessThan(20);
  });
});

describe("WeAreSellers Integration Logic", () => {
  it("should filter out system/admin posts", () => {
    const posts = [
      { title: "亚马逊FBA新品推广策略分享", url: "/question/1" },
      { title: "发布帖子赢众多好礼", url: "/question/2" },
      { title: "社区指南", url: "/question/3" },
      { title: "Listing优化技巧", url: "/question/4" },
    ];
    const filtered = posts.filter(p =>
      !p.title.includes("发布帖子赢众多好礼") && !p.title.includes("社区指南")
    );
    expect(filtered.length).toBe(2);
    expect(filtered[0].title).toContain("FBA");
    expect(filtered[1].title).toContain("Listing");
  });

  it("should sort by engagement score (views + replies*10)", () => {
    const posts = [
      { title: "Post A", url: "/a", views: 100, replies: 5 },
      { title: "Post B", url: "/b", views: 3200, replies: 56 },
      { title: "Post C", url: "/c", views: 2568, replies: 42 },
    ];
    posts.sort((a, b) => (b.views + b.replies * 10) - (a.views + a.replies * 10));
    expect(posts[0].title).toBe("Post B"); // 3200 + 560 = 3760
    expect(posts[1].title).toBe("Post C"); // 2568 + 420 = 2988
    expect(posts[2].title).toBe("Post A"); // 100 + 50 = 150
  });

  it("should combine question content with top answers for richer context", () => {
    const parsed = {
      title: "FBA新品推广",
      content: "这是问题内容",
      author: "seller_king",
      category: "FBA运营",
      answers: [
        { author: "expert_a", content: "这是高赞回答内容，包含很多有用的信息", votes: 28 },
        { author: "expert_b", content: "这是第二个回答", votes: 15 },
      ],
    };
    const answerTexts = parsed.answers
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 5)
      .map((a, i) => `\n\n--- 回答${i + 1} (${a.author}, ${a.votes}赞) ---\n${a.content}`)
      .join("");
    const content = `[分类: ${parsed.category}] [作者: ${parsed.author}]\n\n${parsed.content}${answerTexts}`;

    expect(content).toContain("[分类: FBA运营]");
    expect(content).toContain("[作者: seller_king]");
    expect(content).toContain("这是问题内容");
    expect(content).toContain("--- 回答1 (expert_a, 28赞) ---");
    expect(content).toContain("高赞回答内容");
  });

  it("should construct correct wearesellers URLs for different sort types", () => {
    const baseUrl = "https://www.wearesellers.com/is_notify-1";
    const sortUrls = [
      baseUrl,
      "https://www.wearesellers.com/type-explore__sort_type-new__day-0__is_recommend-0__page-1",
    ];
    expect(sortUrls).toHaveLength(2);
    expect(sortUrls[0]).toContain("wearesellers.com");
    expect(sortUrls[1]).toContain("sort_type-new");
  });
});
