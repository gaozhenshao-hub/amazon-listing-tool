import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Sparkles, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

export default function OffsiteContentReview() {
  const [showAdd, setShowAdd] = useState(false);
  const [showAiReview, setShowAiReview] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [selectedId, setSelectedId] = useState(0);
  const [form, setForm] = useState({ campaignId: 0, influencerId: 0, contentType: "video" as const, contentUrl: "", caption: "" });

  const { data, isLoading, refetch } = trpc.offContent.list.useQuery();
  const createMut = trpc.offContent.create.useMutation({ onSuccess: () => { toast.success("内容已提交"); setShowAdd(false); refetch(); } });
  const aiReviewMut = trpc.offContent.aiReview.useMutation({ onSuccess: (d) => { setAiResult(d.review); toast.success("AI审核完成"); } });
  const updateMut = trpc.offContent.updateStatus.useMutation({ onSuccess: () => { toast.success("状态已更新"); refetch(); } });
  const contents = data || [];
  const statusLabels: Record<string, string> = { pending: "待审核", ai_reviewed: "AI已审", approved: "已通过", rejected: "已拒绝", revision_needed: "需修改" };
  const statusColors: Record<string, string> = { pending: "", ai_reviewed: "bg-blue-100 text-blue-800", approved: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800", revision_needed: "bg-yellow-100 text-yellow-800" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">内容审核</h1><p className="text-muted-foreground mt-1">AI预审核 + 人工最终确认，确保内容质量</p></div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />提交内容</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>提交内容审核</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">活动ID</label><Input type="number" value={form.campaignId} onChange={e => setForm(p => ({ ...p, campaignId: Number(e.target.value) }))} /></div>
                <div><label className="text-sm font-medium">达人ID</label><Input type="number" value={form.influencerId} onChange={e => setForm(p => ({ ...p, influencerId: Number(e.target.value) }))} /></div>
                <div className="col-span-2"><label className="text-sm font-medium">内容类型</label>
                  <Select value={form.contentType} onValueChange={v => setForm(p => ({ ...p, contentType: v as any }))}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="video">视频</SelectItem><SelectItem value="image">图片</SelectItem><SelectItem value="story">故事</SelectItem><SelectItem value="reel">Reel</SelectItem><SelectItem value="post">帖子</SelectItem></SelectContent></Select></div>
              </div>
              <div><label className="text-sm font-medium">内容链接</label><Input value={form.contentUrl} onChange={e => setForm(p => ({ ...p, contentUrl: e.target.value }))} placeholder="https://..." /></div>
              <div><label className="text-sm font-medium">文案</label><Textarea value={form.caption} onChange={e => setForm(p => ({ ...p, caption: e.target.value }))} rows={3} /></div>
              <Button onClick={() => createMut.mutate({ collaborationId: form.campaignId, contentType: form.contentType, contentUrl: form.contentUrl, caption: form.caption })} disabled={createMut.isPending}>{createMut.isPending ? "提交中..." : "提交"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={showAiReview} onOpenChange={setShowAiReview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>AI内容审核结果</DialogTitle></DialogHeader>
          {aiResult && <Card><CardContent className="p-4 prose prose-sm max-w-none dark:prose-invert"><Streamdown>{aiResult}</Streamdown></CardContent></Card>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" className="text-red-600" onClick={() => { updateMut.mutate({ id: selectedId, humanStatus: "rejected", humanNotes: "人工拒绝" }); setShowAiReview(false); }}><XCircle className="h-4 w-4 mr-1" />拒绝</Button>
            <Button variant="outline" className="text-yellow-600" onClick={() => { updateMut.mutate({ id: selectedId, humanStatus: "revision_needed", humanNotes: "需修改" }); setShowAiReview(false); }}>需修改</Button>
            <Button onClick={() => { updateMut.mutate({ id: selectedId, humanStatus: "approved", humanNotes: "人工通过" }); setShowAiReview(false); }}><CheckCircle className="h-4 w-4 mr-1" />通过</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>活动</TableHead><TableHead>达人</TableHead><TableHead>类型</TableHead><TableHead>状态</TableHead><TableHead>AI评分</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">加载中...</TableCell></TableRow>
            : contents.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">暂无待审核内容</TableCell></TableRow>
            : contents.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell>#{c.campaignId}</TableCell>
                <TableCell>#{c.influencerId}</TableCell>
                <TableCell><Badge variant="outline">{c.contentType}</Badge></TableCell>
                <TableCell><Badge className={statusColors[c.status] || ""}>{statusLabels[c.status] || c.status}</Badge></TableCell>
                <TableCell>{c.aiScore ? `${c.aiScore}/100` : "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => { setSelectedId(c.id); aiReviewMut.mutate({ submissionId: c.id }); setShowAiReview(true); }}><Sparkles className="h-3 w-3 mr-1" />AI审核</Button>
                    {c.status !== "approved" && <Button size="sm" variant="ghost" className="h-7 text-green-600" onClick={() => updateMut.mutate({ id: c.id, humanStatus: "approved", humanNotes: "直接通过" })}><CheckCircle className="h-3 w-3 mr-1" />通过</Button>}
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
