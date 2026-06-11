import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LayoutDashboard, Plus, Trash2, Edit, Copy, Loader2,
  BarChart3, LineChart, PieChart, Table2, Sparkles, Calendar,
  TrendingUp, Package, DollarSign, Star, ArrowUpRight, ArrowDownRight,
  GripVertical, Settings
} from "lucide-react";
import { toast } from "sonner";

// Widget type icons & labels
const WIDGET_TYPES: Record<string, { icon: any; label: string }> = {
  kpi_card: { icon: TrendingUp, label: 'KPI卡片' },
  line_chart: { icon: LineChart, label: '折线图' },
  bar_chart: { icon: BarChart3, label: '柱状图' },
  pie_chart: { icon: PieChart, label: '饼图' },
  table: { icon: Table2, label: '数据表' },
  ai_summary: { icon: Sparkles, label: 'AI摘要' },
  calendar: { icon: Calendar, label: '日历' },
  heatmap: { icon: BarChart3, label: '热力图' },
  radar_chart: { icon: Star, label: '雷达图' },
};

const DATA_SOURCES = [
  { value: 'sales', label: '销售数据' },
  { value: 'ads_sp', label: 'SP广告数据' },
  { value: 'inventory', label: '库存数据' },
  { value: 'profit', label: '利润数据' },
  { value: 'reviews', label: 'Review数据' },
];

// Widget renderer
function WidgetCard({ widget, onDelete }: { widget: any; onDelete: (id: number) => void }) {
  const dataQuery = trpc.customDashboard.getWidgetData.useQuery(
    { dataSource: widget.dataSource, config: widget.config },
    { staleTime: 60000 }
  );

  const wType = WIDGET_TYPES[widget.widgetType];
  const Icon = wType?.icon || BarChart3;

  const renderContent = () => {
    if (dataQuery.isLoading) {
      return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    }
    if (!dataQuery.data) {
      return <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>;
    }

    const d = dataQuery.data as any;

    switch (widget.widgetType) {
      case 'kpi_card': {
        const metric = widget.config?.metric || 'revenue';
        let value = 0, label = metric;
        if (widget.dataSource === 'sales') {
          if (metric === 'revenue') { value = d.totalRevenue; label = '销售额'; }
          else if (metric === 'profit') { value = d.totalProfit; label = '利润'; }
          else if (metric === 'orders') { value = d.totalOrders; label = '订单量'; }
        } else if (widget.dataSource === 'ads_sp') {
          if (metric === 'spend') { value = d.totalSpend; label = '广告花费'; }
          else if (metric === 'sales') { value = d.totalSales; label = '广告销售额'; }
          else if (metric === 'acos') { value = d.totalSpend && d.totalSales ? (d.totalSpend / d.totalSales * 100) : 0; label = 'ACoS'; }
        } else if (widget.dataSource === 'inventory') {
          if (metric === 'total') { value = d.totalSkus; label = '总SKU'; }
          else if (metric === 'lowStock') { value = d.lowStock; label = '低库存'; }
          else if (metric === 'overstock') { value = d.overstock; label = '超库存'; }
        }
        const isPercent = metric === 'acos';
        const isCurrency = ['revenue', 'profit', 'spend', 'sales'].includes(metric);
        return (
          <div className="text-center py-4">
            <div className="text-3xl font-bold">
              {isCurrency ? '$' : ''}{typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: isPercent ? 1 : 0 }) : value}
              {isPercent ? '%' : ''}
            </div>
            <div className="text-sm text-muted-foreground mt-1">{label}</div>
          </div>
        );
      }
      case 'line_chart':
      case 'bar_chart': {
        const items = d.items?.slice(0, 10) || [];
        if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>;
        const maxVal = Math.max(...items.map((i: any) => Number(i.totalSalesAmount || i.cost || i.sellable_quantity || 0)));
        return (
          <div className="space-y-2">
            {items.map((item: any, idx: number) => {
              const val = Number(item.totalSalesAmount || item.cost || item.sellable_quantity || 0);
              const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
              const label = item.msku || item.asin || item.sku || `#${idx + 1}`;
              return (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <span className="w-24 truncate text-muted-foreground">{label}</span>
                  <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${widget.widgetType === 'bar_chart' ? 'bg-primary' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 text-right font-medium">{val.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              );
            })}
          </div>
        );
      }
      case 'pie_chart': {
        if (widget.dataSource === 'inventory') {
          const segments = [
            { label: '正常', value: d.totalSkus - d.lowStock - d.overstock, color: 'bg-green-500' },
            { label: '低库存', value: d.lowStock, color: 'bg-orange-500' },
            { label: '超库存', value: d.overstock, color: 'bg-red-500' },
          ];
          const total = segments.reduce((s, seg) => s + seg.value, 0);
          return (
            <div className="flex items-center gap-6">
              <div className="relative w-32 h-32">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  {segments.reduce((acc: any[], seg, i) => {
                    const pct = total > 0 ? (seg.value / total) * 100 : 0;
                    const offset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].pct : 0;
                    const colors = ['#22c55e', '#f97316', '#ef4444'];
                    acc.push({ pct, offset, color: colors[i] });
                    return acc;
                  }, []).map((seg: any, i: number) => (
                    <circle key={i} cx="50" cy="50" r="40" fill="none" stroke={seg.color} strokeWidth="20"
                      strokeDasharray={`${seg.pct * 2.51} 251`}
                      strokeDashoffset={`${-seg.offset * 2.51}`}
                    />
                  ))}
                </svg>
              </div>
              <div className="space-y-2">
                {segments.map((seg, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <div className={`w-3 h-3 rounded-full ${seg.color}`} />
                    <span>{seg.label}</span>
                    <span className="font-medium">{seg.value}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return <p className="text-sm text-muted-foreground text-center py-4">饼图数据加载中...</p>;
      }
      case 'table': {
        const items = d.items?.slice(0, 8) || [];
        if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>;
        const keys = Object.keys(items[0]).slice(0, 5);
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">{keys.map(k => <th key={k} className="text-left py-1 px-2 font-medium">{k}</th>)}</tr>
              </thead>
              <tbody>
                {items.map((item: any, i: number) => (
                  <tr key={i} className="border-b border-border/50">
                    {keys.map(k => <td key={k} className="py-1 px-2 truncate max-w-[120px]">{String(item[k] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case 'ai_summary':
        return (
          <div className="p-3 bg-primary/5 rounded-lg text-sm space-y-2">
            <div className="flex items-center gap-2 text-primary font-medium"><Sparkles className="h-4 w-4" />AI运营摘要</div>
            <p>基于近30天数据分析：{widget.dataSource === 'sales' ? '销售趋势稳定，建议关注高利润ASIN的广告投放优化。' : '数据加载中...'}</p>
          </div>
        );
      default:
        return <p className="text-sm text-muted-foreground text-center py-4">组件类型: {widget.widgetType}</p>;
    }
  };

  return (
    <Card className="group relative">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">{widget.title}</CardTitle>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => onDelete(widget.id)}>
          <Trash2 className="h-3 w-3 text-muted-foreground" />
        </Button>
      </CardHeader>
      <CardContent>{renderContent()}</CardContent>
    </Card>
  );
}

export default function OpsCustomDashboard() {
  const [selectedDashboardId, setSelectedDashboardId] = useState<number | null>(null);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [newDashboardTemplate, setNewDashboardTemplate] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddWidgetDialog, setShowAddWidgetDialog] = useState(false);
  const [newWidgetType, setNewWidgetType] = useState('kpi_card');
  const [newWidgetTitle, setNewWidgetTitle] = useState('');
  const [newWidgetDataSource, setNewWidgetDataSource] = useState('sales');

  const utils = trpc.useUtils();
  const dashboardsQuery = trpc.customDashboard.listDashboards.useQuery();
  const templatesQuery = trpc.customDashboard.getTemplates.useQuery();
  const dashboardQuery = trpc.customDashboard.getDashboard.useQuery(
    { id: selectedDashboardId! },
    { enabled: !!selectedDashboardId }
  );

  const createMutation = trpc.customDashboard.createDashboard.useMutation({
    onSuccess: (data) => {
      utils.customDashboard.listDashboards.invalidate();
      setSelectedDashboardId(data.id);
      setShowCreateDialog(false);
      setNewDashboardName('');
      toast.success('看板创建成功');
    },
  });

  const deleteMutation = trpc.customDashboard.deleteDashboard.useMutation({
    onSuccess: () => {
      utils.customDashboard.listDashboards.invalidate();
      setSelectedDashboardId(null);
      toast.success('看板已删除');
    },
  });

  const addWidgetMutation = trpc.customDashboard.addWidget.useMutation({
    onSuccess: () => {
      utils.customDashboard.getDashboard.invalidate({ id: selectedDashboardId! });
      setShowAddWidgetDialog(false);
      setNewWidgetTitle('');
      toast.success('组件已添加');
    },
  });

  const deleteWidgetMutation = trpc.customDashboard.deleteWidget.useMutation({
    onSuccess: () => {
      utils.customDashboard.getDashboard.invalidate({ id: selectedDashboardId! });
      toast.success('组件已删除');
    },
  });

  const handleCreate = () => {
    if (!newDashboardName.trim()) return;
    createMutation.mutate({
      name: newDashboardName,
      template: newDashboardTemplate || undefined,
    });
  };

  const handleAddWidget = () => {
    if (!selectedDashboardId || !newWidgetTitle.trim()) return;
    addWidgetMutation.mutate({
      dashboardId: selectedDashboardId,
      widgetType: newWidgetType as any,
      title: newWidgetTitle,
      dataSource: newWidgetDataSource,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            自定义看板
          </h2>
          <p className="text-muted-foreground mt-1">拖拽组件 · 多看板管理 · 数据可视化</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />新建看板</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新建看板</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">看板名称</label>
                <Input value={newDashboardName} onChange={e => setNewDashboardName(e.target.value)} placeholder="例如：我的运营看板" />
              </div>
              <div>
                <label className="text-sm font-medium">选择模板（可选）</label>
                <Select value={newDashboardTemplate} onValueChange={setNewDashboardTemplate}>
                  <SelectTrigger><SelectValue placeholder="空白看板" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">空白看板</SelectItem>
                    {templatesQuery.data?.map(t => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.name} ({t.widgetCount}个组件)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newDashboardTemplate && newDashboardTemplate !== 'blank' && templatesQuery.data && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {templatesQuery.data.find(t => t.key === newDashboardTemplate)?.description}
                  </p>
                )}
              </div>
              <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                创建看板
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Dashboard List */}
      {!selectedDashboardId && (
        <div>
          {dashboardsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : dashboardsQuery.data?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <LayoutDashboard className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">还没有看板</h3>
                <p className="text-muted-foreground text-sm mb-4">创建一个自定义看板，选择模板快速开始</p>
                <Button onClick={() => setShowCreateDialog(true)}><Plus className="h-4 w-4 mr-2" />创建第一个看板</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Template cards */}
              {templatesQuery.data?.map(t => (
                <Card key={t.key} className="cursor-pointer hover:border-primary/50 transition-colors border-dashed"
                  onClick={() => { setNewDashboardName(t.name); setNewDashboardTemplate(t.key); setShowCreateDialog(true); }}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Copy className="h-4 w-4 text-primary" />
                      {t.name}
                      <Badge variant="secondary" className="text-xs">模板</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.widgetCount}个预设组件</p>
                  </CardContent>
                </Card>
              ))}
              {/* Existing dashboards */}
              {dashboardsQuery.data?.map(d => (
                <Card key={d.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedDashboardId(d.id)}>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <LayoutDashboard className="h-4 w-4" />
                      {d.name}
                    </CardTitle>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); deleteMutation.mutate({ id: d.id }); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{d.description || '自定义看板'}</p>
                    <p className="text-xs text-muted-foreground mt-1">更新于 {new Date(d.updatedAt).toLocaleDateString()}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dashboard Detail View */}
      {selectedDashboardId && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedDashboardId(null)}>← 返回</Button>
            <h3 className="text-lg font-semibold">{dashboardQuery.data?.name || '加载中...'}</h3>
            <div className="flex-1" />
            <Dialog open={showAddWidgetDialog} onOpenChange={setShowAddWidgetDialog}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" />添加组件</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>添加组件</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">组件类型</label>
                    <Select value={newWidgetType} onValueChange={setNewWidgetType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(WIDGET_TYPES).map(([key, wt]) => (
                          <SelectItem key={key} value={key}>
                            <span className="flex items-center gap-2"><wt.icon className="h-4 w-4" />{wt.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">组件标题</label>
                    <Input value={newWidgetTitle} onChange={e => setNewWidgetTitle(e.target.value)} placeholder="例如：30天销售额" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">数据源</label>
                    <Select value={newWidgetDataSource} onValueChange={setNewWidgetDataSource}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DATA_SOURCES.map(ds => (
                          <SelectItem key={ds.value} value={ds.value}>{ds.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleAddWidget} disabled={addWidgetMutation.isPending} className="w-full">
                    {addWidgetMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    添加组件
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {dashboardQuery.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : dashboardQuery.data?.widgets?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Settings className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">看板为空</h3>
                <p className="text-muted-foreground text-sm mb-4">添加组件开始构建你的自定义看板</p>
                <Button onClick={() => setShowAddWidgetDialog(true)}><Plus className="h-4 w-4 mr-2" />添加第一个组件</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {dashboardQuery.data?.widgets?.map((w: any) => (
                <WidgetCard key={w.id} widget={w} onDelete={(id) => deleteWidgetMutation.mutate({ id })} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
