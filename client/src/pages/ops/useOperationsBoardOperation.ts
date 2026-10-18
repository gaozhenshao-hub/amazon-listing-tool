import { useEffect, useRef, useState } from "react";
import { readBoardPending, releaseBoardPending, reserveBoardPending, subscribeBoardPending, withBoardPendingLock,
  type BoardOperationContext, type BoardPendingOperation } from "./operationsBoardEditionClientState";

export const boardErrorCode = (error: unknown) => {
  const value = error as { data?: { code?: unknown }; code?: unknown } | null;
  return typeof value?.data?.code === "string" ? value.data.code : typeof value?.code === "string" ? value.code : "UNVERIFIED";
};
type Accepted = { status: "committed" | "cancelled" | "unknown" };
/** Fixed-UUID journal client. No timeout, lost acknowledgement or absent
 * operation permits a new submit. All storage mutations use one context lock. */
export function useOperationsBoardOperation(options: {
  context: BoardOperationContext;
  accept: (raw: unknown, pending: BoardPendingOperation) => Accepted;
  recover: (pending: BoardPendingOperation, decision: "check" | "cancel", signal: AbortSignal) => Promise<unknown>;
  onCommitted: (pending: BoardPendingOperation, submittedHere: boolean) => void;
  onInvalidate: () => void;
  onDenied: () => void;
}) {
  const [pending, setPending] = useState<BoardPendingOperation | null>(null), [storageError, setStorageError] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const latest = useRef(options); latest.current = options;
  const observed = useRef<string | null>(null), ownStorage = useRef(false), submitted = useRef(new Set<string>());
  const lane = useRef({ sequence: 0, controller: null as AbortController | null });
  function invalidate() { lane.current.sequence++; lane.current.controller?.abort(); lane.current.controller = null; setBusy(false); }
  function sync() {
    try {
      const value = readBoardPending(latest.current.context), next = value?.operationId ?? null;
      if (observed.current !== next && !ownStorage.current) { invalidate(); latest.current.onInvalidate(); }
      observed.current = next; setPending(value); setStorageError(false);
    } catch { invalidate(); setPending(null); setStorageError(true); latest.current.onInvalidate(); }
  }
  useEffect(() => {
    const currentLane = lane.current;
    sync(); let unsubscribe: (() => void) | undefined;
    try { unsubscribe = subscribeBoardPending(options.context, sync); } catch { setStorageError(true); }
    return () => { currentLane.sequence++; currentLane.controller?.abort(); unsubscribe?.(); };
    // The owner/scope-keyed controller is remounted for a new context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function begin() { invalidate(); const sequence = lane.current.sequence, controller = new AbortController(); lane.current.controller = controller; setBusy(true); setMessage(""); return { sequence, controller }; }
  const active = (work: ReturnType<typeof begin>) => work.sequence === lane.current.sequence && !work.controller.signal.aborted;
  async function finish(raw: unknown, operation: BoardPendingOperation, work: ReturnType<typeof begin>) {
    if (!active(work)) return;
    if (readBoardPending(latest.current.context)?.operationId !== operation.operationId) { sync(); return; }
    const receipt = latest.current.accept(raw, operation);
    if (receipt.status === "unknown") { setMessage("结果尚未确认；保留原操作编号，只能核对或永久取消，不能重新提交。"); return; }
    const released = await withBoardPendingLock(latest.current.context, work.controller.signal, async () => {
      if (!active(work) || readBoardPending(latest.current.context)?.operationId !== operation.operationId) return false;
      ownStorage.current = true;
      try { return releaseBoardPending(latest.current.context, operation.operationId); } finally { ownStorage.current = false; }
    });
    if (!active(work) || !released) { sync(); return; }
    setMessage(receipt.status === "committed" ? "原操作已确认保存。请重新读取当前版本；其他未提交草稿不会自动丢弃。" : "原操作已永久取消，迟到提交不能再次生效。草稿仍保留。");
    if (receipt.status === "committed") latest.current.onCommitted(operation, submitted.current.has(operation.operationId));
    submitted.current.delete(operation.operationId);
  }
  function failure(error: unknown, work: ReturnType<typeof begin>) {
    if (!active(work)) return;
    latest.current.onInvalidate();
    if (boardErrorCode(error) === "FORBIDDEN" || boardErrorCode(error) === "UNAUTHORIZED") latest.current.onDenied();
    setMessage(boardErrorCode(error) === "CONFLICT" ? "版本发生冲突，草稿已保留。先核对／取消原操作，再读取最新版本进行人工对照；不会自动覆盖。" : "未取得可核验回执，或本机安全存储／跨标签锁不可用。已保留原操作编号；不得自动重发。");
    sync();
  }
  async function submit(operation: BoardPendingOperation, send: (signal: AbortSignal) => Promise<unknown>) {
    if (busy || storageError) return;
    const work = begin();
    try {
      await withBoardPendingLock(latest.current.context, work.controller.signal, async () => {
        if (!active(work)) throw new Error("ABORTED");
        ownStorage.current = true;
        try { reserveBoardPending(latest.current.context, operation); observed.current = operation.operationId; setPending(operation); } finally { ownStorage.current = false; }
      });
      if (!active(work)) return;
      submitted.current.add(operation.operationId);
      await finish(await send(work.controller.signal), operation, work);
    } catch (error) { failure(error, work); } finally { if (active(work)) { setBusy(false); lane.current.controller = null; } }
  }
  async function recover(decision: "check" | "cancel", acknowledgedId?: string) {
    if (busy || storageError || !pending || decision === "cancel" && acknowledgedId !== pending.operationId) return;
    const displayedId = pending.operationId, work = begin();
    try {
      const operation = await withBoardPendingLock(latest.current.context, work.controller.signal, async () => {
        const value = readBoardPending(latest.current.context);
        if (!value || value.operationId !== displayedId || decision === "cancel" && value.operationId !== acknowledgedId) throw new Error("PENDING_CHANGED");
        return value;
      });
      if (!active(work)) return;
      await finish(await latest.current.recover(operation, decision, work.controller.signal), operation, work);
    } catch (error) { failure(error, work); } finally { if (active(work)) { setBusy(false); lane.current.controller = null; } }
  }
  return { pending, storageError, busy, message, submit, recover, invalidate };
}
