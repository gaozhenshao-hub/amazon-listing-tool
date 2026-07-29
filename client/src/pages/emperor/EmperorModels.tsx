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
  Loader2,
  Cpu,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Zap,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Provider {
  id: number;
  slug: string;
  name: string;
  provider: string;
  modelId: string;
  displayName: string;
  baseUrl: string;
  apiKeyRef: string;
  isDefault: boolean;
  isActive: boolean;
  capabilityTags: string[];
}

const PROVIDER_COLORS: Record<string, string> = {
  manus_builtin: "bg-purple-500/10 text-purple-600 border-purple-200",
  openai: "bg-green-500/10 text-green-600 border-green-200",
  anthropic: "bg-orange-500/10 text-orange-600 border-orange-200",
  deepseek: "bg-blue-500/10 text-blue-600 border-blue-200",
  custom: "bg-gray-500/10 text-gray-600 border-gray-200",
};

const PROVIDER_LABELS: Record<string, string> = {
  manus_builtin: "Manus 内置",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  custom: "自定义",
};

export default function EmperorModels() {
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<Provider>>({});
  const [testingSlug, setTestingSlug] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ slug: string; ok: boolean; msg: string } | null>(null);

  const { data, isLoading, refetch } = trpc.emperor.models.list.useQuery();
  const upsertMutation = trpc.emperor.models.upsert.useMutation({
    onSuccess: () => {
      toast.success("保存成功");
      setEditMode(false);
      refetch();
    },
    onError: (err: any) => toast.error("保存失败: " + err.message),
  });
  const deleteMutation = trpc.emperor.models.delete.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      setSelectedProvider(null);
      refetch();
    },
    onError: (err: any) => toast.error("删除失败: " + err.message),
  });
  const testMutation = trpc.emperor.models.test.useMutation({
    onSuccess: (res, vars) => {
      setTestResult({ slug: vars.slug, ok: res.success, msg: res.success ? `响应正常 (${res.latencyMs}ms): ${res.response}` : (res as any).error || "测试失败" });
      setTestingSlug(null);
      toast[res.success ? "success" : "error"](res.success ? "连通性正常" : "连通性异常");
    },
    onError: (err: any, vars) => {
      setTestResult({ slug: vars.slug, ok: false, msg: err.message });
      setTestingSlug(null);
    },
  });

  const providers: Provider[] = (data || []) as Provider[];

  const handleEdit = (p: Provider) => {
    setSelectedProvider(p);
    setEditData({ ...p });
    setEditMode(true);
  };

  const handleSave = () => {
    if (!selectedProvider) return;
    upsertMutation.mutate({
      slug: selectedProvider.slug,
      name: editData.name || selectedProvider.name,
      provider: (editData.provider as any) || selectedProvider.provider as any,
      modelId: editData.modelId || selectedProvider.modelId,
      displayName: editData.displayName,
      baseUrl: editData.baseUrl,
      apiKeyRef: editData.apiKeyRef,
      isDefault: editData.isDefault ?? selectedProvider.isDefault,
      isActive: editData.isActive ?? selectedProvider.isActive,
    });
  };

  const handleTest = (p: Provider) => {
    setTestingSlug(p.slug);
    setTestResult(null);
    testMutation.mutate({ slug: p.slug });
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* Left: Provider list */}
        <div className="w-[300px] flex-shrink-0 border-r flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm">模型提供商</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{providers.length} 个模型</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : providers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Cpu className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">暂无模型配置</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedProvider(p); setEditMode(false); }}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all",
                      selectedProvider?.id === p.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{p.displayName || p.name}</span>
                      <div className="flex items-center gap-1">
                        {p.isDefault && <Badge className="text-xs px-1 py-0 h-4 bg-amber-500/10 text-amber-600 border-amber-200">默认</Badge>}
                        {p.isActive ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{p.modelId}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="outline" className={cn("text-xs px-1.5 py-0", PROVIDER_COLORS[p.provider])}>
                        {PROVIDER_LABELS[p.provider] || p.provider}
                      </Badge>
                    </div>
                    {testResult?.slug === p.slug && (
                      <div className={cn(
                        "mt-2 text-xs px-2 py-1 rounded",
                        testResult.ok ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                      )}>
                        {testResult.msg}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right: Provider detail */}
        <div className="flex-1 flex flex-col min-w-0 p-6">
          {selectedProvider ? (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{selectedProvider.displayName || selectedProvider.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{selectedProvider.modelId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(selectedProvider)}
                    disabled={testingSlug === selectedProvider.slug}
                    className="gap-2"
                  >
                    {testingSlug === selectedProvider.slug ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    连通性测试
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteMutation.mutate({ slug: selectedProvider.slug })}
                    disabled={deleteMutation.isPending}
                    className="gap-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                  {!editMode && (
                    <Button size="sm" onClick={() => handleEdit(selectedProvider)}>
                      编辑配置
                    </Button>
                  )}
                </div>
              </div>

              {editMode ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">编辑配置</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">显示名称</label>
                        <Input
                          value={editData.displayName || ""}
                          onChange={(e) => setEditData(d => ({ ...d, displayName: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Model ID</label>
                        <Input
                          value={editData.modelId || ""}
                          onChange={(e) => setEditData(d => ({ ...d, modelId: e.target.value }))}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-sm font-medium mb-1.5 block">Base URL（可选）</label>
                        <Input
                          value={editData.baseUrl || ""}
                          onChange={(e) => setEditData(d => ({ ...d, baseUrl: e.target.value }))}
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-sm font-medium mb-1.5 block">API Key 引用（可选）</label>
                        <Input
                          value={editData.apiKeyRef || ""}
                          onChange={(e) => setEditData(d => ({ ...d, apiKeyRef: e.target.value }))}
                          placeholder="env:OPENAI_API_KEY"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">设为默认</p>
                        <p className="text-xs text-muted-foreground">未指定模型的 Skill 使用此模型</p>
                      </div>
                      <Switch
                        checked={editData.isDefault ?? false}
                        onCheckedChange={(v) => setEditData(d => ({ ...d, isDefault: v }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">启用</p>
                        <p className="text-xs text-muted-foreground">禁用后 Skill 无法选择此模型</p>
                      </div>
                      <Switch
                        checked={editData.isActive ?? true}
                        onCheckedChange={(v) => setEditData(d => ({ ...d, isActive: v }))}
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button onClick={handleSave} disabled={upsertMutation.isPending} className="gap-2">
                        {upsertMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                        保存
                      </Button>
                      <Button variant="outline" onClick={() => setEditMode(false)}>取消</Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">提供商</p>
                        <Badge variant="outline" className={cn("mt-1", PROVIDER_COLORS[selectedProvider.provider])}>
                          {PROVIDER_LABELS[selectedProvider.provider] || selectedProvider.provider}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">状态</p>
                        <p className="font-medium mt-1 flex items-center gap-2">
                          {selectedProvider.isActive ? (
                            <><CheckCircle2 className="h-4 w-4 text-green-500" /> 已启用</>
                          ) : (
                            <><XCircle className="h-4 w-4 text-muted-foreground" /> 已禁用</>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Model ID</p>
                        <p className="font-medium text-sm mt-1">{selectedProvider.modelId}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Slug</p>
                        <p className="font-medium text-sm mt-1">{selectedProvider.slug}</p>
                      </div>
                      {selectedProvider.baseUrl && (
                        <div className="col-span-2">
                          <p className="text-xs text-muted-foreground">Base URL</p>
                          <p className="font-medium text-sm mt-1 break-all">{selectedProvider.baseUrl}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Cpu className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm">从左侧选择一个模型提供商</p>
              <p className="text-xs mt-2 opacity-60">支持 Manus 内置、OpenAI、DeepSeek、Anthropic 等多种模型</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
