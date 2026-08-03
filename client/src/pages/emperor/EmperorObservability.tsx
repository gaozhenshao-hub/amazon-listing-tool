import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Activity, Zap, Bot, Briefcase, Star, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw,
  BarChart3, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function pct(a: number, total: number): string {
  if (!total) return "0%";
  return `${((a / total) * 100).toFixed(1)}%`;
}

const COLORS = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626"];

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color = "violet", trend
}: {
  icon: any; label: string; value: string; sub?: string; color?: string; trend?: "up" | "down" | "neutral";
}) {
  const colorMap: Record<string, string> = {
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    green: "text-green-400 bg-green-500/10 border-green-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    red: "text-red-400 bg-red-500/10 border-red-500/20",
  };
  const cls = colorMap[color] ?? colorMap.violet;
  return (
    <div className="bg-[#0d1117] border border-white/8 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg border ${cls}`}>
          <Icon size={16} />
        </div>
        {trend && (
          <div className={`flex items-center gap-0.5 text-xs ${trend === "up" ? "text-green-400" : trend === "down" ? "text-red-400" : "text-slate-500"}`}>
            {trend === "up" ? <TrendingUp size={12} /> : trend === "down" ? <TrendingDown size={12} /> : null}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, color = "violet" }: { icon: any; title: string; color?: string }) {
  const colorMap: Record<string, string> = {
    violet: "text-violet-400", blue: "text-blue-400", cyan: "text-cyan-400",
    green: "text-green-400", amber: "text-amber-400",
  };
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} className={colorMap[color] ?? "text-violet-400"} />
      <span className="text-sm font-semibold text-white">{title}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmperorObservability() {
  const [days, setDays] = useState(7);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: dashData, isLoading, refetch, isFetching } = trpc.emperor.observability.dashboard.useQuery(
    { days },
    { refetchInterval: 60_000 }
  );
  const dash = dashData as any;

  const { data: evalData } = trpc.emperor.observability.evaluations.useQuery(
    { limit: 50 },
    { refetchInterval: 60_000 }
  );
  const evals = (evalData as any[]) ?? [];

  const { data: metricsData } = trpc.emperor.observability.metrics.useQuery(
    { limit: 100 },
    { refetchInterval: 60_000 }
  );
  const metrics = (metricsData as any[]) ?? [];

  const skill = dash?.summary?.skill ?? {};
  const agent = dash?.summary?.agent ?? {};
  const node = dash?.summary?.node ?? {};
  const job = dash?.summary?.job ?? {};
  const quality = dash?.summary?.quality ?? {};

  // Build chart data from metrics
  const metricsByName: Record<string, any[]> = {};
  metrics.forEach((m: any) => {
    if (!metricsByName[m.metricName]) metricsByName[m.metricName] = [];
    metricsByName[m.metricName].push(m);
  });

  // Pie data for skill success/fail
  const skillPieData = skill.totalRuns ? [
    { name: "成功", value: skill.succeededRuns ?? 0 },
    { name: "失败", value: skill.failedRuns ?? 0 },
    { name: "其他", value: Math.max(0, (skill.totalRuns ?? 0) - (skill.succeededRuns ?? 0) - (skill.failedRuns ?? 0)) },
  ].filter(d => d.value > 0) : [];

  // Eval bar data
  const evalByType = evals.reduce((acc: Record<string, number[]>, e: any) => {
    if (!acc[e.entityType]) acc[e.entityType] = [];
    if (e.score != null) acc[e.entityType].push(Number(e.score));
    return acc;
  }, {});
  const evalBarData = Object.entries(evalByType).map(([type, scores]) => ({
    name: type,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    count: scores.length,
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Activity size={20} className="text-violet-400" />
              AI OS 观测中心
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">实时监控 Skill、Agent、Job 的运行质量与性能</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="h-8 w-28 text-xs bg-[#0d1117] border-white/10 text-slate-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">近 1 天</SelectItem>
                <SelectItem value="7">近 7 天</SelectItem>
                <SelectItem value="30">近 30 天</SelectItem>
                <SelectItem value="90">近 90 天</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 text-xs border-white/10 text-slate-300 hover:bg-white/5"
            >
              {isFetching ? <Loader2 size={12} className="animate-spin mr-1" /> : <RefreshCw size={12} className="mr-1" />}
              刷新
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={24} className="animate-spin text-violet-400" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── Skill 统计 ── */}
            <div>
              <SectionHeader icon={Zap} title="Skill 运行统计" color="violet" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <StatCard icon={Zap} label="总运行次数" value={fmtNum(skill.totalRuns)} color="violet" />
                <StatCard icon={CheckCircle2} label="成功率" value={pct(skill.succeededRuns ?? 0, skill.totalRuns ?? 0)} color="green" />
                <StatCard icon={Clock} label="平均耗时" value={fmtMs(skill.avgDurationMs)} color="cyan" />
                <StatCard icon={BarChart3} label="总 Token" value={fmtNum((skill.inputTokens ?? 0) + (skill.outputTokens ?? 0))} sub={`输入 ${fmtNum(skill.inputTokens)} / 输出 ${fmtNum(skill.outputTokens)}`} color="blue" />
              </div>
              {skillPieData.length > 0 && (
                <div className="bg-[#0d1117] border border-white/8 rounded-xl p-4">
                  <div className="text-xs text-slate-500 mb-3">运行结果分布</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={skillPieData} cx="50%" cy="50%" outerRadius={60} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {skillPieData.map((_, i) => <Cell key={i} fill={["#059669", "#dc2626", "#6b7280"][i] ?? COLORS[i]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* ── Agent 统计 ── */}
            <div>
              <SectionHeader icon={Bot} title="Agent 运行统计" color="blue" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={Bot} label="总 Agent 运行" value={fmtNum(agent.totalRuns)} color="blue" />
                <StatCard icon={CheckCircle2} label="完成率" value={pct(agent.completedRuns ?? 0, agent.totalRuns ?? 0)} color="green" />
                <StatCard icon={Clock} label="平均耗时" value={fmtMs(agent.avgDurationMs)} color="cyan" />
                <StatCard icon={AlertTriangle} label="人工审核节点" value={fmtNum(node.waitingHumanNodes)} sub={`人工编辑 ${fmtNum(node.humanEditedNodes)} 次`} color="amber" />
              </div>
            </div>

            {/* ── Job 统计 ── */}
            <div>
              <SectionHeader icon={Briefcase} title="AI Job 队列统计" color="cyan" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={Briefcase} label="总 Job 数" value={fmtNum(job.totalJobs)} color="cyan" />
                <StatCard icon={CheckCircle2} label="成功率" value={pct(job.succeededJobs ?? 0, job.totalJobs ?? 0)} color="green" />
                <StatCard icon={AlertTriangle} label="失败数" value={fmtNum(job.failedJobs)} color="red" />
                <StatCard icon={Clock} label="平均耗时" value={fmtMs(job.avgDurationMs)} color="cyan" />
              </div>
            </div>

            {/* ── 质量评分 ── */}
            <div>
              <SectionHeader icon={Star} title="AI 质量评分" color="amber" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Eval bar chart */}
                {evalBarData.length > 0 ? (
                  <div className="bg-[#0d1117] border border-white/8 rounded-xl p-4">
                    <div className="text-xs text-slate-500 mb-3">各类型平均质量分（满分 100）</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={evalBarData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }} />
                        <Bar dataKey="avgScore" fill="#7c3aed" radius={[4, 4, 0, 0]} name="平均分" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-[#0d1117] border border-white/8 rounded-xl p-4 flex items-center justify-center h-48">
                    <div className="text-center text-slate-600">
                      <Star size={24} className="mx-auto mb-2" />
                      <div className="text-xs">暂无评测数据</div>
                    </div>
                  </div>
                )}

                {/* Quality summary */}
                <div className="bg-[#0d1117] border border-white/8 rounded-xl p-4">
                  <div className="text-xs text-slate-500 mb-3">质量综合指标</div>
                  <div className="space-y-3">
                    {[
                      { label: "加权质量评分", value: quality.weightedQualityScore != null ? `${Number(quality.weightedQualityScore).toFixed(1)}` : "—", color: "text-violet-400" },
                      { label: "低分评测占比", value: quality.lowScoreRate != null ? `${(Number(quality.lowScoreRate) * 100).toFixed(1)}%` : "—", color: "text-red-400" },
                      { label: "人工编辑率", value: node.humanEditedNodes && node.totalNodes ? pct(node.humanEditedNodes, node.totalNodes) : "—", color: "text-amber-400" },
                      { label: "节点重试率", value: node.retryCount && node.totalNodes ? pct(node.retryCount, node.totalNodes) : "—", color: "text-blue-400" },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{item.label}</span>
                        <span className={`text-sm font-semibold ${item.color}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── 最近评测记录 ── */}
            {evals.length > 0 && (
              <div>
                <div
                  className="flex items-center justify-between cursor-pointer mb-3"
                  onClick={() => setExpanded(e => ({ ...e, evals: !e.evals }))}
                >
                  <SectionHeader icon={Star} title={`最近评测记录（${evals.length}）`} color="amber" />
                  {expanded.evals ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                </div>
                {expanded.evals && (
                  <div className="bg-[#0d1117] border border-white/8 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/8">
                          {["类型", "实体", "评分", "评测者", "时间"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {evals.slice(0, 20).map((e: any, i: number) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                            <td className="px-3 py-2">
                              <Badge className="text-[9px] bg-violet-500/20 text-violet-400 border-violet-500/30">{e.entityType}</Badge>
                            </td>
                            <td className="px-3 py-2 text-slate-400 font-mono truncate max-w-[120px]">{e.entityId}</td>
                            <td className="px-3 py-2">
                              <span className={`font-semibold ${Number(e.score) >= 80 ? "text-green-400" : Number(e.score) >= 60 ? "text-amber-400" : "text-red-400"}`}>
                                {e.score ?? "—"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-500">{e.evaluatorType ?? "—"}</td>
                            <td className="px-3 py-2 text-slate-600">
                              {e.createdAt ? new Date(e.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── 指标趋势 ── */}
            {metrics.length > 0 && (
              <div>
                <div
                  className="flex items-center justify-between cursor-pointer mb-3"
                  onClick={() => setExpanded(e => ({ ...e, metrics: !e.metrics }))}
                >
                  <SectionHeader icon={Activity} title={`运行指标明细（${metrics.length}）`} color="cyan" />
                  {expanded.metrics ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                </div>
                {expanded.metrics && (
                  <div className="bg-[#0d1117] border border-white/8 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/8">
                          {["指标名", "类型", "实体", "数值", "时间"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.slice(0, 30).map((m: any, i: number) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                            <td className="px-3 py-2 text-slate-300 font-mono">{m.metricName}</td>
                            <td className="px-3 py-2">
                              <Badge className="text-[9px] bg-blue-500/20 text-blue-400 border-blue-500/30">{m.entityType}</Badge>
                            </td>
                            <td className="px-3 py-2 text-slate-500 truncate max-w-[100px]">{m.entityId}</td>
                            <td className="px-3 py-2 text-cyan-400 font-semibold">{m.value ?? "—"}</td>
                            <td className="px-3 py-2 text-slate-600">
                              {m.createdAt ? new Date(m.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {!skill.totalRuns && !agent.totalRuns && !job.totalJobs && (
              <div className="flex flex-col items-center justify-center h-48 text-slate-600">
                <Activity size={32} className="mb-3" />
                <div className="text-sm">近 {days} 天内暂无运行数据</div>
                <div className="text-xs mt-1">运行 Skill 或 Agent 后数据将自动出现</div>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
