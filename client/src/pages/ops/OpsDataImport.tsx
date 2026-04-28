import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, Clock, Loader2,
  Trash2, AlertTriangle, Database, BarChart3, ArrowUpFromLine,
} from "lucide-react";
import { toast } from "sonner";
import OperatorMappingDialog from "@/components/OperatorMappingDialog";
import AdReportImportTab from "./AdReportImportTab";
import AdReportUploadCenter from "./AdReportUploadCenter";
import OpsPlanImportTab from "./OpsPlanImportTab";
import OpsReviewImportTab from "./OpsReviewImportTab";

// ─── Helper: format date ───
function formatDate(d: Date | string | null) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── Status Badge ───
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    pending: { label: "待处理", variant: "outline", icon: <Clock className="h-3 w-3" /> },
    parsing: { label: "解析中", variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    previewing: { label: "待确认", variant: "secondary", icon: <AlertTriangle className="h-3 w-3" /> },
    importing: { label: "导入中", variant: "default", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    completed: { label: "已完成", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { label: "失败", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  };
  const c = config[status] || config.pending;
  return (
    <Badge variant={c.variant} className="gap-1">
      {c.icon} {c.label}
    </Badge>
  );
}

// ─── Source Type Badge ───
function SourceBadge({ source }: { source: string }) {
  if (source === "lingxing") {
    return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">领星</Badge>;
  }
  return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">赛狐</Badge>;
}

export default function OpsDataImport() {
  const [activeTab, setActiveTab] = useState("upload");
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [mappingOperatorNames, setMappingOperatorNames] = useState<string[]>([]);
  const [mappingSourceType, setMappingSourceType] = useState<"lingxing" | "saihu">("lingxing");

  // ─── Queries ───
  const historyQuery = trpc.dataImport.getHistory.useQuery({ page: 1, pageSize: 50, sourceType: "all" });
  const statsQuery = trpc.dataImport.getImportStats.useQuery();

  // ─── Mutations ───
  const uploadMutation = trpc.dataImport.uploadAndParse.useMutation({
    onSuccess: (data) => {
      setPreviewData(data);
      setPreviewOpen(true);
      setUploading(false);
    },
    onError: (err) => {
      toast.error("上传解析失败", { description: err.message });
      setUploading(false);
    },
  });

  const confirmMutation = trpc.dataImport.confirmImport.useMutation({
    onSuccess: (data) => {
      toast.success("数据导入成功", {
        description: `成功导入 ${data.importedRows} 行数据${data.skippedRows > 0 ? `，跳过 ${data.skippedRows} 行` : ""}`,
      });
      // Extract unique operator names from preview data for mapping
      if (previewData?.previewRows?.length > 0) {
        const operatorField = previewData.sourceType === "lingxing" ? "operator" : "operator";
        const names = [...new Set(
          previewData.previewRows
            .map((r: any) => r[operatorField] || r.负责人 || r.业务员)
            .filter(Boolean)
        )] as string[];
        if (names.length > 0) {
          setMappingOperatorNames(names);
          setMappingSourceType(previewData.sourceType as "lingxing" | "saihu");
          setMappingDialogOpen(true);
        }
      }
      setPreviewOpen(false);
      setPreviewData(null);
      setConfirmingImport(false);
      historyQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => {
      toast.error("导入失败", { description: err.message });
      setConfirmingImport(false);
    },
  });

  const deleteMutation = trpc.dataImport.deleteImport.useMutation({
    onSuccess: () => {
      toast.success("已删除导入记录");
      historyQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => {
      toast.error("删除失败", { description: err.message });
    },
  });

  // ─── File handling ───
  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      toast.error("请上传 Excel 文件（.xlsx 或 .xls）");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("文件大小不能超过 50MB");
      return;
    }

    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      uploadMutation.mutate({ fileName: file.name, fileData: base64 });
    } catch (err: any) {
      toast.error("文件读取失败", { description: err.message });
      setUploading(false);
    }
  }, [uploadMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleConfirmImport = () => {
    if (!previewData?.importId) return;
    setConfirmingImport(true);
    confirmMutation.mutate({ importId: Number(previewData.importId) });
  };

  // ─── Preview column keys for display ───
  const getPreviewColumns = (sourceType: string, rows: any[]) => {
    if (!rows || rows.length === 0) return [];
    // Show key columns first
    const keyColumns = sourceType === "lingxing"
      ? ["parentAsin", "asin", "title", "storeName", "country", "salesQty", "salesAmount", "settlementProfit", "adSpend", "acos"]
      : ["parentAsin", "asin", "title", "storeName", "site", "salesQty", "salesAmount", "grossProfit", "adSpend", "acos"];
    return keyColumns.filter(col => rows[0]?.[col] !== undefined);
  };

  const columnLabels: Record<string, string> = {
    parentAsin: "父ASIN", asin: "ASIN", title: "标题", storeName: "店铺",
    country: "国家", site: "站点", salesQty: "销量", salesAmount: "销售额",
    settlementProfit: "结算毛利润", grossProfit: "毛利润", adSpend: "广告花费",
    acos: "ACOS", orderQty: "订单量", fbaAvailable: "FBA可售",
  };

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">数据导入中心</h1>
        <p className="text-muted-foreground mt-1">
          上传领星产品表现或赛狐产品分析的导出表格，系统自动识别格式并按周存储数据
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Database className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">领星数据</p>
                <p className="text-xl font-bold">{stats?.lingxing.weekCount || 0} <span className="text-sm font-normal text-muted-foreground">周</span></p>
                <p className="text-xs text-muted-foreground">{stats?.lingxing.productCount || 0} 个产品</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <BarChart3 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">赛狐数据</p>
                <p className="text-xl font-bold">{stats?.saihu.weekCount || 0} <span className="text-sm font-normal text-muted-foreground">周</span></p>
                <p className="text-xs text-muted-foreground">{stats?.saihu.productCount || 0} 个产品</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">已完成导入</p>
                <p className="text-xl font-bold">{historyQuery.data?.records.filter(r => r.status === "completed").length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">最近导入</p>
                <p className="text-sm font-medium">{stats?.lastImportAt ? formatDate(stats.lastImportAt) : "暂无"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload">上传数据</TabsTrigger>
          <TabsTrigger value="ad-report">广告报表</TabsTrigger>
          <TabsTrigger value="ops-plan">运营计划</TabsTrigger>
          <TabsTrigger value="review-import">执行复盘</TabsTrigger>
          <TabsTrigger value="history">导入历史</TabsTrigger>
        </TabsList>

        {/* Upload Tab */}
        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpFromLine className="h-5 w-5" />
                上传产品数据表格
              </CardTitle>
              <CardDescription>
                支持领星ERP"产品表现"和赛狐"产品分析"两种格式的Excel导出文件，系统会自动识别来源
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Drop Zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
                  ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/50"}
                  ${uploading ? "pointer-events-none opacity-60" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = "";
                  }}
                />
                {uploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    <p className="text-lg font-medium">正在解析表格...</p>
                    <p className="text-sm text-muted-foreground">自动识别格式并提取数据</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-lg font-medium">拖拽文件到此处，或点击选择文件</p>
                    <p className="text-sm text-muted-foreground">支持 .xlsx / .xls 格式，最大 50MB</p>
                    <div className="flex gap-3 mt-2">
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                        <FileSpreadsheet className="h-3 w-3 mr-1" /> 领星 · 产品表现
                      </Badge>
                      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">
                        <FileSpreadsheet className="h-3 w-3 mr-1" /> 赛狐 · 产品分析
                      </Badge>
                    </div>
                  </div>
                )}
              </div>

              {/* Instructions */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/50">
                  <h4 className="font-medium text-blue-700 dark:text-blue-300 mb-2">领星产品表现</h4>
                  <ol className="text-sm text-blue-600/80 dark:text-blue-400/80 space-y-1 list-decimal list-inside">
                    <li>登录领星ERP → 产品 → 产品表现</li>
                    <li>选择"父ASIN"维度，设置日期范围</li>
                    <li>点击"导出"下载 Excel 文件</li>
                    <li>文件名需包含日期（如 2026-03-30~2026-04-19）</li>
                  </ol>
                </div>
                <div className="p-4 rounded-lg bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200/50 dark:border-orange-800/50">
                  <h4 className="font-medium text-orange-700 dark:text-orange-300 mb-2">赛狐产品分析</h4>
                  <ol className="text-sm text-orange-600/80 dark:text-orange-400/80 space-y-1 list-decimal list-inside">
                    <li>登录赛狐 → 产品分析 → ASIN列表</li>
                    <li>选择"汇总"模式，设置日期范围</li>
                    <li>点击"导出"下载 Excel 文件</li>
                    <li>文件名需包含日期（如 20260415-20260421）</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ad Report Tab */}
        <TabsContent value="ad-report" className="space-y-4">
          <AdReportUploadCenter />
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">旧版投放报告上传（已有数据）</h3>
            <AdReportImportTab />
          </div>
        </TabsContent>

        {/* Ops Plan Import Tab */}
        <TabsContent value="ops-plan" className="space-y-4">
          <OpsPlanImportTab />
        </TabsContent>

        {/* Execution Review Import Tab */}
        <TabsContent value="review-import" className="space-y-4">
          <OpsReviewImportTab />
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>导入历史记录</CardTitle>
              <CardDescription>查看所有已上传的数据文件和导入状态</CardDescription>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !historyQuery.data?.records.length ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>暂无导入记录</p>
                  <p className="text-sm mt-1">上传第一个表格开始使用</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>文件名</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead>日期范围</TableHead>
                      <TableHead className="text-right">数据行数</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>导入时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyQuery.data.records.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell className="max-w-[200px] truncate font-medium" title={record.fileName}>
                          {record.fileName}
                        </TableCell>
                        <TableCell><SourceBadge source={record.sourceType} /></TableCell>
                        <TableCell className="text-sm">
                          {record.weekStartDate} ~ {record.weekEndDate}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {record.status === "completed" ? (
                            <span>{record.importedRows} / {record.totalRows}</span>
                          ) : (
                            <span>{record.totalRows || "-"}</span>
                          )}
                        </TableCell>
                        <TableCell><StatusBadge status={record.status} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(record.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("确定删除此导入记录及关联数据？")) {
                                deleteMutation.mutate({ importId: record.id });
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={(open) => { if (!confirmingImport) setPreviewOpen(open); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              数据预览
            </DialogTitle>
            <DialogDescription>
              请确认以下数据无误后点击"确认导入"
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-accent/50">
                  <p className="text-xs text-muted-foreground">数据来源</p>
                  <p className="font-medium mt-1">
                    <SourceBadge source={previewData.sourceType} />
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-accent/50">
                  <p className="text-xs text-muted-foreground">日期范围</p>
                  <p className="font-medium mt-1 text-sm">
                    {previewData.dateRange?.startDate} ~ {previewData.dateRange?.endDate}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-accent/50">
                  <p className="text-xs text-muted-foreground">数据行数</p>
                  <p className="font-medium mt-1">{previewData.totalRows} 行</p>
                </div>
                <div className="p-3 rounded-lg bg-accent/50">
                  <p className="text-xs text-muted-foreground">已映射列</p>
                  <p className="font-medium mt-1">{previewData.mappedColumnCount} 列</p>
                </div>
              </div>

              {/* Unmapped columns warning */}
              {previewData.unmappedColumns?.length > 0 && (
                <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                  <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" />
                    {previewData.unmappedColumns.length} 个列未映射（已忽略）
                  </p>
                  <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 mt-1 line-clamp-2">
                    {previewData.unmappedColumns.join("、")}
                  </p>
                </div>
              )}

              {/* Preview Table */}
              {previewData.previewRows?.length > 0 && (
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {getPreviewColumns(previewData.sourceType, previewData.previewRows).map(col => (
                          <TableHead key={col} className="whitespace-nowrap text-xs">
                            {columnLabels[col] || col}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.previewRows.map((row: any, idx: number) => (
                        <TableRow key={idx}>
                          {getPreviewColumns(previewData.sourceType, previewData.previewRows).map(col => (
                            <TableCell key={col} className="text-xs whitespace-nowrap max-w-[200px] truncate">
                              {row[col] != null ? String(row[col]) : "-"}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="text-xs text-muted-foreground p-2 text-center">
                    显示前 {previewData.previewRows.length} 行（共 {previewData.totalRows} 行）
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={confirmingImport}>
              取消
            </Button>
            <Button onClick={handleConfirmImport} disabled={confirmingImport}>
              {confirmingImport ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> 导入中...</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-2" /> 确认导入</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Operator Name Mapping Dialog */}
      <OperatorMappingDialog
        open={mappingDialogOpen}
        onOpenChange={setMappingDialogOpen}
        operatorNames={mappingOperatorNames}
        sourceType={mappingSourceType}
        onComplete={() => {
          setMappingOperatorNames([]);
        }}
      />
    </div>
  );
}
