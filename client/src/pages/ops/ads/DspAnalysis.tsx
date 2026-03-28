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
  Sparkles, Loader2, Monitor, BarChart3,
} from "lucide-react";

interface Props {
  marketplace: string;
  days: number;
}

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];

export default function DspAnalysis({ marketplace, days }: Props) {
  const [aiAdvice, setAiAdvice] = useState<any>(null);
  const [isEditingAdvice, setIsEditingAdvice] = useState(false);
  const [editedAdvice, setEditedAdvice] = useState<any>(null);

  const startDate = useMemo(() => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10), [days]);
  const endDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const { data, isLoading, refetch } = trpc.adAnalysisP2.getDspReport.useQuery({
    marketplace,
    startDate,
    endDate,
  });

  const aiMutation = trpc.adAnalysisP2.aiDspStrategy.useMutation({
    onSuccess: (result) => {
      setAiAdvice(result);
      setEditedAdvice(result);
      toast.success("AI DSP投放建议已生成");
    },
    onError: (err) => toast.error(`AI分析失败: ${err.message}`),
  });

  const handleAiAnalysis = () => {
    if (!data?.kpi) return;
    const topOrders = (data.orders || [])
      .sort((a: any, b: any) => (b.spends || 0) - (a.spends || 0))
      .slice(0, 5)
      .map((o: any) => ({
        order_name: o.order_name,
        spends: o.spends || 0,
        sales: o.sales || 0,
        roas: o.spends > 0 ? +(o.sales / o.spends).toFixed(2) : 0,
        dpv: o.dpv || 0,
      }));
    aiMutation.mutate({ kpi: data.kpi, topOrders });
  };

  // Chart data
  const orderChartData = useMemo(() => {
    if (!data?.orders) return [];
    return data.orders
      .sort((a: any, b: any) => (b.spends || 0) - (a.spends || 0))
      .slice(0, 8)
      .map((o: any) => ({
        name: (o.order_name || "").substring(0, 20),
        花费: +(o.spends || 0).toFixed(2),
        销售额: +(o.sales || 0).toFixed(2),
        DPV: o.dpv || 0,
      }));
  }, [data]);

  const spendDistribution = useMemo(() => {
    if (!data?.orders) return [];
    return data.orders.map((o: any) => ({
      name: (o.order_name || "").substring(0, 15),
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

  const kpi = data?.kpi;
  const orders = data?.orders || [];

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "DSP总花费", value: `$${(kpi?.totalSpends || 0).toFixed(2)}`, icon: DollarSign, color: "text-red-600", bg: "bg-red-50" },
          { label: "DSP总销售额", value: `$${(kpi?.totalSales || 0).toFixed(2)}`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "ROAS", value: `${kpi?.roas || 0}x`, icon: BarChart3, color: "text-blue-600", bg: "bg-blue-50" },
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
          { label: "可见曝光率", value: `${kpi?.viewabilityRate || 0}%` },
          { label: "ACoS", value: `${kpi?.acos || 0}%` },
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
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAiAnalysis} disabled={aiMutation.isPending}>
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
                {orders.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-8 text-gray-400">暂无DSP订单数据</td></tr>
                ) : (
                  orders.map((o: any, i: number) => {
                    const roas = o.spends > 0 ? (o.sales / o.spends).toFixed(2) : "0";
                    return (
                      <tr key={i} className="border-b hover:bg-gray-50/50">
                        <td className="p-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="p-2.5 text-xs font-medium max-w-[200px] truncate">{o.order_name}</td>
                        <td className="p-2.5 text-right text-xs">${(o.order_budget || 0).toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs text-red-600">${(o.spends || 0).toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs font-medium text-emerald-600">${(o.sales || 0).toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs">
                          <span className={`font-medium ${Number(roas) >= 2 ? "text-emerald-600" : Number(roas) >= 1 ? "text-amber-600" : "text-red-600"}`}>
                            {roas}x
                          </span>
                        </td>
                        <td className="p-2.5 text-right text-xs">{(o.impressions || 0).toLocaleString()}</td>
                        <td className="p-2.5 text-right text-xs">{o.dpv || 0}</td>
                        <td className="p-2.5 text-right text-xs">{o.total_add_to_cart || 0}</td>
                        <td className="p-2.5 text-right text-xs">{o.orders || 0}</td>
                      </tr>
                    );
                  })
                )}
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
                {[
                  { label: "问题分析", key: "problemAnalysis", color: "bg-red-100 text-red-700" },
                  { label: "优化目标", key: "adPurpose", color: "bg-blue-100 text-blue-700" },
                  { label: "优化策略", key: "adStrategy", color: "bg-emerald-100 text-emerald-700" },
                  { label: "预期效果", key: "expectedResult", color: "bg-purple-100 text-purple-700" },
                ].map(({ label, key, color }) => (
                  <div key={key}>
                    <Badge variant="outline" className={`${color} text-xs mb-1`}>{label}</Badge>
                    {isEditingAdvice ? (
                      <textarea
                        className="w-full text-sm p-2 border rounded-md bg-white min-h-[60px]"
                        value={editedAdvice?.[key] || ""}
                        onChange={(e) => setEditedAdvice({ ...editedAdvice, [key]: e.target.value })}
                      />
                    ) : (
                      <p className="text-sm text-gray-700 whitespace-pre-line">{aiAdvice[key]}</p>
                    )}
                  </div>
                ))}
                {aiAdvice.orderRecommendations?.length > 0 && (
                  <div>
                    <Badge variant="outline" className="bg-amber-100 text-amber-700 text-xs mb-1">订单优化建议</Badge>
                    <div className="space-y-1">
                      {aiAdvice.orderRecommendations.map((r: any, i: number) => (
                        <div key={i} className="text-xs bg-white p-2 rounded border">
                          <span className="font-medium">{r.orderName}</span>: {r.action}
                          <span className="text-gray-500 ml-1">({r.reason})</span>
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
