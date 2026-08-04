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

import { OUTLINE_APLUS_CATEGORIES, OUTLINE_APLUS_MODULES, findOutlineAplusModule, normalizeAplusModuleStyle } from "./aplusModules";

export function Step2ImageOutline({
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
  const unlockMutation = trpc.imageWorkflow.unlockStep2.useMutation();
  const utils = trpc.useUtils();
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
      await unlockMutation.mutateAsync({ projectId });
      await utils.imageWorkflow.getSession.invalidate({ projectId });
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
      const normalizedData = {
        ...editData,
        aPlusModules: (editData.aPlusModules || []).map(normalizeAplusModuleStyle),
      };
      setEditData(normalizedData);
      await confirmMutation.mutateAsync({ projectId, userEdit: JSON.stringify(normalizedData) });
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

  const updateAPlusModuleStyle = (idx: number, moduleType: string) => {
    const selected = OUTLINE_APLUS_MODULES.find((m) => m.id === moduleType);
    if (!selected || !editData) return;
    const newData = { ...editData, aPlusModules: [...(editData.aPlusModules || [])] };
    newData.aPlusModules[idx] = {
      ...newData.aPlusModules[idx],
      selectedModuleType: selected.id,
      selectedModuleName: selected.name,
      selectedModuleCategory: selected.category,
      selectedModuleSpecs: selected.specs,
      selectedModuleStructure: selected.structure,
    };
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
                  <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={unlockMutation.isPending}>
                    {unlockMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
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

{/* Step0 竞品表达方式联动提示 */}
          {(() => {
            const step0Data = session?.step0AiResult ? (() => { try { return JSON.parse(session.step0AiResult); } catch { return null; } })() : null;
            if (!step0Data) return null;
            const highFreqMethods = step0Data.sellingPointDistribution
              ?.filter((d: any) => d.frequency === '高')
              ?.flatMap((d: any) => d.expressionMethods || [])
              ?.filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
              ?.slice(0, 3) || [];
            const diffOpps = step0Data.differentiationOpportunities?.slice(0, 2) || [];
            if (highFreqMethods.length === 0 && diffOpps.length === 0) return null;
            return (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 mb-2">
                <p className="text-xs font-semibold text-amber-700 mb-1.5">✨ 竞品表达方式参考（来自 Step0 分析）</p>
                {highFreqMethods.length > 0 && (
                  <p className="text-xs text-amber-800 mb-1">
                    竞品高频使用：{highFreqMethods.map((m: string, i: number) => (
                      <span key={i} className="inline-block mx-1 px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 text-[10px]">{m}</span>
                    ))}
                  </p>
                )}
                {diffOpps.length > 0 && (
                  <p className="text-xs text-green-700">差异化机会：{diffOpps.join('、')}，建议尝试差异化表达方式</p>
                )}
              </div>
            );
          })()}

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
                    <div className="flex items-center gap-2">
                      <strong className="text-sm">表达方式:</strong>
                      <Badge className={`text-xs ${
                        img.expressionType === '直接展示' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                        img.expressionType === '场景暗示' ? 'bg-green-100 text-green-700 border-green-200' :
                        img.expressionType === '数据对比' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                        img.expressionType === '原理展示' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                        img.expressionType === '用户获益' ? 'bg-teal-100 text-teal-700 border-teal-200' :
                        img.expressionType === '解决痛点' ? 'bg-red-100 text-red-700 border-red-200' :
                        'bg-gray-100 text-gray-700 border-gray-200'
                      }`} variant="outline">{img.expressionType || '未设置'}</Badge>
                    </div>
                    <p className="text-sm"><strong>呼应卖点:</strong> {img.sellingPointRefs?.join(", ")}</p>
                    <p className="text-sm text-muted-foreground"><strong>理由:</strong> {img.whyThisWay}</p>
                  </>
                ) : (
                  <>
                    <Input value={img.purpose || ""} onChange={(e) => updateSecondaryImage(idx, "purpose", e.target.value)} placeholder="图片目的" className="h-8 text-sm" />
                    <Textarea value={img.contentBrief || ""} onChange={(e) => updateSecondaryImage(idx, "contentBrief", e.target.value)} placeholder="内容简述" className="min-h-[50px] text-sm" />
                    {/* 表达方式下拉选择器 + Step0 联动提示 */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">表达方式</label>
                        {(() => {
                          const step0Data = session?.step0AiResult ? (() => { try { return JSON.parse(session.step0AiResult); } catch { return null; } })() : null;
                          if (!step0Data) return null;
                          const highFreq = step0Data.sellingPointDistribution
                            ?.filter((d: any) => d.frequency === '高')
                            ?.flatMap((d: any) => d.expressionMethods || [])
                            ?.filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
                            ?.slice(0, 2) || [];
                          if (highFreq.length === 0) return null;
                          return (
                            <span className="text-[10px] text-amber-600">竞品高频: {highFreq.join('/')}</span>
                          );
                        })()}
                      </div>
                      <select
                        value={img.expressionType || ""}
                        onChange={(e) => updateSecondaryImage(idx, "expressionType", e.target.value)}
                        className="w-full h-8 text-sm border rounded-md px-2 bg-background"
                      >
                        <option value="">请选择表达方式</option>
                        <option value="直接展示">直接展示 — 正面拍摄产品特征</option>
                        <option value="场景暗示">场景暗示 — 通过使用场景传达价値</option>
                        <option value="数据对比">数据对比 — 数据/图表/参数对比</option>
                        <option value="原理展示">原理展示 — 展示产品工作原理</option>
                        <option value="用户获益">用户获益 — 展示用户得到的好处</option>
                        <option value="解决痛点">解决痛点 — 展示如何解决痛点</option>
                        <option value="情感共鸣">情感共鸣 — 情感化场景建立连接</option>
                        <option value="对比展示">对比展示 — 与竞品或使用前后对比</option>
                      </select>
                    </div>
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
          {editData.aPlusModules?.map((mod: any, idx: number) => {
            const rawSelectedStyle = mod.selectedModuleType || mod.recommendedModuleType || "";
            const matchedModule = findOutlineAplusModule(rawSelectedStyle);
            const selectedStyle = matchedModule?.id || "";
            const selectedModule = matchedModule || findOutlineAplusModule(mod.selectedModuleName);
            return (
              <Card key={idx}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    <Layers className="w-4 h-4 text-purple-500" /> A+ 模块 {mod.moduleNumber || idx + 1}
                    {mod.moduleType && <Badge variant="outline" className="text-xs">{mod.moduleType}</Badge>}
                    {(mod.selectedModuleName || selectedModule?.name) && (
                      <Badge variant="secondary" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                        {mod.selectedModuleName || selectedModule?.name}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isConfirmed ? (
                    <>
                      <p className="text-sm"><strong>目的:</strong> {mod.purpose}</p>
                      <p className="text-sm"><strong>内容:</strong> {mod.contentBrief}</p>
                      <p className="text-sm"><strong>位置逻辑:</strong> {mod.position}</p>
                      {(mod.selectedModuleName || selectedModule) && (
                        <div className="rounded-lg border border-purple-100 bg-purple-50/60 p-3 text-xs text-purple-800">
                          <p className="font-semibold">A+模块样式：{mod.selectedModuleName || selectedModule?.name}</p>
                          <p className="mt-1">结构：{mod.selectedModuleStructure || selectedModule?.structure}</p>
                          <p className="mt-1">规格：{mod.selectedModuleSpecs || selectedModule?.specs}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Layers className="w-3.5 h-3.5 text-purple-500" />
                          <span className="text-xs font-medium text-purple-700">超级A+模块样式</span>
                        </div>
                        <Select value={selectedStyle} onValueChange={(val) => updateAPlusModuleStyle(idx, val)}>
                          <SelectTrigger className="h-8 text-xs bg-white">
                            <SelectValue placeholder="选择A+模块样式，后续构图/效果图将按此结构生成" />
                          </SelectTrigger>
                          <SelectContent>
                            {OUTLINE_APLUS_CATEGORIES.map((cat) => (
                              <div key={cat}>
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">{cat}</div>
                                {OUTLINE_APLUS_MODULES.filter((m) => m.category === cat).map((moduleOption) => (
                                  <SelectItem key={moduleOption.id} value={moduleOption.id}>
                                    <div className="flex flex-col">
                                      <span className="text-xs font-medium">{moduleOption.name}</span>
                                      <span className="text-[10px] text-muted-foreground">{moduleOption.desc} | {moduleOption.structure}</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </div>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedModule && (
                          <p className="mt-2 text-[10px] text-purple-600">
                            {selectedModule.name}: {selectedModule.specs}；{selectedModule.structure}
                          </p>
                        )}
                      </div>
                      <Input value={mod.moduleType || ""} onChange={(e) => updateAPlusModule(idx, "moduleType", e.target.value)} placeholder="模块类型" className="h-8 text-sm" />
                      <Input value={mod.purpose || ""} onChange={(e) => updateAPlusModule(idx, "purpose", e.target.value)} placeholder="模块目的" className="h-8 text-sm" />
                      <Textarea value={mod.contentBrief || ""} onChange={(e) => updateAPlusModule(idx, "contentBrief", e.target.value)} placeholder="内容简述" className="min-h-[50px] text-sm" />
                      <Input value={mod.position || ""} onChange={(e) => updateAPlusModule(idx, "position", e.target.value)} placeholder="位置逻辑" className="h-8 text-sm" />
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}

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
