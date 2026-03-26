/**
 * Amazon Crawler Engine
 * 
 * 功能：
 * 1. 竞品价格/排名/评论数定时抓取
 * 2. 关键词自然排名/广告排名抓取
 * 3. 代理支持 + UA轮换 + 重试
 * 4. 定时调度（每日/每周）
 * 5. 抓取日志和错误处理
 */

import * as cheerio from "cheerio";
import { getScraperConfig } from "./routers/systemSettings";
import { smartFetch, buildProxyPool, randomDelay as antiBotDelay } from "./antiBot";

// ============== Types ==============

export interface CrawlResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
  usedProxy: boolean;
}

export interface CompetitorCrawlData {
  asin: string;
  price: number | null;
  bsrRank: number | null;
  bsrCategory: string | null;
  reviewCount: number | null;
  rating: number | null;
  isInStock: boolean;
  couponInfo: string | null;
  dealInfo: string | null;
  mainImageUrl: string | null;
  bulletPoints: string[];
  title: string | null;
}

export interface KeywordRankData {
  keyword: string;
  targetAsin: string;
  organicRank: number | null;
  adRank: number | null;
  pageNumber: number | null;
  totalResults: number | null;
}

// ============== Anti-Bot: Now uses shared antiBot.ts module ==============
// All UA rotation, fingerprinting, CAPTCHA detection, and proxy rotation
// is handled by the shared antiBot module.

/**
 * Fetch Amazon page using the shared antiBot smart fetch engine.
 */
async function fetchPage(url: string, config?: {
  proxyUrl?: string;
  timeout?: number;
  maxRetries?: number;
}): Promise<string> {
  const proxyPool = buildProxyPool(config?.proxyUrl, 5);
  return smartFetch(url, {
    proxyUrl: config?.proxyUrl,
    proxyPool: proxyPool.length > 0 ? proxyPool : undefined,
    maxRetries: config?.maxRetries ?? 5,
    baseDelay: 3000,
    timeout: config?.timeout ?? 25000,
    simulateNavigation: true,
  });
}

// ============== Competitor Data Crawler ==============

export async function crawlCompetitorData(asin: string, marketplace: string = "US"): Promise<CrawlResult> {
  const startTime = Date.now();
  const scraperConfig = await getScraperConfig();

  try {
    const domain = marketplace === "US" ? "www.amazon.com" :
                   marketplace === "UK" ? "www.amazon.co.uk" :
                   marketplace === "DE" ? "www.amazon.de" :
                   marketplace === "JP" ? "www.amazon.co.jp" :
                   marketplace === "CA" ? "www.amazon.ca" :
                   marketplace === "FR" ? "www.amazon.fr" :
                   marketplace === "IT" ? "www.amazon.it" :
                   marketplace === "ES" ? "www.amazon.es" : "www.amazon.com";

    const url = `https://${domain}/dp/${asin}`;
    const html = await fetchPage(url, {
      proxyUrl: scraperConfig.proxyUrl,
      timeout: scraperConfig.timeout,
      maxRetries: scraperConfig.maxRetries,
    });

    const $ = cheerio.load(html);

    // Extract price
    let priceStr = $("span.a-price span.a-offscreen").first().text().trim()
      || $("span#priceblock_ourprice").text().trim()
      || $("span.a-price-whole").first().text().trim()
      || "";
    const priceMatch = priceStr.match(/([\d,.]+)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : null;

    // Extract BSR rank
    let bsrRank: number | null = null;
    let bsrCategory: string | null = null;
    const bsrText = $("th:contains('Best Sellers Rank')").next().text()
      || $("span:contains('Best Sellers Rank')").parent().text()
      || $("li#SalesRank").text()
      || "";
    const bsrMatch = bsrText.match(/#([\d,]+)\s+in\s+(.+?)(?:\(|$)/);
    if (bsrMatch) {
      bsrRank = parseInt(bsrMatch[1].replace(/,/g, ""), 10);
      bsrCategory = bsrMatch[2].trim();
    }

    // Extract review count and rating
    const ratingText = $("span#acrPopover").attr("title")
      || $("i.a-icon-star span.a-icon-alt").first().text().trim()
      || "";
    const ratingMatch = ratingText.match(/([\d.]+)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    const reviewCountText = $("span#acrCustomerReviewText").text().trim()
      || $("a#acrCustomerReviewLink span").text().trim()
      || "";
    const reviewCountMatch = reviewCountText.match(/([\d,]+)/);
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1].replace(/,/g, ""), 10) : null;

    // In stock check
    const availabilityText = $("div#availability span").text().trim().toLowerCase();
    const isInStock = !availabilityText.includes("unavailable") && !availabilityText.includes("out of stock");

    // Coupon info
    const couponEl = $("span.a-coupon-badge, div#couponBadgeRegularVpc").text().trim();
    const couponInfo = couponEl || null;

    // Deal info
    const dealEl = $("span.a-badge-text:contains('Deal')").text().trim()
      || $("span.dealBadge").text().trim();
    const dealInfo = dealEl || null;

    // Main image
    const mainImageUrl = $("img#landingImage").attr("src")
      || $("img#imgBlkFront").attr("src")
      || null;

    // Bullet points
    const bulletPoints: string[] = [];
    $("#feature-bullets ul li span.a-list-item").each((_, el) => {
      const text = $(el).text().trim();
      if (text && !text.includes("Make sure this fits") && !text.includes("See more")) {
        bulletPoints.push(text);
      }
    });

    // Title
    const title = $("#productTitle").text().trim() || null;

    const data: CompetitorCrawlData = {
      asin,
      price,
      bsrRank,
      bsrCategory,
      reviewCount,
      rating,
      isInStock,
      couponInfo,
      dealInfo,
      mainImageUrl,
      bulletPoints,
      title,
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
      usedProxy: !!scraperConfig.proxyUrl,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Unknown error",
      duration: Date.now() - startTime,
      usedProxy: !!scraperConfig.proxyUrl,
    };
  }
}

// ============== Keyword Rank Crawler ==============

export async function crawlKeywordRank(
  keyword: string,
  targetAsin: string,
  marketplace: string = "US"
): Promise<CrawlResult> {
  const startTime = Date.now();
  const scraperConfig = await getScraperConfig();

  try {
    const domain = marketplace === "US" ? "www.amazon.com" :
                   marketplace === "UK" ? "www.amazon.co.uk" :
                   marketplace === "DE" ? "www.amazon.de" :
                   marketplace === "JP" ? "www.amazon.co.jp" : "www.amazon.com";

    const encodedKw = encodeURIComponent(keyword);
    const url = `https://${domain}/s?k=${encodedKw}`;
    const html = await fetchPage(url, {
      proxyUrl: scraperConfig.proxyUrl,
      timeout: scraperConfig.timeout,
      maxRetries: scraperConfig.maxRetries,
    });

    const $ = cheerio.load(html);

    let organicRank: number | null = null;
    let adRank: number | null = null;
    let organicIndex = 0;
    let adIndex = 0;

    // Parse search results
    $("div[data-asin]").each((_, el) => {
      const asin = $(el).attr("data-asin");
      if (!asin) return;

      const isAd = $(el).find("span:contains('Sponsored')").length > 0
        || $(el).find("span:contains('Ad')").length > 0;

      if (isAd) {
        adIndex++;
        if (asin === targetAsin && !adRank) {
          adRank = adIndex;
        }
      } else {
        organicIndex++;
        if (asin === targetAsin && !organicRank) {
          organicRank = organicIndex;
        }
      }
    });

    // Total results
    const totalText = $("span.s-search-results span:contains('results')").first().text()
      || $("div.s-breadcrumb span:last-child").text()
      || "";
    const totalMatch = totalText.match(/([\d,]+)\s+results/i);
    const totalResults = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : null;

    const data: KeywordRankData = {
      keyword,
      targetAsin,
      organicRank,
      adRank,
      pageNumber: 1,
      totalResults,
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
      usedProxy: !!scraperConfig.proxyUrl,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Unknown error",
      duration: Date.now() - startTime,
      usedProxy: !!scraperConfig.proxyUrl,
    };
  }
}

// ============== Batch Crawl Scheduler ==============

export interface CrawlJob {
  type: "competitor" | "keyword";
  id: number; // monitor ID
  asin?: string;
  keyword?: string;
  targetAsin?: string;
  marketplace?: string;
}

export interface CrawlJobResult extends CrawlJob {
  result: CrawlResult;
  completedAt: number;
}

/**
 * Execute a batch of crawl jobs with rate limiting
 */
export async function executeCrawlBatch(
  jobs: CrawlJob[],
  onProgress?: (completed: number, total: number, result: CrawlJobResult) => void
): Promise<CrawlJobResult[]> {
  const results: CrawlJobResult[] = [];
  const scraperConfig = await getScraperConfig();
  const minDelay = scraperConfig.minRequestDelay ?? 2000;
  const maxDelay = scraperConfig.maxRequestDelay ?? 5000;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];

    let result: CrawlResult;
    if (job.type === "competitor" && job.asin) {
      result = await crawlCompetitorData(job.asin, job.marketplace);
    } else if (job.type === "keyword" && job.keyword && job.targetAsin) {
      result = await crawlKeywordRank(job.keyword, job.targetAsin, job.marketplace);
    } else {
      result = { success: false, error: "Invalid job config", duration: 0, usedProxy: false };
    }

    const jobResult: CrawlJobResult = {
      ...job,
      result,
      completedAt: Date.now(),
    };
    results.push(jobResult);

    if (onProgress) {
      onProgress(i + 1, jobs.length, jobResult);
    }

    // Rate limiting delay between requests
    if (i < jobs.length - 1) {
      await antiBotDelay(minDelay, maxDelay);
    }
  }

  return results;
}

// ============== Crawler Scheduler (in-memory) ==============

interface SchedulerState {
  isRunning: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  intervalId: ReturnType<typeof setInterval> | null;
  lastResults: CrawlJobResult[];
  totalRuns: number;
  totalSuccess: number;
  totalFailed: number;
}

const schedulerState: SchedulerState = {
  isRunning: false,
  lastRunAt: null,
  nextRunAt: null,
  intervalId: null,
  lastResults: [],
  totalRuns: 0,
  totalSuccess: 0,
  totalFailed: 0,
};

export function getSchedulerStatus() {
  return {
    isRunning: schedulerState.isRunning,
    lastRunAt: schedulerState.lastRunAt,
    nextRunAt: schedulerState.nextRunAt,
    totalRuns: schedulerState.totalRuns,
    totalSuccess: schedulerState.totalSuccess,
    totalFailed: schedulerState.totalFailed,
    lastResultCount: schedulerState.lastResults.length,
  };
}

export function startScheduler(intervalMs: number, jobProvider: () => Promise<CrawlJob[]>) {
  if (schedulerState.intervalId) {
    clearInterval(schedulerState.intervalId);
  }

  schedulerState.isRunning = true;
  schedulerState.nextRunAt = Date.now() + intervalMs;

  schedulerState.intervalId = setInterval(async () => {
    try {
      const jobs = await jobProvider();
      if (jobs.length === 0) return;

      schedulerState.lastRunAt = Date.now();
      schedulerState.totalRuns++;

      const results = await executeCrawlBatch(jobs);
      schedulerState.lastResults = results;

      const successCount = results.filter(r => r.result.success).length;
      schedulerState.totalSuccess += successCount;
      schedulerState.totalFailed += results.length - successCount;
      schedulerState.nextRunAt = Date.now() + intervalMs;
    } catch (err) {
      console.error("[CrawlerScheduler] Error:", err);
    }
  }, intervalMs);
}

export function stopScheduler() {
  if (schedulerState.intervalId) {
    clearInterval(schedulerState.intervalId);
    schedulerState.intervalId = null;
  }
  schedulerState.isRunning = false;
  schedulerState.nextRunAt = null;
}
