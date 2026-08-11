import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Unlock,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type InsightResult = {
  priceBands: Array<{ label: string; min: number; max: number; reason?: string }>;
  competitors: Array<{ asin: string; name?: string; brand?: string; reason?: string }>;
  sections: Array<{
    key: "selling_points" | "parameters" | "positive_reviews" | "negative_reviews";
    label: string;
    rows: Array<{ item: string; necessity?: string; cells: Record<string, string>; ours?: string; manualNote?: string }>;
  }>;
  summary?: string;
};

function cloneResult(value: InsightResult): InsightResult {
  return JSON.parse(JSON.stringify(value));
}

function statusLabel(status?: string | null) {
  switch (status) {
    case "queued": return "排队中";
    case "running": return "分析中";
    case "ready": return "待确认";
    case "editing": return "编辑中";
    case "confirmed": return "已锁定";
    case "failed": return "失败";
    case "canceled": return "已取消";
    default: return "未生成";
  }
}

function displayCell(value?: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["✓", "√", "true", "yes", "有"].includes(normalized)) {
    return <Check className="h-4 w-4 text-emerald-600 mx-auto" />;
  }
  return value || <span className="text-muted-foreground/40">-</span>;
}

export default function MajorCompetitorAnalysis({
  projectId,
  panoramaConfirmed,
  selectedCompetitorAsins,
  onSelectedCompetitorAsinsChange,
}: {
  projectId: number;
  panoramaConfirmed: boolean;
  selectedCompetitorAsins: string[];
  onSelectedCompetitorAsinsChange: (asins: string[]) => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.devPanorama.getMarketInsight.useQuery(
    { projectId },
    {
      refetchInterval: (state) => {
        const status = state.state.data?.status;
        return status === "queued" || status === "running" ? 2_000 : false;
      },
    },
  );
  const insight = query.data;
  const [draft, setDraft] = useState<InsightResult | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (insight?.result) setDraft(cloneResult(insight.result as InsightResult));
    if (insight?.status === "confirmed") setEditing(false);
  }, [insight?.result, insight?.status, insight?.version]);

  useEffect(() => {
    if (selectedCompetitorAsins.length > 0 || !insight?.result || insight.runError?.includes("全景产品已")) return;
    const analyzedAsins = (insight.result as InsightResult).competitors
      .map((competitor) => String(competitor.asin || "").trim().toUpperCase())
      .filter(Boolean);
    if (analyzedAsins.length >= 2 && analyzedAsins.length <= 4) {
      onSelectedCompetitorAsinsChange(analyzedAsins);
    }
  }, [insight?.result, insight?.runError, onSelectedCompetitorAsinsChange, selectedCompetitorAsins.length]);

  const refresh = async () => {
    await Promise.all([
      utils.devPanorama.getMarketInsight.invalidate({ projectId }),
      utils.devPanorama.getData.invalidate({ projectId }),
    ]);
  };
  const generate = trpc.devPanorama.generateMarketInsight.useMutation({
    onSuccess: () => { toast.success("主要竞争对手分析已进入后台队列"); void refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const cancel = trpc.devPanorama.cancelMarketInsight.useMutation({
    onSuccess: () => { toast.success("任务已取消"); void refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const save = trpc.devPanorama.saveMarketInsight.useMutation({
    onSuccess: () => { toast.success("人工编辑版本已保存"); setEditing(false); void refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const confirm = trpc.devPanorama.confirmMarketInsight.useMutation({
    onSuccess: () => { toast.success("主要竞争对手分析已确认锁定"); setEditing(false); void refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const unlock = trpc.devPanorama.unlockMarketInsight.useMutation({
    onSuccess: () => { toast.success("已解锁编辑"); setEditing(true); void refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const running = insight?.status === "queued" || insight?.status === "running";
  const confirmed = insight?.status === "confirmed";
  const progress = insight?.job?.progress ?? insight?.runProgress ?? 0;
  const busy = generate.isPending || cancel.isPending || save.isPending || confirm.isPending || unlock.isPending;
  const validSelection = selectedCompetitorAsins.length >= 2 && selectedCompetitorAsins.length <= 4;
  const canGenerate = panoramaConfirmed && validSelection;
  const analysisInvalidated = Boolean(insight?.runError?.includes("全景产品已"));
  const analyzedCompetitorAsins = useMemo(
    () => (draft?.competitors || []).map((competitor) => String(competitor.asin || "").trim().toUpperCase()),
    [draft?.competitors],
  );
  const selectionMatchesDraft = analyzedCompetitorAsins.length === selectedCompetitorAsins.length
    && analyzedCompetitorAsins.every((asin) => selectedCompetitorAsins.includes(asin));
  const sectionTone = useMemo(() => ({
    selling_points: "bg-emerald-50 text-emerald-800",
    parameters: "bg-sky-50 text-sky-800",
    positive_reviews: "bg-teal-50 text-teal-800",
    negative_reviews: "bg-amber-50 text-amber-900",
  }), []);

  const patchBand = (index: number, field: "label" | "min" | "max" | "reason", value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneResult(current);
      (next.priceBands[index] as any)[field] = field === "min" || field === "max" ? Number(value) : value;
      return next;
    });
  };

  const patchRow = (sectionIndex: number, rowIndex: number, field: string, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneResult(current);
      const row = next.sections[sectionIndex].rows[rowIndex];
      if (field.startsWith("cell:")) row.cells[field.slice(5)] = value;
      else (row as any)[field] = value;
      return next;
    });
  };

  const addRow = (sectionIndex: number) => {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneResult(current);
      next.sections[sectionIndex].rows.push({ item: "新增项目", necessity: "", cells: {}, ours: "", manualNote: "" });
      return next;
    });
  };

  const removeRow = (sectionIndex: number, rowIndex: number) => {
    setDraft((current) => {
      if (!current || current.sections[sectionIndex].rows.length <= 1) return current;
      const next = cloneResult(current);
      next.sections[sectionIndex].rows.splice(rowIndex, 1);
      return next;
    });
  };

  const runAnalysis = () => {
    if (!canGenerate) {
      toast.error(!panoramaConfirmed
        ? "请先确认锁定全景分析表"
        : "请先在全景分析表勾选 2-4 个主要竞争对手");
      return;
    }
    generate.mutate({ projectId, competitorAsins: selectedCompetitorAsins });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">主要竞争对手分析</CardTitle>
            <Badge variant="secondary">{statusLabel(insight?.status)}</Badge>
            {insight?.version ? <Badge variant="outline">v{insight.version}</Badge> : null}
          </div>
          <div className="flex items-center gap-2">
            {running ? (
              <Button size="sm" variant="outline" onClick={() => cancel.mutate({ projectId })} disabled={busy}>
                <XCircle className="h-4 w-4 mr-1" />取消
              </Button>
            ) : confirmed ? (
              <Button size="sm" variant="outline" onClick={() => unlock.mutate({ projectId })} disabled={busy}>
                <Unlock className="h-4 w-4 mr-1" />解锁编辑
              </Button>
            ) : draft ? (
              <>
                {editing ? (
                  <Button size="sm" variant="outline" onClick={() => save.mutate({ projectId, result: draft })} disabled={busy}>
                    <Save className="h-4 w-4 mr-1" />保存版本
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
                    <Pencil className="h-4 w-4 mr-1" />编辑
                  </Button>
                )}
                <Button size="sm" onClick={() => confirm.mutate({ projectId, result: draft })} disabled={busy || !selectionMatchesDraft || analysisInvalidated}>
                  <Lock className="h-4 w-4 mr-1" />确认锁定
                </Button>
                <Button size="sm" variant="ghost" onClick={runAnalysis} disabled={busy || !canGenerate}>
                  <Sparkles className="h-4 w-4 mr-1" />分析已选 {selectedCompetitorAsins.length} 个
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={runAnalysis} disabled={busy || !canGenerate}>
                <Sparkles className="h-4 w-4 mr-1" />分析已选 {selectedCompetitorAsins.length} 个
              </Button>
            )}
          </div>
        </div>
        {running ? (
          <div className="space-y-1 pt-2">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />后台分析中 {progress}%</p>
          </div>
        ) : null}
        {insight?.runError && !running ? (
          <p className="text-xs text-destructive flex items-center gap-1 pt-2"><AlertCircle className="h-3.5 w-3.5" />{insight.runError}</p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
          <div>
            <p className="text-sm font-medium">已从全景分析表选择 {selectedCompetitorAsins.length} 个竞争对手</p>
            <p className="text-xs text-muted-foreground">
              {panoramaConfirmed ? "请在上方表格“主要竞品”列勾选 2-4 个父体销量计入行。" : "删除或编辑后，请先重新确认锁定全景分析表。"}
            </p>
          </div>
          <div className="flex max-w-[55%] flex-wrap justify-end gap-1">
            {selectedCompetitorAsins.map((asin) => <Badge key={asin} variant="outline">{asin}</Badge>)}
          </div>
        </div>
        {draft && (!selectionMatchesDraft || analysisInvalidated) ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {analysisInvalidated
              ? "产品数据已发生变化，请重新确认全景表并执行主要竞争对手分析。"
              : `当前勾选与现有分析版本不一致，请先点击“分析已选 ${selectedCompetitorAsins.length} 个”，生成完成后再确认锁定。`}
          </div>
        ) : null}
        {!draft && !running ? (
          <div className="border border-dashed rounded-md py-12 text-center text-sm text-muted-foreground">
            价格结构与主要竞品矩阵尚未生成
          </div>
        ) : null}

        {draft ? (
          <>
            <section className="space-y-2">
              <div className="flex items-center gap-2"><span className="text-sm font-semibold">AI 价格区间</span><Badge variant="outline">{draft.priceBands.length} 段</Badge></div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                {draft.priceBands.map((band, index) => (
                  <div key={`${band.label}-${index}`} className="border rounded-md p-2 space-y-1 min-w-0">
                    {editing ? (
                      <>
                        <Input className="h-7 text-xs" value={band.label} onChange={(event) => patchBand(index, "label", event.target.value)} />
                        <div className="grid grid-cols-2 gap-1">
                          <Input className="h-7 text-xs" type="number" value={band.min} onChange={(event) => patchBand(index, "min", event.target.value)} />
                          <Input className="h-7 text-xs" type="number" value={band.max} onChange={(event) => patchBand(index, "max", event.target.value)} />
                        </div>
                        <Input className="h-7 text-xs" value={band.reason || ""} onChange={(event) => patchBand(index, "reason", event.target.value)} />
                      </>
                    ) : (
                      <><p className="text-sm font-medium truncate">{band.label}</p><p className="text-xs text-muted-foreground line-clamp-2">{band.reason}</p></>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              {draft.sections.map((section, sectionIndex) => (
                <div key={section.key} className="border rounded-md overflow-hidden">
                  <div className={`px-3 py-2 flex items-center justify-between ${sectionTone[section.key]}`}>
                    <span className="text-sm font-semibold">{section.label}</span>
                    {editing ? (
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => addRow(sectionIndex)}><Plus className="h-3.5 w-3.5 mr-1" />增加一行</Button>
                    ) : null}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-xs border-collapse table-fixed">
                      <thead className="bg-muted/60">
                        <tr>
                          <th className="w-10 px-2 py-2 border-r text-center">#</th>
                          <th className="w-40 px-2 py-2 border-r text-left">分析项目</th>
                          <th className="w-36 px-2 py-2 border-r text-left">必要性/备注</th>
                          {draft.competitors.map((competitor) => (
                            <th key={competitor.asin} className="w-44 px-2 py-2 border-r text-left">
                              <div className="font-semibold">{competitor.name || competitor.brand || competitor.asin}</div>
                              <div className="font-normal text-muted-foreground">{competitor.asin}</div>
                            </th>
                          ))}
                          <th className="w-44 px-2 py-2 border-r text-left">我们的</th>
                          <th className="w-48 px-2 py-2 text-left">人工备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row, rowIndex) => (
                          <tr key={`${section.key}-${rowIndex}`} className="border-t align-top">
                            <td className="px-2 py-2 border-r text-center">
                              {editing ? <button className="text-muted-foreground hover:text-destructive" onClick={() => removeRow(sectionIndex, rowIndex)}><Trash2 className="h-3.5 w-3.5" /></button> : rowIndex + 1}
                            </td>
                            <td className="px-2 py-2 border-r">{editing ? <Textarea rows={2} value={row.item} onChange={(event) => patchRow(sectionIndex, rowIndex, "item", event.target.value)} /> : row.item}</td>
                            <td className="px-2 py-2 border-r">{editing ? <Textarea rows={2} value={row.necessity || ""} onChange={(event) => patchRow(sectionIndex, rowIndex, "necessity", event.target.value)} /> : displayCell(row.necessity)}</td>
                            {draft.competitors.map((competitor) => (
                              <td key={competitor.asin} className="px-2 py-2 border-r break-words">
                                {editing ? <Textarea rows={2} value={row.cells[competitor.asin] || ""} onChange={(event) => patchRow(sectionIndex, rowIndex, `cell:${competitor.asin}`, event.target.value)} /> : displayCell(row.cells[competitor.asin])}
                              </td>
                            ))}
                            <td className="px-2 py-2 border-r break-words">{editing ? <Textarea rows={2} value={row.ours || ""} onChange={(event) => patchRow(sectionIndex, rowIndex, "ours", event.target.value)} /> : displayCell(row.ours)}</td>
                            <td className="px-2 py-2 break-words">{editing ? <Textarea rows={2} value={row.manualNote || ""} onChange={(event) => patchRow(sectionIndex, rowIndex, "manualNote", event.target.value)} /> : displayCell(row.manualNote)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <p className="text-sm font-semibold">竞争结论</p>
              {editing ? <Textarea rows={4} value={draft.summary || ""} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /> : <p className="text-sm leading-6 whitespace-pre-wrap">{draft.summary}</p>}
            </section>

            {confirmed ? (
              <div className="flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />该版本已锁定，供后续市场分析读取。</div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
