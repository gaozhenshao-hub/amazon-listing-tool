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
import { Search, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

export default function OffsiteInfluencers() {
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showAiMatch, setShowAiMatch] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [form, setForm] = useState({ name: "", platform: "tiktok", handle: "", followerCount: 0, category: "", contactEmail: "", region: "", notes: "" });
  const [matchForm, setMatchForm] = useState({ productName: "", productCategory: "", targetAudience: "", budget: "", goals: "" });

  const { data, isLoading, refetch } = trpc.offInfluencer.search.useQuery({ keyword: search, platform: platform === "all" ? undefined : platform });
  const createMut = trpc.offInfluencer.create.useMutation({ onSuccess: () => { toast.success("达人已添加"); setShowAdd(false); refetch(); } });
  const aiMatchMut = trpc.offInfluencer.aiMatch.useMutation({ onSuccess: (d) => { setAiResult(d.analysis); toast.success("AI匹配完成"); } });

  const influencers = data || [];
  const platformColors: Record<string, string> = { tiktok: "bg-pink-100 text-pink-800", instagram: "bg-purple-100 text-purple-800", youtube: "bg-red-100 text-red-800", twitter: "bg-blue-100 text-blue-800", facebook: "bg-indigo-100 text-indigo-800" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">达人管理</h1>
          <p className="text-muted-foreground mt-1">管理达人资源库，AI智能匹配最佳合作达人</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showAiMatch} onOpenChange={setShowAiMatch}>
            <DialogTrigger asChild><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" />AI智能匹配</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle>AI达人智能匹配</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium">产品名称</label><Input value={matchForm.productName} onChange={e => setMatchForm(p => ({ ...p, productName: e.target.value }))} placeholder="如: 瑜伽垫" /></div>
                  <div><label className="text-sm font-medium">产品类目</label><Input value={matchForm.productCategory} onChange={e => setMatchForm(p => ({ ...p, productCategory: e.target.value }))} placeholder="如: 运动健身" /></div>
                  <div><label className="text-sm font-medium">目标受众</label><Input value={matchForm.targetAudience} onChange={e => setMatchForm(p => ({ ...p, targetAudience: e.target.value }))} placeholder="如: 25-35岁女性" /></div>
                  <div><label className="text-sm font-medium">预算范围</label><Input value={matchForm.budget} onChange={e => setMatchForm(p => ({ ...p, budget: e.target.value }))} placeholder="如: $500-2000" /></div>
                </div>
                <div><label className="text-sm font-medium">合作目标</label><Textarea value={matchForm.goals} onChange={e => setMatchForm(p => ({ ...p, goals: e.target.value }))} rows={3} placeholder="描述合作目标..." /></div>
                <Button onClick={() => aiMatchMut.mutate({ productName: matchForm.productName, productCategory: matchForm.productCategory, targetAudience: matchForm.targetAudience, budget: matchForm.budget })} disabled={aiMatchMut.isPending}>{aiMatchMut.isPending ? "AI分析中..." : "开始匹配"}</Button>
                {aiResult && <Card><CardContent className="p-4 prose prose-sm max-w-none dark:prose-invert"><Streamdown>{aiResult}</Streamdown></CardContent></Card>}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />添加达人</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>添加达人</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium">名称 *</label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div><label className="text-sm font-medium">平台 *</label>
                    <Select value={form.platform} onValueChange={v => setForm(p => ({ ...p, platform: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="tiktok">TikTok</SelectItem><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="youtube">YouTube</SelectItem><SelectItem value="twitter">Twitter/X</SelectItem><SelectItem value="facebook">Facebook</SelectItem></SelectContent>
                    </Select></div>
                  <div><label className="text-sm font-medium">账号</label><Input value={form.handle} onChange={e => setForm(p => ({ ...p, handle: e.target.value }))} placeholder="@handle" /></div>
                  <div><label className="text-sm font-medium">粉丝数</label><Input type="number" value={form.followerCount} onChange={e => setForm(p => ({ ...p, followerCount: Number(e.target.value) }))} /></div>
                  <div><label className="text-sm font-medium">类目</label><Input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} /></div>
                  <div><label className="text-sm font-medium">邮箱</label><Input value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))} /></div>
                </div>
                <div><label className="text-sm font-medium">备注</label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
                <Button onClick={() => createMut.mutate(form)} disabled={createMut.isPending}>{createMut.isPending ? "添加中..." : "添加"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="搜索达人名称、账号..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select value={platform} onValueChange={setPlatform}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部平台</SelectItem><SelectItem value="tiktok">TikTok</SelectItem><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="youtube">YouTube</SelectItem><SelectItem value="twitter">Twitter/X</SelectItem></SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>达人</TableHead><TableHead>平台</TableHead><TableHead>粉丝数</TableHead><TableHead>类目</TableHead><TableHead>状态</TableHead><TableHead>联系邮箱</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">加载中...</TableCell></TableRow>
            : influencers.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">暂无达人数据，点击"添加达人"开始</TableCell></TableRow>
            : influencers.map((inf: any) => (
              <TableRow key={inf.id}>
                <TableCell className="font-medium">{inf.name} {inf.handle && <span className="text-muted-foreground text-xs ml-1">@{inf.handle}</span>}</TableCell>
                <TableCell><Badge className={platformColors[inf.platform] || ""}>{inf.platform}</Badge></TableCell>
                <TableCell>{inf.followerCount ? (inf.followerCount > 10000 ? `${(inf.followerCount / 10000).toFixed(1)}万` : inf.followerCount.toLocaleString()) : "-"}</TableCell>
                <TableCell>{inf.category || "-"}</TableCell>
                <TableCell><Badge variant={inf.status === "active" ? "default" : "secondary"}>{inf.status === "active" ? "活跃" : "未激活"}</Badge></TableCell>
                <TableCell className="text-sm">{inf.contactEmail || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
