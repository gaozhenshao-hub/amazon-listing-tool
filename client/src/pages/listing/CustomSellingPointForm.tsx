import type { Dispatch, SetStateAction } from "react";
import { Check, Loader2, Pencil, Plus, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CustomSellingPointFormProps = {
  totalCoresCount: number;
  aiAssistMode: boolean;
  setAiAssistMode: Dispatch<SetStateAction<boolean>>;
  aiKeyword: string;
  setAiKeyword: Dispatch<SetStateAction<string>>;
  aiResult: any;
  setAiResult: Dispatch<SetStateAction<any>>;
  newCoreTheme: string;
  setNewCoreTheme: Dispatch<SetStateAction<string>>;
  newCoreThemeZh: string;
  setNewCoreThemeZh: Dispatch<SetStateAction<string>>;
  newCoreDescription: string;
  setNewCoreDescription: Dispatch<SetStateAction<string>>;
  setShowAddForm: Dispatch<SetStateAction<boolean>>;
  isExpanding: boolean;
  handleAiExpand: () => void;
  handleConfirmAiResult: () => void;
  handleAddManualCore: () => void;
};

/** Controlled presentation only: the owning project keeps every draft and action. */
export function CustomSellingPointForm({
  totalCoresCount, aiAssistMode, setAiAssistMode, aiKeyword, setAiKeyword,
  aiResult, setAiResult, newCoreTheme, setNewCoreTheme, newCoreThemeZh,
  setNewCoreThemeZh, newCoreDescription, setNewCoreDescription, setShowAddForm,
  isExpanding, handleAiExpand, handleConfirmAiResult, handleAddManualCore,
}: CustomSellingPointFormProps) {
  return (
    <div className="rounded-lg border-2 border-dashed border-teal-300 p-4 bg-teal-50/30 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-teal-700 flex items-center gap-2">
          <Plus className="h-4 w-4" />
          添加自定义卖点 (还可添加 {9 - totalCoresCount} 条)
        </h4>
        <div className="flex gap-1 bg-muted rounded-md p-0.5">
          <button
            className={`px-3 py-1 text-xs rounded transition-colors ${
              aiAssistMode
                ? "bg-background shadow-sm text-teal-700 font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { setAiAssistMode(true); setAiResult(null); }}
          >
            <Wand2 className="h-3 w-3 inline mr-1" />AI辅助
          </button>
          <button
            className={`px-3 py-1 text-xs rounded transition-colors ${
              !aiAssistMode
                ? "bg-background shadow-sm text-teal-700 font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { setAiAssistMode(false); setAiResult(null); }}
          >
            <Pencil className="h-3 w-3 inline mr-1" />手动填写
          </button>
        </div>
      </div>
    
      {aiAssistMode ? (
        <div className="space-y-3">
          {/* AI Keyword Input */}
          {!aiResult && (
            <div className="space-y-2">
              <Label className="text-xs">输入关键词或卖点主题 <span className="text-red-500">*</span></Label>
              <p className="text-xs text-muted-foreground">输入一个关键词或简短主题，AI将自动扩展为完整的FABE格式卖点</p>
              <div className="flex gap-2">
                <Input
                  placeholder="例如: waterproof, eco-friendly, easy assembly, 防水设计..."
                  value={aiKeyword}
                  onChange={(e) => setAiKeyword(e.target.value)}
                  className="h-9 text-sm flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter" && aiKeyword.trim()) handleAiExpand(); }}
                />
                <Button
                  size="sm"
                  onClick={handleAiExpand}
                  disabled={!aiKeyword.trim() || isExpanding}
                  className="bg-teal-600 hover:bg-teal-700 h-9"
                >
                  {isExpanding ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />AI生成中...</>
                  ) : (
                    <><Wand2 className="h-3.5 w-3.5 mr-1" />AI生成FABE</>
                  )}
                </Button>
              </div>
            </div>
          )}
    
          {/* AI Result Preview & Edit */}
          {aiResult && (
            <div className="space-y-3 rounded-lg border border-teal-200 bg-white/80 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-teal-600" />
                  <span className="text-sm font-medium text-teal-700">AI生成结果</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => { setAiResult(null); }}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />重新生成
                </Button>
              </div>
    
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">主题 (EN)</Label>
                  <Input
                    value={aiResult.theme}
                    onChange={(e) => setAiResult((prev: any) => ({ ...prev, theme: e.target.value }))}
                    className="h-8 text-sm font-medium"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">主题 (CN)</Label>
                  <Input
                    value={aiResult.themeZh}
                    onChange={(e) => setAiResult((prev: any) => ({ ...prev, themeZh: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
    
              <div>
                <Label className="text-xs text-muted-foreground">描述</Label>
                <Textarea
                  value={aiResult.description}
                  onChange={(e) => setAiResult((prev: any) => ({ ...prev, description: e.target.value }))}
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
    
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {["feature", "advantage", "benefit", "evidence"].map((field) => (
                  <div key={field}>
                    <Label className="text-xs text-muted-foreground">
                      {field === "feature" ? "F - 特征" : field === "advantage" ? "A - 优势" : field === "benefit" ? "B - 利益" : "E - 证据"}
                    </Label>
                    <Textarea
                      value={aiResult.fabeDirection?.[field] || ""}
                      onChange={(e) => setAiResult((prev: any) => ({
                        ...prev,
                        fabeDirection: { ...prev.fabeDirection, [field]: e.target.value }
                      }))}
                      rows={2}
                      className="text-xs resize-none"
                    />
                  </div>
                ))}
              </div>
    
              {aiResult.targetKeywords?.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">目标关键词</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {aiResult.targetKeywords.map((kw: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                    ))}
                  </div>
                </div>
              )}
    
              {aiResult.addressesGap && (
                <div>
                  <Label className="text-xs text-muted-foreground">解决的竞品缺口</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{aiResult.addressesGap}</p>
                </div>
              )}
    
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleConfirmAiResult} className="bg-teal-600 hover:bg-teal-700">
                  <Check className="h-3.5 w-3.5 mr-1" />确认添加
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setAiResult(null); setAiKeyword(""); }}>取消</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Manual Mode */
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">卖点主题 (英文) <span className="text-red-500">*</span></Label>
              <Input
                placeholder="例如: Eco-Friendly Design"
                value={newCoreTheme}
                onChange={(e) => setNewCoreTheme(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">卖点主题 (中文)</Label>
              <Input
                placeholder="例如: 环保设计"
                value={newCoreThemeZh}
                onChange={(e) => setNewCoreThemeZh(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">描述</Label>
            <Textarea
              placeholder="简要描述这条卖点应该传达什么信息..."
              value={newCoreDescription}
              onChange={(e) => setNewCoreDescription(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddManualCore} disabled={!newCoreTheme.trim()}>
              <Plus className="h-3.5 w-3.5 mr-1" />添加
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>取消</Button>
          </div>
        </div>
      )}
    
      {/* Close button when in AI mode without result */}
      {aiAssistMode && !aiResult && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setAiAssistMode(false); setAiKeyword(""); }}>取消</Button>
        </div>
      )}
    </div>
  );
}

