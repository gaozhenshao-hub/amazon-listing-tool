import { z } from "zod";
export const AMAZON_RESEARCH_HOSTS = [
  "amazon.com",
  "amazon.ca",
  "amazon.com.mx",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.nl",
  "amazon.se",
  "amazon.pl",
  "amazon.com.be",
  "amazon.ie",
  "amazon.co.jp",
  "amazon.com.au",
  "amazon.sg",
  "amazon.in",
  "amazon.ae",
  "amazon.sa",
  "amazon.com.br",
  "amazon.com.tr",
  "amazon.eg",
  "amazon.co.za",
] as const;
export function amazonResearchHost(hostname: string) {
  return (
    AMAZON_RESEARCH_HOSTS.find(
      host =>
        hostname === host ||
        hostname === `www.${host}` ||
        hostname === `smile.${host}`
    ) || null
  );
}
export function researchIdentity(kind: "product" | "store", address: string) {
  const url = new URL(address),
    host = amazonResearchHost(url.hostname);
  if (
    url.protocol !== "https:" ||
    !host ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("请使用亚马逊商品或店铺页面链接");
  const origin = `https://www.${host}`;
  if (kind === "product") {
    const asin = url.pathname
      .match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]
      ?.toUpperCase();
    if (!asin) throw new Error("未识别到商品ASIN，请打开商品详情页");
    return {
      key: `product:${host}:${asin}`,
      site: host,
      asin,
      url: `${origin}/dp/${asin}`,
    };
  }
  const page = url.pathname
    .match(/\/stores\/(?:[^/]+\/)?page\/([a-f0-9-]{16,60})(?:\/|$)/i)?.[1]
    ?.toUpperCase();
  const seller = url.searchParams.get("seller") || url.searchParams.get("me");
  if (page)
    return {
      key: `store:${host}:page:${page}`,
      site: host,
      asin: null,
      url: `${origin}/stores/page/${page}`,
    };
  if (
    seller &&
    /^[A-Z0-9]{5,30}$/i.test(seller) &&
    /^\/(?:sp|s|gp\/aag\/main)(?:\/|$)/.test(url.pathname)
  )
    return {
      key: `store:${host}:seller:${seller.toUpperCase()}`,
      site: host,
      asin: null,
      url: `${origin}/sp?seller=${seller.toUpperCase()}`,
    };
  throw new Error("请打开品牌店铺或卖家店铺页面后收藏");
}
export function researchThumbnail(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      /(^|\.)(?:media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com|amazon-adsystem\.com)$/.test(
        url.hostname
      )
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}
export const researchBookmarkSchema = z
  .object({
    kind: z.enum(["product", "store"]),
    url: z.string().url().max(2000),
    title: z.string().trim().min(1).max(1000),
    thumbnail: z.string().max(2000).default(""),
    price: z.string().max(100).default(""),
    brand: z.string().max(200).default(""),
  })
  .strict();
export const RESEARCH_STATES = {
  pending: "待调研",
  researching: "调研中",
  valuable: "有价值",
  archived: "已归档",
} as const;
