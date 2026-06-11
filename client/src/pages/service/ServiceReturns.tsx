import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, AlertTriangle, Bot, TrendingDown, BarChart3, RefreshCw, FileText } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from "recharts";

const REASON_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280"];

export default function ServiceReturns() {
  const [selectedSid, setSelectedSid] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState("30");

  const marketplacesQuery = trpc.operations.getMarketplaces.useQuery();
  const returnsQuery = trpc.afterSales.getReturnAnalysis.useQuery({ sid: selectedSid, asin: undefined });
  const diagnosisMut = trpc.afterSales.aiReturnDiagnosis.useMutation();

  const data = returnsQuery.data;

  // Aggregate reason distribution for pie chart
  const reasonPieData = useMemo(() => {
    if (!data?.reasonDistribution?.length) return [];
    return data.reasonDistribution.map((r: any, i: number) => ({
      name: r.reason,
      value: r.count,
      fill: REASON_COLORS[i % REASON_COLORS.length],
    }));
  }, [data]);

  // Top ASIN return rates
  const topAsinReturns = useMemo(() => {
    if (!data?.asinReturns?.length) return [];
    return [...data.asinReturns]
      .sort((a: any, b: any) => b.return_rate - a.return_rate)
      .slice(0, 10);
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">退货分析</h1>
          <p className="text-muted-foreground text-sm mt-1">退货率监控、原因分析和AI根因诊断</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedSid?.toString() || "all"} onValueChange={v => setSelectedSid(v === "all" ? undefined : Number(v))}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="全部店铺" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部店铺</SelectItem>
              {(marketplacesQuery.data || []).flatMap((mp: any) => mp.sids.map((sid: string, i: number) => (
                <SelectItem key={sid} value={sid}>{mp.storeNames?.[i] || `${mp.name}-${sid}`}</SelectItem>
              )))}
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">近7天</SelectItem>
              <SelectItem value="14">近14天</SelectItem>
              <SelectItem value="30">近30天</SelectItem>
              <SelectItem value="60">近60天</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => returnsQuery.refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> 刷新
          </Button>
        </div>
      </div>

      {returnsQuery.isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { title: "总退货数", value: data?.summary?.totalReturns || 0, icon: Package, color: "text-red-500" },
              { title: "退货率", value: `${data?.summary?.returnRate || 0}%`, icon: TrendingDown, color: data?.summary?.returnRate > 5 ? "text-red-500" : "text-green-500" },
              { title: "退款金额", value: `$${(data?.summary?.refundAmount || 0).toLocaleString()}`, icon: BarChart3, color: "text-orange-500" },
              { title: "高退货ASIN", value: data?.summary?.highReturnAsinCount || 0, icon: AlertTriangle, color: "text-yellow-500" },
            ].map((kpi, i) => (
              <Card key={i} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{kpi.title}</span>
                    <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                  </div>
                  <div className="text-2xl font-bold">{kpi.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Return Rate Trend */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">退货率趋势</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data?.trend || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="return_rate" stroke="#ef4444" strokeWidth={2} name="退货率(%)" dot={false} />
                    <Line type="monotone" dataKey="returns" stroke="#f97316" strokeWidth={1.5} name="退货数" dot={false} />
                    <Line type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={1.5} name="订单数" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Reason Distribution Pie */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">退货原因分布</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={reasonPieData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="value"
                      label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {reasonPieData.map((entry: any, i: number) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Top ASIN Returns */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">ASIN退货率排行（Top 10）</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topAsinReturns} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="%" />
                  <YAxis type="category" dataKey="asin" width={120} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="return_rate" name="退货率" radius={[0, 4, 4, 0]}>
                    {topAsinReturns.map((entry: any, i: number) => (
                      <Cell key={i} fill={entry.return_rate > 8 ? "#ef4444" : entry.return_rate > 5 ? "#f97316" : "#22c55e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* RMA Detail Table */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">退货明细</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">订单号</th>
                      <th className="pb-2 font-medium text-muted-foreground">ASIN</th>
                      <th className="pb-2 font-medium text-muted-foreground">退货原因</th>
                      <th className="pb-2 font-medium text-muted-foreground">状态</th>
                      <th className="pb-2 font-medium text-muted-foreground">退款金额</th>
                      <th className="pb-2 font-medium text-muted-foreground">日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recentReturns || []).slice(0, 15).map((r: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/30">
                        <td className="py-2 font-mono text-xs">{r.order_id}</td>
                        <td className="py-2">{r.asin}</td>
                        <td className="py-2"><Badge variant="outline" className="text-xs">{r.return_reason}</Badge></td>
                        <td className="py-2">
                          <Badge variant={r.status === "refunded" ? "default" : r.status === "pending" ? "secondary" : "destructive"} className="text-xs">
                            {r.status === "refunded" ? "已退款" : r.status === "pending" ? "处理中" : r.status}
                          </Badge>
                        </td>
                        <td className="py-2">${r.refund_amount?.toFixed(2)}</td>
                        <td className="py-2 text-muted-foreground text-xs">{r.return_date}</td>
                      </tr>
                    ))}
                    {(!data?.recentReturns?.length) && (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">暂无退货数据</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* AI Root Cause Diagnosis */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Bot className="h-5 w-5 text-blue-500" /> AI退货根因诊断
                </CardTitle>
                <Button size="sm" onClick={() => diagnosisMut.mutate({ asin: 'ALL', returnData: data })} disabled={diagnosisMut.isPending}>
                  {diagnosisMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Bot className="h-4 w-4 mr-1" />}
                  开始诊断
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {diagnosisMut.data ? (
                <div className="space-y-4">
                  {/* Root Causes */}
                  {(diagnosisMut.data as any).rootCauses?.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2 text-sm">根本原因分析</h4>
                      <div className="space-y-2">
                        {(diagnosisMut.data as any).rootCauses.map((cause: any, i: number) => (
                          <div key={i} className="p-3 rounded-lg border">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm">{cause.cause}</span>
                              <Badge variant={cause.impact === "high" ? "destructive" : cause.impact === "medium" ? "default" : "secondary"}>
                                影响: {cause.impact === "high" ? "高" : cause.impact === "medium" ? "中" : "低"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{cause.description}</p>
                            <div className="text-xs mt-1">占比: <strong>{cause.percentage}%</strong></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Improvement Actions */}
                  {(diagnosisMut.data as any).improvementActions?.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2 text-sm">改进行动计划</h4>
                      <div className="space-y-2">
                        {(diagnosisMut.data as any).improvementActions.map((action: any, i: number) => (
                          <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                            <Badge variant="outline" className="shrink-0">P{action.priority}</Badge>
                            <div>
                              <div className="text-sm font-medium">{action.action}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                负责部门: {action.department} · 预期降低退货率: {action.expectedReduction}%
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Listing Optimization */}
                  {(diagnosisMut.data as any).listingOptimization && (
                    <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20">
                      <h4 className="font-medium mb-1 text-sm">Listing优化建议</h4>
                      <p className="text-sm text-muted-foreground">{(diagnosisMut.data as any).listingOptimization}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">点击"开始诊断"让AI分析退货数据并生成根因报告</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
