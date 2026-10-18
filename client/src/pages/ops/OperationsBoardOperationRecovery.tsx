import { useState } from "react";
import type { useOperationsBoardOperation } from "./useOperationsBoardOperation";

export function BoardOperationRecovery({ operation, label }: { operation: ReturnType<typeof useOperationsBoardOperation>; label: string }) {
  const [acknowledged, setAcknowledged] = useState<string | null>(null), pending = operation.pending;
  return <>{operation.storageError && <p role="alert">本机未决操作元数据不可安全读取，已停止新提交；不会删除或覆盖原记录。</p>}
    {operation.message && <p role="status">{operation.message}</p>}
    {pending && <section aria-label={`${label}未决操作恢复`} className="min-w-0 space-y-2 rounded border border-amber-400 p-3 text-sm">
      <p className="break-all">{label}原操作：{pending.action} · UUID {pending.operationId}</p><p>只核对原编号。永久取消不会撤销已经提交成功的结果，未取得取消回执前不能新提交。</p>
      <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={operation.busy} onClick={() => { void operation.recover("check"); }}>核对原{label}操作</button>
      <label className="flex gap-2"><input type="checkbox" checked={acknowledged === pending.operationId} onChange={event => setAcknowledged(event.currentTarget.checked ? pending.operationId : null)} />确认永久取消此原操作编号</label>
      <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={operation.busy || acknowledged !== pending.operationId} onClick={() => { void operation.recover("cancel", acknowledged ?? undefined); }}>永久取消原{label}操作</button>
    </section>}
  </>;
}
