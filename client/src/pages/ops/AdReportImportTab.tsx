/**
 * Ad Report Import Tab
 * Handles uploading and importing ad report Excel files
 * Integrated into the Data Import Center
 */
import { useState, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload, FileSpreadsheet, CheckCircle2, Loader2, Trash2,
  AlertTriangle, Megaphone, Link2, ArrowUpFromLine, Info,
} from "lucide-react";
import { useLocation } from "wouter";

function formatDate(d: Date | string | null) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AdReportImportTab() {
  const [, navigate] = useLocation();
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [weekStartDate, setWeekStartDate] = useState("");
  const [weekEndDate, setWeekEndDate] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Queries ───
  const importsQuery = trpc.adTracking.listAdImports.useQuery();
  const mappingsQuery = trpc.adTracking.listMappings.useQuery();

  // ─── Mutations ───
  const uploadMutation = trpc.adTracking.uploadAdReport.useMutation({
    onSuccess: (data) => {
      setPreviewData(data);
      setPreviewOpen(true);
      setUploading(false);
    },
    onError: (err) => {
      toast.error("解析失败", { description: err.message });
      setUploading(false);
    },
  });

  const confirmMutation = trpc.adTracking.confirmAdImport.useMutation({
    onSuccess: (data) => {
      toast.success("广告数据导入成功", {
        description: `成功导入 ${data.imported} 行数据`,
      });
      setPreviewOpen(false);
      setPreviewData(null);
      setConfirmingImport(false);
      setSelectedFile(null);
      setFileBase64("");
      importsQuery.refetch();
    },
    onError: (err) => {
      toast.error("导入失败", { description: err.message });
      setConfirmingImport(false);
    },
  });

  const deleteMutation = trpc.adTracking.deleteAdImport.useMutation({
    onSuccess: () => {
      toast.success("已删除导入记录");
      importsQuery.refetch();
    },
    onError: (err) => toast.error("删除失败", { description: err.message }),
  });

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    const buffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );
    setFileBase64(base64);
  };

  const handleUpload = () => {
    if (!selectedFile || !fileBase64) {
      toast.error("请先选择文件");
      return;
    }
    if (!weekStartDate || !weekEndDate) {
      toast.error("请选择数据周期的起止日期");
      return;
    }
    setUploading(true);
    uploadMutation.mutate({
      fileName: selectedFile.name,
      fileData: fileBase64,
      weekStartDate,
      weekEndDate,
    });
  };

  const handleConfirmImport = () => {
    if (!previewData?.importId || !fileBase64) return;
    setConfirmingImport(true);
    confirmMutation.mutate({
      importId: Number(previewData.importId),
      fileName: selectedFile?.name || "",
      fileData: fileBase64,
      weekStartDate,
      weekEndDate,
    });
  };

  const mappingCount = mappingsQuery.data?.length || 0;

  return (
    <div className="space-y-4">
      {/* Mapping Status Banner */}
      {mappingCount === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800 flex-1">
            <p className="font-medium">尚未配置广告组合映射</p>
            <p className="text-xs mt-1">
              导入广告报表前，请先在"广告组合映射"页面配置ASIN与广告组合的对应关系，否则数据无法归类到对应产品。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-1 text-amber-700 border-amber-300 hover:bg-amber-100"
              onClick={() => navigate("/ops/ad-mapping")}
            >
              <Link2 className="h-3.5 w-3.5" />
              去配置映射
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <span className="text-sm text-green-800">
            已配置 {mappingCount} 个广告组合映射
          </span>
          <Button
            variant="link"
            size="sm"
            className="text-green-700 p-0 h-auto"
            onClick={() => navigate("/ops/ad-mapping")}
          >
            管理映射
          </Button>
        </div>
      )}

      {/* Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-purple-600" />
            上传广告报表
          </CardTitle>
          <CardDescription>
            上传领星导出的广告汇总报表（Excel格式），支持SP/SB/SD广告类型
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>周期开始日期</Label>
              <Input
                type="date"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>周期结束日期</Label>
              <Input
                type="date"
                value={weekEndDate}
                onChange={(e) => setWeekEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* File Upload */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              selectedFile ? "border-green-300 bg-green-50/50" : "border-muted-foreground/20 hover:border-primary/40"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFileSelect(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
            {selectedFile ? (
              <div className="space-y-2">
                <FileSpreadsheet className="h-10 w-10 text-green-600 mx-auto" />
                <p className="text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                    setFileBase64("");
                  }}
                >
                  重新选择
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <ArrowUpFromLine className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  点击或拖拽上传广告报表Excel文件
                </p>
                <p className="text-xs text-muted-foreground">
                  支持 .xlsx / .xls 格式
                </p>
              </div>
            )}
          </div>

          <Button
            onClick={handleUpload}
            disabled={!selectedFile || !weekStartDate || !weekEndDate || uploading}
            className="w-full gap-2"
          >
            {uploading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> 解析中...</>
            ) : (
              <><Upload className="h-4 w-4" /> 上传并解析</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Import History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">广告报表导入历史</CardTitle>
        </CardHeader>
        <CardContent>
          {importsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !importsQuery.data?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">暂无广告报表导入记录</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead>数据周期</TableHead>
                  <TableHead className="text-right">总行数</TableHead>
                  <TableHead className="text-right">已映射</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>导入时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importsQuery.data.map((imp: any) => (
                  <TableRow key={imp.id}>
                    <TableCell className="max-w-[180px] truncate font-medium" title={imp.fileName}>
                      {imp.fileName}
                    </TableCell>
                    <TableCell className="text-sm">
                      {imp.weekStartDate} ~ {imp.weekEndDate}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{imp.totalRows}</TableCell>
                    <TableCell className="text-right tabular-nums">{imp.mappedRows || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={imp.status === "completed" ? "default" : imp.status === "failed" ? "destructive" : "secondary"}>
                        {imp.status === "completed" ? "已完成" : imp.status === "failed" ? "失败" : imp.status === "importing" ? "导入中" : "预览中"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(imp.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm("确定删除此导入记录及关联的广告数据？")) {
                            deleteMutation.mutate({ importId: imp.id });
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

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={(open) => { if (!confirmingImport) setPreviewOpen(open); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              广告报表解析结果
            </DialogTitle>
            <DialogDescription>
              确认数据无误后点击"确认导入"
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold">{previewData.totalRows}</p>
                  <p className="text-xs text-muted-foreground">总行数</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold">{previewData.keywordRows}</p>
                  <p className="text-xs text-muted-foreground">关键词行</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold">{previewData.productTargetRows}</p>
                  <p className="text-xs text-muted-foreground">商品定投行</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{previewData.mappedRows}</p>
                  <p className="text-xs text-muted-foreground">已映射行</p>
                </div>
              </div>

              {/* Ad Types & Stores */}
              <div className="flex flex-wrap gap-2">
                {previewData.uniqueAdTypes?.map((t: string) => (
                  <Badge key={t} variant="outline">{t}</Badge>
                ))}
                {previewData.uniqueStores?.map((s: string) => (
                  <Badge key={s} variant="secondary">{s}</Badge>
                ))}
              </div>

              {/* Unmapped Portfolios Warning */}
              {previewData.unmappedPortfolios?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">
                      {previewData.unmappedPortfolios.length} 个广告组合未映射
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {previewData.unmappedPortfolios.map((p: string) => (
                      <Badge key={p} variant="outline" className="text-[10px] bg-amber-100 text-amber-700 border-amber-300">
                        {p}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-amber-700 mt-2">
                    未映射的广告组合数据将被保留但不会显示在产品详情页。
                    导入后可在"广告组合映射"页面补充映射。
                  </p>
                </div>
              )}

              {/* Preview Table */}
              {previewData.preview?.length > 0 && (
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="text-left p-2 font-medium">广告组合</th>
                        <th className="text-left p-2 font-medium">关键词</th>
                        <th className="text-left p-2 font-medium">类型</th>
                        <th className="text-left p-2 font-medium">匹配</th>
                        <th className="text-right p-2 font-medium">曝光</th>
                        <th className="text-right p-2 font-medium">点击</th>
                        <th className="text-right p-2 font-medium">花费</th>
                        <th className="text-right p-2 font-medium">ACoS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.preview.map((row: any, idx: number) => (
                        <tr key={idx} className="border-t hover:bg-muted/30">
                          <td className="p-2 max-w-[120px] truncate">{row.portfolioName}</td>
                          <td className="p-2 max-w-[150px] truncate">{row.keyword}</td>
                          <td className="p-2">{row.adType}</td>
                          <td className="p-2">{row.matchType}</td>
                          <td className="p-2 text-right tabular-nums">{row.impressions?.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums">{row.clicks?.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums">{row.spend != null ? `$${row.spend.toFixed(1)}` : "-"}</td>
                          <td className="p-2 text-right">{row.acos != null ? `${row.acos.toFixed(1)}%` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
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
    </div>
  );
}
