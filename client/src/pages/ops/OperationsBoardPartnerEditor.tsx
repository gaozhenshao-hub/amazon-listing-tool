import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { OperationsBoardPartnersOptionsResultSchema, OperationsBoardPartnersExecuteInputSchema, OperationsBoardPartnersWriteResultSchema,
  operationsBoardPartnersRequestHash, type OperationsBoardPartnersOptionsResult } from "@shared/operationsBoardPartners";
import { boardOperationContext, publishBoardEditionChange, subscribeBoardEditionChanges, type BoardOwner } from "./operationsBoardEditionClientState";
import { boardErrorCode, useOperationsBoardOperation } from "./useOperationsBoardOperation";
import { BoardOperationRecovery } from "./OperationsBoardOperationRecovery";

const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
/** Administrator-only direct numeric READ pairs. All historical pairs remain
 * visible; inactive/missing members may be disabled, never silently reassigned. */
export function OperationsBoardPartnerEditor({ owner, onDirtyChange }: { owner: BoardOwner; onDirtyChange: (dirty: boolean) => void }) {
  const client = trpc.useUtils().client.operationsBoard;
  const [options, setOptions] = useState<OperationsBoardPartnersOptionsResult | null>(null), [first, setFirst] = useState(""), [second, setSecond] = useState("");
  const [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [needsReview, setNeedsReview] = useState(false), [offset, setOffset] = useState(0);
  const lane = useRef({ sequence: 0, controller: null as AbortController | null });
  const context = boardOperationContext(owner, null), dirty = !!first || !!second;
  const notifyDirty = useRef(onDirtyChange); notifyDirty.current = onDirtyChange;
  useEffect(() => { notifyDirty.current(dirty); return () => notifyDirty.current(false); }, [dirty]);
  function invalidate() { lane.current.sequence++; lane.current.controller?.abort(); setBusy(false); setOptions(null); setConfirmed(false); setNeedsReview(true); }
  const operation = useOperationsBoardOperation({ context,
    accept(raw, pending) {
      const value = OperationsBoardPartnersWriteResultSchema.parse(raw);
      if (value.identity.userId !== owner.userId || value.identity.workspaceId !== owner.workspaceId || value.operationId !== pending.operationId || value.status === "committed" && value.requestHash !== pending.requestHash) throw new Error("RECEIPT_CHANGED");
      return value;
    },
    recover: (pending, decision, signal) => client.recoverPartner.mutate({ expectedWorkspaceId: owner.workspaceId, operationId: pending.operationId, decision }, { signal }),
    onInvalidate: invalidate,
    onDenied: () => { setFirst(""); setSecond(""); setOptions(null); },
    onCommitted: (_pending, own) => { invalidate(); if (own) { setFirst(""); setSecond(""); } publishBoardEditionChange({ workspaceId: owner.workspaceId, scope: null, action: "partners" }); },
  });
  useEffect(() => { const stop = subscribeBoardEditionChanges(notice => { if (notice.workspaceId === owner.workspaceId && notice.action === "partners") { invalidate(); operation.invalidate(); } }); return () => { stop(); lane.current.sequence++; lane.current.controller?.abort(); }; }, [owner.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function read() {
    invalidate(); const sequence = lane.current.sequence, controller = new AbortController(); lane.current.controller = controller; setBusy(true); setMessage("");
    try {
      const input = { expectedWorkspaceId: owner.workspaceId }, value = OperationsBoardPartnersOptionsResultSchema.parse(await client.partnerOptions.query(input, { signal: controller.signal }));
      if (sequence !== lane.current.sequence || controller.signal.aborted) return;
      if (value.identity.userId !== owner.userId || value.identity.workspaceId !== owner.workspaceId || value.request.expectedWorkspaceId !== owner.workspaceId) throw new Error("SCOPE_CHANGED");
      setOptions(value); setOffset(0); setNeedsReview(false);
    } catch (error) { if (sequence === lane.current.sequence && !controller.signal.aborted) { setMessage("搭档配置读取失败或权限已变化，旧目录已隐藏。请重新读取，未自动更改原配对。"); if (["FORBIDDEN", "UNAUTHORIZED"].includes(boardErrorCode(error))) { setFirst(""); setSecond(""); } } }
    finally { if (sequence === lane.current.sequence) { setBusy(false); lane.current.controller = null; } }
  }
  async function save(firstUserId: number, secondUserId: number, isActive: boolean, expectedVersion: number) {
    if (!options?.capability.available || needsReview || !confirmed || operation.pending || operation.busy || operation.storageError) return;
    const [a, b] = [firstUserId, secondUserId].sort((x, y) => x - y);
    const parsed = OperationsBoardPartnersExecuteInputSchema.safeParse({ expectedWorkspaceId: owner.workspaceId, operationId: crypto.randomUUID(), firstUserId: a, secondUserId: b, isActive, expectedVersion });
    if (!parsed.success || isActive && (!options.members.some(value => value.userId === a) || !options.members.some(value => value.userId === b))) { setMessage("请选择两个不同的当前有效数字成员；无法启用已离职成员配对。"); return; }
    const input = parsed.data;
    await operation.submit({ version: 1, context, operationId: input.operationId, requestHash: operationsBoardPartnersRequestHash(input), action: "setPartner", editionId: null, parentAsin: null }, signal => client.setPartner.mutate(input, { signal }));
  }
  const eligible = (id: number) => options?.members.some(member => member.userId === id);
  const label = (id: number) => `${options?.members.find(member => member.userId === id)?.displayName ?? "当前非有效成员"} · ID ${id}`;
  const blocked = !options?.capability.available || needsReview || !confirmed || operation.busy || !!operation.pending || operation.storageError;
  return <section aria-label="数字搭档配置" className="min-w-0 space-y-3 rounded border p-3">
    <h4 className="font-semibold">数字搭档配置（管理员）</h4><p className="text-sm">仅授予同工作区直接搭档的看板读取，不传递到搭档的搭档，也不授予负责人、备注编辑、任务或财务写权限。停用保留原配对编号，重新启用必须双方仍为有效成员。</p>
    <button type="button" className={buttonClass} disabled={busy || operation.busy} onClick={() => { void read(); }}>读取搭档配置与权限</button>
    {busy && <p role="status">正在核验数字成员与配对…</p>}{message && <p role="alert">{message}</p>}
    <BoardOperationRecovery operation={operation} label="搭档" />
    {options && <><p>{options.capability.available ? "允许管理员明确配置" : `当前不可写：${options.capability.reasonCode === "writes_not_enabled" ? "功能写入开关尚未启用" : options.capability.reasonCode}；已有未知操作仍可核对或取消。`}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">{([["第一位数字成员", first, setFirst], ["第二位数字成员", second, setSecond]] as const).map(([name, value, setValue]) => <label className="min-w-0 text-sm" key={name}>{name}<select aria-label={name} className="mt-1 w-full min-w-0 max-w-full rounded border bg-background p-2" value={value} disabled={!!operation.pending || operation.busy} onChange={event => { setValue(event.currentTarget.value); setConfirmed(false); }}><option value="">请选择</option>{value && !eligible(Number(value)) && <option value={value}>待核验 · ID {value}</option>}{options.members.map(member => <option key={member.userId} value={member.userId}>{member.displayName} · ID {member.userId}</option>)}</select></label>)}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />我确认此次配对／停用会改变双方当前可读范围，不会赋予写权限</label>
      <button type="button" className={buttonClass} disabled={blocked || !first || !second || first === second} onClick={() => { const found = options.pairs.find(pair => pair.firstUserId === Math.min(Number(first), Number(second)) && pair.secondUserId === Math.max(Number(first), Number(second))); void save(Number(first), Number(second), true, found?.version ?? 0); }}>保存数字配对</button>
      <p className="text-sm">完整配对 {options.pairs.length} 条（含停用）；{offset + 1}–{Math.min(offset + 20, options.pairs.length)}。</p>
      <nav aria-label="搭档配对分页" className="flex flex-wrap gap-2"><button className={buttonClass} type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>配对上一页</button><button className={buttonClass} type="button" disabled={offset + 20 >= options.pairs.length} onClick={() => setOffset(offset + 20)}>配对下一页</button></nav>
      {options.pairs.slice(offset, offset + 20).map(pair => <article key={pair.id} className="min-w-0 rounded border p-3 text-sm"><p className="break-words">配对 #{pair.id} · v{pair.version} · {label(pair.firstUserId)} ↔ {label(pair.secondUserId)}</p><p>{pair.isActive ? "启用" : "已停用"} · 更新者 ID {pair.updatedBy} · {pair.updatedAt}（原文时间，时区未声明）</p><button type="button" className={buttonClass} disabled={blocked || !pair.isActive && (!eligible(pair.firstUserId) || !eligible(pair.secondUserId))} onClick={() => { void save(pair.firstUserId, pair.secondUserId, !pair.isActive, pair.version); }}>{pair.isActive ? "停用" : "重新启用"}配对 #{pair.id}</button></article>)}
    </>}
  </section>;
}
