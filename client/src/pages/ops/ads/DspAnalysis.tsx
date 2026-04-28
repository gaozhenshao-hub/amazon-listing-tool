import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import {
  DollarSign, Eye, TrendingUp, ShoppingCart, MousePointerClick,
  Sparkles, Loader2, Monitor, BarChart3, Upload, FileSpreadsheet,
  ArrowRight, AlertCircle, Info,
} from "lucide-react";
import { Link } from "wouter";

interface Props {
  marketplace: string;
  reportDate: string;
  weekStartDate?: string;
  weekEndDate?: string;
}

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];

export default function DspAnalysis({ marketplace, reportDate, weekStartDate, weekEndDate }: Props) {
  const [aiAdvice, setAiAdvice] = useState<any>(null);
  const [isEditingAdvice, setIsEditingAdvice] = useState(false);
  const [editedAdvice, setEditedAdvice] = useState<any>(null);

  const { data, isLoading, refetch } = trpc.adLocalAnalysis.getDspReportLocal.useQuery({
    weekStartDate: weekStartDate || reportDate,
    weekEndDate: weekEndDate || reportDate,
  });

  const aiMutation = trpc.adLocalAnalysis.aiDspStrategyLocal.useMutation({
    onSuccess: (result) => {
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setAiAdvice(result.strategy);
      setEditedAdvice(result.strategy);
      toast.success("AI DSP投放建议已生成");
    },
    onError: (err) => toast.error(`AI分析失败: ${err.message}`),
  });

  const handleAiAnalysis = () => {
    aiMutation.mutate({ question: 'DSP投放策略建议' });
  };

  // Chart data - use updated field names from local data
  const orderChartData = useMemo(() => {
    if (!data?.orders) return [];
    return data.orders
      .sort((a: any, b: any) => (b.spends || 0) - (a.spends || 0))
      .slice(0, 8)
      .map((o: any) => ({
        name: (o.orderName || "").substring(0, 20),
        花费: +(o.spends || 0).toFixed(2),
        销售额: +(o.sales || 0).toFixed(2),
        DPV: o.dpv || 0,
      }));
  }, [data]);

  const spendDistribution = useMemo(() => {
    if (!data?.orders) return [];
    return data.orders
      .filter((o: any) => (o.spends || 0) > 0)
      .map((o: any) => ({
        name: (o.orderName || "").substring(0, 15),
        value: +(o.spends || 0).toFixed(2),
      }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ─── Friendly Empty State ─────────────────────────────────────
  if (!data?.hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
            <Monitor className="w-12 h-12 text-purple-400" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center border-2 border-white">
            <Upload className="w-5 h-5 text-amber-500" />
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mb-2">暂无 DSP 广告数据</h3>
        <p className="text-sm text-gray-500 text-center max-w-md mb-6 leading-relaxed">
          DSP（Demand-Side Platform）是亚马逊的展示型广告平台，支持站内外精准投放。
          上传 DSP 报告后，即可查看订单级别的花费、销售、ROAS 等核心指标分析。
        </p>

        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-5 max-w-lg w-full mb-6">
          <div className="flex items-start gap-3 mb-4">
            <Info className="w-5 h-5 text-purple-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">如何获取 DSP 报告？</p>
              <p className="text-xs text-gray-500 leading-relaxed">
                登录 Amazon DSP 控制台 → 报告中心 → 选择「订单报告」→ 设置日期范围 → 导出 Excel/CSV 文件
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-xs text-gray-600">
              <div className="w-5 h-5 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center font-bold text-[10px]">1</div>
              <span>从 Amazon DSP 控制台导出订单报告（Excel 格式）</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-gray-600">
              <div className="w-5 h-5 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center font-bold text-[10px]">2</div>
              <span>前往「数据导入中心」，选择「DSP广告报告」类型上传</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-gray-600">
              <div className="w-5 h-5 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center font-bold text-[10px]">3</div>
              <span>上传成功后，返回此页面查看 DSP 数据分析和 AI 投放建议</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/ops/ad-report-upload">
            <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              前往数据导入中心
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            刷新检查
          </Button>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4 max-w-lg w-full">
          {[
            { icon: DollarSign, label: "花费与ROAS分析", desc: "订单级别投入产出" },
            { icon: Eye, label: "曝光与DPV追踪", desc: "品牌展示效果评估" },
            { icon: Sparkles, label: "AI投放建议", desc: "智能优化策略推荐" },
          ].map((f) => (
            <div key={f.label} className="text-center p-3 rounded-lg bg-gray-50 border border-gray-100">
              <f.icon className="w-5 h-5 text-gray-400 mx-auto mb-1.5" />
              <p className="text-xs font-medium text-gray-600">{f.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Data Display ─────────────────────────────────────────────
  const kpi = data?.kpi;
  const orders = data?.orders || [];

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "DSP总花费", value: `$${(kpi?.totalSpends || 0).toFixed(2)}`, icon: DollarSign, color: "text-red-600", bg: "bg-red-50" },
          { label: "DSP总销售额", value: `$${(kpi?.totalSales || 0).toFixed(2)}`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "ROAS", value: `${(kpi?.roas || 0).toFixed(2)}x`, icon: BarChart3, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "DPV", value: (kpi?.totalDpv || 0).toLocaleString(), icon: Eye, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "加购次数", value: (kpi?.totalAddToCart || 0).toLocaleString(), icon: ShoppingCart, color: "text-amber-600", bg: "bg-amber-50" },
        ].map((k) => (
          <Card key={k.label} className={`${k.bg} border-none`}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <k.icon className={`w-4 h-4 ${k.color}`} />
                <span className="text-xs text-gray-600">{k.label}</span>
              </div>
              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "总曝光", value: (kpi?.totalImpressions || 0).toLocaleString() },
          { label: "可见曝光", value: (kpi?.totalViewable || 0).toLocaleString() },
          { label: "可见曝光率", value: `${((kpi?.viewabilityRate || 0) * 100).toFixed(1)}%` },
          { label: "ACoS", value: `${((kpi?.acos || 0) * 100).toFixed(1)}%` },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-3 pb-2.5 px-4">
              <span className="text-xs text-gray-500">{m.label}</span>
              <p className="text-lg font-semibold mt-0.5">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">DSP订单花费 vs 销售额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={orderChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="花费" fill="#ef4444" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="销售额" fill="#10b981" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">DSP花费分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={spendDistribution}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {spendDistribution.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DSP Order Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">DSP订单明细 ({orders.length})</CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAiAnalysis} disabled={aiMutation.isPending || orders.length === 0}>
              {aiMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
              AI DSP投放建议
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left p-2.5 font-medium text-gray-600 w-8">#</th>
                  <th className="text-left p-2.5 font-medium text-gray-600">订单名称</th>
                  <th className="text-center p-2.5 font-medium text-gray-600">状态</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">预算</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">花费</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">销售额</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">ROAS</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">DPV</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">加购</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">订单</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any, i: number) => {
                  const roas = o.spends > 0 ? (o.sales / o.spends).toFixed(2) : "0";
                  return (
                    <tr key={i} className="border-b hover:bg-gray-50/50">
                      <td className="p-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="p-2.5 text-xs font-medium max-w-[200px] truncate">{o.orderName}</td>
                      <td className="p-2.5 text-center">
                        <Badge variant="outline" className={`text-[10px] ${o.orderStatus === 'RUNNING' ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-600'}`}>
                          {o.orderStatus || '-'}
                        </Badge>
                      </td>
                      <td className="p-2.5 text-right text-xs">${(o.orderBudget || 0).toFixed(2)}</td>
                      <td className="p-2.5 text-right text-xs text-red-600">${(o.spends || 0).toFixed(2)}</td>
                      <td className="p-2.5 text-right text-xs font-medium text-emerald-600">${(o.sales || 0).toFixed(2)}</td>
                      <td className="p-2.5 text-right text-xs">
                        <span className={`font-medium ${Number(roas) >= 2 ? "text-emerald-600" : Number(roas) >= 1 ? "text-amber-600" : "text-red-600"}`}>
                          {roas}x
                        </span>
                      </td>
                      <td className="p-2.5 text-right text-xs">{(o.impressions || 0).toLocaleString()}</td>
                      <td className="p-2.5 text-right text-xs">{o.dpv || 0}</td>
                      <td className="p-2.5 text-right text-xs">{o.totalAddToCart || 0}</td>
                      <td className="p-2.5 text-right text-xs">{o.orders || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* AI Advice Card */}
      {(aiAdvice || aiMutation.isPending) && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                AI DSP投放建议
              </CardTitle>
              <div className="flex gap-2">
                {aiAdvice && !isEditingAdvice && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsEditingAdvice(true)}>
                    编辑
                  </Button>
                )}
                {isEditingAdvice && (
                  <>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setAiAdvice(editedAdvice); setIsEditingAdvice(false); toast.success("已保存修改"); }}>
                      保存
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditedAdvice(aiAdvice); setIsEditingAdvice(false); }}>
                      取消
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {aiMutation.isPending ? (
              <div className="flex items-center gap-2 py-4 justify-center text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">AI正在分析DSP投放数据...</span>
              </div>
            ) : aiAdvice && (
              <>
                {/* Analysis */}
                {aiAdvice.analysis && (
                  <div>
                    <Badge variant="outline" className="bg-blue-100 text-blue-700 text-xs mb-1">整体分析</Badge>
                    {isEditingAdvice ? (
                      <textarea
                        className="w-full text-sm p-2 border rounded-md bg-white min-h-[60px]"
                        value={editedAdvice?.analysis || ""}
                        onChange={(e) => setEditedAdvice({ ...editedAdvice, analysis: e.target.value })}
                      />
                    ) : (
                      <p className="text-sm text-gray-700 whitespace-pre-line">{aiAdvice.analysis}</p>
                    )}
                  </div>
                )}

                {/* Key Metrics */}
                {aiAdvice.key_metrics && (
                  <div>
                    <Badge variant="outline" className="bg-purple-100 text-purple-700 text-xs mb-1">关键指标评估</Badge>
                    <div className="grid grid-cols-3 gap-2 mt-1">
                      {[
                        { label: "ROAS评估", value: aiAdvice.key_metrics.roas_assessment },
                        { label: "预算效率", value: aiAdvice.key_metrics.budget_efficiency },
                        { label: "受众质量", value: aiAdvice.key_metrics.audience_quality },
                      ].map((m) => (
                        <div key={m.label} className="bg-white p-2 rounded border text-xs">
                          <span className="font-medium text-gray-600">{m.label}</span>
                          <p className="text-gray-700 mt-0.5">{m.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {aiAdvice.recommendations?.length > 0 && (
                  <div>
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-700 text-xs mb-1">优化建议</Badge>
                    <div className="space-y-1.5 mt-1">
                      {aiAdvice.recommendations.map((r: any, i: number) => (
                        <div key={i} className="text-xs bg-white p-2.5 rounded border flex items-start gap-2">
                          <Badge variant="outline" className={`shrink-0 text-[10px] ${r.priority === '高' ? 'bg-red-50 text-red-600' : r.priority === '中' ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-600'}`}>
                            {r.priority}
                          </Badge>
                          <div>
                            <span className="font-medium">{r.area}</span>
                            <p className="text-gray-600 mt-0.5">{r.suggestion}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
