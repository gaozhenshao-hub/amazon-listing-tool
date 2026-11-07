/** Two-level vocabulary shared by the library and image outline. Pixel sizes are
 * Amazon's documented minimums; gallery 2000px is our editable working default.
 * Reviewed 2026-11-01. These definitions do not reclassify historical assets. */
export const AMAZON_MODULE_SOURCES = {
  standard: "https://developer-docs.amazon/sp-api/docs/a-plus-content-examples",
  premium: "https://developer-docs.amazon/sp-api/docs/a-plus-premium-modules",
  story: "https://developer-docs.amazon/sp-api/docs/a-plus-brand-story-modules",
} as const;
export type ImageFamily = "主图" | "普通A+" | "高级A+" | "品牌故事";
export type ModuleSpec = {
  family: ImageFamily;
  name: string;
  officialName: string;
  officialType: string;
  media: "image" | "text" | "video" | "mixed";
  min: number;
  max: number;
  defaultCount: number;
  width: number;
  height: number;
  mobileWidth?: number;
  mobileHeight?: number;
  extraSizes?: string;
  guidance: string;
  source: string;
};
type Definition = [
  name: string,
  type: string,
  media: ModuleSpec["media"],
  count: number | [number, number, number],
  width: number,
  height: number,
  guidance: string,
  mobile?: [number, number],
  extra?: string,
];
function define(
  family: ImageFamily,
  source: string,
  items: Definition[]
): ModuleSpec[] {
  return items.map(
    ([
      name,
      type,
      media,
      count,
      width,
      height,
      guidance,
      mobile,
      extraSizes,
    ]) => ({
      family,
      name,
      officialName: type
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase()),
      officialType: type,
      media,
      min: typeof count === "number" ? count : count[0],
      max: typeof count === "number" ? count : count[1],
      defaultCount: typeof count === "number" ? count : count[2],
      width,
      height,
      ...(mobile ? { mobileWidth: mobile[0], mobileHeight: mobile[1] } : {}),
      extraSizes,
      guidance,
      source,
    })
  );
}
export const AMAZON_MODULE_CATALOG: readonly ModuleSpec[] = [
  ...define("主图", "", [
    [
      "主图",
      "MAIN_IMAGE",
      "image",
      1,
      2000,
      2000,
      "第一张图的备选方案；三个方案比较背景、角度、摆放和产品呈现，最终选择一个。2000×2000为可修改的制作默认值。",
    ],
    [
      "附图",
      "SECONDARY_IMAGE",
      "image",
      1,
      2000,
      2000,
      "第一张以外的展示图；2000×2000为可修改的制作默认值。",
    ],
  ]),
  ...define("普通A+", AMAZON_MODULE_SOURCES.standard, [
    [
      "公司标识",
      "STANDARD_COMPANY_LOGO",
      "image",
      1,
      600,
      180,
      "展示品牌标识，保留独立标识图。",
    ],
    [
      "图文叠加",
      "STANDARD_IMAGE_TEXT_OVERLAY",
      "image",
      1,
      970,
      300,
      "背景图上叠加文字，可选择深色或浅色文字区域。",
    ],
    [
      "顶部图片与文字",
      "STANDARD_HEADER_IMAGE_TEXT",
      "image",
      1,
      970,
      600,
      "宽图配标题、正文，文字保持独立可编辑。",
    ],
    [
      "多图与文字",
      "STANDARD_MULTIPLE_IMAGE_TEXT",
      "image",
      [1, 5, 4],
      300,
      300,
      "多张高亮图片及配套文字，按图片分别规划。",
    ],
    [
      "单侧图片",
      "STANDARD_SINGLE_SIDE_IMAGE",
      "image",
      1,
      300,
      300,
      "单图在左或右，另一侧展示文字；左右方向作为排版属性。",
    ],
    [
      "图片与侧栏",
      "STANDARD_IMAGE_SIDEBAR",
      "image",
      2,
      300,
      400,
      "主图配侧栏小图及文字。第二张使用侧栏尺寸。",
      undefined,
      "侧栏图片 300×175",
    ],
    [
      "单图与亮点",
      "STANDARD_SINGLE_IMAGE_HIGHLIGHTS",
      "image",
      1,
      300,
      300,
      "单图配重点说明和条目式文字。",
    ],
    [
      "单图与规格详情",
      "STANDARD_SINGLE_IMAGE_SPECS_DETAIL",
      "image",
      1,
      300,
      300,
      "单图、规格、详细说明并列规划。",
    ],
    [
      "三图文",
      "STANDARD_THREE_IMAGE_TEXT",
      "image",
      3,
      300,
      300,
      "三个图片及独立图文区域。",
    ],
    [
      "四图文",
      "STANDARD_FOUR_IMAGE_TEXT",
      "image",
      4,
      220,
      200,
      "四张图片横排，各自标题与正文。",
    ],
    [
      "商品对比表",
      "STANDARD_COMPARISON_TABLE",
      "image",
      [1, 6, 4],
      150,
      300,
      "每列商品图片与参数；图片为可选，参数保留文字。",
    ],
    [
      "四图文象限",
      "STANDARD_FOUR_IMAGE_TEXT_QUADRANT",
      "image",
      4,
      135,
      135,
      "四组图片与文字组成2×2布局。",
    ],
    [
      "纯文字",
      "STANDARD_TEXT",
      "text",
      0,
      0,
      0,
      "保留标题与正文，规划文字内容，不占生图格子。",
    ],
    [
      "商品描述文字",
      "STANDARD_PRODUCT_DESCRIPTION",
      "text",
      0,
      0,
      0,
      "纯商品描述，不占生图格子。",
    ],
    [
      "技术规格",
      "STANDARD_TECH_SPECS",
      "text",
      0,
      0,
      0,
      "4–16组参数说明，可排一列或两列。",
    ],
  ]),
  ...define("高级A+", AMAZON_MODULE_SOURCES.premium, [
    [
      "单图文",
      "PREMIUM_IMAGE_TEXT",
      "image",
      1,
      800,
      600,
      "图片与文字左右并列，移动端上下排列。",
    ],
    [
      "全宽背景图",
      "PREMIUM_FULL_BACKGROUND_IMAGE",
      "image",
      1,
      1464,
      600,
      "全宽图片，底部可添加文字。",
      [600, 450],
    ],
    [
      "全宽背景图文",
      "PREMIUM_FULL_BACKGROUND_TEXT",
      "image",
      1,
      1464,
      600,
      "全宽图片叠加标题和说明。",
      [600, 450],
    ],
    [
      "四列图片",
      "PREMIUM_FOUR_COLUMN_IMAGES",
      "image",
      [3, 4, 4],
      300,
      225,
      "桌面3–4列，移动端2×2，各图配独立说明。",
    ],
    [
      "双图文",
      "PREMIUM_DUAL_IMAGE_TEXT",
      "image",
      2,
      650,
      350,
      "两张图片与各自文字并列。",
    ],
    [
      "纯文字",
      "PREMIUM_TEXT",
      "text",
      0,
      0,
      0,
      "标题和富文本正文，不占生图格子。",
    ],
    [
      "图片轮播",
      "PREMIUM_IMAGE_CAROUSEL",
      "image",
      [2, 6, 4],
      1464,
      600,
      "2–6张图片轮播，每张独立规划内容。",
      [600, 450],
    ],
    [
      "导航轮播",
      "PREMIUM_NAVIGATION_CAROUSEL",
      "image",
      [2, 5, 4],
      1464,
      600,
      "2–5张图片，带导航标签及独立标题说明。",
      [600, 450],
    ],
    [
      "流程轮播",
      "PREMIUM_REGIMEN_CAROUSEL",
      "image",
      [2, 5, 4],
      1464,
      600,
      "2–5步流程轮播，导航文字与每步内容对应。",
      [600, 450],
    ],
    [
      "三列商品对比",
      "PREMIUM_THREE_COLUMN_COMPARISON",
      "image",
      3,
      300,
      225,
      "三列商品对比，2–5个比较维度。",
    ],
    [
      "商品对比轮播",
      "PREMIUM_COMPARISON_CAROUSEL",
      "image",
      [3, 5, 4],
      488,
      700,
      "3–5个商品，3–7项对比参数。",
      [600, 450],
    ],
    [
      "商品对比滚动表",
      "PREMIUM_COMPARISON_SCROLLER",
      "image",
      [4, 7, 4],
      200,
      225,
      "4–7个商品，5–12项比较参数。",
    ],
    [
      "热点图片",
      "PREMIUM_HOTSPOT_IMAGE",
      "image",
      [3, 7, 4],
      1464,
      600,
      "主图设2–6个热点；每个热点另需移动端细节图。",
      undefined,
      "第1格主图；第2格起为热点细节图 600×450（2–6张）",
    ],
    [
      "热点图文",
      "PREMIUM_HOTSPOT_IMAGE_TEXT",
      "image",
      [3, 7, 4],
      1464,
      600,
      "主图及2–6个热点，另有模块标题正文；每个热点另需细节图。",
      undefined,
      "第1格主图；第2格起为热点细节图 600×450（2–6张）",
    ],
    [
      "常见问题",
      "PREMIUM_FAQ",
      "text",
      0,
      0,
      0,
      "2–5组问答，直接回应买家问题及顾虑，不占生图格子。",
    ],
    [
      "技术规格",
      "PREMIUM_TECH_SPECS",
      "text",
      0,
      0,
      0,
      "4–16组规格，可一列或两列排列。",
    ],
    [
      "视频与文字",
      "PREMIUM_VIDEO_TEXT",
      "video",
      1,
      800,
      600,
      "视频配独立文字；尺寸为预览封面最低尺寸。",
    ],
    [
      "全宽视频",
      "PREMIUM_HERO_VIDEO",
      "video",
      1,
      1464,
      600,
      "全宽视频；图片尺寸为封面，视频最低960×540。",
    ],
    [
      "视频图片轮播",
      "PREMIUM_VIDEO_IMAGE_CAROUSEL",
      "mixed",
      [2, 6, 4],
      800,
      600,
      "2–6个图或视频卡片，每个卡片配独立说明。",
      [600, 450],
    ],
  ]),
  ...define("品牌故事", AMAZON_MODULE_SOURCES.story, [
    [
      "轮播背景",
      "BRAND_STORY_IMAGE_WITH_LOGO",
      "image",
      1,
      1464,
      625,
      "整个品牌故事共用背景；原采集背景不进行卖点分析。",
      [463, 625],
    ],
    [
      "四商品与店铺展示",
      "BRAND_STORY_FOUR_ASIN",
      "image",
      4,
      166,
      182,
      "四张商品图组成一个卡片，保留商品与店铺关联。",
    ],
    [
      "品牌焦点图片",
      "BRAND_STORY_MEDIA_ASSET",
      "image",
      1,
      362,
      453,
      "单张品牌焦点图片及标题。",
    ],
    [
      "品牌标识与介绍",
      "BRAND_STORY_ABOUT",
      "image",
      1,
      315,
      145,
      "品牌标识配品牌介绍，标识与正文分别规划。",
    ],
    [
      "品牌问答",
      "BRAND_STORY_QUESTIONS",
      "text",
      0,
      0,
      0,
      "三组品牌问答，保留独立文字，不占生图格子。",
    ],
  ]),
];
export const IMAGE_FAMILIES: readonly ImageFamily[] = [
  "主图",
  "普通A+",
  "高级A+",
  "品牌故事",
];
export const DEFAULT_APLUS_FAMILY = "高级A+" as const;
export const moduleSpec = (family: string, name: string) =>
  AMAZON_MODULE_CATALOG.find(m => m.family === family && m.name === name);
export const moduleSpecLabel = (spec: ModuleSpec) =>
  spec.media === "text"
    ? "文字模块，无需图片"
    : `${spec.width}×${spec.height}${spec.mobileWidth ? `；移动端 ${spec.mobileWidth}×${spec.mobileHeight}` : ""}${spec.extraSizes ? `；${spec.extraSizes}` : ""}`;
export const CURRENT_IMAGE_BELONG_HIERARCHY: Record<string, string[]> =
  Object.fromEntries(
    IMAGE_FAMILIES.map(f => [
      f,
      AMAZON_MODULE_CATALOG.filter(m => m.family === f).map(m => m.name),
    ])
  );
export const LEGACY_IMAGE_BELONG_HIERARCHY: Record<string, string[]> = {
  套图: [],
  "A+": [
    "图片轮播",
    "对比表格",
    "全宽图",
    "图文叠加",
    "四图文",
    "三图文",
    "热点交互",
    "视频模块",
    "导航轮播",
    "单图侧文",
    "技术参数表",
    "品牌故事卡",
  ],
  品牌故事: ["单图", "四图组合"],
};
