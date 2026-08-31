import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { BookOpenCheck, CheckCircle2, CircleAlert, FileStack, FlaskConical, GitBranch, Layers3, LockKeyhole, Plus, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type SourceDomain = "products" | "listings" | "images" | "skills" | "videos";
type ClaimDraft = { claimKey: string; statement: string; evidenceKeys: string[]; status: "candidate" | "confirmed"; risk: "low" | "medium" | "high" };

const DOMAIN_LABELS: Record<SourceDomain, string> = {
  products: "产品创意",
  listings: "Listing文案",
  images: "图片知识库",
  skills: "运营SOP",
  videos: "视频知识库",
};

const GROUP_COLORS: Record<string, string> = {
  蒸馏治理: "border-violet-200 bg-violet-50 text-violet-700",
  Listing: "border-amber-200 bg-amber-50 text-amber-700",
  图片: "border-sky-200 bg-sky-50 text-sky-700",
  协同治理: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

export default function EmperorSkillDistillation() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const isGovernor = user?.role === "super_admin";
  const utils = trpc.useUtils();
  const [projectKey, setProjectKey] = useState<string>("");
  const [sourceDomain, setSourceDomain] = useState<SourceDomain | "all">("all");
  const [sourceQuery, setSourceQuery] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectCategory, setProjectCategory] = useState("");
  const [evidenceClaim, setEvidenceClaim] = useState("");
  const [selectedSourceKey, setSelectedSourceKey] = useState("");
  const [draftSkillType, setDraftSkillType] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [selectedEvidenceKeys, setSelectedEvidenceKeys] = useState<string[]>([]);
  const [claimStatement, setClaimStatement] = useState("");
  const [editingDraftKey, setEditingDraftKey] = useState("");
  const [editingDraftTitle, setEditingDraftTitle] = useState("");
  const [editingManifestJson, setEditingManifestJson] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [releaseNotes, setReleaseNotes] = useState<Record<string, string>>({});
  const [rollbackNotes, setRollbackNotes] = useState<Record<string, string>>({});
  const [selectedFeedbackKeys, setSelectedFeedbackKeys] = useState<string[]>([]);
  const [nextDraftTitle, setNextDraftTitle] = useState("");
  const [selectedLedgerKey, setSelectedLedgerKey] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  const catalogQuery = trpc.skillDistillation.catalog.useQuery();
  const projectsQuery = trpc.skillDistillation.projects.useQuery(undefined, { enabled: isGovernor });
  const detailQuery = trpc.skillDistillation.projectDetail.useQuery({ projectKey }, { enabled: isGovernor && Boolean(projectKey) });
  const sourcesQuery = trpc.skillDistillation.eligibleSources.useQuery({
    sourceDomain: sourceDomain === "all" ? undefined : sourceDomain,
    query: sourceQuery || undefined,
  }, { enabled: isGovernor });
  const ledgersQuery = trpc.skillDistillation.claimLedgers.useQuery({}, { enabled: isGovernor });
  const publishedVersionsQuery = trpc.skillDistillation.publishedSkillVersions.useQuery(undefined, { enabled: isGovernor });
  const feedbackQueryInput = useMemo(() => ({ projectKey: projectKey || undefined }), [projectKey]);
  const feedbackQuery = trpc.skillDistillation.feedback.useQuery(feedbackQueryInput, { enabled: isGovernor && Boolean(projectKey) });
  const feedbackSummaryQuery = trpc.skillDistillation.feedbackSummary.useQuery(feedbackQueryInput, { enabled: isGovernor && Boolean(projectKey) });
  const consistencyMatrixQuery = trpc.skillDistillation.consistencyMatrix.useQuery({ ledgerKey: selectedLedgerKey }, { enabled: isGovernor && Boolean(selectedLedgerKey) });

  useEffect(() => {
    if (!projectKey && projectsQuery.data?.[0]?.projectKey) setProjectKey(String(projectsQuery.data[0].projectKey));
  }, [projectKey, projectsQuery.data]);
  useEffect(() => {
    const firstLocked = (ledgersQuery.data || []).find((ledger: any) => ledger.status === "locked");
    if (!selectedLedgerKey && firstLocked?.ledgerKey) setSelectedLedgerKey(String(firstLocked.ledgerKey));
  }, [selectedLedgerKey, ledgersQuery.data]);

  const createProject = trpc.skillDistillation.createProject.useMutation({
    onSuccess: async (project) => {
      toast.success("蒸馏项目已创建；当前仍是手动来源选择模式");
      setProjectName("");
      setProjectKey(String(project.projectKey));
      await utils.skillDistillation.projects.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const addSource = trpc.skillDistillation.addSource.useMutation({
    onSuccess: async () => {
      toast.success("已加入手动蒸馏候选；尚未执行蒸馏");
      setSelectedSourceIds([]);
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const createEvidence = trpc.skillDistillation.createEvidence.useMutation({
    onSuccess: async () => {
      toast.success("证据卡已创建，需人工批准后才能用于Skill草案");
      setEvidenceClaim("");
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const reviewEvidence = trpc.skillDistillation.reviewEvidence.useMutation({
    onSuccess: async () => {
      toast.success("证据卡状态已更新");
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const createDraft = trpc.skillDistillation.createDraft.useMutation({
    onSuccess: async () => {
      toast.success("Skill草案已创建；未调用模型，未发布Skill");
      setDraftTitle("");
      setSelectedEvidenceKeys([]);
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const runManualDistillation = trpc.skillDistillation.runManualDistillation.useMutation({
    onSuccess: async (draft) => {
      toast.success(`模型已生成${draft.generatedRuleCount}条待审规则；尚未发布Skill`);
      setDraftTitle("");
      setSelectedEvidenceKeys([]);
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const revalidateSources = trpc.skillDistillation.revalidateSources.useMutation({
    onSuccess: async (result) => {
      toast.success(result.invalidatedCount ? `已标记${result.invalidatedCount}个失效来源，关联证据需重新批准` : `已复核${result.checked}个来源，均仍有效`);
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const transitionDraft = trpc.skillDistillation.transitionDraft.useMutation({
    onSuccess: async () => { toast.success("草案状态已更新"); await detailQuery.refetch(); },
    onError: (error) => toast.error(error.message),
  });
  const publishDraft = trpc.skillDistillation.publishDraft.useMutation({
    onSuccess: async (result) => {
      toast.success(`已发布 ${result.skillSlug} v${result.skillVersion}；仅影响后续显式选择`);
      await detailQuery.refetch();
      await publishedVersionsQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const updateDraft = trpc.skillDistillation.updateDraft.useMutation({
    onSuccess: async () => {
      toast.success("草案已保存并重新完成冲突检查；尚未提交审查或发布");
      setEditingDraftKey("");
      setEditingNote("");
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const restoreSnapshot = trpc.skillDistillation.restoreSnapshot.useMutation({
    onSuccess: async (result) => {
      toast.success(`已从历史快照创建 ${result.restoredSkillSlug}；原版本与已锁定任务未被修改`);
      await publishedVersionsQuery.refetch();
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const createNextDraftFromFeedback = trpc.skillDistillation.createNextDraftFromFeedback.useMutation({
    onSuccess: async (draft) => {
      toast.success(`已根据所选反馈生成${draft.generatedRuleCount}条待审规则；未发布Skill`);
      setSelectedFeedbackKeys([]);
      setNextDraftTitle("");
      await detailQuery.refetch();
      await feedbackQuery.refetch();
      await feedbackSummaryQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const createLedger = trpc.skillDistillation.createClaimLedger.useMutation({
    onSuccess: async () => {
      toast.success("Claim Ledger草案已创建；确认后才可锁定为下游只读输入");
      setClaimStatement("");
      await ledgersQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const recordConsistencyDecision = trpc.skillDistillation.recordConsistencyDecision.useMutation({
    onSuccess: async (result) => {
      toast.success(result.requiresNewVersion ? "已记录新版本决定；请显式建立账本新版本。" : "差异决定已记录；未修改任何内容。");
      await consistencyMatrixQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const detail = detailQuery.data;
  const approvedEvidence = useMemo(() => (detail?.evidence || []).filter((item: any) => item.status === "approved"), [detail?.evidence]);
  const selectedSource = useMemo(() => (detail?.sources || []).find((item: any) => item.sourceKey === selectedSourceKey), [detail?.sources, selectedSourceKey]);
  const groupedCatalog = useMemo(() => {
    return (catalogQuery.data?.catalog || []).reduce<Record<string, any[]>>((groups, item) => {
      (groups[item.group] ||= []).push(item);
      return groups;
    }, {});
  }, [catalogQuery.data?.catalog]);

  if (authLoading) return <div className="flex min-h-[40vh] items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (!isGovernor) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 py-8">
        <Card className="border-amber-200 bg-amber-50/60">
          <CardHeader>
            <div className="flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-amber-700" /><div><CardTitle>知识蒸馏与Skill治理</CardTitle><CardDescription>该工作台仅对超级管理员开放。</CardDescription></div></div>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">您仍可在实际Listing和图片工作流中查看已锁定的Claim Ledger与获准的Skill版本；来源选择、证据审批、Skill发布和回滚由超级管理员统一治理。</CardContent>
        </Card>
      </div>
    );
  }

  const refreshAll = async () => {
    await Promise.all([projectsQuery.refetch(), detailQuery.refetch(), sourcesQuery.refetch(), ledgersQuery.refetch(), publishedVersionsQuery.refetch(), feedbackQuery.refetch(), feedbackSummaryQuery.refetch(), consistencyMatrixQuery.refetch()]);
    toast.success("工作台已刷新");
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <section className="rounded-2xl border border-violet-200 bg-[linear-gradient(115deg,#faf7ff_0%,#f4fbff_55%,#f7fffb_100%)] p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="max-w-4xl"><div className="mb-2 flex items-center gap-2 text-violet-700"><FlaskConical className="h-5 w-5" /><span className="text-sm font-semibold">皇帝 · 知识蒸馏与Skill治理</span></div><h1 className="text-2xl font-bold tracking-tight">先建立受控底座，再在知识充分时启动蒸馏</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">当前系统不会扫描知识库、调用模型、生成Draft或发布Skill。只有您手动创建项目、选择“已确认 + 已共享”来源并进入审批，才会产生可追溯的候选记录。</p></div>
          <Button variant="outline" onClick={refreshAll} disabled={projectsQuery.isFetching}><RefreshCw className="mr-2 h-4 w-4" />刷新状态</Button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[['22','固定Skill能力类型'],['P0–P3','分阶段发布'],['0','自动蒸馏任务'],['0','自动发布规则']].map(([value,label]) => <div key={label} className="rounded-xl border bg-background/80 px-4 py-3"><div className="text-xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>)}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit"><CardHeader className="pb-3"><CardTitle className="text-base">蒸馏项目</CardTitle><CardDescription>来源和草案均在项目内隔离。</CardDescription></CardHeader><CardContent className="space-y-3">
          <div className="space-y-2"><Label htmlFor="distill-project-name">新项目名称</Label><Input id="distill-project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例如：热水器配件 · 美国站" /><Input value={projectCategory} onChange={(event) => setProjectCategory(event.target.value)} placeholder="产品类目（可选）" /><Button className="w-full" onClick={() => createProject.mutate({ name: projectName, profile: { productCategory: projectCategory || undefined } })} disabled={!projectName.trim() || createProject.isPending}><Plus className="mr-2 h-4 w-4" />建立空蒸馏项目</Button></div>
          <div className="border-t pt-3"><p className="mb-2 text-xs font-medium text-muted-foreground">已建立项目</p><ScrollArea className="max-h-64"><div className="space-y-1">{(projectsQuery.data || []).map((project: any) => <button type="button" key={project.projectKey} onClick={() => setProjectKey(String(project.projectKey))} className={`w-full rounded-lg border px-3 py-2 text-left transition ${projectKey === project.projectKey ? "border-violet-400 bg-violet-50" : "border-transparent hover:bg-muted"}`}><div className="truncate text-sm font-medium">{project.name}</div><div className="mt-1 flex gap-1 text-[11px] text-muted-foreground"><span>{project.sourceCount} 来源</span><span>·</span><span>{project.evidenceCount} 证据</span><span>·</span><span>{project.draftCount} 草案</span></div></button>)}{!projectsQuery.isLoading && !projectsQuery.data?.length && <p className="px-1 py-4 text-xs leading-5 text-muted-foreground">尚未建立项目。建立空项目不会读取或蒸馏现有知识。</p>}</div></ScrollArea></div>
        </CardContent></Card>

        <div className="space-y-5">
          <Card><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><BookOpenCheck className="h-4 w-4 text-violet-700" />一、可信来源池</CardTitle><CardDescription>只显示当前工作空间内已确认且已共享的产品知识；勾选后仍需手动加入当前项目。</CardDescription></div><div className="flex items-center gap-2"><Badge variant="outline">自动蒸馏关闭</Badge><Button size="sm" variant="outline" disabled={!projectKey || revalidateSources.isPending} onClick={() => revalidateSources.mutate({ projectKey })}><RefreshCw className="mr-1 h-3.5 w-3.5" />复核来源</Button></div></div></CardHeader><CardContent>
            <div className="mb-3 flex flex-col gap-2 md:flex-row"><Select value={sourceDomain} onValueChange={(value) => setSourceDomain(value as SourceDomain | "all")}><SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部知识模块</SelectItem>{Object.entries(DOMAIN_LABELS).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="按ASIN、标题或类目检索" /><Button variant="outline" onClick={() => sourcesQuery.refetch()}>查询</Button></div>
            <div className="max-h-64 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground"><tr><th className="w-10 p-3" /><th className="p-3">来源</th><th className="p-3">类目 / ASIN</th><th className="p-3">最近更新</th></tr></thead><tbody>{(sourcesQuery.data || []).map((source: any) => <tr key={`${source.sourceDomain}-${source.sourceRowId}`} className="border-t"><td className="p-3"><Checkbox checked={selectedSourceIds.includes(source.sourceRowId)} onCheckedChange={(checked) => setSelectedSourceIds((previous) => checked ? [...new Set([...previous, source.sourceRowId])] : previous.filter((id) => id !== source.sourceRowId))} aria-label={`选择${source.title}`} /></td><td className="p-3"><Badge variant="secondary" className="mr-2 text-[10px]">{DOMAIN_LABELS[source.sourceDomain as SourceDomain]}</Badge>{source.title}</td><td className="p-3 text-xs text-muted-foreground">{source.category || "—"}{source.asin ? ` · ${source.asin}` : ""}</td><td className="p-3 text-xs text-muted-foreground">{formatDate(source.updatedAt)}</td></tr>)}{!sourcesQuery.isLoading && !sourcesQuery.data?.length && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">暂无符合“已确认 + 已共享”条件的来源</td></tr>}</tbody></table></div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">已选择 {selectedSourceIds.length} 条。来源不会被复制，只保存经验证的引用与内容指纹。</p><Button disabled={!projectKey || selectedSourceIds.length !== 1 || addSource.isPending} onClick={() => { const source = (sourcesQuery.data || []).find((item: any) => item.sourceRowId === selectedSourceIds[0]); if (source) addSource.mutate({ projectKey, sourceDomain: source.sourceDomain, sourceRowId: source.sourceRowId }); }}><Plus className="mr-2 h-4 w-4" />加入当前项目</Button></div>
          </CardContent></Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FileStack className="h-4 w-4 text-violet-700" />二、Evidence Card</CardTitle><CardDescription>从手动选择的来源中，由人录入并批准可复用的事实或模式。</CardDescription></CardHeader><CardContent className="space-y-3">
              <Select value={selectedSourceKey} onValueChange={setSelectedSourceKey} disabled={!projectKey}><SelectTrigger><SelectValue placeholder="选择当前项目中的来源" /></SelectTrigger><SelectContent>{(detail?.sources || []).filter((source: any) => source.sourceStatus === "eligible").map((source: any) => <SelectItem key={source.sourceKey} value={source.sourceKey}>{source.sourceSummary}</SelectItem>)}</SelectContent></Select>
              <Textarea value={evidenceClaim} onChange={(event) => setEvidenceClaim(event.target.value)} placeholder="录入可验证的事实、兼容性、视觉规律或合规边界；不粘贴完整知识正文" />
              <Button variant="outline" className="w-full" disabled={!projectKey || !selectedSource || evidenceClaim.trim().length < 4 || createEvidence.isPending} onClick={() => createEvidence.mutate({ projectKey, sourceKey: selectedSourceKey, evidenceType: "proof", claim: evidenceClaim, normalizedAttributes: {}, confidence: 0.8 })}>创建证据卡（待批准）</Button>
              <div className="space-y-2 border-t pt-3">{(detail?.evidence || []).slice(0, 6).map((evidence: any) => <div key={evidence.evidenceKey} className="rounded-lg border p-2"><div className="flex gap-2"><Badge variant={evidence.status === "approved" ? "default" : "secondary"}>{evidence.status === "approved" ? "已批准" : evidence.status}</Badge><p className="line-clamp-2 text-xs leading-5">{evidence.claim}</p></div>{evidence.status === "draft" && <div className="mt-2 flex gap-2"><Button size="sm" className="h-7 text-xs" onClick={() => reviewEvidence.mutate({ projectKey, evidenceKey: evidence.evidenceKey, approved: true })}>批准</Button><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => reviewEvidence.mutate({ projectKey, evidenceKey: evidence.evidenceKey, approved: false })}>拒绝</Button></div>}</div>)}{projectKey && !detail?.evidence?.length && <p className="text-xs text-muted-foreground">尚无证据卡。</p>}</div>
            </CardContent></Card>

            <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-violet-700" />三、Skill草案与审批</CardTitle><CardDescription>草案仅保存结构化Manifest和证据引用；模型仅在此处由您明确点击后调用，输出始终进入待审状态。</CardDescription></CardHeader><CardContent className="space-y-3">
              <Select value={draftSkillType} onValueChange={setDraftSkillType} disabled={!projectKey}><SelectTrigger><SelectValue placeholder="选择固定Skill类型" /></SelectTrigger><SelectContent>{(catalogQuery.data?.catalog || []).map((item: any) => <SelectItem value={item.skillTypeKey} key={item.skillTypeKey}>{item.name} · {item.priority}</SelectItem>)}</SelectContent></Select>
              <Input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="草案名称" />
              <div className="max-h-24 space-y-1 overflow-auto rounded-md border p-2">{approvedEvidence.map((evidence: any) => <label key={evidence.evidenceKey} className="flex cursor-pointer items-center gap-2 text-xs"><Checkbox checked={selectedEvidenceKeys.includes(evidence.evidenceKey)} onCheckedChange={(checked) => setSelectedEvidenceKeys((previous) => checked ? [...new Set([...previous, evidence.evidenceKey])] : previous.filter((key) => key !== evidence.evidenceKey))} />{evidence.claim}</label>)}{!approvedEvidence.length && <p className="text-xs text-muted-foreground">先批准至少一张证据卡。</p>}</div>
              <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" disabled={!projectKey || !draftSkillType || !draftTitle.trim() || !selectedEvidenceKeys.length || createDraft.isPending} onClick={() => createDraft.mutate({ projectKey, skillTypeKey: draftSkillType, title: draftTitle, evidenceKeys: selectedEvidenceKeys, profile: {} })}><Plus className="mr-2 h-4 w-4" />建立人工草案</Button><Button disabled={!projectKey || !draftSkillType || !draftTitle.trim() || !selectedEvidenceKeys.length || runManualDistillation.isPending} onClick={() => runManualDistillation.mutate({ projectKey, skillTypeKey: draftSkillType, title: draftTitle, evidenceKeys: selectedEvidenceKeys, profile: {} })}><Sparkles className="mr-2 h-4 w-4" />手动生成蒸馏草案</Button></div>
              <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-800">模型不会自动运行；点击“手动生成蒸馏草案”后仍须人工编辑、审查和发布。已发布版本只供后续任务显式选择，不覆盖任何既有内容。</p>
              <div className="space-y-2 border-t pt-3">{(detail?.drafts || []).slice(0, 12).map((draft: any) => <div key={draft.draftKey} className="rounded-lg border p-2"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-medium">{draft.title}</p><Badge variant="outline">{draft.status}</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">{draft.skillTypeKey} · {draft.evidenceKeys?.length || 0} 条证据</p>{draft.conflictReport?.hasConflict && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">检测到冲突：重复指纹 {draft.conflictReport.duplicateFingerprint?.length || 0}，重复规则 {draft.conflictReport.duplicateRules?.length || 0}，相反规则 {draft.conflictReport.opposingRules?.length || 0}。请人工处理，系统不会合并。</p>}<div className="mt-2 flex flex-wrap gap-2">{["draft", "conflict", "rejected"].includes(draft.status) && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditingDraftKey(draft.draftKey); setEditingDraftTitle(draft.title); setEditingManifestJson(JSON.stringify(draft.manifestDraft || {}, null, 2)); setSelectedEvidenceKeys(draft.evidenceKeys || []); }}>编辑草案</Button>}{draft.status === "draft" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => transitionDraft.mutate({ projectKey, draftKey: draft.draftKey, status: "review", reviewSummary: "超级管理员提交人工审查。" })}>提交审查</Button>}{draft.status === "review" && <><Button size="sm" className="h-7 text-xs" onClick={() => transitionDraft.mutate({ projectKey, draftKey: draft.draftKey, status: "approved", reviewSummary: "超级管理员批准，等待显式发布。" })}>批准</Button><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => transitionDraft.mutate({ projectKey, draftKey: draft.draftKey, status: "conflict", reviewSummary: "审查中发现待人工编辑的问题。" })}>返回编辑</Button><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => transitionDraft.mutate({ projectKey, draftKey: draft.draftKey, status: "rejected", reviewSummary: "人工拒绝。" })}>拒绝</Button></>}{draft.status === "approved" && <div className="flex w-full gap-2"><Input value={releaseNotes[draft.draftKey] || ""} onChange={(event) => setReleaseNotes((notes) => ({ ...notes, [draft.draftKey]: event.target.value }))} placeholder="填写人工发布说明（至少5字）" /><Button size="sm" disabled={(releaseNotes[draft.draftKey] || "").trim().length < 5 || publishDraft.isPending} onClick={() => publishDraft.mutate({ projectKey, draftKey: draft.draftKey, releaseNote: (releaseNotes[draft.draftKey] || "").trim() })}>发布新版本</Button></div>}</div></div>)}{projectKey && !detail?.drafts?.length && <p className="text-xs text-muted-foreground">尚未建立Skill草案。</p>}</div>
              {editingDraftKey && <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3"><p className="text-xs font-semibold text-violet-900">编辑草案 {editingDraftKey}</p><Input value={editingDraftTitle} onChange={(event) => setEditingDraftTitle(event.target.value)} placeholder="草案名称" /><Textarea className="min-h-40 font-mono text-xs" value={editingManifestJson} onChange={(event) => setEditingManifestJson(event.target.value)} placeholder="结构化Manifest JSON" /><div className="max-h-24 space-y-1 overflow-auto rounded-md border bg-background p-2">{approvedEvidence.map((evidence: any) => <label key={evidence.evidenceKey} className="flex cursor-pointer items-center gap-2 text-xs"><Checkbox checked={selectedEvidenceKeys.includes(evidence.evidenceKey)} onCheckedChange={(checked) => setSelectedEvidenceKeys((previous) => checked ? [...new Set([...previous, evidence.evidenceKey])] : previous.filter((key) => key !== evidence.evidenceKey))} />{evidence.claim}</label>)}</div><Input value={editingNote} onChange={(event) => setEditingNote(event.target.value)} placeholder="编辑说明（可选，写入审计）" /><div className="flex gap-2"><Button size="sm" disabled={!editingDraftTitle.trim() || !selectedEvidenceKeys.length || updateDraft.isPending} onClick={() => { try { const manifestDraft = JSON.parse(editingManifestJson); if (!manifestDraft || Array.isArray(manifestDraft) || typeof manifestDraft !== "object") throw new Error("Manifest必须为JSON对象"); updateDraft.mutate({ projectKey, draftKey: editingDraftKey, title: editingDraftTitle, profile: {}, evidenceKeys: selectedEvidenceKeys, manifestDraft, editNote: editingNote || undefined }); } catch (error) { toast.error(error instanceof Error ? error.message : "Manifest JSON格式无效"); } }}>保存并复核冲突</Button><Button size="sm" variant="outline" onClick={() => setEditingDraftKey("")}>取消</Button></div></div>}
            </CardContent></Card>
          </div>

          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Layers3 className="h-4 w-4 text-violet-700" />四、Claim Ledger 与工作流联动</CardTitle><CardDescription>Claim Ledger 是 Listing 与图片工作流共享的“卖点—证据—承载位置”账本。锁定后只能建立新版本，系统只提示影响，不会覆盖已确认内容。</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-[1fr_180px_auto]"><Textarea value={claimStatement} onChange={(event) => setClaimStatement(event.target.value)} placeholder="先手动写入一个已批准证据支持的核心主张" /><Select value={selectedEvidenceKeys[0] || ""} onValueChange={(value) => setSelectedEvidenceKeys((previous) => [value, ...previous.filter((key) => key !== value)])}><SelectTrigger><SelectValue placeholder="关联证据" /></SelectTrigger><SelectContent>{approvedEvidence.map((evidence: any) => <SelectItem key={evidence.evidenceKey} value={evidence.evidenceKey}>{evidence.claim}</SelectItem>)}</SelectContent></Select><Button disabled={!claimStatement.trim() || !selectedEvidenceKeys[0] || createLedger.isPending} onClick={() => createLedger.mutate({ profile: {}, claims: [{ claimKey: `claim_${Date.now()}`, statement: claimStatement, evidenceKeys: [selectedEvidenceKeys[0]], status: "confirmed", risk: "medium" }] })}><LockKeyhole className="mr-2 h-4 w-4" />建立账本草案</Button></div><div className="mt-4 grid gap-2 md:grid-cols-3">{(ledgersQuery.data || []).slice(0, 3).map((ledger: any) => <button type="button" key={ledger.ledgerKey} onClick={() => setSelectedLedgerKey(String(ledger.ledgerKey))} className={`rounded-lg border p-3 text-left ${selectedLedgerKey === ledger.ledgerKey ? "border-violet-400 bg-violet-50" : "bg-muted/30"}`}><div className="flex justify-between gap-2"><span className="font-mono text-xs">v{ledger.version}</span><Badge variant="outline">{ledger.status}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{ledger.claims?.length || 0} 项主张 · {ledger.ledgerKey}</p></button>)}{!ledgersQuery.data?.length && <p className="text-sm text-muted-foreground">尚未建立Claim Ledger；不会自动从Listing或图片内容中抽取。</p>}</div></CardContent></Card>

          <Card><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><CircleAlert className="h-4 w-4 text-violet-700" />五、图文一致性矩阵与差异决策</CardTitle><CardDescription>检查主张在五点、A+、QA、主图、辅图、A+图片和独立品牌故事的承载关系；仅输出建议，不自动修改内容。</CardDescription></div><Select value={selectedLedgerKey} onValueChange={setSelectedLedgerKey}><SelectTrigger className="w-64"><SelectValue placeholder="选择已锁定账本" /></SelectTrigger><SelectContent>{(ledgersQuery.data || []).filter((ledger: any) => ledger.status === "locked").map((ledger: any) => <SelectItem key={ledger.ledgerKey} value={ledger.ledgerKey}>v{ledger.version} · {ledger.ledgerKey}</SelectItem>)}</SelectContent></Select></div></CardHeader><CardContent className="space-y-3">{consistencyMatrixQuery.isLoading && <p className="text-sm text-muted-foreground">正在生成只读一致性矩阵…</p>}{consistencyMatrixQuery.data && <><div className="grid gap-2 md:grid-cols-5">{Object.entries(consistencyMatrixQuery.data.sourceState || {}).map(([key, value]) => <div key={key} className="rounded-lg border bg-muted/30 p-2"><div className="text-[11px] text-muted-foreground">{key}</div><div className="truncate text-sm font-semibold">{Array.isArray(value) ? value.join("、") || "—" : String(value)}</div></div>)}</div><div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-muted/70 text-muted-foreground"><tr><th className="p-2">主张</th><th className="p-2">证据</th><th className="p-2">五点</th><th className="p-2">A+</th><th className="p-2">QA</th><th className="p-2">主/辅图</th><th className="p-2">图A+/品牌故事</th></tr></thead><tbody>{consistencyMatrixQuery.data.matrix.map((row: any) => <tr key={row.claimKey} className="border-t"><td className="max-w-56 p-2"><div className="font-medium">{row.claimKey}</div><div className="line-clamp-2 text-muted-foreground">{row.statement}</div></td><td className="p-2">{row.evidenceKeys.length}</td><td className="p-2">{row.coverage.bullet}</td><td className="p-2">{row.coverage.aplus}</td><td className="p-2">{row.coverage.qa}</td><td className="p-2">{row.coverage.mainImage}/{row.coverage.secondaryImage}</td><td className="p-2">{row.coverage.imageAplus}/{row.coverage.brandStory}</td></tr>)}</tbody></table></div><div className="space-y-2">{consistencyMatrixQuery.data.issues.map((issue: any) => <div key={issue.issueKey} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><Badge variant="outline" className="mr-2">{issue.category}</Badge><span className="text-xs font-medium">{issue.message}</span></div><Badge variant="secondary">{issue.severity}</Badge></div><div className="mt-2 flex flex-wrap gap-2"><Input className="min-w-64 flex-1" value={decisionNotes[issue.issueKey] || ""} onChange={(event) => setDecisionNotes((notes) => ({ ...notes, [issue.issueKey]: event.target.value }))} placeholder="人工判断说明（可选）" />{([['accepted','接受建议'],['ignored','忽略'],['new_version','建立新版本'] ] as const).map(([decision, label]) => <Button key={decision} size="sm" variant={decision === "new_version" ? "default" : "outline"} disabled={recordConsistencyDecision.isPending} onClick={() => recordConsistencyDecision.mutate({ ledgerKey: selectedLedgerKey, matrixFingerprint: consistencyMatrixQuery.data.matrixFingerprint, issueKey: issue.issueKey, decision, note: decisionNotes[issue.issueKey] || undefined })}>{label}</Button>)}</div>{issue.latestDecision && <p className="mt-2 text-[11px] text-muted-foreground">最近决定：{issue.latestDecision.decision} · {formatDate(issue.latestDecision.createdAt)}</p>}</div>)}{!consistencyMatrixQuery.data.issues.length && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">未发现需要人工决定的覆盖、重复、孤立、空内容或辅图编号问题。</p>}</div><p className="text-[11px] text-muted-foreground">{consistencyMatrixQuery.data.advisory}</p></>}</CardContent></Card>

          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-violet-700" />五、已发布版本与可视化回滚</CardTitle><CardDescription>每次发布及恢复都创建新Skill和快照。恢复仅影响未来可选择版本，绝不覆盖历史、已锁定账本或已执行任务。</CardDescription></CardHeader><CardContent className="space-y-2">{(publishedVersionsQuery.data || []).map((version: any) => <div key={version.snapshotId} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-medium">{version.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{version.skillSlug} · 快照 {version.snapshotId}</p><p className="mt-1 text-[11px] text-muted-foreground">创建于 {formatDate(version.snapshotCreatedAt)}</p></div><div className="flex gap-2"><Input className="w-64" value={rollbackNotes[version.snapshotId] || ""} onChange={(event) => setRollbackNotes((notes) => ({ ...notes, [version.snapshotId]: event.target.value }))} placeholder="填写恢复说明（至少5字）" /><Button size="sm" variant="outline" disabled={!projectKey || (rollbackNotes[version.snapshotId] || "").trim().length < 5 || restoreSnapshot.isPending} onClick={() => restoreSnapshot.mutate({ projectKey, snapshotId: version.snapshotId, releaseNote: (rollbackNotes[version.snapshotId] || "").trim() })}>创建恢复版本</Button></div></div></div>)}{!publishedVersionsQuery.isLoading && !publishedVersionsQuery.data?.length && <p className="text-sm text-muted-foreground">当前工作空间尚无已发布蒸馏Skill或历史快照。</p>}</CardContent></Card>

          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4 text-violet-700" />六、反馈闭环与下一版草案</CardTitle><CardDescription>汇总使用后的接受、修订、拒绝与问题反馈。下一版仅根据您勾选的同一已发布Skill反馈和当前有效证据生成；不会修改已发布版本。</CardDescription></CardHeader><CardContent className="space-y-3"><div className="grid gap-2 sm:grid-cols-4">{[{ key: "acceptedCount", label: "接受" }, { key: "revisedCount", label: "已修订" }, { key: "rejectedCount", label: "拒绝" }, { key: "issueCount", label: "问题" }].map(({ key, label }) => <div key={key} className="rounded-lg border bg-muted/30 p-2 text-center"><div className="text-lg font-semibold">{(feedbackSummaryQuery.data || []).reduce((total: number, item: any) => total + Number(item[key] || 0), 0)}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>)}</div><div className="max-h-40 space-y-2 overflow-auto rounded-lg border p-2">{(feedbackQuery.data || []).map((feedback: any) => <label key={feedback.feedbackKey} className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-muted"><Checkbox checked={selectedFeedbackKeys.includes(feedback.feedbackKey)} onCheckedChange={(checked) => setSelectedFeedbackKeys((keys) => checked ? [...new Set([...keys, feedback.feedbackKey])] : keys.filter((key) => key !== feedback.feedbackKey))} /><span className="min-w-0"><span className="mr-2 text-xs font-medium">{feedback.outcome}</span><span className="text-xs">{feedback.note || "未填写说明"}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{feedback.parentDraftTitle} · {feedback.consumerDomain} · {feedback.consumerRef}</span></span></label>)}{!feedbackQuery.isLoading && !feedbackQuery.data?.length && <p className="py-3 text-center text-xs text-muted-foreground">尚无已发布蒸馏Skill的消费反馈。</p>}</div><div className="grid gap-2 md:grid-cols-[1fr_auto]"><Input value={nextDraftTitle} onChange={(event) => setNextDraftTitle(event.target.value)} placeholder="下一版草案名称" /><Button disabled={!projectKey || !nextDraftTitle.trim() || !selectedFeedbackKeys.length || !selectedEvidenceKeys.length || createNextDraftFromFeedback.isPending} onClick={() => createNextDraftFromFeedback.mutate({ projectKey, title: nextDraftTitle, feedbackKeys: selectedFeedbackKeys, evidenceKeys: selectedEvidenceKeys })}>基于所选反馈创建Draft</Button></div><p className="text-[11px] text-muted-foreground">同时勾选上方“已批准Evidence Card”作为下一版可验证依据。系统会拒绝跨Skill父草案混选的反馈。</p></CardContent></Card>

          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CircleAlert className="h-4 w-4 text-violet-700" />22项固定Skill目录</CardTitle><CardDescription>目录是能力蓝图，不代表当前已有运行中Skill。每个类型在未来可按类目、方向、描述方式与风格形成审核过的版本。</CardDescription></CardHeader><CardContent className="grid gap-3 xl:grid-cols-4">{Object.entries(groupedCatalog).map(([group, items]) => <div key={group} className="rounded-xl border p-3"><Badge className={`mb-3 border ${GROUP_COLORS[group] || ""}`} variant="outline">{group}</Badge><div className="space-y-2">{items.map((item: any) => <div key={item.skillTypeKey} className="rounded-lg bg-muted/50 p-2"><div className="flex justify-between gap-2"><p className="text-xs font-medium">{item.name}</p><span className="text-[10px] text-muted-foreground">{item.priority}</span></div><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.skillTypeKey}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{item.workflowNodes.join(" · ")}</p></div>)}</div></div>)}</CardContent></Card>
        </div>
      </section>
    </div>
  );
}
