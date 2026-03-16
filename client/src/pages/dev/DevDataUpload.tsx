import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  BarChart3,
  MessageSquare,
  TrendingUp,
  FileText,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  projectId: number;
  onDataUploaded?: () => void;
}

const FILE_TYPES = [
  {
    key: "sales" as const,
    label: "搜索结果/销量数据",
    desc: "卖家精灵 Search 导出文件，包含ASIN、价格、评分、月销量等",
    icon: TrendingUp,
    accept: ".xlsx,.xls,.csv",
    example: "Search(air-line-kit)-99-US-*.xlsx",
  },
  {
    key: "bullet_points" as const,
    label: "标题五点数据",
    desc: "卖家精灵 Bullet Points 导出文件，包含竞品Listing文案",
    icon: FileText,
    accept: ".xlsx,.xls,.csv",
    example: "US-Bullet-Points(*)-*.xlsx",
  },
  {
    key: "reviews" as const,
    label: "评论数据",
    desc: "卖家精灵 Reviews 导出文件，支持批量上传多个ASIN的评论文件",
    icon: MessageSquare,
    accept: ".xlsx,.xls,.csv",
    example: "B0*-US-Reviews-*.xlsx（支持多文件）",
    multiple: true,
  },
  {
    key: "history_sales" as const,
    label: "历史销量数据",
    desc: "卖家精灵 Product Sales 导出文件，包含月度销售额趋势",
    icon: BarChart3,
    accept: ".xlsx,.xls,.csv",
    example: "US-product-sales-*.xlsx",
  },
];

type FileType = typeof FILE_TYPES[number]["key"];

interface UploadState {
  status: "idle" | "reading" | "parsing" | "uploading" | "saving" | "done" | "error";
  fileName?: string;
  recordCount?: number;
  error?: string;
}

export default function DevDataUpload({ projectId, onDataUploaded }: Props) {
  const [uploadStates, setUploadStates] = useState<Record<FileType, UploadState>>({
    sales: { status: "idle" },
    bullet_points: { status: "idle" },
    reviews: { status: "idle" },
    history_sales: { status: "idle" },
  });

  const utils = trpc.useUtils();
  const uploadFileMutation = trpc.devProject.uploadFile.useMutation();
  const saveProductsMutation = trpc.devProject.saveProducts.useMutation();
  const saveReviewsMutation = trpc.devProject.saveReviews.useMutation();

  const updateState = useCallback((fileType: FileType, update: Partial<UploadState>) => {
    setUploadStates(prev => ({ ...prev, [fileType]: { ...prev[fileType], ...update } }));
  }, []);

  const handleFileSelect = useCallback(async (fileType: FileType, file: File) => {
    updateState(fileType, { status: "reading", fileName: file.name, error: undefined });

    try {
      // 1. Read file
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      // 2. Upload to S3
      updateState(fileType, { status: "uploading" });
      await uploadFileMutation.mutateAsync({
        projectId,
        fileName: file.name,
        fileType,
        fileData: base64,
      });

      // 3. Parse Excel
      updateState(fileType, { status: "parsing" });
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

      if (rows.length === 0) {
        updateState(fileType, { status: "error", error: "文件为空或格式不正确" });
        return;
      }

      // 4. Save parsed data based on file type
      updateState(fileType, { status: "saving" });

      if (fileType === "sales") {
        await parseSalesData(rows);
      } else if (fileType === "bullet_points") {
        await parseBulletPointsData(rows);
      } else if (fileType === "reviews") {
        await parseReviewsData(rows);
      } else if (fileType === "history_sales") {
        await parseHistorySalesData(rows, workbook);
      }

      updateState(fileType, { status: "done", recordCount: rows.length });
      toast.success(`${FILE_TYPES.find(f => f.key === fileType)?.label}解析成功，共 ${rows.length} 条记录`);
      utils.devProject.getById.invalidate({ id: projectId });
      utils.devProject.getProducts.invalidate({ projectId });
      onDataUploaded?.();
    } catch (err: any) {
      updateState(fileType, { status: "error", error: err.message || "解析失败" });
      toast.error(`解析失败: ${err.message}`);
    }
  }, [projectId, uploadFileMutation, saveProductsMutation, saveReviewsMutation, utils, onDataUploaded, updateState]);

  // ─── Parse Sales Data (Search results) ───
  const parseSalesData = async (rows: any[]) => {
    const products = rows.map((r: any) => {
      // Map seller wizard column names (Chinese/English)
      // Support 卖家精灵 export format with $ suffixes and various naming conventions
      const asin = r["ASIN"] || r["asin"] || "";
      if (!asin) return null;

      // Helper: try multiple column names, return first non-empty value
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          if (r[k] !== undefined && r[k] !== "") return r[k];
        }
        return "";
      };
      const pickNum = (...keys: string[]) => {
        for (const k of keys) {
          const v = Number(r[k]);
          if (!isNaN(v) && r[k] !== "" && r[k] !== undefined) return v;
        }
        return 0;
      };

      return {
        asin,
        title: pick("商品标题", "标题", "Title", "title"),
        brand: pick("品牌", "Brand", "brand"),
        price: String(pick("价格($)", "价格", "Price", "price") || ""),
        rating: String(pick("评分", "Rating", "rating") || ""),
        reviewCount: pickNum("评分数", "评论数", "Reviews", "Review Count", "reviews"),
        monthlySales: pickNum("月销量", "Monthly Sales", "Est. Monthly Sales"),
        bsr: pickNum("小类BSR", "大类BSR", "BSR", "Best Sellers Rank", "bsr"),
        monthlyRevenue: pickNum("月销售额($)", "月销售额", "Monthly Revenue", "Est. Monthly Revenue"),
        listingDate: pick("上架时间", "Date First Available", "Listing Date"),
        fulfillment: pick("配送方式", "Fulfillment", "FBA/FBM"),
        sellerName: pick("Buybox卖家", "卖家", "Seller", "Seller Name"),
        sellerLocation: pick("卖家所属地", "卖家所在地", "Seller Location"),
        variantCount: pickNum("变体数", "Variants", "Variation Count"),
        category: pick("大类目", "类目路径", "类目", "Category", "Main Category"),
        subcategory: pick("小类目", "子类目", "Sub Category", "Subcategory"),
        imageUrl: pick("商品主图", "图片", "Image", "Main Image"),
        searchRank: pickNum("搜索排名", "Search Rank", "Rank", "序号", "#"),
        // Extended fields from 卖家精灵
        bulletPoints: pick("产品卖点", "Bullet Points"),
        specifications: pick("详细参数", "SKU"),
      };
    }).filter(Boolean) as any[];

    if (products.length > 0) {
      // Batch save in chunks of 50
      for (let i = 0; i < products.length; i += 50) {
        await saveProductsMutation.mutateAsync({
          projectId,
          products: products.slice(i, i + 50),
        });
      }
    }
  };

  // ─── Parse Bullet Points Data ───
  const parseBulletPointsData = async (rows: any[]) => {
    const products = rows.map((r: any) => {
      const asin = r["ASIN"] || r["asin"] || "";
      if (!asin) return null;
      // Combine bullet points
      const bullets = [];
      for (let i = 1; i <= 10; i++) {
        const b = r[`卖点${i}`] || r[`Bullet ${i}`] || r[`Bullet Point ${i}`] || r[`bullet_${i}`] || "";
        if (b) bullets.push(b);
      }
      // Also try combined field
      const combinedBullets = r["五点描述"] || r["Bullet Points"] || r["bulletPoints"] || "";
      const bulletText = bullets.length > 0 ? bullets.join("\n") : combinedBullets;

      return {
        asin,
        title: r["标题"] || r["Title"] || r["title"] || "",
        brand: r["品牌"] || r["Brand"] || r["brand"] || "",
        price: String(r["价格"] || r["Price"] || r["price"] || ""),
        rating: String(r["评分"] || r["Rating"] || r["rating"] || ""),
        reviewCount: Number(r["评论数"] || r["Reviews"] || r["Review Count"] || 0),
        bulletPoints: bulletText,
        description: r["描述"] || r["Description"] || r["description"] || "",
      };
    }).filter(Boolean) as any[];

    if (products.length > 0) {
      for (let i = 0; i < products.length; i += 50) {
        await saveProductsMutation.mutateAsync({
          projectId,
          products: products.slice(i, i + 50),
        });
      }
    }
  };

  // ─── Parse Reviews Data ───
  const parseReviewsData = async (rows: any[]) => {
    const reviews = rows.map((r: any) => ({
      asin: r["ASIN"] || r["asin"] || "",
      title: r["标题"] || r["Title"] || r["Review Title"] || "",
      content: r["内容"] || r["Content"] || r["Review Content"] || r["Review"] || "",
      rating: Number(r["评分"] || r["Rating"] || r["Star Rating"] || r["Stars"] || 0),
      reviewDate: r["日期"] || r["Date"] || r["Review Date"] || "",
      isVP: Boolean(r["VP"] || r["Verified Purchase"] || r["verified_purchase"]),
      variant: r["变体"] || r["Variant"] || r["Size"] || r["Color"] || "",
      helpfulCount: Number(r["有用数"] || r["Helpful"] || r["Helpful Votes"] || 0),
    })).filter((r: any) => r.content || r.title);

    if (reviews.length > 0) {
      for (let i = 0; i < reviews.length; i += 100) {
        await saveReviewsMutation.mutateAsync({
          projectId,
          reviews: reviews.slice(i, i + 100),
        });
      }
    }
  };

  // ─── Parse History Sales Data ───
  const parseHistorySalesData = async (rows: any[], workbook: any) => {
    const XLSX = await import("xlsx");
    // Try to find monthly sales sheet
    const monthlySheet = workbook.Sheets["产品历史月销售额"] || workbook.Sheets["Monthly Sales"] || workbook.Sheets[workbook.SheetNames[1]];
    let monthlyRows: any[] = [];
    if (monthlySheet) {
      monthlyRows = XLSX.utils.sheet_to_json(monthlySheet, { defval: "" });
    }

    // Build monthly history map by ASIN
    const historyMap: Record<string, any> = {};
    if (monthlyRows.length > 0) {
      for (const r of monthlyRows) {
        const asin = r["ASIN"] || r["asin"] || "";
        if (!asin) continue;
        // Collect all month columns
        const salesHistory: Record<string, number> = {};
        const revenueHistory: Record<string, number> = {};
        for (const [key, val] of Object.entries(r)) {
          if (key.match(/\d{4}[-/]\d{1,2}/) || key.match(/^\d{4}年\d{1,2}月/)) {
            salesHistory[key] = Number(val) || 0;
          }
        }
        historyMap[asin] = { salesHistory, revenueHistory };
      }
    }

    // Parse main sheet products
    const products = rows.map((r: any) => {
      const asin = r["ASIN"] || r["asin"] || "";
      if (!asin) return null;
      const history = historyMap[asin];
      return {
        asin,
        title: r["标题"] || r["Title"] || r["title"] || "",
        brand: r["品牌"] || r["Brand"] || r["brand"] || "",
        price: String(r["价格"] || r["Price"] || r["price"] || ""),
        monthlySales: Number(r["月销量"] || r["Monthly Sales"] || 0),
        monthlyRevenue: Number(r["月销售额"] || r["Monthly Revenue"] || 0),
        monthlySalesHistory: history ? JSON.stringify(history.salesHistory) : undefined,
        monthlyRevenueHistory: history ? JSON.stringify(history.revenueHistory) : undefined,
      };
    }).filter(Boolean) as any[];

    if (products.length > 0) {
      for (let i = 0; i < products.length; i += 50) {
        await saveProductsMutation.mutateAsync({
          projectId,
          products: products.slice(i, i + 50),
        });
      }
    }
  };

  // Handle batch file upload for reviews
  const handleBatchFileSelect = useCallback(async (fileType: FileType, files: FileList) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    updateState(fileType, {
      status: "reading",
      fileName: `${fileArray.length} 个文件`,
      error: undefined,
    });

    try {
      let totalRecords = 0;
      const XLSX = await import("xlsx");

      for (let fi = 0; fi < fileArray.length; fi++) {
        const file = fileArray[fi];
        updateState(fileType, {
          status: "parsing",
          fileName: `处理中 (${fi + 1}/${fileArray.length}): ${file.name}`,
        });

        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        // Upload to S3
        await uploadFileMutation.mutateAsync({
          projectId,
          fileName: file.name,
          fileType,
          fileData: base64,
        });

        // Parse Excel
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

        if (rows.length === 0) continue;

        // Try to extract ASIN from filename (e.g., B0G2WP66RW-US-Reviews-xxx.xlsx)
        const asinMatch = file.name.match(/^(B[A-Z0-9]{9,})/i);
        const fileAsin = asinMatch ? asinMatch[1].toUpperCase() : "";

        // Parse reviews
        const reviews = rows.map((r: any) => ({
          asin: r["ASIN"] || r["asin"] || fileAsin || "",
          title: r["标题"] || r["Title"] || r["Review Title"] || "",
          content: r["内容"] || r["Content"] || r["Review Content"] || r["Review"] || r["评论内容"] || "",
          rating: Number(r["评分"] || r["Rating"] || r["Star Rating"] || r["Stars"] || r["星级"] || 0),
          reviewDate: r["日期"] || r["Date"] || r["Review Date"] || r["评论日期"] || "",
          isVP: Boolean(r["VP"] || r["Verified Purchase"] || r["verified_purchase"] || r["认证购买"]),
          variant: r["变体"] || r["Variant"] || r["Size"] || r["Color"] || r["颜色"] || r["尺寸"] || "",
          helpfulCount: Number(r["有用数"] || r["Helpful"] || r["Helpful Votes"] || 0),
        })).filter((r: any) => r.content || r.title);

        if (reviews.length > 0) {
          for (let i = 0; i < reviews.length; i += 100) {
            await saveReviewsMutation.mutateAsync({
              projectId,
              reviews: reviews.slice(i, i + 100),
            });
          }
          totalRecords += reviews.length;
        }
      }

      updateState(fileType, {
        status: "done",
        fileName: `${fileArray.length} 个文件`,
        recordCount: totalRecords,
      });
      toast.success(`评论数据批量上传成功，共 ${fileArray.length} 个文件，${totalRecords} 条评论`);
      utils.devProject.getById.invalidate({ id: projectId });
      utils.devProject.getProducts.invalidate({ projectId });
      onDataUploaded?.();
    } catch (err: any) {
      updateState(fileType, { status: "error", error: err.message || "批量解析失败" });
      toast.error(`批量解析失败: ${err.message}`);
    }
  }, [projectId, uploadFileMutation, saveReviewsMutation, utils, onDataUploaded, updateState]);

  const handleDrop = useCallback((fileType: FileType, e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const ftConfig = FILE_TYPES.find(f => f.key === fileType);
    if (ftConfig && 'multiple' in ftConfig && ftConfig.multiple && files.length > 1) {
      handleBatchFileSelect(fileType, files);
    } else {
      handleFileSelect(fileType, files[0]);
    }
  }, [handleFileSelect, handleBatchFileSelect]);

  const handleInputChange = useCallback((fileType: FileType, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Check if this file type supports batch upload
    const ftConfig = FILE_TYPES.find(f => f.key === fileType);
    if (ftConfig && 'multiple' in ftConfig && ftConfig.multiple && files.length > 1) {
      handleBatchFileSelect(fileType, files);
    } else {
      handleFileSelect(fileType, files[0]);
    }
    e.target.value = ""; // Reset input
  }, [handleFileSelect, handleBatchFileSelect]);

  const totalDone = Object.values(uploadStates).filter(s => s.status === "done").length;
  const totalRecords = Object.values(uploadStates).reduce((sum, s) => sum + (s.recordCount || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Upload className="h-4 w-4" />
            卖家精灵数据上传
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            上传4种卖家精灵导出的Excel文件，系统将自动解析并入库
          </p>
        </div>
        {totalDone > 0 && (
          <Badge variant="secondary" className="text-xs">
            已上传 {totalDone}/4 · {totalRecords} 条记录
          </Badge>
        )}
      </div>

      {totalDone > 0 && (
        <Progress value={(totalDone / 4) * 100} className="h-1.5" />
      )}

      {/* File Upload Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FILE_TYPES.map((ft) => {
          const state = uploadStates[ft.key];
          const Icon = ft.icon;
          const isProcessing = ["reading", "parsing", "uploading", "saving"].includes(state.status);

          return (
            <Card key={ft.key} className={`transition-all ${state.status === "done" ? "border-emerald-200 dark:border-emerald-800" : ""}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {ft.label}
                  </span>
                  {state.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {state.status === "error" && <AlertCircle className="h-4 w-4 text-red-500" />}
                  {isProcessing && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">{ft.desc}</p>

                {state.status === "done" ? (
                  <div className="flex items-center justify-between p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-md">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                      <div>
                        <p className="text-xs font-medium truncate max-w-[180px]">{state.fileName}</p>
                        <p className="text-xs text-muted-foreground">{state.recordCount} 条记录</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => updateState(ft.key, { status: "idle", fileName: undefined, recordCount: undefined })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : state.status === "error" ? (
                  <div className="space-y-2">
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-md">
                      <p className="text-xs text-red-600">{state.error}</p>
                    </div>
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept={ft.accept}
                        className="hidden"
                        onChange={(e) => handleInputChange(ft.key, e)}
                      />
                      <Button size="sm" variant="outline" className="w-full gap-1" asChild>
                        <span><Upload className="h-3.5 w-3.5" />重新上传</span>
                      </Button>
                    </label>
                  </div>
                ) : isProcessing ? (
                  <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs">
                      {state.status === "reading" && "读取文件..."}
                      {state.status === "uploading" && "上传文件..."}
                      {state.status === "parsing" && "解析数据..."}
                      {state.status === "saving" && "保存数据..."}
                    </span>
                  </div>
                ) : (
                  <label
                    className="cursor-pointer block"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(ft.key, e)}
                  >
                    <input
                      type="file"
                      accept={ft.accept}
                      className="hidden"
                      multiple={'multiple' in ft && ft.multiple ? true : undefined}
                      onChange={(e) => handleInputChange(ft.key, e)}
                    />
                    <div className="border-2 border-dashed border-muted-foreground/20 rounded-lg p-4 text-center hover:border-primary/40 transition-colors">
                      <Upload className="h-5 w-5 mx-auto text-muted-foreground/40 mb-1" />
                      <p className="text-xs text-muted-foreground">
                        {'multiple' in ft && ft.multiple ? '拖拽或点击批量上传' : '拖拽或点击上传'}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">格式: {ft.example}</p>
                    </div>
                  </label>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
