import { describe, it, expect, vi } from 'vitest';
import { parseAmazonResearch, fetchWithBoundedRetries, mergeAmazonResearch } from './amazonResearchParser';
import { parseBasicAmazonImages } from './basicAmazonProvider';
import { normalizeAmazonArtifact } from './amazonNormalizer';
const asin = 'B08C7LHM7S';
describe('public competitor facts', () => {
  it('records the delivery context displayed by the page without inventing a default', () => {
    expect(parseAmazonResearch('<span id="glow-ingress-line2"> New York 10001\u200c </span>',asin).deliveryLocation).toBe('New York 10001');
    expect(parseAmazonResearch('',asin).deliveryLocation).toBeNull();
  });
  it('keeps Amazon AI summaries separate from reviews and preserves aspect counts and polarity', () => {
    const html='<section><div data-testid="overall-summary">Customers like protection but disagree on size.</div><div data-testid="aspect-list"><div role="tab" aria-label="Positive aspect, protection, 1,238 mentions"><span data-testid="aspect-label">Protection<span>(1,238)</span></span></div><div role="tab" aria-label="Mixed aspect, size, 130 mentions"><span data-testid="aspect-label">Size (130)</span></div></div></section>';
    const data=parseAmazonResearch(html,asin);
    expect(data.customersSay).toEqual({source:'amazon_ai_review_summary',summary:'Customers like protection but disagree on size.',aspects:[{label:'Protection',mentions:1238,sentiment:'positive'},{label:'Size',mentions:130,sentiment:'mixed'}]});
    expect(data.reviews).toEqual([]);
    mergeAmazonResearch(data,parseAmazonResearch('',asin),asin);
    expect(data.customersSay?.aspects).toHaveLength(2);
  });
  it('distinguishes a login requirement from zero reviews and preserves earlier evidence', () => {
    const restricted = parseAmazonResearch('<div id="customerReviews"><a>Sign in</a> to see customer reviews.</div>', asin);
    expect(restricted.reviewFetchStatus).toBe('login_required');
    const current = parseAmazonResearch('<span id="social-proofing-faceout-title-tk_bought">50+ bought in past month</span><div data-hook="review" id="R1"><span data-hook="review-body">Useful sample</span></div>', asin);
    mergeAmazonResearch(current, restricted, asin);
    expect(current.reviewFetchStatus).toBe('collected');
    expect(current.boughtPastMonth).toBe('50+ bought in past month');
    expect(current.reviews).toHaveLength(1);
    const missing = parseAmazonResearch('',asin);
    mergeAmazonResearch(missing,current,asin);
    expect(missing.variants[0].boughtPastMonth).toBe('50+ bought in past month');
  });
  it('reads the new review cards, preserving good and bad reviews without UI hints', () => {
    const card = (id: string, stars: number) => `<div data-hook="review" id="${id}"><i data-hook="review-star-rating">${stars} out of 5 stars</i><h5 data-hook="reviewTitle">Actual title</h5><div data-hook="reviewText"><div class="a-hidden">Brief content visible</div><div data-hook="reviewRichContentContainer"><p>Actual review <span>body.</span></p></div><button>Read more</button></div><span data-hook="review-date">September 15, 2026</span><a data-hook="format-strip">Size: XL</a></div>`;
    const data = parseAmazonResearch(card('R1',5)+card('R2',1)+card('R1',5), asin);
    expect(data.reviews).toHaveLength(2);
    expect(data.reviews[0]).toMatchObject({title:'Actual title',body:'Actual review body.',rating:5,variant:'Size: XL'});
    expect(data.reviews[1].rating).toBe(1);
  });
  it('skips empty purchase badges and excludes unrelated recommendations', () => {
    const data = parseAmazonResearch(`<div id="social-proofing-faceout-title"></div><span id="social-proofing-faceout-title-tk_bought"><span>50+ bought</span><span> in past month</span></span><div id="recommendations">10K+ bought in past month</div>`, asin);
    expect(data.boughtPastMonth).toBe('50+ bought in past month');
    expect(parseAmazonResearch('<div id="recommendations">10K+ bought in past month</div>', asin).boughtPastMonth).toBeNull();
    expect(parseAmazonResearch('<div id="social-proofing-faceout_feature_div">1K+ bought in past month</div>', asin).boughtPastMonth).toBe('1K+ bought in past month');
  });
  it('extracts dates, variant attributes and reviews without copying shared sales to children', () => {
    const html = `<div id="detailBullets_feature_div"><li>Date First Available : March 2, 2021</li></div><span id="social-proofing-faceout-title-tk_bought">100+ bought in past month</span><script>var x={"dimensionValuesDisplayData":{"B08C7LHM7S":["XL","White"],"B09Y5TQ6B7":["XXL","White"]}};</script><div data-hook="review" id="R1"><i data-hook="review-star-rating">1.0 out of 5 stars</i><span data-hook="review-body">Seam broke after use.</span><span data-hook="avp-badge">Verified Purchase</span></div>`;
    const data = parseAmazonResearch(html, asin);
    expect(data.dateFirstAvailable).toBe('March 2, 2021');
    expect(data.variants[1]).toMatchObject({ asin:'B09Y5TQ6B7', attributes:['XXL','White'], boughtPastMonth:null, status:'not_fetched' });
    expect(data.reviews[0]).toMatchObject({rating:1,body:'Seam broke after use.',verifiedPurchase:true});
    expect(parseAmazonResearch('', asin)).toMatchObject({dateFirstAvailable:null,boughtPastMonth:null,reviews:[]});
  });
  it('preserves supplementary evidence through normalization', () => {
    const data = parseBasicAmazonImages(`<input id="ASIN" value="${asin}"><span id="productTitle">Bee suit</span><img id="landingImage" src="https://m.media-amazon.com/images/I/main.jpg"><span id="acrPopover" title="4.5 out of 5 stars"></span><span id="acrCustomerReviewText">1,234 ratings</span>`, asin);
    expect(data).toMatchObject({rating:4.5, reviewCount:1234});
    const normalized = normalizeAmazonArtifact({ marketplace:'US', expectedAsin:asin, bytes:Buffer.from(JSON.stringify([data])) });
    expect(normalized.snapshot.research?.variants[0].asin).toBe(asin);
    const missing = normalizeAmazonArtifact({ marketplace:'US', expectedAsin:asin, bytes:Buffer.from(JSON.stringify([{...data,rating:null,reviewCount:null}])) });
    expect(missing.snapshot).toMatchObject({ rating:null, reviewCount:null });
    const numericCount = parseBasicAmazonImages(`<span id="productTitle">Bee suit</span><img id="landingImage" src="https://m.media-amazon.com/images/I/main.jpg"><span id="acrCustomerReviewText">(1,234)</span>`, asin);
    expect(numericCount.reviewCount).toBe(1234);
  });
  it('retries transient blocks at bounded intervals and stops after success', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await fetchWithBoundedRetries(fetch, ()=>'provider_blocked_suspected', sleep)).toEqual({value:'ok',attempts:2});
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('stops after three blocks and never retries rate-limit or invalid data failures', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('blocked'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(fetchWithBoundedRetries(fetch, ()=>'provider_blocked_suspected', sleep)).rejects.toThrow('blocked');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[5000],[15000]]);
    fetch.mockClear();
    await expect(fetchWithBoundedRetries(fetch, ()=>'rate_limited', sleep)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
