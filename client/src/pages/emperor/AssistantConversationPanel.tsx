import { useRef } from "react";
import type { AssistantConversationMode, AssistantConversationState } from "@shared/assistantConversation";
import { CONVERSATION_FILE_ACCEPT, type ConversationDraftFile, type ConversationPending } from "./AssistantConversationDraft";

export type ConversationThreadView = { threadId: string; title: string; version: number; activeOperationId: string | null };
export type ConversationAttachmentView = { name: string; sizeBytes: number; image: boolean; coverage: string; warnings: string[] };
export type ConversationMessageView = {
  operationId: string; sequence: number; mode: AssistantConversationMode; message: string; reply: string | null;
  state: AssistantConversationState; errorCode: string | null; selectedSkillSlug: string | null;
  configurationRevision: number; createdAt: string; attachments: ConversationAttachmentView[];
  proposedRules: string[] | null;
};
export type ConversationOptionsView = {
  title: string; model: string | null; configurationRevision: number | null;
  createAvailable: boolean; submitAvailable: boolean; cancelAvailable: boolean; uploadAvailable: boolean;
  reason: string | null; skills: Array<{ slug: string; name: string; version: number }>;
};
export type ConversationReadView<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };
export type AssistantConversationPanelProps = {
  options: ConversationReadView<ConversationOptionsView>;
  threads: ConversationReadView<ConversationThreadView[]>; nextThreadPage: boolean;
  selectedThread: ConversationThreadView | null;
  history: ConversationReadView<ConversationMessageView[]> | null; nextHistoryPage: boolean;
  mode: AssistantConversationMode; skillSlug: string; message: string; title: string;
  files: ConversationDraftFile[]; readingFiles: boolean; busy: boolean; draftLocked?: boolean;
  pending: ConversationPending | null; pendingState: AssistantConversationState | "not_found" | null;
  cancelAcknowledged: boolean; storageError: boolean; locksAvailable: boolean;
  notice: string; denied: boolean;
  onReload: () => void; onSelectThread: (threadId: string) => void;
  onLoadThreads: () => void; onLoadHistory: () => void; onCreateThread: () => void;
  onTitle: (title: string) => void; onMode: (mode: AssistantConversationMode) => void;
  onSkill: (slug: string) => void; onMessage: (message: string) => void;
  onFiles: (files: File[]) => void; onRemoveFile: (id: string) => void; onSend: () => void;
  onCheck: () => void; onCancel: () => void; onCancelAcknowledged: (value: boolean) => void;
  onRecoverMessage?: (operationId: string) => void;
  onReviewRules?: (operationId: string) => void;
};
const button = "min-h-10 rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-40";
const input = "block w-full min-w-0 max-w-full rounded-lg border border-white/15 bg-[#101622] px-3 py-2 text-sm text-slate-100";
const labels: Record<AssistantConversationState, string> = {
  queued: "已持久入队", route_dispatched: "Skill 选择请求已发出", route_ready: "Skill 选择已保存",
  reply_dispatched: "对话请求已发出", reply_ready: "回复已保存，等待完成确认", succeeded: "对话已完成",
  failed: "对话失败", canceled: "已取消", unknown: "结果未知：不会重复调用",
};
function ReadError({ state }: { state: ConversationReadView<unknown> }) {
  return state.status === "loading" ? <p role="status" className="text-sm text-slate-400">正在读取私有对话…</p>
    : state.status === "error" ? <p role="alert" className="text-sm text-red-300">{state.message}；读取失败不是没有记录。</p> : null;
}
export default function AssistantConversationPanel(props: AssistantConversationPanelProps) {
  const picker = useRef<HTMLInputElement>(null);
  const option = props.options.status === "ready" ? props.options.value : null;
  const blocked = props.denied || props.busy || props.readingFiles || props.draftLocked || !!props.pending || props.storageError;
  const sendable = !blocked && props.locksAvailable && option?.submitAvailable && (!props.files.length || option.uploadAvailable) && props.selectedThread && !props.selectedThread.activeOperationId && props.message.trim().length > 0;
  return <section aria-label="助手私有对话" className="min-w-0 space-y-4 rounded-xl border border-violet-500/20 bg-white/[0.025] p-4 sm:p-5">
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="text-lg font-semibold text-slate-100">{option?.title ?? "对话与调教"}</h3><p className="mt-1 break-words text-xs text-slate-400">对话仅本人可见 · 候选规则未经人工确认不会生效{option?.configurationRevision ? ` · 配置 v${option.configurationRevision}` : ""}{option?.model ? ` · ${option.model}` : ""}</p></div>
      <button type="button" className={button} disabled={props.busy} onClick={props.onReload}>刷新对话状态</button>
    </header>
    <p className="text-xs leading-6 text-amber-200">这里提供基于已批准上下文的对话、分析与写作，不代表执行了业务 Skill、写入了业务数据或启动了自动任务。自动工作模式可能包含“选择 Skill → 生成回复”两次模型调用。</p>
    <ReadError state={props.options} />
    {option?.reason && <p role="status" className="break-words text-sm text-amber-300">{option.reason}</p>}
    {props.notice && <p role="status" className="whitespace-pre-wrap break-words rounded-lg border border-amber-500/30 p-3 text-sm text-amber-200">{props.notice}</p>}
    {props.storageError && <p role="alert" className="text-red-300">本机恢复记录不可读，已停止新提交；不要清除存储或创建新 UUID 重试，请先核对原操作。</p>}
    {!props.locksAvailable && <p role="alert" className="text-amber-300">浏览器不支持跨窗口安全锁，无法开始新提交；仍可核对已有操作。</p>}
    {props.denied ? <p role="alert">权限或身份已变化，私有记录和草稿已清除，请重新进入。</p> : <>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2"><label className="text-xs text-slate-400">私有项目会话<select aria-label="私有项目会话" className={input} value={props.selectedThread?.threadId ?? ""} disabled={props.busy || props.readingFiles} onChange={event => props.onSelectThread(event.currentTarget.value)}><option value="">选择会话</option>{props.threads.status === "ready" && props.threads.value.map(thread => <option key={thread.threadId} value={thread.threadId}>{thread.title}</option>)}</select></label><ReadError state={props.threads} />{props.nextThreadPage && <button className={button} disabled={props.busy} onClick={props.onLoadThreads}>加载更多会话</button>}</div>
        <div className="min-w-0"><label className="text-xs text-slate-400">新会话名称<input aria-label="新会话名称" maxLength={80} value={props.title} className={input} disabled={blocked} onChange={event => props.onTitle(event.currentTarget.value)} /></label><button className={`${button} mt-2`} disabled={blocked || !option?.createAvailable || !props.title.trim()} onClick={props.onCreateThread}>创建私有会话</button></div>
      </div>
      {props.pending && <aside aria-label="原对话恢复" className="min-w-0 space-y-3 rounded-lg border border-amber-500/30 p-3 text-sm">
        <p className="break-all">原操作 UUID：{props.pending.operationId}</p><p className="break-all">会话：{props.pending.threadId} · 提交时配置 v{props.pending.configurationRevision}</p>
        <p>{props.pendingState === "not_found" ? "暂未查到原操作，不等于失败；迟到请求仍可能到达。" : props.pendingState ? labels[props.pendingState] : "尚未核实提交结果"}</p>
        <p className="text-xs text-amber-200">关闭开关或没有新执行权限时，仍可核对或取消原 UUID。页面状态不代表工作进程正在运行；未知结果不会自动重新发送。</p>
        <button className={button} disabled={props.busy} onClick={props.onCheck}>核对原对话</button>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={props.cancelAcknowledged} disabled={props.busy} onChange={event => props.onCancelAcknowledged(event.currentTarget.checked)} />我确认取消上述 UUID；取消只阻止后续保存，不能撤回已发出的模型请求或费用。</label>
        <button className={button} disabled={props.busy || !props.cancelAcknowledged || !option?.cancelAvailable || !props.locksAvailable} onClick={props.onCancel}>永久取消原对话</button>
      </aside>}
      <div aria-label="Agent 对话记录" className="max-h-[540px] min-h-48 min-w-0 space-y-5 overflow-y-auto rounded-lg bg-black/15 p-3">
        {!props.selectedThread && <p className="py-10 text-center text-sm text-slate-400">请选择或创建私有会话。不同会话的上下文相互隔离。</p>}
        {props.history && <ReadError state={props.history} />}
        {props.history?.status === "ready" && props.history.value.length === 0 && <p className="py-10 text-center text-sm text-slate-400">此会话尚无消息，可以发送任务或需要讨论的资料。</p>}
        {props.nextHistoryPage && <button className={button} disabled={props.busy} onClick={props.onLoadHistory}>加载更早消息</button>}
        {props.history?.status === "ready" && props.history.value.map(item => <article key={item.operationId} className="min-w-0 space-y-2" aria-label={`第 ${item.sequence} 轮对话`}>
          <div className="ml-3 min-w-0 rounded-xl bg-violet-500/10 p-3 sm:ml-8"><p className="text-xs text-slate-400">你 · {item.createdAt} · {item.mode === "work" ? "帮我工作" : "调教与纠正"}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{item.message}</p>
            {item.attachments.map((file, index) => <details key={index} className="mt-2 min-w-0 text-xs text-slate-400"><summary className="break-words [overflow-wrap:anywhere]">{file.image ? "图片" : "文档"} · {file.name} · {file.sizeBytes} 字节</summary><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{file.coverage}</p>{file.warnings.map((warning, i) => <p key={i} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{warning}</p>)}{file.image && <p>历史图片不自动重用，需要再次分析时请重新附图。</p>}</details>)}
          </div>
          <div className="mr-2 min-w-0 rounded-xl border border-white/10 p-3 sm:mr-5"><p className="break-words text-xs text-violet-300">{labels[item.state]} · 配置 v{item.configurationRevision}{item.selectedSkillSlug ? ` · 上下文 Skill：${item.selectedSkillSlug}` : ""}</p>{item.reply !== null && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{item.reply}</p>}{item.errorCode && <p className="mt-2 break-words text-xs text-amber-300">原因：{item.errorCode}</p>}
            {props.onRecoverMessage && !["succeeded", "failed", "canceled"].includes(item.state) && <button type="button" className={`${button} mt-2`} disabled={props.busy || !props.locksAvailable || !!props.pending && props.pending.operationId !== item.operationId} onClick={() => props.onRecoverMessage?.(item.operationId)}>管理第 {item.sequence} 轮原对话</button>}
            {item.proposedRules !== null && <details className="mt-3 border-t border-white/10 pt-3"><summary className="text-sm">{item.proposedRules.length} 条完整候选规则（不会自动生效）</summary><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{item.proposedRules.map((rule, index) => <li className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" key={index}>{rule}</li>)}</ol>{props.onReviewRules && item.mode === "coach" && item.state === "succeeded" ? <><p className="mt-3 text-xs text-amber-200">候选基于 v{item.configurationRevision}；须重新核对来源和当前配置，人工编辑完整列表后明确确认。此前是否已应用应以配置与确认回执为准。</p><button type="button" className={`${button} mt-2`} disabled={props.busy} onClick={() => props.onReviewRules?.(item.operationId)}>审核第 {item.sequence} 轮候选规则</button></> : <p className="mt-3 text-xs text-amber-200">候选规则确认尚未接通或当前对话尚未成功，不会自动保存。现有规则编辑器仍是唯一配置入口；候选基于 v{item.configurationRevision}，须人工核对当前版本后再修改。</p>}</details>}
          </div>
        </article>)}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><label className="min-w-0 text-xs text-slate-400">对话模式<select aria-label="对话模式" className={input} value={props.mode} disabled={blocked} onChange={event => props.onMode(event.currentTarget.value as AssistantConversationMode)}><option value="work">帮我工作</option><option value="coach">调教与纠正</option></select></label><label className="min-w-0 text-xs text-slate-400">本次上下文 Skill<select aria-label="本次上下文 Skill" className={input} value={props.skillSlug} disabled={blocked} onChange={event => props.onSkill(event.currentTarget.value)}><option value="">按对话要求自动选择</option>{option?.skills.map(skill => <option key={skill.slug} value={skill.slug}>{skill.name} · v{skill.version}</option>)}</select></label></div>
      <textarea aria-label="给助手的消息" className={`${input} min-h-28`} maxLength={8000} value={props.message} disabled={blocked} placeholder="描述任务、粘贴图片，或告诉助手如何改进…" onChange={event => props.onMessage(event.currentTarget.value)} onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); props.onFiles(files); } }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (sendable) props.onSend(); } }} />
      <div className="flex min-w-0 flex-wrap gap-2">{props.files.map(file => <div key={file.id} className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-white/10 p-2 text-xs">{file.previewUrl && <img className="h-12 w-12 shrink-0 rounded object-contain" src={file.previewUrl} alt={`${file.name} 附件预览`} />}<span className="min-w-0 break-all">{file.name} · {file.sizeBytes} 字节</span><button type="button" className={button} disabled={blocked} aria-label={`移除 ${file.name}`} onClick={() => props.onRemoveFile(file.id)}>移除</button></div>)}</div>
      {props.files.length > 0 && option && !option.uploadAvailable && <p role="alert" className="text-xs text-amber-200">当前附件提交能力不可用；文件仍在本页草稿，不会提交。可移除附件后发送文字，或重新核对权限与运行时。</p>}
      <input ref={picker} type="file" multiple accept={CONVERSATION_FILE_ACCEPT} aria-label="选择对话附件" className="sr-only" disabled={blocked} onChange={event => { props.onFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
      <div className="flex flex-wrap justify-between gap-2"><button className={button} disabled={blocked} onClick={() => picker.current?.click()}>{props.readingFiles ? "正在读取附件…" : "添加图片 / 文件"}</button><button className={`${button} bg-violet-500/20`} disabled={!sendable} onClick={props.onSend}>发送对话</button></div>
      <p className="text-xs leading-6 text-slate-400">最多 3 个附件，每个 3 MiB；图片最多 3000 万像素。PDF 前 30 页、表格前 5 表且每表前 300 行、提取文字最多 40000 字；服务端会检查真实类型与完整提取范围。最近 6 轮文字与文档上下文可用，历史图片须重传。附件与回复不会自动成为长期规则。未发送正文和附件只保留在当前页面内存。</p>
    </>}
  </section>;
}
