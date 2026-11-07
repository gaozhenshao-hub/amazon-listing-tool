import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
export default function TaskFeedbackDialog({
  title,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>
        <p className="text-sm text-muted-foreground">
          对结果哪里不满意？有什么改进意见？小L会结合当前结果重新整理，保留人工修改。
        </p>
        <textarea
          autoFocus
          aria-label="重新整理改进意见"
          maxLength={4000}
          value={message}
          onChange={e => setMessage(e.target.value)}
          className="min-h-32 w-full rounded-xl border p-3 text-sm"
          placeholder="例如：合并重复内容，标题更具体，突出我已经修改过的产品信息。"
          disabled={busy}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            返回
          </Button>
          <Button
            disabled={busy || !message.trim()}
            onClick={() => void onSubmit(message.trim())}
          >
            {busy ? "正在提交…" : "开始重新整理"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
