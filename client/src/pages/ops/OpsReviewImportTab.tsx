import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Download, Upload, FileSpreadsheet, CheckCircle2, XCircle, Loader2,
  AlertTriangle, FileText, SkipForward, Trash2, History, Clock,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function OpsReviewImportTab() {
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [pendingFileData, setPendingFileData] = useState<{ fileName: string; fileData: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<number | null>(null);

  // ─── Queries ───
  const importHistory = trpc.productOps.listImportHistory.useQuery({ importType: "review" });

  // ─── Mutations ───
  const downloadTemplate = trpc.productOps.downloadReviewTemplate.useMutation({
    onSuccess: (data) => {
      const byteChars = atob(data.base64Data);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("模板下载成功", { description: `包含 ${data.productCount} 个产品` });
      setDownloading(false);
    },
    onError: (err) => {
      toast.error("模板下载失败", { description: err.message });
      setDownloading(false);
    },
  });

  const importReviews = trpc.productOps.importReviewsFromExcel.useMutation({
    onSuccess: (data) => {
      setImportResult(data);
      setResultDialogOpen(true);
      setPreviewOpen(false);
      setPendingFileData(null);
      setImporting(false);
      importHistory.refetch();
      toast.success("执行复盘导入完成", {
        description: `创建 ${data.created} 个，更新 ${data.updated} 个，跳过 ${data.skipped} 个`,
      });
    },
    onError: (err) => {
      toast.error("导入失败", { description: err.message });
      setImporting(false);
    },
  });

  const deleteImportHistoryMut = trpc.productOps.deleteImportHistory.useMutation({
    onSuccess: (data) => {
      importHistory.refetch();
      setDeleteConfirmOpen(false);
      setDeletingHistoryId(null);
      toast.success("导入记录已删除", {
        description: `已级联删除 ${data.deletedRecords} 条执行复盘数据`,
      });
    },
    onError: (err) => {
      toast.error("删除失败", { description: err.message });
    },
  });

  // ─── Handlers ───
  const handleDownloadTemplate = () => {
    setDownloading(true);
    downloadTemplate.mutate({ marketplace: "ALL" });
  };

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      toast.error("请上传 Excel 文件（.xlsx 或 .xls）");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件大小不能超过 10MB");
      return;
    }

    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      // Parse locally for preview
      const XLSX = await import("xlsx");
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const ws = wb.Sheets["执行复盘"] || wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        toast.error('未找到"执行复盘"工作表');
        setUploading(false);
        return;
      }
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) {
        toast.error("表格中没有数据行");
        setUploading(false);
        return;
      }

      const validRows = rows.filter(r => r["父ASIN"] && r["复盘周期"]);
      setPreviewRows(validRows.length > 0 ? validRows : rows);
      setPendingFileData({ fileName: file.name, fileData: base64 });
      setPreviewOpen(true);
      setUploading(false);
    } catch (err: any) {
      toast.error("文件读取失败", { description: err.message });
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleConfirmImport = () => {
    if (!pendingFileData) return;
    setImporting(true);
    importReviews.mutate(pendingFileData);
  };

  // ─── Preview columns ───
  const previewColumns = ["父ASIN", "产品标题", "运营", "复盘周期", "周期类型",
    "成果摘要", "关键动作", "经验教训", "下期计划"];

  return (
    <div className="space-y-4">
      {/* Template Download Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            执行复盘批量导入
          </CardTitle>
          <CardDescription>
            下载包含您负责产品的模板，填写复盘数据后上传导入。系统会自动为每个产品创建或更新执行复盘记录。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step 1: Download Template */}
          <div className="flex items-start gap-4 p-4 rounded-lg bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/50">
            <div className="h-8 w-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
            <div className="flex-1">
              <h4 className="font-medium text-purple-700 dark:text-purple-300 mb-1">下载执行复盘模板</h4>
                <p className="text-sm text-purple-600/80 dark:text-purple-400/80 mb-3">
                模板已自动填充您负责的产品父ASIN和产品标题，您只需填写复盘周期和复盘内容（基线/目标/实际数据在系统中自动加载）
              </p>
              <Button onClick={handleDownloadTemplate} disabled={downloading} variant="outline" className="gap-2">
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {downloading ? "正在生成模板..." : "下载模板 Excel"}
              </Button>
            </div>
          </div>

          {/* Step 2: Fill Template */}
          <div className="flex items-start gap-4 p-4 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50">
            <div className="h-8 w-8 rounded-full bg-amber-600 text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
            <div className="flex-1">
              <h4 className="font-medium text-amber-700 dark:text-amber-300 mb-1">填写复盘数据</h4>
              <div className="text-sm text-amber-600/80 dark:text-amber-400/80 space-y-1">
                <p>在模板中填写以下信息：</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li><strong>复盘周期</strong>（必填）：建议格式“2026W16”、“2026年4月”、“2026Q2”</li>
                  <li><strong>周期类型</strong>：weekly(周)、monthly(月)、quarterly(季)，默认weekly</li>
                  <li><strong>基线/目标/实际数据</strong>：无需填写，在产品详情页选择周度自动加载</li>
                  <li><strong>复盘内容</strong>：成果摘要、关键动作、经验教训、下期计划</li>
                </ul>
                <div className="mt-2 p-2 rounded bg-amber-100/60 dark:bg-amber-900/30 text-xs">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  校验提示：父ASIN请勿修改；复盘周期为空的行将被跳过；周期类型只能填weekly/monthly/quarterly；同ASIN+同周期将自动更新
                </div>
              </div>
            </div>
          </div>

          {/* Step 3: Upload */}
          <div className="flex items-start gap-4 p-4 rounded-lg bg-green-50/50 dark:bg-green-950/20 border border-green-200/50 dark:border-green-800/50">
            <div className="h-8 w-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
            <div className="flex-1">
              <h4 className="font-medium text-green-700 dark:text-green-300 mb-2">上传填写好的模板</h4>
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
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
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                    <p className="font-medium">正在解析文件...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Upload className="h-6 w-6 text-primary" />
                    </div>
                    <p className="font-medium">拖拽文件到此处，或点击选择文件</p>
                    <p className="text-sm text-muted-foreground">支持 .xlsx / .xls 格式</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={(open) => { if (!importing) setPreviewOpen(open); }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              执行复盘预览
            </DialogTitle>
            <DialogDescription>
              请确认以下复盘数据无误后点击"确认导入"
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-accent/50">
                <p className="text-xs text-muted-foreground">总行数</p>
                <p className="font-bold text-lg mt-1">{previewRows.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-accent/50">
                <p className="text-xs text-muted-foreground">有复盘周期</p>
                <p className="font-bold text-lg mt-1 text-green-600">
                  {previewRows.filter(r => r["复盘周期"]).length}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-accent/50">
                <p className="text-xs text-muted-foreground">缺少复盘周期</p>
                <p className="font-bold text-lg mt-1 text-amber-600">
                  {previewRows.filter(r => !r["复盘周期"]).length}
                </p>
              </div>
            </div>

            {/* Warning for rows without period */}
            {previewRows.some(r => !r["复盘周期"]) && (
              <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  部分行缺少"复盘周期"，这些行将被跳过
                </p>
              </div>
            )}

            {/* Preview Table */}
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    {previewColumns.map(col => (
                      <TableHead key={col} className="whitespace-nowrap text-xs">{col}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.slice(0, 20).map((row, idx) => (
                    <TableRow key={idx} className={!row["复盘周期"] ? "opacity-50" : ""}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      {previewColumns.map(col => (
                        <TableCell key={col} className="text-xs whitespace-nowrap max-w-[180px] truncate">
                          {row[col] != null ? String(row[col]) : "-"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {previewRows.length > 20 && (
                <p className="text-xs text-muted-foreground p-2 text-center">
                  显示前 20 行（共 {previewRows.length} 行）
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={importing}>
              取消
            </Button>
            <Button onClick={handleConfirmImport} disabled={importing}>
              {importing ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> 导入中...</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-2" /> 确认导入</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Result Dialog */}
      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              导入结果
            </DialogTitle>
          </DialogHeader>

          {importResult && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-accent/50 text-center">
                  <p className="text-xs text-muted-foreground">总计</p>
                  <p className="font-bold text-lg">{importResult.total}</p>
                </div>
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 text-center">
                  <p className="text-xs text-green-600">新建</p>
                  <p className="font-bold text-lg text-green-600">{importResult.created}</p>
                </div>
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-center">
                  <p className="text-xs text-blue-600">更新</p>
                  <p className="font-bold text-lg text-blue-600">{importResult.updated}</p>
                </div>
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-center">
                  <p className="text-xs text-amber-600">跳过</p>
                  <p className="font-bold text-lg text-amber-600">{importResult.skipped}</p>
                </div>
              </div>

              {/* Detail Table */}
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>父ASIN</TableHead>
                      <TableHead>复盘周期</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>备注</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importResult.details.map((d: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-sm">{d.parentAsin}</TableCell>
                        <TableCell className="text-sm">{d.period}</TableCell>
                        <TableCell>
                          {d.status === "created" && (
                            <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 gap-1">
                              <CheckCircle2 className="h-3 w-3" /> 新建
                            </Badge>
                          )}
                          {d.status === "updated" && (
                            <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 gap-1">
                              <CheckCircle2 className="h-3 w-3" /> 更新
                            </Badge>
                          )}
                          {d.status === "skipped" && (
                            <Badge variant="outline" className="text-amber-600 gap-1">
                              <SkipForward className="h-3 w-3" /> 跳过
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {d.reason || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setResultDialogOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Import History */}
      {(importHistory.data && importHistory.data.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              导入历史
              <Badge variant="secondary" className="ml-1">{importHistory.data.length}</Badge>
            </CardTitle>
            <CardDescription>删除导入记录将同步清除该次导入创建的所有执行复盘数据</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>导入时间</TableHead>
                    <TableHead>文件名</TableHead>
                    <TableHead className="text-center">总计</TableHead>
                    <TableHead className="text-center">新建</TableHead>
                    <TableHead className="text-center">更新</TableHead>
                    <TableHead className="text-center">跳过</TableHead>
                    <TableHead>涉及ASIN</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importHistory.data.map((h: any) => (
                    <TableRow key={h.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          {new Date(h.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={h.fileName}>
                        <div className="flex items-center gap-1.5">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-green-600 shrink-0" />
                          {h.fileName}
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-medium">{h.totalCount}</TableCell>
                      <TableCell className="text-center text-green-600 font-medium">{h.createdCount}</TableCell>
                      <TableCell className="text-center text-blue-600 font-medium">{h.updatedCount}</TableCell>
                      <TableCell className="text-center text-amber-600 font-medium">{h.skippedCount}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {(h.parentAsins || []).slice(0, 3).map((asin: string) => (
                            <Badge key={asin} variant="outline" className="text-[10px] font-mono">{asin}</Badge>
                          ))}
                          {(h.parentAsins || []).length > 3 && (
                            <Badge variant="outline" className="text-[10px]">+{h.parentAsins.length - 3}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            setDeletingHistoryId(h.id);
                            setDeleteConfirmOpen(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除导入记录</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将永久删除该次导入创建的所有执行复盘数据，且不可恢复。确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteImportHistoryMut.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteImportHistoryMut.isPending}
              onClick={() => {
                if (deletingHistoryId) {
                  deleteImportHistoryMut.mutate({ historyId: deletingHistoryId });
                }
              }}
            >
              {deleteImportHistoryMut.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> 删除中...</>
              ) : (
                <><Trash2 className="h-4 w-4 mr-2" /> 确认删除</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
