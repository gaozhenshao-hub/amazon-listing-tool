import axios from "axios";
import * as cheerio from "cheerio";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

/** Recognized A+ module types based on Amazon's Premium A+ Content modules */
export type AplusModuleType =
  | "comparison_table"      // 对比表格模块
  | "image_carousel"        // 图片轮播模块
  | "full_width_image"      // 全宽图片模块
  | "image_text_overlay"    // 图文叠加模块
  | "standard_image_text"   // 标准图文模块
  | "four_image_text"       // 四图文模块
  | "three_image_text"      // 三图文模块
  | "hotspot_interactive"   // 热点交互模块
  | "video_module"          // 视频模块
  | "brand_story_hero"      // 品牌故事主图
  | "brand_story_card"      // 品牌故事卡片
  | "single_image_sidebar"  // 单图侧边栏
  | "tech_specs"            // 技术参数模块
  | "navigation_carousel"   // 导航轮播模块
  | "unknown";              // 未识别

export interface ProductImage {
  url: string;
  position: "main" | "secondary" | "aplus" | "brand_story";
  positionIndex: number;
  /** For A+ images: the module type (e.g. "comparison_table") */
  aplusModuleType?: AplusModuleType;
  /** For A+ images: the raw CSS class of the module container */
  aplusModuleClass?: string;
}

export interface AmazonProductData {
  title: string;
  bulletPoints: string[];
  price: string;
  rating: string;
  reviewCount: string;
  description: string;
  brand: string;
  imageUrls: string[];
  /** Structured images with position classification */
  images: ProductImage[];
  reviews: string[];
  category: string;
  asin: string;
}

export interface ScraperConfig {
  /** Optional proxy URL (e.g. "http://user:pass@proxy.example.com:8080") */
  proxyUrl?: string;
  /** Max retries per request (default: 3) */
  maxRetries?: number;
  /** Base delay in ms between retries (default: 2000, exponential backoff) */
  retryBaseDelay?: number;
  /** Request timeout in ms (default: 20000) */
  timeout?: number;
  /** Min random delay between requests in ms (default: 1000) */
  minRequestDelay?: number;
  /** Max random delay between requests in ms (default: 3000) */
  maxRequestDelay?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Anti-Scraping: User-Agent Pool (20+ real browser UAs)
// ═══════════════════════════════════════════════════════════════════════

const USER_AGENTS = [
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Firefox on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  // Firefox on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Safari on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  // Edge on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  // Chrome on Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Chrome on Android (mobile)
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  // Safari on iPhone (mobile)
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
];

// Accept-Language variations to appear as different locales
const ACCEPT_LANGUAGES = [
  "en-US,en;q=0.9",
  "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
  "en-US,en;q=0.9,es;q=0.8",
  "en-GB,en;q=0.9,en-US;q=0.8",
  "en,en-US;q=0.9",
];

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate realistic browser headers with randomized fingerprint.
 */
function getHeaders(): Record<string, string> {
  const ua = getRandomItem(USER_AGENTS);
  const isFirefox = ua.includes("Firefox");
  const isSafari = ua.includes("Safari") && !ua.includes("Chrome");
  const isMobile = ua.includes("Mobile");

  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Accept-Language": getRandomItem(ACCEPT_LANGUAGES),
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };

  // Browser-specific Accept header
  if (isFirefox) {
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
  } else if (isSafari) {
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  } else {
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
  }

  // Sec-* headers (Chrome/Edge only, not Firefox/Safari)
  if (!isFirefox && !isSafari) {
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";
    headers["Sec-Ch-Ua-Platform"] = ua.includes("Windows") ? '"Windows"' : ua.includes("Mac") ? '"macOS"' : '"Linux"';
    headers["Sec-Ch-Ua-Mobile"] = isMobile ? "?1" : "?0";
  }

  return headers;
}

/**
 * Random delay between min and max milliseconds.
 */
function randomDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.floor(Math.random() * (max - min));
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════
// Anti-Scraping: Fetch with Retry + Exponential Backoff + Proxy
// ═══════════════════════════════════════════════════════════════════════

async function fetchWithRetry(url: string, config: ScraperConfig = {}): Promise<string> {
  const maxRetries = config.maxRetries ?? 3;
  const baseDelay = config.retryBaseDelay ?? 2000;
  const timeout = config.timeout ?? 20000;

  // Build axios config
  const axiosConfig: any = {
    headers: getHeaders(),
    timeout,
    maxRedirects: 5,
    // Decompress gzip/br responses
    decompress: true,
  };

  // Proxy support
  if (config.proxyUrl) {
    try {
      const proxyUrlObj = new URL(config.proxyUrl);
      axiosConfig.proxy = {
        host: proxyUrlObj.hostname,
        port: parseInt(proxyUrlObj.port) || 8080,
        protocol: proxyUrlObj.protocol.replace(":", ""),
        ...(proxyUrlObj.username ? {
          auth: {
            username: decodeURIComponent(proxyUrlObj.username),
            password: decodeURIComponent(proxyUrlObj.password || ""),
          }
        } : {}),
      };
      console.log(`[Scraper] Using proxy: ${proxyUrlObj.hostname}:${proxyUrlObj.port}`);
    } catch (e) {
      console.warn(`[Scraper] Invalid proxy URL: ${config.proxyUrl}, proceeding without proxy`);
    }
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Rotate headers for each attempt
      axiosConfig.headers = getHeaders();

      // Add Referer on retries to simulate navigation
      if (attempt > 0) {
        axiosConfig.headers["Referer"] = "https://www.amazon.com/s?k=" + encodeURIComponent("product");
      }

      const response = await axios.get(url, axiosConfig);

      if (response.status === 200 && response.data) {
        const html = typeof response.data === "string" ? response.data : String(response.data);

        // Check for CAPTCHA / robot check page
        if (html.includes("api-services-support@amazon.com") || html.includes("Type the characters you see in this image")) {
          console.warn(`[Scraper] CAPTCHA detected on attempt ${attempt + 1} for ${url}`);
          if (attempt < maxRetries - 1) {
            // Longer delay on CAPTCHA
            const captchaDelay = baseDelay * Math.pow(3, attempt + 1);
            console.log(`[Scraper] Waiting ${captchaDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, captchaDelay));
            continue;
          }
          throw new Error("Amazon CAPTCHA detected. Consider using a proxy or waiting before retrying.");
        }

        // Check for empty/error page
        if (html.length < 5000 || html.includes("Sorry, we just need to make sure you")) {
          console.warn(`[Scraper] Suspicious response on attempt ${attempt + 1} (${html.length} bytes)`);
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
            continue;
          }
        }

        return html;
      }

      // Non-200 status
      console.warn(`[Scraper] HTTP ${response.status} on attempt ${attempt + 1} for ${url}`);
    } catch (error: any) {
      const errMsg = error.message || "Unknown error";
      const status = error.response?.status;

      console.warn(`[Scraper] Attempt ${attempt + 1}/${maxRetries} failed for ${url}: ${errMsg}${status ? ` (HTTP ${status})` : ""}`);

      // 503 = throttled, use longer backoff
      if (status === 503 && attempt < maxRetries - 1) {
        const throttleDelay = baseDelay * Math.pow(3, attempt + 1);
        console.log(`[Scraper] Throttled (503), waiting ${throttleDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, throttleDelay));
        continue;
      }
    }

    // Exponential backoff between retries
    if (attempt < maxRetries - 1) {
      const delay = baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
      console.log(`[Scraper] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries. Amazon may be blocking requests. Try using a proxy.`);
}

// ═══════════════════════════════════════════════════════════════════════
// Image URL Processing
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert an Amazon image URL to its highest resolution version.
 * Amazon uses suffixes like ._AC_SY355_. or ._AC_SL1500_. to control size.
 * We replace these with ._AC_SL1500_. for the highest quality.
 */
export function toHighRes(url: string): string {
  if (!url) return url;
  // If it's an aplus-media-library URL, remove the __CR params for original size
  if (url.includes("aplus-media-library")) {
    return url.replace(/\.__CR\d+,\d+,\d+,\d+_PT\d+_SX\d+_V\d+___/, "");
  }
  // For standard product images, upgrade to SL1500 (highest standard res)
  return url
    .replace(/\._[A-Z]{2}_S[XYL]\d+_\./, "._AC_SL1500_.")
    .replace(/\._AC_US\d+_\./, "._AC_SL1500_.")
    .replace(/\._SS\d+_\./, "._AC_SL1500_.");
}

/**
 * Check if a URL is a video thumbnail (not a product image).
 */
export function isVideoThumbnail(url: string): boolean {
  return (
    url.includes("dp-play-icon-overlay") ||
    url.includes("play-button") ||
    url.includes("video-icon") ||
    url.includes("/videos/") ||
    url.includes("video-thumbs")
  );
}

// ═══════════════════════════════════════════════════════════════════════
// A+ Module Type Identification
// ═══════════════════════════════════════════════════════════════════════

/**
 * Map Amazon's internal A+ module CSS classes to human-readable types.
 * Amazon uses classes like:
 * - apm-tablemodule-* → comparison_table
 * - apm-carousel-* → image_carousel
 * - apm-full-width-* → full_width_image
 * - apm-image-text-overlay-* → image_text_overlay
 * - apm-four-image-text-* → four_image_text
 * - apm-three-image-text-* → three_image_text
 * - apm-hotspot-* → hotspot_interactive
 * - apm-video-* → video_module
 * - apm-brand-story-hero → brand_story_hero
 * - apm-brand-story-card → brand_story_card
 * - premium-aplus-module-N → various based on N
 */
export function identifyAplusModuleType(htmlContext: string): AplusModuleType {
  const ctx = htmlContext.toLowerCase();

  // Comparison / Table modules
  if (ctx.includes("apm-tablemodule") || ctx.includes("comparison-table") ||
      ctx.includes("aplus-comparison") || ctx.includes("a-compare")) {
    return "comparison_table";
  }

  // Carousel modules
  if (ctx.includes("apm-carousel") || ctx.includes("carousel-module") ||
      ctx.includes("a-carousel") || ctx.includes("image-carousel")) {
    return "image_carousel";
  }

  // Full-width image
  if (ctx.includes("apm-full-width") || ctx.includes("full-bleed") ||
      ctx.includes("full-width-image") || ctx.includes("premium-aplus-module-1")) {
    return "full_width_image";
  }

  // Image text overlay
  if (ctx.includes("apm-image-text-overlay") || ctx.includes("text-overlay") ||
      ctx.includes("overlay-module")) {
    return "image_text_overlay";
  }

  // Four image + text
  if (ctx.includes("apm-four-image") || ctx.includes("four-image-text") ||
      ctx.includes("premium-aplus-module-4") || ctx.includes("quad-image")) {
    return "four_image_text";
  }

  // Three image + text
  if (ctx.includes("apm-three-image") || ctx.includes("three-image-text") ||
      ctx.includes("premium-aplus-module-3") || ctx.includes("triple-image")) {
    return "three_image_text";
  }

  // Hotspot / Interactive
  if (ctx.includes("apm-hotspot") || ctx.includes("hotspot") || ctx.includes("interactive-module")) {
    return "hotspot_interactive";
  }

  // Video module
  if (ctx.includes("apm-video") || ctx.includes("video-module") || ctx.includes("video-player")) {
    return "video_module";
  }

  // Brand story hero
  if (ctx.includes("apm-brand-story-hero") || ctx.includes("brand-story-hero")) {
    return "brand_story_hero";
  }

  // Brand story card
  if (ctx.includes("apm-brand-story-card") || ctx.includes("brand-story-card")) {
    return "brand_story_card";
  }

  // Single image with sidebar text
  if (ctx.includes("apm-single-image") || ctx.includes("single-image-sidebar") ||
      ctx.includes("premium-aplus-module-2")) {
    return "single_image_sidebar";
  }

  // Tech specs
  if (ctx.includes("apm-tech-spec") || ctx.includes("tech-specs") || ctx.includes("specification-table")) {
    return "tech_specs";
  }

  // Navigation carousel
  if (ctx.includes("apm-navigation") || ctx.includes("navigation-carousel")) {
    return "navigation_carousel";
  }

  // Standard image + text (most common fallback)
  if (ctx.includes("apm-standard") || ctx.includes("standard-image") ||
      ctx.includes("image-text-module") || ctx.includes("aplus-module-")) {
    return "standard_image_text";
  }

  return "unknown";
}

/**
 * Extract the surrounding HTML context (500 chars before the image) to identify module type.
 */
function getModuleContext(html: string, imageIndex: number, contextSize: number = 800): string {
  const start = Math.max(0, imageIndex - contextSize);
  return html.substring(start, imageIndex);
}

// ═══════════════════════════════════════════════════════════════════════
// Product Image Extraction
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extract product images from the page HTML.
 * Strategy:
 * 1. Primary: Extract hiRes URLs from colorImages JavaScript data (highest quality)
 * 2. Fallback: Use data-a-dynamic-image attributes
 * 3. Last resort: Parse img tags from altImages/imageBlock
 */
function extractProductImages(html: string, $: cheerio.CheerioAPI): ProductImage[] {
  const images: ProductImage[] = [];
  const seenUrls = new Set<string>();

  // ── Strategy 1: Extract from colorImages JavaScript data ──────────
  const hiResUrls: string[] = [];
  const largeUrls: string[] = [];
  const variants: string[] = [];

  // Extract hiRes URLs
  const hiResMatches = html.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
  if (hiResMatches) {
    for (const m of hiResMatches) {
      const urlMatch = m.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/);
      if (urlMatch) hiResUrls.push(urlMatch[1]);
    }
  }

  // Extract large URLs as fallback (when hiRes is null)
  const largeMatches = html.match(/"large"\s*:\s*"(https:\/\/[^"]+)"/g);
  if (largeMatches) {
    for (const m of largeMatches) {
      const urlMatch = m.match(/"large"\s*:\s*"(https:\/\/[^"]+)"/);
      if (urlMatch) largeUrls.push(urlMatch[1]);
    }
  }

  // Extract variant types
  const variantMatches = html.match(/"variant"\s*:\s*"([^"]+)"/g);
  if (variantMatches) {
    for (const m of variantMatches) {
      const varMatch = m.match(/"variant"\s*:\s*"([^"]+)"/);
      if (varMatch) variants.push(varMatch[1]);
    }
  }

  if (hiResUrls.length > 0 || largeUrls.length > 0) {
    const maxLen = Math.max(hiResUrls.length, largeUrls.length, variants.length);
    console.log(`[Scraper] Found ${hiResUrls.length} hiRes, ${largeUrls.length} large, ${variants.length} variants from colorImages`);

    for (let i = 0; i < maxLen; i++) {
      const variant = variants[i] || "";

      // Skip VIDEO variants entirely
      if (variant === "VIDEO" || variant.startsWith("VIDEO")) continue;

      // Get best available URL: hiRes > large (upgraded)
      let url = hiResUrls[i] || "";
      if (!url || url === "null") {
        url = largeUrls[i] ? toHighRes(largeUrls[i]) : "";
      }
      if (!url || url === "null") continue;

      // Skip video thumbnails
      if (isVideoThumbnail(url)) continue;

      // Determine position: MAIN variant is the main image
      const isMain = variant === "MAIN" || (i === 0 && !variant);
      const position: "main" | "secondary" = isMain ? "main" : "secondary";
      const posIdx = isMain ? 0 : images.filter(img => img.position === "secondary").length + 1;

      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        images.push({ url, position, positionIndex: posIdx });
      }
    }
  }

  // ── Strategy 2: Fallback to data-a-dynamic-image ──────────────────
  if (images.length === 0) {
    console.log("[Scraper] Falling back to data-a-dynamic-image extraction");
    const dynImgEls = $("[data-a-dynamic-image]");
    let mainFound = false;

    dynImgEls.each((_, el) => {
      const dataStr = $(el).attr("data-a-dynamic-image") || "";
      const urlMatches = dataStr.match(/"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/g);
      if (!urlMatches) return;

      let bestUrl = "";
      let bestSize = 0;
      for (const um of urlMatches) {
        const urlStr = um.replace(/"/g, "");
        const sizeMatch = urlStr.match(/SX(\d+)|SY(\d+)|SL(\d+)/);
        const size = sizeMatch ? parseInt(sizeMatch[1] || sizeMatch[2] || sizeMatch[3]) : 0;
        if (size > bestSize) {
          bestSize = size;
          bestUrl = urlStr;
        }
      }

      if (bestUrl) {
        const hiResUrl = toHighRes(bestUrl);
        if (!seenUrls.has(hiResUrl) && !isVideoThumbnail(hiResUrl)) {
          seenUrls.add(hiResUrl);
          const position: "main" | "secondary" = !mainFound ? "main" : "secondary";
          const posIdx = !mainFound ? 0 : images.filter(img => img.position === "secondary").length + 1;
          if (!mainFound) mainFound = true;
          images.push({ url: hiResUrl, position, positionIndex: posIdx });
        }
      }
    });
  }

  // ── Strategy 3: Last resort - parse img tags ──────────────────────
  if (images.length === 0) {
    console.log("[Scraper] Last resort: parsing img tags from altImages");
    const mainImg = $("img#landingImage").attr("src") || $("img#imgBlkFront").attr("src") || "";
    if (mainImg && !isVideoThumbnail(mainImg)) {
      const hiRes = toHighRes(mainImg);
      seenUrls.add(hiRes);
      images.push({ url: hiRes, position: "main", positionIndex: 0 });
    }

    $("li.imageThumbnail img, div#altImages li:not(.videoThumbnail) img").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (!src || isVideoThumbnail(src) || src.includes("sprite") || src.includes("grey-pixel")) return;
      const hiRes = toHighRes(src);
      if (!seenUrls.has(hiRes)) {
        seenUrls.add(hiRes);
        images.push({
          url: hiRes,
          position: "secondary",
          positionIndex: images.filter(img => img.position === "secondary").length + 1,
        });
      }
    });
  }

  // Filter out any remaining video thumbnails
  return images.filter(img => !isVideoThumbnail(img.url));
}

// ═══════════════════════════════════════════════════════════════════════
// A+ Content Image Extraction (with Module Type Identification)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extract A+ content images from the page with module type identification.
 * A+ content is in the #aplus_feature_div section, before #aplusBrandStory_feature_div.
 */
function extractAplusImages(html: string): ProductImage[] {
  const images: ProductImage[] = [];
  const seenUrls = new Set<string>();

  const aplusStart = html.indexOf('id="aplus_feature_div"');
  const brandStoryStart = html.indexOf('id="aplusBrandStory_feature_div"');

  if (aplusStart < 0) {
    console.log("[Scraper] No A+ content section found");
    return images;
  }

  const endPos = brandStoryStart > aplusStart ? brandStoryStart : aplusStart + 200000;
  const aplusHtml = html.substring(aplusStart, endPos);

  let idx = 0;

  // Extract images from aplus-media-library-service-media (primary A+ images)
  const aplusMediaRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/S\/aplus-media-library-service-media\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  let match;

  while ((match = aplusMediaRegex.exec(aplusHtml)) !== null) {
    let url = match[1];
    url = toHighRes(url);

    // Filter out tiny images (icons, spacers < 50px)
    const sizeMatch = url.match(/SX(\d+)/);
    if (sizeMatch && parseInt(sizeMatch[1]) < 50) continue;

    if (!seenUrls.has(url)) {
      seenUrls.add(url);

      // Identify the module type from surrounding HTML context
      const context = getModuleContext(aplusHtml, match.index!);
      const moduleType = identifyAplusModuleType(context);

      // Also try to extract the raw module class
      const classMatch = context.match(/class="[^"]*?(apm-[a-z-]+|premium-aplus-module-\d+)[^"]*"/i);
      const moduleClass = classMatch ? classMatch[1] : undefined;

      images.push({
        url,
        position: "aplus",
        positionIndex: idx++,
        aplusModuleType: moduleType,
        aplusModuleClass: moduleClass,
      });
    }
  }

  // Also extract standard Amazon images within A+ section
  const stdImgRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((match = stdImgRegex.exec(aplusHtml)) !== null) {
    let url = match[1];
    url = toHighRes(url);
    if (!seenUrls.has(url) && !url.includes("sprite") && !url.includes("grey-pixel") && !isVideoThumbnail(url)) {
      seenUrls.add(url);

      const context = getModuleContext(aplusHtml, match.index!);
      const moduleType = identifyAplusModuleType(context);
      const classMatch = context.match(/class="[^"]*?(apm-[a-z-]+|premium-aplus-module-\d+)[^"]*"/i);

      images.push({
        url,
        position: "aplus",
        positionIndex: idx++,
        aplusModuleType: moduleType,
        aplusModuleClass: classMatch ? classMatch[1] : undefined,
      });
    }
  }

  // Also check for aplus-seller-content-images pattern
  const sellerContentRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/S\/aplus-seller-content-images[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((match = sellerContentRegex.exec(aplusHtml)) !== null) {
    let url = match[1];
    url = toHighRes(url);
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      const context = getModuleContext(aplusHtml, match.index!);
      const moduleType = identifyAplusModuleType(context);

      images.push({
        url,
        position: "aplus",
        positionIndex: idx++,
        aplusModuleType: moduleType,
      });
    }
  }

  console.log(`[Scraper] Found ${images.length} A+ content images`);
  if (images.length > 0) {
    const typeCounts: Record<string, number> = {};
    for (const img of images) {
      const t = img.aplusModuleType || "unknown";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    console.log(`[Scraper] A+ module types: ${JSON.stringify(typeCounts)}`);
  }
  return images;
}

// ═══════════════════════════════════════════════════════════════════════
// Brand Story Image Extraction
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extract Brand Story images from the page.
 * Brand Story is in the #aplusBrandStory_feature_div section.
 */
function extractBrandStoryImages(html: string): ProductImage[] {
  const images: ProductImage[] = [];
  const seenUrls = new Set<string>();

  const brandStoryStart = html.indexOf('id="aplusBrandStory_feature_div"');
  if (brandStoryStart < 0) {
    console.log("[Scraper] No Brand Story section found");
    return images;
  }

  const nextSectionMatch = html.substring(brandStoryStart + 50).match(/id="[a-z]+_feature_div"/i);
  const endPos = nextSectionMatch
    ? brandStoryStart + 50 + (nextSectionMatch.index || 100000)
    : brandStoryStart + 100000;
  const brandHtml = html.substring(brandStoryStart, endPos);

  let idx = 0;

  // Extract aplus-media-library images
  const mediaRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/S\/aplus-media-library-service-media\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  let match;
  while ((match = mediaRegex.exec(brandHtml)) !== null) {
    let url = match[1];
    url = toHighRes(url);
    const sizeMatch = url.match(/SX(\d+)/);
    if (sizeMatch && parseInt(sizeMatch[1]) < 100) continue;

    if (!seenUrls.has(url)) {
      seenUrls.add(url);

      // Identify brand story sub-type
      const context = getModuleContext(brandHtml, match.index!);
      let moduleType: AplusModuleType = "brand_story_card";
      if (context.includes("hero-image") || context.includes("brand-story-hero") || idx === 0) {
        moduleType = "brand_story_hero";
      }

      images.push({
        url,
        position: "brand_story",
        positionIndex: idx++,
        aplusModuleType: moduleType,
      });
    }
  }

  // Also get standard images in brand story
  const stdRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((match = stdRegex.exec(brandHtml)) !== null) {
    let url = match[1];
    url = toHighRes(url);
    if (!seenUrls.has(url) && !url.includes("sprite") && !url.includes("grey-pixel") && !isVideoThumbnail(url)) {
      seenUrls.add(url);

      const context = getModuleContext(brandHtml, match.index!);
      let moduleType: AplusModuleType = "brand_story_card";
      if (context.includes("hero-image") || context.includes("brand-story-hero")) {
        moduleType = "brand_story_hero";
      }

      images.push({
        url,
        position: "brand_story",
        positionIndex: idx++,
        aplusModuleType: moduleType,
      });
    }
  }

  // Extract seller-content images in brand story
  const sellerRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/S\/aplus-seller-content-images[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((match = sellerRegex.exec(brandHtml)) !== null) {
    let url = match[1];
    url = toHighRes(url);
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      images.push({
        url,
        position: "brand_story",
        positionIndex: idx++,
        aplusModuleType: "brand_story_card",
      });
    }
  }

  console.log(`[Scraper] Found ${images.length} Brand Story images`);
  return images;
}

// ═══════════════════════════════════════════════════════════════════════
// Product Data Extraction
// ═══════════════════════════════════════════════════════════════════════

function extractProductData(html: string, asin: string): AmazonProductData {
  const $ = cheerio.load(html);

  // Title
  const title = $("#productTitle").text().trim()
    || $("h1.a-size-large span").first().text().trim()
    || $("h1#title span").text().trim()
    || "";

  // Bullet Points
  const bulletPoints: string[] = [];
  $("#feature-bullets ul li span.a-list-item").each((_, el) => {
    const text = $(el).text().trim();
    if (text && !text.includes("Make sure this fits") && !text.includes("See more product details")) {
      bulletPoints.push(text);
    }
  });
  if (bulletPoints.length === 0) {
    $("div#feature-bullets li").each((_, el) => {
      const text = $(el).text().trim();
      if (text) bulletPoints.push(text);
    });
  }

  // Price
  let price = "";
  price = $("span.a-price span.a-offscreen").first().text().trim()
    || $("span#priceblock_ourprice").text().trim()
    || $("span#priceblock_dealprice").text().trim()
    || $("span.a-price-whole").first().text().trim()
    || $("span#price_inside_buybox").text().trim()
    || "";
  if (price && !price.startsWith("$")) {
    const whole = $("span.a-price-whole").first().text().trim();
    const fraction = $("span.a-price-fraction").first().text().trim();
    if (whole) price = `$${whole}${fraction}`;
  }

  // Rating
  const ratingText = $("span#acrPopover").attr("title")
    || $("i.a-icon-star span.a-icon-alt").first().text().trim()
    || $("span.a-icon-alt").first().text().trim()
    || "";
  const ratingMatch = ratingText.match(/([\d.]+)/);
  const rating = ratingMatch ? ratingMatch[1] : "";

  // Review count
  const reviewCountText = $("span#acrCustomerReviewText").text().trim()
    || $("a#acrCustomerReviewLink span").text().trim()
    || "";
  const reviewCountMatch = reviewCountText.match(/([\d,]+)/);
  const reviewCount = reviewCountMatch ? reviewCountMatch[1].replace(/,/g, "") : "";

  // Description
  const description = $("div#productDescription p").text().trim()
    || $("div#productDescription").text().trim()
    || $("div.a-section.a-spacing-small p").first().text().trim()
    || "";

  // Brand
  const brand = $("a#bylineInfo").text().trim().replace(/^(Visit the |Brand: )/, "").replace(/ Store$/, "")
    || $("tr.po-brand td.a-span9 span").text().trim()
    || $("div#bylineInfo_feature_div a").text().trim()
    || "";

  // ── Extract all images with proper classification ─────────────────
  const productImages = extractProductImages(html, $);
  const aplusImages = extractAplusImages(html);
  const brandStoryImages = extractBrandStoryImages(html);

  // Combine all images
  const allImages = [...productImages, ...aplusImages, ...brandStoryImages];

  // Legacy imageUrls: only product images (main + secondary) for backward compatibility
  const imageUrls = productImages.map(img => img.url);

  // Category
  const categoryParts: string[] = [];
  $("a.a-link-normal.a-color-tertiary").each((_, el) => {
    const text = $(el).text().trim();
    if (text) categoryParts.push(text);
  });
  const category = categoryParts.join(" > ") || "";

  console.log(`[Scraper] Image extraction summary: ${productImages.length} product, ${aplusImages.length} A+, ${brandStoryImages.length} brand story`);

  return {
    title,
    bulletPoints,
    price,
    rating,
    reviewCount,
    description,
    brand,
    imageUrls: Array.from(new Set(imageUrls)),
    images: allImages,
    reviews: [],
    category,
    asin,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Review Extraction
// ═══════════════════════════════════════════════════════════════════════

async function fetchReviews(asin: string, config: ScraperConfig = {}): Promise<string[]> {
  const reviews: string[] = [];
  try {
    // Random delay before review fetch to avoid pattern detection
    await randomDelay(config.minRequestDelay ?? 1000, config.maxRequestDelay ?? 3000);

    const url = `https://www.amazon.com/product-reviews/${asin}/ref=cm_cr_dp_d_show_all_btm?ie=UTF8&reviewerType=all_reviews&sortBy=recent`;
    const html = await fetchWithRetry(url, config);
    const $ = cheerio.load(html);

    $("div.review span.review-text-content span, div[data-hook='review-body'] span").each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 20) {
        reviews.push(text);
      }
    });

    if (reviews.length === 0) {
      $("div.a-row.review-data span.review-text").each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 20) {
          reviews.push(text);
        }
      });
    }
  } catch (error: any) {
    console.warn(`[Scraper] Failed to fetch reviews for ${asin}: ${error.message}`);
  }

  return Array.from(new Set(reviews)).slice(0, 30);
}

// ═══════════════════════════════════════════════════════════════════════
// Main Export
// ═══════════════════════════════════════════════════════════════════════

export async function scrapeAmazonProduct(asin: string, config: ScraperConfig = {}): Promise<AmazonProductData> {
  console.log(`[Scraper] Starting scrape for ASIN: ${asin}${config.proxyUrl ? " (with proxy)" : ""}`);

  const productUrl = `https://www.amazon.com/dp/${asin}`;
  const html = await fetchWithRetry(productUrl, config);
  const productData = extractProductData(html, asin);

  // Fetch reviews with random delay
  const reviews = await fetchReviews(asin, config);
  productData.reviews = reviews;

  console.log(`[Scraper] Completed scrape for ASIN: ${asin} - Title: ${productData.title.substring(0, 50)}... Images: ${productData.images.length} total`);

  return productData;
}
