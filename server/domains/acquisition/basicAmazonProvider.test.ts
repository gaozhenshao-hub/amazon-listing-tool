import { beforeEach,afterEach,describe, expect, it, vi } from "vitest";
import { parseBasicAmazonImages, BasicAmazonImagesProvider, isAmazonShoppingLanding } from "./basicAmazonProvider";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { openAmazonBrowser } from "./amazonBrowser";
vi.mock("../../infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: vi.fn() }));
vi.mock("./amazonBrowser", () => ({ openAmazonBrowser: vi.fn() }));
const header = '<input id="ASIN" value="B089LDX88M"><span id="productTitle">Phone mount</span>';
const a = "https://m.media-amazon.com/images/I/main.jpg";
const b = "https://m.media-amazon.com/images/I/second.jpg";
describe("basic Amazon images", () => {
  beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('AMAZON_BROWSER_ENABLED','false');});
  afterEach(()=>vi.unstubAllEnvs());
  it('preserves a separate subtitle without including the brand byline',()=>{const d=parseBasicAmazonImages(header+`<span id="productSubtitle">Full Body Protection</span><span id="bylineInfo">Visit Brand Store</span><img id="landingImage" src="${a}">`,'B089LDX88M');expect(d.title).toBe('Phone mount');expect(d.subtitle).toBe('Full Body Protection');});
  it("extracts competitor listing and ratings without inventing missing values", () => {
    const base=header+`<img id="landingImage" src="${a}">`;
    const data=parseBasicAmazonImages(base+'<div id="feature-bullets"><li><span class="a-list-item">Sturdy mount</span></li></div><div id="productDescription">Easy installation</div><span id="acrPopover" title="4.6 out of 5 stars"></span><span id="acrCustomerReviewText">1,234 ratings</span><div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$19.99</span></span></div>', 'B089LDX88M');
    expect(data).toMatchObject({bulletPoints:['Sturdy mount'],description:'Easy installation',rating:4.6,reviewCount:1234,price:{value:19.99,currency:'USD'}});
    expect(parseBasicAmazonImages(base,'B089LDX88M')).toMatchObject({bulletPoints:[],description:null,rating:null,reviewCount:null,price:null});
  });
  it("extracts only selected variant and excludes recommendations", () => {
    const data = parseBasicAmazonImages(header + `<script>var data={'colorImages':{'initial':[{"hiRes":"${a}"},{"hiRes":null,"large":"${b}"}], 'other': [{"hiRes":"https://m.media-amazon.com/images/I/other.jpg"}]}};</script><img src="https://m.media-amazon.com/images/I/recommendation.jpg">`, "B089LDX88M");
    expect(data.highResolutionImages).toEqual([a, b]);
  });
  it("separates A+ and brand story and rejects untrusted images", () => {
    const data = parseBasicAmazonImages(header + `<img id="landingImage" data-old-hires="${a}"><div id="aplus"><img data-src="${b}"><img src="http://127.0.0.1/private.jpg"><div id="aplusBrandStory"><img src="https://m.media-amazon.com/images/I/story.jpg"></div></div>`, "B089LDX88M");
    expect(data.aPlusContent).toEqual([b]);
    expect(data.brandStory).toEqual(["https://m.media-amazon.com/images/I/story.jpg"]);
  });
  it("fails on a CAPTCHA, wrong ASIN, or missing images instead of inventing results", () => {
    expect(() => parseBasicAmazonImages('<title>Robot Check</title>', "B089LDX88M")).toThrow("captcha");
    expect(() => parseBasicAmazonImages(header, "B000000000")).toThrow("mismatch");
    expect(() => parseBasicAmazonImages(header, "B089LDX88M")).toThrow("主图");
  });
  it("returns a zero-cost result and constrains outbound network access", async () => {
    vi.mocked(safeHttpRequest).mockResolvedValue({ ok: true, text: () => header + `<img id="landingImage" src="${a}">` } as any);
    const provider = new BasicAmazonImagesProvider();
    const request = { workspaceId: 1, marketplace: "US" as const, asin: "B089LDX88M", capabilities: ["image_gallery" as const], maxChargeUsd: 0, idempotencyKey: "basic-test-0000001" };
    expect(await provider.fetch(request)).toMatchObject({status:"succeeded", chargedUsd:0});
    expect(safeHttpRequest).toHaveBeenCalledWith("https://www.amazon.com/dp/B089LDX88M", expect.objectContaining({ allowedHosts: ["www.amazon.com", "amazon.com"], maxRedirects: 3 }));
  });
  it("re-reads a partial gallery once for missing rich images, retaining the gallery", async () => {
    vi.mocked(safeHttpRequest).mockReset();
    vi.mocked(safeHttpRequest).mockResolvedValueOnce({ ok: true, text: () => header + `<img id="landingImage" src="${a}">` } as any)
      .mockResolvedValueOnce({ ok: true, text: () => header + `<img id="landingImage" src="${a}"><div id="aplus"><img src="${b}"></div>` } as any);
    const result = await new BasicAmazonImagesProvider().fetch({ workspaceId: 1, marketplace: "US", asin: "B089LDX88M", capabilities: ["image_gallery", "aplus", "brand_story"], idempotencyKey: "partial-gallery-test" });
    expect(vi.mocked(safeHttpRequest)).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("succeeded");
    const [product] = JSON.parse(Buffer.from(result.rawArtifact!.bytes).toString());
    expect(product.highResolutionImages).toEqual([a]); expect(product.aPlusContent).toEqual([b]);
    expect(product.brandStory).toEqual([]); expect(product.research.attempts).toBe(2);
  });
  it("keeps acquired images if the one rich-content follow-up fails", async () => {
    vi.mocked(safeHttpRequest).mockReset();
    vi.mocked(safeHttpRequest).mockResolvedValueOnce({ ok: true, text: () => header + `<img id="landingImage" src="${a}">` } as any).mockRejectedValueOnce(Error("timeout"));
    const result = await new BasicAmazonImagesProvider().fetch({ workspaceId: 1, marketplace: "US", asin: "B089LDX88M", capabilities: ["image_gallery", "aplus"], idempotencyKey: "partial-failure-test" });
    expect(result.status).toBe("succeeded"); expect(vi.mocked(safeHttpRequest)).toHaveBeenCalledTimes(2);
  });
  it("uses complete initial HTML without launching a browser", async () => {
    vi.stubEnv('AMAZON_BROWSER_ENABLED','true');
    vi.mocked(safeHttpRequest).mockReset().mockResolvedValue({ ok:true, text:()=>header+`<img id="landingImage" src="${a}"><div id="aplus"><img src="${b}"></div><div id="aplusBrandStory"><img src="https://m.media-amazon.com/images/I/story.jpg"></div>` } as any);
    const result=await new BasicAmazonImagesProvider().fetch({workspaceId:1,marketplace:'US',asin:'B089LDX88M',capabilities:['image_gallery','aplus','brand_story'],idempotencyKey:'complete-http-test'});
    expect(result.status).toBe('succeeded'); expect(openAmazonBrowser).not.toHaveBeenCalled();
    expect(safeHttpRequest).toHaveBeenCalledTimes(1);
  });
  it("uses the browser only to fill missing rich content and closes it", async () => {
    vi.stubEnv('AMAZON_BROWSER_ENABLED','true');
    vi.mocked(safeHttpRequest).mockReset().mockResolvedValue({ok:true,text:()=>header+`<img id="landingImage" src="${a}">`} as any);
    const close=vi.fn();
    vi.mocked(openAmazonBrowser).mockResolvedValue({close,productPage:vi.fn().mockResolvedValue(header+`<img id="landingImage" src="${a}"><div id="aplus"><img src="${b}"></div>`),productPageSamples:()=>[]} as any);
    const result=await new BasicAmazonImagesProvider().fetch({workspaceId:1,marketplace:'US',asin:'B089LDX88M',capabilities:['image_gallery','aplus'],idempotencyKey:'browser-rich-test'});
    expect(result.status).toBe('succeeded'); expect(openAmazonBrowser).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
    const [product]=JSON.parse(Buffer.from(result.rawArtifact!.bytes).toString());
    expect(product.aPlusContent).toEqual([b]); expect(product.highResolutionImages).toEqual([a]);
  });
  it('follows a plain shopping landing page but does not treat a CAPTCHA as navigation', async () => {
    const landing='<title>Amazon.com</title><form action="/errors_page/validateCaptcha"><button>Continue shopping</button></form>';
    expect(isAmazonShoppingLanding(landing)).toBe(true);
    expect(isAmazonShoppingLanding(landing+'<input id="captchacharacters">')).toBe(false);
    expect(isAmazonShoppingLanding('<title>Robot Check</title>'+landing)).toBe(false);
    vi.stubEnv('AMAZON_BROWSER_ENABLED','true');
    vi.mocked(safeHttpRequest).mockReset().mockResolvedValue({ok:true,text:()=>landing} as any);
    const close=vi.fn();
    vi.mocked(openAmazonBrowser).mockResolvedValue({close,productPage:vi.fn().mockResolvedValue(header+`<img id="landingImage" src="${a}">`),productPageSamples:()=>[]} as any);
    const result=await new BasicAmazonImagesProvider().fetch({workspaceId:1,marketplace:'US',asin:'B089LDX88M',capabilities:['image_gallery'],idempotencyKey:'shopping-landing-test'});
    expect(result.status).toBe('succeeded'); expect(openAmazonBrowser).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  });
});
