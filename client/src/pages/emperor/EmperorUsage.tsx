import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, BarChart3, Cpu, Zap, TrendingUp, Calendar } from "lucide-react";
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
  LineChart,
  Line,
} from "recharts";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#14b8a6"];
const PERIOD_OPTIONS = [
  { label: "7天", value: 7 },
  { label: "30天", value: 30 },
  { label: "90天", value: 90 },
];

export default function EmperorUsage() {
  const [days, setDays] = useState(30);

  // Three separate queries matching the backend groupBy parameter
  const { data: dayData, isLoading: dayLoading } = trpc.emperor.run.tokenStats.useQuery({ days, groupBy: "day" });
  const { data: skillData, isLoading: skillLoading } = trpc.emperor.run.tokenStats.useQuery({ days, groupBy: "skill" });
  const { data: userData, isLoading: userLoading } = trpc.emperor.run.tokenStats.useQuery({ days, groupBy: "user" });
  const { data: diagStats } = trpc.emperor.diagnostics.stats.useQuery();

  const isLoading = dayLoading || skillLoading || userLoading;

  // Day-level data: { date, totalTokens, runCount }
  const byDay = (dayData as Array<{ date: string; totalTokens: number; runCount: number }> | undefined) || [];
  // Skill-level data: { skillSlug, skillName, totalTokens, runCount, avgDurationMs }
  const bySkill = (skillData as Array<{ skillSlug: string; skillName: string; totalTokens: number; runCount: number; avgDurationMs: number }> | undefined) || [];
  // User-level data: { userId, userName, totalTokens, runCount }
  const byUser = (userData as Array<{ userId: number; userName: string; totalTokens: number; runCount: number }> | undefined) || [];

  const totalRuns = byDay.reduce((s, d) => s + Number(d.runCount || 0), 0);
  const totalTokens = byDay.reduce((s, d) => s + Number(d.totalTokens || 0), 0);
  const totalSkillRuns = bySkill.reduce((s, d) => s + Number(d.runCount || 0), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-auto h-[calc(100vh-56px)]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Token 用量统计</h1>
            <p className="text-sm text-muted-foreground mt-1">AI 调用数据分析与趋势</p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            {PERIOD_OPTIONS.map(opt => (
              <Button
                key={opt.value}
                variant={days === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => setDays(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
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
                  <p className="text-2xl font-bold">{totalRuns.toLocaleString()}</p>
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
                  <p className="text-2xl font-bold">{(totalTokens / 1000).toFixed(1)}K</p>
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
                  <p className="text-xs text-muted-foreground">活跃 Skill 数</p>
                  <p className="text-2xl font-bold">{diagStats?.skillCount || 0}</p>
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
                  <p className="text-xs text-muted-foreground">今日运行</p>
                  <p className="text-2xl font-bold">{diagStats?.todayRuns || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">每日 Token 用量趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                  <Tooltip formatter={(v: number) => [`${(v/1000).toFixed(1)}K`, "Token"]} />
                  <Line type="monotone" dataKey="totalTokens" stroke="#6366f1" strokeWidth={2} dot={false} name="Token 用量" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">每日运行次数趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="runCount" fill="#8b5cf6" radius={[3, 3, 0, 0]} name="运行次数" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* User distribution */}
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">用户 Token 消耗分布</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={byUser.slice(0, 8)}
                    dataKey="totalTokens"
                    nameKey="userName"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ userName, percent }) => `${userName || "未知"} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {byUser.slice(0, 8).map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${(v/1000).toFixed(1)}K tokens`, ""]} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">用户调用排行</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {byUser.slice(0, 8).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5 text-right font-mono">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">{item.userName || `用户 ${item.userId}`}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                          <span>{Number(item.runCount).toLocaleString()} 次</span>
                          <span>{(Number(item.totalTokens) / 1000).toFixed(1)}K</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Math.min(100, (Number(item.totalTokens) / (Number(byUser[0]?.totalTokens) || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {byUser.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
                )}
              </div>
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
              {bySkill.slice(0, 10).map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-right font-mono">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{item.skillName || item.skillSlug}</span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                        <span>{Number(item.runCount).toLocaleString()} 次</span>
                        <span>{(Number(item.totalTokens) / 1000).toFixed(1)}K tokens</span>
                        <span>{(Number(item.avgDurationMs) / 1000).toFixed(1)}s avg</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${Math.min(100, (Number(item.runCount) / (totalSkillRuns || 1)) * 100 * 3)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {bySkill.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
              )}
            </div>
          </CardContent>
        </Card>
    </div>
  );
}
