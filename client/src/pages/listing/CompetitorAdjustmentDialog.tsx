import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
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
  competitorStudyFields,
  competitorCurrentValues,
} from "@shared/competitorStudyFields";

type Edit = { key: string; original: string; value: string };
type Props = {
  projectId: number;
  analysisId: number;
  target: "study" | "translation" | "video";
  fieldKeys: string[];
  label: string;
  study: any;
  layout: unknown;
  edits?: Record<string, { original: string; value: string }>;
  onClose: () => void;
};
function fieldLabel(key: string, study: any) {
  if (key.startsWith("video:")) return "视频主要卖点";
  if (key.startsWith("subtitle:")) {
    const [, hash, id] = key.split(":");
    return (
      "视频字幕 · " +
      (study?.videoAnalyses
        ?.find((v: any) => v.hash === hash)
        ?.cues?.find((c: any) => c.id === id)?.source || "原文")
    );
  }
  if (key.startsWith("module:")) return "主要卖点";
  if (key.startsWith("region:")) {
    const [, hash, index] = key.split(":");
    return `图片译文 · ${study?.richContent?.images?.find((i: any) => i.sourceHash === hash)?.regions?.[Number(index)]?.source || "图中文字"}`;
  }
  if (key.startsWith("text:")) {
    const id = key.split(":")[1];
    return `${key.endsWith("sellingPoints") ? "文案卖点" : "文案译文"} · ${study?.richContent?.texts?.find((t: any) => t.id === id)?.source || "原生文案"}`;
  }
  if (key.startsWith("image:"))
    return key.endsWith("sellingPoints") ? "图片卖点" : "图片译文";
  if (key.startsWith("bullet:"))
    return `第${Number(key.split(":")[1]) + 1}条 · ${key.endsWith("translation") ? "中文翻译" : "主要卖点"}`;
  if (key.startsWith("review:"))
    return `评论分析 · ${{ name: "主题", reason: "归纳依据", percentage: "比例" }[key.split(":")[2]] || "内容"}`;
  return "标题翻译";
}

export default function CompetitorAdjustmentDialog({
  projectId,
  analysisId,
  target,
  fieldKeys,
  label,
  study,
  layout,
  edits = {},
  onClose,
}: Props) {
  const utils = trpc.useUtils(),
    adjust = trpc.analysis.adjustCompetitor.useMutation(),
    confirm = trpc.analysis.confirmCompetitorAdjustment.useMutation();
  const [messages, setMessages] = useState<
      Array<{ role: "user" | "assistant"; text: string }>
    >([]),
    [message, setMessage] = useState("");
  const [changes, setChanges] = useState<Edit[]>([]),
    [baseline, setBaseline] = useState<{
      sourceHash: string;
      revision: number;
    }>();
  const [exit, setExit] = useState(false),
    [improve, setImprove] = useState(false),
    [operationId] = useState(() => crypto.randomUUID());
  const bottom = useRef<HTMLDivElement>(null);
  const fields = competitorStudyFields(study, layout),
    keys = fieldKeys.length ? fieldKeys : Object.keys(fields);
  const currentValues = competitorCurrentValues(study, layout, edits);
  const current = (key: string) => currentValues[key] || "";
  const dirty = Boolean(messages.length || message.trim()),
    busy = adjust.isPending || confirm.isPending,
    canSave = !!baseline && !!changes.length && !message.trim() && !busy;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const close = () => {
    if (confirm.isPending) return;
    if (dirty || adjust.isPending) setExit(true);
    else onClose();
  };
  async function send() {
    const text = message.trim();
    if (!text || busy) return;
    try {
      const result = await adjust.mutateAsync({
        projectId,
        analysisId,
        target,
        fieldKeys,
        message: text,
        history: messages,
        proposed: changes,
        baseline,
      });
      setMessages([
        ...messages,
        { role: "user", text },
        { role: "assistant", text: result.reply },
      ]);
      setChanges(result.changes);
      setBaseline(result.baseline);
      setMessage("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "调整未完成，原结果保留"
      );
    }
  }
  async function save(withImprovement: boolean) {
    if (!baseline || !canSave) return;
    try {
      await confirm.mutateAsync({
        projectId,
        analysisId,
        target,
        fieldKeys,
        history: messages,
        proposed: changes,
        baseline,
        operationId,
        improve: withImprovement,
      });
      await Promise.all([
        utils.analysis.getAggregation.invalidate({ projectId }),
        utils.analysis.listByProject.invalidate({ projectId }),
      ]);
      toast.success(
        withImprovement
          ? "本次调整已保存，独立改进草稿已建立"
          : "本次调整已保存"
      );
      onClose();
    } catch (error) {
      setImprove(false);
      toast.error(
        error instanceof Error
          ? error.message
          : "暂时无法保存，请保留对话后重试"
      );
    }
  }
  const preview = (key: string, before: string, after?: string) => (
    <div key={key} className="rounded-lg border bg-background p-3 text-sm">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {fieldLabel(key, study)}
      </p>
      <p className="whitespace-pre-wrap break-words">
        {(after ?? before) || "暂无"}
      </p>
      {after !== undefined && after !== before && (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          原结果：{before || "暂无"}
        </p>
      )}
    </div>
  );
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
          className="left-auto right-0 top-0 flex h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-[1100px]"
        >
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              调整结果（AI）
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {label}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-h-0 flex-col">
              <div
                role="log"
                aria-label="与小酷的对话"
                className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
              >
                <p className="max-w-[92%] rounded-2xl bg-muted/60 p-4 text-sm leading-relaxed">
                  告诉我当前模块哪里需要调整，我会结合图片、原文和你的意见逐步核对。确认之前，原结果会一直保留。
                </p>
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[92%] whitespace-pre-wrap rounded-2xl p-4 text-sm leading-relaxed ${m.role === "user" ? "ml-auto bg-primary/10" : "bg-muted/60"}`}
                  >
                    <span className="mb-1 block text-xs text-muted-foreground">
                      {m.role === "user" ? "你" : "小酷"}
                    </span>
                    {m.text}
                  </div>
                ))}
                {adjust.isPending && (
                  <p className="text-sm text-muted-foreground">
                    小酷正在查看并调整…
                  </p>
                )}
                <div ref={bottom} />
              </div>
              <form
                className="border-t p-4"
                onSubmit={e => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  aria-label="告诉小酷需要调整什么"
                  placeholder="例如：把重复的防护卖点合并，保留面料配比和厚度。"
                  className="min-h-24 w-full resize-none rounded-xl border bg-background p-3 text-sm"
                  value={message}
                  maxLength={4000}
                  disabled={busy}
                  onChange={e => setMessage(e.target.value)}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    可以继续补充或追问，直到你满意
                  </span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!message.trim() || busy}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    发送
                  </Button>
                </div>
              </form>
            </div>
            <aside
              aria-label="当前调整预览"
              className="min-h-0 overflow-y-auto border-l bg-muted/15 p-5"
            >
              <h3 className="mb-4 font-semibold">当前调整预览</h3>
              <div className="space-y-3">
                {(changes.length ? changes.map(c => c.key) : keys).map(key =>
                  preview(
                    key,
                    current(key),
                    changes.find(c => c.key === key)?.value
                  )
                )}
              </div>
            </aside>
          </div>
          <footer className="flex flex-wrap justify-end gap-3 border-t px-5 py-4">
            <Button
              variant="outline"
              disabled={!canSave}
              onClick={() => void save(false)}
            >
              确认本次调整
            </Button>
            <Button disabled={!canSave} onClick={() => setImprove(true)}>
              确认并用于改进
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
      <AlertDialog open={exit} onOpenChange={setExit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>本次调整尚未保存</AlertDialogTitle>
            <AlertDialogDescription>
              是否放弃本次对话并退出？已保存的结果会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续调整</AlertDialogCancel>
            <AlertDialogAction disabled={confirm.isPending} onClick={onClose}>
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
              保存当前模块的原始结果、你的意见和确认后的结果，建立对应技能的独立改进草稿。正式规则由后续测试和发布决定。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            {changes.map(c => preview(c.key, current(c.key), c.value))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>返回调整</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canSave}
              onClick={e => {
                e.preventDefault();
                void save(true);
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
