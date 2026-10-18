import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { DevelopmentMarketPreviewSchema, DevelopmentMarketViewSchema, DevelopmentMarketApplyReceiptSchema,
  developmentMarketHash, type DevelopmentMarketIdentity, type DevelopmentMarketOperation, type DevelopmentMarketStart,
  type DevelopmentMarketApply, type DevelopmentMarketApplyOperation } from "@shared/developmentMarket";
import { developmentMarketPendingKey, readDevelopmentMarketPending, saveDevelopmentMarketPending, releaseDevelopmentMarketPending,
  withDevelopmentMarketLock, type DevelopmentMarketPending, type DevelopmentMarketPendingContext } from "./developmentMarketPending";
type Preview = ReturnType<typeof DevelopmentMarketPreviewSchema.parse>;
type View = ReturnType<typeof DevelopmentMarketViewSchema.parse>;
type Props = { projectId: number; onApplied?: () => void };
type Rpc = {
  marketPreview: { query(input: DevelopmentMarketOperation, options: { signal: AbortSignal }): Promise<unknown> };
  marketStart: { mutate(input: DevelopmentMarketStart): Promise<unknown> };
  marketCheck: { query(input: DevelopmentMarketOperation, options: { signal: AbortSignal }): Promise<unknown> };
  marketCancel: { mutate(input: DevelopmentMarketOperation): Promise<unknown> };
  marketApply: { mutate(input: DevelopmentMarketApply): Promise<unknown> };
  marketApplyCheck: { query(input: DevelopmentMarketApplyOperation, options: { signal: AbortSignal }): Promise<unknown> };
  marketApplyCancel: { mutate(input: DevelopmentMarketApplyOperation): Promise<unknown> };
};
const labels: Record<string, string> = { not_found: "尚未观察到原请求，不能判定失败", queued: "已排队", running: "准备执行", dispatched: "已派发，等待原回执",
  candidate: "候选已保存，尚未应用", applied: "已应用，仍待原流程人工确认", failed: "执行失败，未自动重试", canceled: "已取消", outcome_unknown: "结果未知，不会自动重试" };
export default function DevelopmentMarketWorkflow(props: Props) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  if (auth.loading || permissions.isLoading) return <p role="status">正在核对受控市场分析权限…</p>;
  if (!user || auth.error || !user.defaultWorkspaceId || !permissions.canRead("dev", "dev_projects")) return <p role="alert">当前市场分析身份或权限不可核验。</p>;
  return <DevelopmentMarketController key={`${user.id}:${user.defaultWorkspaceId}:${user.role}:${props.projectId}`} {...props}
    identity={{ userId: user.id, workspaceId: user.defaultWorkspaceId }} canEdit={permissions.canEdit("dev", "dev_projects")} />;
}
export function DevelopmentMarketController({ projectId, identity, canEdit, onApplied }: Props & { identity: DevelopmentMarketIdentity; canEdit: boolean }) {
  const rpc = trpc.useUtils().client.devAnalysis as unknown as Rpc, scope = { expectedWorkspaceId: identity.workspaceId, devProjectId: projectId },
    context: DevelopmentMarketPendingContext = { ...identity, devProjectId: projectId };
  const [preview, setPreview] = useState<Preview | null>(null), [job, setJob] = useState<View | null>(null), [pending, setPending] = useState<DevelopmentMarketPending | null>(null),
    [busy, setBusy] = useState(false), [charge, setCharge] = useState(false), [reviewed, setReviewed] = useState(false), [notice, setNotice] = useState(""), [storageError, setStorageError] = useState(false);
  const alive = useRef(true), busyRef = useRef(false), controller = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    const refresh = () => { try { setPending(readDevelopmentMarketPending(context)); setStorageError(false); setPreview(null); setCharge(false); setReviewed(false); } catch { setStorageError(true); } };
    refresh(); const changed = (event: StorageEvent) => { if (event.key === developmentMarketPendingKey(context)) { controller.current.abort(); controller.current = new AbortController(); setJob(null); refresh(); } };
    window.addEventListener("storage", changed);
    return () => { alive.current = false; controller.current.abort(); window.removeEventListener("storage", changed); };
  // Identity changes remount this controller, so asynchronous old results cannot render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bound = <T extends { identity: DevelopmentMarketIdentity; scope: DevelopmentMarketOperation }>(value: T, operation: DevelopmentMarketOperation) => {
    if (developmentMarketHash(value.identity) !== developmentMarketHash(identity) || developmentMarketHash(value.scope) !== developmentMarketHash(operation)) throw new Error("Reply scope invalid"); return value;
  };
  async function action(body: () => Promise<void>, write = true) {
    if (busyRef.current || storageError) return; busyRef.current = true; setBusy(true); setNotice("");
    try { if (write) await withDevelopmentMarketLock(context, body); else await body(); }
    catch { if (alive.current) setNotice("请求未能确认。若已提交，请保留原 UUID，使用核对或取消；不会自动重发或重复计费。"); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  function keep(value: DevelopmentMarketPending, replace?: string) { const saved = saveDevelopmentMarketPending(context, value, replace); if (alive.current) setPending(saved); }
  function release(operationId: string) { releaseDevelopmentMarketPending(context, operationId); if (alive.current) setPending(readDevelopmentMarketPending(context)); }
  async function observe(cancel = false) {
    const original = readDevelopmentMarketPending(context); if (!original) return;
    const operation = { ...scope, operationId: original.operationId };
    if (original.action === "start") {
      const value = bound(DevelopmentMarketViewSchema.parse(await (cancel ? rpc.marketCancel.mutate(operation) : rpc.marketCheck.query(operation, { signal: controller.current.signal }))), operation);
      if (!alive.current) return; setJob(value); setReviewed(false); setNotice(labels[value.state]);
      if (["failed", "canceled", "applied"].includes(value.state)) release(original.operationId);
    } else {
      const input = { ...operation, runOperationId: original.runOperationId! }, value = DevelopmentMarketApplyReceiptSchema.parse(await (cancel ? rpc.marketApplyCancel.mutate(input) : rpc.marketApplyCheck.query(input, { signal: controller.current.signal })));
      if (developmentMarketHash(value.identity) !== developmentMarketHash(identity) || developmentMarketHash(value.scope) !== developmentMarketHash(input)
        || value.requestHash !== null && value.requestHash !== original.requestHash) throw new Error("Apply receipt invalid");
      if (!alive.current) return;
      if (["committed", "canceled"].includes(value.status)) { release(original.operationId); setNotice(value.status === "committed" ? "已应用完整结果；请在原结果区编辑并人工确认。" : "原应用请求已取消。"); if (value.status === "committed") { setJob(null); onApplied?.(); } }
      else setNotice("原应用请求尚未确认，不可更换 UUID 盲重发。");
    }
  }
  async function loadPreview() {
    if (readDevelopmentMarketPending(context)) throw new Error("Original request unresolved");
    const operation = { ...scope, operationId: crypto.randomUUID() }, value = bound(DevelopmentMarketPreviewSchema.parse(await rpc.marketPreview.query(operation, { signal: controller.current.signal })), operation);
    if (alive.current) { setPreview(value); setCharge(false); setJob(null); setNotice(value.available ? "已核对完整已确认全景与当前来源；提交前请确认单次费用上限。" : `当前不可执行（${value.reasonCode}），未调用模型。`); }
  }
  async function start() {
    if (!canEdit || !preview?.available || !preview.runtimeHash || preview.maxCostCents === null || !charge) return;
    const input: DevelopmentMarketStart = { ...preview.scope, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.maxCostCents, chargeConfirmed: true };
    keep({ version: 1, ...context, operationId: input.operationId, runOperationId: null, action: "start", requestHash: developmentMarketHash({ identity, request: input }) });
    const value = bound(DevelopmentMarketViewSchema.parse(await rpc.marketStart.mutate(input)), preview.scope);
    if (alive.current) { setJob(value); setPreview(null); setCharge(false); setNotice(labels[value.state]); }
  }
  async function apply() {
    if (!canEdit || !reviewed || job?.state !== "candidate" || job.sourceChanged || !job.currentSourceHash || !job.resultHash) return;
    const original = readDevelopmentMarketPending(context); if (original?.action !== "start" || original.operationId !== job.scope.operationId) throw new Error("Original request changed");
    const input: DevelopmentMarketApply = { ...scope, operationId: crypto.randomUUID(), runOperationId: job.scope.operationId, expectedSourceHash: job.currentSourceHash, expectedResultHash: job.resultHash };
    const hash = developmentMarketHash({ identity, request: input }); keep({ version: 1, ...context, operationId: input.operationId, runOperationId: input.runOperationId, action: "apply", requestHash: hash }, original.operationId);
    const value = DevelopmentMarketApplyReceiptSchema.parse(await rpc.marketApply.mutate(input));
    if (developmentMarketHash(value.identity) !== developmentMarketHash(identity) || developmentMarketHash(value.scope) !== developmentMarketHash({ ...scope, operationId: input.operationId, runOperationId: input.runOperationId }) || value.requestHash !== hash || value.status !== "committed") throw new Error("Apply receipt invalid");
    if (alive.current) { release(input.operationId); setJob(null); setReviewed(false); setNotice("完整结果已应用，原始结果已保留版本；仍需原流程人工确认。"); onApplied?.(); }
  }
  return <section className="space-y-3 border rounded-md p-3" aria-label="受控市场概览">
    <p className="font-medium">使用已保存的 Development Agent（青岛 Skill）</p>
    <p className="text-xs text-muted-foreground">完整已确认全景、规则、Skill 和模型冻结执行；不会替代下方原流程或自动确认。</p>
    {storageError && <p role="alert">原请求记录不可核验，已停止新写；请恢复浏览器存储后再核对。</p>}
    {notice && <p role="status">{notice}</p>}
    {!pending && <Button size="sm" variant="outline" disabled={busy || storageError} onClick={() => void action(loadPreview, false)}>预览受控执行与费用</Button>}
    {preview && <div className="text-xs space-y-2"><p>{preview.productCount} 个产品 · 全景 v{preview.panoramaVersion} · {preview.asOf}</p>
      <p>配置 v{preview.configuration?.revision ?? "未就绪"} · {preview.skillSlug ?? "Skill 未就绪"} · {preview.modelSlug ?? "模型未就绪"}</p>
      <p>单次费用上限：{preview.maxCostCents === null ? "不可用" : `USD ${(preview.maxCostCents / 100).toFixed(2)}`}</p>
      <label><input type="checkbox" checked={charge} disabled={!canEdit || !preview.available || busy} onChange={event => setCharge(event.target.checked)} /> 我确认此费用上限，仅执行一次并生成人工候选</label>
      <Button size="sm" disabled={!canEdit || !preview.available || !charge || busy || storageError} onClick={() => void action(start)}>提交受控市场分析</Button></div>}
    {pending && <div className="space-y-2 text-xs"><p>原请求：{pending.operationId} · {pending.action === "apply" ? "人工应用" : "候选生成"}</p>
      <Button size="sm" variant="outline" disabled={busy || storageError} onClick={() => void action(() => observe(), false)}>核对原请求与来源</Button>{" "}
      <Button size="sm" variant="outline" disabled={busy || storageError || !canEdit} onClick={() => void action(() => observe(true))}>取消原请求（不重试）</Button></div>}
    {job && <div className="space-y-2"><p className="text-xs">{labels[job.state]}{job.sourceChanged ? "；来源已变化，禁止应用此旧候选" : ""}</p>
      {job.result && <details><summary>查看完整统计与 AI 候选</summary><pre className="whitespace-pre-wrap break-all text-xs max-h-96 overflow-auto">{JSON.stringify(job.result, null, 2)}</pre></details>}
      {job.state === "candidate" && pending?.action === "start" && <><label className="text-xs"><input type="checkbox" checked={reviewed} disabled={busy || job.sourceChanged || !canEdit} onChange={event => setReviewed(event.target.checked)} /> 我已核对完整候选，应用为待确认结果（不代替人工确认）</label>
        <Button size="sm" disabled={busy || !canEdit || !reviewed || job.sourceChanged || storageError} onClick={() => void action(apply)}>人工应用此完整候选</Button>
        <Button size="sm" variant="outline" disabled={busy || storageError} onClick={() => void action(async () => { const original = readDevelopmentMarketPending(context); if (original?.action !== "start" || original.operationId !== job.scope.operationId) throw new Error("Original request changed"); release(original.operationId); setJob(null); setPreview(null); setNotice("候选仍保留在服务器，未应用；下一次生成需重新预览并确认费用。"); })}>不应用此候选，准备新预览</Button></>}
    </div>}
  </section>;
}
