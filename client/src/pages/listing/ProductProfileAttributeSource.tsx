import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { ProfileImportJobView } from "@shared/profileImportJob";
import { listingOwnerKey, listingRequestOwner } from "./listingResearchSelectionState";
import { exactProfileImportMatch, isOwnedProfileImportJob, isProfileImportActive, isProfileImportCommitted,
  isProfileImportResumable, isSourceHash, profileImportMatches, type ProfileImportBinding, type ProfileImportOwner } from "./profileImportJobState";

type Client = ReturnType<typeof trpc.useUtils>["client"];
type ProjectOption = Awaited<ReturnType<Client["projectAssignment"]["listImportableDevProjects"]["query"]>>[number];
type ProfilePreview = Awaited<ReturnType<Client["projectAssignment"]["getDevProjectProfile"]["query"]>>;
type ReadState<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };
type Props = { projectId: number };
type JobsState = { status: "loading" | "ready" | "error"; items: ProfileImportJobView[]; error: string };
const sections = [
  ["appearanceColors", "appearanceAiSuggestion", "外观设计"], ["mainFunctions", "functionsAiSuggestion", "功能特点"],
  ["costBreakdown", "costAiSuggestion", "产品成本"], ["packageDimensions", "packageAiSuggestion", "包装尺寸"],
  ["packageDesign", "packageDesignAiSuggestion", "包装设计"], ["userPersona", "userPersonaAiSuggestion", "用户画像"],
  ["usageScenarios", "usageScenariosAiSuggestion", "使用场景"], ["productMap", "productMapAiSuggestion", "产品地图"],
] as const;
function displayValue(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim(); if (!text) return "";
    try { return displayValue(JSON.parse(text)); } catch { return text; }
  }
  if (value === null || value === undefined || (typeof value === "object" && Object.keys(value).length === 0)) return "";
  return JSON.stringify(value, null, 2) ?? "";
}
function enteredSourceText(raw: unknown): string {
  let value = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { /* Preserve entered text. */ } }
  function flatten(data: unknown, indent = 0): string {
    if (data === null || data === undefined || data === "") return "";
    const prefix = "  ".repeat(indent);
    if (typeof data !== "object") return prefix + String(data);
    if (Array.isArray(data)) return data.map(item => flatten(item)).filter(text => text.trim()).map(text => prefix + "- " + text).join("\n");
    return Object.entries(data).flatMap(([key, item]) => {
      const text = flatten(item, typeof item === "object" ? indent + 1 : 0);
      return !text.trim() ? [] : [typeof item === "object" ? prefix + key + ":\n" + text : prefix + key + ": " + text];
    }).join("\n");
  }
  const text = flatten(value); return text.trim() ? text : "";
}
function errorCode(error: unknown) {
  return error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? error.data.code : null;
}
const deniedCode = (code: unknown) => ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "PRECONDITION_FAILED"].includes(String(code));
const statusLabel: Record<ProfileImportJobView["status"], string> = { queued: "等待执行", running: "正在生成", succeeded: "任务已完成", failed: "任务未完成", canceled: "任务已取消" };

/** All status, directory and preview responses belong to this authenticated
 * instance. Polling is read-only; closing the chooser never cancels a job. */
function OwnedSource({ owner, suspended }: { owner: ProfileImportOwner; suspended: boolean }) {
  const { listingProjectId: projectId, workspaceId } = owner;
  const utils = trpc.useUtils(), client = utils.client;
  const startMutation = trpc.projectFile.startProfileImportJob.useMutation({ retry: false });
  const resumeMutation = trpc.projectFile.resumeProfileImportJob.useMutation({ retry: false });
  const [open, setOpen] = useState(false), [selection, setSelection] = useState("");
  const [projects, setProjects] = useState<ReadState<ProjectOption[]>>({ status: "loading" });
  const [preview, setPreview] = useState<ReadState<ProfilePreview>>({ status: "loading" });
  const [jobs, setJobs] = useState<JobsState>({ status: "loading", items: [], error: "" });
  const [uncertain, setUncertain] = useState<ProfileImportBinding[]>([]);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const [directoryRefresh, setDirectoryRefresh] = useState(0), [previewRefresh, setPreviewRefresh] = useState(0);
  const [previewStamp, setPreviewStamp] = useState(0);
  const [completion, setCompletion] = useState("");
  const active = useRef(false), suspendedRef = useRef(suspended), denied = useRef(false), pendingRef = useRef(false);
  suspendedRef.current = suspended;
  const previewTicket = useRef(0), statusTicket = useRef(0), clock = useRef(0);
  const previewAbort = useRef<AbortController | null>(null), directoryAbort = useRef<AbortController | null>(null), statusAbort = useRef<AbortController | null>(null);
  const jobsRef = useRef(jobs); jobsRef.current = jobs;
  const resumeFloors = useRef(new Map<string, number>()), handledSuccess = useRef(new Set<string>());
  const snapshot = useRef({ open, selection, projectStatus: projects.status, previewStatus: preview.status });
  snapshot.current = { open, selection, projectStatus: projects.status, previewStatus: preview.status };
  const wasSuspended = useRef(suspended);
  const alive = useCallback(() => active.current && !suspendedRef.current, []);
  const usable = useCallback(() => alive() && !denied.current, [alive]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; previewAbort.current?.abort(); directoryAbort.current?.abort(); statusAbort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (suspended) { previewAbort.current?.abort(); directoryAbort.current?.abort(); statusAbort.current?.abort(); }
    else if (wasSuspended.current) {
      const current = snapshot.current;
      if (current.open && current.projectStatus === "loading") setDirectoryRefresh(value => value + 1);
      if (current.open && current.selection && current.previewStatus === "loading") setPreviewRefresh(value => value + 1);
    }
    wasSuspended.current = suspended;
  }, [suspended]);

  const acceptJobs = useCallback((items: ProfileImportJobView[]) => {
    for (const item of items) {
      if (isProfileImportResumable(item)) {
        if (!resumeFloors.current.has(item.runId)) resumeFloors.current.set(item.runId, ++clock.current);
      } else resumeFloors.current.delete(item.runId);
    }
    setJobs({ status: "ready", items, error: "" });
    setUncertain(previous => previous.filter(binding => !exactProfileImportMatch(items, binding)));
  }, []);
  const clearDenied = useCallback(() => {
    denied.current = true; previewTicket.current++; previewAbort.current?.abort(); directoryAbort.current?.abort();
    setSelection(""); setPreview({ status: "loading" }); setPreviewStamp(0); setProjects({ status: "loading" });
    setUncertain([]); setCompletion("");
    setJobs({ status: "error", items: [], error: "当前访问条件已变化，已隐藏旧任务；请重新读取确认访问权限。" });
  }, []);
  const refreshJobs = useCallback(async (mode: "list" | "status" = "list") => {
    if (!alive()) return null;
    statusAbort.current?.abort(); const controller = new AbortController(), ticket = ++statusTicket.current;
    statusAbort.current = controller;
    const previous = jobsRef.current.items;
    setJobs(current => ({ ...current, status: "loading", error: "" }));
    try {
      const activeJobs = previous.filter(isProfileImportActive);
      const items = mode === "status" && activeJobs.length
        ? await Promise.all(activeJobs.map(job => client.projectFile.getProfileImportJob.query(
          { listingProjectId: projectId, runId: job.runId, expectedWorkspaceId: workspaceId }, { signal: controller.signal })))
          .then(updated => {
            if (updated.some((item, index) => !isOwnedProfileImportJob(item, owner) || item.runId !== activeJobs[index].runId
              || !profileImportMatches(item, activeJobs[index]))) throw new Error("PROFILE_JOB_SCOPE_MISMATCH");
            return previous.map(job => updated.find(item => item.runId === job.runId) || job);
          })
        : await client.projectFile.listProfileImportJobs.query({ listingProjectId: projectId, expectedWorkspaceId: workspaceId }, { signal: controller.signal });
      if (!alive() || controller.signal.aborted || ticket !== statusTicket.current) return null;
      if (!Array.isArray(items) || items.some(item => !isOwnedProfileImportJob(item, owner)) || new Set(items.map(item => item.runId)).size !== items.length) {
        clearDenied(); return null;
      }
      const hadDenied = denied.current; denied.current = false;
      acceptJobs(items);
      if (hadDenied && snapshot.current.open) setDirectoryRefresh(value => value + 1);
      return items;
    } catch (error) {
      if (!alive() || controller.signal.aborted || ticket !== statusTicket.current) return null;
      if (deniedCode(errorCode(error)) || (error instanceof Error && error.message === "PROFILE_JOB_SCOPE_MISMATCH")) clearDenied();
      else setJobs(current => ({ ...current, status: "error", error: "任务状态读取失败，尚不能确认最新进度。请重新读取，不要重复提交。" }));
      return null;
    }
  }, [acceptJobs, alive, clearDenied, client, owner, projectId, workspaceId]);
  useEffect(() => {
    if (!suspended) void refreshJobs();
    return () => statusAbort.current?.abort();
  }, [refreshJobs, suspended]);
  useEffect(() => {
    if (suspended || jobs.status === "loading" || denied.current || (!jobs.items.some(isProfileImportActive) && !uncertain.length)) return;
    const timer = setTimeout(() => { void refreshJobs(uncertain.length ? "list" : "status"); }, jobs.status === "error" ? 5_000 : 2_000);
    return () => clearTimeout(timer);
  }, [jobs, refreshJobs, suspended, uncertain.length]);

  useEffect(() => {
    if (!open || !usable()) return;
    const controller = new AbortController(); directoryAbort.current = controller;
    setProjects({ status: "loading" });
    void client.projectAssignment.listImportableDevProjects.query({ expectedWorkspaceId: workspaceId }, { signal: controller.signal })
      .then(data => { if (usable() && !controller.signal.aborted) setProjects(Array.isArray(data) ? { status: "ready", data } : { status: "error" }); })
      .catch(() => { if (usable() && !controller.signal.aborted) setProjects({ status: "error" }); });
    return () => controller.abort();
  }, [client, directoryRefresh, open, usable, workspaceId]);
  useEffect(() => {
    if (!open || !selection || !usable()) return;
    const controller = new AbortController(), ticket = ++previewTicket.current, stamp = ++clock.current;
    previewAbort.current = controller; setPreview({ status: "loading" }); setPreviewStamp(0);
    void client.projectAssignment.getDevProjectProfile.query({ devProjectId: Number(selection), expectedWorkspaceId: workspaceId }, { signal: controller.signal })
      .then(data => {
        if (!usable() || controller.signal.aborted || ticket !== previewTicket.current) return;
        if (data.project?.id !== Number(selection) || (data.profile && data.profile.projectId !== Number(selection))) { setPreview({ status: "error" }); return; }
        setPreview({ status: "ready", data }); setPreviewStamp(stamp);
      }).catch(() => { if (usable() && !controller.signal.aborted && ticket === previewTicket.current) setPreview({ status: "error" }); });
    return () => controller.abort();
  }, [client, open, previewRefresh, selection, usable, workspaceId]);

  useEffect(() => {
    if (!usable()) return;
    const completed = jobs.items.filter(job => isProfileImportCommitted(job) && !handledSuccess.current.has(job.runId));
    if (!completed.length) return;
    for (const job of completed) handledSuccess.current.add(job.runId);
    void Promise.allSettled([
      utils.projectFile.listByType.invalidate({ projectId, fileType: "product_attributes" }),
      utils.projectFile.listByProject.invalidate({ projectId }), utils.projectFile.getAnalysisSummary.invalidate({ projectId }),
      utils.listing.listRawFactSuggestions.invalidate({ projectId }), utils.listing.listReviewedFacts.invalidate({ projectId }),
    ]).then(results => {
      // Dispatch already happened. Auth suspension only suppresses the notice;
      // it must not turn the same committed receipt into another refresh batch.
      if (!usable()) return;
      setCompletion(results.some(result => result.status === "rejected")
        ? "属性表已生成，但页面刷新失败。请查看当前属性及版本历史，不要重复生成。"
        : "属性表已生成，请在生成页审核本品事实。");
    });
  }, [jobs.items, projectId, usable, utils, suspended]);

  const previewSections = useMemo(() => {
    if (preview.status !== "ready" || !preview.data.profile) return [];
    const profile = preview.data.profile as Record<string, unknown>;
    return sections.flatMap(([field, fallback, label]) => {
      const edited = enteredSourceText(profile[field]), suggested = displayValue(profile[fallback]);
      return edited || suggested ? [{ label, text: edited || suggested, ai: !edited }] : [];
    });
  }, [preview]);
  const binding: ProfileImportBinding | null = projects.status === "ready" && projects.data.some(item => String(item.id) === selection)
    && preview.status === "ready" && !!preview.data.profile && isSourceHash(preview.data.sourceHash) && previewSections.some(item => !item.ai)
    ? { devProjectId: Number(selection), sourceHash: preview.data.sourceHash } : null;
  const existing = binding ? jobs.items.filter(job => profileImportMatches(job, binding)) : [];
  const sameUncertain = binding && uncertain.some(item => item.devProjectId === binding.devProjectId && item.sourceHash === binding.sourceHash);
  const canStart = !!binding && jobs.status === "ready" && !existing.length && !sameUncertain && !pending && !denied.current;

  function changeSelection(value: string) {
    if (pendingRef.current || !usable()) return;
    previewTicket.current++; previewAbort.current?.abort(); setSelection(value); setPreview({ status: "loading" }); setPreviewStamp(0); setNotice("");
  }
  function close() {
    if (pendingRef.current) return;
    previewTicket.current++; previewAbort.current?.abort(); setOpen(false); setSelection(""); setPreview({ status: "loading" }); setPreviewStamp(0);
  }
  async function submit(resume?: ProfileImportJobView) {
    if (!usable() || pendingRef.current || !binding || jobs.status !== "ready") return;
    if (resume ? !isProfileImportResumable(resume) || !profileImportMatches(resume, binding)
      || previewStamp <= (resumeFloors.current.get(resume.runId) ?? Infinity) : !canStart) return;
    const requested = { ...binding };
    const rememberUnconfirmed = () => {
      // A retained same-owner instance can be temporarily hidden during auth
      // refresh. Keep dispatch uncertainty, but never mutate a departed owner.
      if (!active.current || denied.current) return;
      setUncertain(previous => previous.some(item => item.devProjectId === requested.devProjectId && item.sourceHash === requested.sourceHash) ? previous : [...previous, requested]);
    };
    pendingRef.current = true; setPending(true); setNotice("");
    if (resume) resumeFloors.current.delete(resume.runId);
    try {
      const job = resume
        ? await resumeMutation.mutateAsync({ listingProjectId: projectId, runId: resume.runId, expectedWorkspaceId: workspaceId, expectedSourceHash: requested.sourceHash })
        : await startMutation.mutateAsync({ listingProjectId: projectId, devProjectId: requested.devProjectId, expectedWorkspaceId: workspaceId, expectedSourceHash: requested.sourceHash });
      if (!usable()) { rememberUnconfirmed(); return; }
      if (!isOwnedProfileImportJob(job, owner) || !profileImportMatches(job, requested) || (resume && job.runId !== resume.runId)) { clearDenied(); return; }
      statusTicket.current++; statusAbort.current?.abort();
      acceptJobs([job, ...jobsRef.current.items.filter(item => item.runId !== job.runId)]);
      setNotice(isProfileImportCommitted(job) ? "" : "任务已记录，可离开页面；返回后可继续查看进度。");
    } catch (error) {
      if (!usable()) { rememberUnconfirmed(); return; }
      const code = errorCode(error);
      if (deniedCode(code)) { clearDenied(); return; }
      if (code === "CONFLICT" || code === "BAD_REQUEST") {
        setNotice("画像或任务状态已变化，请重新读取任务并重新选择、预览画像后再确认。");
        previewTicket.current++; previewAbort.current?.abort(); setSelection(""); setPreview({ status: "loading" }); setPreviewStamp(0);
        void refreshJobs(); return;
      }
      rememberUnconfirmed();
      setNotice("提交结果尚未确认，正在核对原任务。不会自动重复提交；请读取任务状态后再操作。");
      const items = await refreshJobs();
      if (usable() && items && exactProfileImportMatch(items, requested)) setNotice("已找到原任务，请按任务记录查看进度。");
    } finally { pendingRef.current = false; if (active.current) setPending(false); }
  }

  return <section aria-label="产品画像属性来源" className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/30 p-4">
    <div><h3 className="font-semibold">选择产品画像生成本品属性表</h3><p className="mt-1 text-xs text-muted-foreground">预览并明确确认后创建后台任务；本地上传仅作补充，生成结果仍须审核本品事实。</p></div>
    <section aria-label="画像属性生成任务" className="space-y-2">
      {jobs.status === "loading" && <p role="status">正在读取已记录的属性任务…</p>}
      {jobs.status === "error" && <p role="alert">{jobs.error}</p>}
      {jobs.status === "ready" && !jobs.items.length && <p className="text-xs">当前范围尚无已记录的属性任务。</p>}
      {jobs.items.map(job => <article key={job.runId} aria-label={"属性任务 " + job.runId} className="space-y-1 rounded border bg-background p-3 text-sm">
        <p className="font-medium">画像项目 #{job.devProjectId} · {statusLabel[job.status]}{isProfileImportActive(job) ? " · " + Math.round(job.progress) + "%" : ""}</p>
        <p>{isProfileImportCommitted(job) ? "属性表已保存，文件 #" + job.fileId : job.stage === "model_result_unknown" ? "模型结果尚未确认，此画像版本不能再次生成。请核对属性历史或联系管理员。" : job.message.slice(0, 400)}</p>
        {job.status === "succeeded" && !isProfileImportCommitted(job) && <p role="alert">尚无完整的保存凭据，不能认定属性表已生成；请重新读取核对。</p>}
        {isProfileImportResumable(job) && <><p className="text-xs">可恢复此任务。请重新选择并预览同一画像版本，再明确确认；不会改用新版本。</p>
          <Button type="button" variant="outline" disabled={pending || jobs.status !== "ready" || !binding || !profileImportMatches(job, binding) || previewStamp <= (resumeFloors.current.get(job.runId) ?? Infinity)}
            onClick={() => void submit(job)}>确认恢复属性任务</Button></>}
        {!isProfileImportResumable(job) && (job.status === "failed" || job.status === "canceled") && job.stage !== "model_result_unknown" && <p className="text-xs">此任务不支持直接恢复，请核对属性历史；不会自动重新调用模型。</p>}
      </article>)}
      <Button type="button" variant="ghost" disabled={pending || jobs.status === "loading"} onClick={() => void refreshJobs()}>重新读取属性任务</Button>
    </section>
    {!open ? <Button type="button" variant="outline" onClick={() => setOpen(true)}>选择产品画像</Button> : <>
      {projects.status === "loading" && <p role="status">正在读取可选择的产品开发项目…</p>}
      {projects.status === "error" && <p role="alert">产品开发项目读取失败，请重新读取或联系管理员。</p>}
      {projects.status === "ready" && <label className="block text-sm">产品开发项目<select aria-label="产品画像来源项目" className="mt-1 block w-full rounded border bg-background p-2"
        value={selection} disabled={pending || denied.current} onChange={event => changeSelection(event.target.value)}>
        <option value="">请选择项目</option>{projects.data.map(item => <option key={item.id} value={item.id}>{item.name}{item.targetMarket ? " · " + item.targetMarket : ""}</option>)}</select></label>}
      {projects.status === "ready" && !projects.data.length && <p>暂无当前工作区可用项目，请联系管理员分配。</p>}
      {selection && preview.status === "loading" && <p role="status">正在读取所选产品画像…</p>}
      {selection && preview.status === "error" && <p role="alert">画像预览读取失败，请重新选择或联系管理员。</p>}
      {selection && preview.status === "ready" && <section aria-label="所选产品画像预览" className="space-y-2 rounded border bg-background p-3">
        <h4 className="font-medium">{preview.data.project?.name}</h4>
        {!preview.data.profile ? <p>该项目尚无产品画像。</p> : <>
          {!previewSections.length && <p>画像尚无可转换的内容，请先完善产品画像。</p>}
          {!!previewSections.length && !previewSections.some(item => !item.ai) && <p role="alert">画像尚无人工填写内容；AI 建议不参与本次生成，请先完善画像。</p>}
          {previewSections.map(item => <div key={item.label}><p className="text-xs font-medium">{item.label} · {item.ai ? "AI 建议（仅供参考，不参与本次生成）" : "参与生成的画像已填内容（仍须事实审核）"}</p>
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs">{item.text.slice(0, 3000)}</pre>
            {item.text.length > 3000 && <p className="text-xs">本段仅显示前 3000 字，请在产品画像中核对完整内容。</p>}</div>)}
          {!isSourceHash(preview.data.sourceHash) && <p role="alert">来源版本无法确认，请重新读取画像。</p>}
        </>}
      </section>}
      {!!existing.length && <p className="text-xs">此画像版本已有任务，请查看任务状态或在新鲜预览后确认恢复，不重复创建任务。</p>}
      {sameUncertain && <p role="alert">此画像版本的提交结果尚未确认，请先重新读取原任务，不要重复生成。</p>}
      <p className="text-xs text-amber-800">确认可能产生 AI 分析费用。仅采用画像已填内容；来源变化后请重新审核事实，已有编辑稿保持不变。</p>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={!canStart} onClick={() => void submit()}>{pending ? "正在提交属性任务…" : "确认生成属性表"}</Button>
        <Button type="button" variant="outline" disabled={pending || denied.current} onClick={() => { changeSelection(""); setDirectoryRefresh(value => value + 1); }}>重新读取画像来源</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={close}>关闭选择</Button></div>
    </>}
    {notice && <p role="status" className="text-sm">{notice}</p>}{completion && <p role="status" className="text-sm">{completion}</p>}
    <a className="block text-sm text-blue-700 underline" href="/listing/data-files#product-attributes-source-history">查看当前属性及版本历史</a>
  </section>;
}

export default function ProductProfileAttributeSource({ projectId }: Props) {
  const auth = useAuth(), actor = listingRequestOwner(auth.user, projectId);
  const identity = listingOwnerKey(actor), boundary = useRef({ identity, epoch: 0 });
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, shown = useRef<typeof token | null>(null);
  if (!actor) return <p role={auth.loading ? "status" : "alert"}>{auth.loading ? "正在确认画像来源读取身份…" : "用户、工作区或项目身份不完整，未读取产品画像。"}</p>;
  const suspended = auth.loading || !!auth.error;
  if (!suspended) shown.current = token;
  if (suspended && shown.current !== token) return <p role="status">正在确认画像来源读取身份…</p>;
  return <>{suspended && <p role="status">正在确认画像来源读取身份，当前预览暂时保留…</p>}
    <div hidden={suspended}><OwnedSource key={identity + ":" + token.epoch}
      owner={{ userId: actor.userId, workspaceId: actor.workspaceId, listingProjectId: projectId }} suspended={suspended} /></div></>;
}
