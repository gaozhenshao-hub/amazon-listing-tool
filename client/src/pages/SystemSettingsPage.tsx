import { useState } from "react";
import { Link } from "wouter";
import { PlugZap, Settings2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
function SaihuSettings() {
  const query = trpc.workspaceSettings.saihu.useQuery(undefined, {
      refetchOnWindowFocus: false,
    }),
    save = trpc.workspaceSettings.saveSaihu.useMutation(),
    test = trpc.workspaceSettings.testSaihu.useMutation();
  const [editing, setEditing] = useState(false),
    [appId, setAppId] = useState(""),
    [secret, setSecret] = useState("");
  const data = query.data,
    busy = save.isPending || test.isPending;
  async function persist() {
    if (!data) return;
    try {
      await save.mutateAsync({
        appId: appId.trim(),
        secret: secret.trim() || undefined,
        expectedVersion: data.version,
      });
      setSecret("");
      setEditing(false);
      await query.refetch();
      toast.success("赛狐接口配置已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存未完成");
    }
  }
  async function validate() {
    if (!data) return;
    try {
      const result = await test.mutateAsync({ expectedVersion: data.version });
      await query.refetch();
      if (result.check?.status === "connected")
        toast.success(result.check.message);
      else toast.error(result.check?.message || "连接未通过");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "连接测试未完成");
    }
  }
  return (
    <section className="max-w-3xl overflow-hidden rounded-2xl border bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <PlugZap className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">赛狐 ERP</h2>
            <p className="text-xs text-muted-foreground">
              产品数据、财务与库存同步使用的接口连接
            </p>
          </div>
        </div>
        <span
          className={
            "rounded-full border px-3 py-1 text-xs " +
            (data?.check?.status === "connected"
              ? "border-green-200 bg-green-50 text-green-800"
              : data?.check?.status === "failed"
                ? "border-red-200 bg-red-50 text-red-800"
                : "bg-muted text-muted-foreground")
          }
        >
          {data?.check?.status === "connected"
            ? "已连接"
            : data?.check?.status === "failed"
              ? "连接失败"
              : data?.configured
                ? "已配置 · 待测试"
                : "未配置"}
        </span>
      </header>
      <div className="space-y-5 p-5">
        {query.isLoading ? (
          <p>正在读取接口配置…</p>
        ) : query.error ? (
          <div role="alert">
            配置暂时无法读取。
            <Button variant="link" onClick={() => void query.refetch()}>
              重试
            </Button>
          </div>
        ) : (
          data && (
            <>
              <p className="text-xs text-muted-foreground">
                接口地址：{data.origin}
              </p>
              <label className="block space-y-2 text-sm">
                <span>应用ID（App ID）</span>
                <input
                  aria-label="赛狐应用ID"
                  value={editing ? appId : data.appId}
                  readOnly={!editing}
                  disabled={busy}
                  onChange={e => setAppId(e.target.value)}
                  maxLength={200}
                  className="w-full rounded-lg border bg-background p-3"
                  placeholder="填写赛狐开放平台的应用ID"
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span>应用密钥（App Secret）</span>
                <input
                  aria-label="赛狐应用密钥"
                  type="password"
                  autoComplete="new-password"
                  value={
                    editing ? secret : data.hasSecret ? "••••••••••••" : ""
                  }
                  readOnly={!editing}
                  disabled={busy}
                  onChange={e => setSecret(e.target.value)}
                  maxLength={4096}
                  className="w-full rounded-lg border bg-background p-3"
                  placeholder={
                    data.hasSecret
                      ? "留空继续使用已保存的密钥"
                      : "填写对应的应用密钥"
                  }
                />
              </label>
              {data.check && (
                <p role="status" className="rounded-lg bg-muted/40 p-3 text-sm">
                  {data.check.message}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    测试时间：
                    {new Date(data.check.checkedAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </span>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <Button
                      disabled={busy || !appId.trim()}
                      onClick={() => void persist()}
                    >
                      {save.isPending ? "保存中…" : "保存配置"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setSecret("");
                        setEditing(false);
                      }}
                    >
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setAppId(data.appId);
                        setSecret("");
                        setEditing(true);
                      }}
                    >
                      {data.configured ? "修改配置" : "配置接口"}
                    </Button>
                    <Button
                      disabled={busy || !data.configured}
                      onClick={() => void validate()}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {test.isPending ? "正在测试连接…" : "测试连接"}
                    </Button>
                  </>
                )}
                <Link
                  href="/ops/saihu-sync"
                  className="self-center px-3 text-sm text-primary underline"
                >
                  查看赛狐数据同步
                </Link>
              </div>
            </>
          )
        )}
      </div>
    </section>
  );
}
export default function SystemSettingsPage() {
  const { user } = useAuth(),
    allowed = ["admin", "super_admin"].includes(user?.role || "");
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Settings2 />
          系统设置
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          统一管理当前工作空间的API接口连接。
        </p>
      </header>
      <div className="flex gap-2 border-b pb-3">
        <span className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
          API接口配置
        </span>
      </div>
      {allowed ? (
        <SaihuSettings />
      ) : (
        <p className="rounded-xl border p-6 text-muted-foreground">
          管理员可以管理API接口配置，请联系管理员协助。
        </p>
      )}
    </main>
  );
}
