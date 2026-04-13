import { useState, useMemo, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, Loader2, ClipboardList, Mic, FileText,
  MoreHorizontal, Pencil, Trash2, CheckCircle, Clock,
  AlertTriangle, ArrowUpDown, Filter, Users, Tag,
  Sparkles, Upload, ChevronDown, ChevronRight, Calendar,
  ListTodo, LayoutGrid, BarChart3, Bell, AlarmClock, RefreshCw,
  BellRing, Settings2,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown, Check, Package, X } from "lucide-react";

// ─── Types ───
type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
type TaskPriority = "urgent" | "high" | "medium" | "low";

interface ExtractedTask {
  title: string;
  description: string;
  assigneeName: string | null;
  category: string;
  priority: TaskPriority;
  dueDate: string | null;
  estimatedHours: string | null;
  selected?: boolean;
}

// ─── Constants ───
const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; icon: any }> = {
  backlog: { label: "待规划", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", icon: Clock },
  todo: { label: "待办", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", icon: ListTodo },
  in_progress: { label: "进行中", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", icon: Loader2 },
  review: { label: "待审核", color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300", icon: Search },
  done: { label: "已完成", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300", icon: CheckCircle },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: "紧急", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  high: { label: "高", color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
  medium: { label: "中", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  low: { label: "低", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

const CATEGORY_OPTIONS = [
  "Listing优化", "广告调整", "库存管理", "图片更新",
  "竞品分析", "定价策略", "客服处理", "物流跟进",
  "数据分析", "其他",
];

const REMINDER_DAY_OPTIONS = [
  { value: 0, label: "当天" },
  { value: 1, label: "1天前" },
  { value: 2, label: "2天前" },
  { value: 3, label: "3天前" },
  { value: 5, label: "5天前" },
  { value: 7, label: "7天前" },
  { value: 14, label: "14天前" },
];

function parseReminderDays(raw: string | null | undefined): number[] {
  if (!raw) return [1, 3];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === "number")) return parsed;
  } catch {}
  return [1, 3];
}

// ─── Product Search Selector Component ───
type ProductOption = {
  id: number;
  parentAsin: string;
  title: string;
  chineseName: string | null;
  imageUrl?: string | null;
  marketplace?: string | null;
};

function ProductSearchSelector({ value, onChange, products }: {
  value: number | undefined;
  onChange: (id: number | undefined) => void;
  products: ProductOption[];
}) {
  const [open, setOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");

  // Use server-side search when keyword is entered
  const searchQuery = trpc.taskManagement.searchProducts.useQuery(
    { keyword: searchKeyword, limit: 20 },
    { enabled: searchKeyword.length >= 1 }
  );

  // Show search results when searching, otherwise show initial products list
  const displayProducts = searchKeyword.length >= 1
    ? (searchQuery.data ?? [])
    : products;

  const selectedProduct = products.find(p => p.id === value)
    || (searchQuery.data ?? []).find(p => p.id === value);

  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5">
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
        关联产品
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal h-9 text-sm"
          >
            {selectedProduct ? (
              <span className="flex items-center gap-2 truncate">
                {selectedProduct.imageUrl && (
                  <img src={selectedProduct.imageUrl} alt="" className="h-5 w-5 rounded object-cover flex-shrink-0" />
                )}
                <span className="truncate">
                  {selectedProduct.chineseName || selectedProduct.title}
                </span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 flex-shrink-0">
                  {selectedProduct.parentAsin}
                </Badge>
              </span>
            ) : (
              <span className="text-muted-foreground">搜索产品名称或ASIN...</span>
            )}
            <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="输入产品名称或父ASIN搜索..."
              value={searchKeyword}
              onValueChange={setSearchKeyword}
            />
            <CommandList>
              <CommandEmpty>
                {searchQuery.isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>搜索中...</span>
                  </div>
                ) : (
                  "未找到匹配的产品"
                )}
              </CommandEmpty>
              <CommandGroup>
                {/* "Not associated" option */}
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange(undefined);
                    setOpen(false);
                    setSearchKeyword("");
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${!value ? "opacity-100" : "opacity-0"}`} />
                  <span className="text-muted-foreground">不关联产品</span>
                </CommandItem>
                {displayProducts.map(p => (
                  <CommandItem
                    key={p.id}
                    value={`${p.parentAsin}-${p.id}`}
                    onSelect={() => {
                      onChange(p.id);
                      setOpen(false);
                      setSearchKeyword("");
                    }}
                  >
                    <Check className={`mr-2 h-4 w-4 ${value === p.id ? "opacity-100" : "opacity-0"}`} />
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {p.imageUrl && (
                        <img src={p.imageUrl} alt="" className="h-6 w-6 rounded object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{p.chineseName || p.title}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <span className="font-mono">{p.parentAsin}</span>
                          {p.marketplace && <span>· {p.marketplace}</span>}
                        </div>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedProduct && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
          {selectedProduct.imageUrl && (
            <img src={selectedProduct.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-foreground">{selectedProduct.chineseName || selectedProduct.title}</div>
            <div className="font-mono">{selectedProduct.parentAsin}{selectedProduct.marketplace ? ` · ${selectedProduct.marketplace}` : ""}</div>
          </div>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Reminder Days Selector Component ───
function ReminderDaysSelector({ selectedDays, onChange, enabled, onEnabledChange }: {
  selectedDays: number[];
  onChange: (days: number[]) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const toggleDay = (day: number) => {
    if (selectedDays.includes(day)) {
      onChange(selectedDays.filter(d => d !== day));
    } else {
      onChange([...selectedDays, day].sort((a, b) => a - b));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <BellRing className="h-3.5 w-3.5 text-muted-foreground" />
          提前提醒
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? "已开启" : "已关闭"}</span>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        </div>
      </div>
      {enabled && (
        <div className="flex flex-wrap gap-1.5">
          {REMINDER_DAY_OPTIONS.map(opt => {
            const isSelected = selectedDays.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleDay(opt.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-transparent hover:border-border hover:bg-accent"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
      {enabled && selectedDays.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          将在截止日期前 {selectedDays.sort((a, b) => a - b).map(d => d === 0 ? "当天" : `${d}天`).join("、")} 发送提醒通知
        </p>
      )}
    </div>
  );
}

// ─── Main Component ───
export default function OpsTaskManagement() {
  const [activeTab, setActiveTab] = useState("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMeetingDialog, setShowMeetingDialog] = useState(false);
  const [showExtractPreview, setShowExtractPreview] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [showReminderPanel, setShowReminderPanel] = useState(true);

  // ─── Data Queries ───
  const tasksQuery = trpc.taskManagement.listAllTasks.useQuery({
    assigneeName: filterAssignee !== "all" ? filterAssignee : undefined,
    category: filterCategory !== "all" ? filterCategory : undefined,
    status: filterStatus !== "all" ? filterStatus as TaskStatus : undefined,
    priority: filterPriority !== "all" ? filterPriority as TaskPriority : undefined,
    search: searchQuery || undefined,
    limit: 200,
  });

  const statsQuery = trpc.taskManagement.getTaskStats.useQuery();
  const assigneesQuery = trpc.taskManagement.getAssignees.useQuery();
  const categoriesQuery = trpc.taskManagement.getCategories.useQuery();
  const productsQuery = trpc.taskManagement.getProductsForAssignment.useQuery();
  const reminderSummary = trpc.taskManagement.getReminderSummary.useQuery();

  const utils = trpc.useUtils();

  // ─── Mutations ───
  const createTask = trpc.taskManagement.createGlobalTask.useMutation({
    onSuccess: () => {
      toast.success("任务创建成功");
      utils.taskManagement.listAllTasks.invalidate();
      utils.taskManagement.getTaskStats.invalidate();
      setShowCreateDialog(false);
    },
    onError: (err) => toast.error(`创建失败: ${err.message}`),
  });

  const updateTask = trpc.productOps.updateTeamTask.useMutation({
    onSuccess: () => {
      toast.success("任务已更新");
      utils.taskManagement.listAllTasks.invalidate();
      utils.taskManagement.getTaskStats.invalidate();
      setEditingTask(null);
    },
    onError: (err) => toast.error(`更新失败: ${err.message}`),
  });

  const deleteTask = trpc.productOps.deleteTeamTask.useMutation({
    onSuccess: () => {
      toast.success("任务已删除");
      utils.taskManagement.listAllTasks.invalidate();
      utils.taskManagement.getTaskStats.invalidate();
    },
    onError: (err) => toast.error(`删除失败: ${err.message}`),
  });

  const batchCreate = trpc.taskManagement.batchCreateTasks.useMutation({
    onSuccess: (data) => {
      toast.success(`成功创建 ${data.count} 个任务`);
      utils.taskManagement.listAllTasks.invalidate();
      utils.taskManagement.getTaskStats.invalidate();
      setShowExtractPreview(false);
    },
    onError: (err) => toast.error(`批量创建失败: ${err.message}`),
  });

  const triggerReminder = trpc.taskManagement.triggerReminderCheck.useMutation({
    onSuccess: (data) => {
      toast.success(`提醒检测完成：检查 ${data.checked} 个任务，发送 ${data.notified} 条通知`);
      utils.taskManagement.getReminderSummary.invalidate();
    },
    onError: (err) => toast.error(`检测失败: ${err.message}`),
  });

  // ─── Stats Cards ───
  const stats = statsQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            任务管理中心
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            跨产品任务管理，支持AI会议录音提取和团队协作
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => triggerReminder.mutate()}
                  disabled={triggerReminder.isPending}
                  className="relative"
                >
                  {triggerReminder.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <BellRing className="h-4 w-4" />
                  )}
                  {reminderSummary.data && reminderSummary.data.counts.overdue > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                      {reminderSummary.data.counts.overdue}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>手动触发提醒检测</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button variant="outline" onClick={() => setShowMeetingDialog(true)}>
            <Sparkles className="h-4 w-4 mr-1" />
            AI会议提取
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />
            新建任务
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatsCard label="全部任务" value={stats?.total ?? 0} icon={ClipboardList} />
        <StatsCard label="待办" value={stats?.byStatus?.todo ?? 0} icon={ListTodo} color="text-blue-600" />
        <StatsCard label="进行中" value={stats?.byStatus?.in_progress ?? 0} icon={Loader2} color="text-amber-600" />
        <StatsCard label="已完成" value={stats?.byStatus?.done ?? 0} icon={CheckCircle} color="text-green-600" />
        <StatsCard label="已逾期" value={stats?.overdue ?? 0} icon={AlertTriangle} color="text-red-600" />
      </div>

      {/* Reminder Alert Panel */}
      {reminderSummary.data && (reminderSummary.data.counts.overdue > 0 || reminderSummary.data.counts.dueSoon > 0) && (
        <ReminderAlertPanel
          data={reminderSummary.data}
          isOpen={showReminderPanel}
          onToggle={() => setShowReminderPanel(!showReminderPanel)}
          onTriggerCheck={() => triggerReminder.mutate()}
          isChecking={triggerReminder.isPending}
          onEditTask={setEditingTask}
        />
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="list" className="gap-1">
              <ListTodo className="h-4 w-4" /> 列表视图
            </TabsTrigger>
            <TabsTrigger value="kanban" className="gap-1">
              <LayoutGrid className="h-4 w-4" /> 看板视图
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-1">
              <BarChart3 className="h-4 w-4" /> 统计分析
            </TabsTrigger>
          </TabsList>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索任务..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-48"
              />
            </div>
            <Select value={filterAssignee} onValueChange={setFilterAssignee}>
              <SelectTrigger className="w-32">
                <Users className="h-3.5 w-3.5 mr-1" />
                <SelectValue placeholder="负责人" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部负责人</SelectItem>
                {(assigneesQuery.data || []).map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-32">
                <Tag className="h-3.5 w-3.5 mr-1" />
                <SelectValue placeholder="类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {CATEGORY_OPTIONS.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="优先级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部优先级</SelectItem>
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* List View */}
        <TabsContent value="list" className="mt-4">
          <TaskListView
            tasks={tasksQuery.data?.tasks ?? []}
            isLoading={tasksQuery.isLoading}
            onEdit={setEditingTask}
            onDelete={(id) => deleteTask.mutate({ taskId: id })}
            onStatusChange={(id, status) => updateTask.mutate({ taskId: id, status })}
          />
        </TabsContent>

        {/* Kanban View */}
        <TabsContent value="kanban" className="mt-4">
          <KanbanView
            tasks={tasksQuery.data?.tasks ?? []}
            isLoading={tasksQuery.isLoading}
            onEdit={setEditingTask}
            onStatusChange={(id, status) => updateTask.mutate({ taskId: id, status })}
          />
        </TabsContent>

        {/* Stats View */}
        <TabsContent value="stats" className="mt-4">
          <StatsView stats={stats} />
        </TabsContent>
      </Tabs>

      {/* Create Task Dialog */}
      <CreateTaskDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={(data) => createTask.mutate(data)}
        isLoading={createTask.isPending}
        products={productsQuery.data ?? []}
      />

      {/* Edit Task Dialog */}
      {editingTask && (
        <EditTaskDialog
          task={editingTask}
          open={!!editingTask}
          onOpenChange={(open) => !open && setEditingTask(null)}
          onUpdate={(data) => updateTask.mutate({ taskId: editingTask.id, ...data })}
          isLoading={updateTask.isPending}
        />
      )}

      {/* Meeting Extract Dialog */}
      <MeetingExtractDialog
        open={showMeetingDialog}
        onOpenChange={setShowMeetingDialog}
        onExtracted={(tasks, meetingId) => {
          setShowMeetingDialog(false);
          setShowExtractPreview(true);
        }}
      />

      {/* Extract Preview Dialog */}
      <ExtractPreviewDialog
        open={showExtractPreview}
        onOpenChange={setShowExtractPreview}
        onConfirm={(tasks, meetingId) => {
          batchCreate.mutate({
            tasks: tasks.filter((t: ExtractedTask) => t.selected !== false).map((t: ExtractedTask) => ({
              title: t.title,
              description: t.description,
              priority: t.priority,
              category: t.category,
              assigneeName: t.assigneeName ?? undefined,
              dueDate: t.dueDate ?? undefined,
              estimatedHours: t.estimatedHours ?? undefined,
            })),
            meetingRecordId: meetingId,
          });
        }}
        isLoading={batchCreate.isPending}
      />
    </div>
  );
}

// ─── Stats Card ───
function StatsCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: any; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-muted ${color || "text-foreground"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Task List View ───
function TaskListView({ tasks, isLoading, onEdit, onDelete, onStatusChange }: {
  tasks: any[];
  isLoading: boolean;
  onEdit: (task: any) => void;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: TaskStatus) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">暂无任务</p>
          <p className="text-sm text-muted-foreground mt-1">点击"新建任务"或"AI会议提取"来创建任务</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">任务</TableHead>
            <TableHead className="w-[100px]">状态</TableHead>
            <TableHead className="w-[80px]">优先级</TableHead>
            <TableHead className="w-[100px]">负责人</TableHead>
            <TableHead className="w-[100px]">类型</TableHead>
            <TableHead className="w-[100px]">截止日期</TableHead>
            <TableHead className="w-[60px]">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const statusCfg = STATUS_CONFIG[task.status as TaskStatus] || STATUS_CONFIG.todo;
            const priorityCfg = PRIORITY_CONFIG[task.priority as TaskPriority] || PRIORITY_CONFIG.medium;
            const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "done";

            return (
              <TableRow key={task.id} className={isOverdue ? "bg-red-50/50 dark:bg-red-950/20" : ""}>
                <TableCell>
                  <div>
                    <p className="font-medium text-sm">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{task.description}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={task.status}
                    onValueChange={(v) => onStatusChange(task.id, v as TaskStatus)}
                  >
                    <SelectTrigger className="h-7 text-xs border-0 p-0">
                      <Badge className={`${statusCfg.color} text-xs`}>{statusCfg.label}</Badge>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge className={`${priorityCfg.color} text-xs`}>{priorityCfg.label}</Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{task.assigneeName || "未分配"}</span>
                </TableCell>
                <TableCell>
                  {task.category && <Badge variant="outline" className="text-xs">{task.category}</Badge>}
                </TableCell>
                <TableCell>
                  <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                    {task.dueDate || "-"}
                    {isOverdue && " (逾期)"}
                  </span>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(task)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> 编辑
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("确定删除此任务？")) onDelete(task.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> 删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

// ─── Kanban View ───
function KanbanView({ tasks, isLoading, onEdit, onStatusChange }: {
  tasks: any[];
  isLoading: boolean;
  onEdit: (task: any) => void;
  onStatusChange: (id: number, status: TaskStatus) => void;
}) {
  const columns: TaskStatus[] = ["backlog", "todo", "in_progress", "review", "done"];

  if (isLoading) {
    return (
      <div className="grid grid-cols-5 gap-3">
        {columns.map(col => (
          <div key={col} className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-3 min-h-[400px]">
      {columns.map(status => {
        const cfg = STATUS_CONFIG[status];
        const columnTasks = tasks.filter(t => t.status === status);

        return (
          <div key={status} className="flex flex-col">
            <div className={`px-3 py-2 rounded-t-lg font-medium text-sm flex items-center justify-between ${cfg.color}`}>
              <span>{cfg.label}</span>
              <Badge variant="secondary" className="text-xs">{columnTasks.length}</Badge>
            </div>
            <div className="flex-1 bg-muted/30 rounded-b-lg p-2 space-y-2 min-h-[300px]">
              {columnTasks.map(task => {
                const priorityCfg = PRIORITY_CONFIG[task.priority as TaskPriority] || PRIORITY_CONFIG.medium;
                const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "done";

                return (
                  <Card
                    key={task.id}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${isOverdue ? "border-red-300 dark:border-red-800" : ""}`}
                    onClick={() => onEdit(task)}
                  >
                    <CardContent className="p-3 space-y-2">
                      <p className="text-sm font-medium line-clamp-2">{task.title}</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Badge className={`${priorityCfg.color} text-[10px] px-1.5 py-0`}>{priorityCfg.label}</Badge>
                        {task.category && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{task.category}</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{task.assigneeName || "未分配"}</span>
                        {task.dueDate && (
                          <span className={isOverdue ? "text-red-600" : ""}>
                            {task.dueDate}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stats View ───
function StatsView({ stats }: { stats: any }) {
  if (!stats) return <Skeleton className="h-64 w-full" />;

  const assigneeEntries = Object.entries(stats.byAssignee || {}) as [string, { total: number; done: number; overdue: number }][];
  const categoryEntries = Object.entries(stats.byCategory || {}) as [string, number][];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* By Assignee */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> 按负责人统计
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assigneeEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无数据</p>
          ) : (
            <div className="space-y-3">
              {assigneeEntries.map(([name, data]) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{data.total} 总计</Badge>
                    <Badge className="bg-green-100 text-green-700">{data.done} 完成</Badge>
                    {data.overdue > 0 && (
                      <Badge className="bg-red-100 text-red-700">{data.overdue} 逾期</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* By Category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" /> 按类型统计
          </CardTitle>
        </CardHeader>
        <CardContent>
          {categoryEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无数据</p>
          ) : (
            <div className="space-y-3">
              {categoryEntries.map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-sm">{cat}</span>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* By Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">按状态分布</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
              const count = stats.byStatus?.[status] ?? 0;
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              return (
                <div key={status} className="flex items-center gap-3">
                  <Badge className={`${cfg.color} w-16 justify-center text-xs`}>{cfg.label}</Badge>
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm w-12 text-right">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* By Priority */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">按优先级分布</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(PRIORITY_CONFIG).map(([priority, cfg]) => {
              const count = stats.byPriority?.[priority] ?? 0;
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              return (
                <div key={priority} className="flex items-center gap-3">
                  <Badge className={`${cfg.color} w-12 justify-center text-xs`}>{cfg.label}</Badge>
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm w-12 text-right">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Create Task Dialog ───
function CreateTaskDialog({ open, onOpenChange, onCreate, isLoading, products }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (data: any) => void;
  isLoading: boolean;
  products: { id: number; parentAsin: string; title: string; chineseName: string | null }[];
}) {
  const [form, setForm] = useState({
    title: "", description: "", status: "todo" as TaskStatus,
    priority: "medium" as TaskPriority, category: "",
    assigneeName: "", dueDate: "", estimatedHours: "",
    productProfileId: undefined as number | undefined,
    reminderEnabled: true,
    reminderDays: [1, 3] as number[],
  });

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error("请输入任务标题"); return; }
    onCreate({
      ...form,
      estimatedHours: form.estimatedHours || undefined,
      productProfileId: form.productProfileId || undefined,
      reminderEnabled: form.reminderEnabled ? 1 : 0,
      reminderDays: JSON.stringify(form.reminderDays),
    });
    setForm({
      title: "", description: "", status: "todo", priority: "medium",
      category: "", assigneeName: "", dueDate: "", estimatedHours: "",
      productProfileId: undefined, reminderEnabled: true, reminderDays: [1, 3],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>创建一个新的运营任务</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>任务标题 *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="输入任务标题" />
          </div>
          <div>
            <Label>详细描述</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="任务详情..." rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>优先级</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as TaskPriority }))}>
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
              <Select value={form.category || "none"} onValueChange={v => setForm(f => ({ ...f, category: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="选择类型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不选择</SelectItem>
                  {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>负责人</Label>
              <Input value={form.assigneeName} onChange={e => setForm(f => ({ ...f, assigneeName: e.target.value }))} placeholder="输入负责人姓名" />
            </div>
            <div>
              <Label>截止日期</Label>
              <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>预估工时（小时）</Label>
            <Input type="number" value={form.estimatedHours} onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))} placeholder="如 2.5" />
          </div>
          <ProductSearchSelector
            value={form.productProfileId}
            onChange={id => setForm(f => ({ ...f, productProfileId: id }))}
            products={products}
          />
          {/* Reminder Days Setting */}
          <ReminderDaysSelector
            selectedDays={form.reminderDays}
            onChange={days => setForm(f => ({ ...f, reminderDays: days }))}
            enabled={form.reminderEnabled}
            onEnabledChange={v => setForm(f => ({ ...f, reminderEnabled: v }))}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            创建任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Task Dialog ───
function EditTaskDialog({ task, open, onOpenChange, onUpdate, isLoading }: {
  task: any;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdate: (data: any) => void;
  isLoading: boolean;
}) {
  const productsQuery = trpc.taskManagement.getProductsForAssignment.useQuery();
  const [form, setForm] = useState({
    title: task.title || "",
    description: task.description || "",
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    category: task.category || "",
    assigneeName: task.assigneeName || "",
    dueDate: task.dueDate || "",
    estimatedHours: task.estimatedHours || "",
    actualHours: task.actualHours || "",
    productProfileId: task.productProfileId as number | undefined,
    reminderEnabled: task.reminderEnabled !== 0,
    reminderDays: parseReminderDays(task.reminderDays),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑任务</DialogTitle>
          <DialogDescription>修改任务信息</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>任务标题</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <Label>详细描述</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>状态</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as TaskStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>优先级</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as TaskPriority }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>类型</Label>
              <Select value={form.category || "none"} onValueChange={v => setForm(f => ({ ...f, category: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不选择</SelectItem>
                  {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>负责人</Label>
              <Input value={form.assigneeName} onChange={e => setForm(f => ({ ...f, assigneeName: e.target.value }))} />
            </div>
            <div>
              <Label>截止日期</Label>
              <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>预估工时</Label>
              <Input type="number" value={form.estimatedHours} onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))} />
            </div>
            <div>
              <Label>实际工时</Label>
              <Input type="number" value={form.actualHours} onChange={e => setForm(f => ({ ...f, actualHours: e.target.value }))} />
            </div>
          </div>
          {/* Product Selector */}
          <ProductSearchSelector
            value={form.productProfileId}
            onChange={id => setForm(f => ({ ...f, productProfileId: id }))}
            products={productsQuery.data ?? []}
          />
          {/* Reminder Days Setting */}
          <ReminderDaysSelector
            selectedDays={form.reminderDays}
            onChange={days => setForm(f => ({ ...f, reminderDays: days }))}
            enabled={form.reminderEnabled}
            onEnabledChange={v => setForm(f => ({ ...f, reminderEnabled: v }))}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => onUpdate({
            ...form,
            productProfileId: form.productProfileId || undefined,
            reminderEnabled: form.reminderEnabled ? 1 : 0,
            reminderDays: JSON.stringify(form.reminderDays),
          })} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Meeting Extract Dialog ───
function MeetingExtractDialog({ open, onOpenChange, onExtracted }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onExtracted: (tasks: ExtractedTask[], meetingId?: number) => void;
}) {
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [textInput, setTextInput] = useState("");
  const [title, setTitle] = useState("");
  const [extractedTasks, setExtractedTasks] = useState<ExtractedTask[]>([]);
  const [summary, setSummary] = useState("");
  const [meetingId, setMeetingId] = useState<number>();
  const [showPreview, setShowPreview] = useState(false);

  const extractFromText = trpc.taskManagement.extractTasksFromText.useMutation({
    onSuccess: (data) => {
      setExtractedTasks(data.tasks.map((t: any) => ({ ...t, selected: true })));
      setSummary(data.summary);
      setMeetingId(data.meetingId);
      setShowPreview(true);
      toast.success(`AI成功提取 ${data.tasks.length} 个任务`);
    },
    onError: (err) => toast.error(`提取失败: ${err.message}`),
  });

  const handleExtract = () => {
    if (!textInput.trim()) { toast.error("请输入会议内容"); return; }
    extractFromText.mutate({ text: textInput, title: title || undefined });
  };

  const handleConfirmBatch = () => {
    onExtracted(extractedTasks, meetingId);
  };

  const utils = trpc.useUtils();
  const batchCreate = trpc.taskManagement.batchCreateTasks.useMutation({
    onSuccess: (data) => {
      toast.success(`成功创建 ${data.count} 个任务`);
      utils.taskManagement.listAllTasks.invalidate();
      utils.taskManagement.getTaskStats.invalidate();
      utils.taskManagement.getAssignees.invalidate();
      utils.taskManagement.getCategories.invalidate();
      setShowPreview(false);
      setTextInput("");
      setTitle("");
      setExtractedTasks([]);
      onOpenChange(false);
    },
    onError: (err) => toast.error(`批量创建失败: ${err.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI会议任务提取
          </DialogTitle>
          <DialogDescription>
            粘贴会议记录文本，AI将自动提取任务、负责人、截止日期等信息
          </DialogDescription>
        </DialogHeader>

        {!showPreview ? (
          <div className="space-y-4">
            <div>
              <Label>会议标题（可选）</Label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="例如：周一运营例会"
              />
            </div>
            <div>
              <Label>会议内容 *</Label>
              <Textarea
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                placeholder={"粘贴会议记录、会议纪要或会议转录文本...\n\n示例：\n张三负责优化A产品的Listing标题，下周三前完成。\n李四跟进B产品的库存补货，本周五前确认物流方案。\n王五分析竞品C的广告策略，输出分析报告。"}
                rows={10}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {textInput.length} 字符 | 支持任意格式的会议记录文本
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button onClick={handleExtract} disabled={extractFromText.isPending || !textInput.trim()}>
                {extractFromText.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> AI提取中...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-1" /> 开始提取</>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            {summary && (
              <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                <CardContent className="p-3">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">会议摘要</p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">{summary}</p>
                </CardContent>
              </Card>
            )}

            {/* Extracted Tasks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">提取的任务 ({extractedTasks.filter(t => t.selected !== false).length}/{extractedTasks.length})</p>
                <Button variant="ghost" size="sm" onClick={() => setShowPreview(false)}>
                  返回编辑
                </Button>
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {extractedTasks.map((task, idx) => (
                  <Card key={idx} className={task.selected === false ? "opacity-50" : ""}>
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={task.selected !== false}
                          onCheckedChange={(checked) => {
                            setExtractedTasks(prev => prev.map((t, i) =>
                              i === idx ? { ...t, selected: !!checked } : t
                            ));
                          }}
                          className="mt-1"
                        />
                        <div className="flex-1 space-y-1">
                          <Input
                            value={task.title}
                            onChange={e => {
                              setExtractedTasks(prev => prev.map((t, i) =>
                                i === idx ? { ...t, title: e.target.value } : t
                              ));
                            }}
                            className="font-medium h-8 text-sm"
                          />
                          <Textarea
                            value={task.description}
                            onChange={e => {
                              setExtractedTasks(prev => prev.map((t, i) =>
                                i === idx ? { ...t, description: e.target.value } : t
                              ));
                            }}
                            className="text-xs min-h-[40px]"
                            rows={2}
                          />
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">负责人:</span>
                              <Input
                                value={task.assigneeName || ""}
                                onChange={e => {
                                  setExtractedTasks(prev => prev.map((t, i) =>
                                    i === idx ? { ...t, assigneeName: e.target.value || null } : t
                                  ));
                                }}
                                className="h-6 w-20 text-xs"
                                placeholder="未分配"
                              />
                            </div>
                            <Badge className={PRIORITY_CONFIG[task.priority]?.color || ""} >
                              {PRIORITY_CONFIG[task.priority]?.label || task.priority}
                            </Badge>
                            {task.category && <Badge variant="outline" className="text-xs">{task.category}</Badge>}
                            {task.dueDate && (
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                <Calendar className="h-3 w-3" /> {task.dueDate}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPreview(false)}>返回编辑</Button>
              <Button
                onClick={() => {
                  const selectedTasks = extractedTasks.filter(t => t.selected !== false);
                  if (selectedTasks.length === 0) { toast.error("请至少选择一个任务"); return; }
                  batchCreate.mutate({
                    tasks: selectedTasks.map(t => ({
                      title: t.title,
                      description: t.description,
                      priority: t.priority,
                      category: t.category,
                      assigneeName: t.assigneeName || undefined,
                      dueDate: t.dueDate || undefined,
                      estimatedHours: t.estimatedHours || undefined,
                    })),
                    meetingRecordId: meetingId,
                  });
                }}
                disabled={batchCreate.isPending}
              >
                {batchCreate.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> 创建中...</>
                ) : (
                  <><CheckCircle className="h-4 w-4 mr-1" /> 确认创建 {extractedTasks.filter(t => t.selected !== false).length} 个任务</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Reminder Alert Panel ───
function ReminderAlertPanel({ data, isOpen, onToggle, onTriggerCheck, isChecking, onEditTask }: {
  data: {
    overdue: { id: number; title: string; assigneeName: string | null; dueDate: string | null; priority: string; status: string; category: string | null; daysOverdue: number }[];
    dueSoon: { id: number; title: string; assigneeName: string | null; dueDate: string | null; priority: string; status: string; category: string | null; daysUntilDue: number }[];
    dueThisWeek: { id: number; title: string; assigneeName: string | null; dueDate: string | null; priority: string; status: string; category: string | null; daysUntilDue: number }[];
    counts: { overdue: number; dueSoon: number; dueThisWeek: number };
  };
  isOpen: boolean;
  onToggle: () => void;
  onTriggerCheck: () => void;
  isChecking: boolean;
  onEditTask: (task: any) => void;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <Card className={data.counts.overdue > 0 ? "border-red-300 dark:border-red-800" : "border-orange-300 dark:border-orange-800"}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-lg ${data.counts.overdue > 0 ? "bg-red-100 dark:bg-red-900" : "bg-orange-100 dark:bg-orange-900"}`}>
                  <AlarmClock className={`h-4 w-4 ${data.counts.overdue > 0 ? "text-red-600" : "text-orange-600"}`} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">任务提醒</span>
                  {data.counts.overdue > 0 && (
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs">
                      {data.counts.overdue} 已逾期
                    </Badge>
                  )}
                  {data.counts.dueSoon > 0 && (
                    <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 text-xs">
                      {data.counts.dueSoon} 即将到期
                    </Badge>
                  )}
                  {data.counts.dueThisWeek > 0 && (
                    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-xs">
                      {data.counts.dueThisWeek} 本周到期
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(e) => { e.stopPropagation(); onTriggerCheck(); }}
                  disabled={isChecking}
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${isChecking ? "animate-spin" : ""}`} />
                  检测并通知
                </Button>
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-4 space-y-3">
            {/* Overdue Tasks */}
            {data.overdue.length > 0 && (
              <div>
                <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> 已逾期任务
                </p>
                <div className="space-y-1">
                  {data.overdue.map(task => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between px-3 py-2 rounded-md bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 cursor-pointer transition-colors"
                      onClick={() => onEditTask(task)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge className={PRIORITY_CONFIG[task.priority as TaskPriority]?.color || ""} >
                          {PRIORITY_CONFIG[task.priority as TaskPriority]?.label || task.priority}
                        </Badge>
                        <span className="text-sm truncate">{task.title}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{task.assigneeName || "未分配"}</span>
                        <Badge variant="destructive" className="text-[10px]">逾期 {task.daysOverdue} 天</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Due Soon Tasks (within 3 days) */}
            {data.dueSoon.length > 0 && (
              <div>
                <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-1.5 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> 3天内到期
                </p>
                <div className="space-y-1">
                  {data.dueSoon.map(task => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between px-3 py-2 rounded-md bg-orange-50 dark:bg-orange-950/30 hover:bg-orange-100 dark:hover:bg-orange-950/50 cursor-pointer transition-colors"
                      onClick={() => onEditTask(task)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge className={PRIORITY_CONFIG[task.priority as TaskPriority]?.color || ""} >
                          {PRIORITY_CONFIG[task.priority as TaskPriority]?.label || task.priority}
                        </Badge>
                        <span className="text-sm truncate">{task.title}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{task.assigneeName || "未分配"}</span>
                        <Badge className="bg-orange-100 text-orange-700 text-[10px]">
                          {task.daysUntilDue === 0 ? "今天到期" : `${task.daysUntilDue} 天后到期`}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Due This Week Tasks (3-7 days) */}
            {data.dueThisWeek.length > 0 && (
              <div>
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1.5 flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> 本周内到期
                </p>
                <div className="space-y-1">
                  {data.dueThisWeek.map(task => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 cursor-pointer transition-colors"
                      onClick={() => onEditTask(task)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge className={PRIORITY_CONFIG[task.priority as TaskPriority]?.color || ""} >
                          {PRIORITY_CONFIG[task.priority as TaskPriority]?.label || task.priority}
                        </Badge>
                        <span className="text-sm truncate">{task.title}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{task.assigneeName || "未分配"}</span>
                        <Badge className="bg-blue-100 text-blue-700 text-[10px]">{task.daysUntilDue} 天后到期</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground pt-1">
              系统每小时自动检测任务到期情况并发送通知给负责人。点击"检测并通知"可手动触发。
            </p>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Extract Preview Dialog (placeholder, main logic in MeetingExtractDialog) ───
function ExtractPreviewDialog({ open, onOpenChange, onConfirm, isLoading }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (tasks: ExtractedTask[], meetingId?: number) => void;
  isLoading: boolean;
}) {
  // This dialog is now handled within MeetingExtractDialog
  return null;
}
