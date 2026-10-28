import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export default function MissingAssetActions({
  jobId,
  assetId,
  video,
  disabled,
  onSaved,
}: {
  jobId: number;
  assetId: number;
  video: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const retry = trpc.acquisition.retryMissingAsset.useMutation({
    onSuccess: r => {
      toast.success(r.runId ? "已安排补采这一项" : "这一项已补齐");
      onSaved();
    },
    onError: e => toast.error(e.message),
  });
  const image = trpc.acquisition.supplementMissingImage.useMutation();
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > (video ? 200 : 8) * 1024 * 1024) {
      toast.error(video ? "视频请控制在 200MB 以内" : "图片请控制在 8MB 以内");
      return;
    }
    setUploading(true);
    try {
      if (video) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(
          `/api/knowledge/videos/upload?collectionJobId=${jobId}&assetId=${assetId}`,
          { method: "POST", body: form, credentials: "same-origin" }
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "上传失败，请重试");
      } else {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("读取图片失败"));
          reader.readAsDataURL(file);
        });
        await image.mutateAsync({ jobId, assetId, base64 });
      }
      toast.success("这一项已补齐，核对后可确认入库");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }
  const busy = disabled || uploading || retry.isPending;
  return (
    <div className="space-y-2 pt-2">
      <Button
        size="sm"
        variant="outline"
        className="w-full text-xs"
        disabled={busy}
        onClick={() =>
          retry.mutate({ jobId, assetId, requestId: crypto.randomUUID() })
        }
      >
        重新采集该{video ? "视频" : "图片"}
      </Button>
      <label
        className={`block rounded-md border px-2 py-2 text-center ${busy ? "opacity-50" : "cursor-pointer text-primary hover:bg-muted"}`}
      >
        {uploading ? "正在上传…" : video ? "手动补视频" : "手动补图"}
        <input
          className="sr-only"
          aria-label={`补充${video ? "视频" : "图片"} ${assetId}`}
          type="file"
          disabled={busy}
          accept={
            video
              ? ".mp4,.avi,.mov,.webm,.m4v"
              : "image/jpeg,image/png,image/webp,image/gif"
          }
          onChange={e => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
