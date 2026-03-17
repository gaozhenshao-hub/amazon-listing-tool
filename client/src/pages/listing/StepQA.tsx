import { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
  MessageSquare,
  Plus,
  Trash2,
  GripVertical,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

// ─── QA 8 Dimensions Definition ─────────────────────────────────────
const QA_CHECKLIST_DIMENSIONS = [
  { key: "questionNaturalness", code: "Q1", label: "问题自然度", labelEn: "Question Naturalness", description: "问题模拟真实消费者口吻，第一人称，简洁(<100字符)" },
  { key: "answerProfessionalism", code: "Q2", label: "回答专业度", labelEn: "Answer Professionalism", description: "回答专业友好，150-300字符，直接回答问题" },
  { key: "painPointCoverage", code: "Q3", label: "痛点覆盖", labelEn: "Pain Point Coverage", description: "包含2-3个来自评论的高频痛点问题" },
  { key: "differentiationCoverage", code: "Q4", label: "差异化覆盖", labelEn: "Differentiation Coverage", description: "包含2-3个突出产品差异化优势的问题" },
  { key: "categoryStandard", code: "Q5", label: "品类标准问题", labelEn: "Category Standard", description: "包含1-2个品类通用问题（兼容性/尺寸/质保/物流）" },
  { key: "dataQuantification", code: "Q6", label: "数据量化", labelEn: "Data Quantification", description: "回答中包含具体数据和量化表述" },
  { key: "semanticRelation", code: "Q7", label: "语义关系", labelEn: "Semantic Relation", description: "回答自然体现语义关系（用途/能力/定义/因果）" },
  { key: "priorityOrder", code: "Q8", label: "优先级排序", labelEn: "Priority Order", description: "按客户影响力排序：痛点→差异化→品类标准" },
] as const;

interface StepQAProps {
  projectId: number;
  emphasis: string;
  locked?: boolean;
  savedContent?: string | null;
  onLock?: () => void;
  onUnlock?: () => void;
  onComplete: () => void;
}

interface QAItem {
  question: string;
  answer: string;
  category?: string;
  priority?: number;
  sourceInsight?: string;
}

export default function StepQA({ projectId, emphasis, locked, savedContent, onLock, onUnlock, onComplete }: StepQAProps) {
  const [qaItems, setQaItems] = useState<QAItem[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");
  const [checkScores, setCheckScores] = useState<Record<string, { pass: boolean; notes: string }> | undefined>(undefined);
  const autoCheckTriggered = useRef(false);

  const evaluateCheck = trpc.listing.evaluateQAChecklist.useMutation({
    onSuccess: (data) => {
      if (data.checkListScores && Object.keys(data.checkListScores).length > 0) {
        setCheckScores(data.checkListScores);
      }
    },
    onError: () => toast.error("QA自检失败"),
  });

  // Auto-trigger checklist when QA items are generated
  useEffect(() => {
    if (generated && qaItems.length > 0 && !autoCheckTriggered.current && !checkScores) {
      autoCheckTriggered.current = true;
      evaluateCheck.mutate({ qaContent: JSON.stringify(qaItems) });
    }
  }, [generated, qaItems.length]);

  const handleRunCheck = () => {
    if (qaItems.length === 0) {
      toast.error("请先生成QA问答");
      return;
    }
    setCheckScores(undefined);
    evaluateCheck.mutate({ qaContent: JSON.stringify(qaItems) });
  };

  // Parse saved QA content from DB for locked display
  const savedQaItems = useMemo<QAItem[]>(() => {
    if (!savedContent) return [];
    try {
      const parsed = JSON.parse(savedContent);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any, idx: number) => ({
          question: item.question || item.q || "",
          answer: item.answer || item.a || "",
          category: item.category || "",
          priority: item.priority || idx + 1,
          sourceInsight: item.sourceInsight || "",
        }));
      }
      return [];
    } catch {
      return [];
    }
  }, [savedContent]);

  const generateQA = trpc.listing.generateQA.useMutation({
    onSuccess: (data: any) => {
      try {
        const content = data.qa || data;
        let items: QAItem[] = [];
        if (typeof content === "string") {
          try {
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
            const toParse = jsonMatch ? jsonMatch[1].trim() : content;
            const parsed = JSON.parse(toParse);
            items = parsed.qaItems || parsed.questions || parsed.qa || (Array.isArray(parsed) ? parsed : []);
          } catch {
            items = [];
          }
        } else if (Array.isArray(content)) {
          items = content;
        } else if (content.qaItems) {
          items = content.qaItems;
        } else if (content.questions) {
          items = content.questions;
        }

        if (items.length > 0) {
          setQaItems(items.map((item: any, idx: number) => ({
            question: item.question || item.q || "",
            answer: item.answer || item.a || "",
            category: item.category || item.type || "",
            priority: item.priority || idx + 1,
            sourceInsight: item.sourceInsight || item.source || "",
          })));
          setGenerated(true);
          setCheckScores(undefined);
          autoCheckTriggered.current = false;
          toast.success(`已生成 ${items.length} 组QA`);
        } else {
          toast.error("QA生成结果格式异常");
        }
      } catch {
        toast.error("QA解析失败");
      }
    },
    onError: (err) => toast.error("QA生成失败: " + err.message),
  });

  const updateListing = trpc.listing.updateByProject.useMutation({
    onSuccess: () => {
      toast.success("QA已保存并锁定");
      setConfirmed(true);
      onLock?.();
      onComplete();
    },
    onError: (err) => toast.error("保存失败: " + err.message),
  });

  const handleGenerate = () => {
    generateQA.mutate({
      projectId,
      emphasis: emphasis.trim() || undefined,
    });
  };

  const handleConfirm = () => {
    if (qaItems.length === 0) {
      toast.error("请至少添加一组QA");
      return;
    }
    updateListing.mutate({
      projectId,
      field: "qaContent",
      value: JSON.stringify(qaItems),
    });
  };

  const handleUnlock = () => {
    // Restore saved content for editing when unlocking
    if (savedQaItems.length > 0) {
      setQaItems(savedQaItems);
      setGenerated(true);
    }
    setConfirmed(false);
    onUnlock?.();
  };

  const handleStartEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditQ(qaItems[idx].question);
    setEditA(qaItems[idx].answer);
  };

  const handleSaveEdit = () => {
    if (editingIdx === null) return;
    setQaItems(prev => prev.map((item, i) =>
      i === editingIdx ? { ...item, question: editQ, answer: editA } : item
    ));
    setEditingIdx(null);
    toast.success("QA已更新");
  };

  const handleDelete = (idx: number) => {
    setQaItems(prev => prev.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
    toast.success("QA已删除");
  };

  const handleAddQA = () => {
    if (!newQ.trim() || !newA.trim()) {
      toast.error("问题和回答不能为空");
      return;
    }
    setQaItems(prev => [...prev, {
      question: newQ.trim(),
      answer: newA.trim(),
      category: "custom",
      priority: prev.length + 1,
      sourceInsight: "手动添加",
    }]);
    setNewQ("");
    setNewA("");
    setShowAddForm(false);
    toast.success("QA已添加");
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    setQaItems(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const handleMoveDown = (idx: number) => {
    if (idx === qaItems.length - 1) return;
    setQaItems(prev => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const categoryColors: Record<string, string> = {
    pain_point: "bg-red-100 text-red-700",
    differentiator: "bg-blue-100 text-blue-700",
    generic: "bg-gray-100 text-gray-700",
    custom: "bg-purple-100 text-purple-700",
  };

  const categoryLabels: Record<string, string> = {
    pain_point: "痛点问题",
    differentiator: "差异化问题",
    generic: "通用问题",
    custom: "自定义",
  };

  // Locked state - show saved content from DB
  if (locked) {
    const displayItems = confirmed ? qaItems : savedQaItems;
    return (
      <Card className="border-2 border-green-300 bg-green-50/30 dark:border-green-800 dark:bg-green-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-teal-600" />
            Step 5: QA问答
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LockedContentBar
            locked={true}
            label="QA问答"
            onUnlock={handleUnlock}
            info={displayItems.length > 0 ? `${displayItems.length} 组QA · 已同步到预览页` : "已同步到预览页"}
          />
          {displayItems.length > 0 ? (
            <div className="space-y-1.5 pl-2">
              {displayItems.slice(0, 5).map((qa, idx) => (
                <div key={idx} className="text-xs text-green-800 dark:text-green-300">
                  <span className="font-medium">Q{idx + 1}:</span> {qa.question}
                </div>
              ))}
              {displayItems.length > 5 && (
                <p className="text-xs text-green-600">...还有 {displayItems.length - 5} 组QA</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground pl-2">QA内容已锁定</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-teal-600" />
          Step 5: QA问答
        </CardTitle>
        <CardDescription>
          AI生成5-8组结构化QA → 8维度自检 → 编辑/增删/排序 → 确认保存
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Generate button */}
        {!confirmed && (
          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={generateQA.isPending}
          >
            {generateQA.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />正在生成QA问答...</>
            ) : generated ? (
              <><RotateCcw className="h-4 w-4 mr-2" />重新生成QA</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />AI生成QA问答</>
            )}
          </Button>
        )}

        {generateQA.isPending && (
          <p className="text-xs text-muted-foreground text-center">
            AI正在基于竞品评论痛点和产品卖点生成QA问答...
          </p>
        )}

        {/* QA list */}
        {generated && !confirmed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">QA列表 ({qaItems.length}组)</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {showAddForm ? "取消" : "新增QA"}
              </Button>
            </div>

            {/* Add form */}
            {showAddForm && (
              <div className="rounded-lg border-2 border-dashed border-teal-300 p-4 space-y-3 bg-teal-50/30">
                <div className="space-y-2">
                  <Input
                    placeholder="输入问题 (Question)..."
                    value={newQ}
                    onChange={(e) => setNewQ(e.target.value)}
                    className="text-sm"
                  />
                  <Textarea
                    placeholder="输入回答 (Answer)..."
                    value={newA}
                    onChange={(e) => setNewA(e.target.value)}
                    rows={3}
                    className="text-sm resize-none"
                  />
                </div>
                <Button size="sm" onClick={handleAddQA}>
                  <Check className="h-3.5 w-3.5 mr-1" />添加
                </Button>
              </div>
            )}

            {/* QA items */}
            {qaItems.map((qa, idx) => (
              <div
                key={idx}
                className="rounded-lg border p-4 space-y-2 hover:border-teal-200 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Badge variant="outline" className="text-xs">Q{idx + 1}</Badge>
                    {qa.category && (
                      <Badge className={`text-[10px] ${categoryColors[qa.category] || "bg-gray-100 text-gray-700"}`}>
                        {categoryLabels[qa.category] || qa.category}
                      </Badge>
                    )}
                    {qa.sourceInsight && (
                      <span className="text-[10px] text-muted-foreground">来源: {qa.sourceInsight}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1 rounded hover:bg-muted transition-colors"
                      onClick={() => handleMoveUp(idx)}
                      disabled={idx === 0}
                    >
                      <ArrowUp className={`h-3.5 w-3.5 ${idx === 0 ? "text-muted-foreground/30" : "text-muted-foreground"}`} />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-muted transition-colors"
                      onClick={() => handleMoveDown(idx)}
                      disabled={idx === qaItems.length - 1}
                    >
                      <ArrowDown className={`h-3.5 w-3.5 ${idx === qaItems.length - 1 ? "text-muted-foreground/30" : "text-muted-foreground"}`} />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-blue-100 transition-colors"
                      onClick={() => handleStartEdit(idx)}
                    >
                      <Pencil className="h-3.5 w-3.5 text-blue-600" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-red-100 transition-colors"
                      onClick={() => handleDelete(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                </div>

                {editingIdx === idx ? (
                  <div className="space-y-2 pl-6">
                    <Input
                      value={editQ}
                      onChange={(e) => setEditQ(e.target.value)}
                      className="text-sm font-medium"
                    />
                    <Textarea
                      value={editA}
                      onChange={(e) => setEditA(e.target.value)}
                      rows={3}
                      className="text-sm resize-none"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit}>
                        <Check className="h-3.5 w-3.5 mr-1" />保存
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingIdx(null)}>
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="pl-6 space-y-1">
                    <p className="text-sm font-medium">Q: {qa.question}</p>
                    <p className="text-sm text-muted-foreground">A: {qa.answer}</p>
                    <Badge variant="secondary" className="text-[10px]">
                      {qa.answer.length} 字符
                    </Badge>
                  </div>
                )}
              </div>
            ))}

            {/* QA 8-Dimension Checklist Panel */}
            <ChecklistPanel
              dimensions={QA_CHECKLIST_DIMENSIONS}
              checkListScores={checkScores}
              panelTitle="QA问答 - 8维度质量自检"
              checkLabel="8维度自检"
              onRunCheck={handleRunCheck}
              isRunningCheck={evaluateCheck.isPending}
            />

            {/* Confirm button */}
            <Button
              className="w-full bg-teal-600 hover:bg-teal-700"
              onClick={handleConfirm}
              disabled={updateListing.isPending || qaItems.length === 0}
            >
              {updateListing.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />保存中...</>
              ) : (
                <><Check className="h-4 w-4 mr-2" />确认并锁定QA ({qaItems.length}组)</>
              )}
            </Button>
          </div>
        )}

        {/* Confirmed but not yet locked */}
        {confirmed && !locked && (
          <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50/50">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm font-semibold text-green-800">QA已确认 ({qaItems.length}组)</span>
            </div>
            <div className="space-y-2">
              {qaItems.slice(0, 3).map((qa, idx) => (
                <div key={idx} className="text-xs text-green-700">
                  <span className="font-medium">Q{idx + 1}:</span> {qa.question}
                </div>
              ))}
              {qaItems.length > 3 && (
                <p className="text-xs text-green-600">...还有 {qaItems.length - 3} 组QA</p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setConfirmed(false)}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />重新编辑
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
