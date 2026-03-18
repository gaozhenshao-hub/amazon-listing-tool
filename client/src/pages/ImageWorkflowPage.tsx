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
  Wand2,
  Pencil,
  Send,
  Lock,
  Unlock,
  Upload,
  Zap,
  Grid3X3,
  LayoutGrid,
  RefreshCw,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  { id: 6, label: "AI提示词", icon: Zap, desc: "生成图片Prompt" },
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
      !!session.step6Confirmed,
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
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();
  const [editData, setEditData] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLocked, setIsLocked] = useState(!!session?.step1Confirmed);

  // Load existing data
  useEffect(() => {
    if (session?.step1UserEdit) {
      try { setEditData(JSON.parse(session.step1UserEdit)); } catch {}
    } else if (session?.step1AiResult) {
      try { setEditData(JSON.parse(session.step1AiResult)); } catch {}
    }
    setIsLocked(!!session?.step1Confirmed);
  }, [session?.step1AiResult, session?.step1UserEdit, session?.step1Confirmed]);

  const handleUnlock = async () => {
    try {
      await resetMutation.mutateAsync({ projectId, step: 1 });
      setIsLocked(false);
      setIsEditing(true);
      toast.success("已解锁，可编辑卖点内容");
    } catch (err: any) {
      toast.error(err.message || "解锁失败");
    }
  };

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

  const isConfirmed = isLocked;

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
              {!editData && !isConfirmed && (
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
                <div className="flex gap-2 items-center">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Lock className="w-3 h-3 mr-1" /> 已锁定
                  </Badge>
                  <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={resetMutation.isPending}>
                    {resetMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                    解锁编辑
                  </Button>
                </div>
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
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();
  const [editData, setEditData] = useState<any>(null);
  const [isLocked, setIsLocked] = useState(!!session?.step2Confirmed);

  useEffect(() => {
    if (session?.step2UserEdit) {
      try { setEditData(JSON.parse(session.step2UserEdit)); } catch {}
    } else if (session?.step2AiResult) {
      try { setEditData(JSON.parse(session.step2AiResult)); } catch {}
    }
    setIsLocked(!!session?.step2Confirmed);
  }, [session?.step2AiResult, session?.step2UserEdit, session?.step2Confirmed]);

  const handleUnlock = async () => {
    try {
      await resetMutation.mutateAsync({ projectId, step: 2 });
      setIsLocked(false);
      toast.success("已解锁，可编辑图片大纲");
    } catch (err: any) {
      toast.error(err.message || "解锁失败");
    }
  };

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

  const isConfirmed = isLocked;

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
                <div className="flex gap-2 items-center">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Lock className="w-3 h-3 mr-1" /> 已锁定
                  </Badge>
                  <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={resetMutation.isPending}>
                    {resetMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                    解锁编辑
                  </Button>
                </div>
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
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();
  const [aiResult, setAiResult] = useState<any>(null);
  const [isLocked, setIsLocked] = useState(!!session?.step3Confirmed);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  // KB image picker state for style references
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [kbPickerTargetStyleId, setKbPickerTargetStyleId] = useState<number | null>(null);
  const [styleKbImages, setStyleKbImages] = useState<Record<number, Array<{ id: number; imageUrl: string; imagePosition: string; tagCategory: string; tagImageType: string; tagDesignStyle: string; tagColorScheme: string }>>>({});

  useEffect(() => {
    if (session?.step3UserEdit) {
      try {
        const parsed = JSON.parse(session.step3UserEdit);
        setSelectedIds(parsed.selectedIds || []);
        if (parsed.styleKbImages) setStyleKbImages(parsed.styleKbImages);
        if (session.step3AiResult) setAiResult(JSON.parse(session.step3AiResult));
      } catch {}
    } else if (session?.step3AiResult) {
      try { setAiResult(JSON.parse(session.step3AiResult)); } catch {}
    }
  }, [session?.step3AiResult, session?.step3UserEdit]);

  useEffect(() => { setIsLocked(!!session?.step3Confirmed); }, [session?.step3Confirmed]);

  const handleUnlock = async () => {
    try {
      await resetMutation.mutateAsync({ projectId, step: 3 });
      setIsLocked(false);
      toast.success("已解锁，可重新选择风格");
    } catch (err: any) {
      toast.error(err.message || "解锁失败");
    }
  };

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
        userEdit: JSON.stringify({ selectedIds, selectedStyles, styleKbImages }),
      });
      toast.success("风格已确认");
      onConfirm();
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  // KB image picker handlers
  const openKbPickerForStyle = (styleId: number) => {
    setKbPickerTargetStyleId(styleId);
    setKbPickerOpen(true);
  };

  const handleKbImageSelectForStyle = (images: Array<{ id: number; imageUrl: string; imagePosition: string; tagCategory: string; tagImageType: string; tagDesignStyle: string; tagColorScheme: string }>) => {
    if (kbPickerTargetStyleId === null) return;
    setStyleKbImages(prev => {
      const existing = prev[kbPickerTargetStyleId] || [];
      return { ...prev, [kbPickerTargetStyleId]: [...existing, ...images] };
    });
    toast.success(`已添加 ${images.length} 张参考图到风格方案`);
  };

  const removeKbImageFromStyle = (styleId: number, imgIdx: number) => {
    setStyleKbImages(prev => {
      const imgs = [...(prev[styleId] || [])];
      imgs.splice(imgIdx, 1);
      return { ...prev, [styleId]: imgs };
    });
  };

  const isConfirmed = isLocked;

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
                <div className="flex gap-2 items-center">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Lock className="w-3 h-3 mr-1" /> 已锁定
                  </Badge>
                  <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={resetMutation.isPending}>
                    {resetMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                    解锁编辑
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        {generateMutation.isPending && (
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mr-3" />
              <span className="text-muted-foreground">AI正在推荐视觉风格方案...</span>
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

                  {/* KB Reference Images for this style */}
                  {(styleKbImages[style.id]?.length > 0) && (
                    <div className="border-t pt-2 mt-2">
                      <p className="text-xs font-medium text-emerald-700 mb-1.5 flex items-center gap-1">
                        <BookOpen className="w-3 h-3" /> 知识库参考图 ({styleKbImages[style.id].length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {styleKbImages[style.id].map((kbImg, imgIdx) => (
                          <div key={imgIdx} className="relative group">
                            <div className="w-14 h-14 rounded overflow-hidden border border-emerald-200">
                              <img src={kbImg.imageUrl} alt={`ref ${imgIdx}`} className="w-full h-full object-cover" />
                            </div>
                            {!isConfirmed && (
                              <button
                                className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => { e.stopPropagation(); removeKbImageFromStyle(style.id, imgIdx); }}
                              >
                                <X className="w-2 h-2" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add KB reference button */}
                  {!isConfirmed && isSelected && (
                    <div className="border-t pt-2 mt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs w-full"
                        onClick={(e) => { e.stopPropagation(); openKbPickerForStyle(style.id); }}
                      >
                        <BookOpen className="w-3 h-3 mr-1" /> 从知识库添加参考图
                      </Button>
                    </div>
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

      {/* KB Image Picker Dialog for Step 3 */}
      <KbImagePickerDialog
        open={kbPickerOpen}
        onOpenChange={setKbPickerOpen}
        onSelect={handleKbImageSelectForStyle}
      />
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
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();
  const uploadRefMutation = trpc.imageWorkflow.uploadStep4RefImage.useMutation();
  const reoptimizeMutation = trpc.imageWorkflow.reoptimizeStep4WithRefs.useMutation();
  const [editData, setEditData] = useState<any>(null);
  const [isLocked, setIsLocked] = useState(!!session?.step4Confirmed);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [kbPickerTargetIdx, setKbPickerTargetIdx] = useState<number | null>(null);
  const [kbPickerTargetType, setKbPickerTargetType] = useState<string>("");
  const [uploadingRef, setUploadingRef] = useState<{idx: number; type: 'composition'|'effect'} | null>(null);

  useEffect(() => {
    if (session?.step4UserEdit) {
      try { setEditData(JSON.parse(session.step4UserEdit)); } catch {}
    } else if (session?.step4AiResult) {
      try { setEditData(JSON.parse(session.step4AiResult)); } catch {}
    }
    setIsLocked(!!session?.step4Confirmed);
  }, [session?.step4AiResult, session?.step4UserEdit, session?.step4Confirmed]);

  const handleUnlock = async () => {
    try {
      await resetMutation.mutateAsync({ projectId, step: 4 });
      setIsLocked(false);
      toast.success("已解锁，可编辑参考图");
    } catch (err: any) {
      toast.error(err.message || "解锁失败");
    }
  };

  // Upload independent reference image (composition or effect)
  const handleRefImageUpload = async (idx: number, refType: 'composition' | 'effect', file: File) => {
    setUploadingRef({ idx, type: refType });
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const result = await uploadRefMutation.mutateAsync({
          projectId,
          imageKey: `step4-ref-${idx}-${refType}`,
          refType,
          imageData: base64,
          fileName: file.name,
        });
        // Update editData with the uploaded image URL
        if (editData) {
          const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
          const ref = { ...newData.imageReferences[idx] };
          if (refType === 'composition') {
            ref.compositionRefImageUrl = result.url;
          } else {
            ref.effectRefImageUrl = result.url;
          }
          newData.imageReferences[idx] = ref;
          setEditData(newData);
        }
        toast.success(`${refType === 'composition' ? '构图' : '效果'}参考图已上传`);
        setUploadingRef(null);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast.error(err.message || "上传失败");
      setUploadingRef(null);
    }
  };

  // Re-optimize Step 4 based on uploaded reference images
  const handleReoptimize = async (idx: number) => {
    if (!editData) return;
    try {
      const ref = editData.imageReferences[idx];
      const result = await reoptimizeMutation.mutateAsync({
        projectId,
        imageKey: `step4-ref-${idx}`,
        compositionRefUrl: ref.compositionRefImageUrl || '',
        effectRefUrl: ref.effectRefImageUrl || '',
      });
      // Merge the re-optimized result into editData
      const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
      newData.imageReferences[idx] = { ...newData.imageReferences[idx], ...result };
      setEditData(newData);
      toast.success("已根据参考图重新优化");
    } catch (err: any) {
      toast.error(err.message || "优化失败");
    }
  };

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

  const isConfirmed = isLocked;

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
                <div className="flex gap-2 items-center">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Lock className="w-3 h-3 mr-1" /> 已锁定
                  </Badge>
                  <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={resetMutation.isPending}>
                    {resetMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                    解锁编辑
                  </Button>
                </div>
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

            {/* Independent Reference Image Upload Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Composition Reference Image Upload */}
              <div className="border-2 border-dashed border-blue-200 rounded-lg p-3 bg-blue-50/20">
                <h4 className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-1">
                  <Upload className="w-3.5 h-3.5" /> 构图参考图
                </h4>
                {ref.compositionRefImageUrl ? (
                  <div className="relative group">
                    <img src={ref.compositionRefImageUrl} alt="构图参考" className="w-full h-32 object-cover rounded-lg border" />
                    {!isConfirmed && (
                      <div className="absolute top-1 right-1 flex gap-1">
                        <label className="cursor-pointer bg-white/90 hover:bg-white rounded-full p-1 shadow-sm">
                          <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRefImageUpload(idx, 'composition', f); }} />
                        </label>
                      </div>
                    )}
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center h-28 rounded-lg border-2 border-dashed border-blue-300 cursor-pointer hover:bg-blue-50/50 transition-colors ${uploadingRef?.idx === idx && uploadingRef?.type === 'composition' ? 'opacity-50' : ''}`}>
                    {uploadingRef?.idx === idx && uploadingRef?.type === 'composition' ? (
                      <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-blue-400 mb-1" />
                        <span className="text-xs text-blue-500">上传构图参考图</span>
                        <span className="text-[10px] text-muted-foreground">或从知识库选择</span>
                      </>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRefImageUpload(idx, 'composition', f); }} disabled={!!uploadingRef} />
                  </label>
                )}
              </div>

              {/* Effect Reference Image Upload */}
              <div className="border-2 border-dashed border-amber-200 rounded-lg p-3 bg-amber-50/20">
                <h4 className="text-sm font-medium text-amber-700 mb-2 flex items-center gap-1">
                  <Upload className="w-3.5 h-3.5" /> 效果参考图
                </h4>
                {ref.effectRefImageUrl ? (
                  <div className="relative group">
                    <img src={ref.effectRefImageUrl} alt="效果参考" className="w-full h-32 object-cover rounded-lg border" />
                    {!isConfirmed && (
                      <div className="absolute top-1 right-1 flex gap-1">
                        <label className="cursor-pointer bg-white/90 hover:bg-white rounded-full p-1 shadow-sm">
                          <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRefImageUpload(idx, 'effect', f); }} />
                        </label>
                      </div>
                    )}
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center h-28 rounded-lg border-2 border-dashed border-amber-300 cursor-pointer hover:bg-amber-50/50 transition-colors ${uploadingRef?.idx === idx && uploadingRef?.type === 'effect' ? 'opacity-50' : ''}`}>
                    {uploadingRef?.idx === idx && uploadingRef?.type === 'effect' ? (
                      <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-amber-400 mb-1" />
                        <span className="text-xs text-amber-500">上传效果参考图</span>
                        <span className="text-[10px] text-muted-foreground">或从知识库选择</span>
                      </>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRefImageUpload(idx, 'effect', f); }} disabled={!!uploadingRef} />
                  </label>
                )}
              </div>
            </div>

            {/* AI Re-optimize button when both ref images are uploaded */}
            {(ref.compositionRefImageUrl || ref.effectRefImageUrl) && !isConfirmed && (
              <div className="mb-4 flex justify-center">
                <Button variant="outline" size="sm" onClick={() => handleReoptimize(idx)} disabled={reoptimizeMutation.isPending} className="text-xs">
                  {reoptimizeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                  根据参考图重新优化构图和效果方案
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Composition Reference */}
              <div className="border rounded-lg p-3 bg-blue-50/30">
                <h4 className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-1">
                  <Layout className="w-3.5 h-3.5" /> 构图方案
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
                  <Paintbrush className="w-3.5 h-3.5" /> 效果方案
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

// ─── Lockable field definitions per image type ─────────────────────────
const LOCKABLE_FIELDS: Record<string, { key: string; label: string; icon: string }[]> = {
  mainImage: [
    { key: "title", label: "标题", icon: "T" },
    { key: "concept", label: "概念", icon: "C" },
    { key: "colorScheme", label: "配色方案", icon: "🎨" },
    { key: "composition", label: "构图方式", icon: "📐" },
    { key: "shootingNotes", label: "拍摄提示", icon: "📷" },
    { key: "keyElements", label: "关键元素", icon: "⭐" },
    { key: "sellingPoints", label: "卖点", icon: "💡" },
  ],
  secondaryImage: [
    { key: "title", label: "标题", icon: "T" },
    { key: "fabe", label: "FABE分析", icon: "F" },
    { key: "expressionMethod", label: "表达方式", icon: "📝" },
    { key: "colorScheme", label: "配色方案", icon: "🎨" },
    { key: "composition", label: "构图", icon: "📐" },
    { key: "dataVisualization", label: "数据可视化", icon: "📊" },
    { key: "icons", label: "图标建议", icon: "🔣" },
    { key: "keyElements", label: "关键元素", icon: "⭐" },
    { key: "sellingPoints", label: "卖点", icon: "💡" },
    { key: "copywriting", label: "文案", icon: "✏️" },
  ],
  aPlusSection: [
    { key: "title", label: "标题", icon: "T" },
    { key: "fabe", label: "FABE分析", icon: "F" },
    { key: "expressionMethod", label: "表达方式", icon: "📝" },
    { key: "colorScheme", label: "配色方案", icon: "🎨" },
    { key: "composition", label: "构图", icon: "📐" },
    { key: "dataVisualization", label: "数据可视化", icon: "📊" },
    { key: "icons", label: "图标建议", icon: "🔣" },
    { key: "content", label: "内容描述", icon: "📄" },
    { key: "copywriting", label: "文案", icon: "✏️" },
  ],
};

// ─── Refine Popover Component ──────────────────────────────────────────
// Inline popover for refining a single image suggestion with lock feature
function RefinePopover({
  projectId,
  imageType,
  imageIndex,
  currentEnContent,
  currentCnContent,
  onRefineComplete,
  disabled,
}: {
  projectId: number;
  imageType: "mainImage" | "secondaryImage" | "aPlusSection";
  imageIndex?: number;
  currentEnContent: any;
  currentCnContent: any;
  onRefineComplete: (en: any, cn: any) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
  const [showLockPanel, setShowLockPanel] = useState(false);
  const refineMutation = trpc.imageWorkflow.refineSingleImage.useMutation();

  // Get lockable fields for this image type
  const lockableFields = useMemo(() => {
    const fields = LOCKABLE_FIELDS[imageType] || [];
    // Filter to only show fields that exist in current content
    if (!currentEnContent) return fields;
    return fields.filter((f) => {
      const val = currentEnContent[f.key];
      return val !== undefined && val !== null && val !== "";
    });
  }, [imageType, currentEnContent]);

  const toggleLock = (fieldKey: string) => {
    setLockedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const lockAll = () => {
    setLockedFields(new Set(lockableFields.map((f) => f.key)));
  };

  const unlockAll = () => {
    setLockedFields(new Set());
  };

  const quickActions = [
    { label: "标题更简短", instruction: "请把标题改得更简短有力，更有吸引力" },
    { label: "换一种构图", instruction: "请推荐一种不同的构图方式，让画面更有冲击力" },
    { label: "强化卖点表达", instruction: "请强化卖点的表达，让卖点更突出更有说服力" },
    { label: "优化文案", instruction: "请优化图片上的文案内容，让文字更精炼更有营销力" },
    { label: "调整配色", instruction: "请推荐一套更合适的配色方案，提升视觉效果" },
    { label: "增加数据可视化", instruction: "请增加数据可视化元素（图表、图标、数据对比等）让信息更直观" },
  ];

  const handleRefine = async (instr: string) => {
    if (!instr.trim()) return;
    try {
      const result = await refineMutation.mutateAsync({
        projectId,
        imageType,
        imageIndex,
        currentContent: JSON.stringify({ en: currentEnContent, cn: currentCnContent }),
        instruction: instr,
        lockedFields: lockedFields.size > 0 ? Array.from(lockedFields) : undefined,
      });
      onRefineComplete(result.en, result.cn);
      setInstruction("");
      setOpen(false);
      toast.success("微调完成" + (lockedFields.size > 0 ? `（已锁定${lockedFields.size}个元素）` : ""));
    } catch (err: any) {
      toast.error(err.message || "微调失败");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
          disabled={disabled}
        >
          <Wand2 className="w-3 h-3 mr-1" /> 微调
          {lockedFields.size > 0 && (
            <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {lockedFields.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="space-y-0">
          {/* Header with lock toggle */}
          <div className="flex items-center justify-between p-3 pb-2">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">AI 微调这张图</span>
            </div>
            <Button
              variant={showLockPanel ? "secondary" : "ghost"}
              size="sm"
              className={`h-7 px-2 text-xs ${lockedFields.size > 0 ? "text-amber-600" : "text-muted-foreground"}`}
              onClick={() => setShowLockPanel(!showLockPanel)}
            >
              {lockedFields.size > 0 ? <Lock className="w-3 h-3 mr-1" /> : <Unlock className="w-3 h-3 mr-1" />}
              {lockedFields.size > 0 ? `已锁定 ${lockedFields.size}` : "锁定元素"}
            </Button>
          </div>

          {/* Lock panel - collapsible */}
          {showLockPanel && (
            <div className="mx-3 mb-2 p-2.5 rounded-lg border border-amber-200 bg-amber-50/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-amber-800 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> 锁定元素（微调时保持不变）
                </p>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-amber-700" onClick={lockAll}>
                    全锁
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-amber-700" onClick={unlockAll}>
                    全解
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {lockableFields.map((field) => {
                  const isLocked = lockedFields.has(field.key);
                  return (
                    <button
                      key={field.key}
                      onClick={() => toggleLock(field.key)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-all border ${
                        isLocked
                          ? "bg-amber-100 border-amber-300 text-amber-800 shadow-sm"
                          : "bg-white border-gray-200 text-gray-500 hover:border-amber-200 hover:bg-amber-50"
                      }`}
                    >
                      <span className="text-[10px]">{field.icon}</span>
                      <span>{field.label}</span>
                      {isLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5 opacity-40" />}
                    </button>
                  );
                })}
              </div>
              {lockableFields.length === 0 && (
                <p className="text-xs text-amber-600/70 text-center py-1">当前图片无可锁定字段</p>
              )}
            </div>
          )}

          <div className="px-3 pb-3 space-y-3">
            {/* Quick action buttons */}
            <div className="flex flex-wrap gap-1.5">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={refineMutation.isPending}
                  onClick={() => handleRefine(action.instruction)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
            <Separator />
            {/* Custom instruction */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">或输入自定义修改指令：</p>
              <div className="flex gap-1.5">
                <Input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="例如：把标题改为XXX..."
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleRefine(instruction);
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 px-2"
                  disabled={!instruction.trim() || refineMutation.isPending}
                  onClick={() => handleRefine(instruction)}
                >
                  {refineMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </Button>
              </div>
            </div>
            {refineMutation.isPending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                AI正在微调中...
                {lockedFields.size > 0 && <span className="text-amber-600">（{lockedFields.size}个元素已锁定）</span>}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();
  const aplusOptimizeMutation = trpc.imageWorkflow.optimizeWithAplusModule.useMutation();
  const [enData, setEnData] = useState<any>(null);
  const [cnData, setCnData] = useState<any>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(!!session?.step5Confirmed);
  const [showModuleSelector, setShowModuleSelector] = useState(false);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  // Per-section module style state: { [sectionIndex]: moduleTypeId }
  const [sectionModuleStyles, setSectionModuleStyles] = useState<Record<number, string>>({});
  const [optimizingSectionIdx, setOptimizingSectionIdx] = useState<number | null>(null);
  const singleModuleOptimizeMutation = trpc.imageWorkflow.optimizeSingleAplusModule.useMutation();
  const comboRecommendMutation = trpc.imageWorkflow.recommendAplusCombo.useMutation();
  const [comboRecommendations, setComboRecommendations] = useState<any>(null);
  const [showComboPanel, setShowComboPanel] = useState(false);
  const [selectedComboIdx, setSelectedComboIdx] = useState<number | null>(null);

  // Amazon Premium A+ Module Types - comprehensive list matching backend prompt
  const APLUS_MODULES = [
    { id: 'premium_full_image', name: '高级完整图片', desc: '全屏背景+文字覆盖, 1464x600px', category: '全屏展示', specs: '标题800字符, 正文300字符' },
    { id: 'premium_text', name: '高级文本', desc: '纯文本模块', category: '文本', specs: '标题80字符, 正文300字符' },
    { id: 'premium_bg_image_text', name: '高级背景图像+文本', desc: '背景图+叠加文字, 1464x600px', category: '全屏展示', specs: '标题60字符, 副标题40字符, 正文300字符' },
    { id: 'premium_four_image_text', name: '高级四图片+文本', desc: '4张小图+文字, 300x225px', category: '图文组合', specs: '标题30字符, 正文150字符' },
    { id: 'premium_dual_image_text', name: '高级双图片+文本', desc: '左右双图, 650x350px', category: '图文组合', specs: '标题50字符, 副标题50字符, 正文300字符' },
    { id: 'premium_single_image_text', name: '高级单图+文本', desc: '大图+长文, 800x600px', category: '图文组合', specs: '标题80字符, 副标题40字符, 正文500字符' },
    { id: 'premium_full_video', name: '高级全视频', desc: '视频≤200MB,≤180秒, 960x540px', category: '多媒体', specs: '标题80字符, 正文300字符' },
    { id: 'premium_video_text', name: '高级视频+文本', desc: '视频+文字, 800x600px', category: '多媒体', specs: '标题80字符, 副标题40字符, 正文500字符' },
    { id: 'premium_comparison_1', name: '高级比较表1', desc: '4-7产品, 5-12特征, 200x225px', category: '对比展示', specs: '图片200x225px' },
    { id: 'premium_comparison_2', name: '高级比较表2', desc: '2-3产品, 2-5特征, 300x225px', category: '对比展示', specs: '图片300x225px' },
    { id: 'premium_comparison_3', name: '高级比较表3', desc: '2-4产品, 3-7特征, 488x700px', category: '对比展示', specs: '图片488x700px' },
    { id: 'premium_hotspot_1', name: '高级热点1', desc: '2-6个可点击热点, 1464x600px', category: '交互展示', specs: '标题50字符, 正文200字符' },
    { id: 'premium_hotspot_2', name: '高级热点2', desc: '2-6个热点, 1464x600px', category: '交互展示', specs: '模块标题80字符' },
    { id: 'premium_nav_carousel', name: '高级导航轮播', desc: '2-5个面板, 1464x600px', category: '轮播展示', specs: '导航文本25字符' },
    { id: 'premium_rule_carousel', name: '高级规则轮播', desc: '2-5个面板, 1464x600px', category: '轮播展示', specs: '模块标题100字符' },
    { id: 'premium_simple_carousel', name: '高级简单图像轮播', desc: '2-6个面板, 1464x600px', category: '轮播展示', specs: '标题50字符' },
    { id: 'premium_video_carousel', name: '高级视频图像轮播', desc: '2-6个面板, 800x600px', category: '轮播展示', specs: '标题80字符' },
    { id: 'premium_qa', name: '高级问答', desc: '2-5个问答, 1464x600px', category: '信息展示', specs: '问题120字符, 回答250字符' },
    { id: 'premium_tech_specs', name: '高级技术规格', desc: '3-15个规格, 300x300px', category: '信息展示', specs: '标题80字符' },
    { id: 'brand_highlight', name: '品牌亮点', desc: '3-4个亮点, 135x135px', category: '品牌建设', specs: '标题30字符, 正文80字符' },
    { id: 'standard_image_text', name: '标准图文', desc: '标准A+基础模块, 970x300px', category: '标准A+', specs: '标题160字符, 正文6000字符' },
    { id: 'standard_comparison', name: '标准对比表', desc: '最多5个产品, 150x150px', category: '标准A+', specs: '标题80字符, 正文250字符' },
    { id: 'standard_four_image', name: '标准四图', desc: '4张图+文字, 220x220px', category: '标准A+', specs: '标题60字符, 正文160字符' },
    { id: 'standard_single_image', name: '标准单图', desc: '全宽单图, 970x600px', category: '标准A+', specs: '标题160字符, 正文6000字符' },
  ];

  const MODULE_CATEGORIES = Array.from(new Set(APLUS_MODULES.map(m => m.category)));

  // Handle per-section module style optimize
  const handleSingleModuleOptimize = async (sectionIdx: number) => {
    const moduleId = sectionModuleStyles[sectionIdx];
    if (!moduleId) {
      toast.error("请先选择一个A+模块样式");
      return;
    }
    const mod = APLUS_MODULES.find(m => m.id === moduleId);
    if (!mod) return;
    setOptimizingSectionIdx(sectionIdx);
    try {
      const result = await singleModuleOptimizeMutation.mutateAsync({
        projectId,
        sectionIndex: sectionIdx,
        moduleType: moduleId,
        moduleName: mod.name,
      });
      // Update only this section in enData and cnData
      if (result.en) {
        setEnData((prev: any) => {
          const sections = [...(prev.aPlusContent?.sections || [])];
          sections[sectionIdx] = { ...sections[sectionIdx], ...result.en, selectedModuleType: moduleId, selectedModuleName: mod.name };
          return { ...prev, aPlusContent: { ...prev.aPlusContent, sections } };
        });
      }
      if (result.cn) {
        setCnData((prev: any) => {
          if (!prev) return prev;
          const sections = [...(prev.aPlusContent?.sections || [])];
          sections[sectionIdx] = { ...sections[sectionIdx], ...result.cn };
          return { ...prev, aPlusContent: { ...prev.aPlusContent, sections } };
        });
      }
      toast.success(`A+模块 ${sectionIdx + 1} 已根据「${mod.name}」样式重新优化`);
    } catch (err: any) {
      toast.error(err.message || "优化失败");
    } finally {
      setOptimizingSectionIdx(null);
    }
  };

  useEffect(() => {
    setIsLocked(!!session?.step5Confirmed);
  }, [session?.step5Confirmed]);

  const handleUnlock = async () => {
    try {
      await resetMutation.mutateAsync({ projectId, step: 5 });
      setIsLocked(false);
      toast.success("已解锁Step 5，可重新编辑");
    } catch (err: any) {
      toast.error(err.message || "解锁失败");
    }
  };

  const handleAplusModuleOptimize = async () => {
    if (selectedModules.length === 0) {
      toast.error("请先选择至少一个A+模块");
      return;
    }
    try {
      const result = await aplusOptimizeMutation.mutateAsync({
        projectId,
        selectedModules: selectedModules.map((id, i) => {
          const mod = APLUS_MODULES.find(m => m.id === id);
          return { moduleType: id, moduleName: mod?.name || id, position: i + 1 };
        }),
      });
      if (result.en) setEnData(result.en);
      if (result.cn) setCnData(result.cn);
      setShowModuleSelector(false);
      toast.success("已根据A+模块样式二次优化");
    } catch (err: any) {
      toast.error(err.message || "A+模块优化失败");
    }
  };

  // Handle AI combo recommendation
  const handleComboRecommend = async () => {
    try {
      const result = await comboRecommendMutation.mutateAsync({ projectId });
      setComboRecommendations(result);
      setShowComboPanel(true);
      toast.success("AI已生成3套推荐方案");
    } catch (err: any) {
      toast.error(err.message || "推荐失败");
    }
  };

  // Apply a recommended combo to per-section module styles
  const handleApplyCombo = (comboIdx: number) => {
    const combo = comboRecommendations?.recommendations?.[comboIdx];
    if (!combo?.modules) return;
    const newStyles: Record<number, string> = {};
    combo.modules.forEach((mod: any) => {
      const idx = (mod.position || 1) - 1;
      if (mod.moduleType) newStyles[idx] = mod.moduleType;
    });
    setSectionModuleStyles(newStyles);
    setSelectedComboIdx(comboIdx);
    toast.success(`已应用「${combo.name}」方案，可在各模块单独微调后点击AI优化`);
  };

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

  // Refine handlers - update specific image data
  const handleRefineMainImage = (en: any, cn: any) => {
    setEnData((prev: any) => ({ ...prev, mainImage: en }));
    setCnData((prev: any) => prev ? ({ ...prev, mainImage: cn }) : prev);
  };

  const handleRefineSecondaryImage = (idx: number) => (en: any, cn: any) => {
    setEnData((prev: any) => {
      const imgs = [...(prev.secondaryImages || [])];
      imgs[idx] = en;
      return { ...prev, secondaryImages: imgs };
    });
    setCnData((prev: any) => {
      if (!prev) return prev;
      const imgs = [...(prev.secondaryImages || [])];
      imgs[idx] = cn;
      return { ...prev, secondaryImages: imgs };
    });
  };

  const handleRefineAplusSection = (idx: number) => (en: any, cn: any) => {
    setEnData((prev: any) => {
      const sections = [...(prev.aPlusContent?.sections || [])];
      sections[idx] = en;
      return { ...prev, aPlusContent: { ...prev.aPlusContent, sections } };
    });
    setCnData((prev: any) => {
      if (!prev) return prev;
      const sections = [...(prev.aPlusContent?.sections || [])];
      sections[idx] = cn;
      return { ...prev, aPlusContent: { ...prev.aPlusContent, sections } };
    });
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
    if (cnData?.aPlusContent?.sections) {
      const cnSections = [...cnData.aPlusContent.sections];
      const [cnMoved] = cnSections.splice(draggedIdx, 1);
      cnSections.splice(idx, 0, cnMoved);
      setCnData({ ...cnData, aPlusContent: { ...cnData.aPlusContent, sections: cnSections } });
    }
    setDraggedIdx(idx);
  };
  const handleDragEnd = () => setDraggedIdx(null);

  // HTML export
  const handleExportHtml = () => {
    toast.info("正在准备导出...");
    try {
      const content = buildPdfContent(enData, cnData);
      const blob = new Blob([content], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "image-suggestions.html";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("已导出HTML文件");
    } catch {
      toast.error("导出失败");
    }
  };

  // PDF export via print
  const handleExportPdf = () => {
    toast.info("正在生成PDF...");
    try {
      const content = buildPdfContent(enData, cnData);
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast.error("无法打开打印窗口，请允许弹出窗口");
        return;
      }
      printWindow.document.write(content);
      printWindow.document.close();
      // Add print-specific styles and auto-trigger print
      setTimeout(() => {
        printWindow.print();
      }, 500);
      toast.success("已打开打印对话框，选择“保存为PDF”即可导出");
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
                  <Button variant="outline" onClick={handleExportHtml}>
                    <Download className="w-4 h-4 mr-2" /> 导出HTML
                  </Button>
                  <Button variant="outline" onClick={handleExportPdf}>
                    <FileText className="w-4 h-4 mr-2" /> 导出PDF
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认建议
                  </Button>
                </>
              )}
              {isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleExportHtml}>
                    <Download className="w-4 h-4 mr-2" /> 导出HTML
                  </Button>
                  <Button variant="outline" onClick={handleExportPdf}>
                    <FileText className="w-4 h-4 mr-2" /> 导出PDF
                  </Button>
                  <div className="flex gap-2 items-center">
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      <Lock className="w-3 h-3 mr-1" /> 已锁定
                    </Badge>
                    <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={resetMutation.isPending}>
                      {resetMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                      解锁编辑
                    </Button>
                  </div>
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

      {/* A+ Module Combo Recommendation Panel */}
      {enData && !isConfirmed && (
        <Card className="border-purple-200 bg-gradient-to-r from-purple-50/50 to-indigo-50/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" /> AI推荐A+模块组合方案
              </CardTitle>
              <Button
                variant={showComboPanel ? "secondary" : "default"}
                size="sm"
                className={showComboPanel ? "" : "bg-purple-600 hover:bg-purple-700"}
                onClick={() => {
                  if (!comboRecommendations) handleComboRecommend();
                  else setShowComboPanel(!showComboPanel);
                }}
                disabled={comboRecommendMutation.isPending}
              >
                {comboRecommendMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> 分析中...</>
                ) : showComboPanel ? "收起" : (
                  <><Sparkles className="w-4 h-4 mr-1" /> {comboRecommendations ? "查看推荐" : "AI智能推荐"}</>
                )}
              </Button>
            </div>
            <CardDescription>基于产品类目、卖点数量和品牌调性，AI自动推荐3套最佳的A+模块组合方案，一键应用后可单独微调</CardDescription>
          </CardHeader>
          {showComboPanel && comboRecommendations?.recommendations && (
            <CardContent>
              {comboRecommendations.analysisNote && (
                <div className="mb-4 p-3 bg-white/80 rounded-lg border border-purple-100 text-sm text-muted-foreground">
                  <strong className="text-purple-700">分析说明：</strong> {comboRecommendations.analysisNote}
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {comboRecommendations.recommendations.map((combo: any, cIdx: number) => {
                  const isApplied = selectedComboIdx === cIdx;
                  return (
                    <div
                      key={cIdx}
                      className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
                        isApplied
                          ? "border-purple-500 bg-purple-50 shadow-md"
                          : "border-gray-200 bg-white hover:border-purple-300 hover:shadow-sm"
                      }`}
                      onClick={() => handleApplyCombo(cIdx)}
                    >
                      {/* Score badge */}
                      {combo.score && (
                        <div className={`absolute -top-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                          combo.score >= 85 ? 'bg-green-500' : combo.score >= 70 ? 'bg-blue-500' : 'bg-orange-500'
                        }`}>
                          {combo.score}
                        </div>
                      )}
                      {isApplied && (
                        <div className="absolute -top-2 -left-2">
                          <Badge className="bg-purple-600 text-white text-[10px]">已应用</Badge>
                        </div>
                      )}
                      <h4 className="font-semibold text-sm text-purple-800 mb-1">{combo.name}</h4>
                      <p className="text-xs text-muted-foreground mb-2">{combo.description}</p>
                      {combo.visualRhythm && (
                        <p className="text-[10px] text-purple-600 mb-2 italic">节奏: {combo.visualRhythm}</p>
                      )}
                      {/* Module list */}
                      <div className="space-y-1.5 mb-3">
                        {combo.modules?.map((mod: any, mIdx: number) => {
                          const modInfo = APLUS_MODULES.find(m => m.id === mod.moduleType);
                          return (
                            <div key={mIdx} className="flex items-start gap-2">
                              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center">{mod.position || mIdx + 1}</span>
                              <div className="min-w-0">
                                <span className="text-xs font-medium">{mod.moduleName || modInfo?.name}</span>
                                {mod.purpose && <p className="text-[10px] text-muted-foreground truncate">{mod.purpose}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Strengths */}
                      {combo.strengths?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {combo.strengths.map((s: string, sIdx: number) => (
                            <Badge key={sIdx} variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">{s}</Badge>
                          ))}
                        </div>
                      )}
                      {combo.bestFor && (
                        <p className="text-[10px] text-muted-foreground">✅ 最适合: {combo.bestFor}</p>
                      )}
                      <Button
                        size="sm"
                        variant={isApplied ? "secondary" : "default"}
                        className={`w-full mt-2 text-xs ${isApplied ? '' : 'bg-purple-600 hover:bg-purple-700'}`}
                        onClick={(e) => { e.stopPropagation(); handleApplyCombo(cIdx); }}
                      >
                        {isApplied ? <><Check className="w-3 h-3 mr-1" /> 已应用</> : <>一键应用该方案</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>点击方案卡片或“一键应用”按钮，将自动填充各A+模块的样式选择器</span>
                <Button variant="ghost" size="sm" className="text-xs" onClick={handleComboRecommend} disabled={comboRecommendMutation.isPending}>
                  {comboRecommendMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                  重新推荐
                </Button>
              </div>
            </CardContent>
          )}
          {showComboPanel && comboRecommendMutation.isPending && (
            <CardContent>
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-500 mr-2" />
                <span className="text-sm text-muted-foreground">AI正在分析产品特征并生成最佳模块组合方案...</span>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* A+ Module Selector Panel */}
      {enData && !isConfirmed && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-500" /> 选择亚马逊超级A+模块样式
              </CardTitle>
              <Button variant={showModuleSelector ? "secondary" : "outline"} size="sm" onClick={() => setShowModuleSelector(!showModuleSelector)}>
                {showModuleSelector ? "收起" : "选择A+模块"}
              </Button>
            </div>
            <CardDescription>选择亚马逊高级A+模块样式，AI将根据模块规格二次优化图片建议</CardDescription>
          </CardHeader>
          {showModuleSelector && (
            <CardContent>
              <div className="space-y-4">
                {MODULE_CATEGORIES.map(cat => (
                  <div key={cat}>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">{cat}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {APLUS_MODULES.filter(m => m.category === cat).map(mod => {
                        const isSelected = selectedModules.includes(mod.id);
                        return (
                          <button
                            key={mod.id}
                            onClick={() => {
                              setSelectedModules(prev =>
                                isSelected ? prev.filter(id => id !== mod.id) : [...prev, mod.id]
                              );
                            }}
                            className={`p-3 rounded-lg border text-left transition-all ${
                              isSelected
                                ? "border-purple-400 bg-purple-50 shadow-sm"
                                : "border-gray-200 hover:border-purple-200 hover:bg-purple-50/30"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                                isSelected ? "bg-purple-500 border-purple-500" : "border-gray-300"
                              }`}>
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <span className="text-sm font-medium">{mod.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 ml-6">{mod.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-sm text-muted-foreground">已选择 {selectedModules.length} 个模块</span>
                  <Button onClick={handleAplusModuleOptimize} disabled={selectedModules.length === 0 || aplusOptimizeMutation.isPending}>
                    {aplusOptimizeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    根据模块二次优化
                  </Button>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}

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
                <div className="flex items-center justify-between w-full">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Camera className="w-4 h-4 text-primary" /> 主图 (Main Image)
                  </CardTitle>
                  {!isConfirmed && enData.mainImage && (
                    <RefinePopover
                      projectId={projectId}
                      imageType="mainImage"
                      currentEnContent={enData.mainImage}
                      currentCnContent={cnData?.mainImage}
                      onRefineComplete={handleRefineMainImage}
                    />
                  )}
                </div>
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
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Image className="w-4 h-4 text-blue-500" /> 辅图 {img.imageNumber || idx + 2}
                    </CardTitle>
                    {!isConfirmed && (
                      <RefinePopover
                        projectId={projectId}
                        imageType="secondaryImage"
                        imageIndex={idx}
                        currentEnContent={img}
                        currentCnContent={cnImg}
                        onRefineComplete={handleRefineSecondaryImage(idx)}
                      />
                    )}
                  </div>
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

              {/* Draggable A+ sections with per-section module style selector */}
              {enData.aPlusContent.sections?.map((section: any, idx: number) => {
                const cnSection = cnData?.aPlusContent?.sections?.[idx];
                const selectedStyle = sectionModuleStyles[idx] || section.selectedModuleType || '';
                const selectedMod = APLUS_MODULES.find(m => m.id === selectedStyle);
                const isOptimizing = optimizingSectionIdx === idx;
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
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {!isConfirmed && <GripVertical className="w-4 h-4 text-gray-400" />}
                          <CardTitle className="text-sm flex items-center gap-2">
                            A+ 模块 {idx + 1}
                            {section.type && <Badge variant="outline" className="text-xs">{section.type}</Badge>}
                            {section.selectedModuleName && (
                              <Badge variant="secondary" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                                {section.selectedModuleName}
                              </Badge>
                            )}
                          </CardTitle>
                        </div>
                        {!isConfirmed && (
                          <RefinePopover
                            projectId={projectId}
                            imageType="aPlusSection"
                            imageIndex={idx}
                            currentEnContent={section}
                            currentCnContent={cnSection}
                            onRefineComplete={handleRefineAplusSection(idx)}
                          />
                        )}
                      </div>
                      {/* Per-section A+ module style selector */}
                      {!isConfirmed && (
                        <div className="mt-3 p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                          <div className="flex items-center gap-2 mb-2">
                            <Layers className="w-3.5 h-3.5 text-purple-500" />
                            <span className="text-xs font-medium text-purple-700">选择超级A+模块样式</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select
                              value={selectedStyle}
                              onValueChange={(val) => setSectionModuleStyles(prev => ({ ...prev, [idx]: val }))}
                            >
                              <SelectTrigger className="h-8 text-xs flex-1 bg-white">
                                <SelectValue placeholder="选择A+模块样式..." />
                              </SelectTrigger>
                              <SelectContent>
                                {MODULE_CATEGORIES.map(cat => (
                                  <div key={cat}>
                                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">{cat}</div>
                                    {APLUS_MODULES.filter(m => m.category === cat).map(mod => (
                                      <SelectItem key={mod.id} value={mod.id}>
                                        <div className="flex flex-col">
                                          <span className="text-xs font-medium">{mod.name}</span>
                                          <span className="text-[10px] text-muted-foreground">{mod.desc} | {mod.specs}</span>
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </div>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-8 text-xs bg-purple-600 hover:bg-purple-700"
                              disabled={!selectedStyle || isOptimizing}
                              onClick={() => handleSingleModuleOptimize(idx)}
                            >
                              {isOptimizing ? (
                                <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> 优化中...</>
                              ) : (
                                <><Sparkles className="w-3 h-3 mr-1" /> AI优化</>
                              )}
                            </Button>
                          </div>
                          {selectedMod && (
                            <p className="text-[10px] text-purple-600 mt-1.5">
                              ℹ️ {selectedMod.name}: {selectedMod.desc} — {selectedMod.specs}
                            </p>
                          )}
                        </div>
                      )}
                    </CardHeader>
                    {isOptimizing ? (
                      <CardContent>
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-purple-500 mr-2" />
                          <span className="text-sm text-muted-foreground">AI正在根据「{selectedMod?.name}」样式重新优化该模块...</span>
                        </div>
                      </CardContent>
                    ) : (
                      <CardContent>
                        {/* Module specs display if optimized */}
                        {section.specs && (
                          <div className="mb-3 p-2 bg-purple-50 rounded border border-purple-100">
                            <div className="flex flex-wrap gap-2 text-[10px]">
                              {section.specs.desktopSize && <Badge variant="outline" className="text-[10px] bg-white">桌面: {section.specs.desktopSize}</Badge>}
                              {section.specs.mobileSize && <Badge variant="outline" className="text-[10px] bg-white">移动: {section.specs.mobileSize}</Badge>}
                              {section.specs.maxTitleChars && <Badge variant="outline" className="text-[10px] bg-white">标题≤{section.specs.maxTitleChars}字符</Badge>}
                              {section.specs.maxBodyChars && <Badge variant="outline" className="text-[10px] bg-white">正文≤{section.specs.maxBodyChars}字符</Badge>}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2 border-r pr-4">
                            <Badge variant="outline" className="text-xs">English</Badge>
                            <p className="text-sm font-medium">{section.title}</p>
                            <p className="text-xs"><strong>Purpose:</strong> {section.purpose}</p>
                            <p className="text-xs"><strong>Content:</strong> {section.content}</p>
                            {section.imageDescription && <p className="text-xs"><strong>Image:</strong> {section.imageDescription}</p>}
                            <FABEDisplay fabe={section.fabe} variant="en" />
                            {section.expressionMethod && <p className="text-xs"><strong>Expression:</strong> {section.expressionMethod}</p>}
                            {section.composition && <p className="text-xs"><strong>Composition:</strong> {section.composition}</p>}
                            {section.dataVisualization && <p className="text-xs"><strong>Data Viz:</strong> {section.dataVisualization}</p>}
                            {section.icons?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {section.icons.map((icon: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{icon}</Badge>)}
                              </div>
                            )}
                            {section.designTips?.length > 0 && (
                              <div className="mt-2 p-2 bg-amber-50 rounded text-xs">
                                <strong className="text-amber-700">设计提示:</strong>
                                <ul className="list-disc list-inside mt-1 text-amber-600">
                                  {section.designTips.map((tip: string, i: number) => <li key={i}>{tip}</li>)}
                                </ul>
                              </div>
                            )}
                            {/* Module-specific content display */}
                            {section.moduleSpecificContent && (
                              <div className="mt-2 p-2 bg-blue-50 rounded text-xs space-y-1">
                                <strong className="text-blue-700">模块专属内容:</strong>
                                {section.moduleSpecificContent.comparisons && (
                                  <div><strong>对比数据:</strong> {JSON.stringify(section.moduleSpecificContent.comparisons).slice(0, 200)}...</div>
                                )}
                                {section.moduleSpecificContent.panels && (
                                  <div><strong>面板:</strong> {section.moduleSpecificContent.panels.length}个面板</div>
                                )}
                                {section.moduleSpecificContent.hotspots && (
                                  <div><strong>热点:</strong> {section.moduleSpecificContent.hotspots.length}个热点</div>
                                )}
                                {section.moduleSpecificContent.qaItems && (
                                  <div><strong>问答:</strong> {section.moduleSpecificContent.qaItems.length}个问答</div>
                                )}
                                {section.moduleSpecificContent.specs && (
                                  <div><strong>规格:</strong> {section.moduleSpecificContent.specs.length}个规格项</div>
                                )}
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
                                {cnSection.imageDescription && <p className="text-xs"><strong>图片:</strong> {cnSection.imageDescription}</p>}
                                <FABEDisplay fabe={cnSection.fabe} variant="cn" />
                                {cnSection.expressionMethod && <p className="text-xs"><strong>表达方式:</strong> {cnSection.expressionMethod}</p>}
                                {cnSection.composition && <p className="text-xs"><strong>构图:</strong> {cnSection.composition}</p>}
                                {cnSection.dataVisualization && <p className="text-xs"><strong>数据可视化:</strong> {cnSection.dataVisualization}</p>}
                                {cnSection.designTips?.length > 0 && (
                                  <div className="mt-2 p-2 bg-amber-50 rounded text-xs">
                                    <strong className="text-amber-700">设计提示:</strong>
                                    <ul className="list-disc list-inside mt-1 text-amber-600">
                                      {cnSection.designTips.map((tip: string, i: number) => <li key={i}>{tip}</li>)}
                                    </ul>
                                  </div>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-muted-foreground">中文翻译未生成</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    )}
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

// ─── PDF content builder (Step 5 only) ──────────────────────────────
function buildPdfContent(enData: any, cnData: any): string {
  return buildFullPlanContent(null, enData, cnData);
}

// ─── Full Plan HTML builder (all 5 steps) ─────────────────────────
function buildFullPlanContent(session: any, enData?: any, cnData?: any): string {
  const s: string[] = [];
  s.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>产品图片设计完整方案</title>
<style>
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 960px; margin: 0 auto; padding: 24px; color: #333; line-height: 1.6; }
h1 { color: #8B4513; border-bottom: 3px solid #8B4513; padding-bottom: 10px; font-size: 24px; }
h2 { color: #8B4513; margin-top: 32px; padding: 8px 12px; background: #fdf2e9; border-left: 4px solid #8B4513; font-size: 18px; }
h3 { color: #555; margin-top: 16px; font-size: 15px; }
h4 { color: #666; margin-top: 12px; font-size: 14px; }
.step-badge { display: inline-block; background: #8B4513; color: white; padding: 3px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-right: 8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0; }
.en { background: #f0f7ff; padding: 14px; border-radius: 8px; border: 1px solid #d0e3ff; }
.cn { background: #fff7ed; padding: 14px; border-radius: 8px; border: 1px solid #ffe0c0; }
.card { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin: 8px 0; }
.card-selected { border-color: #8B4513; background: #fdf8f4; }
.fabe { background: #f5f5f5; padding: 8px 10px; border-radius: 4px; margin: 6px 0; font-size: 12px; border-left: 3px solid #d4a574; }
.badge { display: inline-block; background: #e5e7eb; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin: 2px; }
.badge-primary { background: #8B4513; color: white; }
.badge-green { background: #dcfce7; color: #166534; }
.badge-red { background: #fee2e2; color: #991b1b; }
.color-dot { display: inline-block; width: 16px; height: 16px; border-radius: 50%; border: 1px solid #ccc; vertical-align: middle; margin-right: 4px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
p { margin: 4px 0; font-size: 13px; }
.divider { border: none; border-top: 1px dashed #d4a574; margin: 24px 0; }
.ref-img { width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; margin: 2px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
th { background: #f3f4f6; padding: 8px; text-align: left; border: 1px solid #e5e7eb; }
td { padding: 8px; border: 1px solid #e5e7eb; }
.toc { background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0; }
.toc a { color: #8B4513; text-decoration: none; }
.toc a:hover { text-decoration: underline; }
@media print { body { max-width: 100%; padding: 12px; } h2 { break-before: auto; } }
</style></head><body>`);

  s.push(`<h1>📷 产品图片设计完整方案</h1>`);
  s.push(`<p style="color:#888;font-size:12px;">生成时间: ${new Date().toLocaleString('zh-CN')}</p>`);

  // Table of Contents
  s.push(`<div class="toc"><strong>目录</strong><br/>`);
  s.push(`<a href="#step1">Step 1: 卖点梳理</a><br/>`);
  s.push(`<a href="#step2">Step 2: 图片大纲</a><br/>`);
  s.push(`<a href="#step3">Step 3: 风格确认</a><br/>`);
  s.push(`<a href="#step4">Step 4: 参考图确认</a><br/>`);
  s.push(`<a href="#step5">Step 5: 图片结构及内容建议</a><br/>`);
  s.push(`<a href="#step6">Step 6: AI图片提示词</a>`);
  s.push(`</div>`);

  // ===== Step 1: Selling Points =====
  if (session) {
    s.push(`<h2 id="step1"><span class="step-badge">Step 1</span>卖点梳理</h2>`);
    const sp = safeJsonParse(session.step1UserEdit || session.step1AiResult);
    if (sp) {
      if (sp.coreSellingPoints?.length) {
        s.push(`<h3>⭐ 核心卖点（主卖点）</h3>`);
        sp.coreSellingPoints.forEach((p: any) => {
          s.push(`<div class="card"><strong>${p.point || p}</strong>${p.memoryHook ? `<br/><span style="color:#8B4513;font-size:12px;">记忆点: ${p.memoryHook}</span>` : ''}${p.expressions?.length ? `<br/><span class="tag-list">${p.expressions.map((e: string) => `<span class="badge">${e}</span>`).join('')}</span>` : ''}</div>`);
        });
      }
      if (sp.secondarySellingPoints?.length) {
        s.push(`<h3>○ 次要卖点</h3>`);
        sp.secondarySellingPoints.forEach((p: any) => {
          s.push(`<div class="card"><strong>${p.point || p}</strong>${p.addedValue ? `<br/><span style="font-size:12px;color:#666;">附加价值: ${p.addedValue}</span>` : ''}</div>`);
        });
      }
      if (sp.positiveReviewPoints?.length) {
        s.push(`<h3>✅ 好评点（需强化）</h3>`);
        s.push(`<div class="tag-list">${sp.positiveReviewPoints.map((p: any) => `<span class="badge badge-green">${p.point || p}</span>`).join('')}</div>`);
      }
      if (sp.negativeReviewPoints?.length) {
        s.push(`<h3>⚠️ 差评点</h3>`);
        sp.negativeReviewPoints.forEach((p: any) => {
          s.push(`<div class="card"><strong>${p.point || p}</strong>${p.resolved !== undefined ? `<br/><span class="badge ${p.resolved ? 'badge-green' : 'badge-red'}">${p.resolved ? '已解决 - 做对比' : '未解决 - 做引导'}</span>` : ''}${p.strategy ? `<br/><span style="font-size:12px;">策略: ${p.strategy}</span>` : ''}</div>`);
        });
      }
      if (sp.necessityDescriptions?.length) {
        s.push(`<h3>📏 必要性描述</h3>`);
        s.push(`<table><tr><th>类型</th><th>内容</th></tr>`);
        sp.necessityDescriptions.forEach((n: any) => {
          s.push(`<tr><td>${n.type || ''}</td><td>${n.description || n}</td></tr>`);
        });
        s.push(`</table>`);
      }
      if (sp.scenes?.length) {
        s.push(`<h3>🎬 场景及占比</h3>`);
        s.push(`<table><tr><th>场景</th><th>占比</th><th>优先级</th></tr>`);
        sp.scenes.forEach((sc: any) => {
          s.push(`<tr><td>${sc.scene || sc.name || sc}</td><td>${sc.percentage || sc.ratio || '-'}</td><td>${sc.priority || '-'}</td></tr>`);
        });
        s.push(`</table>`);
      }
    } else {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
  }

  // ===== Step 2: Image Outline =====
  if (session) {
    s.push(`<hr class="divider"/>`);
    s.push(`<h2 id="step2"><span class="step-badge">Step 2</span>图片大纲</h2>`);
    const outline = safeJsonParse(session.step2UserEdit || session.step2AiResult);
    if (outline?.images?.length) {
      s.push(`<table><tr><th>图片</th><th>内容规划</th><th>呼应卖点</th><th>表达方式</th></tr>`);
      outline.images.forEach((img: any) => {
        s.push(`<tr><td><strong>${img.imageLabel || img.label || ''}</strong><br/><span class="badge">${img.imageType || ''}</span></td><td>${img.content || img.description || ''}</td><td>${img.sellingPoint || img.linkedSellingPoint || ''}</td><td>${img.expressionMethod || ''}</td></tr>`);
      });
      s.push(`</table>`);
    }
    if (outline?.brandStory) {
      s.push(`<h3>品牌故事</h3><div class="card">${typeof outline.brandStory === 'string' ? outline.brandStory : JSON.stringify(outline.brandStory)}</div>`);
    }
    if (outline?.aPlusOutline) {
      s.push(`<h3>A+ 内容大纲</h3><div class="card">${typeof outline.aPlusOutline === 'string' ? outline.aPlusOutline : JSON.stringify(outline.aPlusOutline)}</div>`);
    }
    if (!outline) {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
  }

  // ===== Step 3: Style Confirmation =====
  if (session) {
    s.push(`<hr class="divider"/>`);
    s.push(`<h2 id="step3"><span class="step-badge">Step 3</span>风格确认</h2>`);
    const styleData = safeJsonParse(session.step3UserEdit || session.step3AiResult);
    if (styleData?.selectedStyles?.length) {
      styleData.selectedStyles.forEach((style: any) => {
        s.push(`<div class="card card-selected">`);
        s.push(`<h4>✅ ${style.name || '已选风格'}</h4>`);
        if (style.description) s.push(`<p>${style.description}</p>`);
        if (style.colorPalette) {
          s.push(`<p><strong>配色:</strong> `);
          Object.entries(style.colorPalette).forEach(([k, v]: [string, any]) => {
            const hex = String(v).match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc';
            s.push(`<span class="color-dot" style="background:${hex}"></span>${k}: ${v} &nbsp;`);
          });
          s.push(`</p>`);
        }
        if (style.typography) s.push(`<p><strong>字体:</strong> 标题: ${style.typography.headingFont || ''} | 正文: ${style.typography.bodyFont || ''}</p>`);
        if (style.overallTone) s.push(`<p><strong>调性:</strong> ${style.overallTone}</p>`);
        if (style.whyRecommend) s.push(`<p style="font-size:12px;color:#888;"><em>${style.whyRecommend}</em></p>`);
        s.push(`</div>`);
      });
    }
    // KB reference images for styles
    if (styleData?.styleKbImages) {
      const hasAny = Object.values(styleData.styleKbImages).some((arr: any) => arr?.length > 0);
      if (hasAny) {
        s.push(`<h3>知识库参考图</h3>`);
        Object.entries(styleData.styleKbImages).forEach(([styleId, imgs]: [string, any]) => {
          if (imgs?.length) {
            s.push(`<div class="card"><strong>风格 ${styleId} 参考图:</strong><br/>`);
            imgs.forEach((img: any) => {
              s.push(`<img class="ref-img" src="${img.imageUrl}" alt="ref"/>`);
            });
            s.push(`</div>`);
          }
        });
      }
    }
    if (!styleData) {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
  }

  // ===== Step 4: Reference Images =====
  if (session) {
    s.push(`<hr class="divider"/>`);
    s.push(`<h2 id="step4"><span class="step-badge">Step 4</span>参考图确认</h2>`);
    const refData = safeJsonParse(session.step4UserEdit || session.step4AiResult);
    if (refData?.imageReferences?.length) {
      refData.imageReferences.forEach((ref: any) => {
        s.push(`<div class="card">`);
        s.push(`<h4>${ref.imageLabel || ''}</h4>`);
        if (ref.compositionReference) {
          s.push(`<p><strong>构图参考:</strong></p>`);
          s.push(`<p>类型: ${ref.compositionReference.type || ''}</p>`);
          s.push(`<p>描述: ${ref.compositionReference.description || ''}</p>`);
          if (ref.compositionReference.source) s.push(`<p>来源: ${ref.compositionReference.source}</p>`);
        }
        if (ref.effectReference) {
          s.push(`<p><strong>效果图参考:</strong></p>`);
          s.push(`<p>风格: ${ref.effectReference.style || ''}</p>`);
          s.push(`<p>描述: ${ref.effectReference.description || ''}</p>`);
        }
        // KB reference images
        if (ref.kbReferenceImages?.length) {
          s.push(`<p><strong>知识库参考图:</strong></p>`);
          ref.kbReferenceImages.forEach((img: any) => {
            s.push(`<img class="ref-img" src="${img.imageUrl}" alt="ref"/>`);
          });
        }
        s.push(`</div>`);
      });
    }
    if (!refData) {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
  }

  // ===== Step 5: Final Image Suggestions =====
  s.push(`<hr class="divider"/>`);
  s.push(`<h2 id="step5"><span class="step-badge">Step 5</span>图片结构及内容建议</h2>`);

  const en = enData || (session ? safeJsonParse(session.step5UserEdit || session.step5AiResult) : null);
  const cn = cnData || (session ? safeJsonParse(session.step5AiResultCn) : null);

  if (en) {
    if (en.designGuidelines) {
      s.push(`<h3>设计指南 / Design Guidelines</h3><div class="grid"><div class="en"><p><strong>Font:</strong> ${en.designGuidelines.fontRecommendation || ''}</p><p><strong>Color:</strong> ${en.designGuidelines.overallColorPalette || ''}</p><p><strong>Tone:</strong> ${en.designGuidelines.brandTone || ''}</p></div><div class="cn"><p><strong>字体:</strong> ${cn?.designGuidelines?.fontRecommendation || ''}</p><p><strong>配色:</strong> ${cn?.designGuidelines?.overallColorPalette || ''}</p><p><strong>调性:</strong> ${cn?.designGuidelines?.brandTone || ''}</p></div></div>`);
    }
    if (en.mainImage) {
      s.push(`<h3>主图 / Main Image</h3><div class="grid"><div class="en"><p><strong>${en.mainImage.title || ''}</strong></p><p>${en.mainImage.concept || ''}</p><p><strong>Composition:</strong> ${en.mainImage.composition || ''}</p><p><strong>Shooting:</strong> ${en.mainImage.shootingNotes || ''}</p></div><div class="cn"><p><strong>${cn?.mainImage?.title || ''}</strong></p><p>${cn?.mainImage?.concept || ''}</p><p><strong>构图:</strong> ${cn?.mainImage?.composition || ''}</p><p><strong>拍摄:</strong> ${cn?.mainImage?.shootingNotes || ''}</p></div></div>`);
    }
    en.secondaryImages?.forEach((img: any, idx: number) => {
      const cnImg = cn?.secondaryImages?.[idx];
      s.push(`<h3>辅图 ${img.imageNumber || idx + 2}</h3><div class="grid"><div class="en"><p><strong>${img.title || ''}</strong></p><p><strong>Focus:</strong> ${img.focus || ''}</p>${img.fabe ? `<div class="fabe"><strong>FABE:</strong> F: ${img.fabe.feature || ''} | A: ${img.fabe.advantage || ''} | B: ${img.fabe.benefit || ''} | E: ${img.fabe.evidence || ''}</div>` : ''}<p><strong>Expression:</strong> ${img.expressionMethod || ''}</p><p><strong>Composition:</strong> ${img.composition || ''}</p><p><strong>Text:</strong> ${img.textOverlay || ''}</p></div><div class="cn"><p><strong>${cnImg?.title || ''}</strong></p><p><strong>聚焦:</strong> ${cnImg?.focus || ''}</p>${cnImg?.fabe ? `<div class="fabe"><strong>FABE:</strong> F: ${cnImg.fabe.feature || ''} | A: ${cnImg.fabe.advantage || ''} | B: ${cnImg.fabe.benefit || ''} | E: ${cnImg.fabe.evidence || ''}</div>` : ''}<p><strong>表达:</strong> ${cnImg?.expressionMethod || ''}</p><p><strong>构图:</strong> ${cnImg?.composition || ''}</p><p><strong>文案:</strong> ${cnImg?.textOverlay || ''}</p></div></div>`);
    });
    if (en.aPlusContent?.sections) {
      s.push(`<h3>A+ Content</h3>`);
      en.aPlusContent.sections.forEach((sec: any, idx: number) => {
        const cnSec = cn?.aPlusContent?.sections?.[idx];
        s.push(`<h4>Module ${idx + 1}: ${sec.title || ''}</h4><div class="grid"><div class="en"><p><strong>Purpose:</strong> ${sec.purpose || ''}</p><p>${sec.content || ''}</p>${sec.fabe ? `<div class="fabe">FABE: F: ${sec.fabe.feature || ''} | A: ${sec.fabe.advantage || ''} | B: ${sec.fabe.benefit || ''} | E: ${sec.fabe.evidence || ''}</div>` : ''}</div><div class="cn"><p><strong>目的:</strong> ${cnSec?.purpose || ''}</p><p>${cnSec?.content || ''}</p>${cnSec?.fabe ? `<div class="fabe">FABE: F: ${cnSec.fabe.feature || ''} | A: ${cnSec.fabe.advantage || ''} | B: ${cnSec.fabe.benefit || ''} | E: ${cnSec.fabe.evidence || ''}</div>` : ''}</div></div>`);
      });
    }
  } else {
    s.push(`<p style="color:#999;">未生成或未确认</p>`);
  }

  // ===== Step 6: AI Prompts =====
  if (session) {
    s.push(`<h2 id="step6"><span class="step-badge">Step 6</span>AI图片提示词</h2>`);
    const s6 = safeJsonParse(session.step6UserEdit || session.step6AiResult);
    if (s6?.imagePrompts?.length) {
      if (s6.globalSettings) {
        s.push(`<div class="card"><strong>全局设置</strong><br/>`);
        s.push(`<p>推荐工具: ${s6.globalSettings.recommendedTool || ''}</p>`);
        s.push(`<p>一致性提示: ${s6.globalSettings.consistencyTips || ''}</p>`);
        s.push(`<p>品牌色融入: ${s6.globalSettings.brandColorIntegration || ''}</p></div>`);
      }
      s6.imagePrompts.forEach((p: any, idx: number) => {
        s.push(`<div class="card"><h4>${p.imageLabel || `Image ${idx + 1}`} - ${p.purpose || ''}</h4>`);
        s.push(`<p style="color:green;"><strong>Positive Prompt:</strong></p><pre style="background:#f0fff0;padding:8px;border-radius:4px;font-size:12px;white-space:pre-wrap;">${p.prompt || ''}</pre>`);
        s.push(`<p style="color:red;"><strong>Negative Prompt:</strong></p><pre style="background:#fff0f0;padding:8px;border-radius:4px;font-size:12px;white-space:pre-wrap;">${p.negativePrompt || ''}</pre>`);
        if (p.parameters) {
          s.push(`<p><span class="badge">宽高比: ${p.parameters.aspectRatio || ''}</span> <span class="badge">风格: ${p.parameters.style || ''}</span> <span class="badge">质量: ${p.parameters.quality || ''}</span></p>`);
        }
        if (p.notes) s.push(`<p style="color:#8B4513;font-size:12px;">提示: ${p.notes}</p>`);
        s.push(`</div>`);
      });
    } else {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
  }

  s.push(`</body></html>`);
  return s.join("\n");
}

function safeJsonParse(str: string | null | undefined): any {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}
// ═════════════════════════════════════════════════════════════════
// ─── Step 6: AI Prompts Generation ──────────────────────────────────
// ═════════════════════════════════════════════════════════════════
function Step6AIPrompts({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const generateMutation = trpc.imageWorkflow.generateStep6.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep6.useMutation();
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();
  const [enData, setEnData] = useState<any>(null);
  const [cnData, setCnData] = useState<any>(null);
  const [isLocked, setIsLocked] = useState(!!session?.step6Confirmed);
  const [showLang, setShowLang] = useState<"en" | "cn">("en");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (session?.step6AiResult) {
      try { setEnData(JSON.parse(session.step6UserEdit || session.step6AiResult)); } catch {}
    }
    if (session?.step6AiResultCn) {
      try { setCnData(JSON.parse(session.step6AiResultCn)); } catch {}
    }
  }, [session?.step6AiResult, session?.step6AiResultCn, session?.step6UserEdit]);

  useEffect(() => {
    setIsLocked(!!session?.step6Confirmed);
  }, [session?.step6Confirmed]);

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ projectId });
      setEnData(result.en);
      setCnData(result.cn);
      toast.success("AI提示词生成完成");
    } catch (err: any) {
      toast.error(err.message || "生成失败");
    }
  };

  const handleConfirm = async () => {
    if (!enData) return;
    try {
      await confirmMutation.mutateAsync({ projectId, userEdit: JSON.stringify(enData) });
      setIsLocked(true);
      toast.success("AI提示词已确认");
      onConfirm();
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  const handleUnlock = async () => {
    try {
      await resetMutation.mutateAsync({ projectId, step: 6 });
      setIsLocked(false);
      toast.success("已解锁Step 6，可重新编辑");
    } catch (err: any) {
      toast.error(err.message || "解锁失败");
    }
  };

  const handleCopyPrompt = (prompt: string, idx: number) => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopiedIdx(idx);
      toast.success("提示词已复制到剪贴板");
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  };

  const handleCopyAll = () => {
    if (!enData?.imagePrompts) return;
    const allPrompts = enData.imagePrompts.map((p: any, i: number) =>
      `--- ${p.imageLabel || `Image ${i + 1}`} ---\nPrompt: ${p.prompt}\nNegative: ${p.negativePrompt}\nAspect Ratio: ${p.parameters?.aspectRatio || 'N/A'}\nStyle: ${p.parameters?.style || 'N/A'}\n`
    ).join('\n');
    navigator.clipboard.writeText(allPrompts).then(() => {
      toast.success("全部提示词已复制");
    });
  };

  const handleEditPrompt = (idx: number, field: string, value: string) => {
    setEnData((prev: any) => {
      const prompts = [...(prev.imagePrompts || [])];
      prompts[idx] = { ...prompts[idx], [field]: value };
      return { ...prev, imagePrompts: prompts };
    });
  };

  const isConfirmed = isLocked;
  const data = showLang === "cn" && cnData ? cnData : enData;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-500" />
                Step 6: AI图片提示词生成
              </CardTitle>
              <CardDescription>根据前5步确认的内容，生成可直接用于AI图片生成工具的提示词（支持Midjourney/DALL-E/Stable Diffusion）</CardDescription>
            </div>
            <div className="flex gap-2">
              {!enData && (
                <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  生成AI提示词
                </Button>
              )}
              {enData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
                    <RotateCcw className="w-4 h-4 mr-2" /> 重新生成
                  </Button>
                  <Button variant="outline" onClick={handleCopyAll}>
                    <Copy className="w-4 h-4 mr-2" /> 复制全部
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认提示词
                  </Button>
                </>
              )}
              {isConfirmed && (
                <div className="flex gap-2 items-center">
                  <Button variant="outline" onClick={handleCopyAll}>
                    <Copy className="w-4 h-4 mr-2" /> 复制全部
                  </Button>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Lock className="w-3 h-3 mr-1" /> 已锁定
                  </Badge>
                  <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={resetMutation.isPending}>
                    {resetMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                    解锁编辑
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        {generateMutation.isPending && (
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500 mr-3" />
              <span className="text-muted-foreground">AI正在综合生成图片提示词（包含正面/负面提示词、参数建议）...</span>
            </div>
          </CardContent>
        )}
      </Card>

      {data?.imagePrompts && !generateMutation.isPending && (
        <>
          {/* Language toggle */}
          {cnData && (
            <div className="flex justify-end">
              <div className="inline-flex rounded-lg border p-0.5 bg-muted">
                <button
                  className={`px-3 py-1 rounded-md text-sm transition-all ${showLang === 'en' ? 'bg-white shadow-sm font-medium' : 'text-muted-foreground'}`}
                  onClick={() => setShowLang('en')}
                >
                  English
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-sm transition-all ${showLang === 'cn' ? 'bg-white shadow-sm font-medium' : 'text-muted-foreground'}`}
                  onClick={() => setShowLang('cn')}
                >
                  中文
                </button>
              </div>
            </div>
          )}

          {/* Global Settings */}
          {data.globalSettings && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" /> 全局设置与建议
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-xs font-medium text-blue-700 mb-1">推荐工具</p>
                    <p className="text-sm">{data.globalSettings.recommendedTool}</p>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                    <p className="text-xs font-medium text-green-700 mb-1">一致性提示</p>
                    <p className="text-sm">{data.globalSettings.consistencyTips}</p>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                    <p className="text-xs font-medium text-purple-700 mb-1">品牌色融入</p>
                    <p className="text-sm">{data.globalSettings.brandColorIntegration}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Image Prompts */}
          {data.imagePrompts.map((prompt: any, idx: number) => (
            <Card key={idx} className="overflow-hidden">
              <CardHeader className="pb-3 bg-gradient-to-r from-purple-50 to-blue-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge className={`${
                      prompt.imageType === 'mainImage' ? 'bg-amber-500' :
                      prompt.imageType === 'secondaryImage' ? 'bg-blue-500' : 'bg-purple-500'
                    }`}>
                      {prompt.imageLabel || `Image ${idx + 1}`}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{prompt.purpose}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleCopyPrompt(prompt.prompt, idx)}
                    >
                      {copiedIdx === idx ? <Check className="w-3 h-3 mr-1 text-green-500" /> : <Copy className="w-3 h-3 mr-1" />}
                      {copiedIdx === idx ? "已复制" : "复制Prompt"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* Main Prompt */}
                <div>
                  <label className="text-xs font-medium text-green-700 flex items-center gap-1 mb-1">
                    <Sparkles className="w-3 h-3" /> Positive Prompt
                  </label>
                  {!isConfirmed ? (
                    <Textarea
                      value={showLang === 'en' ? (enData?.imagePrompts?.[idx]?.prompt || '') : prompt.prompt}
                      onChange={(e) => showLang === 'en' && handleEditPrompt(idx, 'prompt', e.target.value)}
                      className="min-h-[80px] text-sm font-mono bg-green-50/50 border-green-200"
                      readOnly={showLang !== 'en'}
                    />
                  ) : (
                    <div className="p-3 bg-green-50/50 rounded-lg border border-green-200 text-sm font-mono whitespace-pre-wrap">
                      {prompt.prompt}
                    </div>
                  )}
                </div>

                {/* Negative Prompt */}
                <div>
                  <label className="text-xs font-medium text-red-700 flex items-center gap-1 mb-1">
                    <X className="w-3 h-3" /> Negative Prompt
                  </label>
                  {!isConfirmed ? (
                    <Textarea
                      value={showLang === 'en' ? (enData?.imagePrompts?.[idx]?.negativePrompt || '') : prompt.negativePrompt}
                      onChange={(e) => showLang === 'en' && handleEditPrompt(idx, 'negativePrompt', e.target.value)}
                      className="min-h-[60px] text-sm font-mono bg-red-50/50 border-red-200"
                      readOnly={showLang !== 'en'}
                    />
                  ) : (
                    <div className="p-3 bg-red-50/50 rounded-lg border border-red-200 text-sm font-mono whitespace-pre-wrap">
                      {prompt.negativePrompt}
                    </div>
                  )}
                </div>

                {/* Parameters */}
                {prompt.parameters && (
                  <div className="flex flex-wrap gap-3">
                    <div className="px-3 py-1.5 bg-gray-100 rounded-lg">
                      <span className="text-xs text-muted-foreground">宽高比</span>
                      <p className="text-sm font-medium">{prompt.parameters.aspectRatio}</p>
                    </div>
                    <div className="px-3 py-1.5 bg-gray-100 rounded-lg">
                      <span className="text-xs text-muted-foreground">风格</span>
                      <p className="text-sm font-medium">{prompt.parameters.style}</p>
                    </div>
                    <div className="px-3 py-1.5 bg-gray-100 rounded-lg">
                      <span className="text-xs text-muted-foreground">质量</span>
                      <p className="text-sm font-medium">{prompt.parameters.quality}</p>
                    </div>
                    {prompt.parameters.seed && (
                      <div className="px-3 py-1.5 bg-gray-100 rounded-lg">
                        <span className="text-xs text-muted-foreground">Seed</span>
                        <p className="text-sm font-medium">{prompt.parameters.seed}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Prompt Breakdown */}
                {prompt.promptBreakdown && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">提示词拆解</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {Object.entries(prompt.promptBreakdown).map(([key, val]: [string, any]) => (
                        <div key={key} className="p-2 bg-gray-50 rounded border text-xs">
                          <span className="text-muted-foreground capitalize">{key === 'subject' ? '主体' : key === 'scene' ? '场景' : key === 'composition' ? '构图' : key === 'lighting' ? '光影' : key === 'color' ? '色彩' : key === 'styleKeywords' ? '风格' : key === 'qualityKeywords' ? '质量' : key}</span>
                          <p className="mt-0.5 font-mono text-[11px]">{val as string}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {prompt.notes && (
                  <div className="p-2 bg-amber-50 rounded border border-amber-100 text-xs text-amber-800">
                    <strong>使用提示：</strong> {prompt.notes}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ─── Main Page Component ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
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
    if (currentStep < 6) {
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
            <p className="text-muted-foreground text-sm mt-1">6步工作流：卖点梳理 → 图片大纲 → 风格确认 → 参考图确认 → 图片建议 → AI提示词</p>
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
          <p className="text-muted-foreground text-sm mt-1">6步工作流：卖点梳理 → 图片大纲 → 风格确认 → 参考图确认 → 图片建议 → AI提示词</p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectSelector />
          {session && session.step6Confirmed && (
            <Button variant="outline" size="sm" onClick={() => {
              toast.info("正在生成完整方案...");
              try {
                const content = buildFullPlanContent(session);
                const blob = new Blob([content], { type: "text/html;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `图片设计完整方案-${new Date().toISOString().slice(0,10)}.html`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("已导出完整方案，可在浏览器中打印为PDF");
              } catch {
                toast.error("导出失败");
              }
            }}>
              <FileText className="w-3 h-3 mr-1" /> 导出完整方案
            </Button>
          )}
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
                <p className="text-sm text-muted-foreground mt-1">通过6个步骤，AI将帮助你规划产品图片的完整方案并生成AI图片提示词</p>
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
      {session && currentStep === 6 && (
        <Step6AIPrompts projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
    </div>
  );
}
