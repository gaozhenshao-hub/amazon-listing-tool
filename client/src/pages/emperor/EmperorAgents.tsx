import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Bot, Plus, RefreshCw, Play, GitBranch, Clock,
  Trash2, Search, ChevronRight, Loader2
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
import { useAuth } from "@/_core/hooks/useAuth";

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft:      { label: "草稿",   color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/25" },
  active:     { label: "启用",   color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/25" },
  deprecated: { label: "已弃用", color: "text-slate-400",   bg: "bg-slate-500/15 border-slate-500/25" },
};

const defaultForm = {
  name: "",
  slug: "",
  description: "",
  triggerType: "manual",
  scope: "project" as "project" | "private" | "global",
  maxExecutionSeconds: 300,
};

function slugify(name: string): string {
  const ascii = name.replace(/[\u4e00-\u9fa5]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ascii || `agent-${Date.now()}`;
}

export default function EmperorAgents() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || (user as any)?.role === "super_admin";
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "active" | "deprecated">("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [form, setForm] = useState(defaultForm);

  const { data: agents, isLoading, refetch } = trpc.emperor.agents.list.useQuery();

  const createMutation = trpc.emperor.agents.create.useMutation({
    onSuccess: (data: any) => {
      toast.success("Agent 已创建，正在打开画布...");
      setShowCreateDialog(false);
      setForm(defaultForm);
      refetch();
      if (data?.slug) {
        navigate(`/emperor/agents/${data.slug}/canvas`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.emperor.agents.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const installListingTemplate = trpc.emperor.agents.installListingTemplate.useMutation({
    onSuccess: (data: any) => {
      toast.success("Listing 全链路 Agent 已安装");
      refetch();
      if (data?.slug) navigate(`/emperor/agents/${data.slug}/canvas`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!form.name.trim()) return toast.error("请填写 Agent 名称");
    const slug = form.slug.trim() || slugify(form.name);
    createMutation.mutate({
      name: form.name,
      slug,
      description: form.description || undefined,
      triggerType: form.triggerType as "manual" | "event" | "scheduled",
      scope: form.scope as "project" | "private" | "global",
      maxExecutionSeconds: form.maxExecutionSeconds,
    });
  };

  const agentList = (agents as any[]) ?? [];

  const filtered = agentList.filter((a: any) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search && !a.name?.toLowerCase().includes(search.toLowerCase()) && !a.slug?.includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    all: agentList.length,
    draft: agentList.filter((a: any) => a.status === "draft").length,
    active: agentList.filter((a: any) => a.status === "active").length,
    deprecated: agentList.filter((a: any) => a.status === "deprecated").length,
  };

  return (
    <div className="flex flex-col h-full bg-[#080b11] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-6 border-b border-white/6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-2 bg-violet-500/15 border border-violet-500/20">
            <Bot className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Agent 编排</h1>
            <p className="text-sm text-slate-500 mt-0.5">可视化工作流编排，连接 Skill、LLM 和人工审核节点</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-400 hover:text-white">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <>
              <Button
                variant="outline"
                onClick={() => installListingTemplate.mutate()}
                disabled={installListingTemplate.isPending}
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 gap-2"
              >
                {installListingTemplate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                安装 Listing 模板
              </Button>
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-violet-600 hover:bg-violet-500 text-white gap-2"
              >
                <Plus className="h-4 w-4" />
                新建 Agent
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 px-8 py-4 flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 Agent 名称或 Slug..."
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-slate-600 h-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "draft", "active", "deprecated"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "bg-violet-600/30 text-violet-300 ring-1 ring-violet-500/40"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {s === "all" ? "全部" : STATUS_MAP[s]?.label ?? s}
              <span className="ml-1.5 text-slate-600">{counts[s]}</span>
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded text-slate-600 hover:text-slate-400 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Agent Cards */}
      <div className="flex-1 px-8 pb-8 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
          </div>
        ) : !filtered.length ? (
          <div className="text-center py-16">
            <Bot className="h-12 w-12 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 mb-4">
              {search || statusFilter !== "all" ? "没有匹配的 Agent" : "暂无 Agent，点击右上角新建"}
            </p>
            {isAdmin && !search && statusFilter === "all" && (
              <Button onClick={() => setShowCreateDialog(true)} variant="outline" className="border-white/10 text-slate-300">
                <Plus className="h-4 w-4 mr-2" />新建 Agent
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {filtered.map((agent: any) => {
              const st = STATUS_MAP[agent.status ?? "draft"] ?? STATUS_MAP.draft;
              const nodeCount = (() => {
                try {
                  const dag = typeof agent.dagDefinition === "string"
                    ? JSON.parse(agent.dagDefinition)
                    : (agent.dagDefinition ?? {});
                  return dag.nodes?.length ?? 0;
                } catch { return 0; }
              })();
              return (
                <div key={agent.slug} className="rounded-xl bg-white/3 border border-white/6 hover:border-white/12 transition-all group flex flex-col">
                  <div className="p-5 flex-1">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg p-2 bg-violet-500/15 border border-violet-500/20">
                          <Bot className="h-4 w-4 text-violet-400" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
                          <p className="text-xs text-slate-500 font-mono">{agent.slug}</p>
                        </div>
                      </div>
                      <Badge className={`text-[10px] border ${st.bg} ${st.color} px-2 py-0.5`}>
                        {st.label}
                      </Badge>
                    </div>
                    {agent.description && (
                      <p className="text-xs text-slate-400 mb-3 line-clamp-2">{agent.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Play className="h-3 w-3" />
                        {agent.triggerType === "manual" ? "手动触发" : agent.triggerType === "event" ? "事件触发" : "定时触发"}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {nodeCount} 节点
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {agent.maxExecutionSeconds ?? 300}s
                      </span>
                    </div>
                  </div>
                  <div className="px-5 py-3 border-t border-white/6 flex items-center justify-between">
                    <span className="text-xs text-slate-600">
                      更新于 {agent.updatedAt ? new Date(agent.updatedAt).toLocaleDateString("zh-CN") : "—"}
                    </span>
                    <div className="flex items-center gap-2">
                      {isAdmin && (
                        <button
                          onClick={() => {
                            if (confirm(`确认删除 Agent "${agent.name}"？`)) {
                              deleteMutation.mutate({ slug: agent.slug });
                            }
                          }}
                          className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => navigate(`/emperor/agents/${agent.slug}/canvas`)}
                        className="bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 border border-violet-500/30 h-7 text-xs gap-1"
                      >
                        <GitBranch className="h-3 w-3" />
                        打开画布
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-[#0d1117] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Bot className="h-5 w-5 text-violet-400" />
              新建 Agent
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300 text-sm">Agent 名称 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm(prev => ({ ...prev, name, slug: prev.slug || slugify(name) }));
                  }}
                  placeholder="Listing 质量审核 Agent"
                  className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-slate-600"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Slug *</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm(prev => ({ ...prev, slug: e.target.value }))}
                  placeholder="listing-quality-review"
                  className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-slate-600 font-mono text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">描述</Label>
              <textarea
                value={form.description}
                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Agent 的功能说明..."
                rows={3}
                className="mt-1.5 w-full rounded-md bg-white/5 border border-white/10 text-white placeholder:text-slate-600 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300 text-sm">触发方式</Label>
                <Select value={form.triggerType} onValueChange={(v) => setForm(prev => ({ ...prev, triggerType: v }))}>
                  <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1117] border-white/10">
                    <SelectItem value="manual" className="text-slate-300 focus:bg-white/10">手动触发</SelectItem>
                    <SelectItem value="event" className="text-slate-300 focus:bg-white/10">事件触发</SelectItem>
                    <SelectItem value="scheduled" className="text-slate-300 focus:bg-white/10">定时触发</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-sm">可见范围</Label>
                <Select value={form.scope} onValueChange={(v) => setForm(prev => ({ ...prev, scope: v as "project" | "private" | "global" }))}>
                  <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1117] border-white/10">
                    <SelectItem value="project" className="text-slate-300 focus:bg-white/10">项目内</SelectItem>
                    <SelectItem value="public" className="text-slate-300 focus:bg-white/10">公开</SelectItem>
                    <SelectItem value="private" className="text-slate-300 focus:bg-white/10">私有</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">最大执行时间（秒）</Label>
              <Input
                type="number" min={30} max={3600}
                value={form.maxExecutionSeconds}
                onChange={(e) => setForm(prev => ({ ...prev, maxExecutionSeconds: Number(e.target.value) }))}
                className="mt-1.5 bg-white/5 border-white/10 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowCreateDialog(false); setForm(defaultForm); }}
              className="border-white/10 text-slate-300 hover:bg-white/5"
            >
              取消
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="bg-violet-600 hover:bg-violet-500 text-white"
            >
              {createMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />创建中...</> : "创建 Agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
