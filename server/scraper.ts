import axios from "axios";
import * as cheerio from "cheerio";

export interface AmazonProductData {
  title: string;
  bulletPoints: string[];
  price: string;
  rating: string;
  reviewCount: string;
  description: string;
  brand: string;
  imageUrls: string[];
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
        // Wait with exponential backoff
        await new Promise(resolve => setTimeout(resolve, (i + 1) * 2000));
      }
    }
  }
  throw new Error("Failed to fetch Amazon page after multiple retries. Amazon may be blocking the request.");
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
  // Alternative selector
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

  // Image URLs
  const imageUrls: string[] = [];
  // Try to extract from data attributes or scripts
  $("div#altImages img, div#imageBlock img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src && src.includes("images") && !src.includes("sprite") && !src.includes("grey-pixel")) {
      // Convert thumbnail to full size
      const fullSrc = src.replace(/\._[A-Z]+\d+_\./, ".");
      imageUrls.push(fullSrc);
    }
  });
  // Also try main image
  const mainImg = $("img#landingImage").attr("src") || $("img#imgBlkFront").attr("src") || "";
  if (mainImg) imageUrls.unshift(mainImg);

  // Category
  const categoryParts: string[] = [];
  $("a.a-link-normal.a-color-tertiary").each((_, el) => {
    const text = $(el).text().trim();
    if (text) categoryParts.push(text);
  });
  const category = categoryParts.join(" > ") || "";

  return {
    title,
    bulletPoints,
    price,
    rating,
    reviewCount,
    description,
    brand,
    imageUrls: Array.from(new Set(imageUrls)).slice(0, 9),
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

    // Also try alternative selectors
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

  // Fetch product page
  const productUrl = `https://www.amazon.com/dp/${asin}`;
  const html = await fetchWithRetry(productUrl);
  const productData = extractProductData(html, asin);

  // Fetch reviews
  const reviews = await fetchReviews(asin);
  productData.reviews = reviews;

  console.log(`[Scraper] Completed scrape for ASIN: ${asin} - Title: ${productData.title.substring(0, 50)}...`);

  return productData;
}
