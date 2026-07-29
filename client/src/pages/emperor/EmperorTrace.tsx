import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
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
  status: string;
  modelSlug?: string;
  model?: string;
  output?: string;
  errorMessage: string | null;
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  durationMs: number;
  createdAt: string | Date;
  userId: number;
  userName?: string;
}

type DetailTab = "output" | "input" | "meta";

export default function EmperorTrace() {
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

  const runs: RunRecord[] = (data?.runs || []) as RunRecord[];
  const selectedRun = runs.find(r => r.runId === selectedRunId) || null;

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
              { label: "Run ID", value: detail.runId },
              { label: "Skill Slug", value: detail.skillSlug },
              { label: "模型", value: getModelName(detail as RunRecord) },
              { label: "状态", value: detail.status },
              { label: "开始时间", value: detail.startedAt ? formatTime(detail.startedAt as string) : "-" },
              { label: "完成时间", value: detail.completedAt ? formatTime(detail.completedAt as string) : "-" },
              { label: "耗时", value: formatDuration(detail.durationMs) },
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
    <DashboardLayout>
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
                      {run.status === "success" ? (
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
                    <p className="text-xs text-muted-foreground mt-1 truncate">{getModelName(run)}</p>
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
                  {selectedRun.status === "success" ? (
                    <Badge className="bg-green-500/10 text-green-600 border-green-200 border">成功</Badge>
                  ) : (
                    <Badge className="bg-red-500/10 text-red-600 border-red-200 border">失败</Badge>
                  )}
                  <h2 className="font-semibold">{selectedRun.skillName || selectedRun.skillSlug}</h2>
                  <span className="text-xs text-muted-foreground font-mono">{selectedRun.runId?.slice(0, 16)}...</span>
                </div>
                <div className="grid grid-cols-4 gap-4 text-sm">
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
                    <p className="font-medium text-xs truncate">{getModelName(selectedRun)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Token 用量</p>
                    <p className="font-medium">
                      {getPromptTokens(selectedRun)} + {getCompletionTokens(selectedRun)}
                    </p>
                  </div>
                </div>
              </div>

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
    </DashboardLayout>
  );
}
