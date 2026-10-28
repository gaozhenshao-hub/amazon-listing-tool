import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IMAGE_UPLOAD_LIMIT } from "@shared/standaloneImage";

export function readImageBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("文件无法读取"));
    reader.readAsDataURL(file);
  });
}
export default function StandaloneImageUpload({
  onClose,
}: {
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [progress, setProgress] = useState(""),
    [failures, setFailures] = useState<string[]>([]);
  const utils = trpc.useUtils(),
    mutation = trpc.kbImages.uploadStandalone.useMutation();
  async function upload() {
    if (progress || !files.length) return;
    const failed: File[] = [],
      messages: string[] = [];
    let saved = 0;
    for (const [index, file] of files.entries()) {
      setProgress(`正在上传 ${index + 1} / ${files.length}：${file.name}`);
      try {
        if (file.size > IMAGE_UPLOAD_LIMIT)
          throw new Error("单张图片不能超过 20MB");
        const receipt = await mutation.mutateAsync({
          filename: file.name,
          base64: await readImageBase64(file),
        });
        saved++;
        if (receipt.duplicate) toast.info(`${file.name} 已上传过，保留原图`);
        if (!receipt.tagging)
          messages.push(
            `${file.name} 已保存，自动打标暂未启动，可在图片详情重试`
          );
      } catch (e) {
        failed.push(file);
        messages.push(
          `${file.name}：${e instanceof Error ? e.message : "上传失败，请重试"}`
        );
      }
    }
    setProgress("");
    setFiles(failed);
    setFailures(messages);
    await utils.kbImages.listAllImages.invalidate();
    if (saved) toast.success(`已保存 ${saved} 张图片，后台自动生成标签`);
    if (!messages.length) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !progress) onClose();
      }}
    >
      <DialogContent
        onInteractOutside={e => {
          if (progress) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>图片导入</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          支持单张或多张 JPG、PNG、WebP，每张不超过
          20MB。每张图片独立入库，自动识别自身的标签。
        </p>
        <input
          aria-label="选择图片文件"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={!!progress}
          onChange={e => {
            const selected = Array.from(e.target.files || []);
            if (selected.length > 50)
              toast.info("每次最多上传 50 张，已选择前 50 张");
            setFiles(selected.slice(0, 50));
            setFailures([]);
          }}
        />
        {files.length > 0 && (
          <p className="text-sm">已选择 {files.length} 张</p>
        )}
        {progress && (
          <p role="status" className="text-sm">
            {progress}
          </p>
        )}
        {failures.length > 0 && (
          <div
            role="alert"
            className="max-h-40 overflow-auto rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
          >
            {failures.map((m, i) => (
              <p key={i}>{m}</p>
            ))}
          </div>
        )}
        <Button disabled={!!progress || !files.length} onClick={upload}>
          {progress
            ? "上传中…"
            : failures.length
              ? "重试未上传的图片"
              : "上传并自动打标"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
