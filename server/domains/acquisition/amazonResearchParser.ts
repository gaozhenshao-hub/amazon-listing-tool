import { load } from "cheerio";
import type { CompetitorResearch } from "../../../shared/competitorResearch";

// Parse only a JSON object literal; never execute retailer scripts.
function objectAfter(text: string, start: number): Record<string, unknown> {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return {}; } }
  }
  return {};
}
export function parseAmazonResearch(html: string, asin: string): CompetitorResearch {
  const $ = load(html);
  const clean = (s: string) => s.replace(/[\u200b-\u200f]/g, '').replace(/\s+/g, ' ').trim();
  const deliveryLocation = clean($('#glow-ingress-line2').text()).slice(0,160) || null;
  const summaryNode = $('[data-testid="overall-summary"]').first();
  const summaryText = clean(summaryNode.text()).slice(0, 8000);
  const aspects: NonNullable<CompetitorResearch['customersSay']>['aspects'] = [];
  const seenAspects = new Set<string>();
  summaryNode.parent().find('[data-testid="aspect-list"] [role="tab"]').each((_, el) => {
    const node = $(el), accessible = node.attr('aria-label') || '';
    const text = clean(node.find('[data-testid="aspect-label"]').text());
    const label = text.replace(/\s*\([\d,]+\)\s*$/, '').trim().slice(0, 200);
    const count = accessible.match(/([\d,]+)\s+mentions/i) || text.match(/\(([\d,]+)\)\s*$/);
    const sentiment = accessible.match(/^(positive|mixed|negative)\s+aspect/i)?.[1]?.toLowerCase() as 'positive' | 'mixed' | 'negative' | undefined;
    if (!label || seenAspects.has(label.toLowerCase()) || aspects.length >= 30) return;
    seenAspects.add(label.toLowerCase());
    aspects.push({label, mentions: count ? Number(count[1].replace(/,/g, '')) : null, sentiment: sentiment || 'unknown'});
  });
  const customersSay: CompetitorResearch['customersSay'] = summaryText ? { summary: summaryText, source: 'amazon_ai_review_summary', aspects } : null;
  let dateFirstAvailable: string | null = null;
  $('#detailBullets_feature_div li, #productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr').each((_, el) => {
    const text = clean($(el).text());
    if (/^Date First Available\b/i.test(text)) dateFirstAvailable = text.replace(/^Date First Available\s*:?\s*/i, '').slice(0, 160) || null;
  });
  // Desktop experiments can leave an empty wrapper before the populated badge.
  // Search product purchase regions only, never recommendation cards or scripts.
  let boughtPastMonth: string | null = null;
  const purchasePattern = /\b\d[\d,.]*\s*[KkMm]?\s*\+?\s+bought\s+in\s+(?:the\s+)?past\s+month\b/i;
  $('#social-proofing-faceout-title-tk_bought, #social-proofing-faceout-title, #social-proofing-faceout_feature_div, #socialProofingAsinFaceout_feature_div, #centerCol .social-proofing-faceout-title-text').each((_, el) => {
    const match = clean($(el).text()).match(purchasePattern);
    if (!boughtPastMonth && match) boughtPastMonth = match[0].slice(0, 200);
  });
  const variants = new Map<string, CompetitorResearch['variants'][number]>();
  const add = (id: string, attrs: string[]) => {
    if (!/^[A-Z0-9]{10}$/.test(id) || variants.size >= 100) return;
    const previous = variants.get(id);
    variants.set(id, { asin: id, attributes: attrs.length ? attrs.slice(0, 20).map(s => s.slice(0, 200)) : previous?.attributes || [], boughtPastMonth: id === asin ? boughtPastMonth : null, dateFirstAvailable: id === asin ? dateFirstAvailable : null, status: id === asin ? 'collected' : 'not_fetched' });
  };
  add(asin, []);
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    const marker = /["']dimensionValuesDisplayData["']\s*:\s*(\{)/.exec(text);
    if (!marker) return;
    const data = objectAfter(text, marker.index + marker[0].length - 1);
    for (const [id, attributes] of Object.entries(data)) add(id.toUpperCase(), Array.isArray(attributes) ? attributes.filter((x): x is string => typeof x === 'string') : []);
  });
  $('#twister [data-asin], [id^="variation_"] [data-defaultasin], [id^="variation_"] [data-asin]').each((_, el) => {
    const element = $(el);
    add((element.attr('data-defaultasin') || element.attr('data-asin') || '').toUpperCase(), [clean(element.attr('title') || element.find('img').attr('alt') || element.text())].filter(Boolean));
  });
  const reviews: CompetitorResearch['reviews'] = [];
  const reviewIds = new Set<string>();
  $('[data-hook="review"]').each((index, el) => {
    if (reviews.length >= 20) return;
    const review = $(el);
    // New Amazon review cards use reviewRichContentContainer/reviewTitle.
    // Read the body itself to exclude read-more controls and accessibility hints.
    let body = '';
    for (const selector of ['[data-hook="reviewRichContentContainer"]', '[data-hook="review-body"]', '[data-hook="reviewText"]']) {
      const content = review.find(selector).first().clone();
      content.find('script, style, button, .a-hidden, [aria-hidden="true"], [data-hook="reviewExpandButtonContainer"]').remove();
      body = clean(content.text());
      if (body) break;
    }
    if (!body) return;
    const star = review.find('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"]').first().text().match(/([0-5](?:\.\d+)?)\s+out of\s+5/i);
    const id = (review.attr('id') || `page-review-${index}`).slice(0, 200);
    if (reviewIds.has(id)) return;
    reviewIds.add(id);
    const title = clean(review.find('[data-hook="reviewTitle"], [data-hook="review-title"]').first().text()).replace(/^[0-5](?:\.\d+)?\s+out of\s+5\s+stars\s*/i, '');
    reviews.push({ id, title: title.slice(0, 1000), body: body.slice(0, 8000), rating: star ? Number(star[1]) : null, date: clean(review.find('[data-hook="review-date"]').first().text()).slice(0, 200) || null, variant: clean(review.find('[data-hook="format-strip"]').first().text()).slice(0, 500) || null, verifiedPurchase: review.find('[data-hook="avp-badge"]').length > 0 });
  });
  const reviewRegion = clean($('#customerReviews, #customer-reviews_feature_div, #reviewsMedley').text());
  const loginRequired = /sign in to see customer reviews/i.test(reviewRegion) || $('form[name="signIn"], #ap_signin_form, #authportal-main-section').length > 0;
  return { deliveryLocation, dateFirstAvailable, boughtPastMonth, customersSay, variants: [...variants.values()], reviews, reviewCoverage: 'product_page_sample', reviewFetchStatus: reviews.length ? 'collected' : loginRequired ? 'login_required' : 'not_returned', fetchedAt: new Date().toISOString(), attempts: 1 };
}

/** Merge another response for the same requested ASIN; never erase obtained facts. */
export function mergeAmazonResearch(current: CompetitorResearch, extra: CompetitorResearch, asin: string) {
  current.boughtPastMonth ||= extra.boughtPastMonth;
  current.dateFirstAvailable ||= extra.dateFirstAvailable;
  if (!current.customersSay || (!current.customersSay.aspects.length && extra.customersSay?.aspects.length)) current.customersSay = extra.customersSay || current.customersSay;
  const selected = current.variants.find(v => v.asin === asin);
  if (selected) {
    selected.boughtPastMonth ||= extra.boughtPastMonth;
    selected.dateFirstAvailable ||= extra.dateFirstAvailable;
  }
  const ids = new Set(current.reviews.map(r => r.id));
  for (const review of extra.reviews) {
    if (!ids.has(review.id) && current.reviews.length < 20) { current.reviews.push(review); ids.add(review.id); }
  }
  current.reviewFetchStatus = current.reviews.length ? 'collected' : extra.reviewFetchStatus || current.reviewFetchStatus;
}

export async function fetchWithBoundedRetries<T>(fetchOnce: () => Promise<T>, classify: (error: unknown) => string, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return { value: await fetchOnce(), attempts: attempt }; }
    catch (error) {
      if (attempt === 3 || !['provider_blocked_suspected', 'request_timeout', 'provider_unavailable'].includes(classify(error))) throw error;
      await sleep(attempt === 1 ? 5000 : 15000);
    }
  }
  throw new Error('Retry limit reached');
}
