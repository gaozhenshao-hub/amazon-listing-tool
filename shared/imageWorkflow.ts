export const IMAGE_WORKFLOW_SECONDARY_IMAGE_NUMBERS = [2, 3, 4, 5, 6, 7] as const;

const SECONDARY_IMAGE_CONTRACT_FALLBACKS: Record<number, {
  purpose: string;
  contentBrief: string;
  expressionType: string;
  whyThisWay: string;
}> = {
  2: {
    purpose: "优先展示首要购买理由和核心优势",
    contentBrief: "围绕已确认的第一核心卖点安排产品特写、关键结构或使用结果，并用精炼文案说明用户可获得的价值。",
    expressionType: "直接展示",
    whyThisWay: "在主图之后快速承接用户注意力，建立产品与核心需求的直接关联。",
  },
  3: {
    purpose: "解释关键功能、结构或工作原理",
    contentBrief: "拆解与核心性能相关的结构、材质或工作原理，使用局部放大、标注和必要的数据说明。",
    expressionType: "原理展示",
    whyThisWay: "用可理解的证据支撑卖点，减少用户对功能真实性的疑虑。",
  },
  4: {
    purpose: "展示产品在主要场景中的使用价值",
    contentBrief: "选择与目标用户高度相关的使用场景，展示产品、人物或环境之间的关系，并突出使用后的实际收益。",
    expressionType: "场景暗示",
    whyThisWay: "帮助用户代入真实使用情境，强化需求匹配和购买意愿。",
  },
  5: {
    purpose: "回应用户痛点并体现差异化优势",
    contentBrief: "围绕已确认的用户痛点制作使用前后或解决方案对比，清楚说明产品如何降低风险、成本或操作难度。",
    expressionType: "解决痛点",
    whyThisWay: "把抽象优势转换为可比较的解决效果，降低用户决策门槛。",
  },
  6: {
    purpose: "补充规格、适配范围或套装信息",
    contentBrief: "以参数、尺寸、兼容性或包装清单为主，使用图标和结构化信息帮助用户快速确认是否适合购买。",
    expressionType: "数据对比",
    whyThisWay: "在用户形成购买兴趣后补齐理性决策信息，减少误购和售后风险。",
  },
  7: {
    purpose: "补齐购买决策信息并完成视觉收尾",
    contentBrief: "展示已确认的产品规格、套装内容、认证、质保或售后支持，并简洁回顾核心优势；不得添加未经确认的证明。",
    expressionType: "直接展示",
    whyThisWay: "作为最后一张辅图补齐购买前关键信息，降低决策疑虑并承接后续A+内容。",
  },
};

export const DEFAULT_OUTLINE_APLUS_MODULE_ID = "premium_full_image";

export const IMAGE_WORKFLOW_APLUS_MODULES = [
  { id: "premium_full_image", name: "高级完整图片", desc: "全屏背景+文字覆盖", category: "全屏展示", specs: "1464x600px；标题800字符，正文300字符", structure: "单张全宽大图" },
  { id: "premium_text", name: "高级文本", desc: "纯文本模块", category: "文本", specs: "标题80字符，正文300字符", structure: "纯文字说明" },
  { id: "premium_bg_image_text", name: "高级背景图像+文本", desc: "背景图+叠加文字", category: "全屏展示", specs: "1464x600px；标题60字符，副标题40字符，正文300字符", structure: "单张背景图叠字" },
  { id: "premium_four_image_text", name: "高级四图片+文本", desc: "4张小图+文字", category: "图文组合", specs: "每图300x225px；标题30字符，正文150字符", structure: "4张子图，适合拆分卖点或步骤" },
  { id: "premium_dual_image_text", name: "高级双图片+文本", desc: "左右双图", category: "图文组合", specs: "每图650x350px；标题50字符，副标题50字符，正文300字符", structure: "2张并列图" },
  { id: "premium_single_image_text", name: "高级单图+文本", desc: "大图+长文", category: "图文组合", specs: "800x600px；标题80字符，副标题40字符，正文500字符", structure: "单张说明图" },
  { id: "premium_full_video", name: "高级全视频", desc: "全宽视频模块", category: "多媒体", specs: "视频≤200MB，≤180秒，960x540px", structure: "1个视频脚本/封面" },
  { id: "premium_video_text", name: "高级视频+文本", desc: "视频+文字", category: "多媒体", specs: "800x600px；标题80字符，副标题40字符，正文500字符", structure: "1个视频脚本+说明图" },
  { id: "premium_comparison_1", name: "高级比较表1", desc: "4-7产品对比", category: "对比展示", specs: "产品图200x225px；5-12个特征", structure: "4-7列产品对比" },
  { id: "premium_comparison_2", name: "高级比较表2", desc: "2-3产品对比", category: "对比展示", specs: "产品图300x225px；2-5个特征", structure: "2-3列产品对比" },
  { id: "premium_comparison_3", name: "高级比较表3", desc: "2-4产品纵向对比", category: "对比展示", specs: "产品图488x700px；3-7个特征", structure: "2-4张纵向对比图" },
  { id: "premium_hotspot_1", name: "高级热点1", desc: "点击热点说明", category: "交互展示", specs: "1464x600px；2-6个热点，标题50字符，正文200字符", structure: "1张底图+2-6个热点" },
  { id: "premium_hotspot_2", name: "高级热点2", desc: "热点模块", category: "交互展示", specs: "1464x600px；2-6个热点，模块标题80字符", structure: "1张底图+2-6个热点" },
  { id: "premium_nav_carousel", name: "高级导航轮播", desc: "2-5个导航面板", category: "轮播展示", specs: "每面板1464x600px；导航文本25字符", structure: "2-5张轮播面板" },
  { id: "premium_rule_carousel", name: "高级规则轮播", desc: "2-5个规则面板", category: "轮播展示", specs: "每面板1464x600px；模块标题100字符", structure: "2-5张轮播面板" },
  { id: "premium_simple_carousel", name: "高级简单图像轮播", desc: "2-6个图片面板", category: "轮播展示", specs: "每面板1464x600px；标题50字符", structure: "2-6张轮播面板" },
  { id: "premium_video_carousel", name: "高级视频图像轮播", desc: "2-6个视频/图片面板", category: "轮播展示", specs: "每面板800x600px；标题80字符", structure: "2-6个视频或图片面板" },
  { id: "premium_qa", name: "高级问答", desc: "2-5个问答", category: "信息展示", specs: "问题120字符，回答250字符", structure: "2-5组问答内容" },
  { id: "premium_tech_specs", name: "高级技术规格", desc: "3-15个规格", category: "信息展示", specs: "规格图300x300px；标题80字符", structure: "3-15个规格项" },
  { id: "brand_highlight", name: "品牌亮点", desc: "3-4个品牌亮点", category: "品牌建设", specs: "图标135x135px；标题30字符，正文80字符", structure: "3-4个品牌亮点卡片" },
  { id: "standard_image_text", name: "标准图文", desc: "标准A+基础模块", category: "标准A+", specs: "970x300px；标题160字符，正文6000字符", structure: "单张标准图文" },
  { id: "standard_comparison", name: "标准对比表", desc: "最多5个产品", category: "标准A+", specs: "产品图150x150px；标题80字符，正文250字符", structure: "最多5列对比表" },
  { id: "standard_four_image", name: "标准四图", desc: "4张图+文字", category: "标准A+", specs: "每图220x220px；标题60字符，正文160字符", structure: "4张子图" },
  { id: "standard_single_image", name: "标准单图", desc: "全宽单图", category: "标准A+", specs: "970x600px；标题160字符，正文6000字符", structure: "单张全宽图" },
] as const;

export const IMAGE_WORKFLOW_APLUS_CATEGORIES = Array.from(
  new Set(IMAGE_WORKFLOW_APLUS_MODULES.map((module) => module.category)),
);

export function findImageWorkflowAplusModule(value?: string | null) {
  if (!value) return undefined;
  return IMAGE_WORKFLOW_APLUS_MODULES.find((module) => module.id === value || module.name === value);
}

export function applyImageWorkflowAplusStyle(module: Record<string, unknown>, moduleType: string) {
  const selected = findImageWorkflowAplusModule(moduleType);
  if (!selected) return module;
  return {
    ...module,
    selectedModuleType: selected.id,
    selectedModuleName: selected.name,
    selectedModuleCategory: selected.category,
    selectedModuleSpecs: selected.specs,
    selectedModuleStructure: selected.structure,
  };
}

export function normalizeImageWorkflowAplusStyle(
  module: Record<string, any>,
  options: { forceDefault?: boolean } = {},
) {
  const requested = options.forceDefault
    ? DEFAULT_OUTLINE_APLUS_MODULE_ID
    : module.selectedModuleType || module.recommendedModuleType || module.selectedModuleName || DEFAULT_OUTLINE_APLUS_MODULE_ID;
  return applyImageWorkflowAplusStyle(module, requested);
}

export function normalizeSecondaryImageSlots<T extends Record<string, any>>(
  items: T[] | null | undefined,
  createMissing: (imageNumber: number) => T,
): T[] {
  const byNumber = new Map<number, T>();
  const unassigned: T[] = [];

  for (const item of Array.isArray(items) ? items : []) {
    const imageNumber = Number(item?.imageNumber);
    if (
      IMAGE_WORKFLOW_SECONDARY_IMAGE_NUMBERS.includes(imageNumber as (typeof IMAGE_WORKFLOW_SECONDARY_IMAGE_NUMBERS)[number]) &&
      !byNumber.has(imageNumber)
    ) {
      byNumber.set(imageNumber, item);
    } else {
      unassigned.push(item);
    }
  }

  return IMAGE_WORKFLOW_SECONDARY_IMAGE_NUMBERS.map((imageNumber) => {
    const item = byNumber.get(imageNumber) || unassigned.shift() || createMissing(imageNumber);
    return { ...item, imageNumber };
  });
}

export function normalizeImageOutline(
  value: Record<string, any>,
  options: { forceDefaultAplus?: boolean; recoverMissingSecondaryContent?: boolean } = {},
) {
  const sourceSecondaryImages = Array.isArray(value?.secondaryImages) ? value.secondaryImages : [];
  const canRecoverLegacyContract = options.recoverMissingSecondaryContent && sourceSecondaryImages.length >= 5;
  const secondaryImages = normalizeSecondaryImageSlots(
    sourceSecondaryImages,
    (imageNumber) => ({
      imageNumber,
      purpose: "",
      sellingPointRefs: [],
      contentBrief: "",
      expressionType: "",
      whyThisWay: "",
      priority: "中",
      referenceHighlights: [],
    }),
  ).map((image) => {
    if (!canRecoverLegacyContract) return image;

    const fallback = SECONDARY_IMAGE_CONTRACT_FALLBACKS[image.imageNumber];
    const recoveredFields: string[] = [];
    const recoverText = (field: keyof typeof fallback) => {
      const current = String(image?.[field] || "").trim();
      if (current) return image[field];
      recoveredFields.push(field);
      return fallback[field];
    };
    const sellingPointRefs = Array.isArray(image.sellingPointRefs) && image.sellingPointRefs.length > 0
      ? image.sellingPointRefs
      : (recoveredFields.push("sellingPointRefs"), ["已确认卖点体系"]);
    const purpose = recoverText("purpose");
    const contentBrief = recoverText("contentBrief");
    const expressionType = recoverText("expressionType");
    const whyThisWay = recoverText("whyThisWay");

    if (recoveredFields.length === 0) return image;

    return {
      ...image,
      purpose,
      contentBrief,
      expressionType,
      whyThisWay,
      sellingPointRefs,
      priority: image.priority || "中",
      referenceHighlights: Array.isArray(image.referenceHighlights) ? image.referenceHighlights : [],
      contractRecovered: true,
      contractRecoveryFields: recoveredFields,
    };
  });

  return {
    ...value,
    secondaryImages,
    aPlusModules: (Array.isArray(value?.aPlusModules) ? value.aPlusModules : []).map((module: Record<string, any>) =>
      normalizeImageWorkflowAplusStyle(module, { forceDefault: options.forceDefaultAplus }),
    ),
  };
}
