import { useState } from "react";
import { CheckCircle2, Link2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
export default function ResearchExtensionConnect() {
  const code =
      new URLSearchParams(window.location.search).get("code")?.toUpperCase() ||
      "",
    valid = /^[A-F0-9]{10}$/.test(code),
    query = trpc.researchLibrary.pairing.useQuery(
      { code },
      { enabled: valid, retry: false }
    ),
    approve = trpc.researchLibrary.approveExtension.useMutation(),
    { user } = useAuth(),
    [done, setDone] = useState(false);
  return (
    <main className="mx-auto flex min-h-[65vh] max-w-xl items-center p-6">
      <section className="w-full space-y-5 rounded-2xl border bg-background p-8 shadow-sm">
        {done ? (
          <>
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <h1 className="text-2xl font-semibold">收藏插件已登录</h1>
            <p className="text-sm leading-7 text-muted-foreground">
              请返回插件点击“检查登录状态”，然后在亚马逊页面收藏产品和店铺。
            </p>
          </>
        ) : (
          <>
            <Link2 className="h-10 w-10 text-primary" />
            <h1 className="text-2xl font-semibold">连接产品收藏插件</h1>
            <p className="text-sm leading-7">
              使用当前账号 <strong>{user?.name || "当前用户"}</strong>{" "}
              登录收藏插件。
            </p>
            <div className="rounded-xl bg-muted/30 p-4 text-sm leading-7">
              插件可以将你主动选择的亚马逊产品和店铺加入本人的待调研产品库，查看本人收藏状态。你可随时在产品库解除连接。
            </div>
            {!valid || query.error ? (
              <p role="alert" className="text-sm text-destructive">
                连接码无效或已过期，请从插件重新发起登录。
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">连接码：{code}</p>
                <Button
                  className="w-full"
                  disabled={!query.data || approve.isPending}
                  onClick={async () => {
                    try {
                      await approve.mutateAsync({ code });
                      setDone(true);
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : "连接未完成，请重试"
                      );
                    }
                  }}
                >
                  确认连接当前账号
                </Button>
              </>
            )}
          </>
        )}
        <Button variant="link" asChild>
          <a href="/dev/library">返回待调研产品库</a>
        </Button>
      </section>
    </main>
  );
}
