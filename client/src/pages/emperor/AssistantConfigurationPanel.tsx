import { useEffect, useState } from "react";
import { AGENT_LIBRARY_ROLES, type AgentLibraryKey } from "@shared/agentLibraryContracts";
import {
  AssistantConfigurationSchema, type AssistantConfiguration, type AssistantConfigurationMetadata,
  type AssistantConfigurationRead as AssistantConfigurationDetail, type AssistantConfigurationOptions,
  type AssistantConfigurationHistory,
} from "@shared/assistantConfigurations";
export type {
  AssistantConfigurationMetadata, AssistantConfigurationRead as AssistantConfigurationDetail,
  AssistantConfigurationOptions, AssistantConfigurationHistory,
} from "@shared/assistantConfigurations";
import {
  assistantConfigurationDraftIsStale, createAssistantConfigurationDraft, createAssistantConfigurationRequestGuard,
  discardAssistantConfigurationDraft, observeAssistantConfiguration, parseAssistantConfigurationDraft,
  updateAssistantConfigurationDraft, type AssistantConfigurationDraft, type AssistantConfigurationRecord,
} from "./assistantConfigurationDraft";

export type AssistantConfigurationReadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; scopeKey: string; data: T };
export type AssistantConfigurationPanelProps = {
  agentKey: AgentLibraryKey; scopeKey: string; canEdit: boolean; writesEnabled?: boolean;
  metadata: AssistantConfigurationReadState<AssistantConfigurationMetadata>;
  detail?: AssistantConfigurationReadState<AssistantConfigurationDetail>;
  options?: AssistantConfigurationReadState<AssistantConfigurationOptions>;
  history?: AssistantConfigurationReadState<AssistantConfigurationHistory>;
  onSave: (input: { agentKey: AgentLibraryKey; expectedRevision: number; config: AssistantConfiguration }) => Promise<AssistantConfigurationRecord>;
  onRestore: (input: { agentKey: AgentLibraryKey; expectedRevision: number; targetRevision: number }) => Promise<AssistantConfigurationRecord>;
  onReadVersion?: (input: { agentKey: AgentLibraryKey; revision: number }) => Promise<{ revision: number; config: AssistantConfiguration }>;
  onReload?: () => void;
  onLoadHistoryPage?: (beforeRevision: number) => void;
};

const inputClass = "mt-1 w-full rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm text-slate-100 disabled:opacity-60";
const buttonClass = "rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200 disabled:cursor-not-allowed disabled:opacity-40";
const panelClass = "rounded-xl border border-white/10 bg-white/[0.025] p-5";

function currentData<T>(state: AssistantConfigurationReadState<T> | undefined, scopeKey: string): T | undefined {
  return state?.status === "ready" && state.scopeKey === scopeKey ? state.data : undefined;
}

function ReadNotice({ state, noun, scopeKey }: { state?: AssistantConfigurationReadState<unknown>; noun: string; scopeKey: string }) {
  if (state?.status === "error") return <p role="alert" className="mt-3 text-sm text-red-300">{noun}读取失败：{state.message}。未将失败视为未配置，请刷新重试。</p>;
  if (!state || state.status === "loading" || (state.status === "ready" && state.scopeKey !== scopeKey)) return <p role="status" className="mt-3 text-sm text-slate-400">正在读取{noun}…</p>;
  return null;
}

function validatedRecord(detail: AssistantConfigurationDetail | undefined, agentKey: AgentLibraryKey) {
  if (!detail) return { kind: "waiting" } as const;
  if (detail.status === "not-configured") return detail.agentKey === agentKey ? { kind: "ready", record: null } as const : { kind: "waiting" } as const;
  const record = detail.record;
  if (record.agentKey !== agentKey) return { kind: "waiting" } as const;
  const parsed = AssistantConfigurationSchema.safeParse(record.config);
  if (!parsed.success || !Number.isSafeInteger(record.revision) || record.revision < 1) return { kind: "invalid" } as const;
  return { kind: "ready", record: { ...record, config: parsed.data } } as const;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求未完成，请重试";
}

function resourceIssues(config: AssistantConfiguration, options: AssistantConfigurationOptions, requiresVision: boolean): string[] {
  const issues: string[] = [];
  if (config.modelSlug) {
    const model = options.models.find(item => item.slug === config.modelSlug);
    if (!model) issues.push("所选模型不在当前服务器可用选项中，请重新选择或继承业务模型。");
    else if (requiresVision && !model.capabilityTags.includes("vision")) issues.push("此角色需要视觉能力，请选择服务器已验证 vision 能力的模型。");
  }
  for (const binding of config.skills) {
    if (!options.skills.some(item => item.slug === binding.slug && item.version === binding.version && item.manifestSha256 === binding.manifestSha256)) {
      issues.push(`Skill ${binding.slug} 的版本或内容摘要已不在当前发布选项中，请重新选择或移除。`);
    }
  }
  return issues;
}

function HistoricalPreview({ revision, config }: { revision: number; config: AssistantConfiguration }) {
  return <section aria-label={`版本 ${revision} 配置预览`} className="mt-4 space-y-3 rounded-lg border border-white/10 p-4 text-xs text-slate-400">
    <h4 className="text-sm text-slate-200">版本 {revision} 配置预览</h4>
    <p>{config.name} · 配置设为{config.enabled ? "启用" : "停用"}（尚未接入业务执行） · {config.modelSlug || "继承业务模型"}</p>
    <p className="whitespace-pre-wrap">{config.description || "无描述"}</p>
    <p className="text-slate-300">长期指令</p><pre className="whitespace-pre-wrap break-words font-sans">{config.instructions || "未设置"}</pre>
    <p className="text-slate-300">长期规则</p><ul className="list-inside list-disc space-y-1">{config.rules.map((rule, index) => <li key={index}>{rule}</li>)}</ul>
    {config.rules.length === 0 && <p>未设置规则</p>}
    <p className="text-slate-300">Skill 绑定</p>{config.skills.map(skill => <div key={skill.slug} className="rounded border border-white/10 p-2"><p className="break-all">{skill.slug} · v{skill.version} · 摘要 {skill.manifestSha256.slice(0, 12)} · 绑定设为{skill.enabled ? "启用" : "停用"}（尚未接入业务执行）</p><p className="whitespace-pre-wrap">触发条件：{skill.trigger || "未设置"}</p><p className="whitespace-pre-wrap">补充指令：{skill.instructions || "未设置"}</p></div>)}
    {config.skills.length === 0 && <p>未绑定 Skill</p>}
  </section>;
}

function ConfigurationEditor(props: AssistantConfigurationPanelProps) {
  const { agentKey, scopeKey, detail, options, history } = props;
  const incoming = currentData(detail, scopeKey);
  const initial = validatedRecord(incoming, agentKey);
  const [draft, setDraft] = useState<AssistantConfigurationDraft | null>(() => initial.kind === "ready" ? createAssistantConfigurationDraft(agentKey, initial.record) : null);
  const [guard] = useState(createAssistantConfigurationRequestGuard);
  const [pending, setPending] = useState<"save" | "restore" | "version" | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [preview, setPreview] = useState<{ revision: number; config: AssistantConfiguration } | null>(null);
  useEffect(() => { guard.activate(); return () => guard.dispose(); }, [guard]);
  useEffect(() => {
    const checked = validatedRecord(incoming, agentKey);
    if (checked.kind === "ready") setDraft(current => current ? observeAssistantConfiguration(current, checked.record) : createAssistantConfigurationDraft(agentKey, checked.record));
  }, [incoming, agentKey]);

  const checked = validatedRecord(incoming, agentKey);
  const available = currentData(options, scopeKey);
  const versions = currentData(history, scopeKey);
  const writesEnabled = props.writesEnabled === true;
  const requiresVision = AGENT_LIBRARY_ROLES.find(role => role.key === agentKey)!.requiresVision;
  const parsed = draft ? parseAssistantConfigurationDraft(draft.form) : null;
  const issues = parsed?.success && available ? resourceIssues(parsed.data, available, requiresVision) : [];
  const stale = draft ? assistantConfigurationDraftIsStale(draft) : false;
  const canSubmit = writesEnabled && !!draft && !!parsed?.success && !!available && checked.kind === "ready" && issues.length === 0 && !stale && !pending;

  function edit(fields: Partial<AssistantConfigurationDraft["form"]>) {
    setDraft(current => current ? updateAssistantConfigurationDraft(current, { ...current.form, ...fields }) : current);
    setNotice(null);
  }

  async function save() {
    if (!writesEnabled || !draft || !parsed?.success || !canSubmit) return;
    const request = guard.begin();
    setPending("save"); setNotice(null);
    try {
      const result = await props.onSave({ agentKey, expectedRevision: draft.expectedRevision, config: parsed.data });
      if (!guard.accepts(request)) return;
      const saved = validatedRecord({ status: "configured", record: result }, agentKey);
      if (saved.kind !== "ready" || !saved.record || saved.record.revision <= draft.expectedRevision) throw new Error("保存响应格式或版本无效，请重新读取配置；草稿已保留。");
      setDraft(createAssistantConfigurationDraft(agentKey, saved.record));
      setNotice({ error: false, message: `已保存版本 ${saved.record.revision}。` });
      props.onReload?.();
    } catch (error) {
      if (guard.accepts(request)) setNotice({ error: true, message: `保存失败，草稿已保留：${errorMessage(error)}` });
    } finally { if (guard.accepts(request)) setPending(null); }
  }

  async function readVersion(revision: number) {
    if (!props.onReadVersion || pending) return;
    const request = guard.begin(); setPending("version"); setNotice(null);
    try {
      const result = await props.onReadVersion({ agentKey, revision });
      if (!guard.accepts(request)) return;
      const parsedVersion = AssistantConfigurationSchema.safeParse(result.config);
      if (result.revision !== revision || !parsedVersion.success) throw new Error("历史配置格式或版本无效");
      setPreview({ revision, config: parsedVersion.data });
    } catch (error) { if (guard.accepts(request)) setNotice({ error: true, message: `历史版本读取失败：${errorMessage(error)}` }); }
    finally { if (guard.accepts(request)) setPending(null); }
  }

  async function restore(targetRevision: number) {
    if (!writesEnabled || !draft || draft.dirty || stale || pending || checked.kind !== "ready") return;
    const request = guard.begin(); setPending("restore"); setNotice(null);
    try {
      const result = await props.onRestore({ agentKey, expectedRevision: draft.expectedRevision, targetRevision });
      if (!guard.accepts(request)) return;
      const saved = validatedRecord({ status: "configured", record: result }, agentKey);
      if (saved.kind !== "ready" || !saved.record || saved.record.revision <= draft.expectedRevision) throw new Error("恢复响应未产生有效的新版本");
      setDraft(createAssistantConfigurationDraft(agentKey, saved.record)); setPreview(null);
      setNotice({ error: false, message: `已将历史版本 ${targetRevision} 恢复为新版本 ${saved.record.revision}。` });
      props.onReload?.();
    } catch (error) { if (guard.accepts(request)) setNotice({ error: true, message: `恢复失败：${errorMessage(error)}` }); }
    finally { if (guard.accepts(request)) setPending(null); }
  }

  return <section aria-label="管理员配置编辑器" className={`${panelClass} space-y-4`}>
    <h3 className="font-medium text-slate-100">管理员配置与版本</h3>
    <p className="text-xs leading-6 text-slate-500">仅管理员且拥有 agent.update 权限可读取完整配置和保存。保存只产生配置版本，不启动聊天、Skill 或业务任务。</p>
    {!writesEnabled && <p role="status" className="text-sm text-amber-300">本环境配置保存未启用。可查看完整配置与历史版本，并编辑本地草稿；保存与恢复暂不可用。</p>}
    <ReadNotice state={detail} noun="完整配置" scopeKey={scopeKey} />
    {checked.kind === "invalid" && <p role="alert" className="text-sm text-red-300">配置格式错误，无法安全编辑。未将错误视为未配置，请刷新重试。</p>}
    {draft && <>
      <p className="text-xs text-slate-400">{draft.expectedRevision ? `编辑基于已保存版本 ${draft.expectedRevision}` : "尚未保存配置；下方为本地草稿"}{draft.dirty ? " · 有未保存修改" : ""}</p>
      {stale && <p role="alert" className="text-sm text-amber-300">服务器已有版本 {draft.latest?.revision ?? 0}。当前草稿和原版本号已保留，请先读取并核对最新配置。</p>}
      <fieldset disabled={!!pending} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-400">助手名称<input aria-label="助手名称" className={inputClass} value={draft.form.name} maxLength={60} onChange={event => edit({ name: event.target.value })} /></label><label className="text-xs text-slate-400">描述<input aria-label="描述" className={inputClass} value={draft.form.description} maxLength={500} onChange={event => edit({ description: event.target.value })} /></label></div>
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={draft.form.enabled} onChange={event => edit({ enabled: event.target.checked })} />配置设为启用（尚未接入业务执行）</label>
        <label className="block text-xs text-slate-400">专属模型<select aria-label="专属模型" className={inputClass} value={draft.form.modelSlug} disabled={!available} onChange={event => edit({ modelSlug: event.target.value })}>
          <option value="">继承业务模型策略（独立对话未配置）</option>
          {draft.form.modelSlug && !available?.models.some(model => model.slug === draft.form.modelSlug) && <option value={draft.form.modelSlug} disabled>{draft.form.modelSlug}（当前不可用）</option>}
          {available?.models.map(model => <option key={model.slug} value={model.slug} disabled={requiresVision && !model.capabilityTags.includes("vision")}>{model.name} · {model.modelId} · {model.capabilityTags.join(", ") || "无能力标签"}</option>)}
        </select></label>
        <p className="text-xs leading-6 text-slate-500">模型来自服务器当前可用目录，能力以 capabilityTags 为准。{requiresVision ? "此角色需要服务器已验证的 vision 能力。" : ""}模型留空时继承业务策略；独立对话仍未配置。</p>
        <label className="block text-xs text-slate-400">长期指令<textarea aria-label="长期指令" className={inputClass} rows={6} maxLength={12000} value={draft.form.instructions} onChange={event => edit({ instructions: event.target.value })} /></label>
        <label className="block text-xs text-slate-400">长期规则（每行一条，空行忽略）<textarea aria-label="长期规则" className={inputClass} rows={5} value={draft.form.rulesText} onChange={event => edit({ rulesText: event.target.value })} /></label>
        <div className="space-y-3"><h4 className="text-sm text-slate-200">Skill 绑定</h4><p className="text-xs leading-6 text-slate-500">只能选择服务器返回的当前已发布版本。版本号与内容摘要一并固定，目录刷新不会自动改写草稿。</p>
          {draft.form.skills.map((binding, index) => {
            const exact = available?.skills.some(skill => skill.slug === binding.slug && skill.version === binding.version && skill.manifestSha256 === binding.manifestSha256);
            return <div key={binding.slug} className="space-y-3 rounded-lg border border-white/10 p-3">
              <label className="block text-xs text-slate-400">Skill {index + 1} 版本<select aria-label={`Skill ${index + 1} 版本`} className={inputClass} value={`${binding.slug}:${binding.version}:${binding.manifestSha256}`} disabled={!available} onChange={event => {
                const selected = available?.skills.find(skill => `${skill.slug}:${skill.version}:${skill.manifestSha256}` === event.target.value);
                if (selected) edit({ skills: draft.form.skills.map((item, position) => position === index ? { ...item, slug: selected.slug, version: selected.version, manifestSha256: selected.manifestSha256 } : item) });
              }}>
                {!exact && <option value={`${binding.slug}:${binding.version}:${binding.manifestSha256}`} disabled>{binding.slug} · v{binding.version} · 摘要 {binding.manifestSha256.slice(0, 12)}（当前不可用）</option>}
                {available?.skills.filter(skill => skill.slug === binding.slug || !draft.form.skills.some(item => item.slug === skill.slug)).map(skill => <option key={`${skill.slug}:${skill.version}:${skill.manifestSha256}`} value={`${skill.slug}:${skill.version}:${skill.manifestSha256}`}>{skill.name} · {skill.slug} · v{skill.version} · 摘要 {skill.manifestSha256.slice(0, 12)}</option>)}
              </select></label>
              <label className="flex items-center gap-2 text-xs text-slate-300"><input aria-label={`启用 Skill ${index + 1}`} type="checkbox" checked={binding.enabled} onChange={event => edit({ skills: draft.form.skills.map((item, position) => position === index ? { ...item, enabled: event.target.checked } : item) })} />启用此 Skill 绑定</label>
              <label className="block text-xs text-slate-400">触发条件<input aria-label={`Skill ${index + 1} 触发条件`} className={inputClass} maxLength={500} value={binding.trigger} onChange={event => edit({ skills: draft.form.skills.map((item, position) => position === index ? { ...item, trigger: event.target.value } : item) })} /></label>
              <label className="block text-xs text-slate-400">补充指令<textarea aria-label={`Skill ${index + 1} 补充指令`} className={inputClass} maxLength={8000} rows={3} value={binding.instructions} onChange={event => edit({ skills: draft.form.skills.map((item, position) => position === index ? { ...item, instructions: event.target.value } : item) })} /></label>
              <button type="button" className={buttonClass} onClick={() => edit({ skills: draft.form.skills.filter((_, position) => position !== index) })}>移除 Skill {index + 1}</button>
            </div>;
          })}
          <button type="button" className={buttonClass} disabled={!available?.skills.some(skill => !draft.form.skills.some(item => item.slug === skill.slug)) || draft.form.skills.length >= 80} onClick={() => {
            const skill = available?.skills.find(item => !draft.form.skills.some(binding => binding.slug === item.slug));
            if (skill) edit({ skills: [...draft.form.skills, { slug: skill.slug, version: skill.version, manifestSha256: skill.manifestSha256, enabled: false, trigger: "", instructions: "" }] });
          }}>添加已发布 Skill 绑定</button>
        </div>
      </fieldset>
      <ReadNotice state={options} noun="模型与 Skill 选项" scopeKey={scopeKey} />
      {parsed && !parsed.success && <p role="alert" className="text-xs text-amber-300">配置校验未通过：{parsed.error.issues.map(issue => issue.message).join("；")}</p>}
      {issues.length > 0 && <p role="alert" className="text-xs text-amber-300">{issues.join(" ")}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!canSubmit || (!draft.dirty && draft.expectedRevision > 0)} onClick={() => void save()}>{pending === "save" ? "正在保存…" : "保存配置为新版本"}</button>
        <button type="button" className={buttonClass} disabled={!draft.dirty || !!pending} onClick={() => { setDraft(discardAssistantConfigurationDraft(draft)); setNotice(null); }}>放弃草稿并载入最新已读配置</button>
        {props.onReload && <button type="button" className={buttonClass} disabled={!!pending} onClick={props.onReload}>重新读取配置</button>}</div>
    </>}
    {notice && <p role={notice.error ? "alert" : "status"} className={`text-sm ${notice.error ? "text-red-300" : "text-emerald-300"}`}>{notice.message}</p>}
    <section aria-label="配置版本历史" className="border-t border-white/10 pt-4"><h4 className="text-sm text-slate-200">配置版本历史</h4><p className="mt-2 text-xs leading-6 text-slate-500">恢复历史配置会创建新版本，并按当前版本号检查并发修改。存在草稿时请先保存或明确放弃。</p>
      <ReadNotice state={history} noun="版本历史" scopeKey={scopeKey} />
      {versions?.versions.length === 0 && <p className="mt-3 text-xs text-slate-500">暂无已保存版本。</p>}
      <ul className="mt-3 space-y-2">{versions?.versions.map(version => <li key={version.revision} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-3 text-xs"><span className="text-slate-400">版本 {version.revision} · {version.createdAt}{version.sourceRevision !== null ? ` · 从版本 ${version.sourceRevision} 恢复` : ""}</span><span className="flex gap-2">{props.onReadVersion && <button type="button" className={buttonClass} disabled={!!pending} onClick={() => void readVersion(version.revision)}>查看版本 {version.revision}</button>}<button type="button" className={buttonClass} disabled={!writesEnabled || !draft || draft.dirty || stale || !!pending || checked.kind !== "ready" || draft.expectedRevision === version.revision} onClick={() => void restore(version.revision)}>恢复版本 {version.revision} 为新版本</button></span></li>)}</ul>
      {versions?.nextBeforeRevision != null && props.onLoadHistoryPage && <button type="button" className={`${buttonClass} mt-3`} disabled={!!pending} onClick={() => props.onLoadHistoryPage?.(versions.nextBeforeRevision!)}>读取更早版本</button>}
      {preview && <HistoricalPreview revision={preview.revision} config={preview.config} />}
    </section>
  </section>;
}

export default function AssistantConfigurationPanel(props: AssistantConfigurationPanelProps) {
  const metadata = currentData(props.metadata, props.scopeKey);
  const item = metadata?.agentKey === props.agentKey ? metadata : undefined;
  return <div className="space-y-4"><section aria-label="助手已保存配置状态" className={panelClass}>
    <h3 className="font-medium text-slate-100">助手专属配置</h3><ReadNotice state={props.metadata} noun="配置摘要" scopeKey={props.scopeKey} />
    <p className="mt-3 text-xs leading-6 text-slate-500">本页长期规则以专属配置的 rules 为唯一来源。本批未自动迁移或双写旧图像记忆。Skill 摘要仅标识 manifest 内容，不是完整运行快照。</p>
    {item?.status === "not-configured" && <p className="mt-3 text-sm text-amber-300">此助手尚未配置，没有已保存版本或已启用状态。</p>}
    {item?.status === "configured" && <><p className="mt-3 text-sm text-slate-200">{item.name} · 已保存版本 {item.revision} · 配置设为{item.enabled ? "启用" : "停用"}（尚未接入业务执行）</p><p className="mt-2 text-xs text-slate-400">{item.description || "未设置描述"}</p><dl className="mt-4 grid gap-3 text-xs text-slate-400 sm:grid-cols-2"><div><dt className="text-slate-500">专属模型</dt><dd className="mt-1 break-all">{item.modelSlug || "继承业务模型策略；独立对话未配置"}</dd></div><div><dt className="text-slate-500">保存的绑定与规则</dt><dd className="mt-1">{item.skillCount} 个 Skill 绑定 · {item.ruleCount} 条长期规则</dd></div><div><dt className="text-slate-500">更新时间</dt><dd className="mt-1">{item.updatedAt || "未返回"}</dd></div></dl></>}
    {!props.canEdit && <p className="mt-4 text-xs leading-6 text-slate-500">当前仅可查看配置摘要。完整指令、规则、版本历史与可选资源需要管理员且拥有 agent.update 权限。</p>}
    {!props.canEdit && props.onReload && <button type="button" className={`${buttonClass} mt-3`} onClick={props.onReload}>重新读取配置摘要</button>}
  </section>{props.canEdit && <ConfigurationEditor key={JSON.stringify([props.scopeKey, props.agentKey])} {...props} />}</div>;
}
