import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function AssetDeleteButton({
  kind,
  id,
  label,
  count = 1,
  onDeleted,
}: {
  kind: "set" | "image" | "video";
  id: number;
  label: string;
  count?: number;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false),
    [permanent, setPermanent] = useState(false);
  const utils = trpc.useUtils();
  const remove = trpc.knowledgeAssets.delete.useMutation({
    onSuccess: () => {
      setOpen(false);
      void utils.kbImages.invalidate();
      void utils.kbVideos.invalidate();
      void utils.knowledgeAssets.recycle.invalidate();
      toast.success(
        permanent
          ? "已永久删除，未被其他资料引用的文件将自动清理"
          : "已放入回收站，可由管理员恢复"
      );
      onDeleted();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <>
      <Button
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => {
          setPermanent(false);
          setOpen(true);
        }}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!remove.isPending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              {kind === "set"
                ? "会处理本 ASIN 集及其中的图片、视频和标签。"
                : count > 1
                  ? `这个 A+ 模块由 ${count} 张图片组成，将作为一个整体移入回收站。`
                  : "资料和标签会一起移入回收站。"}
            </DialogDescription>
          </DialogHeader>
          {kind === "set" && (
            <fieldset className="space-y-3">
              <label className="flex cursor-pointer gap-3 rounded-xl border p-4">
                <input
                  type="radio"
                  name="delete-mode"
                  checked={!permanent}
                  onChange={() => setPermanent(false)}
                />
                <span>
                  <strong className="block text-sm">放入回收站</strong>
                  <span className="text-xs text-muted-foreground">
                    保留原文件，管理员可恢复
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-xl border p-4">
                <input
                  type="radio"
                  name="delete-mode"
                  checked={permanent}
                  onChange={() => setPermanent(true)}
                />
                <span>
                  <strong className="block text-sm text-destructive">
                    永久删除
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    删除后无法恢复，不备份图片或视频
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              variant={permanent ? "destructive" : "default"}
              disabled={remove.isPending}
              onClick={() => remove.mutate({ kind, id, permanent })}
            >
              {remove.isPending
                ? "正在处理…"
                : permanent
                  ? "确认永久删除"
                  : "确认放入回收站"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
