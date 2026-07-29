import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plug, Plus, Pencil, Trash2, RefreshCw, XCircle,
  ChevronRight, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";

interface MCPConnector {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  connectionType: string;
  config: Record<string, unknown> | null;
  isActive: number;
  createdAt: string;
}

type ConnType = "http_api" | "database" | "webhook" | "internal" | "script";

interface FormData {
  slug: string; name: string; description: string; connectionType: ConnType;
  baseUrl: string; apiKey: string; headers: Array<{ key: string; value: string }>;
  connectionString: string; command: string; args: string[];
  env: Array<{ key: string; value: string }>; isActive: boolean;
}

const EMPTY: FormData = {
  slug: "", name: "", description: "", connectionType: "http_api",
  baseUrl: "", apiKey: "", headers: [], connectionString: "",
  command: "", args: [], env: [], isActive: true,
};

const CT_LABELS: Record<string, string> = {
  http_api: "HTTP API", webhook: "Webhook", database: "数据库",
  script: "脚本 (stdio)", internal: "内部服务",
};

const CT_COLORS: Record<string, string> = {
  http_api: "bg-blue-100 text-blue-700", webhook: "bg-purple-100 text-purple-700",
  database: "bg-green-100 text-green-700", script: "bg-orange-100 text-orange-700",
  internal: "bg-gray-100 text-gray-700",
};

function slugify(n: string) {
  return n.toLowerCase().replace(/[\s\u4e00-\u9fa5]+/g, "-")
    .replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "")
    || `mcp-${Date.now()}`;
}

function KVEditor({ label, rows, onChange, kp = "Key", vp = "Value" }: {
  label: string; rows: Array<{ key: string; value: string }>;
  onChange: (r: Array<{ key: string; value: string }>) => void;
  kp?: string; vp?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <button type="button" onClick={() => onChange([...rows, { key: "", value: "" }])}
          className="text-xs text-primary hover:underline flex items-center gap-1">
          <Plus className="h-3 w-3" />添加
        </button>
      </div>
      {rows.length === 0
        ? <div className="text-xs text-muted-foreground py-2 text-center border border-dashed rounded-lg">暂无配置</div>
        : <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input value={row.key} onChange={(e) => { const n = [...rows]; n[i] = { ...n[i], key: e.target.value }; onChange(n); }}
                placeholder={kp} className="h-8 text-xs font-mono flex-1" />
              <Input value={row.value} onChange={(e) => { const n = [...rows]; n[i] = { ...n[i], value: e.target.value }; onChange(n); }}
                placeholder={vp} className="h-8 text-xs font-mono flex-1" />
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-red-500 flex-shrink-0">
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      }
    </div>
  );
}

function MCPFormDialog({ open, onOpenChange, initialData, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  initialData?: MCPConnector; onSaved: () => void;
}) {
  const isEdit = !!initialData;
  const [form, setForm] = useState<FormData>(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      const cfg = initialData.config || {};
      setForm({
        slug: initialData.slug, name: initialData.name,
        description: initialData.description || "",
        connectionType: initialData.connectionType as ConnType,
        baseUrl: (cfg.baseUrl as string) || "",
        apiKey: (cfg.apiKey as string) || "",
        headers: Array.isArray(cfg.headers)
          ? (cfg.headers as any)
          : Object.entries((cfg.headers as any) || {}).map(([key, value]) => ({ key, value })),
        connectionString: (cfg.connectionString as string) || "",
        command: (cfg.command as string) || "",
        args: Array.isArray(cfg.args) ? (cfg.args as string[]) : [],
        env: Array.isArray(cfg.env)
          ? (cfg.env as any)
          : Object.entries((cfg.env as any) || {}).map(([key, value]) => ({ key, value })),
        isActive: !!initialData.isActive,
      });
    } else { setForm(EMPTY); }
  }, [open, initialData]);

  const upsertMutation = trpc.emperor.mcp.upsert.useMutation({
    onSuccess: () => { toast.success(isEdit ? "已更新" : "已创建"); onSaved(); onOpenChange(false); },
    onError: (e) => toast.error("保存失败: " + e.message),
  });

  const sf = <K extends keyof FormData>(k: K, v: FormData[K]) => setForm(f => ({ ...f, [k]: v }));

  const buildConfig = () => {
    const cfg: Record<string, unknown> = {};
    if (form.connectionType === "http_api" || form.connectionType === "webhook") {
      if (form.baseUrl) cfg.baseUrl = form.baseUrl;
      if (form.apiKey) cfg.apiKey = form.apiKey;
      if (form.headers.length > 0)
        cfg.headers = form.headers.filter(h => h.key).reduce((a, h) => ({ ...a, [h.key]: h.value }), {});
    } else if (form.connectionType === "database") {
      if (form.connectionString) cfg.connectionString = form.connectionString;
    } else {
      if (form.command) cfg.command = form.command;
      if (form.args.length > 0) cfg.args = form.args.filter(Boolean);
      if (form.env.length > 0)
        cfg.env = form.env.filter(e => e.key).reduce((a, e) => ({ ...a, [e.key]: e.value }), {});
    }
    return cfg;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑 MCP 连接器" : "新建 MCP 连接器"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">名称 *</label>
              <Input value={form.name} onChange={(e) => {
                const name = e.target.value;
                setForm(f => ({ ...f, name, slug: isEdit ? f.slug : slugify(name) }));
              }} placeholder="例如：亚马逊 SP-API" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Slug</label>
              <Input value={form.slug} onChange={(e) => sf("slug", e.target.value)}
                disabled={isEdit} className={isEdit ? "opacity-60" : ""} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">描述</label>
            <Textarea value={form.description} onChange={(e) => sf("description", e.target.value)}
              className="resize-none min-h-[60px]" placeholder="描述该连接器的用途..." />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">连接类型</label>
            <Select value={form.connectionType} onValueChange={(v) => sf("connectionType", v as ConnType)} disabled={isEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {(form.connectionType === "http_api" || form.connectionType === "webhook") && (<>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Base URL</label>
              <Input value={form.baseUrl} onChange={(e) => sf("baseUrl", e.target.value)}
                placeholder="https://api.example.com/v1" className="font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">API Key（可选）</label>
              <Input type="password" value={form.apiKey} onChange={(e) => sf("apiKey", e.target.value)}
                placeholder="Bearer token 或 API Key" className="font-mono text-xs" />
            </div>
            <KVEditor label="自定义请求头" rows={form.headers} onChange={(r) => sf("headers", r)} kp="Header 名称" vp="Header 值" />
          </>)}

          {form.connectionType === "database" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">连接字符串</label>
              <Input type="password" value={form.connectionString} onChange={(e) => sf("connectionString", e.target.value)}
                placeholder="mysql://user:pass@host:3306/db" className="font-mono text-xs" />
            </div>
          )}

          {(form.connectionType === "script" || form.connectionType === "internal") && (<>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">命令 (command)</label>
              <Input value={form.command} onChange={(e) => sf("command", e.target.value)}
                placeholder="例如：python3" className="font-mono text-xs" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">参数 (args)</label>
                <button type="button" onClick={() => sf("args", [...form.args, ""])}
                  className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Plus className="h-3 w-3" />添加
                </button>
              </div>
              {form.args.map((a, i) => (
                <div key={i} className="flex gap-2 items-center mb-1.5">
                  <Input value={a} onChange={(e) => { const n = [...form.args]; n[i] = e.target.value; sf("args", n); }}
                    placeholder={`参数 ${i + 1}`} className="h-8 text-xs font-mono" />
                  <button type="button" onClick={() => sf("args", form.args.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-red-500"><XCircle className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <KVEditor label="环境变量 (env)" rows={form.env} onChange={(r) => sf("env", r)} kp="变量名" vp="变量值" />
          </>)}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">启用连接器</p>
              <p className="text-xs text-muted-foreground">禁用后不会被 Skill 调用</p>
            </div>
            <Switch checked={form.isActive} onCheckedChange={(v) => sf("isActive", v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => {
            if (!form.name.trim()) { toast.error("请填写连接器名称"); return; }
            const slug = isEdit ? form.slug : (form.slug || slugify(form.name));
            upsertMutation.mutate({
              slug, name: form.name, description: form.description || undefined,
              connectionType: form.connectionType, config: buildConfig(), isActive: form.isActive,
            });
          }} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "保存更改" : "创建连接器"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function EmperorMCP() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingConnector, setEditingConnector] = useState<MCPConnector | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const { data: listData, isLoading } = trpc.emperor.mcp.list.useQuery();
  const connectors = (listData || []) as MCPConnector[];
  const { data: detailData } = trpc.emperor.mcp.get.useQuery(
    { slug: selectedSlug! }, { enabled: !!selectedSlug }
  );
  const detail = detailData as (MCPConnector & { config: Record<string, unknown> }) | undefined;

  const toggleMutation = trpc.emperor.mcp.upsert.useMutation({
    onSuccess: () => utils.emperor.mcp.list.invalidate(),
    onError: (e) => toast.error("操作失败: " + e.message),
  });
  const deleteMutation = trpc.emperor.mcp.delete.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      setDeletingSlug(null);
      if (selectedSlug === deletingSlug) setSelectedSlug(null);
      utils.emperor.mcp.list.invalidate();
    },
    onError: (e) => toast.error("删除失败: " + e.message),
  });

  const handleToggle = (c: MCPConnector) => toggleMutation.mutate({
    slug: c.slug, name: c.name, description: c.description || undefined,
    connectionType: c.connectionType as any, config: c.config || {}, isActive: !c.isActive,
  });

  const grouped = connectors.reduce((acc, c) => {
    if (!acc[c.connectionType]) acc[c.connectionType] = [];
    acc[c.connectionType].push(c);
    return acc;
  }, {} as Record<string, MCPConnector[]>);

  const selectedConnector = connectors.find(c => c.slug === selectedSlug);

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* Left panel */}
        <div className="w-[280px] flex-shrink-0 border-r flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">MCP 连接器</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => utils.emperor.mcp.list.invalidate()}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                {isAdmin && (
                  <button onClick={() => { setEditingConnector(null); setShowCreate(true); }}
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {isLoading ? "加载中..." : `${connectors.length} 个连接器`}
            </p>
          </div>

          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : connectors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Plug className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-xs">暂无连接器</p>
                {isAdmin && (
                  <Button size="sm" variant="outline" className="mt-2 h-7 text-xs"
                    onClick={() => setShowCreate(true)}>
                    <Plus className="h-3 w-3 mr-1" />新建
                  </Button>
                )}
              </div>
            ) : (
              <div className="p-2">
                {Object.entries(grouped).map(([type, items]) => (
                  <div key={type} className="mb-3">
                    <div className="flex items-center gap-1.5 px-2 py-1 mb-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {CT_LABELS[type] || type}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">{items.length}</span>
                    </div>
                    {items.map((c) => (
                      <button key={c.id} onClick={() => setSelectedSlug(c.slug)}
                        className={cn(
                          "w-full text-left px-3 py-2.5 rounded-lg transition-all group mb-0.5",
                          selectedSlug === c.slug
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent text-foreground"
                        )}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={cn("w-2 h-2 rounded-full flex-shrink-0",
                              c.isActive ? "bg-green-400" : "bg-gray-300")} />
                            <span className="text-sm font-medium truncate">{c.name}</span>
                          </div>
                          <ChevronRight className={cn(
                            "h-3.5 w-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100",
                            selectedSlug === c.slug && "opacity-100"
                          )} />
                        </div>
                        {c.description && (
                          <p className={cn("text-xs mt-0.5 truncate",
                            selectedSlug === c.slug ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {c.description}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedConnector ? (
            <>
              <div className="p-5 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-lg font-semibold">{selectedConnector.name}</h2>
                      <Badge className={cn("text-xs border-0",
                        selectedConnector.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                        {selectedConnector.isActive ? "已启用" : "已禁用"}
                      </Badge>
                      <Badge className={cn("text-xs border-0",
                        CT_COLORS[selectedConnector.connectionType] || "bg-gray-100 text-gray-700")}>
                        {CT_LABELS[selectedConnector.connectionType] || selectedConnector.connectionType}
                      </Badge>
                    </div>
                    {selectedConnector.description && (
                      <p className="text-sm text-muted-foreground">{selectedConnector.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground/60 font-mono mt-1">{selectedConnector.slug}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="flex items-center gap-2 mr-2">
                        <span className="text-xs text-muted-foreground">启用</span>
                        <Switch checked={!!selectedConnector.isActive}
                          onCheckedChange={() => handleToggle(selectedConnector)}
                          disabled={toggleMutation.isPending} />
                      </div>
                      <Button size="sm" variant="outline" className="h-8 px-3"
                        onClick={() => { setEditingConnector(selectedConnector); setShowCreate(true); }}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />编辑
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-8 px-3 hover:text-red-600 hover:border-red-300"
                        onClick={() => setDeletingSlug(selectedConnector.slug)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />删除
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <ScrollArea className="flex-1 p-5">
                {detail ? (
                  <div className="max-w-2xl space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold mb-3">连接配置</h3>
                      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                        {(detail.connectionType === "http_api" || detail.connectionType === "webhook") && (<>
                          {detail.config?.baseUrl && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Base URL</p>
                              <p className="text-sm font-mono bg-background rounded-lg px-3 py-2 border">
                                {detail.config.baseUrl as string}
                              </p>
                            </div>
                          )}
                          {detail.config?.apiKey && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">API Key</p>
                              <p className="text-sm font-mono bg-background rounded-lg px-3 py-2 border text-muted-foreground">
                                {"•".repeat(20)}
                              </p>
                            </div>
                          )}
                          {detail.config?.headers && Object.keys(detail.config.headers as object).length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">自定义请求头</p>
                              {Object.entries(detail.config.headers as Record<string, string>).map(([k, v]) => (
                                <div key={k} className="flex items-center gap-2 text-xs font-mono mb-1">
                                  <span className="bg-primary/10 text-primary px-2 py-1 rounded">{k}</span>
                                  <span className="text-muted-foreground">: {v.length > 20 ? "•".repeat(20) : v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>)}
                        {detail.connectionType === "database" && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">连接字符串</p>
                            <p className="text-sm font-mono bg-background rounded-lg px-3 py-2 border text-muted-foreground">
                              {"•".repeat(30)}
                            </p>
                          </div>
                        )}
                        {(detail.connectionType === "script" || detail.connectionType === "internal") && (<>
                          {detail.config?.command && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">命令</p>
                              <p className="text-sm font-mono bg-background rounded-lg px-3 py-2 border">
                                {detail.config.command as string}
                              </p>
                            </div>
                          )}
                          {Array.isArray(detail.config?.args) && (detail.config.args as string[]).length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">参数</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(detail.config.args as string[]).map((a, i) => (
                                  <span key={i} className="text-xs font-mono bg-background border px-2 py-1 rounded">{a}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {detail.config?.env && Object.keys(detail.config.env as object).length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">环境变量</p>
                              {Object.keys(detail.config.env as object).map(k => (
                                <div key={k} className="flex items-center gap-2 text-xs font-mono mb-1">
                                  <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded">{k}</span>
                                  <span className="text-muted-foreground">= {"•".repeat(10)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 p-4">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="text-xs text-blue-700 dark:text-blue-400">
                          <p className="font-medium mb-1">在 Skill 中引用此连接器</p>
                          <p className="font-mono bg-blue-100 dark:bg-blue-900/40 px-2 py-1 rounded mt-1 inline-block">
                            {`{{mcp.${detail.slug}}}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Plug className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">选择一个 MCP 连接器查看详情</p>
              <p className="text-xs mt-1 opacity-60">MCP 连接器用于扩展 Skill 的外部数据访问能力</p>
              {isAdmin && (
                <Button size="sm" variant="outline" className="mt-4" onClick={() => setShowCreate(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />新建连接器
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <MCPFormDialog
        open={showCreate || !!editingConnector}
        onOpenChange={(v) => { if (!v) { setShowCreate(false); setEditingConnector(null); } }}
        initialData={editingConnector || undefined}
        onSaved={() => {
          utils.emperor.mcp.list.invalidate();
          if (selectedSlug) utils.emperor.mcp.get.invalidate({ slug: selectedSlug });
        }}
      />

      <AlertDialog open={!!deletingSlug} onOpenChange={(v) => !v && setDeletingSlug(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除连接器？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销。删除后，引用此连接器的 Skill 可能无法正常运行。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700"
              onClick={() => deletingSlug && deleteMutation.mutate({ slug: deletingSlug })}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
