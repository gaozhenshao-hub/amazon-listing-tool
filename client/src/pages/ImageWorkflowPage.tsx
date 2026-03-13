import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Image,
  Loader2,
  Sparkles,
  Target,
  Layout,
  Palette,
  Eye,
  FileText,
  RotateCcw,
  Plus,
  Trash2,
  GripVertical,
  Download,
  Languages,
  Paintbrush,
  Camera,
  BarChart3,
  Layers,
  Lightbulb,
  Smartphone,
  TypeIcon,
  Copy,
  Search,
  ImageIcon,
  BookOpen,
  X,
  Filter,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════
// ─── Step Progress Bar ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
const STEPS = [
  { id: 1, label: "卖点梳理", icon: Target, desc: "AI分析+人工确认" },
  { id: 2, label: "图片大纲", icon: Layout, desc: "内容规划+确认" },
  { id: 3, label: "风格确认", icon: Palette, desc: "视觉风格选择" },
  { id: 4, label: "参考图确认", icon: Eye, desc: "构图+效果参考" },
  { id: 5, label: "图片建议", icon: FileText, desc: "最终输出" },
];

function StepProgressBar({
  currentStep,
  session,
  onStepClick,
}: {
  currentStep: number;
  session: any;
  onStepClick: (step: number) => void;
}) {
  const getStepStatus = (stepId: number) => {
    if (!session) return stepId === 1 ? "current" : "locked";
    const confirmed = [
      false,
      !!session.step1Confirmed,
      !!session.step2Confirmed,
      !!session.step3Confirmed,
      !!session.step4Confirmed,
      !!session.step5Confirmed,
    ];
    if (confirmed[stepId]) return "completed";
    if (stepId === currentStep) return "current";
    if (stepId < currentStep) return "completed";
    // Check if previous step is confirmed
    if (stepId > 1 && confirmed[stepId - 1]) return "available";
    return "locked";
  };

  return (
    <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
      {STEPS.map((step, idx) => {
        const status = getStepStatus(step.id);
        const Icon = step.icon;
        const isClickable = status !== "locked";

        return (
          <div key={step.id} className="flex items-center">
            <button
              onClick={() => isClickable && onStepClick(step.id)}
              disabled={!isClickable}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm whitespace-nowrap ${
                status === "completed"
                  ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                  : status === "current"
                  ? "bg-primary/10 text-primary border border-primary/30 shadow-sm"
                  : status === "available"
                  ? "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                  : "bg-gray-50 text-gray-400 border border-gray-100 cursor-not-allowed"
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                status === "completed"
                  ? "bg-green-500 text-white"
                  : status === "current"
                  ? "bg-primary text-primary-foreground"
                  : "bg-gray-200 text-gray-500"
              }`}>
                {status === "completed" ? <Check className="w-3.5 h-3.5" /> : step.id}
              </div>
              <div className="text-left">
                <div className="font-medium leading-tight">{step.label}</div>
                <div className="text-[10px] opacity-60">{step.desc}</div>
              </div>
            </button>
            {idx < STEPS.length - 1 && (
              <ChevronRight className="w-4 h-4 text-gray-300 mx-1 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Step 1: Selling Points ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
function Step1SellingPoints({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const generateMutation = trpc.imageWorkflow.generateStep1.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep1.useMutation();
  const [editData, setEditData] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Load existing data
  useEffect(() => {
    if (session?.step1UserEdit) {
      try { setEditData(JSON.parse(session.step1UserEdit)); } catch {}
    } else if (session?.step1AiResult) {
      try { setEditData(JSON.parse(session.step1AiResult)); } catch {}
    }
  }, [session?.step1AiResult, session?.step1UserEdit]);

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ projectId });
      setEditData(result);
      setIsEditing(true);
      toast.success("卖点梳理完成，请检查并确认");
    } catch (err: any) {
      toast.error(err.message || "生成失败");
    }
  };

  const handleConfirm = async () => {
    if (!editData) return;
    try {
      await confirmMutation.mutateAsync({
        projectId,
        userEdit: JSON.stringify(editData),
      });
      toast.success("卖点已确认，可以进入下一步");
      onConfirm();
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  // Editable list helpers
  const updateItem = (category: string, index: number, field: string, value: any) => {
    if (!editData) return;
    const newData = { ...editData };
    if (newData[category] && Array.isArray(newData[category])) {
      newData[category] = [...newData[category]];
      newData[category][index] = { ...newData[category][index], [field]: value };
    }
    setEditData(newData);
  };

  const removeItem = (category: string, index: number) => {
    if (!editData) return;
    const newData = { ...editData };
    if (newData[category] && Array.isArray(newData[category])) {
      newData[category] = newData[category].filter((_: any, i: number) => i !== index);
    }
    setEditData(newData);
  };

  const addItem = (category: string, template: any) => {
    if (!editData) return;
    const newData = { ...editData };
    if (!newData[category]) newData[category] = [];
    newData[category] = [...newData[category], { ...template, id: newData[category].length + 1 }];
    setEditData(newData);
  };

  const isConfirmed = !!session?.step1Confirmed;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                Step 1: 卖点梳理
              </CardTitle>
              <CardDescription>AI分析竞品数据和产品画像，梳理核心卖点、次要卖点、好差评点、必要性描述和使用场景</CardDescription>
            </div>
            <div className="flex gap-2">
              {!editData && (
                <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  AI生成卖点
                </Button>
              )}
              {editData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    重新生成
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认卖点
                  </Button>
                </>
              )}
              {isConfirmed && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <Check className="w-3 h-3 mr-1" /> 已确认
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        {generateMutation.isPending && (
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mr-3" />
              <span className="text-muted-foreground">AI正在分析产品数据，梳理卖点体系...</span>
            </div>
          </CardContent>
        )}
      </Card>

      {editData && !generateMutation.isPending && (
        <>
          {/* Core Selling Points */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold">核</span>
                  核心卖点（不超过2个）
                </CardTitle>
                {!isConfirmed && editData.coreSellingPoints?.length < 2 && (
                  <Button variant="ghost" size="sm" onClick={() => addItem("coreSellingPoints", { point: "", whyCore: "", expressionStrategies: [""], memoryHook: "" })}>
                    <Plus className="w-3 h-3 mr-1" /> 添加
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {editData.coreSellingPoints?.map((sp: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 space-y-2 bg-red-50/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">卖点</label>
                        {isConfirmed ? (
                          <p className="text-sm font-medium">{sp.point}</p>
                        ) : (
                          <Input value={sp.point || ""} onChange={(e) => updateItem("coreSellingPoints", idx, "point", e.target.value)} className="h-8 text-sm" />
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">为什么是核心</label>
                        {isConfirmed ? (
                          <p className="text-sm text-muted-foreground">{sp.whyCore}</p>
                        ) : (
                          <Textarea value={sp.whyCore || ""} onChange={(e) => updateItem("coreSellingPoints", idx, "whyCore", e.target.value)} className="min-h-[50px] text-sm" />
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">记忆点/口号</label>
                        {isConfirmed ? (
                          <p className="text-sm italic text-primary">{sp.memoryHook}</p>
                        ) : (
                          <Input value={sp.memoryHook || ""} onChange={(e) => updateItem("coreSellingPoints", idx, "memoryHook", e.target.value)} className="h-8 text-sm" />
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">表达策略</label>
                        {isConfirmed ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {sp.expressionStrategies?.map((s: string, i: number) => (
                              <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>
                            ))}
                          </div>
                        ) : (
                          <Textarea
                            value={sp.expressionStrategies?.join("\n") || ""}
                            onChange={(e) => updateItem("coreSellingPoints", idx, "expressionStrategies", e.target.value.split("\n"))}
                            className="min-h-[60px] text-sm"
                            placeholder="每行一个表达策略"
                          />
                        )}
                      </div>
                    </div>
                    {!isConfirmed && (
                      <Button variant="ghost" size="icon" className="shrink-0 text-red-400 hover:text-red-600" onClick={() => removeItem("coreSellingPoints", idx)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Secondary Selling Points */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">次</span>
                  次要卖点
                </CardTitle>
                {!isConfirmed && (
                  <Button variant="ghost" size="sm" onClick={() => addItem("secondarySellingPoints", { point: "", value: "", suggestedExpression: "" })}>
                    <Plus className="w-3 h-3 mr-1" /> 添加
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {editData.secondarySellingPoints?.map((sp: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 bg-blue-50/30 flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    {isConfirmed ? (
                      <>
                        <p className="text-sm font-medium">{sp.point}</p>
                        <p className="text-xs text-muted-foreground">{sp.value}</p>
                        <p className="text-xs text-blue-600">建议表达: {sp.suggestedExpression}</p>
                      </>
                    ) : (
                      <>
                        <Input value={sp.point || ""} onChange={(e) => updateItem("secondarySellingPoints", idx, "point", e.target.value)} placeholder="卖点" className="h-7 text-sm" />
                        <Input value={sp.value || ""} onChange={(e) => updateItem("secondarySellingPoints", idx, "value", e.target.value)} placeholder="附加价值" className="h-7 text-sm" />
                        <Input value={sp.suggestedExpression || ""} onChange={(e) => updateItem("secondarySellingPoints", idx, "suggestedExpression", e.target.value)} placeholder="建议表达" className="h-7 text-sm" />
                      </>
                    )}
                  </div>
                  {!isConfirmed && (
                    <Button variant="ghost" size="icon" className="shrink-0 text-red-400 hover:text-red-600" onClick={() => removeItem("secondarySellingPoints", idx)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Negative Review Points */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold">差</span>
                  差评点分析
                </CardTitle>
                {!isConfirmed && (
                  <Button variant="ghost" size="sm" onClick={() => addItem("negativeReviewPoints", { point: "", status: "resolved", imageStrategy: "" })}>
                    <Plus className="w-3 h-3 mr-1" /> 添加
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {editData.negativeReviewPoints?.map((sp: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 bg-orange-50/30 flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    {isConfirmed ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Badge variant={sp.status === "resolved" ? "default" : "destructive"} className="text-xs">
                            {sp.status === "resolved" ? "已解决" : "未解决"}
                          </Badge>
                          <span className="text-sm font-medium">{sp.point}</span>
                        </div>
                        <p className="text-xs text-orange-600">图片策略: {sp.imageStrategy}</p>
                      </>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <select
                            value={sp.status || "resolved"}
                            onChange={(e) => updateItem("negativeReviewPoints", idx, "status", e.target.value)}
                            className="h-7 text-xs border rounded px-2"
                          >
                            <option value="resolved">已解决</option>
                            <option value="unresolved">未解决</option>
                          </select>
                          <Input value={sp.point || ""} onChange={(e) => updateItem("negativeReviewPoints", idx, "point", e.target.value)} placeholder="差评点" className="h-7 text-sm flex-1" />
                        </div>
                        <Input value={sp.imageStrategy || ""} onChange={(e) => updateItem("negativeReviewPoints", idx, "imageStrategy", e.target.value)} placeholder="图片策略" className="h-7 text-sm" />
                      </>
                    )}
                  </div>
                  {!isConfirmed && (
                    <Button variant="ghost" size="icon" className="shrink-0 text-red-400 hover:text-red-600" onClick={() => removeItem("negativeReviewPoints", idx)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Positive Review Points */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs font-bold">好</span>
                  好评点
                </CardTitle>
                {!isConfirmed && (
                  <Button variant="ghost" size="sm" onClick={() => addItem("positiveReviewPoints", { point: "", frequency: "中", reinforceStrategy: "" })}>
                    <Plus className="w-3 h-3 mr-1" /> 添加
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {editData.positiveReviewPoints?.map((sp: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 bg-green-50/30 flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    {isConfirmed ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700">频率: {sp.frequency}</Badge>
                          <span className="text-sm font-medium">{sp.point}</span>
                        </div>
                        <p className="text-xs text-green-600">强化策略: {sp.reinforceStrategy}</p>
                      </>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <select
                            value={sp.frequency || "中"}
                            onChange={(e) => updateItem("positiveReviewPoints", idx, "frequency", e.target.value)}
                            className="h-7 text-xs border rounded px-2"
                          >
                            <option value="高">高频</option>
                            <option value="中">中频</option>
                            <option value="低">低频</option>
                          </select>
                          <Input value={sp.point || ""} onChange={(e) => updateItem("positiveReviewPoints", idx, "point", e.target.value)} placeholder="好评点" className="h-7 text-sm flex-1" />
                        </div>
                        <Input value={sp.reinforceStrategy || ""} onChange={(e) => updateItem("positiveReviewPoints", idx, "reinforceStrategy", e.target.value)} placeholder="强化策略" className="h-7 text-sm" />
                      </>
                    )}
                  </div>
                  {!isConfirmed && (
                    <Button variant="ghost" size="icon" className="shrink-0 text-red-400 hover:text-red-600" onClick={() => removeItem("positiveReviewPoints", idx)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Necessity Descriptions */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold">必</span>
                  必要性描述
                </CardTitle>
                {!isConfirmed && (
                  <Button variant="ghost" size="sm" onClick={() => addItem("necessityDescriptions", { type: "参数", content: "", displayPriority: "中" })}>
                    <Plus className="w-3 h-3 mr-1" /> 添加
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {editData.necessityDescriptions?.map((nd: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 bg-purple-50/30 flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    {isConfirmed ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{nd.type}</Badge>
                        <Badge variant="outline" className="text-xs">{nd.displayPriority}</Badge>
                        <span className="text-sm">{nd.content}</span>
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <select value={nd.type || "参数"} onChange={(e) => updateItem("necessityDescriptions", idx, "type", e.target.value)} className="h-7 text-xs border rounded px-2">
                          <option value="参数">参数</option>
                          <option value="尺寸">尺寸</option>
                          <option value="适配性">适配性</option>
                          <option value="材质">材质</option>
                          <option value="认证">认证</option>
                        </select>
                        <select value={nd.displayPriority || "中"} onChange={(e) => updateItem("necessityDescriptions", idx, "displayPriority", e.target.value)} className="h-7 text-xs border rounded px-2">
                          <option value="高">高优先</option>
                          <option value="中">中优先</option>
                          <option value="低">低优先</option>
                        </select>
                        <Input value={nd.content || ""} onChange={(e) => updateItem("necessityDescriptions", idx, "content", e.target.value)} placeholder="描述内容" className="h-7 text-sm flex-1 min-w-[200px]" />
                      </div>
                    )}
                  </div>
                  {!isConfirmed && (
                    <Button variant="ghost" size="icon" className="shrink-0 text-red-400 hover:text-red-600" onClick={() => removeItem("necessityDescriptions", idx)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Scenes */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-cyan-100 text-cyan-600 flex items-center justify-center text-xs font-bold">景</span>
                  使用场景及占比
                </CardTitle>
                {!isConfirmed && (
                  <Button variant="ghost" size="sm" onClick={() => addItem("scenes", { scene: "", percentage: 10, targetAudience: "", emotionalAppeal: "" })}>
                    <Plus className="w-3 h-3 mr-1" /> 添加
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {editData.scenes?.map((sc: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 bg-cyan-50/30 flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    {isConfirmed ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-cyan-100 text-cyan-700 text-xs">{sc.percentage}%</Badge>
                          <span className="text-sm font-medium">{sc.scene}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">目标人群: {sc.targetAudience} | 情感诉求: {sc.emotionalAppeal}</p>
                      </>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Input type="number" value={sc.percentage || 0} onChange={(e) => updateItem("scenes", idx, "percentage", parseInt(e.target.value) || 0)} className="h-7 text-sm w-20" min={0} max={100} />
                          <span className="text-sm self-center">%</span>
                          <Input value={sc.scene || ""} onChange={(e) => updateItem("scenes", idx, "scene", e.target.value)} placeholder="场景描述" className="h-7 text-sm flex-1" />
                        </div>
                        <div className="flex gap-2">
                          <Input value={sc.targetAudience || ""} onChange={(e) => updateItem("scenes", idx, "targetAudience", e.target.value)} placeholder="目标人群" className="h-7 text-sm flex-1" />
                          <Input value={sc.emotionalAppeal || ""} onChange={(e) => updateItem("scenes", idx, "emotionalAppeal", e.target.value)} placeholder="情感诉求" className="h-7 text-sm flex-1" />
                        </div>
                      </>
                    )}
                  </div>
                  {!isConfirmed && (
                    <Button variant="ghost" size="icon" className="shrink-0 text-red-400 hover:text-red-600" onClick={() => removeItem("scenes", idx)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Overall Strategy */}
          {editData.overallStrategy && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">整体策略</CardTitle>
              </CardHeader>
              <CardContent>
                {isConfirmed ? (
                  <p className="text-sm text-muted-foreground">{editData.overallStrategy}</p>
                ) : (
                  <Textarea
                    value={editData.overallStrategy || ""}
                    onChange={(e) => setEditData({ ...editData, overallStrategy: e.target.value })}
                    className="min-h-[80px] text-sm"
                  />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Step 2: Image Outline ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
function Step2ImageOutline({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const generateMutation = trpc.imageWorkflow.generateStep2.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep2.useMutation();
  const [editData, setEditData] = useState<any>(null);

  useEffect(() => {
    if (session?.step2UserEdit) {
      try { setEditData(JSON.parse(session.step2UserEdit)); } catch {}
    } else if (session?.step2AiResult) {
      try { setEditData(JSON.parse(session.step2AiResult)); } catch {}
    }
  }, [session?.step2AiResult, session?.step2UserEdit]);

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ projectId });
      setEditData(result);
      toast.success("图片大纲生成完成");
    } catch (err: any) {
      toast.error(err.message || "生成失败");
    }
  };

  const handleConfirm = async () => {
    if (!editData) return;
    try {
      await confirmMutation.mutateAsync({ projectId, userEdit: JSON.stringify(editData) });
      toast.success("图片大纲已确认");
      onConfirm();
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  const isConfirmed = !!session?.step2Confirmed;

  const updateSecondaryImage = (idx: number, field: string, value: any) => {
    if (!editData) return;
    const newData = { ...editData, secondaryImages: [...(editData.secondaryImages || [])] };
    newData.secondaryImages[idx] = { ...newData.secondaryImages[idx], [field]: value };
    setEditData(newData);
  };

  const updateAPlusModule = (idx: number, field: string, value: any) => {
    if (!editData) return;
    const newData = { ...editData, aPlusModules: [...(editData.aPlusModules || [])] };
    newData.aPlusModules[idx] = { ...newData.aPlusModules[idx], [field]: value };
    setEditData(newData);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layout className="w-5 h-5 text-primary" />
                Step 2: 图片大纲
              </CardTitle>
              <CardDescription>规划每张图片的内容、呼应的卖点和安排理由</CardDescription>
            </div>
            <div className="flex gap-2">
              {!editData && (
                <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  AI生成大纲
                </Button>
              )}
              {editData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
                    <RotateCcw className="w-4 h-4 mr-2" /> 重新生成
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认大纲
                  </Button>
                </>
              )}
              {isConfirmed && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <Check className="w-3 h-3 mr-1" /> 已确认
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        {generateMutation.isPending && (
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mr-3" />
              <span className="text-muted-foreground">AI正在规划图片大纲...</span>
            </div>
          </CardContent>
        )}
      </Card>

      {editData && !generateMutation.isPending && (
        <>
          {/* Main Image */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="w-4 h-4 text-primary" /> 主图
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isConfirmed ? (
                <>
                  <p className="text-sm"><strong>目的:</strong> {editData.mainImage?.purpose}</p>
                  <p className="text-sm"><strong>内容:</strong> {editData.mainImage?.contentBrief}</p>
                  <p className="text-sm text-muted-foreground"><strong>理由:</strong> {editData.mainImage?.whyThisWay}</p>
                </>
              ) : (
                <>
                  <Input value={editData.mainImage?.purpose || ""} onChange={(e) => setEditData({ ...editData, mainImage: { ...editData.mainImage, purpose: e.target.value } })} placeholder="主图目的" className="h-8 text-sm" />
                  <Textarea value={editData.mainImage?.contentBrief || ""} onChange={(e) => setEditData({ ...editData, mainImage: { ...editData.mainImage, contentBrief: e.target.value } })} placeholder="内容简述" className="min-h-[50px] text-sm" />
                  <Textarea value={editData.mainImage?.whyThisWay || ""} onChange={(e) => setEditData({ ...editData, mainImage: { ...editData.mainImage, whyThisWay: e.target.value } })} placeholder="为什么这样安排" className="min-h-[50px] text-sm" />
                </>
              )}
            </CardContent>
          </Card>

          {/* Secondary Images */}
          {editData.secondaryImages?.map((img: any, idx: number) => (
            <Card key={idx}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Image className="w-4 h-4 text-blue-500" /> 辅图 {img.imageNumber || idx + 2}
                  {img.priority && <Badge variant="outline" className="text-xs">{img.priority}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isConfirmed ? (
                  <>
                    <p className="text-sm"><strong>目的:</strong> {img.purpose}</p>
                    <p className="text-sm"><strong>内容:</strong> {img.contentBrief}</p>
                    <p className="text-sm"><strong>表达类型:</strong> {img.expressionType}</p>
                    <p className="text-sm"><strong>呼应卖点:</strong> {img.sellingPointRefs?.join(", ")}</p>
                    <p className="text-sm text-muted-foreground"><strong>理由:</strong> {img.whyThisWay}</p>
                  </>
                ) : (
                  <>
                    <Input value={img.purpose || ""} onChange={(e) => updateSecondaryImage(idx, "purpose", e.target.value)} placeholder="图片目的" className="h-8 text-sm" />
                    <Textarea value={img.contentBrief || ""} onChange={(e) => updateSecondaryImage(idx, "contentBrief", e.target.value)} placeholder="内容简述" className="min-h-[50px] text-sm" />
                    <Input value={img.expressionType || ""} onChange={(e) => updateSecondaryImage(idx, "expressionType", e.target.value)} placeholder="表达类型" className="h-8 text-sm" />
                    <Input value={img.sellingPointRefs?.join(", ") || ""} onChange={(e) => updateSecondaryImage(idx, "sellingPointRefs", e.target.value.split(", "))} placeholder="呼应卖点（逗号分隔）" className="h-8 text-sm" />
                    <Textarea value={img.whyThisWay || ""} onChange={(e) => updateSecondaryImage(idx, "whyThisWay", e.target.value)} placeholder="为什么这样安排" className="min-h-[50px] text-sm" />
                  </>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Brand Story */}
          {editData.brandStory && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" /> 品牌故事
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isConfirmed ? (
                  <>
                    <p className="text-sm"><strong>主题:</strong> {editData.brandStory.theme}</p>
                    <p className="text-sm"><strong>内容:</strong> {editData.brandStory.contentBrief}</p>
                    <p className="text-sm"><strong>情感诉求:</strong> {editData.brandStory.emotionalAppeal}</p>
                  </>
                ) : (
                  <>
                    <Input value={editData.brandStory.theme || ""} onChange={(e) => setEditData({ ...editData, brandStory: { ...editData.brandStory, theme: e.target.value } })} placeholder="品牌故事主题" className="h-8 text-sm" />
                    <Textarea value={editData.brandStory.contentBrief || ""} onChange={(e) => setEditData({ ...editData, brandStory: { ...editData.brandStory, contentBrief: e.target.value } })} placeholder="内容简述" className="min-h-[50px] text-sm" />
                    <Input value={editData.brandStory.emotionalAppeal || ""} onChange={(e) => setEditData({ ...editData, brandStory: { ...editData.brandStory, emotionalAppeal: e.target.value } })} placeholder="情感诉求" className="h-8 text-sm" />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* A+ Modules */}
          {editData.aPlusModules?.map((mod: any, idx: number) => (
            <Card key={idx}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-500" /> A+ 模块 {mod.moduleNumber || idx + 1}
                  {mod.moduleType && <Badge variant="outline" className="text-xs">{mod.moduleType}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isConfirmed ? (
                  <>
                    <p className="text-sm"><strong>目的:</strong> {mod.purpose}</p>
                    <p className="text-sm"><strong>内容:</strong> {mod.contentBrief}</p>
                    <p className="text-sm"><strong>位置逻辑:</strong> {mod.position}</p>
                  </>
                ) : (
                  <>
                    <Input value={mod.moduleType || ""} onChange={(e) => updateAPlusModule(idx, "moduleType", e.target.value)} placeholder="模块类型" className="h-8 text-sm" />
                    <Input value={mod.purpose || ""} onChange={(e) => updateAPlusModule(idx, "purpose", e.target.value)} placeholder="模块目的" className="h-8 text-sm" />
                    <Textarea value={mod.contentBrief || ""} onChange={(e) => updateAPlusModule(idx, "contentBrief", e.target.value)} placeholder="内容简述" className="min-h-[50px] text-sm" />
                    <Input value={mod.position || ""} onChange={(e) => updateAPlusModule(idx, "position", e.target.value)} placeholder="位置逻辑" className="h-8 text-sm" />
                  </>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Overall Narrative */}
          {editData.overallNarrative && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">整套图片叙事逻辑</CardTitle>
              </CardHeader>
              <CardContent>
                {isConfirmed ? (
                  <p className="text-sm text-muted-foreground">{editData.overallNarrative}</p>
                ) : (
                  <Textarea value={editData.overallNarrative || ""} onChange={(e) => setEditData({ ...editData, overallNarrative: e.target.value })} className="min-h-[80px] text-sm" />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Step 3: Style Confirmation ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
function Step3StyleConfirm({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const generateMutation = trpc.imageWorkflow.generateStep3.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep3.useMutation();
  const [aiResult, setAiResult] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    if (session?.step3UserEdit) {
      try {
        const parsed = JSON.parse(session.step3UserEdit);
        setSelectedIds(parsed.selectedIds || []);
        if (session.step3AiResult) setAiResult(JSON.parse(session.step3AiResult));
      } catch {}
    } else if (session?.step3AiResult) {
      try { setAiResult(JSON.parse(session.step3AiResult)); } catch {}
    }
  }, [session?.step3AiResult, session?.step3UserEdit]);

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ projectId });
      setAiResult(result);
      setSelectedIds([]);
      toast.success("风格方案推荐完成");
    } catch (err: any) {
      toast.error(err.message || "生成失败");
    }
  };

  const toggleStyle = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      if (prev.length >= 2) {
        toast.info("最多选择2个风格");
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleConfirm = async () => {
    if (selectedIds.length === 0) {
      toast.error("请至少选择1个风格方案");
      return;
    }
    try {
      const selectedStyles = aiResult?.styleOptions?.filter((s: any) => selectedIds.includes(s.id)) || [];
      await confirmMutation.mutateAsync({
        projectId,
        userEdit: JSON.stringify({ selectedIds, selectedStyles }),
      });
      toast.success("风格已确认");
      onConfirm();
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  const isConfirmed = !!session?.step3Confirmed;

  // Color swatch helper
  const ColorDot = ({ color }: { color: string }) => {
    const hex = color?.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || "#ccc";
    return <div className="w-5 h-5 rounded-full border border-gray-300" style={{ backgroundColor: hex }} title={color} />;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5 text-primary" />
                Step 3: 风格确认
              </CardTitle>
              <CardDescription>AI推荐视觉风格方案，选择1-2个确认</CardDescription>
            </div>
            <div className="flex gap-2">
              {!aiResult && (
                <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  AI推荐风格
                </Button>
              )}
              {aiResult && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
                    <RotateCcw className="w-4 h-4 mr-2" /> 重新推荐
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending || selectedIds.length === 0}>
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认风格 ({selectedIds.length}/2)
                  </Button>
                </>
              )}
              {isConfirmed && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <Check className="w-3 h-3 mr-1" /> 已确认
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        {generateMutation.isPending && (
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mr-3" />
              <span className="text-muted-foreground">AI正在分析产品特性，推荐视觉风格...</span>
            </div>
          </CardContent>
        )}
      </Card>

      {aiResult?.styleOptions && !generateMutation.isPending && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {aiResult.styleOptions.map((style: any) => {
            const isSelected = selectedIds.includes(style.id);
            return (
              <Card
                key={style.id}
                className={`cursor-pointer transition-all ${
                  isSelected
                    ? "ring-2 ring-primary border-primary shadow-md"
                    : isConfirmed && !isSelected
                    ? "opacity-40"
                    : "hover:shadow-sm"
                }`}
                onClick={() => !isConfirmed && toggleStyle(style.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{style.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      {style.suitability && <Badge variant="outline" className="text-xs">适合度: {style.suitability}/10</Badge>}
                      {isSelected && <Badge className="bg-primary text-primary-foreground">已选</Badge>}
                    </div>
                  </div>
                  <CardDescription className="text-xs">{style.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Color Palette */}
                  <div>
                    <p className="text-xs font-medium mb-1">配色方案</p>
                    <div className="flex flex-wrap gap-2">
                      {style.colorPalette && Object.entries(style.colorPalette).map(([key, val]: [string, any]) => (
                        <div key={key} className="flex items-center gap-1">
                          <ColorDot color={val} />
                          <span className="text-[10px] text-muted-foreground">{key}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Typography */}
                  {style.typography && (
                    <div>
                      <p className="text-xs font-medium mb-1">字体</p>
                      <p className="text-xs text-muted-foreground">标题: {style.typography.headingFont} | 正文: {style.typography.bodyFont}</p>
                    </div>
                  )}
                  {/* Other info */}
                  <div className="flex flex-wrap gap-1">
                    {style.overallTone && <Badge variant="secondary" className="text-xs">{style.overallTone}</Badge>}
                    {style.iconStyle && <Badge variant="secondary" className="text-xs">图标: {style.iconStyle}</Badge>}
                    {style.backgroundStyle && <Badge variant="secondary" className="text-xs">背景: {style.backgroundStyle}</Badge>}
                  </div>
                  {/* Recommendation */}
                  {style.whyRecommend && (
                    <p className="text-xs text-muted-foreground border-t pt-2">{style.whyRecommend}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {aiResult?.recommendation && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              <strong>AI推荐:</strong> {aiResult.recommendation}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Knowledge Base Image Picker Dialog ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════
function KbImagePickerDialog({
  open,
  onOpenChange,
  onSelect,
  targetImageType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (images: Array<{ id: number; imageUrl: string; imagePosition: string; tagCategory: string; tagImageType: string; tagDesignStyle: string; tagColorScheme: string }>) => void;
  targetImageType?: string; // e.g. "主图", "辅图", "A+"
}) {
  const [filters, setFilters] = useState<{
    tagCategory?: string;
    tagColorScheme?: string;
    tagImageType?: string;
    tagDesignStyle?: string;
    imagePosition?: string;
  }>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Auto-set position filter based on target image type
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      if (targetImageType) {
        if (targetImageType === "主图") {
          setFilters(prev => ({ ...prev, imagePosition: "main" }));
        } else if (targetImageType?.includes("A+")) {
          setFilters(prev => ({ ...prev, imagePosition: "aplus" }));
        } else {
          setFilters(prev => ({ ...prev, imagePosition: "secondary" }));
        }
      }
    }
  }, [open, targetImageType]);

  const filterOptions = trpc.imageWorkflow.getKbImageFilterOptions.useQuery(undefined, { enabled: open });
  const kbImages = trpc.imageWorkflow.listKbImages.useQuery(
    Object.keys(filters).length > 0 ? filters : undefined,
    { enabled: open }
  );

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConfirmSelection = () => {
    const selected = (kbImages.data || []).filter(img => selectedIds.has(img.id)).map(img => ({
      id: img.id,
      imageUrl: img.imageUrl,
      imagePosition: img.imagePosition,
      tagCategory: img.tagCategory || "",
      tagImageType: img.tagImageType || "",
      tagDesignStyle: img.tagDesignStyle || "",
      tagColorScheme: img.tagColorScheme || "",
    }));
    onSelect(selected);
    onOpenChange(false);
  };

  const clearFilter = (key: string) => {
    setFilters(prev => {
      const next = { ...prev };
      delete (next as any)[key];
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            从知识库选择参考图
          </DialogTitle>
          <DialogDescription>
            从图片知识库中筛选并选择参考图片，支持按类目、色系、图片类型、设计风格筛选
          </DialogDescription>
        </DialogHeader>

        {/* Filter Bar */}
        <div className="flex flex-wrap gap-2 py-2 border-b">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="w-3.5 h-3.5" /> 筛选:
          </div>

          <Select value={filters.imagePosition || "__all__"} onValueChange={v => v === "__all__" ? clearFilter("imagePosition") : setFilters(prev => ({ ...prev, imagePosition: v }))}>
            <SelectTrigger className="h-7 text-xs w-[100px]">
              <SelectValue placeholder="位置" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部位置</SelectItem>
              <SelectItem value="main">主图</SelectItem>
              <SelectItem value="secondary">辅图</SelectItem>
              <SelectItem value="aplus">A+</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.tagCategory || "__all__"} onValueChange={v => v === "__all__" ? clearFilter("tagCategory") : setFilters(prev => ({ ...prev, tagCategory: v }))}>
            <SelectTrigger className="h-7 text-xs w-[110px]">
              <SelectValue placeholder="类目" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部类目</SelectItem>
              {(filterOptions.data?.categories || []).map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.tagColorScheme || "__all__"} onValueChange={v => v === "__all__" ? clearFilter("tagColorScheme") : setFilters(prev => ({ ...prev, tagColorScheme: v }))}>
            <SelectTrigger className="h-7 text-xs w-[100px]">
              <SelectValue placeholder="色系" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部色系</SelectItem>
              {(filterOptions.data?.colorSchemes || []).map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.tagImageType || "__all__"} onValueChange={v => v === "__all__" ? clearFilter("tagImageType") : setFilters(prev => ({ ...prev, tagImageType: v }))}>
            <SelectTrigger className="h-7 text-xs w-[110px]">
              <SelectValue placeholder="图片类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部类型</SelectItem>
              {(filterOptions.data?.imageTypes || []).map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.tagDesignStyle || "__all__"} onValueChange={v => v === "__all__" ? clearFilter("tagDesignStyle") : setFilters(prev => ({ ...prev, tagDesignStyle: v }))}>
            <SelectTrigger className="h-7 text-xs w-[110px]">
              <SelectValue placeholder="设计风格" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部风格</SelectItem>
              {(filterOptions.data?.designStyles || []).map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {Object.values(filters).some(Boolean) && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFilters({})}>
              <X className="w-3 h-3 mr-1" /> 清除筛选
            </Button>
          )}
        </div>

        {/* Image Grid */}
        <ScrollArea className="flex-1 min-h-0" style={{ maxHeight: "50vh" }}>
          {kbImages.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
              <span className="text-sm text-muted-foreground">加载知识库图片...</span>
            </div>
          ) : (kbImages.data?.length || 0) === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <ImageIcon className="w-12 h-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">知识库中暂无图片，请先在图片知识库中导入图片</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 p-1">
              {(kbImages.data || []).map(img => {
                const isSelected = selectedIds.has(img.id);
                return (
                  <div
                    key={img.id}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      isSelected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-gray-300"
                    }`}
                    onClick={() => toggleSelect(img.id)}
                  >
                    <div className="aspect-square bg-gray-100">
                      <img
                        src={img.imageUrl}
                        alt={`KB image ${img.id}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    {/* Selection indicator */}
                    <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      isSelected ? "bg-primary border-primary" : "bg-white/80 border-gray-300 opacity-0 group-hover:opacity-100"
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    {/* Tags */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 pt-4">
                      <div className="flex flex-wrap gap-0.5">
                        {img.imagePosition && (
                          <span className="text-[9px] bg-white/20 text-white rounded px-1">
                            {img.imagePosition === "main" ? "主图" : img.imagePosition === "secondary" ? "辅图" : "A+"}
                          </span>
                        )}
                        {img.tagImageType && (
                          <span className="text-[9px] bg-blue-500/40 text-white rounded px-1">{img.tagImageType}</span>
                        )}
                        {img.tagDesignStyle && (
                          <span className="text-[9px] bg-purple-500/40 text-white rounded px-1">{img.tagDesignStyle}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer with selection count and confirm */}
        <div className="flex items-center justify-between pt-3 border-t">
          <div className="text-sm text-muted-foreground">
            {kbImages.data?.length || 0} 张图片
            {selectedIds.size > 0 && (
              <span className="ml-2 text-primary font-medium">· 已选 {selectedIds.size} 张</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
            <Button size="sm" disabled={selectedIds.size === 0} onClick={handleConfirmSelection}>
              <Check className="w-3.5 h-3.5 mr-1" /> 确认选择 ({selectedIds.size})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Step 4: Reference Images (含知识库图片选择) ─────────────────
// ═══════════════════════════════════════════════════════════════════
function Step4References({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const generateMutation = trpc.imageWorkflow.generateStep4.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep4.useMutation();
  const [editData, setEditData] = useState<any>(null);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [kbPickerTargetIdx, setKbPickerTargetIdx] = useState<number | null>(null);
  const [kbPickerTargetType, setKbPickerTargetType] = useState<string>("");

  useEffect(() => {
    if (session?.step4UserEdit) {
      try { setEditData(JSON.parse(session.step4UserEdit)); } catch {}
    } else if (session?.step4AiResult) {
      try { setEditData(JSON.parse(session.step4AiResult)); } catch {}
    }
  }, [session?.step4AiResult, session?.step4UserEdit]);

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ projectId });
      setEditData(result);
      toast.success("参考图推荐完成");
    } catch (err: any) {
      toast.error(err.message || "生成失败");
    }
  };

  const handleConfirm = async () => {
    if (!editData) return;
    try {
      await confirmMutation.mutateAsync({ projectId, userEdit: JSON.stringify(editData) });
      toast.success("参考图已确认");
      onConfirm();
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  const isConfirmed = !!session?.step4Confirmed;

  const updateRef = (idx: number, section: string, field: string, value: any) => {
    if (!editData) return;
    const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
    newData.imageReferences[idx] = {
      ...newData.imageReferences[idx],
      [section]: { ...newData.imageReferences[idx][section], [field]: value },
    };
    setEditData(newData);
  };

  // Open KB picker for a specific image reference
  const openKbPicker = (idx: number, imageType: string) => {
    setKbPickerTargetIdx(idx);
    setKbPickerTargetType(imageType);
    setKbPickerOpen(true);
  };

  // Handle KB image selection - attach selected images to the reference
  const handleKbImageSelect = (images: Array<{ id: number; imageUrl: string; imagePosition: string; tagCategory: string; tagImageType: string; tagDesignStyle: string; tagColorScheme: string }>) => {
    if (kbPickerTargetIdx === null || !editData) return;
    const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
    const ref = { ...newData.imageReferences[kbPickerTargetIdx] };

    // Attach selected KB images to this reference
    const existingKbImages = ref.kbReferenceImages || [];
    const newKbImages = [...existingKbImages, ...images.map(img => ({
      id: img.id,
      imageUrl: img.imageUrl,
      position: img.imagePosition,
      category: img.tagCategory,
      imageType: img.tagImageType,
      designStyle: img.tagDesignStyle,
      colorScheme: img.tagColorScheme,
    }))];
    ref.kbReferenceImages = newKbImages;
    newData.imageReferences[kbPickerTargetIdx] = ref;
    setEditData(newData);
    toast.success(`已添加 ${images.length} 张知识库参考图`);
  };

  // Remove a KB reference image
  const removeKbImage = (refIdx: number, imgIdx: number) => {
    if (!editData) return;
    const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
    const ref = { ...newData.imageReferences[refIdx] };
    const imgs = [...(ref.kbReferenceImages || [])];
    imgs.splice(imgIdx, 1);
    ref.kbReferenceImages = imgs;
    newData.imageReferences[refIdx] = ref;
    setEditData(newData);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-primary" />
                Step 4: 参考图确认
              </CardTitle>
              <CardDescription>每张图的构图参考和效果图参考，可从知识库直接选择参考图片</CardDescription>
            </div>
            <div className="flex gap-2">
              {!editData && (
                <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  AI推荐参考
                </Button>
              )}
              {editData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
                    <RotateCcw className="w-4 h-4 mr-2" /> 重新推荐
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认参考图
                  </Button>
                </>
              )}
              {isConfirmed && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <Check className="w-3 h-3 mr-1" /> 已确认
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        {generateMutation.isPending && (
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mr-3" />
              <span className="text-muted-foreground">AI正在推荐构图和效果参考...</span>
            </div>
          </CardContent>
        )}
      </Card>

      {editData?.imageReferences && !generateMutation.isPending && editData.imageReferences.map((ref: any, idx: number) => (
        <Card key={idx}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {ref.imageType === "主图" ? <Camera className="w-4 h-4 text-primary" /> : ref.imageType?.includes("A+") ? <Layers className="w-4 h-4 text-purple-500" /> : <Image className="w-4 h-4 text-blue-500" />}
                {ref.imageType} {ref.imageNumber > 0 ? `#${ref.imageNumber}` : ""}
                <span className="text-xs text-muted-foreground font-normal">— {ref.purpose}</span>
              </CardTitle>
              {!isConfirmed && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openKbPicker(idx, ref.imageType)}>
                  <BookOpen className="w-3.5 h-3.5 mr-1" /> 从知识库选图
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* KB Reference Images Section */}
            {(ref.kbReferenceImages?.length > 0) && (
              <div className="mb-4 border rounded-lg p-3 bg-emerald-50/30">
                <h4 className="text-sm font-medium text-emerald-700 mb-2 flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5" /> 知识库参考图 ({ref.kbReferenceImages.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {ref.kbReferenceImages.map((kbImg: any, imgIdx: number) => (
                    <div key={imgIdx} className="relative group">
                      <div className="w-20 h-20 rounded-lg overflow-hidden border border-emerald-200">
                        <img src={kbImg.imageUrl} alt={`KB ref ${imgIdx}`} className="w-full h-full object-cover" />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
                        <span className="text-[8px] text-white">
                          {kbImg.position === "main" ? "主图" : kbImg.position === "secondary" ? "辅图" : "A+"}
                          {kbImg.imageType ? ` · ${kbImg.imageType}` : ""}
                        </span>
                      </div>
                      {!isConfirmed && (
                        <button
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeKbImage(idx, imgIdx)}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Composition Reference */}
              <div className="border rounded-lg p-3 bg-blue-50/30">
                <h4 className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-1">
                  <Layout className="w-3.5 h-3.5" /> 构图参考
                </h4>
                {isConfirmed ? (
                  <div className="space-y-1 text-xs">
                    <p><strong>构图方式:</strong> {ref.compositionReference?.compositionType}</p>
                    <p><strong>布局:</strong> {ref.compositionReference?.layout}</p>
                    <p><strong>焦点:</strong> {ref.compositionReference?.focalPoint}</p>
                    <p><strong>视线引导:</strong> {ref.compositionReference?.visualFlow}</p>
                    <p><strong>比例:</strong> {ref.compositionReference?.proportions}</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Input value={ref.compositionReference?.compositionType || ""} onChange={(e) => updateRef(idx, "compositionReference", "compositionType", e.target.value)} placeholder="构图方式" className="h-7 text-xs" />
                    <Textarea value={ref.compositionReference?.layout || ""} onChange={(e) => updateRef(idx, "compositionReference", "layout", e.target.value)} placeholder="具体布局" className="min-h-[40px] text-xs" />
                    <Input value={ref.compositionReference?.focalPoint || ""} onChange={(e) => updateRef(idx, "compositionReference", "focalPoint", e.target.value)} placeholder="视觉焦点" className="h-7 text-xs" />
                    <Input value={ref.compositionReference?.visualFlow || ""} onChange={(e) => updateRef(idx, "compositionReference", "visualFlow", e.target.value)} placeholder="视线引导" className="h-7 text-xs" />
                    <Input value={ref.compositionReference?.proportions || ""} onChange={(e) => updateRef(idx, "compositionReference", "proportions", e.target.value)} placeholder="元素比例" className="h-7 text-xs" />
                  </div>
                )}
              </div>

              {/* Effect Reference */}
              <div className="border rounded-lg p-3 bg-amber-50/30">
                <h4 className="text-sm font-medium text-amber-700 mb-2 flex items-center gap-1">
                  <Paintbrush className="w-3.5 h-3.5" /> 效果参考
                </h4>
                {isConfirmed ? (
                  <div className="space-y-1 text-xs">
                    <p><strong>配色应用:</strong> {ref.effectReference?.colorApplication}</p>
                    <p><strong>字体应用:</strong> {ref.effectReference?.typographyApplication}</p>
                    <p><strong>图标应用:</strong> {ref.effectReference?.iconApplication}</p>
                    <p><strong>氛围:</strong> {ref.effectReference?.atmosphere}</p>
                    <p><strong>光影:</strong> {ref.effectReference?.lightingStyle}</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Textarea value={ref.effectReference?.colorApplication || ""} onChange={(e) => updateRef(idx, "effectReference", "colorApplication", e.target.value)} placeholder="配色应用" className="min-h-[40px] text-xs" />
                    <Input value={ref.effectReference?.typographyApplication || ""} onChange={(e) => updateRef(idx, "effectReference", "typographyApplication", e.target.value)} placeholder="字体应用" className="h-7 text-xs" />
                    <Input value={ref.effectReference?.iconApplication || ""} onChange={(e) => updateRef(idx, "effectReference", "iconApplication", e.target.value)} placeholder="图标应用" className="h-7 text-xs" />
                    <Input value={ref.effectReference?.atmosphere || ""} onChange={(e) => updateRef(idx, "effectReference", "atmosphere", e.target.value)} placeholder="视觉氛围" className="h-7 text-xs" />
                    <Input value={ref.effectReference?.lightingStyle || ""} onChange={(e) => updateRef(idx, "effectReference", "lightingStyle", e.target.value)} placeholder="光影风格" className="h-7 text-xs" />
                  </div>
                )}
              </div>
            </div>
            {ref.designNotes && (
              <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-muted-foreground">
                <strong>设计师注意:</strong> {ref.designNotes}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {editData?.overallConsistency && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              <strong>整套一致性要求:</strong> {editData.overallConsistency}
            </p>
          </CardContent>
        </Card>
      )}

      {/* KB Image Picker Dialog */}
      <KbImagePickerDialog
        open={kbPickerOpen}
        onOpenChange={setKbPickerOpen}
        onSelect={handleKbImageSelect}
        targetImageType={kbPickerTargetType}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Step 5: Final Suggestions (reuse existing display) ──────────
// ═══════════════════════════════════════════════════════════════════
function ColorSwatch({ color, label }: { color: string; label: string }) {
  const hex = color?.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || "#ccc";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-4 h-4 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: hex }} />
      <span className="text-xs">{label}: {color}</span>
    </div>
  );
}

function FABEDisplay({ fabe, variant = "en" }: { fabe: any; variant?: "en" | "cn" }) {
  if (!fabe) return null;
  const isEn = variant === "en";
  const textColor = isEn ? "text-blue-600" : "text-orange-600";
  const bgColor = isEn ? "bg-blue-50" : "bg-orange-50";
  const borderColor = isEn ? "border-blue-200" : "border-orange-200";
  const items = [
    { key: "feature", label: "F - 特征" },
    { key: "advantage", label: "A - 优势" },
    { key: "benefit", label: "B - 利益" },
    { key: "evidence", label: "E - 证据" },
  ];
  return (
    <div className={`${bgColor} ${borderColor} border rounded-lg p-2 space-y-1`}>
      <p className={`text-xs font-medium ${textColor}`}>FABE分析</p>
      {items.map(({ key, label }) => (
        fabe[key] ? (
          <div key={key} className="flex gap-1 text-xs">
            <span className={`font-medium ${textColor} shrink-0`}>{label}:</span>
            <span className="text-muted-foreground">{fabe[key]}</span>
          </div>
        ) : null
      ))}
    </div>
  );
}

function Step5FinalSuggestions({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const generateMutation = trpc.imageWorkflow.generateStep5.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep5.useMutation();
  const [enData, setEnData] = useState<any>(null);
  const [cnData, setCnData] = useState<any>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (session?.step5AiResult) {
      try { setEnData(JSON.parse(session.step5UserEdit || session.step5AiResult)); } catch {}
    }
    if (session?.step5AiResultCn) {
      try { setCnData(JSON.parse(session.step5AiResultCn)); } catch {}
    }
  }, [session?.step5AiResult, session?.step5AiResultCn, session?.step5UserEdit]);

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ projectId });
      setEnData(result.en);
      setCnData(result.cn);
      toast.success("图片建议生成完成");
    } catch (err: any) {
      toast.error(err.message || "生成失败");
    }
  };

  const handleConfirm = async () => {
    if (!enData) return;
    try {
      await confirmMutation.mutateAsync({ projectId, userEdit: JSON.stringify(enData) });
      toast.success("图片建议已确认");
      onConfirm();
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  // A+ drag and drop
  const handleDragStart = (idx: number) => setDraggedIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    const sections = [...(enData?.aPlusContent?.sections || [])];
    const [moved] = sections.splice(draggedIdx, 1);
    sections.splice(idx, 0, moved);
    setEnData({ ...enData, aPlusContent: { ...enData.aPlusContent, sections } });
    // Also reorder CN if available
    if (cnData?.aPlusContent?.sections) {
      const cnSections = [...cnData.aPlusContent.sections];
      const [cnMoved] = cnSections.splice(draggedIdx, 1);
      cnSections.splice(idx, 0, cnMoved);
      setCnData({ ...cnData, aPlusContent: { ...cnData.aPlusContent, sections: cnSections } });
    }
    setDraggedIdx(idx);
  };
  const handleDragEnd = () => setDraggedIdx(null);

  // PDF export
  const handleExportPdf = async () => {
    toast.info("正在准备PDF导出...");
    try {
      // Build content for PDF
      const content = buildPdfContent(enData, cnData);
      const blob = new Blob([content], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "image-suggestions.html";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("已导出HTML文件，可在浏览器中打印为PDF");
    } catch {
      toast.error("导出失败");
    }
  };

  const isConfirmed = !!session?.step5Confirmed;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Step 5: 图片结构及内容建议
              </CardTitle>
              <CardDescription>综合所有确认结果，输出最终图片建议（中英文对照）</CardDescription>
            </div>
            <div className="flex gap-2">
              {!enData && (
                <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  生成最终建议
                </Button>
              )}
              {enData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
                    <RotateCcw className="w-4 h-4 mr-2" /> 重新生成
                  </Button>
                  <Button variant="outline" onClick={handleExportPdf}>
                    <Download className="w-4 h-4 mr-2" /> 导出PDF
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认建议
                  </Button>
                </>
              )}
              {isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleExportPdf}>
                    <Download className="w-4 h-4 mr-2" /> 导出PDF
                  </Button>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Check className="w-3 h-3 mr-1" /> 已确认
                  </Badge>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        {generateMutation.isPending && (
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mr-3" />
              <span className="text-muted-foreground">AI正在综合生成最终图片建议（含中文翻译）...</span>
            </div>
          </CardContent>
        )}
      </Card>

      {enData && !generateMutation.isPending && (
        <>
          {/* Design Guidelines */}
          {enData.designGuidelines && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Paintbrush className="w-4 h-4 text-primary" /> 设计指南
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 border-r pr-4">
                    <Badge variant="outline" className="text-xs">English</Badge>
                    <p className="text-xs"><strong>Font:</strong> {enData.designGuidelines.fontRecommendation}</p>
                    <p className="text-xs"><strong>Color Palette:</strong> {enData.designGuidelines.overallColorPalette}</p>
                    <p className="text-xs"><strong>Brand Tone:</strong> {enData.designGuidelines.brandTone}</p>
                    <p className="text-xs"><strong>Mobile:</strong> {enData.designGuidelines.mobileOptimization}</p>
                  </div>
                  <div className="space-y-2">
                    <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700">中文</Badge>
                    {cnData?.designGuidelines ? (
                      <>
                        <p className="text-xs"><strong>字体:</strong> {cnData.designGuidelines.fontRecommendation}</p>
                        <p className="text-xs"><strong>配色:</strong> {cnData.designGuidelines.overallColorPalette}</p>
                        <p className="text-xs"><strong>品牌调性:</strong> {cnData.designGuidelines.brandTone}</p>
                        <p className="text-xs"><strong>手机端:</strong> {cnData.designGuidelines.mobileOptimization}</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">中文翻译未生成</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Main Image */}
          {enData.mainImage && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Camera className="w-4 h-4 text-primary" /> 主图 (Main Image)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 border-r pr-4">
                    <Badge variant="outline" className="text-xs">English</Badge>
                    <p className="text-sm font-medium">{enData.mainImage.title}</p>
                    <p className="text-xs"><strong>Concept:</strong> {enData.mainImage.concept}</p>
                    <p className="text-xs"><strong>Composition:</strong> {enData.mainImage.composition}</p>
                    {enData.mainImage.colorScheme && (
                      <div className="space-y-0.5">
                        <ColorSwatch color={enData.mainImage.colorScheme.primary || ""} label="Primary" />
                        <ColorSwatch color={enData.mainImage.colorScheme.secondary || ""} label="Secondary" />
                        <ColorSwatch color={enData.mainImage.colorScheme.accent || ""} label="Accent" />
                      </div>
                    )}
                    <p className="text-xs"><strong>Shooting:</strong> {enData.mainImage.shootingNotes}</p>
                  </div>
                  <div className="space-y-2">
                    <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700">中文</Badge>
                    {cnData?.mainImage ? (
                      <>
                        <p className="text-sm font-medium text-orange-700">{cnData.mainImage.title}</p>
                        <p className="text-xs"><strong>概念:</strong> {cnData.mainImage.concept}</p>
                        <p className="text-xs"><strong>构图:</strong> {cnData.mainImage.composition}</p>
                        <p className="text-xs"><strong>拍摄:</strong> {cnData.mainImage.shootingNotes}</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">中文翻译未生成</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Secondary Images */}
          {enData.secondaryImages?.map((img: any, idx: number) => {
            const cnImg = cnData?.secondaryImages?.[idx];
            return (
              <Card key={idx}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Image className="w-4 h-4 text-blue-500" /> 辅图 {img.imageNumber || idx + 2}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 border-r pr-4">
                      <Badge variant="outline" className="text-xs">English</Badge>
                      <p className="text-sm font-medium">{img.title}</p>
                      <p className="text-xs"><strong>Focus:</strong> {img.focus}</p>
                      <FABEDisplay fabe={img.fabe} variant="en" />
                      <p className="text-xs"><strong>Expression:</strong> {img.expressionMethod}</p>
                      <p className="text-xs"><strong>Composition:</strong> {img.composition}</p>
                      {img.colorScheme && (
                        <div className="space-y-0.5">
                          <ColorSwatch color={img.colorScheme.primary || ""} label="Primary" />
                          <ColorSwatch color={img.colorScheme.secondary || ""} label="Secondary" />
                          <ColorSwatch color={img.colorScheme.accent || ""} label="Accent" />
                        </div>
                      )}
                      <p className="text-xs"><strong>Text Overlay:</strong> {img.textOverlay}</p>
                      {img.dataVisualization && <p className="text-xs"><strong>Data Viz:</strong> {img.dataVisualization}</p>}
                      {img.icons?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {img.icons.map((icon: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{icon}</Badge>)}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700">中文</Badge>
                      {cnImg ? (
                        <>
                          <p className="text-sm font-medium text-orange-700">{cnImg.title}</p>
                          <p className="text-xs"><strong>聚焦:</strong> {cnImg.focus}</p>
                          <FABEDisplay fabe={cnImg.fabe} variant="cn" />
                          <p className="text-xs"><strong>表达方式:</strong> {cnImg.expressionMethod}</p>
                          <p className="text-xs"><strong>构图:</strong> {cnImg.composition}</p>
                          <p className="text-xs"><strong>文案:</strong> {cnImg.textOverlay}</p>
                          {cnImg.dataVisualization && <p className="text-xs"><strong>数据可视化:</strong> {cnImg.dataVisualization}</p>}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">中文翻译未生成</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* A+ Content with drag and drop */}
          {enData.aPlusContent && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Layers className="w-4 h-4 text-purple-500" /> A+ Content
                    </CardTitle>
                    {!isConfirmed && (
                      <Badge variant="outline" className="text-xs">拖拽模块可调整顺序</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-1 border-r pr-4">
                      <Badge variant="outline" className="text-xs">English</Badge>
                      <p className="text-xs"><strong>Strategy:</strong> {enData.aPlusContent.overallStrategy}</p>
                      <p className="text-xs"><strong>Story:</strong> {enData.aPlusContent.overallStory}</p>
                      <p className="text-xs"><strong>Consistency:</strong> {enData.aPlusContent.consistency}</p>
                      <p className="text-xs"><strong>Modular Design:</strong> {enData.aPlusContent.modularDesign}</p>
                    </div>
                    <div className="space-y-1">
                      <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700">中文</Badge>
                      {cnData?.aPlusContent ? (
                        <>
                          <p className="text-xs"><strong>策略:</strong> {cnData.aPlusContent.overallStrategy}</p>
                          <p className="text-xs"><strong>故事线:</strong> {cnData.aPlusContent.overallStory}</p>
                          <p className="text-xs"><strong>一致性:</strong> {cnData.aPlusContent.consistency}</p>
                          <p className="text-xs"><strong>模块化:</strong> {cnData.aPlusContent.modularDesign}</p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">中文翻译未生成</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Draggable A+ sections */}
              {enData.aPlusContent.sections?.map((section: any, idx: number) => {
                const cnSection = cnData?.aPlusContent?.sections?.[idx];
                return (
                  <Card
                    key={idx}
                    draggable={!isConfirmed}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`transition-all ${draggedIdx === idx ? "opacity-50 scale-95" : ""} ${!isConfirmed ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        {!isConfirmed && <GripVertical className="w-4 h-4 text-gray-400" />}
                        <CardTitle className="text-sm flex items-center gap-2">
                          A+ 模块 {idx + 1}
                          {section.type && <Badge variant="outline" className="text-xs">{section.type}</Badge>}
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2 border-r pr-4">
                          <Badge variant="outline" className="text-xs">English</Badge>
                          <p className="text-sm font-medium">{section.title}</p>
                          <p className="text-xs"><strong>Purpose:</strong> {section.purpose}</p>
                          <p className="text-xs"><strong>Content:</strong> {section.content}</p>
                          <FABEDisplay fabe={section.fabe} variant="en" />
                          {section.expressionMethod && <p className="text-xs"><strong>Expression:</strong> {section.expressionMethod}</p>}
                          {section.composition && <p className="text-xs"><strong>Composition:</strong> {section.composition}</p>}
                          {section.dataVisualization && <p className="text-xs"><strong>Data Viz:</strong> {section.dataVisualization}</p>}
                          {section.icons?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {section.icons.map((icon: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{icon}</Badge>)}
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700">中文</Badge>
                          {cnSection ? (
                            <>
                              <p className="text-sm font-medium text-orange-700">{cnSection.title}</p>
                              <p className="text-xs"><strong>目的:</strong> {cnSection.purpose}</p>
                              <p className="text-xs"><strong>内容:</strong> {cnSection.content}</p>
                              <FABEDisplay fabe={cnSection.fabe} variant="cn" />
                              {cnSection.expressionMethod && <p className="text-xs"><strong>表达方式:</strong> {cnSection.expressionMethod}</p>}
                              {cnSection.composition && <p className="text-xs"><strong>构图:</strong> {cnSection.composition}</p>}
                              {cnSection.dataVisualization && <p className="text-xs"><strong>数据可视化:</strong> {cnSection.dataVisualization}</p>}
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">中文翻译未生成</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── PDF content builder ─────────────────────────────────────────
function buildPdfContent(enData: any, cnData: any): string {
  const sections: string[] = [];
  sections.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Image Suggestions</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; color: #333; }
h1 { color: #8B4513; border-bottom: 2px solid #8B4513; padding-bottom: 8px; }
h2 { color: #555; margin-top: 24px; }
h3 { color: #666; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.en { background: #f0f7ff; padding: 12px; border-radius: 8px; }
.cn { background: #fff7ed; padding: 12px; border-radius: 8px; }
.fabe { background: #f5f5f5; padding: 8px; border-radius: 4px; margin: 4px 0; font-size: 12px; }
.badge { display: inline-block; background: #e5e7eb; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin: 2px; }
.color-dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 1px solid #ccc; vertical-align: middle; margin-right: 4px; }
p { margin: 4px 0; font-size: 13px; }
@media print { body { max-width: 100%; } }
</style></head><body>`);

  sections.push(`<h1>Amazon Product Image Suggestions / 亚马逊产品图片建议</h1>`);

  if (enData?.designGuidelines) {
    sections.push(`<h2>Design Guidelines / 设计指南</h2><div class="grid"><div class="en"><p><strong>Font:</strong> ${enData.designGuidelines.fontRecommendation || ''}</p><p><strong>Color:</strong> ${enData.designGuidelines.overallColorPalette || ''}</p><p><strong>Tone:</strong> ${enData.designGuidelines.brandTone || ''}</p></div><div class="cn"><p><strong>字体:</strong> ${cnData?.designGuidelines?.fontRecommendation || ''}</p><p><strong>配色:</strong> ${cnData?.designGuidelines?.overallColorPalette || ''}</p><p><strong>调性:</strong> ${cnData?.designGuidelines?.brandTone || ''}</p></div></div>`);
  }

  if (enData?.mainImage) {
    sections.push(`<h2>Main Image / 主图</h2><div class="grid"><div class="en"><p><strong>${enData.mainImage.title || ''}</strong></p><p>${enData.mainImage.concept || ''}</p><p><strong>Composition:</strong> ${enData.mainImage.composition || ''}</p><p><strong>Shooting:</strong> ${enData.mainImage.shootingNotes || ''}</p></div><div class="cn"><p><strong>${cnData?.mainImage?.title || ''}</strong></p><p>${cnData?.mainImage?.concept || ''}</p><p><strong>构图:</strong> ${cnData?.mainImage?.composition || ''}</p><p><strong>拍摄:</strong> ${cnData?.mainImage?.shootingNotes || ''}</p></div></div>`);
  }

  enData?.secondaryImages?.forEach((img: any, idx: number) => {
    const cnImg = cnData?.secondaryImages?.[idx];
    sections.push(`<h2>Secondary Image ${img.imageNumber || idx + 2} / 辅图 ${img.imageNumber || idx + 2}</h2><div class="grid"><div class="en"><p><strong>${img.title || ''}</strong></p><p><strong>Focus:</strong> ${img.focus || ''}</p>${img.fabe ? `<div class="fabe"><strong>FABE:</strong> F: ${img.fabe.feature || ''} | A: ${img.fabe.advantage || ''} | B: ${img.fabe.benefit || ''} | E: ${img.fabe.evidence || ''}</div>` : ''}<p><strong>Expression:</strong> ${img.expressionMethod || ''}</p><p><strong>Composition:</strong> ${img.composition || ''}</p><p><strong>Text:</strong> ${img.textOverlay || ''}</p></div><div class="cn"><p><strong>${cnImg?.title || ''}</strong></p><p><strong>聚焦:</strong> ${cnImg?.focus || ''}</p>${cnImg?.fabe ? `<div class="fabe"><strong>FABE:</strong> F: ${cnImg.fabe.feature || ''} | A: ${cnImg.fabe.advantage || ''} | B: ${cnImg.fabe.benefit || ''} | E: ${cnImg.fabe.evidence || ''}</div>` : ''}<p><strong>表达:</strong> ${cnImg?.expressionMethod || ''}</p><p><strong>构图:</strong> ${cnImg?.composition || ''}</p><p><strong>文案:</strong> ${cnImg?.textOverlay || ''}</p></div></div>`);
  });

  if (enData?.aPlusContent?.sections) {
    sections.push(`<h2>A+ Content</h2>`);
    enData.aPlusContent.sections.forEach((sec: any, idx: number) => {
      const cnSec = cnData?.aPlusContent?.sections?.[idx];
      sections.push(`<h3>Module ${idx + 1}: ${sec.title || ''}</h3><div class="grid"><div class="en"><p><strong>Purpose:</strong> ${sec.purpose || ''}</p><p>${sec.content || ''}</p>${sec.fabe ? `<div class="fabe">FABE: F: ${sec.fabe.feature || ''} | A: ${sec.fabe.advantage || ''} | B: ${sec.fabe.benefit || ''} | E: ${sec.fabe.evidence || ''}</div>` : ''}</div><div class="cn"><p><strong>目的:</strong> ${cnSec?.purpose || ''}</p><p>${cnSec?.content || ''}</p>${cnSec?.fabe ? `<div class="fabe">FABE: F: ${cnSec.fabe.feature || ''} | A: ${cnSec.fabe.advantage || ''} | B: ${cnSec.fabe.benefit || ''} | E: ${cnSec.fabe.evidence || ''}</div>` : ''}</div></div>`);
    });
  }

  sections.push(`</body></html>`);
  return sections.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// ─── Main Page Component ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
export default function ImageWorkflowPage() {
  const { selectedProjectId } = useProject();
  const [currentStep, setCurrentStep] = useState(1);

  const sessionQuery = trpc.imageWorkflow.getSession.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );
  const createSessionMutation = trpc.imageWorkflow.createSession.useMutation();
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();

  const session = sessionQuery.data;

  // Sync current step from session
  useEffect(() => {
    if (session?.currentStep) {
      setCurrentStep(session.currentStep);
    }
  }, [session?.currentStep]);

  const handleStepClick = (step: number) => {
    setCurrentStep(step);
  };

  const handleStepConfirm = () => {
    sessionQuery.refetch();
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleStartNew = async () => {
    if (!selectedProjectId) return;
    try {
      await createSessionMutation.mutateAsync({ projectId: selectedProjectId });
      sessionQuery.refetch();
      setCurrentStep(1);
      toast.success("新工作流已创建");
    } catch (err: any) {
      toast.error(err.message || "创建失败");
    }
  };

  const handleReset = async (step: number) => {
    if (!selectedProjectId) return;
    try {
      await resetMutation.mutateAsync({ projectId: selectedProjectId, step });
      sessionQuery.refetch();
      setCurrentStep(step);
      toast.success(`已重置到步骤 ${step}`);
    } catch (err: any) {
      toast.error(err.message || "重置失败");
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Image className="w-6 h-6 text-primary" />
              智能图片建议
            </h1>
            <p className="text-muted-foreground text-sm mt-1">5步工作流：卖点梳理 → 图片大纲 → 风格确认 → 参考图确认 → 图片建议</p>
          </div>
          <ProjectSelector />
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
              <p className="text-muted-foreground">请先选择一个项目</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Image className="w-6 h-6 text-primary" />
            智能图片建议
          </h1>
          <p className="text-muted-foreground text-sm mt-1">5步工作流：卖点梳理 → 图片大纲 → 风格确认 → 参考图确认 → 图片建议</p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectSelector />
          {session && (
            <Button variant="outline" size="sm" onClick={handleStartNew} disabled={createSessionMutation.isPending}>
              <RotateCcw className="w-3 h-3 mr-1" /> 重新开始
            </Button>
          )}
        </div>
      </div>

      <StepProgressBar
        currentStep={currentStep}
        session={session}
        onStepClick={handleStepClick}
      />

      {!session && (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <div className="text-center space-y-4">
              <Image className="w-16 h-16 text-primary/30 mx-auto" />
              <div>
                <p className="text-lg font-medium">开始图片建议工作流</p>
                <p className="text-sm text-muted-foreground mt-1">通过5个步骤，AI将帮助你规划产品图片的完整方案</p>
              </div>
              <Button onClick={handleStartNew} disabled={createSessionMutation.isPending} size="lg">
                {createSessionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                开始工作流
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {session && currentStep === 1 && (
        <Step1SellingPoints projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 2 && (
        <Step2ImageOutline projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 3 && (
        <Step3StyleConfirm projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 4 && (
        <Step4References projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 5 && (
        <Step5FinalSuggestions projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
    </div>
  );
}
