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

// 亮点标签预设类型
const HIGHLIGHT_CATEGORIES = [
  { key: "scene", label: "场景", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { key: "color", label: "配色", color: "bg-pink-100 text-pink-700 border-pink-200" },
  { key: "composition", label: "构图", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { key: "expression", label: "表达方式", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { key: "typography", label: "字体文案", color: "bg-teal-100 text-teal-700 border-teal-200" },
  { key: "other", label: "其他", color: "bg-gray-100 text-gray-700 border-gray-200" },
];

function HighlightTag({ text, category, removable, onRemove }: { text: string; category: string; removable?: boolean; onRemove?: () => void }) {
  const cat = HIGHLIGHT_CATEGORIES.find(c => c.key === category) || HIGHLIGHT_CATEGORIES[5];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium ${cat.color}`}>
      <span className="text-[10px] opacity-60">{cat.label}</span>
      {text}
      {removable && onRemove && (
        <button onClick={onRemove} className="ml-0.5 hover:opacity-70"><X className="w-2.5 h-2.5" /></button>
      )}
    </span>
  );
}

export function Step0CompetitorAnalysis({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  // ── tRPC hooks ──────────────────────────────────────────────────
  const groupsQuery = trpc.imageWorkflow.getExpressionGroups.useQuery({ projectId });
  const createGroupMutation = trpc.imageWorkflow.createExpressionGroup.useMutation();
  const updateGroupMutation = trpc.imageWorkflow.updateExpressionGroup.useMutation();
  const deleteGroupMutation = trpc.imageWorkflow.deleteExpressionGroup.useMutation();
  const addImageMutation = trpc.imageWorkflow.addImageToGroup.useMutation();
  const removeImageMutation = trpc.imageWorkflow.removeImageFromGroup.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep0.useMutation();
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();

  // ── Local state ─────────────────────────────────────────────────
  const [newGroupName, setNewGroupName] = useState("");
  const [uploadingGroupId, setUploadingGroupId] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(!!session?.step0Confirmed);
  const [summaryData, setSummaryData] = useState<any>(null);
  // Per-group local edit state (for middle + right columns)
  const [groupEdits, setGroupEdits] = useState<Record<number, any>>({});
  const [newHighlightText, setNewHighlightText] = useState<Record<number, string>>({});
  const [newHighlightCat, setNewHighlightCat] = useState<Record<number, string>>({});
  // Competitor name input per group (for image upload)
  const [competitorInputs, setCompetitorInputs] = useState<Record<number, string>>({});
  const generationJob = useImageStepGenerationJob({
    projectId,
    step: 0,
    onSucceeded: (result) => setSummaryData(result),
    onRefresh: () => groupsQuery.refetch(),
  });

  useEffect(() => {
    setIsLocked(!!session?.step0Confirmed);
    if (session?.step0AiResult) {
      try { setSummaryData(JSON.parse(session.step0AiResult)); } catch {}
    }
  }, [session?.step0Confirmed, session?.step0AiResult]);

  // Sync groupEdits from fetched data
  useEffect(() => {
    if (groupsQuery.data) {
      const edits: Record<number, any> = {};
      groupsQuery.data.forEach((g: any) => {
        try {
          edits[g.id] = JSON.parse(g.userEdit || g.aiAnalysis || "{}");
        } catch {
          edits[g.id] = {};
        }
      });
      setGroupEdits(edits);
    }
  }, [groupsQuery.data]);

  const groups = groupsQuery.data || [];
  const getEdit = (id: number) => groupEdits[id] || {};
  const setEdit = (id: number, patch: any) => {
    setGroupEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  // ── Handlers ────────────────────────────────────────────────────
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) { toast.error("请输入表达方向名称"); return; }
    try {
      await createGroupMutation.mutateAsync({ projectId, expressionName: newGroupName.trim() });
      setNewGroupName("");
      groupsQuery.refetch();
      toast.success("表达方向已创建");
    } catch (err: any) { toast.error(err.message || "创建失败"); }
  };

  const handleDeleteGroup = async (groupId: number) => {
    try {
      await deleteGroupMutation.mutateAsync({ projectId, groupId });
      groupsQuery.refetch();
      toast.success("已删除");
    } catch (err: any) { toast.error(err.message || "删除失败"); }
  };

  const handleImageUpload = async (groupId: number, file: File) => {
    const group = groups.find((g: any) => g.id === groupId);
    if (!group) return;
    if ((group.images || []).length >= 5) { toast.error("每个表达方向最多上传5张图片"); return; }
    setUploadingGroupId(groupId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", String(projectId));
      formData.append("groupId", String(groupId));
      formData.append("competitorName", (competitorInputs[groupId] || "").trim());
      const resp = await fetch("/api/upload/expression-group-image", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || "上传失败");
      }
      const { url, competitorName } = await resp.json();
      // Persist to DB via tRPC
      await addImageMutation.mutateAsync({
        projectId,
        groupId,
        competitorName: competitorName || (competitorInputs[groupId] || "").trim(),
        imageUrl: url,
      });
      groupsQuery.refetch();
      toast.success("图片已上传");
    } catch (err: any) { toast.error(err.message || "上传失败"); }
    finally { setUploadingGroupId(null); }
  };

  const handleRemoveImage = async (imageId: number) => {
    try {
      await removeImageMutation.mutateAsync({ projectId, imageId });
      groupsQuery.refetch();
      toast.success("已删除");
    } catch (err: any) { toast.error(err.message || "删除失败"); }
  };

  const handleAnalyzeGroup = async (groupId: number) => {
    const group = groups.find((item: any) => item.id === groupId);
    if (!group?.images?.length) {
      toast.error("请先上传图片");
      return;
    }
    await generationJob.start();
  };

  const handleSaveGroupEdit = async (groupId: number) => {
    try {
      await updateGroupMutation.mutateAsync({
        projectId,
        groupId,
        userEdit: JSON.stringify(getEdit(groupId)),
      });
      toast.success("已保存");
    } catch (err: any) { toast.error(err.message || "保存失败"); }
  };

  const addHighlight = (groupId: number) => {
    const text = (newHighlightText[groupId] || "").trim();
    if (!text) return;
    const cat = newHighlightCat[groupId] || "other";
    const edit = getEdit(groupId);
    const highlights = [...(edit.highlights || []), { text, category: cat }];
    setEdit(groupId, { highlights });
    setNewHighlightText(prev => ({ ...prev, [groupId]: "" }));
  };

  const removeHighlight = (groupId: number, idx: number) => {
    const edit = getEdit(groupId);
    const highlights = (edit.highlights || []).filter((_: any, i: number) => i !== idx);
    setEdit(groupId, { highlights });
  };

  const handleConfirm = async () => {
    if (groups.length === 0) { toast.error("请先创建至少一个表达方向并上传图片"); return; }
    if (!summaryData) {
      await generationJob.start();
      return;
    }
    // Save all pending edits first
    for (const g of groups) {
      if (groupEdits[g.id]) {
        try { await updateGroupMutation.mutateAsync({ projectId, groupId: g.id, userEdit: JSON.stringify(groupEdits[g.id]) }); } catch {}
      }
    }
    try {
      const result = await confirmMutation.mutateAsync({ projectId, userEdit: JSON.stringify(summaryData) });
      setSummaryData(result.summary);
      setIsLocked(true);
      toast.success("竞品分析已确认，进入卖点梳理");
      onConfirm();
    } catch (err: any) { toast.error(err.message || "确认失败"); }
  };

  const handleUnlock = async () => {
    try { await resetMutation.mutateAsync({ projectId, step: 0 }); setIsLocked(false); toast.success("已解锁"); }
    catch (err: any) { toast.error(err.message || "解锁失败"); }
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5 text-primary" />
                Step 0: 竞品图片分析
              </CardTitle>
              <CardDescription>
                按卖点表达方向分组 — 每组上传 1-5 张不同竞品的同类表达图片，AI 提取共性亮点
              </CardDescription>
            </div>
            <div className="flex gap-2 items-center">
              {!isLocked && (
                <>
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onConfirm}>跳过</Button>
                  {summaryData && (
                    <Button variant="outline" onClick={generationJob.start} disabled={generationJob.isGenerating}>
                      <RotateCcw className="w-4 h-4 mr-2" />重新分析
                    </Button>
                  )}
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending || generationJob.isGenerating || groups.length === 0}>
                    {confirmMutation.isPending || generationJob.isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : summaryData ? <Check className="w-4 h-4 mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    {summaryData ? "确认分析总结" : "后台分析并生成总结"}
                  </Button>
                </>
              )}
              {isLocked && (
                <div className="flex gap-2 items-center">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><Lock className="w-3 h-3 mr-1" />已确认</Badge>
                  <Button variant="ghost" size="sm" className="text-xs text-amber-600" onClick={handleUnlock} disabled={resetMutation.isPending}>
                    <Unlock className="w-3 h-3 mr-1" />解锁编辑
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Add new expression group */}
        {!isLocked && (
          <CardContent className="pt-0">
            <div className="flex gap-2">
              <Input
                placeholder="新建表达方向（如：场景使用图、功能对比图、数据展示图）"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }}
                className="h-9"
              />
              <Button size="sm" onClick={handleCreateGroup} disabled={createGroupMutation.isPending} className="shrink-0">
                {createGroupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                新建方向
              </Button>
            </div>
          </CardContent>
        )}
        <ImageStepGenerationStatus
          run={generationJob.run}
          isGenerating={generationJob.isGenerating}
          isCanceling={generationJob.isCanceling}
          onCancel={generationJob.cancel}
          onRetry={generationJob.start}
        />
      </Card>

      {/* Empty state */}
      {groups.length === 0 && !isLocked && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground border-2 border-dashed rounded-xl">
          <ImageIcon className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm font-medium">暂无表达方向</p>
          <p className="text-xs mt-1 max-w-xs">
            输入一种卖点表达方向（如"场景使用图"），新建后上传 1-5 张不同竞品的同类图片
          </p>
        </div>
      )}

      {/* ─── Expression Group Cards (Three-column waterfall) ─── */}
      {groups.map((group: any) => {
        const edit = getEdit(group.id);
        const highlights: Array<{ text: string; category: string }> = edit.highlights || [];
        const images = group.images || [];
        const isAnalyzing = generationJob.isGenerating;
        const isUploading = uploadingGroupId === group.id;

        return (
          <div key={group.id} className="border rounded-xl overflow-hidden shadow-sm bg-card">
            {/* Group header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs font-semibold">{group.expressionName}</Badge>
                <span className="text-xs text-muted-foreground">{images.length}/5 张图片</span>
              </div>
              {!isLocked && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleAnalyzeGroup(group.id)} disabled={isAnalyzing || images.length === 0}>
                    {isAnalyzing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                    后台分析全部
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteGroup(group.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
              {/* ── Column 1: Image Grid (1-5 competitor images) ── */}
              <div className="p-3 border-r bg-gray-50/50">
                <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />不同竞品参考图（最多5张）
                </p>

                {/* Image grid */}
                {images.length > 0 && (
                  <div className={`grid gap-1.5 mb-2 ${images.length === 1 ? 'grid-cols-1' : images.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {images.map((img: any) => (
                      <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-100 border">
                        <img src={img.imageUrl} alt={img.competitorName} className="w-full h-full object-cover" />
                        {img.competitorName && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                            <p className="text-[9px] text-white truncate">{img.competitorName}</p>
                          </div>
                        )}
                        {!isLocked && (
                          <button
                            onClick={() => handleRemoveImage(img.id)}
                            className="absolute top-1 right-1 w-5 h-5 bg-red-500/80 hover:bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload area */}
                {!isLocked && images.length < 5 && (
                  <div className="space-y-1.5">
                    <Input
                      value={competitorInputs[group.id] || ""}
                      onChange={(e) => setCompetitorInputs(prev => ({ ...prev, [group.id]: e.target.value }))}
                      placeholder="竞品名称（可选）"
                      className="h-7 text-xs"
                    />
                    <label className={`flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border-2 border-dashed border-primary/40 cursor-pointer hover:bg-primary/5 transition-colors text-xs text-primary ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                      {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      上传竞品图片
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        disabled={isUploading}
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          const remaining = 5 - images.length;
                          files.slice(0, remaining).forEach(f => handleImageUpload(group.id, f));
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {images.length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center">上传不同竞品的「{group.expressionName}」图片</p>
                    )}
                  </div>
                )}
                {!isLocked && images.length >= 5 && (
                  <p className="text-xs text-amber-600 text-center py-1">已达上限（5张）</p>
                )}
              </div>

              {/* ── Column 2: Image Type + Selling Point Processing ── */}
              <div className="p-4 border-r space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Layout className="w-3.5 h-3.5 text-blue-500" />图片类型 & 卖点处理
                  </h4>
                  {!isLocked && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs text-primary" onClick={() => handleSaveGroupEdit(group.id)} disabled={updateGroupMutation.isPending}>
                      <Check className="w-3 h-3 mr-0.5" />保存
                    </Button>
                  )}
                </div>

                {isAnalyzing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />正在后台分析全部表达方向...
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">图片类型</label>
                  {isLocked ? (
                    <p className="text-sm">{edit.imageType || "未标注"}</p>
                  ) : (
                    <Input value={edit.imageType || ""} onChange={(e) => setEdit(group.id, { imageType: e.target.value })} placeholder="如：场景图 / 功能图 / 卖点图 / A+" className="h-7 text-xs" />
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">构图方式</label>
                  {isLocked ? (
                    <p className="text-sm text-muted-foreground">{edit.composition || "未分析"}</p>
                  ) : (
                    <Input value={edit.composition || ""} onChange={(e) => setEdit(group.id, { composition: e.target.value })} placeholder="如：居中展示、对角构图、三分法" className="h-7 text-xs" />
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">配色方案</label>
                  {isLocked ? (
                    <p className="text-sm text-muted-foreground">{edit.colorScheme || "未分析"}</p>
                  ) : (
                    <Input value={edit.colorScheme || ""} onChange={(e) => setEdit(group.id, { colorScheme: e.target.value })} placeholder="如：白底清洁风、深色高级感" className="h-7 text-xs" />
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">卖点表达方式</label>
                  {isLocked ? (
                    <p className="text-sm text-muted-foreground">{edit.sellingPointExpression || "未分析"}</p>
                  ) : (
                    <Textarea value={edit.sellingPointExpression || ""} onChange={(e) => setEdit(group.id, { sellingPointExpression: e.target.value })} placeholder="如：数据对比、场景使用、功能图标展示" className="min-h-[56px] text-xs resize-none" />
                  )}
                </div>
              </div>

              {/* ── Column 3: Highlight Tags ── */}
              <div className="p-4 space-y-3">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />亮点标签
                </h4>

                <div className="flex flex-wrap gap-1.5 min-h-[40px]">
                  {highlights.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">{isLocked ? "未添加亮点" : "AI分析后自动填充，也可手动添加"}</p>
                  )}
                  {highlights.map((h, i) => (
                    <HighlightTag key={i} text={h.text} category={h.category} removable={!isLocked} onRemove={() => removeHighlight(group.id, i)} />
                  ))}
                </div>

                {!isLocked && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">手动添加亮点</p>
                    <div className="flex gap-1.5">
                      <select
                        value={newHighlightCat[group.id] || "other"}
                        onChange={(e) => setNewHighlightCat(prev => ({ ...prev, [group.id]: e.target.value }))}
                        className="h-7 text-xs border rounded-md px-1.5 bg-background text-foreground shrink-0"
                      >
                        {HIGHLIGHT_CATEGORIES.map(c => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                      <Input
                        value={newHighlightText[group.id] || ""}
                        onChange={(e) => setNewHighlightText(prev => ({ ...prev, [group.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") addHighlight(group.id); }}
                        placeholder="输入亮点描述后回车"
                        className="h-7 text-xs flex-1"
                      />
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0 shrink-0" onClick={() => addHighlight(group.id)}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { text: "白底清洁", cat: "color" }, { text: "场景化展示", cat: "scene" },
                        { text: "对角构图", cat: "composition" }, { text: "数据对比", cat: "expression" },
                        { text: "图标展示", cat: "expression" }, { text: "大字标题", cat: "typography" },
                      ].map((preset) => (
                        <button
                          key={preset.text}
                          onClick={() => {
                            const e2 = getEdit(group.id);
                            const exists = (e2.highlights || []).some((h: any) => h.text === preset.text);
                            if (!exists) setEdit(group.id, { highlights: [...(e2.highlights || []), { text: preset.text, category: preset.cat }] });
                          }}
                          className="text-[10px] px-1.5 py-1 rounded border border-dashed border-gray-300 hover:border-primary hover:text-primary text-muted-foreground transition-colors truncate"
                        >
                          + {preset.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!isLocked && highlights.length > 0 && (
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => handleSaveGroupEdit(group.id)} disabled={updateGroupMutation.isPending}>
                    {updateGroupMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                    保存此方向分析
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* ─── Bottom Summary ─── */}
      {summaryData && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              竞品分析总结
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {summaryData.overallTrends && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">整体趋势</p>
                  <p className="text-sm">{summaryData.overallTrends}</p>
                </div>
              )}
              {summaryData.commonCompositions?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">常见构图</p>
                  <div className="flex flex-wrap gap-1">
                    {summaryData.commonCompositions.map((c: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {summaryData.colorTrends?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">配色趋势</p>
                  <div className="flex flex-wrap gap-1">
                    {summaryData.colorTrends.map((c: string, i: number) => (
                      <Badge key={i} className="text-xs bg-pink-100 text-pink-700 border-pink-200">{c}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {summaryData.differentiationOpportunities?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">差异化机会</p>
                  <ul className="space-y-0.5">
                    {summaryData.differentiationOpportunities.map((o: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1"><span className="text-amber-500 shrink-0">•</span>{o}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
