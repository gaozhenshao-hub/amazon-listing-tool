import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, NotebookPen, Pencil, Save } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { journalToday, journalMonday, shiftJournalDate, type JournalContent, type JournalReadResult, type JournalRecord } from "@shared/operationsJournal";

const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition hover:bg-muted disabled:opacity-40";
const input = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20";
const weekLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const shortDate = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
type Draft = { date: string; revision: number; content: JournalContent; requestId: string };
export default function OperationsJournal({ userId, workspaceId }: { userId: number; workspaceId: number }) {
  const client = trpc.useUtils().client;
  const [owner, setOwner] = useState(userId), [members, setMembers] = useState<{ id: number; name: string }[]>([]);
  const [dailyEnd, setDailyEnd] = useState(journalToday), [week, setWeek] = useState(() => journalMonday(journalToday()));
  const [result, setResult] = useState<JournalReadResult | null>(null), [loading, setLoading] = useState(true), [message, setMessage] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null), [saving, setSaving] = useState(false), [uncertain, setUncertain] = useState(false);
  const [reload, setReload] = useState(0), lane = useRef(0);
  const dates = [-2, -1, 0].map(offset => shiftJournalDate(dailyEnd, offset));
  useEffect(() => {
    const controller = new AbortController();
    client.operationsJournal.options.query({ expectedWorkspaceId: workspaceId }, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setMembers(data.members); }).catch(() => { if (!controller.signal.aborted) setMessage("无法读取运营列表，请稍后刷新。"); });
    return () => controller.abort();
  }, [client, workspaceId, userId]);
  useEffect(() => {
    const ticket = ++lane.current, controller = new AbortController(); setLoading(true); setResult(null); setDraft(null); setUncertain(false);
    client.operationsJournal.read.query({ expectedWorkspaceId: workspaceId, ownerId: owner, from: shiftJournalDate(dailyEnd, -2), to: dailyEnd, week }, { signal: controller.signal })
      .then(data => { if (ticket === lane.current && !controller.signal.aborted) { setResult(data); setMessage(""); } })
      .catch(() => { if (!controller.signal.aborted && ticket === lane.current) setMessage("日报和周计划加载失败，请点击刷新重试。"); })
      .finally(() => { if (!controller.signal.aborted && ticket === lane.current) setLoading(false); });
    return () => { controller.abort(); lane.current++; };
  }, [client, workspaceId, owner, dailyEnd, week, reload]);
  function edit(date: string, kind: "daily" | "weekly", saved?: JournalRecord | null) {
    setUncertain(false); setMessage("");
    setDraft({ date, revision: saved?.revision ?? 0, requestId: crypto.randomUUID(), content: saved ? structuredClone(saved.content) : kind === "daily" ? { kind, completed: "", issues: "", next: "" } : { kind, days: Array(7).fill("") } });
  }
  async function save() {
    if (!draft || saving) return;
    const current = lane.current; setSaving(true); setMessage("");
    try {
      await client.operationsJournal.save.mutate({ expectedWorkspaceId: workspaceId, ownerId: owner, date: draft.date, content: draft.content, expectedRevision: draft.revision, requestId: draft.requestId });
      if (lane.current !== current) return;
      setDraft(null); setUncertain(false); setReload(value => value + 1);
    } catch (err) {
      if (lane.current !== current) return;
      const conflict = (err as { data?: { code?: string } }).data?.code === "CONFLICT";
      setUncertain(true); setMessage(conflict ? "这份内容已有更新，请保留你的文字，关闭后刷新再编辑。" : "暂时未确认保存结果。可重试保存同一份内容，或关闭后刷新核对。");
    } finally { setSaving(false); }
  }
  const busy = loading || saving;
  return <div className="space-y-7" aria-label="运营日报与周计划">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4">
      <div><h2 className="text-lg font-semibold">工作记录</h2><p className="mt-1 text-sm text-muted-foreground">记录每天的进展，安排下一周的重点。</p></div>
      <div className="flex items-center gap-2"><label className="text-sm" htmlFor="journal-owner">运营</label><select id="journal-owner" className={`${input} min-w-36`} value={owner} disabled={saving} onChange={event => { setResult(null); setOwner(Number(event.target.value)); }}>
        {!members.length && <option value={userId}>我</option>}{members.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === userId ? "（我）" : ""}</option>)}</select><button className={button} disabled={busy} onClick={() => setReload(value => value + 1)}>刷新</button></div>
    </div>
    {message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
    <section aria-label="运营日报" className="rounded-2xl border bg-card p-5 md:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-orange-50 p-2.5 text-primary"><NotebookPen size={22} /></span><div><h2 className="text-xl font-semibold">运营日报</h2><p className="mt-1 text-sm text-muted-foreground">沿时间轴查看每天的工作记录</p></div></div>
        <div className="flex items-center gap-2"><button className={button} aria-label="查看更早日报" disabled={saving} onClick={() => setDailyEnd(shiftJournalDate(dailyEnd, -3))}><ChevronLeft size={17} /></button><input type="date" aria-label="日报日期" className={`${input} w-auto`} value={dailyEnd} disabled={saving} onChange={event => { if (event.target.value) setDailyEnd(event.target.value); }} /><button className={button} aria-label="查看更晚日报" disabled={saving} onClick={() => setDailyEnd(shiftJournalDate(dailyEnd, 3))}><ChevronRight size={17} /></button><button className={button} disabled={saving} onClick={() => setDailyEnd(journalToday())}>今天</button></div>
      </header>
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3" aria-label="日报时间轴">
        {dates.map(date => { const saved = result?.daily.find(row => row.date === date), content = saved?.content.kind === "daily" ? saved.content : null;
          return <article key={date} className="flex min-w-[280px] flex-1 snap-start flex-col"><div className="relative mb-4 flex items-center gap-2 text-sm text-muted-foreground"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary ring-4 ring-primary/10" /><time dateTime={date}>{date}</time><span className="h-px flex-1 bg-border" /></div>
            <div className={`flex min-h-[290px] flex-1 flex-col rounded-xl border p-5 ${date === journalToday() ? "border-primary/30 bg-primary/[0.03]" : "bg-background"}`}>
              <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{shortDate(date)}</h3><span className={`rounded-full px-2 py-1 text-xs ${content ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{content ? "已填写" : "未填写"}</span></div>
              <div className="my-4 flex-1 space-y-4 text-sm">{loading ? <p className="text-muted-foreground">正在加载…</p> : content ? <>{([['今日完成', content.completed], ['遇到的问题', content.issues], ['明日安排', content.next]] as const).map(([title, text]) => <div key={title}><p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p><p className="line-clamp-4 whitespace-pre-wrap break-words leading-6">{text || "暂无记录"}</p></div>)}</> : <p className="py-10 text-center text-muted-foreground">还没有这一天的日报</p>}</div>
              {!loading && result && <button className={`${button} w-full`} onClick={() => edit(date, "daily", saved)}><Pencil size={14} />{result.canEdit ? content ? "查看 / 编辑日报" : "填写日报" : "查看日报"}</button>}
            </div>
          </article>;
        })}
      </div>
    </section>
    <section aria-label="运营周计划" className="rounded-2xl border bg-card p-5 md:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><CalendarDays size={22} /></span><div><h2 className="text-xl font-semibold">运营周计划</h2><p className="mt-1 text-sm text-muted-foreground">{week} — {shiftJournalDate(week, 6)}</p></div></div><div className="flex gap-2"><button className={button} aria-label="上一周计划" disabled={saving} onClick={() => setWeek(shiftJournalDate(week, -7))}><ChevronLeft size={17} /></button><button className={button} disabled={saving} onClick={() => setWeek(journalMonday(journalToday()))}>本周</button><button className={button} aria-label="下一周计划" disabled={saving} onClick={() => setWeek(shiftJournalDate(week, 7))}><ChevronRight size={17} /></button>{result?.canEdit && <button className={`${button} border-primary/30 text-primary`} disabled={busy} onClick={() => edit(week, "weekly", result.weekly)}><Pencil size={15} />编辑周计划</button>}</div></header>
      <div className="overflow-hidden rounded-xl border">{weekLabels.map((label, index) => { const day = shiftJournalDate(week, index); return <div key={day} className={`grid grid-cols-[100px_1fr] border-b last:border-b-0 sm:grid-cols-[140px_1fr] ${day === journalToday() ? "bg-primary/[0.03]" : ""}`}><div className="border-r bg-muted/40 px-4 py-4"><p className="font-semibold">{label}</p><p className="mt-1 text-xs text-muted-foreground">{shortDate(day)}</p></div><p className="whitespace-pre-wrap break-words px-5 py-4 text-sm leading-6">{loading ? "正在加载…" : result?.weekly?.content.kind === "weekly" ? result.weekly.content.days[index] || "暂无安排" : "暂无安排"}</p></div>; })}</div>
    </section>
    <Dialog open={!!draft} onOpenChange={open => { if (!open && !saving) { setDraft(null); setMessage(""); } }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{draft?.content.kind === "daily" ? "运营日报" : "运营周计划"} · {draft?.date}</DialogTitle><DialogDescription>{result?.canEdit ? "填写后保存，之后可随时回看和修改。" : "查看搭档的工作记录。"}</DialogDescription></DialogHeader>
      {draft?.content.kind === "daily" ? ([['completed', '今日完成'], ['issues', '遇到的问题'], ['next', '明日安排']] as const).map(([key, label]) => <label key={key} className="space-y-2 text-sm font-medium">{label}<textarea className={`${input} mt-2 min-h-28 resize-y font-normal`} aria-label={label} maxLength={key === "completed" ? 5000 : 3000} disabled={!result?.canEdit || saving || uncertain} value={draft.content.kind === "daily" ? draft.content[key] : ""} onChange={event => { const value = event.target.value; setDraft(old => old && old.content.kind === "daily" ? { ...old, content: { ...old.content, [key]: value } } : old); }} /></label>) : draft && weekLabels.map((label, index) => <label key={label} className="text-sm font-medium">{label} · {shortDate(shiftJournalDate(draft.date, index))}<textarea className={`${input} mt-2 min-h-20 resize-y font-normal`} aria-label={`${label}安排`} maxLength={3000} disabled={!result?.canEdit || saving || uncertain} value={draft.content.kind === "weekly" ? draft.content.days[index] : ""} onChange={event => { const value = event.target.value; setDraft(old => old && old.content.kind === "weekly" ? { ...old, content: { kind: "weekly", days: old.content.days.map((text, i) => i === index ? value : text) } } : old); }} /></label>)}
      {message && <p role="alert" className="text-sm text-amber-700">{message}</p>}<div className="flex justify-end gap-2"><button className={button} disabled={saving} onClick={() => { setDraft(null); setMessage(""); }}>关闭</button>{result?.canEdit && <button className={`${button} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={saving} onClick={() => void save()}><Save size={16} />{saving ? "保存中…" : uncertain ? "重试保存" : "保存"}</button>}</div>
    </DialogContent></Dialog>
  </div>;
}
