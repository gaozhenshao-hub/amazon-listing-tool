/**
 * Ad Report Upload Center
 * Unified upload interface for 5 types of ad reports:
 * 1. Search Term Report (领星)
 * 2. Campaign Report (领星)
 * 3. Placement Report (领星)
 * 4. Hourly Report (亚马逊 CSV)
 * 5. Order Report (领星 SC订单)
 */
import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload, FileSpreadsheet, CheckCircle2, Loader2, Trash2,
  ArrowUpFromLine, Search, BarChart3, MapPin, Clock, ShoppingCart,
  FileText, Info, Monitor,
} from "lucide-react";

type ReportType = "search_term" | "campaign" | "placement" | "hourly" | "order" | "dsp";

const REPORT_TYPES: { key: ReportType; label: string; icon: any; source: string; accept: string; desc: string }[] = [
  { key: "search_term", label: "搜索词报告", icon: Search, source: "领星导出", accept: ".xlsx,.xls", desc: "用户搜索词报告，支持搜索词12分类、趋势对比、否定词建议分析" },
  { key: "campaign", label: "广告活动报告", icon: BarChart3, source: "领星导出", accept: ".xlsx,.xls", desc: "广告活动报告，支持总览数据、预算分配、效果追踪分析" },
  { key: "placement", label: "广告位报告", icon: MapPin, source: "领星导出", accept: ".xlsx,.xls", desc: "广告位报告，支持首页/商品页/其他位置的效果分析" },
  { key: "hourly", label: "广告小时报告", icon: Clock, source: "亚马逊广告后台", accept: ".csv", desc: "亚马逊广告小时报告(CSV)，用于分时竞价策略和热力图分析" },
  { key: "order", label: "SC订单报告", icon: ShoppingCart, source: "领星导出", accept: ".xlsx,.xls", desc: "领星SC订单导出，用于分时出单分析（需含订购日期时间）" },
  { key: "dsp", label: "DSP广告报告", icon: Monitor, source: "Amazon DSP", accept: ".xlsx,.xls,.csv", desc: "Amazon DSP订单报告，用于DSP花费、ROAS、DPV等展示广告效果分析" },
];

function formatDate(d: Date | string | null) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ReportUploadCard({ reportType }: { reportType: typeof REPORT_TYPES[number] }) {
  const [uploading, setUploading] = useState(false);
  const [weekStartDate, setWeekStartDate] = useState("");
  const [weekEndDate, setWeekEndDate] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64OrText, setFileBase64OrText] = useState<string>("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  // Query upload history for this report type
  const uploadsQuery = trpc.adReportUpload.listUploads.useQuery({
    reportType: reportType.key,
    limit: 50,
  });

  // Upload mutations for each report type
  const uploadSearchTerm = trpc.adReportUpload.uploadSearchTermReport.useMutation();
  const uploadCampaign = trpc.adReportUpload.uploadCampaignReport.useMutation();
  const uploadPlacement = trpc.adReportUpload.uploadPlacementReport.useMutation();
  const uploadHourly = trpc.adReportUpload.uploadHourlyReport.useMutation();
  const uploadOrder = trpc.adReportUpload.uploadOrderReport.useMutation();
  const uploadDsp = trpc.adReportUpload.uploadDspReport.useMutation();

  const deleteMutation = trpc.adReportUpload.deleteUpload.useMutation({
    onSuccess: () => {
      toast.success("已删除导入记录及关联数据");
      uploadsQuery.refetch();
      setDeleteId(null);
    },
    onError: (err) => {
      toast.error("删除失败", { description: err.message });
      setDeleteId(null);
    },
  });

  const handleFileSelect = useCallback(async (file: File) => {
    setSelectedFile(file);
    if (reportType.key === "hourly") {
      // Hourly CSV: read as text for legacy compatibility
      const text = await file.text();
      setFileBase64OrText(text);
    } else {
      // Excel: read as base64
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      setFileBase64OrText(base64);
    }
  }, [reportType.key]);

  const handleUpload = async () => {
    if (!selectedFile || !fileBase64OrText) {
      toast.error("请先选择文件");
      return;
    }
    // Order report doesn't need date range (auto-detected from data)
    if (reportType.key !== "order" && reportType.key !== "hourly" && reportType.key !== "dsp" && (!weekStartDate || !weekEndDate)) {
      toast.error("请选择数据周期的起止日期");
      return;
    }

    setUploading(true);
    const label = dateLabel || (weekStartDate && weekEndDate ? `${weekStartDate} ~ ${weekEndDate}` : "");

    try {
      let result: any;
      switch (reportType.key) {
        case "search_term":
          result = await uploadSearchTerm.mutateAsync({
            fileBase64: fileBase64OrText,
            fileName: selectedFile.name,
            weekStartDate,
            weekEndDate,
            dateLabel: label,
          });
          break;
        case "campaign":
          result = await uploadCampaign.mutateAsync({
            fileBase64: fileBase64OrText,
            fileName: selectedFile.name,
            weekStartDate,
            weekEndDate,
            dateLabel: label,
          });
          break;
        case "placement":
          result = await uploadPlacement.mutateAsync({
            fileBase64: fileBase64OrText,
            fileName: selectedFile.name,
            weekStartDate,
            weekEndDate,
            dateLabel: label,
          });
          break;
        case "hourly":
          result = await uploadHourly.mutateAsync({
            csvText: fileBase64OrText,
            fileName: selectedFile.name,
            reportDate: weekStartDate || undefined,
            dateLabel: label || undefined,
          });
          break;
        case "order":
          result = await uploadOrder.mutateAsync({
            fileBase64: fileBase64OrText,
            fileName: selectedFile.name,
            dateLabel: label || undefined,
          });
          break;
        case "dsp":
          result = await uploadDsp.mutateAsync({
            fileBase64: fileBase64OrText,
            fileName: selectedFile.name,
            weekStartDate: weekStartDate || undefined,
            weekEndDate: weekEndDate || undefined,
            dateLabel: label || undefined,
          });
          break;
      }

      toast.success("导入成功", {
        description: `成功导入 ${result?.importedRows || result?.totalRows || 0} 行数据`,
      });
      setSelectedFile(null);
      setFileBase64OrText("");
      setWeekStartDate("");
      setWeekEndDate("");
      setDateLabel("");
      uploadsQuery.refetch();
    } catch (err: any) {
      toast.error("导入失败", { description: err.message });
    } finally {
      setUploading(false);
    }
  };

  const isOrderOrHourly = reportType.key === "order" || reportType.key === "hourly" || reportType.key === "dsp";

  return (
    <div className="space-y-4">
      {/* Upload Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <reportType.icon className="h-4 w-4 text-primary" />
            上传{reportType.label}
          </CardTitle>
          <CardDescription className="text-xs">
            {reportType.desc}
            <Badge variant="outline" className="ml-2 text-[10px]">{reportType.source}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Date Range */}
          {!isOrderOrHourly ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">周期开始日期</Label>
                <Input
                  type="date"
                  value={weekStartDate}
                  onChange={(e) => setWeekStartDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">周期结束日期</Label>
                <Input
                  type="date"
                  value={weekEndDate}
                  onChange={(e) => setWeekEndDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          ) : reportType.key === "hourly" ? (
            <div className="space-y-1">
              <Label className="text-xs">报告日期（可选，自动从数据中提取）</Label>
              <Input
                type="date"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
              <Info className="h-3.5 w-3.5 flex-shrink-0" />
              订单日期范围将从数据中自动提取
            </div>
          )}

          {/* Optional label */}
          <div className="space-y-1">
            <Label className="text-xs">数据标签（可选）</Label>
            <Input
              placeholder="例: 2026-W16 或 04/14-04/20"
              value={dateLabel}
              onChange={(e) => setDateLabel(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          {/* File Upload Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              selectedFile ? "border-green-300 bg-green-50/50" : "border-muted-foreground/20 hover:border-primary/40"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFileSelect(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={reportType.accept}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
            {selectedFile ? (
              <div className="space-y-1">
                <FileSpreadsheet className="h-8 w-8 text-green-600 mx-auto" />
                <p className="text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                    setFileBase64OrText("");
                  }}
                >
                  重新选择
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <ArrowUpFromLine className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-xs text-muted-foreground">
                  点击或拖拽上传 {reportType.accept} 文件
                </p>
              </div>
            )}
          </div>

          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading || (!isOrderOrHourly && (!weekStartDate || !weekEndDate))}
            className="w-full gap-2 h-9"
            size="sm"
          >
            {uploading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> 解析导入中...</>
            ) : (
              <><Upload className="h-4 w-4" /> 上传并导入</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Upload History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {reportType.label}导入历史
          </CardTitle>
        </CardHeader>
        <CardContent>
          {uploadsQuery.isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !uploadsQuery.data?.length ? (
            <div className="text-center py-6 text-muted-foreground">
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">暂无{reportType.label}导入记录</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">文件名</TableHead>
                    <TableHead className="text-xs">数据标签</TableHead>
                    <TableHead className="text-xs">店铺</TableHead>
                    <TableHead className="text-xs text-right">导入行数</TableHead>
                    <TableHead className="text-xs">状态</TableHead>
                    <TableHead className="text-xs">导入时间</TableHead>
                    <TableHead className="text-xs text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadsQuery.data.map((u: any) => (
                    <TableRow key={u.id}>
                      <TableCell className="max-w-[160px] truncate text-xs font-medium" title={u.fileName}>
                        {u.fileName}
                      </TableCell>
                      <TableCell className="text-xs">{u.dateLabel || `${u.weekStartDate || ""} ~ ${u.weekEndDate || ""}`}</TableCell>
                      <TableCell className="text-xs">{u.storeName || "-"}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{u.importedRows ?? u.totalRows ?? "-"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={u.status === "completed" ? "default" : u.status === "failed" ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {u.status === "completed" ? "已完成" : u.status === "failed" ? "失败" : "处理中"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(u.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将同步清除该次导入的所有{reportType.label}数据，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) deleteMutation.mutate({ uploadId: deleteId });
              }}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function AdReportUploadCenter() {
  const [activeTab, setActiveTab] = useState<ReportType>("search_term");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            广告报告上传中心
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            上传领星/亚马逊导出的广告报告，替代API数据源，支持6种报告类型
          </p>
        </div>
      </div>

      {/* Report Type Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportType)}>
        <TabsList className="grid grid-cols-6 w-full">
          {REPORT_TYPES.map((rt) => (
            <TabsTrigger key={rt.key} value={rt.key} className="gap-1 text-xs">
              <rt.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{rt.label}</span>
              <span className="sm:hidden">{rt.label.slice(0, 3)}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {REPORT_TYPES.map((rt) => (
          <TabsContent key={rt.key} value={rt.key}>
            <ReportUploadCard reportType={rt} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
