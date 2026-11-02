import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Layers, Star, ArrowUpDown, Edit2, Save } from "lucide-react";
import AdDeepFilters from "./AdDeepFilters";

const TIER_COLORS: Record<string, string> = {
  "S": "bg-red-100 text-red-700",
  "A": "bg-orange-100 text-orange-700",
  "B": "bg-yellow-100 text-yellow-700",
  "C": "bg-green-100 text-green-700",
  "D": "bg-gray-100 text-gray-700",
};

export default function AdDeepKeywordTier() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTier, setEditTier] = useState("");

  const analyzeMutation = trpc.adDeepAnalysis.analyzeKeywordTiers.useMutation();

  const handleAnalyze = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await analyzeMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success(`关键词分级完成，共 ${res.keywords?.length || 0} 个关键词`);
    } catch (err: any) {
      toast.error(`分析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTier = (keyword: string) => {
    if (result?.keywords) {
      const updated = result.keywords.map((k: any) =>
        k.keyword === keyword ? { ...k, tier: editTier } : k
      );
      setResult({ ...result, keywords: updated });
      setEditingId(null);
      toast.success(`已将 "${keyword}" 调整为 ${editTier} 级`);
    }
  };

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleAnalyze} loading={loading} actionLabel="分析关键词层级" />

      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-5 gap-3">
            {["S", "A", "B", "C", "D"].map((tier) => {
              const count = result.keywords?.filter((k: any) => k.tier === tier).length || 0;
              return (
                <Card key={tier}>
                  <CardContent className="p-3 text-center">
                    <Badge className={`${TIER_COLORS[tier]} text-lg px-3`}>{tier}级</Badge>
                    <p className="text-xl font-bold mt-1">{count}</p>
                    <p className="text-xs text-muted-foreground">个关键词</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Strategy Summary */}
          {result.overall_strategy && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <h4 className="text-sm font-medium text-blue-800 mb-2">整体策略建议</h4>
                <p className="text-sm text-blue-700">{result.overall_strategy}</p>
              </CardContent>
            </Card>
          )}

          {/* Keyword Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Layers className="w-4 h-4" />
                关键词分级详情（可编辑）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left">
                      <th className="py-2 px-3">关键词</th>
                      <th className="py-2 px-3">层级</th>
                      <th className="py-2 px-3">月搜索量</th>
                      <th className="py-2 px-3">点击率</th>
                      <th className="py-2 px-3">转化率</th>
                      <th className="py-2 px-3">ACOS</th>
                      <th className="py-2 px-3">策略</th>
                      <th className="py-2 px-3">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.keywords?.map((kw: any, idx: number) => (
                      <tr key={idx} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-3 font-medium">{kw.keyword}</td>
                        <td className="py-2 px-3">
                          {editingId === kw.keyword ? (
                            <Select value={editTier} onValueChange={setEditTier}>
                              <SelectTrigger className="w-[70px] h-7">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {["S", "A", "B", "C", "D"].map((t) => (
                                  <SelectItem key={t} value={t}>{t}级</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={TIER_COLORS[kw.tier] || ""}>{kw.tier}级</Badge>
                          )}
                        </td>
                        <td className="py-2 px-3">{kw.monthly_search_volume?.toLocaleString() || "-"}</td>
                        <td className="py-2 px-3">{kw.ctr ? `${kw.ctr}%` : "-"}</td>
                        <td className="py-2 px-3">{kw.cvr ? `${kw.cvr}%` : "-"}</td>
                        <td className="py-2 px-3">{kw.acos ? `${kw.acos}%` : "-"}</td>
                        <td className="py-2 px-3 max-w-[200px] truncate text-xs text-muted-foreground">{kw.action || "-"}</td>
                        <td className="py-2 px-3">
                          {editingId === kw.keyword ? (
                            <Button variant="ghost" size="sm" onClick={() => handleSaveTier(kw.keyword)}>
                              <Save className="w-3.5 h-3.5 text-green-500" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => { setEditingId(kw.keyword); setEditTier(kw.tier); }}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
