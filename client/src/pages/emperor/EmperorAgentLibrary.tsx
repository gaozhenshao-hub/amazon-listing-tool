import { useEffect, useRef, useState } from "react";
import { Bot, GitBranch, RefreshCw } from "lucide-react";
import type { AgentLibraryKey } from "@shared/agentLibraryContracts";
import { SECURITY_RESOURCE_MODULES } from "@shared/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import AgentLibraryPanel from "./AgentLibraryPanel";
import AssistantConfigurationBridge from "./AssistantConfigurationBridge";
import type { LibraryModel, LibraryReadState, LibrarySkill, LibraryWorkflow } from "./AgentLibraryPresentation";

/** Mounted only for one authenticated scope; no business rows enter shared caches. */
function OwnedLibrary({ scopeKey, workspaceId, canEdit }: { scopeKey: string; workspaceId: number; canEdit: boolean }) {
  const client = trpc.useUtils().client;
  const [selected, setSelected] = useState<AgentLibraryKey>("listing");
  const [workflows, setWorkflows] = useState<LibraryReadState<LibraryWorkflow>>({ status: "loading" });
  const [skills, setSkills] = useState<LibraryReadState<LibrarySkill>>({ status: "loading" });
  const [models, setModels] = useState<LibraryReadState<LibraryModel>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(true), [generation, setGeneration] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), ticket = ++sequence.current;
    let active = true;
    const current = () => active && !controller.signal.aborted && ticket === sequence.current;
    setWorkflows({ status: "loading" }); setSkills({ status: "loading" }); setModels({ status: "loading" }); setRefreshing(true);
    async function load<T>(read: () => Promise<T[]>, accept: (state: LibraryReadState<T>) => void) {
      try {
        const rows = await read();
        if (!Array.isArray(rows)) throw new Error("Unexpected library result");
        if (current()) accept({ status: "ready", rows });
      } catch {
        if (current()) accept({ status: "error", message: "请求失败，请确认当前权限与连接后重试" });
      }
    }
    void Promise.all([
      load(() => client.emperor.agents.list.query(undefined, { signal: controller.signal }), setWorkflows),
      load(() => client.emperor.agents.getAvailableSkills.query(undefined, { signal: controller.signal }), setSkills),
      load(() => client.emperor.agents.getAvailableModels.query(undefined, { signal: controller.signal }), setModels),
    ]).then(() => { if (current()) setRefreshing(false); });
    return () => { active = false; controller.abort(); };
  }, [client, generation]);
  function reload() {
    // Invalidate pending callbacks immediately, before React runs effect cleanup.
    sequence.current++;
    setWorkflows({ status: "loading" }); setSkills({ status: "loading" }); setModels({ status: "loading" }); setRefreshing(true);
    setGeneration(value => value + 1);
  }

  return <main className="min-h-full bg-[#080b12] text-slate-200">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-6 md:px-8">
      <div className="flex items-center gap-3"><div className="rounded-xl border border-violet-500/20 bg-violet-500/15 p-2"><Bot className="h-5 w-5 text-violet-400" /></div><div><h1 className="text-xl font-semibold text-white">Agent 库</h1><p className="mt-1 text-sm text-slate-500">七类助手 · 真实专属配置与版本 · 已有编排与资源目录</p></div></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm" className="border-white/10 bg-white/5 text-slate-300"><a href="/emperor/agents"><GitBranch className="h-4 w-4" />原 Agent 编排</a></Button><Button type="button" variant="outline" size="sm" aria-busy={refreshing}
        onClick={reload}
        className="border-white/10 bg-white/5 text-slate-300"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />刷新资源目录</Button></div>
    </header>
    <div className="mx-auto max-w-[1600px] space-y-6 px-5 py-6 md:px-8">
      <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-6 text-amber-200/90">专属配置按当前工作区读取，未保存和读取失败会分别显示；保存与恢复版本受管理员权限及服务器写入开关控制。资源目录不是助手绑定，查看、刷新和保存配置都不会启动 AI 或业务任务。</p>
      <AgentLibraryPanel selected={selected} onSelect={setSelected}
        workflows={workflows} skills={skills} models={models}
        configurationSlot={<AssistantConfigurationBridge key={JSON.stringify([scopeKey, selected, canEdit])}
          agentKey={selected} scopeKey={scopeKey} workspaceId={workspaceId} canEdit={canEdit} />} />
    </div>
  </main>;
}

export default function EmperorAgentLibrary() {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading) return <p role="status" className="p-8">正在确认登录状态…</p>;
  if (auth.error) return <p role="alert" className="p-8">登录状态读取失败，未读取 Agent 数据。</p>;
  const user = auth.user;
  if (!user) return <p role="alert" className="p-8">请先登录后查看 Agent 库。</p>;
  const workspaceId = user.defaultWorkspaceId;
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof workspaceId !== "number" || !Number.isSafeInteger(workspaceId) || workspaceId <= 0 || workspaceId > 2_147_483_647 || typeof user.role !== "string" || !user.role) {
    return <p role="alert" className="p-8">当前用户 / 工作区信息不完整，未读取 Agent 数据。</p>;
  }
  if (permissions.isLoading) return <p role="status" className="p-8">正在确认 Agent 读取权限…</p>;
  const { moduleId, subModuleId } = SECURITY_RESOURCE_MODULES.agent;
  if (!permissions.canRead(moduleId, subModuleId)) return <p role="alert" className="p-8">没有读取 Agent 库的权限。</p>;
  // Matches the real adminProcedure roles; resource edit permission alone is insufficient.
  const canEdit = ["super_admin", "admin"].includes(user.role) && permissions.canEdit(moduleId, subModuleId);
  const scopeKey = JSON.stringify([user.id, workspaceId, user.role, canEdit]);
  return <OwnedLibrary key={scopeKey} scopeKey={scopeKey} workspaceId={workspaceId} canEdit={canEdit} />;
}
