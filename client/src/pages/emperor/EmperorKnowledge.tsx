import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Brain,
  Loader2,
  MessageSquare,
  BookOpen,
  FolderOpen,
  Link,
  Tag,
  Calendar,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
type MemoryType = "feedback" | "fact" | "project" | "reference";

interface KnowledgeItem {
  id: number;
  user_id: number;
  project_id: string | null;
  title: string;
  content: string;
  memory_type: MemoryType;
  source: string | null;
  tags: string[];
  is_active: boolean;
  confidence: number;
  created_at: number;
  updated_at: number;
}

interface KnowledgeFormData {
  title: string;
  content: string;
  memoryType: MemoryType;
  source: string;
  tagsInput: string;
  confidence: number;
}

const EMPTY_FORM: KnowledgeFormData = {
  title: "",
  content: "",
  memoryType: "fact",
  source: "",
  tagsInput: "",
  confidence: 1.0,
};

// ─── Memory type config ────────────────────────────────────────────────────────
const MEMORY_TYPES: Record<MemoryType, {
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}> = {
  feedback: {
    label: "反馈记忆",
    icon: MessageSquare,
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
    description: "用户反馈、错误修正、偏好学习",
  },
  fact: {
    label: "事实知识",
    icon: BookOpen,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    description: "产品规格、市场数据、行业知识",
  },
  project: {
    label: "项目记忆",
    icon: FolderOpen,
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    description: "项目上下文、决策记录、进度状态",
  },
  reference: {
    label: "参考资料",
    icon: Link,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    description: "外部链接、文档索引、案例参考",
  },
};

// ─── Knowledge Form Dialog ─────────────────────────────────────────────────────
function KnowledgeFormDialog({
  open,
  onOpenChange,
  initialData,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialData?: KnowledgeItem;
  onSaved: () => void;
}) {
  const isEdit = !!initialData;
  const [form, setForm] = useState<KnowledgeFormData>(EMPTY_FORM);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          title: initialData.title,
          content: initialData.content,
          memoryType: initialData.memory_type,
          source: initialData.source || "",
          tagsInput: (initialData.tags || []).join(", "),
          confidence: initialData.confidence ?? 1.0,
        });
      } else {
        setForm(EMPTY_FORM);
      }
    }
  }, [open, initialData]);

  const upsertMutation = trpc.emperor.knowledge.upsert.useMutation({
    onSuccess: () => {
      toast.success(isEdit ? "记忆已更新" : "记忆已创建");
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => toast.error("操作失败: " + e.message),
  });

  const handleSave = () => {
    if (!form.title.trim()) { toast.error("请填写标题"); return; }
    if (!form.content.trim()) { toast.error("请填写内容"); return; }
    const tags = form.tagsInput.split(/[,，\n]+/).map((t) => t.trim()).filter(Boolean);
    upsertMutation.mutate({
      id: initialData?.id,
      title: form.title,
      content: form.content,
      memoryType: form.memoryType,
      source: form.source || undefined,
      tags,
      confidence: form.confidence,
    });
  };

  const typeConfig = MEMORY_TYPES[form.memoryType];
  const TypeIcon = typeConfig.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {isEdit ? "编辑记忆条目" : "新建记忆条目"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Memory Type Selector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">记忆类型</label>
            <div className="grid grid-cols-4 gap-2">
              {(Object.entries(MEMORY_TYPES) as [MemoryType, typeof MEMORY_TYPES[MemoryType]][]).map(([type, cfg]) => {
                const Icon = cfg.icon;
                const isSelected = form.memoryType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setForm((f) => ({ ...f, memoryType: type }))}
                    className={cn(
                      "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center",
                      isSelected
                        ? `${cfg.bgColor} ${cfg.borderColor} ${cfg.color}`
                        : "border-border hover:border-muted-foreground/30 text-muted-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs font-medium">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{typeConfig.description}</p>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">标题 *</label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="简洁描述这条记忆的核心内容..."
            />
          </div>

          {/* Content */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">内容 *</label>
            <Textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="详细描述记忆内容，AI 将在相关任务中自动引用..."
              className="resize-none min-h-[120px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Source */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                来源
                <span className="ml-1 text-muted-foreground/60">（URL / 文件名 / 对话 ID）</span>
              </label>
              <Input
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                placeholder="https://... 或文件名"
              />
            </div>

            {/* Confidence */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                置信度
                <span className="ml-1 text-muted-foreground/60">（0-1，越高越可信）</span>
              </label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={form.confidence}
                onChange={(e) => setForm((f) => ({ ...f, confidence: Number(e.target.value) }))}
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              标签
              <span className="ml-1 text-muted-foreground/60">（逗号分隔）</span>
            </label>
            <Input
              value={form.tagsInput}
              onChange={(e) => setForm((f) => ({ ...f, tagsInput: e.target.value }))}
              placeholder="亚马逊, Listing, 竞品分析"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "保存更改" : "创建记忆"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function EmperorKnowledge() {
  const [activeType, setActiveType] = useState<MemoryType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<KnowledgeItem | undefined>();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);

  const { data: statsData } = trpc.emperor.knowledge.stats.useQuery();
  const { data, isLoading, refetch } = trpc.emperor.knowledge.list.useQuery({
    memoryType: activeType === "all" ? undefined : activeType,
    search: searchQuery || undefined,
    page,
    pageSize: 20,
  });

  const deleteMutation = trpc.emperor.knowledge.delete.useMutation({
    onSuccess: () => {
      toast.success("记忆已删除");
      setDeleteId(null);
      setSelectedItem(null);
      refetch();
    },
    onError: (e) => toast.error("删除失败: " + e.message),
  });

  const items = data?.items || [];
  const total = data?.total || 0;

  const handleEdit = (item: KnowledgeItem) => {
    setEditItem(item);
    setFormOpen(true);
  };

  const handleNew = () => {
    setEditItem(undefined);
    setFormOpen(true);
  };

  const totalCount = statsData
    ? Object.values(statsData).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="border-b bg-background px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">记忆知识库</h1>
                <p className="text-xs text-muted-foreground">cc-haha 四分类记忆体系 · 共 {totalCount} 条记忆</p>
              </div>
            </div>
            <Button onClick={handleNew} size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              新建记忆
            </Button>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            {(Object.entries(MEMORY_TYPES) as [MemoryType, typeof MEMORY_TYPES[MemoryType]][]).map(([type, cfg]) => {
              const Icon = cfg.icon;
              const count = statsData?.[type] || 0;
              const isActive = activeType === type;
              return (
                <button
                  key={type}
                  onClick={() => { setActiveType(isActive ? "all" : type); setPage(1); }}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                    isActive
                      ? `${cfg.bgColor} ${cfg.borderColor}`
                      : "border-border hover:border-muted-foreground/30 bg-card"
                  )}
                >
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", cfg.bgColor)}>
                    <Icon className={cn("h-4 w-4", cfg.color)} />
                  </div>
                  <div>
                    <p className={cn("text-lg font-bold leading-none", isActive ? cfg.color : "")}>{count}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{cfg.label}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* List */}
          <div className="w-80 border-r flex flex-col">
            {/* Search */}
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                  placeholder="搜索记忆..."
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 p-2 border-b">
              <button
                onClick={() => { setActiveType("all"); setPage(1); }}
                className={cn(
                  "flex-1 py-1 text-xs rounded font-medium transition-colors",
                  activeType === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                全部 ({totalCount})
              </button>
              {(Object.entries(MEMORY_TYPES) as [MemoryType, typeof MEMORY_TYPES[MemoryType]][]).map(([type, cfg]) => (
                <button
                  key={type}
                  onClick={() => { setActiveType(type); setPage(1); }}
                  className={cn(
                    "flex-1 py-1 text-xs rounded font-medium transition-colors",
                    activeType === type ? `${cfg.bgColor} ${cfg.color}` : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {statsData?.[type] || 0}
                </button>
              ))}
            </div>

            {/* List items */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Brain className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">暂无记忆条目</p>
                  <button onClick={handleNew} className="text-xs text-primary mt-1 hover:underline">
                    新建第一条记忆
                  </button>
                </div>
              ) : (
                items.map((item) => {
                  const cfg = MEMORY_TYPES[item.memory_type as MemoryType] || MEMORY_TYPES.fact;
                  const Icon = cfg.icon;
                  const isSelected = selectedItem?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItem(item as KnowledgeItem)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors",
                        isSelected && "bg-muted"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded", cfg.bgColor)}>
                          <Icon className={cn("h-3 w-3", cfg.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{item.content}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <Badge variant="outline" className={cn("text-[10px] px-1 py-0", cfg.color, cfg.bgColor, cfg.borderColor)}>
                              {cfg.label}
                            </Badge>
                            {(item.tags || []).slice(0, 2).map((tag: string) => (
                              <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">{tag}</Badge>
                            ))}
                          </div>
                        </div>
                        <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1", isSelected && "text-primary")} />
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Pagination */}
            {total > 20 && (
              <div className="flex items-center justify-between p-2 border-t text-xs text-muted-foreground">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2 py-1 rounded hover:bg-muted disabled:opacity-40"
                >
                  上一页
                </button>
                <span>{page} / {Math.ceil(total / 20)}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= Math.ceil(total / 20)}
                  className="px-2 py-1 rounded hover:bg-muted disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="flex-1 overflow-y-auto">
            {selectedItem ? (
              <div className="p-6 max-w-2xl">
                {/* Detail header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3">
                    {(() => {
                      const cfg = MEMORY_TYPES[selectedItem.memory_type as MemoryType] || MEMORY_TYPES.fact;
                      const Icon = cfg.icon;
                      return (
                        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", cfg.bgColor)}>
                          <Icon className={cn("h-5 w-5", cfg.color)} />
                        </div>
                      );
                    })()}
                    <div>
                      <h2 className="text-base font-semibold">{selectedItem.title}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        {(() => {
                          const cfg = MEMORY_TYPES[selectedItem.memory_type as MemoryType] || MEMORY_TYPES.fact;
                          return (
                            <Badge variant="outline" className={cn("text-xs", cfg.color, cfg.bgColor, cfg.borderColor)}>
                              {cfg.label}
                            </Badge>
                          );
                        })()}
                        <span className="text-xs text-muted-foreground">
                          置信度 {Math.round((selectedItem.confidence ?? 1) * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(selectedItem)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      编辑
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(selectedItem.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      删除
                    </Button>
                  </div>
                </div>

                {/* Content */}
                <div className="rounded-lg border bg-muted/30 p-4 mb-4">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{selectedItem.content}</p>
                </div>

                {/* Metadata */}
                <div className="space-y-3 text-sm">
                  {selectedItem.source && (
                    <div className="flex items-center gap-2">
                      <Link className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">来源：</span>
                      <span className="text-primary truncate">{selectedItem.source}</span>
                    </div>
                  )}
                  {(selectedItem.tags || []).length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">标签：</span>
                      {selectedItem.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4 shrink-0" />
                    <span>
                      创建于 {selectedItem.created_at ? new Date(selectedItem.created_at).toLocaleString() : "—"}
                      {selectedItem.updated_at !== selectedItem.created_at && (
                        <span className="ml-2">· 更新于 {new Date(selectedItem.updated_at).toLocaleString()}</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Brain className="h-16 w-16 mb-4 opacity-20" />
                <p className="text-base font-medium">选择一条记忆查看详情</p>
                <p className="text-sm mt-1">或点击「新建记忆」创建新的知识条目</p>
                <div className="mt-6 grid grid-cols-2 gap-3 max-w-sm">
                  {(Object.entries(MEMORY_TYPES) as [MemoryType, typeof MEMORY_TYPES[MemoryType]][]).map(([type, cfg]) => {
                    const Icon = cfg.icon;
                    return (
                      <div key={type} className={cn("flex items-start gap-2 p-3 rounded-lg border", cfg.bgColor, cfg.borderColor)}>
                        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", cfg.color)} />
                        <div>
                          <p className={cn("text-xs font-semibold", cfg.color)}>{cfg.label}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{cfg.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Form Dialog */}
      <KnowledgeFormDialog
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditItem(undefined);
        }}
        initialData={editItem}
        onSaved={() => {
          refetch();
          setEditItem(undefined);
        }}
      />

      {/* Delete Confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将软删除该记忆条目，AI 将不再引用它。确定要删除吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
