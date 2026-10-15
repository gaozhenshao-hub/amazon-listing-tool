import { AGENT_LIBRARY_ROLES, type AgentLibraryKey } from "@shared/agentLibraryContracts";
import { BookOpen, Bot, Eye, GitBranch, Info, Layers, Loader2 } from "lucide-react";
import {
  firstVisibleBySlug, libraryDirectory, libraryRoleForSkill, libraryRoleForWorkflow,
  libraryWorkflowNodes, workflowCanvasHref,
  type LibraryModel, type LibraryReadState, type LibrarySkill, type LibraryWorkflow,
} from "./AgentLibraryPresentation";

type Props = {
  selected: AgentLibraryKey; onSelect: (key: AgentLibraryKey) => void;
  workflows: LibraryReadState<LibraryWorkflow>; skills: LibraryReadState<LibrarySkill>;
  models: LibraryReadState<LibraryModel>;
};

const panelClass = "rounded-xl border border-white/10 bg-white/[0.025] p-5";
const linkClass = "text-xs text-violet-300 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-violet-400";

function ReadNotice({ state, noun }: { state: LibraryReadState<unknown>; noun: string }) {
  if (state.status === "error") return <p role="alert" className="text-sm text-red-300">{noun}读取失败：{state.message}。未将失败视为空记录；请刷新重试。</p>;
  if (state.status === "loading") return <p role="status" className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />正在读取{noun}…</p>;
  return null;
}

export default function AgentLibraryPanel({ selected, onSelect, workflows, skills, models }: Props) {
  const role = libraryDirectory(selected);
  const visibleWorkflows = workflows.status === "ready" ? workflows.rows : [];
  const roleWorkflows = visibleWorkflows.filter(item => libraryRoleForWorkflow(item.slug) === selected);
  const relatedSkills = skills.status === "ready"
    ? firstVisibleBySlug(skills.rows).filter(item => libraryRoleForSkill(item.slug) === selected) : [];
  const visibleModels = models.status === "ready" ? firstVisibleBySlug(models.rows) : [];
  const otherWorkflows = visibleWorkflows.filter(item => libraryRoleForWorkflow(item.slug) === null);

  return <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ["角色目录", String(AGENT_LIBRARY_ROLES.length), "目录定义，不代表已启用"],
        ["可见编排记录", workflows.status === "ready" ? String(visibleWorkflows.length) : "—", "来自当前权限范围"],
        ["已发布 Skill", skills.status === "ready" ? String(firstVisibleBySlug(skills.rows).length) : "—", "同 slug 优先工作区记录"],
        ["启用模型目录", models.status === "ready" ? String(visibleModels.length) : "—", "不是助手已绑定模型"],
      ].map(([label, count, note]) => <div key={label} className={panelClass}>
        <p className="text-xs text-slate-400">{label}</p><p className="my-2 text-2xl font-semibold text-white">{count}</p><p className="text-xs text-slate-500">{note}</p>
      </div>)}
    </div>

    <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Agent 角色目录" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {AGENT_LIBRARY_ROLES.map(item => <button key={item.key} type="button" aria-pressed={selected === item.key}
          onClick={() => onSelect(item.key)}
          className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-violet-400 ${selected === item.key ? "border-violet-500/50 bg-violet-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/5"}`}>
          <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-100">{item.name}</span><Bot className="h-4 w-4 shrink-0 text-violet-400" /></span>
          <span className="mt-1 block text-xs leading-5 text-slate-400">{item.stages.join(" · ")}</span>
          <span className="mt-2 block text-[11px] text-amber-300/90">仅角色目录 · 专属配置待读取</span>
        </button>)}
      </nav>

      <div className="min-w-0 space-y-5">
        <section className={panelClass} aria-label="角色与配置状态">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-violet-300">角色目录 / {role.key}</p><h2 className="mt-1 text-lg font-semibold text-white">{role.name}</h2><p className="mt-2 text-sm text-slate-400">职责目录：{role.stages.join("、")}</p></div>
            {role.requiresVision && <span className="flex items-center gap-1 rounded-md border border-cyan-500/20 px-2 py-1 text-xs text-cyan-300"><Eye className="h-3.5 w-3.5" />角色需要视觉能力</span>}</div>
          <dl className="mt-5 grid gap-3 rounded-lg bg-black/15 p-4 text-sm sm:grid-cols-2">
            {[["专属配置", "尚未接入读取"], ["专属模型", "未知，未设置默认值"], ["长期规则 / 指令", "尚未接入读取"], ["配置版本 / 启用状态", "未知，不显示为已启用"]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-slate-300">{value}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs leading-6 text-slate-500">当前后端没有 Agent 库专属配置读取接口。下方是已有编排与资源的真实只读记录；不会据此推断已绑定、已授权或会自动执行。视觉需求来自角色定义，模型能力尚不能由本接口验证。</p>
        </section>

        <section className={panelClass} aria-label="已有编排配置">
          <h3 className="flex items-center gap-2 font-medium text-slate-100"><GitBranch className="h-4 w-4 text-violet-400" />已有编排配置</h3>
          <p className="mb-4 mt-2 text-xs leading-6 text-slate-500">按 slug 规则归类，不是保存的助手绑定。节点显示原 DAG 的静态配置和依赖，不代表执行顺序或运行状态。</p>
          <ReadNotice state={workflows} noun="编排" />
          {workflows.status === "ready" && roleWorkflows.length === 0 && <p className="text-sm text-slate-400">当前权限范围内，没有归入此角色的编排记录。不会自动创建模板。</p>}
          <div className="space-y-4">{roleWorkflows.map(workflow => <article key={workflow.id} className="rounded-lg border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-medium text-slate-100">{workflow.name}</h4><p className="mt-1 break-all text-xs text-slate-500">{workflow.slug}</p></div><a className={linkClass} href={workflowCanvasHref(workflow.slug)}>打开原编排画布</a></div>
            {workflow.description && <p className="mt-2 text-xs leading-6 text-slate-400">{workflow.description}</p>}
            <p className="mt-2 text-xs text-slate-400">保存状态：{workflow.status} · 触发配置：{workflow.triggerType}</p>
            <ul className="mt-3 space-y-2">{libraryWorkflowNodes(workflow.dagDefinition).map(node => <li key={node.id} className="rounded-md bg-white/[0.025] px-3 py-2 text-xs leading-6 text-slate-400">
              <p className="font-medium text-slate-200">{node.label} <span className="font-normal text-slate-500">({node.id})</span>{node.humanGate && <span className="ml-2 text-amber-300">配置了人工确认</span>}</p>
              <p>前置节点：{node.parentIds.join("、") || "未配置"}</p>
              {node.skillSlug && <p className="break-all">Skill：{node.skillSlug}{node.skillVersionRef ? ` · 版本引用：${node.skillVersionRef}` : " · 未返回显式版本引用"}</p>}
              {node.modelSlug && <p className="break-all">节点显式模型：{node.modelSlug}（不是助手级绑定）</p>}
            </li>)}</ul>
            {libraryWorkflowNodes(workflow.dagDefinition).length === 0 && <p className="mt-3 text-xs text-slate-500">没有可展示的 DAG 节点。</p>}
          </article>)}</div>
        </section>

        <section className={panelClass} aria-label="相关 Skill 目录">
          <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-medium text-slate-100"><BookOpen className="h-4 w-4 text-violet-400" />相关 Skill 目录</h3><a className={linkClass} href="/emperor/skills">打开原 Skill 库</a></div>
          <p className="mb-4 mt-2 text-xs leading-6 text-slate-500">仅展示当前权限范围内已发布 Skill，按 slug 目录归类；不是已启用绑定。具体版本、模型覆盖与运行仍在原 Skill 页面管理。</p>
          <ReadNotice state={skills} noun="Skill" />
          {skills.status === "ready" && relatedSkills.length === 0 && <p className="text-sm text-slate-400">未读取到可归入此角色的已发布 Skill。</p>}
          <ul className="space-y-2">{relatedSkills.map(skill => <li key={skill.slug} className="rounded-lg border border-white/10 p-3"><p className="text-sm text-slate-200">{skill.name}</p><p className="mt-1 break-all font-mono text-xs text-slate-500">{skill.slug}</p>{skill.description && <p className="mt-2 text-xs leading-6 text-slate-400">{skill.description}</p>}</li>)}</ul>
        </section>

        <section className={panelClass} aria-label="可用模型目录">
          <h3 className="flex items-center gap-2 font-medium text-slate-100"><Layers className="h-4 w-4 text-violet-400" />可用模型目录</h3>
          <p className="mb-4 mt-2 text-xs leading-6 text-slate-500">来自已有启用模型注册表，并非本助手的模型配置。此接口不返回能力标签，因此不推测视觉能力，也不发起模型连通性测试。</p>
          <ReadNotice state={models} noun="模型" />
          {models.status === "ready" && visibleModels.length === 0 && <p className="text-sm text-slate-400">当前权限范围内没有可见的启用模型记录。</p>}
          <ul className="grid gap-2 xl:grid-cols-2">{visibleModels.map(model => <li key={model.slug} className="min-w-0 rounded-lg border border-white/10 p-3"><p className="text-sm text-slate-200">{model.name}</p><p className="mt-1 break-all text-xs text-slate-400">{model.provider} · {model.modelId}</p><p className="mt-1 break-all font-mono text-xs text-slate-500">{model.slug}</p>{model.isDefault && <p className="mt-2 text-xs text-amber-300">注册表默认标记（非助手绑定）</p>}</li>)}</ul>
        </section>
      </div>
    </div>

    {workflows.status === "ready" && otherWorkflows.length > 0 && <section className={panelClass} aria-label="其他已有编排"><h3 className="text-sm font-medium text-slate-200">其他已有编排 / 业务管理流程</h3><p className="mb-3 mt-2 text-xs text-slate-500">未按目录归类的记录仍保留，不自动改绑或复制。</p><div className="flex flex-wrap gap-3">{otherWorkflows.map(item => <a key={item.id} className={linkClass} href={workflowCanvasHref(item.slug)}>{item.name}</a>)}</div></section>}
    <p className="flex items-start gap-2 text-xs leading-6 text-slate-500"><Info className="mt-1 h-4 w-4 shrink-0" />本页仅查询与展示，不提供聊天、保存配置、Skill 执行或自动任务。原编排画布、CRUD 和业务执行入口保持不变，继续使用原有权限。</p>
  </div>;
}
