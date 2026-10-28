import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ADMIN_ROLES } from "@shared/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DeleteAcquisitionButton from "./DeleteAcquisitionButton";

export default function AcquisitionRecordActions({ jobId, asin, status, onDeleted }: {
  jobId: number; asin: string; status: string; onDeleted?: () => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const requestId = useRef<string | null>(null);
  const retry = trpc.acquisition.recollectJob.useMutation({
    onSuccess: result => {
      void utils.acquisition.listJobs.invalidate();
      void utils.acquisition.jobDetails.invalidate({jobId});
      setOpen(false);
      requestId.current = null;
      toast.success(result.runId ? "已安排补采缺失部分，已保存的素材保留" : "没有需要补采的图片或视频");
    },
    onError: error => toast.error(error.message),
  });
  const active = ["queued", "running"].includes(status);
  return <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline" disabled={active || retry.isPending} onClick={() => setOpen(true)}>
      <RefreshCw className="mr-1 h-4 w-4" />重新采集（缺失部分）
    </Button>
    {user?.role && (ADMIN_ROLES as readonly string[]).includes(user.role) &&
      <DeleteAcquisitionButton jobId={jobId} status={status} onDeleted={onDeleted} />}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>重新采集 {asin}</DialogTitle>
          <DialogDescription>只重新下载缺失的图片或视频，已保存的素材不变。尚未入库的任务补采完成后，仍需点击确认入库。</DialogDescription>
        </DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button disabled={retry.isPending} onClick={() => {
            requestId.current ??= crypto.randomUUID();
            retry.mutate({ jobId, requestId: requestId.current });
          }}>{retry.isPending ? "正在提交…" : "确认重新采集"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
