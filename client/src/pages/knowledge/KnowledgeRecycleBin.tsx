import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export default function KnowledgeRecycleBin() {
  const { user } = useAuth(),
    admin = ["admin", "super_admin"].includes(user?.role || "");
  const [page, setPage] = useState(1),
    [deleting, setDeleting] = useState<{ id: string; title: string } | null>(
      null
    );
  const utils = trpc.useUtils(),
    query = trpc.knowledgeAssets.recycle.useQuery({ page }, { enabled: admin });
  function refresh() {
    void utils.knowledgeAssets.recycle.invalidate();
    void utils.kbImages.invalidate();
    void utils.kbVideos.invalidate();
  }
  const restore = trpc.knowledgeAssets.restore.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("资料和标签已恢复");
    },
    onError: e => toast.error(e.message),
  });
  const purge = trpc.knowledgeAssets.purge.useMutation({
    onSuccess: () => {
      setDeleting(null);
      refresh();
      toast.success("已永久删除，未被引用的文件将自动清理");
    },
    onError: e => toast.error(e.message),
  });
  if (!admin)
    return <p className="p-8 text-muted-foreground">回收站仅管理员可访问。</p>;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Trash2 className="h-6 w-6 text-primary" />
          回收站
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          恢复会保留原来的图片、视频和标签；永久删除后无法恢复。
        </p>
      </header>
      {query.isLoading ? (
        <p>正在读取…</p>
      ) : query.error ? (
        <div role="alert">
          回收站暂时无法读取。
          <Button variant="outline" onClick={() => query.refetch()}>
            重试
          </Button>
        </div>
      ) : !query.data?.items.length ? (
        <div className="rounded-2xl border border-dashed py-20 text-center text-muted-foreground">
          回收站是空的
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {query.data.items.map(item => (
            <article
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div className="min-w-0 flex-1">
                <span className="text-xs text-muted-foreground">
                  {
                    { set: "ASIN 集", image: "图片 / 模块", video: "视频" }[
                      item.kind
                    ]
                  }{" "}
                  · {item.itemCount} 项
                </span>
                <h2 className="mt-1 break-words font-medium">{item.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  删除时间：{new Date(item.deletedAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={restore.isPending || purge.isPending}
                  onClick={() => restore.mutate({ id: item.id })}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  恢复
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={restore.isPending || purge.isPending}
                  onClick={() => setDeleting(item)}
                >
                  永久删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage(p => p - 1)}
        >
          上一页
        </Button>
        <span className="self-center text-sm">第 {page} 页</span>
        <Button
          variant="outline"
          disabled={!query.data?.hasMore}
          onClick={() => setPage(p => p + 1)}
        >
          下一页
        </Button>
      </div>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={open => {
          if (!open && !purge.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认永久删除？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.title}
              。将删除对应记录和未被其他资料引用的文件，不备份，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purge.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={purge.isPending}
              onClick={e => {
                e.preventDefault();
                if (deleting) purge.mutate({ id: deleting.id });
              }}
            >
              确认永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
