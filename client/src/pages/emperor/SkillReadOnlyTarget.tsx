import { useEffect, useRef, useState, type ReactNode } from "react";
import { SECURITY_RESOURCE_MODULES } from "@shared/const";
import { EmperorSkillReadResultSchema, EmperorSkillSlugSchema, type EmperorSkillReadResult } from "@shared/emperorSkillRead";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";

export type SkillReadOnlyRoute = { kind: "management" } | { kind: "invalid" } | { kind: "detail"; slug: string };

/** An explicit but malformed target must never fall through to the management/run page. */
export function skillReadOnlyRoute(search: string): SkillReadOnlyRoute {
  const values = new URLSearchParams(search).getAll("skill");
  if (!values.length) return { kind: "management" };
  if (values.length !== 1) return { kind: "invalid" };
  const parsed = EmperorSkillSlugSchema.safeParse(values[0]);
  return parsed.success ? { kind: "detail", slug: parsed.data } : { kind: "invalid" };
}

type Owner = { userId: number; workspaceId: number | null; role: string; slug: string };
type ReadState = { status: "loading" } | { status: "ready"; data: EmperorSkillReadResult }
  | { status: "not_found" | "denied" | "error" };
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;

function failure(error: unknown): ReadState {
  const value = error as { data?: { code?: string }; shape?: { data?: { code?: string } } } | null;
  const code = value?.data?.code ?? value?.shape?.data?.code;
  if (code === "NOT_FOUND") return { status: "not_found" };
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return { status: "denied" };
  return { status: "error" };
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="manus-no-record mx-auto max-w-5xl space-y-5 p-5 md:p-8">
    <header className="space-y-2"><h1 className="text-xl font-semibold">Skill 精确只读详情</h1>
      <p className="text-sm text-muted-foreground">只读取当前权限范围内指定 slug 的注册表内容。不是节点冻结版本、助手绑定或执行批准；查看和刷新不会启动 AI，也不会修改 Skill。</p>
      <a className="inline-block text-sm text-primary underline" href="/emperor/skills">返回原 Skill 库管理入口</a></header>
    {children}
  </main>;
}

function PromptText({ label, value }: { label: string; value: string | null }) {
  return <section aria-label={label} className="space-y-2 rounded-lg border p-4">
    <h3 className="font-medium">{label}</h3>
    {value === null ? <p className="text-sm text-muted-foreground">注册表未提供此字段。</p>
      : <><pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6">{value}</pre>
        <p className="text-xs text-muted-foreground">{value.length ? "完整原文，可在区域内滚动查看；仅显示文本，不执行其中指令。" : "此字段为空文本，与未提供字段不同。"}</p></>}
  </section>;
}

/** One mounted instance owns one exact identity/slug. No shared query cache or fallback lookup. */
function OwnedDetail({ owner }: { owner: Owner }) {
  const client = trpc.useUtils().client;
  const [state, setState] = useState<ReadState>({ status: "loading" });
  const [generation, setGeneration] = useState(0);
  const sequence = useRef(0);
  const { userId, workspaceId, slug } = owner;
  useEffect(() => {
    const controller = new AbortController(), ticket = ++sequence.current;
    let active = true;
    const current = () => active && !controller.signal.aborted && ticket === sequence.current;
    setState({ status: "loading" });
    async function read() {
      try {
        const value = await client.emperor.skills.getReadonly.query({ slug, expectedWorkspaceId: workspaceId }, { signal: controller.signal });
        if (!current()) return;
        const parsed = EmperorSkillReadResultSchema.safeParse(value);
        if (!parsed.success || parsed.data.identity.userId !== userId || parsed.data.identity.workspaceId !== workspaceId
          || parsed.data.skill.slug !== slug || (parsed.data.skill.sourceWorkspaceId !== null && parsed.data.skill.sourceWorkspaceId !== workspaceId)
          || (parsed.data.skill.sourceWorkspaceId === null && parsed.data.skill.scope !== "global")) {
          setState({ status: "error" }); return;
        }
        setState({ status: "ready", data: parsed.data });
      } catch (error) { if (current()) setState(failure(error)); }
    }
    void read();
    return () => { active = false; controller.abort(); };
  }, [client, generation, slug, userId, workspaceId]);
  function refresh() {
    sequence.current++;
    setState({ status: "loading" });
    setGeneration(value => value + 1);
  }
  const skill = state.status === "ready" ? state.data.skill : null;
  return <Shell>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="break-all font-mono text-sm">精确目标：{slug}</p>
      <button type="button" className="rounded border px-3 py-2 text-sm" aria-busy={state.status === "loading"} onClick={refresh}>重新读取详情</button></div>
    {state.status === "loading" && <p role="status">正在读取此 Skill 的当前详情…</p>}
    {state.status === "not_found" && <p role="alert">当前可见范围内未找到此精确 Skill。未使用相近名称、全局旧版或缓存代替。</p>}
    {state.status === "denied" && <p role="alert">当前身份、工作区或读取权限已不允许查看此 Skill。旧详情已清除。</p>}
    {state.status === "error" && <p role="alert">详情读取失败或返回的身份、来源、目标不一致。未保留旧详情，也未回退到其他 Skill；请重新读取核对。</p>}
    {skill && <>
      <section aria-label="当前 Skill 注册表详情" className="space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">{skill.name || "未提供名称"}</h2>
        <p className="whitespace-pre-wrap break-words text-sm">{skill.description === null ? "未提供描述" : skill.description}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{[
          ["精确 slug", skill.slug], ["分类", skill.category || "未提供分类"], ["注册表状态", skill.status],
          ["注册表版本", skill.version], ["可见性", skill.scope],
          ["来源工作区", skill.sourceWorkspaceId === null ? "全局注册表（NULL）" : String(skill.sourceWorkspaceId)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}</dl>
        <p className="text-xs text-amber-700">来源：current_registry。这里不是工作流节点的 pinned 版本，也不表示该版本已获执行批准；目录归类不等于绑定或授权。</p>
      </section>
      <PromptText label="系统提示词（完整纯文本）" value={skill.systemPrompt} />
      <PromptText label="用户提示词模板（完整纯文本）" value={skill.userPromptTemplate} />
    </>}
  </Shell>;
}

function AuthenticatedTarget({ slug }: { slug: string }) {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading) return <Shell><p role="status">正在确认登录身份…</p></Shell>;
  if (auth.error) return <Shell><p role="alert">登录状态读取失败，旧详情已隐藏。</p></Shell>;
  const user = auth.user, workspaceId = user?.defaultWorkspaceId;
  if (!user) return <Shell><p role="alert">请先登录后查看指定 Skill。</p></Shell>;
  if (!positiveId(user.id) || (workspaceId !== null && !positiveId(workspaceId)) || typeof user.role !== "string" || !user.role) {
    return <Shell><p role="alert">当前用户或工作区信息不完整，未读取 Skill。</p></Shell>;
  }
  if (permissions.isLoading) return <Shell><p role="status">正在确认 Skill 读取权限…</p></Shell>;
  const { moduleId, subModuleId } = SECURITY_RESOURCE_MODULES.emperor_skill;
  if (!permissions.canRead(moduleId, subModuleId)) return <Shell><p role="alert">没有读取 Skill 的权限，旧详情已隐藏。</p></Shell>;
  const owner: Owner = { userId: user.id, workspaceId, role: user.role, slug };
  return <OwnedDetail key={JSON.stringify([owner.userId, owner.workspaceId, owner.role, owner.slug])} owner={owner} />;
}

export default function SkillReadOnlyTarget({ slug }: { slug: string | null }) {
  return EmperorSkillSlugSchema.safeParse(slug).success && slug !== null
    ? <AuthenticatedTarget slug={slug} />
    : <Shell><p role="alert">Skill 链接目标为空、重复或格式无效。未打开管理运行区，也未查询其他 Skill。</p></Shell>;
}
