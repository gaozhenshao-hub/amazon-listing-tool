import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, ArrowLeft, Braces, FileSearch, LibraryBig, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

type RunLedgerPanelProps = { onBack: () => void };

function time(value?: string | Date | null) {
  if (!value) return "-";
  try { return format(new Date(value), "MM-dd HH:mm:ss", { locale: zhCN }); } catch { return String(value); }
}

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export default function RunLedgerPanel({ onBack }: RunLedgerPanelProps) {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"events" | "context" | "compiler">("events");
  const { data: traces = [], isLoading, refetch } = trpc.emperor.observability.traces.useQuery({ limit: 100 });
  const { data: detail, isLoading: detailLoading } = trpc.emperor.observability.traceDetail.useQuery(
    { traceId: selectedTraceId! },
    { enabled: Boolean(selectedTraceId) },
  );

  return (
    <>
      <aside className="w-80 shrink-0 border-r flex flex-col min-h-0">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-semibold">执行轨迹</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Agent、Job、人工确认与上下文</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="刷新执行轨迹">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> 返回 Skill 运行历史
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          {isLoading ? <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : null}
          {!isLoading && traces.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              暂无新的 Agent Trace。启动一个皇帝 Agent 后，这里会显示可回放的执行轨迹。
            </div>
          ) : null}
          <div className="p-2 space-y-1">
            {(traces as any[]).map((trace) => (
              <button
                key={trace.traceId}
                className={`w-full p-3 rounded-lg text-left transition-colors ${selectedTraceId === trace.traceId ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"}`}
                onClick={() => { setSelectedTraceId(trace.traceId); setDetailMode("events"); }}
              >
                <div className="flex gap-2 items-start"><Activity className="h-3.5 w-3.5 mt-0.5 text-primary" /><span className="text-sm font-medium truncate">{trace.agentSlug || trace.rootRunType}</span></div>
                <div className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{trace.traceId}</span><Badge variant="secondary" className="text-[10px] h-5">{trace.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{time(trace.updatedAt || trace.createdAt)}</p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        {!selectedTraceId ? (
          <div className="flex-1 flex flex-col justify-center items-center text-muted-foreground"><FileSearch className="h-12 w-12 opacity-20 mb-4" /><p className="text-sm">从左侧选择一条 Agent 执行轨迹</p></div>
        ) : detailLoading ? (
          <div className="flex-1 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !detail ? (
          <div className="flex-1 flex justify-center items-center text-sm text-muted-foreground">Trace 不存在或已被清理</div>
        ) : (
          <>
            <div className="p-5 border-b">
              <div className="flex items-center gap-2"><Badge>Trace</Badge><h2 className="font-semibold">{(detail as any).trace.agentSlug || (detail as any).trace.rootRunType}</h2><span className="font-mono text-xs text-muted-foreground">{(detail as any).trace.traceId}</span></div>
              <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
                <div><p className="text-xs text-muted-foreground">状态</p><p className="font-medium">{(detail as any).trace.status}</p></div>
                <div><p className="text-xs text-muted-foreground">开始</p><p className="font-medium">{time((detail as any).trace.startedAt)}</p></div>
                <div><p className="text-xs text-muted-foreground">事件数</p><p className="font-medium">{(detail as any).events.length}</p></div>
                <div><p className="text-xs text-muted-foreground">上下文清单</p><p className="font-medium">{(detail as any).manifests.length}</p></div>
              </div>
            </div>
            <div className="border-b px-5 flex gap-1">
              <button className={`px-3 py-2.5 text-sm border-b-2 ${detailMode === "events" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setDetailMode("events")}>事件时间线</button>
              <button className={`px-3 py-2.5 text-sm border-b-2 ${detailMode === "context" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setDetailMode("context")}><Braces className="inline h-3.5 w-3.5 mr-1" />Context Manifest</button>
              <button className={`px-3 py-2.5 text-sm border-b-2 ${detailMode === "compiler" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setDetailMode("compiler")}><LibraryBig className="inline h-3.5 w-3.5 mr-1" />上下文编译</button>
            </div>
            <ScrollArea className="flex-1 min-h-0 p-5">
              {detailMode === "events" ? <div className="space-y-3">{(detail as any).events.map((event: any) => <div key={event.eventId} className="border rounded-lg p-3"><div className="flex justify-between gap-3"><div><Badge variant="outline" className="mr-2">{event.entityType}</Badge><span className="font-medium text-sm">{event.eventType}</span></div><span className="text-xs text-muted-foreground">{time(event.occurredAt)}</span></div><pre className="mt-3 p-3 rounded bg-muted/50 text-xs overflow-auto whitespace-pre-wrap break-words">{pretty(event.payload)}</pre></div>)}</div> : detailMode === "context" ? <div className="space-y-4">{(detail as any).manifests.map((manifest: any) => <div key={manifest.manifestId} className="border rounded-lg p-4"><div className="flex justify-between gap-3"><div><p className="font-medium text-sm">节点 {manifest.nodeId || "Run 入口"}</p><p className="text-xs text-muted-foreground font-mono">{manifest.contextHash}</p></div><span className="text-xs text-muted-foreground">{time(manifest.createdAt)}</span></div><pre className="mt-3 p-3 rounded bg-muted/50 text-xs overflow-auto whitespace-pre-wrap break-words">{pretty(manifest.manifest)}</pre></div>)}</div> : <CompilerOverview manifests={(detail as any).manifests || []} />}
            </ScrollArea>
          </>
        )}
      </section>
    </>
  );
}

function CompilerOverview({ manifests }: { manifests: any[] }) {
  const compiled = manifests.map((item) => ({ item, context: item?.manifest?.input?.contextPackage })).filter(({ context }) => context?.compiler);
  if (compiled.length === 0) return <div className="py-16 text-center text-sm text-muted-foreground"><LibraryBig className="h-9 w-9 mx-auto mb-3 opacity-30" /><p>本次运行没有启用 Context Compiler。</p><p className="text-xs mt-1">未启用节点继续使用原有上下文包，不会改变既有Skill输入。</p></div>;
  return <div className="space-y-4">{compiled.map(({ item, context }) => <div key={item.manifestId} className="border rounded-lg p-4 space-y-4"><div className="flex justify-between gap-3"><div><p className="font-medium text-sm">节点 {item.nodeId || "Run 入口"} · Context Compiler</p><p className="text-xs text-muted-foreground font-mono">策略 {context.compiler.policyHash.slice(0, 16)}… · {context.compiler.selectedKnowledgeCount} 条知识引用</p></div><span className="text-xs text-muted-foreground">{time(item.createdAt)}</span></div><div className="grid md:grid-cols-2 gap-3"><div className="rounded-md bg-muted/40 p-3"><p className="text-xs font-medium text-muted-foreground mb-2"><LibraryBig className="inline h-3.5 w-3.5 mr-1" />已编译知识来源</p>{(context.knowledge || []).length ? <div className="space-y-2">{context.knowledge.map((knowledge: any) => <div key={knowledge.knowledgeId} className="text-xs"><p className="font-medium">{knowledge.title}</p><p className="text-muted-foreground">#{knowledge.knowledgeId} · {knowledge.memoryType} · 匹配：{(knowledge.matchedTerms || []).join("、") || "策略筛选"}</p></div>)}</div> : <p className="text-xs text-muted-foreground">没有匹配到可用知识。</p>}</div><div className="rounded-md bg-muted/40 p-3"><p className="text-xs font-medium text-muted-foreground mb-2"><ShieldCheck className="inline h-3.5 w-3.5 mr-1" />Tool治理边界</p><p className="text-xs">模式：{context.toolPolicy?.mode || "catalog_only"}</p><p className="text-xs mt-1">执行：{context.toolPolicy?.execution || "not_requested"}</p><p className="text-xs mt-1 text-muted-foreground">Shell：{context.toolPolicy?.shell === "denied" ? "已拒绝" : "未声明"}</p></div></div></div>)}</div>;
}
