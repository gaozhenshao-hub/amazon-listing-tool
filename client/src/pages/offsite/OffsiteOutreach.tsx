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
import { Plus, Sparkles, Send, Mail } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

export default function OffsiteOutreach() {
  const [showAdd, setShowAdd] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [form, setForm] = useState({ influencerId: 0, channel: "email" as const, subject: "", content: "" });
  const [aiForm, setAiForm] = useState({ influencerId: 0, productName: "", tone: "professional", language: "en" });

  const { data, isLoading, refetch } = trpc.offOutreach.list.useQuery();
  const createMut = trpc.offOutreach.create.useMutation({ onSuccess: () => { toast.success("消息已创建"); setShowAdd(false); refetch(); } });
  const aiMut = trpc.offOutreach.aiGenerate.useMutation({ onSuccess: (d) => { setAiResult(d.emailDraft); toast.success("AI邮件已生成"); } });
  const updateMut = trpc.offOutreach.update.useMutation({ onSuccess: () => refetch() });
  const messages = data || [];
  const statusLabels: Record<string, string> = { draft: "草稿", sent: "已发送", replied: "已回复", follow_up: "跟进中", closed: "已关闭" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">外联管理</h1><p className="text-muted-foreground mt-1">AI生成外联邮件，管理达人沟通全流程</p></div>
        <div className="flex gap-2">
          <Dialog open={showAi} onOpenChange={setShowAi}>
            <DialogTrigger asChild><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" />AI生成邮件</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle>AI生成外联邮件</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium">达人ID</label><Input type="number" value={aiForm.influencerId} onChange={e => setAiForm(p => ({ ...p, influencerId: Number(e.target.value) }))} /></div>
                  <div><label className="text-sm font-medium">产品名称</label><Input value={aiForm.productName} onChange={e => setAiForm(p => ({ ...p, productName: e.target.value }))} /></div>
                  <div><label className="text-sm font-medium">语气</label>
                    <Select value={aiForm.tone} onValueChange={v => setAiForm(p => ({ ...p, tone: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="professional">专业正式</SelectItem><SelectItem value="friendly">友好轻松</SelectItem><SelectItem value="casual">随意自然</SelectItem></SelectContent></Select></div>
                  <div><label className="text-sm font-medium">语言</label>
                    <Select value={aiForm.language} onValueChange={v => setAiForm(p => ({ ...p, language: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="zh">中文</SelectItem></SelectContent></Select></div>
                </div>
                <Button onClick={() => aiMut.mutate(aiForm)} disabled={aiMut.isPending}>{aiMut.isPending ? "生成中..." : "生成邮件"}</Button>
                {aiResult && <Card><CardContent className="p-4 prose prose-sm max-w-none dark:prose-invert"><Streamdown>{aiResult}</Streamdown></CardContent></Card>}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />新建消息</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新建外联消息</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium">达人ID *</label><Input type="number" value={form.influencerId} onChange={e => setForm(p => ({ ...p, influencerId: Number(e.target.value) }))} /></div>
                  <div><label className="text-sm font-medium">渠道</label>
                    <Select value={form.channel} onValueChange={v => setForm(p => ({ ...p, channel: v as any }))}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="email">邮件</SelectItem><SelectItem value="dm">私信</SelectItem><SelectItem value="platform">平台消息</SelectItem></SelectContent></Select></div>
                </div>
                <div><label className="text-sm font-medium">主题</label><Input value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">内容 *</label><Textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} rows={5} /></div>
                <Button onClick={() => createMut.mutate(form)} disabled={createMut.isPending}>{createMut.isPending ? "创建中..." : "创建"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>达人ID</TableHead><TableHead>渠道</TableHead><TableHead>主题</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">加载中...</TableCell></TableRow>
            : messages.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">暂无外联消息</TableCell></TableRow>
            : messages.map((m: any) => (
              <TableRow key={m.id}>
                <TableCell>#{m.influencerId}</TableCell>
                <TableCell><Badge variant="outline">{m.channel === "email" ? "邮件" : m.channel === "dm" ? "私信" : "平台"}</Badge></TableCell>
                <TableCell className="max-w-[200px] truncate">{m.subject || "-"}</TableCell>
                <TableCell><Badge>{statusLabels[m.status] || m.status}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {m.status === "draft" && <Button size="sm" variant="ghost" className="h-7" onClick={() => { updateMut.mutate({ id: m.id, data: { status: "sent" } }); toast.success("已发送"); }}><Send className="h-3 w-3 mr-1" />发送</Button>}
                    {m.status === "sent" && <Button size="sm" variant="ghost" className="h-7" onClick={() => { updateMut.mutate({ id: m.id, data: { status: "replied" } }); toast.success("已回复"); }}><Mail className="h-3 w-3 mr-1" />已回复</Button>}
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
