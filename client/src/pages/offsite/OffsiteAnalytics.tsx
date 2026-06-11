import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Users, Megaphone, TrendingUp, DollarSign, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export default function OffsiteAnalytics() {
  const [showAi, setShowAi] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiInput, setAiInput] = useState("");
  const { data, isLoading } = trpc.offAnalytics.getDashboardStats.useQuery();
  const aiMut = trpc.offAnalytics.aiAttributionAnalysis.useMutation({ onSuccess: (d) => { setAiResult(d.analysis); toast.success("AI分析完成"); } });

  // Match the actual backend shape: influencers, campaigns, collaborations, outreach, contentReview, social, calendar, attribution, matrix
  const s = data as any || {};

  const cards = [
    { title: "达人总数", value: s.influencers?.total || 0, sub: `活跃达人`, icon: Users, color: "text-blue-500" },
    { title: "活动总数", value: s.campaigns?.total || 0, sub: `进行中: ${s.campaigns?.active || 0}`, icon: Megaphone, color: "text-purple-500" },
    { title: "合作数", value: s.collaborations?.total || 0, sub: "所有合作", icon: DollarSign, color: "text-green-500" },
    { title: "外联数", value: s.outreach?.total || 0, sub: "消息总量", icon: BarChart3, color: "text-orange-500" },
    { title: "待审核", value: s.contentReview?.pending || 0, sub: "内容审核", icon: TrendingUp, color: "text-pink-500" },
    { title: "社媒账号", value: s.social?.accounts || 0, sub: `排期: ${(s.calendar?.total || 0)}`, icon: Users, color: "text-cyan-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">全渠道分析</h1><p className="text-muted-foreground mt-1">站外营销全局数据看板，AI智能洞察</p></div>
        <Dialog open={showAi} onOpenChange={setShowAi}>
          <DialogTrigger asChild><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" />AI洞察分析</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>AI全渠道洞察</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Textarea value={aiInput} onChange={e => setAiInput(e.target.value)} rows={3} placeholder="如: 分析各渠道ROI，给出优化建议..." />
              <Button onClick={() => aiMut.mutate({ campaignIds: [], dateRange: "last_30_days" })} disabled={aiMut.isPending}>{aiMut.isPending ? "分析中..." : "开始分析"}</Button>
              {aiResult && <Card><CardContent className="p-4 prose prose-sm max-w-none dark:prose-invert"><Streamdown>{aiResult}</Streamdown></CardContent></Card>}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Card key={i}><CardContent className="p-6"><div className="h-16 bg-muted animate-pulse rounded" /></CardContent></Card>)}</div> : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {cards.map((c, i) => (
            <Card key={i}><CardContent className="p-6"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{c.title}</p><p className="text-2xl font-bold mt-1">{c.value}</p><p className="text-xs text-muted-foreground mt-1">{c.sub}</p></div><c.icon className={`h-8 w-8 ${c.color} opacity-50`} /></div></CardContent></Card>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card><CardHeader><CardTitle className="text-base">归因追踪概览</CardTitle></CardHeader><CardContent><div className="space-y-3">
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">追踪链接</span><span className="font-medium">{s.attribution?.totalLinks || 0}</span></div>
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">总点击</span><span className="font-medium">{s.attribution?.totalClicks || 0}</span></div>
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">总转化</span><span className="font-medium">{s.attribution?.totalConversions || 0}</span></div>
        </div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">矩阵管理</CardTitle></CardHeader><CardContent><div className="space-y-3">
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">矩阵分组</span><span className="font-medium">{s.matrix?.totalGroups || 0}</span></div>
          <div className="flex justify-between"><span className="text-sm text-muted-foreground">总账号</span><span className="font-medium">{s.matrix?.totalAccounts || 0}</span></div>
        </div></CardContent></Card>
      </div>
    </div>
  );
}
