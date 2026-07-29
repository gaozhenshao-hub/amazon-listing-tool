import { useState, useMemo, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Play,
  Loader2,
  ChevronRight,
  Sparkles,
  Tag,
  Zap,
  Plus,
  Pencil,
  Trash2,
  Download,
  Upload,
  BrainCircuit,
  Copy,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { useAuth } from "@/_core/hooks/useAuth";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SkillRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: string;
  callCount: number;
  modelOverride: string | null;
  isSystem: number;
  riskTier: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

interface RunResult {
  runId: string;
  content: string;
  status: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

interface SkillFormData {
  slug: string;
  name: string;
  description: string;
  category: string;
  systemPrompt: string;
  userPromptTemplate: string;
  modelOverride: string;
  status: "Draft" | "Validated" | "Approved" | "Released" | "Deprecated";
}

const EMPTY_FORM: SkillFormData = {
  slug: "",
  name: "",
  description: "",
  category: "通用",
  systemPrompt: "",
  userPromptTemplate: "{{context}}",
  modelOverride: "",
  status: "Draft",
};

// ─── Category color map ───────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  "Listing优化": "bg-blue-500/10 text-blue-600 border-blue-200",
  "广告优化": "bg-orange-500/10 text-orange-600 border-orange-200",
  "竞品分析": "bg-purple-500/10 text-purple-600 border-purple-200",
  "关键词": "bg-green-500/10 text-green-600 border-green-200",
  "运营策略": "bg-indigo-500/10 text-indigo-600 border-indigo-200",
  "产品开发": "bg-pink-500/10 text-pink-600 border-pink-200",
  "数据分析": "bg-cyan-500/10 text-cyan-600 border-cyan-200",
  "客服售后": "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  "内容创作": "bg-rose-500/10 text-rose-600 border-rose-200",
  "通用": "bg-gray-500/10 text-gray-600 border-gray-200",
};

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  Validated: "bg-blue-100 text-blue-700",
  Approved: "bg-indigo-100 text-indigo-700",
  Released: "bg-green-100 text-green-700",
  Deprecated: "bg-red-100 text-red-600",
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || "bg-gray-500/10 text-gray-600 border-gray-200";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\u4e00-\u9fa5]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || `skill-${Date.now()}`;
}

// ─── Skill Form Dialog ────────────────────────────────────────────────────────
function SkillFormDialog({
  open,
  onOpenChange,
  initialData,
  categories,
  models,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialData?: SkillRow & { manifest?: any };
  categories: string[];
  models: Array<{ slug: string; displayName: string; provider: string }>;
  onSaved: () => void;
}) {
  const isEdit = !!initialData;
  const [form, setForm] = useState<SkillFormData>(EMPTY_FORM);
  const [activeTab, setActiveTab] = useState<"basic" | "prompt" | "model">("basic");

  useEffect(() => {
    if (open) {
      if (initialData) {
        const manifest = initialData.manifest || {};
        setForm({
          slug: initialData.slug,
          name: initialData.name,
          description: initialData.description || "",
          category: initialData.category || "通用",
          systemPrompt: manifest?.implementation?.systemPrompt || "",
          userPromptTemplate: manifest?.implementation?.userPromptTemplate || "{{context}}",
          modelOverride: initialData.modelOverride || "",
          status: (initialData.status as SkillFormData["status"]) || "Draft",
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setActiveTab("basic");
    }
  }, [open, initialData]);

  const createMutation = trpc.emperor.skills.create.useMutation({
    onSuccess: () => { toast.success("Skill 已创建"); onSaved(); onOpenChange(false); },
    onError: (e) => toast.error("创建失败: " + e.message),
  });
  const updateMutation = trpc.emperor.skills.update.useMutation({
    onSuccess: () => { toast.success("Skill 已更新"); onSaved(); onOpenChange(false); },
    onError: (e) => toast.error("更新失败: " + e.message),
  });

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("请填写 Skill 名称"); return; }
    const slug = isEdit ? form.slug : (form.slug || slugify(form.name));
    if (isEdit) {
      updateMutation.mutate({
        slug,
        name: form.name,
        description: form.description,
        category: form.category,
        systemPrompt: form.systemPrompt,
        userPromptTemplate: form.userPromptTemplate,
        modelOverride: form.modelOverride || null,
        status: form.status,
      });
    } else {
      createMutation.mutate({
        slug,
        name: form.name,
        description: form.description,
        category: form.category,
        systemPrompt: form.systemPrompt,
        userPromptTemplate: form.userPromptTemplate,
        modelOverride: form.modelOverride || null,
        status: form.status,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const tabs = [
    { id: "basic", label: "基本信息" },
    { id: "prompt", label: "Prompt 配置" },
    { id: "model", label: "模型配置" },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑 Skill" : "新建 Skill"}</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b mb-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                activeTab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "basic" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Skill 名称 *</label>
                <Input
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({ ...f, name, slug: isEdit ? f.slug : slugify(name) }));
                  }}
                  placeholder="例如：竞品标题分析"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Slug（唯一标识）</label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="自动生成"
                  disabled={isEdit}
                  className={isEdit ? "opacity-60" : ""}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">描述</label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="简要描述该 Skill 的功能和适用场景..."
                className="resize-none min-h-[80px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">分类</label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set(["通用", "Listing优化", "广告优化", "竞品分析", "关键词", "运营策略", "产品开发", "数据分析", "客服售后", "内容创作", ...categories])].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">状态</label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as SkillFormData["status"] }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Draft">Draft（草稿）</SelectItem>
                    <SelectItem value="Validated">Validated（已验证）</SelectItem>
                    <SelectItem value="Approved">Approved（已审批）</SelectItem>
                    <SelectItem value="Released">Released（已发布）</SelectItem>
                    <SelectItem value="Deprecated">Deprecated（已废弃）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {activeTab === "prompt" && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                System Prompt
                <span className="ml-2 text-muted-foreground/60">（定义 AI 的角色和行为准则）</span>
              </label>
              <Textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="你是一位专业的亚马逊运营专家..."
                className="resize-none min-h-[150px] font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                User Prompt 模板
                <span className="ml-2 text-muted-foreground/60">（使用 {"{{context}}"} {"{{emphasis}}"} 等变量）</span>
              </label>
              <Textarea
                value={form.userPromptTemplate}
                onChange={(e) => setForm((f) => ({ ...f, userPromptTemplate: e.target.value }))}
                placeholder="请分析以下内容：\n\n{{context}}\n\n重点关注：{{emphasis}}"
                className="resize-none min-h-[150px] font-mono text-xs"
              />
            </div>
          </div>
        )}

        {activeTab === "model" && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                模型覆盖
                <span className="ml-2 text-muted-foreground/60">（留空则使用系统默认模型）</span>
              </label>
              <Select value={form.modelOverride || "__default__"} onValueChange={(v) => setForm((f) => ({ ...f, modelOverride: v === "__default__" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">默认模型（系统配置）</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.slug} value={m.slug}>
                      {m.displayName || m.slug} ({m.provider})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium mb-1">模型优先级说明：</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>运行时手动指定的模型（最高优先级）</li>
                <li>此处配置的 Skill 专属模型</li>
                <li>Manifest 中定义的 modelPolicy</li>
                <li>系统默认模型（最低优先级）</li>
              </ol>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "保存更改" : "创建 Skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EmperorSkillLibrary() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSkill, setSelectedSkill] = useState<SkillRow | null>(null);
  const [context, setContext] = useState("");
  const [emphasis, setEmphasis] = useState("");
  const [modelOverride, setModelOverride] = useState<string>("default");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  // CRUD state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingSkill, setEditingSkill] = useState<(SkillRow & { manifest?: any }) | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const utils = trpc.useUtils();

  // Fetch skills
  const { data: skillsData, isLoading: skillsLoading } = trpc.emperor.skills.list.useQuery({
    category: selectedCategory === "all" ? "" : (selectedCategory || ""),
    search: searchQuery || "",
    page: 1,
    pageSize: 500,
  });

  // Fetch categories
  const { data: categoriesData } = trpc.emperor.skills.categories.useQuery();

  // Fetch model providers
  const { data: modelsData } = trpc.emperor.models.list.useQuery();

  // Fetch skill detail for edit
  const { data: skillDetail } = trpc.emperor.skills.get.useQuery(
    { slug: editingSkill?.slug || "" },
    { enabled: !!editingSkill }
  );

  // Run skill mutation
  const runMutation = trpc.emperor.run.run.useMutation({
    onSuccess: (data) => {
      setRunResult(data as RunResult);
      setIsRunning(false);
    },
    onError: (err: any) => {
      setRunResult({
        runId: "",
        content: "",
        status: "error",
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        error: err.message,
      });
      setIsRunning(false);
      toast.error("运行失败: " + err.message);
    },
  });

  // Delete mutation
  const deleteMutation = trpc.emperor.skills.delete.useMutation({
    onSuccess: () => {
      toast.success("Skill 已删除");
      setDeletingSlug(null);
      if (selectedSkill?.slug === deletingSlug) setSelectedSkill(null);
      utils.emperor.skills.list.invalidate();
      utils.emperor.skills.categories.invalidate();
    },
    onError: (e) => toast.error("删除失败: " + e.message),
  });

  const skills: SkillRow[] = useMemo(() => {
    return (skillsData?.skills || []) as SkillRow[];
  }, [skillsData]);

  const categories = useMemo(() => {
    if (categoriesData) {
      return (categoriesData as Array<{ category: string; count: number }>)
        .map((c) => c.category)
        .filter(Boolean);
    }
    const cats = new Set(skills.map((s) => s.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [categoriesData, skills]);

  const availableModels = useMemo(() => {
    const providers = (modelsData || []) as Array<{ isActive: number; slug: string; modelId: string; displayName: string; provider: string }>;
    const modelList: { value: string; label: string }[] = [
      { value: "default", label: "默认模型（Skill 配置）" },
    ];
    for (const p of providers) {
      if (p.isActive) {
        modelList.push({ value: p.modelId, label: `${p.displayName || p.modelId} (${p.provider})` });
      }
    }
    return modelList;
  }, [modelsData]);

  const handleRun = () => {
    if (!selectedSkill) return;
    setIsRunning(true);
    setRunResult(null);
    runMutation.mutate({
      skillSlug: selectedSkill.slug,
      context,
      emphasis,
      modelOverride: modelOverride === "default" ? undefined : modelOverride,
    });
  };

  const handleCopyOutput = () => {
    if (runResult?.content) {
      navigator.clipboard.writeText(runResult.content);
      toast.success("已复制到剪贴板");
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(skills, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `emperor-skills-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${skills.length} 个 Skill`);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          toast.success(`解析成功，共 ${Array.isArray(data) ? data.length : 1} 条记录（导入功能开发中）`);
        } catch {
          toast.error("JSON 解析失败");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Auto-scroll output
  useEffect(() => {
    if (runResult && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [runResult]);

  const handleEditSkill = (skill: SkillRow) => {
    setEditingSkill(skill);
  };

  useEffect(() => {
    if (skillDetail && editingSkill && skillDetail.slug === editingSkill.slug) {
      setEditingSkill(skillDetail as any);
    }
  }, [skillDetail]);

  const refreshSkills = () => {
    utils.emperor.skills.list.invalidate();
    utils.emperor.skills.categories.invalidate();
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* ── Left: Category tree ── */}
        <div className="w-[200px] flex-shrink-0 border-r bg-muted/30 flex flex-col">
          <div className="p-3 border-b">
            <div className="flex items-center gap-2 mb-1">
              <BrainCircuit className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Skill 库</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {skillsLoading ? "加载中..." : `${skillsData?.total ?? skills.length} 个技能`}
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              <button
                onClick={() => setSelectedCategory("all")}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  selectedCategory === "all"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "hover:bg-accent text-muted-foreground hover:text-foreground"
                )}
              >
                全部分类
                <span className="float-right text-xs opacity-60">{skillsData?.total ?? skills.length}</span>
              </button>
              {categories.map((cat) => {
                const catData = (categoriesData as Array<{ category: string; count: number }> | undefined)?.find((c) => c.category === cat);
                const count = catData?.count ?? skills.filter((s) => s.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                      selectedCategory === cat
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-accent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className="truncate block pr-6">{cat}</span>
                    <span className="float-right text-xs opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* ── Middle: Skill card list ── */}
        <div className="flex-1 flex flex-col min-w-0 border-r">
          {/* Toolbar */}
          <div className="p-3 border-b bg-background space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索 Skill 名称或描述..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 gap-1.5 h-8 text-xs" onClick={() => setShowCreateDialog(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  新建 Skill
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={handleExport} title="导出 JSON">
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={handleImport} title="导入 JSON">
                  <Upload className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={refreshSkills} title="刷新">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Skill list */}
          <ScrollArea className="flex-1">
            {skillsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : skills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Sparkles className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">暂无匹配的 Skill</p>
                {isAdmin && (
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowCreateDialog(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    新建第一个 Skill
                  </Button>
                )}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {skills.map((skill) => (
                  <div
                    key={skill.id}
                    className={cn(
                      "group relative p-3 rounded-lg border transition-all hover:shadow-sm cursor-pointer",
                      selectedSkill?.id === skill.id
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-transparent hover:border-border hover:bg-accent/50"
                    )}
                    onClick={() => {
                      setSelectedSkill(skill);
                      setRunResult(null);
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate">{skill.name}</span>
                          {selectedSkill?.id === skill.id && (
                            <ChevronRight className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {skill.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge
                            variant="outline"
                            className={cn("text-xs px-1.5 py-0 border", getCategoryColor(skill.category))}
                          >
                            {skill.category}
                          </Badge>
                          <span className={cn("text-xs px-1.5 py-0.5 rounded-full", STATUS_COLORS[skill.status] || "bg-gray-100 text-gray-600")}>
                            {skill.status}
                          </span>
                          {skill.callCount > 0 && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              {skill.callCount}次
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Admin actions */}
                    {isAdmin && (
                      <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1">
                        <button
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); handleEditSkill(skill); }}
                          title="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"
                          onClick={(e) => { e.stopPropagation(); setDeletingSlug(skill.slug); }}
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* ── Right: Run panel ── */}
        <div className="w-[480px] flex-shrink-0 flex flex-col bg-background">
          {selectedSkill ? (
            <>
              {/* Skill header */}
              <div className="p-4 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base leading-tight mb-1">{selectedSkill.name}</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">{selectedSkill.description}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant="outline"
                      className={cn("text-xs border", getCategoryColor(selectedSkill.category))}
                    >
                      {selectedSkill.category}
                    </Badge>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleEditSkill(selectedSkill)}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        编辑
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="font-mono opacity-60">{selectedSkill.slug}</span>
                  <span className={cn("px-1.5 py-0.5 rounded-full", STATUS_COLORS[selectedSkill.status] || "bg-gray-100 text-gray-600")}>
                    {selectedSkill.status}
                  </span>
                  {selectedSkill.callCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {selectedSkill.callCount} 次调用
                    </span>
                  )}
                </div>
              </div>

              {/* Input area */}
              <div className="p-4 border-b space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    上下文内容 <span className="text-muted-foreground/60">（粘贴需要分析的文本、数据等）</span>
                  </label>
                  <Textarea
                    placeholder="粘贴 Listing 文案、广告数据、竞品信息等..."
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    className="min-h-[100px] text-sm resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    重点强调 <span className="text-muted-foreground/60">（可选，补充特殊要求）</span>
                  </label>
                  <Input
                    placeholder="例如：重点关注价格竞争力..."
                    value={emphasis}
                    onChange={(e) => setEmphasis(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">模型选择</label>
                  <Select value={modelOverride} onValueChange={setModelOverride}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m.value} value={m.value} className="text-sm">
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleRun}
                  disabled={isRunning}
                  className="w-full gap-2"
                  size="sm"
                >
                  {isRunning ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />运行中...</>
                  ) : (
                    <><Play className="h-4 w-4" />运行 Skill</>
                  )}
                </Button>
              </div>

              {/* Output area */}
              <div className="flex-1 flex flex-col min-h-0">
                {runResult ? (
                  <>
                    <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                      <div className="flex items-center gap-2">
                        {runResult.status === "completed" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <span className="text-xs font-medium">
                          {runResult.status === "completed" ? "运行成功" : "运行失败"}
                        </span>
                        {runResult.durationMs > 0 && (
                          <span className="text-xs text-muted-foreground">{(runResult.durationMs / 1000).toFixed(1)}s</span>
                        )}
                        {runResult.inputTokens > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {runResult.inputTokens + runResult.outputTokens} tokens
                          </span>
                        )}
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleCopyOutput}>
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        复制
                      </Button>
                    </div>
                    <div ref={outputRef} className="flex-1 overflow-y-auto p-4">
                      {runResult.error ? (
                        <div className="text-sm text-red-500 bg-red-50 rounded-lg p-3">
                          {runResult.error}
                        </div>
                      ) : (
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <Streamdown>{runResult.content}</Streamdown>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">填写输入内容后点击运行</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <BrainCircuit className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">选择一个 Skill 开始运行</p>
                <p className="text-xs mt-1 opacity-60">从左侧列表选择要运行的 AI 技能</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <SkillFormDialog
        open={showCreateDialog || !!editingSkill}
        onOpenChange={(v) => {
          if (!v) { setShowCreateDialog(false); setEditingSkill(null); }
        }}
        initialData={editingSkill || undefined}
        categories={categories}
        models={(modelsData || []) as Array<{ slug: string; displayName: string; provider: string }>}
        onSaved={refreshSkills}
      />

      {/* Delete Confirm */}
      <AlertDialog open={!!deletingSlug} onOpenChange={(v) => !v && setDeletingSlug(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除 Skill？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销。删除后，该 Skill 的所有配置将永久丢失，但历史运行记录将保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletingSlug && deleteMutation.mutate({ slug: deletingSlug })}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
