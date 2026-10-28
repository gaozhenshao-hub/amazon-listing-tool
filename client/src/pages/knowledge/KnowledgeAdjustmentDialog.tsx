import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  SET_ADJUSTMENT_LABELS,
  IMAGE_ADJUSTMENT_LABELS,
  VIDEO_ADJUSTMENT_LABELS,
} from "@shared/knowledgeAdjustment";
import { videoTime } from "@shared/videoLabels";
import { KnowledgeTag } from "./KnowledgeTag";

export function ResultValue({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        {value.map((v: any, i) => (
          <div key={i} className="rounded-lg border p-2 text-xs">
            <span className="font-medium">{v.label}</span>
            <span className="ml-2 font-mono text-primary">
              {videoTime(v.start)}–{videoTime(v.end)}
            </span>
            <p className="mt-1 text-muted-foreground">{v.description}</p>
          </div>
        ))}
      </div>
    );
  return <>{String(value || "未设置")}</>;
}
export default function KnowledgeAdjustmentDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.knowledgeAssets.adjustment.useQuery(
    { id },
    { refetchInterval: q => (q.state.data?.state === "running" ? 2000 : false) }
  );
  const [text, setText] = useState(""),
    [exit, setExit] = useState(false),
    [improve, setImprove] = useState(false);
  const bottom = useRef<HTMLDivElement>(null),
    draft = query.data;
  const refresh = () => utils.knowledgeAssets.adjustment.invalidate({ id });
  const send = trpc.knowledgeAssets.sendAdjustment.useMutation({
    onSuccess: () => {
      setText("");
      void refresh();
    },
    onError: e => toast.error(e.message),
  });
  const discard = trpc.knowledgeAssets.discardAdjustment.useMutation({
    onSuccess: onClose,
    onError: e => toast.error(e.message),
  });
  const confirm = trpc.knowledgeAssets.confirmAdjustment.useMutation({
    onSuccess: () => {
      toast.success(
        improve ? "调整已保存，小酷会参考这次纠正继续打标" : "本次调整已保存"
      );
      onSaved();
      onClose();
    },
    onError: e => {
      setImprove(false);
      toast.error(e.message);
    },
  });
  const busy =
    draft?.state === "running" ||
    send.isPending ||
    confirm.isPending ||
    discard.isPending;
  const dirty = Boolean(draft?.messages.length || text.trim());
  const canSave = Boolean(
    draft?.messages.some(m => m.role === "assistant") &&
      draft.result &&
      draft.state === "open"
  );
  function close() {
    if (confirm.isPending) return;
    if (dirty || draft?.state === "running") setExit(true);
    else discard.mutate({ id });
  }
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [draft?.messages.length]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const fieldLabels =
    draft?.kind === "set" ? SET_ADJUSTMENT_LABELS : draft?.kind === "video" ? VIDEO_ADJUSTMENT_LABELS : IMAGE_ADJUSTMENT_LABELS;
  return (
    <>
      <Dialog
        open
        onOpenChange={open => {
          if (!open) close();
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          onEscapeKeyDown={e => {
            e.preventDefault();
            close();
          }}
          onPointerDownOutside={e => e.preventDefault()}
          className="flex h-[88vh] max-h-[900px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]"
        >
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              调整结果（AI）
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                与小酷一起核对
              </span>
            </DialogTitle>
          </DialogHeader>
          {query.error ? (
            <div className="p-6 text-destructive">
              暂时无法读取本次对话。
              <Button variant="outline" onClick={() => query.refetch()}>
                重试
              </Button>
            </div>
          ) : !draft ? (
            <p className="p-6">正在准备对话…</p>
          ) : (
            <>
              <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_380px]">
                <div className="flex min-h-0 flex-col">
                  <div
                    role="log"
                    aria-label="与小酷的对话"
                    className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
                  >
                    <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-muted/60 p-4 text-sm leading-relaxed">
                      告诉我哪里判断不对，我会结合图片或视频逐步调整。你确认之前，原结果会一直保留。
                    </div>
                    {draft.messages.map((message, index) => (
                      <div
                        key={index}
                        className={`max-w-[92%] whitespace-pre-wrap rounded-2xl p-4 text-sm leading-relaxed ${message.role === "user" ? "ml-auto rounded-tr-sm bg-primary/10" : "rounded-tl-sm bg-muted/60"}`}
                      >
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                          {message.role === "user" ? "你" : "小酷"}
                        </span>
                        {message.text}
                      </div>
                    ))}
                    {draft.state === "running" && (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        小酷正在查看并调整…
                      </p>
                    )}
                    {draft.error && (
                      <p
                        role="alert"
                        className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
                      >
                        {draft.error}
                      </p>
                    )}
                    <div ref={bottom} />
                  </div>
                  <form
                    className="border-t p-4"
                    onSubmit={e => {
                      e.preventDefault();
                      if (text.trim() && !busy)
                        send.mutate({ id, revision: draft.revision, text });
                    }}
                  >
                    <textarea
                      aria-label="告诉小酷需要调整的地方"
                      placeholder="例如：这里主要是在展示使用场景，不是在教安装操作。"
                      value={text}
                      onChange={e => setText(e.target.value)}
                      maxLength={4000}
                      className="min-h-24 w-full resize-none rounded-xl border bg-background p-3 text-sm focus:outline-primary"
                      disabled={confirm.isPending}
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        可以继续追问或补充，直到你满意
                      </span>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!text.trim() || busy}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        发送
                      </Button>
                    </div>
                  </form>
                </div>
                <aside className="hidden min-h-0 overflow-y-auto border-l bg-muted/15 p-5 md:block">
                  <h3 className="mb-4 font-semibold">当前调整预览</h3>
                  {draft.kind === "set" && draft.changes.length > 0 && (
                      <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                        类目、风格、主色和提亮色的修改会同步到整个 ASIN 集。
                      </p>
                    )}
                  <div className="space-y-4">
                    {Object.entries(fieldLabels).map(([key, label]) => {
                      const edited = draft.changes.find(c => c.key === key);
                      return (
                        <div key={key}>
                          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                            {label}
                            {edited && (
                              <span className="text-primary">已调整</span>
                            )}
                          </div>
                          {key === "segments" || key === "summary" ? (
                            <div className="text-sm">
                              <ResultValue value={draft.result?.[key]} />
                            </div>
                          ) : (
                            <KnowledgeTag
                              color={/color/i.test(key)}
                              tone={key === "type" ? "video" : undefined}
                            >
                              {String(draft.result?.[key] || "未设置")}
                            </KnowledgeTag>
                          )}
                          {edited && key !== "segments" && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              原结果：
                              <ResultValue value={edited.before} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </aside>
              </div>
              <footer className="flex flex-wrap justify-end gap-3 border-t bg-background px-5 py-4">
                <Button
                  variant="outline"
                  disabled={!canSave || busy}
                  onClick={() =>
                    confirm.mutate({
                      id,
                      revision: draft.revision,
                      improve: false,
                    })
                  }
                >
                  确认本次调整
                </Button>
                <Button
                  disabled={
                    !canSave ||
                    busy ||
                    !draft.changes.length ||
                    !draft.improvement
                  }
                  onClick={() => setImprove(true)}
                >
                  确认并用于改进
                </Button>
              </footer>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={exit} onOpenChange={setExit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>本次调整尚未保存</AlertDialogTitle>
            <AlertDialogDescription>
              是否放弃本次调整并退出？原来的标签和结果会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discard.isPending}>
              继续调整
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={discard.isPending}
              onClick={e => {
                e.preventDefault();
                discard.mutate({ id });
              }}
            >
              放弃并退出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={improve} onOpenChange={setImprove}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>这次会改进什么？</AlertDialogTitle>
            <AlertDialogDescription>
              {draft?.improvementScope}
              会参考这次纠正。这里只保存你确认的案例，不把单个产品的结论当成所有产品的规则。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm leading-relaxed">{draft?.improvement}</p>
          <div className="space-y-2">
            {draft?.changes.map(c => (
              <div key={c.key} className="rounded-lg border p-3 text-sm">
                <strong>{c.label}</strong>
                <div className="mt-1 text-muted-foreground">
                  <ResultValue value={c.before} />
                </div>
                <div className="mt-2 text-primary">
                  改为：
                  <ResultValue value={c.after} />
                </div>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirm.isPending}>
              返回调整
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirm.isPending}
              onClick={e => {
                e.preventDefault();
                if (draft)
                  confirm.mutate({
                    id,
                    revision: draft.revision,
                    improve: true,
                  });
              }}
            >
              确认保存并改进
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
