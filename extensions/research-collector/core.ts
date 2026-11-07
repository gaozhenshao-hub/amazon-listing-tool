import {
  researchIdentity,
  researchThumbnail,
  amazonResearchHost,
} from "../../shared/researchLibrary";
export function visibleResearchPage(document: Document, address: string) {
  const url = new URL(address);
  if (!amazonResearchHost(url.hostname)) return null;
  const product = !!url.pathname.match(
    /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}(?:\/|$)/i
  );
  const kind = product ? "product" : "store";
  let identity;
  try {
    identity = researchIdentity(kind, address);
  } catch {
    return null;
  }
  const text = (selector: string) =>
    document
      .querySelector(selector)
      ?.textContent?.trim()
      .replace(/\s+/g, " ") || "";
  const target = product
    ? document.querySelector("#productTitle") || document.querySelector("h1")
    : document.querySelector('[data-testid="store-name"],.stores-page h1,h1');
  const title = (
    target?.textContent?.trim() ||
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content") ||
    document.title
  )
    .replace(/\s+/g, " ")
    .slice(0, 1000);
  if (!title) return null;
  const thumbnail =
    (product
      ? document.querySelector<HTMLImageElement>("#landingImage,#imgBlkFront")
          ?.src
      : "") ||
    document
      .querySelector('meta[property="og:image"]')
      ?.getAttribute("content") ||
    "";
  return {
    target,
    data: {
      kind,
      url: identity.url,
      title,
      thumbnail: researchThumbnail(thumbnail),
      price: product
        ? text(
            "#corePrice_feature_div .a-offscreen,.a-price .a-offscreen,#priceblock_ourprice"
          ).slice(0, 100)
        : "",
      brand: product ? text("#bylineInfo").slice(0, 200) : "",
    },
  };
}
