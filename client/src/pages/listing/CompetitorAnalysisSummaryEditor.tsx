import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Check,
  CheckCircle2,
  FilePenLine,
  Loader2,
  LockKeyhole,
  RotateCcw,
  Save,
  Sparkles,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

type CompetitorAnalysisSummaryEditorProps = {
  projectId: number;
  analysis: {
    id: number;
    asin: string;
    rawData: string | null;
    aiSummary: string | null;
    summary: string | null;
    summaryStatus: "draft" | "confirmed";
    summaryVersion: number;
    summaryConfirmedAt: Date | string | null;
  };
};

function parseJson(value: string | null): any {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return String(record.sellingPoint || record.point || record.feature || JSON.stringify(item));
    }
    return String(item);
  });
}

function list(items: string[], fallback: string) {
  return (items.length ? items : [fallback]).map(item => `- ${item}`).join("\n");
}

function fallbackSummary(rawData: string | null): string {
  const raw = parseJson(rawData) || {};
  const summary = raw.summary || {};
  const sellingPoints = stringList(summary.coreSellingPoints).length
    ? stringList(summary.coreSellingPoints)
    : stringList(raw.bulletPointsAnalysis);
  const strengths = stringList(summary.strengths).length
    ? stringList(summary.strengths)
    : stringList(raw.advantages);
  const weaknesses = stringList(summary.weaknesses).length
    ? stringList(summary.weaknesses)
    : stringList(raw.weaknesses);
  return [
    "## 定位概览",
    String(summary.overview || raw.competitivePositioning || "请结合标题、价格、评分与评论数据补充竞品定位。"),
    "",
    "## 核心卖点",
    list(sellingPoints, "暂无明确核心卖点"),
    "",
    "## 值得参考的优秀点",
    list(strengths, "暂无明确优势"),
    "",
    "## 可超越的弱点",
    list(weaknesses, "暂无明确弱点"),
    "",
    "## Listing 借鉴建议",
    list(stringList(summary.listingLessons), "请结合本品属性补充差异化表达"),
  ].join("\n");
}

export function CompetitorAnalysisSummaryEditor({
  projectId,
  analysis,
}: CompetitorAnalysisSummaryEditorProps) {
  const utils = trpc.useUtils();
  const initialSummary = useMemo(
    () => analysis.summary || analysis.aiSummary || fallbackSummary(analysis.rawData),
    [analysis.aiSummary, analysis.rawData, analysis.summary],
  );
  const [draft, setDraft] = useState(initialSummary);
  const [isEditing, setIsEditing] = useState(false);
  const isConfirmed = analysis.summaryStatus === "confirmed";

  useEffect(() => {
    setDraft(initialSummary);
    setIsEditing(false);
  }, [analysis.id, analysis.summaryStatus, initialSummary]);

  const refresh = async () => {
    await utils.analysis.listByProject.invalidate({ projectId });
  };

  const updateMutation = trpc.analysis.updateSummary.useMutation({
    onSuccess: async () => {
      await refresh();
      setIsEditing(false);
      toast.success("竞品分析总结已保存");
    },
    onError: error => toast.error("保存失败", { description: error.message }),
  });
  const confirmMutation = trpc.analysis.confirmSummary.useMutation({
    onSuccess: async () => {
      await refresh();
      setIsEditing(false);
      toast.success("竞品分析已确认并锁定");
    },
    onError: error => toast.error("确认失败", { description: error.message }),
  });
  const unlockMutation = trpc.analysis.unlockSummary.useMutation({
    onSuccess: async () => {
      await refresh();
      setIsEditing(true);
      toast.success("已解锁，可以继续编辑");
    },
    onError: error => toast.error("解锁失败", { description: error.message }),
  });
  const isPending = updateMutation.isPending || confirmMutation.isPending || unlockMutation.isPending;

  const confirm = () => {
    if (!draft.trim()) {
      toast.error("总结不能为空");
      return;
    }
    confirmMutation.mutate({ projectId, analysisId: analysis.id, summary: draft });
  };

  return (
    <section className="mb-4 border bg-muted/20">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <h4 className="text-sm font-semibold">竞品分析总结</h4>
            <p className="text-xs text-muted-foreground">确认后的版本将作为 Listing 下游正式输入</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isConfirmed ? "default" : "secondary"} className="gap-1">
            {isConfirmed ? <LockKeyhole className="h-3 w-3" /> : <FilePenLine className="h-3 w-3" />}
            {isConfirmed ? "已确认" : "待确认"} · v{analysis.summaryVersion}
          </Badge>
          {isConfirmed ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => unlockMutation.mutate({ projectId, analysisId: analysis.id })}
            >
              {unlockMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UnlockKeyhole className="h-4 w-4" />}
              解锁编辑
            </Button>
          ) : isEditing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => { setDraft(initialSummary); setIsEditing(false); }}
              >
                <X className="h-4 w-4" />
                取消
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending || !draft.trim()}
                onClick={() => updateMutation.mutate({ projectId, analysisId: analysis.id, summary: draft })}
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存草稿
              </Button>
              <Button size="sm" disabled={isPending || !draft.trim()} onClick={confirm}>
                {confirmMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                确认并锁定
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => setIsEditing(true)}>
                <FilePenLine className="h-4 w-4" />
                编辑
              </Button>
              <Button size="sm" disabled={isPending} onClick={confirm}>
                {confirmMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                确认结果
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="p-4">
        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              rows={14}
              className="min-h-[280px] resize-y bg-background font-mono text-sm leading-6"
              placeholder="按“定位概览、核心卖点、优秀点、弱点、Listing 借鉴建议”编辑总结"
              disabled={isPending}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>支持 Markdown 结构，保存草稿不会锁定。</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                disabled={isPending}
                onClick={() => setDraft(analysis.aiSummary || fallbackSummary(analysis.rawData))}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                恢复 AI 原稿
              </Button>
            </div>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90">
            <Streamdown>{draft}</Streamdown>
          </div>
        )}
      </div>
    </section>
  );
}
