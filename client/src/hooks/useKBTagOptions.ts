import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Hook that fetches KB image tag options from the database (kbTags Router)
 * and provides them in the same format as the old hardcoded constants.
 * Falls back to hardcoded defaults if no database tags are available.
 */

// Hardcoded fallbacks (used when DB has no tags yet)
const FALLBACK_CATEGORY = ["家居","餐厨","庭院花园","房车户外","泳池","玩具","个护","大小家电","3C数码","五金工具","家电配件","母婴（儿童）","老人","运动健身","宠物","工业品","农业品","实验室品"];
const FALLBACK_COLOR = ["红色","绿色","蓝色","黄色","橙色","紫色","金色","浅灰","深灰","浅棕","深棕","白色","黑色"];
const FALLBACK_IMAGE_BELONG = ["主图", "套图", "A+", "品牌故事"];
const FALLBACK_COMPOSITION = ["居中构图", "三分法构图", "对角线构图", "模块化构图", "二分构图", "环绕构图", "层叠构图", "大面积留白"];
const FALLBACK_STYLE = ["大厂极简风","日系小清新","美式家居温馨风","北欧原木治愈风","户外探险风","科技未来感","轻奢高端风","工业硬核风","ins网红风","母婴柔和风","国潮新中式","暗黑酷炫风","田园自然风"];
const FALLBACK_IMAGE_TYPE_HIERARCHY: Record<string, string[]> = {
  "对比": ["综合对比", "细节对比", "尺寸对比", "参数对比"],
  "细节": ["单一特写", "多细节", "场景加细节"],
  "场景": ["远景", "近景", "多场景"],
  "特效": ["透视", "局部提亮", "原理结构"],
  "必要": ["参数", "尺寸", "适配性", "全家福", "步骤图", "使用说明", "标注（爆炸图）"],
  "品牌": ["A+首图", "品牌故事", "买家秀", "证书-质保", "logo设计"],
};
const FALLBACK_SELLING_POINT_HIERARCHY: Record<string, string[]> = {
  "质量": ["耐高温低温", "耐磨耐刮耐刺", "防水", "防锈耐腐", "防褪色防光衰", "防雨防晒", "防砸防摔", "寿命长", "质保和认证", "防其他"],
  "功能": ["更快更强更有劲", "更大更小", "更粗更宽更承重", "更静音（环境）", "更多（功能，配件）", "更牛逼"],
  "设计": ["可折叠收缩", "可调节", "可更换（多用途）", "可变形", "可自动（变暗变亮变频）"],
  "操作": ["一键（启动，完成）", "两步（安装，清洁）", "三秒（收纳，充气）", "免维护（Set it, Forget it）"],
  "安全": ["环保", "食品级/可啃咬/EPA", "保护（过载，过热）", "自动（断电，熄火）"],
  "附加值": ["易清洗/打理/维护", "易收纳/便携/移动", "额外用途"],
};

interface TagOptions {
  categoryOptions: string[];
  colorOptions: string[];
  imageBelongOptions: string[];
  compositionOptions: string[];
  styleOptions: string[];
  imageTypeHierarchy: Record<string, string[]>;
  imageTypeMainOptions: string[];
  sellingPointHierarchy: Record<string, string[]>;
  sellingPointMainOptions: string[];
  isLoading: boolean;
  isFromDb: boolean;
}

export function useKBTagOptions(): TagOptions {
  // Fetch all dimensions in parallel
  const { data: categoryTags, isLoading: catLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: "category" },
    { staleTime: 5 * 60 * 1000 } // Cache for 5 minutes
  );
  const { data: colorTags, isLoading: colorLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: "color" },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: imageBelongTags, isLoading: belongLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: "imageBelong" },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: compositionTags, isLoading: compLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: "composition" },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: styleTags, isLoading: styleLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: "style" },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: imageTypeTags, isLoading: typeLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: "imageType" },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: sellingPointTags, isLoading: spLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: "sellingPoint" },
    { staleTime: 5 * 60 * 1000 }
  );

  const isLoading = catLoading || colorLoading || belongLoading || compLoading || styleLoading || typeLoading || spLoading;

  // Build flat option arrays from DB tags, with fallback to hardcoded
  const categoryOptions = useMemo(() => {
    if (!categoryTags || categoryTags.length === 0) return FALLBACK_CATEGORY;
    return categoryTags.map(t => t.value);
  }, [categoryTags]);

  const colorOptions = useMemo(() => {
    if (!colorTags || colorTags.length === 0) return FALLBACK_COLOR;
    return colorTags.map(t => t.value);
  }, [colorTags]);

  const imageBelongOptions = useMemo(() => {
    if (!imageBelongTags || imageBelongTags.length === 0) return FALLBACK_IMAGE_BELONG;
    return imageBelongTags.map(t => t.value);
  }, [imageBelongTags]);

  const compositionOptions = useMemo(() => {
    if (!compositionTags || compositionTags.length === 0) return FALLBACK_COMPOSITION;
    return compositionTags.map(t => t.value);
  }, [compositionTags]);

  const styleOptions = useMemo(() => {
    if (!styleTags || styleTags.length === 0) return FALLBACK_STYLE;
    return styleTags.map(t => t.value);
  }, [styleTags]);

  // Build hierarchical options for imageType
  const { imageTypeHierarchy, imageTypeMainOptions } = useMemo(() => {
    if (!imageTypeTags || imageTypeTags.length === 0) {
      return {
        imageTypeHierarchy: FALLBACK_IMAGE_TYPE_HIERARCHY,
        imageTypeMainOptions: Object.keys(FALLBACK_IMAGE_TYPE_HIERARCHY),
      };
    }
    // Parents have no parentValue, children have parentValue
    const parents = imageTypeTags.filter(t => !t.parentValue);
    const hierarchy: Record<string, string[]> = {};
    parents.forEach(p => {
      hierarchy[p.value] = imageTypeTags
        .filter(t => t.parentValue === p.value)
        .map(t => t.value);
    });
    return {
      imageTypeHierarchy: hierarchy,
      imageTypeMainOptions: parents.map(p => p.value),
    };
  }, [imageTypeTags]);

  // Build hierarchical options for sellingPoint
  const { sellingPointHierarchy, sellingPointMainOptions } = useMemo(() => {
    if (!sellingPointTags || sellingPointTags.length === 0) {
      return {
        sellingPointHierarchy: FALLBACK_SELLING_POINT_HIERARCHY,
        sellingPointMainOptions: Object.keys(FALLBACK_SELLING_POINT_HIERARCHY),
      };
    }
    const parents = sellingPointTags.filter(t => !t.parentValue);
    const hierarchy: Record<string, string[]> = {};
    parents.forEach(p => {
      hierarchy[p.value] = sellingPointTags
        .filter(t => t.parentValue === p.value)
        .map(t => t.value);
    });
    return {
      sellingPointHierarchy: hierarchy,
      sellingPointMainOptions: parents.map(p => p.value),
    };
  }, [sellingPointTags]);

  // Determine if data is from DB (at least one dimension has DB tags)
  const isFromDb = !!(
    (categoryTags && categoryTags.length > 0) ||
    (colorTags && colorTags.length > 0) ||
    (styleTags && styleTags.length > 0)
  );

  return {
    categoryOptions,
    colorOptions,
    imageBelongOptions,
    compositionOptions,
    styleOptions,
    imageTypeHierarchy,
    imageTypeMainOptions,
    sellingPointHierarchy,
    sellingPointMainOptions,
    isLoading,
    isFromDb,
  };
}
