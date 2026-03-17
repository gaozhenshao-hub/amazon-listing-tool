import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft, BarChart3, FileText, Loader2, Package, Star, Target, Users,
  Wrench, ClipboardCheck, Brain, RefreshCw, Globe, Upload, CheckCircle2,
  AlertCircle, DollarSign, Download, Lock, Unlock, ChevronRight,
  Edit2, Save, X, Copy, Tags, Tag, FileUp, FileDown, Eye,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import DevDataUpload from "./DevDataUpload";
import PanoramaTable from "./PanoramaTable";
import AttributeTagging from "./AttributeTagging";
import BomEditor from "./BomEditor";
import ProfileEditor from "./ProfileEditor";
import TestReportEditor from "./TestReportEditor";
import ScoringEditor from "./ScoringEditor";
import ManualEditor from "./ManualEditor";
import ProfitEditor from "./ProfitEditor";

const statusLabel: Record<string, { text: string; color: string }> = {
  draft: { text: "草稿", color: "bg-gray-500/10 text-gray-600" },
  data_collection: { text: "数据采集", color: "bg-blue-500/10 text-blue-600" },
  analyzing: { text: "分析中", color: "bg-amber-500/10 text-amber-600" },
  scoring: { text: "评分中", color: "bg-purple-500/10 text-purple-600" },
  completed: { text: "已完成", color: "bg-emerald-500/10 text-emerald-600" },
  archived: { text: "已归档", color: "bg-gray-500/10 text-gray-500" },
};

const phaseLabel: Record<string, { text: string; color: string; icon: any }> = {
  market_analysis: { text: "第一阶段：市场分析", color: "bg-blue-500/10 text-blue-700 border-blue-200", icon: BarChart3 },
  project_execution: { text: "第二阶段：项目落地", color: "bg-emerald-500/10 text-emerald-700 border-emerald-200", icon: Target },
};

export default function DevProjectDetail() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const [activeTab, setActiveTab] = useState("overview");
  const utils = trpc.useUtils();

  const { data: project, isLoading } = trpc.devProject.getById.useQuery({ id: projectId });
  const { data: products } = trpc.devProject.getProducts.useQuery({ projectId });
  const { data: profile } = trpc.devProfile.get.useQuery({ projectId }) as any;
  const { data: score } = trpc.devScoring.getScore.useQuery({ projectId }) as any;
  const { data: manual } = trpc.devManual.getManual.useQuery({ projectId }) as any;
  const { data: testReport } = trpc.devManual.getTestReport.useQuery({ projectId }) as any;

  const currentPhase = (project as any)?.phase || "market_analysis";
  const isPhase2 = currentPhase === "project_execution";

  /* scoring mutations moved to ScoringEditor.tsx */
  const manualMutation = trpc.devManual.generateManual.useMutation({
    onSuccess: () => { toast.success("说明书生成完成"); utils.devManual.getManual.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });
  const testReportMutation = trpc.devManual.generateTestReport.useMutation({
    onSuccess: () => { toast.success("测试报告生成完成"); utils.devManual.getTestReport.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  // Phase 1 tabs
  const phase1Tabs = useMemo(() => [
    { value: "overview", label: "概览", icon: Target },
    { value: "data", label: "数据管理", icon: Upload },
    { value: "tags", label: "标签管理", icon: Tags },
    { value: "tagging", label: "属性标注", icon: Tag },
    { value: "panorama", label: "全景分析表", icon: FileText },
    { value: "analysis", label: "分析报告", icon: BarChart3 },
    { value: "offsite", label: "站外分析", icon: Globe },
    { value: "scoring", label: "评分立项", icon: Star },
  ], []);

  // Phase 2 tabs
  const phase2Tabs = useMemo(() => [
    { value: "profile", label: "产品画像", icon: Users },
    { value: "bom", label: "BOM表", icon: Package },
    { value: "manual", label: "说明书", icon: FileText },
    { value: "test", label: "测试报告", icon: ClipboardCheck },
    { value: "profit", label: "利润计算", icon: DollarSign },
    { value: "download", label: "报告下载", icon: Download },
  ], []);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto space-y-5">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-6xl mx-auto text-center py-20">
        <p className="text-muted-foreground">项目不存在或无权访问</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/dev/projects")}>返回项目列表</Button>
      </div>
    );
  }

  const st = statusLabel[project.status] ?? { text: project.status, color: "" };
  const ph = phaseLabel[currentPhase] ?? phaseLabel.market_analysis;
  const PhaseIcon = ph.icon;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/dev/projects")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{project.name}</h1>
              <Badge variant="secondary" className={`text-xs ${st.color}`}>{st.text}</Badge>
              <Badge variant="outline" className={`text-xs ${ph.color}`}>
                <PhaseIcon className="h-3 w-3 mr-1" />{ph.text}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {project.targetMarket} · {project.platform || "Amazon"} · 创建于 {new Date(project.createdAt).toLocaleDateString()}
              {(project as any).approvedAt && ` · 立项于 ${new Date((project as any).approvedAt).toLocaleDateString()}`}
            </p>
          </div>
        </div>
      </div>

      {/* Phase Switcher */}
      <div className="flex gap-2">
        <Button
          variant={!isPhase2 ? "default" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={() => { setActiveTab("overview"); }}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          市场分析阶段
        </Button>
        <ChevronRight className="h-4 w-4 text-muted-foreground self-center" />
        <Button
          variant={isPhase2 ? "default" : "outline"}
          size="sm"
          className="gap-1.5"
          disabled={!isPhase2}
          onClick={() => { setActiveTab("profile"); }}
        >
          {isPhase2 ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          项目落地阶段
          {!isPhase2 && <span className="text-xs opacity-60 ml-1">(需先立项)</span>}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Dynamic Tab List */}
        <TabsList className={`grid w-full ${isPhase2 && ["profile","bom","manual","test","profit","download"].includes(activeTab) ? "grid-cols-6" : "grid-cols-7"}`}>
          {(isPhase2 && ["profile","bom","manual","test","profit","download"].includes(activeTab) ? phase2Tabs : phase1Tabs).map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs gap-1">
              <tab.icon className="h-3.5 w-3.5" />{tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ─── Phase 1: Market Analysis ─────────────────────── */}
        {/* ═══════════════════════════════════════════════════════ */}

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">竞品数量</p><p className="text-2xl font-bold mt-1">{products?.length ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">BOM部件</p><p className="text-2xl font-bold mt-1">--</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">综合评分</p><p className="text-2xl font-bold mt-1">{score?.totalScore ?? "--"}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">当前阶段</p><p className="text-lg font-bold mt-1">{isPhase2 ? "落地执行" : "市场分析"}</p></CardContent></Card>
          </div>

          {/* Phase Progress */}
          <Card>
            <CardHeader><CardTitle className="text-sm">项目进度</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${!isPhase2 ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>市场分析</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${isPhase2 ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
                  {isPhase2 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  <span>项目落地</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {project.description && (
            <Card><CardHeader><CardTitle className="text-sm">项目描述</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{project.description}</p></CardContent></Card>
          )}
          {project.keywords && (
            <Card><CardHeader><CardTitle className="text-sm">核心关键词</CardTitle></CardHeader><CardContent>
              <div className="flex flex-wrap gap-2">
                {project.keywords.split(/[,，\n]/).filter(Boolean).map((kw: string, i: number) => <Badge key={i} variant="secondary">{kw.trim()}</Badge>)}
              </div>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* Data Management */}
        <TabsContent value="data" className="space-y-4">
          <DevDataUpload projectId={projectId} onDataUploaded={() => utils.devProject.getById.invalidate({ id: projectId })} />
        </TabsContent>

        {/* Tag Management */}
        <TabsContent value="tags" className="space-y-4">
          <ProjectTagManager projectId={projectId} />
        </TabsContent>

        {/* Attribute Tagging */}
        <TabsContent value="tagging" className="space-y-4">
          <AttributeTagging projectId={projectId} />
        </TabsContent>

        {/* Panorama Table */}
        <TabsContent value="panorama" className="space-y-4">
          <PanoramaTable projectId={projectId} />
        </TabsContent>

        {/* Analysis Report */}
        <TabsContent value="analysis" className="space-y-4">
          <Card><CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="h-10 w-10 mb-3 text-primary opacity-60" />
            <p className="text-sm font-medium">市场分析工作台</p>
            <p className="text-xs text-muted-foreground mt-1">6阶段数据驱动分析：市场大盘 → 属性交叉 → 价格段 → 品牌竞争 → 评论深度 → 综合决策（属性标注已独立为单独tab）</p>
            <Button className="mt-4 gap-2" onClick={() => setLocation(`/dev/project/${projectId}/analysis`)}>
              <BarChart3 className="h-4 w-4" />
              进入分析工作台
            </Button>
          </CardContent></Card>
        </TabsContent>

        {/* Offsite Analysis */}
        <TabsContent value="offsite" className="space-y-4">
          <Card><CardContent className="flex flex-col items-center justify-center py-12">
            <Globe className="h-10 w-10 mb-3 text-primary opacity-60" />
            <p className="text-sm font-medium">站外数据分析</p>
            <p className="text-xs text-muted-foreground mt-1">Google趋势 · YouTube · TikTok · Facebook · 独立站 · Reddit · 众筹网站</p>
            <Button className="mt-4 gap-2" onClick={() => setLocation(`/dev/project/${projectId}/offsite`)}>
              <Globe className="h-4 w-4" />
              进入站外分析
            </Button>
          </CardContent></Card>
        </TabsContent>

        {/* Scoring + Approval */}
        <TabsContent value="scoring" className="space-y-4">
          <ScoringEditor score={score} project={project} projectId={projectId} isPhase2={isPhase2} />
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ─── Phase 2: Project Execution ───────────────────── */}
        {/* ═══════════════════════════════════════════════════════ */}

        {/* Product Profile (8 sub-modules) */}
        <TabsContent value="profile" className="space-y-4">
          {!isPhase2 ? (
            <LockedPhaseCard />
          ) : (
            <ProfileEditor projectId={projectId} profile={profile} />
          )}
        </TabsContent>

        {/* BOM */}
        <TabsContent value="bom" className="space-y-4">
          {!isPhase2 ? (
            <LockedPhaseCard />
          ) : (
            <BomEditor projectId={projectId} />
          )}
        </TabsContent>

        {/* Manual */}
        <TabsContent value="manual" className="space-y-4">
          {!isPhase2 ? (
            <LockedPhaseCard />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" />产品说明书</h3>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => manualMutation.mutate({ projectId })} disabled={manualMutation.isPending} className="gap-2">
                    {manualMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {manual ? "重新生成" : "AI生成说明书"}
                  </Button>
                </div>
              </div>
              <ManualEditor manual={manual} projectId={projectId} />
            </>
          )}
        </TabsContent>

        {/* Test Report */}
        <TabsContent value="test" className="space-y-4">
          {!isPhase2 ? (
            <LockedPhaseCard />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2"><ClipboardCheck className="h-4 w-4" />测试报告</h3>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => testReportMutation.mutate({ projectId })} disabled={testReportMutation.isPending} className="gap-2">
                    {testReportMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {testReport ? "重新生成" : "AI生成测试报告"}
                  </Button>
                </div>
              </div>
              {testReport?.testItems ? (
                <TestReportEditor testReport={testReport} projectId={projectId} />
              ) : (
                <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ClipboardCheck className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">8类测试：安装 · 使用 · 跌落 · 运输 · 功能 · 耐久性 · 安全 · 包装</p>
                  <p className="text-xs text-muted-foreground mt-1">点击"AI生成测试报告"开始</p>
                </CardContent></Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Profit Calculator */}
        <TabsContent value="profit" className="space-y-4">
          {!isPhase2 ? (
            <LockedPhaseCard />
          ) : (
            <ProfitEditor projectId={projectId} />
          )}
        </TabsContent>

        {/* Report Download */}
        <TabsContent value="download" className="space-y-4">
          {!isPhase2 ? (
            <LockedPhaseCard />
          ) : (
            <ReportDownload projectId={projectId} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Locked Phase Card ─────────────────────────────────── */
/* ═══════════════════════════════════════════════════════ */
/* ─── Project Tag Manager Component ──────────────────── */
/* ═══════════════════════════════════════════════════════ */
function ProjectTagManager({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [addingTagCatId, setAddingTagCatId] = useState<number | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagValue, setNewTagValue] = useState("");
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editItemName, setEditItemName] = useState("");
  const [editItemValue, setEditItemValue] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [showAddCat, setShowAddCat] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<number>>(new Set());
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importStep, setImportStep] = useState<"upload" | "preview" | "result">("upload");
  const [importResult, setImportResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: categories, isLoading } = trpc.devProjectTags.getCategories.useQuery({ projectId });
  const { data: tagStatus } = trpc.devProjectTags.getTagStatus.useQuery({ projectId });
  const { data: templateData } = trpc.devProjectTags.getImportTemplate.useQuery({ projectId });
  const { data: dataStatus } = trpc.devProject.getDataStatus.useQuery({ projectId });

  const initMutation = trpc.devProjectTags.initCategories.useMutation({
    onSuccess: () => { toast.success("标签分类初始化完成"); utils.devProjectTags.getCategories.invalidate({ projectId }); utils.devProjectTags.getTagStatus.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const aiGenMutation = trpc.devProjectTags.aiGenerateTags.useMutation({
    onSuccess: (d: any) => { toast.success(`AI生成完成：${d.totalTags}个标签`); utils.devProjectTags.getCategories.invalidate({ projectId }); utils.devProjectTags.getTagStatus.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const aiGenCatMutation = trpc.devProjectTags.aiGenerateCategoryTags.useMutation({
    onSuccess: (d: any) => { toast.success(`生成${d.count}个标签`); utils.devProjectTags.getCategories.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateCatMutation = trpc.devProjectTags.updateCategoryName.useMutation({
    onSuccess: () => { toast.success("分类名称已更新"); setEditingCatId(null); utils.devProjectTags.getCategories.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const addCatMutation = trpc.devProjectTags.addCategory.useMutation({
    onSuccess: () => { toast.success("分类已添加"); setNewCatName(""); setShowAddCat(false); utils.devProjectTags.getCategories.invalidate({ projectId }); utils.devProjectTags.getTagStatus.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteCatMutation = trpc.devProjectTags.deleteCategory.useMutation({
    onSuccess: () => { toast.success("分类已删除"); utils.devProjectTags.getCategories.invalidate({ projectId }); utils.devProjectTags.getTagStatus.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const addItemMutation = trpc.devProjectTags.addTagItem.useMutation({
    onSuccess: () => { toast.success("标签已添加"); setAddingTagCatId(null); setNewTagName(""); setNewTagValue(""); utils.devProjectTags.getCategories.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateItemMutation = trpc.devProjectTags.updateTagItem.useMutation({
    onSuccess: () => { toast.success("标签已更新"); setEditingItemId(null); utils.devProjectTags.getCategories.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteItemMutation = trpc.devProjectTags.deleteTagItem.useMutation({
    onSuccess: () => { toast.success("标签已删除"); utils.devProjectTags.getCategories.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const confirmCatMutation = trpc.devProjectTags.confirmCategory.useMutation({
    onSuccess: () => { toast.success("分类已确认锁定"); utils.devProjectTags.getCategories.invalidate({ projectId }); utils.devProjectTags.getTagStatus.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const unconfirmCatMutation = trpc.devProjectTags.unconfirmCategory.useMutation({
    onSuccess: () => { toast.success("分类已解锁"); utils.devProjectTags.getCategories.invalidate({ projectId }); utils.devProjectTags.getTagStatus.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const confirmAllMutation = trpc.devProjectTags.confirmAll.useMutation({
    onSuccess: () => { toast.success("全部分类已确认"); utils.devProjectTags.getCategories.invalidate({ projectId }); utils.devProjectTags.getTagStatus.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const parseMutation = trpc.devProjectTags.parseImportFile.useMutation({
    onSuccess: (data: any) => { setImportPreview(data); setImportStep("preview"); },
    onError: (e: any) => toast.error(e.message),
  });
  const batchImportMutation = trpc.devProjectTags.batchImport.useMutation({
    onSuccess: (data: any) => { setImportResult(data); setImportStep("result"); utils.devProjectTags.getCategories.invalidate({ projectId }); utils.devProjectTags.getTagStatus.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleFileSelect = async (file: File) => {
    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      parseMutation.mutate({ projectId, fileContent: content, fileName: file.name });
    };
    reader.readAsText(file, "utf-8");
  };

  const handleImport = () => {
    if (!importPreview) return;
    batchImportMutation.mutate({ projectId, items: importPreview.previewRows.concat(
      importPreview.totalRows > 50 ? [] : [] // All rows are in previewRows for now
    ) });
  };

  const handleDownloadTemplate = () => {
    if (!templateData) return;
    const blob = new Blob([templateData.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "标签导入模板.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const resetImportDialog = () => {
    setShowImportDialog(false); setImportFile(null); setImportPreview(null);
    setImportStep("upload"); setImportResult(null);
  };

  const toggleExpand = (catId: number) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  if (isLoading) return <Skeleton className="h-[300px]" />;

  // Not initialized
  if (!categories || categories.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Tags className="h-10 w-10 mb-3 text-primary opacity-60" />
          <p className="text-sm font-medium">标签管理</p>
          <p className="text-xs text-muted-foreground mt-1">初始化7类标签分类（基础分类/材质/功能/参数/安装方式/认证/特殊），用于后续交叉分析</p>
          <Button className="mt-4 gap-2" onClick={() => initMutation.mutate({ projectId })} disabled={initMutation.isPending}>
            {initMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tags className="h-4 w-4" />}
            初始化标签分类
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Tags className="h-4 w-4" />标签管理</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tagStatus ? `${tagStatus.confirmed}/${tagStatus.total} 已确认` : ""}
            {tagStatus?.allConfirmed && <span className="text-emerald-600 ml-2">✓ 全部确认，可进入分析阶段</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              const result = await utils.devProjectTags.exportTagsCsv.fetch({ projectId });
              const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = result.fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              toast.success(`导出成功：${result.totalCategories}个分类，${result.totalItems}个标签`);
            } catch {
              toast.error('导出失败');
            }
          }} className="gap-1.5">
            <FileDown className="h-3.5 w-3.5" />导出CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowImportDialog(true)} className="gap-1.5">
            <FileUp className="h-3.5 w-3.5" />批量导入
          </Button>
          <Button size="sm" variant="outline" onClick={() => aiGenMutation.mutate({ projectId })} disabled={aiGenMutation.isPending} className="gap-1.5">
            {aiGenMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            AI全部生成
          </Button>
          {tagStatus && !tagStatus.allConfirmed && tagStatus.total > 0 && (
            <Button size="sm" onClick={() => confirmAllMutation.mutate({ projectId })} disabled={confirmAllMutation.isPending} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              {confirmAllMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              全部确认
            </Button>
          )}
        </div>
      </div>

      {/* Data Source Indicator */}
      {dataStatus && (
        <div className={`rounded-lg border p-3 flex items-center gap-3 ${(dataStatus as any).bullet_points?.confirmed ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
          <div className={`h-8 w-8 rounded-full flex items-center justify-center ${(dataStatus as any).bullet_points?.confirmed ? 'bg-emerald-100' : 'bg-amber-100'}`}>
            <FileText className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">
              {(dataStatus as any).bullet_points?.confirmed ? '✅ 标题五点数据已确认' : '⚠️ 标题五点数据未确认'}
            </p>
            <p className="text-xs text-muted-foreground">
              {(dataStatus as any).bullet_points?.confirmed
                ? `AI将基于已确认的标题五点数据深度分析生成标签（${(dataStatus as any).bullet_points?.totalRows || 0}条记录）`
                : 'AI将仅基于销量表格中的基础数据生成标签，建议先上传并确认标题五点数据以获得更精准的标签'}
            </p>
          </div>
        </div>
      )}

      {/* Status Bar */}
      {tagStatus && (
        <div className="flex gap-3">
          <div className="flex-1 bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">{tagStatus.total}</p>
            <p className="text-xs text-muted-foreground">标签分类</p>
          </div>
          <div className="flex-1 bg-emerald-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-emerald-600">{tagStatus.confirmed}</p>
            <p className="text-xs text-muted-foreground">已确认</p>
          </div>
          <div className="flex-1 bg-amber-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-600">{tagStatus.total - tagStatus.confirmed}</p>
            <p className="text-xs text-muted-foreground">待确认</p>
          </div>
          <div className={`flex-1 rounded-lg p-3 text-center ${tagStatus.allConfirmed ? "bg-emerald-100" : "bg-gray-50"}`}>
            <p className="text-2xl font-bold">{tagStatus.allConfirmed ? "✓" : "—"}</p>
            <p className="text-xs text-muted-foreground">{tagStatus.allConfirmed ? "可进入分析" : "需全部确认"}</p>
          </div>
        </div>
      )}

      {/* Category List */}
      {categories.map((cat: any) => {
        const isExpanded = expandedCats.has(cat.id);
        const isConfirmed = cat.confirmed === 1;
        const isEditingCat = editingCatId === cat.id;

        return (
          <Card key={cat.id} className={`${isConfirmed ? "border-emerald-200 bg-emerald-50/30" : ""}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  {isEditingCat ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        className="border rounded px-2 py-1 text-sm flex-1 max-w-xs"
                        value={editCatName}
                        onChange={e => setEditCatName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") updateCatMutation.mutate({ categoryId: cat.id, categoryName: editCatName }); }}
                      />
                      <Button size="sm" variant="ghost" onClick={() => updateCatMutation.mutate({ categoryId: cat.id, categoryName: editCatName })}><Save className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingCatId(null)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => toggleExpand(cat.id)} className="flex items-center gap-2">
                        <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        <CardTitle className="text-sm">{cat.categoryName}</CardTitle>
                      </button>
                      <Badge variant="secondary" className="text-xs">{cat.items?.length || 0}个标签</Badge>
                      {isConfirmed && <Badge className="bg-emerald-100 text-emerald-700 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />已确认</Badge>}
                      {cat.description && <span className="text-xs text-muted-foreground hidden md:inline">({cat.description})</span>}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!isConfirmed && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.categoryName); }} title="编辑分类名">
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => aiGenCatMutation.mutate({ projectId, categoryId: cat.id })} disabled={aiGenCatMutation.isPending} title="AI生成此分类标签">
                        {aiGenCatMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600" onClick={() => confirmCatMutation.mutate({ categoryId: cat.id })} title="确认锁定">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                      {cat.categoryKey?.startsWith("custom_") && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => { if (confirm("确定删除此分类？")) deleteCatMutation.mutate({ categoryId: cat.id }); }} title="删除分类">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                  {isConfirmed && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-600" onClick={() => unconfirmCatMutation.mutate({ categoryId: cat.id })}>
                      <Unlock className="h-3.5 w-3.5 mr-1" />解锁编辑
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0">
                {cat.items && cat.items.length > 0 ? (
                  <div className="space-y-1">
                    {cat.items.map((item: any) => (
                      <div key={item.id} className="py-1.5 px-2 rounded hover:bg-muted/50 group">
                        <div className="flex items-center gap-2">
                          {editingItemId === item.id ? (
                            <div className="flex items-center gap-2 flex-1">
                              <input className="border rounded px-2 py-1 text-sm flex-1" value={editItemName} onChange={e => setEditItemName(e.target.value)} placeholder="标签名" />
                              <input className="border rounded px-2 py-1 text-sm flex-1" value={editItemValue} onChange={e => setEditItemValue(e.target.value)} placeholder="标签值(可选)" />
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => updateItemMutation.mutate({ itemId: item.id, tagName: editItemName, tagValue: editItemValue })}><Save className="h-3.5 w-3.5" /></Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingItemId(null)}><X className="h-3.5 w-3.5" /></Button>
                            </div>
                          ) : (
                            <>
                              <Badge variant={item.source === "ai" ? "secondary" : "outline"} className="text-xs shrink-0">
                                {item.source === "ai" ? "AI" : "手动"}
                              </Badge>
                              <span className="text-sm font-medium">{item.tagName}</span>
                              {item.tagValue && <span className="text-xs text-muted-foreground">— {item.tagValue}</span>}
                              {!isConfirmed && (
                                <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditingItemId(item.id); setEditItemName(item.tagName); setEditItemValue(item.tagValue || ""); }}>
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => deleteItemMutation.mutate({ itemId: item.id })}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        {/* Show source evidence for AI-generated tags */}
                        {item.sourceEvidence && item.source === "ai" && (
                          <div className="mt-1 ml-12 text-xs text-blue-600/70 bg-blue-50/50 rounded px-2 py-1 border border-blue-100">
                            <span className="font-medium">原文依据：</span>{item.sourceEvidence}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-3 text-center">暂无标签，点击AI生成或手动添加</p>
                )}

                {/* Add tag item */}
                {!isConfirmed && (
                  addingTagCatId === cat.id ? (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                      <input className="border rounded px-2 py-1 text-sm flex-1" value={newTagName} onChange={e => setNewTagName(e.target.value)} placeholder="标签名称" />
                      <input className="border rounded px-2 py-1 text-sm flex-1" value={newTagValue} onChange={e => setNewTagValue(e.target.value)} placeholder="标签值(可选)" />
                      <Button size="sm" onClick={() => { if (newTagName.trim()) addItemMutation.mutate({ categoryId: cat.id, projectId, tagName: newTagName.trim(), tagValue: newTagValue.trim() || undefined }); }} disabled={!newTagName.trim() || addItemMutation.isPending}>
                        {addItemMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "添加"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAddingTagCatId(null); setNewTagName(""); setNewTagValue(""); }}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" className="mt-2 text-xs w-full" onClick={() => setAddingTagCatId(cat.id)}>+ 手动添加标签</Button>
                  )
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {/* Batch Import Dialog */}
      {showImportDialog && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><FileUp className="h-4 w-4" />批量导入标签</CardTitle>
              <Button size="sm" variant="ghost" onClick={resetImportDialog}><X className="h-4 w-4" /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {importStep === "upload" && (
              <div className="space-y-3">
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
                >
                  <FileUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium">点击或拖拽上传文件</p>
                  <p className="text-xs text-muted-foreground mt-1">支持 CSV、TXT 格式（Excel请先另存为CSV）</p>
                  {importFile && <p className="text-xs text-primary mt-2">已选择: {importFile.name}</p>}
                  <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleDownloadTemplate} className="gap-1.5">
                    <FileDown className="h-3.5 w-3.5" />下载导入模板
                  </Button>
                  <span className="text-xs text-muted-foreground">模板包含当前项目的标签分类名称</span>
                </div>
                {parseMutation.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />正在解析文件...
                  </div>
                )}
              </div>
            )}

            {importStep === "preview" && importPreview && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <span className="font-medium">解析结果:</span>
                    <span className="ml-2">共 {importPreview.totalRows} 行数据</span>
                    {importPreview.uniqueCategories.length > 0 && (
                      <span className="ml-2 text-muted-foreground">· {importPreview.uniqueCategories.length} 个分类</span>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    <Eye className="h-3 w-3 mr-1" />预览前{Math.min(50, importPreview.previewRows.length)}行
                  </Badge>
                </div>

                {/* Column Mapping Info */}
                <div className="bg-muted/50 rounded p-2 text-xs space-y-1">
                  <p className="font-medium">列映射检测:</p>
                  <p>分类列: {importPreview.detectedMapping.categoryCol >= 0 ? `第${importPreview.detectedMapping.categoryCol + 1}列 (${importPreview.headers[importPreview.detectedMapping.categoryCol]})` : "未检测到"}</p>
                  <p>标签名列: {importPreview.detectedMapping.nameCol >= 0 ? `第${importPreview.detectedMapping.nameCol + 1}列 (${importPreview.headers[importPreview.detectedMapping.nameCol]})` : "未检测到"}</p>
                  <p>标签值列: {importPreview.detectedMapping.valueCol >= 0 ? `第${importPreview.detectedMapping.valueCol + 1}列 (${importPreview.headers[importPreview.detectedMapping.valueCol]})` : "未检测到(可选)"}</p>
                </div>

                {/* Preview Table */}
                <div className="border rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">分类</th>
                        <th className="text-left px-3 py-2 font-medium">标签名称</th>
                        <th className="text-left px-3 py-2 font-medium">标签值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.previewRows.map((row: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">{row.category || <span className="text-muted-foreground">未分类</span>}</td>
                          <td className="px-3 py-1.5 font-medium">{row.tagName}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{row.tagValue || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => { setImportStep("upload"); setImportPreview(null); setImportFile(null); }}>重新选择</Button>
                  <Button size="sm" onClick={handleImport} disabled={batchImportMutation.isPending} className="gap-1.5">
                    {batchImportMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
                    确认导入 ({importPreview.previewRows.length} 条)
                  </Button>
                </div>
              </div>
            )}

            {importStep === "result" && importResult && (
              <div className="space-y-3">
                <div className="bg-emerald-50 rounded-lg p-4 text-center">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-600" />
                  <p className="text-sm font-medium">导入完成</p>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold">{importResult.total}</p>
                    <p className="text-xs text-muted-foreground">总计</p>
                  </div>
                  <div className="bg-emerald-50 rounded p-2">
                    <p className="text-lg font-bold text-emerald-600">{importResult.added}</p>
                    <p className="text-xs text-muted-foreground">新增</p>
                  </div>
                  <div className="bg-amber-50 rounded p-2">
                    <p className="text-lg font-bold text-amber-600">{importResult.skipped}</p>
                    <p className="text-xs text-muted-foreground">跳过(重复)</p>
                  </div>
                  <div className="bg-blue-50 rounded p-2">
                    <p className="text-lg font-bold text-blue-600">{importResult.newCategories}</p>
                    <p className="text-xs text-muted-foreground">新建分类</p>
                  </div>
                </div>
                <Button size="sm" className="w-full" onClick={resetImportDialog}>完成</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Custom Category */}
      {showAddCat ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <input className="border rounded px-2 py-1 text-sm flex-1" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="新分类名称" />
              <Button size="sm" onClick={() => { if (newCatName.trim()) addCatMutation.mutate({ projectId, categoryName: newCatName.trim() }); }} disabled={!newCatName.trim() || addCatMutation.isPending}>
                {addCatMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "添加"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowAddCat(false); setNewCatName(""); }}><X className="h-3.5 w-3.5" /></Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setShowAddCat(true)}>+ 添加自定义分类</Button>
      )}
    </div>
  );
}

function LockedPhaseCard() {
  return (
    <Card className="border-dashed border-2">
      <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Lock className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm font-medium">此模块属于"项目落地"阶段</p>
        <p className="text-xs mt-1">请先在"评分立项"页面完成立项审批后解锁</p>
      </CardContent>
    </Card>
  );
}

/* ─── ProfileSection removed - replaced by ProfileEditor.tsx ─── */
/* Old ProfileSection was here (lines 993-1240), now using ProfileEditor component */



/* ─── ManualViewer removed - replaced by ManualEditor.tsx ───── */
/* ─── TestReportViewer removed - replaced by TestReportEditor.tsx ─── */


/* ─── Profit Calculator ─────────────────────────────────── */
/* ─── Report Download ───────────────────────────────────── */
function ReportDownload({ projectId }: { projectId: number }) {
  const { data: reportData, isLoading } = trpc.devBom.getProjectReportData.useQuery({ projectId });

  const handleDownloadPdf = () => {
    if (!reportData) return;

    // Generate comprehensive HTML report
    const html = generateProjectReportHtml(reportData);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-report-${reportData.project?.name || projectId}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("项目报告已下载（HTML格式，可用浏览器打印为PDF）");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Download className="h-4 w-4" />报告下载</h3>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <Download className="h-12 w-12 mx-auto text-primary opacity-60" />
            <div>
              <p className="font-medium">一键生成完整项目报告</p>
              <p className="text-sm text-muted-foreground mt-1">
                汇总所有已确认的分析报告、产品画像、BOM表，生成完整的项目评估报告
              </p>
            </div>

            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin mx-auto" />
            ) : reportData ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-left">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">竞品数据</p>
                    <p className="font-bold">{reportData.products?.length || 0} 条</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">评分</p>
                    <p className="font-bold">{reportData.score?.totalScore || "--"} 分</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">BOM部件</p>
                    <p className="font-bold">{reportData.bomItems?.length || 0} 项</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">说明书</p>
                    <p className="font-bold">{reportData.manual?.contentStatus === "confirmed" ? "已确认" : "未完成"}</p>
                  </div>
                </div>
                <Button className="gap-2" onClick={handleDownloadPdf}>
                  <Download className="h-4 w-4" />
                  下载完整项目报告
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无报告数据</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function generateProjectReportHtml(data: any): string {
  const p = data.project;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${p?.name || "项目报告"} - 完整评估报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #333; line-height: 1.6; padding: 40px; max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 2em; margin-bottom: 10px; color: #1a1a2e; }
    h2 { font-size: 1.4em; margin: 30px 0 15px; padding-bottom: 8px; border-bottom: 2px solid #e0e0e0; color: #1a1a2e; }
    h3 { font-size: 1.1em; margin: 15px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 8px 12px; text-align: left; border: 1px solid #ddd; font-size: 0.9em; }
    th { background: #f5f5f5; font-weight: 600; }
    .meta { color: #666; font-size: 0.9em; margin-bottom: 30px; }
    .score-box { text-align: center; padding: 20px; background: #f0f4ff; border-radius: 8px; margin: 15px 0; }
    .score-box .score { font-size: 3em; font-weight: bold; color: #2563eb; }
    .section { margin-bottom: 30px; }
    @media print { body { padding: 20px; } h2 { page-break-before: auto; } }
  </style>
</head>
<body>
  <h1>${p?.name || "项目报告"}</h1>
  <div class="meta">
    <p>目标市场: ${p?.targetMarket || "US"} | 平台: ${p?.platform || "Amazon"} | 生成时间: ${new Date().toLocaleDateString()}</p>
  </div>

  ${data.score ? `
  <h2>项目评分</h2>
  <div class="score-box">
    <div class="score">${data.score.totalScore}</div>
    <p>综合评分 / 100</p>
  </div>` : ""}

  ${data.products?.length ? `
  <h2>竞品数据 (${data.products.length}条)</h2>
  <table>
    <thead><tr><th>ASIN</th><th>标题</th><th>价格</th><th>评分</th><th>品牌</th></tr></thead>
    <tbody>${data.products.slice(0, 20).map((p: any) => `<tr><td>${p.asin || ""}</td><td>${(p.title || "").substring(0, 60)}</td><td>$${p.price || ""}</td><td>${p.rating || ""}★</td><td>${p.brand || ""}</td></tr>`).join("")}</tbody>
  </table>` : ""}

  ${data.profile ? `
  <h2>产品画像</h2>
  <div class="section">
    ${data.profile.appearanceColors ? `<h3>外观设计</h3><p>${data.profile.appearanceColors}</p>` : ""}
    ${data.profile.mainFunctions ? `<h3>功能提升</h3><p>${data.profile.mainFunctions}</p>` : ""}
    ${data.profile.userPersona ? `<h3>用户画像</h3><p>${data.profile.userPersona}</p>` : ""}
    ${data.profile.usageScenarios ? `<h3>使用场景</h3><p>${data.profile.usageScenarios}</p>` : ""}
    ${data.profile.productMap ? `<h3>产品地图</h3><p>${data.profile.productMap}</p>` : ""}
  </div>` : ""}

  ${data.bomItems?.length ? `
  <h2>BOM物料清单 (${data.bomItems.length}项)</h2>
  <table>
    <thead><tr><th>部件</th><th>材质</th><th>工艺</th><th>数量</th><th>单价</th></tr></thead>
    <tbody>${data.bomItems.map((b: any) => `<tr><td>${b.partName}</td><td>${b.material || "-"}</td><td>${b.process || "-"}</td><td>${b.quantity}</td><td>¥${b.unitPrice || "-"}</td></tr>`).join("")}</tbody>
  </table>` : ""}

  <div style="text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #eee;color:#999;font-size:0.85em;">
    <p>本报告由亚马逊产品开发AI工具自动生成</p>
  </div>
</body>
</html>`;
}
