import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  ChevronRight,
  Loader2,
  Zap,
  RefreshCw,
  Code2,
  FileText,
  Activity,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

interface RunRecord {
  id: number;
  runId: string;
  skillSlug: string;
  skillName: string;
  skillVersion?: number;
  skillPromptHash?: string;
  skillManifestHash?: string;
  migrationSource?: string;
  status: string;
  modelSlug?: string;
  provider?: string;
  model?: string;
  output?: string;
  errorMessage: string | null;
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  durationMs: number;
  costCents?: number;
  createdAt: string | Date;
  userId: number;
  userName?: string;
}

type DetailTab = "output" | "input" | "meta";

export default function EmperorTrace() {
  const { user } = useAuth();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [detailTab, setDetailTab] = useState<DetailTab>("output");

  const { data, isLoading, refetch } = trpc.emperor.run.history.useQuery({
    page,
    pageSize: 50,
  });

  const { data: detail, isLoading: detailLoading } = trpc.emperor.run.getDetail.useQuery(
    { runId: selectedRunId! },
    { enabled: !!selectedRunId }
  );
  const isGovernanceAdmin = user?.role === "admin" || user?.role === "super_admin";
  const verifiedTraceId = typeof (detail as any)?.traceId === "string" ? String((detail as any).traceId) : null;
  const projection = trpc.emperor.observability.runProjection.useQuery(
    { traceId: verifiedTraceId || "", afterId: 0, limit: 100 },
    { enabled: Boolean(isGovernanceAdmin && verifiedTraceId), refetchInterval: 10_000, refetchOnWindowFocus: false },
  );
  const slo = trpc.emperor.observability.slo.useQuery(
    { days: 30 },
    { enabled: isGovernanceAdmin, refetchInterval: 60_000, refetchOnWindowFocus: false },
  );

  const runs = useMemo(() => (data?.runs || []) as RunRecord[], [data?.runs]);
  const selectedRun = runs.find(r => r.runId === selectedRunId) || null;

  useEffect(() => {
    const requestedRunId = new URLSearchParams(window.location.search).get("runId");
    if (requestedRunId && runs.some((run) => run.runId === requestedRunId)) {
      setSelectedRunId(requestedRunId);
      setDetailTab("output");
    }
  }, [runs]);

  const formatTime = (ts: string | Date) => {
    try {
      return format(new Date(ts), "MM-dd HH:mm:ss", { locale: zhCN });
    } catch {
      return String(ts);
    }
  };

  const formatDuration = (ms: number) => {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getModelName = (run: RunRecord) => run.modelSlug || run.model || "-";
  const getPromptTokens = (run: RunRecord) => run.inputTokens || run.promptTokens || 0;
  const getCompletionTokens = (run: RunRecord) => run.outputTokens || run.completionTokens || 0;
  const isSucceeded = (status: string) => status === "succeeded" || status === "success";
  const ledgerEvents = projection.data?.events || [];
  const invalidatedSources = (projection.data?.provenance || []).filter((source: any) => source.status === "invalidated");

  const renderGovernanceProjection = () => {
    if (!isGovernanceAdmin) return null;
    return (
      <div className="space-y-3 border-b bg-slate-50/70 p-4">
        <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-violet-600" /><p className="text-sm font-semibold">受控运行投影与真实评测 SLO</p><Badge variant="outline" className="text-[10px]">只读</Badge></div>
        <div className="grid gap-2 md:grid-cols-3">
          {slo.data?.signals?.map((signal: any) => {
            const insufficient = signal.status === "insufficient_data";
            const breached = signal.status === "breached";
            return <div key={signal.key} className={`rounded-lg border p-2.5 ${breached ? "border-rose-200 bg-rose-50" : insufficient ? "border-slate-200 bg-white" : "border-emerald-200 bg-emerald-50/60"}`}>
              <p className="text-[11px] text-muted-foreground">{signal.name}</p>
              <p className="mt-1 text-sm font-semibold">{insufficient ? "暂无样本" : `${Number(signal.observed).toFixed(1)}${signal.key.includes("rate") ? "%" : ""}`}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">样本 {signal.samples} · 目标 {signal.comparator === "gte" ? "≥" : "≤"}{signal.target}{signal.key.includes("rate") ? "%" : ""}</p>
            </div>;
          }) || <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-muted-foreground md:col-span-3">暂无可展示的真实评测 SLO 数据。</div>}
        </div>
        {verifiedTraceId ? <details className="rounded-lg border border-slate-200 bg-white p-3" open={invalidatedSources.length > 0}>
          <summary className="cursor-pointer text-xs font-medium text-slate-700">Ledger 只读投影 · Trace {verifiedTraceId} · 游标 {projection.data?.nextCursor ?? 0}</summary>
          {invalidatedSources.length > 0 ? <div className="mt-2 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />存在 {invalidatedSources.length} 个已失效上下文来源。系统不会自动恢复；请重新编译上下文并再次人工确认。</div> : null}
          <div className="mt-2 space-y-1.5">{ledgerEvents.length ? ledgerEvents.slice(-12).map((event: any) => <div key={event.eventId} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1.5 text-[11px]"><span className="font-mono text-slate-700">{event.eventType}</span><span className="shrink-0 text-slate-400">{formatTime(event.occurredAt)}</span></div>) : <p className="text-xs text-muted-foreground">暂无已审计事件；投影仅从 Run Ledger 读取，10 秒轮询一次。</p>}</div>
        </details> : <div className="flex gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-muted-foreground"><ShieldAlert className="h-4 w-4 shrink-0" />当前运行没有唯一可验证的Trace映射，因此不展示Ledger投影，避免错误关联。</div>}
      </div>
    );
  };

  const renderDetailOutput = () => {
    if (detailLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (!detail) {
      return (
        <div className="text-sm text-muted-foreground text-center py-12">
          加载详情失败
        </div>
      );
    }

    if (detailTab === "output") {
      const outputText = typeof detail.output === "string"
        ? detail.output
        : JSON.stringify(detail.output, null, 2);
      return detail.status === "failed" ? (
        <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg p-4">
          {detail.errorMessage || "运行失败"}
        </div>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
          <Streamdown>{outputText}</Streamdown>
        </div>
      );
    }

    if (detailTab === "input") {
      const inputData = detail.input;
      if (!inputData) return <p className="text-sm text-muted-foreground py-4">无输入数据</p>;
      const inputText = typeof inputData === "string" ? inputData : JSON.stringify(inputData, null, 2);
      return (
        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-auto whitespace-pre-wrap break-words font-mono">
          {inputText}
        </pre>
      );
    }

    if (detailTab === "meta") {
      return (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Skill Slug", value: detail.skillSlug },
              { label: "Skill 版本", value: detail.skillVersion ? `v${detail.skillVersion}` : "-" },
              { label: "模型", value: getModelName(detail as RunRecord) },
              { label: "Provider", value: detail.provider || "-" },
              { label: "状态", value: detail.status },
              { label: "开始时间", value: detail.startedAt ? formatTime(detail.startedAt as string) : "-" },
              { label: "完成时间", value: detail.completedAt ? formatTime(detail.completedAt as string) : "-" },
              { label: "耗时", value: formatDuration(detail.durationMs) },
              { label: "成本", value: `$${(Number(detail.costCents || 0) / 100).toFixed(4)}` },
              { label: "迁移来源", value: detail.migrationSource || "-" },
              { label: "Prompt Hash", value: detail.skillPromptHash || "-" },
              { label: "Manifest Hash", value: detail.skillManifestHash || "-" },
              { label: "Prompt Tokens", value: String(getPromptTokens(detail as RunRecord)) },
              { label: "Completion Tokens", value: String(getCompletionTokens(detail as RunRecord)) },
              { label: "总 Tokens", value: String(getPromptTokens(detail as RunRecord) + getCompletionTokens(detail as RunRecord)) },
            ].map(item => (
              <div key={item.label} className="bg-muted/30 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                <p className="font-mono text-xs break-all">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex h-[calc(100vh-56px)]">
        {/* Left: Run list */}
        <div className="w-80 flex-shrink-0 border-r flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h1 className="font-semibold">运行历史</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Skill 调用记录与详情</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Zap className="h-8 w-8 mb-3 opacity-20" />
                <p className="text-sm">暂无运行记录</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {runs.map(run => (
                  <button
                    key={run.runId}
                    onClick={() => {
                      setSelectedRunId(run.runId);
                      setDetailTab("output");
                    }}
                    className={cn(
                      "w-full text-left p-3 rounded-lg transition-colors",
                      selectedRunId === run.runId
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {isSucceeded(run.status) ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                      )}
                      <span className="font-medium text-sm truncate">{run.skillName || run.skillSlug}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(run.createdAt)}
                      </span>
                      {run.durationMs > 0 && (
                        <span>{formatDuration(run.durationMs)}</span>
                      )}
                      {(getPromptTokens(run) + getCompletionTokens(run)) > 0 && (
                        <span className="flex items-center gap-1">
                          <Cpu className="h-3 w-3" />
                          {getPromptTokens(run) + getCompletionTokens(run)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {run.skillVersion ? `v${run.skillVersion} · ` : ""}{getModelName(run)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Pagination */}
          <div className="p-3 border-t flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              上一页
            </Button>
            <span className="text-xs text-muted-foreground">第 {page} 页</span>
            <Button
              variant="outline"
              size="sm"
              disabled={runs.length < 50}
              onClick={() => setPage(p => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>

        {/* Right: Run detail */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedRun ? (
            <>
              {/* Detail header */}
              <div className="p-4 border-b">
                <div className="flex items-center gap-3 mb-3">
                  {isSucceeded(selectedRun.status) ? (
                    <Badge className="bg-green-500/10 text-green-600 border-green-200 border">成功</Badge>
                  ) : (
                    <Badge className="bg-red-500/10 text-red-600 border-red-200 border">失败</Badge>
                  )}
                  <h2 className="font-semibold">{selectedRun.skillName || selectedRun.skillSlug}</h2>
                  <span className="text-xs text-muted-foreground">{formatTime(selectedRun.createdAt)}</span>
                </div>
                <div className="grid grid-cols-5 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">运行时间</p>
                    <p className="font-medium">{formatTime(selectedRun.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">耗时</p>
                    <p className="font-medium">{formatDuration(selectedRun.durationMs)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">模型</p>
                    <p className="font-medium text-xs truncate">
                      {selectedRun.skillVersion ? `v${selectedRun.skillVersion} · ` : ""}{getModelName(selectedRun)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">成本</p>
                    <p className="font-medium">${(Number(selectedRun.costCents || 0) / 100).toFixed(4)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Token 用量</p>
                    <p className="font-medium">
                      {getPromptTokens(selectedRun)} + {getCompletionTokens(selectedRun)}
                    </p>
                  </div>
                </div>
              </div>

              {renderGovernanceProjection()}

              {/* Detail tabs */}
              <div className="border-b px-4">
                <div className="flex gap-1">
                  {([
                    { id: "output" as DetailTab, label: "输出结果", icon: FileText },
                    { id: "input" as DetailTab, label: "输入参数", icon: Code2 },
                    { id: "meta" as DetailTab, label: "运行元数据", icon: Cpu },
                  ] as const).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setDetailTab(tab.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors",
                        detailTab === tab.id
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <tab.icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <ScrollArea className="flex-1 p-4">
                {renderDetailOutput()}
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Zap className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm">从左侧选择一条运行记录查看详情</p>
            </div>
          )}
        </div>
    </div>
  );
}
