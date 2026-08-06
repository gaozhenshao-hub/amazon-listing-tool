export interface ListingAgentRunSummary {
  runId: string;
  agentName?: string | null;
  status?: string | null;
  currentNodeId?: string | null;
  progress?: number | string | null;
  templateVersion?: string | null;
  inputs?: unknown;
  startedAt?: string | Date | null;
  createdAt?: string | Date | null;
}

export interface ListingAgentRunPresentation {
  primary: string;
  secondary: string;
  fullRunId: string;
}

const RUN_STATUS_LABELS: Record<string, string> = {
  running: "执行中",
  waiting_human: "待确认",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
};

function parseInputs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function formatRunTime(value?: string | Date | null): string {
  if (!value) return "时间未知";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function shortRunId(runId: string): string {
  const suffix = runId.split("_").filter(Boolean).at(-1);
  return suffix ? `#${suffix}` : `#${runId.slice(-6)}`;
}

export function buildListingAgentRunPresentation(
  run: ListingAgentRunSummary,
  fallbackProjectName?: string | null,
): ListingAgentRunPresentation {
  const inputs = parseInputs(run.inputs);
  const projectName = typeof inputs.projectName === "string" && inputs.projectName.trim()
    ? inputs.projectName.trim()
    : fallbackProjectName?.trim() || run.agentName?.trim() || "Listing 工作流";
  const status = RUN_STATUS_LABELS[run.status || ""] || run.status || "状态未知";
  const progress = Number(run.progress);
  const position = run.currentNodeId
    ? `当前 ${run.currentNodeId}`
    : Number.isFinite(progress)
      ? `进度 ${Math.max(0, Math.min(100, Math.round(progress)))}%`
      : "尚未开始";
  const version = run.templateVersion ? `模板 ${run.templateVersion}` : null;

  return {
    primary: `${projectName} · ${formatRunTime(run.startedAt || run.createdAt)}`,
    secondary: [status, position, version, shortRunId(run.runId)].filter(Boolean).join(" · "),
    fullRunId: run.runId,
  };
}
