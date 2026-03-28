import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useMarketplace } from "@/contexts/MarketplaceContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, Cell,
} from "recharts";
import {
  DollarSign, TrendingUp, TrendingDown, Package, Target, AlertTriangle, ShoppingCart,
  Percent, Store, RefreshCw, Wifi, WifiOff, ArrowUpRight, ArrowDownRight,
  Calendar, ShieldCheck, Sparkles, Zap, Tag, Clock, ChevronLeft, ChevronRight,
  Loader2, CheckCircle, XCircle, Info,
} from "lucide-react";

// ─── Promotion Calendar Component ─────────────────────────────
function PromotionCalendar({ events }: { events: any[] }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const monthEvents = useMemo(() => {
    return events.filter(e => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      return (start.getMonth() === month && start.getFullYear() === year) ||
             (end.getMonth() === month && end.getFullYear() === year);
    });
  }, [events, month, year]);

  const getEventsForDay = (day: number) => {
    const date = new Date(year, month, day);
    return monthEvents.filter(e => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      return date >= new Date(start.toDateString()) && date <= new Date(end.toDateString());
    });
  };

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="font-semibold text-lg">{year}年{month + 1}月</span>
        <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
        ))}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-20" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayEvents = getEventsForDay(day);
          const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;
          return (
            <div key={day} className={`h-20 border rounded-md p-1 text-xs overflow-hidden ${isToday ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <div className={`font-medium mb-0.5 ${isToday ? 'text-primary' : ''}`}>{day}</div>
              {dayEvents.slice(0, 2).map((e, idx) => (
                <div key={idx} className={`truncate px-1 py-0.5 rounded text-[10px] mb-0.5 ${
                  e.type === 'deal' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                }`}>
                  {e.type === 'deal' ? '⚡' : '🎟️'} {e.asin?.slice(-4)}
                </div>
              ))}
              {dayEvents.length > 2 && (
                <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 2}更多</div>
              )}
            </div>
          );
        })}
      </div>
      {/* Event list */}
      <div className="mt-4 space-y-2">
        <h4 className="font-medium text-sm">本月活动 ({monthEvents.length})</h4>
        {monthEvents.length === 0 && <p className="text-sm text-muted-foreground">暂无促销活动</p>}
        {monthEvents.slice(0, 8).map((e, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg border text-sm">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              e.type === 'deal' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
            }`}>
              {e.type === 'deal' ? <Zap className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{e.title}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="h-3 w-3" />
                {new Date(e.startTime).toLocaleDateString()} - {new Date(e.endTime).toLocaleDateString()}
              </div>
            </div>
            <Badge variant={e.status === 'ACTIVE' ? 'default' : e.status === 'UPCOMING' || e.status === 'SCHEDULED' ? 'secondary' : 'outline'}>
              {e.status === 'ACTIVE' ? '进行中' : e.status === 'UPCOMING' || e.status === 'SCHEDULED' ? '待开始' : e.status === 'EXPIRED' ? '已结束' : e.status}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shop Health Score Card ───────────────────────────────────
function ShopHealthCard({ data }: { data: any }) {
  const scoreColor = data.level === 'excellent' ? 'text-green-500' :
    data.level === 'good' ? 'text-blue-500' :
    data.level === 'warning' ? 'text-yellow-500' : 'text-red-500';
  const scoreBg = data.level === 'excellent' ? 'bg-green-500' :
    data.level === 'good' ? 'bg-blue-500' :
    data.level === 'warning' ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6">
        <div className="relative w-28 h-28">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8"
              className={scoreColor}
              strokeDasharray={`${data.score * 2.64} 264`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${scoreColor}`}>{data.score}</span>
            <span className="text-xs text-muted-foreground">健康分</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${scoreBg}`} />
            <span className="font-medium">
              {data.level === 'excellent' ? '优秀' : data.level === 'good' ? '良好' : data.level === 'warning' ? '需关注' : '危险'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>订单缺陷率: <span className={data.metrics.orderDefectRate > 1 ? 'text-red-500 font-medium' : ''}>{data.metrics.orderDefectRate}%</span></div>
            <div>迟发率: <span className={data.metrics.lateShipmentRate > 4 ? 'text-red-500 font-medium' : ''}>{data.metrics.lateShipmentRate}%</span></div>
            <div>取消率: <span className={data.metrics.cancellationRate > 2.5 ? 'text-red-500 font-medium' : ''}>{data.metrics.cancellationRate}%</span></div>
            <div>有效追踪率: <span className={data.metrics.validTrackingRate < 95 ? 'text-red-500 font-medium' : ''}>{data.metrics.validTrackingRate}%</span></div>
          </div>
        </div>
      </div>
      {data.riskItems.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-red-500 flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> 风险项</h4>
          {data.riskItems.map((r: any, i: number) => (
            <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-red-50 text-sm">
              <span>{r.metric}</span>
              <div className="flex items-center gap-2">
                <span className="text-red-600 font-medium">{r.value}</span>
                <span className="text-muted-foreground">阈值: {r.threshold}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────
export default function OpsDashboard() {
  const [, setLocation] = useLocation();
  const { marketplace } = useMarketplace();

  // Original dashboard data
  const { data, isLoading, refetch } = trpc.operations.getDashboardOverview.useQuery({ marketplace });
  const { data: statusData } = trpc.operations.getLingxingStatus.useQuery();
  const { data: products } = trpc.productOps.listProducts.useQuery();

  // Upgrade dashboard data
  const calendarQuery = trpc.dashboardUpgrade.getPromotionCalendar.useQuery({ sid: undefined });
  const healthQuery = trpc.dashboardUpgrade.getShopHealth.useQuery({});
  const alertsQuery = trpc.dashboardUpgrade.getAlertsList.useQuery({ marketplace });
  const briefingMutation = trpc.dashboardUpgrade.aiDailyBriefing.useMutation();

  const handleGenerateBriefing = () => {
    briefingMutation.mutate({ marketplace });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  const summary = data?.summary;
  const profitTrend = data?.profitTrend || [];
  const topAlerts = data?.topAlerts || [];
  const isMock = data?.isMock;

  const kpiCards = [
    {
      title: "30天销售额",
      value: `$${(summary?.revenue30d || 0).toLocaleString()}`,
      icon: DollarSign,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
    },
    {
      title: "30天净利润",
      value: `$${(summary?.profit30d || 0).toLocaleString()}`,
      icon: TrendingUp,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      sub: `利润率 ${summary?.avgMargin || 0}%`,
    },
    {
      title: "30天订单量",
      value: (summary?.orders30d || 0).toLocaleString(),
      icon: ShoppingCart,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      title: "库存预警",
      value: `${summary?.lowStockCount || 0}`,
      icon: Package,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
      sub: `滞销 ${summary?.overstockCount || 0}`,
    },
    {
      title: "广告ACoS",
      value: `${summary?.avgAcos || 0}%`,
      icon: Target,
      color: "text-red-600",
      bgColor: "bg-red-50",
      sub: `花费 $${(summary?.adSpend30d || 0).toLocaleString()}`,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">运营仪表盘</h1>
          <p className="text-sm text-gray-500 mt-1">基于领星ERP数据的运营概览 · 促销日历 · 店铺健康 · 智能预警</p>
        </div>
        <div className="flex items-center gap-3">
          {isMock && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
              <WifiOff className="w-3 h-3 mr-1" />
              Mock数据模式
            </Badge>
          )}
          {!isMock && (
            <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50">
              <Wifi className="w-3 h-3 mr-1" />
              实时数据
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleGenerateBriefing} disabled={briefingMutation.isPending}>
            {briefingMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
            AI简报
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
        </div>
      </div>

      {/* AI Briefing Card (shown after generation) */}
      {briefingMutation.data && (
        <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI每日运营简报 — {briefingMutation.data.date}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: '销售', text: briefingMutation.data.salesSummary, icon: TrendingUp, color: 'text-blue-500' },
                { label: '广告', text: briefingMutation.data.adSummary, icon: Zap, color: 'text-orange-500' },
                { label: '库存', text: briefingMutation.data.inventorySummary, icon: Info, color: 'text-green-500' },
                { label: '退货', text: briefingMutation.data.returnSummary, icon: AlertTriangle, color: 'text-red-500' },
              ].map((item, i) => (
                <div key={i} className="p-3 rounded-lg bg-background border">
                  <div className={`text-xs font-medium ${item.color} flex items-center gap-1 mb-1`}>
                    <item.icon className="h-3 w-3" />{item.label}
                  </div>
                  <p className="text-sm">{item.text}</p>
                </div>
              ))}
            </div>
            {briefingMutation.data.priorityActions?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">今日优先事项</h4>
                <div className="space-y-1">
                  {briefingMutation.data.priorityActions.map((a: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                      <Badge variant={a.priority === 'P0' ? 'destructive' : a.priority === 'P1' ? 'default' : 'secondary'} className="text-xs">
                        {a.priority}
                      </Badge>
                      <span className="flex-1">{a.action}</span>
                      <span className="text-xs text-muted-foreground">{a.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {briefingMutation.data.opportunities?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-green-600 mb-1">机会点</h4>
                  {briefingMutation.data.opportunities.map((o: string, i: number) => (
                    <div key={i} className="text-sm flex items-start gap-1"><CheckCircle className="h-3 w-3 mt-1 text-green-500 shrink-0" />{o}</div>
                  ))}
                </div>
              )}
              {briefingMutation.data.risks?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-red-600 mb-1">风险点</h4>
                  {briefingMutation.data.risks.map((r: string, i: number) => (
                    <div key={i} className="text-sm flex items-start gap-1"><XCircle className="h-3 w-3 mt-1 text-red-500 shrink-0" />{r}</div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.title} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{kpi.title}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  {kpi.sub && <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>}
                </div>
                <div className={`p-2 rounded-lg ${kpi.bgColor}`}>
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row: Profit Trend + Shop Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profit Trend Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">收入与利润趋势</CardTitle>
            <CardDescription>近30天每日收入和利润走势</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={profitTrend}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name === "revenue" ? "收入" : "利润"]}
                    labelFormatter={(label) => `日期: ${label}`}
                  />
                  <Legend formatter={(value) => value === "revenue" ? "收入" : "利润"} />
                  <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="url(#colorRevenue)" strokeWidth={2} />
                  <Area type="monotone" dataKey="profit" stroke="#10b981" fill="url(#colorProfit)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Shop Health Score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-500" />
              店铺健康度
            </CardTitle>
            <CardDescription>账户绩效指标概览</CardDescription>
          </CardHeader>
          <CardContent>
            {healthQuery.isLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : healthQuery.data ? (
              <ShopHealthCard data={healthQuery.data} />
            ) : (
              <div className="text-center py-8 text-gray-400">
                <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无健康数据</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Alerts + Promotion Calendar */}
      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts"><AlertTriangle className="h-4 w-4 mr-1" />运营预警</TabsTrigger>
          <TabsTrigger value="calendar"><Calendar className="h-4 w-4 mr-1" />促销日历</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Original Alerts */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  异常指标预警
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topAlerts.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">暂无预警信息</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {topAlerts.map((alert, i) => (
                      <div
                        key={i}
                        className={`p-3 rounded-lg border text-sm ${
                          alert.severity === "critical"
                            ? "bg-red-50 border-red-200 text-red-800"
                            : "bg-amber-50 border-amber-200 text-amber-800"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <Badge
                            variant={alert.severity === "critical" ? "destructive" : "outline"}
                            className="text-[10px] shrink-0 mt-0.5"
                          >
                            {alert.severity === "critical" ? "紧急" : "警告"}
                          </Badge>
                          <p className="leading-snug">{alert.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Enhanced Alerts: Low Stock + Return Rate */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-orange-600">
                    <Package className="w-4 h-4" />
                    库存预警
                    {alertsQuery.data && <Badge variant="outline" className="text-xs">{alertsQuery.data.lowStockAlerts.length}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {alertsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-6"><Loader2 className="h-6 w-6 animate-spin" /></div>
                  ) : alertsQuery.data?.lowStockAlerts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无库存预警</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {alertsQuery.data?.lowStockAlerts.slice(0, 5).map((a: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant={a.severity === 'critical' ? 'destructive' : 'default'} className="text-[10px]">
                              {a.severity === 'critical' ? '紧急' : '警告'}
                            </Badge>
                            <span className="font-mono text-xs">{a.asin}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-medium text-orange-600">{a.daysOfSupply}天</span>
                            <span className="text-xs text-muted-foreground ml-2">库存{a.quantity}件</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-red-600">
                    <TrendingDown className="w-4 h-4" />
                    退货率异常
                    {alertsQuery.data && <Badge variant="outline" className="text-xs">{alertsQuery.data.returnAlerts.length}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {alertsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-6"><Loader2 className="h-6 w-6 animate-spin" /></div>
                  ) : alertsQuery.data?.returnAlerts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无退货率异常</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {alertsQuery.data?.returnAlerts.slice(0, 5).map((a: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant={a.severity === 'critical' ? 'destructive' : 'default'} className="text-[10px]">
                              {a.severity === 'critical' ? '严重' : '偏高'}
                            </Badge>
                            <span className="font-mono text-xs">{a.asin}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-medium text-red-600">{a.returnRate}%</span>
                            <span className="text-xs text-muted-foreground ml-2">退货{a.returnCount}件</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                促销活动日历
                {calendarQuery.data && (
                  <span className="text-sm font-normal text-muted-foreground">
                    秒杀 {calendarQuery.data.dealCount} · 优惠券 {calendarQuery.data.couponCount}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {calendarQuery.isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : calendarQuery.data ? (
                <PromotionCalendar events={calendarQuery.data.events} />
              ) : (
                <p className="text-muted-foreground text-center py-8">暂无数据</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Product Ranking - Clickable to Product Detail */}
      {products && products.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">产品运营排行</CardTitle>
                <CardDescription>点击产品查看详细运营数据</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setLocation("/ops/products")}>
                查看全部 <ArrowUpRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left p-3 font-medium text-gray-600">#</th>
                    <th className="text-left p-3 font-medium text-gray-600">ASIN</th>
                    <th className="text-left p-3 font-medium text-gray-600">产品名称</th>
                    <th className="text-left p-3 font-medium text-gray-600">品牌</th>
                    <th className="text-center p-3 font-medium text-gray-600">状态</th>
                    <th className="text-center p-3 font-medium text-gray-600">待办</th>
                  </tr>
                </thead>
                <tbody>
                  {products.slice(0, 8).map((p: any, i: number) => (
                    <tr
                      key={p.id}
                      className="border-b hover:bg-blue-50/50 cursor-pointer transition-colors"
                      onClick={() => setLocation(`/ops/products/${p.id}`)}
                      title="点击进入产品详情页"
                    >
                      <td className="p-3 text-gray-400">{i + 1}</td>
                      <td className="p-3 font-mono text-xs text-blue-600 hover:underline">{p.parentAsin}</td>
                      <td className="p-3 max-w-[200px] truncate">{p.title}</td>
                      <td className="p-3 text-gray-600">{p.brand || "-"}</td>
                      <td className="p-3 text-center">
                        <Badge variant="secondary" className={`text-[10px] ${
                          p.status === "active" ? "bg-emerald-100 text-emerald-700" :
                          p.status === "inactive" ? "bg-gray-100 text-gray-600" : "bg-red-100 text-red-700"
                        }`}>
                          {p.status === "active" ? "在售" : p.status === "inactive" ? "暂停" : "停售"}
                        </Badge>
                      </td>
                      <td className="p-3 text-center">
                        {p.pendingTodoCount > 0 ? (
                          <Badge variant="destructive" className="text-[10px]">{p.pendingTodoCount}</Badge>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickActionCard
          title="利润分析"
          description="查看SKU级别的利润分解和成本优化建议"
          icon={DollarSign}
          href="/ops/profit"
          color="emerald"
        />
        <QuickActionCard
          title="库存预警"
          description="FBA库存监控、补货建议和滞销预警"
          icon={Package}
          href="/ops/inventory"
          color="orange"
        />
        <QuickActionCard
          title="广告优化"
          description="搜索词分析、关键词建议和自动化规则"
          icon={Target}
          href="/ops/ads"
          color="blue"
        />
        <QuickActionCard
          title="竞品监控"
          description="竞品价格、排名、评论变化追踪"
          icon={TrendingUp}
          href="/ops/competitor"
          color="purple"
        />
      </div>
    </div>
  );
}

function QuickActionCard({ title, description, icon: Icon, href, color }: {
  title: string;
  description: string;
  icon: any;
  href: string;
  color: string;
}) {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-100" },
    orange: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-100" },
    blue: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-100" },
    purple: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-100" },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <a href={href}>
      <Card className={`hover:shadow-md transition-all cursor-pointer border ${c.border} hover:border-gray-300`}>
        <CardContent className="pt-5 pb-4 px-5">
          <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center mb-3`}>
            <Icon className={`w-5 h-5 ${c.text}`} />
          </div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</p>
          <div className={`flex items-center gap-1 mt-3 text-xs font-medium ${c.text}`}>
            查看详情 <ArrowUpRight className="w-3 h-3" />
          </div>
        </CardContent>
      </Card>
    </a>
  );
}
