import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Loader2,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SkillWorkbenchDraft } from "@shared/skillWorkbench";

type Catalog = {
  slug: string;
  name: string;
  description: string;
  category: string;
  status: string;
  version: number;
};
type Detail = Awaited<
  ReturnType<
    ReturnType<
      typeof trpc.useUtils
    >["client"]["emperor"]["skillWorkbench"]["detail"]["query"]
  >
>;
type Product = { id: number; asin: string; title: string; projectName: string };
const statusLabels: Record<string, string> = {
  Draft: "草稿",
  Validated: "已测试",
  Approved: "待发布",
  Released: "已发布",
  Deprecated: "已停用",
};
const selectClass = "h-10 rounded-lg border bg-background px-3 text-sm";
const panelClass = "rounded-2xl border bg-card p-5 shadow-sm";
const tabs = ["试用与调教", "技能内容", "测试案例", "版本记录"];

export default function SkillWorkbench() {
  const { user, loading } = useAuth();
  const route = useSearch();
  if (loading) return <p className="p-8">正在读取技能库…</p>;
  if (!user?.defaultWorkspaceId)
    return (
      <p role="alert" className="p-8">
        请登录并选择工作区后使用技能库。
      </p>
    );
  return (
    <OwnedWorkbench
      key={`${user.id}:${user.defaultWorkspaceId}:${user.role}:${route}`}
      workspaceId={user.defaultWorkspaceId}
      admin={["admin", "super_admin"].includes(user.role)}
    />
  );
}

function OwnedWorkbench({
  workspaceId,
  admin,
}: {
  workspaceId: number;
  admin: boolean;
}) {
  const api = trpc.useUtils().client.emperor.skillWorkbench;
  const [, navigate] = useLocation();
  const slug = new URLSearchParams(useSearch()).get("workbench") ?? "";
  const scope = useMemo(
    () => ({ expectedWorkspaceId: workspaceId }),
    [workspaceId]
  );
  const [catalog, setCatalog] = useState<Catalog[]>([]),
    [detail, setDetail] = useState<Detail | null>(null);
  const [products, setProducts] = useState<Product[]>([]),
    [draft, setDraft] = useState<SkillWorkbenchDraft | null>(null);
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("全部分类"),
    [status, setStatus] = useState("全部状态");
  const [tab, setTab] = useState(0),
    [page, setPage] = useState(1),
    [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false),
    [newName, setNewName] = useState(""),
    [newPurpose, setNewPurpose] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const owner = useRef(0),
    pending = useRef(false),
    savedDraft = useRef("");
  const dirty =
    !!draft &&
    JSON.stringify({ content: draft.content, input: draft.input }) !==
      savedDraft.current;
  useEffect(() => {
    const token = ++owner.current,
      controller = new AbortController();
    setLoading(true);
    setDetail(null);
    setDraft(null);
    setError("");
    setTab(0);
    setFeedback("");
    void (async () => {
      try {
        if (slug) {
          const result = await api.detail.query(
            { ...scope, slug },
            { signal: controller.signal }
          );
          if (owner.current !== token) return;
          setDetail(result);
          const active = result.drafts.find(
            item => item.status !== "published"
          );
          if (active) accept(active);
          // Product reads are independent; their failure must not erase a usable saved draft.
          try {
            const found = await api.products.query(scope, {
              signal: controller.signal,
            });
            if (owner.current === token) setProducts(found);
          } catch {
            if (owner.current === token)
              setError("产品资料目录暂时不可用，可以先粘贴资料测试。");
          }
        } else {
          const result = await api.catalog.query(scope, {
            signal: controller.signal,
          });
          if (owner.current === token) setCatalog(result);
        }
      } catch (e) {
        if (owner.current === token)
          setError(e instanceof Error ? e.message : "读取失败，请重试");
      } finally {
        if (owner.current === token) setLoading(false);
      }
    })();
    return () => {
      owner.current = token + 1;
      controller.abort();
      pending.current = false;
    };
  }, [api, slug, scope]);
  useEffect(() => {
    setPage(1);
  }, [search, category, status]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function accept(next: SkillWorkbenchDraft) {
    setDraft(next);
    savedDraft.current = JSON.stringify({
      content: next.content,
      input: next.input,
    });
  }
  async function action(work: () => Promise<void>) {
    if (pending.current) return;
    const token = owner.current;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (owner.current === token)
        setError(e instanceof Error ? e.message : "操作失败，草稿已保留");
    } finally {
      if (owner.current === token) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function save() {
    if (!draft) throw new Error("请先新建调教草稿");
    if (!dirty) return draft;
    const next = await api.save.mutate({
      ...scope,
      id: draft.id,
      revision: draft.revision,
      content: draft.content,
      input: draft.input,
    });
    accept(next);
    return next;
  }
  const run = (baseline: boolean, instruction?: string) =>
    action(async () => {
      const current = await save();
      const next = await api.run.mutate({
        ...scope,
        id: current.id,
        revision: current.revision,
        baseline,
        feedback: instruction,
      });
      accept(next);
      if (instruction && next.status !== "failed") setFeedback("");
    });
  const open = (value: string) =>
    navigate(`/emperor/skills?workbench=${encodeURIComponent(value)}`);
  const filtered = catalog.filter(
    item =>
      (category === "全部分类" || item.category === category) &&
      (status === "全部状态" || item.status === status) &&
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const latest = draft?.tests.filter(item => !item.baseline).at(-1),
    baseline = draft?.tests.filter(item => item.baseline).at(-1);
  const locked =
    busy || draft?.status === "running" || draft?.status === "published";
  return (
    <main className="mx-auto max-w-[1680px] space-y-6 p-5 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">
              {slug ? (detail?.skill.name ?? "技能工作台") : "Skill 库"}
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {slug
              ? "用真实资料试效果，通过对话改进方法。测试确认后再发布。"
              : "把好方法保存成技能，让每次业务执行都能复用。"}
          </p>
        </div>
        {slug ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm("有未保存的修改，仍要返回技能库吗？")
              )
                navigate("/emperor/skills");
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            返回技能库
          </Button>
        ) : (
          admin && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              新建技能
            </Button>
          )
        )}
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {error}
          <Button variant="link" onClick={() => window.location.reload()}>
            重新读取
          </Button>
        </div>
      )}
      {loading ? (
        <p
          role="status"
          className="flex items-center gap-2 py-12 text-muted-foreground"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          正在读取…
        </p>
      ) : !slug ? (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-60 flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="搜索技能"
                className="pl-9"
                placeholder="搜索技能名称、用途…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="技能分类"
              className={selectClass}
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {["全部分类", ...new Set(catalog.map(item => item.category))].map(
                item => (
                  <option key={item}>{item}</option>
                )
              )}
            </select>
            <select
              aria-label="技能状态"
              className={selectClass}
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              <option>全部状态</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted-foreground">
            共 {filtered.length} 个技能
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.slice((page - 1) * 18, page * 18).map(item => (
              <article
                key={item.slug}
                className={`${panelClass} flex flex-col`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md bg-muted px-2 py-1 text-xs">
                    {item.category}
                  </span>
                  <span
                    className={`text-xs ${item.status === "Released" ? "text-emerald-600" : "text-muted-foreground"}`}
                  >
                    {statusLabels[item.status] ?? "待核对"} · v{item.version}
                  </span>
                </div>
                <h2 className="mt-5 text-base font-semibold">{item.name}</h2>
                <p className="mb-6 mt-2 line-clamp-3 min-h-16 text-sm leading-6 text-muted-foreground">
                  {item.description || "打开技能查看执行方法与输入要求"}
                </p>
                <Button
                  variant="outline"
                  className="mt-auto w-full"
                  onClick={() => open(item.slug)}
                >
                  打开技能
                </Button>
              </article>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="p-10 text-center text-muted-foreground">
              没有匹配的技能。
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className="py-2 text-sm">
              {page} / {Math.max(1, Math.ceil(filtered.length / 18))}
            </span>
            <Button
              variant="outline"
              disabled={page * 18 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      ) : (
        detail && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 px-4 py-3">
              <p className="text-sm">
                正式版本 v{detail.skill.version} ·{" "}
                {statusLabels[detail.skill.status]}
                {draft && (
                  <span className="ml-3 text-primary">
                    {draft.status === "published"
                      ? "该草稿已发布"
                      : "独立调教草稿"}
                    {dirty ? " · 尚未保存" : ""}
                  </span>
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || dirty}
                onClick={() =>
                  action(async () =>
                    accept(await api.create.mutate({ ...scope, slug }))
                  )
                }
              >
                新建调教草稿
              </Button>
            </div>
            <div
              role="tablist"
              aria-label="技能工作台"
              className="flex flex-wrap gap-2 border-b pb-3"
            >
              {tabs.map((label, i) => (
                <button
                  key={label}
                  role="tab"
                  aria-selected={tab === i}
                  onClick={() => setTab(i)}
                  className={`rounded-lg px-4 py-2 text-sm ${tab === i ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {!draft && tab !== 3 && (
              <div className={`${panelClass} text-center`}>
                <Sparkles className="mx-auto mb-4 h-8 w-8 text-primary" />
                <p className="text-sm">
                  点击“新建调教草稿”，即可选择产品开始测试。
                </p>
              </div>
            )}
            {draft?.error && (
              <p role="alert" className="text-sm text-amber-700">
                {draft.error}
              </p>
            )}
            {draft?.status === "running" && (
              <p role="status" className="text-sm text-amber-700">
                请求处理中。可以刷新查看结果；请勿重复启动。若长时间没有完成，请到运行记录核查。
              </p>
            )}
            {draft && tab === 0 && (
              <div className="grid items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
                <section className={`${panelClass} space-y-4`}>
                  <h2 className="font-semibold">本次测试资料</h2>
                  <label className="block space-y-2 text-sm">
                    <span>真实产品</span>
                    <select
                      aria-label="真实产品"
                      className={`${selectClass} w-full`}
                      value={draft.input.productId ?? ""}
                      disabled={locked}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          input: {
                            ...draft.input,
                            productId: e.target.value
                              ? Number(e.target.value)
                              : null,
                          },
                        })
                      }
                    >
                      <option value="">手动粘贴资料</option>
                      {products.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.asin} · {item.title || item.projectName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    产品资料来自已保存的 Listing
                    项目，包含抓取资料和补充评论。没有取得的资料不会自动补齐。
                  </p>
                  <label className="block space-y-2 text-sm">
                    <span>
                      {draft.input.productId ? "补充要求" : "输入资料"}
                    </span>
                    <Textarea
                      rows={12}
                      maxLength={120000}
                      disabled={locked}
                      value={draft.input.context}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          input: { ...draft.input, context: e.target.value },
                        })
                      }
                      placeholder="粘贴上一阶段产出、评论或本次要分析的资料…"
                    />
                  </label>
                  <Button
                    className="w-full"
                    disabled={
                      locked ||
                      (!draft.input.productId && !draft.input.context.trim())
                    }
                    onClick={() => run(false)}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    测试草稿
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={
                      locked ||
                      (!draft.input.productId && !draft.input.context.trim())
                    }
                    onClick={() => run(true)}
                  >
                    用正式版本对照测试
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    每次测试或对话调教都会调用模型，按实际用量计费。
                  </p>
                </section>
                <div className="space-y-5">
                  <div
                    className={`grid gap-4 ${baseline ? "2xl:grid-cols-2" : ""}`}
                  >
                    {[
                      ...(baseline
                        ? [{ label: "正式版本结果", test: baseline }]
                        : []),
                      { label: "草稿结果", test: latest },
                    ].map(({ label, test }) => (
                      <section key={label} className={`${panelClass} min-w-0`}>
                        <h2 className="mb-4 font-semibold">{label}</h2>
                        {test ? (
                          <>
                            <div className="max-h-[520px] overflow-auto break-words text-sm leading-7">
                              <Streamdown>{test.output}</Streamdown>
                            </div>
                            <p className="mt-4 text-xs text-muted-foreground">
                              {test.name} ·{" "}
                              {(test.durationMs / 1000).toFixed(1)} 秒 ·{" "}
                              {new Date(test.createdAt).toLocaleString()}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-3"
                              onClick={() =>
                                action(async () => {
                                  await navigator.clipboard.writeText(
                                    test.output
                                  );
                                })
                              }
                            >
                              复制结果
                            </Button>
                          </>
                        ) : (
                          <p className="py-16 text-center text-sm text-muted-foreground">
                            选择资料，开始第一次测试。
                          </p>
                        )}
                      </section>
                    ))}
                  </div>
                  <section className={`${panelClass} space-y-4`}>
                    <h2 className="font-semibold">告诉我哪里需要改进</h2>
                    {draft.feedback.map((item, i) => (
                      <div key={i} className="space-y-2 text-sm leading-6">
                        <p className="rounded-lg bg-muted p-3">
                          你：{item.instruction}
                        </p>
                        <p className="px-3 text-muted-foreground">
                          改进建议：{item.response}
                        </p>
                      </div>
                    ))}
                    <Textarea
                      aria-label="修改意见"
                      disabled={locked}
                      rows={3}
                      value={feedback}
                      onChange={e => setFeedback(e.target.value)}
                      placeholder="例如：把问题和评论一起分析；好评比例要说明分母；每个结论要有原文证据。"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        生成方法修改草稿，不会立即影响业务。
                      </p>
                      <Button
                        disabled={locked || feedback.trim().length < 2}
                        onClick={() => run(false, feedback)}
                      >
                        生成改进草稿
                      </Button>
                    </div>
                  </section>
                </div>
              </div>
            )}
            {draft && tab === 1 && (
              <section className={`${panelClass} space-y-5`}>
                <label className="block space-y-3">
                  <span className="font-semibold">技能方法与输出要求</span>
                  <Textarea
                    aria-label="技能方法"
                    rows={22}
                    maxLength={50000}
                    disabled={locked}
                    value={draft.content.systemPrompt}
                    onChange={e =>
                      setDraft({
                        ...draft,
                        content: {
                          ...draft.content,
                          systemPrompt: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    高级设置：输入模板
                  </summary>
                  <Textarea
                    aria-label="输入模板"
                    className="mt-3 font-mono text-xs"
                    rows={8}
                    maxLength={30000}
                    disabled={locked}
                    value={draft.content.userPromptTemplate}
                    onChange={e =>
                      setDraft({
                        ...draft,
                        content: {
                          ...draft.content,
                          userPromptTemplate: e.target.value,
                        },
                      })
                    }
                  />
                </details>
                <Button
                  disabled={locked || !dirty}
                  onClick={() =>
                    action(async () => {
                      await save();
                    })
                  }
                >
                  保存草稿
                </Button>
              </section>
            )}
            {draft && tab === 2 && (
              <section className={`${panelClass} space-y-4`}>
                <h2 className="font-semibold">测试案例与人工确认</h2>
                <p className="text-sm text-muted-foreground">
                  确认当前方法能稳定产出合格结果。修改方法后，旧结果不能代替新版本测试。
                </p>
                {draft.tests.length === 0 && (
                  <p className="py-8 text-muted-foreground">还没有测试记录。</p>
                )}
                {[...draft.tests].reverse().map(test => (
                  <details key={test.id} className="rounded-xl border p-4">
                    <summary className="cursor-pointer text-sm">
                      {test.name} · {test.baseline ? "正式版本" : "草稿"} ·{" "}
                      {new Date(test.createdAt).toLocaleString()} ·{" "}
                      {test.approved ? "人工确认通过" : "待检查"}
                    </summary>
                    <div className="my-4 max-h-80 overflow-auto text-sm">
                      <Streamdown>{test.output}</Streamdown>
                    </div>
                    {!test.baseline && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={locked || dirty}
                        onClick={() =>
                          action(async () =>
                            accept(
                              await api.approve.mutate({
                                ...scope,
                                id: draft.id,
                                revision: draft.revision,
                                testId: test.id,
                                approved: !test.approved,
                              })
                            )
                          )
                        }
                      >
                        <Check className="h-4 w-4" />
                        {test.approved ? "撤销通过" : "确认结果符合要求"}
                      </Button>
                    )}
                  </details>
                ))}
                {admin && (
                  <div className="rounded-xl bg-muted p-4">
                    <p className="mb-3 text-sm">
                      发布会更新正式技能。采用固定版本的助手仍保留原绑定，需到
                      Agent 库确认升级。
                    </p>
                    <Button
                      disabled={
                        locked ||
                        dirty ||
                        !draft.tests.some(
                          test => test.approved && !test.baseline
                        )
                      }
                      onClick={() => {
                        if (
                          window.confirm(
                            "确认发布当前技能方法？使用该技能最新版本的业务将应用新方法。"
                          )
                        )
                          action(async () => {
                            accept(
                              await api.publish.mutate({
                                ...scope,
                                id: draft.id,
                                revision: draft.revision,
                              })
                            );
                            setDetail(
                              await api.detail.query({ ...scope, slug })
                            );
                          });
                      }}
                    >
                      发布正式版本
                    </Button>
                  </div>
                )}
              </section>
            )}
            {tab === 3 && (
              <section className={`${panelClass} space-y-4`}>
                <h2 className="font-semibold">版本记录</h2>
                <p className="text-sm text-muted-foreground">
                  历史版本可恢复为独立草稿，重新测试后发布。
                </p>
                {detail.versions.length === 0 && (
                  <p className="py-8 text-muted-foreground">
                    本工作区还没有版本记录。
                  </p>
                )}
                {detail.versions.map(version => (
                  <div
                    key={version.snapshotId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm"
                  >
                    <span>
                      版本 {version.skillVersion} · {String(version.createdAt)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || dirty}
                      onClick={() =>
                        action(async () => {
                          accept(
                            await api.create.mutate({
                              ...scope,
                              slug,
                              snapshotId: version.snapshotId,
                            })
                          );
                          setTab(1);
                        })
                      }
                    >
                      恢复为草稿
                    </Button>
                  </div>
                ))}
                {detail.drafts.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-sm">
                      我的调教记录
                    </summary>
                    {detail.drafts.map(item => (
                      <button
                        className="mt-2 block text-sm text-primary underline"
                        key={item.id}
                        disabled={dirty || busy}
                        onClick={() => {
                          accept(item);
                          setTab(0);
                        }}
                      >
                        基于 v{item.baseVersion} · {item.tests.length} 次测试 ·{" "}
                        {item.status === "published" ? "已发布" : "草稿"}
                      </button>
                    ))}
                  </details>
                )}
              </section>
            )}
          </>
        )
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建技能</DialogTitle>
          </DialogHeader>
          <label className="space-y-2 text-sm">
            技能名称
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              maxLength={100}
              placeholder="例如：评论分析"
            />
          </label>
          <label className="space-y-2 text-sm">
            这个技能解决什么问题
            <Input
              value={newPurpose}
              onChange={e => setNewPurpose(e.target.value)}
              maxLength={500}
            />
          </label>
          <label className="space-y-2 text-sm">
            执行方法与期望结果
            <Textarea
              rows={7}
              value={newPrompt}
              onChange={e => setNewPrompt(e.target.value)}
              maxLength={50000}
            />
          </label>
          <Button
            disabled={busy || !newName.trim() || !newPrompt.trim()}
            onClick={() =>
              action(async () => {
                const created = await api.newSkill.mutate({
                  ...scope,
                  name: newName,
                  description: newPurpose,
                  systemPrompt: newPrompt,
                  category: "自建技能",
                });
                setCreateOpen(false);
                open(created.slug);
              })
            }
          >
            创建草稿技能
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
