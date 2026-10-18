import type { RuleConfirmationPending } from "./AssistantRuleConfirmationDraft";

export type RuleProposalView = {
  baseRevision: number; currentRevision: number | null;
  rules: string[]; canConfirm: boolean; reason: string | null; conflict: boolean;
};
export type AssistantRuleConfirmationPanelProps = {
  open: boolean; loading: boolean; error: string | null; notice: string;
  proposal: RuleProposalView | null; draft: string[]; dirty: boolean; busy: boolean;
  pending: RuleConfirmationPending | null; storageError: boolean; locksAvailable: boolean;
  sharedAcknowledged: boolean; emptyAcknowledged: boolean; cancelAcknowledged: boolean;
  validationError: string | null;
  onClose: () => void; onReload: () => void; onSave: () => void;
  onRule: (index: number, value: string) => void; onAdd: () => void; onRemove: (index: number) => void;
  onClear: () => void; onSharedAcknowledged: (value: boolean) => void; onEmptyAcknowledged: (value: boolean) => void;
  onCheck: () => void; onCancel: () => void; onCancelAcknowledged: (value: boolean) => void;
};
const button = "min-h-10 rounded-lg border border-white/15 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40";
export default function AssistantRuleConfirmationPanel(props: AssistantRuleConfirmationPanelProps) {
  if (!props.open && !props.pending && !props.storageError && !props.notice) return null;
  const locked = props.busy || !!props.pending || props.storageError;
  const canSave = !locked && !props.loading && props.locksAvailable && props.proposal?.canConfirm && !props.proposal.conflict
    && props.sharedAcknowledged && (props.draft.length > 0 || props.emptyAcknowledged) && !props.validationError;
  return <section aria-label="候选规则人工确认" className="min-w-0 space-y-4 rounded-xl border border-amber-500/30 bg-[#131321] p-4 text-slate-200">
    <header className="flex min-w-0 flex-wrap justify-between gap-2"><h3 className="font-semibold">候选规则人工确认</h3>{props.open && <button type="button" className={button} disabled={props.busy} onClick={props.onClose}>关闭规则编辑</button>}</header>
    <p className="text-sm leading-6 text-amber-200">此处保存的是整个工作区该助手的长期规则，不只是你自己的会话。确认将替换完整规则列表，其他成员今后的对话也会受影响；不会改变模型、提示词、Skill 绑定或取消原消息。</p>
    {props.notice && <p role="status" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{props.notice}</p>}
    {props.storageError && <p role="alert" className="text-red-300">规则确认恢复记录不可读，已停止新确认；请勿清除存储或换 UUID 重试。</p>}
    {!props.locksAvailable && <p role="alert" className="text-amber-200">浏览器缺少跨窗口安全锁，不能创建新的规则确认；仍可核对原确认。</p>}
    {props.pending && <aside aria-label="原规则确认恢复" className="min-w-0 space-y-3 rounded-lg border border-amber-500/30 p-3 text-sm">
      <p className="break-all">规则确认 UUID：{props.pending.confirmationId}</p><p className="break-all">来源消息：{props.pending.operationId} · 基础配置 v{props.pending.baseRevision}</p>
      <p>没有可验证终态前只能检查或取消这个确认 UUID，不会再次保存。取消规则确认不会取消原对话；已经提交的规则不能靠取消回滚。</p>
      <button type="button" className={button} disabled={props.busy} onClick={props.onCheck}>核对原规则确认</button>
      <label className="flex items-start gap-2"><input type="checkbox" checked={props.cancelAcknowledged} disabled={props.busy} onChange={event => props.onCancelAcknowledged(event.currentTarget.checked)} />我确认永久取消上述规则确认 UUID</label>
      <button type="button" className={button} disabled={props.busy || !props.locksAvailable || !props.cancelAcknowledged} onClick={props.onCancel}>永久取消原规则确认</button>
    </aside>}
    {props.open && <>
      <button type="button" className={button} disabled={props.busy || props.loading} onClick={props.onReload}>重新核对规则来源与当前版本</button>
      {props.loading && <p role="status">正在读取私有候选与当前配置…</p>}
      {props.error && <p role="alert" className="break-words text-red-300">{props.error}；未将读取失败视为没有规则，编辑草稿仍保留。</p>}
      {props.proposal && <>
        <p className="text-sm">候选基于配置 v{props.proposal.baseRevision} · 当前配置 {props.proposal.currentRevision === null ? "不可用" : `v${props.proposal.currentRevision}`}</p>
        {props.proposal.reason && <p role="alert" className="break-words text-amber-200">{props.proposal.reason}</p>}
        {props.proposal.conflict && <p role="alert" className="text-amber-200">基础配置与当前版本冲突。保留编辑草稿，但不能自动改用新版本覆盖；请返回现有配置入口人工核对，或在新版本下生成新候选。</p>}
        <p className="text-xs text-slate-400">此处核对当前配置的版本和指纹，不复制其他配置字段；当前完整规则可在已有配置编辑器中查看。保存后请手动刷新该编辑器，避免覆盖其中未保存草稿。</p>
        <details><summary>查看原始完整候选（{props.proposal.rules.length}）</summary><ol className="list-decimal space-y-2 pl-5">{props.proposal.rules.map((rule, i) => <li key={i} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{rule}</li>)}</ol></details>
      </>}
      <div className="min-w-0 space-y-3">{props.draft.map((rule, index) => <div className="min-w-0 space-y-2" key={index}><label className="block min-w-0 text-sm">第 {index + 1} 条完整规则<textarea aria-label={`第 ${index + 1} 条规则`} className="mt-1 block min-h-24 w-full min-w-0 max-w-full rounded-lg border border-white/15 bg-[#0b1019] p-3" value={rule} disabled={locked || !props.proposal} onChange={event => props.onRule(index, event.currentTarget.value)} /></label><button type="button" className={button} disabled={locked || !props.proposal} onClick={() => props.onRemove(index)}>移除第 {index + 1} 条规则</button></div>)}</div>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={locked || !props.proposal || props.draft.length >= 30} onClick={props.onAdd}>添加一条规则</button><button type="button" className={button} disabled={locked || !props.proposal} onClick={props.onClear}>清空完整规则列表</button></div>
      <p className="text-xs text-slate-400">每条规则保留内部换行，不按换行拆分。最多 30 条，每条最多 500 字，总计最多 10000 字；空白规则须明确移除，不能静默丢弃。</p>
      {props.validationError && <p role="alert" className="text-red-300">{props.validationError}</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={props.sharedAcknowledged} disabled={locked || !props.proposal} onChange={event => props.onSharedAcknowledged(event.currentTarget.checked)} />我已核对完整列表，确认替换本工作区该助手的共享长期规则</label>
      {props.draft.length === 0 && <label className="flex items-start gap-2 text-sm text-amber-200"><input type="checkbox" checked={props.emptyAcknowledged} disabled={locked || !props.proposal} onChange={event => props.onEmptyAcknowledged(event.currentTarget.checked)} />我明确确认清空该助手的全部长期规则</label>}
      <button type="button" className={`${button} bg-violet-500/20`} disabled={!canSave} onClick={props.onSave}>确认保存完整规则</button>
      {props.dirty && <p className="text-xs text-amber-200">有未保存的规则草稿；关闭或切换时会提示，草稿仅保留在当前页面内存。</p>}
    </>}
  </section>;
}
