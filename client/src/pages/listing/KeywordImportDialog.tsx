import { ArrowUpDown, Download, Loader2, Search, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

type KeywordImportDialogProps = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  strategyFilter: string;
  setStrategyFilter: Dispatch<SetStateAction<string>>;
  placementFilter: string;
  setPlacementFilter: Dispatch<SetStateAction<string>>;
  sortOrder: "none" | "asc" | "desc";
  setSortOrder: Dispatch<SetStateAction<"none" | "asc" | "desc">>;
  loading: boolean;
  filteredKeywords: any[];
  allKeywords: any[] | undefined;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onImport: () => void;
};

export function KeywordImportDialog({
  open: showKeywordImport,
  setOpen: setShowKeywordImport,
  searchTerm: kwSearchTerm,
  setSearchTerm: setKwSearchTerm,
  strategyFilter: kwFilterStrategy,
  setStrategyFilter: setKwFilterStrategy,
  placementFilter: kwFilterPlacement,
  setPlacementFilter: setKwFilterPlacement,
  sortOrder: kwSortOrder,
  setSortOrder: setKwSortOrder,
  loading: kwLoading,
  filteredKeywords,
  allKeywords,
  selectedIds: selectedKeywordIds,
  onToggle: toggleKeywordSelection,
  onToggleAll: handleSelectAllFiltered,
  onImport: handleImportSelectedKeywords,
}: KeywordImportDialogProps) {
  return (
    <Dialog open={showKeywordImport} onOpenChange={setShowKeywordImport}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-teal-600" />
            从关键词管理导入
          </DialogTitle>
          <DialogDescription>
            选择关键词后将自动填入AI辅助生成的输入框，点击“AI生成FABE”即可将关键词扩展为完整卖点
          </DialogDescription>
        </DialogHeader>

        {/* Search & Filters */}
        <div className="space-y-2 px-1">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索关键词或中文翻译..."
                value={kwSearchTerm}
                onChange={(e) => setKwSearchTerm(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">策略分类:</Label>
              <select
                value={kwFilterStrategy}
                onChange={(e) => setKwFilterStrategy(e.target.value)}
                className="h-7 text-xs border rounded px-2 bg-background"
              >
                <option value="all">全部</option>
                <option value="core_main">核心主词</option>
                <option value="sub_core">次核心词</option>
                <option value="precise_longtail">精准长尾词</option>
                <option value="scene_intent">场景意图词</option>
                <option value="longtail_main">长尾主词</option>
                <option value="observe_test">观察测试词</option>
                <option value="brand_offensive">品牌进攻词</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Listing位置:</Label>
              <select
                value={kwFilterPlacement}
                onChange={(e) => setKwFilterPlacement(e.target.value)}
                className="h-7 text-xs border rounded px-2 bg-background"
              >
                <option value="all">全部</option>
                <option value="title_front">标题前段</option>
                <option value="title_mid">标题中后段</option>
                <option value="title_end">标题末尾</option>
                <option value="bullet_first">五点描述首句</option>
                <option value="bullet_body">五点描述融入</option>
                <option value="aplus">A+核心文案</option>
                <option value="search_term">后台Search Term</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">月搜索量:</Label>
              <Button
                variant={kwSortOrder !== "none" ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-xs px-2 gap-1"
                onClick={() => setKwSortOrder(prev => prev === "none" ? "desc" : prev === "desc" ? "asc" : "none")}
              >
                <ArrowUpDown className="h-3 w-3" />
                {kwSortOrder === "desc" ? "降序" : kwSortOrder === "asc" ? "升序" : "排序"}
              </Button>
            </div>
            {(kwSearchTerm || kwFilterStrategy !== "all" || kwFilterPlacement !== "all" || kwSortOrder !== "none") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => { setKwSearchTerm(""); setKwFilterStrategy("all"); setKwFilterPlacement("all"); setKwSortOrder("none"); }}
              >
                <X className="h-3 w-3 mr-1" />清除筛选
              </Button>
            )}
          </div>
        </div>

        {/* Keyword List */}
        <div className="flex-1 min-h-0">
          {kwLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">加载关键词中...</span>
            </div>
          ) : filteredKeywords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">{allKeywords?.length ? "没有符合筛选条件的关键词" : "该项目还没有关键词数据"}</p>
              <p className="text-xs mt-1">{allKeywords?.length ? "请调整筛选条件" : "请先在关键词管理模块中导入关键词"}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-1 py-1.5">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={filteredKeywords.length > 0 && filteredKeywords.every((kw: any) => selectedKeywordIds.has(kw.id))}
                    onCheckedChange={handleSelectAllFiltered}
                  />
                  <span className="text-xs text-muted-foreground">
                    全选 ({filteredKeywords.length} 个关键词)
                  </span>
                </div>
                {selectedKeywordIds.size > 0 && (
                  <Badge variant="secondary" className="text-xs">已选 {selectedKeywordIds.size} 个</Badge>
                )}
              </div>
              <ScrollArea className="h-[320px] border rounded-md">
                <div className="divide-y">
                  {filteredKeywords.map((kw: any) => (
                    <div
                      key={kw.id}
                      className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors ${
                        selectedKeywordIds.has(kw.id) ? "bg-teal-50/50 dark:bg-teal-950/20" : ""
                      }`}
                      onClick={() => toggleKeywordSelection(kw.id)}
                    >
                      <Checkbox
                        checked={selectedKeywordIds.has(kw.id)}
                        onCheckedChange={() => toggleKeywordSelection(kw.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{kw.keyword}</span>
                          {kw.translationCn && (
                            <span className="text-xs text-muted-foreground truncate">({kw.translationCn})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {kw.monthlySearchVolume != null && (
                            <span className="text-xs text-muted-foreground">月搜: {kw.monthlySearchVolume.toLocaleString()}</span>
                          )}
                          {kw.relevance && (
                            <Badge variant="outline" className={`text-[10px] px-1 py-0 ${
                              kw.relevance === "high" ? "border-green-300 text-green-700" :
                              kw.relevance === "medium" ? "border-yellow-300 text-yellow-700" :
                              "border-gray-300 text-gray-500"
                            }`}>
                              {kw.relevance === "high" ? "高相关" : kw.relevance === "medium" ? "中相关" : "低相关"}
                            </Badge>
                          )}
                          {kw.strategyCategory && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">
                              {({core_main:"核心主词",sub_core:"次核心",precise_longtail:"精准长尾",scene_intent:"场景意图",longtail_main:"长尾主词",observe_test:"观察测试",brand_offensive:"品牌进攻"} as Record<string,string>)[kw.strategyCategory] || kw.strategyCategory}
                            </Badge>
                          )}
                          {kw.listingPlacement && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {({title_front:"标题前段",title_mid:"标题中后",title_end:"标题末尾",bullet_first:"五点首句",bullet_body:"五点融入",aplus:"A+文案",search_term:"Search Term",not_use:"不使用"} as Record<string,string>)[kw.listingPlacement] || kw.listingPlacement}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <p className="text-xs text-muted-foreground">
            选中的关键词将合并填入AI辅助生成输入框
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowKeywordImport(false)}>取消</Button>
            <Button
              size="sm"
              onClick={handleImportSelectedKeywords}
              disabled={selectedKeywordIds.size === 0}
              className="bg-teal-600 hover:bg-teal-700"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              导入已选 ({selectedKeywordIds.size})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
