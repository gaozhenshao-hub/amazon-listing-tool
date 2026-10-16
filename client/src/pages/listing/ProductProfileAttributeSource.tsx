import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

type Client = ReturnType<typeof trpc.useUtils>["client"];
type ProjectOption = Awaited<ReturnType<Client["projectAssignment"]["listImportableDevProjects"]["query"]>>[number];
type ProfilePreview = Awaited<ReturnType<Client["projectAssignment"]["getDevProjectProfile"]["query"]>>;
type ReadState<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };
type Props = { projectId: number };
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sections = [
  ["appearanceColors", "appearanceAiSuggestion", "外观设计"],
  ["mainFunctions", "functionsAiSuggestion", "功能特点"],
  ["costBreakdown", "costAiSuggestion", "产品成本"],
  ["packageDimensions", "packageAiSuggestion", "包装尺寸"],
  ["packageDesign", "packageDesignAiSuggestion", "包装设计"],
  ["userPersona", "userPersonaAiSuggestion", "用户画像"],
  ["usageScenarios", "usageScenariosAiSuggestion", "使用场景"],
  ["productMap", "productMapAiSuggestion", "产品地图"],
] as const;

function displayValue(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    try { return displayValue(JSON.parse(text)); } catch { return text; }
  }
  if (value === null || value === undefined || (typeof value === "object" && Object.keys(value).length === 0)) return "";
  return JSON.stringify(value, null, 2) ?? "";
}

// Match the importer's source-text selection; AI suggestions are never fallback
// source facts. The server remains authoritative and revalidates the full hash.
function enteredSourceText(raw: unknown): string {
  let value = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { /* Preserve entered text. */ } }
  function flatten(data: unknown, indent = 0): string {
    if (data === null || data === undefined || data === "") return "";
    const prefix = "  ".repeat(indent);
    if (typeof data !== "object") return `${prefix}${String(data)}`;
    if (Array.isArray(data)) return data.map(item => flatten(item)).filter(text => text.trim())
      .map(text => `${prefix}- ${text}`).join("\n");
    return Object.entries(data).flatMap(([key, item]) => {
      const text = flatten(item, typeof item === "object" ? indent + 1 : 0);
      if (!text.trim()) return [];
      return [typeof item === "object" ? `${prefix}${key}:\n${text}` : `${prefix}${key}: ${text}`];
    }).join("\n");
  }
  const text = flatten(value);
  return text.trim() ? text : "";
}

/** Fresh private reads are owned by this authenticated scope, never a shared
 * query cache whose key omits workspace/user. No request runs until opened. */
function OwnedSource({ projectId, workspaceId }: Props & { workspaceId: number | null }) {
  const utils = trpc.useUtils(), client = utils.client;
  const mutation = trpc.projectFile.importFromProfile.useMutation({ retry: false });
  const [open, setOpen] = useState(false), [selection, setSelection] = useState("");
  const [projects, setProjects] = useState<ReadState<ProjectOption[]>>({ status: "loading" });
  const [preview, setPreview] = useState<ReadState<ProfilePreview>>({ status: "loading" });
  const [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const active = useRef(false), sequence = useRef(0), pendingRef = useRef(false);
  const previewAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const generation = sequence;
    active.current = true;
    return () => { active.current = false; generation.current++; previewAbort.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let current = true;
    setProjects({ status: "loading" });
    void client.projectAssignment.listImportableDevProjects.query({ expectedWorkspaceId: workspaceId }, { signal: controller.signal })
      .then(data => { if (current && active.current) setProjects(Array.isArray(data) ? { status: "ready", data } : { status: "error" }); })
      .catch(() => { if (current && active.current) setProjects({ status: "error" }); });
    return () => { current = false; controller.abort(); };
  }, [client, open, workspaceId, refresh]);

  useEffect(() => {
    if (!open || !selection) return;
    const controller = new AbortController(), ticket = ++sequence.current;
    previewAbort.current = controller;
    setPreview({ status: "loading" });
    void client.projectAssignment.getDevProjectProfile.query({ devProjectId: Number(selection), expectedWorkspaceId: workspaceId }, { signal: controller.signal })
      .then(data => {
        if (!active.current || controller.signal.aborted || ticket !== sequence.current) return;
        if (data.project?.id !== Number(selection) || (data.profile && data.profile.projectId !== Number(selection))) {
          setPreview({ status: "error" }); return;
        }
        setPreview({ status: "ready", data });
      }).catch(() => { if (active.current && !controller.signal.aborted && ticket === sequence.current) setPreview({ status: "error" }); });
    return () => { controller.abort(); if (previewAbort.current === controller) previewAbort.current = null; };
  }, [client, open, selection, workspaceId, refresh]);

  const previewSections = useMemo(() => {
    if (preview.status !== "ready" || !preview.data.profile) return [];
    const profile = preview.data.profile as Record<string, unknown>;
    return sections.flatMap(([field, fallback, label]) => {
      const edited = enteredSourceText(profile[field]), suggested = displayValue(profile[fallback]);
      const text = edited || suggested;
      return text ? [{ label, text, ai: !edited }] : [];
    });
  }, [preview]);
  const ready = projects.status === "ready" && projects.data.some(item => String(item.id) === selection)
    && preview.status === "ready" && !!preview.data.profile && hash(preview.data.sourceHash) && previewSections.some(item => !item.ai);

  function changeSelection(value: string) {
    if (pendingRef.current) return;
    sequence.current++; previewAbort.current?.abort(); setSelection(value);
    setPreview({ status: "loading" }); setNotice("");
  }
  function close() {
    if (pendingRef.current) return;
    sequence.current++; previewAbort.current?.abort(); setOpen(false); setSelection("");
    setPreview({ status: "loading" }); setProjects({ status: "loading" }); setNotice("");
  }
  async function importProfile() {
    if (!active.current || pendingRef.current || !ready || preview.status !== "ready" || !hash(preview.data.sourceHash)) return;
    const ticket = sequence.current;
    pendingRef.current = true; setPending(true); setNotice("");
    try {
      const result = await mutation.mutateAsync({ listingProjectId: projectId, devProjectId: Number(selection),
        expectedWorkspaceId: workspaceId, expectedSourceHash: preview.data.sourceHash });
      if (!active.current || ticket !== sequence.current) return;
      if (result.projectId !== projectId || result.workspaceId !== workspaceId) throw new Error("SOURCE_RESULT_SCOPE_CHANGED");
      // Reread only source/summary/facts. Never start a Listing job, confirm a
      // fact/core/candidate, clear dirty edits or replace any existing copy.
      const refreshed = await Promise.allSettled([
        utils.projectFile.listByType.invalidate({ projectId, fileType: "product_attributes" }),
        utils.projectFile.listByProject.invalidate({ projectId }), utils.projectFile.getAnalysisSummary.invalidate({ projectId }),
        utils.listing.listRawFactSuggestions.invalidate({ projectId }), utils.listing.listReviewedFacts.invalidate({ projectId }),
      ]);
      if (!active.current || ticket !== sequence.current) return;
      setNotice(refreshed.some(item => item.status === "rejected")
        ? "属性表已生成，但页面刷新失败。请查看当前属性及版本历史后再审核，不要重复提交。"
        : "属性表已生成，请在生成页审核本品事实。");
      setSelection(""); setPreview({ status: "loading" }); sequence.current++;
    } catch (error) {
      if (active.current && ticket === sequence.current) {
        const code = error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? error.data.code : null;
        setNotice(code === "CONFLICT" ? "画像内容已变化，请重新选择并预览后再生成。"
          : code === "FORBIDDEN" || code === "UNAUTHORIZED" || code === "NOT_FOUND" ? "来源或项目权限已变化，请重新确认访问权限。"
            : "生成结果尚未确认，可能仍在处理中。请先查看当前属性及版本历史，不要盲目重复提交；重新生成前请重新预览画像。");
        setSelection(""); setPreview({ status: "loading" }); sequence.current++;
      }
    } finally { pendingRef.current = false; if (active.current) setPending(false); }
  }

  return <section aria-label="产品画像属性来源" className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/30 p-4">
    <div><h3 className="font-semibold">选择产品画像生成本品属性表</h3>
      <p className="mt-1 text-xs text-muted-foreground">先选择本工作区授权的产品开发项目并预览，明确确认后才生成属性来源；本地上传仅作补充。</p></div>
    {!open ? <Button type="button" variant="outline" onClick={() => setOpen(true)}>选择产品画像</Button> : <>
      {projects.status === "loading" && <p role="status">正在读取可选择的产品开发项目…</p>}
      {projects.status === "error" && <p role="alert">产品开发项目读取失败，请重新读取或联系管理员。</p>}
      {projects.status === "ready" && <label className="block text-sm">产品开发项目
        <select aria-label="产品画像来源项目" className="mt-1 block w-full rounded border bg-background p-2" value={selection} disabled={pending}
          onChange={event => changeSelection(event.target.value)}>
          <option value="">请选择项目</option>{projects.data.map(item => <option key={item.id} value={item.id}>{item.name}{item.targetMarket ? ` · ${item.targetMarket}` : ""}</option>)}
        </select></label>}
      {projects.status === "ready" && projects.data.length === 0 && <p>暂无当前工作区可用项目，请联系管理员分配。</p>}
      {selection && preview.status === "loading" && <p role="status">正在读取所选产品画像…</p>}
      {selection && preview.status === "error" && <p role="alert">画像预览读取失败，请重新选择或联系管理员。</p>}
      {selection && preview.status === "ready" && <section aria-label="所选产品画像预览" className="space-y-2 rounded border bg-background p-3">
        <h4 className="font-medium">{preview.data.project?.name}</h4>
        {!preview.data.profile ? <p>该项目尚无产品画像。</p> : <>
          {previewSections.length === 0 && <p>画像尚无可转换的内容，请先完善产品画像。</p>}
          {previewSections.length > 0 && !previewSections.some(item => !item.ai) && <p role="alert">画像尚无人工填写内容；AI 建议不参与本次生成，请先完善画像。</p>}
          {previewSections.map(item => <div key={item.label}><p className="text-xs font-medium">{item.label} · {item.ai ? "AI 建议（仅供参考，不参与本次生成）" : "参与生成的画像已填内容（仍须事实审核）"}</p>
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs">{item.text.slice(0, 3000)}</pre>
            {item.text.length > 3000 && <p className="text-xs">本段仅显示前 3000 字，请在产品画像中核对完整内容。</p>}</div>)}
          {!hash(preview.data.sourceHash) && <p role="alert">来源版本无法确认，请重新读取画像。</p>}
        </>}
      </section>}
      <p className="text-xs text-amber-800">确认将进行 AI 属性分析并保存，可能产生费用。仅采用画像已填内容；来源变化后请重新审核本品事实，已有编辑稿保持不变。</p>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={!ready || pending} onClick={() => void importProfile()}>{pending ? "正在生成并保存属性…" : "确认生成属性表"}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => { changeSelection(""); setRefresh(value => value + 1); }}>重新读取画像来源</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={close}>关闭选择</Button></div>
    </>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {open && <a className="block text-sm text-blue-700 underline" href="/listing/data-files#product-attributes-source-history">查看当前属性及版本历史</a>}
  </section>;
}

export default function ProductProfileAttributeSource({ projectId }: Props) {
  const auth = useAuth(), user = auth.user;
  if (auth.loading) return <p role="status">正在确认画像来源读取身份…</p>;
  if (auth.error || !user) return <p role="alert">请先确认登录状态，未读取产品画像。</p>;
  const workspaceId = user.defaultWorkspaceId;
  const validWorkspace = workspaceId === null || (typeof workspaceId === "number" && Number.isSafeInteger(workspaceId) && workspaceId > 0);
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || !validWorkspace
    || !Number.isSafeInteger(projectId) || projectId <= 0 || !user.role) return <p role="alert">用户、工作区或项目身份不完整，未读取产品画像。</p>;
  return <OwnedSource key={JSON.stringify([user.id, workspaceId, user.role, projectId])} projectId={projectId} workspaceId={workspaceId} />;
}
