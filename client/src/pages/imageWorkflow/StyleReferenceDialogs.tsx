import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { ImageIcon, Loader2 } from "lucide-react";
import { useState } from "react";

// ─── ASIN Set Picker Dialog ──────────────────────────────────────
// ─── KB Style Tag Picker Dialog ──────────────────────────────────
export function KbStyleTagPickerDialog({
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
export function AsinSetPickerDialog({
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
