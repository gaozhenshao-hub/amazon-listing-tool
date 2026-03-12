import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, PlusCircle, Link2, Upload, Lightbulb, Star, CheckCircle, Edit3, Trash2, Sparkles, Search } from "lucide-react";
import { toast } from "sonner";

export default function KBProducts() {
  const utils = trpc.useUtils();
  const { data: items, isLoading } = trpc.kbProducts.list.useQuery();
  const [showImport, setShowImport] = useState(false);
  const [asinInput, setAsinInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState("");

  const { data: detail } = trpc.kbProducts.getById.useQuery({ id: detailId! }, { enabled: !!detailId });

  const importAsin = trpc.kbProducts.importByAsin.useMutation({
    onSuccess: () => { toast.success("已开始导入，AI正在分析中..."); utils.kbProducts.list.invalidate(); setShowImport(false); setAsinInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const importLink = trpc.kbProducts.importByLink.useMutation({
    onSuccess: () => { toast.success("已开始导入"); utils.kbProducts.list.invalidate(); setShowImport(false); setLinkInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const batchImport = trpc.kbProducts.batchImportAsins.useMutation({
    onSuccess: (r: any) => { toast.success(`已开始导入 ${r.imported} 个ASIN`); utils.kbProducts.list.invalidate(); setShowImport(false); setBatchInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const confirmMutation = trpc.kbProducts.confirmAnalysis.useMutation({
    onSuccess: () => { toast.success("已确认入库"); utils.kbProducts.list.invalidate(); utils.kbProducts.getById.invalidate({ id: detailId! }); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMutation = trpc.kbProducts.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); utils.kbProducts.list.invalidate(); setDetailId(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    crawling: { label: "爬取中", variant: "secondary" },
    analyzing: { label: "AI分析中", variant: "secondary" },
    pending_review: { label: "待确认", variant: "default" },
    confirmed: { label: "已入库", variant: "outline" },
    archived: { label: "已归档", variant: "destructive" },
  };

  const getAnalysis = (item: any) => {
    try { return JSON.parse(item.userEditedAnalysis || item.aiAnalysis || "{}"); } catch { return {}; }
  };

  const filtered = (items as any[] || []).filter((item: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (item.asin || "").toLowerCase().includes(q) || (item.productTitle || "").toLowerCase().includes(q) || (item.brand || "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-500" />
            智能产品创意库
          </h1>
          <p className="text-muted-foreground text-sm mt-1">通过ASIN或链接批量导入产品，AI自动分析创意亮点和差异化特征</p>
        </div>
        <Button onClick={() => setShowImport(true)} className="gap-2">
          <PlusCircle className="h-4 w-4" /> 导入产品
        </Button>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索ASIN、产品名称、品牌..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Badge variant="secondary" className="h-9 px-3 flex items-center">{filtered.length} 条</Badge>
      </div>

      {/* Product List */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Lightbulb className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">暂无产品创意</p>
            <p className="text-xs text-muted-foreground mt-1">通过ASIN或链接导入产品，AI将自动分析创意亮点</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowImport(true)}>
              <PlusCircle className="h-4 w-4" /> 导入第一个产品
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item: any) => {
            const analysis = getAnalysis(item);
            const status = statusMap[item.status] || { label: item.status, variant: "secondary" as const };
            return (
              <Card key={item.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => { setDetailId(item.id); setEditingAnalysis(""); }}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <Badge variant="outline" className="text-xs font-mono">{item.asin}</Badge>
                    <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
                  </div>
                  <h3 className="font-medium text-sm line-clamp-2 mb-2">{item.productTitle || "加载中..."}</h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {item.brand && <span>{item.brand}</span>}
                    {item.overallScore && (
                      <span className="flex items-center gap-0.5 ml-auto">
                        <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                        {item.overallScore}/10
                      </span>
                    )}
                  </div>
                  {analysis.summary && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{analysis.summary}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>导入产品到创意库</DialogTitle></DialogHeader>
          <Tabs defaultValue="asin">
            <TabsList className="w-full">
              <TabsTrigger value="asin" className="flex-1 gap-1.5"><Upload className="h-3.5 w-3.5" /> ASIN导入</TabsTrigger>
              <TabsTrigger value="link" className="flex-1 gap-1.5"><Link2 className="h-3.5 w-3.5" /> 链接导入</TabsTrigger>
              <TabsTrigger value="batch" className="flex-1 gap-1.5"><PlusCircle className="h-3.5 w-3.5" /> 批量ASIN</TabsTrigger>
            </TabsList>
            <TabsContent value="asin" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>输入单个ASIN</Label>
                <Input placeholder="B0XXXXXXXXX" value={asinInput} onChange={(e) => setAsinInput(e.target.value)} className="font-mono" />
              </div>
              <Button onClick={() => importAsin.mutate({ asin: asinInput })} disabled={importAsin.isPending || !asinInput} className="w-full gap-2">
                {importAsin.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 开始采集并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="link" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>输入亚马逊产品链接（每行一个）</Label>
                <Textarea placeholder={"https://www.amazon.com/dp/B0XXXXXXXXX\nhttps://www.amazon.com/dp/B0YYYYYYYYY"} value={linkInput} onChange={(e) => setLinkInput(e.target.value)} rows={4} />
              </div>
              <Button onClick={() => importLink.mutate({ url: linkInput })} disabled={importLink.isPending || !linkInput} className="w-full gap-2">
                {importLink.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 开始采集并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="batch" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>批量输入ASIN（每行一个，或逗号分隔，最多50个）</Label>
                <Textarea placeholder={"B0XXXXXXXXX\nB0YYYYYYYYY\nB0ZZZZZZZZZ"} value={batchInput} onChange={(e) => setBatchInput(e.target.value)} rows={6} className="font-mono text-sm" />
              </div>
              <Button onClick={() => {
                const asins = batchInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
                if (asins.length === 0) return toast.error("请输入至少一个ASIN");
                batchImport.mutate({ asins });
              }} disabled={batchImport.isPending || !batchInput} className="w-full gap-2">
                {batchImport.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 批量采集并AI分析
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {detail ? (() => {
            const d = detail as any;
            const analysis = getAnalysis(d);
            const status = statusMap[d.status] || { label: d.status, variant: "secondary" as const };
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono">{d.asin}</Badge>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <h3 className="font-medium">{d.productTitle || "加载中..."}</h3>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {d.brand && <span>品牌: <strong className="text-foreground">{d.brand}</strong></span>}
                    {d.category && <span>类目: <strong className="text-foreground">{d.category}</strong></span>}
                    {d.overallScore && (
                      <span className="flex items-center gap-1">评分: <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /><strong className="text-foreground">{d.overallScore}/10</strong></span>
                    )}
                  </div>

                  {/* AI Analysis */}
                  {d.aiAnalysis && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-amber-500" />
                          AI创意分析结果
                          {d.status === "pending_review" && <Badge className="ml-auto text-xs">待确认</Badge>}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {editingAnalysis ? (
                          <Textarea rows={12} value={editingAnalysis} onChange={(e) => setEditingAnalysis(e.target.value)} className="text-xs font-mono" />
                        ) : (
                          <div className="space-y-3 text-sm">
                            {analysis.marketPositioning && <p><strong>市场定位:</strong> {analysis.marketPositioning}</p>}
                            {analysis.functionalHighlights && <p><strong>功能亮点:</strong> {analysis.functionalHighlights}</p>}
                            {analysis.designDifferentiation && <p><strong>设计差异化:</strong> {analysis.designDifferentiation}</p>}
                            {analysis.painPointSolutions && <p><strong>痛点解决:</strong> {analysis.painPointSolutions}</p>}
                            {analysis.pricingStrategy && <p><strong>定价策略:</strong> {analysis.pricingStrategy}</p>}
                            {analysis.competitiveAdvantages && <p><strong>竞争优势:</strong> {analysis.competitiveAdvantages}</p>}
                            {analysis.inspiringElements && <p><strong>启发元素:</strong> {analysis.inspiringElements}</p>}
                            {analysis.summary && <p className="text-muted-foreground italic border-l-2 pl-3">{analysis.summary}</p>}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 justify-end">
                    {d.status === "pending_review" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setEditingAnalysis(editingAnalysis ? "" : JSON.stringify(analysis, null, 2))} className="gap-1.5">
                          <Edit3 className="h-3.5 w-3.5" /> {editingAnalysis ? "取消编辑" : "编辑分析"}
                        </Button>
                        <Button size="sm" onClick={() => confirmMutation.mutate({ id: detailId!, editedAnalysis: editingAnalysis || undefined })} disabled={confirmMutation.isPending} className="gap-1.5">
                          {confirmMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          确认入库
                        </Button>
                      </>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => { if (confirm("确定删除？")) deleteMutation.mutate({ id: detailId! }); }} className="gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" /> 删除
                    </Button>
                  </div>
                </div>
              </>
            );
          })() : (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
