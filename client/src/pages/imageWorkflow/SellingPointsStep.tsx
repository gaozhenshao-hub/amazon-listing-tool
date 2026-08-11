import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Check, ChevronRight, Image, Loader2, Sparkles, Target, Layout, Palette, Eye, FileText, RotateCcw, Plus, Trash2, GripVertical, Download, Languages, Paintbrush, Camera, BarChart3, Layers, Lightbulb, Smartphone, TypeIcon, Copy, Search, ImageIcon, BookOpen, X, Filter, Wand2, Pencil, Send, Lock, Unlock, Upload, Zap, Grid3X3, LayoutGrid, RefreshCw } from "lucide-react";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { ImageStepGenerationStatus, useImageStepGenerationJob } from "./useImageStepGenerationJob";

// ═══════════════════════════════════════════════════════════════════
// ─── Step 1: Selling Points ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
export function Step1SellingPoints({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const confirmMutation = trpc.imageWorkflow.confirmStep1.useMutation();
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();
  const [editData, setEditData] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLocked, setIsLocked] = useState(!!session?.step1Confirmed);
  const generationJob = useImageStepGenerationJob({
    projectId,
    step: 1,
    onSucceeded: (result) => {
      setEditData(result);
      setIsEditing(true);
    },
  });

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
    await generationJob.start();
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
                <Button onClick={handleGenerate} disabled={generationJob.isGenerating}>
                  {generationJob.isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  AI生成卖点
                </Button>
              )}
              {editData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generationJob.isGenerating}>
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
        <ImageStepGenerationStatus
          run={generationJob.run}
          isGenerating={generationJob.isGenerating}
          isCanceling={generationJob.isCanceling}
          onCancel={generationJob.cancel}
          onRetry={generationJob.start}
        />
      </Card>

      {editData && !generationJob.isGenerating && (
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
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-muted-foreground">卖点</label>
                          {isConfirmed && sp.dataSource && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 border border-indigo-200">{sp.dataSource}</span>
                          )}
                        </div>
                        {isConfirmed ? (
                          <p className="text-sm font-medium">{sp.point}</p>
                        ) : (
                          <Input value={sp.point || ""} onChange={(e) => updateItem("coreSellingPoints", idx, "point", e.target.value)} className="h-8 text-sm" />
                        )}
                        {!isConfirmed && (
                          <div className="mt-1">
                            <label className="text-[10px] text-muted-foreground">数据来源</label>
                            <select
                              value={sp.dataSource || ""}
                              onChange={(e) => updateItem("coreSellingPoints", idx, "dataSource", e.target.value)}
                              className="w-full h-7 text-xs border rounded-md px-2 bg-background mt-0.5"
                            >
                              <option value="">请选择数据来源</option>
                              <option value="来自竞品差评分析">来自竞品差评分析</option>
                              <option value="来自竞品好评分析">来自竞品好评分析</option>
                              <option value="来自关键词场景数据">来自关键词场景数据</option>
                              <option value="来自产品画像">来自产品画像</option>
                              <option value="来自运营经验推断">来自运营经验推断</option>
                            </select>
                          </div>
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{sp.point}</p>
                          {sp.dataSource && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 border border-indigo-200 shrink-0">{sp.dataSource}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{sp.value}</p>
                        <p className="text-xs text-blue-600">建议表达: {sp.suggestedExpression}</p>
                      </>
                    ) : (
                      <>
                        <Input value={sp.point || ""} onChange={(e) => updateItem("secondarySellingPoints", idx, "point", e.target.value)} placeholder="卖点" className="h-7 text-sm" />
                        <Input value={sp.value || ""} onChange={(e) => updateItem("secondarySellingPoints", idx, "value", e.target.value)} placeholder="附加价値" className="h-7 text-sm" />
                        <Input value={sp.suggestedExpression || ""} onChange={(e) => updateItem("secondarySellingPoints", idx, "suggestedExpression", e.target.value)} placeholder="建议表达" className="h-7 text-sm" />
                        <div>
                          <label className="text-[10px] text-muted-foreground">数据来源</label>
                          <select
                            value={sp.dataSource || ""}
                            onChange={(e) => updateItem("secondarySellingPoints", idx, "dataSource", e.target.value)}
                            className="w-full h-7 text-xs border rounded-md px-2 bg-background mt-0.5"
                          >
                            <option value="">请选择数据来源</option>
                            <option value="来自竞品差评分析">来自竞品差评分析</option>
                            <option value="来自竞品好评分析">来自竞品好评分析</option>
                            <option value="来自关键词场景数据">来自关键词场景数据</option>
                            <option value="来自产品画像">来自产品画像</option>
                            <option value="来自运营经验推断">来自运营经验推断</option>
                          </select>
                        </div>
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
