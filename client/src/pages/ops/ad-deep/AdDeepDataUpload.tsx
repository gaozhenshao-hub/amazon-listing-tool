import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Upload, Database, FileSpreadsheet, Trash2, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REPORT_TYPES = [
  { value: "daily_placement", label: "每日广告位报告", color: "bg-blue-100 text-blue-700" },
  { value: "daily_search_term", label: "每日搜索词报告", color: "bg-green-100 text-green-700" },
  { value: "daily_impression_share", label: "每日展示量份额报告", color: "bg-purple-100 text-purple-700" },
  { value: "daily_sb_benchmark", label: "每日SB Benchmark报告", color: "bg-orange-100 text-orange-700" },
  { value: "daily_business", label: "每日业务报告", color: "bg-red-100 text-red-700" },
] as const;

export default function AdDeepDataUpload() {
  const [selectedType, setSelectedType] = useState<string>("daily_placement");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [uploading, setUploading] = useState(false);

  const utils = trpc.useUtils();
  const overviewQuery = trpc.adDailyReport.getDailyDataOverview.useQuery();
  const uploadsQuery = trpc.adDailyReport.listDailyUploads.useQuery({ limit: 50 });
  const deleteUpload = trpc.adDailyReport.deleteDailyUpload.useMutation({
    onSuccess: () => {
      toast.success("删除成功");
      utils.adDailyReport.getDailyDataOverview.invalidate();
      utils.adDailyReport.listDailyUploads.invalidate();
    },
  });

  const uploadPlacement = trpc.adDailyReport.uploadDailyPlacement.useMutation();
  const uploadSearchTerm = trpc.adDailyReport.uploadDailySearchTerm.useMutation();
  const uploadImpressionShare = trpc.adDailyReport.uploadDailyImpressionShare.useMutation();
  const uploadSbBenchmark = trpc.adDailyReport.uploadDailySbBenchmark.useMutation();
  const uploadBusiness = trpc.adDailyReport.uploadDailyBusiness.useMutation();

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!dateStart || !dateEnd) {
      toast.error("请先选择报告日期范围");
      return;
    }

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const isCSV = file.name.toLowerCase().endsWith(".csv");
      const params = { fileBase64: base64, fileName: file.name, reportDateStart: dateStart, reportDateEnd: dateEnd, isCSV };

      let result: any;
      switch (selectedType) {
        case "daily_placement": result = await uploadPlacement.mutateAsync(params); break;
        case "daily_search_term": result = await uploadSearchTerm.mutateAsync(params); break;
        case "daily_impression_share": result = await uploadImpressionShare.mutateAsync(params); break;
        case "daily_sb_benchmark": result = await uploadSbBenchmark.mutateAsync(params); break;
        case "daily_business": result = await uploadBusiness.mutateAsync(params); break;
      }
      toast.success(`上传成功！导入 ${result?.importedRows || 0} 行数据`);
      utils.adDailyReport.getDailyDataOverview.invalidate();
      utils.adDailyReport.listDailyUploads.invalidate();
    } catch (err: any) {
      toast.error(`上传失败: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, [selectedType, dateStart, dateEnd]);

  const overview = overviewQuery.data;

  return (
    <div className="space-y-6">
      {/* Data Overview Cards */}
      <div className="grid grid-cols-5 gap-4">
        {REPORT_TYPES.map((rt) => {
          const count = overview ? (overview as any)[rt.value === "daily_placement" ? "placement" : rt.value === "daily_search_term" ? "searchTerm" : rt.value === "daily_impression_share" ? "impressionShare" : rt.value === "daily_sb_benchmark" ? "sbBenchmark" : "business"] : 0;
          return (
            <Card key={rt.value} className="border">
              <CardContent className="p-4 text-center">
                <Badge className={`${rt.color} mb-2`}>{rt.label.replace("每日", "")}</Badge>
                <p className="text-2xl font-bold">{Number(count).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">数据行</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            上传每日报告
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">报告类型</label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((rt) => (
                    <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">开始日期</label>
              <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">结束日期</label>
              <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="relative cursor-pointer w-full">
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" disabled={uploading} />
                <Button className="w-full" disabled={uploading}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />}
                  {uploading ? "上传中..." : "选择文件上传"}
                </Button>
              </label>
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p><strong>支持格式：</strong>Excel (.xlsx/.xls) 或 CSV (.csv)</p>
            <p><strong>数据来源：</strong></p>
            <ul className="list-disc list-inside ml-2 space-y-0.5">
              <li>广告位报告：亚马逊广告后台 → Reports → Campaign Report → 勾选Placement维度 → 按日导出</li>
              <li>搜索词报告：广告后台 → Reports → Search Term Report → 按日导出</li>
              <li>展示量份额报告：广告后台 → Reports → Search Term Impression Share Report → 按日导出</li>
              <li>SB Benchmark报告：广告后台 → SB Campaign Report → 按日导出（含Benchmark列）</li>
              <li>业务报告：卖家后台 → Reports → Business Reports → Detail Page Sales & Traffic → 按日导出</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Upload History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            上传历史
          </CardTitle>
        </CardHeader>
        <CardContent>
          {uploadsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : !uploadsQuery.data?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">暂无上传记录，请先上传每日报告数据</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 px-3">报告类型</th>
                    <th className="py-2 px-3">文件名</th>
                    <th className="py-2 px-3">日期范围</th>
                    <th className="py-2 px-3">行数</th>
                    <th className="py-2 px-3">状态</th>
                    <th className="py-2 px-3">上传时间</th>
                    <th className="py-2 px-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadsQuery.data.map((upload) => {
                    const rt = REPORT_TYPES.find((r) => r.value === upload.reportType);
                    return (
                      <tr key={upload.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-3">
                          <Badge className={rt?.color || ""}>{rt?.label.replace("每日", "") || upload.reportType}</Badge>
                        </td>
                        <td className="py-2 px-3 max-w-[200px] truncate">{upload.fileName}</td>
                        <td className="py-2 px-3 text-xs">{upload.dateLabel || `${upload.weekStartDate} ~ ${upload.weekEndDate}`}</td>
                        <td className="py-2 px-3">{upload.importedRows || upload.totalRows}</td>
                        <td className="py-2 px-3">
                          {upload.status === "completed" ? (
                            <Badge variant="outline" className="text-green-600 border-green-300"><CheckCircle className="w-3 h-3 mr-1" />成功</Badge>
                          ) : upload.status === "failed" ? (
                            <Badge variant="outline" className="text-red-600 border-red-300"><XCircle className="w-3 h-3 mr-1" />失败</Badge>
                          ) : (
                            <Badge variant="outline">处理中</Badge>
                          )}
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          {upload.createdAt ? new Date(upload.createdAt).toLocaleString("zh-CN") : "-"}
                        </td>
                        <td className="py-2 px-3">
                          <Button variant="ghost" size="sm" onClick={() => {
                            if (confirm("确认删除此上传记录及其数据？")) {
                              deleteUpload.mutate({ uploadId: upload.id });
                            }
                          }}>
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
