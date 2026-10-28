import { COMPOSITION_GUIDANCE } from "../../../shared/imageTagConstants";
import { CATEGORY_OPTIONS, IMAGE_TYPE_HIERARCHY, SELLING_POINT_HIERARCHY, IMAGE_BELONG_OPTIONS, IMAGE_BELONG_HIERARCHY, IMAGE_TYPE_MAIN_OPTIONS, SELLING_POINT_MAIN_OPTIONS, COLOR_TAG_OPTIONS, COMPOSITION_OPTIONS, STYLE_NAME_OPTIONS } from "../../constants/imageTagConstants";
/**
 * Build the upgraded single-image analysis prompt with 7-dimension constrained enum tags
 */
export function buildSingleImageAnalysisPrompt(): string {
  const imageTypeOptions = Object.entries(IMAGE_TYPE_HIERARCHY)
    .map(([k, v]) => `${k}: [${(v as readonly string[]).join(", ")}]`).join("; ");
  const sellingPointOptions = Object.entries(SELLING_POINT_HIERARCHY)
    .map(([k, v]) => `${k}: [${(v as readonly string[]).join(", ")}]`).join("; ");

  return `你是一位资深的亚马逊产品图片分析专家。请从以下12个维度分析这张产品图片：
1. 构图与布局 2. 色彩搭配 3. 产品展示角度 4. 场景化程度 5. 文字/信息图层
6. 品牌一致性 7. 目标受众匹配度 8. 情感传达 9. 技术质量 10. 差异化程度
11. 转化驱动力 12. 合规性

同时请为图片打上以下标签（必须从给定选项中选择）：

【产品类目】从以下选项中选一个：${CATEGORY_OPTIONS.join("、")}，填入tagCategory。
【图片归属】按输入提供的图片位置选择：${IMAGE_BELONG_OPTIONS.join("、")}。归属细分由采集页面的模块结构确定，不能从单张图片猜测轮播、对比表格等布局；tagImageBelongSub 返回空字符串，系统保留已采集的模块类型。
【图片类型-大类】从以下选项中选一个：${IMAGE_TYPE_MAIN_OPTIONS.join("、")}
【图片类型-子类】根据大类选择对应子类型：${imageTypeOptions}
【卖点分类-大类】从以下选项中选一个：${SELLING_POINT_MAIN_OPTIONS.join("、")}（如果图片没有明确卖点可留空）
【卖点分类-子类】根据大类选择对应子选项：${sellingPointOptions}
【主颜色】从以下颜色中选一个：${COLOR_TAG_OPTIONS.join("、")}
【构图类型】从以下选项中选一个：${COMPOSITION_OPTIONS.join("、")}
${COMPOSITION_GUIDANCE}
【设计风格】从以下选项中选一个：${STYLE_NAME_OPTIONS.join("、")}

返回JSON：
{
  "dimensions": {
    "composition": {"score": 8, "comment": ""},
    "colorScheme": {"score": 8, "comment": ""},
    "productAngle": {"score": 8, "comment": ""},
    "sceneSetting": {"score": 7, "comment": ""},
    "textOverlay": {"score": 7, "comment": ""},
    "brandConsistency": {"score": 8, "comment": ""},
    "audienceMatch": {"score": 8, "comment": ""},
    "emotionalImpact": {"score": 7, "comment": ""},
    "technicalQuality": {"score": 8, "comment": ""},
    "differentiation": {"score": 7, "comment": ""},
    "conversionPower": {"score": 8, "comment": ""},
    "compliance": {"score": 9, "comment": ""}
  },
  "tagCategory": "产品类目",
  "tagColorScheme": "配色方案（旧字段兼容）",
  "tagImageType": "图片类型（旧字段兼容）",
  "tagDesignStyle": "设计风格（旧字段兼容）",
  "tagImageBelong": "图片归属",
  "tagImageBelongSub": "",
  "tagImageTypeMain": "图片类型大类",
  "tagImageTypeSub": "图片类型子类",
  "tagSellingPointCategory": "卖点大类（可为空字符串）",
  "tagSellingPointDetail": "卖点子类（可为空字符串）",
  "tagComposition": "构图类型",
  "tagColorSchemeV2": "主颜色",
  "tagDesignStyleV2": "设计风格",
  "highlights": ["亮点1", "亮点2"],
  "singleImageScore": 8,
  "summary": "一句话总结"
}`;
}

