/**
 * 物流时效分析页面
 * 
 * 展示NextSLS物流运单的时效统计，按渠道/目的国聚合，
 * 并显示与库存预警模块的联动状态。
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Clock,
  RefreshCw,
  TrendingUp,
  Package,
  Truck,
  Globe,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Ship,
  Plane,
  ChevronRight,
  Activity,
  Zap,
} from "lucide-react";

export default function OpsLogistics() {
  const [selectedCountry, setSelectedCountry] = useState<string>("all");

  // Queries
  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = trpc.logistics.getTransitOverview.useQuery();
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.logistics.getTransitStats.useQuery({
    country: selectedCountry === "all" ? undefined : selectedCountry,
  });
  const { data: config } = trpc.logistics.getConfig.useQuery();

  // Mutations
  const refreshMut = trpc.logistics.refreshTransitAnalysis.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchOverview();
      refetchStats();
    },
    onError: (e) => toast.error(e.message),
  });

  const isConfigured = config?.isReady;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Clock className="h-6 w-6 text-blue-500" />
            物流时效分析
          </h1>
          <p className="text-muted-foreground mt-1">
            基于NextSLS真实运单数据，自动计算各渠道/目的国的头程运输天数，反哺库存预警模块
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchOverview(); refetchStats(); }}
            className="gap-1.5"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={() => refreshMut.mutate({})}
            disabled={refreshMut.isPending || !isConfigured}
            className="gap-1.5"
          >
            {refreshMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            重新分析
          </Button>
        </div>
      </div>

      {/* Connection Status */}
      {!isConfigured && (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">物流API未配置</p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  请先在 <a href="/settings" className="underline font-medium">系统设置 → 物流API</a> 中配置NextSLS凭证，才能获取真实物流时效数据。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Flow Diagram */}
      <Card className="border-blue-100 dark:border-blue-900 bg-gradient-to-r from-blue-50/50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20">
        <CardContent className="pt-5 pb-4">
          <p className="text-sm font-medium mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            数据流向：物流时效 → 库存预警
          </p>
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="px-3 py-2 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" />
              NextSLS运单轨迹
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="px-3 py-2 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 font-medium flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              时效统计引擎
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="px-3 py-2 rounded-lg bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 font-medium flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              头程天数计算
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="px-3 py-2 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />
              补货/断货预警
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Overview Cards */}
      {overviewLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-28 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : overview ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">分析运单数</p>
                  <p className="text-2xl font-bold mt-1">{overview.totalShipments || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900">
                  <Truck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">覆盖渠道数</p>
                  <p className="text-2xl font-bold mt-1">{new Set(overview.channels.map((c: any) => c.service)).size || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-purple-100 dark:bg-purple-900">
                  <Ship className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">覆盖目的国</p>
                  <p className="text-2xl font-bold mt-1">{new Set(overview.channels.map((c: any) => c.country)).size || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-amber-100 dark:bg-amber-900">
                  <Globe className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">平均头程天数</p>
                  <p className="text-2xl font-bold mt-1">
                    {overview.channels.length > 0
                      ? `${(overview.channels.reduce((s: number, c: any) => s + c.avgDays, 0) / overview.channels.length).toFixed(1)}天`
                      : "--"}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-900">
                  <Clock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Filter */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">目的国筛选：</span>
          <Select value={selectedCountry} onValueChange={setSelectedCountry}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="全部国家" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部国家</SelectItem>
              <SelectItem value="US">美国 (US)</SelectItem>
              <SelectItem value="UK">英国 (UK)</SelectItem>
              <SelectItem value="DE">德国 (DE)</SelectItem>
              <SelectItem value="FR">法国 (FR)</SelectItem>
              <SelectItem value="JP">日本 (JP)</SelectItem>
              <SelectItem value="CA">加拿大 (CA)</SelectItem>
              <SelectItem value="AU">澳大利亚 (AU)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Transit Time Stats Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            物流时效统计明细
          </CardTitle>
          <CardDescription>
            按物流渠道和目的国统计的平均运输天数，数据来源于NextSLS历史运单轨迹
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : stats && Array.isArray(stats) && stats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-3 font-medium">物流渠道</th>
                    <th className="text-left py-3 px-3 font-medium">目的国</th>
                    <th className="text-center py-3 px-3 font-medium">运单数</th>
                    <th className="text-center py-3 px-3 font-medium">平均天数</th>
                    <th className="text-center py-3 px-3 font-medium">最快</th>
                    <th className="text-center py-3 px-3 font-medium">最慢</th>
                    <th className="text-center py-3 px-3 font-medium">时效评级</th>
                    <th className="text-center py-3 px-3 font-medium">库存预警联动</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((stat: any, i: number) => {
                    const avgDays = stat.avgDays || stat.avg_days || 0;
                    const rating = avgDays <= 15 ? "fast" : avgDays <= 30 ? "normal" : "slow";
                    return (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            {(stat.service || "").toLowerCase().includes("air") || (stat.service || "").toLowerCase().includes("快递") ? (
                              <Plane className="h-4 w-4 text-blue-500" />
                            ) : (
                              <Ship className="h-4 w-4 text-indigo-500" />
                            )}
                            <span className="font-medium">{stat.service || stat.channel || "未知渠道"}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant="outline" className="font-mono">
                            {stat.country || stat.destination || "--"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-center">{stat.count || stat.shipmentCount || 0}</td>
                        <td className="py-3 px-3 text-center">
                          <span className="font-bold text-base">{avgDays.toFixed(1)}</span>
                          <span className="text-muted-foreground text-xs ml-0.5">天</span>
                        </td>
                        <td className="py-3 px-3 text-center text-emerald-600 dark:text-emerald-400">
                          {(stat.minDays || stat.min_days || 0).toFixed(0)}天
                        </td>
                        <td className="py-3 px-3 text-center text-red-600 dark:text-red-400">
                          {(stat.maxDays || stat.max_days || 0).toFixed(0)}天
                        </td>
                        <td className="py-3 px-3 text-center">
                          <Badge variant={rating === "fast" ? "default" : rating === "normal" ? "secondary" : "destructive"}>
                            {rating === "fast" ? "快速" : rating === "normal" ? "正常" : "较慢"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300 gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            已联动
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Truck className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">
                {isConfigured ? "暂无物流时效数据，请点击\"重新分析\"从NextSLS获取历史运单" : "请先配置NextSLS物流API"}
              </p>
              {isConfigured && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={() => refreshMut.mutate({})}
                  disabled={refreshMut.isPending}
                >
                  {refreshMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  开始分析
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mapping to Replenishment Engine */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            补货引擎步骤映射
          </CardTitle>
          <CardDescription>
            物流时效数据如何映射到补货预测引擎的9步流程中
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { step: "Step 1", name: "备货生产", source: "用户配置", icon: Package, color: "bg-slate-100 dark:bg-slate-800" },
              { step: "Step 2", name: "国内运输", source: "NextSLS轨迹", icon: Truck, color: "bg-blue-50 dark:bg-blue-950" },
              { step: "Step 3", name: "出口报关", source: "NextSLS轨迹", icon: Globe, color: "bg-blue-50 dark:bg-blue-950" },
              { step: "Step 4", name: "国际运输", source: "NextSLS轨迹", icon: Ship, color: "bg-blue-50 dark:bg-blue-950" },
              { step: "Step 5", name: "目的港清关", source: "NextSLS轨迹", icon: Globe, color: "bg-blue-50 dark:bg-blue-950" },
              { step: "Step 6", name: "目的国配送", source: "NextSLS轨迹", icon: Truck, color: "bg-blue-50 dark:bg-blue-950" },
              { step: "Step 7", name: "FBA入库操作", source: "领星ERP", icon: Package, color: "bg-amber-50 dark:bg-amber-950" },
              { step: "Step 8", name: "FBA上架", source: "领星ERP", icon: CheckCircle2, color: "bg-amber-50 dark:bg-amber-950" },
              { step: "Step 9", name: "安全缓冲", source: "AI计算", icon: Zap, color: "bg-purple-50 dark:bg-purple-950" },
            ].map((item) => (
              <div key={item.step} className={`flex items-center gap-3 p-3 rounded-lg ${item.color}`}>
                <span className="text-xs font-mono text-muted-foreground w-12">{item.step}</span>
                <item.icon className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm flex-1">{item.name}</span>
                <Badge variant={item.source === "NextSLS轨迹" ? "default" : "outline"} className="text-xs">
                  {item.source}
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            * Step 2-6 的天数将优先使用NextSLS真实物流轨迹数据，当无数据时回退到用户配置的默认值
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
