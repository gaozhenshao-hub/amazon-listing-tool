import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import LockedContentBar from "@/components/LockedContentBar";
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
} from "lucide-react";

interface StepTitleProps {
  projectId: number;
  emphasis: string;
  locked?: boolean;
  savedContent?: string | null;
  onLock?: () => void;
  onUnlock?: () => void;
  onComplete: () => void;
}

function CharCountBadge({ count, min, max }: { count: number; min: number; max: number }) {
  const inRange = count >= min && count <= max;
  const tooShort = count < min;
  return (
    <Badge
      variant={inRange ? "default" : "destructive"}
      className={`text-xs ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}
    >
      {count} / {min}-{max} 字符{inRange && " ✓"}{tooShort && " ↑偏短"}{!inRange && !tooShort && " ↓偏长"}
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
  bundlePack: "T7 套装产品",
  trafficKeywords: "T8 流量词",
  brand: "T9 品牌词",
  seasonal: "T10 节日",
};

export default function StepTitle({ projectId, emphasis, locked, savedContent, onLock, onUnlock, onComplete }: StepTitleProps) {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [expandedCheckList, setExpandedCheckList] = useState<number | null>(null);
  const [holidayTerm, setHolidayTerm] = useState("");

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
          setCandidates(titles);
          setSelectedIdx(null);
          setConfirmed(false);
          toast.success(`已生成 ${titles.length} 个候选标题`);
        } else {
          setCandidates([{
            title: typeof content === "string" ? content : JSON.stringify(content),
            characterCount: (typeof content === "string" ? content : "").length,
            checkListScores: {},
          }]);
          toast.success("标题已生成");
        }
      } catch {
        const text = typeof data.title === "string" ? data.title : JSON.stringify(data);
        setCandidates([{
          title: text,
          characterCount: text.length,
          checkListScores: {},
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

  const handleGenerate = () => {
    generateTitle.mutate({
      projectId,
      emphasis: [emphasis, holidayTerm].filter(Boolean).join("; ") || undefined,
    });
  };

  const handleSelect = (idx: number) => {
    setSelectedIdx(idx);
    setEditingTitle(candidates[idx].title);
    setIsEditing(false);
  };

  const handleConfirm = () => {
    if (selectedIdx === null) {
      toast.error("请先选择一个标题");
      return;
    }
    const finalTitle = isEditing ? editingTitle : candidates[selectedIdx].title;
    updateListing.mutate({
      projectId,
      field: "title",
      value: finalTitle,
    });
  };

  const handleUnlock = () => {
    // Auto-fill editing area with saved content on unlock
    if (savedContent) {
      setEditingTitle(savedContent);
      // Set candidates with saved content so user can continue editing
      setCandidates([{ title: savedContent, score: 0, analysis: "" }]);
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
    return (
      <Card className="border-2 border-green-300 bg-green-50/30 dark:border-green-800 dark:bg-green-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="h-5 w-5 text-blue-600" />
            Step 2: 标题生成
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LockedContentBar
            locked={true}
            label="标题"
            onUnlock={handleUnlock}
            info={displayTitle ? `${displayTitle.length} 字符 · 已同步到预览页` : "已同步到预览页"}
          />
          {displayTitle ? (
            <div className="pl-2 space-y-2">
              <p className="text-sm text-green-800 dark:text-green-300 leading-relaxed">{displayTitle}</p>
              <CharCountBadge count={displayTitle.length} min={180} max={200} />
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
          Step 2: 标题生成
        </CardTitle>
        <CardDescription>
          AI生成3个候选标题 → 10维度Check List自检 → 选择/编辑 → 确认
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

        {/* Amazon title rules */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50/50 border border-blue-200">
          <AlertCircle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            亚马逊标题规则：<strong>180-200字符</strong>，包含核心关键词、卖点、参数、场景、目标人群。品牌词前置，核心卖点词优先。
          </p>
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
              <><Sparkles className="h-4 w-4 mr-2" />AI生成候选标题</>
            )}
          </Button>
        )}

        {generateTitle.isPending && (
          <p className="text-xs text-muted-foreground text-center">
            AI正在基于4大数据源和10维度Check List生成候选标题...
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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      方案 {idx + 1}
                    </Badge>
                    <CharCountBadge count={c.characterCount || c.title?.length || 0} min={180} max={200} />
                    {c.checkListScores && Object.keys(c.checkListScores).length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        Check List: {passCount(c.checkListScores)}/{Object.keys(c.checkListScores).length} 通过
                      </Badge>
                    )}
                  </div>
                  {selectedIdx === idx && (
                    <Badge className="bg-blue-600 text-white text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />已选
                    </Badge>
                  )}
                </div>

                <p className="text-sm leading-relaxed">{c.title}</p>

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

            {/* Edit area for selected title */}
            {selectedIdx !== null && (
              <div className="rounded-lg border-2 border-blue-300 p-4 bg-blue-50/30 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-blue-700">
                    {isEditing ? "编辑标题" : "已选标题"}
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
                  <div className="space-y-2">
                    <Textarea
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      rows={3}
                      className="text-sm resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <CharCountBadge count={editingTitle.length} min={180} max={200} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed">{candidates[selectedIdx].title}</p>
                    <CharCountBadge count={candidates[selectedIdx].title?.length || 0} min={180} max={200} />
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
                    <><Check className="h-4 w-4 mr-2" />确认并锁定标题</>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Confirmed but not yet locked (transitional state) */}
        {confirmed && !locked && (
          <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50/50">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm font-semibold text-green-800">标题已确认</span>
            </div>
            <p className="text-sm text-green-700">{editingTitle || candidates[selectedIdx!]?.title}</p>
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
