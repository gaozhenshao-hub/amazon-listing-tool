import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, Loader2, Users, GripVertical, Calendar, User,
  CheckCircle2, Clock, AlertCircle, ArrowRight, BarChart3,
  ChevronDown, ChevronUp, Edit2, MessageSquare,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

interface Props {
  productId: number;
  parentAsin: string;
}

const BOARD_COLUMNS = [
  { status: "todo", label: "待处理", icon: AlertCircle, color: "bg-gray-100 border-gray-300", badgeColor: "bg-gray-200 text-gray-700" },
  { status: "in_progress", label: "进行中", icon: Clock, color: "bg-blue-50 border-blue-300", badgeColor: "bg-blue-200 text-blue-700" },
  { status: "review", label: "待审核", icon: Users, color: "bg-amber-50 border-amber-300", badgeColor: "bg-amber-200 text-amber-700" },
  { status: "done", label: "已完成", icon: CheckCircle2, color: "bg-emerald-50 border-emerald-300", badgeColor: "bg-emerald-200 text-emerald-700" },
];

const PRIORITY_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  urgent: { label: "紧急", color: "bg-red-100 text-red-700 border-red-200", order: 0 },
  high: { label: "高", color: "bg-orange-100 text-orange-700 border-orange-200", order: 1 },
  medium: { label: "中", color: "bg-blue-100 text-blue-700 border-blue-200", order: 2 },
  low: { label: "低", color: "bg-gray-100 text-gray-600 border-gray-200", order: 3 },
};

const TASK_TYPES: Record<string, { label: string; color: string }> = {
  listing: { label: "Listing优化", color: "bg-purple-100 text-purple-700" },
  ads: { label: "广告调整", color: "bg-blue-100 text-blue-700" },
  inventory: { label: "库存管理", color: "bg-emerald-100 text-emerald-700" },
  pricing: { label: "价格策略", color: "bg-amber-100 text-amber-700" },
  review: { label: "评论管理", color: "bg-pink-100 text-pink-700" },
  competitor: { label: "竞品应对", color: "bg-red-100 text-red-700" },
  other: { label: "其他", color: "bg-gray-100 text-gray-700" },
};

const PIE_COLORS = ["#94a3b8", "#3b82f6", "#f59e0b", "#10b981"];

export default function OpsProductTeam({ productId, parentAsin }: Props) {
  const { data: tasks, refetch, isLoading } = trpc.productOps.listTeamTasks.useQuery(
    { productProfileId: productId }
  );
  const { data: stats } = trpc.productOps.getTeamTaskStats.useQuery(
    { productProfileId: productId }
  );

  const createTask = trpc.productOps.createTeamTask.useMutation({
    onSuccess: () => { refetch(); setShowCreate(false); toast.success("任务已创建"); },
  });
  const updateTask = trpc.productOps.updateTeamTask.useMutation({
    onSuccess: () => { refetch(); },
  });
  const deleteTask = trpc.productOps.deleteTeamTask.useMutation({
    onSuccess: () => { refetch(); toast.success("任务已删除"); },
  });
  const moveTask = trpc.productOps.moveTeamTask.useMutation({
    onSuccess: () => { refetch(); },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [viewMode, setViewMode] = useState<"board" | "list" | "stats">("board");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [editingTask, setEditingTask] = useState<any>(null);

  const [createForm, setCreateForm] = useState({
    title: "", description: "", assignee: "", taskType: "other" as string,
    priority: "medium" as string, dueDate: "",
  });

  // ─── Computed ───
  const tasksByStatus = useMemo(() => {
    if (!tasks) return {};
    const grouped: Record<string, any[]> = { todo: [], in_progress: [], review: [], done: [] };
    for (const t of tasks as any[]) {
      if (filterAssignee !== "all" && t.assignee !== filterAssignee) continue;
      if (filterType !== "all" && t.taskType !== filterType) continue;
      const status = t.status || "todo";
      if (!grouped[status]) grouped[status] = [];
      grouped[status].push(t);
    }
    // Sort by priority
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a: any, b: any) => (PRIORITY_CONFIG[a.priority]?.order ?? 9) - (PRIORITY_CONFIG[b.priority]?.order ?? 9));
    }
    return grouped;
  }, [tasks, filterAssignee, filterType]);

  const assignees = useMemo(() => {
    if (!tasks) return [];
    const set = new Set<string>();
    (tasks as any[]).forEach((t: any) => { if (t.assignee) set.add(t.assignee); });
    return Array.from(set);
  }, [tasks]);

  const statusPieData = useMemo(() => {
    return BOARD_COLUMNS.map(col => ({
      name: col.label,
      value: tasksByStatus[col.status]?.length || 0,
    }));
  }, [tasksByStatus]);

  const assigneeBarData = useMemo(() => {
    if (!tasks) return [];
    const map: Record<string, { name: string; todo: number; in_progress: number; review: number; done: number }> = {};
    (tasks as any[]).forEach((t: any) => {
      const name = t.assignee || "未分配";
      if (!map[name]) map[name] = { name, todo: 0, in_progress: 0, review: 0, done: 0 };
      const status = t.status || "todo";
      if (status in map[name]) (map[name] as any)[status]++;
    });
    return Object.values(map);
  }, [tasks]);

  const handleMoveTask = (taskId: number, newStatus: string) => {
    moveTask.mutate({ taskId, newStatus: newStatus as "todo" | "in_progress" | "review" | "done" | "backlog" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            团队协作看板
          </h3>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {(["board", "list", "stats"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded text-sm transition-colors ${viewMode === mode ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                {mode === "board" ? "看板" : mode === "list" ? "列表" : "统计"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Filters */}
          <Select value={filterAssignee} onValueChange={setFilterAssignee}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="负责人" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部成员</SelectItem>
              {assignees.map(a => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="任务类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {Object.entries(TASK_TYPES).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3 w-3 mr-1" /> 新建任务
          </Button>
        </div>
      </div>

      {/* Board View */}
      {viewMode === "board" && (
        <div className="grid grid-cols-4 gap-3">
          {BOARD_COLUMNS.map(col => {
            const colTasks = tasksByStatus[col.status] || [];
            const Icon = col.icon;
            return (
              <div key={col.status} className={`rounded-lg border-2 ${col.color} p-3 min-h-[300px]`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    <span className="font-medium text-sm">{col.label}</span>
                    <Badge variant="secondary" className="text-xs">{colTasks.length}</Badge>
                  </div>
                </div>
                <div className="space-y-2">
                  {colTasks.map((task: any) => (
                    <Card key={task.id} className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-1">
                          <p className="text-sm font-medium line-clamp-2">{task.title}</p>
                          <button
                            onClick={() => {
                              if (confirm("删除此任务？")) deleteTask.mutate({ taskId: task.id });
                            }}
                            className="p-0.5 hover:bg-muted rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                        {task.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{task.description}</p>
                        )}
                        <div className="flex items-center gap-1 flex-wrap mb-2">
                          <Badge variant="outline" className={`text-xs ${PRIORITY_CONFIG[task.priority]?.color || ""}`}>
                            {PRIORITY_CONFIG[task.priority]?.label || task.priority}
                          </Badge>
                          {task.taskType && TASK_TYPES[task.taskType] && (
                            <Badge variant="outline" className={`text-xs ${TASK_TYPES[task.taskType].color}`}>
                              {TASK_TYPES[task.taskType].label}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            <span>{task.assignee || "未分配"}</span>
                          </div>
                          {task.dueDate && (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              <span>{task.dueDate}</span>
                            </div>
                          )}
                        </div>
                        {/* Move buttons */}
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t">
                          {BOARD_COLUMNS.filter(c => c.status !== col.status).map(target => (
                            <button
                              key={target.status}
                              onClick={() => handleMoveTask(task.id, target.status)}
                              className="text-xs px-2 py-0.5 rounded bg-muted hover:bg-muted-foreground/10 transition-colors"
                            >
                              → {target.label}
                            </button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {colTasks.length === 0 && (
                    <div className="text-center py-8 text-xs text-muted-foreground">
                      暂无任务
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium">任务</th>
                  <th className="text-left p-3 text-sm font-medium w-[100px]">状态</th>
                  <th className="text-left p-3 text-sm font-medium w-[80px]">优先级</th>
                  <th className="text-left p-3 text-sm font-medium w-[100px]">类型</th>
                  <th className="text-left p-3 text-sm font-medium w-[100px]">负责人</th>
                  <th className="text-left p-3 text-sm font-medium w-[100px]">截止日期</th>
                  <th className="text-right p-3 text-sm font-medium w-[80px]">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks && (tasks as any[]).map((task: any) => (
                  <tr key={task.id} className="border-b hover:bg-muted/30">
                    <td className="p-3">
                      <p className="text-sm font-medium">{task.title}</p>
                      {task.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>}
                    </td>
                    <td className="p-3">
                      <Select value={task.status} onValueChange={v => handleMoveTask(task.id, v)}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BOARD_COLUMNS.map(col => (
                            <SelectItem key={col.status} value={col.status}>{col.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={`text-xs ${PRIORITY_CONFIG[task.priority]?.color || ""}`}>
                        {PRIORITY_CONFIG[task.priority]?.label || task.priority}
                      </Badge>
                    </td>
                    <td className="p-3">
                      {task.taskType && TASK_TYPES[task.taskType] && (
                        <Badge variant="outline" className={`text-xs ${TASK_TYPES[task.taskType].color}`}>
                          {TASK_TYPES[task.taskType].label}
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-sm">{task.assignee || "—"}</td>
                    <td className="p-3 text-sm text-muted-foreground">{task.dueDate || "—"}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => {
                        if (confirm("删除此任务？")) deleteTask.mutate({ taskId: task.id });
                      }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Stats View */}
      {viewMode === "stats" && (
        <div className="grid grid-cols-2 gap-4">
          {/* Status Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">任务状态分布</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {statusPieData.map((_entry, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-4 mt-2">
                {BOARD_COLUMNS.map((col, i) => (
                  <div key={col.status} className="flex items-center gap-1 text-xs">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: PIE_COLORS[i] }} />
                    <span>{col.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Assignee Workload */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">成员工作量</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={assigneeBarData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={60} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="todo" name="待处理" stackId="a" fill="#94a3b8" />
                  <Bar dataKey="in_progress" name="进行中" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="review" name="待审核" stackId="a" fill="#f59e0b" />
                  <Bar dataKey="done" name="已完成" stackId="a" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          <Card className="col-span-2">
            <CardContent className="pt-4">
              <div className="grid grid-cols-4 gap-4">
                {BOARD_COLUMNS.map(col => {
                  const count = tasksByStatus[col.status]?.length || 0;
                  const total = tasks?.length || 1;
                  const pct = ((count / total) * 100).toFixed(0);
                  return (
                    <div key={col.status} className={`rounded-lg border p-4 ${col.color}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{col.label}</span>
                        <Badge className={col.badgeColor}>{count}</Badge>
                      </div>
                      <div className="w-full bg-white/50 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-current opacity-60"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{pct}% 占比</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Task Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>新建团队任务</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>任务标题 *</Label>
              <Input value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))} placeholder="输入任务标题" />
            </div>
            <div>
              <Label>任务描述</Label>
              <Textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} placeholder="详细描述任务内容" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>负责人</Label>
                <Input value={createForm.assignee} onChange={e => setCreateForm(f => ({ ...f, assignee: e.target.value }))} placeholder="负责人姓名" />
              </div>
              <div>
                <Label>截止日期</Label>
                <Input type="date" value={createForm.dueDate} onChange={e => setCreateForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>优先级</Label>
                <Select value={createForm.priority} onValueChange={v => setCreateForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>任务类型</Label>
                <Select value={createForm.taskType} onValueChange={v => setCreateForm(f => ({ ...f, taskType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TASK_TYPES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button disabled={!createForm.title || createTask.isPending} onClick={() => createTask.mutate({
              productProfileId: productId,
              title: createForm.title,
              description: createForm.description || undefined,
              assigneeName: createForm.assignee || undefined,
              category: createForm.taskType,
              priority: createForm.priority as "urgent" | "high" | "medium" | "low",
              dueDate: createForm.dueDate || undefined,
            })}>
              {createTask.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              创建任务
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
