import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import {
  Brain, Plus, Activity, DollarSign, Zap, RefreshCw,
  Trash2, CheckCircle, XCircle, Clock, Eye, EyeOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts";
import { useAuth } from "@/_core/hooks/useAuth";

const PROVIDERS = ["OpenAI", "Anthropic", "Google", "Mistral", "DeepSeek", "Qwen", "Custom"];
const CAPABILITY_TAGS = ["chat", "vision", "code", "reasoning", "embedding", "function-call", "long-context"];

const defaultForm = {
  name: "", modelId: "", provider: "OpenAI",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  capabilityTags: [] as string[],
  costPer1kInputTokens: 0, costPer1kOutputTokens: 0,
  maxContextTokens: 128000,
  isDefault: false,
};

export default function EmperorModels() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || (user as any)?.role === "super_admin";
  const { data: models, isLoading, refetch } = trpc.emperor.models.list.useQuery();
  const { data: costStats } = trpc.emperor.models.getCostStats.useQuery({ days: 30 });
  const { data: auditLogs } = trpc.emperor.models.getAuditLogs.useQuery({ limit: 20 });

  const createMutation = trpc.emperor.models.create.useMutation({
    onSuccess: () => {
      toast.success("模型已添加");
      setShowCreateDialog(false);
      setForm(defaultForm);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.emperor.models.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const healthCheckMutation = trpc.emperor.models.healthCheck.useMutation({
    onSuccess: (data) => {
      if (data.status === "active") {
        toast.success(`健康检查通过，延迟 ${data.latencyMs}ms`);
      } else {
        toast.error(`健康检查失败：${data.error}`);
      }
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const testMutation = trpc.emperor.models.test.useMutation({
    onSuccess: (data: any) => {
      if (data.success) toast.success(`测试成功，延迟 ${data.latencyMs}ms`);
      else toast.error(`测试失败: ${data.error}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [showApiKey, setShowApiKey] = useState(false);
  const [activeTab, setActiveTab] = useState<"models" | "cost" | "logs">("models");

  const handleCreate = () => {
    if (!form.name || !form.modelId || !form.apiKey) {
      return toast.error("请填写模型名称、Model ID 和 API Key");
    }
    createMutation.mutate(form);
  };

  const toggleTag = (tag: string) => {
    const tags = form.capabilityTags;
    setForm({
      ...form,
      capabilityTags: tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
    });
  };

  const chartData = costStats?.daily ?? [];
  const totalCost = costStats?.totals?.totalCostUsd ?? 0;
  const totalCalls = costStats?.totals?.totalCalls ?? 0;
  const activeCount = (models as any[])?.filter((m: any) => m.isActive).length ?? 0;
  const totalCount = (models as any[])?.length ?? 0;

  return (
    <div className="flex flex-col h-full bg-[#080b11] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-6 border-b border-white/6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-2 bg-violet-500/15 border border-violet-500/20">
            <Brain className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">LLM 模型管理</h1>
            <p className="text-sm text-slate-500 mt-0.5">注册和管理大语言模型，配置路由策略、成本监控和降级方案</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-400 hover:text-white">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-violet-600 hover:bg-violet-500 text-white gap-2"
            >
              <Plus className="h-4 w-4" />
              添加模型
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 px-8 py-6 flex-shrink-0">
        {[
          { label: "已注册模型", value: totalCount, icon: Brain, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
          { label: "正常运行", value: activeCount, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
          { label: "本月调用", value: totalCalls, icon: Zap, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
          { label: "本月成本", value: `$${totalCost.toFixed(2)}`, icon: DollarSign, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-xl p-5 border ${stat.bg} bg-white/3`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500">{stat.label}</span>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="px-8 flex-shrink-0">
        <div className="flex gap-1 border-b border-white/6">
          {[
            { key: "models", label: "模型列表" },
            { key: "cost", label: "成本统计" },
            { key: "logs", label: "操作日志" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-8 py-6 overflow-auto">
        {activeTab === "models" && (
          <div className="space-y-2">
            {isLoading ? (
              <div className="text-center py-12 text-slate-500">加载中...</div>
            ) : !totalCount ? (
              <div className="text-center py-16">
                <Brain className="h-12 w-12 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500 mb-4">暂无模型，点击右上角添加</p>
                {isAdmin && (
                  <Button onClick={() => setShowCreateDialog(true)} variant="outline" className="border-white/10 text-slate-300">
                    <Plus className="h-4 w-4 mr-2" />添加模型
                  </Button>
                )}
              </div>
            ) : (
              (models as any[]).map((model: any) => (
                <div key={model.slug} className="flex items-center gap-4 px-5 py-4 rounded-xl bg-white/3 border border-white/6 hover:border-white/10 transition-all group">
                  <div className="flex items-center gap-2 min-w-[80px]">
                    {model.isActive
                      ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                      : <XCircle className="h-3.5 w-3.5 text-red-400" />
                    }
                    <span className={`text-xs ${model.isActive ? "text-emerald-400" : "text-red-400"}`}>
                      {model.isActive ? "正常" : "异常"}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{model.name}</span>
                      {model.isDefault && (
                        <Badge className="text-[10px] bg-violet-500/20 text-violet-300 border-violet-500/30 px-1.5 py-0">默认</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      {model.modelId} · {model.provider} {model.maxContextTokens ? `${Math.round((model.maxContextTokens||128000)/1000)}K ctx` : "128K ctx"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end min-w-[180px]">
                    {(model.capabilityTags ?? []).slice(0, 3).map((tag: string) => (
                      <Badge key={tag} variant="outline" className="text-[10px] border-white/10 text-slate-400 px-1.5 py-0">{tag}</Badge>
                    ))}
                  </div>
                  <div className="text-right text-xs text-slate-500 min-w-[120px]">
                    <div>输入 / 输出</div>
                    <div className="text-slate-300 font-mono">$0.0000 / $0.0000</div>
                    <div className="text-slate-600">per 1K tokens</div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => healthCheckMutation.mutate({ slug: model.slug })}
                      className="p-1.5 rounded text-slate-500 hover:text-violet-400 hover:bg-violet-500/10 transition-colors"
                      title="健康检查"
                    >
                      <Activity className="h-3.5 w-3.5" />
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => {
                          if (confirm(`确认删除模型 "${model.name}"？`)) {
                            deleteMutation.mutate({ slug: model.slug });
                          }
                        }}
                        className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "cost" && (
          <div className="space-y-6">
            <div className="rounded-xl bg-white/3 border border-white/6 p-6">
              <h3 className="text-sm font-medium text-slate-300 mb-4">近 30 天调用趋势</h3>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                    <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: "#0d1117", border: "1px solid #ffffff15", borderRadius: 8 }}
                      labelStyle={{ color: "#94a3b8" }}
                    />
                    <Area type="monotone" dataKey="calls" stroke="#8b5cf6" fill="#8b5cf620" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-slate-600">暂无调用数据</div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "总调用次数", value: costStats?.totals?.totalCalls ?? 0 },
                { label: "输入 Token", value: (costStats?.totals?.totalInputTokens ?? 0).toLocaleString() },
                { label: "输出 Token", value: (costStats?.totals?.totalOutputTokens ?? 0).toLocaleString() },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-white/3 border border-white/6 p-5">
                  <p className="text-xs text-slate-500 mb-2">{item.label}</p>
                  <p className="text-xl font-bold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "logs" && (
          <div className="space-y-2">
            {!(auditLogs as any[])?.length ? (
              <div className="text-center py-12 text-slate-500">暂无操作日志</div>
            ) : (
              (auditLogs as any[]).map((log: any, i: number) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3 rounded-xl bg-white/3 border border-white/6 text-sm">
                  <span className="text-slate-500 text-xs font-mono">{new Date(log.createdAt).toLocaleString()}</span>
                  <Badge variant="outline" className="text-[10px] border-white/10 text-slate-400">{log.action}</Badge>
                  <span className="text-slate-300">{log.resourceId}</span>
                  <span className={`ml-auto text-xs ${log.status === "completed" ? "text-emerald-400" : "text-red-400"}`}>{log.status}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-[#0d1117] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Brain className="h-5 w-5 text-violet-400" />
              添加 LLM 模型
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300 text-sm">模型名称 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：GPT-4o"
                  className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-slate-600"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Model ID *</Label>
                <Input
                  value={form.modelId}
                  onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                  placeholder="如：gpt-4o"
                  className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-slate-600 font-mono"
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">提供商</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1117] border-white/10">
                  {PROVIDERS.map(p => (
                    <SelectItem key={p} value={p} className="text-slate-300 focus:bg-white/10">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">API Base URL *</Label>
              <Input
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                className="mt-1.5 bg-white/5 border-white/10 text-white font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">API Key *</Label>
              <div className="relative mt-1.5">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-slate-300 text-sm">输入成本 ($/1K)</Label>
                <Input
                  type="number" min={0} step={0.0001}
                  value={form.costPer1kInputTokens}
                  onChange={(e) => setForm({ ...form, costPer1kInputTokens: Number(e.target.value) })}
                  className="mt-1.5 bg-white/5 border-white/10 text-white"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">输出成本 ($/1K)</Label>
                <Input
                  type="number" min={0} step={0.0001}
                  value={form.costPer1kOutputTokens}
                  onChange={(e) => setForm({ ...form, costPer1kOutputTokens: Number(e.target.value) })}
                  className="mt-1.5 bg-white/5 border-white/10 text-white"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">上下文长度</Label>
                <Input
                  type="number" min={1000}
                  value={form.maxContextTokens}
                  onChange={(e) => setForm({ ...form, maxContextTokens: Number(e.target.value) })}
                  className="mt-1.5 bg-white/5 border-white/10 text-white"
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">能力标签</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {CAPABILITY_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      form.capabilityTags.includes(tag)
                        ? "bg-violet-600/30 text-violet-300 ring-1 ring-violet-500/40"
                        : "bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isDefault"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="rounded border-white/20"
              />
              <Label htmlFor="isDefault" className="text-slate-300 text-sm cursor-pointer">
                设为默认模型（Skill 未指定模型时使用此模型）
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              className="border-white/10 text-slate-300 hover:bg-white/5"
            >
              取消
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="bg-violet-600 hover:bg-violet-500 text-white"
            >
              {createMutation.isPending ? "添加中..." : "添加模型"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
