/**
 * 图片知识库标签常量定义
 * 基于优化后的标签体系：套图风格结构化参数 + 单图7维标签 + 图片归属分类
 */

// ============ 套图风格（15种 + 结构化参数） ============

export interface StyleParams {
  name: string;
  lightType: string;
  colorTemp: string;
  materialKeywords: string;
  colorTone: string;        // 色调
  tabooElements: string;
  refBrands: string;
  aiKeywords: string;
  styleFeature?: string;    // 风格特点
}

export const IMAGE_STYLES: readonly StyleParams[] = [
  {
    name: "大厂工业极简风",
    lightType: "柔光箱 + 均匀散射光",
    colorTemp: "5500-6500K（中性偏冷）",
    materialKeywords: "亚克力、磨砂玻璃、铝合金、纯色纸",
    colorTone: "白、灰、黑、科技蓝",
    tabooElements: "复杂纹理、花卉、暖木纹、杂乱生活元素",
    refBrands: "Apple、Dyson、Bose、Xiaomi",
    aiKeywords: "minimalist product photography, clean white background, soft diffused lighting, premium tech aesthetic, acrylic display, industrial minimalism",
    styleFeature: "极简、专业、高级、科技感、产品至上"
  },
  {
    name: "现代都市风",
    lightType: "大面积自然光 + 落地窗漫射光",
    colorTemp: "5200-6000K",
    materialKeywords: "大理石、岩板、不锈钢、玻璃、黑钛金属",
    colorTone: "黑、白、灰、石材色",
    tabooElements: "原木乡村风、复古家具、碎花、过多暖色",
    refBrands: "Joseph Joseph、simplehuman、Miele、Bosch Home Appliances",
    aiKeywords: "modern contemporary home, luxury apartment, marble countertop, stainless steel kitchen, floor-to-ceiling window, premium lifestyle",
    styleFeature: "都市、高级住宅、现代厨房、品质生活"
  },
  {
    name: "大胆图形风",
    lightType: "均匀棚拍光",
    colorTemp: "5500K",
    materialKeywords: "纯色色块、几何图形、平面背景",
    colorTone: "高饱和撞色（黄、蓝、红、橙、绿）",
    tabooElements: "复杂场景、纹理过多、低对比度",
    refBrands: "Liquid I.V.、Native、Method",
    aiKeywords: "bold graphic design, colorful blocks, oversized typography, modern commercial layout, geometric shapes, vibrant branding",
    styleFeature: "强营销、信息优先、视觉冲击、品牌设计感"
  },
  {
    name: "美式复古风",
    lightType: "暖色侧光 + 环境光",
    colorTemp: "2800-3500K",
    materialKeywords: "深色木材、皮革、黄铜、铸铁",
    colorTone: "深棕、焦糖、酒红、墨绿",
    tabooElements: "RGB灯、科技蓝、大面积纯白",
    refBrands: "Le Creuset、Fellow",
    aiKeywords: "vintage kitchen, rustic wood table, warm lighting, leather texture, heritage aesthetic, premium cookware",
    styleFeature: "经典、质感、怀旧、手工感"
  },
  {
    name: "北欧原木风",
    lightType: "柔和自然光",
    colorTemp: "5000-5600K",
    materialKeywords: "原木、棉麻、陶瓷、绿植",
    colorTone: "米白、浅木色、浅灰、鼠尾草绿",
    tabooElements: "黑金轻奢、高饱和撞色、工业风",
    refBrands: "IKEA、ferm LIVING",
    aiKeywords: "scandinavian home, oak wood, linen fabric, soft daylight, minimalist nordic interior",
    styleFeature: "自然、治愈、简洁、舒适"
  },
  {
    name: "温馨家居风",
    lightType: "暖色自然光 + 室内灯光",
    colorTemp: "3500-4500K",
    materialKeywords: "布艺、木材、棉织物、陶瓷",
    colorTone: "奶油色、暖木色、米白",
    tabooElements: "冷灰空间、工业感、科技感",
    refBrands: "Pottery Barn",
    aiKeywords: "cozy family home, warm kitchen, natural lifestyle, soft lighting, comfortable living",
    styleFeature: "家庭感、真实生活、温暖陪伴"
  },
  {
    name: "INS生活风",
    lightType: "明亮自然光",
    colorTemp: "5200-5800K",
    materialKeywords: "奶油背景、玻璃、陶瓷、亚克力",
    colorTone: "奶油白、浅粉、浅灰、莫兰迪色",
    tabooElements: "深色木纹、重工业风",
    refBrands: "Our Place",
    aiKeywords: "instagram aesthetic, cream palette, soft lifestyle, clean composition, cozy minimal",
    styleFeature: "年轻、精致、轻生活、社交媒体感"
  },
  {
    name: "轻奢高级风",
    lightType: "柔和聚光 + 环境补光",
    colorTemp: "4000-5000K",
    materialKeywords: "大理石、黄铜、水晶、丝绒",
    colorTone: "香槟金、象牙白、墨绿、酒红",
    tabooElements: "卡通元素、高饱和撞色",
    refBrands: "Jo Malone London、Tom Dixon",
    aiKeywords: "luxury interior, marble texture, brass accents, elegant styling, premium aesthetic",
    styleFeature: "精致、优雅、高端、品质感"
  },
  {
    name: "运动活力风",
    lightType: "户外阳光 + 高反差光影",
    colorTemp: "5500-6500K",
    materialKeywords: "草坪、塑胶跑道、运动场地",
    colorTone: "蓝、白、绿",
    tabooElements: "昏暗灯光、静态摆拍",
    refBrands: "Nike、Wilson Sporting Goods",
    aiKeywords: "sports lifestyle, sunny outdoor court, dynamic action, energetic atmosphere, fitness branding",
    styleFeature: "阳光、活力、速度、激情"
  },
  {
    name: "健康生活风",
    lightType: "晨光自然光",
    colorTemp: "4800-5600K",
    materialKeywords: "原木、瑜伽垫、绿植、亚麻",
    colorTone: "白、浅绿、米色",
    tabooElements: "暗黑灯光、工业空间",
    refBrands: "Lululemon、Therabody",
    aiKeywords: "wellness lifestyle, yoga home, morning sunlight, healthy living, calm aesthetic",
    styleFeature: "放松、自律、健康、治愈"
  },
  {
    name: "户外探险风",
    lightType: "自然阳光、日落光",
    colorTemp: "5000-6500K",
    materialKeywords: "木材、岩石、帐篷布、金属",
    colorTone: "军绿、卡其、棕色",
    tabooElements: "城市室内、高级公寓",
    refBrands: "Snow Peak、Coleman",
    aiKeywords: "camping lifestyle, mountain landscape, outdoor adventure, forest, sunset, exploration",
    styleFeature: "自由、探索、自然、户外精神"
  },
  {
    name: "庭院休闲风",
    lightType: "下午自然光 + 黄金时刻",
    colorTemp: "4500-5500K",
    materialKeywords: "木平台、藤编、草坪、户外织物",
    colorTone: "木色、绿色、米白",
    tabooElements: "商业办公空间、工业风",
    refBrands: "POLYWOOD",
    aiKeywords: "backyard patio, outdoor furniture, family gathering, garden lifestyle, wooden deck",
    styleFeature: "后院生活、聚会、休闲、家庭娱乐"
  },
  {
    name: "亲和童趣风",
    lightType: "柔和自然光",
    colorTemp: "5000-5600K",
    materialKeywords: "硅胶、木材、布艺、插画元素",
    colorTone: "奶油白、浅黄、浅蓝、牛油果绿、珊瑚色",
    tabooElements: "暗黑风、重金属风、复杂纹理",
    refBrands: "Mushie、Wild One、Munchkin",
    aiKeywords: "cute lifestyle, pastel colors, friendly illustration, rounded design, playful branding, soft lighting",
    styleFeature: "温馨、可爱、治愈、亲和、安全"
  },
  {
    name: "工业硬核风",
    lightType: "定向硬光 + 侧逆光",
    colorTemp: "4500-5500K",
    materialKeywords: "钢材、水泥、机械、铁锈、金属",
    colorTone: "黑、深灰、工业黄",
    tabooElements: "花卉、奶油色、治愈风",
    refBrands: "Milwaukee Tool、DEWALT",
    aiKeywords: "industrial workshop, concrete wall, heavy duty tools, dramatic lighting, rugged metal texture",
    styleFeature: "力量、耐用、专业、机械感"
  },
  {
    name: "赛博科技风",
    lightType: "RGB霓虹灯 + 背光 + 边缘轮廓光",
    colorTemp: "7000-10000K（冷色调）",
    materialKeywords: "碳纤维、钢化玻璃、RGB灯带、金属网格",
    colorTone: "黑、霓虹紫、电光蓝、青色、荧光绿",
    tabooElements: "原木、暖黄灯、乡村元素、复古家具",
    refBrands: "Razer、ASUS Republic of Gamers、Corsair、SteelSeries",
    aiKeywords: "cyber gaming setup, RGB lighting, neon glow, futuristic gaming room, black aesthetic, cyberpunk atmosphere",
    styleFeature: "暗黑、霓虹、电竞、沉浸、未来感"
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
