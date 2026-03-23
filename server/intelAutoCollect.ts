/**
 * Intel Auto-Collect Scheduler & Worker
 *
 * 定时轮询情报源 → 爬取新内容 → 去重 → AI质量评估 → 推送通知
 *
 * 架构：
 * - IntelScheduler: 管理所有定时任务的调度（基于setInterval轮询检查）
 * - collectFromSource: 单个情报源的采集worker
 * - 支持动态增删改调度、连续失败自动暂停、采集日志记录
 */
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import {
  kbIntelSources,
  kbIntelItems,
  kbIntelCollectLogs,
} from "../drizzle/schema";
import { eq, and, lte, isNotNull, sql } from "drizzle-orm";
import { execSync } from "child_process";

// ─── Interval Constants ────────────────────────────
const INTERVAL_MAP: Record<string, number> = {
  every_6h: 6 * 60 * 60 * 1000,
  every_12h: 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const MAX_CONSECUTIVE_FAILURES = 5; // 连续失败5次后自动暂停
const SCHEDULER_CHECK_INTERVAL = 60 * 1000; // 每60秒检查一次是否有需要执行的任务
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

// ─── Helper: Calculate next run time ───────────────
export function calculateNextRunTime(
  interval: string | null,
  customCron: string | null,
  fromTime: number = Date.now()
): number {
  if (interval && interval !== "custom" && INTERVAL_MAP[interval]) {
    return fromTime + INTERVAL_MAP[interval];
  }
  // For custom cron, default to daily if we can't parse
  if (customCron) {
    // Simple cron parsing for common patterns
    const parts = customCron.trim().split(/\s+/);
    if (parts.length >= 5) {
      // Try to calculate next run from cron
      const hour = parseInt(parts[1]) || 9;
      const now = new Date(fromTime);
      const next = new Date(now);
      next.setHours(hour, parseInt(parts[0]) || 0, 0, 0);
      if (next.getTime() <= fromTime) {
        next.setDate(next.getDate() + 1);
      }
      return next.getTime();
    }
  }
  // Default: daily
  return fromTime + INTERVAL_MAP.daily;
}

// ─── Helper: Random User-Agent ─────────────────────
function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
// ─── Helper: Fetch URL with curl fallback ───────────

function fetchWithCurl(url: string): { ok: boolean; html: string } {
  try {
    const html = execSync(
      `curl -sL --max-time 30 -H "User-Agent: ${randomUA()}" -H "Accept: text/html,application/xhtml+xml" -H "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8" "${url.replace(/"/g, '\\"')}"`,
      { maxBuffer: 20 * 1024 * 1024, encoding: "utf-8", timeout: 35000 }
    );
    return { ok: html.length > 100, html };
  } catch {
    return { ok: false, html: "" };
  }
}

// ─── Helper: Fetch URL content with retry (fetch + curl fallback) ────────────
async function fetchWithRetry(
  url: string,
  maxRetries: number = 3
): Promise<{ ok: boolean; content: string; title: string; rawHtml?: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let html = "";
    try {
      // Try native fetch first
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timeout);
      if (response.ok) {
        html = await response.text();
      }
    } catch {
      // fetch failed, try curl fallback
    }

    // If fetch failed or returned empty, try curl
    if (!html || html.length < 100) {
      const curlResult = fetchWithCurl(url);
      if (curlResult.ok) {
        html = curlResult.html;
      }
    }

    if (html && html.length >= 100) {
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, " ") : "";
      // Extract main text content (strip HTML tags)
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const bodyHtml = bodyMatch ? bodyMatch[1] : html;
      const content = bodyHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 10000);

      return { ok: true, content, title, rawHtml: html };
    }

    if (attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return { ok: false, content: "", title: "" };
}
// ─── Helper: Check if URL already exists ───────────
async function isUrlDuplicate(sourceId: number, url: string): Promise<boolean> {
  const _d = await getDb();
  if (!_d) return false;
  const [existing] = await _d
    .select({ id: kbIntelItems.id })
    .from(kbIntelItems)
    .where(and(eq(kbIntelItems.sourceId, sourceId), eq(kbIntelItems.originalUrl, url)))
    .limit(1);
  return !!existing;
}

// ─── AI Quality Evaluation (reused from kbIntel router) ──
function buildQualityEvalPrompt(title: string, source: string, content: string) {
  return `你是一位资深的亚马逊运营专家。请评估以下外部文章对亚马逊卖家的价值。

文章标题: ${title}
文章来源: ${source}
文章内容（前3000字）: ${content.slice(0, 3000)}

请从以下5个维度打分（1-10分），并给出简要理由：
1. 相关性（30%）：与亚马逊运营的相关程度
2. 实操性（25%）：是否包含可执行的操作步骤或方法论
3. 时效性（20%）：内容是否仍然有效
4. 深度（15%）：分析深度和信息密度
5. 独特性（10%）：与常见知识的差异度

同时请：
- 生成一段200字以内的摘要
- 判断该文章最适合录入哪个知识库：sop/listing/product/image/video

输出严格JSON格式：
{
  "scores": {
    "relevance": { "score": 8, "reason": "..." },
    "actionability": { "score": 7, "reason": "..." },
    "timeliness": { "score": 9, "reason": "..." },
    "depth": { "score": 6, "reason": "..." },
    "uniqueness": { "score": 7, "reason": "..." }
  },
  "weightedTotal": 7.6,
  "summary": "...",
  "suggestedType": "sop"
}`;
}

// ─── RSS Feed Parser (simple) ──────────────────────
function parseRssItems(xml: string): Array<{ title: string; url: string; pubDate?: string }> {
  const items: Array<{ title: string; url: string; pubDate?: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    if (titleMatch && linkMatch) {
      const title = titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
      const url = linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
      items.push({
        title,
        url,
        pubDate: pubDateMatch ? pubDateMatch[1].trim() : undefined,
      });
    }
  }
  // Also try Atom format
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const titleMatch = entryXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = entryXml.match(/<link[^>]*href="([^"]*)"[^>]*\/>/i);
    const updatedMatch = entryXml.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
    if (titleMatch && linkMatch) {
      items.push({
        title: titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim(),
        url: linkMatch[1].trim(),
        pubDate: updatedMatch ? updatedMatch[1].trim() : undefined,
      });
    }
  }
  return items;
}

// ─── WeAreSellers Parser ──────────────────────────
function parseWeareSellersListPage(html: string): Array<{
  title: string;
  url: string;
  questionId: string;
  category: string;
  author: string;
  views: number;
  replies: number;
  followers: number;
}> {
  const items: Array<{
    title: string; url: string; questionId: string;
    category: string; author: string; views: number; replies: number; followers: number;
  }> = [];

  // Match each .aw-item block (real HTML has whitespace/newlines between class and data-question_id)
  const itemRegex = /class="aw-item\s*"\s+data-question_id="(\d+)"[^>]*>([\s\S]*?)(?=class="aw-item\s*"\s+data-question_id|$)/gi;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const questionId = match[1];
    const block = match[2];

    // Extract title - try h4 > a first, then any a[href*=question]
    const titleMatch = block.match(/<h4[^>]*>[\s\S]*?<a[^>]+href="([^"]*question\/\d+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a\s+href="([^"]*question\/\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const url = titleMatch[1].startsWith("http") ? titleMatch[1] : `https://www.wearesellers.com${titleMatch[1]}`;
    const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();
    if (!title || title.length < 5) continue;

    // Extract category from .aw-question-tags a or .topic-tag a
    const catMatch = block.match(/class="aw-question-tags"[^>]*>([^<]+)<\/a>/i)
      || block.match(/class="topic-tag"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
    const category = catMatch ? catMatch[1].trim() : "";

    // Extract author
    const authorMatch = block.match(/class="aw-user-name[^"]*"[^>]*data-id="([^"]*)"/i);
    const author = authorMatch ? authorMatch[1].trim() : "匿名用户";

    // Extract meta: views, replies, followers
    const metaText = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const viewsMatch = metaText.match(/(\d+)\s*次浏览/);
    const repliesMatch = metaText.match(/(\d+)\s*个回复/);
    const followersMatch = metaText.match(/(\d+)\s*人关注/);

    items.push({
      title,
      url,
      questionId,
      category,
      author,
      views: viewsMatch ? parseInt(viewsMatch[1]) : 0,
      replies: repliesMatch ? parseInt(repliesMatch[1]) : 0,
      followers: followersMatch ? parseInt(followersMatch[1]) : 0,
    });
  }
  return items;
}

// ─── WeAreSellers Detail Page Parser ──────────────
function parseWeareSellersDetail(html: string): {
  title: string;
  content: string;
  author: string;
  category: string;
  answers: Array<{ author: string; content: string; votes: number }>;
} {
  // Extract title - try specific class first, then <title> tag (most reliable on real pages)
  const titleMatch = html.match(/<h1[^>]*class="[^"]*aw-question-detail-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
  // Clean up title from <title> tag (remove " - 知无不言跨境电商社区" suffix)
  title = title.replace(/\s*-\s*知无不言.*$/, "").trim();

  // Extract question content
  const contentMatch = html.match(/class="[^"]*aw-question-detail-txt[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/class="[^"]*markitup-box[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  let content = contentMatch
    ? contentMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : "";

  // Extract author - on real pages, author may be in user-name link or anonymous
  const authorMatch = html.match(/class="[^"]*aw-question-detail-author[^"]*"[\s\S]*?data-id="([^"]*)"/i)
    || html.match(/class="aw-user-name[^"]*"[^>]*data-id="([^"]*)"/i);
  const author = authorMatch ? authorMatch[1].trim() : "匿名用户";

  // Extract category from .aw-question-tags or .topic-tag
  const catMatch = html.match(/class="aw-question-tags"[^>]*>([^<]+)<\/a>/i)
    || html.match(/class="topic-tag"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
  const category = catMatch ? catMatch[1].trim() : "";

  // Extract answers (best answers and regular answers)
  const answers: Array<{ author: string; content: string; votes: number }> = [];
  const answerRegex = /class="[^"]*aw-item[^"]*"[^>]*data-answer-id[^>]*>([\s\S]*?)(?=class="[^"]*aw-item[^"]*"[^>]*data-answer-id|<div\s+id="aw-comment-box|$)/gi;
  let ansMatch;
  while ((ansMatch = answerRegex.exec(html)) !== null) {
    const ansBlock = ansMatch[1];
    const ansAuthorMatch = ansBlock.match(/class="aw-user-name[^"]*"[^>]*data-id="([^"]*)"/i);
    const ansContentMatch = ansBlock.match(/class="[^"]*markitup-box[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const votesMatch = ansBlock.match(/class="[^"]*aw-agree-count[^"]*"[^>]*>(\d+)/i);
    if (ansContentMatch) {
      const ansContent = ansContentMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (ansContent.length > 20) {
        answers.push({
          author: ansAuthorMatch ? ansAuthorMatch[1].trim() : "匿名用户",
          content: ansContent.slice(0, 3000),
          votes: votesMatch ? parseInt(votesMatch[1]) : 0,
        });
      }
    }
  }

  // If no structured content found, try to extract from body
  if (!content || content.length < 30) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      content = bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);
    }
  }

  return { title, content: content.slice(0, 8000), author, category, answers };
}

// ─── CifNews (雨果网) Parser ──────────────────────
function parseCifNewsListPage(html: string): Array<{
  title: string;
  url: string;
  author: string;
  date: string;
  description: string;
}> {
  const items: Array<{
    title: string; url: string; author: string; date: string; description: string;
  }> = [];

  // Match cif-article blocks with title links (handle both href-before-class and class-before-href)
  const articleRegex = /(?:class="cif-article__tit[^"]*"[^>]*href="(https?:\/\/www\.cifnews\.com\/article\/\d+)"|href="(https?:\/\/www\.cifnews\.com\/article\/\d+)"[^>]*class="cif-article__tit[^"]*")[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const url = match[1] || match[2]; // Either group can match depending on attribute order
    const title = match[3].replace(/<[^>]+>/g, "").trim();
    if (!title || title.length < 5) continue;

    // Look for description and author in the surrounding context
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

function parseCifNewsDetail(html: string): {
  title: string;
  content: string;
  author: string;
  date: string;
} {
  // Extract title from h1
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

  // Extract article content
  const contentMatch = html.match(/class="[^"]*article[_-]?content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/class="[^"]*cif-detail__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  let content = "";
  if (contentMatch) {
    content = contentMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Extract author
  const authorMatch = html.match(/class="[^"]*author[_-]?name[^"]*"[^>]*>([^<]+)/i)
    || html.match(/class="username[^"]*"[^>]*>([^<]+)/i);
  const author = authorMatch ? authorMatch[1].trim() : "";

  // Extract date
  const dateMatch = html.match(/class="[^"]*publish[_-]?time[^"]*"[^>]*>([^<]+)/i)
    || html.match(/class="usertime[^"]*"[^>]*>([^<]+)/i);
  const date = dateMatch ? dateMatch[1].trim() : "";

  // If no structured content, fallback to body text
  if (!content || content.length < 50) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      content = bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);
    }
  }

  return { title, content: content.slice(0, 8000), author, date };
}

// ─── Amazon Seller Blog Parser ──────────────────────
function parseAmazonSellerBlog(html: string): Array<{
  title: string;
  url: string;
}> {
  const items: Array<{ title: string; url: string }> = [];
  // Match blog article links from sell.amazon.com
  const linkRegex = /<a[^>]+href="(https?:\/\/sell\.amazon\.com\/blog\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    if (!title || title.length < 5) continue;
    // Skip category/tag pages
    if (url.match(/\/blog\/(categories|tags|announcements|getting-started)$/)) continue;
    items.push({ title, url });
  }
  return items;
}

// ─── Preset Source Templates ─────────────────────────
export const PRESET_SOURCES = [
  {
    name: "知无不言跨境电商社区",
    sourceType: "wearesellers" as const,
    url: "https://www.wearesellers.com/is_notify-1",
    description: "国内最大的亚马逊卖家交流社区，涵盖运营技巧、选品策略、政策解读等",
    category: "论坛社区",
  },
  {
    name: "雨果网-亚马逊频道",
    sourceType: "media" as const,
    url: "https://www.cifnews.com/amazon",
    description: "雨果跨境亚马逊频道，提供行业新闻、运营干货、政策变动等资讯",
    category: "跨境媒体",
  },
  {
    name: "雨果网-选品频道",
    sourceType: "media" as const,
    url: "https://www.cifnews.com/selection",
    description: "雨果跨境选品频道，提供热门品类分析、选品趋势和市场洞察",
    category: "跨境媒体",
  },
  {
    name: "Amazon Seller Blog",
    sourceType: "amazon_news" as const,
    url: "https://sell.amazon.com/blog",
    description: "亚马逊官方卖家博客，发布平台政策更新、功能上线和最佳实践",
    category: "官方资讯",
  },
  {
    name: "知无不言-PPC广告专区",
    sourceType: "wearesellers" as const,
    url: "https://www.wearesellers.com/category-ppc",
    description: "知无不言PPC广告讨论区，聚焦亚马逊广告投放策略和优化技巧",
    category: "论坛社区",
  },
  {
    name: "知无不言-Listing优化专区",
    sourceType: "wearesellers" as const,
    url: "https://www.wearesellers.com/category-listing",
    description: "知无不言Listing优化讨论区，聚焦标题、关键词、图片和A+内容优化",
    category: "论坛社区",
  },
];

// ─── Discover new URLs from a source ───────────────
async function discoverNewUrls(
  source: { id: number; url: string; sourceType: string; autoCollectMaxItems: number | null }
): Promise<Array<{ title: string; url: string }>> {
  const maxItems = source.autoCollectMaxItems || 10;

  if (source.sourceType === "rss") {
    // Fetch and parse RSS feed
    const result = await fetchWithRetry(source.url, 2);
    if (!result.ok) return [];
    const items = parseRssItems(result.content);
    // Filter out duplicates
    const newItems: Array<{ title: string; url: string }> = [];
    for (const item of items.slice(0, maxItems * 2)) {
      if (!(await isUrlDuplicate(source.id, item.url))) {
        newItems.push({ title: item.title, url: item.url });
        if (newItems.length >= maxItems) break;
      }
    }
    return newItems;
  }

  // ── 跨境电商媒体（雨果网等）专用解析 ──────────────
  if (source.sourceType === "media") {
    const result = await fetchWithRetry(source.url, 2);
    if (!result.ok) return [];
    const articles = parseCifNewsListPage(result.rawHtml || result.content);
    const newItems: Array<{ title: string; url: string }> = [];
    for (const article of articles.slice(0, maxItems * 2)) {
      if (!(await isUrlDuplicate(source.id, article.url))) {
        newItems.push({ title: article.title, url: article.url });
        if (newItems.length >= maxItems) break;
      }
    }
    return newItems;
  }

  // ── 亚马逊官方资讯 ──────────────────────────
  if (source.sourceType === "amazon_news") {
    const result = await fetchWithRetry(source.url, 2);
    if (!result.ok) return [];
    const articles = parseAmazonSellerBlog(result.rawHtml || result.content);
    const newItems: Array<{ title: string; url: string }> = [];
    for (const article of articles.slice(0, maxItems * 2)) {
      if (!(await isUrlDuplicate(source.id, article.url))) {
        newItems.push({ title: article.title, url: article.url });
        if (newItems.length >= maxItems) break;
      }
    }
    return newItems;
  }

  // ── WeAreSellers专用解析 ──────────────────────────
  if (source.sourceType === "wearesellers") {
    // Fetch the list page (try multiple sort types for broader coverage)
    const sortUrls = [
      source.url, // default URL
      "https://www.wearesellers.com/type-explore__sort_type-new__day-0__is_recommend-0__page-1",
    ];
    const allPosts: Array<{ title: string; url: string; views: number; replies: number }> = [];
    const seenUrls = new Set<string>();

    for (const sortUrl of sortUrls) {
      const result = await fetchWithRetry(sortUrl, 2);
      if (!result.ok) continue;
      // Use rawHtml for list parsing (we need the HTML structure, not stripped text)
      const posts = parseWeareSellersListPage(result.rawHtml || result.content);
      for (const post of posts) {
        if (seenUrls.has(post.url)) continue;
        seenUrls.add(post.url);
        allPosts.push(post);
      }
      if (allPosts.length >= maxItems * 3) break;
    }

    // Sort by engagement (views + replies * 10 + followers * 5) to prioritize popular content
    allPosts.sort((a, b) => (b.views + b.replies * 10) - (a.views + a.replies * 10));

    // Filter out duplicates against existing items
    const newItems: Array<{ title: string; url: string }> = [];
    for (const post of allPosts) {
      if (!(await isUrlDuplicate(source.id, post.url))) {
        // Filter out system/admin posts
        if (post.title.includes("发布帖子赢众多好礼") || post.title.includes("社区指南")) continue;
        newItems.push({ title: post.title, url: post.url });
        if (newItems.length >= maxItems) break;
      }
    }
    return newItems;
  }

  // For non-RSS, non-wearesellers sources, try to find article links on the page
  const result = await fetchWithRetry(source.url, 2);
  if (!result.ok) return [];

  // Extract links that look like articles
  const linkRegex = /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const links: Array<{ title: string; url: string }> = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(result.content)) !== null) {
    let href = linkMatch[1];
    const text = linkMatch[2].replace(/<[^>]+>/g, "").trim();
    if (!text || text.length < 5) continue;
    // Resolve relative URLs
    if (href.startsWith("/")) {
      try {
        const baseUrl = new URL(source.url);
        href = `${baseUrl.origin}${href}`;
      } catch { continue; }
    }
    if (!href.startsWith("http")) continue;
    // Filter out navigation/utility links
    if (href.includes("#") || href.includes("javascript:") || href.includes("login") || href.includes("signup")) continue;
    links.push({ title: text.slice(0, 200), url: href });
  }

  // Deduplicate and check against existing items
  const seen = new Set<string>();
  const newItems: Array<{ title: string; url: string }> = [];
  for (const link of links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    if (!(await isUrlDuplicate(source.id, link.url))) {
      newItems.push(link);
      if (newItems.length >= maxItems) break;
    }
  }
  return newItems;
}

// ─── Main Collect Worker ───────────────────────────
export async function collectFromSource(
  source: {
    id: number;
    userId: number;
    name: string;
    url: string;
    sourceType: string;
    qualityThreshold: string | null;
    autoEvaluateEnabled: boolean;
    autoCollectMaxItems: number | null;
  },
  triggerType: "manual" | "auto" | "test" = "auto"
): Promise<{
  logId: number;
  totalFound: number;
  totalNew: number;
  totalDuplicate: number;
  totalEvaluated: number;
  totalRecommended: number;
  status: "success" | "partial" | "failed";
}> {
  const _d = await getDb();
  if (!_d) throw new Error("Database not available");

  const startedAt = Date.now();

  // Create collect log entry
  const [logEntry] = await _d.insert(kbIntelCollectLogs).values({
    sourceId: source.id,
    userId: source.userId,
    triggerType,
    status: "running",
    startedAt,
  });
  const logId = logEntry.insertId;

  let totalFound = 0;
  let totalNew = 0;
  let totalDuplicate = 0;
  let totalEvaluated = 0;
  let totalRecommended = 0;
  const details: Array<{ title: string; url: string; status: string; qualityScore?: number }> = [];

  try {
    // Step 1: Discover new URLs
    const newUrls = await discoverNewUrls(source);
    totalFound = newUrls.length;

    if (totalFound === 0) {
      // No new content found
      const completedAt = Date.now();
      await _d.update(kbIntelCollectLogs).set({
        status: "success",
        totalFound: 0,
        totalNew: 0,
        totalDuplicate: 0,
        details: [],
        completedAt,
        durationMs: completedAt - startedAt,
      }).where(eq(kbIntelCollectLogs.id, logId));

      // Update source timestamps
      await _d.update(kbIntelSources).set({
        lastAutoCollectAt: startedAt,
        nextAutoCollectAt: calculateNextRunTime(
          source.autoCollectMaxItems ? "daily" : null,
          null,
          startedAt
        ),
        consecutiveFailures: 0,
        updatedAt: Date.now(),
      }).where(eq(kbIntelSources.id, source.id));

      return { logId, totalFound: 0, totalNew: 0, totalDuplicate: 0, totalEvaluated: 0, totalRecommended: 0, status: "success" };
    }

    // Step 2: Fetch and process each new URL
    for (const item of newUrls) {
      try {
        // Fetch full content
        const fetchResult = await fetchWithRetry(item.url, 2);
        if (!fetchResult.ok) {
          details.push({ title: item.title, url: item.url, status: "fetch_failed" });
          continue;
        }

        // Use specialized parser for detail pages
        let content: string;
        let title: string;
        if (source.sourceType === "media" && item.url.includes("cifnews.com/article/")) {
          const parsed = parseCifNewsDetail(fetchResult.rawHtml || fetchResult.content);
          title = parsed.title || item.title;
          content = `[作者: ${parsed.author}] [日期: ${parsed.date}]\n\n${parsed.content}`;
        } else if (source.sourceType === "wearesellers" && item.url.includes("/question/")) {
          const parsed = parseWeareSellersDetail(fetchResult.rawHtml || fetchResult.content);
          title = parsed.title || item.title;
          // Combine question content with top answers for richer context
          const answerTexts = parsed.answers
            .sort((a, b) => b.votes - a.votes)
            .slice(0, 5)
            .map((a, i) => `\n\n--- 回答${i + 1} (${a.author}, ${a.votes}赞) ---\n${a.content}`)
            .join("");
          content = `[分类: ${parsed.category}] [作者: ${parsed.author}]\n\n${parsed.content}${answerTexts}`;
        } else {
          content = fetchResult.content;
          title = fetchResult.title || item.title;
        }

        if (content.length < 50) {
          details.push({ title, url: item.url, status: "content_too_short" });
          continue;
        }

        // Step 3: AI Quality Evaluation (if enabled)
        let qualityScore = 5;
        let scoreDetails: Record<string, unknown> = {};
        let summary = content.slice(0, 200);
        let suggestedType: "sop" | "listing" | "product" | "image" | "video" = "sop";

        if (source.autoEvaluateEnabled) {
          try {
            const evalResponse = await invokeLLM({
              messages: [
                { role: "system", content: "你是亚马逊运营内容质量评估专家。请严格输出JSON格式。" },
                { role: "user", content: buildQualityEvalPrompt(title, source.name, content) },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "quality_eval",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      scores: {
                        type: "object",
                        properties: {
                          relevance: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                          actionability: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                          timeliness: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                          depth: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                          uniqueness: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                        },
                        required: ["relevance", "actionability", "timeliness", "depth", "uniqueness"],
                        additionalProperties: false,
                      },
                      weightedTotal: { type: "number" },
                      summary: { type: "string" },
                      suggestedType: { type: "string", enum: ["sop", "listing", "product", "image", "video"] },
                    },
                    required: ["scores", "weightedTotal", "summary", "suggestedType"],
                    additionalProperties: false,
                  },
                },
              },
            });
            const contentStr = typeof evalResponse.choices[0].message.content === "string"
              ? evalResponse.choices[0].message.content
              : JSON.stringify(evalResponse.choices[0].message.content);
            const parsed = JSON.parse(contentStr || "{}");
            qualityScore = parsed.weightedTotal || 5;
            scoreDetails = parsed.scores || {};
            summary = parsed.summary || content.slice(0, 200);
            suggestedType = parsed.suggestedType || "sop";
            totalEvaluated++;
          } catch {
            // AI eval failed, use defaults
          }
        }

        const threshold = parseFloat(source.qualityThreshold || "6");
        const status = qualityScore >= threshold ? "recommended" : "pending";
        if (status === "recommended") totalRecommended++;

        // Insert into intel items
        await _d.insert(kbIntelItems).values({
          sourceId: source.id,
          title,
          originalUrl: item.url,
          rawContent: content,
          aiSummary: summary,
          aiQualityScore: String(qualityScore),
          aiScoreDetails: scoreDetails,
          aiSuggestedType: suggestedType,
          status,
          createdAt: Date.now(),
        });

        totalNew++;
        details.push({ title, url: item.url, status, qualityScore });
      } catch (err) {
        details.push({ title: item.title, url: item.url, status: "error: " + String(err) });
      }
    }

    // Step 4: Update log and source
    const completedAt = Date.now();
    const finalStatus = totalNew > 0 ? "success" : (totalFound > 0 ? "partial" : "success");

    await _d.update(kbIntelCollectLogs).set({
      status: finalStatus,
      totalFound,
      totalNew,
      totalDuplicate: totalFound - totalNew,
      totalEvaluated,
      totalRecommended,
      details,
      completedAt,
      durationMs: completedAt - startedAt,
    }).where(eq(kbIntelCollectLogs.id, logId));

    // Update source
    await _d.update(kbIntelSources).set({
      lastCrawledAt: startedAt,
      lastAutoCollectAt: triggerType === "auto" ? startedAt : undefined,
      totalCrawled: sql`${kbIntelSources.totalCrawled} + ${totalNew}`,
      consecutiveFailures: 0,
      updatedAt: Date.now(),
    }).where(eq(kbIntelSources.id, source.id));

    // Step 5: Notify owner if there are recommended items
    if (totalRecommended > 0) {
      try {
        await notifyOwner({
          title: `📰 情报采集完成: ${source.name}`,
          content: `发现 ${totalFound} 条内容，新增 ${totalNew} 条，其中 ${totalRecommended} 条达到推荐标准。请前往情报推荐中心查看。`,
        });
      } catch {
        // Notification failure is non-critical
      }
    }

    return {
      logId,
      totalFound,
      totalNew,
      totalDuplicate: totalFound - totalNew,
      totalEvaluated,
      totalRecommended,
      status: finalStatus as "success" | "partial",
    };
  } catch (err) {
    // Mark log as failed
    const completedAt = Date.now();
    await _d.update(kbIntelCollectLogs).set({
      status: "failed",
      errorMessage: String(err),
      details,
      completedAt,
      durationMs: completedAt - startedAt,
    }).where(eq(kbIntelCollectLogs.id, logId));

    // Increment failure counter
    await _d.update(kbIntelSources).set({
      consecutiveFailures: sql`${kbIntelSources.consecutiveFailures} + 1`,
      updatedAt: Date.now(),
    }).where(eq(kbIntelSources.id, source.id));

    return {
      logId,
      totalFound,
      totalNew,
      totalDuplicate: 0,
      totalEvaluated,
      totalRecommended,
      status: "failed",
    };
  }
}

// ─── Scheduler Class ───────────────────────────────
class IntelScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private activeCollections = new Set<number>(); // source IDs currently being collected

  start() {
    if (this.intervalId) return;
    console.log("[IntelScheduler] Starting auto-collect scheduler (check every 60s)");
    this.intervalId = setInterval(() => this.checkAndRun(), SCHEDULER_CHECK_INTERVAL);
    // Run initial check after 10 seconds
    setTimeout(() => this.checkAndRun(), 10000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[IntelScheduler] Stopped auto-collect scheduler");
    }
  }

  isActive() {
    return this.intervalId !== null;
  }

  getActiveCollections() {
    return Array.from(this.activeCollections);
  }

  private async checkAndRun() {
    if (this.isRunning) return; // Prevent overlapping checks
    this.isRunning = true;

    try {
      const _d = await getDb();
      if (!_d) return;

      const now = Date.now();

      // Find sources that need auto-collection
      const dueSources = await _d
        .select()
        .from(kbIntelSources)
        .where(
          and(
            eq(kbIntelSources.autoCollectEnabled, true),
            eq(kbIntelSources.isActive, true),
            lte(kbIntelSources.nextAutoCollectAt, now)
          )
        );

      // Also include sources with autoCollectEnabled but no nextAutoCollectAt set yet
      const uninitializedSources = await _d
        .select()
        .from(kbIntelSources)
        .where(
          and(
            eq(kbIntelSources.autoCollectEnabled, true),
            eq(kbIntelSources.isActive, true),
            sql`${kbIntelSources.nextAutoCollectAt} IS NULL`
          )
        );

      const allDueSources = [...dueSources, ...uninitializedSources];

      for (const source of allDueSources) {
        // Skip if already collecting or too many failures
        if (this.activeCollections.has(source.id)) continue;
        if ((source.consecutiveFailures || 0) >= MAX_CONSECUTIVE_FAILURES) {
          // Auto-disable after too many failures
          await _d.update(kbIntelSources).set({
            autoCollectEnabled: false,
            updatedAt: Date.now(),
          }).where(eq(kbIntelSources.id, source.id));
          console.log(`[IntelScheduler] Source ${source.id} (${source.name}) disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
          try {
            await notifyOwner({
              title: `⚠️ 情报源自动采集已暂停: ${source.name}`,
              content: `由于连续 ${MAX_CONSECUTIVE_FAILURES} 次采集失败，已自动暂停该情报源的定时采集。请检查URL是否有效后重新启用。`,
            });
          } catch { /* non-critical */ }
          continue;
        }

        // Start collection in background
        this.activeCollections.add(source.id);
        this.runCollection(source).finally(() => {
          this.activeCollections.delete(source.id);
        });
      }
    } catch (err) {
      console.error("[IntelScheduler] Check error:", err);
    } finally {
      this.isRunning = false;
    }
  }

  private async runCollection(source: typeof kbIntelSources.$inferSelect) {
    try {
      console.log(`[IntelScheduler] Auto-collecting from: ${source.name} (ID: ${source.id})`);
      const result = await collectFromSource(
        {
          id: source.id,
          userId: source.userId,
          name: source.name,
          url: source.url,
          sourceType: source.sourceType,
          qualityThreshold: source.qualityThreshold,
          autoEvaluateEnabled: source.autoEvaluateEnabled,
          autoCollectMaxItems: source.autoCollectMaxItems,
        },
        "auto"
      );
      console.log(`[IntelScheduler] Collection complete for ${source.name}: found=${result.totalFound}, new=${result.totalNew}, recommended=${result.totalRecommended}`);

      // Update next run time
      const _d = await getDb();
      if (_d) {
        const nextRun = calculateNextRunTime(
          source.autoCollectInterval,
          source.autoCollectCron,
          Date.now()
        );
        await _d.update(kbIntelSources).set({
          nextAutoCollectAt: nextRun,
          updatedAt: Date.now(),
        }).where(eq(kbIntelSources.id, source.id));
      }
    } catch (err) {
      console.error(`[IntelScheduler] Collection failed for ${source.name}:`, err);
    }
  }
}

// ─── Singleton Instance ────────────────────────────
export const intelScheduler = new IntelScheduler();

// ─── Exported helper to recalculate next run ───────
export async function updateSourceSchedule(sourceId: number) {
  const _d = await getDb();
  if (!_d) return;
  const [source] = await _d.select().from(kbIntelSources).where(eq(kbIntelSources.id, sourceId));
  if (!source || !source.autoCollectEnabled) return;
  const nextRun = calculateNextRunTime(source.autoCollectInterval, source.autoCollectCron);
  await _d.update(kbIntelSources).set({
    nextAutoCollectAt: nextRun,
    updatedAt: Date.now(),
  }).where(eq(kbIntelSources.id, sourceId));
}
