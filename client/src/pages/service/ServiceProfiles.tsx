import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Users, UserCheck, UserX, DollarSign, Loader2, Sparkles,
  Search, RefreshCw, Plus, Star, ShoppingCart, TrendingUp,
  AlertTriangle, Heart, ArrowUpRight
} from "lucide-react";
import { toast } from "sonner";

function ValueBadge({ tag }: { tag: string | null }) {
  if (!tag) return <Badge variant="outline" className="text-xs">未评估</Badge>;
  const map: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    high_value: { label: "高价值", variant: "default" },
    normal: { label: "普通", variant: "secondary" },
    risk: { label: "流失风险", variant: "destructive" },
    new: { label: "新客户", variant: "outline" },
  };
  const info = map[tag] || { label: tag, variant: "outline" as const };
  return <Badge variant={info.variant} className="text-xs">{info.label}</Badge>;
}

export default function ServiceProfiles() {
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

  const statsQuery = trpc.customerProfile.getStats.useQuery();
  const listQuery = trpc.customerProfile.listCustomers.useQuery({
    search: search || undefined,
    tag: tagFilter || undefined,
    offset: 0, limit: 100,
  });
  const syncMutation = trpc.customerProfile.syncFromLingxing.useMutation({
    onSuccess: (data) => {
      toast.success(`同步完成：${data.synced}个客户`);
      listQuery.refetch();
      statsQuery.refetch();
    },
  });
  const aiValueMutation = trpc.customerProfile.aiCustomerValue.useMutation({
    onSuccess: () => {
      toast.success('AI评估完成');
      listQuery.refetch();
      statsQuery.refetch();
    },
  });

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            客户画像
          </h2>
          <p className="text-muted-foreground mt-1">客户价值分析 · 复购预测 · 风险识别</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => syncMutation.mutate({})} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            从领星同步
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Users className="h-4 w-4" />总客户</div>
            <div className="text-2xl font-bold mt-1">{stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><UserCheck className="h-4 w-4 text-green-500" />高价值</div>
            <div className="text-2xl font-bold mt-1 text-green-600">{stats?.highValue || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><UserX className="h-4 w-4 text-red-500" />流失风险</div>
            <div className="text-2xl font-bold mt-1 text-red-600">{stats?.atRisk || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><DollarSign className="h-4 w-4" />总收入</div>
            <div className="text-2xl font-bold mt-1">${(stats?.totalRevenue || 0).toFixed(0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><ShoppingCart className="h-4 w-4" />复购率</div>
            <div className="text-2xl font-bold mt-1">{(stats?.repeatRate || 0).toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><TrendingUp className="h-4 w-4" />客均消费</div>
            <div className="text-2xl font-bold mt-1">${(stats?.avgOrderValue || 0).toFixed(0)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索客户名称..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex items-center gap-1">
          {['', 'high_value', 'normal', 'risk', 'new'].map(tag => (
            <Button key={tag} variant={tagFilter === tag ? 'default' : 'outline'} size="sm"
              onClick={() => setTagFilter(tag)}>
              {tag === '' ? '全部' : tag === 'high_value' ? '高价值' : tag === 'normal' ? '普通' : tag === 'risk' ? '风险' : '新客户'}
            </Button>
          ))}
        </div>
      </div>

      {/* Customer List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              客户列表
              {listQuery.data && <Badge variant="outline">{listQuery.data.total}个客户</Badge>}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !listQuery.data?.list.length ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">暂无客户数据</p>
              <p className="text-sm text-muted-foreground mt-1">点击"从领星同步"导入客户数据</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">客户</th>
                    <th className="text-left py-2 px-3 font-medium">标签</th>
                    <th className="text-right py-2 px-3 font-medium">订单数</th>
                    <th className="text-right py-2 px-3 font-medium">总消费</th>
                    <th className="text-right py-2 px-3 font-medium">客均价</th>
                    <th className="text-right py-2 px-3 font-medium">评分</th>
                    <th className="text-right py-2 px-3 font-medium">退货</th>
                    <th className="text-center py-2 px-3 font-medium">AI评分</th>
                    <th className="text-center py-2 px-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {listQuery.data.list.map((c: any) => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelectedCustomer(c)}>
                      <td className="py-2 px-3">
                        <div className="font-medium">{c.buyerName || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{c.customerId}</div>
                      </td>
                      <td className="py-2 px-3"><ValueBadge tag={c.aiValueTag} /></td>
                      <td className="py-2 px-3 text-right">{c.totalOrders || 0}</td>
                      <td className="py-2 px-3 text-right font-medium">${Number(c.totalSpent || 0).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right">${Number(c.avgOrderValue || 0).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right">
                        {c.avgRating ? (
                          <span className="flex items-center justify-end gap-1">
                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                            {Number(c.avgRating).toFixed(1)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2 px-3 text-right">{c.returnCount || 0}</td>
                      <td className="py-2 px-3 text-center">
                        {c.aiValueScore ? (
                          <span className={`font-bold ${Number(c.aiValueScore) >= 80 ? 'text-green-600' : Number(c.aiValueScore) >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {Number(c.aiValueScore).toFixed(0)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Button variant="ghost" size="sm"
                          onClick={(e) => { e.stopPropagation(); aiValueMutation.mutate({ customerId: c.id }); }}
                          disabled={aiValueMutation.isPending}>
                          <Sparkles className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Detail Dialog */}
      <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              客户详情
            </DialogTitle>
          </DialogHeader>
          {selectedCustomer && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{selectedCustomer.buyerName || 'Unknown'}</h3>
                  <p className="text-sm text-muted-foreground">{selectedCustomer.customerId}</p>
                </div>
                <ValueBadge tag={selectedCustomer.aiValueTag} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-xs text-muted-foreground">订单数</div>
                  <div className="text-lg font-bold">{selectedCustomer.totalOrders || 0}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-xs text-muted-foreground">总消费</div>
                  <div className="text-lg font-bold">${Number(selectedCustomer.totalSpent || 0).toFixed(2)}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-xs text-muted-foreground">首次下单</div>
                  <div className="text-sm font-medium">{selectedCustomer.firstOrderDate || '-'}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-xs text-muted-foreground">最近下单</div>
                  <div className="text-sm font-medium">{selectedCustomer.lastOrderDate || '-'}</div>
                </div>
              </div>

              {/* AI Analysis */}
              {selectedCustomer.aiAnalysis && (
                <Card className="border-primary/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />AI价值评估
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(() => {
                      const ai = typeof selectedCustomer.aiAnalysis === 'string' ? JSON.parse(selectedCustomer.aiAnalysis) : selectedCustomer.aiAnalysis;
                      return (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="text-3xl font-bold text-primary">{ai.valueScore}</div>
                            <div>
                              <div className="font-medium">{ai.valueLabel}</div>
                              <div className="text-xs text-muted-foreground">{ai.customerType}</div>
                            </div>
                          </div>
                          {ai.insights?.map((ins: string, i: number) => (
                            <div key={i} className="text-sm p-2 rounded bg-muted/50 flex items-start gap-2">
                              <ArrowUpRight className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                              {ins}
                            </div>
                          ))}
                          {ai.recommendations?.map((rec: string, i: number) => (
                            <div key={i} className="text-sm p-2 rounded bg-green-50 dark:bg-green-900/10 flex items-start gap-2">
                              <Heart className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                              {rec}
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => {
                  aiValueMutation.mutate({ customerId: selectedCustomer.id });
                }} disabled={aiValueMutation.isPending}>
                  {aiValueMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  AI评估
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
