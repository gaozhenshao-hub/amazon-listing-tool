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

  const catalogQuery = trpc.skillDistillation.catalog.useQuery();
  const projectsQuery = trpc.skillDistillation.projects.useQuery(undefined, { enabled: isGovernor });
  const detailQuery = trpc.skillDistillation.projectDetail.useQuery({ projectKey }, { enabled: isGovernor && Boolean(projectKey) });
  const sourcesQuery = trpc.skillDistillation.eligibleSources.useQuery({
    sourceDomain: sourceDomain === "all" ? undefined : sourceDomain,
    query: sourceQuery || undefined,
  }, { enabled: isGovernor });
  const ledgersQuery = trpc.skillDistillation.claimLedgers.useQuery({}, { enabled: isGovernor });

  useEffect(() => {
    if (!projectKey && projectsQuery.data?.[0]?.projectKey) setProjectKey(String(projectsQuery.data[0].projectKey));
  }, [projectKey, projectsQuery.data]);

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
  const transitionDraft = trpc.skillDistillation.transitionDraft.useMutation({
    onSuccess: async () => { toast.success("草案状态已更新"); await detailQuery.refetch(); },
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
    await Promise.all([projectsQuery.refetch(), detailQuery.refetch(), sourcesQuery.refetch(), ledgersQuery.refetch()]);
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
          <Card><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><BookOpenCheck className="h-4 w-4 text-violet-700" />一、可信来源池</CardTitle><CardDescription>只显示当前工作空间内已确认且已共享的产品知识；勾选后仍需手动加入当前项目。</CardDescription></div><Badge variant="outline">自动蒸馏关闭</Badge></div></CardHeader><CardContent>
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

            <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-violet-700" />三、Skill草案与审批</CardTitle><CardDescription>草案仅保存结构化Manifest和证据引用；默认不会调用模型。</CardDescription></CardHeader><CardContent className="space-y-3">
              <Select value={draftSkillType} onValueChange={setDraftSkillType} disabled={!projectKey}><SelectTrigger><SelectValue placeholder="选择固定Skill类型" /></SelectTrigger><SelectContent>{(catalogQuery.data?.catalog || []).map((item: any) => <SelectItem value={item.skillTypeKey} key={item.skillTypeKey}>{item.name} · {item.priority}</SelectItem>)}</SelectContent></Select>
              <Input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="草案名称" />
              <div className="max-h-24 space-y-1 overflow-auto rounded-md border p-2">{approvedEvidence.map((evidence: any) => <label key={evidence.evidenceKey} className="flex cursor-pointer items-center gap-2 text-xs"><Checkbox checked={selectedEvidenceKeys.includes(evidence.evidenceKey)} onCheckedChange={(checked) => setSelectedEvidenceKeys((previous) => checked ? [...new Set([...previous, evidence.evidenceKey])] : previous.filter((key) => key !== evidence.evidenceKey))} />{evidence.claim}</label>)}{!approvedEvidence.length && <p className="text-xs text-muted-foreground">先批准至少一张证据卡。</p>}</div>
              <Button className="w-full" disabled={!projectKey || !draftSkillType || !draftTitle.trim() || !selectedEvidenceKeys.length || createDraft.isPending} onClick={() => createDraft.mutate({ projectKey, skillTypeKey: draftSkillType, title: draftTitle, evidenceKeys: selectedEvidenceKeys, profile: {} })}><Sparkles className="mr-2 h-4 w-4" />建立人工草案</Button>
              <div className="space-y-2 border-t pt-3">{(detail?.drafts || []).slice(0, 6).map((draft: any) => <div key={draft.draftKey} className="rounded-lg border p-2"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-medium">{draft.title}</p><Badge variant="outline">{draft.status}</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">{draft.skillTypeKey} · {draft.evidenceKeys?.length || 0} 条证据</p>{draft.status === "draft" && <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => transitionDraft.mutate({ projectKey, draftKey: draft.draftKey, status: "review" })}>提交审查</Button>}</div>)}{projectKey && !detail?.drafts?.length && <p className="text-xs text-muted-foreground">尚未建立Skill草案。</p>}</div>
            </CardContent></Card>
          </div>

          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Layers3 className="h-4 w-4 text-violet-700" />四、Claim Ledger 与工作流联动</CardTitle><CardDescription>Claim Ledger 是 Listing 与图片工作流共享的“卖点—证据—承载位置”账本。锁定后只能建立新版本，系统只提示影响，不会覆盖已确认内容。</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-[1fr_180px_auto]"><Textarea value={claimStatement} onChange={(event) => setClaimStatement(event.target.value)} placeholder="先手动写入一个已批准证据支持的核心主张" /><Select value={selectedEvidenceKeys[0] || ""} onValueChange={(value) => setSelectedEvidenceKeys((previous) => [value, ...previous.filter((key) => key !== value)])}><SelectTrigger><SelectValue placeholder="关联证据" /></SelectTrigger><SelectContent>{approvedEvidence.map((evidence: any) => <SelectItem key={evidence.evidenceKey} value={evidence.evidenceKey}>{evidence.claim}</SelectItem>)}</SelectContent></Select><Button disabled={!claimStatement.trim() || !selectedEvidenceKeys[0] || createLedger.isPending} onClick={() => createLedger.mutate({ profile: {}, claims: [{ claimKey: `claim_${Date.now()}`, statement: claimStatement, evidenceKeys: [selectedEvidenceKeys[0]], status: "confirmed", risk: "medium" }] })}><LockKeyhole className="mr-2 h-4 w-4" />建立账本草案</Button></div><div className="mt-4 grid gap-2 md:grid-cols-3">{(ledgersQuery.data || []).slice(0, 3).map((ledger: any) => <div key={ledger.ledgerKey} className="rounded-lg border bg-muted/30 p-3"><div className="flex justify-between gap-2"><span className="font-mono text-xs">v{ledger.version}</span><Badge variant="outline">{ledger.status}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{ledger.claims?.length || 0} 项主张 · {ledger.ledgerKey}</p></div>)}{!ledgersQuery.data?.length && <p className="text-sm text-muted-foreground">尚未建立Claim Ledger；不会自动从Listing或图片内容中抽取。</p>}</div></CardContent></Card>

          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CircleAlert className="h-4 w-4 text-violet-700" />22项固定Skill目录</CardTitle><CardDescription>目录是能力蓝图，不代表当前已有运行中Skill。每个类型在未来可按类目、方向、描述方式与风格形成审核过的版本。</CardDescription></CardHeader><CardContent className="grid gap-3 xl:grid-cols-4">{Object.entries(groupedCatalog).map(([group, items]) => <div key={group} className="rounded-xl border p-3"><Badge className={`mb-3 border ${GROUP_COLORS[group] || ""}`} variant="outline">{group}</Badge><div className="space-y-2">{items.map((item: any) => <div key={item.skillTypeKey} className="rounded-lg bg-muted/50 p-2"><div className="flex justify-between gap-2"><p className="text-xs font-medium">{item.name}</p><span className="text-[10px] text-muted-foreground">{item.priority}</span></div><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.skillTypeKey}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{item.workflowNodes.join(" · ")}</p></div>)}</div></div>)}</CardContent></Card>
        </div>
      </section>
    </div>
  );
}
