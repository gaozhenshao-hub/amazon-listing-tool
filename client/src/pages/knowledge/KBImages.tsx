import { useState, useMemo, useEffect, useRef } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Loader2, PlusCircle, Link2, Upload, Image as ImageIcon, CheckCircle, Edit3, Trash2, Sparkles, Search, Grid3X3, LayoutGrid, Package, Eye, Tag } from "lucide-react";
import { toast } from "sonner";
import { TagEditor } from "@/components/TagEditor";
import { ScoreSlider } from "@/components/ScoreSlider";

type ViewMode = "asin" | "waterfall" | "grid";

const CATEGORY_OPTIONS = ["3C数码","家居生活","户外运动","美妆个护","母婴玩具","宠物用品","服装鞋包","厨房用品","汽车配件","办公用品","健康保健","食品饮料","工具五金","其他"];
const COLOR_OPTIONS = ["暖色系","冷色系","中性色系","撞色/对比色","品牌色","渐变色"];
const IMAGE_TYPE_OPTIONS = ["场景图","功能图","卖点图","尺寸图","参数图","对比图","细节图","包装图","使用步骤图","成分图","认证图","生活方式图"];
const DESIGN_STYLE_OPTIONS = ["简约现代","科技感","自然清新","温馨家居","运动活力","奢华高端","可爱卡通","工业硬朗","日系极简","北欧风","美式复古","扁平化"];

const DIMENSION_LABELS: Record<string, string> = {
  copywriting: "文案", structure: "结构", expression: "表达方式",
  color: "色彩", dataVisualization: "数据可视化", icons: "图标",
  keyElements: "关键元素", composition: "构图", brandTone: "品牌调性",
  storytelling: "故事性", consistency: "一致性", overallArchitecture: "整体架构",
};

export default function KBImages() {
  const utils = trpc.useUtils();
  const [showImport, setShowImport] = useState(false);
  const [asinInput, setAsinInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("asin");
  const [detailSetId, setDetailSetId] = useState<number | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState("");

  // Filters (four dimensions + position)
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterColorScheme, setFilterColorScheme] = useState("all");
  const [filterImageType, setFilterImageType] = useState("all");
  const [filterStyle, setFilterStyle] = useState("all");
  const [filterPosition, setFilterPosition] = useState("all");
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null);

  // Use listSets for the ASIN-grouped view (default)
  const { data: sets, isLoading } = trpc.kbImages.listSets.useQuery();
  // Use listAllImages for image-level browsing (waterfall/grid)
  const { data: allImages, isLoading: imagesLoading } = trpc.kbImages.listAllImages.useQuery({
    tagCategory: filterCategory !== "all" ? filterCategory : undefined,
    tagColorScheme: filterColorScheme !== "all" ? filterColorScheme : undefined,
    tagImageType: filterImageType !== "all" ? filterImageType : undefined,
    tagDesignStyle: filterStyle !== "all" ? filterStyle : undefined,
    imagePosition: filterPosition !== "all" ? filterPosition : undefined,
  }, { enabled: viewMode !== "asin" });
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
  const updateImageTagsMutation = trpc.kbImages.confirmImageTags.useMutation({
    onSuccess: () => { toast.success("标签已更新"); utils.kbImages.getSet.invalidate({ id: detailSetId! }); utils.kbImages.listAllImages.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateImageScoreMutation = trpc.kbImages.updateImageScore.useMutation({
    onSuccess: () => { toast.success("评分已更新"); utils.kbImages.getSet.invalidate({ id: detailSetId! }); },
    onError: (e: any) => toast.error(e.message),
  });

  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    crawling: { label: "爬取中", variant: "secondary" },
    analyzing: { label: "AI分析中", variant: "secondary" },
    pending_review: { label: "待确认", variant: "default" },
    confirmed: { label: "已入库", variant: "outline" },
  };

  // Filter sets for ASIN view
  const filteredSets = useMemo(() => {
    if (!sets) return [];
    return (sets as any[]).filter((s: any) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (s.asin || "").toLowerCase().includes(q) || (s.productTitle || "").toLowerCase().includes(q) || (s.brand || "").toLowerCase().includes(q);
    });
  }, [sets, searchQuery]);

  // Filter images for waterfall/grid view
  const filteredImages = useMemo(() => {
    if (!allImages) return [];
    return (allImages as any[]).filter((item: any) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (item.asin || "").toLowerCase().includes(q) || (item.imageType || "").toLowerCase().includes(q);
    });
  }, [allImages, searchQuery]);

  // Waterfall columns
  const columns = useMemo(() => {
    const cols: any[][] = [[], [], [], []];
    filteredImages.forEach((item: any, i: number) => cols[i % 4].push(item));
    return cols;
  }, [filteredImages]);

  // Group detail set images by position
  const groupedImages = useMemo(() => {
    if (!detailSet) return { main: [], secondary: [], aplus: [], brand_story: [] };
    const imgs = (detailSet as any).images || [];
    return {
      main: imgs.filter((i: any) => i.imagePosition === "main"),
      secondary: imgs.filter((i: any) => i.imagePosition === "secondary"),
      aplus: imgs.filter((i: any) => i.imagePosition === "aplus"),
      brand_story: imgs.filter((i: any) => i.imagePosition === "brand_story"),
    };
  }, [detailSet]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ImageIcon className="h-6 w-6 text-purple-500" />
            智能图片知识库
          </h1>
          <p className="text-muted-foreground text-sm mt-1">AI四维分类（类目/图片类型/设计风格/色系），按ASIN整合浏览</p>
        </div>
        <Button onClick={() => setShowImport(true)} className="gap-2"><PlusCircle className="h-4 w-4" /> 导入图片</Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索ASIN、产品名、品牌..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        {viewMode !== "asin" && (
          <>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="类目" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类目</SelectItem>
                {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterColorScheme} onValueChange={setFilterColorScheme}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="色系" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部色系</SelectItem>
                {COLOR_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterImageType} onValueChange={setFilterImageType}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="图片类型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {IMAGE_TYPE_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStyle} onValueChange={setFilterStyle}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="设计风格" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部风格</SelectItem>
                {DESIGN_STYLE_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterPosition} onValueChange={setFilterPosition}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="图片位置" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部位置</SelectItem>
                <SelectItem value="main">主图</SelectItem>
                <SelectItem value="secondary">副图</SelectItem>
                <SelectItem value="aplus">A+图片</SelectItem>
                <SelectItem value="brand_story">品牌故事</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        <div className="ml-auto flex gap-1">
          <Button variant={viewMode === "asin" ? "default" : "outline"} size="sm" className="h-9 gap-1.5" onClick={() => setViewMode("asin")}>
            <Package className="h-4 w-4" /> ASIN集
          </Button>
          <Button variant={viewMode === "waterfall" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("waterfall")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("grid")}>
            <Grid3X3 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Badge variant="secondary" className="text-xs">
        {viewMode === "asin" ? `${filteredSets.length} 个ASIN图片集` : `${filteredImages.length} 张图片`}
      </Badge>

      {/* ═══ ASIN Grouped View (Default) ═══ */}
      {viewMode === "asin" && (
        isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : filteredSets.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">暂无图片集</p>
              <p className="text-xs text-muted-foreground mt-1">通过ASIN或链接导入产品图片，AI将进行四维分类和12维度分析</p>
              <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowImport(true)}><PlusCircle className="h-4 w-4" /> 导入第一批图片</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredSets.map((set: any) => {
              const status = statusMap[set.status] || { label: set.status, variant: "secondary" as const };
              return (
                <Card key={set.id} className="group cursor-pointer hover:shadow-lg transition-all overflow-hidden" onClick={() => { setDetailSetId(set.id); setEditingAnalysis(""); }}>
                  {/* Thumbnail strip - show first 4 images from the set */}
                  <div className="relative h-40 bg-muted overflow-hidden">
                    <AsinThumbnailStrip setId={set.id} />
                    <div className="absolute top-2 right-2">
                      <Badge variant={status.variant} className="text-[10px] shadow-sm">{status.label}</Badge>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                      <span className="text-white text-xs font-medium flex items-center gap-1"><Eye className="h-3 w-3" /> 查看详情</span>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="font-mono text-xs">{set.asin}</Badge>
                      {set.brand && <Badge variant="secondary" className="text-[10px]">{set.brand}</Badge>}
                    </div>
                    <h3 className="text-sm font-medium line-clamp-2 mb-2">{set.productTitle || "未命名产品"}</h3>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{set.category || "未分类"}</span>
                      {set.overallScore && (
                        <span className="font-medium text-primary">{set.overallScore}分</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* ═══ Waterfall View ═══ */}
      {viewMode === "waterfall" && (
        (isLoading || imagesLoading) ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : filteredImages.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">暂无图片</p>
              <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowImport(true)}><PlusCircle className="h-4 w-4" /> 导入图片</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {columns.map((col, ci) => (
              <div key={ci} className="space-y-4">
                {col.map((item: any) => (
                  <Card key={item.id} className="cursor-pointer hover:shadow-lg transition-all overflow-hidden group" onClick={() => { setDetailSetId(item.imageSetId); setEditingAnalysis(""); }}>
                    {item.imageUrl && (
                      <div className="relative">
                        <img src={item.imageUrl} alt="" className="w-full object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                      </div>
                    )}
                    <CardContent className="p-3">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <Badge variant="outline" className="text-[10px]">{item.asin || "N/A"}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{item.imagePosition === "main" ? "主图" : item.imagePosition === "aplus" ? "A+" : `副图#${item.positionIndex}`}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.tagImageType && <Badge variant="secondary" className="text-[10px]">{item.tagImageType}</Badge>}
                        {item.tagDesignStyle && <Badge variant="secondary" className="text-[10px]">{item.tagDesignStyle}</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))}
          </div>
        )
      )}

      {/* ═══ Grid View ═══ */}
      {viewMode === "grid" && (
        (isLoading || imagesLoading) ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : filteredImages.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">暂无图片</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredImages.map((item: any) => (
              <Card key={item.id} className="cursor-pointer hover:shadow-md transition-all overflow-hidden" onClick={() => { setDetailSetId(item.imageSetId); setEditingAnalysis(""); }}>
                {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full aspect-square object-cover" loading="lazy" />}
                <CardContent className="p-2">
                  <Badge variant="outline" className="text-[10px]">{item.asin || "N/A"}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )
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
                <p className="text-xs text-muted-foreground">系统将自动爬取所有产品图片（主图+副图+A+图片），并按ASIN整合为一个图片集</p>
              </div>
              <Button onClick={() => importAsin.mutate({ asin: asinInput })} disabled={importAsin.isPending || !asinInput} className="w-full gap-2">
                {importAsin.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 开始采集并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="link" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>输入亚马逊产品链接</Label>
                <Textarea placeholder={"https://www.amazon.com/dp/B0XXXXXXXXX\nhttps://www.amazon.com/dp/B0YYYYYYYYY"} value={linkInput} onChange={(e) => setLinkInput(e.target.value)} rows={4} />
                <p className="text-xs text-muted-foreground">支持多个链接，每行一个，系统自动提取ASIN</p>
              </div>
              <Button onClick={() => importLink.mutate({ url: linkInput })} disabled={importLink.isPending || !linkInput} className="w-full gap-2">
                {importLink.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 开始采集并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="batch" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>批量输入ASIN（每行一个，最多20个）</Label>
                <Textarea placeholder={"B0XXXXXXXXX\nB0YYYYYYYYY\nB0ZZZZZZZZZ"} value={batchInput} onChange={(e) => setBatchInput(e.target.value)} rows={6} className="font-mono text-sm" />
                <p className="text-xs text-muted-foreground">每个ASIN将创建独立的图片集，AI分别进行12维度分析</p>
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

      {/* ═══ ASIN Set Detail Dialog — Images Grouped by Position ═══ */}
      <Dialog open={!!detailSetId} onOpenChange={(open) => !open && setDetailSetId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {detailSet ? (() => {
            const d = detailSet as any;
            const status = statusMap[d.status] || { label: d.status, variant: "secondary" as const };
            let analysis: any = {};
            try { analysis = JSON.parse(d.userEditedOverallAnalysis || d.overallAnalysis || "{}"); } catch {}
            const totalImages = (d.images || []).length;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono">{d.asin}</Badge>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className="text-sm text-muted-foreground">{totalImages} 张图片</span>
                    {d.overallScore && <Badge className="bg-primary/10 text-primary border-primary/20">{d.overallScore}分</Badge>}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-6">
                  {d.productTitle && <h3 className="font-medium text-lg">{d.productTitle}</h3>}

                  {/* ── Main Image Section ── */}
                  {groupedImages.main.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <div className="w-1 h-4 bg-blue-500 rounded-full" />
                        主图 <Badge variant="secondary" className="text-[10px]">{groupedImages.main.length}张</Badge>
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {groupedImages.main.map((img: any) => (
                          <ImageCardEnhanced key={img.id} img={img} onSelectImage={setSelectedImageId} selectedImageId={selectedImageId} onUpdateTags={updateImageTagsMutation} onUpdateScore={updateImageScoreMutation} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Secondary Images Section ── */}
                  {groupedImages.secondary.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <div className="w-1 h-4 bg-emerald-500 rounded-full" />
                        副图 <Badge variant="secondary" className="text-[10px]">{groupedImages.secondary.length}张</Badge>
                      </h4>
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                        {groupedImages.secondary.sort((a: any, b: any) => (a.positionIndex || 0) - (b.positionIndex || 0)).map((img: any) => (
                          <ImageCardEnhanced key={img.id} img={img} onSelectImage={setSelectedImageId} selectedImageId={selectedImageId} onUpdateTags={updateImageTagsMutation} onUpdateScore={updateImageScoreMutation} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── A+ Images Section ── */}
                  {groupedImages.aplus.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <div className="w-1 h-4 bg-purple-500 rounded-full" />
                        A+ 图片 <Badge variant="secondary" className="text-[10px]">{groupedImages.aplus.length}张</Badge>
                      </h4>
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                        {groupedImages.aplus.sort((a: any, b: any) => (a.positionIndex || 0) - (b.positionIndex || 0)).map((img: any) => (
                          <ImageCardEnhanced key={img.id} img={img} onSelectImage={setSelectedImageId} selectedImageId={selectedImageId} onUpdateTags={updateImageTagsMutation} onUpdateScore={updateImageScoreMutation} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Brand Story Images Section ── */}
                  {groupedImages.brand_story.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <div className="w-1 h-4 bg-amber-500 rounded-full" />
                        品牌故事 <Badge variant="secondary" className="text-[10px]">{groupedImages.brand_story.length}张</Badge>
                      </h4>
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                        {groupedImages.brand_story.sort((a: any, b: any) => (a.positionIndex || 0) - (b.positionIndex || 0)).map((img: any) => (
                          <ImageCardEnhanced key={img.id} img={img} onSelectImage={setSelectedImageId} selectedImageId={selectedImageId} onUpdateTags={updateImageTagsMutation} onUpdateScore={updateImageScoreMutation} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Overall Analysis */}
                  {(d.overallAnalysis || d.userEditedOverallAnalysis) && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-purple-500" /> AI图片集整体分析
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {editingAnalysis ? (
                          <Textarea rows={12} value={editingAnalysis} onChange={(e) => setEditingAnalysis(e.target.value)} className="text-xs font-mono" />
                        ) : (
                          <div className="space-y-3 text-sm">
                            {analysis.overallStrategy && <p><strong>整体策略:</strong> {analysis.overallStrategy}</p>}
                            {analysis.mainImageAssessment && <p><strong>主图评估:</strong> {analysis.mainImageAssessment}</p>}
                            {analysis.secondaryImageFlow && <p><strong>副图叙事流:</strong> {analysis.secondaryImageFlow}</p>}
                            {analysis.aplusAssessment && <p><strong>A+内容评估:</strong> {analysis.aplusAssessment}</p>}
                            {analysis.brandStoryAssessment && <p><strong>品牌故事评估:</strong> {analysis.brandStoryAssessment}</p>}
                            {analysis.overallStyle && <p><strong>整体风格:</strong> {analysis.overallStyle}</p>}
                            {analysis.imageStrategy && <p><strong>图片策略:</strong> {analysis.imageStrategy}</p>}
                            {analysis.highlights && <p><strong>亮点:</strong> {analysis.highlights}</p>}
                            {analysis.improvements && <p><strong>改进建议:</strong> {analysis.improvements}</p>}
                            {analysis.missingImageTypes && Array.isArray(analysis.missingImageTypes) && analysis.missingImageTypes.length > 0 && (
                              <p><strong>缺少的图片类型:</strong> {analysis.missingImageTypes.join("、")}</p>
                            )}
                            {analysis.improvementSuggestions && Array.isArray(analysis.improvementSuggestions) && (
                              <div>
                                <strong>改进建议:</strong>
                                <ul className="list-disc list-inside mt-1 space-y-1 text-muted-foreground">
                                  {analysis.improvementSuggestions.map((s: string, i: number) => <li key={i}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                            {analysis.summary && <p className="text-muted-foreground italic border-l-2 pl-3">{analysis.summary}</p>}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <Separator />

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

/** Thumbnail strip for ASIN card - loads images for the set */
function AsinThumbnailStrip({ setId }: { setId: number }) {
  const { data } = trpc.kbImages.getSet.useQuery({ id: setId });
  const images = (data as any)?.images || [];
  const displayImages = images.slice(0, 5);

  if (displayImages.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted">
        <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
      </div>
    );
  }

  if (displayImages.length === 1) {
    return <img src={displayImages[0].imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />;
  }

  // Show main image large + secondary images small
  return (
    <div className="flex h-full gap-0.5">
      <div className="flex-1 min-w-0">
        <img src={displayImages[0].imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      </div>
      <div className="w-20 flex flex-col gap-0.5">
        {displayImages.slice(1, 5).map((img: any, i: number) => (
          <div key={i} className="flex-1 min-h-0">
            <img src={img.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Enhanced single image card with expandable tag editing, score slider, and 12-dimension analysis */
function ImageCardEnhanced({ img, onSelectImage, selectedImageId, onUpdateTags, onUpdateScore }: {
  img: any;
  onSelectImage: (id: number | null) => void;
  selectedImageId: number | null;
  onUpdateTags: any;
  onUpdateScore: any;
}) {
  const isExpanded = selectedImageId === img.id;
  let dimensions: any = {};
  try { dimensions = JSON.parse(img.aiDimensionAnalysis || "{}"); } catch {}

  return (
    <div className={`rounded-lg overflow-hidden bg-muted border transition-all ${isExpanded ? "ring-2 ring-primary col-span-full" : ""}`}>
      <div className="relative cursor-pointer" onClick={() => onSelectImage(isExpanded ? null : img.id)}>
        <img src={img.imageUrl} alt="" className={`w-full ${isExpanded ? "max-h-80 object-contain bg-black/5" : "aspect-square object-cover"}`} loading="lazy" />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
          <div className="flex flex-wrap gap-1">
            {img.tagCategory && <Badge variant="secondary" className="text-[9px] bg-white/20 text-white border-0">{img.tagCategory}</Badge>}
            {img.tagColorScheme && <Badge variant="secondary" className="text-[9px] bg-white/20 text-white border-0">{img.tagColorScheme}</Badge>}
            {img.tagImageType && <Badge variant="secondary" className="text-[9px] bg-white/20 text-white border-0">{img.tagImageType}</Badge>}
            {img.tagDesignStyle && <Badge variant="secondary" className="text-[9px] bg-white/20 text-white border-0">{img.tagDesignStyle}</Badge>}
            {img.singleImageScore && <Badge className="text-[9px] bg-primary/80 border-0">{img.singleImageScore}/10</Badge>}
          </div>
        </div>
        {img.imagePosition !== "main" && (
          <Badge variant="outline" className="absolute top-1.5 left-1.5 text-[9px] bg-white/80 backdrop-blur-sm">
            {img.imagePosition === "aplus" ? "A+" : img.imagePosition === "brand_story" ? "品牌故事" : `#${img.positionIndex}`}
          </Badge>
        )}
        {img.aplusModuleType && img.aplusModuleType !== "unknown" && (
          <Badge className={`absolute top-1.5 right-1.5 text-[9px] border-0 backdrop-blur-sm ${
            img.aplusModuleType === "comparison_table" ? "bg-blue-500/80 text-white" :
            img.aplusModuleType === "image_carousel" ? "bg-green-500/80 text-white" :
            img.aplusModuleType === "full_width_image" ? "bg-purple-500/80 text-white" :
            img.aplusModuleType === "image_text_overlay" ? "bg-orange-500/80 text-white" :
            img.aplusModuleType === "four_image_text" ? "bg-cyan-500/80 text-white" :
            img.aplusModuleType === "three_image_text" ? "bg-teal-500/80 text-white" :
            img.aplusModuleType === "hotspot_interactive" ? "bg-pink-500/80 text-white" :
            img.aplusModuleType === "video_module" ? "bg-red-500/80 text-white" :
            img.aplusModuleType === "brand_story_hero" ? "bg-amber-600/80 text-white" :
            img.aplusModuleType === "brand_story_card" ? "bg-amber-500/80 text-white" :
            img.aplusModuleType === "single_image_sidebar" ? "bg-indigo-500/80 text-white" :
            img.aplusModuleType === "tech_specs" ? "bg-slate-500/80 text-white" :
            img.aplusModuleType === "navigation_carousel" ? "bg-emerald-500/80 text-white" :
            "bg-violet-500/80 text-white"
          }`}>
            {({
              comparison_table: "对比表格",
              image_carousel: "图片轮播",
              full_width_image: "全宽图",
              image_text_overlay: "图文叠加",
              standard_image_text: "标准图文",
              four_image_text: "四图文",
              three_image_text: "三图文",
              hotspot_interactive: "热点交互",
              video_module: "视频模块",
              brand_story_hero: "品牌主图",
              brand_story_card: "品牌卡片",
              single_image_sidebar: "单图侧栏",
              tech_specs: "技术参数",
              navigation_carousel: "导航轮播",
            } as Record<string, string>)[img.aplusModuleType] || img.aplusModuleType}
          </Badge>
        )}
      </div>

      {isExpanded && (
        <div className="p-4 space-y-4 bg-card">
          {/* Four-dimension tag selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">类目</Label>
              <Select value={img.tagCategory || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagCategory: v, tagColorScheme: img.tagColorScheme, tagImageType: img.tagImageType, tagDesignStyle: img.tagDesignStyle })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择类目" /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">色系</Label>
              <Select value={img.tagColorScheme || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagCategory: img.tagCategory, tagColorScheme: v, tagImageType: img.tagImageType, tagDesignStyle: img.tagDesignStyle })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择色系" /></SelectTrigger>
                <SelectContent>
                  {COLOR_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">图片类型</Label>
              <Select value={img.tagImageType || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagCategory: img.tagCategory, tagColorScheme: img.tagColorScheme, tagImageType: v, tagDesignStyle: img.tagDesignStyle })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择类型" /></SelectTrigger>
                <SelectContent>
                  {IMAGE_TYPE_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">设计风格</Label>
              <Select value={img.tagDesignStyle || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagCategory: img.tagCategory, tagColorScheme: img.tagColorScheme, tagImageType: img.tagImageType, tagDesignStyle: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择风格" /></SelectTrigger>
                <SelectContent>
                  {DESIGN_STYLE_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Score Slider */}
          <ScoreSlider
            value={img.singleImageScore || 5}
            onChange={() => {}}
            onSave={(val) => onUpdateScore.mutate({ imageId: img.id, score: val })}
            min={1}
            max={10}
            label="单图评分"
            disabled={onUpdateScore.isPending}
          />

          {/* 12-Dimension Analysis Display */}
          {img.aiDimensionAnalysis && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                12维度分析
              </h5>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                  const dim = dimensions[key];
                  if (!dim) return null;
                  const analysis = typeof dim === "string" ? dim : dim?.analysis || dim?.content || JSON.stringify(dim);
                  return (
                    <div key={key} className="bg-muted/50 rounded-md p-2">
                      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
                      <p className="text-xs mt-0.5 line-clamp-3">{analysis}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
