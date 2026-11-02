import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, LayoutGrid, List, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

const STATUS_COLS = [
  { key: "draft", label: "草稿", color: "bg-gray-100 dark:bg-gray-800" },
  { key: "active", label: "进行中", color: "bg-blue-50 dark:bg-blue-900/30" },
  { key: "paused", label: "暂停", color: "bg-yellow-50 dark:bg-yellow-900/30" },
  { key: "completed", label: "已完成", color: "bg-green-50 dark:bg-green-900/30" },
];

export default function OffsiteCampaigns() {
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [showAdd, setShowAdd] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [form, setForm] = useState({ name: "", type: "influencer", budget: "", startDate: "", endDate: "", description: "" });

  const { data, isLoading, refetch } = trpc.offCampaign.list.useQuery();
  const createMut = trpc.offCampaign.create.useMutation({ onSuccess: () => { toast.success("活动已创建"); setShowAdd(false); refetch(); } });
  const updateMut = trpc.offCampaign.update.useMutation({ onSuccess: () => refetch() });
  const aiMut = trpc.offCampaign.aiAnalysis.useMutation({ onSuccess: (d) => setAiResult(d.analysis) });
  const campaigns = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">活动管理</h1><p className="text-muted-foreground mt-1">管理站外营销活动，看板式协作跟进</p></div>
        <div className="flex gap-2">
          <div className="flex border rounded-lg overflow-hidden">
            <Button variant={view === "kanban" ? "default" : "ghost"} size="sm" onClick={() => setView("kanban")}><LayoutGrid className="h-4 w-4" /></Button>
            <Button variant={view === "list" ? "default" : "ghost"} size="sm" onClick={() => setView("list")}><List className="h-4 w-4" /></Button>
          </div>
          <Dialog open={showAi} onOpenChange={setShowAi}>
            <DialogTrigger asChild><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" />AI分析</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle>AI活动分析</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">AI将分析当前所有活动的表现，给出优化建议</p>
                <Button onClick={() => aiMut.mutate({ campaignId: 0 })} disabled={aiMut.isPending}>{aiMut.isPending ? "分析中..." : "开始分析"}</Button>
                {aiResult && <Card><CardContent className="p-4 prose prose-sm max-w-none dark:prose-invert"><Streamdown>{aiResult}</Streamdown></CardContent></Card>}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />新建活动</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新建营销活动</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium">活动名称 *</label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div><label className="text-sm font-medium">类型</label>
                    <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="influencer">达人合作</SelectItem><SelectItem value="social_media">社媒推广</SelectItem><SelectItem value="deal_site">Deal站</SelectItem><SelectItem value="pr">PR推广</SelectItem></SelectContent></Select></div>
                  <div><label className="text-sm font-medium">预算($)</label><Input value={form.budget} onChange={e => setForm(p => ({ ...p, budget: e.target.value }))} placeholder="如: 5000" /></div>
                  <div><label className="text-sm font-medium">开始日期</label><Input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} /></div>
                  <div><label className="text-sm font-medium">结束日期</label><Input type="date" value={form.endDate} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} /></div>
                </div>
                <div><label className="text-sm font-medium">描述</label><Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} /></div>
                <Button onClick={() => createMut.mutate(form)} disabled={createMut.isPending}>{createMut.isPending ? "创建中..." : "创建"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? <div className="text-center py-12 text-muted-foreground">加载中...</div> :
      view === "kanban" ? (
        <div className="grid grid-cols-4 gap-4">
          {STATUS_COLS.map(col => {
            const items = campaigns.filter((c: any) => c.status === col.key);
            return (
              <div key={col.key} className={`rounded-xl p-3 ${col.color} min-h-[300px]`}>
                <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-sm">{col.label}</h3><Badge variant="secondary" className="text-xs">{items.length}</Badge></div>
                <div className="space-y-2">
                  {items.map((c: any) => (
                    <Card key={c.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-3 space-y-2">
                        <p className="font-medium text-sm">{c.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="outline" className="text-xs">{c.type}</Badge><span>{c.platform}</span></div>
                        {c.budget > 0 && <p className="text-xs text-muted-foreground">预算: ${c.budget}</p>}
                        <div className="flex gap-1 flex-wrap">
                          {STATUS_COLS.filter(s => s.key !== col.key).map(s => (
                            <Button key={s.key} variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => { updateMut.mutate({ id: c.id, data: { status: s.key } }); toast.success(`状态→${s.label}`); }}>{s.label}</Button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b"><th className="p-3 text-left font-medium">活动名称</th><th className="p-3 text-left font-medium">类型</th><th className="p-3 text-left font-medium">平台</th><th className="p-3 text-left font-medium">状态</th><th className="p-3 text-left font-medium">预算</th></tr></thead>
            <tbody>{campaigns.map((c: any) => (
              <tr key={c.id} className="border-b hover:bg-muted/50">
                <td className="p-3 font-medium">{c.name}</td><td className="p-3"><Badge variant="outline">{c.type}</Badge></td>
                <td className="p-3">{c.platform}</td><td className="p-3"><Badge>{STATUS_COLS.find(s => s.key === c.status)?.label || c.status}</Badge></td>
                <td className="p-3">${c.budget || 0}</td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}
