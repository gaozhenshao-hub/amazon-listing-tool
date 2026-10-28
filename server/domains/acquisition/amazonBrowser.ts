import { createRequire } from 'node:module';
import { createBrowserSlot } from './browserSlot';

// The ECS image includes Playwright and system Chromium. No user browser/session
// is accessed: every acquisition gets its own anonymous, short-lived context.
export function isAmazonBrowserUrlAllowed(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      ['www.amazon.com', 'amazon.com', 'm.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-fe.ssl-images-amazon.com'].includes(url.hostname);
  } catch { return false; }
}

const acquireBrowserSlot = createBrowserSlot();
export async function openAmazonBrowser() {
  const releaseBrowserSlot = await acquireBrowserSlot();
  let browser: any;
  try {
    const runtimeRequire = createRequire(import.meta.url);
    const { chromium } = runtimeRequire('playwright-core');
    browser = await chromium.launch({executablePath:process.env.AMAZON_BROWSER_EXECUTABLE || '/usr/bin/chromium', headless:true, timeout:15000, args:['--disable-dev-shm-usage']});
    const context = await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000},acceptDownloads:false,serviceWorkers:'block'});
    await context.route('**/*', async (route: any) => {
      const request = route.request();
      // We inspect image URLs/DOM here; the bounded downloader saves the bytes.
      if (!isAmazonBrowserUrlAllowed(request.url()) || ['font','media','image'].includes(request.resourceType())) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    let closed = false;
    let deliveryAttempted = false;
    let sampleAsin = '';
    let pageSamples: string[] = [];
    const remember = (html: string) => {
      if (Buffer.byteLength(html) <= 8*1024*1024 && pageSamples.length < 4) pageSamples.push(html);
    };
    return {
      productPageSamples(asin: string) { return asin === sampleAsin ? [...pageSamples] : []; },
      async productPage(asin: string, timeoutMs = 30000, options: { includeResearch?: boolean } = {}) {
        if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('normalization invalid ASIN');
        sampleAsin = asin;
        pageSamples = [];
        const url = `https://www.amazon.com/dp/${asin}`;
        const deadline = Date.now() + timeoutMs;
        const remaining = () => Math.max(1,deadline-Date.now());
        const go = async () => {
          let response;
          try { response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:remaining()}); }
          catch (error) {
            // Slow scripts can delay DOMContentLoaded after the product HTML has
            // arrived. Keep that HTML only on the exact product URL; the provider
            // still validates ASIN, title, image sources and CAPTCHA boundaries.
            if (!(error instanceof Error) || error.name !== 'TimeoutError' || page.url().split('?')[0] !== url
              || await page.locator('#captchacharacters').count() || !await page.locator('span#productTitle').count()) throw error;
            remember(await page.content());
          }
          if (response && response.status() >= 400) throw new Error(`Amazon HTTP ${response.status()}`);
          // Preserve public server-rendered reviews before scripts or a delivery
          // reload replace the review region. The provider validates each ASIN.
          if (response) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try { await Promise.race([response.text().then(remember), new Promise(resolve => { timer = setTimeout(resolve, Math.min(2000,remaining())); })]); }
            catch { /* The live DOM remains available if response capture fails. */ }
            finally { if (timer) clearTimeout(timer); }
          }
        };
        await go();
        // Normal Amazon landing page navigation only; CAPTCHA challenges stop.
        // Amazon also uses validateCaptcha as the action of its ordinary
        // "Continue shopping" landing form. Only the challenge input itself
        // identifies an actual CAPTCHA before we try that visible button.
        if (await page.locator('#captchacharacters').count()) throw new Error('Amazon captcha blocked');
        const continueButton = page.getByRole('button',{name:'Continue shopping',exact:true});
        if (await continueButton.count()) {
          await continueButton.click({timeout:Math.min(5000,remaining())});
          await page.waitForLoadState('domcontentloaded',{timeout:Math.min(5000,remaining())}).catch(()=>{});
          if (!await page.locator('span#productTitle').count()) await go();
        }
        if (await page.locator('#captchacharacters').count()) throw new Error('Amazon captcha blocked');
        // Some product pages also contain a hidden input with the same ID.
        await page.locator('span#productTitle').first().waitFor({state:'attached',timeout:Math.min(15000,remaining())});
        const postcode = process.env.AMAZON_BROWSER_POSTCODE;
        if (!deliveryAttempted && remaining() > 8000 && postcode && /^\d{5}$/.test(postcode)) {
          deliveryAttempted = true;
          remember(await page.content());
          try {
            // Set a reference US delivery location in this anonymous context only.
            // This is ordinary storefront navigation, not an account/address edit.
            await page.locator('#nav-global-location-popover-link').click({timeout:Math.min(4000,remaining())});
            await page.locator('#GLUXZipUpdateInput').fill(postcode,{timeout:Math.min(4000,remaining())});
            await page.locator('#GLUXZipUpdate').click({timeout:Math.min(3000,remaining())});
            const confirm = page.getByRole('button',{name:'Continue',exact:true});
            await confirm.waitFor({state:'visible',timeout:Math.min(4000,remaining())}).catch(()=>{});
            if (await confirm.count()) await confirm.click({timeout:Math.min(3000,remaining())});
            await go();
            await page.locator('span#productTitle').first().waitFor({state:'attached',timeout:Math.min(8000,remaining())});
          } catch {
            await page.keyboard.press('Escape').catch(()=>{});
            // Keep public data even if the optional delivery dialog is unavailable.
          }
        }
        await page.waitForLoadState('load',{timeout:Math.min(5000,remaining())}).catch(()=>{});
        // Rich modules are often hydrated only when brought into the viewport.
        // Keep the real module DOM; do not flatten carousel/card relationships.
        for (const selector of ['#aplusBrandStory_feature_div', '#aplus_feature_div']) {
          if (remaining() < 1000) break;
          const region = page.locator(selector).first();
          if (await region.count()) {
            await region.scrollIntoViewIfNeeded({timeout:Math.min(2000,remaining())}).catch(()=>{});
            await region.locator('img').first().waitFor({state:'attached',timeout:Math.min(3000,remaining())}).catch(()=>{});
            remember(await page.content());
          }
        }
        if (options.includeResearch !== false) {
        const reviewArea = page.locator('#customerReviews, #customer-reviews_feature_div, #reviewsMedley').first();
        await reviewArea.waitFor({state:'attached',timeout:Math.min(8000,remaining())}).catch(()=>{});
        if (await reviewArea.count()) {
          await reviewArea.scrollIntoViewIfNeeded({timeout:Math.min(2000,remaining())}).catch(()=>{});
          await page.locator('[data-hook="reviewRichContentContainer"], [data-hook="review-body"]').first().waitFor({state:'attached',timeout:Math.min(5000,remaining())}).catch(()=>{});
        }
        }
        if (!isAmazonBrowserUrlAllowed(page.url())) throw new Error('Amazon blocked redirect');
        const html = await page.content();
        if (Buffer.byteLength(html) > 8*1024*1024) throw new Error('normalization page too large');
        return html;
      },
      async close() { if (closed) return; closed=true; await browser.close().catch(()=>{}); releaseBrowserSlot(); },
    };
  } catch (error) { if (browser) await browser.close().catch(()=>{}); releaseBrowserSlot(); throw error; }
}
