import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Sparkles, Loader2, Layers, DollarSign, TrendingUp, Target,
  ArrowRight, BarChart3,
} from "lucide-react";

interface Props {
  marketplace: string;
  reportDate: string;
}

const CHANNEL_COLORS: Record<string, string> = {
  SP: "#3b82f6",
  SB: "#10b981",
  SD: "#f59e0b",
  DSP: "#8b5cf6",
};

export default function CrossChannelAnalysis({ marketplace, reportDate }: Props) {
  const [aiAdvice, setAiAdvice] = useState<any>(null);
  const [isEditingAdvice, setIsEditingAdvice] = useState(false);
  const [editedAdvice, setEditedAdvice] = useState<any>(null);



  const { data, isLoading } = trpc.adAnalysisP2.getCrossChannelData.useQuery({
    marketplace,
    startDate: reportDate,
    endDate: reportDate,
  });

  const aiMutation = trpc.adAnalysisP2.aiChannelStrategy.useMutation({
    onSuccess: (result) => {
      setAiAdvice(result);
      setEditedAdvice(result);
      toast.success("AI跨渠道策略已生成");
    },
    onError: (err) => toast.error(`AI分析失败: ${err.message}`),
  });

  const handleAiAnalysis = () => {
    if (!data?.channels) return;
    aiMutation.mutate({
      channels: data.channels.map(c => ({
        channel: c.channel,
        cost: c.cost,
        sales: c.sales,
        acos: c.acos,
        roas: c.roas,
        orders: c.orders,
        costShare: c.costShare,
      })),
      totalCost: data.total.cost,
      totalSales: data.total.sales,
    });
  };

  // Chart data
  const costShareData = useMemo(() => {
    if (!data?.channels) return [];
    return data.channels.map(c => ({
      name: c.channel,
      value: c.cost,
    }));
  }, [data]);

  const comparisonData = useMemo(() => {
    if (!data?.channels) return [];
    return data.channels.map(c => ({
      channel: c.channel,
      花费: c.cost,
      销售额: c.sales,
    }));
  }, [data]);

  const radarData = useMemo(() => {
    if (!data?.channels) return [];
    // Normalize metrics for radar chart (0-100 scale)
    const maxRoas = Math.max(...data.channels.map(c => c.roas), 1);
    const maxCtr = Math.max(...data.channels.map(c => c.ctr), 0.01);
    const maxCvr = Math.max(...data.channels.map(c => c.cvr), 1);
    const maxOrders = Math.max(...data.channels.map(c => c.orders), 1);

    return [
      { metric: "ROAS", ...Object.fromEntries(data.channels.map(c => [c.channel, Math.round((c.roas / maxRoas) * 100)])) },
      { metric: "CTR", ...Object.fromEntries(data.channels.map(c => [c.channel, Math.round((c.ctr / maxCtr) * 100)])) },
      { metric: "CVR", ...Object.fromEntries(data.channels.map(c => [c.channel, Math.round((c.cvr / maxCvr) * 100)])) },
      { metric: "订单量", ...Object.fromEntries(data.channels.map(c => [c.channel, Math.round((c.orders / maxOrders) * 100)])) },
      { metric: "花费效率", ...Object.fromEntries(data.channels.map(c => [c.channel, Math.round(Math.min(c.roas * 20, 100))])) },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const channels = data?.channels || [];
  const total = data?.total;

  return (
    <div className="space-y-4">
      {/* Channel Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {channels.map((ch) => (
          <Card key={ch.channel} className="relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: CHANNEL_COLORS[ch.channel] || "#6b7280" }} />
            <CardContent className="pt-3 pb-3 px-4 pl-5">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline" className="text-xs font-bold" style={{ color: CHANNEL_COLORS[ch.channel], borderColor: CHANNEL_COLORS[ch.channel] }}>
                  {ch.channel}
                </Badge>
                <span className="text-xs text-gray-400">{ch.costShare}%花费</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">花费</span>
                  <span className="font-medium text-red-600">${ch.cost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">销售额</span>
                  <span className="font-medium text-emerald-600">${ch.sales.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">ROAS</span>
                  <span className={`font-medium ${ch.roas >= 2 ? "text-emerald-600" : ch.roas >= 1 ? "text-amber-600" : "text-red-600"}`}>
                    {ch.roas}x
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">ACoS</span>
                  <span className={`font-medium ${ch.acos <= 25 ? "text-emerald-600" : ch.acos <= 40 ? "text-amber-600" : "text-red-600"}`}>
                    {ch.acos}%
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">订单</span>
                  <span className="font-medium">{ch.orders}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Total Summary */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "总花费", value: `$${total?.cost.toFixed(2) || 0}`, icon: DollarSign, color: "text-red-600" },
          { label: "总销售额", value: `$${total?.sales.toFixed(2) || 0}`, icon: TrendingUp, color: "text-emerald-600" },
          { label: "综合ACoS", value: `${total?.acos || 0}%`, icon: Target, color: "text-blue-600" },
          { label: "综合ROAS", value: `${total?.roas || 0}x`, icon: BarChart3, color: "text-purple-600" },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-3 pb-2.5 px-4">
              <div className="flex items-center gap-1.5 mb-0.5">
                <m.icon className={`w-3.5 h-3.5 ${m.color}`} />
                <span className="text-xs text-gray-500">{m.label}</span>
              </div>
              <p className={`text-lg font-bold ${m.color}`}>{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cost vs Sales Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">渠道花费 vs 销售额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="花费" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="销售额" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Cost Share Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">花费占比分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={costShareData}
                    cx="50%" cy="50%"
                    innerRadius={45} outerRadius={75}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {costShareData.map((entry, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[entry.name] || "#6b7280"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Radar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">渠道效率雷达图</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
                  <PolarRadiusAxis tick={{ fontSize: 8 }} domain={[0, 100]} />
                  {channels.map((ch) => (
                    <Radar
                      key={ch.channel}
                      name={ch.channel}
                      dataKey={ch.channel}
                      stroke={CHANNEL_COLORS[ch.channel]}
                      fill={CHANNEL_COLORS[ch.channel]}
                      fillOpacity={0.15}
                    />
                  ))}
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Comparison Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              渠道详细对比
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAiAnalysis} disabled={aiMutation.isPending}>
              {aiMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />} AI分析
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Table implementation here */}
        </CardContent>
      </Card>

      {/* AI Advice Card */}
      {aiAdvice && (
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              AI 跨渠道投放策略建议
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isEditingAdvice ? (
              <div>
                <textarea
                  className="w-full p-2 border rounded-md text-xs"
                  rows={6}
                  value={editedAdvice}
                  onChange={(e) => setEditedAdvice(e.target.value)}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => setIsEditingAdvice(false)}>取消</Button>
                  <Button size="sm" onClick={() => { setAiAdvice(editedAdvice); setIsEditingAdvice(false); }}>保存</Button>
                </div>
              </div>
            ) : (
              <div className="text-xs whitespace-pre-wrap" onClick={() => setIsEditingAdvice(true)}>
                {aiAdvice}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
