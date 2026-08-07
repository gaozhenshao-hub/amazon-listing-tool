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

// ═══════════════════════════════════════════════════════════════════
// ─── Knowledge Base Image Picker Dialog ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════
export function KbImagePickerDialog({
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
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [filters, setFilters] = useState<{
    tagCategory?: string;
    tagColorSchemeV2?: string;
    tagImageTypeMain?: string;
    tagDesignStyleV2?: string;
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

  const filterOptions = trpc.imageWorkflow.getKbImageFilterOptions.useQuery({ scope }, { enabled: open });
  const kbImages = trpc.imageWorkflow.listKbImages.useQuery(
    { scope, ...filters },
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
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
        <div className="px-6 pt-6 shrink-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            从知识库选择参考图
          </DialogTitle>
          <DialogDescription>
            从图片知识库中筛选并选择参考图片，支持按类目、色系、图片类型、设计风格筛选
          </DialogDescription>
        </DialogHeader>
        </div>

        {/* Scope + Filter Bar */}
        <div className="flex flex-wrap gap-2 py-2 border-b px-6 shrink-0">
          {/* Scope toggle */}
          <div className="flex rounded-md border overflow-hidden text-xs mr-1">
            <button
              className={`px-2.5 py-1 transition-colors ${scope === "all" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              onClick={() => setScope("all")}
            >全部</button>
            <button
              className={`px-2.5 py-1 transition-colors ${scope === "mine" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              onClick={() => setScope("mine")}
            >我的</button>
          </div>

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

          <Select value={filters.tagColorSchemeV2 || "__all__"} onValueChange={v => v === "__all__" ? clearFilter("tagColorSchemeV2") : setFilters(prev => ({ ...prev, tagColorSchemeV2: v }))}>
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

          <Select value={filters.tagImageTypeMain || "__all__"} onValueChange={v => v === "__all__" ? clearFilter("tagImageTypeMain") : setFilters(prev => ({ ...prev, tagImageTypeMain: v }))}>
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

          <Select value={filters.tagDesignStyleV2 || "__all__"} onValueChange={v => v === "__all__" ? clearFilter("tagDesignStyleV2") : setFilters(prev => ({ ...prev, tagDesignStyleV2: v }))}>
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
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
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
        </div>

        {/* Footer with selection count and confirm */}
        <div className="flex items-center justify-between px-6 py-3 border-t shrink-0">
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
