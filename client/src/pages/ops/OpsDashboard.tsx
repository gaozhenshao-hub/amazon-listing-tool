import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useMarketplace } from "@/contexts/MarketplaceContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, Cell,
} from "recharts";
import {
  DollarSign, TrendingUp, Package, Target, AlertTriangle, ShoppingCart,
  Percent, Store, RefreshCw, Wifi, WifiOff, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

export default function OpsDashboard() {
  const [, setLocation] = useLocation();
  
  const { marketplace } = useMarketplace();
  const { data, isLoading, refetch } = trpc.operations.getDashboardOverview.useQuery({ marketplace });
  const { data: statusData } = trpc.operations.getLingxingStatus.useQuery();
  const { data: products } = trpc.productOps.listProducts.useQuery();

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
          <p className="text-sm text-gray-500 mt-1">基于领星ERP数据的运营概览</p>
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
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
        </div>
      </div>

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

      {/* Charts Row */}
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

        {/* Alerts Panel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              运营预警
            </CardTitle>
            <CardDescription>需要关注的异常指标</CardDescription>
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
      </div>

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
