import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Eye, Plus, Trash2, RefreshCw, ExternalLink, Sparkles, Loader2,
  TrendingUp, TrendingDown, Minus, Star, DollarSign, BarChart3,
} from "lucide-react";

export default function OpsCompetitor() {
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(null);
  const [newMonitor, setNewMonitor] = useState({ competitorAsin: "", competitorTitle: "", notes: "" });

  const { data, isLoading, refetch } = trpc.operations.getCompetitorMonitors.useQuery();
  const utils = trpc.useUtils();

  const addMonitor = trpc.operations.saveCompetitorMonitor.useMutation({
    onSuccess: () => {
      toast.success("已添加竞品监控");
      setShowAddDialog(false);
      setNewMonitor({ competitorAsin: "", competitorTitle: "", notes: "" });
      utils.operations.getCompetitorMonitors.invalidate();
    },
    onError: (err) => toast.error("添加失败", { description: err.message }),
  });

  const removeMonitor = trpc.operations.deleteCompetitorMonitor.useMutation({
    onSuccess: () => {
      toast.success("已移除竞品监控");
      utils.operations.getCompetitorMonitors.invalidate();
    },
    onError: (err) => toast.error("移除失败", { description: err.message }),
  });

  const aiAnalysis = trpc.operations.aiCompetitorReport.useMutation({
    onSuccess: () => toast.success("竞品分析完成"),
    onError: (err) => toast.error("分析失败", { description: err.message }),
  });

  const monitors = data || [];

  const handleAdd = () => {
    if (!newMonitor.competitorAsin.trim()) {
      toast.error("请输入ASIN");
      return;
    }
    addMonitor.mutate(newMonitor);
  };

  const handleAiAnalysis = () => {
    if (monitors.length === 0) {
      toast.success("请先添加竞品", { description: "需要至少一个竞品才能进行分析" });
      return;
    }
    setShowAiDialog(true);
    aiAnalysis.mutate({
      monitorIds: monitors.map((m: any) => m.id),
      reportType: "comparison" as const,
    });
  };

  // Mock price trend data for selected monitor
  const selectedMonitor = monitors.find((m: any) => m.id === selectedMonitorId);
  const trendData = useMemo(() => {
    if (!selectedMonitor) return [];
    // Generate mock trend data
    const days = 14;
    const basePrice = 29.99;
    const baseRank = 5000;
    return Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      return {
        date: date.toISOString().split("T")[0],
        price: +(basePrice + (Math.random() - 0.5) * 5).toFixed(2),
        rank: Math.round(baseRank + (Math.random() - 0.5) * 2000),
      };
    });
  }, [selectedMonitor]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">竞品监控</h1>
          <p className="text-sm text-gray-500 mt-1">追踪竞品价格、排名、评论变化</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handleAiAnalysis} disabled={aiAnalysis.isPending}>
            {aiAnalysis.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
            AI竞品分析
          </Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="w-4 h-4 mr-1" />
            添加竞品
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-blue-50 border-transparent">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-gray-500">监控数量</p>
            <p className="text-2xl font-bold">{monitors.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-transparent">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-gray-500">平均价格</p>
            <p className="text-2xl font-bold">
              ${monitors.length > 0
                ? (monitors.reduce((s: number, m: any) => s + (m.latestSnapshot?.price || 0), 0) / monitors.length).toFixed(2)
                : "0"}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-transparent">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-gray-500">平均评分</p>
            <p className="text-2xl font-bold">
              {monitors.length > 0
                ? (monitors.reduce((s: number, m: any) => s + (m.latestSnapshot?.rating || 0), 0) / monitors.length).toFixed(1)
                : "0"}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 border-transparent">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-gray-500">平均BSR排名</p>
            <p className="text-2xl font-bold">
              #{monitors.length > 0
                ? Math.round(monitors.reduce((s: number, m: any) => s + (m.latestSnapshot?.bsr_rank || 0), 0) / monitors.length).toLocaleString()
                : "0"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Competitor Cards Grid */}
      {monitors.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Eye className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">暂无竞品监控</h3>
            <p className="text-sm text-gray-400 mb-4">添加竞品ASIN开始追踪价格和排名变化</p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="w-4 h-4 mr-1" />
              添加第一个竞品
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {monitors.map((m: any) => {
            const snap: any = null; // snapshots loaded separately
            return (
              <Card key={m.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-gray-400 mb-1">{m.competitorAsin}</p>
                      <h3 className="font-medium text-sm truncate">{m.competitorTitle || "未命名竞品"}</h3>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setSelectedMonitorId(m.id === selectedMonitorId ? null : m.id)}
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                      </Button>
                      <a
                        href={`https://www.amazon.com/dp/${m.competitorAsin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-gray-100"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                      </a>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                        onClick={() => removeMonitor.mutate({ id: m.id })}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {snap ? (
                    <div className="grid grid-cols-2 gap-3">
                      <MetricItem icon={DollarSign} label="价格" value={`$${snap.price || 0}`} color="emerald" />
                      <MetricItem icon={Star} label="评分" value={`${snap.rating || 0}`} color="amber" />
                      <MetricItem icon={TrendingUp} label="BSR排名" value={`#${(snap.bsr_rank || 0).toLocaleString()}`} color="blue" />
                      <MetricItem icon={Eye} label="评论数" value={`${(snap.review_count || 0).toLocaleString()}`} color="purple" />
                    </div>
                  ) : (
                    <div className="text-center py-4 text-gray-400 text-sm">
                      暂无快照数据
                    </div>
                  )}

                  {m.notes && (
                    <p className="text-xs text-gray-400 mt-3 border-t pt-2">{m.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Selected Monitor Trend Chart */}
      {selectedMonitor && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {(selectedMonitor as any).competitorTitle || (selectedMonitor as any).competitorAsin} - 价格与排名趋势
            </CardTitle>
            <CardDescription>近14天变化趋势（Mock数据）</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis yAxisId="price" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <YAxis yAxisId="rank" orientation="right" tick={{ fontSize: 11 }} reversed />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === "price") return [`$${value}`, "价格"];
                      return [`#${value.toLocaleString()}`, "BSR排名"];
                    }}
                  />
                  <Legend formatter={(v) => v === "price" ? "价格" : "BSR排名"} />
                  <Line yAxisId="price" type="monotone" dataKey="price" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line yAxisId="rank" type="monotone" dataKey="rank" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Monitor Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加竞品监控</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>ASIN *</Label>
              <Input
                placeholder="例: B0XXXXXXXXX"
                value={newMonitor.competitorAsin}
                onChange={(e) => setNewMonitor(prev => ({ ...prev, competitorAsin: e.target.value }))}
              />
            </div>
            <div>
              <Label>产品标题</Label>
              <Input
                placeholder="竞品产品名称（可选）"
                value={newMonitor.competitorTitle}
                onChange={(e) => setNewMonitor(prev => ({ ...prev, competitorTitle: e.target.value }))}
              />
            </div>
            <div>
              <Label>备注</Label>
              <Textarea
                placeholder="监控备注（可选）"
                value={newMonitor.notes}
                onChange={(e) => setNewMonitor(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>取消</Button>
            <Button onClick={handleAdd} disabled={addMonitor.isPending}>
              {addMonitor.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Analysis Dialog */}
      <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-500" />
              AI竞品分析报告
            </DialogTitle>
          </DialogHeader>
          {aiAnalysis.isPending ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
              <p className="text-sm text-gray-500">AI正在分析竞品数据...</p>
            </div>
          ) : aiAnalysis.data ? (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">{(aiAnalysis.data as any).overview}</p>
              </div>

              {(aiAnalysis.data as any).competitorInsights?.map((insight: any, i: number) => (
                <Card key={i}>
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-xs text-gray-400">{insight.asin}</span>
                      <Badge variant="outline" className="text-[10px]">{insight.threat_level}</Badge>
                    </div>
                    <h4 className="font-medium text-sm mb-1">{insight.title}</h4>
                    <div className="space-y-1">
                      <p className="text-xs text-gray-600"><span className="font-medium">优势:</span> {insight.strengths}</p>
                      <p className="text-xs text-gray-600"><span className="font-medium">弱点:</span> {insight.weaknesses}</p>
                      <p className="text-xs text-gray-600"><span className="font-medium">建议:</span> {insight.recommendation}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {(aiAnalysis.data as any).strategicRecommendations?.length > 0 && (
                <Card className="bg-emerald-50 border-emerald-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-emerald-800">战略建议</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {(aiAnalysis.data as any).strategicRecommendations.map((rec: string, i: number) => (
                        <li key={i} className="text-sm text-emerald-700 flex items-start gap-2">
                          <span className="font-bold shrink-0">{i + 1}.</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricItem({ icon: Icon, label, value, color }: {
  icon: any; label: string; value: string; color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    blue: "text-blue-600",
    purple: "text-purple-600",
  };

  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 ${colorMap[color] || "text-gray-500"}`} />
      <div>
        <p className="text-[10px] text-gray-400">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
