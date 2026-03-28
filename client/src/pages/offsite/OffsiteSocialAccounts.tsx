import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export default function OffsiteSocialAccounts() {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ platform: "tiktok", accountName: "", accountId: "", accessToken: "" });
  const { data, isLoading, refetch } = trpc.offSocial.listAccounts.useQuery();
  const createMut = trpc.offSocial.createAccount.useMutation({ onSuccess: () => { toast.success("账号已添加"); setShowAdd(false); refetch(); } });
  const accounts = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">社媒账号管理</h1><p className="text-muted-foreground mt-1">管理所有社交媒体账号，统一运营</p></div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />添加账号</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>添加社媒账号</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><label className="text-sm font-medium">平台</label>
                <Select value={form.platform} onValueChange={v => setForm(p => ({ ...p, platform: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="tiktok">TikTok</SelectItem><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="youtube">YouTube</SelectItem><SelectItem value="twitter">Twitter/X</SelectItem><SelectItem value="facebook">Facebook</SelectItem></SelectContent></Select></div>
              <div><label className="text-sm font-medium">账号名称 *</label><Input value={form.accountName} onChange={e => setForm(p => ({ ...p, accountName: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">账号ID</label><Input value={form.accountId} onChange={e => setForm(p => ({ ...p, accountId: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">Access Token</label><Input value={form.accessToken} onChange={e => setForm(p => ({ ...p, accessToken: e.target.value }))} type="password" /></div>
              <Button onClick={() => createMut.mutate(form)} disabled={createMut.isPending}>{createMut.isPending ? "添加中..." : "添加"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>平台</TableHead><TableHead>账号名称</TableHead><TableHead>账号ID</TableHead><TableHead>状态</TableHead><TableHead>粉丝数</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">加载中...</TableCell></TableRow>
            : accounts.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">暂无社媒账号</TableCell></TableRow>
            : accounts.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell>{a.platform}</TableCell>
                <TableCell className="font-medium">{a.accountName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.accountId || "-"}</TableCell>
                <TableCell><Badge variant={a.status === "connected" ? "default" : "secondary"}>{a.status === "connected" ? "已连接" : "未连接"}</Badge></TableCell>
                <TableCell>{a.followerCount ? a.followerCount.toLocaleString() : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
