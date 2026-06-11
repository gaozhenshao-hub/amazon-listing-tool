import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserCheck, Target, Send, CheckCircle, Globe, CalendarDays, Link2, Activity, Video, Users, TrendingUp, BarChart3 } from "lucide-react";
import { useLocation } from "wouter";

const statCards = [
  { key: "influencers", label: "达人库", icon: UserCheck, color: "text-purple-500", bgColor: "bg-purple-500/10", path: "/offsite/influencers", field: "total" },
  { key: "campaigns", label: "营销活动", icon: Target, color: "text-blue-500", bgColor: "bg-blue-500/10", path: "/offsite/campaigns", field: "total" },
  { key: "campaigns_active", label: "进行中活动", icon: TrendingUp, color: "text-green-500", bgColor: "bg-green-500/10", path: "/offsite/campaigns", field: "active" },
  { key: "outreach", label: "外联消息", icon: Send, color: "text-orange-500", bgColor: "bg-orange-500/10", path: "/offsite/outreach", field: "total" },
  { key: "contentReview", label: "待审核内容", icon: CheckCircle, color: "text-red-500", bgColor: "bg-red-500/10", path: "/offsite/content-review", field: "pending" },
  { key: "social", label: "社媒账号", icon: Globe, color: "text-cyan-500", bgColor: "bg-cyan-500/10", path: "/offsite/social-accounts", field: "accounts" },
  { key: "calendar", label: "内容排期", icon: CalendarDays, color: "text-indigo-500", bgColor: "bg-indigo-500/10", path: "/offsite/content-calendar", field: "total" },
  { key: "attribution", label: "追踪链接", icon: Link2, color: "text-amber-500", bgColor: "bg-amber-500/10", path: "/offsite/attribution", field: "links" },
  { key: "matrix", label: "矩阵分组", icon: Video, color: "text-pink-500", bgColor: "bg-pink-500/10", path: "/offsite/tiktok-matrix", field: "groups" },
];

export default function OffsiteOverview() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = trpc.offAnalytics.getDashboardStats.useQuery();

  const getStatValue = (key: string, field: string) => {
    if (!stats) return 0;
    const section = (stats as any)[key];
    if (!section) return 0;
    return section[field] || 0;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">站外营销</h1>
        <p className="text-muted-foreground mt-1">管理达人合作、社交媒体运营和归因分析</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          const value = getStatValue(card.key === "campaigns_active" ? "campaigns" : card.key, card.field);
          return (
            <Card key={card.key} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setLocation(card.path)}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                    <p className="text-2xl font-bold mt-1">{isLoading ? "..." : value}</p>
                  </div>
                  <div className={`h-12 w-12 rounded-xl ${card.bgColor} flex items-center justify-center`}>
                    <Icon className={`h-6 w-6 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> 达人合作管理</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">管理达人资源库、AI智能匹配、合作跟进和内容审核全流程</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setLocation("/offsite/influencers")}>达人发现</Button>
              <Button size="sm" variant="outline" onClick={() => setLocation("/offsite/campaigns")}>活动管理</Button>
              <Button size="sm" variant="outline" onClick={() => setLocation("/offsite/outreach")}>外联管理</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" /> 社交媒体运营</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">管理社媒账号矩阵、AI内容生成、排期发布和TikTok矩阵引流</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setLocation("/offsite/social-accounts")}>社媒账号</Button>
              <Button size="sm" variant="outline" onClick={() => setLocation("/offsite/content-calendar")}>内容日历</Button>
              <Button size="sm" variant="outline" onClick={() => setLocation("/offsite/tiktok-matrix")}>TikTok矩阵</Button>
            </div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> 归因分析与数据洞察</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">UTM追踪链接管理、多渠道归因分析、ROI计算和AI智能洞察</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setLocation("/offsite/attribution")}>归因追踪</Button>
              <Button size="sm" variant="outline" onClick={() => setLocation("/offsite/analytics")}>全渠道分析</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
