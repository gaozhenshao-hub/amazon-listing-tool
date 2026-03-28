import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Star, Package, Mail, AlertTriangle, TrendingUp, TrendingDown, ShieldCheck, Bot, RefreshCw } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Area, AreaChart
} from "recharts";

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];

export default function ServiceDashboard() {
  const [selectedSid, setSelectedSid] = useState<number | undefined>();
  const marketplacesQuery = trpc.operations.getMarketplaces.useQuery();
  const dashQuery = trpc.afterSales.getDashboardStats.useQuery({ sid: selectedSid });
  const briefingMut = trpc.afterSales.aiServiceBriefing.useMutation();

  const dash = dashQuery.data;

  // KPI Cards data
  const kpiCards = useMemo(() => {
    if (!dash) return [];
    return [
      { title: "平均评分", value: dash.reviews.averageRating?.toFixed(1) || "N/A", icon: Star, color: "text-yellow-500", sub: `共${dash.reviews.totalReviews}条Review` },
      { title: "差评数(1-2星)", value: dash.reviews.negativeCount || 0, icon: AlertTriangle, color: "text-red-500", sub: "近30天" },
      { title: "退货率", value: `${dash.returns.returnRate}%`, icon: Package, color: dash.returns.returnRate > 5 ? "text-red-500" : "text-green-500", sub: `${dash.returns.totalReturns}/${dash.returns.totalOrders}` },
      { title: "Feedback好评率", value: `${dash.feedback.positiveRate}%`, icon: TrendingUp, color: "text-green-500", sub: `共${dash.feedback.totalFeedback}条` },
      { title: "未读邮件", value: dash.emails.unread || 0, icon: Mail, color: dash.emails.unread > 5 ? "text-orange-500" : "text-blue-500", sub: `总邮件${dash.emails.total}` },
      { title: "店铺健康", value: dash.performance.account_health_rating || "N/A", icon: ShieldCheck, color: "text-emerald-500", sub: `ODR: ${dash.performance.order_defect_rate || 0}%` },
    ];
  }, [dash]);

  // Star distribution for pie chart
  const starDistribution = useMemo(() => {
    if (!dash?.reviewTrend?.length) return [];
    const totals = { "1星": 0, "2星": 0, "3星": 0, "4星": 0, "5星": 0 };
    dash.reviewTrend.forEach((d: any) => {
      totals["1星"] += d.star_1 || 0;
      totals["2星"] += d.star_2 || 0;
      totals["3星"] += d.star_3 || 0;
      totals["4星"] += d.star_4 || 0;
      totals["5星"] += d.star_5 || 0;
    });
    return Object.entries(totals).map(([name, value]) => ({ name, value }));
  }, [dash]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">售后管理仪表盘</h1>
          <p className="text-muted-foreground text-sm mt-1">实时监控Review、退货、邮件和店铺绩效</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedSid?.toString() || "all"} onValueChange={v => setSelectedSid(v === "all" ? undefined : Number(v))}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="全部店铺" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部店铺</SelectItem>
              {(marketplacesQuery.data || []).flatMap((mp: any) => mp.sids.map((sid: string, i: number) => (
                <SelectItem key={sid} value={sid}>{mp.storeNames?.[i] || `${mp.name}-${sid}`}</SelectItem>
              )))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => dashQuery.refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> 刷新
          </Button>
        </div>
      </div>

      {dashQuery.isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {kpiCards.map((kpi, i) => (
              <Card key={i} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{kpi.title}</span>
                    <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                  </div>
                  <div className="text-2xl font-bold">{kpi.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Review Trend */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Review趋势（近30天）</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={dash?.reviewTrend || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="star_5" stackId="1" stroke="#22c55e" fill="#22c55e" fillOpacity={0.6} name="5星" />
                    <Area type="monotone" dataKey="star_4" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} name="4星" />
                    <Area type="monotone" dataKey="star_3" stackId="1" stroke="#eab308" fill="#eab308" fillOpacity={0.6} name="3星" />
                    <Area type="monotone" dataKey="star_2" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.6} name="2星" />
                    <Area type="monotone" dataKey="star_1" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} name="1星" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Return Rate Trend */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">退货率趋势（近30天）</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={dash?.returnTrend || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip formatter={(v: number) => `${v}%`} />
                    <Legend />
                    <Line type="monotone" dataKey="return_rate" stroke="#ef4444" strokeWidth={2} name="退货率" dot={false} />
                    <Line type="monotone" dataKey="returns" stroke="#f97316" strokeWidth={1.5} name="退货数" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Star Distribution + Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">评分分布</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={starDistribution} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {starDistribution.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Shop Performance Metrics */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">店铺绩效指标</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "订单缺陷率(ODR)", value: `${dash?.performance?.order_defect_rate || 0}%`, threshold: 1, actual: dash?.performance?.order_defect_rate || 0 },
                    { label: "迟发率", value: `${dash?.performance?.late_shipment_rate || 0}%`, threshold: 4, actual: dash?.performance?.late_shipment_rate || 0 },
                    { label: "预取消率", value: `${dash?.performance?.pre_fulfillment_cancel_rate || 0}%`, threshold: 2.5, actual: dash?.performance?.pre_fulfillment_cancel_rate || 0 },
                    { label: "有效追踪率", value: `${dash?.performance?.valid_tracking_rate || 0}%`, threshold: 95, actual: dash?.performance?.valid_tracking_rate || 100, reverse: true },
                    { label: "准时送达率", value: `${dash?.performance?.on_time_delivery_rate || 0}%`, threshold: 97, actual: dash?.performance?.on_time_delivery_rate || 100, reverse: true },
                    { label: "退货不满意率", value: `${dash?.performance?.return_dissatisfaction_rate || 0}%`, threshold: 10, actual: dash?.performance?.return_dissatisfaction_rate || 0 },
                    { label: "客服不满意率", value: `${dash?.performance?.customer_service_dissatisfaction_rate || 0}%`, threshold: 25, actual: dash?.performance?.customer_service_dissatisfaction_rate || 0 },
                    { label: "账户健康", value: dash?.performance?.account_health_rating || "N/A", threshold: 0, actual: 0 },
                  ].map((m, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-muted/30">
                      <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
                      <div className="text-lg font-semibold">{m.value}</div>
                      {m.threshold > 0 && (
                        <Badge variant={
                          (m as any).reverse
                            ? m.actual >= m.threshold ? "default" : "destructive"
                            : m.actual <= m.threshold ? "default" : "destructive"
                        } className="text-[10px] mt-1">
                          {(m as any).reverse
                            ? m.actual >= m.threshold ? "达标" : "预警"
                            : m.actual <= m.threshold ? "达标" : "预警"
                          }
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* AI Briefing */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Bot className="h-5 w-5 text-blue-500" /> AI售后日报
                </CardTitle>
                <Button size="sm" onClick={() => briefingMut.mutate({ sid: selectedSid })} disabled={briefingMut.isPending}>
                  {briefingMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Bot className="h-4 w-4 mr-1" />}
                  生成AI简报
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {briefingMut.data ? (
                <div className="space-y-4">
                  {/* Health Score */}
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30">
                    <div className={`text-4xl font-bold ${(briefingMut.data as any).healthScore >= 80 ? 'text-green-500' : (briefingMut.data as any).healthScore >= 60 ? 'text-yellow-500' : 'text-red-500'}`}>
                      {(briefingMut.data as any).healthScore}
                    </div>
                    <div>
                      <div className="font-medium">售后健康评分</div>
                      <div className="text-sm text-muted-foreground">{(briefingMut.data as any).summary}</div>
                    </div>
                  </div>

                  {/* Alerts */}
                  {(briefingMut.data as any).alerts?.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2 text-sm">紧急事项</h4>
                      <div className="space-y-2">
                        {(briefingMut.data as any).alerts.map((alert: any, i: number) => (
                          <div key={i} className={`p-3 rounded-lg border-l-4 ${alert.level === 'critical' ? 'border-l-red-500 bg-red-50 dark:bg-red-950/20' : alert.level === 'warning' ? 'border-l-yellow-500 bg-yellow-50 dark:bg-yellow-950/20' : 'border-l-blue-500 bg-blue-50 dark:bg-blue-950/20'}`}>
                            <div className="font-medium text-sm">{alert.title}</div>
                            <div className="text-xs text-muted-foreground mt-1">{alert.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {(briefingMut.data as any).recommendations?.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2 text-sm">改进建议</h4>
                      <div className="space-y-2">
                        {(briefingMut.data as any).recommendations.map((rec: any, i: number) => (
                          <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                            <Badge variant="outline" className="shrink-0">P{rec.priority}</Badge>
                            <div>
                              <div className="text-sm font-medium">{rec.action}</div>
                              <div className="text-xs text-muted-foreground mt-1">预期效果: {rec.expectedImpact}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">点击"生成AI简报"获取今日售后运营分析报告</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
