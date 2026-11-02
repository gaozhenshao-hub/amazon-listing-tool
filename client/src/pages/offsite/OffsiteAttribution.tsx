import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function OffsiteAttribution() {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ campaignId: 0, originalUrl: "", utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "" });
  const { data, isLoading, refetch } = trpc.offAnalytics.listLinks.useQuery();
  const createMut = trpc.offAnalytics.createLink.useMutation({ onSuccess: () => { toast.success("追踪链接已创建"); setShowAdd(false); refetch(); } });
  const links = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">归因追踪</h1><p className="text-muted-foreground mt-1">UTM追踪链接管理，精准衡量站外流量效果</p></div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />创建追踪链接</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>创建UTM追踪链接</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><label className="text-sm font-medium">原始URL *</label><Input value={form.originalUrl} onChange={e => setForm(p => ({ ...p, originalUrl: e.target.value }))} placeholder="https://amazon.com/dp/..." /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">活动ID</label><Input type="number" value={form.campaignId} onChange={e => setForm(p => ({ ...p, campaignId: Number(e.target.value) }))} /></div>
                <div><label className="text-sm font-medium">utm_source *</label><Input value={form.utmSource} onChange={e => setForm(p => ({ ...p, utmSource: e.target.value }))} placeholder="如: tiktok" /></div>
                <div><label className="text-sm font-medium">utm_medium</label><Input value={form.utmMedium} onChange={e => setForm(p => ({ ...p, utmMedium: e.target.value }))} placeholder="如: influencer" /></div>
                <div><label className="text-sm font-medium">utm_campaign</label><Input value={form.utmCampaign} onChange={e => setForm(p => ({ ...p, utmCampaign: e.target.value }))} placeholder="如: summer_sale" /></div>
              </div>
              <div><label className="text-sm font-medium">utm_content</label><Input value={form.utmContent} onChange={e => setForm(p => ({ ...p, utmContent: e.target.value }))} placeholder="如: video_1" /></div>
              <Button onClick={() => createMut.mutate(form)} disabled={createMut.isPending}>{createMut.isPending ? "创建中..." : "创建"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">总链接数</p><p className="text-2xl font-bold mt-1">{links.length}</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">总点击</p><p className="text-2xl font-bold mt-1">{links.reduce((s: number, l: any) => s + (l.clickCount || 0), 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">总转化</p><p className="text-2xl font-bold mt-1">{links.reduce((s: number, l: any) => s + (l.conversionCount || 0), 0)}</p></CardContent></Card>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>来源</TableHead><TableHead>媒介</TableHead><TableHead>活动</TableHead><TableHead>点击</TableHead><TableHead>转化</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">加载中...</TableCell></TableRow>
            : links.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">暂无追踪链接</TableCell></TableRow>
            : links.map((l: any) => (
              <TableRow key={l.id}>
                <TableCell><Badge variant="outline">{l.utmSource}</Badge></TableCell>
                <TableCell>{l.utmMedium || "-"}</TableCell>
                <TableCell>{l.utmCampaign || "-"}</TableCell>
                <TableCell className="font-medium">{l.clickCount || 0}</TableCell>
                <TableCell className="font-medium">{l.conversionCount || 0}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => { navigator.clipboard.writeText(l.trackedUrl || l.originalUrl); toast.success("已复制"); }}><Copy className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => window.open(l.originalUrl, "_blank")}><ExternalLink className="h-3 w-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
