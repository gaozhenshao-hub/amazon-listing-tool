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

import { OUTLINE_APLUS_CATEGORIES, OUTLINE_APLUS_MODULES, findOutlineAplusModule, normalizeImageOutline } from "./aplusModules";
import { ImageStepGenerationStatus, useImageStepGenerationJob } from "./useImageStepGenerationJob";

export function Step2AplusSubmoduleEditor({
  submodule,
  onChange,
}: {
  submodule: any;
  onChange: (field: string, value: string) => void;
}) {
  const isLocked = Boolean(submodule?.isLocked);
  return (
    <>
      <Input disabled={isLocked} value={submodule.title || ""} onChange={(e) => onChange("title", e.target.value)} placeholder="子图标题" className="h-8 text-xs" />
      <Input disabled={isLocked} value={submodule.purpose || ""} onChange={(e) => onChange("purpose", e.target.value)} placeholder="子图目的" className="h-8 text-xs" />
      <Textarea disabled={isLocked} value={submodule.contentBrief || ""} onChange={(e) => onChange("contentBrief", e.target.value)} placeholder="子图独立大纲" className="min-h-[56px] text-xs" />
      <Input disabled={isLocked} value={submodule.expressionType || ""} onChange={(e) => onChange("expressionType", e.target.value)} placeholder="表达方式" className="h-8 text-xs" />
      <Input disabled={isLocked} value={submodule.whyThisWay || ""} onChange={(e) => onChange("whyThisWay", e.target.value)} placeholder="安排理由" className="h-8 text-xs" />
    </>
  );
}

export function Step2ImageOutline({
  projectId,
  session,
  onConfirm,
  canEdit = true,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
  canEdit?: boolean;
}) {
  const confirmMutation = trpc.imageWorkflow.confirmStep2.useMutation();
  const unlockMutation = trpc.imageWorkflow.unlockStep2.useMutation();
  const optimizeAplusMutation = trpc.imageWorkflow.optimizeStep2AplusModule.useMutation();
  const lockAplusSubmoduleMutation = trpc.imageWorkflow.lockStep2AplusSubmodule.useMutation();
  const saveDraftMutation = trpc.imageWorkflow.saveStep2Draft.useMutation();
  const utils = trpc.useUtils();
  const [editData, setEditData] = useState<any>(null);
  const [isLockedState, setIsLocked] = useState(!!session?.step2Confirmed);
  const isLocked = isLockedState || !canEdit;
  const [optimizingModuleIndex, setOptimizingModuleIndex] = useState<number | null>(null);
  const [lockingSubmoduleKey, setLockingSubmoduleKey] = useState<string | null>(null);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<number | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationJob = useImageStepGenerationJob({
    projectId,
    step: 2,
    onSucceeded: (result) => setEditData(normalizeImageOutline(result, {
      forceDefaultAplus: true,
      recoverMissingSecondaryContent: true,
    })),
  });

  useEffect(() => {
    if (session?.step2UserEdit) {
      try { setEditData(normalizeImageOutline(JSON.parse(session.step2UserEdit))); } catch {}
    } else if (session?.step2AiResult) {
      try {
        setEditData(normalizeImageOutline(JSON.parse(session.step2AiResult), {
          forceDefaultAplus: true,
          recoverMissingSecondaryContent: true,
        }));
      } catch {}
    }
    setIsLocked(!!session?.step2Confirmed);
  }, [session?.step2AiResult, session?.step2UserEdit, session?.step2Confirmed]);

  useEffect(() => () => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
  }, []);

  const scheduleDraftSave = (draft: any) => {
    if (isLocked) return;
    const normalizedDraft = normalizeImageOutline(draft);
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      setIsDraftSaving(true);
      void saveDraftMutation.mutateAsync({
        projectId,
        userEdit: JSON.stringify(normalizedDraft),
      }).then(() => {
        setLastDraftSavedAt(Date.now());
      }).catch((error: any) => {
        toast.error(error?.message || "图片大纲草稿自动保存失败");
      }).finally(() => {
        setIsDraftSaving(false);
      });
    }, 450);
  };

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
    await generationJob.start();
  };

  const handleConfirm = async () => {
    if (!editData) return;
    try {
      const normalizedData = normalizeImageOutline(editData);
      const incompleteImage = normalizedData.secondaryImages.find((image: any) =>
        !String(image?.purpose || "").trim() || !String(image?.contentBrief || "").trim(),
      );
      if (incompleteImage) {
        toast.error(`请补全辅图${incompleteImage.imageNumber}的目的和内容后再确认`);
        return;
      }
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

  const updateAPlusSubmoduleRemark = (idx: number, remark: string) => {
    if (!editData) return;
    const newData = { ...editData, aPlusModules: [...(editData.aPlusModules || [])] };
    const count = remark.match(/(?:^|\s)(\d{1,2})\s*(?:种|个|张|组|项|场景|步骤|面板)/)?.[1];
    newData.aPlusModules[idx] = {
      ...newData.aPlusModules[idx],
      subModuleRemark: remark,
      ...(count ? { subModuleCount: Number(count) } : {}),
    };
    const normalized = normalizeImageOutline(newData);
    const topics = remark.replace(/^\s*\d{1,2}\s*(?:种|个|张|组|项)?\s*(?:场景|步骤|面板)?\s*[:：]?\s*/, "")
      .split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean);
    if (topics.length && normalized.aPlusModules?.[idx]?.subModules) {
      normalized.aPlusModules[idx].subModules = normalized.aPlusModules[idx].subModules.map((submodule: any, submoduleIndex: number) => {
        const topic = topics[submoduleIndex];
        return topic ? {
          ...submodule,
          title: topic,
          purpose: `围绕“${topic}”展开的独立A+子图`,
          contentBrief: submodule.contentBrief || `展示产品在“${topic}”中的核心价值、使用方式或结果。`,
        } : submodule;
      });
    }
    setEditData(normalized);
    scheduleDraftSave(normalized);
  };

  const updateAPlusSubmodule = (moduleIndex: number, submoduleIndex: number, field: string, value: any) => {
    if (!editData) return;
    const newData = { ...editData, aPlusModules: [...(editData.aPlusModules || [])] };
    const module = { ...newData.aPlusModules[moduleIndex] };
    const subModules = [...(module.subModules || [])];
    if (subModules[submoduleIndex]?.isLocked) return;
    subModules[submoduleIndex] = { ...subModules[submoduleIndex], [field]: value };
    module.subModules = subModules;
    newData.aPlusModules[moduleIndex] = module;
    const normalized = normalizeImageOutline(newData);
    setEditData(normalized);
    scheduleDraftSave(normalized);
  };

  const lockAplusSubmodule = async (moduleIndex: number, submoduleIndex: number) => {
    const key = `${moduleIndex}-${submoduleIndex}`;
    setLockingSubmoduleKey(key);
    try {
      const result = await lockAplusSubmoduleMutation.mutateAsync({ projectId, moduleIndex, submoduleIndex });
      setEditData(normalizeImageOutline(result.outline));
      toast.success("子图已锁定并发布独立资产版本");
    } catch (err: any) {
      toast.error(err.message || "子图锁定失败");
    } finally {
      setLockingSubmoduleKey(null);
    }
  };

  const updateAPlusModuleStyle = async (idx: number, moduleType: string) => {
    const selected = OUTLINE_APLUS_MODULES.find((m) => m.id === moduleType);
    if (!selected || !editData) return;
    if (editData.aPlusModules?.[idx]?.selectedModuleType === selected.id) return;

    setOptimizingModuleIndex(idx);
    try {
      const result = await optimizeAplusMutation.mutateAsync({
        projectId,
        moduleIndex: idx,
        moduleType: selected.id,
      });
      setEditData(normalizeImageOutline(result.outline));
      toast.success(`已按“${selected.name}”重新优化此A+模块`);
    } catch (err: any) {
      toast.error(err.message || "A+模块重新优化失败");
    } finally {
      setOptimizingModuleIndex(null);
    }
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
              {canEdit && !editData && (
                <Button onClick={handleGenerate} disabled={generationJob.isGenerating}>
                  {generationJob.isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  AI生成大纲
                </Button>
              )}
              {editData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generationJob.isGenerating}>
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
                  {canEdit && <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={unlockMutation.isPending}>
                    {unlockMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                    解锁编辑
                  </Button>}
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
                  {img.contractRecovered && (
                    <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-700">
                      系统补全，请复核
                    </Badge>
                  )}
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
                      {Array.isArray(mod.subModules) && mod.subModules.length > 0 && (
                        <div className="space-y-3 rounded-lg border border-purple-200 bg-purple-50/30 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-purple-800">逐图子模块大纲</p>
                            <Badge variant="outline" className="text-[10px]">{mod.subModules.length} 张子图</Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground">锁定版本：后续参考图、构图效果与图片建议均按每张子图独立处理。</p>
                          {mod.subModules.map((submodule: any, submoduleIndex: number) => (
                            <div key={submoduleIndex} className="space-y-1.5 rounded-md border bg-background p-2.5 text-sm">
                              <p className="text-xs font-medium">A+ 模块 {mod.moduleNumber || idx + 1}.{submodule.subModuleNumber || submoduleIndex + 1}</p>
                              <p><strong>标题:</strong> {submodule.title || "—"}</p>
                              <p><strong>目的:</strong> {submodule.purpose || "—"}</p>
                              <p><strong>内容:</strong> {submodule.contentBrief || "—"}</p>
                              {submodule.expressionType && <p><strong>表达方式:</strong> {submodule.expressionType}</p>}
                              {submodule.whyThisWay && <p className="text-muted-foreground"><strong>理由:</strong> {submodule.whyThisWay}</p>}
                            </div>
                          ))}
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
                        <Select
                          value={selectedStyle}
                          onValueChange={(val) => void updateAPlusModuleStyle(idx, val)}
                          disabled={optimizeAplusMutation.isPending}
                        >
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
                        {optimizingModuleIndex === idx && (
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-purple-700">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            皇帝 Skill 正在按新模块结构重新优化...
                          </div>
                        )}
                      </div>
                      <Input value={mod.moduleType || ""} onChange={(e) => updateAPlusModule(idx, "moduleType", e.target.value)} placeholder="模块类型" className="h-8 text-sm" />
                      <Input value={mod.purpose || ""} onChange={(e) => updateAPlusModule(idx, "purpose", e.target.value)} placeholder="模块目的" className="h-8 text-sm" />
                      <Textarea value={mod.contentBrief || ""} onChange={(e) => updateAPlusModule(idx, "contentBrief", e.target.value)} placeholder="内容简述" className="min-h-[50px] text-sm" />
                      <Input value={mod.position || ""} onChange={(e) => updateAPlusModule(idx, "position", e.target.value)} placeholder="位置逻辑" className="h-8 text-sm" />
                      {Array.isArray(mod.subModules) && mod.subModules.length > 0 && (
                        <div className="rounded-md border border-dashed border-purple-200 bg-purple-50/40 p-2.5">
                          <p className="text-xs font-medium text-purple-900">子图备注 / 拆分说明</p>
                          <Textarea value={mod.subModuleRemark || ""} onChange={(e) => updateAPlusSubmoduleRemark(idx, e.target.value)} placeholder="例如：4种场景：车库、庭院、露营、工地" className="mt-1 min-h-[54px] text-sm" />
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-[10px] text-purple-900">预期子图数量</span>
                            <Input type="number" min={2} max={15} value={mod.subModuleCount || mod.subModules.length} onChange={(e) => {
                              const newData = { ...editData, aPlusModules: [...(editData.aPlusModules || [])] };
                              newData.aPlusModules[idx] = { ...newData.aPlusModules[idx], subModuleCount: Number(e.target.value || 0) };
                              const normalized = normalizeImageOutline(newData);
                              setEditData(normalized);
                              scheduleDraftSave(normalized);
                            }} className="h-7 w-20 text-xs" />
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">备注中的数量优先；也可直接调整数量。冒号后列出每张图主题，后续参考图和图片建议会逐图继承。</p>
                          <p className="mt-1 text-[10px] text-purple-700">
                            {isDraftSaving ? "正在自动保存草稿…" : lastDraftSavedAt ? "草稿已自动保存" : "编辑后将自动保存草稿"}
                          </p>
                        </div>
                      )}
                      {Array.isArray(mod.subModules) && mod.subModules.length > 0 && (
                        <div className="space-y-3 rounded-lg border border-purple-200 bg-purple-50/30 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-purple-800">逐图子模块大纲</p>
                            <Badge variant="outline" className="text-[10px]">{mod.subModules.length} 张子图</Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground">后续参考图、构图效果与图片建议会按每张子图分别生成和确认。</p>
                          {mod.subModules.map((submodule: any, submoduleIndex: number) => (
                            <div key={submoduleIndex} className="space-y-2 rounded-md border bg-background p-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-medium">A+ 模块 {mod.moduleNumber || idx + 1}.{submodule.subModuleNumber || submoduleIndex + 1}</p>
                                {submodule.isLocked ? (
                                  <Badge variant="outline" className="text-[10px] border-green-300 bg-green-50 text-green-700"><Lock className="mr-1 h-3 w-3" />已锁定资产</Badge>
                                ) : (
                                  <Button type="button" size="sm" variant="outline" className="h-6 text-[10px]" disabled={lockingSubmoduleKey === `${idx}-${submoduleIndex}`} onClick={() => void lockAplusSubmodule(idx, submoduleIndex)}>
                                    {lockingSubmoduleKey === `${idx}-${submoduleIndex}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Lock className="mr-1 h-3 w-3" />}锁定子图
                                  </Button>
                                )}
                              </div>
                              <Step2AplusSubmoduleEditor
                                submodule={submodule}
                                onChange={(field, value) => updateAPlusSubmodule(idx, submoduleIndex, field, value)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
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
