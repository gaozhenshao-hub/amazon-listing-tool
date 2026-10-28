import { useId, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { parseKnowledgeAsins, KNOWLEDGE_COLLECTION_LIMIT, type KnowledgeCollectionInput, type KnowledgeCollectionReceipt } from "@shared/knowledgeCollection";

const skipLabels = { exists: "已经采集过，已排除", active: "正在采集或等待补图，已排除", not_collected: "尚未采集，请使用上方新建采集" };

export function KnowledgeCollectionForm({ mode = "normal", initialAsin = "" }: { mode?: KnowledgeCollectionInput["mode"]; initialAsin?: string }) {
  const id = useId();
  const [text, setText] = useState(initialAsin);
  const [receipt, setReceipt] = useState<KnowledgeCollectionReceipt | null>(null);
  const request = useRef<{ signature: string; requestId: string } | null>(null);
  const utils = trpc.useUtils();
  const parsed = parseKnowledgeAsins(text);
  const valid = parsed.asins.length > 0 && parsed.asins.length <= KNOWLEDGE_COLLECTION_LIMIT && !parsed.invalid.length;
  const mutation = trpc.acquisition.collectKnowledge.useMutation({
    onSuccess: result => {
      setReceipt(result);
      // Keep the same idempotency key until the input changes, including after a successful retry.
      void utils.acquisition.listJobs.invalidate();
      toast.success(result.items.length ? `已安排 ${result.items.length} 个 ASIN 按顺序采集` : "已排除重复或正在处理的 ASIN，没有新建任务");
    },
    onError: error => toast.error(error.message),
  });
  const submit = () => {
    if (!valid || mutation.isPending) return;
    const signature = JSON.stringify({ asins: parsed.asins, mode });
    if (request.current?.signature !== signature) request.current = { signature, requestId: crypto.randomUUID() };
    mutation.mutate({ asins: parsed.asins, mode, requestId: request.current.requestId });
  };
  return <div className="space-y-4">
    <div className="space-y-2">
      <Label htmlFor={id}>ASIN / 美国站商品链接（每次最多 10 个）</Label>
      <Textarea id={id} rows={4} value={text} disabled={mutation.isPending}
        onChange={event => { setText(event.target.value); setReceipt(null); }}
        placeholder={"B0FKN88MFL\nB0G3WN7CL2\n也可粘贴多个美国站商品链接"} className="font-mono text-sm" />
      <p className="text-xs text-muted-foreground">支持换行、空格、逗号或分号分隔。关闭页面后仍会继续采集，可在任务记录查看进度。</p>
    </div>
    {text.trim() && <div className="space-y-2 text-sm" aria-live="polite">
      <p>已识别 <strong>{parsed.asins.length}</strong> 个 ASIN</p>
      <div className="flex flex-wrap gap-2">{parsed.asins.map(asin => <span key={asin} className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{asin}</span>)}</div>
      {!!parsed.repeated.length && <p className="text-muted-foreground">本次输入重复，已合并：{parsed.repeated.join("、")}</p>}
      {!!parsed.invalid.length && <p className="break-all text-destructive">无法识别，请修改：{parsed.invalid.join("、")}</p>}
      {parsed.asins.length > 10 && <p className="text-destructive">每次最多 10 个，请分批提交；不会截断输入。</p>}
    </div>}
    {mode === "new_version" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">重新获取最新图片并保存独立版本，显示为“新 ASIN”“新2 ASIN”等，旧版图片和标签保留。</p>}
    <Button onClick={submit} disabled={!valid || mutation.isPending || Boolean(receipt)} className="gap-2">
      {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {mutation.isPending ? "正在提交…" : mode === "new_version" ? "开始采集新版本" : "开始顺序采集"}
    </Button>
    {receipt && <div className="space-y-2 rounded-lg border p-3 text-sm" aria-live="polite">
      <p className="font-medium">已创建 {receipt.items.length} 个任务，排除 {receipt.skippedItems.length} 个 ASIN</p>
      {receipt.skippedItems.map(item => <p key={item.asin} className="text-amber-800">{item.asin}：{skipLabels[item.reason]}</p>)}
      {receipt.items.map((item, index) => <div key={item.jobId} className="flex items-center justify-between gap-2">
        <span>{index + 1}. {item.displayAsin}</span><Link className="text-primary underline" href={`/knowledge/acquisition/job/${item.jobId}`}>查看采集情况</Link>
      </div>)}
    </div>}
  </div>;
}
