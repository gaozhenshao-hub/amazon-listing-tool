import { useProject } from "@/contexts/ProjectContext";
import ProjectSelector from "@/components/ProjectSelector";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  History,
  FileSpreadsheet,
  Trash2,
  RefreshCw,
  Eye,
  ExternalLink,
  FileText,
  Calendar,
  Hash,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date | string | null): string {
  if (!date) return "未知";
  const d = new Date(date);
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="default" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          已完成
        </Badge>
      );
    case "analyzing":
      return (
        <Badge variant="default" className="bg-blue-500/10 text-blue-600 border-blue-200">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          分析中
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="bg-red-500/10 text-red-600 border-red-200">
          <XCircle className="h-3 w-3 mr-1" />
          失败
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 mr-1" />
          等待中
        </Badge>
      );
  }
}

export default function ReviewHistoryPage() {
  const { selectedProjectId } = useProject();
  const [, navigate] = useLocation();
  const [selectedImport, setSelectedImport] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const utils = trpc.useUtils();

  // Fetch project details
  const { data: projects } = trpc.project.list.useQuery();
  const currentProject = projects?.find((p: any) => p.id === selectedProjectId) ?? null;

  const { data: imports, isLoading } = trpc.analysis.listReviewImports.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const deleteMutation = trpc.analysis.deleteReviewImport.useMutation({
    onSuccess: () => {
      toast.success("导入记录已删除");
      utils.analysis.listReviewImports.invalidate({ projectId: selectedProjectId! });
    },
    onError: (err) => {
      toast.error(`删除失败: ${err.message}`);
    },
  });

  const reAnalyzeMutation = trpc.analysis.reAnalyzeImport.useMutation({
    onSuccess: (data) => {
      toast.success(`ASIN ${data.asin} 重新分析完成`);
      utils.analysis.listReviewImports.invalidate({ projectId: selectedProjectId! });
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
    },
    onError: (err) => {
      toast.error(`重新分析失败: ${err.message}`);
    },
  });

  const handleViewDetail = (record: any) => {
    setSelectedImport(record);
    setDetailOpen(true);
  };

  const handleGoToAnalysis = (analysisId: number) => {
    navigate("/listing/analysis");
  };

  if (!selectedProjectId) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">评论导入历史</h1>
            <p className="text-muted-foreground mt-1">查看和管理已导入的评论文件记录</p>
          </div>
          <ProjectSelector />
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <History className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-lg">请先选择一个项目</p>
            <p className="text-muted-foreground/70 text-sm mt-1">选择项目后可查看该项目的评论导入记录</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">评论导入历史</h1>
          <p className="text-muted-foreground mt-1">
            查看和管理 <span className="font-medium text-foreground">{currentProject?.name ?? '当前项目'}</span> 的评论导入记录
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => navigate("/listing/analysis")}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            导入新评论
          </Button>
          <ProjectSelector />
        </div>
      </div>

      {/* Stats Summary */}
      {imports && imports.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{imports.length}</p>
                  <p className="text-xs text-muted-foreground">总导入次数</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{imports.filter(i => i.status === "completed").length}</p>
                  <p className="text-xs text-muted-foreground">分析完成</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Hash className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {imports.reduce((sum, i) => sum + (i.parsedRows || 0), 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">总评论数</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {new Set(imports.map(i => i.asin)).size}
                  </p>
                  <p className="text-xs text-muted-foreground">涉及ASIN</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Import History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            导入记录
          </CardTitle>
          <CardDescription>
            所有通过Excel/CSV文件导入的评论记录，支持查看详情、重新分析和删除
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">加载中...</span>
            </div>
          ) : !imports || imports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground text-lg">暂无导入记录</p>
              <p className="text-muted-foreground/70 text-sm mt-1">
                前往竞品分析页面，使用「评论导入」模式上传卖家精灵导出的评论文件
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => navigate("/listing/analysis")}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                去导入评论
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">ASIN</TableHead>
                    <TableHead>文件名</TableHead>
                    <TableHead className="w-[80px] text-center">评论数</TableHead>
                    <TableHead className="w-[80px] text-center">文件大小</TableHead>
                    <TableHead className="w-[100px] text-center">格式</TableHead>
                    <TableHead className="w-[90px] text-center">状态</TableHead>
                    <TableHead className="w-[140px]">导入时间</TableHead>
                    <TableHead className="w-[200px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-mono text-sm font-medium">
                        {record.asin}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[200px]" title={record.filename}>
                            {record.filename}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-medium">{record.parsedRows ?? 0}</span>
                        {record.skippedRows ? (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({record.skippedRows}跳过)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {formatFileSize(record.fileSize)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">
                          {record.detectedFormat || "未知"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <StatusBadge status={record.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(record.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewDetail(record)}
                            title="查看详情"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {record.analysisId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleGoToAnalysis(record.analysisId!)}
                              title="查看分析结果"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => reAnalyzeMutation.mutate({ id: record.id })}
                            disabled={reAnalyzeMutation.isPending}
                            title="重新分析"
                          >
                            {reAnalyzeMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                title="删除记录"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>确认删除</AlertDialogTitle>
                                <AlertDialogDescription>
                                  确定要删除 ASIN {record.asin} 的导入记录「{record.filename}」吗？
                                  此操作不会删除已生成的分析结果。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate({ id: record.id })}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  删除
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              导入详情
            </DialogTitle>
            <DialogDescription>
              评论文件导入的详细信息
            </DialogDescription>
          </DialogHeader>
          {selectedImport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">ASIN</p>
                  <p className="font-mono font-medium">{selectedImport.asin}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">状态</p>
                  <StatusBadge status={selectedImport.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">文件名</p>
                  <p className="text-sm truncate" title={selectedImport.filename}>{selectedImport.filename}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">文件大小</p>
                  <p className="text-sm">{formatFileSize(selectedImport.fileSize)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">检测格式</p>
                  <Badge variant="outline">{selectedImport.detectedFormat || "未知"}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">导入时间</p>
                  <p className="text-sm">{formatDate(selectedImport.createdAt)}</p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-medium mb-2">解析统计</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold">{selectedImport.totalRows ?? 0}</p>
                    <p className="text-xs text-muted-foreground">总行数</p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-emerald-600">{selectedImport.parsedRows ?? 0}</p>
                    <p className="text-xs text-muted-foreground">有效评论</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-500/10 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-amber-600">{selectedImport.skippedRows ?? 0}</p>
                    <p className="text-xs text-muted-foreground">跳过行数</p>
                  </div>
                </div>
              </div>

              {selectedImport.columns && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-2">检测到的列</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(typeof selectedImport.columns === "string"
                        ? JSON.parse(selectedImport.columns)
                        : selectedImport.columns
                      ).map((col: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {col}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedImport.metadata && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-2">产品信息</p>
                    <div className="space-y-1.5 text-sm">
                      {(() => {
                        const meta = typeof selectedImport.metadata === "string"
                          ? JSON.parse(selectedImport.metadata)
                          : selectedImport.metadata;
                        return (
                          <>
                            {meta.brand && (
                              <p><span className="text-muted-foreground">品牌:</span> {meta.brand}</p>
                            )}
                            {meta.title && (
                              <p><span className="text-muted-foreground">标题:</span> {meta.title}</p>
                            )}
                            {meta.price && (
                              <p><span className="text-muted-foreground">价格:</span> {meta.price}</p>
                            )}
                            {meta.rating && (
                              <p><span className="text-muted-foreground">评分:</span> {meta.rating}</p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </>
              )}

              {selectedImport.errorMessage && (
                <>
                  <Separator />
                  <div className="bg-destructive/10 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                      <p className="text-sm font-medium text-destructive">错误信息</p>
                    </div>
                    <p className="text-sm text-destructive/80">{selectedImport.errorMessage}</p>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                {selectedImport.analysisId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDetailOpen(false);
                      handleGoToAnalysis(selectedImport.analysisId);
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    查看分析结果
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    reAnalyzeMutation.mutate({ id: selectedImport.id });
                    setDetailOpen(false);
                  }}
                  disabled={reAnalyzeMutation.isPending}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  重新分析
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
