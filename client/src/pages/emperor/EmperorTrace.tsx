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
  model: string;
  output: string;
  errorMessage: string | null;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  createdAt: string | Date;
  userId: number;
  userName?: string;
}

export default function EmperorTrace() {
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = trpc.emperor.run.history.useQuery({
    page,
    pageSize: 50,
  });

  const runs: RunRecord[] = (data?.runs || []) as RunRecord[];
  const total = runs.length; // history endpoint returns page/pageSize, not total count

  const formatTime = (ts: string | Date) => {
    try {
      return format(new Date(ts), "MM-dd HH:mm:ss", { locale: zhCN });
    } catch {
      return String(ts);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* Left: Run list */}
        <div className="w-[360px] flex-shrink-0 border-r flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm">运行历史</h2>
              <p className="text-xs text-muted-foreground mt-0.5">共 {total} 条记录</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Zap className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">暂无运行记录</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRun(run)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all",
                      selectedRun?.id === run.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {run.status === "success" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                          )}
                          <span className="font-medium text-sm truncate">{run.skillName || run.skillSlug}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(run.createdAt)}
                          </span>
                          {run.durationMs > 0 && (
                            <span>{formatDuration(run.durationMs)}</span>
                          )}
                          {(run.promptTokens + run.completionTokens) > 0 && (
                            <span className="flex items-center gap-1">
                              <Cpu className="h-3 w-3" />
                              {run.promptTokens + run.completionTokens}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{run.model}</p>
                      </div>
                      {selectedRun?.id === run.id && (
                        <ChevronRight className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          {/* Pagination */}
          {total > 50 && (
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
                disabled={page * 50 >= total}
                onClick={() => setPage(p => p + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>

        {/* Right: Run detail */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedRun ? (
            <>
              <div className="p-4 border-b">
                <div className="flex items-center gap-3 mb-2">
                  {selectedRun.status === "success" ? (
                    <Badge className="bg-green-500/10 text-green-600 border-green-200 border">成功</Badge>
                  ) : (
                    <Badge className="bg-red-500/10 text-red-600 border-red-200 border">失败</Badge>
                  )}
                  <h2 className="font-semibold">{selectedRun.skillName || selectedRun.skillSlug}</h2>
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
                    <p className="font-medium text-xs truncate">{selectedRun.model}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Token 用量</p>
                    <p className="font-medium">
                      {selectedRun.promptTokens} + {selectedRun.completionTokens}
                    </p>
                  </div>
                </div>
              </div>
              <ScrollArea className="flex-1 p-4">
                {selectedRun.status === "error" ? (
                  <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg p-4">
                    {selectedRun.errorMessage || "运行失败"}
                  </div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                    <Streamdown>{selectedRun.output}</Streamdown>
                  </div>
                )}
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
