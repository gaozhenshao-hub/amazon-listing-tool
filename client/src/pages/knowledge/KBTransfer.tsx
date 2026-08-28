import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArchiveRestore, ArrowLeft, CheckCircle2, CircleAlert, Download, FileArchive, FileUp, Loader2, PackageCheck, ShieldCheck, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const MODULES = [
  { value: "products", label: "产品创意", description: "产品信息、AI分析及产品图片" },
  { value: "listings", label: "Listing文案", description: "标题、五点、描述、A+与问答" },
  { value: "images", label: "图片知识库", description: "图片集、图片位置、标签与视觉分析" },
  { value: "skills", label: "运营SOP", description: "结构化SOP与原始文档附件" },
  { value: "videos", label: "视频知识库", description: "视频、封面、关键帧与分析内容" },
] as const;

type ModuleName = typeof MODULES[number]["value"];

const actionMeta = {
  create: { label: "将新建", icon: CheckCircle2, className: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  skip_identical: { label: "重复跳过", icon: PackageCheck, className: "text-slate-700 bg-slate-50 border-slate-200" },
  conflict: { label: "冲突，不导入", icon: CircleAlert, className: "text-amber-800 bg-amber-50 border-amber-200" },
} as const;

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

export default function KBTransfer() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const workspaceId = Number((user as any)?.defaultWorkspaceId || 0);
  const canExportSharedKnowledge = (user as any)?.role === "super_admin";
  const [selectedModules, setSelectedModules] = useState<ModuleName[]>(MODULES.map((module) => module.value));
  const [dateField, setDateField] = useState<"created_at" | "updated_at">("updated_at");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stage, setStage] = useState<any>(null);
  const [conflictPolicy, setConflictPolicy] = useState<"skip_conflicts" | "create_version">("skip_conflicts");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const filters = useMemo(() => ({
    modules: selectedModules,
    dateField,
    ...(startDate ? { startAt: new Date(`${startDate}T00:00:00.000`).toISOString() } : {}),
    ...(endDate ? { endAt: new Date(`${endDate}T23:59:59.999`).toISOString() } : {}),
    ...(tagInput.trim() ? { tags: tagInput.split(",").map((tag) => tag.trim()).filter(Boolean) } : {}),
  }), [selectedModules, dateField, startDate, endDate, tagInput]);

  const previewQuery = trpc.kbTransfer.previewExport.useQuery(filters, { enabled: canExportSharedKnowledge && selectedModules.length > 0 });
  const exportMutation = trpc.kbTransfer.exportZip.useMutation({
    onSuccess: (result) => {
      toast.success(`已生成完整知识包：${result.itemCount}条知识、${result.attachmentCount}个附件`);
      window.location.assign(result.url);
    },
    onError: (error) => toast.error(error.message),
  });
  const confirmMutation = trpc.kbTransfer.confirmImport.useMutation({
    onSuccess: async (result) => {
      toast.success(`已导入${result.created.length}条知识；${result.skipped.length}条按安全策略跳过`);
      if (stage?.stageId) {
        const fresh = await utils.kbTransfer.getStage.fetch({ stageId: stage.stageId });
        setStage({ ...fresh.preview, status: fresh.status, importResult: fresh.importResult });
      }
      await utils.kbSearch.stats.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleModule = (value: ModuleName, checked: boolean) => {
    setSelectedModules((current) => checked ? [...new Set([...current, value])] : current.filter((module) => module !== value));
  };

  const handleExport = () => {
    if (!canExportSharedKnowledge) {
      toast.error("仅超级管理员可导出当前工作空间的共享产品知识");
      return;
    }
    if (!selectedModules.length) {
      toast.error("请至少选择一个知识库模块");
      return;
    }
    exportMutation.mutate(filters);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (workspaceId <= 0) {
      toast.error("无法识别当前工作空间，请重新登录后重试");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("仅支持上传产品知识库完整ZIP包");
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      toast.error("知识包超过512MB上传上限，请拆分模块或日期范围");
      return;
    }
    setIsUploading(true);
    setUploadProgress(12);
    setStage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("workspaceId", String(workspaceId));
      setUploadProgress(35);
      const response = await fetch("/api/kb-transfer/preflight", { method: "POST", body: formData, credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "知识包预检失败");
      setUploadProgress(100);
      setStage(payload);
      toast.success("知识包预检通过，请核对导入计划后确认");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "知识包预检失败");
    } finally {
      setIsUploading(false);
      window.setTimeout(() => setUploadProgress(0), 700);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const importActions = stage?.items?.reduce((total: Record<string, number>, item: any) => {
    total[item.action] = (total[item.action] || 0) + 1;
    return total;
  }, {}) || {};

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate("/knowledge")} aria-label="返回知识库总览">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ArchiveRestore className="h-6 w-6 text-primary" />知识库流转</h1>
            <p className="mt-1 text-sm text-muted-foreground">仅适用于产品知识库；以完整ZIP在不同系统实例之间安全迁移已审核、可编辑的知识资产。</p>
          </div>
        </div>
        <Badge variant="secondary" className="h-fit w-fit border border-primary/15 bg-primary/5 text-primary">人工预览后确认</Badge>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Download className="h-5 w-5 text-primary" />导出完整知识包</CardTitle>
            <CardDescription>仅超级管理员可导出当前工作空间内全部已确认共享的产品知识。选择业务模块、标签和时间范围后，系统会重新验证每一个图片、PDF、文档或视频附件；任何无法安全嵌入的外部引用都会阻止“完整包”导出。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {MODULES.map((module) => (
                <label key={module.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50">
                  <Checkbox disabled={!canExportSharedKnowledge} checked={selectedModules.includes(module.value)} onCheckedChange={(checked) => toggleModule(module.value, checked === true)} />
                  <span className="grid gap-0.5"><span className="text-sm font-medium">{module.label}</span><span className="text-xs text-muted-foreground">{module.description}</span></span>
                </label>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2"><Label>筛选时间字段</Label><Select value={dateField} onValueChange={(value) => setDateField(value as "created_at" | "updated_at")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated_at">最后更新时间</SelectItem><SelectItem value="created_at">创建时间</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="transfer-start">开始日期</Label><Input id="transfer-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="transfer-end">结束日期</Label><Input id="transfer-end" type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="transfer-tags">标签筛选（可选）</Label><Input id="transfer-tags" value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="输入一个或多个标签，以英文逗号分隔" /></div>

            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] p-4">
              {!canExportSharedKnowledge ? <span className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 text-amber-600" />导出范围为当前工作空间的全部已确认共享知识，仅超级管理员可预览或导出。</span> : previewQuery.isLoading ? <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在计算导出范围…</span> : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"><span className="font-semibold">待导出 {previewQuery.data?.totalItems ?? 0} 条</span>{MODULES.filter((module) => selectedModules.includes(module.value)).map((module) => <span key={module.value} className="text-muted-foreground">{module.label} {previewQuery.data?.counts?.[module.value] ?? 0}</span>)}<span className="text-muted-foreground">声明附件候选约 {previewQuery.data?.declaredAttachmentCandidates ?? 0} 个</span></div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{previewQuery.data?.completenessRule || "预览不下载或复制任何附件。"}</p>
            </div>
            {canExportSharedKnowledge ? (
              <Button className="w-full sm:w-auto" onClick={handleExport} disabled={exportMutation.isPending || !selectedModules.length || Boolean(startDate && endDate && startDate > endDate)}><FileArchive className="mr-2 h-4 w-4" />{exportMutation.isPending ? "正在校验附件并生成ZIP…" : "下载全部共享ZIP知识包"}</Button>
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" role="note"><ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />仅超级管理员可导出当前工作空间的完整共享知识包。</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><FileUp className="h-5 w-5 text-primary" />上传并预检</CardTitle>
            <CardDescription>ZIP先在隔离区进行版本、文件路径、数量、体积、SHA-256、完整性清单与工作空间权限校验。预检不会立即写入产品知识库。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(event) => void handleFile(event.target.files?.[0])} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.025] px-5 text-center transition-colors hover:bg-primary/[0.06] disabled:cursor-not-allowed disabled:opacity-60">
              {isUploading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-primary" />}
              <span className="font-medium">{isUploading ? "正在上传并安全预检…" : "选择产品知识库完整ZIP包"}</span>
              <span className="text-xs text-muted-foreground">最大512MB；不接受皇帝记忆、密钥、运行审计或其他非产品知识数据。</span>
            </button>
            {isUploading && <Progress value={uploadProgress} className="h-2" />}
            <div className="grid gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />导入时会重写为当前工作空间和当前操作者，绝不采纳源端用户、工作空间、审核人或签名链接。</p><p className="flex gap-2"><PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />默认仅新建安全条目；内容哈希相同将跳过，ASIN等业务键冲突将保留在预览中而不覆盖。</p></div>
          </CardContent>
        </Card>
      </div>

      {stage && <Card className="border-primary/25 shadow-sm">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><CardTitle className="flex items-center gap-2 text-lg"><PackageCheck className="h-5 w-5 text-emerald-600" />导入预览已就绪</CardTitle><CardDescription className="mt-1">{stage.originalFileName} · {stage.summary?.itemCount ?? 0}条知识 · {stage.summary?.attachmentCount ?? 0}个附件 · 解压内容 {formatBytes(stage.summary?.totalBytes ?? 0)}。预览将在 {stage.expiresAt ? new Date(stage.expiresAt).toLocaleString() : "24小时后"} 失效。</CardDescription></div>
          <div className="flex flex-wrap gap-2">{Object.entries(importActions).map(([action, count]) => <Badge key={action} variant="outline" className={actionMeta[action as keyof typeof actionMeta].className}>{actionMeta[action as keyof typeof actionMeta].label} {String(count)}</Badge>)}</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-80 overflow-auto rounded-lg border">
            <table className="w-full min-w-[700px] text-left text-sm"><thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr><th className="p-3 font-medium">模块</th><th className="p-3 font-medium">知识条目</th><th className="p-3 font-medium">ASIN</th><th className="p-3 font-medium">预检结论</th><th className="p-3 font-medium">说明</th></tr></thead><tbody>{stage.items?.map((item: any) => { const meta = actionMeta[item.action as keyof typeof actionMeta]; const Icon = meta.icon; return <tr key={item.itemRef} className="border-t"><td className="p-3 text-muted-foreground">{MODULES.find((module) => module.value === item.module)?.label || item.module}</td><td className="max-w-72 truncate p-3 font-medium" title={item.label}>{item.label}</td><td className="p-3 font-mono text-xs">{item.asin || "—"}</td><td className="p-3"><Badge variant="outline" className={meta.className}><Icon className="mr-1 h-3.5 w-3.5" />{meta.label}</Badge></td><td className="p-3 text-xs text-muted-foreground">{item.reason || "内容完整，可创建为待审核条目"}</td></tr>; })}</tbody></table>
          </div>
          <Separator />
          {stage.status === "completed" ? <div className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-5 w-5" />此预览包已完成导入；重复点击不会再次写入。</div> : <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex max-w-3xl flex-col gap-2 text-sm text-muted-foreground"><p className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />确认后，重复内容始终跳过；新建项全部写入为当前工作空间的待审核知识。</p>{Boolean(importActions.conflict) && <div className="flex flex-wrap items-center gap-2"><Label htmlFor="transfer-conflict-policy" className="text-xs">ASIN等业务键冲突</Label><Select value={conflictPolicy} onValueChange={(value) => setConflictPolicy(value as "skip_conflicts" | "create_version")}><SelectTrigger id="transfer-conflict-policy" className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="skip_conflicts">安全跳过冲突（默认）</SelectItem><SelectItem value="create_version">保留为新的待审核版本</SelectItem></SelectContent></Select></div>}</div><Button onClick={() => confirmMutation.mutate({ stageId: stage.stageId, conflictPolicy })} disabled={confirmMutation.isPending || !(importActions.create || (importActions.conflict && conflictPolicy === "create_version"))}><CheckCircle2 className="mr-2 h-4 w-4" />{confirmMutation.isPending ? "正在安全导入…" : `确认导入 ${(importActions.create || 0) + (conflictPolicy === "create_version" ? (importActions.conflict || 0) : 0)} 条`}</Button></div>}
        </CardContent>
      </Card>}

      <Card className="border-amber-200 bg-amber-50/50 shadow-none dark:border-amber-900 dark:bg-amber-950/10"><CardContent className="flex gap-3 pt-6 text-sm text-amber-900 dark:text-amber-200"><XCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">完整包不接受静默缺件</p><p className="mt-1 text-amber-800/80 dark:text-amber-300/80">当前视频知识库可能存在仅保存外部URL的历史记录。若其视频、封面或关键帧无法在安全限制下下载，系统将明确阻止导出，而不会把链接伪装成已备份的附件。</p></div></CardContent></Card>
    </div>
  );
}
