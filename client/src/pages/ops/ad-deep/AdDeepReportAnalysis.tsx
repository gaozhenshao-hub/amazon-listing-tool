import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  BarChart3, Monitor, Search, Eye, TrendingUp, ShoppingBag,
  CheckCircle, AlertTriangle, Edit2, Save, X, ArrowRight,
  Loader2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import AdDeepFilters from "./AdDeepFilters";

const REPORT_TABS = [
  { value: "placement", label: "广告位报告", icon: Monitor, color: "text-blue-600" },
  { value: "search-term", label: "搜索词报告", icon: Search, color: "text-green-600" },
  { value: "impression-share", label: "展示量份额", icon: Eye, color: "text-purple-600" },
  { value: "sb-benchmark", label: "SB Benchmark", icon: TrendingUp, color: "text-orange-600" },
  { value: "business-cross", label: "业务报告交叉", icon: ShoppingBag, color: "text-red-600" },
];

// ============================
// Sub-component: Placement Report Analysis
// ============================
function PlacementAnalysis() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const analyzeMutation = trpc.adDeepAnalysis.analyzePlacementReport.useMutation();

  const handleAnalyze = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await analyzeMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success("广告位报告分析完成");
    } catch (err: any) {
      toast.error(`分析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = (idx: number) => {
    if (result?.actions) {
      const updated = [...result.actions];
      updated[idx] = { ...updated[idx], action: editText };
      setResult({ ...result, actions: updated });
      setEditingIdx(null);
      toast.success("操作建议已更新");
    }
  };

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleAnalyze} loading={loading} actionLabel="分析广告位" />

      {result && (
        <div className="space-y-4">
          {/* Placement Trend Chart */}
          {result.trend_data?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">广告位日度趋势</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={result.trend_data}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="tos_ctr" name="TOS CTR%" stroke="#3b82f6" strokeWidth={2} />
                    <Line yAxisId="left" type="monotone" dataKey="ros_ctr" name="ROS CTR%" stroke="#10b981" strokeWidth={2} />
                    <Line yAxisId="left" type="monotone" dataKey="pp_ctr" name="PP CTR%" stroke="#f59e0b" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="tos_cvr" name="TOS CVR%" stroke="#3b82f6" strokeDasharray="5 5" />
                    <Line yAxisId="right" type="monotone" dataKey="ros_cvr" name="ROS CVR%" stroke="#10b981" strokeDasharray="5 5" />
                    <Line yAxisId="right" type="monotone" dataKey="pp_cvr" name="PP CVR%" stroke="#f59e0b" strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Placement Comparison */}
          {result.placement_comparison && (
            <div className="grid grid-cols-3 gap-4">
              {["top_of_search", "rest_of_search", "product_pages"].map((pos) => {
                const data = result.placement_comparison[pos];
                if (!data) return null;
                const label = pos === "top_of_search" ? "Top of Search" : pos === "rest_of_search" ? "Rest of Search" : "Product Pages";
                return (
                  <Card key={pos}>
                    <CardContent className="p-4 space-y-2">
                      <h4 className="font-medium text-sm">{label}</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>CTR: <span className="font-bold">{data.avg_ctr}%</span></div>
                        <div>CVR: <span className="font-bold">{data.avg_cvr}%</span></div>
                        <div>ACOS: <span className="font-bold">{data.avg_acos}%</span></div>
                        <div>花费占比: <span className="font-bold">{data.spend_ratio}%</span></div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Actions with Edit */}
          {result.actions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" />
                  操作建议（可编辑确认）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.actions.map((a: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={a.priority === "high" ? "bg-red-100 text-red-700" : a.priority === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}>
                          {a.priority === "high" ? "高优" : a.priority === "medium" ? "中优" : "低优"}
                        </Badge>
                        <span className="text-sm font-medium">{a.campaign || a.title}</span>
                      </div>
                      {editingIdx === i ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleSaveEdit(i)}><Save className="w-3.5 h-3.5 text-green-500" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingIdx(null)}><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => { setEditingIdx(i); setEditText(a.action); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    {editingIdx === i ? (
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{a.action}</p>
                    )}
                    {a.rule_id && <Badge variant="outline" className="text-xs">规则: {a.rule_id}</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ============================
// Sub-component: Search Term Report Analysis
// ============================
function SearchTermAnalysis() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const analyzeMutation = trpc.adDeepAnalysis.analyzeSearchTermReport.useMutation();

  const handleAnalyze = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await analyzeMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success("搜索词报告分析完成");
    } catch (err: any) {
      toast.error(`分析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = (idx: number) => {
    if (result?.actions) {
      const updated = [...result.actions];
      updated[idx] = { ...updated[idx], action: editText };
      setResult({ ...result, actions: updated });
      setEditingIdx(null);
      toast.success("操作建议已更新");
    }
  };

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleAnalyze} loading={loading} actionLabel="分析搜索词" />

      {result && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-3">
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">否词建议</p>
              <p className="text-2xl font-bold text-red-600">{result.negative_suggestions?.length || 0}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">异常花费词</p>
              <p className="text-2xl font-bold text-yellow-600">{result.anomaly_terms?.length || 0}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">养词建议</p>
              <p className="text-2xl font-bold text-green-600">{result.nurture_terms?.length || 0}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">高效词</p>
              <p className="text-2xl font-bold text-blue-600">{result.high_efficiency_terms?.length || 0}</p>
            </CardContent></Card>
          </div>

          {/* Negative Suggestions Table */}
          {result.negative_suggestions?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm text-red-600">否词建议（高花费零转化）</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left">
                        <th className="py-2 px-3">搜索词</th>
                        <th className="py-2 px-3">花费</th>
                        <th className="py-2 px-3">点击</th>
                        <th className="py-2 px-3">转化</th>
                        <th className="py-2 px-3">连续天数</th>
                        <th className="py-2 px-3">建议</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.negative_suggestions.map((t: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium">{t.term}</td>
                          <td className="py-2 px-3">${t.total_spend?.toFixed(2)}</td>
                          <td className="py-2 px-3">{t.total_clicks}</td>
                          <td className="py-2 px-3">{t.total_orders || 0}</td>
                          <td className="py-2 px-3">{t.consecutive_days || "-"}</td>
                          <td className="py-2 px-3 text-xs text-red-600">{t.suggestion || "建议否定"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions with Edit */}
          {result.actions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" />
                  操作建议（可编辑确认）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.actions.map((a: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={a.priority === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}>
                          {a.priority === "high" ? "高优" : "中优"}
                        </Badge>
                        <span className="text-sm font-medium">{a.title}</span>
                      </div>
                      {editingIdx === i ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleSaveEdit(i)}><Save className="w-3.5 h-3.5 text-green-500" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingIdx(null)}><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => { setEditingIdx(i); setEditText(a.action); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    {editingIdx === i ? (
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{a.action}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ============================
// Sub-component: Impression Share Analysis
// ============================
function ImpressionShareAnalysis() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const analyzeMutation = trpc.adDeepAnalysis.analyzeImpressionShareReport.useMutation();

  const handleAnalyze = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await analyzeMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success("展示量份额分析完成");
    } catch (err: any) {
      toast.error(`分析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = (idx: number) => {
    if (result?.actions) {
      const updated = [...result.actions];
      updated[idx] = { ...updated[idx], action: editText };
      setResult({ ...result, actions: updated });
      setEditingIdx(null);
      toast.success("操作建议已更新");
    }
  };

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleAnalyze} loading={loading} actionLabel="分析展示量份额" />

      {result && (
        <div className="space-y-4">
          {/* Impression Share Trend */}
          {result.trend_data?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">展示量份额日度趋势</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={result.trend_data}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="impression_share" name="展示量份额%" fill="#8b5cf6" stroke="#8b5cf6" fillOpacity={0.3} />
                    <Area type="monotone" dataKey="lost_to_budget" name="预算丢失%" fill="#ef4444" stroke="#ef4444" fillOpacity={0.2} />
                    <Area type="monotone" dataKey="lost_to_rank" name="排名丢失%" fill="#f59e0b" stroke="#f59e0b" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Competition Landscape */}
          {result.competition_landscape && (
            <Card>
              <CardHeader><CardTitle className="text-sm">竞争格局分析</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-purple-50 rounded-lg">
                    <p className="text-xs text-muted-foreground">平均展示份额</p>
                    <p className="text-2xl font-bold text-purple-600">{result.competition_landscape.avg_share}%</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <p className="text-xs text-muted-foreground">预算丢失占比</p>
                    <p className="text-2xl font-bold text-red-600">{result.competition_landscape.budget_lost}%</p>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 rounded-lg">
                    <p className="text-xs text-muted-foreground">排名丢失占比</p>
                    <p className="text-2xl font-bold text-yellow-600">{result.competition_landscape.rank_lost}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          {result.actions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" />
                  操作建议（可编辑确认）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.actions.map((a: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={a.priority === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}>
                          {a.priority === "high" ? "高优" : "中优"}
                        </Badge>
                        <span className="text-sm font-medium">{a.title}</span>
                      </div>
                      {editingIdx === i ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleSaveEdit(i)}><Save className="w-3.5 h-3.5 text-green-500" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingIdx(null)}><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => { setEditingIdx(i); setEditText(a.action); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    {editingIdx === i ? (
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{a.action}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ============================
// Sub-component: SB Benchmark Analysis
// ============================
function SbBenchmarkAnalysis() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const analyzeMutation = trpc.adDeepAnalysis.analyzeSbBenchmarkReport.useMutation();

  const handleAnalyze = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await analyzeMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success("SB Benchmark分析完成");
    } catch (err: any) {
      toast.error(`分析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = (idx: number) => {
    if (result?.actions) {
      const updated = [...result.actions];
      updated[idx] = { ...updated[idx], action: editText };
      setResult({ ...result, actions: updated });
      setEditingIdx(null);
      toast.success("操作建议已更新");
    }
  };

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleAnalyze} loading={loading} actionLabel="分析SB Benchmark" />

      {result && (
        <div className="space-y-4">
          {/* Radar Chart: Self vs Benchmark */}
          {result.radar_data && (
            <Card>
              <CardHeader><CardTitle className="text-sm">自身 vs 类目基准</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={result.radar_data}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis tick={{ fontSize: 10 }} />
                    <Radar name="自身" dataKey="self" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                    <Radar name="类目基准" dataKey="benchmark" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} />
                    <Legend />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Brand vs Category Analysis */}
          {result.brand_analysis && (
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <h4 className="text-sm font-medium mb-2">品牌词表现</h4>
                  <div className="space-y-1 text-sm">
                    <div>CTR: <span className="font-bold">{result.brand_analysis.brand_ctr}%</span></div>
                    <div>CVR: <span className="font-bold">{result.brand_analysis.brand_cvr}%</span></div>
                    <div>ACOS: <span className="font-bold">{result.brand_analysis.brand_acos}%</span></div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <h4 className="text-sm font-medium mb-2">类目词表现</h4>
                  <div className="space-y-1 text-sm">
                    <div>CTR: <span className="font-bold">{result.brand_analysis.category_ctr}%</span></div>
                    <div>CVR: <span className="font-bold">{result.brand_analysis.category_cvr}%</span></div>
                    <div>ACOS: <span className="font-bold">{result.brand_analysis.category_acos}%</span></div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Actions */}
          {result.actions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" />
                  操作建议（可编辑确认）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.actions.map((a: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={a.priority === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}>
                          {a.priority === "high" ? "高优" : "中优"}
                        </Badge>
                        <span className="text-sm font-medium">{a.title}</span>
                      </div>
                      {editingIdx === i ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleSaveEdit(i)}><Save className="w-3.5 h-3.5 text-green-500" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingIdx(null)}><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => { setEditingIdx(i); setEditText(a.action); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    {editingIdx === i ? (
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{a.action}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ============================
// Sub-component: Business Report Cross Analysis
// ============================
function BusinessCrossAnalysis() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const analyzeMutation = trpc.adDeepAnalysis.analyzeBusinessCrossReport.useMutation();

  const handleAnalyze = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await analyzeMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success("业务报告交叉分析完成");
    } catch (err: any) {
      toast.error(`分析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = (idx: number) => {
    if (result?.actions) {
      const updated = [...result.actions];
      updated[idx] = { ...updated[idx], action: editText };
      setResult({ ...result, actions: updated });
      setEditingIdx(null);
      toast.success("操作建议已更新");
    }
  };

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleAnalyze} loading={loading} actionLabel="交叉分析" />

      {result && (
        <div className="space-y-4">
          {/* TACOS Trend */}
          {result.tacos_trend?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">TACOS & 自然单占比趋势</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={result.tacos_trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="tacos" name="TACOS%" stroke="#ef4444" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="organic_ratio" name="自然单占比%" stroke="#10b981" strokeWidth={2} />
                    <Line yAxisId="left" type="monotone" dataKey="acos" name="ACOS%" stroke="#f59e0b" strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Key Metrics */}
          <div className="grid grid-cols-4 gap-3">
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">平均TACOS</p>
              <p className="text-2xl font-bold text-red-600">{result.avg_tacos || 0}%</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">平均自然单占比</p>
              <p className="text-2xl font-bold text-green-600">{result.avg_organic_ratio || 0}%</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">广告依赖度</p>
              <p className="text-2xl font-bold text-yellow-600">{result.ad_dependency || "N/A"}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">趋势判断</p>
              <p className="text-lg font-bold">{result.trend_judgment || "N/A"}</p>
            </CardContent></Card>
          </div>

          {/* Cannibalization Warning */}
          {result.cannibalization_warning && (
            <Card className="bg-red-50 border-red-200">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-red-800">广告吃自然单预警</h4>
                  <p className="text-sm text-red-700">{result.cannibalization_warning}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          {result.actions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" />
                  操作建议（可编辑确认）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.actions.map((a: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={a.priority === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}>
                          {a.priority === "high" ? "高优" : "中优"}
                        </Badge>
                        <span className="text-sm font-medium">{a.title}</span>
                      </div>
                      {editingIdx === i ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleSaveEdit(i)}><Save className="w-3.5 h-3.5 text-green-500" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingIdx(null)}><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => { setEditingIdx(i); setEditText(a.action); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    {editingIdx === i ? (
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{a.action}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ============================
// Main Report Analysis Component
// ============================
export default function AdDeepReportAnalysis() {
  const [activeReport, setActiveReport] = useState("placement");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-bold">五大报表独立深度分析</h2>
        <Badge variant="outline" className="text-xs">广告组合维度 · 每日粒度</Badge>
      </div>

      <Tabs value={activeReport} onValueChange={setActiveReport}>
        <TabsList className="grid w-full grid-cols-5 h-auto">
          {REPORT_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs gap-1 py-2">
              <tab.icon className={`w-3.5 h-3.5 ${tab.color}`} />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="placement" className="mt-4"><PlacementAnalysis /></TabsContent>
        <TabsContent value="search-term" className="mt-4"><SearchTermAnalysis /></TabsContent>
        <TabsContent value="impression-share" className="mt-4"><ImpressionShareAnalysis /></TabsContent>
        <TabsContent value="sb-benchmark" className="mt-4"><SbBenchmarkAnalysis /></TabsContent>
        <TabsContent value="business-cross" className="mt-4"><BusinessCrossAnalysis /></TabsContent>
      </Tabs>
    </div>
  );
}
