import { parseAmazonImageLayout } from "./amazonImageLayout";
import { createHash, randomUUID } from "node:crypto";
import { load } from "cheerio";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { AmazonAcquisitionRequestSchema, assertProviderSupportsRequest, type AmazonAcquisitionProvider, type AmazonAcquisitionRequest, type ProviderFetchResult } from "./contracts";
import { classifyProviderFailure } from "./providerContracts";
import { parseAmazonResearch, fetchWithBoundedRetries, mergeAmazonResearch } from "./amazonResearchParser";
import { openAmazonBrowser } from './amazonBrowser';

export const BASIC_AMAZON_PROVIDER = "builtin.amazon.public_images";
export const BASIC_IMAGE_CAPABILITIES = ["catalog_basic", "listing_content", "ratings", "image_gallery", "aplus", "brand_story"] as const;

export function isAmazonShoppingLanding(html: string) {
  const $ = load(html);
  if ($('#captchacharacters').length || /robot check|sorry, we just need to make sure/i.test($('title').text())) return false;
  return $('form[action*="validateCaptcha"] button, form[action*="validateCaptcha"] input[type="submit"]').toArray()
    .some(el => ($(el).text() || $(el).attr('value') || '').trim() === 'Continue shopping');
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!["media-amazon.com", "ssl-images-amazon.com"].some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) return null;
    if (!/\.(?:jpe?g|png|webp|gif)(?:$)/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

// Read a JSON array without evaluating page scripts. Quoted brackets are ignored.
function jsonArrayAfter(text: string, offset: number): unknown[] {
  const start = text.indexOf("[", offset);
  if (start < 0 || start - offset > 100) return [];
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return []; }
    }
  }
  return [];
}

export function parseBasicAmazonImages(html: string, asin: string) {
  const $ = load(html);
  if ($('form[action*="validateCaptcha"], #captchacharacters').length || /robot check|sorry, we just need to make sure/i.test($("title").text())) {
    throw new Error("Amazon captcha blocked: 请稍后重试或手动上传图片");
  }
  const pageAsin = $('#ASIN').attr("value") || $('input[name="ASIN"]').first().attr("value");
  if (pageAsin && pageAsin.toUpperCase() !== asin) throw new Error("normalization ASIN mismatch");
  const title = $('#productTitle').text().replace(/\s+/g, ' ').trim();
  const subtitle = $('#productSubtitle, #product-subtitle, #title_feature_div .a-size-medium.a-color-secondary, #bookEdition').map((_,el)=>$(el).text().replace(/\s+/g,' ').trim()).get().filter((t,i,a)=>t&&t!==title&&a.indexOf(t)===i).join(' · ') || null;
  if (!title) throw new Error("normalization failed: 商品页未返回有效产品信息");
  const gallery: string[] = [];
  const add = (target: string[], raw: unknown) => { const url = imageUrl(raw); if (url && !target.includes(url)) target.push(url); };
  $('script').each((_, el) => {
    const script = $(el).html() || "";
    const marker = /["']colorImages["']\s*:\s*\{\s*["']initial["']\s*:/g.exec(script);
    if (!marker) return;
    for (const item of jsonArrayAfter(script, marker.index + marker[0].length)) {
      if (item && typeof item === "object") {
        const img = item as Record<string, unknown>;
        add(gallery, img.hiRes || img.large);
      }
    }
  });
  if (!gallery.length) {
    const main = $('#landingImage, #imgBlkFront').first();
    add(gallery, main.attr("data-old-hires"));
    try {
      const dynamic = JSON.parse(main.attr("data-a-dynamic-image") || "{}");
      const best = Object.entries(dynamic).sort((a, b) => {
        const area = (v: unknown) => Array.isArray(v) ? Number(v[0]) * Number(v[1]) : 0;
        return area(b[1]) - area(a[1]);
      })[0];
      if (!gallery.length && best) add(gallery, best[0]);
    } catch { /* Page may omit dynamic-image JSON. */ }
    if (!gallery.length) add(gallery, main.attr("src"));
  }
  if (!gallery.length) throw new Error("normalization failed: 商品页未返回可用主图，请手动上传或稍后重试");
  const collect = (selector: string, excludeBrand: boolean) => {
    const result: string[] = [];
    $(selector).find("img").each((_, el) => {
      if (excludeBrand && $(el).closest('#aplusBrandStory_feature_div, #aplusBrandStory').length) return;
      const img = $(el);
      if (excludeBrand && /initVideo\s*\(|<video\b/.test(img.closest('.aplus-module').html() || "")) return;
      if (Number(img.attr("width")) <= 40 && Number(img.attr("height")) <= 40 && img.attr("width") && img.attr("height")) return;
      add(result, img.attr("data-src") || img.attr("data-a-hires") || img.attr("src"));
    });
    return result.slice(0, 40);
  };
  const bulletPoints = $('#feature-bullets li .a-list-item').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  const description = $('#productDescription').text().replace(/\s+/g, ' ').trim() || null;
  const ratingText = $('#acrPopover').attr('title') || $('#averageCustomerReviews .a-icon-alt, [data-hook="rating-out-of-text"]').first().text();
  const ratingMatch = ratingText.match(/([0-5](?:\.\d+)?)\s+out of\s+5/i);
  const countText = $('#acrCustomerReviewText, [data-hook="total-review-count"]').first().text().trim();
  const countMatch = countText.match(/^\(?([\d,]+)\)?(?:\s+(?:global\s+)?(?:ratings?|reviews?))?\s*$/i);
  const priceText = $('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice').first().text().trim();
  const priceMatch = priceText.match(/^\$([\d,]+(?:\.\d{2})?)$/);
  const research = parseAmazonResearch(html, asin);
  const rich = parseAmazonImageLayout(html);
  return {
    asin, title, subtitle,
    research, variantAsins: research.variants.map(variant => variant.asin),
    bulletPoints, description,
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    reviewCount: countMatch ? Number(countMatch[1].replace(/,/g, '')) : null,
    price: priceMatch ? {value:Number(priceMatch[1].replace(/,/g, '')),currency:'USD'} : null,
    brand: $('#bylineInfo').text().trim().replace(/^Visit the\s+|\s+Store$|^Brand:\s*/gi, "") || null,
    url: `https://www.amazon.com/dp/${asin}`,
    highResolutionImages: gallery.slice(0, 20),
    sourceLayout: rich.layout,
    videos: rich.videos,
    aPlusContent: [...new Set([...rich.urls.aplus, ...collect('#aplus_feature_div, #aplus', true)])],
    brandStory: [...new Set([...rich.urls.brand_story, ...collect('#aplusBrandStory_feature_div, #aplusBrandStory', false)])],
  };
}

function mergeProductSupplement(current: ReturnType<typeof parseBasicAmazonImages>, extra: ReturnType<typeof parseBasicAmazonImages>) {
  if (current.asin !== extra.asin) return;
  mergeAmazonResearch(current.research,extra.research,current.asin);
  if (extra.sourceLayout.modules.length > current.sourceLayout.modules.length) current.sourceLayout = extra.sourceLayout;
  if (extra.videos.length > current.videos.length) { current.videos = extra.videos; current.sourceLayout = extra.sourceLayout; }
  for (const [key,limit] of [['highResolutionImages',20],['aPlusContent',40],['brandStory',40]] as const) {
    current[key] = [...new Set([...current[key],...extra[key]])].slice(0,limit);
  }
  if (!current.bulletPoints.length) current.bulletPoints = extra.bulletPoints;
  current.description ??= extra.description;
  current.subtitle ??= extra.subtitle;
  current.brand ??= extra.brand;
  current.rating ??= extra.rating;
  current.reviewCount ??= extra.reviewCount;
  if (!current.research.deliveryLocation || current.research.deliveryLocation === extra.research.deliveryLocation) current.price ??= extra.price;
  const known = new Set(current.research.variants.map(v=>v.asin));
  for (const variant of extra.research.variants) {
    if (!known.has(variant.asin) && current.research.variants.length < 100) { current.research.variants.push(variant); known.add(variant.asin); }
  }
  current.variantAsins = current.research.variants.map(v=>v.asin);
}

export class BasicAmazonImagesProvider implements AmazonAcquisitionProvider {
  readonly providerCode = BASIC_AMAZON_PROVIDER;
  readonly supportedMarketplaces = ["US"] as const;
  readonly capabilities = BASIC_IMAGE_CAPABILITIES;
  async fetch(request: AmazonAcquisitionRequest): Promise<ProviderFetchResult> {
    const parsed = AmazonAcquisitionRequestSchema.parse(request);
    assertProviderSupportsRequest(this, parsed);
    const providerRunId = `basic-${randomUUID()}`;
    let browserSession: Awaited<ReturnType<typeof openAmazonBrowser>> | undefined;
    try {
      const browserEnabled = process.env.AMAZON_BROWSER_ENABLED === 'true';
      const imageOnly = !parsed.capabilities.includes('listing_content');
      // Image URLs and layout are usually present in the initial HTML. Avoid
      // waiting for unrelated storefront scripts before downloading those images.
      if (browserEnabled && !imageOnly) browserSession = await openAmazonBrowser();
      const fetchPage = async (asin: string, timeoutMs: number): Promise<ReturnType<typeof parseBasicAmazonImages>> => {
      if (browserSession) {
        const product = parseBasicAmazonImages(await browserSession.productPage(asin, timeoutMs, { includeResearch: parsed.capabilities.includes('listing_content') }),asin);
        for (const html of browserSession.productPageSamples?.(asin) || []) {
          try {
            const sample = parseBasicAmazonImages(html,asin);
            // Rich-content samples have the same validated ASIN. Preserve
            // layout/images that hydration later removes, without changing price.
            if (sample.sourceLayout.modules.length > product.sourceLayout.modules.length) product.sourceLayout = sample.sourceLayout;
            if (sample.videos.length > product.videos.length) { product.videos=sample.videos;product.sourceLayout=sample.sourceLayout; }
            product.aPlusContent = [...new Set([...product.aPlusContent,...sample.aPlusContent])];
            product.brandStory = [...new Set([...product.brandStory,...sample.brandStory])];
            if (sample.research.reviews.length) mergeAmazonResearch(product.research, {
              ...sample.research, boughtPastMonth:null, dateFirstAvailable:null, customersSay:null,
            },asin);
          } catch { /* Landing pages / other ASINs are not product evidence. */ }
        }
        return product;
      }
      const response = await safeHttpRequest(`https://www.amazon.com/dp/${asin}`, {
        allowedHosts: ["www.amazon.com", "amazon.com"], timeoutMs,
        maxRedirects: 3, maxResponseBytes: 8 * 1024 * 1024,
        headers: { "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "identity" },
        auditContext: { workspaceId: parsed.workspaceId, operation: "knowledge_base.basic_image_collection" },
      });
      if (!response.ok) throw new Error(`Amazon HTTP ${response.status}`);
      const html = response.text();
      try { return parseBasicAmazonImages(html, asin); }
      catch (error) {
        // Amazon reuses validateCaptcha for a plain Continue shopping form.
        // Only follow that visible navigation; never solve a CAPTCHA challenge.
        if (browserEnabled && !browserSession && isAmazonShoppingLanding(html)) {
          browserSession = await openAmazonBrowser();
          return fetchPage(asin, 40000);
        }
        throw error;
      }
      };
      let pageAttempts = 0;
      let browserFallbackAllowed = false;
      const collected = await fetchWithBoundedRetries(async () => {
        if (pageAttempts++ > 0 && browserEnabled && imageOnly && browserFallbackAllowed && !browserSession) browserSession = await openAmazonBrowser();
        try { return await fetchPage(parsed.asin, browserSession ? 40000 : 20000); }
        catch (error) {
          browserFallbackAllowed = ['request_timeout', 'provider_unavailable'].includes(classifyProviderFailure(error));
          throw error;
        }
      }, classifyProviderFailure);
      const product = collected.value;
      product.research.collectionMethod = browserSession ? 'browser' : 'http';
      product.research.attempts = collected.attempts;
      // A usable gallery does not imply that lazy A+ / brand modules loaded.
      // Re-read once when requested sections are missing, preserving successes.
      const missingRichImages = parsed.capabilities.includes('aplus') && !product.aPlusContent.length
        || parsed.capabilities.includes('brand_story') && !product.brandStory.length;
      if (missingRichImages && collected.attempts < 3 && !parsed.capabilities.includes('listing_content')) {
        product.research.attempts++;
        try {
          if (browserEnabled && !browserSession) browserSession = await openAmazonBrowser();
          mergeProductSupplement(product, await fetchPage(parsed.asin, browserSession ? 40000 : 20000));
          if (browserSession) product.research.collectionMethod = 'browser';
        }
        catch { /* Return the valid first page, with missing sections visible. */ }
      }
      // Bound total requests. Never copy a parent's/shared purchase badge to children.
      if (parsed.capabilities.includes('listing_content')) {
        // A valid but partial response previously stopped all main-page retries.
        // Allow one additional read, within the same three-attempt budget.
        if (collected.attempts < 3 && product.research.reviewFetchStatus !== 'login_required' && (!product.research.boughtPastMonth || !product.research.reviews.length)) {
          await new Promise(resolve => setTimeout(resolve, 2500));
          product.research.attempts++;
          try {
            const supplement = await fetchPage(parsed.asin, 20000);
            mergeProductSupplement(product,supplement);
          } catch { /* Keep all facts from the successful initial page. */ }
        }
        for (const sentiment of ['critical', 'positive'] as const) {
          if (product.research.reviewFetchStatus === 'login_required') break;
          const hasSample = product.research.reviews.some(r => r.rating !== null && (sentiment === 'critical' ? r.rating <= 2 : r.rating >= 4));
          if (hasSample) continue;
          try {
            const page = await safeHttpRequest(`https://www.amazon.com/product-reviews/${parsed.asin}/?filterByStar=${sentiment}`, {
              allowedHosts: ['www.amazon.com', 'amazon.com'], timeoutMs: 10000, maxRedirects: 2, maxResponseBytes: 4 * 1024 * 1024,
              headers: { 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'identity' },
              auditContext: { workspaceId: parsed.workspaceId, operation: 'competitor.public_review_sample' },
            });
            const pageHtml = page.text();
            const blocked = /validateCaptcha|captchacharacters/i.test(pageHtml);
            const extra = parseAmazonResearch(pageHtml, parsed.asin);
            if (!page.ok || blocked) {
              if (!product.research.reviews.length) product.research.reviewFetchStatus = blocked ? 'blocked' : 'request_failed';
              break;
            }
            // Amazon sometimes redirects public review links back to the exact
            // product page. Preserve its product facts and images after verifying
            // the final URL/ASIN, rather than discarding already fetched data.
            let mergedProduct = false;
            let redirectedAsin: string | undefined;
            try {
              const finalUrl = new URL(page.url);
              if (finalUrl.hostname === 'www.amazon.com') redirectedAsin = finalUrl.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
            } catch { /* No canonical product URL; use review-only fields below. */ }
            if (redirectedAsin) {
              if (redirectedAsin !== parsed.asin) throw new Error('normalization ASIN mismatch');
              mergeProductSupplement(product,parseBasicAmazonImages(pageHtml,parsed.asin));
              mergedProduct = true;
            }
            if (extra.reviewFetchStatus === 'login_required') {
              if (!product.research.reviews.length) product.research.reviewFetchStatus = 'login_required';
              break;
            }
            if (!mergedProduct) mergeAmazonResearch(product.research, { ...extra, boughtPastMonth: null, dateFirstAvailable: null }, parsed.asin);
            if (extra.reviews.length) product.research.reviewCoverage = 'public_page_sample';
          } catch { if (!product.research.reviews.length) product.research.reviewFetchStatus = 'request_failed'; break; }
        }
        for (const variant of product.research.variants.filter(v => v.asin !== parsed.asin).slice(0, 5)) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          try {
            const child = await fetchPage(variant.asin, 12000);
            variant.boughtPastMonth = child.research.boughtPastMonth;
            variant.dateFirstAvailable = child.research.dateFirstAvailable;
            variant.status = 'collected';
          } catch (error) {
            variant.status = 'unavailable';
            if (['provider_blocked_suspected', 'rate_limited', 'permission_denied'].includes(classifyProviderFailure(error))) break;
          }
        }
      }
      const bytes = Buffer.from(JSON.stringify([product]));
      return { providerCode: this.providerCode, providerRunId, status: "succeeded", failureCategory: null, chargedUsd: 0,
        rawArtifact: { bytes, contentHash: createHash("sha256").update(bytes).digest("hex"), contentType: "application/json", providerRunId } };
    } catch (error) {
      return { providerCode: this.providerCode, providerRunId, status: "failed", failureCategory: classifyProviderFailure(error), chargedUsd: 0, rawArtifact: null };
    } finally { await browserSession?.close(); }
  }
}
