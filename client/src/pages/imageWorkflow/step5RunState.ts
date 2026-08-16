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
