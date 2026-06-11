import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, AlertTriangle, Frown, Lightbulb, Sparkles,
  Pencil, Check, X, Trash2, Plus, MessageSquareText, Save,
  ChevronDown, ChevronUp, Info, Filter, ArrowUpDown,
} from "lucide-react";

type KanoPoint = {
  point: string;
  frequency: string;
  severity?: string;
  importance?: string;
  impact?: string;
  quotes?: string[];
  sourceAsins?: string[];
  listingAdvice?: string;
};

const FREQ_OPTIONS = ["high", "medium", "low"];
const SEVERITY_OPTIONS = ["critical", "major", "minor"];
const IMPORTANCE_OPTIONS = ["high", "medium", "low"];

const freqLabel: Record<string, string> = { high: "高频", medium: "中频", low: "低频" };
const severityLabel: Record<string, string> = { critical: "严重", major: "较重", minor: "轻微" };
const importanceLabel: Record<string, string> = { high: "高", medium: "中", low: "低" };

// Sorting weight maps
const FREQ_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };
const SEVERITY_WEIGHT: Record<string, number> = { critical: 3, major: 2, minor: 1, high: 3, medium: 2, low: 1 };

type SortMode = "default" | "severity_desc" | "severity_asc" | "frequency_desc" | "frequency_asc";

function FreqBadge({ freq }: { freq: string }) {
  const color = freq === "high" ? "bg-red-100 text-red-700" : freq === "medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";
  return <Badge variant="outline" className={`${color} text-xs`}>{freqLabel[freq] || freq}</Badge>;
}

function SeverityBadge({ level, type }: { level: string; type: "severity" | "importance" | "impact" }) {
  const labels = type === "severity" ? severityLabel : importanceLabel;
  const color = level === "critical" || level === "high" ? "bg-red-100 text-red-700" : level === "major" || level === "medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";
  return <Badge variant="outline" className={`${color} text-xs`}>{labels[level] || level}</Badge>;
}

function KanoPointEditor({
  point,
  type,
  onSave,
  onDelete,
}: {
  point: KanoPoint;
  type: "pain" | "itch" | "delight";
  onSave: (updated: KanoPoint) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<KanoPoint>({ ...point });

  const levelField = type === "pain" ? "severity" : type === "itch" ? "importance" : "impact";
  const levelOptions = type === "pain" ? SEVERITY_OPTIONS : IMPORTANCE_OPTIONS;
  const levelValue = (draft as any)[levelField] || "medium";

  if (editing) {
    return (
      <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">描述</label>
          <Textarea
            value={draft.point}
            onChange={(e) => setDraft({ ...draft, point: e.target.value })}
            rows={2}
            className="resize-none text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">频率</label>
            <Select value={draft.frequency} onValueChange={(v) => setDraft({ ...draft, frequency: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQ_OPTIONS.map(o => <SelectItem key={o} value={o}>{freqLabel[o]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{type === "pain" ? "严重度" : "重要度"}</label>
            <Select value={levelValue} onValueChange={(v) => setDraft({ ...draft, [levelField]: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {levelOptions.map(o => <SelectItem key={o} value={o}>{importanceLabel[o]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Listing建议</label>
          <Textarea
            value={draft.listingAdvice || ""}
            onChange={(e) => setDraft({ ...draft, listingAdvice: e.target.value })}
            rows={2}
            className="resize-none text-sm"
            placeholder="如何在Listing中体现这一点..."
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft({ ...point }); }}>
            <X className="h-3 w-3 mr-1" /> 取消
          </Button>
          <Button size="sm" variant="destructive" onClick={onDelete}>
            <Trash2 className="h-3 w-3 mr-1" /> 删除
          </Button>
          <Button size="sm" onClick={() => { onSave(draft); setEditing(false); }}>
            <Check className="h-3 w-3 mr-1" /> 保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-3 hover:bg-muted/20 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{point.point}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <FreqBadge freq={point.frequency} />
            <SeverityBadge level={(point as any)[levelField] || "medium"} type={levelField as any} />
            {point.sourceAsins?.length ? (
              <span className="text-xs text-muted-foreground">
                来源: {point.sourceAsins.join(", ")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 text-xs">
          {point.listingAdvice && (
            <div className="bg-primary/5 rounded p-2">
              <span className="font-medium text-primary">Listing建议: </span>
              {point.listingAdvice}
            </div>
          )}
          {point.quotes && point.quotes.length > 0 && (
            <div className="space-y-1">
              <span className="font-medium text-muted-foreground">原文引用:</span>
              {point.quotes.map((q, i) => (
                <p key={i} className="pl-3 border-l-2 border-muted text-muted-foreground italic">"{q}"</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helper: filter and sort Kano points ───────────────────────
function filterAndSortPoints(
  points: KanoPoint[],
  asinFilter: string[],
  sortMode: SortMode,
  levelField: string,
): KanoPoint[] {
  let filtered = points;

  // ASIN filter
  if (asinFilter.length > 0) {
    filtered = filtered.filter(p =>
      p.sourceAsins?.some(a => asinFilter.includes(a))
    );
  }

  // Sort
  if (sortMode !== "default") {
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortMode === "severity_desc" || sortMode === "severity_asc") {
        const wa = SEVERITY_WEIGHT[(a as any)[levelField] || "medium"] || 2;
        const wb = SEVERITY_WEIGHT[(b as any)[levelField] || "medium"] || 2;
        return sortMode === "severity_desc" ? wb - wa : wa - wb;
      }
      if (sortMode === "frequency_desc" || sortMode === "frequency_asc") {
        const wa = FREQ_WEIGHT[a.frequency] || 2;
        const wb = FREQ_WEIGHT[b.frequency] || 2;
        return sortMode === "frequency_desc" ? wb - wa : wa - wb;
      }
      return 0;
    });
    return sorted;
  }

  return filtered;
}

// ─── Helper: extract all unique ASINs from Kano points ─────────
function extractAllAsins(pain: KanoPoint[], itch: KanoPoint[], delight: KanoPoint[]): string[] {
  const set = new Set<string>();
  [...pain, ...itch, ...delight].forEach(p => {
    p.sourceAsins?.forEach(a => { if (a) set.add(a); });
  });
  return Array.from(set).sort();
}

export default function ReviewAggregationPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Filter & sort state
  const [asinFilter, setAsinFilter] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("default");

  // Local editable state
  const [localPainPoints, setLocalPainPoints] = useState<KanoPoint[]>([]);
  const [localItchPoints, setLocalItchPoints] = useState<KanoPoint[]>([]);
  const [localDelightPoints, setLocalDelightPoints] = useState<KanoPoint[]>([]);

  const projectsQuery = trpc.project.list.useQuery();
  const projects = projectsQuery.data || [];

  // Auto-select first project
  const effectiveProjectId = selectedProjectId || projects[0]?.id || null;

  const aggregationQuery = trpc.reviewAggregation.get.useQuery(
    { projectId: effectiveProjectId! },
    { enabled: !!effectiveProjectId }
  );

  const analyzeMutation = trpc.reviewAggregation.analyze.useMutation({
    onSuccess: (data) => {
      toast.success(`聚合分析完成，已分析 ${data?.analysisCount || 0} 个竞品的评论数据`);
      aggregationQuery.refetch();
    },
    onError: (err) => {
      toast.error(`分析失败: ${err.message}`);
    },
  });

  const updatePointsMutation = trpc.reviewAggregation.updatePoints.useMutation({
    onSuccess: () => {
      toast.success("评论分析结果已保存");
      setHasChanges(false);
      aggregationQuery.refetch();
    },
    onError: (err) => {
      toast.error(`保存失败: ${err.message}`);
    },
  });

  // Sync server data to local state when data loads
  const aggregation = aggregationQuery.data;
  useMemo(() => {
    if (aggregation && aggregation.status === "completed") {
      try { setLocalPainPoints(JSON.parse(aggregation.painPoints || "[]")); } catch { setLocalPainPoints([]); }
      try { setLocalItchPoints(JSON.parse(aggregation.itchPoints || "[]")); } catch { setLocalItchPoints([]); }
      try { setLocalDelightPoints(JSON.parse(aggregation.delightPoints || "[]")); } catch { setLocalDelightPoints([]); }
      setHasChanges(false);
    }
  }, [aggregation?.id, aggregation?.updatedAt?.toString()]);

  // Extract all available ASINs for filter
  const allAsins = useMemo(
    () => extractAllAsins(localPainPoints, localItchPoints, localDelightPoints),
    [localPainPoints, localItchPoints, localDelightPoints]
  );

  // Filtered & sorted points for display
  const displayPainPoints = useMemo(
    () => filterAndSortPoints(localPainPoints, asinFilter, sortMode, "severity"),
    [localPainPoints, asinFilter, sortMode]
  );
  const displayItchPoints = useMemo(
    () => filterAndSortPoints(localItchPoints, asinFilter, sortMode, "importance"),
    [localItchPoints, asinFilter, sortMode]
  );
  const displayDelightPoints = useMemo(
    () => filterAndSortPoints(localDelightPoints, asinFilter, sortMode, "impact"),
    [localDelightPoints, asinFilter, sortMode]
  );

  const handleSaveAll = () => {
    if (!effectiveProjectId) return;
    updatePointsMutation.mutate({
      projectId: effectiveProjectId,
      painPoints: JSON.stringify(localPainPoints),
      itchPoints: JSON.stringify(localItchPoints),
      delightPoints: JSON.stringify(localDelightPoints),
    });
  };

  const updatePoint = (category: "pain" | "itch" | "delight", index: number, updated: KanoPoint) => {
    // Find the original index in the unfiltered array
    const originalPoints = category === "pain" ? localPainPoints : category === "itch" ? localItchPoints : localDelightPoints;
    const displayPoints = category === "pain" ? displayPainPoints : category === "itch" ? displayItchPoints : displayDelightPoints;
    const displayItem = displayPoints[index];
    const originalIndex = originalPoints.indexOf(displayItem);
    if (originalIndex === -1) return;

    if (category === "pain") {
      const arr = [...localPainPoints]; arr[originalIndex] = updated; setLocalPainPoints(arr);
    } else if (category === "itch") {
      const arr = [...localItchPoints]; arr[originalIndex] = updated; setLocalItchPoints(arr);
    } else {
      const arr = [...localDelightPoints]; arr[originalIndex] = updated; setLocalDelightPoints(arr);
    }
    setHasChanges(true);
  };

  const deletePoint = (category: "pain" | "itch" | "delight", index: number) => {
    const originalPoints = category === "pain" ? localPainPoints : category === "itch" ? localItchPoints : localDelightPoints;
    const displayPoints = category === "pain" ? displayPainPoints : category === "itch" ? displayItchPoints : displayDelightPoints;
    const displayItem = displayPoints[index];
    const originalIndex = originalPoints.indexOf(displayItem);
    if (originalIndex === -1) return;

    if (category === "pain") {
      setLocalPainPoints(localPainPoints.filter((_, i) => i !== originalIndex));
    } else if (category === "itch") {
      setLocalItchPoints(localItchPoints.filter((_, i) => i !== originalIndex));
    } else {
      setLocalDelightPoints(localDelightPoints.filter((_, i) => i !== originalIndex));
    }
    setHasChanges(true);
  };

  const addPoint = (category: "pain" | "itch" | "delight") => {
    const newPoint: KanoPoint = {
      point: "",
      frequency: "medium",
      ...(category === "pain" ? { severity: "minor" } : category === "itch" ? { importance: "medium" } : { impact: "medium" }),
      quotes: [],
      sourceAsins: [],
      listingAdvice: "",
    };
    if (category === "pain") setLocalPainPoints([...localPainPoints, newPoint]);
    else if (category === "itch") setLocalItchPoints([...localItchPoints, newPoint]);
    else setLocalDelightPoints([...localDelightPoints, newPoint]);
    setHasChanges(true);
  };

  const toggleAsinFilter = (asin: string) => {
    setAsinFilter(prev =>
      prev.includes(asin) ? prev.filter(a => a !== asin) : [...prev, asin]
    );
  };

  const renderCategory = (
    title: string,
    icon: React.ReactNode,
    displayPoints: KanoPoint[],
    totalCount: number,
    category: "pain" | "itch" | "delight",
    colorClass: string,
    description: string,
  ) => (
    <Card className={`border-l-4 ${colorClass}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title} ({displayPoints.length}{displayPoints.length !== totalCount ? `/${totalCount}` : ""})
          </CardTitle>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addPoint(category)}>
            <Plus className="h-3 w-3 mr-1" /> 添加
          </Button>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {displayPoints.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {totalCount > 0 ? "当前筛选条件下无匹配数据" : "暂无数据，点击\"添加\"手动录入或运行聚合分析"}
          </p>
        ) : (
          displayPoints.map((p, i) => (
            <KanoPointEditor
              key={`${category}-${i}-${p.point.slice(0, 20)}`}
              point={p}
              type={category}
              onSave={(updated) => updatePoint(category, i, updated)}
              onDelete={() => deletePoint(category, i)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquareText className="h-6 w-6" />
            评论聚合分析
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            基于卡诺模型（Kano Model）聚合所有竞品评论，提取痛点/痒点/爽点，可编辑调整后供Listing生成使用
          </p>
        </div>
      </div>

      {/* Project selector + actions */}
      <div className="flex items-center gap-4 flex-wrap">
        <Select
          value={effectiveProjectId?.toString() || ""}
          onValueChange={(v) => setSelectedProjectId(Number(v))}
        >
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="选择项目" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p: any) => (
              <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={() => effectiveProjectId && analyzeMutation.mutate({ projectId: effectiveProjectId })}
          disabled={!effectiveProjectId || analyzeMutation.isPending}
        >
          {analyzeMutation.isPending ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> AI分析中...</>
          ) : (
            <><RefreshCw className="h-4 w-4 mr-2" /> 运行聚合分析</>
          )}
        </Button>

        {hasChanges && (
          <Button onClick={handleSaveAll} disabled={updatePointsMutation.isPending} variant="default">
            {updatePointsMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 保存中...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" /> 保存修改</>
            )}
          </Button>
        )}
      </div>

      {/* Filter & Sort toolbar */}
      {aggregation?.status === "completed" && allAsins.length > 0 && (
        <Card className="bg-muted/20">
          <CardContent className="py-3 space-y-3">
            {/* ASIN filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground shrink-0">
                <Filter className="h-4 w-4" />
                按ASIN筛选:
              </div>
              {allAsins.map(asin => (
                <Badge
                  key={asin}
                  variant={asinFilter.includes(asin) ? "default" : "outline"}
                  className="cursor-pointer select-none transition-colors hover:bg-primary/10"
                  onClick={() => toggleAsinFilter(asin)}
                >
                  {asin}
                </Badge>
              ))}
              {asinFilter.length > 0 && (
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setAsinFilter([])}>
                  清除筛选
                </Button>
              )}
            </div>
            {/* Sort selector */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground shrink-0">
                <ArrowUpDown className="h-4 w-4" />
                排序方式:
              </div>
              <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                <SelectTrigger className="w-[200px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">默认顺序</SelectItem>
                  <SelectItem value="severity_desc">严重程度 高→低</SelectItem>
                  <SelectItem value="severity_asc">严重程度 低→高</SelectItem>
                  <SelectItem value="frequency_desc">出现频率 高→低</SelectItem>
                  <SelectItem value="frequency_asc">出现频率 低→高</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status info */}
      {aggregation && (
        <Card className="bg-muted/30">
          <CardContent className="py-3 flex items-center gap-4 text-sm">
            <Info className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>
              已分析 <strong>{aggregation.analysisCount}</strong> 个竞品评论 |
              状态: <Badge variant={aggregation.status === "completed" ? "default" : aggregation.status === "analyzing" ? "secondary" : "destructive"} className="text-xs ml-1">
                {aggregation.status === "completed" ? "已完成" : aggregation.status === "analyzing" ? "分析中" : aggregation.status === "failed" ? "失败" : "待分析"}
              </Badge>
              {aggregation.updatedAt && (
                <span className="text-muted-foreground ml-2">
                  更新于 {new Date(aggregation.updatedAt).toLocaleString()}
                </span>
              )}
            </span>
            {aggregation.overallSentiment && (
              <span className="text-muted-foreground border-l pl-4 ml-2">
                市场情绪: {aggregation.overallSentiment}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Kano Model Categories */}
      {aggregation?.status === "analyzing" && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
          <span className="text-muted-foreground">AI正在聚合分析所有竞品评论...</span>
        </div>
      )}

      {(!aggregation || aggregation.status === "completed") && effectiveProjectId && (
        <div className="grid grid-cols-1 gap-6">
          {renderCategory(
            "痛点 (Pain Points)",
            <Frown className="h-5 w-5 text-red-500" />,
            displayPainPoints,
            localPainPoints.length,
            "pain",
            "border-l-red-500",
            "Must-Be Quality — 客户的基本需求，未满足则极度不满。在Listing中需要明确解决这些问题。"
          )}
          {renderCategory(
            "痒点 (Itch Points)",
            <Lightbulb className="h-5 w-5 text-amber-500" />,
            displayItchPoints,
            localItchPoints.length,
            "itch",
            "border-l-amber-500",
            "One-Dimensional Quality — 客户的期望需求，满足程度与满意度成正比。在Listing中可作为差异化卖点。"
          )}
          {renderCategory(
            "爽点 (Delight Points)",
            <Sparkles className="h-5 w-5 text-green-500" />,
            displayDelightPoints,
            localDelightPoints.length,
            "delight",
            "border-l-green-500",
            "Attractive Quality — 超出客户预期的惊喜功能。在Listing中重点突出可大幅提升转化率。"
          )}
        </div>
      )}

      {/* Key Themes */}
      {aggregation?.keyThemes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">关键主题</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(() => {
                try {
                  const themes = JSON.parse(aggregation.keyThemes);
                  return Array.isArray(themes) ? themes.map((t: string, i: number) => (
                    <Badge key={i} variant="secondary">{t}</Badge>
                  )) : null;
                } catch { return null; }
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hint */}
      {!aggregation && effectiveProjectId && (
        <Card className="bg-muted/20">
          <CardContent className="py-8 text-center">
            <MessageSquareText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">尚未进行评论聚合分析</h3>
            <p className="text-sm text-muted-foreground mb-4">
              请先在"竞品分析"模块导入竞品评论数据，然后点击"运行聚合分析"按钮，<br />
              AI将自动聚合所有竞品评论并按卡诺模型分类为痛点、痒点、爽点。
            </p>
            <p className="text-xs text-muted-foreground">
              分析结果可手动编辑调整，调整后的结果将自动供Listing生成时的多竞品分析模块使用。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
