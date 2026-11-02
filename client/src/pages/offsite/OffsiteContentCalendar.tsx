import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

export default function OffsiteContentCalendar() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [form, setForm] = useState({ platform: "tiktok", title: "", content: "", scheduledDate: "", scheduledTime: "" });
  const [aiForm, setAiForm] = useState({ productName: "", platforms: ["tiktok"], startDate: "", endDate: "", frequency: "每周3次" });

  const startDate = useMemo(() => new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString().split("T")[0], [currentMonth]);
  const endDate = useMemo(() => new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).toISOString().split("T")[0], [currentMonth]);

  const { data, isLoading, refetch } = trpc.offSocial.listCalendar.useQuery({ startDate, endDate });
  const createMut = trpc.offSocial.createCalendarItem.useMutation({ onSuccess: () => { toast.success("排期已创建"); setShowAdd(false); refetch(); } });
  const aiMut = trpc.offSocial.aiGenerateCalendar.useMutation({ onSuccess: (d) => { setAiResult(d.calendarPlan); toast.success("AI计划已生成"); } });
  const items = data || [];

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const calendarDays = Array.from({ length: 42 }, (_, i) => { const day = i - firstDayOfWeek + 1; return day >= 1 && day <= daysInMonth ? day : null; });

  const getItemsForDay = (day: number) => {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return items.filter((it: any) => it.scheduledDate && String(it.scheduledDate).startsWith(dateStr));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">内容日历</h1><p className="text-muted-foreground mt-1">可视化排期管理，AI智能生成内容计划</p></div>
        <div className="flex gap-2">
          <Dialog open={showAi} onOpenChange={setShowAi}>
            <DialogTrigger asChild><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" />AI生成计划</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle>AI内容计划生成</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium">平台</label>
                    <Select value={aiForm.platforms[0]} onValueChange={v => setAiForm(p => ({ ...p, platforms: [v] }))}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="tiktok">TikTok</SelectItem><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="youtube">YouTube</SelectItem></SelectContent></Select></div>
                  <div><label className="text-sm font-medium">频率</label><Input value={aiForm.frequency} onChange={e => setAiForm(p => ({ ...p, frequency: e.target.value }))} placeholder="如: 每周3次" /></div>
                </div>
                <div><label className="text-sm font-medium">产品名称</label><Input value={aiForm.productName} onChange={e => setAiForm(p => ({ ...p, productName: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="text-sm font-medium">开始日期</label><Input type="date" value={aiForm.startDate} onChange={e => setAiForm(p => ({ ...p, startDate: e.target.value }))} /></div><div><label className="text-sm font-medium">结束日期</label><Input type="date" value={aiForm.endDate} onChange={e => setAiForm(p => ({ ...p, endDate: e.target.value }))} /></div></div>
                <Button onClick={() => aiMut.mutate({ productName: aiForm.productName, platforms: aiForm.platforms, startDate: aiForm.startDate || startDate, endDate: aiForm.endDate || endDate, frequency: aiForm.frequency })} disabled={aiMut.isPending}>{aiMut.isPending ? "生成中..." : "生成计划"}</Button>
                {aiResult && <Card><CardContent className="p-4 prose prose-sm max-w-none dark:prose-invert"><Streamdown>{aiResult}</Streamdown></CardContent></Card>}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />新建排期</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新建内容排期</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-sm font-medium">平台</label>
                    <Select value={form.platform} onValueChange={v => setForm(p => ({ ...p, platform: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="tiktok">TikTok</SelectItem><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="youtube">YouTube</SelectItem></SelectContent></Select></div>
                  <div><label className="text-sm font-medium">标签</label><Input value="" placeholder="如: 新品推广" /></div>
                </div>
                <div><label className="text-sm font-medium">标题 *</label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">内容</label><Textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} rows={3} /></div>
                <div className="grid grid-cols-2 gap-2"><div><label className="text-sm font-medium">排期日期</label><Input type="date" value={form.scheduledDate} onChange={e => setForm(p => ({ ...p, scheduledDate: e.target.value }))} /></div><div><label className="text-sm font-medium">时间</label><Input type="time" value={form.scheduledTime} onChange={e => setForm(p => ({ ...p, scheduledTime: e.target.value }))} /></div></div>
                <Button onClick={() => createMut.mutate({ platform: form.platform, title: form.title, content: form.content, scheduledDate: form.scheduledDate, scheduledTime: form.scheduledTime })} disabled={createMut.isPending}>{createMut.isPending ? "创建中..." : "创建"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <CardTitle className="text-lg">{currentMonth.getFullYear()}年{currentMonth.getMonth() + 1}月</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
            {["日", "一", "二", "三", "四", "五", "六"].map(d => <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>)}
            {calendarDays.map((day, i) => {
              const dayItems = day ? getItemsForDay(day) : [];
              return (
                <div key={i} className={`bg-background p-1 min-h-[80px] ${!day ? "bg-muted/30" : ""}`}>
                  {day && <div className="text-xs font-medium mb-1 px-1">{day}</div>}
                  {dayItems.slice(0, 2).map((it: any) => <div key={it.id} className="text-xs px-1 py-0.5 mb-0.5 rounded bg-primary/10 text-primary truncate">{it.title}</div>)}
                  {dayItems.length > 2 && <div className="text-xs text-muted-foreground px-1">+{dayItems.length - 2}更多</div>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
