import { useCallback, useEffect, useState } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import KnowledgeAdjustmentDialog from "./KnowledgeAdjustmentDialog";
import AssetDeleteButton from "./AssetDeleteButton";

export function AdjustResultButton({
  kind,
  id,
  onSaved,
}: {
  kind: "set" | "image" | "video";
  id: number;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const start = trpc.knowledgeAssets.startAdjustment.useMutation({
    onSuccess: d => setDraft(d.id),
    onError: e => toast.error(e.message),
  });
  return (
    <>
      <Button
        variant="outline"
        disabled={start.isPending}
        onClick={() => start.mutate({ kind, id })}
      >
        <MessageSquare className="mr-2 h-4 w-4" />
        调整结果（AI）
      </Button>
      {draft && (
        <KnowledgeAdjustmentDialog
          id={draft}
          onClose={() => setDraft(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
export default function KnowledgeAssetActions({
  id,
  onDeleted,
}: {
  id: number;
  onDeleted: () => void;
}) {
  const utils = trpc.useUtils(),
    access = trpc.knowledgeAssets.access.useQuery({ kind: "image", id });
  const [retag, setRetag] = useState<string | null>(null);
  const run = trpc.knowledgeAssets.retagImage.useMutation({
    onSuccess: r => setRetag(r.id),
    onError: e => toast.error(e.message),
  });
  const progress = trpc.knowledgeAssets.adjustment.useQuery(
    { id: retag || "" },
    {
      enabled: Boolean(retag),
      refetchInterval: q =>
        q.state.data?.state === "saved" || q.state.data?.state === "failed"
          ? false
          : 2000,
    }
  );
  const refresh=useCallback(()=> {
    void utils.kbImages.invalidate();
    void utils.kbVideos.invalidate();
  },[utils]);
  useEffect(() => {
    if (progress.data?.state === "saved") {
      refresh();
      setRetag(null);
      toast.success("重新打标完成");
    } else if (progress.data?.state === "failed") {
      setRetag(null);
      toast.error(progress.data.error || "重新打标未完成，原结果已保留");
    }
  }, [progress.data?.state,progress.data?.error,refresh]);
  return (
    <div className="flex flex-wrap gap-2 rounded-b-lg bg-background px-3 py-4">
      {access.data?.canEdit && access.data.canTag && (
        <>
          <AdjustResultButton kind="image" id={id} onSaved={refresh} />
          <Button
            variant="outline"
            disabled={run.isPending || Boolean(retag)}
            onClick={() => run.mutate({ id })}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {retag ? "正在打标…" : "重新打标"}
          </Button>
        </>
      )}
      {access.data?.canDelete && (
        <AssetDeleteButton
          kind="image"
          id={id}
          count={access.data.count}
          label={
            access.data.count > 1
              ? `删除该模块（共 ${access.data.count} 张）`
              : "删除该图片"
          }
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
