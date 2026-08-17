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

import { KbImagePickerDialog } from "./KnowledgeImagePickerDialog";
import { ReferenceImagesHeader } from "./ReferenceImagesHeader";
import { normalizeStep4References } from "@shared/imageWorkflow";

const isActiveStep4Run = (status?: string | null) => status === "queued" || status === "running";

function formatStep4Error(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "参考图推荐失败");
  if (/<!doctype\s+html|<html[\s>]/i.test(message)) {
    return "参考图推荐被服务器网关中断，请重新提交；后台任务不会因切换页面而丢失";
  }
  return message.length > 300 ? `${message.slice(0, 300)}...` : message;
}

// ═══════════════════════════════════════════════════════════════════
// ─── Step 4: Reference Images (含知识库图片选择) ─────────────────
// ═══════════════════════════════════════════════════════════════════
export function Step4References({
  projectId,
  session,
  onConfirm: _onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const generateMutation = trpc.imageWorkflow.startStep4Generation.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep4.useMutation();
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();
  const uploadRefMutation = trpc.imageWorkflow.uploadStep4RefImage.useMutation();
  const saveDraftMutation = trpc.imageWorkflow.saveStep4Draft.useMutation();
  const confirmImageVersionMutation = trpc.imageWorkflow.confirmStep4ImageVersion.useMutation();
  const unlockImageVersionMutation = trpc.imageWorkflow.unlockStep4ImageVersion.useMutation();
  const unlockMutation = trpc.imageWorkflow.unlockStep4ForEditing.useMutation();
  const reoptimizeMutation = trpc.imageWorkflow.reoptimizeStep4WithRefs.useMutation();
  const regenerateAllMutation = trpc.imageWorkflow.regenerateAllFromReferences.useMutation();
  const regenerateSingleMutation = trpc.imageWorkflow.regenerateSingleImageFromRef.useMutation();
  const [regeneratingSingleIdx, setRegeneratingSingleIdx] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [isLocked, setIsLocked] = useState(!!session?.step4Confirmed);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [kbPickerTargetIdx, setKbPickerTargetIdx] = useState<number | null>(null);
  const [kbPickerTargetType, setKbPickerTargetType] = useState<string>("");
  const [uploadingRef, setUploadingRef] = useState<{idx: number; type: 'composition'|'effect'} | null>(null);
  const [reoptimizingIdx, setReoptimizingIdx] = useState<number | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const handledRunIdsRef = useRef<Set<string>>(new Set());
  const utils = trpc.useUtils();
  const step4RunQuery = trpc.imageWorkflow.getStep4Run.useQuery(
    { projectId },
    {
      refetchInterval: (query) => isActiveStep4Run((query.state.data as any)?.status) ? 2_000 : false,
    },
  );
  const step4Run = step4RunQuery.data as any;
  const isGenerating = generateMutation.isPending || isActiveStep4Run(step4Run?.status);
  const generationProgress = Number(step4Run?.progress || (generateMutation.isPending ? 5 : 0));

  useEffect(() => {
    if (session?.step4UserEdit) {
      try { setEditData(normalizeStep4References(JSON.parse(session.step4UserEdit))); } catch {}
    } else if (session?.step4AiResult) {
      try { setEditData(normalizeStep4References(JSON.parse(session.step4AiResult))); } catch {}
    }
    setIsLocked(!!session?.step4Confirmed);
  }, [session?.step4AiResult, session?.step4UserEdit, session?.step4Confirmed]);

  useEffect(() => {
    const run = step4RunQuery.data as any;
    if (!run?.runId) return;
    if (isActiveStep4Run(run.status)) {
      setActiveRunId((current) => current || run.runId);
      return;
    }

    const terminalKey = `${run.runId}:${run.status}`;
    if (handledRunIdsRef.current.has(terminalKey)) return;
    handledRunIdsRef.current.add(terminalKey);
    const wasActive = activeRunId === run.runId;
    setActiveRunId(null);

    if (run.status === "succeeded" && run.output?.imageReferences) {
      setEditData(normalizeStep4References(run.output));
      void utils.imageWorkflow.getSession.invalidate({ projectId });
      if (wasActive) toast.success("参考图推荐完成");
    } else if (run.status === "failed") {
      if (wasActive || !editData) toast.error(formatStep4Error(run.error));
    } else if (run.status === "canceled" && wasActive) {
      toast.info("参考图推荐任务已取消");
    }
  }, [activeRunId, editData, projectId, step4RunQuery.data, utils.imageWorkflow.getSession]);

  const handleUnlock = async () => {
    try {
      // 后台以最新成功的Step4任务为方案基准，并从已保存草稿合并本地参考图和备注。
      // 不再回传锁定视图中的完整快照，避免历史数据或过大请求阻断解锁。
      const result = await unlockMutation.mutateAsync({ projectId });
      setEditData(normalizeStep4References(JSON.parse(result.userEdit)));
      setIsLocked(false);
      await utils.imageWorkflow.getSession.invalidate({ projectId });
      toast.success("已解锁，已保留当前方案与参考图");
    } catch (err: any) {
      toast.error(err.message || "解锁失败");
    }
  };

  const persistStep4Draft = async (nextData: any) => {
    await saveDraftMutation.mutateAsync({
      projectId,
      userEdit: JSON.stringify(nextData),
    });
  };

  const handleLockSingle = async (idx: number) => {
    if (!editData?.imageReferences?.[idx]) return;
    const newData = { ...editData, imageReferences: [...editData.imageReferences] };
    const currentRef = { ...newData.imageReferences[idx] };
    newData.imageReferences[idx] = {
      ...currentRef,
      isLocked: true,
      lockedAt: new Date().toISOString(),
      lockedSnapshot: { ...currentRef, isLocked: undefined, lockedSnapshot: undefined },
    };
    await confirmImageVersionMutation.mutateAsync({ projectId, imageIndex: idx, content: JSON.stringify(newData.imageReferences[idx].lockedSnapshot) });
    setEditData(newData);
    await persistStep4Draft(newData);
    toast.success(`已确认并锁定第${idx + 1}张图`);
  };

  const handleUnlockSingle = async (idx: number) => {
    if (!editData?.imageReferences?.[idx]) return;
    const newData = { ...editData, imageReferences: [...editData.imageReferences] };
    const currentRef = newData.imageReferences[idx];
    await unlockImageVersionMutation.mutateAsync({ projectId, imageIndex: idx });
    newData.imageReferences[idx] = {
      ...(currentRef.lockedSnapshot || currentRef),
      isLocked: false,
      lockedAt: undefined,
      lockedSnapshot: currentRef.lockedSnapshot,
    };
    setEditData(newData);
    await persistStep4Draft(newData);
    toast.success(`第${idx + 1}张图已解锁，可继续编辑或重新生成`);
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
          await persistStep4Draft(newData);
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
    if (editData.imageReferences?.[idx]?.isLocked) {
      toast.error("请先解锁此图，再重新优化");
      return;
    }
    setReoptimizingIdx(idx);
    try {
      const ref = editData.imageReferences[idx];
      const result = await reoptimizeMutation.mutateAsync({
        projectId,
        imageKey: `step4-ref-${idx}`,
        compositionRefUrl: ref.compositionRefImageUrl || '',
        effectRefUrl: ref.effectRefImageUrl || '',
        compositionRefNote: ref.compositionRefNote || undefined,
        effectRefNote: ref.effectRefNote || undefined,
      });
      // Merge the re-optimized result into editData
      const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
      // Preserve client-side fields (uploaded ref images, KB selections) that AI doesn't return
      const preserved = {
        compositionRefImageUrl: ref.compositionRefImageUrl,
        effectRefImageUrl: ref.effectRefImageUrl,
        compositionRefNote: ref.compositionRefNote,
        effectRefNote: ref.effectRefNote,
        kbReferenceImages: ref.kbReferenceImages,
        imageNumber: ref.imageNumber,
        imageType: ref.imageType,
        purpose: ref.purpose,
      };
      newData.imageReferences[idx] = { ...newData.imageReferences[idx], ...result, ...preserved };
      setEditData(newData);
      await persistStep4Draft(newData);
      toast.success("已根据参考图重新优化");
    } catch (err: any) {
      toast.error(err.message || "优化失败");
    } finally {
      setReoptimizingIdx(null);
    }
  };

  const handleGenerate = async () => {
    try {
      const job = await generateMutation.mutateAsync({ projectId });
      setActiveRunId(job.runId);
      await Promise.all([
        step4RunQuery.refetch(),
        utils.imageWorkflow.getSession.invalidate({ projectId }),
      ]);
      toast.success(job.status === "running" ? "参考图推荐正在后台执行" : "参考图推荐已进入后台队列");
    } catch (err: any) {
      toast.error(formatStep4Error(err));
    }
  };

  const handleConfirm = async () => {
    if (!editData) return;
    const unlockedRefs = (editData.imageReferences || []).filter((ref: any) => !ref?.isLocked || !ref?.lockedSnapshot);
    if (unlockedRefs.length > 0) {
      toast.error(`请先逐图点击“确认此图”。尚有 ${unlockedRefs.length} 张图片未确认`);
      return;
    }
    try {
      await confirmMutation.mutateAsync({ projectId, userEdit: JSON.stringify(editData) });
      setIsLocked(true);
      await utils.imageWorkflow.getSession.invalidate({ projectId });
      toast.success("参考图已确认");
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  const isConfirmed = isLocked;

  const updateRef = (idx: number, section: string, field: string, value: any) => {
    if (!editData) return;
    if (editData.imageReferences?.[idx]?.isLocked) return;
    const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
    newData.imageReferences[idx] = {
      ...newData.imageReferences[idx],
      [section]: { ...newData.imageReferences[idx][section], [field]: value },
    };
    setEditData(newData);
  };

  const updateLocalReferenceNote = (idx: number, field: "compositionRefNote" | "effectRefNote", value: string) => {
    if (!editData || editData.imageReferences?.[idx]?.isLocked) return;
    const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
    newData.imageReferences[idx] = { ...newData.imageReferences[idx], [field]: value };
    setEditData(newData);
  };

  // Open KB picker for a specific image reference
  const openKbPicker = (idx: number, imageType: string) => {
    setKbPickerTargetIdx(idx);
    setKbPickerTargetType(imageType);
    setKbPickerOpen(true);
  };

  // Handle KB image selection - attach selected images to the reference
  const handleKbImageSelect = async (images: Array<{ id: number; imageUrl: string; imagePosition: string; tagCategory: string; tagImageType: string; tagDesignStyle: string; tagColorScheme: string }>) => {
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
    await persistStep4Draft(newData);
    toast.success(`已添加 ${images.length} 张知识库参考图`);
  };

  // Regenerate ALL image references from all KB images + notes
  const handleRegenerateAll = async () => {
    if (!editData) return;
    // Collect all KB reference images with notes across all refs
    const allKbImages: Array<{ url: string; note?: string; position?: string }> = [];
    (editData.imageReferences || []).forEach((ref: any) => {
      (ref.kbReferenceImages || []).forEach((kbImg: any) => {
        allKbImages.push({
          url: kbImg.imageUrl,
          note: kbImg.note || undefined,
          position: kbImg.position || undefined,
        });
      });
    });
    if (allKbImages.length === 0) {
      toast.error("请先为至少一张图添加知识库参考图");
      return;
    }
    // Collect composition/effect ref URLs (from first ref that has them)
    let compositionRefUrl: string | undefined;
    let effectRefUrl: string | undefined;
    let compositionRefNote: string | undefined;
    let effectRefNote: string | undefined;
    for (const ref of (editData.imageReferences || [])) {
      if (!compositionRefUrl && ref.compositionRefImageUrl) {
        compositionRefUrl = ref.compositionRefImageUrl;
        compositionRefNote = ref.compositionRefNote || undefined;
      }
      if (!effectRefUrl && ref.effectRefImageUrl) {
        effectRefUrl = ref.effectRefImageUrl;
        effectRefNote = ref.effectRefNote || undefined;
      }
    }
    try {
      const result = await regenerateAllMutation.mutateAsync({
        projectId,
        kbImages: allKbImages,
        compositionRefUrl,
        effectRefUrl,
        compositionRefNote,
        effectRefNote,
      });
      const existingRefs = editData.imageReferences || [];
      const mergedResult = {
        ...editData,
        ...result,
        imageReferences: (result.imageReferences || []).map((generatedRef: any, imageIndex: number) => {
          const existingRef = existingRefs[imageIndex] || {};
          return {
            ...existingRef,
            ...generatedRef,
            compositionRefImageUrl: existingRef.compositionRefImageUrl,
            effectRefImageUrl: existingRef.effectRefImageUrl,
            compositionRefNote: existingRef.compositionRefNote,
            effectRefNote: existingRef.effectRefNote,
            kbReferenceImages: existingRef.kbReferenceImages,
            imageNumber: existingRef.imageNumber ?? generatedRef.imageNumber,
            imageType: existingRef.imageType ?? generatedRef.imageType,
            purpose: existingRef.purpose ?? generatedRef.purpose,
          };
        }),
      };
      setEditData(mergedResult);
      await persistStep4Draft(mergedResult);
      toast.success("已根据参考图和备注重新生成方案");
    } catch (err: any) {
      toast.error(err.message || "重新生成失败");
    }
  };

  // Regenerate a single image from its reference images
  const handleRegenerateSingle = async (idx: number) => {
    if (!editData) return;
    const ref = editData.imageReferences?.[idx];
    if (!ref) return;
    if (ref.isLocked) {
      toast.error("请先解锁此图，再单独重新生成");
      return;
    }
    const kbImages: Array<{ url: string; note?: string; position?: string }> = (ref.kbReferenceImages || []).map((kbImg: any) => ({
      url: kbImg.imageUrl,
      note: kbImg.note || undefined,
      position: kbImg.position || undefined,
    }));
    if (kbImages.length === 0) {
      toast.error("请先为这张图添加知识库参考图");
      return;
    }
    setRegeneratingSingleIdx(idx);
    try {
      const result = await regenerateSingleMutation.mutateAsync({
        projectId,
        imageIndex: idx,
        kbImages,
        compositionRefUrl: ref.compositionRefImageUrl || undefined,
        effectRefUrl: ref.effectRefImageUrl || undefined,
        compositionRefNote: ref.compositionRefNote || undefined,
        effectRefNote: ref.effectRefNote || undefined,
      });
      // Merge only the regenerated single image's AI fields into current editData,
      // preserving all other images' client-side state (kbReferenceImages, ref URLs, etc.)
      const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
      const newRef = result.newImageRef || {};
      // Preserve client-side fields for the regenerated image too
      newData.imageReferences[idx] = {
        ...newData.imageReferences[idx],
        ...newRef,
        compositionRefImageUrl: ref.compositionRefImageUrl,
        effectRefImageUrl: ref.effectRefImageUrl,
        compositionRefNote: ref.compositionRefNote,
        effectRefNote: ref.effectRefNote,
        kbReferenceImages: ref.kbReferenceImages,
        imageNumber: ref.imageNumber ?? newRef.imageNumber,
        imageType: ref.imageType ?? newRef.imageType,
        purpose: ref.purpose ?? newRef.purpose,
      };
      setEditData(newData);
      await persistStep4Draft(newData);
      toast.success(`第${idx + 1}张图已根据参考图重新生成`);
    } catch (err: any) {
      toast.error(err.message || "重新生成失败");
    } finally {
      setRegeneratingSingleIdx(null);
    }
  };

  // Remove a KB reference image
  const removeKbImage = async (refIdx: number, imgIdx: number) => {
    if (!editData) return;
    const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
    const ref = { ...newData.imageReferences[refIdx] };
    const imgs = [...(ref.kbReferenceImages || [])];
    imgs.splice(imgIdx, 1);
    ref.kbReferenceImages = imgs;
    newData.imageReferences[refIdx] = ref;
    setEditData(newData);
    await persistStep4Draft(newData);
  };

  return (
    <div className="space-y-4">
      <ReferenceImagesHeader
        hasData={!!editData}
        isConfirmed={isConfirmed}
        isGenerating={isGenerating}
        generationProgress={generationProgress}
        isRegeneratingAll={regenerateAllMutation.isPending}
        isConfirming={confirmMutation.isPending}
        isResetting={resetMutation.isPending}
        onGenerate={handleGenerate}
        onRegenerateAll={handleRegenerateAll}
        onConfirm={handleConfirm}
        onUnlock={handleUnlock}
      />

      {editData?.imageReferences && !isGenerating && editData.imageReferences.map((ref: any, idx: number) => {
        const isImageLocked = Boolean(ref.isLocked);
        return (
        <Card key={idx} className={isImageLocked ? "border-emerald-300 bg-emerald-50/20" : ""}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {ref.imageType === "主图" ? <Camera className="w-4 h-4 text-primary" /> : ref.imageType?.includes("A+") ? <Layers className="w-4 h-4 text-purple-500" /> : <Image className="w-4 h-4 text-blue-500" />}
                {ref.imageType} {ref.imageNumber > 0 ? `#${ref.imageNumber}` : ""}
                <span className="text-xs text-muted-foreground font-normal">— {ref.purpose}</span>
              </CardTitle>
              {!isConfirmed && (
                <div className="flex gap-1.5">
                  {!isImageLocked && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openKbPicker(idx, ref.imageType)}>
                    <BookOpen className="w-3.5 h-3.5 mr-1" /> 从知识库选图
                  </Button>}
                  {!isImageLocked && (ref.kbReferenceImages?.length > 0 || ref.compositionRefImageUrl || ref.effectRefImageUrl) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => handleRegenerateSingle(idx)}
                      disabled={regeneratingSingleIdx === idx}
                      title="根据此图的参考图单独重新生成方案"
                    >
                      {regeneratingSingleIdx === idx ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                      {regeneratingSingleIdx === idx ? "AI 分析中..." : "单独重新生成"}
                    </Button>
                  )}
                  <Button
                    variant={isImageLocked ? "outline" : "default"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => isImageLocked ? handleUnlockSingle(idx) : handleLockSingle(idx)}
                  >
                    {isImageLocked ? <Unlock className="w-3.5 h-3.5 mr-1" /> : <Lock className="w-3.5 h-3.5 mr-1" />}
                    {isImageLocked ? "解锁此图" : "确认此图"}
                  </Button>
                </div>
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
                    <div key={imgIdx} className="flex gap-2 items-start border rounded-lg p-2 bg-white">
                      <div className="relative shrink-0">
                        <div className="w-16 h-16 rounded-lg overflow-hidden border border-emerald-200">
                          <img src={kbImg.imageUrl} alt={`KB ref ${imgIdx}`} className="w-full h-full object-cover" />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 rounded-b-lg">
                          <span className="text-[8px] text-white">
                            {kbImg.position === "主图" || kbImg.position === "main" ? "主图" : kbImg.position === "辅图" || kbImg.position === "secondary" ? "辅图" : "A+"}
                          </span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-emerald-700 font-medium">参考图 {imgIdx + 1}</span>
                          {!isConfirmed && !isImageLocked && (
                            <button
                              className="w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                              onClick={() => removeKbImage(idx, imgIdx)}
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                        {!isConfirmed && !isImageLocked ? (
                          <Input
                            value={kbImg.note || ""}
                            onChange={(e) => {
                              const newData = { ...editData, imageReferences: [...(editData.imageReferences || [])] };
                              const ref2 = { ...newData.imageReferences[idx] };
                              const imgs2 = [...(ref2.kbReferenceImages || [])];
                              imgs2[imgIdx] = { ...imgs2[imgIdx], note: e.target.value };
                              ref2.kbReferenceImages = imgs2;
                              newData.imageReferences[idx] = ref2;
                              setEditData(newData);
                            }}
                            placeholder="备注：参考哪个方面（如：构图方式、配色风格）"
                            className="h-6 text-xs"
                          />
                        ) : (
                          kbImg.note && <p className="text-xs text-muted-foreground">{kbImg.note}</p>
                        )}
                      </div>
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
                    {!isConfirmed && !isImageLocked && (
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
                {ref.compositionRefImageUrl && (
                  !isConfirmed && !isImageLocked ? (
                    <Textarea
                      value={ref.compositionRefNote || ""}
                      onChange={(e) => updateLocalReferenceNote(idx, "compositionRefNote", e.target.value)}
                      onBlur={() => void persistStep4Draft(editData)}
                      placeholder="备注构图要参考的部分，例如：保留左右分栏和大标题位置"
                      className="mt-2 min-h-[54px] text-xs bg-white/90"
                    />
                  ) : ref.compositionRefNote ? <p className="mt-2 text-xs text-muted-foreground">备注：{ref.compositionRefNote}</p> : null
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
                    {!isConfirmed && !isImageLocked && (
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
                {ref.effectRefImageUrl && (
                  !isConfirmed && !isImageLocked ? (
                    <Textarea
                      value={ref.effectRefNote || ""}
                      onChange={(e) => updateLocalReferenceNote(idx, "effectRefNote", e.target.value)}
                      onBlur={() => void persistStep4Draft(editData)}
                      placeholder="备注效果要参考的部分，例如：沿用冷色光影和金属高光"
                      className="mt-2 min-h-[54px] text-xs bg-white/90"
                    />
                  ) : ref.effectRefNote ? <p className="mt-2 text-xs text-muted-foreground">备注：{ref.effectRefNote}</p> : null
                )}
              </div>
            </div>

            {/* AI Re-optimize button when both ref images are uploaded */}
            {(ref.compositionRefImageUrl || ref.effectRefImageUrl) && !isConfirmed && !isImageLocked && (
              <div className="mb-4 flex flex-col items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleReoptimize(idx)}
                  disabled={reoptimizingIdx !== null}
                  className="text-xs"
                >
                  {reoptimizingIdx === idx ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                  {reoptimizingIdx === idx ? "AI 正在分析参考图与备注..." : "根据参考图和备注重新优化构图和效果方案"}
                </Button>
                {reoptimizingIdx === idx && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
                    <Loader2 className="w-3 h-3 animate-spin text-amber-500 shrink-0" />
                    <span>Claude 正在深度分析参考图的构图与效果特征，预计需要 30-60 秒，请耐心等待...</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Composition Reference */}
              <div className="border rounded-lg p-3 bg-blue-50/30">
                <h4 className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-1">
                  <Layout className="w-3.5 h-3.5" /> 构图方案
                </h4>
                {isConfirmed || isImageLocked ? (
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
                {isConfirmed || isImageLocked ? (
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
        );
      })}

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
