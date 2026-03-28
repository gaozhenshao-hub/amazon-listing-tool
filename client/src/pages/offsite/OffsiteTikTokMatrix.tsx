import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Sparkles, Video } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

export default function OffsiteTikTokMatrix() {
  const [showAdd, setShowAdd] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [form, setForm] = useState({ name: "", description: "" });
  const [aiForm, setAiForm] = useState({ originalScript: "", accountProfiles: "" });

  const { data, isLoading, refetch } = trpc.offSocial.listMatrixGroups.useQuery();
  const createMut = trpc.offSocial.createMatrixGroup.useMutation({ onSuccess: () => { toast.success("矩阵分组已创建"); setShowAdd(false); refetch(); } });
  const aiMut = trpc.offSocial.aiMatrixVariation.useMutation({ onSuccess: (d) => { setAiResult(d.variations); toast.success("AI变体已生成"); } });
  const groups = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">TikTok矩阵管理</h1><p className="text-muted-foreground mt-1">多账号矩阵运营，AI生成差异化内容变体</p></div>
        <div className="flex gap-2">
          <Dialog open={showAi} onOpenChange={setShowAi}>
            <DialogTrigger asChild><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" />AI生成变体</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle>AI内容变体生成</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><label className="text-sm font-medium">原始脚本</label><Textarea value={aiForm.originalScript} onChange={e => setAiForm(p => ({ ...p, originalScript: e.target.value }))} rows={4} placeholder="输入原始视频脚本..." /></div>
                <div><label className="text-sm font-medium">账号画像</label><Textarea value={aiForm.accountProfiles} onChange={e => setAiForm(p => ({ ...p, accountProfiles: e.target.value }))} rows={3} placeholder="描述各账号的定位和风格..." /></div>
                <Button onClick={() => aiMut.mutate({ originalScript: aiForm.originalScript, accountProfiles: aiForm.accountProfiles.split('\n').filter(Boolean) })} disabled={aiMut.isPending}>{aiMut.isPending ? "生成中..." : "生成变体"}</Button>
                {aiResult && <Card><CardContent className="p-4 prose prose-sm max-w-none dark:prose-invert"><Streamdown>{aiResult}</Streamdown></CardContent></Card>}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />新建分组</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新建矩阵分组</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><label className="text-sm font-medium">分组名称 *</label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">描述</label><Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} /></div>
                <Button onClick={() => createMut.mutate(form)} disabled={createMut.isPending}>{createMut.isPending ? "创建中..." : "创建"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>分组名称</TableHead><TableHead>描述</TableHead><TableHead>账号数</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">加载中...</TableCell></TableRow>
            : groups.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">暂无矩阵分组</TableCell></TableRow>
            : groups.map((g: any) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium"><div className="flex items-center gap-2"><Video className="h-4 w-4 text-pink-500" />{g.name}</div></TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{g.description || "-"}</TableCell>
                <TableCell>{g.accountCount || 0}</TableCell>
                <TableCell><Badge variant={g.isActive ? "default" : "secondary"}>{g.isActive ? "活跃" : "停用"}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
