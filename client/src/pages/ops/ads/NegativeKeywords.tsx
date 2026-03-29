import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  XCircle, Download, Search, Trash2, Plus, Filter, AlertTriangle,
  CheckCircle2, Copy,
} from "lucide-react";

interface NegativeKeywordsProps {
  campaignId: string | null;
  marketplace?: string;
  days: number;
}

export default function NegativeKeywords({ campaignId, marketplace, days }: NegativeKeywordsProps) {
  const [negTab, setNegTab] = useState("exact");
  const [searchQuery, setSearchQuery] = useState("");

  // Use the 12-category search term data to derive negative keyword suggestions
  const { data: classData, isLoading } = trpc.adAnalysis.getSearchTerms12Category.useQuery({
    campaignId: campaignId || undefined,
    marketplace,
    days,
  });

  // Derive negative keywords from categories that indicate waste
  const exactNeg = useMemo(() => {
    const terms = classData?.searchTerms || [];
    // Categories 4,10,11,12 suggest exact negation (low CTR + low CVR, or zero orders with high spend)
    return terms.filter((t: any) => [4, 10, 11, 12].includes(t.categoryId) && t.cost > 5 && t.orders === 0)
      .map((t: any) => ({ keyword: t.searchTerm, impressions: t.impressions, clicks: t.clicks, cost: t.cost, orders: t.orders, reason: `分类${t.categoryId}: ${t.categoryLabel} - 花费$${t.cost.toFixed(2)}无转化` }));
  }, [classData]);

  const phraseNeg = useMemo(() => {
    const terms = classData?.searchTerms || [];
    // High impression low CTR low CVR terms suggest phrase negation
    return terms.filter((t: any) => [4, 5].includes(t.categoryId) && t.clicks >= 3 && t.orders === 0)
      .map((t: any) => ({ keyword: t.searchTerm, impressions: t.impressions, clicks: t.clicks, cost: t.cost, orders: t.orders, reason: `分类${t.categoryId}: ${t.categoryLabel} - 点击${t.clicks}次无转化` }));
  }, [classData]);

  const targetNeg = useMemo(() => {
    const terms = classData?.searchTerms || [];
    // Very high spend zero conversion ASIN targets
    return terms.filter((t: any) => t.cost > 10 && t.orders === 0 && t.clicks >= 5)
      .map((t: any) => ({ target: t.searchTerm, impressions: t.impressions, clicks: t.clicks, cost: t.cost, orders: t.orders, reason: `花费$${t.cost.toFixed(2)}/点击${t.clicks}次/零转化` }));
  }, [classData]);

  const currentList = negTab === "exact" ? exactNeg : negTab === "phrase" ? phraseNeg : targetNeg;

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return currentList;
    const q = searchQuery.toLowerCase();
    return currentList.filter((item: any) => (item.keyword || item.target || "").toLowerCase().includes(q));
  }, [currentList, searchQuery]);

  const handleExportBulkSheet = () => {
    const headers = negTab === "target"
      ? ["Target", "Type", "Impressions", "Clicks", "Cost", "Orders", "Reason"]
      : ["Keyword", "Match Type", "Impressions", "Clicks", "Cost", "Orders", "Reason"];
    const rows = filteredList.map((item: any): string[] => [
      item.keyword || item.target,
      negTab === "exact" ? "Negative Exact" : negTab === "phrase" ? "Negative Phrase" : "Negative Target",
      item.impressions, item.clicks, item.cost?.toFixed(2), item.orders, item.reason,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `negative_${negTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("已导出否定词Bulk Sheet");
  };

  const handleCopyAll = () => {
    const keywords = filteredList.map((item: any) => item.keyword || item.target).join("\n");
    navigator.clipboard.writeText(keywords);
    toast.success(`已复制${filteredList.length}个否定词`);
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-red-50/50 border-red-200">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-gray-600">精准否定词</span>
            </div>
            <p className="text-2xl font-bold text-red-700">{exactNeg.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-orange-50/50 border-orange-200">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-gray-600">词组否定词</span>
            </div>
            <p className="text-2xl font-bold text-orange-700">{phraseNeg.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50 border-gray-200">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-600">关闭投放对象</span>
            </div>
            <p className="text-2xl font-bold text-gray-700">{targetNeg.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Negative Keywords Tabs */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">否定词管理</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCopyAll}>
                <Copy className="w-3 h-3 mr-1" />
                复制全部
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportBulkSheet}>
                <Download className="w-3 h-3 mr-1" />
                导出Bulk Sheet
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={negTab} onValueChange={setNegTab}>
            <div className="flex items-center justify-between mb-3">
              <TabsList>
                <TabsTrigger value="exact">精准否定 ({exactNeg.length})</TabsTrigger>
                <TabsTrigger value="phrase">词组否定 ({phraseNeg.length})</TabsTrigger>
                <TabsTrigger value="target">关闭投放 ({targetNeg.length})</TabsTrigger>
              </TabsList>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  placeholder="搜索..."
                  className="pl-7 h-8 w-40 text-xs"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left p-2.5 font-medium text-gray-600 w-8">#</th>
                    <th className="text-left p-2.5 font-medium text-gray-600">{negTab === "target" ? "投放对象" : "关键词"}</th>
                    <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                    <th className="text-right p-2.5 font-medium text-gray-600">点击</th>
                    <th className="text-right p-2.5 font-medium text-gray-600">花费</th>
                    <th className="text-right p-2.5 font-medium text-gray-600">订单</th>
                    <th className="text-left p-2.5 font-medium text-gray-600">否定原因</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">暂无否定词建议</td></tr>
                  ) : (
                    filteredList.map((item: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-gray-50/50">
                        <td className="p-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="p-2.5 font-medium text-xs">{item.keyword || item.target}</td>
                        <td className="p-2.5 text-right text-xs">{(item.impressions || 0).toLocaleString()}</td>
                        <td className="p-2.5 text-right text-xs">{item.clicks || 0}</td>
                        <td className="p-2.5 text-right text-xs text-red-600">${(item.cost || 0).toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs">{item.orders || 0}</td>
                        <td className="p-2.5 text-xs text-gray-500 max-w-[200px] truncate">{item.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
