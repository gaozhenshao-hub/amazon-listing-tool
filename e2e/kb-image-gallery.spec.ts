import { expect, test, type Locator, type Page } from "@playwright/test";
import { installRealPageFixtures } from "./trpcMock";

const assetPrefix = "/__e2e__/kb-image-gallery/";
const imageUrl = (role: string, index: number) => `${assetPrefix}${role}-${index}.svg`;
const cases = [
  { name: "81 images including 20 brand stories", total: 81, aplus: 52, brandStories: 20 },
  { name: "12 images without brand stories", total: 12, aplus: 3, brandStories: 0 },
];
const viewports = [{ name: "desktop", width: 1438, height: 1000 }, { name: "mobile", width: 390, height: 844 }];

function fixture(counts: typeof cases[number]) {
  let id = 0;
  const images = [
    ...Array.from({ length: 9 }, (_, index) => ({ role: index === 0 ? "main" : "secondary", index })),
    ...Array.from({ length: counts.aplus }, (_, index) => ({ role: "aplus", index })),
    ...Array.from({ length: counts.brandStories }, (_, index) => ({ role: "brand_story", index })),
  ].map(({ role, index }) => ({
    id: ++id, imageSetId: 1, imageUrl: imageUrl(role, index), imagePosition: role, positionIndex: index,
    tagImageBelong: role === "main" ? "主图" : role === "secondary" ? "套图" : role === "aplus" ? "A+" : "品牌故事",
    // Also exercise long tag wrapping, not only empty fixed-width panels.
    tagComposition: role === "aplus" ? "SyntheticLongTag".repeat(8) : "居中构图",
    tagsConfirmed: 1, analysisConfirmed: 1,
  }));
  const set = {
    id: 1, userId: 1, workspaceId: 1, asin: "B0E2E00001", productTitle: `Synthetic gallery ${counts.total}`,
    brand: "Synthetic Brand", status: "confirmed", visibility: "team", category: "家居",
    thumbnailImages: images.slice(0, 5), images, acquisitionCoverage: null,
    overallAnalysis: null, userEditedOverallAnalysis: null,
  };
  return { set, images };
}

async function installGalleryFixtures(page: Page, counts: typeof cases[number]) {
  const { set, images } = fixture(counts);
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  // Never let a synthetic UI regression invoke a provider or external image host.
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname)) return route.fallback();
    externalRequests.push(url.origin);
    await route.abort("blockedbyclient");
  });
  await installRealPageFixtures(page, {
    "kbImages.listSets": [set], "kbImages.getSet": set, "kbImages.listAllImages": images,
    "kbTags.listAllForDimension": [], "kbTags.getTagCountsLive": {},
  });
  await page.route(`**${assetPrefix}*.svg`, route => route.fulfill({
    status: 200, contentType: "image/svg+xml",
    // Off-center content makes the full-canvas toggle observably different.
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="white"/><rect x="40" y="200" width="200" height="400" fill="#245b9a"/></svg>',
  }));
  return { set, externalRequests, pageErrors };
}

async function expectContainedFrames(dialog: Locator, aplusCount: number) {
  // Inspect actual geometry; overflow:hidden alone must not make the test pass.
  await expect.poll(() => dialog.evaluate((element, expectedAplus) => {
    const rect = element.getBoundingClientRect();
    const main = element.querySelector<HTMLImageElement>("img[fetchpriority=high]");
    const aplus = [...element.querySelectorAll<HTMLImageElement>('img[src*="/aplus-"]')];
    const frames = [main, ...aplus].map(img => img?.parentElement?.getBoundingClientRect());
    return aplus.length === expectedAplus && frames.every(frame => frame && frame.width > 0
      && frame.left >= rect.left - 1 && frame.right <= rect.right + 1)
      && element.scrollWidth <= element.clientWidth;
  }, aplusCount)).toBe(true);
}

async function expectFullCanvasInsideFrame(image: Locator) {
  await expect.poll(() => image.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const frame = element.parentElement!.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= frame.left - 1 && rect.right <= frame.right + 1
      && rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1;
  })).toBe(true);
}

for (const counts of cases) {
  for (const viewport of viewports) {
    test(`${counts.name} stays contained on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const { set, pageErrors, externalRequests } = await installGalleryFixtures(page, counts);
      await page.goto("/knowledge/images");
      await expect(page.getByRole("heading", { name: "智能图片知识库", exact: true })).toBeVisible();
      await page.getByRole("heading", { name: set.productTitle, exact: true }).click();
      const dialog = page.getByTestId("kb-image-set-detail");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(`${counts.total} 张图片`, { exact: true })).toBeVisible();
      const main = dialog.locator("img[fetchpriority=high]");
      await expect.poll(() => main.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 800)).toBe(true);
      await expectContainedFrames(dialog, counts.aplus);
      const dialogRect = await dialog.boundingBox();
      expect(dialogRect!.x).toBeGreaterThanOrEqual(0);
      expect(dialogRect!.x + dialogRect!.width).toBeLessThanOrEqual(viewport.width + 1);

      // Switching thumbnails must change the full image, without losing containment.
      const nextUrl = imageUrl("secondary", 1);
      const nextThumbnail = dialog.locator("button:visible").filter({ has: page.locator(`img[src="${nextUrl}"]`) });
      await expect(nextThumbnail).toHaveCount(1);
      await nextThumbnail.click();
      await expect(main).toHaveAttribute("src", nextUrl);
      await expect(main).toHaveCSS("object-fit", "contain");
      await expect.poll(() => main.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 800)).toBe(true);
      await expectContainedFrames(dialog, counts.aplus);

      const mainFrame = main.locator("..");
      await expect.poll(() => main.evaluate(img => img.style.transform)).not.toBe("translate(0px, 0px)");
      await mainFrame.getByRole("button", { name: "完整画布", exact: true }).click();
      await expect(main).toHaveCSS("transform", "none");
      await expect(main).toHaveAttribute("src", nextUrl);
      await expect(main).toHaveCSS("object-fit", "contain");
      await expectFullCanvasInsideFrame(main);
      await mainFrame.getByRole("button", { name: "平衡留白", exact: true }).click();
      await expectContainedFrames(dialog, counts.aplus);

      const firstAplus = dialog.locator('img[src*="/aplus-"]').first();
      const aplusFrame = firstAplus.locator("..");
      await aplusFrame.scrollIntoViewIfNeeded();
      await expect.poll(() => firstAplus.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 800)).toBe(true);
      await aplusFrame.getByRole("button", { name: "完整画布", exact: true }).click();
      await expect(firstAplus).toHaveCSS("transform", "none");
      await expect(firstAplus).toHaveCSS("object-fit", "contain");
      await expectFullCanvasInsideFrame(firstAplus);
      await expectContainedFrames(dialog, counts.aplus);

      const brandImages = dialog.locator('img[src*="/brand_story-"]');
      await expect(brandImages).toHaveCount(counts.brandStories);
      if (counts.brandStories) {
        // `has` is relative to each candidate strip; reusing brandImages would
        // incorrectly require another detail dialog nested inside that strip.
        const strip = dialog.locator("div.overflow-x-auto").filter({
          has: page.locator('img[src*="/brand_story-"]').first(),
        });
        await expect(strip).toHaveCount(1);
        await expect(strip.locator('img[src*="/brand_story-"]')).toHaveCount(counts.brandStories);
        await strip.scrollIntoViewIfNeeded();
        expect(await strip.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        expect(await strip.evaluate(element => { element.scrollLeft = element.scrollWidth; return element.scrollLeft; })).toBeGreaterThan(0);
        await expectContainedFrames(dialog, counts.aplus);
        expect(await dialog.evaluate(element => element.scrollLeft)).toBe(0);
      }
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    });
  }
}
