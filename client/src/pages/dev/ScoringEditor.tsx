import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Save, Star, RefreshCw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";

interface DimensionData {
  key: string;
  label: string;
  aiScore: number;
  userScore: number;
  aiReasoning: string;
  userNote: string;
  confirmed: boolean;
}

const DIMENSIONS = [
  { key: "marketCapacity", label: "市场容量", desc: "市场规模和增长潜力" },
  { key: "competitiveness", label: "竞争强度", desc: "进入后的竞争优势" },
  { key: "profit", label: "利润空间", desc: "预期利润空间" },
  { key: "differentiation", label: "差异化", desc: "产品差异化空间" },
  { key: "entryOpportunity", label: "入场机会", desc: "市场进入机会窗口" },
  { key: "risk", label: "风险", desc: "综合风险评估（分数越高风险越低）" },
];

function getScoreColor(score: number): string {
  if (score >= 18) return "text-emerald-600";
  if (score >= 15) return "text-blue-600";
  if (score >= 12) return "text-amber-600";
  return "text-red-600";
}

function getScoreLabel(score: number): string {
  if (score >= 18) return "优秀";
  if (score >= 15) return "良好";
  if (score >= 12) return "一般";
  if (score >= 10) return "较差";
  return "很差";
}

export default function ScoringEditor({
  score,
  project,
  projectId,
  isPhase2,
}: {
  score: any;
  project: any;
  projectId: number;
  isPhase2: boolean;
}) {
  const utils = trpc.useUtils();

  const scoreMutation = trpc.devScoring.generate.useMutation({
    onSuccess: () => {
      toast.success("项目评分完成");
      utils.devScoring.getScore.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`评分失败: ${err.message}`),
  });

  const approveMutation = trpc.devScoring.approveProject.useMutation({
    onSuccess: () => {
      toast.success("项目已立项");
      utils.devScoring.getScore.invalidate({ projectId });
      utils.devProject.getById.invalidate({ id: projectId });
    },
    onError: (err: any) => toast.error(`立项失败: ${err.message}`),
  });

  const revokeMutation = trpc.devScoring.revokeApproval.useMutation({
    onSuccess: () => {
      toast.success("已撤销立项");
      utils.devProject.getById.invalidate({ id: projectId });
    },
    onError: (err: any) => toast.error(`撤销失败: ${err.message}`),
  });

  // Parse AI reasoning
  const aiReasoningMap = useMemo(() => {
    if (!score?.aiReasoning) return {};
    try {
      return JSON.parse(score.aiReasoning);
    } catch {
      return {};
    }
  }, [score?.aiReasoning]);

  // Build editable dimensions from score data
  const [dimensions, setDimensions] = useState<DimensionData[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [expandedDims, setExpandedDims] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (score) {
      setDimensions(
        DIMENSIONS.map((dim) => ({
          key: dim.key,
          label: dim.label,
          aiScore: (score as any)[dim.key] ?? 0,
          userScore: (score as any)[dim.key] ?? 0,
          aiReasoning: aiReasoningMap[dim.key] || "",
          userNote: "",
          confirmed: false,
        }))
      );
      setHasChanges(false);
    }
  }, [score, aiReasoningMap]);

  const updateDimension = (key: string, field: keyof DimensionData, value: any) => {
    setDimensions((prev) =>
      prev.map((d) => (d.key === key ? { ...d, [field]: value } : d))
    );
    setHasChanges(true);
  };

  const confirmDimension = (key: string) => {
    setDimensions((prev) =>
      prev.map((d) => (d.key === key ? { ...d, confirmed: true } : d))
    );
    setHasChanges(true);
  };

  const toggleExpand = (key: string) => {
    setExpandedDims((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Calculate totals
  const totalAiScore = useMemo(
    () => dimensions.reduce((sum, d) => sum + d.aiScore, 0),
    [dimensions]
  );
  const totalUserScore = useMemo(
    () => dimensions.reduce((sum, d) => sum + d.userScore, 0),
    [dimensions]
  );
  const allConfirmed = dimensions.length > 0 && dimensions.every((d) => d.confirmed);

  // Save user adjustments back to DB
  const saveMutation = trpc.devScoring.generate.useMutation({
    onSuccess: () => {
      toast.success("评分已保存");
      setHasChanges(false);
    },
  });

  // For now, save is handled via the existing upsert - we need a dedicated updateScore endpoint
  // We'll use the existing generate mutation pattern but add a new updateScore endpoint

  if (!score) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Star className="h-4 w-4" />
            AI立项评分
          </h3>
          <Button
            size="sm"
            onClick={() => scoreMutation.mutate({ projectId })}
            disabled={scoreMutation.isPending}
            className="gap-2"
          >
            {scoreMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            AI评分
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Star className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">点击"AI评分"开始立项评估</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <Star className="h-4 w-4" />
          AI立项评分
        </h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => scoreMutation.mutate({ projectId })}
            disabled={scoreMutation.isPending}
            className="gap-2"
          >
            {scoreMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            重新评分
          </Button>
        </div>
      </div>

      {/* Score Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">AI综合评分</p>
            <p className={`text-3xl font-bold mt-1 ${getScoreColor(totalAiScore / 6)}`}>
              {totalAiScore}
            </p>
            <p className="text-xs text-muted-foreground">/ 120</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">人工调整后评分</p>
            <p className={`text-3xl font-bold mt-1 ${totalUserScore !== totalAiScore ? "text-primary" : getScoreColor(totalUserScore / 6)}`}>
              {totalUserScore}
            </p>
            <p className="text-xs text-muted-foreground">/ 120</p>
            {totalUserScore < 72 && (
              <p className="text-xs text-red-500 mt-1">低于72分不建议立项</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Scoring Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 pl-4 text-xs font-medium w-[120px]">评估维度</th>
                  <th className="text-center p-3 text-xs font-medium w-[80px]">AI评分</th>
                  <th className="text-center p-3 text-xs font-medium w-[120px]">人工调整</th>
                  <th className="text-left p-3 text-xs font-medium">AI推理摘要</th>
                  <th className="text-left p-3 text-xs font-medium w-[160px]">人工备注</th>
                  <th className="text-center p-3 text-xs font-medium w-[80px]">状态</th>
                </tr>
              </thead>
              <tbody>
                {dimensions.map((dim) => {
                  const dimDef = DIMENSIONS.find((d) => d.key === dim.key);
                  const isExpanded = expandedDims.has(dim.key);
                  const scoreDiff = dim.userScore - dim.aiScore;
                  return (
                    <tr
                      key={dim.key}
                      className={`border-b last:border-0 hover:bg-muted/20 ${dim.confirmed ? "bg-emerald-50/30" : ""}`}
                    >
                      <td className="p-3 pl-4">
                        <p className="font-medium text-xs">{dim.label}</p>
                        <p className="text-[10px] text-muted-foreground">{dimDef?.desc}</p>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`text-lg font-bold ${getScoreColor(dim.aiScore)}`}>
                          {dim.aiScore}
                        </span>
                        <p className="text-[10px] text-muted-foreground">{getScoreLabel(dim.aiScore)}</p>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={20}
                            value={dim.userScore}
                            onChange={(e) =>
                              updateDimension(dim.key, "userScore", parseInt(e.target.value))
                            }
                            className="w-16 h-1.5 accent-primary"
                            disabled={isPhase2}
                          />
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={dim.userScore}
                            onChange={(e) => {
                              const v = Math.min(20, Math.max(0, parseInt(e.target.value) || 0));
                              updateDimension(dim.key, "userScore", v);
                            }}
                            className="w-12 text-center text-sm font-bold border rounded px-1 py-0.5"
                            disabled={isPhase2}
                          />
                          {scoreDiff !== 0 && (
                            <span className={`text-[10px] ${scoreDiff > 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <div
                          className="cursor-pointer"
                          onClick={() => toggleExpand(dim.key)}
                        >
                          <div className="flex items-center gap-1">
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                            )}
                            <span className={`text-xs ${isExpanded ? "" : "line-clamp-2"}`}>
                              {dim.aiReasoning || "—"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        {isPhase2 ? (
                          <span className="text-xs">{dim.userNote || "—"}</span>
                        ) : (
                          <textarea
                            className="w-full text-xs border rounded px-2 py-1 resize-none bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
                            rows={2}
                            value={dim.userNote}
                            onChange={(e) =>
                              updateDimension(dim.key, "userNote", e.target.value)
                            }
                            placeholder="补充判断依据..."
                          />
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {dim.confirmed ? (
                          <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-0.5" />
                            已确认
                          </Badge>
                        ) : isPhase2 ? (
                          <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">已立项</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-[10px] h-6 px-2"
                            onClick={() => confirmDimension(dim.key)}
                          >
                            确认
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* Total Row */}
                <tr className="bg-muted/30 font-semibold">
                  <td className="p-3 pl-4 text-xs">总分</td>
                  <td className="p-3 text-center">
                    <span className={`text-lg font-bold ${getScoreColor(totalAiScore / 6)}`}>
                      {totalAiScore}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className={`text-lg font-bold ${totalUserScore !== totalAiScore ? "text-primary" : getScoreColor(totalUserScore / 6)}`}>
                      {totalUserScore}
                    </span>
                    {totalUserScore !== totalAiScore && (
                      <span className={`text-[10px] ml-1 ${totalUserScore > totalAiScore ? "text-emerald-600" : "text-red-600"}`}>
                        ({totalUserScore > totalAiScore ? "+" : ""}{totalUserScore - totalAiScore})
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground" colSpan={2}>
                    {totalUserScore >= 72 ? "建议立项" : totalUserScore >= 50 ? "需要审慎评估" : "不建议立项"}
                  </td>
                  <td className="p-3 text-center text-xs">
                    {allConfirmed ? (
                      <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">全部确认</Badge>
                    ) : (
                      <span className="text-muted-foreground text-[10px]">
                        {dimensions.filter((d) => d.confirmed).length}/{dimensions.length}
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Overall AI Reasoning */}
      {aiReasoningMap.overall && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI综合分析</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{aiReasoningMap.overall}</p>
          </CardContent>
        </Card>
      )}

      {/* Approval Action */}
      <Card
        className={`border-2 ${isPhase2 ? "border-emerald-300 bg-emerald-50/50" : "border-blue-300 bg-blue-50/50"}`}
      >
        <CardContent className="p-6">
          {isPhase2 ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-800">项目已立项</p>
                  <p className="text-sm text-emerald-600">
                    评分 {(project as any).approvedScore ?? totalUserScore} 分 ·
                    立项时间{" "}
                    {(project as any).approvedAt
                      ? new Date((project as any).approvedAt).toLocaleDateString()
                      : ""}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => {
                  if (confirm("确定撤销立项？项目将回到市场分析阶段。")) {
                    revokeMutation.mutate({ projectId });
                  }
                }}
                disabled={revokeMutation.isPending}
              >
                {revokeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : null}
                撤销立项
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="font-semibold text-blue-800">确认立项</p>
                  <p className="text-sm text-blue-600">
                    当前评分 {totalUserScore} 分 ·
                    立项后将解锁"项目落地"阶段（产品画像、BOM、说明书、测试报告、利润计算）
                  </p>
                </div>
              </div>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                onClick={() => approveMutation.mutate({ projectId })}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                确认立项
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
