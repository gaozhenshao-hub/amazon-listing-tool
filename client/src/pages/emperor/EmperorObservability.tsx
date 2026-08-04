import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";

const PERIOD_OPTIONS = [
  { label: "7天", value: 7 },
  { label: "30天", value: 30 },
  { label: "90天", value: 90 },
];

function formatNumber(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function formatMs(value: unknown) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatPercent(value: unknown) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function statusBadge(status: string) {
  const normalized = status || "unknown";
  if (["active", "ok", "succeeded", "completed"].includes(normalized)) {
    return <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">正常</Badge>;
  }
  if (["warning", "draining", "dry_run", "running", "queued"].includes(normalized)) {
    return <Badge className="border border-amber-200 bg-amber-50 text-amber-700">关注</Badge>;
  }
  if (["failed", "unhealthy", "stopped", "canceled"].includes(normalized)) {
    return <Badge className="border border-rose-200 bg-rose-50 text-rose-700">异常</Badge>;
  }
  return <Badge variant="outline">{normalized}</Badge>;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "green" | "amber" | "red" | "blue";
}) {
  const toneClass = {
    default: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    blue: "bg-sky-50 text-sky-700",
  }[tone];

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", toneClass)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EmperorObservability() {
  const [days, setDays] = useState(30);
  const utils = trpc.useUtils();
  const { data, isLoading, isFetching, error } = trpc.emperor.observability.dashboard.useQuery({ days });
  const snapshotMutation = trpc.emperor.observability.recordDatabaseBaselineSnapshot.useMutation({
    onSuccess: (result) => {
      toast.success(`数据库基线已记录：${result.rowCountSamples} 个表，${result.explainSamples} 个 EXPLAIN`);
      utils.emperor.observability.dashboard.invalidate({ days });
    },
    onError: (mutationError) => toast.error(mutationError.message || "记录数据库基线失败"),
  });

  const topRows = useMemo(() => {
    const rows = data?.database?.rowCounts || [];
    return [...rows]
      .sort((a, b) => Number(b.rowCount || 0) - Number(a.rowCount || 0))
      .slice(0, 10);
  }, [data?.database?.rowCounts]);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="max-w-2xl border-rose-200 bg-rose-50">
          <CardContent className="flex items-start gap-3 pt-6">
            <XCircle className="mt-0.5 h-5 w-5 text-rose-600" />
            <div>
              <p className="font-medium text-rose-900">可观测数据读取失败</p>
              <p className="mt-1 text-sm text-rose-700">{error.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const summary = data?.summary;
  const worker = data?.workerQueue;
  const database = data?.database;

  return (
    <div className="h-[calc(100vh-56px)] overflow-auto bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">可观测看板</h1>
            <p className="mt-1 text-sm text-muted-foreground">AI OS、Worker 队列、数据库基线和 QA 运营指标</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PERIOD_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={days === option.value ? "default" : "outline"}
                onClick={() => setDays(option.value)}
              >
                {option.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={snapshotMutation.isPending}
              onClick={() => snapshotMutation.mutate()}
            >
              {snapshotMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              记录DB基线
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Zap}
            label="Skill 成本"
            value={`${(Number(summary?.skill?.costCents || 0) / 100).toFixed(2)}`}
            sub={`${formatNumber(summary?.skill?.totalTokens)} tokens / ${formatNumber(summary?.skill?.totalRuns)} 次`}
            tone="blue"
          />
          <MetricCard
            icon={Activity}
            label="Agent 失败率"
            value={formatPercent(summary?.agent?.failureRate)}
            sub={`${formatNumber(summary?.agent?.failedRuns)} failed / ${formatNumber(summary?.agent?.totalRuns)} runs`}
            tone={Number(summary?.agent?.failureRate || 0) > 10 ? "red" : "green"}
          />
          <MetricCard
            icon={ShieldCheck}
            label="人工确认率"
            value={formatPercent(summary?.node?.confirmationRate)}
            sub={`编辑率 ${formatPercent(summary?.node?.humanEditRate)} / 重试率 ${formatPercent(summary?.node?.retryRate)}`}
            tone="green"
          />
          <MetricCard
            icon={Wrench}
            label="Tool 失败率"
            value={formatPercent(summary?.tool?.failureRate)}
            sub={`${formatNumber(summary?.tool?.failedRuns)} failed / ${formatNumber(summary?.tool?.totalRuns)} runs`}
            tone={Number(summary?.tool?.failureRate || 0) > 10 ? "red" : "default"}
          />
          <MetricCard
            icon={Timer}
            label="Job 平均耗时"
            value={formatMs(summary?.job?.avgDurationMs)}
            sub={`失败率 ${formatPercent(summary?.job?.failureRate)} / 重试率 ${formatPercent(summary?.job?.retryRate)}`}
            tone="amber"
          />
          <MetricCard
            icon={CheckCircle2}
            label="质量均分"
            value={Number(summary?.quality?.avgScore || 0).toFixed(1)}
            sub={`低分率 ${formatPercent(summary?.quality?.lowScoreRate)} / ${formatNumber(summary?.quality?.evaluationCount)} 样本`}
            tone="green"
          />
          <MetricCard
            icon={Server}
            label="Worker 健康"
            value={`${formatNumber(worker?.healthyCount)} / ${formatNumber(worker?.workers?.length)}`}
            sub={`stale ${formatNumber(worker?.staleCount)} / unhealthy ${formatNumber(worker?.unhealthyCount)}`}
            tone={Number(worker?.unhealthyCount || 0) > 0 ? "red" : "blue"}
          />
          <MetricCard
            icon={Database}
            label="DB EXPLAIN"
            value={`${formatNumber(database?.explainSummary?.passedChecks)} / ${formatNumber(database?.explainSummary?.totalChecks)}`}
            sub={`命中率 ${formatPercent(database?.explainSummary?.passRate)}`}
            tone={Number(database?.explainSummary?.failedChecks || 0) > 0 ? "amber" : "green"}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4" />
                Worker 队列健康
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                {(worker?.queue || []).slice(0, 6).map((item) => (
                  <div key={`${item.status}-${item.queueName}`} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{item.queueName}</span>
                      {statusBadge(item.status)}
                    </div>
                    <p className="mt-3 text-2xl font-semibold tabular-nums">{formatNumber(item.jobCount)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      max age {formatNumber(item.maxAgeSeconds)}s / stale lease {formatNumber(item.staleLeaseCount)}
                    </p>
                  </div>
                ))}
                {(worker?.queue || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">暂无队列数据</p>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 font-medium">Worker</th>
                      <th className="py-2 font-medium">状态</th>
                      <th className="py-2 font-medium">并发</th>
                      <th className="py-2 font-medium">运行中</th>
                      <th className="py-2 font-medium">心跳延迟</th>
                      <th className="py-2 font-medium">角色</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(worker?.workers || []).slice(0, 10).map((item) => (
                      <tr key={item.workerId} className="border-b last:border-0">
                        <td className="max-w-[240px] truncate py-2 font-mono text-xs">{item.workerId}</td>
                        <td className="py-2">{statusBadge(item.effectiveStatus)}</td>
                        <td className="py-2 tabular-nums">{formatNumber(item.concurrency)}</td>
                        <td className="py-2 tabular-nums">{formatNumber(item.runningCount)}</td>
                        <td className="py-2 tabular-nums">{item.heartbeatAgeMs === null ? "-" : `${formatNumber(Math.round(item.heartbeatAgeMs / 1000))}s`}</td>
                        <td className="py-2">{item.role}</td>
                      </tr>
                    ))}
                    {(worker?.workers || []).length === 0 && (
                      <tr>
                        <td className="py-6 text-center text-muted-foreground" colSpan={6}>暂无 Worker 心跳</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4" />
                死信与失败分类
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                {(data?.toolFailures || []).slice(0, 8).map((item) => (
                  <div key={item.failureKind} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <span className="text-sm">{item.failureKind}</span>
                    <span className="font-mono text-sm tabular-nums">{formatNumber(item.count)}</span>
                  </div>
                ))}
                {(data?.toolFailures || []).length === 0 && (
                  <p className="py-4 text-sm text-muted-foreground">暂无 Tool 失败分类</p>
                )}
              </div>
              <div className="space-y-2">
                {(worker?.deadLetters || []).slice(0, 6).map((item) => (
                  <div key={item.runId} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">{item.runId}</span>
                      <Badge variant="outline">{item.module}</Badge>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.errorMessage || "无错误详情"}</p>
                  </div>
                ))}
                {(worker?.deadLetters || []).length === 0 && (
                  <p className="py-4 text-sm text-muted-foreground">暂无 Job 死信</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                核心表行数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 font-medium">表</th>
                      <th className="py-2 font-medium">域</th>
                      <th className="py-2 text-right font-medium">行数</th>
                      <th className="py-2 font-medium">增长</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topRows.map((item) => (
                      <tr key={item.table} className="border-b last:border-0">
                        <td className="py-2 font-mono text-xs">{item.table}</td>
                        <td className="py-2">{item.domain}</td>
                        <td className="py-2 text-right font-mono tabular-nums">{formatNumber(item.rowCount)}</td>
                        <td className="py-2">{item.highGrowth ? <Badge className="border border-amber-200 bg-amber-50 text-amber-700">高增长</Badge> : <Badge variant="outline">稳定</Badge>}</td>
                      </tr>
                    ))}
                    {topRows.length === 0 && (
                      <tr>
                        <td className="py-6 text-center text-muted-foreground" colSpan={4}>暂无数据库行数基线</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4" />
                慢查询与 EXPLAIN 基线
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 font-medium">检查项</th>
                      <th className="py-2 font-medium">表</th>
                      <th className="py-2 font-medium">预期索引</th>
                      <th className="py-2 font-medium">实际命中</th>
                      <th className="py-2 font-medium">风险</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(database?.explainAudits || []).map((item) => (
                      <tr key={item.slug} className="border-b last:border-0">
                        <td className="max-w-[220px] py-2">
                          <p className="truncate font-medium">{item.slug}</p>
                          <p className="truncate text-xs text-muted-foreground">{item.purpose}</p>
                        </td>
                        <td className="py-2 font-mono text-xs">{item.table}</td>
                        <td className="max-w-[180px] truncate py-2 text-xs">{item.expectedIndexNames.join(", ")}</td>
                        <td className="py-2">
                          {item.usesExpectedIndex ? (
                            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">已命中</Badge>
                          ) : (
                            <Badge className="border border-rose-200 bg-rose-50 text-rose-700">需审计</Badge>
                          )}
                        </td>
                        <td className="py-2">{item.risk}</td>
                      </tr>
                    ))}
                    {(database?.explainAudits || []).length === 0 && (
                      <tr>
                        <td className="py-6 text-center text-muted-foreground" colSpan={5}>暂无 EXPLAIN 基线</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                归档任务健康
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">总运行</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(database?.archiveHealth?.totalRuns)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">成功率</p>
                  <p className="mt-1 text-xl font-semibold">{formatPercent(database?.archiveHealth?.successRate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">已归档</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(database?.archiveHealth?.archivedCount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">已删除</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(database?.archiveHealth?.deletedCount)}</p>
                </div>
              </div>
              <div className="space-y-2">
                {(database?.archiveHealth?.latestRuns || []).slice(0, 6).map((item) => (
                  <div key={item.archiveRunId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.policySlug}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.tableName} / {item.mode}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(item.status)}
                      <span className="font-mono text-xs tabular-nums">{formatNumber(item.candidateCount)}</span>
                    </div>
                  </div>
                ))}
                {(database?.archiveHealth?.latestRuns || []).length === 0 && (
                  <p className="py-4 text-sm text-muted-foreground">暂无归档任务记录</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4" />
                迁移回归基线
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">迁移文件</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(database?.migrationRegression?.requiredMigrations?.length)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">核心表</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(database?.migrationRegression?.requiredTables?.length)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">索引基线</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(database?.migrationRegression?.requiredIndexes?.length)}</p>
                </div>
              </div>
              <div className="space-y-2">
                {(database?.migrationRegression?.requiredChecks || []).map((item) => (
                  <div key={item.slug} className="rounded-lg border px-3 py-2">
                    <p className="text-sm font-medium">{item.slug}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>生成时间：{data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "-"}</span>
          <span>{isFetching ? "正在刷新" : "数据已同步"}</span>
        </div>
      </div>
    </div>
  );
}
