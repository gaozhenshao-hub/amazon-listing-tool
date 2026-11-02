import { useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";

type MonitorRunView = {
  id: number;
  monitorKind: "competitor" | "keyword";
  asin: string;
  keyword: string | null;
  triggerType: string;
  status: string;
  chargedUsd: string | number | null;
  createdAt: Date | string;
};

export function AmazonMonitorGovernancePanel() {
  const readiness = trpc.crawler.getProviderReadiness.useQuery();
  const runs = trpc.crawler.getMonitorRuns.useQuery({ limit: 20 }, { refetchInterval: 10000 });
  const register = trpc.crawler.registerProviderCandidate.useMutation({
    onSuccess: () => { toast.success("Provider候选已登记为待资格验证"); void readiness.refetch(); },
    onError: error => toast.error("登记失败", { description: error.message }),
  });
  const qualify = trpc.crawler.qualifyProvider.useMutation({
    onSuccess: result => { toast.success("资格验证Job已排队", { description: result.aiJobRunId }); void runs.refetch(); },
    onError: error => toast.error("资格验证未启动", { description: error.message }),
  });
  const [asin, setAsin] = useState("");
  const [keyword, setKeyword] = useState("");
  const [budget, setBudget] = useState("0.10");

  const runQualification = (kind: "competitor" | "keyword") => {
    const maxChargeUsd = Number(budget);
    const normalizedAsin = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(normalizedAsin)) return toast.error("请输入10位测试ASIN");
    if (kind === "keyword" && !keyword.trim()) return toast.error("关键词排名资格验证需要测试关键词");
    if (!Number.isFinite(maxChargeUsd) || maxChargeUsd <= 0 || maxChargeUsd > 1) return toast.error("单次预算必须在0–1美元之间");
    if (!window.confirm(`确认运行${kind === "competitor" ? "价格/BSR" : "关键词排名"}资格测试，单次费用上限 $${maxChargeUsd.toFixed(2)}？`)) return;
    qualify.mutate({ kind, asin: normalizedAsin, keyword: kind === "keyword" ? keyword.trim() : null, maxChargeUsd, confirmExternalCharge: true });
  };

  return (
    <div className="space-y-4">
      <Card className="border-l-4 border-l-blue-500">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4" />Provider资格与预算</CardTitle><CardDescription>候选登记不产生费用；真实资格Run必须再次确认ASIN、关键词和费用上限。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {readiness.isLoading ? <Skeleton className="h-40" /> : !readiness.data ? <p className="text-sm text-destructive">无法读取Provider状态</p> : (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                {[readiness.data.competitor, readiness.data.keyword].map(provider => (
                  <div key={provider.kind} className="rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{provider.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{provider.actorName}</p></div><Badge variant={provider.status === "active" ? "default" : "secondary"}>{provider.status === "active" ? "已验证" : "待验证"}</Badge></div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge variant="outline">{provider.capabilities.join(" / ")}</Badge><Badge variant="outline">单Run ${Number(provider.perRunMaxUsd || 0).toFixed(2)}</Badge><Badge variant="outline">Secret {provider.secretConfigured ? "已配置" : "缺失"}</Badge></div>
                    <div className="mt-4 flex gap-2">
                      {!provider.configured && <Button size="sm" variant="outline" disabled={register.isPending} onClick={() => register.mutate({ kind: provider.kind, perRunMaxUsd: 0.1, dailyBudgetUsd: 5, monthlyBudgetUsd: 100 })}>登记候选</Button>}
                      {provider.status === "qualification_pending" && provider.configured && <Button size="sm" disabled={qualify.isPending || !provider.secretConfigured} onClick={() => runQualification(provider.kind)}>运行受控资格测试</Button>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-3"><Input value={asin} onChange={event => setAsin(event.target.value)} placeholder="测试ASIN（不会自动运行）" /><Input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="关键词排名测试关键词" /><Input type="number" min="0.01" max="1" step="0.01" value={budget} onChange={event => setBudget(event.target.value)} placeholder="单次预算美元" /></div>
            </>
          )}
          <p className="text-xs text-muted-foreground">Provider未通过资格验证时，手动Run、批量Run和Heartbeat均失败关闭；不会调用旧内嵌爬虫。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center justify-between"><div><CardTitle className="text-base">最近Monitor Run</CardTitle><CardDescription>Provider Run、AI Job与Agent Run的持久化审计记录。</CardDescription></div><Button size="sm" variant="outline" onClick={() => void runs.refetch()}><RefreshCw className="mr-1 h-3 w-3" />刷新</Button></div></CardHeader>
        <CardContent>{runs.isLoading ? <Skeleton className="h-32" /> : !runs.data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">暂无Monitor Run；待资格验证通过后方可执行。</p> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-2">类型</th><th className="px-3 py-2">ASIN / 关键词</th><th className="px-3 py-2">触发</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">费用</th><th className="px-3 py-2">时间</th></tr></thead><tbody>{runs.data.map((run: MonitorRunView) => <tr key={run.id} className="border-b"><td className="px-3 py-2">{run.monitorKind === "competitor" ? "价格/BSR" : "关键词排名"}</td><td className="px-3 py-2 font-mono">{run.asin}{run.keyword ? ` · ${run.keyword}` : ""}</td><td className="px-3 py-2">{run.triggerType}</td><td className="px-3 py-2"><Badge variant={run.status === "succeeded" ? "default" : "secondary"}>{run.status}</Badge></td><td className="px-3 py-2">{run.chargedUsd === null ? "—" : `$${Number(run.chargedUsd).toFixed(4)}`}</td><td className="px-3 py-2">{new Date(run.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</CardContent>
      </Card>
    </div>
  );
}
