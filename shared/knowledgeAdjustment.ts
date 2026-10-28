export const SET_ADJUSTMENT_LABELS: Record<string, string> = {
  setCategory: "类目", setStyle: "风格", setPrimaryColor: "主色", setAccentColor: "提亮色",
};
export const IMAGE_ADJUSTMENT_LABELS: Record<string, string> = {
  tagCategory: "类目",
  tagDesignStyleV2: "风格",
  tagColorSchemeV2: "主色",
  tagAccentColor: "提亮色",
  tagImageBelong: "图片归属",
  tagImageBelongSub: "归属细分",
  tagImageTypeMain: "图片类型",
  tagImageTypeSub: "类型细分",
  tagSellingPointCategory: "卖点",
  tagSellingPointDetail: "卖点细分",
  tagComposition: "构图",
};
export const VIDEO_ADJUSTMENT_LABELS: Record<string, string> = {
  category: "类目",
  style: "风格",
  primaryColor: "主色",
  accentColor: "提亮色",
  type: "视频类型",
  summary: "视频简介",
  segments: "内容时间段",
};
export function adjustmentChanges(
  kind: "set" | "image" | "video",
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) {
  const labels =
    kind === "set" ? SET_ADJUSTMENT_LABELS : kind === "image" ? IMAGE_ADJUSTMENT_LABELS : VIDEO_ADJUSTMENT_LABELS;
  return Object.keys(labels)
    .filter(
      key =>
        JSON.stringify(before?.[key] ?? "") !==
        JSON.stringify(after?.[key] ?? "")
    )
    .map(key => ({
      key,
      label: labels[key],
      before: before?.[key] ?? "",
      after: after?.[key] ?? "",
    }));
}
export type AdjustmentMessage = { role: "user" | "assistant"; text: string };
