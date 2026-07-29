import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Clock,
  Play,
  Pause,
  Trash2,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ScheduledTask {
  id: number;
  slug: string;
  name: string;
  description: string;
  skillSlug: string;
  cronExpr: string;
  isActive: boolean;
  runCount: number;
  lastRunAt: string | null;
}

const CRON_PRESETS = [
  { label: "每小时", value: "0 * * * *" },
  { label: "每天早上9点", value: "0 9 * * *" },
  { label: "每天晚上6点", value: "0 18 * * *" },
  { label: "每周一早上9点", value: "0 9 * * 1" },
  { label: "每天午夜", value: "0 0 * * *" },
];

export default function EmperorScheduled() {
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ name: "", skillSlug: "", cronExpr: "0 9 * * *", context: "" });

  const { data, isLoading, refetch } = trpc.emperor.scheduled.list.useQuery();
  const { data: skillsData } = trpc.emperor.skills.list.useQuery({ page: 1, pageSize: 200, category: "", search: "" });

  const upsertMutation = trpc.emperor.scheduled.upsert.useMutation({
    onSuccess: () => { toast.success("已更新"); refetch(); },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = trpc.emperor.scheduled.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); setSelectedTask(null); refetch(); },
    onError: (err: any) => toast.error(err.message),
  });

  const triggerMutation = trpc.emperor.scheduled.trigger.useMutation({
    onSuccess: (res) => { toast.success(res.message); refetch(); },
    onError: (err: any) => toast.error(err.message),
  });

  const tasks: ScheduledTask[] = (data || []) as ScheduledTask[];
  const skills = (skillsData?.skills || []) as Array<{ slug: string; name: string }>;

  const formatTime = (ts: number | null) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* Left: Task list */}
        <div className="w-[320px] flex-shrink-0 border-r flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm">定时任务</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{tasks.length} 个任务</p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button size="sm" className="h-8 gap-1" onClick={() => setShowCreate(true)}>
                <Plus className="h-3.5 w-3.5" />新建
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Clock className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">暂无定时任务</p>
                <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={() => setShowCreate(true)}>
                  <Plus className="h-3.5 w-3.5" />创建第一个
                </Button>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all",
                      selectedTask?.id === task.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm truncate">{task.name}</span>
                      {task.isActive ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{task.skillSlug}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="outline" className="text-xs px-1.5 py-0 font-mono">{task.cronExpr}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span>运行 {task.runCount} 次</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right: Task detail */}
        <div className="flex-1 flex flex-col min-w-0 p-6">
          {selectedTask ? (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{selectedTask.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{selectedTask.skillSlug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => upsertMutation.mutate({ slug: selectedTask.slug, name: selectedTask.name, skillSlug: selectedTask.skillSlug, cronExpr: selectedTask.cronExpr, isActive: !selectedTask.isActive })}
                    disabled={upsertMutation.isPending}
                    className="gap-2"
                  >
                    {selectedTask.isActive ? <><Pause className="h-4 w-4" />暂停</> : <><Play className="h-4 w-4" />启用</>}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteMutation.mutate({ slug: selectedTask.slug })}
                    disabled={deleteMutation.isPending}
                    className="gap-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />删除
                  </Button>
                </div>
              </div>

              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Cron 表达式</p>
                      <p className="font-mono font-medium mt-1">{selectedTask.cronExpr}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">状态</p>
                      <p className="font-medium mt-1 flex items-center gap-2">
                        {selectedTask.isActive ? (
                          <><CheckCircle2 className="h-4 w-4 text-green-500" />已启用</>
                        ) : (
                          <><XCircle className="h-4 w-4 text-muted-foreground" />已暂停</>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">上次运行</p>
                      <p className="font-medium mt-1">{selectedTask.lastRunAt ? new Date(selectedTask.lastRunAt).toLocaleString() : "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">运行次数</p>
                      <p className="font-medium mt-1">{selectedTask.runCount} 次</p>
                    </div>
                  </div>
                  {selectedTask.description && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">描述</p>
                      <p className="text-sm">{selectedTask.description}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Calendar className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm">从左侧选择一个定时任务</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建定时任务</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">任务名称</label>
              <Input
                value={newTask.name}
                onChange={(e) => setNewTask(t => ({ ...t, name: e.target.value }))}
                placeholder="如：每日关键词分析"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">选择 Skill</label>
              <Select value={newTask.skillSlug} onValueChange={(v) => setNewTask(t => ({ ...t, skillSlug: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="选择要定时运行的 Skill" />
                </SelectTrigger>
                <SelectContent>
                  {skills.map((s) => (
                    <SelectItem key={s.slug} value={s.slug}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">执行频率</label>
              <Select value={newTask.cronExpr} onValueChange={(v) => setNewTask(t => ({ ...t, cronExpr: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label} ({p.value})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">运行上下文（可选）</label>
              <Input
                value={newTask.context}
                onChange={(e) => setNewTask(t => ({ ...t, context: e.target.value }))}
                placeholder="传递给 Skill 的额外上下文..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button
              onClick={() => upsertMutation.mutate({ slug: `task-${Date.now()}`, name: newTask.name, skillSlug: newTask.skillSlug, cronExpr: newTask.cronExpr, isActive: true })}
              disabled={upsertMutation.isPending || !newTask.name || !newTask.skillSlug}
              className="gap-2"
            >
              {upsertMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
