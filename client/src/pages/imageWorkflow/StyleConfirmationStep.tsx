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
// ─── ASIN Set Picker Dialog ──────────────────────────────────────
// ─── KB Style Tag Picker Dialog ──────────────────────────────────
function KbStyleTagPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (styles: any[]) => void;
}) {
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
  const { data: tags, isLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: "designStyle" },
    { enabled: open }
  );

  const toggleTag = (value: string) => {
    setSelectedValues(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!tags) return;
    const selected = (tags as any[]).filter((t: any) => selectedValues.has(t.value));
    const styleOptions = selected.map((t: any, idx: number) => {
      let meta: any = {};
      try { meta = t.metadata ? JSON.parse(t.metadata) : {}; } catch {}
      return {
        id: 7000 + idx,
        name: t.value,
        description: meta.description || `知识库风格：${t.value}`,
        source: "kb_style_tag" as const,
        colorPalette: meta.colorPalette || null,
        typography: meta.typography || null,
        overallTone: meta.overallTone || t.value,
        whyRecommend: meta.whyRecommend || "来自知识库设计风格标签，手动选择",
        suitability: null,
        lightType: meta.lightType || null,
        colorTemp: meta.colorTemp || null,
        materialKeywords: meta.materialKeywords || null,
        colorTone: meta.colorTone || null,
        tabooElements: meta.tabooElements || null,
        refBrands: meta.refBrands || null,
        aiKeywords: meta.aiKeywords || null,
      };
    });
    onSelect(styleOptions);
    onOpenChange(false);
    setSelectedValues(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>从知识库选择设计风格</DialogTitle>
          <DialogDescription>选择已定义的设计风格作为参考方案</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 max-h-[55vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : !tags || (tags as any[]).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">知识库中暂无设计风格标签，请先在知识库标签管理中添加</div>
          ) : (
            <div className="space-y-2 p-1">
              {(tags as any[]).map((t: any) => {
                let meta: any = {};
                try { meta = t.metadata ? JSON.parse(t.metadata) : {}; } catch {}
                const isSelected = selectedValues.has(t.value);
                return (
                  <div
                    key={t.id}
                    className={`border rounded-lg p-3 cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary border-primary bg-primary/5" : "hover:border-primary/50"}`}
                    onClick={() => toggleTag(t.value)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{t.value}</p>
                          {isSelected && <Badge className="bg-primary text-primary-foreground text-xs">已选</Badge>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                          {meta.lightType && <span className="text-xs text-muted-foreground">💡 {meta.lightType}</span>}
                          {meta.colorTemp && <span className="text-xs text-muted-foreground">🌡 {meta.colorTemp}</span>}
                          {meta.materialKeywords && <span className="text-xs text-muted-foreground">🧱 {meta.materialKeywords}</span>}
                          {meta.refBrands && <span className="text-xs text-muted-foreground">🏷 {meta.refBrands}</span>}
                        </div>
                        {meta.aiKeywords && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">🔑 {meta.aiKeywords}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => { onOpenChange(false); setSelectedValues(new Set()); }}>取消</Button>
          <Button onClick={handleConfirm} disabled={selectedValues.size === 0}>
            确认选择 ({selectedValues.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── ASIN Set Picker Dialog ──────────────────────────────────────
function AsinSetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (styles: any[]) => void;
}) {
  const [selectedSetIds, setSelectedSetIds] = useState<Set<number>>(new Set());
  const { data: sets, isLoading } = trpc.kbImages.listSets.useQuery({ scope: "all" }, { enabled: open });

  const toggleSet = (id: number) => {
    setSelectedSetIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!sets) return;
    const selected = (sets as any[]).filter((s: any) => selectedSetIds.has(s.id));
    const styleOptions = selected.map((s: any, idx: number) => ({
      id: 9000 + idx,
      name: s.productTitle || s.asin || `ASIN集 ${s.id}`,
      description: `参考 ASIN: ${s.asin}${s.productTitle ? ` - ${s.productTitle}` : ""}`,
      source: "kb_asin" as const,
      asinSetId: s.id,
      asin: s.asin,
      thumbnailUrl: s.thumbnailImages?.[0]?.imageUrl || null,
      colorPalette: null,
      typography: null,
      overallTone: s.setStyle || "",
      whyRecommend: "来自知识库ASIN集，手动选择作为风格参考",
      suitability: null,
    }));
    onSelect(styleOptions);
    onOpenChange(false);
    setSelectedSetIds(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>从知识库ASIN集选择风格参考</DialogTitle>
          <DialogDescription>选择ASIN图片集作为风格参考（全部共享）</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 max-h-[55vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : !sets || (sets as any[]).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">知识库中暂无ASIN集，请先在知识库中导入ASIN图片</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-1">
              {(sets as any[]).map((s: any) => (
                <div
                  key={s.id}
                  className={`border rounded-lg p-3 cursor-pointer transition-all ${selectedSetIds.has(s.id) ? "ring-2 ring-primary border-primary bg-primary/5" : "hover:border-primary/50"}`}
                  onClick={() => toggleSet(s.id)}
                >
                  <div className="flex items-start gap-3">
                    {s.thumbnailImages?.[0]?.imageUrl ? (
                      <img src={s.thumbnailImages[0].imageUrl} alt={s.asin} className="w-16 h-16 object-cover rounded flex-shrink-0" />
                    ) : (
                      <div className="w-16 h-16 bg-muted rounded flex-shrink-0 flex items-center justify-center">
                        <ImageIcon className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{s.productTitle || s.asin}</p>
                      <p className="text-xs text-muted-foreground">ASIN: {s.asin}</p>
                      {s.overallScore != null && (
                        <p className="text-xs text-amber-600 font-medium mt-0.5">{s.overallScore}分</p>
                      )}
                      {s.setStyle && <Badge variant="secondary" className="text-xs mt-1">{s.setStyle}</Badge>}
                      <p className="text-xs text-muted-foreground mt-0.5">{s.thumbnailImages?.length || 0}+ 张图片</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => { onOpenChange(false); setSelectedSetIds(new Set()); }}>取消</Button>
          <Button onClick={handleConfirm} disabled={selectedSetIds.size === 0}>
            确认选择 ({selectedSetIds.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
  // Manual selection state
  const [kbStylePickerOpen, setKbStylePickerOpen] = useState(false);
  const [asinSetPickerOpen, setAsinSetPickerOpen] = useState(false);
  const [manualStyles, setManualStyles] = useState<any[]>([]);

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
      const selectedStyles = allStyleOptions.filter((s: any) => selectedIds.includes(s.id));
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

  // Handle manual KB style tag selection (from KbStyleTagPickerDialog)
  const handleKbStyleSelect = (styles: any[]) => {
    setManualStyles(prev => [...prev, ...styles]);
    toast.success(`已从知识库添加 ${styles.length} 个风格方案`);
  };

  // Handle ASIN set selection
  const handleAsinSetSelect = (styles: any[]) => {
    setManualStyles(prev => [...prev, ...styles]);
    toast.success(`已添加 ${styles.length} 个ASIN集风格参考`);
  };

  // Merge AI result styles with manual styles
  const allStyleOptions = [
    ...(aiResult?.styleOptions || []),
    ...manualStyles,
  ];

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
              {!isConfirmed && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setKbStylePickerOpen(true)}>
                    <BookOpen className="w-4 h-4 mr-1" /> 知识库风格
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAsinSetPickerOpen(true)}>
                    <Grid3X3 className="w-4 h-4 mr-1" /> ASIN集
                  </Button>
                </>
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

      {(allStyleOptions.length > 0) && !generateMutation.isPending && (
        <div className="space-y-4">
          {/* 模式提示横幅 */}
          {aiResult.mode === "kb" ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 border border-blue-200 text-sm text-blue-700">
              <span>📚</span>
              <span>已从<strong>知识库风格</strong>中匹配推荐，风格名称与知识库保持一致</span>
            </div>
          ) : aiResult.mode === "ai_creative" ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-700">
              <span>✨</span>
              <span><strong>AI创意推荐</strong>：知识库暂无该类目风格，已基于产品特性自由推荐。添加参考图片后可获得更精准的风格建议</span>
            </div>
          ) : null}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {allStyleOptions.map((style: any) => {
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
                      {style.source === "kb" && (
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">📚 知识库</Badge>
                      )}
                      {style.source === "ai_creative" && (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">✨ AI创意</Badge>
                      )}
                      {style.source === "kb_manual" && (
                        <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">📚 手动选择</Badge>
                      )}
                      {style.source === "kb_asin" && (
                        <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">🏷️ ASIN集</Badge>
                      )}
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
      {/* KB Style Tag Picker - for manual style selection from tag library */}
      <KbStyleTagPickerDialog
        open={kbStylePickerOpen}
        onOpenChange={setKbStylePickerOpen}
        onSelect={handleKbStyleSelect}
      />
      {/* ASIN Set Picker */}
      <AsinSetPickerDialog
        open={asinSetPickerOpen}
        onOpenChange={setAsinSetPickerOpen}
        onSelect={handleAsinSetSelect}
      />
    </div>
  );
}
