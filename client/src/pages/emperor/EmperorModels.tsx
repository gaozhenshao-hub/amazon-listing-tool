import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Cpu,
  Plus,
  Pencil,
  Trash2,
  Star,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";

interface ModelProvider {
  id: number;
  slug: string;
  name: string;
  provider: string;
  modelId: string;
  displayName: string;
  isDefault: number;
  isActive: number;
  capabilityTags: string | null;
  createdAt: string;
}

interface ModelFormData {
  slug: string;
  name: string;
  provider: "manus_builtin" | "openai" | "deepseek" | "anthropic" | "custom";
  modelId: string;
  displayName: string;
  baseUrl: string;
  apiKeyRef: string;
  isDefault: boolean;
  isActive: boolean;
  capabilityTags: string;
}

const EMPTY_FORM: ModelFormData = {
  slug: "",
  name: "",
  provider: "manus_builtin",
  modelId: "",
  displayName: "",
  baseUrl: "",
  apiKeyRef: "",
  isDefault: false,
  isActive: true,
  capabilityTags: "",
};

const PROVIDER_LABELS: Record<string, string> = {
  manus_builtin: "Manus 内置",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  custom: "自定义",
};

const PROVIDER_COLORS: Record<string, string> = {
  manus_builtin: "bg-purple-100 text-purple-700",
  openai: "bg-green-100 text-green-700",
  deepseek: "bg-blue-100 text-blue-700",
  anthropic: "bg-orange-100 text-orange-700",
  custom: "bg-gray-100 text-gray-700",
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[\s\u4e00-\u9fa5]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || `model-${Date.now()}`;
}

function ModelFormDialog({
  open, onOpenChange, initialData, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; initialData?: ModelProvider; onSaved: () => void;
}) {
  const isEdit = !!initialData;
  const [form, setForm] = useState<ModelFormData>(EMPTY_FORM);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          slug: initialData.slug,
          name: initialData.name,
          provider: initialData.provider as ModelFormData["provider"],
          modelId: initialData.modelId,
          displayName: initialData.displayName || "",
          baseUrl: "",
          apiKeyRef: "",
          isDefault: !!initialData.isDefault,
          isActive: !!initialData.isActive,
          capabilityTags: initialData.capabilityTags ? JSON.parse(initialData.capabilityTags).join(", ") : "",
        });
      } else {
        setForm(EMPTY_FORM);
      }
    }
  }, [open, initialData]);

  const upsertMutation = trpc.emperor.models.upsert.useMutation({
    onSuccess: () => { toast.success(isEdit ? "模型已更新" : "模型已添加"); onSaved(); onOpenChange(false); },
    onError: (e) => toast.error("保存失败: " + e.message),
  });

  const handleSave = () => {
    if (!form.name.trim() || !form.modelId.trim()) { toast.error("请填写模型名称和 Model ID"); return; }
    const slug = isEdit ? form.slug : (form.slug || slugify(form.name));
    const tags = form.capabilityTags ? form.capabilityTags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    upsertMutation.mutate({ slug, name: form.name, provider: form.provider, modelId: form.modelId, displayName: form.displayName || undefined, baseUrl: form.baseUrl || undefined, apiKeyRef: form.apiKeyRef || undefined, isDefault: form.isDefault, isActive: form.isActive, capabilityTags: tags });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "编辑模型提供商" : "添加模型提供商"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">显示名称 *</label>
              <Input value={form.name} onChange={(e) => { const name = e.target.value; setForm((f) => ({ ...f, name, slug: isEdit ? f.slug : slugify(name) })); }} placeholder="例如：GPT-4o" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Slug</label>
              <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="自动生成" disabled={isEdit} className={isEdit ? "opacity-60" : ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">提供商 *</label>
              <Select value={form.provider} onValueChange={(v) => setForm((f) => ({ ...f, provider: v as ModelFormData["provider"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PROVIDER_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Model ID *</label>
              <Input value={form.modelId} onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))} placeholder="例如：gpt-4o" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">别名（可选）</label>
            <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="例如：GPT-4o（最新）" />
          </div>
          {form.provider !== "manus_builtin" && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Base URL（可选）</label>
                <Input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">API Key（可选）</label>
                <div className="relative">
                  <Input type={showApiKey ? "text" : "password"} value={form.apiKeyRef} onChange={(e) => setForm((f) => ({ ...f, apiKeyRef: e.target.value }))} placeholder="sk-..." className="pr-10" />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowApiKey(!showApiKey)}>
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">能力标签（逗号分隔）</label>
            <Input value={form.capabilityTags} onChange={(e) => setForm((f) => ({ ...f, capabilityTags: e.target.value }))} placeholder="vision, function_call, long_context" />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} className="rounded" />
              <span className="text-sm">设为默认模型</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="rounded" />
              <span className="text-sm">启用</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "保存更改" : "添加模型"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function EmperorModels() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelProvider | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [testingSlug, setTestingSlug] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latencyMs?: number; error?: string }>>({});

  const { data: modelsData, isLoading } = trpc.emperor.models.list.useQuery();
  const models = (modelsData || []) as ModelProvider[];

  const deleteMutation = trpc.emperor.models.delete.useMutation({
    onSuccess: () => { toast.success("模型已删除"); setDeletingSlug(null); utils.emperor.models.list.invalidate(); },
    onError: (e) => toast.error("删除失败: " + e.message),
  });

  const testMutation = trpc.emperor.models.test.useMutation({
    onSuccess: (data, variables) => {
      setTestResults((prev) => ({ ...prev, [variables.slug]: data as any }));
      setTestingSlug(null);
      if ((data as any).success) toast.success(`测试成功，延迟 ${(data as any).latencyMs}ms`);
      else toast.error(`测试失败: ${(data as any).error}`);
    },
    onError: (e, variables) => {
      setTestResults((prev) => ({ ...prev, [variables.slug]: { success: false, error: e.message } }));
      setTestingSlug(null);
    },
  });

  const refresh = () => utils.emperor.models.list.invalidate();

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2"><Cpu className="h-5 w-5 text-primary" />模型路由配置</h1>
            <p className="text-sm text-muted-foreground mt-1">管理 AI 模型提供商，配置路由规则和默认模型</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4 mr-1.5" />刷新</Button>
            {isAdmin && <Button size="sm" onClick={() => { setEditingModel(null); setShowForm(true); }}><Plus className="h-4 w-4 mr-1.5" />添加模型</Button>}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : models.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Cpu className="h-12 w-12 mx-auto mb-3 opacity-20" /><p className="text-sm">暂无模型配置</p>
            {isAdmin && <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowForm(true)}><Plus className="h-3.5 w-3.5 mr-1" />添加第一个模型</Button>}
          </div>
        ) : (
          <div className="space-y-3">
            {models.map((model) => {
              const testResult = testResults[model.slug];
              const isTesting = testingSlug === model.slug;
              let tags: string[] = [];
              try { tags = model.capabilityTags ? JSON.parse(model.capabilityTags) : []; } catch {}
              return (
                <div key={model.id} className={cn("rounded-xl border bg-card p-4 transition-all", !model.isActive && "opacity-60")}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{model.displayName || model.name}</span>
                        {!!model.isDefault && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs"><Star className="h-3 w-3 mr-1" />默认</Badge>}
                        {!model.isActive && <Badge variant="outline" className="text-xs text-muted-foreground">已禁用</Badge>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span className={cn("px-1.5 py-0.5 rounded-full text-xs font-medium", PROVIDER_COLORS[model.provider] || "bg-gray-100 text-gray-700")}>{PROVIDER_LABELS[model.provider] || model.provider}</span>
                        <span className="font-mono">{model.modelId}</span>
                        {tags.map((t: string) => <span key={t} className="bg-muted px-1.5 py-0.5 rounded text-xs">{t}</span>)}
                      </div>
                      {testResult && (
                        <div className={cn("mt-2 text-xs flex items-center gap-1.5", testResult.success ? "text-green-600" : "text-red-500")}>
                          {testResult.success ? <><CheckCircle2 className="h-3.5 w-3.5" />测试成功，延迟 {testResult.latencyMs}ms</> : <><XCircle className="h-3.5 w-3.5" />测试失败：{testResult.error}</>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setTestingSlug(model.slug); testMutation.mutate({ slug: model.slug }); }} disabled={isTesting}>
                        {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                        <span className="ml-1.5">测试</span>
                      </Button>
                      {isAdmin && (
                        <>
                          <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => { setEditingModel(model); setShowForm(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="outline" className="h-8 px-2 hover:text-red-600 hover:border-red-300" onClick={() => setDeletingSlug(model.slug)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ModelFormDialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditingModel(null); }} initialData={editingModel || undefined} onSaved={refresh} />

      <AlertDialog open={!!deletingSlug} onOpenChange={(v) => !v && setDeletingSlug(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除模型？</AlertDialogTitle><AlertDialogDescription>此操作不可撤销。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deletingSlug && deleteMutation.mutate({ slug: deletingSlug })}>
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
