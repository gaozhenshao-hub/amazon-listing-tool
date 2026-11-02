import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Activity, ArrowRight, CheckCircle2, ChevronRight, Clock, ExternalLink, Globe, KeyRound, Loader2, LockKeyhole, Settings2, Shield, TestTube2, Trash2, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { ApiConnectionManager } from "./apiConnections/ApiConnectionManager";

function providerStatusLabel(status: string) {
  if (status === "active") return "已通过资格验证";
  if (status === "qualification_pending") return "待资格验证";
  if (status === "paused") return "已暂停";
  if (status === "rejected") return "未通过";
  return status;
}

export default function SystemSettings() {
  const readiness = trpc.crawler.getProviderReadiness.useQuery();
  const providers = readiness.data ? [readiness.data.competitor, readiness.data.keyword] : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <LockKeyhole className="h-4 w-4" /> 旧内嵌Amazon爬虫已退役
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Settings2 className="h-6 w-6 text-primary" /> 系统设置</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            代理、User-Agent、重试参数和即时HTML抓取入口已关闭。Amazon数据统一经过受控Provider、持久化Job/Run、S3证据与人工审核链。
          </p>
        </div>
        <Button asChild><Link href="/ops/crawler">前往监控与Provider治理 <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
      </div>

      <Tabs defaultValue="connections" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="connections"><KeyRound className="mr-2 h-4 w-4" />API连接管理</TabsTrigger>
          <TabsTrigger value="nextsls">物流API</TabsTrigger>
          <TabsTrigger value="provider"><Shield className="mr-2 h-4 w-4" />Amazon Provider</TabsTrigger>
          <TabsTrigger value="mapping"><Users className="mr-2 h-4 w-4" />人员映射</TabsTrigger>
        </TabsList>
        <TabsContent value="connections"><ApiConnectionManager /></TabsContent>
        <TabsContent value="nextsls"><NextSlsSettings /></TabsContent>
        <TabsContent value="provider" className="space-y-6">
          <Card>
            <CardHeader><CardTitle>安全边界</CardTitle><CardDescription>历史代理配置不再读取，也不能作为Provider失败后的降级方案。</CardDescription></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                ["外部调用", "仅服务端受控Provider API"], ["凭证", "受管环境引用，不入库或下发客户端"],
                ["执行", "持久化Job/Run与Heartbeat"], ["失败策略", "失败关闭，不回退旧爬虫"],
                ["原始证据", "S3归档，数据库保存引用与哈希"], ["真实费用", "资格验证与真实调用需显式确认预算"],
              ].map(([label, value]) => <div key={label} className="rounded-lg border bg-muted/30 p-4"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-1 text-sm font-medium">{value}</div></div>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>监控Provider资格状态</CardTitle><CardDescription>待验证能力在真实资格Run通过前不可执行。</CardDescription></CardHeader>
            <CardContent>
              {readiness.isLoading ? <p className="text-sm text-muted-foreground">正在读取Provider状态…</p> : readiness.isError ? <p className="text-sm text-destructive">{readiness.error.message}</p> : (
                <div className="grid gap-4 md:grid-cols-2">{providers.map(provider => (
                  <div key={provider.kind} className="rounded-xl border p-4">
                    <div className="flex items-center justify-between gap-3"><h3 className="font-medium">{provider.displayName}</h3><Badge variant={provider.status === "active" ? "default" : "secondary"}>{providerStatusLabel(provider.status)}</Badge></div>
                    <div className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">能力</span><span className="text-right">{provider.capabilities.join(" / ")}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Actor</span><span className="max-w-[60%] truncate" title={provider.actorName || ""}>{provider.actorName || "未登记"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">服务端Secret</span><span>{provider.secretConfigured ? "已配置" : "未配置"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">单Run上限</span><span>${Number(provider.perRunMaxUsd || 0).toFixed(2)}</span></div>
                    </div>
                  </div>
                ))}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="mapping"><OperatorMappingSettings /></TabsContent>
      </Tabs>
    </div>
  );
}

function NextSlsSettings() {
  const { data, isLoading, refetch } = trpc.logistics.getConfig.useQuery();
  const saveMut = trpc.logistics.saveConfig.useMutation({
    onSuccess: () => { toast.success("物流API配置已保存"); void refetch(); },
    onError: error => toast.error(error.message),
  });
  const testMut = trpc.logistics.testConnection.useMutation();
  const { data: logsData, refetch: refetchLogs } = trpc.logistics.getApiLogs.useQuery({ limit: 15 });
  const [form, setForm] = useState({ baseUrl: "", token: "", enabled: false });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setForm({ baseUrl: data.baseUrl || "https://zjyxgj.nextsls.com", token: data.token || "", enabled: data.enabled });
      setInitialized(true);
    }
  }, [data, initialized]);

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(item => <div key={item} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>;

  return (
    <div className="space-y-6">
      <Card className={data?.isReady ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30"}>
        <CardContent className="flex items-center justify-between pt-5">
          <div><p className="font-medium">{data?.isReady ? "已连接知己云星管家物流API" : "物流API未配置"}</p><p className="text-sm text-muted-foreground">物流时效数据用于库存预警与补货建议。</p></div>
          {data?.isReady && <Badge variant="outline"><CheckCircle2 className="mr-1 h-3 w-3" />已就绪</Badge>}
        </CardContent>
      </Card>
      <Card className="border-blue-100 dark:border-blue-900">
        <CardContent className="pt-5"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-lg bg-blue-100 px-2.5 py-1.5 font-medium text-blue-700">NextSLS运单轨迹</span><ChevronRight className="h-3.5 w-3.5" /><span className="rounded-lg bg-purple-100 px-2.5 py-1.5 font-medium text-purple-700">物流时效统计</span><ChevronRight className="h-3.5 w-3.5" /><span className="rounded-lg bg-emerald-100 px-2.5 py-1.5 font-medium text-emerald-700">库存预警</span></div></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Globe className="h-4 w-4 text-blue-500" />知己云星管家 API 凭证</CardTitle><CardDescription>配置NextSLS物流API地址和Token。<a href="https://zjyxgj.nextsls.com/api/v5/docs" target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-600 hover:underline">API文档 <ExternalLink className="inline h-3 w-3" /></a></CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>API网站地址</Label><Input value={form.baseUrl} onChange={event => setForm(current => ({ ...current, baseUrl: event.target.value }))} /></div>
          <div><Label>API Token</Label><Input type="password" value={form.token} onChange={event => setForm(current => ({ ...current, token: event.target.value }))} />{form.token === "••••••••" && <p className="mt-1 text-xs text-muted-foreground">已配置；如需修改请重新输入。</p>}</div>
          <div className="flex items-center justify-between rounded-lg border p-4"><div><p className="text-sm font-medium">启用物流API</p><p className="text-xs text-muted-foreground">启用后同步物流时效数据。</p></div><Button variant={form.enabled ? "default" : "outline"} size="sm" onClick={() => setForm(current => ({ ...current, enabled: !current.enabled }))}>{form.enabled ? <><CheckCircle2 className="mr-1 h-4 w-4" />已启用</> : <><XCircle className="mr-1 h-4 w-4" />未启用</>}</Button></div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => saveMut.mutate({ baseUrl: form.baseUrl || undefined, token: form.token || undefined, enabled: form.enabled })} disabled={saveMut.isPending}>{saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}保存配置</Button>
        <Button variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending}>{testMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}测试连接</Button>
        {!!logsData?.length && <Button variant="ghost" className="ml-auto" onClick={() => void refetchLogs()}><Activity className="mr-2 h-4 w-4" />刷新日志</Button>}
      </div>
      {testMut.data && <Card className={testMut.data.success ? "border-emerald-200" : "border-red-200"}><CardContent className="pt-5"><p className="font-medium">{testMut.data.message}</p></CardContent></Card>}
      {!!logsData?.length && <Card><CardHeader><CardTitle className="text-base">最近API调用</CardTitle></CardHeader><CardContent><div className="max-h-48 overflow-y-auto"><Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>接口</TableHead><TableHead>状态</TableHead><TableHead>耗时</TableHead></TableRow></TableHeader><TableBody>{logsData.slice().reverse().map((log, index) => <TableRow key={`${log.timestamp}-${index}`}><TableCell>{new Date(log.timestamp).toLocaleString()}</TableCell><TableCell className="max-w-[240px] truncate font-mono text-xs">{log.endpoint}</TableCell><TableCell>{log.status === "success" ? "OK" : "FAIL"}</TableCell><TableCell>{log.latencyMs}ms</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}
      <Card><CardContent className="pt-5"><p className="flex items-center gap-2 text-sm font-medium"><Clock className="h-4 w-4" />功能说明</p><p className="mt-2 text-xs text-muted-foreground">物流时效继续用于补货引擎与库存预警，本次Amazon监控迁移不会改变此配置。</p></CardContent></Card>
    </div>
  );
}

function OperatorMappingSettings() {
  const { data: mappings, isLoading, refetch } = trpc.operatorMapping.listMappings.useQuery();
  const deleteMut = trpc.operatorMapping.deleteMapping.useMutation({
    onSuccess: () => { toast.success("映射已删除"); void refetch(); },
    onError: error => toast.error("删除失败", { description: error.message }),
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />运营人员名称映射管理</CardTitle><CardDescription>管理领星/赛狐外部运营名称与系统用户的映射。</CardDescription></CardHeader>
        <CardContent>
          {isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div> : !mappings?.length ? <div className="py-12 text-center text-muted-foreground">暂无映射记录</div> : (
            <div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>外部名称</TableHead><TableHead className="w-10" /><TableHead>系统用户名</TableHead><TableHead>来源</TableHead><TableHead>状态</TableHead><TableHead>创建时间</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{mappings.map(mapping => <TableRow key={mapping.id}><TableCell className="font-medium">{mapping.externalName}</TableCell><TableCell><ArrowRight className="h-4 w-4" /></TableCell><TableCell>{mapping.systemUserName || "未映射"}</TableCell><TableCell><Badge variant="outline">{mapping.sourceType === "lingxing" ? "领星" : mapping.sourceType === "saihu" ? "赛狐" : "通用"}</Badge></TableCell><TableCell><Badge variant="outline">{mapping.isConfirmed ? "已确认" : "待确认"}</Badge></TableCell><TableCell>{mapping.createdAt ? new Date(mapping.createdAt).toLocaleDateString("zh-CN") : "-"}</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" className="text-destructive" disabled={deleteMut.isPending} onClick={() => { if (confirm("确定删除此映射关系？")) deleteMut.mutate({ id: mapping.id }); }}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
