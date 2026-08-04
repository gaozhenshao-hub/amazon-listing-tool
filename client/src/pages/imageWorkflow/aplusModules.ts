export const OUTLINE_APLUS_MODULES = [
  { id: 'premium_full_image', name: '高级完整图片', desc: '全屏背景+文字覆盖', category: '全屏展示', specs: '1464x600px；标题800字符，正文300字符', structure: '单张全宽大图' },
  { id: 'premium_text', name: '高级文本', desc: '纯文本模块', category: '文本', specs: '标题80字符，正文300字符', structure: '纯文字说明' },
  { id: 'premium_bg_image_text', name: '高级背景图像+文本', desc: '背景图+叠加文字', category: '全屏展示', specs: '1464x600px；标题60字符，副标题40字符，正文300字符', structure: '单张背景图叠字' },
  { id: 'premium_four_image_text', name: '高级四图片+文本', desc: '4张小图+文字', category: '图文组合', specs: '每图300x225px；标题30字符，正文150字符', structure: '4张子图，适合拆分卖点或步骤' },
  { id: 'premium_dual_image_text', name: '高级双图片+文本', desc: '左右双图', category: '图文组合', specs: '每图650x350px；标题50字符，副标题50字符，正文300字符', structure: '2张并列图' },
  { id: 'premium_single_image_text', name: '高级单图+文本', desc: '大图+长文', category: '图文组合', specs: '800x600px；标题80字符，副标题40字符，正文500字符', structure: '单张说明图' },
  { id: 'premium_full_video', name: '高级全视频', desc: '全宽视频模块', category: '多媒体', specs: '视频≤200MB，≤180秒，960x540px', structure: '1个视频脚本/封面' },
  { id: 'premium_video_text', name: '高级视频+文本', desc: '视频+文字', category: '多媒体', specs: '800x600px；标题80字符，副标题40字符，正文500字符', structure: '1个视频脚本+说明图' },
  { id: 'premium_comparison_1', name: '高级比较表1', desc: '4-7产品对比', category: '对比展示', specs: '产品图200x225px；5-12个特征', structure: '4-7列产品对比' },
  { id: 'premium_comparison_2', name: '高级比较表2', desc: '2-3产品对比', category: '对比展示', specs: '产品图300x225px；2-5个特征', structure: '2-3列产品对比' },
  { id: 'premium_comparison_3', name: '高级比较表3', desc: '2-4产品纵向对比', category: '对比展示', specs: '产品图488x700px；3-7个特征', structure: '2-4张纵向对比图' },
  { id: 'premium_hotspot_1', name: '高级热点1', desc: '点击热点说明', category: '交互展示', specs: '1464x600px；2-6个热点，标题50字符，正文200字符', structure: '1张底图+2-6个热点' },
  { id: 'premium_hotspot_2', name: '高级热点2', desc: '热点模块', category: '交互展示', specs: '1464x600px；2-6个热点，模块标题80字符', structure: '1张底图+2-6个热点' },
  { id: 'premium_nav_carousel', name: '高级导航轮播', desc: '2-5个导航面板', category: '轮播展示', specs: '每面板1464x600px；导航文本25字符', structure: '2-5张轮播面板' },
  { id: 'premium_rule_carousel', name: '高级规则轮播', desc: '2-5个规则面板', category: '轮播展示', specs: '每面板1464x600px；模块标题100字符', structure: '2-5张轮播面板' },
  { id: 'premium_simple_carousel', name: '高级简单图像轮播', desc: '2-6个图片面板', category: '轮播展示', specs: '每面板1464x600px；标题50字符', structure: '2-6张轮播面板' },
  { id: 'premium_video_carousel', name: '高级视频图像轮播', desc: '2-6个视频/图片面板', category: '轮播展示', specs: '每面板800x600px；标题80字符', structure: '2-6个视频或图片面板' },
  { id: 'premium_qa', name: '高级问答', desc: '2-5个问答', category: '信息展示', specs: '问题120字符，回答250字符', structure: '2-5组问答内容' },
  { id: 'premium_tech_specs', name: '高级技术规格', desc: '3-15个规格', category: '信息展示', specs: '规格图300x300px；标题80字符', structure: '3-15个规格项' },
  { id: 'brand_highlight', name: '品牌亮点', desc: '3-4个品牌亮点', category: '品牌建设', specs: '图标135x135px；标题30字符，正文80字符', structure: '3-4个品牌亮点卡片' },
  { id: 'standard_image_text', name: '标准图文', desc: '标准A+基础模块', category: '标准A+', specs: '970x300px；标题160字符，正文6000字符', structure: '单张标准图文' },
  { id: 'standard_comparison', name: '标准对比表', desc: '最多5个产品', category: '标准A+', specs: '产品图150x150px；标题80字符，正文250字符', structure: '最多5列对比表' },
  { id: 'standard_four_image', name: '标准四图', desc: '4张图+文字', category: '标准A+', specs: '每图220x220px；标题60字符，正文160字符', structure: '4张子图' },
  { id: 'standard_single_image', name: '标准单图', desc: '全宽单图', category: '标准A+', specs: '970x600px；标题160字符，正文6000字符', structure: '单张全宽图' },
];
export const OUTLINE_APLUS_CATEGORIES = Array.from(new Set(OUTLINE_APLUS_MODULES.map((m) => m.category)));

export function findOutlineAplusModule(value?: string) {
  if (!value) return undefined;
  return OUTLINE_APLUS_MODULES.find((m) => m.id === value || m.name === value);
}

export function normalizeAplusModuleStyle(mod: any) {
  const selected = findOutlineAplusModule(mod.selectedModuleType || mod.recommendedModuleType || mod.selectedModuleName);
  return selected ? {
    ...mod,
    selectedModuleType: selected.id,
    selectedModuleName: selected.name,
    selectedModuleCategory: selected.category,
    selectedModuleSpecs: selected.specs,
    selectedModuleStructure: selected.structure,
  } : mod;
}
