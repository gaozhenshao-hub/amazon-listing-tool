/** Public SP-API families; left/right and light/dark are presentation variants. */
export const AMAZON_MODULE_CATALOG = {
  STANDARD_COMPANY_LOGO: ["品牌标志", "image"],
  STANDARD_COMPARISON_TABLE: ["产品比较表", "comparison"],
  STANDARD_FOUR_IMAGE_TEXT: ["四图文", "grid"],
  STANDARD_FOUR_IMAGE_TEXT_QUADRANT: ["四宫格图文", "grid"],
  STANDARD_HEADER_IMAGE_TEXT: ["标题图文", "image"],
  STANDARD_IMAGE_SIDEBAR: ["图片侧栏", "grid"],
  STANDARD_IMAGE_TEXT_OVERLAY: ["图文叠加", "image"],
  STANDARD_MULTIPLE_IMAGE_TEXT: ["多图切换", "carousel"],
  STANDARD_PRODUCT_DESCRIPTION: ["产品描述", "text"],
  STANDARD_SINGLE_IMAGE_HIGHLIGHTS: ["单图重点说明", "image"],
  STANDARD_SINGLE_IMAGE_SPECS_DETAIL: ["单图规格详情", "image"],
  STANDARD_SINGLE_SIDE_IMAGE: ["单图侧文", "image"],
  STANDARD_TECH_SPECS: ["技术参数表", "specifications"],
  STANDARD_TEXT: ["纯文字", "text"],
  STANDARD_THREE_IMAGE_TEXT: ["三图文", "grid"],
  PREMIUM_IMAGE_TEXT: ["高级单图文", "image"],
  PREMIUM_TEXT: ["高级纯文字", "text"],
  PREMIUM_FULL_BACKGROUND_TEXT: ["全幅图文叠加", "image"],
  PREMIUM_FULL_BACKGROUND_IMAGE: ["全幅图片", "image"],
  PREMIUM_FOUR_COLUMN_IMAGES: ["四列图文", "grid"],
  PREMIUM_DUAL_IMAGE_TEXT: ["双图文", "grid"],
  PREMIUM_IMAGE_CAROUSEL: ["图片轮播", "carousel"],
  PREMIUM_NAVIGATION_CAROUSEL: ["导航轮播", "carousel"],
  PREMIUM_REGIMEN_CAROUSEL: ["步骤轮播", "carousel"],
  PREMIUM_THREE_COLUMN_COMPARISON: ["三列产品比较", "comparison"],
  PREMIUM_COMPARISON_CAROUSEL: ["产品比较轮播", "comparison"],
  PREMIUM_COMPARISON_SCROLLER: ["横向滚动比较", "comparison"],
  PREMIUM_HOTSPOT_IMAGE: ["图片热点", "hotspots"],
  PREMIUM_HOTSPOT_IMAGE_TEXT: ["图片热点说明", "hotspots"],
  PREMIUM_FAQ: ["常见问答", "faq"],
  PREMIUM_TECH_SPECS: ["高级技术参数", "specifications"],
  PREMIUM_VIDEO_TEXT: ["视频图文", "video"],
  PREMIUM_HERO_VIDEO: ["全幅视频", "video"],
  PREMIUM_VIDEO_IMAGE_CAROUSEL: ["图视频轮播", "carousel"],
  BRAND_STORY_IMAGE_WITH_LOGO: ["品牌背景", "brand_story"],
  BRAND_STORY_FOUR_ASIN: ["品牌四产品卡", "brand_story"],
  BRAND_STORY_MEDIA_ASSET: ["品牌图片卡", "brand_story"],
  BRAND_STORY_ABOUT: ["品牌介绍卡", "brand_story"],
  BRAND_STORY_QUESTIONS: ["品牌问答卡", "brand_story"],
} as const;
export type AmazonModuleType = keyof typeof AMAZON_MODULE_CATALOG;
export type AmazonModuleKind =
  | (typeof AMAZON_MODULE_CATALOG)[AmazonModuleType][1]
  | "unknown";
export function knownAmazonModuleType(
  value: string
): AmazonModuleType | undefined {
  const normalized = value
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase()
    .replace(/_MODULE$/, "");
  return normalized in AMAZON_MODULE_CATALOG
    ? (normalized as AmazonModuleType)
    : undefined;
}
