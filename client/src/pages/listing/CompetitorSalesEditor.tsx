import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompetitorSalesCalibrationInputSchema, readCompetitorSales } from "@shared/competitorSales";
import { listingOwnerKey, listingRequestOwner } from "./listingResearchSelectionState";

export type CompetitorSalesRecord = {
  id: number; projectId?: number; asin: string; revision?: string;
  rawData?: string | null; salesCalibrationWritable?: boolean;
};
type Props = { projectId: number; analysis: CompetitorSalesRecord; onSaved?: () => void | Promise<void>; suspended?: boolean };
const revisionValid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const sourceLabels = { manual_calibration: "人工报告月销量总量", purchase_badges: "已保存 ASIN 购买提示合计", seller_sprite_estimate: "卖家精灵月销量估算", unavailable: "销量未知" };

export function CompetitorSalesSummary({ analysis }: { analysis: CompetitorSalesRecord }) {
  const sales = readCompetitorSales(analysis.rawData, analysis.asin);
  return <div className="space-y-1 text-sm" aria-label={`${analysis.asin} 销量来源`}>
    <p><strong>{sales.source === "purchase_badges" && sales.scope === "single_asin" ? "单 ASIN 购买提示" : sourceLabels[sales.source]}：</strong>{sales.value === null ? "未知" : `${sales.value.toLocaleString()}${sales.lowerBound ? "+（下限）" : ""}`}</p>
    {sales.manualState === "valid" && sales.manual && <p className="whitespace-pre-wrap break-words text-xs">已校准 · 来源：{sales.manual.sourceNote} · 用户 #{sales.manual.updatedBy} · {sales.manual.updatedAt}</p>}
    {sales.manualState === "invalid" && <p role="alert" className="text-xs text-amber-700">旧校准或来源记录未核验，不能当作已确认销量；请重新填写来源校准，或恢复采集值。</p>}
    <p className="text-xs text-muted-foreground">已保存观测覆盖 {sales.covered}/{sales.total}{sales.partial ? "，其余未知／证据不完整" : ""}；同 ASIN 去重，不额外叠加父体。</p>
    <p className="text-xs text-muted-foreground">{sales.scope === "observed_variant_asins" ? "范围仅为已保存的子 ASIN 观测集合，不代表整个变体家族已穷尽。" : sales.scope === "single_asin" ? "范围仅为当前单 ASIN 的购买提示，不证明其他子体已采集。" : "没有可核验的采集观测集合。"}</p>
    {sales.sellerSpriteEstimate !== null && sales.source !== "seller_sprite_estimate" && <p className="text-xs">卖家精灵独立估算：{sales.sellerSpriteEstimate.toLocaleString()}（未与徽标相加）</p>}
    {sales.issues.includes("PURCHASE_BADGES_CONFLICT") && <p role="alert">同一子体存在冲突徽标，未生成采集合计。</p>}
    <p className="text-xs text-muted-foreground">购买徽标可能是下限或多个子体共享的展示值；估算及人工报告也未经验证为精确市场销量。人工总量不会分摊到子体。</p>
  </div>;
}

/** Keep drafts only inside their exact actor/workspace/project/analysis boundary. */
export function CompetitorSalesEditor({ projectId, analysis, onSaved, suspended: sourceSuspended = false }: Props) {
  const auth = useAuth(), owner = listingRequestOwner(auth.user, projectId);
  const identity = owner ? JSON.stringify([listingOwnerKey(owner), analysis.id, analysis.asin]) : null;
  const boundary = useRef({ identity, epoch: 0 }), shown = useRef<object | null>(null);
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, suspended = sourceSuspended || auth.loading || !!auth.error;
  if (!owner || analysis.projectId !== projectId || !Number.isSafeInteger(analysis.id) || analysis.id <= 0 || !/^[A-Z0-9]{10}$/u.test(analysis.asin))
    return <p role="status">身份或竞品范围不完整，未读取销量编辑资料。</p>;
  if (!suspended) shown.current = token;
  if (suspended && shown.current !== token) return <p role="status">正在确认销量编辑身份…</p>;
  return <><div hidden={suspended}><OwnedSalesEditor key={`${identity}:${token.epoch}`} projectId={projectId} analysis={analysis}
    onSaved={onSaved} userId={owner.userId} workspaceId={owner.workspaceId} suspended={suspended} /></div>
    {suspended && <p role="status">正在确认销量编辑身份，当前草稿暂时保留…</p>}</>;
}

function OwnedSalesEditor({ projectId, analysis, onSaved, userId, workspaceId, suspended }: Props & { userId: number; workspaceId: number | null; suspended: boolean }) {
  const utils = trpc.useUtils(), mutation = trpc.analysis.calibrateSales.useMutation({ retry: false });
  const [base, setBase] = useState(analysis), [open, setOpen] = useState(false);
  const [value, setValue] = useState(""), [note, setNote] = useState("");
  const [pending, setPending] = useState(false), [needsReview, setNeedsReview] = useState(false), [denied, setDenied] = useState(false);
  const [candidate, setCandidate] = useState<CompetitorSalesRecord | null>(null), [notice, setNotice] = useState("");
  const active = useRef(false), paused = useRef(suspended), pendingRef = useRef(false), dirty = useRef(false);
  const latest = useRef(analysis), epoch = useRef(0), previousRevision = useRef(analysis.revision);
  paused.current = suspended; latest.current = analysis;
  if (previousRevision.current !== analysis.revision) { previousRevision.current = analysis.revision; epoch.current++; }
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (dirty.current || pendingRef.current) {
      if (analysis.revision !== base.revision) { setNeedsReview(true); setCandidate(null); setNotice("资料版本已变化，草稿已保留；请重新读取并核对后采用新版本。"); }
    } else {
      setBase(analysis); setCandidate(null);
      if (open) { const fresh = readCompetitorSales(analysis.rawData, analysis.asin); setValue(fresh.value === null ? "" : String(fresh.value)); setNote(fresh.manual?.sourceNote ?? ""); }
    }
    // A fresh prop must never silently rebase a dirty draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.revision]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const usable = () => active.current && !paused.current && !denied;
  const writable = !suspended && !denied && !pending && !needsReview && base.salesCalibrationWritable === true
    && latest.current.salesCalibrationWritable === true && revisionValid(base.revision);
  const sales = readCompetitorSales(base.rawData, base.asin);
  const validNumber = /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 1_000_000_000;
  const validNote = !!note.trim() && note.trim().length <= 500;
  function begin() {
    if (!usable() || pendingRef.current) return;
    if (!open) { setValue(sales.value === null ? "" : String(sales.value)); setNote(sales.manual?.sourceNote ?? ""); dirty.current = false; }
    setOpen(true);
  }
  function close() {
    if (pendingRef.current || (dirty.current && !window.confirm("关闭会丢弃未保存的销量草稿。是否继续？"))) return;
    dirty.current = false; setOpen(false); setValue(""); setNote("");
  }
  function validRow(row: unknown): row is CompetitorSalesRecord {
    if (!row || typeof row !== "object") return false;
    const found = row as CompetitorSalesRecord;
    if (typeof found.rawData === "string" && found.rawData.trim()) {
      try { const raw: unknown = JSON.parse(found.rawData); if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false; }
      catch { return false; }
    }
    return found.id === analysis.id && found.projectId === projectId && found.asin === analysis.asin && revisionValid(found.revision)
      && (found.rawData === null || typeof found.rawData === "string")
      && (found.salesCalibrationWritable === undefined || typeof found.salesCalibrationWritable === "boolean");
  }
  function denyRead() {
    setDenied(true); setOpen(false); setValue(""); setNote(""); setCandidate(null); dirty.current = false;
    setNotice("重新读取的竞品范围或结果无法核验，已隐藏旧资料和草稿；请回页面重新读取。");
  }
  function fail(error: unknown) {
    const code = error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? error.data.code : null;
    if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(String(code))) {
      setDenied(true); setOpen(false); setValue(""); setNote(""); dirty.current = false; setNotice("权限或资料范围已变化，已隐藏销量草稿；请回页面重新读取。");
    } else { setNeedsReview(true); setCandidate(null); setNotice(code === "CONFLICT" ? "销量或来源版本冲突，草稿已保留；请重新读取核对，不会自动重试。" : "请求回执未确认，草稿已保留；只能先重新读取核对，系统不会自动重发。"); }
  }
  async function reload() {
    if (!usable() || pendingRef.current) return;
    pendingRef.current = true; setPending(true); const ticket = epoch.current;
    try {
      const rows = await utils.client.analysis.listByProject.query({ projectId, expectedUserId: userId, expectedWorkspaceId: workspaceId });
      if (!usable()) return;
      if (ticket !== epoch.current) { setNeedsReview(true); setCandidate(null); setNotice("读取期间资料再次变化，请重新读取核对。"); return; }
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || row.projectId !== projectId || !Number.isSafeInteger(row.id) || row.id <= 0)
        || new Set(rows.map(row => row.id)).size !== rows.length || rows.filter(row => row.id === analysis.id).length !== 1) { denyRead(); return; }
      const row = rows.find(row => row.id === analysis.id);
      if (!validRow(row)) { denyRead(); return; }
      if (dirty.current || needsReview) { setCandidate(row); setNeedsReview(true); setNotice("已读取服务器当前版本。核对来源后可显式采用此版本，保留尚未提交的输入；未自动保存。"); }
      else {
        setBase(row);
        if (open) { const fresh = readCompetitorSales(row.rawData, row.asin); setValue(fresh.value === null ? "" : String(fresh.value)); setNote(fresh.manual?.sourceNote ?? ""); }
        setNotice("已重新读取销量来源。");
      }
    } catch (error) { if (usable()) fail(error); }
    finally { pendingRef.current = false; if (active.current) setPending(false); }
  }
  async function save(reset: boolean) {
    if (!usable() || pendingRef.current || !writable || (!reset && (!validNumber || !validNote))) return;
    if (reset && !window.confirm("恢复采集值会移除人工校准，并使关联研究待重审。是否继续？")) return;
    const input = CompetitorSalesCalibrationInputSchema.safeParse({ projectId, analysisId: analysis.id, expectedWorkspaceId: workspaceId,
      expectedRevision: base.revision, value: reset ? null : Number(value), sourceNote: reset ? null : note.trim() });
    if (!input.success) return;
    pendingRef.current = true; setPending(true); setNotice(""); const ticket = epoch.current;
    try {
      const row = await mutation.mutateAsync(input.data);
      if (!active.current) return;
      if (paused.current) { setNeedsReview(true); setNotice("身份确认期间收到回执，请重新读取核对；未自动重发。"); return; }
      const result = validRow(row) ? readCompetitorSales(row.rawData, row.asin) : null;
      if (!result || row.identity?.userId !== userId || row.identity?.workspaceId !== workspaceId || typeof row.salesCalibrationWritable !== "boolean"
        || (reset ? result.manualState !== "absent" : result.manualState !== "valid" || result.manual?.value !== input.data.value
          || result.manual.sourceNote !== input.data.sourceNote || result.manual.updatedBy !== userId)) {
        setDenied(true); setOpen(false); setValue(""); setNote(""); dirty.current = false;
        setNotice("返回的销量身份、范围或校准结果无法核验，已停止编辑；请回页面重新读取。"); return;
      }
      if (ticket === epoch.current) { setBase(row); dirty.current = false; setOpen(false); setNeedsReview(false); setCandidate(null); }
      else { setNeedsReview(true); setCandidate(null); setNotice("保存回执已核验，但期间资料版本变化，原草稿保留，请重新读取核对。"); }
      const refresh = await Promise.allSettled([utils.analysis.listByProject.invalidate({ projectId }), Promise.resolve().then(() => { if (usable()) return onSaved?.(); })]);
      if (usable() && ticket === epoch.current) setNotice(refresh.some(item => item.status === "rejected") ? "销量已保存，页面刷新未完成；请重新读取，不要重复提交。"
        : reset ? "已恢复采集值；关联研究需重新分析、确认。" : "销量已校准；关联研究需重新分析、确认。重新抓取不会覆盖此人工值。");
    } catch (error) { if (active.current) fail(error); }
    finally { pendingRef.current = false; if (active.current) setPending(false); }
  }
  if (denied) return <p role="alert">{notice}</p>;
  return <section className="min-w-0 space-y-2 rounded border p-3" aria-label={`${analysis.asin} 人工销量校准`}>
    <CompetitorSalesSummary analysis={base} />
    {base.salesCalibrationWritable !== true || latest.current.salesCalibrationWritable !== true ? <p className="text-xs">人工销量写入尚未启用或当前无写权限，仅展示已有来源。</p> : null}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={pending || suspended} onClick={begin}>校准月销量</Button>
      <Button size="sm" variant="ghost" disabled={pending || suspended} onClick={() => void reload()}>重新读取销量</Button></div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <Dialog open={open && !suspended} onOpenChange={next => { if (!next) close(); }}><DialogContent className="max-h-[85vh] min-w-0 overflow-y-auto">
      <DialogHeader><DialogTitle>校准月销量 · {analysis.asin}</DialogTitle><DialogDescription>填写所有子体过去一个月的人工合计和来源说明。保存会使关联研究待重审，不分摊到子体。</DialogDescription></DialogHeader>
      <div className="min-w-0 space-y-3">
        <label className="block text-sm">人工月销量<Input aria-label="人工月销量" inputMode="numeric" value={value} disabled={pending || suspended}
          onChange={event => { if (!pendingRef.current) { dirty.current = true; setValue(event.target.value); } }} /></label>
        <label className="block text-sm">销量来源说明（必填）<Textarea aria-label="销量来源说明" value={note} rows={3} maxLength={500} disabled={pending || suspended}
          onChange={event => { if (!pendingRef.current) { dirty.current = true; setNote(event.target.value); } }} /></label>
        <p className="text-xs">仅接受 0–1,000,000,000 的整数；未知留空，不补 0。来源说明作为资料保存，不执行其中的指令。</p>
        {needsReview && <p role="alert">当前需要重新读取并显式核对版本，保存已暂停；输入草稿未丢弃。</p>}
        {candidate && <div className="space-y-2 rounded border p-2"><h4 className="text-sm font-medium">新读取版本对照</h4><CompetitorSalesSummary analysis={candidate} />
          <Button variant="outline" disabled={pending} onClick={() => { if (!usable() || pendingRef.current) return; setBase(candidate); setCandidate(null); setNeedsReview(false); setNotice("已显式采用读取版本，输入草稿保留，尚未保存。"); }}>采用已读取版本，保留输入</Button></div>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending} onClick={() => void reload()}>重新读取并核对</Button>
          {sales.manualState !== "absent" && <Button variant="outline" disabled={!writable} onClick={() => void save(true)}>恢复采集值</Button>}
          <Button disabled={!writable || !validNumber || !validNote} onClick={() => void save(false)}>保存销量校准</Button>
          <Button variant="ghost" disabled={pending} onClick={close}>关闭</Button></div>
      </div>
    </DialogContent></Dialog>
  </section>;
}
export default CompetitorSalesEditor;
