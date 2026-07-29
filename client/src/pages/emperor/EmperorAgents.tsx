import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Loader2, Network, Plus, Pencil, Trash2, Play, ChevronRight,
  GitBranch, Zap, ArrowRight, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";

interface DAGNode {
  id: string;
  skillSlug: string;
  skillName?: string;
  label: string;
  x: number;
  y: number;
  condition?: string;
}
interface DAGEdge { id: string; from: string; to: string; label?: string; }
interface DAGDefinition { nodes: DAGNode[]; edges: DAGEdge[]; }
interface Agent {
  id: number; slug: string; name: string; description: string | null;
  category: string; status: string; callCount: number;
  dagDefinition?: DAGDefinition;
  steps?: Array<{ order: number; skillSlug: string; skillName?: string; condition?: string }>;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  Released: "bg-green-100 text-green-700", Draft: "bg-gray-100 text-gray-600",
  Validated: "bg-blue-100 text-blue-700", Deprecated: "bg-red-100 text-red-600",
};

function slugify(n: string) {
  return n.toLowerCase().replace(/[\s\u4e00-\u9fa5]+/g, "-")
    .replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "")
    || `agent-${Date.now()}`;
}

function DAGCanvas({ dag, onChange, skills, readonly }: {
  dag: DAGDefinition; onChange?: (d: DAGDefinition) => void;
  skills: Array<{ slug: string; name: string }>; readonly?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const NW = 160, NH = 52;

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if (readonly) return;
    e.stopPropagation();
    const node = dag.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    setDragging(nodeId);
    setDragOffset({ x: e.clientX - r.left - node.x, y: e.clientY - r.top - node.y });
    setSelectedNode(nodeId);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !onChange) return;
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.max(10, e.clientX - r.left - dragOffset.x);
    const y = Math.max(10, e.clientY - r.top - dragOffset.y);
    onChange({ ...dag, nodes: dag.nodes.map(n => n.id === dragging ? { ...n, x, y } : n) });
  }, [dragging, dragOffset, dag, onChange]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
  }, [handleMouseMove, handleMouseUp]);

  const addNode = () => {
    if (!onChange) return;
    const skill = skills[0];
    onChange({ ...dag, nodes: [...dag.nodes, { id: `node-${Date.now()}`, skillSlug: skill?.slug || "", skillName: skill?.name || "", label: skill?.name || "新节点", x: 80 + dag.nodes.length * 200, y: 120 }] });
  };

  const removeNode = (nodeId: string) => {
    if (!onChange) return;
    onChange({ nodes: dag.nodes.filter(n => n.id !== nodeId), edges: dag.edges.filter(e => e.from !== nodeId && e.to !== nodeId) });
    if (selectedNode === nodeId) setSelectedNode(null);
  };

  const addEdge = (toId: string) => {
    if (!connectFrom || !onChange || connectFrom === toId) { setConnectFrom(null); return; }
    if (dag.edges.some(e => e.from === connectFrom && e.to === toId)) { setConnectFrom(null); return; }
    onChange({ ...dag, edges: [...dag.edges, { id: `edge-${Date.now()}`, from: connectFrom, to: toId }] });
    setConnectFrom(null);
  };

  const getEdgePath = (edge: DAGEdge) => {
    const f = dag.nodes.find(n => n.id === edge.from);
    const t = dag.nodes.find(n => n.id === edge.to);
    if (!f || !t) return "";
    const x1 = f.x + NW, y1 = f.y + NH / 2, x2 = t.x, y2 = t.y + NH / 2, cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
  };

  const svgW = Math.max(600, ...dag.nodes.map(n => n.x + NW + 60));
  const svgH = Math.max(300, ...dag.nodes.map(n => n.y + NH + 60));

  return (
    <div className="relative border rounded-xl bg-muted/20 overflow-hidden">
      {!readonly && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={addNode}>
            <Plus className="h-3 w-3 mr-1" />添加节点
          </Button>
          {connectFrom && (
            <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/30 rounded-lg px-2 py-1">
              <ArrowRight className="h-3 w-3 text-primary" />
              <span className="text-xs text-primary">点击目标节点连线</span>
              <button onClick={() => setConnectFrom(null)} className="text-primary hover:text-red-500"><X className="h-3 w-3" /></button>
            </div>
          )}
        </div>
      )}
      <svg ref={svgRef} width={svgW} height={svgH} className="block" style={{ cursor: dragging ? "grabbing" : "default" }} onClick={() => { setSelectedNode(null); setConnectFrom(null); }}>
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" className="text-border opacity-40" />
          </pattern>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="hsl(var(--primary))" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        {dag.edges.map(edge => (
          <g key={edge.id}>
            <path d={getEdgePath(edge)} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" markerEnd="url(#arrowhead)" opacity="0.7" />
            {!readonly && <path d={getEdgePath(edge)} fill="none" stroke="transparent" strokeWidth="12" className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onChange && onChange({ ...dag, edges: dag.edges.filter(e2 => e2.id !== edge.id) }); }} />}
          </g>
        ))}
        {dag.nodes.map((node, idx) => {
          const isSel = selectedNode === node.id, isCF = connectFrom === node.id;
          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <rect width={NW} height={NH} rx="10" ry="10"
                fill={isSel || isCF ? "hsl(var(--primary))" : "hsl(var(--card))"}
                stroke={isSel || isCF ? "hsl(var(--primary))" : "hsl(var(--border))"}
                strokeWidth="1.5" className="cursor-grab drop-shadow-sm"
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onClick={(e) => { e.stopPropagation(); if (connectFrom) { addEdge(node.id); return; } setSelectedNode(isSel ? null : node.id); }}
              />
              <circle cx="20" cy={NH / 2} r="10" fill={isSel ? "rgba(255,255,255,0.2)" : "hsl(var(--primary)/0.1)"} />
              <text x="20" y={NH / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill={isSel ? "white" : "hsl(var(--primary))"}>{idx + 1}</text>
              <text x="38" y={NH / 2 - 6} fontSize="12" fontWeight="600" fill={isSel ? "white" : "hsl(var(--foreground))"}>{node.label.length > 14 ? node.label.slice(0, 14) + "…" : node.label}</text>
              <text x="38" y={NH / 2 + 8} fontSize="10" fill={isSel ? "rgba(255,255,255,0.7)" : "hsl(var(--muted-foreground))"}>{node.skillSlug.length > 18 ? node.skillSlug.slice(0, 18) + "…" : node.skillSlug}</text>
              {!readonly && <g transform={`translate(${NW - 14}, ${NH / 2 - 7})`} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setConnectFrom(isCF ? null : node.id); }}><circle r="7" fill={isCF ? "hsl(var(--primary))" : "hsl(var(--muted))"} /><text x="0" y="4" textAnchor="middle" fontSize="10" fill={isCF ? "white" : "hsl(var(--muted-foreground))"}>{"→"}</text></g>}
              {!readonly && isSel && <g transform={`translate(${NW - 14}, -8)`} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}><circle r="7" fill="hsl(var(--destructive))" /><text x="0" y="4" textAnchor="middle" fontSize="10" fill="white">{"×"}</text></g>}
            </g>
          );
        })}
      </svg>
      {!readonly && selectedNode && (() => {
        const node = dag.nodes.find(n => n.id === selectedNode);
        if (!node) return null;
        return (
          <div className="absolute bottom-3 left-3 right-3 bg-background border rounded-xl p-3 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold">编辑节点</span>
              <button onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">选择 Skill</label>
                <Select value={node.skillSlug} onValueChange={(v) => { if (!onChange) return; const s = skills.find(sk => sk.slug === v); onChange({ ...dag, nodes: dag.nodes.map(n => n.id === node.id ? { ...n, skillSlug: v, skillName: s?.name || v, label: s?.name || v } : n) }); }}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{skills.map(s => <SelectItem key={s.slug} value={s.slug} className="text-xs">{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">条件（可选）</label>
                <Input value={node.condition || ""} onChange={(e) => onChange && onChange({ ...dag, nodes: dag.nodes.map(n => n.id === node.id ? { ...n, condition: e.target.value } : n) })} placeholder="如：output.success === true" className="h-7 text-xs font-mono" />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function AgentFormDialog({ open, onOpenChange, initialData, skills, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; initialData?: Agent;
  skills: Array<{ slug: string; name: string }>; onSaved: () => void;
}) {
  const isEdit = !!initialData;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("通用");
  const [status, setStatus] = useState<"Draft" | "Validated" | "Released" | "Deprecated">("Draft");
  const [dag, setDag] = useState<DAGDefinition>({ nodes: [], edges: [] });

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setName(initialData.name); setSlug(initialData.slug);
      setDescription(initialData.description || ""); setCategory(initialData.category || "通用");
      setStatus(initialData.status as any || "Draft");
      setDag(initialData.dagDefinition || { nodes: [], edges: [] });
    } else { setName(""); setSlug(""); setDescription(""); setCategory("通用"); setStatus("Draft"); setDag({ nodes: [], edges: [] }); }
  }, [open, initialData]);

  const upsertMutation = trpc.emperor.agents.upsert.useMutation({
    onSuccess: () => { toast.success(isEdit ? "已更新" : "已创建"); onSaved(); onOpenChange(false); },
    onError: (e) => toast.error("保存失败: " + e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? "编辑 Agent" : "新建 Agent"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Agent 名称 *</label>
              <Input value={name} onChange={(e) => { const n = e.target.value; setName(n); if (!isEdit) setSlug(slugify(n)); }} placeholder="例如：关键词分析 Agent" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Slug</label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} disabled={isEdit} className={isEdit ? "opacity-60" : ""} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">描述</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="resize-none min-h-[60px]" placeholder="描述该 Agent 的功能..." />
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">分类</label>
                <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="通用" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">状态</label>
                <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{["Draft","Validated","Released","Deprecated"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">DAG 流程图 — 拖拽节点调整位置，点击 → 按钮后再点击目标节点连线</label>
            <DAGCanvas dag={dag} onChange={setDag} skills={skills} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => {
            if (!name.trim()) { toast.error("请填写 Agent 名称"); return; }
            const s = isEdit ? slug : (slug || slugify(name));
            upsertMutation.mutate({ slug: s, name, description: description || undefined, category, status, dagDefinition: dag });
          }} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "保存更改" : "创建 Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function EmperorAgents() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("dag");

  const { data: listData, isLoading } = trpc.emperor.agents.list.useQuery();
  const agents = (listData || []) as Agent[];
  const { data: detailData } = trpc.emperor.agents.get.useQuery({ slug: selectedSlug! }, { enabled: !!selectedSlug });
  const detail = detailData as Agent | undefined;
  const { data: skillsData } = trpc.emperor.skills.list.useQuery({ page: 1, pageSize: 200 });
  const skills = ((skillsData as any)?.skills || []).map((s: any) => ({ slug: s.slug, name: s.name }));

  const deleteMutation = trpc.emperor.agents.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); setDeletingSlug(null); if (selectedSlug === deletingSlug) setSelectedSlug(null); utils.emperor.agents.list.invalidate(); },
    onError: (e) => toast.error("删除失败: " + e.message),
  });

  const selectedAgent = agents.find(a => a.slug === selectedSlug);

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        <div className="w-[260px] flex-shrink-0 border-r flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2"><Network className="h-4 w-4 text-primary" /><span className="font-semibold text-sm">Agent 编排</span></div>
              {isAdmin && <button onClick={() => { setEditingAgent(null); setShowCreate(true); }} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>}
            </div>
            <p className="text-xs text-muted-foreground">{isLoading ? "加载中..." : `${agents.length} 个 Agent`}</p>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              : agents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Network className="h-8 w-8 mb-2 opacity-30" /><p className="text-xs">暂无 Agent</p>
                  {isAdmin && <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => setShowCreate(true)}><Plus className="h-3 w-3 mr-1" />新建</Button>}
                </div>
              ) : (
                <div className="p-2 space-y-0.5">
                  {agents.map((agent) => (
                    <button key={agent.id} onClick={() => setSelectedSlug(agent.slug)} className={cn("w-full text-left px-3 py-2.5 rounded-lg transition-all group", selectedSlug === agent.slug ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{agent.name}</span>
                        <ChevronRight className={cn("h-3.5 w-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100", selectedSlug === agent.slug && "opacity-100")} />
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={cn("text-xs border-0 h-4 px-1.5", STATUS_COLORS[agent.status] || "bg-gray-100 text-gray-600")}>{agent.status}</Badge>
                        <span className={cn("text-xs flex items-center gap-1", selectedSlug === agent.slug ? "text-primary-foreground/70" : "text-muted-foreground")}><GitBranch className="h-3 w-3" />{(agent.dagDefinition?.nodes || agent.steps || []).length} 步</span>
                        {agent.callCount > 0 && <span className={cn("text-xs flex items-center gap-1", selectedSlug === agent.slug ? "text-primary-foreground/70" : "text-muted-foreground")}><Zap className="h-3 w-3" />{agent.callCount}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
          </ScrollArea>
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          {selectedAgent ? (
            <>
              <div className="p-5 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1.5">
                      <h2 className="text-lg font-semibold">{selectedAgent.name}</h2>
                      <Badge className={cn("text-xs border-0", STATUS_COLORS[selectedAgent.status] || "bg-gray-100 text-gray-600")}>{selectedAgent.status}</Badge>
                      <Badge variant="outline" className="text-xs">{selectedAgent.category}</Badge>
                    </div>
                    {selectedAgent.description && <p className="text-sm text-muted-foreground">{selectedAgent.description}</p>}
                    <p className="text-xs text-muted-foreground/60 font-mono mt-1">{selectedAgent.slug}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => { setRunningId(selectedAgent.id); setTimeout(() => { setRunningId(null); toast.success(`Agent "${selectedAgent.name}" 已触发运行`); }, 1500); }} disabled={runningId === selectedAgent.id}>
                      {runningId === selectedAgent.id ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />运行中</> : <><Play className="h-3.5 w-3.5 mr-1.5" />运行</>}
                    </Button>
                    {isAdmin && <>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => { setEditingAgent(selectedAgent); setShowCreate(true); }}><Pencil className="h-3.5 w-3.5 mr-1.5" />编辑</Button>
                      <Button size="sm" variant="outline" className="h-8 hover:text-red-600 hover:border-red-300" onClick={() => setDeletingSlug(selectedAgent.slug)}><Trash2 className="h-3.5 w-3.5 mr-1.5" />删除</Button>
                    </>}
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                  <div className="px-5 pt-3 border-b"><TabsList className="h-8"><TabsTrigger value="dag" className="text-xs h-7">DAG 流程图</TabsTrigger><TabsTrigger value="steps" className="text-xs h-7">执行步骤</TabsTrigger></TabsList></div>
                  <TabsContent value="dag" className="flex-1 overflow-auto p-5 mt-0">
                    {detail ? <DAGCanvas dag={detail.dagDefinition || { nodes: [], edges: [] }} skills={skills} readonly /> : <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
                  </TabsContent>
                  <TabsContent value="steps" className="flex-1 overflow-auto p-5 mt-0">
                    {detail ? (
                      <div className="max-w-xl space-y-2">
                        {(detail.dagDefinition?.nodes || []).length === 0 ? (
                          <div className="text-center py-10 text-muted-foreground"><GitBranch className="h-8 w-8 mx-auto mb-2 opacity-30" /><p className="text-sm">暂无执行步骤</p></div>
                        ) : detail.dagDefinition!.nodes.map((node, idx) => (
                          <div key={node.id} className="flex items-start gap-3 p-3 rounded-xl border bg-card">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">{idx + 1}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{node.label}</p>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">{node.skillSlug}</p>
                              {node.condition && <p className="text-xs text-amber-600 mt-1 font-mono">条件: {node.condition}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
                  </TabsContent>
                </Tabs>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Network className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">选择一个 Agent 查看详情</p>
              <p className="text-xs mt-1 opacity-60">Agent 是多个 Skill 的有序编排，支持条件分支</p>
              {isAdmin && <Button size="sm" variant="outline" className="mt-4" onClick={() => setShowCreate(true)}><Plus className="h-3.5 w-3.5 mr-1.5" />新建 Agent</Button>}
            </div>
          )}
        </div>
      </div>
      <AgentFormDialog open={showCreate || !!editingAgent} onOpenChange={(v) => { if (!v) { setShowCreate(false); setEditingAgent(null); } }} initialData={editingAgent || undefined} skills={skills} onSaved={() => { utils.emperor.agents.list.invalidate(); if (selectedSlug) utils.emperor.agents.get.invalidate({ slug: selectedSlug }); }} />
      <AlertDialog open={!!deletingSlug} onOpenChange={(v) => !v && setDeletingSlug(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除 Agent？</AlertDialogTitle><AlertDialogDescription>此操作不可撤销。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deletingSlug && deleteMutation.mutate({ slug: deletingSlug })}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
