export const COMPETITOR_CONSUMERS = ["project_competitor", "image_workflow"] as const;
export function competitorProjectId(type: string, ref: string): number | null {
  const match = type === "project_competitor" ? /^project-competitor:(\d+):/.exec(ref)
    : type === "image_workflow" ? /^project:(\d+):competitor-gallery$/.exec(ref) : null;
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}
export function acquisitionFailureMessage(category?: string | null) {
  const messages: Record<string, string> = {
    provider_blocked_suspected: "亚马逊返回验证码或访问限制，未取得商品数据。请稍后在抓取结果中重试，已采到的其他商品资料会保留。",
    request_timeout: "访问亚马逊超时，请稍后重试。",
    rate_limited: "亚马逊暂时限制请求频率，请稍后重试。",
    permission_denied: "亚马逊拒绝此次访问。",
    normalization_failed: "返回页面缺少可识别的商品信息或图片。",
    provider_unavailable: "采集服务暂时不可用。",
  };
  return messages[category || ""] || "采集未完成，请稍后重试。";
}
