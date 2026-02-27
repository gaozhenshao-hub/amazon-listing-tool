import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  Search,
  Loader2,
  AlertTriangle,
  TrendingUp,
  MessageSquare,
  Key,
  Trash2,
  ChevronDown,
  ChevronUp,
  Globe,
  DollarSign,
  Star,
  Zap,
  Package,
  CheckCircle2,
  XCircle,
  Clock,
  List,
  PenLine,
  ArrowRight,
  RotateCcw,
  FileSpreadsheet,
  Upload,
  FileCheck,
  Info,
} from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";

type BatchItemStatus = "pending" | "scraping" | "analyzing" | "done" | "failed";

interface BatchItem {
  asin: string;
  status: BatchItemStatus;
  title?: string;
  error?: string;
}

type InputMode = "auto" | "manual" | "import";

interface FilePreview {
  filename: string;
  totalRows: number;
  parsedRows: number;
  skippedRows: number;
  detectedFormat: string;
  columns: string[];
  previewReviews: Array<{
    title?: string;
    content: string;
    rating?: number;
    date?: string;
    author?: string;
  }>;
}

export default function AnalysisPage() {
  const { selectedProjectId } = useProject();
  const [asinInput, setAsinInput] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef(false);

  // Manual input mode state
  const [inputMode, setInputMode] = useState<InputMode>("auto");
  const [manualAsin, setManualAsin] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualBulletPoints, setManualBulletPoints] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualRating, setManualRating] = useState("");
  const [manualReviews, setManualReviews] = useState("");
  const [manualBrand, setManualBrand] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [failedAsin, setFailedAsin] = useState<string | null>(null);

  // Import mode state
  const [importAsin, setImportAsin] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [importBrand, setImportBrand] = useState("");
  const [importBulletPoints, setImportBulletPoints] = useState("");
  const [importPrice, setImportPrice] = useState("");
  const [importRating, setImportRating] = useState("");
  const [importFileBase64, setImportFileBase64] = useState<string | null>(null);
  const [importFilename, setImportFilename] = useState<string>("");
  const [importPreview, setImportPreview] = useState<FilePreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: analyses, isLoading: loadingAnalyses } = trpc.analysis.listByProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();

  const analyzeAsin = trpc.analysis.analyzeAsin.useMutation();
  const analyzeManual = trpc.analysis.analyzeManual.useMutation();
  const importReviews = trpc.analysis.importReviews.useMutation();
  const previewReviewFile = trpc.analysis.previewReviewFile.useMutation();

  const deleteAnalysis = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
      toast.success("分析记录已删除");
    },
  });

  // Parse ASINs from input
  const parseAsins = useCallback((input: string): string[] => {
    return input
      .toUpperCase()
      .split(/[\s,;\n]+/)
      .map(s => s.trim())
      .filter(s => s.length === 10 && /^[A-Z0-9]{10}$/.test(s));
  }, []);

  const parsedAsins = parseAsins(asinInput);
  const uniqueAsins = Array.from(new Set(parsedAsins));

  // Switch to manual mode with failed ASIN pre-filled
  const switchToManualMode = useCallback((asin?: string) => {
    setInputMode("manual");
    if (asin) {
      setManualAsin(asin);
      setFailedAsin(asin);
    }
  }, []);

  // Switch back to auto mode
  const switchToAutoMode = useCallback(() => {
    setInputMode("auto");
    setFailedAsin(null);
  }, []);

  // Switch to import mode
  const switchToImportMode = useCallback(() => {
    setInputMode("import");
    setFailedAsin(null);
  }, []);

  // Reset manual form
  const resetManualForm = useCallback(() => {
    setManualAsin("");
    setManualTitle("");
    setManualBulletPoints("");
    setManualPrice("");
    setManualRating("");
    setManualReviews("");
    setManualBrand("");
    setManualDescription("");
    setFailedAsin(null);
  }, []);

  // Reset import form
  const resetImportForm = useCallback(() => {
    setImportAsin("");
    setImportTitle("");
    setImportBrand("");
    setImportBulletPoints("");
    setImportPrice("");
    setImportRating("");
    setImportFileBase64(null);
    setImportFilename("");
    setImportPreview(null);
  }, []);

  // Handle file selection for import
  const handleFileSelect = useCallback(async (file: File) => {
    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/csv",
    ];
    const validExtensions = [".xlsx", ".xls", ".csv"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();

    if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
      toast.error("不支持的文件格式", {
        description: "请上传 Excel (.xlsx/.xls) 或 CSV (.csv) 文件",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件过大", {
        description: "文件大小不能超过 10MB",
      });
      return;
    }

    // Read file as base64
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      setImportFileBase64(base64);
      setImportFilename(file.name);

      // Auto-preview the file
      setIsPreviewing(true);
      try {
        const preview = await previewReviewFile.mutateAsync({
          fileBase64: base64,
          filename: file.name,
        });
        setImportPreview(preview as FilePreview);
        toast.success(`文件解析成功`, {
          description: `识别到 ${preview.parsedRows} 条评论，格式: ${preview.detectedFormat}`,
        });
      } catch (error: any) {
        toast.error("文件预览失败", {
          description: error.message,
        });
        setImportFileBase64(null);
        setImportFilename("");
      } finally {
        setIsPreviewing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [previewReviewFile]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  // Handle import submit
  const handleImportSubmit = useCallback(async () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }

    const asin = importAsin.trim().toUpperCase();
    if (asin.length !== 10 || !/^[A-Z0-9]{10}$/.test(asin)) {
      toast.error("请输入有效的10位ASIN码");
      return;
    }

    if (!importFileBase64) {
      toast.error("请先上传评论文件");
      return;
    }

    setIsProcessing(true);
    setBatchItems([{ asin, status: "analyzing" }]);

    try {
      const result = await importReviews.mutateAsync({
        projectId: selectedProjectId,
        asin,
        fileBase64: importFileBase64,
        filename: importFilename,
        title: importTitle.trim() || undefined,
        bulletPoints: importBulletPoints.trim() || undefined,
        price: importPrice.trim() || undefined,
        rating: importRating.trim() || undefined,
        brand: importBrand.trim() || undefined,
      });

      setBatchItems([{ asin, status: "done", title: result.title || "导入分析完成" }]);
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });

      const stats = result.reviewStats;
      toast.success("评论导入分析完成", {
        description: `已导入 ${stats?.parsedRows || 0} 条评论并完成AI分析`,
      });
      resetImportForm();
    } catch (error: any) {
      setBatchItems([{ asin, status: "failed", error: error.message }]);
      toast.error("导入分析失败: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedProjectId, importAsin, importFileBase64, importFilename, importTitle, importBulletPoints, importPrice, importRating, importBrand, importReviews, utils, resetImportForm]);

  // Handle manual input analysis
  const handleManualAnalyze = useCallback(async () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }

    const asin = manualAsin.trim().toUpperCase();
    if (asin.length !== 10 || !/^[A-Z0-9]{10}$/.test(asin)) {
      toast.error("请输入有效的10位ASIN码");
      return;
    }

    if (!manualTitle.trim() && !manualBulletPoints.trim() && !manualReviews.trim()) {
      toast.error("请至少填写标题、五点描述或评论中的一项");
      return;
    }

    setIsProcessing(true);
    setBatchItems([{ asin, status: "analyzing" }]);

    try {
      const result = await analyzeManual.mutateAsync({
        projectId: selectedProjectId,
        asin,
        title: manualTitle.trim() || undefined,
        bulletPoints: manualBulletPoints.trim() || undefined,
        price: manualPrice.trim() || undefined,
        rating: manualRating.trim() || undefined,
        reviews: manualReviews.trim() || undefined,
        brand: manualBrand.trim() || undefined,
        description: manualDescription.trim() || undefined,
      });

      setBatchItems([{ asin, status: "done", title: result.title || "分析完成" }]);
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
      toast.success("手动输入分析完成", {
        description: `已成功分析 ${asin} 的产品数据`,
      });
      resetManualForm();
    } catch (error: any) {
      setBatchItems([{ asin, status: "failed", error: error.message }]);
      toast.error("分析失败: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedProjectId, manualAsin, manualTitle, manualBulletPoints, manualPrice, manualRating, manualReviews, manualBrand, manualDescription, analyzeManual, utils, resetManualForm]);

  // Process batch sequentially on the frontend
  const handleBatchAnalyze = useCallback(async () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }

    if (uniqueAsins.length === 0) {
      toast.error("请输入有效的10位ASIN码");
      return;
    }

    if (uniqueAsins.length > 20) {
      toast.error("单次最多支持20个ASIN");
      return;
    }

    const items: BatchItem[] = uniqueAsins.map(asin => ({
      asin,
      status: "pending" as BatchItemStatus,
    }));
    setBatchItems(items);
    setIsProcessing(true);
    abortRef.current = false;

    let successCount = 0;
    let failCount = 0;
    const failedAsins: string[] = [];

    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) break;

      setBatchItems(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: "scraping" } : item
      ));

      setTimeout(() => {
        setBatchItems(prev => prev.map((item, idx) =>
          idx === i && item.status === "scraping" ? { ...item, status: "analyzing" } : item
        ));
      }, 3000);

      try {
        const result = await analyzeAsin.mutateAsync({
          projectId: selectedProjectId,
          asin: items[i].asin,
        });

        setBatchItems(prev => prev.map((item, idx) =>
          idx === i ? {
            ...item,
            status: "done",
            title: result.title || "分析完成",
          } : item
        ));
        successCount++;
      } catch (error: any) {
        setBatchItems(prev => prev.map((item, idx) =>
          idx === i ? {
            ...item,
            status: "failed",
            error: error.message || "分析失败",
          } : item
        ));
        failCount++;
        failedAsins.push(items[i].asin);
      }

      if (i < items.length - 1 && !abortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setIsProcessing(false);
    utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });

    if (abortRef.current) {
      toast.info("批量分析已取消");
    } else {
      toast.success(`批量分析完成`, {
        description: `成功 ${successCount} 个，失败 ${failCount} 个，共 ${items.length} 个ASIN`,
      });
      if (failedAsins.length > 0) {
        toast.info("部分ASIN爬取失败", {
          description: "您可以切换到手动输入或评论导入模式进行分析",
          duration: 8000,
        });
      }
    }

    setAsinInput("");
  }, [selectedProjectId, uniqueAsins, analyzeAsin, utils]);

  // Single ASIN analysis
  const handleSingleAnalyze = useCallback(async () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }

    if (uniqueAsins.length === 0) {
      toast.error("请输入有效的10位ASIN码");
      return;
    }

    if (uniqueAsins.length > 1) {
      handleBatchAnalyze();
      return;
    }

    const asin = uniqueAsins[0];
    setBatchItems([{ asin, status: "scraping" }]);
    setIsProcessing(true);

    setTimeout(() => {
      setBatchItems(prev => prev.map(item =>
        item.status === "scraping" ? { ...item, status: "analyzing" } : item
      ));
    }, 3000);

    try {
      const result = await analyzeAsin.mutateAsync({
        projectId: selectedProjectId,
        asin,
      });

      setBatchItems([{ asin, status: "done", title: result.title || "分析完成" }]);
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
      toast.success("竞品分析完成", {
        description: `已成功爬取并分析 ${asin} 的产品数据`,
      });
      setAsinInput("");
    } catch (error: any) {
      setBatchItems([{ asin, status: "failed", error: error.message }]);
      toast.error("自动爬取失败", {
        description: "您可以切换到手动输入或评论导入模式进行分析",
        duration: 6000,
      });
      setFailedAsin(asin);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedProjectId, uniqueAsins, analyzeAsin, utils, handleBatchAnalyze]);

  const handleCancel = () => {
    abortRef.current = true;
  };

  const parseJson = (str: string | null) => {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  };

  const getStatusIcon = (status: BatchItemStatus) => {
    switch (status) {
      case "pending": return <Clock className="h-4 w-4 text-muted-foreground" />;
      case "scraping": return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "analyzing": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "done": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusText = (status: BatchItemStatus) => {
    switch (status) {
      case "pending": return "等待中";
      case "scraping": return "爬取数据中...";
      case "analyzing": return "AI分析中...";
      case "done": return "完成";
      case "failed": return "失败";
    }
  };

  const batchProgress = batchItems.length > 0
    ? Math.round((batchItems.filter(i => i.status === "done" || i.status === "failed").length / batchItems.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">竞品分析</h1>
          <p className="text-muted-foreground mt-1">
            输入竞品ASIN，自动爬取产品数据并进行AI深度分析
          </p>
        </div>
        <ProjectSelector />
      </div>

      {!selectedProjectId ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">请先在项目管理中创建并选择一个项目</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Input Form */}
          <div className="lg:col-span-2 space-y-4">
            {/* Mode Switcher - 3 modes */}
            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                  inputMode === "auto"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted/50"
                }`}
                onClick={switchToAutoMode}
                disabled={isProcessing}
              >
                <Zap className="h-3.5 w-3.5" />
                自动爬取
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-x ${
                  inputMode === "import"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted/50"
                }`}
                onClick={switchToImportMode}
                disabled={isProcessing}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                评论导入
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                  inputMode === "manual"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted/50"
                }`}
                onClick={() => switchToManualMode()}
                disabled={isProcessing}
              >
                <PenLine className="h-3.5 w-3.5" />
                手动输入
              </button>
            </div>

            {/* ═══════════════ Auto-scrape Mode ═══════════════ */}
            {inputMode === "auto" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      自动爬取分析
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setIsBatchMode(!isBatchMode)}
                      disabled={isProcessing}
                    >
                      <List className="h-3.5 w-3.5 mr-1" />
                      {isBatchMode ? "单个模式" : "批量模式"}
                    </Button>
                  </div>
                  <CardDescription>
                    {isBatchMode
                      ? "输入多个ASIN码（每行一个，或用逗号/空格分隔），最多20个。"
                      : "输入ASIN码，工具将自动从亚马逊爬取产品数据并进行AI深度分析。"
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>竞品ASIN *</Label>
                      {uniqueAsins.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {uniqueAsins.length} 个ASIN
                        </Badge>
                      )}
                    </div>
                    {isBatchMode ? (
                      <Textarea
                        placeholder={"每行一个ASIN，或用逗号/空格分隔\n例如:\nB0XXXXXXXXX\nB0YYYYYYYYY\nB0ZZZZZZZZZ"}
                        value={asinInput}
                        onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
                        disabled={isProcessing}
                        className="font-mono text-sm tracking-wider min-h-[120px]"
                        rows={6}
                      />
                    ) : (
                      <Input
                        placeholder="例如: B0XXXXXXXXX"
                        value={asinInput}
                        onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !isProcessing) handleSingleAnalyze();
                        }}
                        disabled={isProcessing}
                        className="font-mono text-base tracking-wider"
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {isBatchMode
                        ? `已识别 ${uniqueAsins.length} 个有效ASIN（最多20个）`
                        : "输入10位亚马逊产品标识码，支持输入多个自动切换批量模式"
                      }
                    </p>
                  </div>

                  {/* Batch Progress */}
                  {isProcessing && batchItems.length > 0 && (
                    <BatchProgressDisplay
                      batchItems={batchItems}
                      batchProgress={batchProgress}
                      getStatusIcon={getStatusIcon}
                      getStatusText={getStatusText}
                      onCancel={handleCancel}
                      onManualSwitch={switchToManualMode}
                    />
                  )}

                  {/* Failed ASIN - offer manual fallback */}
                  {!isProcessing && failedAsin && inputMode === "auto" && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-amber-800">
                            ASIN {failedAsin} 自动爬取失败
                          </p>
                          <p className="text-xs text-amber-600 mt-1">
                            亚马逊可能限制了数据访问。您可以切换到评论导入模式导入卖家精灵数据，或手动输入产品信息。
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 border-amber-300 text-amber-800 hover:bg-amber-100"
                          onClick={() => {
                            setImportAsin(failedAsin);
                            switchToImportMode();
                          }}
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
                          导入评论
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 border-amber-300 text-amber-800 hover:bg-amber-100"
                          onClick={() => switchToManualMode(failedAsin)}
                        >
                          <PenLine className="h-3.5 w-3.5 mr-1.5" />
                          手动输入
                        </Button>
                      </div>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={uniqueAsins.length > 1 ? handleBatchAnalyze : handleSingleAnalyze}
                    disabled={isProcessing || uniqueAsins.length === 0}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {batchItems.length > 1 ? "批量分析中..." : "自动爬取分析中..."}
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-2" />
                        {uniqueAsins.length > 1
                          ? `批量爬取 & 分析 (${uniqueAsins.length}个)`
                          : "一键爬取 & 分析"
                        }
                      </>
                    )}
                  </Button>

                  <div className="pt-2 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">自动爬取内容：</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { icon: Package, label: "产品标题" },
                        { icon: TrendingUp, label: "五点描述" },
                        { icon: DollarSign, label: "价格信息" },
                        { icon: Star, label: "评分评论" },
                        { icon: Key, label: "关键词提取" },
                        { icon: MessageSquare, label: "痛点分析" },
                      ].map(({ icon: Icon, label }) => (
                        <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Icon className="h-3 w-3 text-primary/60" />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ═══════════════ Import Mode ═══════════════ */}
            {inputMode === "import" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4" />
                      评论表格导入
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={resetImportForm}
                      disabled={isProcessing}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      重置
                    </Button>
                  </div>
                  <CardDescription>
                    导入从卖家精灵（SellerSprite）等工具下载的评论Excel/CSV文件，自动解析并进行AI分析。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Tip */}
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                    <div className="text-xs text-blue-700 space-y-1">
                      <p className="font-medium">支持的文件格式：</p>
                      <p>Excel (.xlsx/.xls) 和 CSV (.csv) 文件，自动识别卖家精灵、Helium 10等工具导出的评论格式。</p>
                    </div>
                  </div>

                  {/* ASIN */}
                  <div className="space-y-1.5">
                    <Label className="text-sm">竞品ASIN *</Label>
                    <Input
                      placeholder="例如: B0XXXXXXXXX"
                      value={importAsin}
                      onChange={(e) => setImportAsin(e.target.value.toUpperCase())}
                      disabled={isProcessing}
                      className="font-mono text-base tracking-wider"
                    />
                    <p className="text-xs text-muted-foreground">输入该评论文件对应的产品ASIN</p>
                  </div>

                  {/* File Upload Area */}
                  <div className="space-y-1.5">
                    <Label className="text-sm">评论文件 *</Label>
                    <div
                      className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                        isDragOver
                          ? "border-primary bg-primary/5"
                          : importFileBase64
                            ? "border-green-300 bg-green-50"
                            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
                      }`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileSelect(file);
                          e.target.value = "";
                        }}
                        disabled={isProcessing}
                      />

                      {isPreviewing ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <p className="text-sm text-muted-foreground">解析文件中...</p>
                        </div>
                      ) : importFileBase64 && importPreview ? (
                        <div className="flex flex-col items-center gap-2">
                          <FileCheck className="h-8 w-8 text-green-600" />
                          <p className="text-sm font-medium text-green-800">{importFilename}</p>
                          <div className="flex gap-3 text-xs text-green-700">
                            <span>格式: {importPreview.detectedFormat}</span>
                            <span>·</span>
                            <span>{importPreview.parsedRows} 条评论</span>
                            {importPreview.skippedRows > 0 && (
                              <>
                                <span>·</span>
                                <span>{importPreview.skippedRows} 行跳过</span>
                              </>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">点击或拖拽更换文件</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <Upload className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm font-medium">拖拽文件到此处，或点击选择</p>
                          <p className="text-xs text-muted-foreground">支持 .xlsx / .xls / .csv 格式，最大 10MB</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* File Preview */}
                  {importPreview && importPreview.previewReviews.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm">评论预览（前5条）</Label>
                      <div className="max-h-[200px] overflow-y-auto space-y-2">
                        {importPreview.previewReviews.map((review, i) => (
                          <div key={i} className="p-2.5 bg-muted/30 rounded-lg border text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-muted-foreground">#{i + 1}</span>
                              {review.rating && (
                                <Badge variant="secondary" className="text-xs h-5">
                                  <Star className="h-3 w-3 mr-0.5 fill-amber-400 text-amber-400" />
                                  {review.rating}
                                </Badge>
                              )}
                              {review.date && (
                                <span className="text-muted-foreground">{review.date}</span>
                              )}
                            </div>
                            {review.title && (
                              <p className="font-medium text-sm mb-0.5">{review.title}</p>
                            )}
                            <p className="text-muted-foreground leading-relaxed">{review.content}</p>
                          </div>
                        ))}
                      </div>
                      {importPreview.parsedRows > 5 && (
                        <p className="text-xs text-muted-foreground text-center">
                          还有 {importPreview.parsedRows - 5} 条评论未显示
                        </p>
                      )}
                    </div>
                  )}

                  {/* Detected columns */}
                  {importPreview && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">识别到的列名</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {importPreview.columns.filter(c => c.trim()).map((col, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{col}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <Separator />

                  {/* Optional product info */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground font-medium">
                      补充产品信息（可选，有助于提高分析质量）
                    </Label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">品牌</Label>
                      <Input
                        placeholder="例如: Anker"
                        value={importBrand}
                        onChange={(e) => setImportBrand(e.target.value)}
                        disabled={isProcessing}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">价格</Label>
                      <Input
                        placeholder="$29.99"
                        value={importPrice}
                        onChange={(e) => setImportPrice(e.target.value)}
                        disabled={isProcessing}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">产品标题</Label>
                    <Input
                      placeholder="粘贴竞品标题（可选）"
                      value={importTitle}
                      onChange={(e) => setImportTitle(e.target.value)}
                      disabled={isProcessing}
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">评分</Label>
                    <Input
                      placeholder="4.5"
                      value={importRating}
                      onChange={(e) => setImportRating(e.target.value)}
                      disabled={isProcessing}
                      className="h-8 text-sm w-24"
                    />
                  </div>

                  {/* Progress */}
                  {isProcessing && batchItems.length > 0 && (
                    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm font-medium">导入评论并AI分析中...</span>
                      </div>
                      <Progress value={50} className="h-2" />
                      <p className="text-xs text-muted-foreground">
                        正在解析 {importPreview?.parsedRows || 0} 条评论并进行痛点/痒点/爽点分析...
                      </p>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleImportSubmit}
                    disabled={isProcessing || !importAsin.trim() || !importFileBase64}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        导入分析中...
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        导入评论 & AI分析
                        {importPreview && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            {importPreview.parsedRows} 条
                          </Badge>
                        )}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ═══════════════ Manual Input Mode ═══════════════ */}
            {inputMode === "manual" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <PenLine className="h-4 w-4" />
                      手动输入产品数据
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={resetManualForm}
                      disabled={isProcessing}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      重置
                    </Button>
                  </div>
                  <CardDescription>
                    从亚马逊产品页面复制粘贴产品信息，工具将基于您提供的数据进行AI分析。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {failedAsin && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
                        ASIN <span className="font-mono font-bold">{failedAsin}</span> 自动爬取失败，请手动粘贴该产品的信息。
                      </p>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-sm">竞品ASIN *</Label>
                    <Input
                      placeholder="例如: B0XXXXXXXXX"
                      value={manualAsin}
                      onChange={(e) => setManualAsin(e.target.value.toUpperCase())}
                      disabled={isProcessing}
                      className="font-mono text-base tracking-wider"
                    />
                    <p className="text-xs text-muted-foreground">10位亚马逊产品标识码</p>
                  </div>

                  <Separator />

                  <div className="space-y-1.5">
                    <Label className="text-sm">品牌名称</Label>
                    <Input
                      placeholder="例如: Anker"
                      value={manualBrand}
                      onChange={(e) => setManualBrand(e.target.value)}
                      disabled={isProcessing}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm">竞品标题</Label>
                    <Textarea
                      placeholder="粘贴竞品的产品标题..."
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      disabled={isProcessing}
                      rows={3}
                    />
                    {manualTitle && (
                      <p className="text-xs text-muted-foreground">{manualTitle.length} 字符</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm">五点描述（Bullet Points）</Label>
                    <Textarea
                      placeholder={"粘贴竞品的五点描述，每条一行...\n\n例如:\n【PREMIUM QUALITY】High-grade material...\n【EASY TO USE】Simply plug in and...\n【VERSATILE DESIGN】Works with..."}
                      value={manualBulletPoints}
                      onChange={(e) => setManualBulletPoints(e.target.value)}
                      disabled={isProcessing}
                      rows={6}
                      className="text-sm"
                    />
                    {manualBulletPoints && (
                      <p className="text-xs text-muted-foreground">
                        {manualBulletPoints.split("\n").filter(l => l.trim()).length} 条描述
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm">价格</Label>
                      <Input
                        placeholder="$29.99"
                        value={manualPrice}
                        onChange={(e) => setManualPrice(e.target.value)}
                        disabled={isProcessing}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">评分</Label>
                      <Input
                        placeholder="4.5"
                        value={manualRating}
                        onChange={(e) => setManualRating(e.target.value)}
                        disabled={isProcessing}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm">产品描述</Label>
                    <Textarea
                      placeholder="粘贴产品详情页的描述内容（可选）..."
                      value={manualDescription}
                      onChange={(e) => setManualDescription(e.target.value)}
                      disabled={isProcessing}
                      rows={3}
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm">客户评论内容</Label>
                    <Textarea
                      placeholder={"粘贴客户评论内容，用于痛点/痒点/爽点分析...\n\n建议粘贴10-20条有代表性的评论，包含好评和差评"}
                      value={manualReviews}
                      onChange={(e) => setManualReviews(e.target.value)}
                      disabled={isProcessing}
                      rows={6}
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      建议粘贴10-20条有代表性的评论，包含好评和差评
                    </p>
                  </div>

                  {/* Progress */}
                  {isProcessing && batchItems.length > 0 && (
                    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm font-medium">AI分析中...</span>
                      </div>
                      <Progress value={50} className="h-2" />
                    </div>
                  )}

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleManualAnalyze}
                    disabled={isProcessing || !manualAsin.trim()}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        AI分析中...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        提交手动数据 & 分析
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    至少填写标题、五点描述或评论中的一项即可进行分析
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ═══════════════ Results Panel ═══════════════ */}
          <div className="lg:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">分析结果</h2>
              {analyses && analyses.length > 0 && (
                <Badge variant="secondary">{analyses.length} 条分析</Badge>
              )}
            </div>

            {loadingAnalyses ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <Card key={i}><CardContent className="p-6"><div className="h-24 bg-muted animate-pulse rounded" /></CardContent></Card>
                ))}
              </div>
            ) : !analyses || analyses.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Search className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">暂无分析结果</p>
                  <p className="text-muted-foreground text-xs mt-1">输入竞品ASIN开始自动爬取分析，或导入评论文件</p>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-4 pr-4">
                  {analyses.map((analysis) => {
                    const isExpanded = expandedId === analysis.id;
                    const keywords = parseJson(analysis.keywords);
                    const reviewData = parseJson(analysis.reviewAnalysis);
                    const rawData = parseJson(analysis.rawData);
                    const bulletPoints = parseJson(analysis.bulletPoints);
                    const scrapedInfo = rawData?.scrapedData;
                    const isManual = rawData?.manualInput === true;
                    const isImported = rawData?.importedReviews === true;
                    const reviewImport = rawData?.reviewImport;

                    return (
                      <Card key={analysis.id} className="overflow-hidden">
                        <CardHeader
                          className="cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setExpandedId(isExpanded ? null : analysis.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <Badge variant="outline" className="font-mono shrink-0">
                                  {analysis.asin}
                                </Badge>
                                {isImported && (
                                  <Badge variant="secondary" className="text-xs shrink-0 bg-blue-100 text-blue-700">
                                    <FileSpreadsheet className="h-3 w-3 mr-0.5" />
                                    评论导入
                                  </Badge>
                                )}
                                {isManual && !isImported && (
                                  <Badge variant="secondary" className="text-xs shrink-0 bg-amber-100 text-amber-700">
                                    <PenLine className="h-3 w-3 mr-0.5" />
                                    手动
                                  </Badge>
                                )}
                                {analysis.price && (
                                  <Badge variant="secondary" className="text-xs shrink-0">
                                    {analysis.price}
                                  </Badge>
                                )}
                                {analysis.rating && (
                                  <Badge variant="secondary" className="text-xs shrink-0">
                                    <Star className="h-3 w-3 mr-0.5 fill-amber-400 text-amber-400" />
                                    {analysis.rating}
                                  </Badge>
                                )}
                                {analysis.reviewCount && (
                                  <Badge variant="secondary" className="text-xs shrink-0">
                                    <MessageSquare className="h-3 w-3 mr-0.5" />
                                    {analysis.reviewCount} 评论
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate">
                                {analysis.title || "标题未提供"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteAnalysis.mutate({ id: analysis.id });
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                          </div>
                        </CardHeader>

                        {isExpanded && (
                          <CardContent className="pt-0">
                            {/* Import info banner */}
                            {isImported && reviewImport && (
                              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <div className="flex items-center gap-2 text-xs text-blue-700">
                                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                                  <span className="font-medium">评论来源: {reviewImport.filename}</span>
                                  <span>·</span>
                                  <span>格式: {reviewImport.detectedFormat}</span>
                                  <span>·</span>
                                  <span>已解析 {reviewImport.parsedRows} 条评论</span>
                                </div>
                              </div>
                            )}

                            {/* Scraped Data Summary */}
                            {(analysis.title || scrapedInfo) && (
                              <div className="mb-4 p-3 bg-muted/30 rounded-lg border">
                                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                  {isImported ? "导入数据摘要" : isManual ? "手动输入数据摘要" : "爬取数据摘要"}
                                </h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                  {scrapedInfo?.brand && (
                                    <div>
                                      <span className="text-xs text-muted-foreground">品牌</span>
                                      <p className="font-medium truncate">{scrapedInfo.brand}</p>
                                    </div>
                                  )}
                                  {analysis.price && (
                                    <div>
                                      <span className="text-xs text-muted-foreground">价格</span>
                                      <p className="font-medium">{analysis.price}</p>
                                    </div>
                                  )}
                                  {analysis.rating && (
                                    <div>
                                      <span className="text-xs text-muted-foreground">评分</span>
                                      <p className="font-medium">{analysis.rating}/5</p>
                                    </div>
                                  )}
                                  {(scrapedInfo?.reviewsCount != null || analysis.reviewCount) && (
                                    <div>
                                      <span className="text-xs text-muted-foreground">评论数</span>
                                      <p className="font-medium">{scrapedInfo?.reviewsCount || analysis.reviewCount} 条已分析</p>
                                    </div>
                                  )}
                                </div>
                                {bulletPoints && bulletPoints.length > 0 && (
                                  <div className="mt-3">
                                    <span className="text-xs text-muted-foreground">五点描述</span>
                                    <ul className="mt-1 space-y-1">
                                      {bulletPoints.slice(0, 5).map((bp: string, i: number) => (
                                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                          <span className="text-primary mt-0.5 shrink-0">•</span>
                                          <span className="line-clamp-2">{bp}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}

                            <Tabs defaultValue="keywords">
                              <TabsList className="w-full justify-start">
                                <TabsTrigger value="keywords">
                                  <Key className="h-3.5 w-3.5 mr-1.5" />
                                  关键词
                                </TabsTrigger>
                                <TabsTrigger value="reviews">
                                  <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                  评论分析
                                </TabsTrigger>
                                <TabsTrigger value="insights">
                                  <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                                  竞品洞察
                                </TabsTrigger>
                              </TabsList>

                              <TabsContent value="keywords" className="mt-4 space-y-4">
                                {keywords ? (
                                  <>
                                    {keywords.core && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">核心关键词</h4>
                                        <div className="flex flex-wrap gap-2">
                                          {keywords.core.map((k: any, i: number) => (
                                            <Badge key={i} variant="default" className="text-xs">
                                              {k.keyword || k}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {keywords.longTail && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">长尾关键词</h4>
                                        <div className="flex flex-wrap gap-2">
                                          {keywords.longTail.map((k: any, i: number) => (
                                            <Badge key={i} variant="secondary" className="text-xs">
                                              {k.keyword || k}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {keywords.traffic && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">流量关键词</h4>
                                        <div className="flex flex-wrap gap-2">
                                          {keywords.traffic.map((k: any, i: number) => (
                                            <Badge key={i} variant="outline" className="text-xs">
                                              {k.keyword || k}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-sm text-muted-foreground">暂无关键词数据</p>
                                )}
                              </TabsContent>

                              <TabsContent value="reviews" className="mt-4 space-y-4">
                                {reviewData ? (
                                  <>
                                    {reviewData.painPoints && reviewData.painPoints.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2 text-red-600">
                                          痛点 ({reviewData.painPoints.length})
                                        </h4>
                                        <div className="space-y-2">
                                          {reviewData.painPoints.map((p: any, i: number) => (
                                            <div key={i} className="p-3 bg-red-50 rounded-lg border border-red-100">
                                              <p className="text-sm font-medium text-red-800">{p.issue}</p>
                                              <div className="flex gap-2 mt-1">
                                                <Badge variant="outline" className="text-xs">频率: {p.frequency}</Badge>
                                                <Badge variant="outline" className="text-xs">严重度: {p.severity}</Badge>
                                              </div>
                                              {p.quotes && p.quotes.length > 0 && (
                                                <p className="text-xs text-red-600 mt-2 italic">"{p.quotes[0]}"</p>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {reviewData.itchPoints && reviewData.itchPoints.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2 text-amber-600">
                                          痒点 ({reviewData.itchPoints.length})
                                        </h4>
                                        <div className="space-y-2">
                                          {reviewData.itchPoints.map((p: any, i: number) => (
                                            <div key={i} className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                                              <p className="text-sm font-medium text-amber-800">{p.desire}</p>
                                              <Badge variant="outline" className="text-xs mt-1">重要性: {p.importance}</Badge>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {reviewData.delightPoints && reviewData.delightPoints.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2 text-green-600">
                                          爽点 ({reviewData.delightPoints.length})
                                        </h4>
                                        <div className="space-y-2">
                                          {reviewData.delightPoints.map((p: any, i: number) => (
                                            <div key={i} className="p-3 bg-green-50 rounded-lg border border-green-100">
                                              <p className="text-sm font-medium text-green-800">{p.feature}</p>
                                              <Badge variant="outline" className="text-xs mt-1">影响: {p.impact}</Badge>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-center py-6">
                                    <MessageSquare className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                                    <p className="text-sm text-muted-foreground">
                                      {isManual ? "未提供客户评论数据" : "未爬取到客户评论数据"}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      可使用「评论导入」功能导入卖家精灵下载的评论文件进行分析
                                    </p>
                                  </div>
                                )}
                              </TabsContent>

                              <TabsContent value="insights" className="mt-4 space-y-4">
                                {rawData ? (
                                  <>
                                    {rawData.titleAnalysis && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">标题分析</h4>
                                        <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                                          {rawData.titleAnalysis.brand && (
                                            <p><span className="font-medium">品牌:</span> {rawData.titleAnalysis.brand}</p>
                                          )}
                                          {rawData.titleAnalysis.mainKeywords && (
                                            <p><span className="font-medium">主要关键词:</span> {rawData.titleAnalysis.mainKeywords.join(", ")}</p>
                                          )}
                                          {rawData.titleAnalysis.features && (
                                            <p><span className="font-medium">特征:</span> {rawData.titleAnalysis.features.join(", ")}</p>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    {rawData.advantages && rawData.advantages.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">竞品优势</h4>
                                        <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                                          {rawData.advantages.map((a: string, i: number) => (
                                            <li key={i}>{a}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {rawData.weaknesses && rawData.weaknesses.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">竞品弱点</h4>
                                        <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                                          {rawData.weaknesses.map((w: string, i: number) => (
                                            <li key={i}>{w}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-sm text-muted-foreground">暂无竞品洞察数据</p>
                                )}
                              </TabsContent>
                            </Tabs>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Extracted batch progress component
function BatchProgressDisplay({
  batchItems,
  batchProgress,
  getStatusIcon,
  getStatusText,
  onCancel,
  onManualSwitch,
}: {
  batchItems: BatchItem[];
  batchProgress: number;
  getStatusIcon: (status: BatchItemStatus) => React.ReactNode;
  getStatusText: (status: BatchItemStatus) => string;
  onCancel: () => void;
  onManualSwitch: (asin: string) => void;
}) {
  return (
    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">
            {batchItems.length === 1
              ? getStatusText(batchItems[0].status)
              : `批量分析中 (${batchItems.filter(i => i.status === "done" || i.status === "failed").length}/${batchItems.length})`
            }
          </span>
        </div>
        {batchItems.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive"
            onClick={onCancel}
          >
            取消
          </Button>
        )}
      </div>
      <Progress value={batchProgress} className="h-2" />

      {batchItems.length > 1 && (
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {batchItems.map((item) => (
            <div
              key={item.asin}
              className={`flex items-center justify-between text-xs p-2 rounded ${
                item.status === "done" ? "bg-green-50 border border-green-100" :
                item.status === "failed" ? "bg-red-50 border border-red-100" :
                item.status === "scraping" || item.status === "analyzing" ? "bg-blue-50 border border-blue-100" :
                "bg-muted/20 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2">
                {getStatusIcon(item.status)}
                <span className="font-mono">{item.asin}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${
                  item.status === "done" ? "text-green-600" :
                  item.status === "failed" ? "text-red-600" :
                  "text-muted-foreground"
                }`}>
                  {item.status === "done" && item.title
                    ? item.title.substring(0, 30) + (item.title.length > 30 ? "..." : "")
                    : item.status === "failed" && item.error
                      ? item.error.substring(0, 30)
                      : getStatusText(item.status)
                  }
                </span>
                {item.status === "failed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-xs text-primary"
                    onClick={() => onManualSwitch(item.asin)}
                  >
                    手动输入
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {batchItems.length === 1 && (
        <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
          <span className={batchItems[0].status !== "pending" ? "text-primary font-medium" : ""}>
            爬取数据
          </span>
          <span className={batchItems[0].status === "analyzing" || batchItems[0].status === "done" ? "text-primary font-medium" : ""}>
            AI分析
          </span>
          <span className={batchItems[0].status === "done" ? "text-primary font-medium" : ""}>
            保存结果
          </span>
        </div>
      )}
    </div>
  );
}
