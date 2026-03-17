import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import {
  FolderOpen,
  PlusCircle,
  Package,
  TrendingUp,
  Clock,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Star,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

const statusLabel: Record<string, { text: string; color: string }> = {
  research: { text: "调研中", color: "bg-blue-500/10 text-blue-600" },
  analysis: { text: "分析中", color: "bg-amber-500/10 text-amber-600" },
  scoring: { text: "评分中", color: "bg-purple-500/10 text-purple-600" },
  development: { text: "开发中", color: "bg-cyan-500/10 text-cyan-600" },
  completed: { text: "已完成", color: "bg-emerald-500/10 text-emerald-600" },
  archived: { text: "已归档", color: "bg-gray-500/10 text-gray-600" },
};

export default function DevDashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading: statsLoading } = trpc.devProject.stats.useQuery();
  const { data: projects, isLoading: projectsLoading } = trpc.devProject.list.useQuery();

  const recentProjects = projects?.slice(0, 5) ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">智能产品开发</h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI驱动的产品开发全流程管理：市场调研 → 竞品分析 → 立项评分 → 产品画像 → BOM管理
          </p>
        </div>
        <Button onClick={() => setLocation("/dev/new-project")} className="gap-2">
          <PlusCircle className="h-4 w-4" />
          新建项目
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">总项目数</p>
                {statsLoading ? (
                  <Skeleton className="h-8 w-12 mt-1" />
                ) : (
                  <p className="text-2xl font-bold mt-1">{stats?.total ?? 0}</p>
                )}
              </div>
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <FolderOpen className="h-5 w-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">分析中</p>
                {statsLoading ? (
                  <Skeleton className="h-8 w-12 mt-1" />
                ) : (
                  <p className="text-2xl font-bold mt-1">{stats?.analyzing ?? 0}</p>
                )}
              </div>
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">已完成</p>
                {statsLoading ? (
                  <Skeleton className="h-8 w-12 mt-1" />
                ) : (
                  <p className="text-2xl font-bold mt-1">{stats?.completed ?? 0}</p>
                )}
              </div>
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">平均评分</p>
                {statsLoading ? (
                  <Skeleton className="h-8 w-12 mt-1" />
                ) : (
                  <p className="text-2xl font-bold mt-1">{(stats as any)?.scoring ?? 0}</p>
                )}
              </div>
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Star className="h-5 w-5 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => setLocation("/dev/projects")}>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">项目列表</h3>
                <p className="text-sm text-muted-foreground">查看和管理所有产品开发项目</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => setLocation("/dev/supplier-library")}>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Package className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <h3 className="font-semibold">供应商库</h3>
                <p className="text-sm text-muted-foreground">管理全局供应商资源</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => setLocation("/dev/compare")}>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-rose-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-rose-500" />
              </div>
              <div>
                <h3 className="font-semibold">产品对比</h3>
                <p className="text-sm text-muted-foreground">跨项目产品数据对比分析</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>

      {/* Recent projects */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            最近项目
          </CardTitle>
        </CardHeader>
        <CardContent>
          {projectsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : recentProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <FolderOpen className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">暂无项目，点击"新建项目"开始</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentProjects.map(p => {
                const st = statusLabel[p.status] ?? { text: p.status, color: "bg-gray-500/10 text-gray-600" };
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setLocation(`/dev/project/${p.id}`)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <FolderOpen className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.targetMarket || "全球"} · {p.keywords || "未分类"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant="secondary" className={`text-xs ${st.color}`}>
                        {st.text}
                      </Badge>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
