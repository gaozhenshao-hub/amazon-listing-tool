import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, ArrowLeft, Braces, FileSearch, LibraryBig, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

type RunLedgerPanelProps = { onBack: () => void };
type RecordValue = Record<string, unknown>;
type RunSummary = { runId: string; label: string; status: string; createdAt: string | Date | null };
type RunDetail = { runId: string; label: string; status: string; startedAt: string | Date | null; input: unknown; traceId: string | null };
type LedgerEvent = { eventId: string; entityType: string; eventType: string; occurredAt: string | Date | null; payload: unknown };
type ContextSource = { sourceType: string; sourceKey: string; status: string; invalidationReason: string | null };
type ContextPackage = {
  compiler: { policyHash: string; selectedKnowledgeCount: number };
  knowledge: RecordValue[];
  toolPolicy: RecordValue | null;
};

function time(value?: string | Date | null) {
  if (!value) return "-";
  try { return format(new Date(value), "MM-dd HH:mm:ss", { locale: zhCN }); } catch { return String(value); }
}

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dateValue(value: unknown): string | Date | null {
  return typeof value === "string" || value instanceof Date ? value : null;
}

function runSummaries(value: unknown): RunSummary[] {
  const rows = asRecord(value)?.runs;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): RunSummary[] => {
    const run = asRecord(row);
    const runId = stringValue(run?.runId);
    if (!runId) return [];
    return [{
      runId,
      label: stringValue(run?.skillName) || stringValue(run?.skillSlug) || runId,
      status: stringValue(run?.status) || "unknown",
      createdAt: dateValue(run?.createdAt),
    }];
  });
}

function runDetail(value: unknown): RunDetail | null {
  const run = asRecord(value);
  const runId = stringValue(run?.runId);
  if (!run || !runId) return null;
  const traceId = stringValue(run.traceId);
  return {
    runId,
    label: stringValue(run.skillName) || stringValue(run.skillSlug) || runId,
    status: stringValue(run.status) || "unknown",
    startedAt: dateValue(run.startedAt) || dateValue(run.createdAt),
    input: run.input,
    traceId: traceId || null,
  };
}

function ledgerEvents(value: unknown): LedgerEvent[] {
  const rows = asRecord(value)?.events;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): LedgerEvent[] => {
    const event = asRecord(row);
    const eventId = stringValue(event?.eventId);
    if (!event || !eventId) return [];
    return [{
      eventId,
      entityType: stringValue(event.entityType) || "system",
      eventType: stringValue(event.eventType) || "unknown",
      occurredAt: dateValue(event.occurredAt),
      payload: event.payload,
    }];
  });
}

function contextSources(value: unknown): ContextSource[] {
  const rows = asRecord(value)?.provenance;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): ContextSource[] => {
    const source = asRecord(row);
    const sourceKey = stringValue(source?.sourceKey);
    if (!source || !sourceKey) return [];
    return [{
      sourceType: stringValue(source.sourceType) || "unknown",
      sourceKey,
      status: stringValue(source.status) || "unknown",
      invalidationReason: stringValue(source.invalidationReason) || null,
    }];
  });
}

function contextPackage(input: unknown): ContextPackage | null {
  const root = asRecord(input);
  const nestedContext = asRecord(root?.context);
  const context = asRecord(root?.contextPackage) || asRecord(nestedContext?.contextPackage);
  const compiler = asRecord(context?.compiler);
  if (!context || !compiler) return null;
  const knowledge = Array.isArray(context.knowledge)
    ? context.knowledge.flatMap((item): RecordValue[] => {
      const record = asRecord(item);
      return record ? [record] : [];
    })
    : [];
  return {
    compiler: {
      policyHash: stringValue(compiler.policyHash),
      selectedKnowledgeCount: numberValue(compiler.selectedKnowledgeCount),
    },
    knowledge,
    toolPolicy: asRecord(context.toolPolicy),
  };
}

export default function RunLedgerPanel({ onBack }: RunLedgerPanelProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"events" | "context" | "compiler">("events");
  const history = trpc.emperor.run.history.useQuery({ page: 1, pageSize: 100 });
  const detailQuery = trpc.emperor.run.getDetail.useQuery(
    { runId: selectedRunId || "" },
    { enabled: Boolean(selectedRunId) },
  );
  const detail = useMemo(() => runDetail(detailQuery.data), [detailQuery.data]);
  const projection = trpc.emperor.observability.runProjection.useQuery(
    { traceId: detail?.traceId || "", afterId: 0, limit: 300 },
    { enabled: Boolean(detail?.traceId) },
  );
  const runs = useMemo(() => runSummaries(history.data), [history.data]);
  const events = useMemo(() => ledgerEvents(projection.data), [projection.data]);
  const sources = useMemo(() => contextSources(projection.data), [projection.data]);
  const detailLoading = detailQuery.isLoading || (Boolean(detail?.traceId) && projection.isLoading);

  return (
    <>
      <aside className="w-80 shrink-0 border-r flex flex-col min-h-0">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-semibold">执行轨迹</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Skill 运行、审计事件与上下文</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => history.refetch()} aria-label="刷新执行轨迹">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> 返回 Skill 运行历史
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          {history.isLoading ? <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : null}
          {!history.isLoading && runs.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              暂无 Skill 运行。运行受治理的 Skill 后，这里会显示其可验证的 Trace 投影。
            </div>
          ) : null}
          <div className="p-2 space-y-1">
            {runs.map((run) => (
              <button
                key={run.runId}
                className={`w-full p-3 rounded-lg text-left transition-colors ${selectedRunId === run.runId ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"}`}
                onClick={() => { setSelectedRunId(run.runId); setDetailMode("events"); }}
              >
                <div className="flex gap-2 items-start"><Activity className="h-3.5 w-3.5 mt-0.5 text-primary" /><span className="text-sm font-medium truncate">{run.label}</span></div>
                <div className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{run.runId}</span><Badge variant="secondary" className="text-[10px] h-5">{run.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{time(run.createdAt)}</p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        {!selectedRunId ? (
          <div className="flex-1 flex flex-col justify-center items-center text-muted-foreground"><FileSearch className="h-12 w-12 opacity-20 mb-4" /><p className="text-sm">从左侧选择一条 Skill 运行</p></div>
        ) : detailLoading ? (
          <div className="flex-1 flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !detail ? (
          <div className="flex-1 flex justify-center items-center text-sm text-muted-foreground">运行不存在或已被清理</div>
        ) : (
          <>
            <div className="p-5 border-b">
              <div className="flex items-center gap-2"><Badge>Run</Badge><h2 className="font-semibold">{detail.label}</h2><span className="font-mono text-xs text-muted-foreground">{detail.runId}</span></div>
              <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
                <div><p className="text-xs text-muted-foreground">状态</p><p className="font-medium">{detail.status}</p></div>
                <div><p className="text-xs text-muted-foreground">开始</p><p className="font-medium">{time(detail.startedAt)}</p></div>
                <div><p className="text-xs text-muted-foreground">审计事件</p><p className="font-medium">{events.length}</p></div>
                <div><p className="text-xs text-muted-foreground">上下文来源</p><p className="font-medium">{sources.length}</p></div>
              </div>
              {!detail.traceId ? <p className="mt-3 text-xs text-muted-foreground">该运行没有唯一可验证的 Trace 映射，因此不会显示 Ledger 投影。</p> : null}
            </div>
            <div className="border-b px-5 flex gap-1">
              <button className={`px-3 py-2.5 text-sm border-b-2 ${detailMode === "events" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setDetailMode("events")}>事件时间线</button>
              <button className={`px-3 py-2.5 text-sm border-b-2 ${detailMode === "context" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setDetailMode("context")}><Braces className="inline h-3.5 w-3.5 mr-1" />运行输入与来源</button>
              <button className={`px-3 py-2.5 text-sm border-b-2 ${detailMode === "compiler" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setDetailMode("compiler")}><LibraryBig className="inline h-3.5 w-3.5 mr-1" />上下文编译</button>
            </div>
            <ScrollArea className="flex-1 min-h-0 p-5">
              {detailMode === "events" ? <div className="space-y-3">{events.length ? events.map((event) => <div key={event.eventId} className="border rounded-lg p-3"><div className="flex justify-between gap-3"><div><Badge variant="outline" className="mr-2">{event.entityType}</Badge><span className="font-medium text-sm">{event.eventType}</span></div><span className="text-xs text-muted-foreground">{time(event.occurredAt)}</span></div><pre className="mt-3 p-3 rounded bg-muted/50 text-xs overflow-auto whitespace-pre-wrap break-words">{pretty(event.payload)}</pre></div>) : <p className="py-12 text-center text-sm text-muted-foreground">暂无可展示的 Ledger 事件。</p>}</div> : detailMode === "context" ? <div className="space-y-4"><div className="border rounded-lg p-4"><p className="font-medium text-sm">运行输入</p><pre className="mt-3 p-3 rounded bg-muted/50 text-xs overflow-auto whitespace-pre-wrap break-words">{pretty(detail.input)}</pre></div>{sources.length ? <div className="space-y-2">{sources.map((source) => <div key={`${source.sourceType}-${source.sourceKey}`} className="border rounded-lg p-3"><div className="flex justify-between gap-3"><div><p className="font-medium text-sm">{source.sourceType}</p><p className="text-xs text-muted-foreground font-mono">{source.sourceKey}</p></div><Badge variant="outline">{source.status}</Badge></div>{source.invalidationReason ? <p className="mt-2 text-xs text-amber-800">失效原因：{source.invalidationReason}</p> : null}</div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">该 Trace 没有已登记的上下文来源。</p>}</div> : <CompilerOverview input={detail.input} />}
            </ScrollArea>
          </>
        )}
      </section>
    </>
  );
}

function CompilerOverview({ input }: { input: unknown }) {
  const context = contextPackage(input);
  if (!context) return <div className="py-16 text-center text-sm text-muted-foreground"><LibraryBig className="h-9 w-9 mx-auto mb-3 opacity-30" /><p>本次运行没有可展示的 Context Compiler 数据。</p><p className="text-xs mt-1">未编译的运行继续使用原有输入，不会改变既有 Skill 输入。</p></div>;
  const policyHash = context.compiler.policyHash || "未记录";
  const toolMode = stringValue(context.toolPolicy?.mode) || "catalog_only";
  const toolExecution = stringValue(context.toolPolicy?.execution) || "not_requested";
  const shellDenied = stringValue(context.toolPolicy?.shell) === "denied";
  return <div className="space-y-4"><div className="border rounded-lg p-4 space-y-4"><div className="flex justify-between gap-3"><div><p className="font-medium text-sm">Context Compiler</p><p className="text-xs text-muted-foreground font-mono">策略 {policyHash.slice(0, 16)}… · {context.compiler.selectedKnowledgeCount} 条知识引用</p></div></div><div className="grid md:grid-cols-2 gap-3"><div className="rounded-md bg-muted/40 p-3"><p className="text-xs font-medium text-muted-foreground mb-2"><LibraryBig className="inline h-3.5 w-3.5 mr-1" />已编译知识来源</p>{context.knowledge.length ? <div className="space-y-2">{context.knowledge.map((knowledge, index) => <div key={`${stringValue(knowledge.knowledgeId) || "knowledge"}-${index}`} className="text-xs"><p className="font-medium">{stringValue(knowledge.title) || "未命名知识"}</p><p className="text-muted-foreground">#{stringValue(knowledge.knowledgeId) || "—"} · {stringValue(knowledge.memoryType) || "—"} · 匹配：{Array.isArray(knowledge.matchedTerms) ? knowledge.matchedTerms.filter((term): term is string => typeof term === "string").join("、") || "策略筛选" : "策略筛选"}</p></div>)}</div> : <p className="text-xs text-muted-foreground">没有匹配到可用知识。</p>}</div><div className="rounded-md bg-muted/40 p-3"><p className="text-xs font-medium text-muted-foreground mb-2"><ShieldCheck className="inline h-3.5 w-3.5 mr-1" />Tool治理边界</p><p className="text-xs">模式：{toolMode}</p><p className="text-xs mt-1">执行：{toolExecution}</p><p className="text-xs mt-1 text-muted-foreground">Shell：{shellDenied ? "已拒绝" : "未声明"}</p></div></div></div></div>;
}
