export function competitorAcquisitionStatus(status: string, captureOnly: boolean) {
  switch (status) {
    case "collected": return { failed: false, title: "竞品资料已保存，待选择分析", description: "到竞品信息页选择已保存的资料，再明确开始分析；本地上传仅用于补充。" };
    case "direct_ingestion_pending": return { failed: false, title: "采集任务已受理，尚未完成", description: captureOnly ? "安全校验通过后资料将进入竞品列表，不会自动调用分析模型。" : "请在采集任务中心查看进度；当前尚不能确认 AI 分析已排队。" };
    case "analysis_queued": return { failed: false, title: "竞品分析已排队", description: "采集资料已安全保存，请查看后台任务进度。" };
    case "analysis_queue_failed": return { failed: true, title: "资料已保存，但分析排队失败", description: "请检查后台任务状态，不要重复提交采集。" };
    default: return { failed: false, title: "采集状态已返回，分析状态待核对", description: "请在采集任务中心核对记录；此提示不代表分析已经开始或完成。" };
  }
}
