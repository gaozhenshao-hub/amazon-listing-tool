import { useState } from "react";
import { Bot, GitBranch, RefreshCw } from "lucide-react";
import type { AgentLibraryKey } from "@shared/agentLibraryContracts";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import AgentLibraryPanel from "./AgentLibraryPanel";
import { libraryReadState } from "./AgentLibraryPresentation";

/** Uses only existing workspace-scoped, agent.read-protected query procedures. */
export default function EmperorAgentLibrary() {
  const [selected, setSelected] = useState<AgentLibraryKey>("listing");
  const workflows = trpc.emperor.agents.list.useQuery();
  const skills = trpc.emperor.agents.getAvailableSkills.useQuery();
  const models = trpc.emperor.agents.getAvailableModels.useQuery();
  const refreshing = workflows.isFetching || skills.isFetching || models.isFetching;

  return <main className="min-h-full bg-[#080b12] text-slate-200">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-6 md:px-8">
      <div className="flex items-center gap-3"><div className="rounded-xl border border-violet-500/20 bg-violet-500/15 p-2"><Bot className="h-5 w-5 text-violet-400" /></div><div><h1 className="text-xl font-semibold text-white">Agent 库</h1><p className="mt-1 text-sm text-slate-500">七类助手目录 · 已有编排与资源只读视图</p></div></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm" className="border-white/10 bg-white/5 text-slate-300"><a href="/emperor/agents"><GitBranch className="h-4 w-4" />原 Agent 编排</a></Button><Button type="button" variant="outline" size="sm" disabled={refreshing}
        onClick={() => { void workflows.refetch(); void skills.refetch(); void models.refetch(); }}
        className="border-white/10 bg-white/5 text-slate-300"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />刷新只读数据</Button></div>
    </header>
    <div className="mx-auto max-w-[1600px] space-y-6 px-5 py-6 md:px-8">
      <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-6 text-amber-200/90">首批只读接入：角色目录与真实资源分开展示。Agent 专属模型、长期规则、配置版本尚未接入读取；目录不表示已配置或已启用。查看和刷新不会启动 AI。</p>
      <AgentLibraryPanel selected={selected} onSelect={setSelected}
        workflows={libraryReadState(workflows)} skills={libraryReadState(skills)} models={libraryReadState(models)} />
    </div>
  </main>;
}
