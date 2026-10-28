import { useState, type ReactNode } from "react";
import {
  AGENT_LIBRARY_ROLES,
  type AgentLibraryKey,
} from "@shared/agentLibraryContracts";
import {
  BookOpen,
  Bot,
  ChevronRight,
  MessageSquare,
  Settings2,
} from "lucide-react";
import {
  firstVisibleBySlug,
  libraryDirectory,
  libraryRoleForSkill,
  libraryRoleForWorkflow,
  workflowCanvasHref,
  type LibraryModel,
  type LibraryReadState,
  type LibrarySkill,
  type LibraryWorkflow,
} from "./AgentLibraryPresentation";

export type AgentWorkbenchTab =
  | "conversation"
  | "configuration"
  | "memory"
  | "versions";
type Props = {
  selected: AgentLibraryKey;
  onSelect: (key: AgentLibraryKey) => void;
  workflows: LibraryReadState<LibraryWorkflow>;
  skills: LibraryReadState<LibrarySkill>;
  models: LibraryReadState<LibraryModel>;
  configurationSlot?: ReactNode;
  conversationSlot?: ReactNode;
  tab?: AgentWorkbenchTab;
  onTab?: (tab: AgentWorkbenchTab) => void;
};
const tabs: Array<[AgentWorkbenchTab, string]> = [
  ["conversation", "对话与测试"],
  ["configuration", "职责与技能"],
  ["memory", "资料与记忆"],
  ["versions", "版本记录"],
];

export default function AgentLibraryPanel({
  selected,
  onSelect,
  workflows,
  skills,
  configurationSlot,
  conversationSlot,
  tab: controlledTab,
  onTab,
}: Props) {
  const [localTab, setLocalTab] = useState<AgentWorkbenchTab>("conversation");
  const tab = controlledTab ?? localTab;
  const changeTab = (next: AgentWorkbenchTab) => {
    setLocalTab(next);
    onTab?.(next);
  };
  const role = libraryDirectory(selected);
  const related =
    skills.status === "ready"
      ? firstVisibleBySlug(skills.rows).filter(
          skill => libraryRoleForSkill(skill.slug) === selected
        )
      : [];
  const flows =
    workflows.status === "ready"
      ? workflows.rows.filter(
          item => libraryRoleForWorkflow(item.slug) === selected
        )
      : [];
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <nav
        aria-label="Agent 角色目录"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"
      >
        {AGENT_LIBRARY_ROLES.map(item => (
          <button
            type="button"
            key={item.key}
            aria-pressed={selected === item.key}
            onClick={() => onSelect(item.key)}
            className={`rounded-2xl border p-5 text-left transition-colors ${selected === item.key ? "border-violet-400/60 bg-violet-400/10" : "border-white/10 bg-white/[.025] hover:bg-white/5"}`}
          >
            <span className="flex items-center justify-between gap-2 text-sm font-semibold text-white">
              <Bot className="h-5 w-5 text-violet-300" />
              {item.name}
              <ChevronRight className="ml-auto h-4 w-4" />
            </span>
            <span className="mt-3 block text-xs leading-6 text-slate-400">
              {item.stages.join(" · ")}
            </span>
            <span className="mt-3 flex items-center gap-1 text-xs text-violet-300">
              <MessageSquare className="h-3 w-3" />
              打开工作台
            </span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 space-y-5">
        <header className="rounded-2xl border border-white/10 bg-white/[.025] p-6">
          <p className="text-xs text-violet-300">我的业务助手</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            {role.name}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {role.stages.join("、")}
          </p>
          <div
            role="tablist"
            aria-label="助手工作台"
            className="mt-6 flex flex-wrap gap-2"
          >
            {tabs.map(([key, label]) => (
              <button
                role="tab"
                aria-selected={tab === key}
                aria-controls={`agent-panel-${key}`}
                id={`agent-tab-${key}`}
                key={key}
                type="button"
                onClick={() => changeTab(key)}
                className={`rounded-lg px-4 py-2.5 text-sm ${tab === key ? "bg-violet-500 text-white" : "text-slate-400 hover:bg-white/5"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        <div
          role="tabpanel"
          id="agent-panel-conversation"
          aria-labelledby="agent-tab-conversation"
          hidden={tab !== "conversation"}
        >
          {conversationSlot ?? (
            <p className="p-5 text-sm text-slate-400">
              对话服务尚未配置，请先设置模型与技能。
            </p>
          )}
        </div>
        <div
          hidden={tab === "conversation"}
          role="tabpanel"
          id={`agent-panel-${tab === "conversation" ? "configuration" : tab}`}
          aria-labelledby={`agent-tab-${tab}`}
        >
          {configurationSlot ?? (
            <p className="p-5 text-sm text-slate-400">正在读取助手配置…</p>
          )}
        </div>
        {tab === "configuration" && (
          <section className="rounded-2xl border border-white/10 p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <BookOpen className="h-4 w-4" />
              可选技能
            </h3>
            <p className="my-3 text-xs text-slate-400">
              打开技能可单独试用和优化；保存到上方的职责配置后才成为本助手的绑定。
            </p>
            {skills.status === "error" && (
              <p role="alert" className="text-red-300">
                技能读取失败，请刷新重试。
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {related.map(skill => (
                <a
                  key={skill.slug}
                  href={`/emperor/skills?workbench=${encodeURIComponent(skill.slug)}`}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs text-violet-300 hover:bg-white/5"
                >
                  {skill.name}
                </a>
              ))}
            </div>
            <details className="mt-5 text-xs text-slate-400">
              <summary className="flex cursor-pointer items-center gap-2">
                <Settings2 className="h-4 w-4" />
                高级：业务编排
              </summary>
              <div className="mt-3 flex flex-wrap gap-3">
                {flows.map(flow => (
                  <a
                    key={flow.id}
                    href={workflowCanvasHref(flow.slug)}
                    className="text-violet-300 underline"
                  >
                    {flow.name}
                  </a>
                ))}
                {flows.length === 0 && <p>此助手暂无独立业务编排。</p>}
              </div>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
