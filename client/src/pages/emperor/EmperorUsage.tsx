import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, BarChart3, Cpu, Zap, TrendingUp } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#14b8a6"];

interface UsageStats {
  totalRuns: number;
  totalTokens: number;
  successRate: number;
  avgDuration: number;
  bySkill: Array<{ skillName: string; runs: number; tokens: number }>;
  byModel: Array<{ model: string; runs: number; tokens: number }>;
  byDay: Array<{ date: string; runs: number; tokens: number }>;
}

export default function EmperorUsage() {
  const { data, isLoading } = trpc.emperor.run.tokenStats.useQuery({ days: 30, groupBy: "day" });
  const stats = data as UsageStats | undefined;

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[calc(100vh-56px)]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 overflow-auto h-[calc(100vh-56px)]">
        <div>
          <h1 className="text-xl font-semibold">Token 用量统计</h1>
          <p className="text-sm text-muted-foreground mt-1">最近 30 天的 AI 调用数据</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">总运行次数</p>
                  <p className="text-2xl font-bold">{(stats?.totalRuns || 0).toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Cpu className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">总 Token 用量</p>
                  <p className="text-2xl font-bold">{((stats?.totalTokens || 0) / 1000).toFixed(1)}K</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">成功率</p>
                  <p className="text-2xl font-bold">{((stats?.successRate || 0) * 100).toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">平均耗时</p>
                  <p className="text-2xl font-bold">{((stats?.avgDuration || 0) / 1000).toFixed(1)}s</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-6">
          {/* Daily trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">每日运行趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats?.byDay || []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="runs" fill="#6366f1" radius={[3, 3, 0, 0]} name="运行次数" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Model distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">模型使用分布</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={stats?.byModel || []}
                    dataKey="runs"
                    nameKey="model"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ model, percent }) => `${model?.split('/').pop()} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {(stats?.byModel || []).map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Top skills */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最常用 Skill Top 10</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(stats?.bySkill || []).slice(0, 10).map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-right">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{item.skillName}</span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                        <span>{item.runs} 次</span>
                        <span>{(item.tokens / 1000).toFixed(1)}K tokens</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min(100, (item.runs / ((stats?.bySkill?.[0]?.runs || 1))) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
