import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AgentLibraryRulesSchema } from "@shared/agentLibraryContracts";
import {
  AssistantRuleProposalInputSchema, AssistantRuleProposalResultSchema, AssistantRuleConfirmationInputSchema,
  AssistantRuleConfirmationOperationInputSchema, AssistantRuleConfirmationResultSchema, type AssistantRuleProposalResult,
} from "@shared/assistantRuleConfirmation";
import { conversationLocksAvailable, type ConversationOwner } from "./AssistantConversationDraft";
import {
  RULE_CONFIRMATION_PENDING_EVENT, readRuleConfirmationPending, releaseRuleConfirmation, reserveRuleConfirmation,
  ruleConfirmationPendingKey, type RuleConfirmationPending,
} from "./AssistantRuleConfirmationDraft";
import AssistantRuleConfirmationPanel from "./AssistantRuleConfirmationPanel";

type Query<T> = { query: (input: T, options?: { signal?: AbortSignal }) => Promise<unknown> };
type Mutation<T> = { mutate: (input: T) => Promise<unknown> };
export type AssistantRuleConfirmationClient = {
  ruleProposal: Query<z.input<typeof AssistantRuleProposalInputSchema>>;
  confirmRules: Mutation<z.input<typeof AssistantRuleConfirmationInputSchema>>;
  checkRuleConfirmation: Query<z.input<typeof AssistantRuleConfirmationOperationInputSchema>>;
  cancelRuleConfirmation: Mutation<z.input<typeof AssistantRuleConfirmationOperationInputSchema>>;
};
export type RuleConfirmationTarget = { threadId: string; operationId: string };
type Owner = ConversationOwner & { role: string; scopeKey: string };
export type AssistantRuleConfirmationBridgeProps = {
  owner: Owner; api: AssistantRuleConfirmationClient; target: RuleConfirmationTarget | null;
  onTargetClose: () => void; onDirtyChange?: (dirty: boolean) => void; onDenied: () => void; onSaved: () => void;
};
function permissionDenied(error: unknown) {
  const value = error as { data?: { code?: string }; shape?: { data?: { code?: string } }; message?: string } | null;
  return !!value && (["FORBIDDEN", "UNAUTHORIZED"].includes(value.data?.code ?? value.shape?.data?.code ?? "") || /IDENTITY_MISMATCH|SCOPE_MISMATCH|WORKSPACE_CHANGED/u.test(value.message ?? ""));
}
function sameOwner(value: ConversationOwner, owner: ConversationOwner) {
  if (value.userId !== owner.userId || value.workspaceId !== owner.workspaceId || value.agentKey !== owner.agentKey) throw new Error("IDENTITY_MISMATCH");
}
const keyOf = (target: RuleConfirmationTarget | null) => target ? `${target.threadId}:${target.operationId}` : null;
function reason(code: string | null) {
  if (!code) return null;
  if (/DISABLED/u.test(code)) return "规则保存开关尚未开启；仍可检查或取消原规则确认。";
  if (/CONFLICT|STALE/u.test(code)) return "候选的基础配置版本已经变化，不能直接确认。";
  if (/DENIED|FORBIDDEN/u.test(code)) return "当前没有共享规则保存权限。";
  return `当前不可确认：${code}`;
}

/** Always mounted for an owned Agent so unknown confirmation recovery survives
 * closing the editor. Only an explicit target triggers a proposal read. */
export default function AssistantRuleConfirmationBridge(props: AssistantRuleConfirmationBridgeProps) {
  return <OwnedRuleConfirmation key={JSON.stringify([props.owner.userId, props.owner.workspaceId, props.owner.agentKey, props.owner.role, props.owner.scopeKey])} {...props} />;
}
function OwnedRuleConfirmation({ owner, api, target, ...callbacks }: AssistantRuleConfirmationBridgeProps) {
  const [proposal, setProposal] = useState<AssistantRuleProposalResult | null>(null);
  const [draft, setDraft] = useState<string[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string[] | null>(null);
  const [pending, setPending] = useState<RuleConfirmationPending | null>(null), [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const [sharedAck, setSharedAck] = useState(false), [emptyAck, setEmptyAck] = useState(false), [cancelFor, setCancelFor] = useState<string | null>(null);
  const life = useRef({ active: false, epoch: 0, denied: false, controllers: new Set<AbortController>() });
  const action = useRef({ busy: false, ticket: 0 }), readTicket = useRef(0), revision = useRef(0);
  const ownStorage = useRef(false), previousPending = useRef<string | null | undefined>(undefined);
  const submitted = useRef<{ confirmationId: string; targetKey: string; revision: number } | null>(null);
  const callbackRef = useRef(callbacks); callbackRef.current = callbacks;
  const targetRef = useRef(target); targetRef.current = target;
  const targetKey = keyOf(target), targetKeyRef = useRef(targetKey); targetKeyRef.current = targetKey;
  const dirty = baseline !== null && (JSON.stringify(draft) !== JSON.stringify(baseline) || sharedAck || emptyAck);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const storageKey = ruleConfirmationPendingKey(owner);
  const syncRef = useRef(() => {}), reloadRef = useRef((_initialize: boolean) => {});
  const validated = AgentLibraryRulesSchema.safeParse(draft);
  const validationError = validated.success ? null : "规则列表不合法：最多 30 条、每条非空且最多 500 字、合计最多 10000 字。未截断或删除任何规则。";
  function lane() {
    const controller = new AbortController(), epoch = life.current.epoch; life.current.controllers.add(controller);
    return { signal: controller.signal, current: () => life.current.active && !life.current.denied && !controller.signal.aborted && epoch === life.current.epoch,
      close: () => life.current.controllers.delete(controller) };
  }
  function quarantine(cause: unknown) {
    if (!permissionDenied(cause)) return false;
    life.current.denied = true; life.current.epoch++; for (const controller of life.current.controllers) controller.abort();
    action.current.ticket++; action.current.busy = false; setBusy(false); setDenied(true); setProposal(null); setDraft([]); setBaseline(null); setPending(null); setNotice(""); setSharedAck(false); setEmptyAck(false); setCancelFor(null); submitted.current = null;
    callbackRef.current.onDenied(); return true;
  }
  function syncPending() {
    if (life.current.denied) return;
    try {
      const value = readRuleConfirmationPending(owner), next = value?.confirmationId ?? null;
      if (previousPending.current !== undefined && previousPending.current !== next) {
        setCancelFor(null); setSharedAck(false); setEmptyAck(false);
        if (!ownStorage.current) { action.current.ticket++; action.current.busy = false; setBusy(false); setNotice("另一窗口的规则确认 UUID 已变化；当前规则草稿保留，请核对新的原确认。"); }
      }
      previousPending.current = next; setPending(value); setStorageError(false);
    } catch { action.current.ticket++; action.current.busy = false; setBusy(false); setStorageError(true); setPending(null); setCancelFor(null); }
  }
  async function reload(initialize = false) {
    const target = targetRef.current; if (!target || !life.current.active || life.current.denied) return;
    const request = lane(), ticket = ++readTicket.current, targetKey = keyOf(target); setLoading(true); setError(null); setSharedAck(false); setEmptyAck(false);
    try {
      const result = AssistantRuleProposalResultSchema.parse(await api.ruleProposal.query({ expectedWorkspaceId: owner.workspaceId, agentKey: owner.agentKey, ...target }, { signal: request.signal }));
      if (!request.current() || ticket !== readTicket.current || targetKey !== targetKeyRef.current) return;
      sameOwner(result.identity, owner); if (result.threadId !== target.threadId || result.operationId !== target.operationId) throw new Error("SCOPE_MISMATCH");
      setProposal(result); if (initialize || baseline === null) { setDraft([...result.proposedRules]); setBaseline([...result.proposedRules]); revision.current++; }
      else setNotice("已重新核对来源和当前版本；保留原编辑草稿，没有自动替换规则或变更基础版本。");
    } catch (cause) { if (request.current() && ticket === readTicket.current && !quarantine(cause)) { setProposal(null); setError("候选规则或当前配置读取失败，请显式重新核对"); } }
    finally { if (request.current() && ticket === readTicket.current) setLoading(false); request.close(); }
  }
  function begin() {
    if (!life.current.active || life.current.denied || action.current.busy) return null;
    const request = lane(), ticket = ++action.current.ticket; action.current.busy = true; setBusy(true); setNotice("");
    return { ...request, current: () => request.current() && action.current.ticket === ticket,
      done: () => { request.close(); if (life.current.active && action.current.ticket === ticket) { action.current.busy = false; setBusy(false); } } };
  }
  async function accept(raw: unknown, expected: RuleConfirmationPending, request: { signal: AbortSignal; current: () => boolean }) {
    const result = AssistantRuleConfirmationResultSchema.parse(raw); sameOwner(result.identity, owner);
    if (result.threadId !== expected.threadId || result.operationId !== expected.operationId || result.confirmationId !== expected.confirmationId) throw new Error("SCOPE_MISMATCH");
    if (result.status === "committed" && (result.proposalHash !== expected.proposalHash || result.configurationRevision !== expected.baseRevision + 1)) throw new Error("RULE_RECEIPT_INVALID");
    if (!request.current()) return;
    if (readRuleConfirmationPending(owner)?.confirmationId !== expected.confirmationId) { syncPending(); throw new Error("RULE_RECOVERY_CONFIRMATION_CHANGED"); }
    if (result.status === "unknown") { setNotice("原规则确认尚未查到可验证终态，不等于失败；保留同一 UUID，只能继续核对或永久取消。"); return; }
    ownStorage.current = true;
    try { await releaseRuleConfirmation(owner, expected.confirmationId, request.signal); } finally { ownStorage.current = false; }
    if (!request.current()) return;
    setSharedAck(false); setEmptyAck(false); setCancelFor(null);
    if (result.status === "canceled") { setProposal(null); setNotice("服务端已永久取消原规则确认；原对话没有取消，规则草稿保留，没有回滚任何已提交规则。再次保存前须显式重新核对来源和当前版本。"); return; }
    const own = submitted.current;
    if (own?.confirmationId === expected.confirmationId && own.targetKey === targetKeyRef.current && own.revision === revision.current) {
      setDraft([]); setBaseline(null); setProposal(null); submitted.current = null; callbackRef.current.onTargetClose();
    } else { setProposal(null); setNotice("原规则确认已保存；当前未提交草稿仍保留，需重新核对来源与版本后再处理。请手动刷新已有配置编辑器。"); }
    if (own?.confirmationId === expected.confirmationId) setNotice(`完整规则已保存为共享配置 v${result.configurationRevision}；请手动刷新已有配置编辑器，未自动覆盖其中的草稿。`);
    callbackRef.current.onSaved();
  }
  async function save() {
    if (!target || !proposal || proposal.threadId !== target.threadId || proposal.operationId !== target.operationId || loading || pending || storageError || !proposal.capability.available || !sharedAck || draft.length === 0 && !emptyAck || !validated.success) return;
    const request = begin(); if (!request) return;
    try {
      const input = AssistantRuleConfirmationInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, agentKey: owner.agentKey, ...target,
        confirmationId: crypto.randomUUID(), expectedProposalHash: proposal.proposalHash, expectedConfigurationRevision: proposal.baseConfiguration.revision,
        expectedConfigurationHash: proposal.baseConfiguration.hash, rules: validated.data, confirmSharedScope: true, confirmClearAll: draft.length === 0 && emptyAck });
      const metadata: RuleConfirmationPending = { version: 1, ...owner, threadId: input.threadId, operationId: input.operationId, confirmationId: input.confirmationId,
        baseRevision: input.expectedConfigurationRevision, baseHash: input.expectedConfigurationHash, proposalHash: input.expectedProposalHash };
      // Avoid persisting role/scopeKey or private rule text from the component owner.
      const stored = { version: metadata.version, userId: owner.userId, workspaceId: owner.workspaceId, agentKey: owner.agentKey, threadId: metadata.threadId, operationId: metadata.operationId, confirmationId: metadata.confirmationId, baseRevision: metadata.baseRevision, baseHash: metadata.baseHash, proposalHash: metadata.proposalHash };
      ownStorage.current = true;
      try { await reserveRuleConfirmation(owner, stored, request.signal); } finally { ownStorage.current = false; }
      if (!request.current()) return;
      submitted.current = { confirmationId: input.confirmationId, targetKey: keyOf(target)!, revision: revision.current };
      const raw = await api.confirmRules.mutate(input); if (request.current()) await accept(raw, stored, request);
    } catch (cause) { if (request.current() && !quarantine(cause)) { syncPending(); setSharedAck(false); setEmptyAck(false); setNotice("未获得可验证的规则保存回执（可能包含版本冲突）；草稿保留。若已生成确认 UUID，只能核对或永久取消该 UUID，不能换新 UUID 自动重发或自动改用新版本。"); } }
    finally { request.done(); }
  }
  async function recover(cancel = false) {
    if (!pending || storageError) return;
    let stored: RuleConfirmationPending | null;
    try { stored = readRuleConfirmationPending(owner); } catch { syncPending(); return; }
    if (!stored || stored.confirmationId !== pending.confirmationId || cancel && cancelFor !== stored.confirmationId) { syncPending(); setCancelFor(null); return; }
    const request = begin(); if (!request) return;
    try {
      const input = AssistantRuleConfirmationOperationInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, agentKey: owner.agentKey, threadId: stored.threadId, operationId: stored.operationId, confirmationId: stored.confirmationId });
      const raw = cancel ? await api.cancelRuleConfirmation.mutate(input) : await api.checkRuleConfirmation.query(input, { signal: request.signal });
      if (request.current()) await accept(raw, stored, request);
    } catch (cause) { if (request.current() && !quarantine(cause)) { setCancelFor(null); setNotice("原规则确认未获得可验证回执；同一 UUID 与草稿保留，未重新保存。请继续核对或取消。"); } }
    finally { request.done(); }
  }
  syncRef.current = syncPending; reloadRef.current = initialize => { void reload(initialize); };
  useEffect(() => {
    const state = life.current; state.active = true; syncRef.current();
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === storageKey) syncRef.current(); };
    const local = (event: Event) => { if ((event as CustomEvent).detail === storageKey) syncRef.current(); };
    window.addEventListener("storage", storage); window.addEventListener(RULE_CONFIRMATION_PENDING_EVENT, local);
    return () => { state.active = false; state.epoch++; for (const controller of state.controllers) controller.abort(); state.controllers.clear(); window.removeEventListener("storage", storage); window.removeEventListener(RULE_CONFIRMATION_PENDING_EVENT, local); };
  }, [api, storageKey]);
  useEffect(() => { readTicket.current++; submitted.current = null; revision.current++; setProposal(null); setDraft([]); setBaseline(null); setError(null); setSharedAck(false); setEmptyAck(false); setLoading(false); if (targetKey) reloadRef.current(true); }, [targetKey]);
  useEffect(() => { callbackRef.current.onDirtyChange?.(dirty || !!pending); return () => callbackRef.current.onDirtyChange?.(false); }, [dirty, pending]);
  function edit(next: string[]) { if (busy || pending || storageError) return; setDraft(next); revision.current++; setSharedAck(false); setEmptyAck(false); }
  function close() { if (busy || dirtyRef.current && !window.confirm("关闭将丢弃未保存的规则草稿，是否继续？已提交的确认仍可恢复。")) return; callbackRef.current.onTargetClose(); }
  if (denied) return null;
  const conflict = !!proposal && (!proposal.currentConfiguration || proposal.currentConfiguration.revision !== proposal.baseConfiguration.revision || proposal.currentConfiguration.hash !== proposal.baseConfiguration.hash);
  return <AssistantRuleConfirmationPanel open={!!target} proposal={proposal ? { baseRevision: proposal.baseConfiguration.revision, currentRevision: proposal.currentConfiguration?.revision ?? null, rules: proposal.proposedRules, canConfirm: proposal.capability.available, conflict, reason: reason(proposal.capability.reasonCode) } : null}
    draft={draft} dirty={dirty} busy={busy} pending={pending} storageError={storageError} locksAvailable={conversationLocksAvailable()} loading={loading} error={error} notice={notice}
    validationError={target && proposal ? validationError : null} sharedAcknowledged={sharedAck} emptyAcknowledged={emptyAck} cancelAcknowledged={!!pending && cancelFor === pending.confirmationId}
    onClose={close} onReload={() => void reload()} onSave={() => void save()} onRule={(index, value) => edit(draft.map((rule, i) => i === index ? value : rule))}
    onAdd={() => edit([...draft, ""])} onRemove={index => edit(draft.filter((_, i) => i !== index))} onClear={() => edit([])}
    onSharedAcknowledged={setSharedAck} onEmptyAcknowledged={setEmptyAck} onCheck={() => void recover()} onCancel={() => void recover(true)} onCancelAcknowledged={value => setCancelFor(value && pending ? pending.confirmationId : null)} />;
}
