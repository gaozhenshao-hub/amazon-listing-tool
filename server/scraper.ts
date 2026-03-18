import axios from "axios";
import * as cheerio from "cheerio";

export interface ProductImage {
  url: string;
  position: "main" | "secondary" | "aplus" | "brand_story";
  positionIndex: number;
  /** For A+ images: the module type (e.g. "premium-aplus-module-2") */
  aplusModuleType?: string;
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

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getHeaders() {
  return {
    "User-Agent": getRandomUA(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
  };
}

async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        headers: getHeaders(),
        timeout: 15000,
        maxRedirects: 5,
      });
      if (response.status === 200 && response.data) {
        return response.data;
      }
    } catch (error: any) {
      console.warn(`[Scraper] Attempt ${i + 1} failed for ${url}: ${error.message}`);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, (i + 1) * 2000));
      }
    }
  }
  throw new Error("Failed to fetch Amazon page after multiple retries. Amazon may be blocking the request.");
}

/**
 * Convert an Amazon image URL to its highest resolution version.
 * Amazon uses suffixes like ._AC_SY355_. or ._AC_SL1500_. to control size.
 * We replace these with ._AC_SL1500_. for the highest quality.
 */
function toHighRes(url: string): string {
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
function isVideoThumbnail(url: string): boolean {
  return url.includes("dp-play-icon-overlay") || url.includes("play-button") || url.includes("video-icon");
}

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
  // This gives us hiRes URLs and variant info (MAIN, PT01, PT02, etc.)
  const hiResUrls: string[] = [];
  const variants: string[] = [];

  // Extract hiRes URLs
  const hiResMatches = html.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
  if (hiResMatches) {
    for (const m of hiResMatches) {
      const urlMatch = m.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/);
      if (urlMatch) hiResUrls.push(urlMatch[1]);
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

  if (hiResUrls.length > 0) {
    console.log(`[Scraper] Found ${hiResUrls.length} hiRes images from colorImages`);
    for (let i = 0; i < hiResUrls.length; i++) {
      const url = hiResUrls[i];
      const variant = variants[i] || "";
      // Skip if null hiRes
      if (!url || url === "null") continue;
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
      // Parse the JSON-like data to get URLs
      const urlMatches = dataStr.match(/"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/g);
      if (!urlMatches) return;

      // Get the URL with the highest resolution (largest dimensions)
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
        // Upgrade to highest resolution
        const hiResUrl = toHighRes(bestUrl);
        if (!seenUrls.has(hiResUrl)) {
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
    // Get main image first
    const mainImg = $("img#landingImage").attr("src") || $("img#imgBlkFront").attr("src") || "";
    if (mainImg && !isVideoThumbnail(mainImg)) {
      const hiRes = toHighRes(mainImg);
      seenUrls.add(hiRes);
      images.push({ url: hiRes, position: "main", positionIndex: 0 });
    }

    // Get alt images, filtering out video thumbnails
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

/**
 * Extract A+ content images from the page.
 * A+ content is in the #aplus_feature_div section, before #aplusBrandStory_feature_div.
 */
function extractAplusImages(html: string): ProductImage[] {
  const images: ProductImage[] = [];
  const seenUrls = new Set<string>();

  // Find A+ section boundaries
  const aplusStart = html.indexOf('id="aplus_feature_div"');
  const brandStoryStart = html.indexOf('id="aplusBrandStory_feature_div"');

  if (aplusStart < 0) {
    console.log("[Scraper] No A+ content section found");
    return images;
  }

  // Extract the A+ section HTML
  const endPos = brandStoryStart > aplusStart ? brandStoryStart : aplusStart + 200000;
  const aplusHtml = html.substring(aplusStart, endPos);

  // Extract A+ module types for context
  const moduleTypes = new Map<number, string>();
  let moduleMatch: RegExpExecArray | null;
  const moduleRegex = /premium-aplus-module-(\d+)/g;
  while ((moduleMatch = moduleRegex.exec(aplusHtml)) !== null) {
    moduleTypes.set(moduleMatch.index, `premium-aplus-module-${moduleMatch[1]}`);
  }

  // Extract images from aplus-media-library-service-media (primary A+ images)
  const aplusMediaRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/S\/aplus-media-library-service-media\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  let match;
  let idx = 0;

  while ((match = aplusMediaRegex.exec(aplusHtml)) !== null) {
    let url = match[1];
    // Upgrade to original size by removing CR params
    url = toHighRes(url);

    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      // Find the nearest module type
      let nearestModule = "";
      let minDist = Infinity;
      for (const [pos, type] of Array.from(moduleTypes.entries())) {
        const dist = Math.abs(match.index! - pos);
        if (dist < minDist) {
          minDist = dist;
          nearestModule = type;
        }
      }

      images.push({
        url,
        position: "aplus",
        positionIndex: idx++,
        aplusModuleType: nearestModule || undefined,
      });
    }
  }

  // Also extract standard Amazon images within A+ section
  const stdImgRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((match = stdImgRegex.exec(aplusHtml)) !== null) {
    let url = match[1];
    url = toHighRes(url);
    if (!seenUrls.has(url) && !url.includes("sprite") && !url.includes("grey-pixel")) {
      seenUrls.add(url);
      images.push({
        url,
        position: "aplus",
        positionIndex: idx++,
      });
    }
  }

  console.log(`[Scraper] Found ${images.length} A+ content images`);
  return images;
}

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

  // Find the end of brand story section (next major feature div)
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
    // Filter out very small images (likely icons/thumbnails < 100px)
    const sizeMatch = url.match(/SX(\d+)/);
    if (sizeMatch && parseInt(sizeMatch[1]) < 100) continue;

    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      images.push({ url, position: "brand_story", positionIndex: idx++ });
    }
  }

  // Also get standard images in brand story
  const stdRegex = /(?:src|data-src)="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((match = stdRegex.exec(brandHtml)) !== null) {
    let url = match[1];
    url = toHighRes(url);
    if (!seenUrls.has(url) && !url.includes("sprite") && !url.includes("grey-pixel")) {
      seenUrls.add(url);
      images.push({ url, position: "brand_story", positionIndex: idx++ });
    }
  }

  console.log(`[Scraper] Found ${images.length} Brand Story images`);
  return images;
}

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

async function fetchReviews(asin: string): Promise<string[]> {
  const reviews: string[] = [];
  try {
    const url = `https://www.amazon.com/product-reviews/${asin}/ref=cm_cr_dp_d_show_all_btm?ie=UTF8&reviewerType=all_reviews&sortBy=recent`;
    const html = await fetchWithRetry(url);
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

export async function scrapeAmazonProduct(asin: string): Promise<AmazonProductData> {
  console.log(`[Scraper] Starting scrape for ASIN: ${asin}`);

  const productUrl = `https://www.amazon.com/dp/${asin}`;
  const html = await fetchWithRetry(productUrl);
  const productData = extractProductData(html, asin);

  // Fetch reviews
  const reviews = await fetchReviews(asin);
  productData.reviews = reviews;

  console.log(`[Scraper] Completed scrape for ASIN: ${asin} - Title: ${productData.title.substring(0, 50)}... Images: ${productData.images.length} total`);

  return productData;
}
