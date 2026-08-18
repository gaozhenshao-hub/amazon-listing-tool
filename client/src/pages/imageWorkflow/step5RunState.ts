export function isActiveStep5RunStatus(status?: string | null) {
  return status === "queued" || status === "running";
}

/**
 * 仅将queued/running状态的会话runId作为当前任务追踪对象。
 * failed/canceled的runId是历史诊断记录，不能覆盖用户刚发起的新任务。
 */
export function resolveCurrentStep5RunId(input: {
  activeRunId?: string | null;
  sessionRunId?: string | null;
  sessionRunStatus?: string | null;
}) {
  if (input.activeRunId) return input.activeRunId;
  return isActiveStep5RunStatus(input.sessionRunStatus) ? input.sessionRunId || null : null;
}

export type Step5SegmentState = "pending" | "running" | "complete";

export const STEP5_SEGMENT_PROGRESS = [
  { key: "main", label: "主图", start: 30, complete: 55 },
  { key: "secondary", label: "辅图 2–7", start: 30, complete: 55 },
  { key: "aplus", label: "A+ 1–7", start: 65, complete: 82 },
  { key: "brand", label: "品牌故事", start: 65, complete: 82 },
  { key: "merge", label: "合并与保存", start: 90, complete: 100 },
] as const;

export function buildStep5SegmentStates(progress: number) {
  return STEP5_SEGMENT_PROGRESS.map((segment) => ({
    ...segment,
    status: (progress >= segment.complete ? "complete" : progress >= segment.start ? "running" : "pending") as Step5SegmentState,
  }));
}

export function getStep5SegmentPresentation(rawStatus?: string | null) {
  const status = String(rawStatus || "pending");
  if (status === "complete" || status === "succeeded") {
    return { label: "已完成", icon: "✓", tone: "success" as const };
  }
  if (status === "failed") return { label: "失败", icon: "!", tone: "failure" as const };
  if (status === "fallback") return { label: "已回退", icon: "↳", tone: "fallback" as const };
  if (status === "running") return { label: "生成中", icon: "●", tone: "running" as const };
  return { label: "待执行", icon: "○", tone: "pending" as const };
}

export function getStep5FailurePresentation(input: {
  failedGroup?: string | null;
  failedModule?: string | null;
  error?: string | null;
}) {
  const failedGroup = String(input.failedGroup || "").trim();
  const failedModule = String(input.failedModule || "").trim();
  const error = String(input.error || "");
  const groupLabel = failedGroup === "aplus"
    ? "A+模块"
    : failedGroup === "brand_story"
      ? "品牌故事"
      : failedGroup === "main"
        ? "主图"
        : failedGroup === "secondary"
          ? "辅图"
          : failedGroup || "未识别";
  const moduleLabel = failedModule || (failedGroup ? groupLabel : (/a\+|品牌故事/i.test(error)
    ? "A+模块或品牌故事"
    : /主图|辅图/i.test(error)
      ? "主图或辅图"
      : null));
  return {
    shouldShow: Boolean(failedGroup || moduleLabel),
    groupLabel,
    moduleLabel,
  };
}
