import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  type Node, type Edge, type Connection,
  type NodeTypes, Handle, Position,
  Panel, ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft, Save, Play, ChevronDown, X, Plus,
  Zap, Code2, GitBranch, RefreshCw, Wrench,
  BookOpen, LogOut, LogIn, Bot, RotateCcw,
  Globe, UserCheck, Loader2, CheckCircle2, Circle,
  AlertTriangle, FileText, SkipForward, History,
  GitCommit, Rocket, Undo2, SlidersHorizontal, GitCompare, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// ─── Node Type Definitions ───────────────────────────────────────────────────

const NODE_PALETTE = [
  { type: "input_node",    label: "输入节点",   desc: "工作流起始，接收外部输入",   icon: LogIn,       color: "#7c3aed", bg: "#3b0764" },
  { type: "skill_node",    label: "Skill 节点", desc: "调用已注册的 AI Skill",     icon: Zap,         color: "#2563eb", bg: "#1e3a8a" },
  { type: "llm_node",      label: "LLM 节点",   desc: "直接调用大语言模型",         icon: Bot,         color: "#0891b2", bg: "#164e63" },
  { type: "condition_node",label: "条件分支",   desc: "根据条件走不同分支",         icon: GitBranch,   color: "#d97706", bg: "#78350f" },
  { type: "loop_node",     label: "循环节点",   desc: "对列表数据循环处理",         icon: RefreshCw,   color: "#059669", bg: "#064e3b" },
  { type: "human_review",  label: "人工审核",   desc: "暂停等待人工确认",           icon: UserCheck,   color: "#dc2626", bg: "#7f1d1d" },
  { type: "http_node",     label: "HTTP 请求",  desc: "调用外部 API",              icon: Globe,       color: "#7c3aed", bg: "#4c1d95" },
  { type: "code_node",     label: "代码节点",   desc: "执行自定义代码逻辑",         icon: Code2,       color: "#0284c7", bg: "#0c4a6e" },
  { type: "mcp_node",      label: "MCP 工具",   desc: "调用外部 MCP 工具服务",      icon: Wrench,      color: "#7c3aed", bg: "#3b0764" },
  { type: "knowledge_node",label: "知识库",     desc: "查询知识库内容",             icon: BookOpen,    color: "#16a34a", bg: "#14532d" },
  { type: "output_node",   label: "输出节点",   desc: "工作流终止，收集输出",       icon: LogOut,      color: "#6b7280", bg: "#1f2937" },
];

const NODE_COLORS: Record<string, { color: string; bg: string }> = Object.fromEntries(
  NODE_PALETTE.map(n => [n.type, { color: n.color, bg: n.bg }])
);

// ─── Custom Node Component ────────────────────────────────────────────────────

function AgentNode({ data, selected }: { data: any; selected?: boolean }) {
  const palette = NODE_PALETTE.find(p => p.type === data.nodeType) ?? NODE_PALETTE[1];
  const IconComp = palette.icon;
  const isInput = data.nodeType === "input_node";
  const isOutput = data.nodeType === "output_node";

  return (
    <div
      className="rounded-xl border-2 transition-all"
      style={{
        background: `${palette.bg}cc`,
        borderColor: selected ? palette.color : `${palette.color}60`,
        boxShadow: selected ? `0 0 0 2px ${palette.color}40` : "none",
        minWidth: 180,
        padding: "10px 14px",
      }}
    >
      {!isInput && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: palette.color, border: "2px solid #1e1e2e", width: 10, height: 10 }}
        />
      )}
      <div className="flex items-center gap-2">
        <div
          className="rounded-lg p-1.5 flex-shrink-0"
          style={{ background: `${palette.color}30`, border: `1px solid ${palette.color}50` }}
        >
          <IconComp size={14} style={{ color: palette.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-white truncate">{data.label || palette.label}</div>
          <div className="text-[10px] text-slate-400 truncate">{data.subtitle || palette.desc}</div>
        </div>
      </div>
      {!isOutput && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: palette.color, border: "2px solid #1e1e2e", width: 10, height: 10 }}
        />
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  input_node: AgentNode,
  skill_node: AgentNode,
  llm_node: AgentNode,
  condition_node: AgentNode,
  loop_node: AgentNode,
  human_review: AgentNode,
  http_node: AgentNode,
  code_node: AgentNode,
  mcp_node: AgentNode,
  knowledge_node: AgentNode,
  output_node: AgentNode,
};

// ─── Node Property Panel ──────────────────────────────────────────────────────

function NodePropertyPanel({
  node, onUpdate, onClose, skills, models, mcpTools, tools,
}: {
  node: Node;
  onUpdate: (id: string, data: Partial<any>) => void;
  onClose: () => void;
  skills: any[];
  models: any[];
  mcpTools: any[];
  tools: any[];
}) {
  const palette = NODE_PALETTE.find(p => p.type === node.type) ?? NODE_PALETTE[1];
  const d = node.data as any;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-72 bg-[#0d1117] border-l border-white/8 flex flex-col z-10 overflow-auto"
      style={{ boxShadow: "-4px 0 20px rgba(0,0,0,0.4)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/8"
        style={{ background: `${palette.bg}80` }}
      >
        <div className="flex items-center gap-2">
          <palette.icon size={14} style={{ color: palette.color }} />
          <span className="text-sm font-semibold text-white">{palette.label}</span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 p-4 space-y-4 overflow-auto">
        <div>
          <Label className="text-slate-400 text-xs">节点名称</Label>
          <Input
            value={d.label || ""}
            onChange={(e) => onUpdate(node.id, { label: e.target.value })}
            className="mt-1.5 bg-white/5 border-white/10 text-white text-sm h-8"
          />
        </div>

        {node.type === "skill_node" && (
          <>
            <div>
              <Label className="text-slate-400 text-xs">选择 Skill</Label>
              <Select value={d.skillSlug || ""} onValueChange={(v) => {
                const s = skills.find((sk: any) => sk.slug === v);
                onUpdate(node.id, { skillSlug: v, subtitle: s?.name || v });
              }}>
                <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white h-8 text-sm">
                  <SelectValue placeholder="选择 Skill..." />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1117] border-white/10">
                  {skills.map((s: any) => (
                    <SelectItem key={s.slug} value={s.slug} className="text-slate-300 focus:bg-white/10 text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">执行模式（cc-haha）</Label>
              <Select
                value={d.executionMode || "inline"}
                onValueChange={(v) => onUpdate(node.id, { executionMode: v })}
              >
                <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1117] border-white/10">
                  <SelectItem value="inline" className="text-slate-300 focus:bg-white/10 text-xs">• Inline（同步内联）</SelectItem>
                  <SelectItem value="fork" className="text-slate-300 focus:bg-white/10 text-xs">• Fork（并行分支）</SelectItem>
                  <SelectItem value="background" className="text-slate-300 focus:bg-white/10 text-xs">• Background（后台异步）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-500 mt-1">
                {d.executionMode === "fork" && "并行分支：多个 Skill 同时执行，结果合并"}
                {d.executionMode === "background" && "后台异步：不阻塞主流程，完成后回调"}
                {(!d.executionMode || d.executionMode === "inline") && "同步内联：当前节点完成后继续"}
              </p>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">超时（秒）</Label>
              <Input
                type="number"
                min={10}
                max={3600}
                value={d.timeoutSeconds ?? 120}
                onChange={(e) => onUpdate(node.id, { timeoutSeconds: Number(e.target.value) })}
                className="mt-1.5 bg-white/5 border-white/10 text-white text-xs h-8"
              />
            </div>
          </>
        )}

        {node.type === "llm_node" && (
          <>
            <div>
              <Label className="text-slate-400 text-xs">选择模型</Label>
              <Select value={d.modelSlug || ""} onValueChange={(v) => {
                const m = models.find((mo: any) => mo.slug === v);
                onUpdate(node.id, { modelSlug: v, subtitle: m?.name || v });
              }}>
                <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white h-8 text-sm">
                  <SelectValue placeholder="选择模型..." />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1117] border-white/10">
                  {models.map((m: any) => (
                    <SelectItem key={m.slug} value={m.slug} className="text-slate-300 focus:bg-white/10 text-xs">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">System Prompt</Label>
              <Textarea
                value={d.systemPrompt || ""}
                onChange={(e) => onUpdate(node.id, { systemPrompt: e.target.value })}
                placeholder="你是一个专业的..."
                rows={4}
                className="mt-1.5 bg-white/5 border-white/10 text-white text-xs resize-none"
              />
            </div>
          </>
        )}

        {node.type === "condition_node" && (
          <div>
            <Label className="text-slate-400 text-xs">条件表达式</Label>
            <Input
              value={d.condition || ""}
              onChange={(e) => onUpdate(node.id, { condition: e.target.value })}
              placeholder="output.score > 0.8"
              className="mt-1.5 bg-white/5 border-white/10 text-white text-xs font-mono h-8"
            />
          </div>
        )}

        {node.type === "loop_node" && (
          <div>
            <Label className="text-slate-400 text-xs">循环变量</Label>
            <Input
              value={d.loopVar || ""}
              onChange={(e) => onUpdate(node.id, { loopVar: e.target.value })}
              placeholder="items"
              className="mt-1.5 bg-white/5 border-white/10 text-white text-xs h-8"
            />
          </div>
        )}

        {node.type === "http_node" && (
          <>
            <div>
              <Label className="text-slate-400 text-xs">请求方法</Label>
              <Select value={d.method || "GET"} onValueChange={(v) => onUpdate(node.id, { method: v })}>
                <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1117] border-white/10">
                  {["GET","POST","PUT","PATCH","DELETE"].map(m => (
                    <SelectItem key={m} value={m} className="text-slate-300 focus:bg-white/10 text-xs">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">URL</Label>
              <Input
                value={d.url || ""}
                onChange={(e) => onUpdate(node.id, { url: e.target.value })}
                placeholder="https://api.example.com/..."
                className="mt-1.5 bg-white/5 border-white/10 text-white text-xs h-8 font-mono"
              />
            </div>
          </>
        )}

        {node.type === "code_node" && (
          <div>
            <Label className="text-slate-400 text-xs">代码（JavaScript）</Label>
            <Textarea
              value={d.code || ""}
              onChange={(e) => onUpdate(node.id, { code: e.target.value })}
              placeholder="// input: 上游输出\nreturn { result: input };"
              rows={6}
              className="mt-1.5 bg-white/5 border-white/10 text-white text-xs font-mono resize-none"
            />
          </div>
        )}

        {node.type === "mcp_node" && (
          <div>
            <Label className="text-slate-400 text-xs">选择 MCP 工具</Label>
            <Select value={d.mcpSlug || ""} onValueChange={(v) => {
              const t = mcpTools.find((mt: any) => mt.slug === v);
              onUpdate(node.id, { mcpSlug: v, subtitle: t?.name || v });
            }}>
              <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white h-8 text-sm">
                <SelectValue placeholder="选择 MCP 工具..." />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1117] border-white/10">
                {mcpTools.map((t: any) => (
                  <SelectItem key={t.slug} value={t.slug} className="text-slate-300 focus:bg-white/10 text-xs">
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {["input_node", "output_node", "code_node"].includes(String(node.type)) && (
          <div>
            <Label className="text-slate-400 text-xs">绑定 Tool Gateway</Label>
            <Select value={d.toolSlug || ""} onValueChange={(v) => {
              const t = tools.find((tool: any) => tool.slug === v);
              onUpdate(node.id, { toolSlug: v, subtitle: t?.name || v });
            }}>
              <SelectTrigger className="mt-1.5 bg-white/5 border-white/10 text-white h-8 text-sm">
                <SelectValue placeholder="选择 Tool..." />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1117] border-white/10">
                {tools.map((t: any) => (
                  <SelectItem key={t.slug} value={t.slug} className="text-slate-300 focus:bg-white/10 text-xs">
                    {t.name || t.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {node.type === "knowledge_node" && (
          <div>
            <Label className="text-slate-400 text-xs">查询内容</Label>
            <Input
              value={d.query || ""}
              onChange={(e) => onUpdate(node.id, { query: e.target.value })}
              placeholder="{{input.keyword}}"
              className="mt-1.5 bg-white/5 border-white/10 text-white text-xs h-8 font-mono"
            />
          </div>
        )}

        {node.type === "human_review" && (
          <div>
            <Label className="text-slate-400 text-xs">审核提示</Label>
            <Textarea
              value={d.reviewPrompt || ""}
              onChange={(e) => onUpdate(node.id, { reviewPrompt: e.target.value })}
              placeholder="请审核以下内容..."
              rows={3}
              className="mt-1.5 bg-white/5 border-white/10 text-white text-xs resize-none"
            />
          </div>
        )}

        <div>
          <Label className="text-slate-400 text-xs">备注</Label>
          <Input
            value={d.note || ""}
            onChange={(e) => onUpdate(node.id, { note: e.target.value })}
            placeholder="可选备注..."
            className="mt-1.5 bg-white/5 border-white/10 text-white text-xs h-8"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Run Panel ────────────────────────────────────────────────────────────────

function RunPanel({ agentSlug, onClose }: { agentSlug: string; onClose: () => void }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [inputs, setInputs] = useState("{}");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("{}");

  const runMutation = trpc.emperor.agents.run.useMutation({
    onSuccess: (data: any) => {
      const nextRunId = data?.run?.runId || data?.runId;
      setRunId(nextRunId);
      setSelectedNodeId(data?.run?.currentNodeId || null);
      toast.success("已触发运行");
    },
    onError: (e) => toast.error("运行失败: " + e.message),
  });

  const { data: runData, refetch: refetchRun } = trpc.emperor.agents.getRun.useQuery(
    { runId: runId! },
    {
      enabled: !!runId,
      refetchInterval: (query) => {
        const data = query.state.data as any;
        const status = data?.run?.status || data?.status;
        const checkpoints = (data?.checkpoints as any[]) || [];
        return status === "running" || checkpoints.some((c) => c.status === "running") ? 2000 : false;
      },
    }
  );

  const executeNode = trpc.emperor.agents.executeNode.useMutation({
    onSuccess: () => { toast.success("节点已开始执行"); refetchRun(); },
    onError: (e) => toast.error("节点执行失败: " + e.message),
  });
  const scheduleRun = trpc.emperor.agents.scheduleRun.useMutation({
    onSuccess: () => { toast.success("调度器已推进"); refetchRun(); },
    onError: (e) => toast.error("调度失败: " + e.message),
  });
  const cancelRun = trpc.emperor.agents.cancelRun.useMutation({
    onSuccess: () => { toast.success("运行已取消"); refetchRun(); },
    onError: (e) => toast.error("取消失败: " + e.message),
  });
  const rerunNode = trpc.emperor.agents.rerunNode.useMutation({
    onSuccess: () => { toast.success("节点已重跑"); refetchRun(); },
    onError: (e) => toast.error("重跑失败: " + e.message),
  });
  const updateDraft = trpc.emperor.agents.updateNodeDraft.useMutation({
    onSuccess: () => { toast.success("草稿已保存"); refetchRun(); },
    onError: (e) => toast.error("保存失败: " + e.message),
  });
  const confirmNode = trpc.emperor.agents.confirmNode.useMutation({
    onSuccess: () => { toast.success("节点已确认"); refetchRun(); },
    onError: (e) => toast.error("确认失败: " + e.message),
  });

  const detail = runData as any;
  const run = detail?.run || detail;
  const checkpoints = (detail?.checkpoints as any[]) || [];
  const events = (detail?.events as any[]) || [];
  const selectedCheckpoint = checkpoints.find((c) => c.nodeId === selectedNodeId)
    || checkpoints.find((c) => c.nodeId === run?.currentNodeId)
    || checkpoints.find((c) => c.status === "waiting_human")
    || checkpoints.find((c) => c.status === "ready")
    || checkpoints[0];
  const busyNodeId = executeNode.variables?.nodeId || confirmNode.variables?.nodeId || rerunNode.variables?.nodeId || updateDraft.variables?.nodeId;
  const hasReadyNodes = checkpoints.some((checkpoint) => checkpoint.status === "ready");
  const isRunTerminal = run?.status === "completed" || run?.status === "canceled";
  const statusLabel: Record<string, string> = {
    pending: "待依赖",
    ready: "可执行",
    running: "执行中",
    waiting_human: "待确认",
    confirmed: "已确认",
    skipped: "已跳过",
    failed: "失败",
  };
  const statusClass: Record<string, string> = {
    pending: "bg-slate-500/15 text-slate-400",
    ready: "bg-blue-500/15 text-blue-300",
    running: "bg-amber-500/15 text-amber-300",
    waiting_human: "bg-violet-500/15 text-violet-300",
    confirmed: "bg-emerald-500/15 text-emerald-300",
    skipped: "bg-slate-500/15 text-slate-400",
    failed: "bg-red-500/15 text-red-300",
  };
  const parseDraft = () => {
    try {
      return JSON.parse(draft);
    } catch {
      return draft;
    }
  };
  const formatJson = (value: unknown) => {
    if (value === undefined || value === null) return "{}";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };
  useEffect(() => {
    if (!selectedCheckpoint) return;
    setSelectedNodeId((current) => current || selectedCheckpoint.nodeId);
    setDraft(formatJson(selectedCheckpoint.userEdit ?? selectedCheckpoint.output ?? {}));
  }, [selectedCheckpoint?.nodeId, selectedCheckpoint?.output, selectedCheckpoint?.userEdit]);
  const selectedEvents = selectedCheckpoint
    ? events.filter((event) => !event.nodeId || event.nodeId === selectedCheckpoint.nodeId).slice(-12)
    : events.slice(-12);

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[520px] max-w-[58vw] bg-[#0d1117] border-l border-white/8 flex flex-col z-10">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          <Play size={14} className="text-emerald-400" />Agent 运行台
        </span>
        <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={14} /></button>
      </div>
      <div className="flex-1 p-4 space-y-4 overflow-auto">
        <div>
          <Label className="text-slate-400 text-xs">输入参数（JSON）</Label>
          <Textarea
            value={inputs}
            onChange={(e) => setInputs(e.target.value)}
            rows={5}
            className="mt-1.5 bg-white/5 border-white/10 text-white text-xs font-mono resize-none"
          />
        </div>
        <Button
          onClick={() => {
            try {
              const parsed = JSON.parse(inputs);
              runMutation.mutate({ slug: agentSlug, inputs: parsed });
            } catch {
              toast.error("输入参数不是有效 JSON");
            }
          }}
          disabled={runMutation.isPending}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          {runMutation.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : <Play size={14} className="mr-2" />}
          运行 Agent
        </Button>
        {run && (
          <div className="rounded-lg bg-white/5 border border-white/8 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">运行状态</span>
              <Badge className={`text-[10px] ${run.status === "completed" ? "bg-emerald-500/20 text-emerald-400" : run.status === "failed" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>
                {run.status === "running" ? <><Loader2 size={10} className="animate-spin inline mr-1" />运行中</> : run.status === "completed" ? "已完成" : run.status === "waiting_human" ? "等待人工" : run.status === "canceled" ? "已取消" : "失败"}
              </Badge>
            </div>
            <div className="text-xs text-slate-500 font-mono break-all">{run.runId}</div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${Number(run.progress || 0)}%` }} />
            </div>
            <div className="grid grid-cols-4 gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={isRunTerminal || scheduleRun.isPending}
                onClick={() => runId && scheduleRun.mutate({ runId, mode: "unlock" })}
                className="h-7 text-[10px] border-white/10 text-slate-300 hover:bg-white/5"
              >
                <GitBranch size={11} className="mr-1" />解锁
              </Button>
              <Button
                size="sm"
                disabled={isRunTerminal || !hasReadyNodes || scheduleRun.isPending}
                onClick={() => runId && scheduleRun.mutate({ runId, mode: "next" })}
                className="h-7 text-[10px] bg-blue-600 hover:bg-blue-500 text-white"
              >
                <Play size={11} className="mr-1" />下一步
              </Button>
              <Button
                size="sm"
                disabled={isRunTerminal || !hasReadyNodes || scheduleRun.isPending}
                onClick={() => runId && scheduleRun.mutate({ runId, mode: "all_ready" })}
                className="h-7 text-[10px] bg-violet-600 hover:bg-violet-500 text-white"
              >
                <SkipForward size={11} className="mr-1" />全部就绪
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isRunTerminal || cancelRun.isPending}
                onClick={() => runId && cancelRun.mutate({ runId, reason: "User canceled from Agent console" })}
                className="h-7 text-[10px] border-red-500/30 text-red-300 hover:bg-red-500/10"
              >
                <X size={11} className="mr-1" />取消
              </Button>
            </div>
          </div>
        )}
        {checkpoints.length > 0 && (
          <div className="grid grid-cols-[190px_1fr] gap-3 min-h-[480px]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-slate-400 text-xs">节点</Label>
                <button onClick={() => refetchRun()} className="text-slate-500 hover:text-white">
                  <RefreshCw size={12} />
                </button>
              </div>
              <div className="space-y-2">
                {checkpoints.map((checkpoint: any) => {
                  const isSelected = selectedCheckpoint?.nodeId === checkpoint.nodeId;
                  return (
                    <button
                      key={checkpoint.nodeId}
                      onClick={() => setSelectedNodeId(checkpoint.nodeId)}
                      className={`w-full text-left rounded-lg border p-2 transition-colors ${isSelected ? "bg-violet-500/15 border-violet-400/50" : "bg-white/5 border-white/8 hover:bg-white/8"}`}
                    >
                      <div className="flex items-start gap-2">
                        {checkpoint.status === "confirmed" ? (
                          <CheckCircle2 size={13} className="mt-0.5 text-emerald-400" />
                        ) : checkpoint.status === "failed" ? (
                          <AlertTriangle size={13} className="mt-0.5 text-red-400" />
                        ) : checkpoint.status === "running" ? (
                          <Loader2 size={13} className="mt-0.5 text-amber-300 animate-spin" />
                        ) : (
                          <Circle size={13} className="mt-0.5 text-slate-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-slate-200 truncate">{checkpoint.nodeLabel || checkpoint.nodeId}</div>
                          <Badge className={`mt-1 text-[9px] px-1.5 py-0 ${statusClass[checkpoint.status] || statusClass.pending}`}>
                            {statusLabel[checkpoint.status] || checkpoint.status}
                          </Badge>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/8 p-3 space-y-3 min-w-0">
              {selectedCheckpoint ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{selectedCheckpoint.nodeLabel || selectedCheckpoint.nodeId}</div>
                      <div className="text-[10px] text-slate-500 font-mono">attempt {selectedCheckpoint.attempt || 0} · {selectedCheckpoint.nodeId}</div>
                    </div>
                    <Badge className={`text-[10px] ${statusClass[selectedCheckpoint.status] || statusClass.pending}`}>
                      {statusLabel[selectedCheckpoint.status] || selectedCheckpoint.status}
                    </Badge>
                  </div>
                  {selectedCheckpoint.errorMessage && (
                    <div className="rounded-md border border-red-500/20 bg-red-500/10 p-2 text-[11px] text-red-200">
                      {selectedCheckpoint.errorMessage}
                    </div>
                  )}
                  <div>
                    <Label className="text-slate-400 text-xs flex items-center gap-1">
                      <FileText size={11} />节点产物 / 人工编辑
                    </Label>
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={12}
                      className="mt-1.5 bg-black/30 border-white/10 text-slate-100 text-[11px] font-mono resize-y"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(selectedCheckpoint.status === "ready" || selectedCheckpoint.status === "failed") && (
                      <Button
                        size="sm"
                        disabled={isRunTerminal || (busyNodeId === selectedCheckpoint.nodeId && executeNode.isPending)}
                        onClick={() => runId && executeNode.mutate({ runId, nodeId: selectedCheckpoint.nodeId })}
                        className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white"
                      >
                        <Play size={12} className="mr-1" />执行
                      </Button>
                    )}
                    {["waiting_human", "confirmed", "failed"].includes(selectedCheckpoint.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isRunTerminal || (busyNodeId === selectedCheckpoint.nodeId && updateDraft.isPending)}
                        onClick={() => runId && updateDraft.mutate({ runId, nodeId: selectedCheckpoint.nodeId, userEdit: parseDraft() })}
                        className="h-8 text-xs border-white/10 text-slate-300 hover:bg-white/5"
                      >
                        <Save size={12} className="mr-1" />保存草稿
                      </Button>
                    )}
                    {selectedCheckpoint.status === "waiting_human" && (
                      <Button
                        size="sm"
                        disabled={isRunTerminal || (busyNodeId === selectedCheckpoint.nodeId && confirmNode.isPending)}
                        onClick={() => runId && confirmNode.mutate({ runId, nodeId: selectedCheckpoint.nodeId, userEdit: parseDraft() })}
                        className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        <CheckCircle2 size={12} className="mr-1" />确认并解锁
                      </Button>
                    )}
                    {["waiting_human", "confirmed", "failed", "skipped"].includes(selectedCheckpoint.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isRunTerminal || (busyNodeId === selectedCheckpoint.nodeId && rerunNode.isPending)}
                        onClick={() => runId && rerunNode.mutate({ runId, nodeId: selectedCheckpoint.nodeId, resetDescendants: true })}
                        className="h-8 text-xs border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                      >
                        <RotateCcw size={12} className="mr-1" />重跑并重置下游
                      </Button>
                    )}
                    {selectedCheckpoint.status === "waiting_human" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isRunTerminal || (busyNodeId === selectedCheckpoint.nodeId && confirmNode.isPending)}
                        onClick={() => runId && confirmNode.mutate({ runId, nodeId: selectedCheckpoint.nodeId, skip: true })}
                        className="h-8 text-xs border-white/10 text-slate-400 hover:bg-white/5"
                      >
                        <SkipForward size={12} className="mr-1" />跳过
                      </Button>
                    )}
                  </div>
                  <div>
                    <Label className="text-slate-400 text-xs flex items-center gap-1">
                      <History size={11} />历史
                    </Label>
                    <div className="mt-1.5 max-h-40 overflow-auto space-y-1.5">
                      {selectedEvents.length === 0 ? (
                        <div className="text-[11px] text-slate-600">暂无历史事件</div>
                      ) : selectedEvents.map((event: any) => (
                        <div key={event.id} className="rounded-md bg-black/20 border border-white/5 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-300">{event.eventType}</span>
                            <span className="text-[9px] text-slate-600">{event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : ""}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 line-clamp-2">{event.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500">选择一个节点查看产物和历史。</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Canvas Component ────────────────────────────────────────────────────

function AgentCanvasInner({ slug }: { slug: string }) {
  const [, navigate] = useLocation();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showRunPanel, setShowRunPanel] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [diffVersions, setDiffVersions] = useState<{ a: number; b: number } | null>(null);

  const { data: agentData, isLoading } = trpc.emperor.agents.get.useQuery({ slug });
  const agent = agentData as any;

  const { data: skillsData } = trpc.emperor.agents.getAvailableSkills.useQuery();
  const { data: modelsData } = trpc.emperor.agents.getAvailableModels.useQuery();
  const { data: mcpToolsData } = trpc.emperor.agents.getAvailableMcpTools.useQuery();
  const { data: toolsData } = trpc.emperor.agents.getAvailableTools.useQuery();

  const skills = (skillsData as any[]) ?? [];
  const models = (modelsData as any[]) ?? [];
  const mcpTools = (mcpToolsData as any[]) ?? [];
  const tools = (toolsData as any[]) ?? [];

  const saveMutation = trpc.emperor.agents.saveWorkflow.useMutation({
    onSuccess: () => { toast.success("工作流已保存"); setIsDirty(false); versionsQuery.refetch(); },
    onError: (e) => toast.error("保存失败: " + e.message),
  });

  // Version history queries & mutations
  const versionsQuery = trpc.emperor.agents.listTemplateVersions.useQuery(
    { slug },
    { enabled: showVersionPanel }
  );
  const versions = (versionsQuery.data as any[]) ?? [];

  const publishMutation = trpc.emperor.agents.publishTemplateVersion.useMutation({
    onSuccess: () => { toast.success("版本已发布"); versionsQuery.refetch(); },
    onError: (e) => toast.error("发布失败: " + e.message),
  });

  const rollbackMutation = trpc.emperor.agents.rollbackTemplateVersion.useMutation({
    onSuccess: () => { toast.success("已回滚到该版本"); versionsQuery.refetch(); },
    onError: (e) => toast.error("回滚失败: " + e.message),
  });

  const rolloutMutation = trpc.emperor.agents.setTemplateRollout.useMutation({
    onSuccess: () => { toast.success("灰度比例已更新"); versionsQuery.refetch(); },
    onError: (e) => toast.error("更新失败: " + e.message),
  });

  const diffQuery = trpc.emperor.agents.diffTemplateVersions.useQuery(
    { slug, baseVersionId: diffVersions?.a ?? undefined, targetVersionId: diffVersions?.b ?? undefined },
    { enabled: !!diffVersions }
  );

  // Load existing workflow
  useEffect(() => {
    if (!agent) return;
    const dag = agent.dagDefinition ?? { nodes: [], edges: [] };
    const rfNodes: Node[] = (dag.nodes ?? []).map((n: any) => ({
      id: n.id,
      type: n.nodeType ?? "skill_node",
      position: { x: n.x ?? 100, y: n.y ?? 100 },
      data: { ...n, label: n.label ?? n.nodeType },
    }));
    const rfEdges: Edge[] = (dag.edges ?? []).map((e: any) => ({
      id: e.id,
      source: e.source ?? e.from,
      target: e.target ?? e.to,
      label: e.label,
      style: { stroke: "#7c3aed", strokeWidth: 2 },
      animated: true,
    }));
    setNodes(rfNodes);
    setEdges(rfEdges);
    setIsDirty(false);
  }, [agent]);

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({ ...params, animated: true } as Edge, eds));
    setIsDirty(true);
  }, [setEdges]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData("application/reactflow");
    if (!nodeType) return;
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    if (!bounds) return;
    const palette = NODE_PALETTE.find(p => p.type === nodeType);
    const newNode: Node = {
      id: `${nodeType}_${Date.now()}`,
      type: nodeType,
      position: {
        x: event.clientX - bounds.left - 90,
        y: event.clientY - bounds.top - 25,
      },
      data: { label: palette?.label ?? nodeType, nodeType },
    };
    setNodes(nds => [...nds, newNode]);
    setIsDirty(true);
  }, [setNodes]);

  const handleNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
    setShowRunPanel(false);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleNodeUpdate = useCallback((id: string, data: Partial<any>) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n));
    setIsDirty(true);
  }, [setNodes]);

  const handleSave = () => {
    const workflow = {
      nodes: nodes.map(n => ({
        id: n.id,
        nodeType: n.type,
        label: (n.data as any).label,
        x: n.position.x,
        y: n.position.y,
        ...n.data,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        from: e.source,
        to: e.target,
        label: e.label,
      })),
    };
    saveMutation.mutate({ slug, workflow });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#080b11]">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#080b11] overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#0d1117] border-b border-white/8 flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/emperor/agents")}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-violet-400" />
            <span className="text-sm font-semibold text-white">{agent?.name ?? slug}</span>
            <span className="text-xs text-slate-500 font-mono">{slug}</span>
            {isDirty && <Badge className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30">未保存</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{nodes.length} 节点 · {edges.length} 连线</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setShowVersionPanel(v => !v); setShowRunPanel(false); setSelectedNode(null); }}
            className={`h-7 text-xs border-white/10 hover:bg-white/5 ${
              showVersionPanel ? "text-violet-400 border-violet-500/40 bg-violet-500/10" : "text-slate-300"
            }`}
          >
            <History size={12} className="mr-1.5" />版本历史
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setShowRunPanel(v => !v); setSelectedNode(null); setShowVersionPanel(false); }}
            className="h-7 text-xs border-white/10 text-slate-300 hover:bg-white/5"
          >
            <Play size={12} className="mr-1.5" />运行测试
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="h-7 text-xs bg-violet-600 hover:bg-violet-500 text-white"
          >
            {saveMutation.isPending ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
            保存
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Node Palette */}
        <div className="w-44 flex-shrink-0 bg-[#0d1117] border-r border-white/8 overflow-auto py-3 z-10">
          <div className="px-3 mb-2">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">节点类型</span>
          </div>
          {NODE_PALETTE.map((p) => {
            const IconComp = p.icon;
            return (
              <div
                key={p.type}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/reactflow", p.type)}
                className="flex items-center gap-2 mx-2 mb-1 px-2 py-2 rounded-lg cursor-grab hover:bg-white/5 transition-colors group"
              >
                <div
                  className="rounded p-1 flex-shrink-0"
                  style={{ background: `${p.color}20`, border: `1px solid ${p.color}30` }}
                >
                  <IconComp size={12} style={{ color: p.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-300 truncate">{p.label}</div>
                  <div className="text-[9px] text-slate-600 truncate leading-tight">{p.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes) => { onNodesChange(changes); setIsDirty(true); }}
            onEdgesChange={(changes) => { onEdgesChange(changes); setIsDirty(true); }}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            fitView
            style={{ background: "#080b11" }}
            deleteKeyCode="Delete"
          >
            <Background color="#1e2030" gap={24} size={1} />
            <Controls
              style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)" }}
            />
            <MiniMap
              style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)" }}
              nodeColor={(n) => NODE_COLORS[n.type ?? ""]?.color ?? "#7c3aed"}
            />
            <Panel position="top-center">
              {nodes.length === 0 && (
                <div className="text-center py-2 px-4 rounded-lg bg-white/5 border border-white/8 text-xs text-slate-500">
                  从左侧拖拽节点到画布开始编排
                </div>
              )}
            </Panel>
          </ReactFlow>
        </div>

        {/* Right Panel: Node Properties or Run Panel */}
        {selectedNode && (
          <NodePropertyPanel
            node={selectedNode}
            onUpdate={handleNodeUpdate}
            onClose={() => setSelectedNode(null)}
            skills={skills}
            models={models}
            mcpTools={mcpTools}
            tools={tools}
          />
        )}
        {showRunPanel && !selectedNode && !showVersionPanel && (
          <RunPanel agentSlug={slug} onClose={() => setShowRunPanel(false)} />
        )}
        {showVersionPanel && (
          <div className="w-80 flex-shrink-0 bg-[#0d1117] border-l border-white/8 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
              <div className="flex items-center gap-2">
                <History size={14} className="text-violet-400" />
                <span className="text-sm font-semibold text-white">版本历史</span>
              </div>
              <button onClick={() => setShowVersionPanel(false)} className="text-slate-500 hover:text-white">
                <X size={14} />
              </button>
            </div>

            {/* Diff View */}
            {diffVersions && (
              <div className="px-3 py-2 bg-[#0a0f1a] border-b border-white/8">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-violet-400 font-semibold uppercase tracking-wider">版本对比</span>
                  <button onClick={() => setDiffVersions(null)} className="text-slate-500 hover:text-white"><X size={10} /></button>
                </div>
                {diffQuery.isLoading ? (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 size={10} className="animate-spin" />加载中...</div>
                ) : diffQuery.data ? (
                  <div className="text-[10px] text-slate-400 space-y-1">
                    <div className="flex gap-2">
                      <span className="text-green-400">A: v{(diffQuery.data as any).baseVersionId ?? diffVersions?.a}</span>
                      <GitCompare size={10} className="text-slate-600 mt-0.5" />
                      <span className="text-blue-400">B: v{(diffQuery.data as any).targetVersionId ?? diffVersions?.b}</span>
                    </div>
                    <pre className="bg-black/30 rounded p-2 text-[9px] overflow-auto max-h-32 text-slate-300 whitespace-pre-wrap">
                      {JSON.stringify((diffQuery.data as any).diff ?? {}, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            )}

            {/* Version List */}
            <div className="flex-1 overflow-auto">
              {versionsQuery.isLoading ? (
                <div className="flex items-center justify-center h-20">
                  <Loader2 size={16} className="animate-spin text-slate-500" />
                </div>
              ) : versions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-20 text-slate-600">
                  <GitCommit size={20} className="mb-1" />
                  <span className="text-xs">暂无版本记录</span>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {versions.map((v: any, idx: number) => (
                    <div key={v.id ?? v.version} className="px-3 py-2.5 hover:bg-white/3 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[11px] font-mono font-semibold text-violet-300">v{v.version}</span>
                            {v.isDefault && (
                              <Badge className="text-[9px] h-4 px-1 bg-green-500/20 text-green-400 border-green-500/30">当前</Badge>
                            )}
                            {v.rolloutPercent != null && v.rolloutPercent < 100 && (
                              <Badge className="text-[9px] h-4 px-1 bg-amber-500/20 text-amber-400 border-amber-500/30">
                                {v.rolloutPercent}% 灰度
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {v.releaseNotes || "无备注"}
                          </div>
                          <div className="text-[9px] text-slate-600 mt-0.5">
                            {v.createdAt ? new Date(v.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          {!v.isDefault && (
                            <button
                              onClick={() => publishMutation.mutate({ slug, versionId: v.id, rolloutPercent: 100 })}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-400 hover:bg-violet-600/40 border border-violet-500/20 flex items-center gap-0.5"
                            >
                              <Rocket size={8} />发布
                            </button>
                          )}
                          {!v.isDefault && (
                            <button
                              onClick={() => rollbackMutation.mutate({ slug, targetVersion: v.version })}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 border border-amber-500/20 flex items-center gap-0.5"
                            >
                              <Undo2 size={8} />回滚
                            </button>
                          )}
                          {idx > 0 && (
                            <button
                              onClick={() => setDiffVersions({ a: Number(versions[idx - 1].version), b: Number(v.version) })}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 border border-blue-500/20 flex items-center gap-0.5"
                            >
                              <GitCompare size={8} />对比
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Rollout slider for non-default versions */}
                      {!v.isDefault && v.rolloutPercent != null && (
                        <div className="mt-1.5">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] text-slate-600">灰度流量</span>
                            <span className="text-[9px] text-slate-400">{v.rolloutPercent ?? 0}%</span>
                          </div>
                          <input
                            type="range" min={0} max={100} step={5}
                            defaultValue={v.rolloutPercent ?? 0}
                            onMouseUp={(e) => rolloutMutation.mutate({ slug, versionId: v.id, rolloutPercent: Number((e.target as HTMLInputElement).value) })}
                            className="w-full h-1 accent-violet-500 cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentCanvas() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  if (!slug) return <div className="text-white p-8">Invalid agent slug</div>;

  return (
    <ReactFlowProvider>
      <AgentCanvasInner slug={slug} />
    </ReactFlowProvider>
  );
}
