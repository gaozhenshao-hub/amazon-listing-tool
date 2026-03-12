import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, PlusCircle, Link2, Upload, Image as ImageIcon, CheckCircle, Edit3, Trash2, Sparkles, Search, Grid3X3, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

export default function KBImages() {
  const utils = trpc.useUtils();
  const [showImport, setShowImport] = useState(false);
  const [asinInput, setAsinInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"waterfall" | "grid">("waterfall");
  const [detailSetId, setDetailSetId] = useState<number | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState("");

  // Filters
  const [filterImageType, setFilterImageType] = useState("all");
  const [filterStyle, setFilterStyle] = useState("all");

  // Use listSets for the set-level view
  const { data: sets, isLoading } = trpc.kbImages.listSets.useQuery();
  // Use listAllImages for image-level browsing
  const { data: allImages, isLoading: imagesLoading } = trpc.kbImages.listAllImages.useQuery({
    tagImageType: filterImageType !== "all" ? filterImageType : undefined,
    tagDesignStyle: filterStyle !== "all" ? filterStyle : undefined,
  });
  const { data: detailSet } = trpc.kbImages.getSet.useQuery({ id: detailSetId! }, { enabled: !!detailSetId });

  const importAsin = trpc.kbImages.importByAsin.useMutation({
    onSuccess: () => { toast.success("已开始导入图片，AI正在分析..."); utils.kbImages.listSets.invalidate(); utils.kbImages.listAllImages.invalidate(); setShowImport(false); setAsinInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const importLink = trpc.kbImages.importByLink.useMutation({
    onSuccess: () => { toast.success("已开始导入"); utils.kbImages.listSets.invalidate(); utils.kbImages.listAllImages.invalidate(); setShowImport(false); setLinkInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const batchImport = trpc.kbImages.batchImportAsins.useMutation({
    onSuccess: (r: any) => { toast.success(`已开始导入 ${r.imported} 个ASIN的图片`); utils.kbImages.listSets.invalidate(); utils.kbImages.listAllImages.invalidate(); setShowImport(false); setBatchInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const confirmMutation = trpc.kbImages.confirmSetAnalysis.useMutation({
    onSuccess: () => { toast.success("已确认入库"); utils.kbImages.listSets.invalidate(); utils.kbImages.getSet.invalidate({ id: detailSetId! }); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMutation = trpc.kbImages.deleteSet.useMutation({
    onSuccess: () => { toast.success("已删除"); utils.kbImages.listSets.invalidate(); utils.kbImages.listAllImages.invalidate(); setDetailSetId(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    crawling: { label: "爬取中", variant: "secondary" },
    analyzing: { label: "AI分析中", variant: "secondary" },
    pending_review: { label: "待确认", variant: "default" },
    confirmed: { label: "已入库", variant: "outline" },
  };

  // Use allImages for the waterfall/grid view
  const images = (allImages as any[] || []);
  const filtered = useMemo(() => {
    return images.filter((item: any) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (item.asin || "").toLowerCase().includes(q) || (item.imageType || "").toLowerCase().includes(q);
    });
  }, [images, searchQuery]);

  // Waterfall layout: distribute items into columns
  const columns = useMemo(() => {
    const cols: any[][] = [[], [], [], []];
    filtered.forEach((item: any, i: number) => cols[i % 4].push(item));
    return cols;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ImageIcon className="h-6 w-6 text-purple-500" />
            智能图片知识库
          </h1>
          <p className="text-muted-foreground text-sm mt-1">AI四维分类（类目/图片类型/设计风格/色系），瀑布流浏览</p>
        </div>
        <Button onClick={() => setShowImport(true)} className="gap-2"><PlusCircle className="h-4 w-4" /> 导入图片</Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索ASIN、类型..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={filterImageType} onValueChange={setFilterImageType}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="图片类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="main">主图</SelectItem>
            <SelectItem value="scene">场景图</SelectItem>
            <SelectItem value="detail">细节图</SelectItem>
            <SelectItem value="infographic">信息图</SelectItem>
            <SelectItem value="comparison">对比图</SelectItem>
            <SelectItem value="size">尺寸图</SelectItem>
            <SelectItem value="feature">功能图</SelectItem>
            <SelectItem value="lifestyle">生活方式</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStyle} onValueChange={setFilterStyle}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="设计风格" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部风格</SelectItem>
            <SelectItem value="minimal">极简</SelectItem>
            <SelectItem value="premium">高端质感</SelectItem>
            <SelectItem value="colorful">色彩丰富</SelectItem>
            <SelectItem value="tech">科技感</SelectItem>
            <SelectItem value="natural">自然</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-1">
          <Button variant={viewMode === "waterfall" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("waterfall")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("grid")}>
            <Grid3X3 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Badge variant="secondary" className="text-xs">{filtered.length} 张图片</Badge>

      {/* Image Grid */}
      {(isLoading || imagesLoading) ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">暂无图片</p>
            <p className="text-xs text-muted-foreground mt-1">通过ASIN或链接导入产品图片，AI将进行四维分类和评分</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowImport(true)}><PlusCircle className="h-4 w-4" /> 导入第一批图片</Button>
          </CardContent>
        </Card>
      ) : viewMode === "waterfall" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {columns.map((col, ci) => (
            <div key={ci} className="space-y-4">
              {col.map((item: any) => (
                <Card key={item.id} className="cursor-pointer hover:shadow-lg transition-all overflow-hidden group" onClick={() => { setDetailSetId(item.setId); setEditingAnalysis(""); }}>
                  {item.imageUrl && (
                    <div className="relative">
                      <img src={item.imageUrl} alt="" className="w-full object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                    </div>
                  )}
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <Badge variant="outline" className="text-[10px]">{item.asin || "N/A"}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {item.imageType && <Badge variant="secondary" className="text-[10px]">{item.imageType}</Badge>}
                      {item.designStyle && <Badge variant="secondary" className="text-[10px]">{item.designStyle}</Badge>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((item: any) => (
            <Card key={item.id} className="cursor-pointer hover:shadow-md transition-all overflow-hidden" onClick={() => { setDetailSetId(item.setId); setEditingAnalysis(""); }}>
              {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full aspect-square object-cover" loading="lazy" />}
              <CardContent className="p-2">
                <Badge variant="outline" className="text-[10px]">{item.asin || "N/A"}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>导入产品图片</DialogTitle></DialogHeader>
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
                <p className="text-xs text-muted-foreground">系统将自动爬取所有产品图片（主图+副图+A+图片）</p>
              </div>
              <Button onClick={() => importAsin.mutate({ asin: asinInput })} disabled={importAsin.isPending || !asinInput} className="w-full gap-2">
                {importAsin.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 开始采集并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="link" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>输入亚马逊产品链接</Label>
                <Textarea placeholder={"https://www.amazon.com/dp/B0XXXXXXXXX"} value={linkInput} onChange={(e) => setLinkInput(e.target.value)} rows={4} />
              </div>
              <Button onClick={() => importLink.mutate({ url: linkInput })} disabled={importLink.isPending || !linkInput} className="w-full gap-2">
                {importLink.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 开始采集并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="batch" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>批量输入ASIN（每行一个，最多50个）</Label>
                <Textarea placeholder={"B0XXXXXXXXX\nB0YYYYYYYYY"} value={batchInput} onChange={(e) => setBatchInput(e.target.value)} rows={6} className="font-mono text-sm" />
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

      {/* Set Detail Dialog */}
      <Dialog open={!!detailSetId} onOpenChange={(open) => !open && setDetailSetId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {detailSet ? (() => {
            const d = detailSet as any;
            const status = statusMap[d.status] || { label: d.status, variant: "secondary" as const };
            let analysis: any = {};
            try { analysis = JSON.parse(d.userEditedAnalysis || d.aiSetAnalysis || "{}"); } catch {}
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono">{d.asin}</Badge>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className="text-sm text-muted-foreground">{d.imageCount || 0} 张图片</span>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {d.productTitle && <h3 className="font-medium">{d.productTitle}</h3>}
                  {/* Images preview grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {(d.images || []).slice(0, 9).map((img: any, i: number) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                        <img src={img.imageUrl} alt="" className="w-full h-full object-cover" />
                        {img.imageType && <Badge variant="secondary" className="absolute bottom-1 left-1 text-[10px]">{img.imageType}</Badge>}
                      </div>
                    ))}
                  </div>
                  {/* AI Analysis */}
                  {d.aiSetAnalysis && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-purple-500" /> AI图片集分析
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {editingAnalysis ? (
                          <Textarea rows={10} value={editingAnalysis} onChange={(e) => setEditingAnalysis(e.target.value)} className="text-xs font-mono" />
                        ) : (
                          <div className="space-y-2 text-sm">
                            {analysis.overallStyle && <p><strong>整体风格:</strong> {analysis.overallStyle}</p>}
                            {analysis.imageStrategy && <p><strong>图片策略:</strong> {analysis.imageStrategy}</p>}
                            {analysis.highlights && <p><strong>亮点:</strong> {analysis.highlights}</p>}
                            {analysis.improvements && <p><strong>改进建议:</strong> {analysis.improvements}</p>}
                            {analysis.summary && <p className="text-muted-foreground italic border-l-2 pl-3">{analysis.summary}</p>}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                  <div className="flex gap-2 justify-end">
                    {d.status === "pending_review" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setEditingAnalysis(editingAnalysis ? "" : JSON.stringify(analysis, null, 2))} className="gap-1.5">
                          <Edit3 className="h-3.5 w-3.5" /> {editingAnalysis ? "取消编辑" : "编辑分析"}
                        </Button>
                        <Button size="sm" onClick={() => confirmMutation.mutate({ id: detailSetId!, editedAnalysis: editingAnalysis || undefined })} disabled={confirmMutation.isPending} className="gap-1.5">
                          {confirmMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          确认入库
                        </Button>
                      </>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => { if (confirm("确定删除整个图片集？")) deleteMutation.mutate({ id: detailSetId! }); }} className="gap-1.5">
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
