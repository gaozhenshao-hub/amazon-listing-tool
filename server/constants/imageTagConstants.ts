/**
 * 图片知识库标签常量定义
 * 基于优化后的标签体系：套图风格结构化参数 + 单图7维标签 + 图片归属分类
 */

// ============ 套图风格（13种 + 结构化参数） ============

export interface StyleParams {
  name: string;
  lightType: string;
  colorTemp: string;
  materialKeywords: string;
  tabooElements: string;
  refBrands: string;
  aiKeywords: string;
  styleFeature?: string; // 风格特点
}

export const IMAGE_STYLES: readonly StyleParams[] = [
  {
    name: "大厂极简风",
    lightType: "柔光箱 + 均匀散射光",
    colorTemp: "5500-6500K（中性偏冷）",
    materialKeywords: "亚克力、磨砂玻璃、铝合金、纯色纸",
    tabooElements: "复杂纹理、花卉、暖木纹",
    refBrands: "Apple、Dyson、Bose、小米",
    aiKeywords: "minimalist product photography, clean white background, soft diffused lighting, premium tech aesthetic, no shadows",
    styleFeature: "线条简洁、色彩克制、大面积留白、高级感质感"
  },
  {
    name: "日系小清新",
    lightType: "自然窗光 + 反光板补光",
    colorTemp: "5000-5500K（自然白）",
    materialKeywords: "棉麻、原木、陶瓷、干花",
    tabooElements: "金属工业感、深色背景、霓虹色",
    refBrands: "MUJI、niko and...、KEYUCA",
    aiKeywords: "japanese minimalist style, natural window light, cotton linen texture, warm neutral tones, airy composition",
    styleFeature: "空气感十足、自然清淡、温柔中性色、極简且有生活温度"
  },
  {
    name: "美式家居温馨风",
    lightType: "暖色台灯 + 自然光混合",
    colorTemp: "3500-4500K（暖白）",
    materialKeywords: "皮革、深色木、铜件、绿植",
    tabooElements: "塑料感、荧光色、极简冷淡",
    refBrands: "Pottery Barn、West Elm、Crate & Barrel",
    aiKeywords: "american cozy home style, warm ambient lighting, leather and wood textures, lived-in comfort, earth tones",
    styleFeature: "暖色调居家气息、层次丰富、居住感强"
  },
  {
    name: "北欧原木治愈风",
    lightType: "大面积柔光 + 侧窗自然光",
    colorTemp: "4500-5500K（自然中性）",
    materialKeywords: "白橡木、羊毛、亚麻、陶土",
    tabooElements: "深色重色、复杂图案、金属反光",
    refBrands: "IKEA、HAY、Marimekko、Ferm Living",
    aiKeywords: "scandinavian design, light oak wood, natural materials, hygge atmosphere, muted pastels, clean lines",
    styleFeature: "自然材质、温和中性色、功能与美感平衡、治愈氛围"
  },
  {
    name: "科技未来感",
    lightType: "RGB灯带 + 点光源 + 硬光",
    colorTemp: "7000-9000K（冷蓝）+ 彩色点缀",
    materialKeywords: "碳纤维、钢化玻璃、LED、金属网格",
    tabooElements: "自然材质、暖色调、田园元素",
    refBrands: "Razer、ROG、Tesla Cybertruck",
    aiKeywords: "cyberpunk tech aesthetic, neon glow, dark background with RGB accents, futuristic, metallic surfaces",
    styleFeature: "高对比、冷色调、RGB点缀、未来科技感、强烈视觉冲击"
  },
  {
    name: "户外探险风",
    lightType: "强烈日光 + 硬阴影",
    colorTemp: "5500-6500K（日光）",
    materialKeywords: "岩石、泥土、帐篷面料、登山绳",
    tabooElements: "室内场景、精致摆拍、柔美元素",
    refBrands: "The North Face、Patagonia、YETI",
    aiKeywords: "outdoor adventure, rugged terrain, harsh natural light, action shot, durable equipment, wilderness backdrop",
    styleFeature: "硬朗光影、真实场景、动态感强、粗狂耐用气质"
  },
  {
    name: "母婴柔和风",
    lightType: "超柔散射光 + 无阴影",
    colorTemp: "4000-5000K（柔和暖白）",
    materialKeywords: "纯棉、硅胶、圆角、马卡龙色",
    tabooElements: "尖锐物、深暗色调、复杂背景",
    refBrands: "Babycare、Hegen、Stokke",
    aiKeywords: "baby safe aesthetic, pastel colors, soft rounded shapes, gentle lighting, cotton textures, nurturing mood",
    styleFeature: "马卡龙色、软圆形、无阴影柔光、安全温柔氛围"
  },
  {
    name: "轻奢高端风",
    lightType: "聚光灯 + 反射面营造光泽",
    colorTemp: "4000-5000K + 金色反射",
    materialKeywords: "大理石、黄铜、丝绒、水晶",
    tabooElements: "塑料、粗糙纹理、过于鲜艳",
    refBrands: "Jo Malone、Diptyque、Aesop",
    aiKeywords: "luxury premium aesthetic, marble and brass, velvet textures, golden accents, sophisticated composition",
    styleFeature: "光泽质感、金属点缀、高级材质层叠、精致构图"
  },
  {
    name: "国潮新中式",
    lightType: "侧光 + 局部聚光",
    colorTemp: "4000-5000K（暖中性）",
    materialKeywords: "宣纸、竹、漆器、祥云纹、水墨",
    tabooElements: "西式花纹、极简工业、荧光色",
    refBrands: "花西子、观夏、茶颜悦色",
    aiKeywords: "chinese modern style, ink wash painting elements, bamboo and lacquer, traditional patterns, cultural fusion",
    styleFeature: "水墨元素、传统纹样、现代中式融合、文化内涵感"
  },
  {
    name: "ins网红风",
    lightType: "golden hour自然光 + 柔焦",
    colorTemp: "4500-5500K（自然偏暖）",
    materialKeywords: "绿植、咖啡、书籍、针织毯",
    tabooElements: "过于商业化、硬光、纯白背景",
    refBrands: "Glossier、Anthropologie、Urban Outfitters",
    aiKeywords: "instagram lifestyle, golden hour light, flat lay composition, aesthetic arrangement, natural props, bokeh",
    styleFeature: "黄金时刻光效、平铺构图、生活方式展示、自然道具点缀"
  },
  {
    name: "工业硬核风",
    lightType: "硬光侧光 + 强对比",
    colorTemp: "5500-7000K（冷白偏蓝）",
    materialKeywords: "水泥、铁件、裸砖、黑色哑光",
    tabooElements: "花卉、柔美曲线、马卡龙色",
    refBrands: "Milwaukee、DeWalt、Makita",
    aiKeywords: "industrial minimalist, concrete and steel, harsh directional light, high contrast, raw materials, utilitarian",
    styleFeature: "硬光侧光、高对比、裸露材质、实用主义气质"
  },
  {
    name: "田园自然风",
    lightType: "自然散射光 + 绿色反射",
    colorTemp: "5000-5500K（自然白）",
    materialKeywords: "牛皮纸、干花、棉布、木托盘",
    tabooElements: "塑料、金属、荧光色、人工感",
    refBrands: "Aesop、The Body Shop、悦木之源",
    aiKeywords: "organic natural style, botanical elements, kraft paper, dried flowers, earth tones, sustainable aesthetic",
    styleFeature: "自然散射光、植物元素、大地色系、环保有机氛围"
  },
  {
    name: "暗黑酷炫风",
    lightType: "单点硬光 + 大面积暗部",
    colorTemp: "6000-8000K（冷调）",
    materialKeywords: "黑色哑光、金属、烟雾、激光",
    tabooElements: "明亮色彩、可爱元素、自然场景",
    refBrands: "GoPro、DJI、Alienware",
    aiKeywords: "dark moody aesthetic, dramatic single light source, smoke effects, metallic highlights, mysterious atmosphere",
    styleFeature: "大面积暗部、单点光源戳亮、烟雾效果、神秘氛围"
  }
] as const;

// 风格名称列表（用于下拉选项）
export const STYLE_NAME_OPTIONS = IMAGE_STYLES.map(s => s.name);

// ============ 图片归属（二级分类） ============

export const IMAGE_BELONG_HIERARCHY = {
  "主图": [] as string[],
  "套图": [] as string[],
  "A+": ["图片轮播", "对比表格", "全宽图", "图文叠加", "四图文", "三图文", "热点交互", "视频模块", "导航轮播", "单图侧文", "技术参数表", "品牌故事卡"],
  "品牌故事": [] as string[],
} as const;

export const IMAGE_BELONG_OPTIONS = Object.keys(IMAGE_BELONG_HIERARCHY) as Array<keyof typeof IMAGE_BELONG_HIERARCHY>;
export type ImageBelong = keyof typeof IMAGE_BELONG_HIERARCHY;

// ============ 图片类型（二级分类） ============

export const IMAGE_TYPE_HIERARCHY = {
  "对比": ["综合对比", "细节对比", "尺寸对比", "参数对比"],
  "细节": ["单一特写", "多细节", "场景加细节"],
  "场景": ["远景", "近景", "多场景"],
  "特效": ["透视", "局部提亮", "原理结构"],
  "必要": ["参数", "尺寸", "适配性", "全家福", "步骤图", "使用说明", "标注（爆炸图）"],
  "品牌": ["A+首图", "品牌故事", "买家秀", "证书-质保", "logo设计"],
} as const;

export const IMAGE_TYPE_MAIN_OPTIONS = Object.keys(IMAGE_TYPE_HIERARCHY) as Array<keyof typeof IMAGE_TYPE_HIERARCHY>;
export type ImageTypeMain = keyof typeof IMAGE_TYPE_HIERARCHY;

// ============ 卖点分类（二级分类） ============

export const SELLING_POINT_HIERARCHY = {
  "质量": ["耐高温低温", "耐磨耐刮耐刺", "防水", "防锈耐腐", "防褪色防光衰", "防雨防晒", "防砸防摔", "寿命长", "质保和认证", "防其他"],
  "功能": ["更快更强更有劲", "更大更小", "更粗更宽更承重", "更静音（环境）", "更多（功能，配件）", "更牛逼"],
  "设计": ["可折叠收缩", "可调节", "可更换（多用途）", "可变形", "可自动（变暗变亮变频）"],
  "操作": ["一键（启动，完成）", "两步（安装，清洁）", "三秒（收纳，充气）", "免维护（Set it, Forget it）"],
  "安全": ["环保", "食品级/可啃咬/EPA", "保护（过载，过热）", "自动（断电，熄火）"],
  "附加值": ["易清洗/打理/维护", "易收纳/便携/移动", "额外用途"],
} as const;

export const SELLING_POINT_MAIN_OPTIONS = Object.keys(SELLING_POINT_HIERARCHY) as Array<keyof typeof SELLING_POINT_HIERARCHY>;
export type SellingPointCategory = keyof typeof SELLING_POINT_HIERARCHY;

// ============ 配色方案 ============

export const COLOR_SCHEME_OPTIONS = [
  "莫兰迪色系", "高饱和撞色", "黑金配色", "大地色系",
  "马卡龙色系", "渐变色系", "纯白极简", "对比撞色",
  "金属色系", "自然绿植色系"
] as const;
export type ColorScheme = typeof COLOR_SCHEME_OPTIONS[number];

// ============ 构图类型 ============

export const COMPOSITION_OPTIONS = [
  "居中构图", "三分法构图", "对角线构图", "模块化构图",
  "二分构图", "环绕构图", "层叠构图", "大面积留白"
] as const;
export type CompositionType = typeof COMPOSITION_OPTIONS[number];

// ============ 产品类目（18种） ============

export const CATEGORY_OPTIONS = [
  "家居", "餐厨", "庭院花园", "房车户外", "泳池",
  "玩具", "个护", "大小家电", "3C数码", "五金工具",
  "家电配件", "母婴（儿童）", "老人", "运动健身",
  "宠物", "工业品", "农业品", "实验室品"
] as const;
export type CategoryType = typeof CATEGORY_OPTIONS[number];

// ============ 颜色标签选项（13种） ============

export const COLOR_TAG_OPTIONS = [
  "红色", "绿色", "蓝色", "黄色", "橙色", "紫色", "金色",
  "浅灰", "深灰", "浅棕", "深棕", "白色", "黑色"
] as const;
export type ColorTag = typeof COLOR_TAG_OPTIONS[number];

// ============ 辅助函数 ============

/**
 * 根据风格名称获取结构化参数
 */
export function getStyleParams(styleName: string): StyleParams | undefined {
  return IMAGE_STYLES.find(s => s.name === styleName);
}

/**
 * 根据图片类型大类获取子类型选项
 */
export function getImageSubTypes(mainType: string): readonly string[] {
  return IMAGE_TYPE_HIERARCHY[mainType as ImageTypeMain] ?? [];
}

/**
 * 根据卖点大类获取子选项
 */
export function getSellingPointDetails(category: string): readonly string[] {
  return SELLING_POINT_HIERARCHY[category as SellingPointCategory] ?? [];
}
