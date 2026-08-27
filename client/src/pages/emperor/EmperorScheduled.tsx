import { useState } from "react";
import { trpc } from "@/lib/trpc";
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
  Database,
  ExternalLink,
  Pencil,
  ShieldCheck,
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
  nextRunAt?: string | null;
  lastRunStatus?: "succeeded" | "failed" | "running" | null;
  systemManaged?: number;
  triggerMode?: "internal" | "heartbeat";
  dataDomain?: string | null;
  externalTaskUid?: string | null;
  managePath?: string | null;
  lastBatchId?: number | null;
  inputTemplate?: unknown;
}

type SystemTaskDraft = {
  name: string;
  cronExpr: string;
  frequency: "daily" | "weekly";
  beijingTime: string;
  advancedCron: boolean;
  isActive: boolean;
  autoApply: boolean;
  multiplier: string;
  absoluteIncrease: string;
};

const pad = (value: number) => String(value).padStart(2, "0");
function readBeijingSchedule(cronExpr: string, dataDomain?: string | null) {
  const [seconds, minute, hour, dayOfMonth, month, weekday] = cronExpr.trim().split(/\s+/);
  const utcHour = Number(hour);
  const utcMinute = Number(minute);
  const supported = seconds === "0" && dayOfMonth === "*" && month === "*" && Number.isInteger(utcHour) && utcHour >= 0 && utcHour <= 23 && Number.isInteger(utcMinute) && utcMinute >= 0 && utcMinute <= 59;
  const frequency = dataDomain === "parent_asin_weekly_rollup" || weekday !== "*" ? "weekly" : "daily";
  return { frequency, beijingTime: supported ? `${pad((utcHour + 8) % 24)}:${pad(utcMinute)}` : "17:00", advancedCron: !supported } as Pick<SystemTaskDraft, "frequency" | "beijingTime" | "advancedCron">;
}
function createUtcCron(frequency: "daily" | "weekly", beijingTime: string) {
  const [hourText, minuteText] = beijingTime.split(":");
  const beijingHour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(beijingHour) || !Number.isInteger(minute) || beijingHour < 0 || beijingHour > 23 || minute < 0 || minute > 59) return "";
  const utcHour = (beijingHour - 8 + 24) % 24;
  // 周任务固定为中国时间周一；00:00–07:59会转换到前一日UTC，因此使用周日(0)。
  const utcWeekday = frequency === "weekly" ? (beijingHour < 8 ? "0" : "1") : "*";
  return `0 ${minute} ${utcHour} * * ${utcWeekday}`;
}

function systemTaskDraft(task: ScheduledTask): SystemTaskDraft {
  let template: Record<string, unknown> = {};
  try {
    const parsed = typeof task.inputTemplate === "string" ? JSON.parse(task.inputTemplate) : task.inputTemplate;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) template = parsed as Record<string, unknown>;
  } catch { /* 保持安全默认值；服务端仍会校验保存输入。 */ }
  const threshold = template.anomalyThreshold && typeof template.anomalyThreshold === "object" && !Array.isArray(template.anomalyThreshold)
    ? template.anomalyThreshold as Record<string, unknown> : {};
  return {
    name: task.name,
    cronExpr: task.cronExpr || "0 0 9 * * *",
    ...readBeijingSchedule(task.cronExpr || "0 0 9 * * *", task.dataDomain),
    isActive: Boolean(task.isActive),
    autoApply: Boolean(template.autoApply ?? task.dataDomain !== "parent_asin_weekly_rollup"),
    multiplier: String(threshold.multiplier ?? 20),
    absoluteIncrease: String(threshold.absoluteIncrease ?? 10_000),
  };
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
  const [showSystemEdit, setShowSystemEdit] = useState(false);
  const [newTask, setNewTask] = useState({ name: "", skillSlug: "", cronExpr: "0 9 * * *", context: "" });
  const [systemDraft, setSystemDraft] = useState<SystemTaskDraft>({ name: "", cronExpr: "", frequency: "daily", beijingTime: "17:00", advancedCron: false, isActive: true, autoApply: true, multiplier: "20", absoluteIncrease: "10000" });

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
  const setSystemTaskEnabledMutation = trpc.emperor.scheduled.setSystemTaskEnabled.useMutation({
    onSuccess: (result) => { toast.success(result.enabled ? "领星系统任务已恢复" : "领星系统任务已暂停"); refetch(); },
    onError: (err: any) => toast.error(err.message),
  });
  const updateSystemTaskMutation = trpc.emperor.scheduled.updateSystemTask.useMutation({
    onSuccess: () => { toast.success("领星系统任务已更新", { description: "已同步到唯一Heartbeat任务与执行配置。" }); setShowSystemEdit(false); refetch(); },
    onError: (err: any) => toast.error("保存失败", { description: err.message }),
  });

  const tasks: ScheduledTask[] = (data || []) as ScheduledTask[];
  const skills = (skillsData?.skills || []) as Array<{ slug: string; name: string }>;
  const isSystemTask = (task: ScheduledTask | null) => Number(task?.systemManaged || 0) === 1;
  const openSystemEdit = (task: ScheduledTask) => { setSystemDraft(systemTaskDraft(task)); setShowSystemEdit(true); };
  const updateVisualSchedule = (frequency: "daily" | "weekly", beijingTime: string) => setSystemDraft((draft) => ({ ...draft, frequency, beijingTime, cronExpr: createUtcCron(frequency, beijingTime), advancedCron: false }));
  const saveSystemTask = () => {
    if (!selectedTask) return;
    updateSystemTaskMutation.mutate({
      slug: selectedTask.slug,
      name: systemDraft.name.trim(),
      cronExpr: systemDraft.cronExpr.trim(),
      isActive: systemDraft.isActive,
      autoApply: selectedTask.dataDomain === "parent_asin_weekly_rollup" ? false : systemDraft.autoApply,
      anomalyThreshold: { multiplier: Number(systemDraft.multiplier), absoluteIncrease: Number(systemDraft.absoluteIncrease) },
    });
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <>
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
                      <span className="font-medium text-sm truncate flex items-center gap-1.5"><span className="truncate">{task.name}</span>{isSystemTask(task) && <Database className="h-3.5 w-3.5 text-primary flex-shrink-0" />}</span>
                      {task.isActive ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{isSystemTask(task) ? "领星 MCP · 系统任务" : task.skillSlug}</p>
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
                  <p className="text-sm text-muted-foreground mt-1">{isSystemTask(selectedTask) ? "领星官方MCP · 受治理系统任务" : selectedTask.skillSlug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => isSystemTask(selectedTask)
                      ? setSystemTaskEnabledMutation.mutate({ slug: selectedTask.slug, enabled: !selectedTask.isActive })
                      : upsertMutation.mutate({ slug: selectedTask.slug, name: selectedTask.name, skillSlug: selectedTask.skillSlug, cronExpr: selectedTask.cronExpr, isActive: !selectedTask.isActive })}
                    disabled={upsertMutation.isPending || setSystemTaskEnabledMutation.isPending}
                    className="gap-2"
                  >
                    {selectedTask.isActive ? <><Pause className="h-4 w-4" />暂停</> : <><Play className="h-4 w-4" />启用</>}
                  </Button>
                  {isSystemTask(selectedTask) ? (
                    <>
                      <Button variant="outline" size="sm" className="gap-2" onClick={() => openSystemEdit(selectedTask)}><Pencil className="h-4 w-4" />编辑</Button>
                      <Button variant="outline" size="sm" className="gap-2" onClick={() => { window.location.href = selectedTask.managePath || "/ops/lingxing-sync"; }}>
                        <ExternalLink className="h-4 w-4" />查看同步审计
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteMutation.mutate({ slug: selectedTask.slug })}
                      disabled={deleteMutation.isPending}
                      className="gap-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />删除
                    </Button>
                  )}
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
                    {isSystemTask(selectedTask) && <>
                      <div>
                        <p className="text-xs text-muted-foreground">下次运行</p>
                        <p className="font-medium mt-1">{selectedTask.nextRunAt ? new Date(selectedTask.nextRunAt).toLocaleString() : "由平台计划触发"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">最近批次</p>
                        <p className="font-medium mt-1">{selectedTask.lastBatchId ? `#${selectedTask.lastBatchId}` : "尚未运行"}</p>
                      </div>
                    </>}
                  </div>
                  {isSystemTask(selectedTask) && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-primary" />皇帝受治理同步任务</div>
                      <p className="text-xs text-muted-foreground leading-5">任务由皇帝中台统一控制，实际调用仅经领星官方MCP Tool Gateway。暂停/恢复会同步更新唯一的外部任务UID；不可删除、不可直接触发，以避免重复写入。</p>
                      <div className="grid gap-2 text-xs sm:grid-cols-2">
                        <p><span className="text-muted-foreground">数据域：</span>{selectedTask.dataDomain || "—"}</p>
                        <p className="truncate"><span className="text-muted-foreground">任务UID：</span>{selectedTask.externalTaskUid || "—"}</p>
                      </div>
                    </div>
                  )}
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

      <Dialog open={showSystemEdit} onOpenChange={setShowSystemEdit}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>编辑领星系统任务</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground leading-5">
              此处为皇帝中台唯一控制面。保存会更新同一Heartbeat任务和执行配置，不会新建Cron、改变MCP白名单、店铺范围或任务UID。
            </div>
            <div className="space-y-2"><label className="text-sm font-medium">任务名称</label><Input value={systemDraft.name} onChange={(event) => setSystemDraft((draft) => ({ ...draft, name: event.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-sm font-medium">执行频率</label><Select value={systemDraft.frequency} onValueChange={(value: "daily" | "weekly") => updateVisualSchedule(value, systemDraft.beijingTime)} disabled={selectedTask?.dataDomain === "parent_asin_weekly_rollup"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">每天</SelectItem><SelectItem value="weekly">每周一</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">周汇总固定每周一，不能改为每日。</p></div><div className="space-y-2"><label className="text-sm font-medium">执行时间（北京时间）</label><Input type="time" value={systemDraft.beijingTime} onChange={(event) => updateVisualSchedule(systemDraft.frequency, event.target.value)} /><p className="text-xs text-muted-foreground">系统自动转换为UTC时间。</p></div></div>
            <div className="rounded-lg border p-3 space-y-2"><div className="flex items-center justify-between"><div><p className="text-sm font-medium">高级 Cron</p><p className="text-xs text-muted-foreground">仅在需要特殊表达式时使用；仍必须为6段UTC格式。</p></div><Button type="button" variant="outline" size="sm" onClick={() => setSystemDraft((draft) => ({ ...draft, advancedCron: !draft.advancedCron }))}>{systemDraft.advancedCron ? "使用可视化设置" : "编辑高级Cron"}</Button></div>{systemDraft.advancedCron ? <Input className="font-mono" value={systemDraft.cronExpr} onChange={(event) => setSystemDraft((draft) => ({ ...draft, cronExpr: event.target.value }))} /> : <p className="font-mono text-xs text-muted-foreground">将保存为UTC：{systemDraft.cronExpr}</p>}</div>
            <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-sm font-medium">启用任务</p><p className="text-xs text-muted-foreground">暂停会同步暂停唯一Heartbeat触发器。</p></div><Switch checked={systemDraft.isActive} onCheckedChange={(checked) => setSystemDraft((draft) => ({ ...draft, isActive: checked }))} /></div>
            <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-sm font-medium">校验通过后自动应用</p><p className="text-xs text-muted-foreground">关闭后只生成待审核草稿，不追加历史事实。</p></div><Switch checked={selectedTask?.dataDomain === "parent_asin_weekly_rollup" ? false : systemDraft.autoApply} disabled={selectedTask?.dataDomain === "parent_asin_weekly_rollup"} onCheckedChange={(checked) => setSystemDraft((draft) => ({ ...draft, autoApply: checked }))} /></div>
            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-sm font-medium">异常倍数阈值</label><Input type="number" min="2" max="20" value={systemDraft.multiplier} onChange={(event) => setSystemDraft((draft) => ({ ...draft, multiplier: event.target.value }))} /><p className="text-xs text-muted-foreground">范围2–20倍</p></div><div className="space-y-2"><label className="text-sm font-medium">绝对增量阈值</label><Input type="number" min="100" max="10000" value={systemDraft.absoluteIncrease} onChange={(event) => setSystemDraft((draft) => ({ ...draft, absoluteIncrease: event.target.value }))} /><p className="text-xs text-muted-foreground">范围100–10,000</p></div></div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">始终锁定：数据域、MCP工具白名单、美国店铺范围、任务UID、运行审计、库存货期/MOQ/成本，以及广告预算/竞价/否词/状态/结构。</div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowSystemEdit(false)}>取消</Button><Button onClick={saveSystemTask} disabled={updateSystemTaskMutation.isPending || !systemDraft.name.trim()}>{updateSystemTaskMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存受治理变更</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
