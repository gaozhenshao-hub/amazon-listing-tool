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

// ═══════════════════════════════════════════════════════════════════
// ─── Step 3: Style Confirmation ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
export function Step3StyleConfirm({
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
      console.log('[Step3 FE] result:', typeof result, result ? Object.keys(result) : 'null', 'styleOptions:', result?.styleOptions?.length);
      setAiResult(result);
      setSelectedIds([]);
      toast.success("风格方案推荐完成");
    } catch (err: any) {
      console.error('[Step3 FE] error:', err);
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
