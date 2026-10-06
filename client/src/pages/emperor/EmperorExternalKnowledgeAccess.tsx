import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const API_SCOPES = [
  { id: "stats", label: "统计", hint: "读取当前工作空间的已确认知识库计数" },
  { id: "search", label: "检索", hint: "检索当前工作空间的已确认共享资料" },
  { id: "rag", label: "RAG", hint: "按类型返回可引用的已确认资料" },
] as const;

type ApiScope = (typeof API_SCOPES)[number]["id"];

function scopeLabel(scope: string) {
  return API_SCOPES.find((item) => item.id === scope)?.label ?? scope;
}

export default function EmperorExternalKnowledgeAccess() {
  const utils = trpc.useUtils();
  const callersQuery = trpc.emperor.externalKnowledgeAccess.list.useQuery(undefined, { retry: false });
  const createCaller = trpc.emperor.externalKnowledgeAccess.create.useMutation({
    onSuccess: async (result) => {
      setCreatedToken(result.token);
      setName("");
      setDescription("");
      await utils.emperor.externalKnowledgeAccess.list.invalidate();
      toast.success("调用方已绑定当前工作空间；令牌仅显示一次");
    },
    onError: () => toast.error("创建调用方失败，请检查管理员权限后重试"),
  });
  const revokeCaller = trpc.emperor.externalKnowledgeAccess.revoke.useMutation({
    onSuccess: async () => {
      await utils.emperor.externalKnowledgeAccess.list.invalidate();
      toast.success("调用方已撤销，原令牌立即失效");
    },
    onError: () => toast.error("撤销调用方失败，请稍后重试"),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["stats", "search", "rag"]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const toggleScope = (scope: ApiScope) => {
    setScopes((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  };

  const create = () => {
    if (name.trim().length < 2) {
      toast.error("请输入至少两个字符的调用方名称");
      return;
    }
    if (scopes.length === 0) {
      toast.error("至少保留一个只读访问范围");
      return;
    }
    createCaller.mutate({ name: name.trim(), description: description.trim() || undefined, scopes });
  };

  const copyToken = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    toast.success("令牌已复制；请立即保存在调用方的受控密钥库中");
  };

  const endpoint = typeof window === "undefined" ? "/api/external/kb" : `${window.location.origin}/api/external/kb`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary"><ShieldCheck className="h-5 w-5" /><span className="text-sm font-medium">受控外部访问</span></div>
          <h1 className="text-2xl font-semibold tracking-tight">知识库调用方与工作空间绑定</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            每个调用方令牌只绑定当前工作空间，只能读取人工确认且已共享的知识资料。系统不会信任请求头中的工作空间，也不会使用全局回退密钥。
          </p>
        </div>
        <Badge variant="secondary" className="w-fit gap-1.5 px-3 py-1.5"><KeyRound className="h-3.5 w-3.5" />只读 API</Badge>
      </div>

      {createdToken && (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-600" />请立即保存本次令牌</CardTitle>
            <CardDescription>为防止泄露，令牌关闭此提示后不能再次查看；可随时撤销并重新创建。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <code className="min-w-0 flex-1 break-all rounded-md border bg-background px-3 py-2 text-xs">{createdToken}</code>
            <div className="flex gap-2">
              <Button type="button" onClick={copyToken}><Copy className="mr-2 h-4 w-4" />复制令牌</Button>
              <Button type="button" variant="outline" onClick={() => setCreatedToken(null)}>已安全保存</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">新建调用方</CardTitle>
            <CardDescription>令牌会自动绑定当前工作空间，不支持写入、删除或更改数据。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2"><Label htmlFor="caller-name">调用方名称</Label><Input id="caller-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：内部运营助手" maxLength={80} /></div>
            <div className="space-y-2"><Label htmlFor="caller-description">用途说明（可选）</Label><Input id="caller-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明谁会使用此只读调用方" maxLength={240} /></div>
            <div className="space-y-3">
              <Label>允许的只读范围</Label>
              {API_SCOPES.map((scope) => (
                <label key={scope.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/50">
                  <Checkbox checked={scopes.includes(scope.id)} onCheckedChange={() => toggleScope(scope.id)} />
                  <span className="grid gap-1"><span className="text-sm font-medium">{scope.label}</span><span className="text-xs text-muted-foreground">{scope.hint}</span></span>
                </label>
              ))}
            </div>
            <Button type="button" className="w-full" onClick={create} disabled={createCaller.isPending}><Plus className="mr-2 h-4 w-4" />{createCaller.isPending ? "正在创建…" : "创建并显示一次令牌"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">当前工作空间的调用方</CardTitle>
            <CardDescription>撤销后令牌立即失效。令牌内容从不在列表或审计记录中回显。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {callersQuery.isLoading && <div className="space-y-2"><div className="h-16 animate-pulse rounded-lg bg-muted" /><div className="h-16 animate-pulse rounded-lg bg-muted" /></div>}
            {callersQuery.isError && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p className="font-medium">暂时无法读取调用方列表</p><p className="mt-1 text-muted-foreground">请确认当前账号具备管理员权限，然后重试。</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => callersQuery.refetch()}><RotateCcw className="mr-2 h-3.5 w-3.5" />重新加载</Button></div>}
            {!callersQuery.isLoading && !callersQuery.isError && callersQuery.data?.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">尚未创建调用方。创建后可使用下方只读接口。</div>}
            {callersQuery.data?.map((caller) => (
              <div key={caller.slug} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{caller.name}</p><Badge variant="outline">{caller.tokenPrefix}…</Badge></div>{caller.description && <p className="mt-1 text-sm text-muted-foreground">{caller.description}</p>}<div className="mt-2 flex flex-wrap gap-1.5">{caller.scopes.map((scope) => <Badge key={scope} variant="secondary">{scopeLabel(scope)}</Badge>)}</div></div>
                <Button type="button" variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => revokeCaller.mutate({ slug: caller.slug })} disabled={revokeCaller.isPending}><RotateCcw className="mr-2 h-3.5 w-3.5" />撤销</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">接口使用方式</CardTitle><CardDescription>仅供已获授权的服务端调用；不要将令牌放入浏览器、前端代码或公开仓库。</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm"><div><p className="font-medium">接口基址</p><code className="mt-1 block break-all rounded-md bg-muted px-3 py-2 text-xs">{endpoint}</code></div><div className="grid gap-2 text-muted-foreground sm:grid-cols-3"><span><b className="text-foreground">GET</b> /stats</span><span><b className="text-foreground">POST</b> /search</span><span><b className="text-foreground">POST</b> /rag</span></div><p className="text-xs text-muted-foreground">所有请求使用 <code>Authorization: Bearer &lt;调用方令牌&gt;</code>。接口强制使用绑定工作空间的已确认共享数据。</p></CardContent>
      </Card>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />调用方、范围、撤销操作均会写入安全审计记录。</p>
    </div>
  );
}
