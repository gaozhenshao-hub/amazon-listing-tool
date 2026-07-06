import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import LockedContentBar from "@/components/LockedContentBar";
import ChecklistPanel from "@/components/ChecklistPanel";
import {
  Sparkles,
  Loader2,
  Check,
  CheckCircle2,
  Pencil,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Type,
  AlertCircle,
  Layers,
} from "lucide-react";

// ─── Title 10 Dimensions Definition (Updated for Two-Stage) ─────────────────
const TITLE_CHECKLIST_DIMENSIONS = [
  { key: "readability", code: "T1", label: "可读性", labelEn: "Readability", description: "无语法错误，逻辑通顺，无关键词堆砌" },
  { key: "formatting", code: "T2", label: "格式规范", labelEn: "Formatting", description: "阿拉伯数字、Title Case大小写、拼写计量单位" },
  { key: "characterCount", code: "T3", label: "字符数", labelEn: "Character Count", description: "Layer1 ≤75字符, Layer2 ≤125字符" },
  { key: "contentCoverage", code: "T4", label: "内容覆盖", labelEn: "Content Coverage", description: "Layer1含核心词+品牌+差异化; Layer2含规格+场景+次要词" },
  { key: "coreKeywords", code: "T5", label: "核心关键词", labelEn: "Core Keywords", description: "Layer1包含1-2个core_main策略关键词" },
  { key: "wordOrder", code: "T6", label: "词序策略", labelEn: "Word Order", description: "核心卖点前置于Layer1，遵循title_front→mid→end布局" },
  { key: "noRepetition", code: "T7", label: "层间不重复", labelEn: "No Repetition", description: "Layer1和Layer2之间无重复词汇" },
  { key: "trafficKeywords", code: "T8", label: "流量词", labelEn: "Traffic Keywords", description: "融入高流量关键词（可分布在两层）" },
  { key: "brand", code: "T9", label: "品牌", labelEn: "Brand", description: "品牌名放置在Layer1开头" },
  { key: "seasonal", code: "T10", label: "季节性", labelEn: "Seasonal", description: "是否适当包含节日/季节性词汇" },
] as const;

interface StepTitleProps {
  projectId: number;
  emphasis: string;
  locked?: boolean;
  savedContent?: string | null;
  savedItemHighlights?: string | null;
  onLock?: () => void;
  onUnlock?: () => void;
  onComplete: () => void;
}

function CharCountBadge({ count, max, label }: { count: number; max: number; label?: string }) {
  const inRange = count > 0 && count <= max;
  const tooLong = count > max;
  return (
    <Badge
      variant={inRange ? "default" : "destructive"}
      className={`text-xs ${inRange ? "bg-green-600" : tooLong ? "bg-red-500" : "bg-amber-500"}`}
    >
      {label ? `${label}: ` : ""}{count} / ≤{max} 字符{inRange && " ✓"}{tooLong && " ↓超长"}{count === 0 && " (空)"}
    </Badge>
  );
}

const CHECK_LIST_LABELS: Record<string, string> = {
  readability: "T1 可读性",
  formatting: "T2 文字/数字/标点",
  characterCount: "T3 字数",
  contentCoverage: "T4 内容覆盖",
  coreKeywords: "T5 核心关键词",
  wordOrder: "T6 词序",
  noRepetition: "T7 层间不重复",
  trafficKeywords: "T8 流量词",
  brand: "T9 品牌词",
  seasonal: "T10 节日",
};

interface TitleCandidate {
  title: string;
  itemHighlights: string;
  characterCount?: number;
  highlightsCount?: number;
  coreKeywords?: string[];
  trafficKeywords?: string[];
  strategy?: string;
  wordOrderStrategy?: string;
  checkListScores?: Record<string, { pass: boolean; notes: string }>;
}

export default function StepTitle({ projectId, emphasis, locked, savedContent, savedItemHighlights, onLock, onUnlock, onComplete }: StepTitleProps) {
  const [candidates, setCandidates] = useState<TitleCandidate[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingHighlights, setEditingHighlights] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [expandedCheckList, setExpandedCheckList] = useState<number | null>(null);
  const [holidayTerm, setHolidayTerm] = useState("");
  const [titleCheckScores, setTitleCheckScores] = useState<Record<string, { pass: boolean; notes: string }> | undefined>(undefined);
  const autoCheckTriggered = useRef(false);

  const evaluateTitleCheck = trpc.listing.evaluateTitleChecklist.useMutation({
    onSuccess: (data) => {
      if (data.checkListScores && Object.keys(data.checkListScores).length > 0) {
        setTitleCheckScores(data.checkListScores);
      }
    },
    onError: () => toast.error("标题自检失败"),
  });

  // Auto-trigger title checklist when candidates are generated
  useEffect(() => {
    if (candidates.length > 0 && selectedIdx !== null && !autoCheckTriggered.current) {
      const c = candidates[selectedIdx];
      if (c?.title && !titleCheckScores) {
        autoCheckTriggered.current = true;
        evaluateTitleCheck.mutate({ title: `${c.title} | ${c.itemHighlights || ""}` });
      }
    }
  }, [candidates, selectedIdx]);

  const handleRunTitleCheck = () => {
    let titleForCheck: string;
    if (isEditing) {
      titleForCheck = `${editingTitle} | ${editingHighlights}`;
    } else if (selectedIdx !== null) {
      const c = candidates[selectedIdx];
      titleForCheck = `${c.title} | ${c.itemHighlights || ""}`;
    } else {
      toast.error("请先选择或生成标题");
      return;
    }
    setTitleCheckScores(undefined);
    evaluateTitleCheck.mutate({ title: titleForCheck });
  };

  const generateTitle = trpc.listing.generateTitle.useMutation({
    onSuccess: (data: any) => {
      try {
        const content = data.title || data;
        let parsed: any;
        if (typeof content === "string") {
          const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[1].trim());
          } else {
            parsed = JSON.parse(content);
          }
        } else {
          parsed = content;
        }

        const titles = parsed.titles || parsed.candidates || [parsed];
        if (Array.isArray(titles) && titles.length > 0) {
          const normalizedTitles: TitleCandidate[] = titles.map((t: any) => ({
            title: t.title || t.layer1 || "",
            itemHighlights: t.itemHighlights || t.item_highlights || t.layer2 || "",
            characterCount: (t.title || t.layer1 || "").length,
            highlightsCount: (t.itemHighlights || t.item_highlights || t.layer2 || "").length,
            coreKeywords: t.coreKeywords || t.core_keywords || [],
            trafficKeywords: t.trafficKeywords || t.traffic_keywords || [],
            strategy: t.strategy || "",
            wordOrderStrategy: t.wordOrderStrategy || t.word_order_strategy || "",
            checkListScores: t.checkListScores || {},
          }));
          setCandidates(normalizedTitles);
          setSelectedIdx(null);
          setConfirmed(false);
          setTitleCheckScores(undefined);
          autoCheckTriggered.current = false;
          toast.success(`已生成 ${normalizedTitles.length} 个候选标题（两段式）`);
        } else {
          // Fallback: single title
          const text = typeof content === "string" ? content : JSON.stringify(content);
          setCandidates([{
            title: text.slice(0, 75),
            itemHighlights: text.slice(75) || "",
            characterCount: Math.min(text.length, 75),
            highlightsCount: Math.max(0, text.length - 75),
          }]);
          toast.success("标题已生成");
        }
      } catch {
        const text = typeof data.title === "string" ? data.title : JSON.stringify(data);
        setCandidates([{
          title: text.slice(0, 75),
          itemHighlights: text.slice(75) || "",
          characterCount: Math.min(text.length, 75),
          highlightsCount: Math.max(0, text.length - 75),
        }]);
        toast.success("标题已生成");
      }
    },
    onError: (err) => toast.error("标题生成失败: " + err.message),
  });

  const updateListing = trpc.listing.updateByProject.useMutation({
    onSuccess: () => {
      toast.success("标题已保存并锁定");
      setConfirmed(true);
      onLock?.();
      onComplete();
    },
    onError: (err) => toast.error("保存失败: " + err.message),
  });

  const updateItemHighlights = trpc.listing.updateByProject.useMutation({
    onError: (err) => console.error("Failed to save itemHighlights:", err.message),
  });

  const handleGenerate = () => {
    generateTitle.mutate({
      projectId,
      emphasis: [emphasis, holidayTerm].filter(Boolean).join("; ") || undefined,
    });
  };

  const handleSelect = (idx: number) => {
    setSelectedIdx(idx);
    setEditingTitle(candidates[idx].title);
    setEditingHighlights(candidates[idx].itemHighlights || "");
    setIsEditing(false);
  };

  const handleConfirm = () => {
    if (selectedIdx === null) {
      toast.error("请先选择一个标题");
      return;
    }
    const finalTitle = isEditing ? editingTitle : candidates[selectedIdx].title;
    const finalHighlights = isEditing ? editingHighlights : candidates[selectedIdx].itemHighlights;

    // Save title
    updateListing.mutate({
      projectId,
      field: "title",
      value: finalTitle,
    });

    // Save item highlights separately
    if (finalHighlights) {
      updateItemHighlights.mutate({
        projectId,
        field: "itemHighlights",
        value: finalHighlights,
      });
    }
  };

  const handleUnlock = () => {
    if (savedContent) {
      setEditingTitle(savedContent);
      setEditingHighlights(savedItemHighlights || "");
      setCandidates([{
        title: savedContent,
        itemHighlights: savedItemHighlights || "",
        characterCount: savedContent.length,
        highlightsCount: (savedItemHighlights || "").length,
      }]);
      setSelectedIdx(0);
    }
    setConfirmed(false);
    onUnlock?.();
  };

  const passCount = (scores: Record<string, any>) => {
    return Object.values(scores || {}).filter((s: any) => s?.pass).length;
  };

  // If locked, show locked state with saved content from DB
  if (locked) {
    const displayTitle = confirmed
      ? (editingTitle || candidates[selectedIdx!]?.title || "")
      : (savedContent || "");
    const displayHighlights = confirmed
      ? (editingHighlights || candidates[selectedIdx!]?.itemHighlights || "")
      : (savedItemHighlights || "");
    return (
      <Card className="border-2 border-green-300 bg-green-50/30 dark:border-green-800 dark:bg-green-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="h-5 w-5 text-blue-600" />
            Step 2: 标题生成（两段式）
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LockedContentBar
            locked={true}
            label="标题"
            onUnlock={handleUnlock}
            info={displayTitle ? `Layer1: ${displayTitle.length}字符 + Layer2: ${displayHighlights.length}字符 · 已同步到预览页` : "已同步到预览页"}
          />
          {displayTitle ? (
            <div className="pl-2 space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700">Layer 1 - Title</Badge>
                  <CharCountBadge count={displayTitle.length} max={75} />
                </div>
                <p className="text-sm text-green-800 dark:text-green-300 leading-relaxed font-medium">{displayTitle}</p>
              </div>
              {displayHighlights && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-700">Layer 2 - Item Highlights</Badge>
                    <CharCountBadge count={displayHighlights.length} max={125} />
                  </div>
                  <p className="text-sm text-green-700 dark:text-green-400 leading-relaxed">{displayHighlights}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground pl-2">标题内容已锁定</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Type className="h-5 w-5 text-blue-600" />
          Step 2: 标题生成（两段式）
        </CardTitle>
        <CardDescription>
          AI生成3个候选标题（两段式格式）→ 10维度Check List自检 → 选择/编辑 → 确认
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Holiday term input */}
        <div className="flex items-center gap-3">
          <Label className="text-sm whitespace-nowrap">节日词（可选）:</Label>
          <Input
            placeholder="例如: Christmas Gift, Valentine's Day, Mother's Day..."
            value={holidayTerm}
            onChange={(e) => setHolidayTerm(e.target.value)}
            className="h-9 text-sm max-w-md"
          />
        </div>

        {/* Two-Stage Title Policy Notice */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50/50 border border-amber-200">
          <Layers className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 space-y-1">
            <p className="font-semibold">亚马逊两段式标题新规（2026年7月27日强制执行）</p>
            <p><strong>Layer 1 (Title):</strong> ≤75字符 — 品牌 + 核心关键词 + 差异化卖点</p>
            <p><strong>Layer 2 (Item Highlights):</strong> ≤125字符 — 规格参数 + 使用场景 + 次要关键词</p>
            <p className="text-amber-600">两层之间不可有重复词汇，合计≤200字符</p>
          </div>
        </div>

        {/* Generate button */}
        {!confirmed && (
          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={generateTitle.isPending}
          >
            {generateTitle.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />正在生成候选标题...</>
            ) : candidates.length > 0 ? (
              <><RotateCcw className="h-4 w-4 mr-2" />重新生成标题</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />AI生成候选标题（两段式）</>
            )}
          </Button>
        )}

        {generateTitle.isPending && (
          <p className="text-xs text-muted-foreground text-center">
            AI正在基于4大数据源生成两段式候选标题...
          </p>
        )}

        {/* Candidate titles */}
        {candidates.length > 0 && !confirmed && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              候选标题 ({candidates.length}个)
              {selectedIdx !== null && <span className="text-green-600 ml-2">— 已选择第 {selectedIdx + 1} 个</span>}
            </h3>

            {candidates.map((c, idx) => (
              <div
                key={idx}
                className={`rounded-lg border p-4 transition-all cursor-pointer ${
                  selectedIdx === idx
                    ? "border-blue-400 bg-blue-50/50 ring-2 ring-blue-200"
                    : "border-muted hover:border-blue-200"
                }`}
                onClick={() => handleSelect(idx)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      方案 {idx + 1}
                    </Badge>
                    <CharCountBadge count={c.title?.length || 0} max={75} label="L1" />
                    <CharCountBadge count={c.itemHighlights?.length || 0} max={125} label="L2" />
                    {c.checkListScores && Object.keys(c.checkListScores).length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        Check: {passCount(c.checkListScores)}/{Object.keys(c.checkListScores).length}
                      </Badge>
                    )}
                  </div>
                  {selectedIdx === idx && (
                    <Badge className="bg-blue-600 text-white text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />已选
                    </Badge>
                  )}
                </div>

                {/* Layer 1 - Title */}
                <div className="mb-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 px-1.5 py-0">Layer 1</Badge>
                  </div>
                  <p className="text-sm leading-relaxed font-medium">{c.title}</p>
                </div>

                {/* Layer 2 - Item Highlights */}
                {c.itemHighlights && (
                  <div className="mb-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700 px-1.5 py-0">Layer 2</Badge>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{c.itemHighlights}</p>
                  </div>
                )}

                {/* Core keywords */}
                {c.coreKeywords && c.coreKeywords.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    <span className="text-[10px] text-muted-foreground">核心词:</span>
                    {c.coreKeywords.map((kw: string, j: number) => (
                      <Badge key={j} variant="outline" className="text-[10px] border-blue-300 text-blue-700">{kw}</Badge>
                    ))}
                  </div>
                )}

                {/* Traffic keywords */}
                {c.trafficKeywords && c.trafficKeywords.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-1">
                    <span className="text-[10px] text-muted-foreground">流量词:</span>
                    {c.trafficKeywords.map((kw: string, j: number) => (
                      <Badge key={j} variant="outline" className="text-[10px] border-green-300 text-green-700">{kw}</Badge>
                    ))}
                  </div>
                )}

                {/* Strategy */}
                {c.strategy && (
                  <p className="text-[10px] text-muted-foreground mt-1">策略: {c.strategy}</p>
                )}
                {c.wordOrderStrategy && (
                  <p className="text-[10px] text-muted-foreground">词序: {c.wordOrderStrategy}</p>
                )}

                {/* Check List panel (collapsible) */}
                {c.checkListScores && Object.keys(c.checkListScores).length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedCheckList(expandedCheckList === idx ? null : idx);
                      }}
                    >
                      {expandedCheckList === idx ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      Check List详情 ({passCount(c.checkListScores)}/{Object.keys(c.checkListScores).length} 通过)
                    </button>

                    {expandedCheckList === idx && (
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1.5">
                        {Object.entries(c.checkListScores).map(([key, val]: [string, any]) => (
                          <div
                            key={key}
                            className={`flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs ${
                              val?.pass
                                ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                                : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                            }`}
                          >
                            <span className="shrink-0">{val?.pass ? "✅" : "❌"}</span>
                            <div>
                              <span className="font-medium">{CHECK_LIST_LABELS[key] || key}</span>
                              {val?.notes && <p className="text-[10px] opacity-80 mt-0.5">{val.notes}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Edit area for selected title - Two-Stage */}
            {selectedIdx !== null && (
              <div className="rounded-lg border-2 border-blue-300 p-4 bg-blue-50/30 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-blue-700">
                    {isEditing ? "编辑标题（两段式）" : "已选标题"}
                  </h4>
                  <div className="flex gap-2">
                    {!isEditing ? (
                      <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />编辑
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                        取消编辑
                      </Button>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    {/* Layer 1 editing */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs font-medium text-blue-700">Layer 1 - Title（品牌+核心词+差异化）</Label>
                        <CharCountBadge count={editingTitle.length} max={75} />
                      </div>
                      <Textarea
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        rows={2}
                        className="text-sm resize-none"
                        placeholder="Brand + Core Keyword + Differentiator (≤75 chars)"
                      />
                    </div>
                    {/* Layer 2 editing */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs font-medium text-purple-700">Layer 2 - Item Highlights（规格+场景+次要词）</Label>
                        <CharCountBadge count={editingHighlights.length} max={125} />
                      </div>
                      <Textarea
                        value={editingHighlights}
                        onChange={(e) => setEditingHighlights(e.target.value)}
                        rows={2}
                        className="text-sm resize-none"
                        placeholder="Specs + Use Cases + Secondary Keywords (≤125 chars)"
                      />
                    </div>
                    {/* Combined count */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>合计: {editingTitle.length + editingHighlights.length} 字符</span>
                      {editingTitle.length + editingHighlights.length <= 200 && editingTitle.length + editingHighlights.length > 0 && (
                        <Badge className="bg-green-600 text-xs">合规 ✓</Badge>
                      )}
                      {editingTitle.length + editingHighlights.length > 200 && (
                        <Badge className="bg-red-500 text-xs">超出200字符限制</Badge>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700">Layer 1</Badge>
                        <CharCountBadge count={candidates[selectedIdx].title?.length || 0} max={75} />
                      </div>
                      <p className="text-sm leading-relaxed font-medium">{candidates[selectedIdx].title}</p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-700">Layer 2</Badge>
                        <CharCountBadge count={candidates[selectedIdx].itemHighlights?.length || 0} max={125} />
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">{candidates[selectedIdx].itemHighlights}</p>
                    </div>
                  </div>
                )}

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={handleConfirm}
                  disabled={updateListing.isPending}
                >
                  {updateListing.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />保存中...</>
                  ) : (
                    <><Check className="h-4 w-4 mr-2" />确认并锁定标题（两段式）</>
                  )}
                </Button>
              </div>
            )}

            {/* Title 10-Dimension Checklist Panel */}
            {selectedIdx !== null && (
              <ChecklistPanel
                dimensions={TITLE_CHECKLIST_DIMENSIONS}
                checkListScores={titleCheckScores}
                panelTitle="标题 - 10维度质量自检（两段式）"
                checkLabel="10维度自检"
                onRunCheck={handleRunTitleCheck}
                isRunningCheck={evaluateTitleCheck.isPending}
              />
            )}
          </div>
        )}

        {/* Confirmed but not yet locked (transitional state) */}
        {confirmed && !locked && (
          <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50/50">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm font-semibold text-green-800">标题已确认（两段式）</span>
            </div>
            <div className="space-y-2">
              <div>
                <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700 mb-1">Layer 1</Badge>
                <p className="text-sm text-green-700">{editingTitle || candidates[selectedIdx!]?.title}</p>
              </div>
              <div>
                <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-700 mb-1">Layer 2</Badge>
                <p className="text-sm text-green-700">{editingHighlights || candidates[selectedIdx!]?.itemHighlights}</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => { setConfirmed(false); }}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />重新编辑
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
