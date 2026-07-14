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
import { Loader2, PlusCircle, Link2, Upload, Image as ImageIcon, CheckCircle, Edit3, Trash2, Sparkles, Search, Grid3X3, LayoutGrid, Package, Eye, Tag, Send, RefreshCw, UploadCloud, X, RotateCcw, Palette } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TagEditor } from "@/components/TagEditor";
import { ScoreSlider } from "@/components/ScoreSlider";
import { usePermissions } from "@/hooks/usePermissions";
import { KBScopeToggle, type KBScope } from "@/components/KBScopeToggle";
import { createImportOnError } from "@/lib/conflictToast";
import { KBTagManagement } from "./KBTagManagement";
import { AmazonStyleGallery } from "./AmazonStyleGallery";
import { useKBTagOptions } from "@/hooks/useKBTagOptions";
import { Settings2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

type ViewMode = "asin" | "waterfall" | "grid";

// V2 Tag Constants (from server/constants/imageTagConstants.ts)
const CATEGORY_OPTIONS_V2 = ["家居","餐厨","庭院花园","房车户外","泳池","玩具","个护","大小家电","3C数码","五金工具","家电配件","母婴（儿童）","老人","运动健身","宠物","工业品","农业品","实验室品"];
const COLOR_TAG_OPTIONS = ["红色","绿色","蓝色","黄色","橙色","紫色","金色","浅灰","深灰","浅棕","深棕","白色","黑色"];
const IMAGE_BELONG_OPTIONS = ["主图", "套图", "A+", "品牌故事"];
const IMAGE_BELONG_HIERARCHY: Record<string, string[]> = {
  "主图": [],
  "套图": [],
  "A+": ["图片轮播", "对比表格", "全宽图", "图文叠加", "四图文", "三图文", "热点交互", "视频模块", "导航轮播", "单图侧文", "技术参数表", "品牌故事卡"],
  "品牌故事": [],
};
const IMAGE_TYPE_HIERARCHY: Record<string, string[]> = {
  "对比": ["综合对比", "细节对比", "尺寸对比", "参数对比"],
  "细节": ["单一特写", "多细节", "场景加细节"],
  "场景": ["远景", "近景", "多场景"],
  "特效": ["透视", "局部提亮", "原理结构"],
  "必要": ["参数", "尺寸", "适配性", "全家福", "步骤图", "使用说明", "标注（爆炸图）"],
  "品牌": ["A+首图", "品牌故事", "买家秀", "证书-质保", "logo设计"],
};
const IMAGE_TYPE_MAIN_OPTIONS = Object.keys(IMAGE_TYPE_HIERARCHY);
const SELLING_POINT_HIERARCHY: Record<string, string[]> = {
  "质量": ["耐高温低温", "耐磨耐刮耐刺", "防水", "防锈耐腐", "防褪色防光衰", "防雨防晒", "防砸防摔", "寿命长", "质保和认证", "防其他"],
  "功能": ["更快更强更有劲", "更大更小", "更粗更宽更承重", "更静音（环境）", "更多（功能，配件）", "更牛逼"],
  "设计": ["可折叠收缩", "可调节", "可更换（多用途）", "可变形", "可自动（变暗变亮变频）"],
  "操作": ["一键（启动，完成）", "两步（安装，清洁）", "三秒（收纳，充气）", "免维护（Set it, Forget it）"],
  "安全": ["环保", "食品级/可啃咬/EPA", "保护（过载，过热）", "自动（断电，熄火）"],
  "附加值": ["易清洗/打理/维护", "易收纳/便携/移动", "额外用途"],
};
const SELLING_POINT_MAIN_OPTIONS = Object.keys(SELLING_POINT_HIERARCHY);
// COLOR_SCHEME_OPTIONS kept for backward compatibility in single-image tags
const COLOR_SCHEME_OPTIONS = ["莫兰迪色系", "高饱和撞色", "黑金配色", "大地色系", "马卡龙色系", "渐变色系", "纯白极简", "对比撞色", "金属色系", "自然绿植色系"];
const COMPOSITION_OPTIONS = ["居中构图", "三分法构图", "对角线构图", "模块化构图", "二分构图", "环绕构图", "层叠构图", "大面积留白"];
// STYLE_NAME_OPTIONS and STYLE_PARAMS_MAP are now driven by dbTags.styleOptions from useKBTagOptions
// Kept as empty fallback for legacy references
const STYLE_NAME_OPTIONS: string[] = [];
const STYLE_PARAMS_MAP: Record<string, { lightType: string; colorTemp: string; materialKeywords: string; tabooElements: string; refBrands: string; aiKeywords: string }> = {};
// Legacy options kept for backward compatibility in display
const CATEGORY_OPTIONS = CATEGORY_OPTIONS_V2;
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
  const { canEdit, canDelete } = usePermissions();
  const allowEdit = canEdit('knowledge', 'kb_images');
  // Dynamic tag options from database (with fallback to hardcoded constants)
  const dbTags = useKBTagOptions();
  const allowDelete = canDelete('knowledge', 'kb_images');
  const [showImport, setShowImport] = useState(false);
  const [asinInput, setAsinInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("asin");
  const [activeMainTab, setActiveMainTab] = useState<"browse" | "tags">("browse");
  const [detailSetId, setDetailSetId] = useState<number | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState("");

  // Filters - V2 (7 dimensions + image belong)
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterColorScheme, setFilterColorScheme] = useState("all");
  const [filterImageType, setFilterImageType] = useState("all");
  const [filterStyle, setFilterStyle] = useState("all");
  const [filterPosition, setFilterPosition] = useState("all");
  // New V2 filters
  const [filterBelong, setFilterBelong] = useState("all");
  const [filterTypeMain, setFilterTypeMain] = useState("all");
  const [filterTypeSub, setFilterTypeSub] = useState("all");
  const [filterSellingPoint, setFilterSellingPoint] = useState("all");
  const [filterSellingPointDetail, setFilterSellingPointDetail] = useState("all");
  const [filterComposition, setFilterComposition] = useState("all");
  const [filterColorV2, setFilterColorV2] = useState("all");
  const [filterAccentColor, setFilterAccentColor] = useState("all");
  const [filterStyleV2, setFilterStyleV2] = useState("all");
  const [useV2Filters, setUseV2Filters] = useState(true);
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null);
  const [scope, setScope] = useState<KBScope>("mine");

  // Use listSets for the ASIN-grouped view (default)
  const { data: sets, isLoading } = trpc.kbImages.listSets.useQuery({ scope }, { staleTime: 30_000 });
  // Use listAllImages for image-level browsing (waterfall/grid) - supports both v1 and v2 filters
  const { data: allImages, isLoading: imagesLoading } = trpc.kbImages.listAllImages.useQuery({
    scope,
    // Legacy filters (still functional)
    tagCategory: filterCategory !== "all" ? filterCategory : undefined,
    tagColorScheme: (!useV2Filters && filterColorScheme !== "all") ? filterColorScheme : undefined,
    tagImageType: (!useV2Filters && filterImageType !== "all") ? filterImageType : undefined,
    tagDesignStyle: (!useV2Filters && filterStyle !== "all") ? filterStyle : undefined,
    imagePosition: filterPosition !== "all" ? filterPosition : undefined,
    // V2 filters
    tagImageBelong: (useV2Filters && filterBelong !== "all") ? filterBelong : undefined,
    tagImageTypeMain: (useV2Filters && filterTypeMain !== "all") ? filterTypeMain : undefined,
    tagImageTypeSub: (useV2Filters && filterTypeSub !== "all") ? filterTypeSub : undefined,
    tagSellingPointCategory: (useV2Filters && filterSellingPoint !== "all") ? filterSellingPoint : undefined,
    tagSellingPointDetail: (useV2Filters && filterSellingPointDetail !== "all") ? filterSellingPointDetail : undefined,
    tagComposition: (useV2Filters && filterComposition !== "all") ? filterComposition : undefined,
    tagColorSchemeV2: (useV2Filters && filterColorV2 !== "all") ? filterColorV2 : undefined,
    tagDesignStyleV2: (useV2Filters && filterStyleV2 !== "all") ? filterStyleV2 : undefined,
  }, { enabled: viewMode !== "asin" });
  // Use listSets data as placeholder while getSet loads — shows ASIN/status/images immediately
  const detailSetPlaceholder = sets?.find((s: any) => s.id === detailSetId);
  const { data: detailSet, isLoading: detailSetLoading } = trpc.kbImages.getSet.useQuery(
    { id: detailSetId! },
    {
      enabled: !!detailSetId,
      staleTime: 60_000, // 60s cache — avoids redundant refetch when reopening same set
      placeholderData: detailSetPlaceholder ? { ...detailSetPlaceholder, images: [] } : undefined,
    }
  );

  const importAsin = trpc.kbImages.importByAsin.useMutation({
    onSuccess: () => { toast.success("已开始导入图片，AI正在分析..."); utils.kbImages.listSets.invalidate(); utils.kbImages.listAllImages.invalidate(); setShowImport(false); setAsinInput(""); },
    onError: createImportOnError((id) => { setShowImport(false); setDetailSetId(id); }),
  });
  const importLink = trpc.kbImages.importByLink.useMutation({
    onSuccess: () => { toast.success("已开始导入"); utils.kbImages.listSets.invalidate(); utils.kbImages.listAllImages.invalidate(); setShowImport(false); setLinkInput(""); },
    onError: createImportOnError((id) => { setShowImport(false); setDetailSetId(id); }),
  });
  const batchImport = trpc.kbImages.batchImportAsins.useMutation({
    onSuccess: (r: any) => { toast.success(`已开始导入 ${r.imported} 个ASIN的图片`); utils.kbImages.listSets.invalidate(); utils.kbImages.listAllImages.invalidate(); setShowImport(false); setBatchInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  // Manual upload state
  const [manualAsin, setManualAsin] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualFiles, setManualFiles] = useState<File[]>([]);
  const [manualPosition, setManualPosition] = useState<string>("secondary");
  const [manualAutoAnalyze, setManualAutoAnalyze] = useState(true);
  const createFromUpload = trpc.kbImages.createSetFromUpload.useMutation({
    onSuccess: (r: any) => { toast.success(`已创建图片集 ${r.asin}，共${r.imageCount}张图片`); utils.kbImages.listSets.invalidate(); utils.kbImages.listAllImages.invalidate(); setShowImport(false); setManualAsin(""); setManualTitle(""); setManualFiles([]); },
    onError: createImportOnError((id) => { setShowImport(false); setDetailSetId(id); }),
  });
  const handleManualUpload = async () => {
    if (!manualAsin || !manualTitle || manualFiles.length === 0) return;
    const images: { base64: string; filename: string; position: "main" | "secondary" | "aplus" | "brand_story" }[] = [];
    for (const file of manualFiles) {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      images.push({ base64, filename: file.name, position: manualPosition as any });
    }
    createFromUpload.mutate({ asin: manualAsin, title: manualTitle, images, autoAnalyze: manualAutoAnalyze });
  };
  const submitReviewMutation = trpc.kbReview.submitForReview.useMutation({
    onSuccess: () => { toast.success("已提交审核，等待管理员审批"); utils.kbImages.getSet.invalidate({ id: detailSetId! }); utils.kbImages.listSets.invalidate(); },
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
    onMutate: async (vars) => {
      // Optimistic update: patch the image in getSet cache immediately
      await utils.kbImages.getSet.cancel({ id: detailSetId! });
      const prev = utils.kbImages.getSet.getData({ id: detailSetId! });
      utils.kbImages.getSet.setData({ id: detailSetId! }, (old: any) => {
        if (!old) return old;
        return { ...old, images: old.images.map((img: any) => img.id === vars.imageId ? { ...img, ...vars, tagsConfirmed: true } : img) };
      });
      return { prev };
    },
    onError: (e: any, _vars, ctx: any) => {
      toast.error(e.message);
      if (ctx?.prev) utils.kbImages.getSet.setData({ id: detailSetId! }, ctx.prev);
    },
    onSuccess: () => {
      toast.success("标签已更新");
      // Invalidate listAllImages in background (non-blocking)
      utils.kbImages.listAllImages.invalidate();
    },
  });
  const updateImageScoreMutation = trpc.kbImages.updateImageScore.useMutation({
    onMutate: async (vars) => {
      await utils.kbImages.getSet.cancel({ id: detailSetId! });
      const prev = utils.kbImages.getSet.getData({ id: detailSetId! });
      utils.kbImages.getSet.setData({ id: detailSetId! }, (old: any) => {
        if (!old) return old;
        return { ...old, images: old.images.map((img: any) => img.id === vars.imageId ? { ...img, singleImageScore: vars.score } : img) };
      });
      return { prev };
    },
    onError: (e: any, _vars, ctx: any) => {
      toast.error(e.message);
      if (ctx?.prev) utils.kbImages.getSet.setData({ id: detailSetId! }, ctx.prev);
    },
    onSuccess: () => toast.success("评分已更新"),
  });

  // ── New: Re-crawl, upload, re-analyze, delete image ──
  const [showReCrawl, setShowReCrawl] = useState(false);
  const [reCrawlPositions, setReCrawlPositions] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadPosition, setUploadPosition] = useState<string>("secondary");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);

  const reCrawlMutation = trpc.kbImages.reCrawlByPosition.useMutation({
    onSuccess: () => { toast.success("已开始重新爬取，请稍后刷新"); setShowReCrawl(false); setReCrawlPositions([]); utils.kbImages.getSet.invalidate({ id: detailSetId! }); utils.kbImages.listSets.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const uploadImagesMutation = trpc.kbImages.uploadImages.useMutation({
    onSuccess: () => { toast.success("图片上传成功"); setShowUpload(false); setUploadFiles([]); utils.kbImages.getSet.invalidate({ id: detailSetId! }); utils.kbImages.listSets.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const reAnalyzeMutation = trpc.kbImages.reAnalyze.useMutation({
    onSuccess: () => { toast.success("已开始重新AI分析，请稍后刷新"); utils.kbImages.getSet.invalidate({ id: detailSetId! }); utils.kbImages.listSets.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteImageMutation = trpc.kbImages.deleteImage.useMutation({
    onSuccess: () => { toast.success("图片已删除"); utils.kbImages.getSet.invalidate({ id: detailSetId! }); },
    onError: (e: any) => toast.error(e.message),
  });

    const reorderImagesMutation = trpc.kbImages.reorderImages.useMutation({
    onSuccess: () => { toast.success("排序已保存"); utils.kbImages.getSet.invalidate({ id: detailSetId! }); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateSetStyleMutation = trpc.kbImages.updateSetStyle.useMutation({
    onSuccess: () => { toast.success("套图风格已更新"); utils.kbImages.getSet.invalidate({ id: detailSetId! }); },
    onError: (e: any) => toast.error(e.message),
  });
  const handleUploadImages = async () => {
    if (!detailSetId || uploadFiles.length === 0) return;
    const images: { base64: string; filename: string; position: "main" | "secondary" | "aplus" | "brand_story" }[] = [];
    for (const file of uploadFiles) {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] || "");
        };
        reader.readAsDataURL(file);
      });
      images.push({ base64, filename: file.name, position: uploadPosition as any });
    }
    uploadImagesMutation.mutate({ setId: detailSetId, images });
  };

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
      // Filter by setCategory (set-level)
      if (filterCategory !== "all" && s.setCategory !== filterCategory) return false;
      // Filter by setPrimaryColor (set-level)
      if (filterColorV2 !== "all" && s.setPrimaryColor !== filterColorV2) return false;
      // Filter by setAccentColor (set-level)
      if (filterAccentColor !== "all" && s.setAccentColor !== filterAccentColor) return false;
      // Filter by setStyle (set-level)
      if (filterStyleV2 !== "all" && s.setStyle !== filterStyleV2) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (s.asin || "").toLowerCase().includes(q) || (s.productTitle || "").toLowerCase().includes(q) || (s.brand || "").toLowerCase().includes(q);
    });
  }, [sets, searchQuery, filterCategory, filterColorV2, filterAccentColor, filterStyleV2]);

  // Filter images for waterfall/grid view
  const filteredImages = useMemo(() => {
    if (!allImages) return [];
    return (allImages as any[]).filter((item: any) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (item.asin || "").toLowerCase().includes(q) || (item.imageType || "").toLowerCase().includes(q);
    });
  }, [allImages, searchQuery]);

  // Waterfall columns (for virtual row rendering: each row = 4 items)
  const waterfallRows = useMemo(() => {
    const rows: any[][] = [];
    for (let i = 0; i < filteredImages.length; i += 4) {
      rows.push(filteredImages.slice(i, i + 4));
    }
    return rows;
  }, [filteredImages]);

  // Grid rows (each row = 6 items)
  const gridRows = useMemo(() => {
    const rows: any[][] = [];
    for (let i = 0; i < filteredImages.length; i += 6) {
      rows.push(filteredImages.slice(i, i + 6));
    }
    return rows;
  }, [filteredImages]);

  // Virtual scroll refs
  const waterfallParentRef = useRef<HTMLDivElement>(null);
  const gridParentRef = useRef<HTMLDivElement>(null);

  const waterfallVirtualizer = useVirtualizer({
    count: waterfallRows.length,
    getScrollElement: () => waterfallParentRef.current,
    estimateSize: () => 280, // estimated row height (image card ~240px + gap)
    overscan: 3,
  });

  const gridVirtualizer = useVirtualizer({
    count: gridRows.length,
    getScrollElement: () => gridParentRef.current,
    estimateSize: () => 180, // estimated row height for compact grid
    overscan: 4,
  });

  // Group detail set images — tagImageBelong takes priority; fall back to imagePosition
  const groupedImages = useMemo(() => {
    if (!detailSet) return { main: [], secondary: [], aplus: [], brand_story: [] };
    const imgs = (detailSet as any).images || [];
    const getGroup = (i: any): string => {
      const belong = (i.tagImageBelong || "").trim();
      if (belong === "主图" || belong === "套图") return belong === "套图" ? "secondary" : "main";
      if (belong === "A+") return "aplus";
      if (belong === "品牌故事") return "brand_story";
      // No tag yet — fall back to crawled imagePosition
      return i.imagePosition || "secondary";
    };
    return {
      main: imgs.filter((i: any) => getGroup(i) === "main"),
      secondary: imgs.filter((i: any) => getGroup(i) === "secondary"),
      aplus: imgs.filter((i: any) => getGroup(i) === "aplus"),
      brand_story: imgs.filter((i: any) => getGroup(i) === "brand_story"),
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
          <p className="text-muted-foreground text-sm mt-1">AI七维分类（归属/类目/图片类型/卖点/构图/配色/风格），按ASIN整合浏览</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-lg p-0.5">
            <Button
              variant={activeMainTab === "browse" ? "default" : "ghost"}
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => setActiveMainTab("browse")}
            >
              <ImageIcon className="h-3.5 w-3.5" /> 图片浏览
            </Button>
            <Button
              variant={activeMainTab === "tags" ? "default" : "ghost"}
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => setActiveMainTab("tags")}
            >
              <Settings2 className="h-3.5 w-3.5" /> 标签管理
            </Button>
          </div>
          {activeMainTab === "browse" && (
            <Button onClick={() => setShowImport(true)} className="gap-2"><PlusCircle className="h-4 w-4" /> 导入图片</Button>
          )}
        </div>
      </div>

      {activeMainTab === "tags" ? (
        <KBTagManagement />
      ) : (
        <>

      {/* Scope Toggle + Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <KBScopeToggle value={scope} onChange={setScope} />
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索ASIN、产品名、品牌..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        {viewMode === "asin" && (
          <div className="flex flex-wrap gap-2">
            {/* 类目 */}
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="类目" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类目</SelectItem>
                {dbTags.categoryOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`category:${c}`] ? ` (${dbTags.countMap[`category:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* 主颜色 */}
            <Select value={filterColorV2} onValueChange={setFilterColorV2}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="主颜色" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部主色</SelectItem>
                {dbTags.colorOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`color:${c}`] ? ` (${dbTags.countMap[`color:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* 提亮色 */}
            <Select value={filterAccentColor} onValueChange={setFilterAccentColor}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="提亮色" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部提亮</SelectItem>
                {dbTags.colorOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`color:${c}`] ? ` (${dbTags.countMap[`color:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* 风格 */}
            <Select value={filterStyleV2} onValueChange={setFilterStyleV2}>
              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue placeholder="设计风格" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部风格</SelectItem>
                {dbTags.styleOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`style:${c}`] ? ` (${dbTags.countMap[`style:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {viewMode !== "asin" && (
          <div className="flex flex-wrap gap-2 w-full">
            {/* 图片归属 */}
            <Select value={filterBelong} onValueChange={setFilterBelong}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="归属" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部归属</SelectItem>
                {dbTags.imageBelongOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`imageBelong:${c}`] ? ` (${dbTags.countMap[`imageBelong:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* 类目 */}
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="类目" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类目</SelectItem>
                {dbTags.categoryOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`category:${c}`] ? ` (${dbTags.countMap[`category:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* 图片类型 - 二级联动 */}
            <Select value={filterTypeMain} onValueChange={(v) => { setFilterTypeMain(v); setFilterTypeSub("all"); }}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="图片大类" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部大类</SelectItem>
                {dbTags.imageTypeMainOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`imageType:${c}`] ? ` (${dbTags.countMap[`imageType:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {filterTypeMain !== "all" && dbTags.imageTypeHierarchy[filterTypeMain] && (
              <Select value={filterTypeSub} onValueChange={setFilterTypeSub}>
                <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue placeholder="子类型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部子类</SelectItem>
                  {dbTags.imageTypeHierarchy[filterTypeMain].map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`imageType:${c}`] ? ` (${dbTags.countMap[`imageType:${c}`]})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {/* 卖点分类 - 二级联动 */}
            <Select value={filterSellingPoint} onValueChange={(v) => { setFilterSellingPoint(v); setFilterSellingPointDetail("all"); }}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="卖点大类" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部卖点</SelectItem>
                {dbTags.sellingPointMainOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`sellingPoint:${c}`] ? ` (${dbTags.countMap[`sellingPoint:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {filterSellingPoint !== "all" && dbTags.sellingPointHierarchy[filterSellingPoint] && (
              <Select value={filterSellingPointDetail} onValueChange={setFilterSellingPointDetail}>
                <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="卖点子类" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部子类</SelectItem>
                  {dbTags.sellingPointHierarchy[filterSellingPoint].map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`sellingPoint:${c}`] ? ` (${dbTags.countMap[`sellingPoint:${c}`]})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {/* 构图 */}
            <Select value={filterComposition} onValueChange={setFilterComposition}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="构图" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部构图</SelectItem>
                {dbTags.compositionOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`composition:${c}`] ? ` (${dbTags.countMap[`composition:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* 主颜色 */}
            <Select value={filterColorV2} onValueChange={setFilterColorV2}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="主颜色" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部主色</SelectItem>
                {dbTags.colorOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`color:${c}`] ? ` (${dbTags.countMap[`color:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* 提亮色 */}
            <Select value={filterAccentColor} onValueChange={setFilterAccentColor}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="提亮色" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部提亮</SelectItem>
                {dbTags.colorOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`color:${c}`] ? ` (${dbTags.countMap[`color:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* 风格 */}
            <Select value={filterStyleV2} onValueChange={setFilterStyleV2}>
              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue placeholder="设计风格" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部风格</SelectItem>
                {dbTags.styleOptions.map(c => <SelectItem key={c} value={c}>{c}{dbTags.countMap[`style:${c}`] ? ` (${dbTags.countMap[`style:${c}`]})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
                    <AsinThumbnailStrip thumbnailImages={(set as any).thumbnailImages} />
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

      {/* ═══ Waterfall View (Virtualized) ═══ */}
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
          <div
            ref={waterfallParentRef}
            className="overflow-auto"
            style={{ height: "70vh" }}
          >
            <div
              style={{
                height: `${waterfallVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {waterfallVirtualizer.getVirtualItems().map((virtualRow) => {
                const rowItems = waterfallRows[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={waterfallVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-4">
                      {rowItems.map((item: any) => (
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
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* ═══ Grid View (Virtualized) ═══ */}
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
          <div
            ref={gridParentRef}
            className="overflow-auto"
            style={{ height: "70vh" }}
          >
            <div
              style={{
                height: `${gridVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {gridVirtualizer.getVirtualItems().map((virtualRow) => {
                const rowItems = gridRows[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={gridVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 pb-3">
                      {rowItems.map((item: any) => (
                        <Card key={item.id} className="cursor-pointer hover:shadow-md transition-all overflow-hidden" onClick={() => { setDetailSetId(item.imageSetId); setEditingAnalysis(""); }}>
                          {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full aspect-square object-cover" loading="lazy" />}
                          <CardContent className="p-2">
                            <Badge variant="outline" className="text-[10px]">{item.asin || "N/A"}</Badge>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
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
              <TabsTrigger value="manual" className="flex-1 gap-1.5"><UploadCloud className="h-3.5 w-3.5" /> 手动上传</TabsTrigger>
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
            <TabsContent value="manual" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>产品ASIN / 标识符</Label>
                <Input placeholder="B0XXXXXXXXX 或自定义名称" value={manualAsin} onChange={(e) => setManualAsin(e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label>图片集标题 <span className="text-destructive">*</span></Label>
                <Input placeholder="例如：无线电饭盒产品图片" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} />
                {!manualTitle && <p className="text-xs text-destructive">请输入图片集标题，用于快速识别和搜索</p>}
              </div>
              <div className="space-y-2">
                <Label>图片位置</Label>
                <Select value={manualPosition} onValueChange={setManualPosition}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">主图</SelectItem>
                    <SelectItem value="secondary">副图</SelectItem>
                    <SelectItem value="aplus">A+内容图</SelectItem>
                    <SelectItem value="brand_story">品牌故事图</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>选择图片文件（最多50张）</Label>
                <input type="file" multiple accept="image/*" className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" onChange={(e) => setManualFiles(Array.from(e.target.files || []).slice(0, 50))} />
                {manualFiles.length > 0 && <p className="text-xs text-muted-foreground">已选择 {manualFiles.length} 张图片</p>}
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="autoAnalyze" checked={manualAutoAnalyze} onChange={(e) => setManualAutoAnalyze(e.target.checked)} className="rounded" />
                <label htmlFor="autoAnalyze" className="text-sm">上传后自动进AI分析</label>
              </div>
              <Button onClick={handleManualUpload} disabled={createFromUpload.isPending || !manualAsin || !manualTitle || manualFiles.length === 0} className="w-full gap-2">
                {createFromUpload.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <UploadCloud className="h-4 w-4" /> 上传并创建图片集
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ═══ ASIN Set Detail Dialog — Images Grouped by Position ═══ */}
      <Dialog open={!!detailSetId} onOpenChange={(open) => !open && setDetailSetId(null)}>
        <DialogContent className="w-[60vw] max-w-[60vw] max-h-[90vh] overflow-y-auto">
          {(detailSet || detailSetPlaceholder) ? (() => {
            const d = (detailSet || detailSetPlaceholder) as any;
            const isPlaceholder = !detailSet && !!detailSetPlaceholder; // still loading full data
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
                    {!isPlaceholder && <span className="text-sm text-muted-foreground">{totalImages} 张图片</span>}
                    {d.overallScore && !isPlaceholder && <Badge className="bg-primary/10 text-primary border-primary/20">{d.overallScore}分</Badge>}
                    {isPlaceholder && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />加载中...</span>}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-6">
                  {d.productTitle && <h3 className="font-medium text-lg">{d.productTitle}</h3>}

                  {/* ── Action Toolbar ── */}
                  {allowEdit && (d.status === "pending_review" || d.status === "confirmed") && (
                    <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-lg border border-dashed">
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setShowReCrawl(!showReCrawl); setShowUpload(false); }}>
                        <RefreshCw className="h-3.5 w-3.5" /> 重新爬取
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setShowUpload(!showUpload); setShowReCrawl(false); }}>
                        <UploadCloud className="h-3.5 w-3.5" /> 上传图片
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 border-purple-200 text-purple-600 hover:bg-purple-50" onClick={() => reAnalyzeMutation.mutate({ setId: detailSetId! })} disabled={reAnalyzeMutation.isPending}>
                        {reAnalyzeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        重新AI分析
                      </Button>
                    </div>
                  )}

                  {/* ── Re-Crawl Panel ── */}
                  {showReCrawl && (
                    <Card className="border-blue-200 bg-blue-50/30">
                      <CardContent className="p-4 space-y-3">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <RefreshCw className="h-4 w-4 text-blue-500" /> 选择重新爬取的模块
                        </h4>
                        <p className="text-xs text-muted-foreground">勾选需要重新爬取的图片模块，系统将清除该模块旧图片并重新从亚马逊爬取</p>
                        <div className="flex flex-wrap gap-4">
                          {[
                            { key: "main", label: "主图", color: "blue", count: groupedImages.main.length },
                            { key: "secondary", label: "副图", color: "emerald", count: groupedImages.secondary.length },
                            { key: "aplus", label: "A+图片", color: "purple", count: groupedImages.aplus.length },
                            { key: "brand_story", label: "品牌故事图", color: "amber", count: groupedImages.brand_story.length },
                          ].map(item => (
                            <label key={item.key} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={reCrawlPositions.includes(item.key)}
                                onCheckedChange={(checked) => {
                                  setReCrawlPositions(prev => checked ? [...prev, item.key] : prev.filter(p => p !== item.key));
                                }}
                              />
                              <span className="text-sm">{item.label}</span>
                              <Badge variant="secondary" className="text-[10px]">现有{item.count}张</Badge>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => reCrawlMutation.mutate({ setId: detailSetId!, positions: reCrawlPositions as any })} disabled={reCrawlMutation.isPending || reCrawlPositions.length === 0} className="gap-1.5">
                            {reCrawlMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            开始重新爬取
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setShowReCrawl(false); setReCrawlPositions([]); }}>取消</Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* ── Upload Panel ── */}
                  {showUpload && (
                    <Card className="border-green-200 bg-green-50/30">
                      <CardContent className="p-4 space-y-3">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <UploadCloud className="h-4 w-4 text-green-500" /> 手动上传图片
                        </h4>
                        <div className="space-y-2">
                          <Label className="text-xs">图片位置</Label>
                          <Select value={uploadPosition} onValueChange={setUploadPosition}>
                            <SelectTrigger className="h-8 text-xs w-48"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="main">主图</SelectItem>
                              <SelectItem value="secondary">副图</SelectItem>
                              <SelectItem value="aplus">A+图片</SelectItem>
                              <SelectItem value="brand_story">品牌故事图</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div
                          className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/")); setUploadFiles(prev => [...prev, ...files]); }}
                          onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; input.multiple = true; input.onchange = (e) => { const files = Array.from((e.target as HTMLInputElement).files || []); setUploadFiles(prev => [...prev, ...files]); }; input.click(); }}
                        >
                          <UploadCloud className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                          <p className="text-sm text-muted-foreground">点击或拖拽图片到此处</p>
                          <p className="text-xs text-muted-foreground/70 mt-1">支持 JPG、PNG、WebP 格式，最多20张</p>
                        </div>
                        {uploadFiles.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {uploadFiles.map((file, i) => (
                              <div key={i} className="relative group">
                                <img src={URL.createObjectURL(file)} alt="" className="h-16 w-16 object-cover rounded border" />
                                <button className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setUploadFiles(prev => prev.filter((_, idx) => idx !== i)); }}>
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleUploadImages} disabled={uploadImagesMutation.isPending || uploadFiles.length === 0} className="gap-1.5">
                            {uploadImagesMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                            上传 {uploadFiles.length} 张图片
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setShowUpload(false); setUploadFiles([]); }}>取消</Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* ── Amazon-Style Gallery (Main + Secondary + Brand Story + A+) ── */}
                  <div className="-mx-6">
                  <AmazonStyleGallery
                    mainImages={groupedImages.main}
                    secondaryImages={groupedImages.secondary}
                    brandStoryImages={groupedImages.brand_story}
                    aplusImages={groupedImages.aplus}
                    onSelectImage={setSelectedImageId}
                    selectedImageId={selectedImageId}
                    onDeleteImage={allowEdit ? (imageId) => deleteImageMutation.mutate({ imageId, setId: detailSetId! }) : undefined}
                    allowEdit={allowEdit}
                    onReorder={allowEdit ? (imageOrders) => reorderImagesMutation.mutate({ setId: detailSetId!, imageOrders }) : undefined}
                    renderTagEditor={(img) => {
                      return (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            <Select value={img.tagImageBelong || ""} onValueChange={(v) => updateImageTagsMutation.mutate({ imageId: img.id, tagImageBelong: v, tagImageBelongSub: "" })}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="图片归属" /></SelectTrigger>
                              <SelectContent>
                                {(dbTags.imageBelongOptions.length > 0 ? dbTags.imageBelongOptions : IMAGE_BELONG_OPTIONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {img.tagImageBelong === "A+" && (
                              <Select value={(img as any).tagImageBelongSub || ""} onValueChange={(v) => updateImageTagsMutation.mutate({ imageId: img.id, tagImageBelongSub: v })}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="A+子模块" /></SelectTrigger>
                                <SelectContent>
                                  {(dbTags.imageBelongHierarchy?.["A+"] || IMAGE_BELONG_HIERARCHY["A+"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                            <Select value={img.tagImageTypeMain || ""} onValueChange={(v) => updateImageTagsMutation.mutate({ imageId: img.id, tagImageTypeMain: v, tagImageTypeSub: "" })}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="图片大类" /></SelectTrigger>
                              <SelectContent>
                                {(dbTags.imageTypeMainOptions.length > 0 ? dbTags.imageTypeMainOptions : IMAGE_TYPE_MAIN_OPTIONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Select value={img.tagImageTypeSub || ""} onValueChange={(v) => updateImageTagsMutation.mutate({ imageId: img.id, tagImageTypeSub: v })}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="图片子类" /></SelectTrigger>
                              <SelectContent>
                                {(img.tagImageTypeMain && (dbTags.imageTypeHierarchy[img.tagImageTypeMain] || IMAGE_TYPE_HIERARCHY[img.tagImageTypeMain]) ? (dbTags.imageTypeHierarchy[img.tagImageTypeMain] || IMAGE_TYPE_HIERARCHY[img.tagImageTypeMain]) : Object.values(dbTags.imageTypeHierarchy).flat().length > 0 ? Object.values(dbTags.imageTypeHierarchy).flat() : Object.values(IMAGE_TYPE_HIERARCHY).flat()).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Select value={img.tagSellingPointCategory || ""} onValueChange={(v) => updateImageTagsMutation.mutate({ imageId: img.id, tagSellingPointCategory: v })}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="卖点大类" /></SelectTrigger>
                              <SelectContent>
                                {(dbTags.sellingPointMainOptions.length > 0 ? dbTags.sellingPointMainOptions : SELLING_POINT_MAIN_OPTIONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Select value={img.tagSellingPointDetail || ""} onValueChange={(v) => updateImageTagsMutation.mutate({ imageId: img.id, tagSellingPointDetail: v })}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="卖点明细" /></SelectTrigger>
                              <SelectContent>
                                {(img.tagSellingPointCategory && (dbTags.sellingPointHierarchy[img.tagSellingPointCategory] || SELLING_POINT_HIERARCHY[img.tagSellingPointCategory]) ? (dbTags.sellingPointHierarchy[img.tagSellingPointCategory] || SELLING_POINT_HIERARCHY[img.tagSellingPointCategory]) : Object.values(dbTags.sellingPointHierarchy).flat().length > 0 ? Object.values(dbTags.sellingPointHierarchy).flat() : Object.values(SELLING_POINT_HIERARCHY).flat()).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Select value={img.tagComposition || ""} onValueChange={(v) => updateImageTagsMutation.mutate({ imageId: img.id, tagComposition: v })}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="构图类型" /></SelectTrigger>
                              <SelectContent>
                                {(dbTags.compositionOptions.length > 0 ? dbTags.compositionOptions : COMPOSITION_OPTIONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <ScoreSlider
                            value={img.singleImageScore || 5}
                            onChange={() => {}}
                            onSave={(val) => updateImageScoreMutation.mutate({ imageId: img.id, score: val })}
                            min={1}
                            max={10}
                            label="单图评分"
                            disabled={updateImageScoreMutation.isPending}
                          />
                          <ImageDimensionAnalysisPanel imageId={img.id} />
                        </div>
                      );
                    }}
                  />
                  </div>



                  {/* ── Set Style Configuration (Phase 6) ── */}
                  <Card className="border-indigo-200/50 bg-gradient-to-br from-indigo-50/30 to-purple-50/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Palette className="h-4 w-4 text-indigo-500" /> 套图风格配置
                        {d.setStyle && <Badge variant="secondary" className="text-[10px] bg-indigo-100 text-indigo-700">{d.setStyle}</Badge>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">推荐风格</Label>
                          <Select
                            value={d.setStyle || ""}
                            onValueChange={(val) => {
                              const params = dbTags.styleParamsMap[val];
                              updateSetStyleMutation.mutate({
                                id: detailSetId!,
                                setStyle: val,
                                setStyleParams: params ? JSON.stringify(params) : null,
                              });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择风格" /></SelectTrigger>
                            <SelectContent>
                              {dbTags.styleOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">主颜色</Label>
                          <Select
                            value={d.setPrimaryColor || ""}
                            onValueChange={(val) => updateSetStyleMutation.mutate({ id: detailSetId!, setPrimaryColor: val })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择主色" /></SelectTrigger>
                            <SelectContent>
                              {COLOR_TAG_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">提亮色</Label>
                          <Select
                            value={d.setAccentColor || ""}
                            onValueChange={(val) => updateSetStyleMutation.mutate({ id: detailSetId!, setAccentColor: val })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择提亮色" /></SelectTrigger>
                            <SelectContent>
                              {COLOR_TAG_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">套图类目</Label>
                          <Select
                            value={d.setCategory || ""}
                            onValueChange={(val) => updateSetStyleMutation.mutate({ id: detailSetId!, setCategory: val })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择类目" /></SelectTrigger>
                            <SelectContent>
                              {CATEGORY_OPTIONS_V2.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {/* Structured style params display */}
                      {(() => {
                        let styleParams: any = null;
                        try { styleParams = JSON.parse(d.setStyleParams || ""); } catch {}
                        if (!styleParams && d.setStyle) styleParams = dbTags.styleParamsMap[d.setStyle];
                        if (!styleParams) return null;
                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3 bg-white/60 rounded-lg border border-indigo-100">
                            <div className="space-y-1">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">光线类型</span>
                              <p className="text-xs">{styleParams.lightType}</p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">色温范围</span>
                              <p className="text-xs">{styleParams.colorTemp}</p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">材质关键词</span>
                              <p className="text-xs">{styleParams.materialKeywords}</p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">禁忌元素</span>
                              <p className="text-xs text-destructive/80">{styleParams.tabooElements}</p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">参考品牌</span>
                              <p className="text-xs">{styleParams.refBrands}</p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">AI生图关键词</span>
                              <p className="text-xs font-mono text-indigo-600/80 break-all">{styleParams.aiKeywords}</p>
                            </div>
                          </div>
                        );
                      })()}
                      {/* Target audience & category scene */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">目标人群</Label>
                          <Input
                            className="h-8 text-xs"
                            placeholder="如：25-35岁女性、注重生活品质"
                            defaultValue={d.setTargetAudience || ""}
                            onBlur={(e) => {
                              if (e.target.value !== (d.setTargetAudience || "")) {
                                updateSetStyleMutation.mutate({ id: detailSetId!, setTargetAudience: e.target.value || null });
                              }
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">类目场景</Label>
                          <Input
                            className="h-8 text-xs"
                            placeholder="如：室内家居、厨房场景"
                            defaultValue={d.setCategoryScene || ""}
                            onBlur={(e) => {
                              if (e.target.value !== (d.setCategoryScene || "")) {
                                updateSetStyleMutation.mutate({ id: detailSetId!, setCategoryScene: e.target.value || null });
                              }
                            }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

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
                    {allowEdit && (d.status === "confirmed" || d.reviewStatus === "draft" || d.reviewStatus === "rejected") && (
                      <Button variant="outline" size="sm" onClick={() => submitReviewMutation.mutate({ type: "image", id: detailSetId!, visibility: "team" })} disabled={submitReviewMutation.isPending} className="gap-1.5 border-blue-200 text-blue-600 hover:bg-blue-50">
                        {submitReviewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        提交审核
                      </Button>
                    )}
                    {allowDelete && (
                      <Button variant="destructive" size="sm" onClick={() => { if (confirm("确定删除整个图片集？")) deleteMutation.mutate({ id: detailSetId! }); }} className="gap-1.5">
                        <Trash2 className="h-3.5 w-3.5" /> 删除
                      </Button>
                    )}
                  </div>
                </div>
              </>
            );
          })() : (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
        </DialogContent>
      </Dialog>
      </>
      )}
    </div>
  );
}

/** Thumbnail strip for ASIN card - uses pre-fetched thumbnailImages from listSets */
function AsinThumbnailStrip({ thumbnailImages }: { thumbnailImages?: { id: number; imageUrl: string; imagePosition: string; positionIndex?: number | null }[] }) {
  const displayImages = (thumbnailImages || []).slice(0, 5);

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
function ImageCardEnhanced({ img, onSelectImage, selectedImageId, onUpdateTags, onUpdateScore, onDeleteImage, tagOptions }: {
  img: any;
  onSelectImage: (id: number | null) => void;
  selectedImageId: number | null;
  onUpdateTags: any;
  onUpdateScore: any;
  onDeleteImage?: (imageId: number) => void;
  tagOptions?: ReturnType<typeof import('@/hooks/useKBTagOptions').useKBTagOptions>;
}) {
  const isExpanded = selectedImageId === img.id;
  // Lazy-load heavy analysis data only when card is expanded
  const { data: analysisData } = trpc.kbImages.getImageAnalysis.useQuery(
    { imageId: img.id },
    { enabled: isExpanded, staleTime: 300_000 } // 5min cache per image
  );
  // Merge lazy-loaded analysis into img (lightweight img has null aiDimensionAnalysis)
  const imgWithAnalysis = isExpanded && analysisData
    ? { ...img, aiDimensionAnalysis: (analysisData as any).aiDimensionAnalysis, userEditedDimensionAnalysis: (analysisData as any).userEditedDimensionAnalysis }
    : img;
  let dimensions: any = {};
  try { dimensions = JSON.parse(imgWithAnalysis.aiDimensionAnalysis || "{}"); } catch {}

  return (
    <div className={`rounded-lg overflow-hidden bg-muted border transition-all ${isExpanded ? "ring-2 ring-primary col-span-full" : ""}`}>
      <div className="relative cursor-pointer group/card" onClick={() => onSelectImage(isExpanded ? null : img.id)}>
        <img src={img.imageUrl} alt="" className={`w-full ${isExpanded ? "max-h-80 object-contain bg-black/5" : "aspect-square object-cover"}`} loading="lazy" />
        {onDeleteImage && (
          <button
            className="absolute top-1.5 right-1.5 z-10 bg-destructive/90 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover/card:opacity-100 transition-opacity shadow-sm"
            onClick={(e) => { e.stopPropagation(); if (confirm("确定删除这张图片？")) onDeleteImage(img.id); }}
            title="删除图片"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
          <div className="flex flex-wrap gap-1">
            {img.tagImageBelong && <Badge variant="secondary" className="text-[9px] bg-blue-500/70 text-white border-0">{img.tagImageBelong}{(img as any).tagImageBelongSub ? `·${(img as any).tagImageBelongSub}` : ''}</Badge>}
            {img.tagImageTypeMain && <Badge variant="secondary" className="text-[9px] bg-purple-500/70 text-white border-0">{img.tagImageTypeMain}{img.tagImageTypeSub ? `·${img.tagImageTypeSub}` : ''}</Badge>}
            {img.tagSellingPointCategory && <Badge variant="secondary" className="text-[9px] bg-green-500/70 text-white border-0">{img.tagSellingPointCategory}</Badge>}
            {img.tagComposition && <Badge variant="secondary" className="text-[9px] bg-orange-500/70 text-white border-0">{img.tagComposition}</Badge>}
            {img.tagDesignStyleV2 && <Badge variant="secondary" className="text-[9px] bg-pink-500/70 text-white border-0">{img.tagDesignStyleV2}</Badge>}
            {!img.tagImageBelong && img.tagCategory && <Badge variant="secondary" className="text-[9px] bg-white/20 text-white border-0">{img.tagCategory}</Badge>}
            {!img.tagImageBelong && img.tagImageType && <Badge variant="secondary" className="text-[9px] bg-white/20 text-white border-0">{img.tagImageType}</Badge>}
            {img.singleImageScore && <Badge className="text-[9px] bg-primary/80 border-0">{img.singleImageScore}/10</Badge>}
          </div>
        </div>
        {img.imagePosition !== "main" && (
          <Badge variant="outline" className="absolute top-1.5 left-1.5 text-[9px] bg-white/80 backdrop-blur-sm">
            {img.imagePosition === "aplus" ? "A+" : img.imagePosition === "brand_story" ? "品牌故事" : `#${img.positionIndex}`}
          </Badge>
        )}
        {img.aplusModuleType && img.aplusModuleType !== "unknown" && (
          <Badge className={`absolute top-8 right-1.5 text-[9px] border-0 backdrop-blur-sm ${
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
        <div className="p-4 bg-card border-t space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Select value={img.tagImageBelong || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagImageBelong: v, tagImageBelongSub: "" })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="图片归属" /></SelectTrigger>
              <SelectContent>
                {(tagOptions?.imageBelongOptions || IMAGE_BELONG_OPTIONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            {img.tagImageBelong === "A+" && (
              <Select value={(img as any).tagImageBelongSub || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagImageBelongSub: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="A+子模块" /></SelectTrigger>
                <SelectContent>
                  {(tagOptions?.imageBelongHierarchy?.["A+"] || IMAGE_BELONG_HIERARCHY["A+"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={img.tagImageTypeMain || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagImageTypeMain: v, tagImageTypeSub: "" })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="图片大类" /></SelectTrigger>
              <SelectContent>
                {(tagOptions?.imageTypeMainOptions || IMAGE_TYPE_MAIN_OPTIONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={img.tagImageTypeSub || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagImageTypeSub: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="图片子类" /></SelectTrigger>
              <SelectContent>
                {(img.tagImageTypeMain && (tagOptions?.imageTypeHierarchy || IMAGE_TYPE_HIERARCHY)[img.tagImageTypeMain] ? (tagOptions?.imageTypeHierarchy || IMAGE_TYPE_HIERARCHY)[img.tagImageTypeMain] : Object.values(tagOptions?.imageTypeHierarchy || IMAGE_TYPE_HIERARCHY).flat()).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={img.tagSellingPointCategory || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagSellingPointCategory: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="卖点大类" /></SelectTrigger>
              <SelectContent>
                {(tagOptions?.sellingPointMainOptions || SELLING_POINT_MAIN_OPTIONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={img.tagSellingPointDetail || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagSellingPointDetail: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="卖点明细" /></SelectTrigger>
              <SelectContent>
                {(img.tagSellingPointCategory && (tagOptions?.sellingPointHierarchy || SELLING_POINT_HIERARCHY)[img.tagSellingPointCategory] ? (tagOptions?.sellingPointHierarchy || SELLING_POINT_HIERARCHY)[img.tagSellingPointCategory] : Object.values(tagOptions?.sellingPointHierarchy || SELLING_POINT_HIERARCHY).flat()).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={img.tagComposition || ""} onValueChange={(v) => onUpdateTags.mutate({ imageId: img.id, tagComposition: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="构图类型" /></SelectTrigger>
              <SelectContent>
                {(tagOptions?.compositionOptions || COMPOSITION_OPTIONS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

          </div>
          <ScoreSlider
            value={img.singleImageScore || 5}
            onChange={() => {}}
            onSave={(val) => onUpdateScore.mutate({ imageId: img.id, score: val })}
            min={1}
            max={10}
            label="单图评分"
            disabled={onUpdateScore.isPending}
          />
          {/* 12-dimension analysis: lazy-loaded when card is expanded */}
          {isExpanded && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                12维度分析
                {!analysisData && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </h5>
              {analysisData && Object.keys(dimensions).length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                    const dim = dimensions[key];
                    if (!dim) return null;
                    const analysis = typeof dim === "string" ? dim : dim?.analysis || dim?.content || JSON.stringify(dim);
                    return (
                      <div key={key} className="bg-muted/50 rounded-md p-2">
                        <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
                        <p className="text-xs mt-0.5 line-clamp-2">{analysis}</p>
                      </div>
                    );
                  })}
                </div>
              ) : analysisData ? (
                <p className="text-xs text-muted-foreground">暂无12维度分析数据</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Sortable wrapper for ImageCardEnhanced using @dnd-kit */
function SortableImageCard({ img, onSelectImage, selectedImageId, onUpdateTags, onUpdateScore, onDeleteImage, tagOptions }: {
  img: any;
  onSelectImage: (id: number | null) => void;
  selectedImageId: number | null;
  onUpdateTags: any;
  onUpdateScore: any;
  onDeleteImage?: (imageId: number) => void;
  tagOptions?: ReturnType<typeof import('@/hooks/useKBTagOptions').useKBTagOptions>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  const isExpanded = selectedImageId === img.id;
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={isExpanded ? "col-span-full" : ""}>
      <ImageCardEnhanced img={img} onSelectImage={onSelectImage} selectedImageId={selectedImageId} onUpdateTags={onUpdateTags} onUpdateScore={onUpdateScore} onDeleteImage={onDeleteImage} tagOptions={tagOptions} />
    </div>
  );
}

/** Sortable grid for a group of images */
function SortableImageGrid({ images, gridCols, onSelectImage, selectedImageId, onUpdateTags, onUpdateScore, onDeleteImage, onReorder, tagOptions }: {
  images: any[];
  gridCols: string;
  onSelectImage: (id: number | null) => void;
  selectedImageId: number | null;
  onUpdateTags: any;
  onUpdateScore: any;
  onDeleteImage?: (imageId: number) => void;
  onReorder?: (newOrder: { id: number; positionIndex: number }[]) => void;
  tagOptions?: ReturnType<typeof import('@/hooks/useKBTagOptions').useKBTagOptions>;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    setItems([...images].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0)));
  }, [images]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newItems = arrayMove(items, oldIndex, newIndex);
    setItems(newItems);
    if (onReorder) {
      onReorder(newItems.map((item, idx) => ({ id: item.id, positionIndex: idx + 1 })));
    }
  };

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;

  if (!onReorder) {
    return (
      <div className={`grid ${gridCols} gap-3`}>
        {items.map((img) => (
          <ImageCardEnhanced key={img.id} img={img} onSelectImage={onSelectImage} selectedImageId={selectedImageId} onUpdateTags={onUpdateTags} onUpdateScore={onUpdateScore} onDeleteImage={onDeleteImage} tagOptions={tagOptions} />
        ))}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className={`grid ${gridCols} gap-3`}>
          {items.map((img) => (
            <SortableImageCard key={img.id} img={img} onSelectImage={onSelectImage} selectedImageId={selectedImageId} onUpdateTags={onUpdateTags} onUpdateScore={onUpdateScore} onDeleteImage={onDeleteImage} tagOptions={tagOptions} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeItem ? (
          <div className="rounded-lg overflow-hidden shadow-2xl ring-2 ring-primary opacity-90">
            <img src={activeItem.imageUrl} alt="" className="w-32 h-32 object-cover" />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Lazy-loaded 12-dimension analysis panel — only fetches data when rendered (i.e., when user opens tag editor) */
function ImageDimensionAnalysisPanel({ imageId }: { imageId: number }) {
  const { data: analysisData, isLoading } = trpc.kbImages.getImageAnalysis.useQuery(
    { imageId },
    { staleTime: 300_000 } // 5min cache per image
  );
  let dimensions: any = {};
  try { dimensions = JSON.parse((analysisData as any)?.aiDimensionAnalysis || "{}"); } catch {}

  return (
    <div className="space-y-2">
      <h5 className="text-xs font-semibold flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-purple-500" />
        12维度分析
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </h5>
      {!isLoading && Object.keys(dimensions).length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
            const dim = dimensions[key];
            if (!dim) return null;
            const analysis = typeof dim === "string" ? dim : dim?.analysis || dim?.content || JSON.stringify(dim);
            return (
              <div key={key} className="bg-muted/50 rounded-md p-2">
                <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
                <p className="text-xs mt-0.5 line-clamp-2">{analysis}</p>
              </div>
            );
          })}
        </div>
      ) : !isLoading ? (
        <p className="text-xs text-muted-foreground">暂无12维度分析数据</p>
      ) : null}
    </div>
  );
}
