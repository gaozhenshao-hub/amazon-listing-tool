import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, Loader2, RefreshCw, ShieldCheck, TestTube2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

type ConnectionCode = "apify" | "lingxing" | "saihu";
type DraftState = Partial<Record<ConnectionCode, Record<string, string>>>;

function stateLabel(status: string) {
  const labels: Record<string, string> = {
    not_checked: "未校验",
    verified: "已校验",
    configuration_valid: "配置有效",
    pending_provider_contract: "待登记API合同",
    failed: "校验未通过",
  };
  return labels[status] || status;
}

function sourceLabel(source: string) {
  if (source === "managed_secret") return "受控密钥库";
  if (source === "environment_compatibility") return "兼容环境配置";
  return "未配置";
}

export function ApiConnectionManager() {
  const utils = trpc.useUtils();
  const { user, loading: authLoading } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const connections = trpc.apiConnections.list.useQuery(undefined, { retry: false, enabled: isSuperAdmin });
  const [drafts, setDrafts] = useState<DraftState>({});
  const save = trpc.apiConnections.save.useMutation({
    onSuccess: async () => {
      setDrafts({});
      await utils.apiConnections.list.invalidate();
      await utils.crawler.getProviderReadiness.invalidate();
      toast.success("连接密钥已安全保存", { description: "原值不会再次展示；建议执行轻量校验。" });
    },
    onError: error => toast.error("保存失败", { description: error.message }),
  });
  const validate = trpc.apiConnections.validate.useMutation({
    onSuccess: async result => {
      await utils.apiConnections.list.invalidate();
      toast[result.success ? "success" : "error"](result.success ? "轻量校验通过" : "轻量校验未通过", {
        description: result.success ? "未读取业务数据，未启动采集Actor。" : `错误类别：${result.validation.errorCode || "unknown"}`,
      });
    },
    onError: error => toast.error("校验失败", { description: error.message }),
  });
  const rewrap = trpc.apiConnections.rewrap.useMutation({
    onSuccess: async result => {
      await utils.apiConnections.list.invalidate();
      toast.success("密文已重新加密", { description: `已处理 ${result.rotatedFields.length} 个已配置字段。` });
    },
    onError: error => toast.error("重新加密失败", { description: error.message }),
  });

  const connectionItems = useMemo(() => connections.data || [], [connections.data]);
  const updateDraft = (connection: ConnectionCode, field: string, value: string) => {
    setDrafts(current => ({
      ...current,
      [connection]: { ...(current[connection] || {}), [field]: value },
    }));
  };
  const saveConnection = (connection: ConnectionCode) => {
    const values = Object.fromEntries(Object.entries(drafts[connection] || {}).filter(([, value]) => value.trim()));
    if (!Object.keys(values).length) {
      toast.error("请填写至少一个需要新增或替换的密钥字段");
      return;
    }
    save.mutate({ connection, values });
  };

  if (authLoading || (isSuperAdmin && connections.isLoading)) {
    return <div className="space-y-4">{[1, 2, 3].map(item => <div key={item} className="h-48 animate-pulse rounded-xl bg-muted" />)}</div>;
  }

  if (!isSuperAdmin) {
    return <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"><CardContent className="flex gap-3 pt-6"><ShieldCheck className="mt-0.5 h-5 w-5 text-amber-700" /><div><p className="font-medium">仅超级管理员可管理API连接</p><p className="mt-1 text-sm text-muted-foreground">为防止凭据泄露，本页不会向管理员、运营或普通成员显示连接状态和密钥输入框。</p></div></CardContent></Card>;
  }

  if (connections.isError) {
    return <Card className="border-destructive/30"><CardContent className="flex gap-3 pt-6"><CircleAlert className="mt-0.5 h-5 w-5 text-destructive" /><div><p className="font-medium">无法读取连接状态</p><p className="mt-1 text-sm text-muted-foreground">{connections.error.message}</p></div></CardContent></Card>;
  }

  return <div className="space-y-5">
    <Card className="border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20">
      <CardContent className="flex gap-3 pt-5 text-sm"><ShieldCheck className="mt-0.5 h-5 w-5 text-sky-700 dark:text-sky-300" /><p><strong>密钥只支持新增或替换，不支持查看或导出。</strong>保存后使用系统级AES-GCM受管密钥库加密；页面、任务记录、审计记录和错误提示均不保留密钥原值。</p></CardContent>
    </Card>

    {connectionItems.map(connection => {
      const code = connection.code as ConnectionCode;
      const hasDraft = Object.values(drafts[code] || {}).some(value => value.trim());
      const hasStoredSecret = connection.fields.some(field => field.source === "managed_secret");
      const isPendingContract = connection.integrationStatus === "pending_provider_contract";
      return (
        <Card key={connection.code} className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />{connection.displayName}</CardTitle>
                <CardDescription className="mt-2 max-w-3xl">{connection.purpose}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={connection.ready ? "default" : "secondary"}>{connection.ready ? "连接就绪" : "尚未就绪"}</Badge>
                <Badge variant={connection.validation.status === "verified" ? "outline" : "secondary"}>{stateLabel(connection.validation.status)}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className="grid gap-3 md:grid-cols-3">
              {connection.fields.map(field => (
                <div key={field.key} className="rounded-lg border bg-muted/15 p-3">
                  <p className="text-sm font-medium">{field.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{field.configured ? `${sourceLabel(field.source)} · ${field.keyVersion ? `版本 ${field.keyVersion}` : "兼容来源"}` : "未配置"}</p>
                  {field.updatedAt && <p className="mt-1 text-xs text-muted-foreground">最近替换：{new Date(field.updatedAt).toLocaleString("zh-CN")}</p>}
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {connection.fields.map(field => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`${connection.code}-${field.key}`}>{field.label}{field.requiredForReady ? "（必填）" : ""}</Label>
                  <Input
                    id={`${connection.code}-${field.key}`}
                    type="password"
                    value={drafts[code]?.[field.key] || ""}
                    placeholder={field.configured ? "留空则保留当前密钥；重新输入即可替换" : "仅用于新增；保存后不会回显"}
                    autoComplete="new-password"
                    onChange={event => updateDraft(code, field.key, event.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">
                最近校验：{connection.validation.checkedAt ? new Date(connection.validation.checkedAt).toLocaleString("zh-CN") : "尚未执行"}
                {connection.validation.errorCode ? ` · 脱敏错误类别：${connection.validation.errorCode}` : ""}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => saveConnection(code)} disabled={!hasDraft || save.isPending}>
                  {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />}保存/替换密钥
                </Button>
                <Button size="sm" variant="outline" onClick={() => validate.mutate({ connection: code })} disabled={validate.isPending || isPendingContract}>
                  {validate.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-1.5 h-4 w-4" />}{isPendingContract ? "待API合同" : "无费用轻量校验"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => rewrap.mutate({ connection: code })} disabled={!hasStoredSecret || rewrap.isPending}>
                  {rewrap.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}重加密密文
                </Button>
              </div>
            </div>
            {isPendingContract && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">赛狐开放平台文档当前受访问控制。密钥可先受控保存；在管理员登记官方受限API合同前，系统不会发起赛狐远程调用或自动同步。</p>}
          </CardContent>
        </Card>
      );
    })}
  </div>;
}
