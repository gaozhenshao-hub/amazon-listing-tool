const reasons: Record<string, string> = {
  video_too_large: "视频超过 200MB 下载上限",
  video_timeout: "视频下载超时",
  video_network: "视频连接暂时不可用",
  video_link_unavailable: "视频链接已失效或暂时拒绝访问",
  video_http_error: "视频服务暂时未返回文件",
  video_invalid_file: "取得的文件不是完整 MP4 视频",
  video_poster_failed: "视频已取得，但封面未能生成",
  video_source_unsupported: "视频来源暂不支持直接下载",
  video_storage_failed: "视频保存失败",
  video_unavailable: "历史记录未保存具体原因，可重新采集缺失部分",
  http_error: "图片服务暂时未返回文件",
  invalid_image: "取得的内容无法解码为图片",
  storage_failed: "图片保存失败",
  download_failed: "图片下载未完成",
};
export const collectionFailureText = (reason: unknown) =>
  typeof reason === "string" ? reasons[reason] || "素材下载未完成" : null;
