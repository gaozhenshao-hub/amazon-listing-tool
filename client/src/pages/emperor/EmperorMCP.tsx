import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wrench, Plus, RefreshCw, Trash2, CheckCircle2,
  AlertTriangle, PauseCircle, Loader2, Globe, Database,
  Code2, Server, ChevronRight, Activity
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

// ─── Types ───────────────────────────────────────────────────────────────────

type ToolType = "REST API" | "OpenAPI" | "数据库" | "自定义脚本";

interface MCPTool {
  id?: number;
  slug: string;
  name: string;
  description: string | null;
  connectionType: string;
  config: Record<string, unknown> | null;
  isActive: number | boolean;
  createdAt?: string;
}

const TOOL_TYPES: { value: string; label: ToolType; icon: React.ElementType; color: string }[] = [
  { value: "http_api", label: "REST API", icon: Globe, color: "text-blue-400" },
  { value: "openapi", label: "OpenAPI", icon: Code2, color: "text-violet-400" },
  { value: "database", label: "数据库", icon: Database, color: "text-emerald-400" },
  { value: "script", label: "自定义脚本", icon: Code2, color: "text-amber-400" },
];

const AUTH_METHODS = [
  { value: "none", label: "无认证" },
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "oauth2", label: "OAuth 2.0" },
];

function slugify(n: string) {
  return n.toLowerCase().replace(/[\s\u4e00-\u9fa5]+/g, "-")
    .replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "")
    || `tool-${Date.now()}`;
}

function secretSlugFor(connectorSlug: string, kind: string) {
  return `${connectorSlug}-${kind}`.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-|-$/g, "").slice(0, 128);
}

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// ─── Four-Step Wizard Dialog ──────────────────────────────────────────────────

const STEPS = ["基本信息", "连接配置", "认证方式", "能力定义"];

const defaultWizard = {
  name: "", slug: "", toolType: "http_api", description: "",
  baseUrl: "", openApiSpec: "", connectionString: "", command: "",
  authMethod: "none", apiKey: "", apiKeyHeader: "X-API-Key",
  bearerToken: "", basicUser: "", basicPass: "",
  capabilities: [] as Array<{ name: string; description: string; endpoint: string }>,
};

function WizardDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(defaultWizard);

  useEffect(() => { if (open) { setStep(0); setForm(defaultWizard); } }, [open]);

  const upsertMutation = trpc.emperor.mcp.upsert.useMutation({
    onSuccess: () => { toast.success("MCP 工具已接入"); onSaved(); onOpenChange(false); },
    onError: (e) => toast.error("保存失败: " + e.message),
  });
  const upsertSecretMutation = trpc.emperor.tools.upsertSecret.useMutation({
    onError: (e) => toast.error("密钥保存失败: " + e.message),
  });

  const sf = <K extends keyof typeof defaultWizard>(k: K, v: (typeof defaultWizard)[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const handleFinish = async () => {
    const connectorSlug = form.slug || slugify(form.name);
    const config: Record<string, unknown> = {};
    if (form.baseUrl) config.baseUrl = form.baseUrl;
    if (form.openApiSpec) config.openApiSpec = form.openApiSpec;
    if (form.baseUrl) {
      const host = hostnameFromUrl(form.baseUrl);
      if (host) config.allowedHosts = [host];
    }
    if (form.command) config.command = form.command;

    const secretRefs: string[] = [];
    const storeSecret = async (kind: string, value: string) => {
      const secretValue = value.trim();
      if (!secretValue) return "";
      const result = await upsertSecretMutation.mutateAsync({
        slug: secretSlugFor(connectorSlug, kind),
        value: secretValue,
        description: `${form.name} ${kind}`,
        metadata: { connectorSlug, authMethod: form.authMethod },
      });
      if (result.ref) secretRefs.push(result.ref);
      return result.ref;
    };

    if (form.connectionString) {
      const ref = await storeSecret("connection-string", form.connectionString);
      if (ref) config.connectionString = ref;
    }

    if (form.authMethod !== "none") {
      config.authType = form.authMethod;
      if (form.authMethod === "api_key") {
        const ref = await storeSecret("api-key", form.apiKey);
        config.authConfig = {
          apiKeyRef: ref,
          headerName: form.apiKeyHeader || "X-API-Key",
        };
      } else if (form.authMethod === "bearer") {
        const ref = await storeSecret("bearer-token", form.bearerToken);
        config.authConfig = { apiKeyRef: ref };
      } else if (form.authMethod === "basic") {
        const ref = await storeSecret("basic-password", form.basicPass);
        config.authConfig = {
          username: form.basicUser,
          password: ref,
        };
      } else if (form.authMethod === "oauth2") {
        const ref = await storeSecret("oauth-access-token", form.bearerToken);
        config.authConfig = { accessToken: ref };
      }
    }
    if (form.capabilities.length > 0) {
      config.capabilities = form.capabilities.map((capability) => ({
        name: capability.name,
        description: capability.description,
        path: capability.endpoint,
        endpoint: capability.endpoint,
      }));
    }
    await upsertMutation.mutateAsync({
      slug: connectorSlug,
      name: form.name,
      description: form.description || undefined,
      connectionType: form.toolType === "database" ? "database" : form.toolType === "script" ? "script" : "http_api",
      config,
      secretRefs,
      isActive: true,
    });
  };

  const canNext = () => {
    if (step === 0) return form.name.trim().length > 0;
    if (step === 1) {
      if (form.toolType === "http_api" || form.toolType === "openapi") return form.baseUrl.trim().length > 0;
      if (form.toolType === "database") return form.connectionString.trim().length > 0;
      return true;
    }
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d1117] border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Wrench className="h-5 w-5 text-violet-400" />接入新 MCP 工具
          </DialogTitle>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 transition-colors ${
                i < step ? "bg-violet-600 text-white" :
                i === step ? "bg-violet-600 text-white ring-2 ring-violet-400/40" :
                "bg-white/10 text-slate-500"
              }`}>
                {i < step ? "✓" : i + 1}
              </div>
              <span className={`text-xs ${i === step ? "text-white" : "text-slate-500"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-1 ${i < step ? "bg-violet-600" : "bg-white/10"}`} />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="min-h-[280px]">
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">工具名称 *</label>
                  <Input
                    value={form.name}
                    onChange={(e) => { sf("name", e.target.value); sf("slug", slugify(e.target.value)); }}
                    placeholder="如：天气查询 API"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">标识符 (slug) *</label>
                  <Input
                    value={form.slug}
                    onChange={(e) => sf("slug", e.target.value)}
                    placeholder="如：weather-api"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 font-mono text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">工具类型 *</label>
                <div className="grid grid-cols-2 gap-2">
                  {TOOL_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => sf("toolType", t.value)}
                      className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                        form.toolType === t.value
                          ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
                          : "bg-white/3 border-white/8 text-slate-400 hover:border-white/15"
                      }`}
                    >
                      <t.icon className={`h-4 w-4 ${form.toolType === t.value ? "text-violet-400" : t.color}`} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">描述</label>
                <Textarea
                  value={form.description}
                  onChange={(e) => sf("description", e.target.value)}
                  placeholder="简要描述该工具的用途..."
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 resize-none min-h-[80px]"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {(form.toolType === "http_api" || form.toolType === "openapi") && (
                <>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Base URL *</label>
                    <Input
                      value={form.baseUrl}
                      onChange={(e) => sf("baseUrl", e.target.value)}
                      placeholder="https://api.example.com/v1"
                      className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 font-mono text-sm"
                    />
                  </div>
                  {form.toolType === "openapi" && (
                    <div>
                      <label className="text-xs text-slate-400 mb-1.5 block">OpenAPI Spec URL</label>
                      <Input
                        value={form.openApiSpec}
                        onChange={(e) => sf("openApiSpec", e.target.value)}
                        placeholder="https://api.example.com/openapi.json"
                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 font-mono text-sm"
                      />
                    </div>
                  )}
                </>
              )}
              {form.toolType === "database" && (
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">连接字符串 *</label>
                  <Input
                    type="password"
                    value={form.connectionString}
                    onChange={(e) => sf("connectionString", e.target.value)}
                    placeholder="mysql://user:pass@host:3306/db"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 font-mono text-sm"
                  />
                </div>
              )}
              {form.toolType === "script" && (
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">命令</label>
                  <Input
                    value={form.command}
                    onChange={(e) => sf("command", e.target.value)}
                    placeholder="python3 /path/to/script.py"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 font-mono text-sm"
                  />
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">认证方式</label>
                <Select value={form.authMethod} onValueChange={(v) => sf("authMethod", v)}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1117] border-white/10">
                    {AUTH_METHODS.map(m => (
                      <SelectItem key={m.value} value={m.value} className="text-slate-300 focus:bg-white/10">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.authMethod === "api_key" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">API Key</label>
                    <Input type="password" value={form.apiKey} onChange={(e) => sf("apiKey", e.target.value)}
                      placeholder="your-api-key" className="bg-white/5 border-white/10 text-white font-mono text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Header 名称</label>
                    <Input value={form.apiKeyHeader} onChange={(e) => sf("apiKeyHeader", e.target.value)}
                      placeholder="X-API-Key" className="bg-white/5 border-white/10 text-white font-mono text-sm" />
                  </div>
                </div>
              )}
              {(form.authMethod === "bearer" || form.authMethod === "oauth2") && (
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">{form.authMethod === "oauth2" ? "Access Token" : "Bearer Token"}</label>
                  <Input type="password" value={form.bearerToken} onChange={(e) => sf("bearerToken", e.target.value)}
                    placeholder={form.authMethod === "oauth2" ? "your-access-token" : "your-bearer-token"} className="bg-white/5 border-white/10 text-white font-mono text-sm" />
                </div>
              )}
              {form.authMethod === "basic" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">用户名</label>
                    <Input value={form.basicUser} onChange={(e) => sf("basicUser", e.target.value)}
                      className="bg-white/5 border-white/10 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">密码</label>
                    <Input type="password" value={form.basicPass} onChange={(e) => sf("basicPass", e.target.value)}
                      className="bg-white/5 border-white/10 text-white" />
                  </div>
                </div>
              )}
              {form.authMethod === "none" && (
                <div className="rounded-lg bg-white/3 border border-white/8 p-4 text-center">
                  <p className="text-sm text-slate-400">此工具不需要认证</p>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">能力定义（可选）</label>
                <button
                  type="button"
                  onClick={() => sf("capabilities", [...form.capabilities, { name: "", description: "", endpoint: "" }])}
                  className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" />添加能力
                </button>
              </div>
              {form.capabilities.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 p-6 text-center">
                  <Wrench className="h-8 w-8 text-slate-700 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">暂无能力定义，系统将自动从 OpenAPI Spec 解析</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-auto">
                  {form.capabilities.map((cap, i) => (
                    <div key={i} className="rounded-lg bg-white/3 border border-white/8 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={cap.name}
                          onChange={(e) => {
                            const caps = [...form.capabilities];
                            caps[i] = { ...caps[i], name: e.target.value };
                            sf("capabilities", caps);
                          }}
                          placeholder="能力名称"
                          className="bg-white/5 border-white/10 text-white text-xs h-7 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => sf("capabilities", form.capabilities.filter((_, j) => j !== i))}
                          className="text-slate-600 hover:text-red-400 flex-shrink-0"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                      <Input
                        value={cap.description}
                        onChange={(e) => {
                          const caps = [...form.capabilities];
                          caps[i] = { ...caps[i], description: e.target.value };
                          sf("capabilities", caps);
                        }}
                        placeholder="能力描述"
                        className="bg-white/5 border-white/10 text-white text-xs h-7"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/8">
          <Button
            variant="ghost"
            onClick={() => step === 0 ? onOpenChange(false) : setStep(s => s - 1)}
            className="text-slate-400 hover:text-white"
          >
            {step === 0 ? "取消" : "上一步"}
          </Button>
          <Button
            onClick={() => step < STEPS.length - 1 ? setStep(s => s + 1) : handleFinish()}
            disabled={!canNext() || upsertMutation.isPending || upsertSecretMutation.isPending}
            className="bg-violet-600 hover:bg-violet-500 text-white"
          >
            {upsertMutation.isPending || upsertSecretMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />保存中...</>
            ) : step < STEPS.length - 1 ? (
              <>下一步 <ChevronRight className="h-4 w-4 ml-1" /></>
            ) : "完成接入"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tool Card ────────────────────────────────────────────────────────────────

function ToolCard({ tool, isAdmin, onDelete, onTest }: {
  tool: MCPTool; isAdmin: boolean;
  onDelete: () => void; onTest: () => void;
}) {
  const typeInfo = TOOL_TYPES.find(t => t.value === tool.connectionType) ?? TOOL_TYPES[0];
  const isActive = !!tool.isActive;

  return (
    <div className="rounded-xl bg-white/3 border border-white/6 hover:border-white/10 transition-all p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2 bg-white/5 border border-white/8`}>
            <typeInfo.icon className={`h-4 w-4 ${typeInfo.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{tool.name}</span>
              <Badge className={`text-[10px] px-1.5 py-0 ${
                isActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" :
                "bg-red-500/15 text-red-400 border-red-500/25"
              }`}>
                {isActive ? "运行中" : "已停用"}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{tool.slug}</p>
          </div>
        </div>
        <Badge className="text-[10px] bg-white/5 text-slate-400 border-white/10 px-1.5 py-0">
          {typeInfo.label}
        </Badge>
      </div>
      {tool.description && (
        <p className="text-xs text-slate-400 line-clamp-2">{tool.description}</p>
      )}
      <div className="flex items-center gap-2 pt-1 border-t border-white/5">
        <button
          onClick={onTest}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-400 transition-colors"
        >
          <Activity className="h-3.5 w-3.5" />测试
        </button>
        {isAdmin && (
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors ml-auto"
          >
            <Trash2 className="h-3.5 w-3.5" />删除
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function XCircle({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>;
}

export default function EmperorMCP() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || (user as any)?.role === "super_admin";
  const utils = trpc.useUtils();
  const [showWizard, setShowWizard] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "logs">("list");

  const { data: listData, isLoading, refetch } = trpc.emperor.mcp.list.useQuery();
  const tools = (listData || []) as MCPTool[];

  const deleteMutation = trpc.emperor.mcp.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); utils.emperor.mcp.list.invalidate(); },
    onError: (e) => toast.error("删除失败: " + e.message),
  });

  const stats = {
    total: tools.length,
    active: tools.filter(t => !!t.isActive).length,
    error: 0,
    disabled: tools.filter(t => !t.isActive).length,
  };

  return (
    <div className="flex flex-col h-full bg-[#080b11] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-6 border-b border-white/6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-2 bg-violet-500/15 border border-violet-500/20">
            <Wrench className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">MCP 工具管理</h1>
            <p className="text-sm text-slate-500 mt-0.5">管理外部工具接入、能力定义与调用监控</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-400 hover:text-white">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <Button onClick={() => setShowWizard(true)} className="bg-violet-600 hover:bg-violet-500 text-white gap-2">
              <Plus className="h-4 w-4" />接入工具
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 px-8 py-5 flex-shrink-0">
        {[
          { label: "工具总数", value: stats.total, icon: Wrench, color: "text-slate-300", bg: "bg-white/3 border-white/8" },
          { label: "正常运行", value: stats.active, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
          { label: "异常工具", value: stats.error, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
          { label: "已停用", value: stats.disabled, icon: PauseCircle, color: "text-slate-500", bg: "bg-white/3 border-white/8" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">{s.label}</span>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-8 border-b border-white/6 flex-shrink-0">
        {[
          { key: "list", label: "工具列表" },
          { key: "logs", label: "调用日志" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-violet-500 text-violet-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 px-8 py-6 overflow-auto">
        {activeTab === "list" && (
          isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
            </div>
          ) : !tools.length ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Wrench className="h-12 w-12 text-slate-700 mb-4" />
              <p className="text-slate-500 mb-2">暂无 MCP 工具</p>
              <p className="text-xs text-slate-600 mb-6">点击"接入工具"开始配置第一个外部工具</p>
              {isAdmin && (
                <Button onClick={() => setShowWizard(true)} className="bg-violet-600 hover:bg-violet-500 text-white gap-2">
                  <Plus className="h-4 w-4" />接入工具
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {tools.map((tool) => (
                <ToolCard
                  key={tool.slug}
                  tool={tool}
                  isAdmin={isAdmin}
                  onDelete={() => { if (confirm(`确认删除工具 "${tool.name}"？`)) deleteMutation.mutate({ slug: tool.slug }); }}
                  onTest={() => toast.info(`正在测试 ${tool.name}...`)}
                />
              ))}
            </div>
          )
        )}

        {activeTab === "logs" && (
          <div className="text-center py-16">
            <Server className="h-10 w-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">暂无调用日志</p>
          </div>
        )}
      </div>

      {/* Wizard Dialog */}
      <WizardDialog
        open={showWizard}
        onOpenChange={setShowWizard}
        onSaved={() => utils.emperor.mcp.list.invalidate()}
      />
    </div>
  );
}
