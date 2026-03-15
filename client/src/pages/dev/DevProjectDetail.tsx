import { useState, useMemo } from "react";
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
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import DevDataUpload from "./DevDataUpload";

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
  const { data: bom } = trpc.devBom.list.useQuery({ projectId }) as any;
  const { data: manual } = trpc.devManual.getManual.useQuery({ projectId }) as any;
  const { data: testReport } = trpc.devManual.getTestReport.useQuery({ projectId }) as any;

  const currentPhase = (project as any)?.phase || "market_analysis";
  const isPhase2 = currentPhase === "project_execution";

  const approveMutation = trpc.devScoring.approveProject.useMutation({
    onSuccess: () => {
      toast.success("项目已立项！进入落地阶段");
      utils.devProject.getById.invalidate({ id: projectId });
    },
    onError: (err: any) => toast.error(`立项失败: ${err.message}`),
  });

  const revokeMutation = trpc.devScoring.revokeApproval.useMutation({
    onSuccess: () => {
      toast.success("已撤销立项，回到市场分析阶段");
      utils.devProject.getById.invalidate({ id: projectId });
    },
    onError: (err: any) => toast.error(`撤销失败: ${err.message}`),
  });

  const scoreMutation = trpc.devScoring.generate.useMutation({
    onSuccess: () => { toast.success("项目评分完成"); utils.devScoring.getScore.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`评分失败: ${err.message}`),
  });
  const bomSuggestMutation = trpc.devBom.aiSuggest.useMutation({
    onSuccess: () => { toast.success("BOM建议生成完成"); utils.devBom.list.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });
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
        <TabsList className={`grid w-full ${isPhase2 && ["profile","bom","manual","test","profit","download"].includes(activeTab) ? "grid-cols-6" : "grid-cols-5"}`}>
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
            <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">BOM部件</p><p className="text-2xl font-bold mt-1">{bom?.length ?? 0}</p></CardContent></Card>
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

        {/* Analysis Report */}
        <TabsContent value="analysis" className="space-y-4">
          <Card><CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="h-10 w-10 mb-3 text-primary opacity-60" />
            <p className="text-sm font-medium">市场分析工作台</p>
            <p className="text-xs text-muted-foreground mt-1">7阶段数据驱动分析：属性标注 → 市场大盘 → 属性交叉 → 价格段 → 品牌竞争 → 评论深度 → 综合决策</p>
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
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><Star className="h-4 w-4" />AI立项评分</h3>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => scoreMutation.mutate({ projectId })} disabled={scoreMutation.isPending} className="gap-2">
                {scoreMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {score ? "重新评分" : "AI评分"}
              </Button>
            </div>
          </div>

          {score ? (
            <div className="space-y-4">
              <Card><CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">综合评分</p>
                <p className="text-5xl font-bold mt-2 text-primary">{score.totalScore}</p>
                <p className="text-xs text-muted-foreground mt-1">/ 100</p>
              </CardContent></Card>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: "市场容量", value: score.marketCapacity },
                  { label: "竞争强度", value: score.competitiveness },
                  { label: "利润空间", value: score.profit },
                  { label: "差异化", value: score.differentiation },
                  { label: "入场机会", value: score.entryOpportunity },
                  { label: "风险", value: score.risk },
                ].map((dim, i) => (
                  <Card key={i}><CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">{dim.label}</p>
                    <p className="text-xl font-bold mt-1">{dim.value ?? "--"}</p>
                  </CardContent></Card>
                ))}
              </div>
              {score?.aiReasoning && (
                <Card><CardHeader><CardTitle className="text-sm">AI分析</CardTitle></CardHeader>
                  <CardContent><Streamdown>{score.aiReasoning}</Streamdown></CardContent></Card>
              )}

              {/* Approval Action */}
              <Card className={`border-2 ${isPhase2 ? "border-emerald-300 bg-emerald-50/50" : "border-blue-300 bg-blue-50/50"}`}>
                <CardContent className="p-6">
                  {isPhase2 ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                        <div>
                          <p className="font-semibold text-emerald-800">项目已立项</p>
                          <p className="text-sm text-emerald-600">
                            评分 {(project as any).approvedScore ?? score.totalScore} 分 · 
                            立项时间 {(project as any).approvedAt ? new Date((project as any).approvedAt).toLocaleDateString() : ""}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => {
                          if (confirm("确定撤销立项？项目将回到市场分析阶段。")) {
                            revokeMutation.mutate({ projectId });
                          }
                        }}
                        disabled={revokeMutation.isPending}
                      >
                        {revokeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        撤销立项
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <AlertCircle className="h-8 w-8 text-blue-600" />
                        <div>
                          <p className="font-semibold text-blue-800">确认立项</p>
                          <p className="text-sm text-blue-600">
                            当前评分 {score.totalScore} 分 · 立项后将解锁"项目落地"阶段（产品画像、BOM、说明书、测试报告、利润计算）
                          </p>
                        </div>
                      </div>
                      <Button
                        className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                        onClick={() => approveMutation.mutate({ projectId })}
                        disabled={approveMutation.isPending}
                      >
                        {approveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        确认立项
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Star className="h-10 w-10 mb-3 opacity-30" /><p className="text-sm">点击"AI评分"开始立项评估</p>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ─── Phase 2: Project Execution ───────────────────── */}
        {/* ═══════════════════════════════════════════════════════ */}

        {/* Product Profile (8 sub-modules) */}
        <TabsContent value="profile" className="space-y-4">
          {!isPhase2 ? (
            <LockedPhaseCard />
          ) : (
            <ProfileSection projectId={projectId} profile={profile} />
          )}
        </TabsContent>

        {/* BOM */}
        <TabsContent value="bom" className="space-y-4">
          {!isPhase2 ? (
            <LockedPhaseCard />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2"><Package className="h-4 w-4" />BOM物料清单</h3>
                <Button size="sm" onClick={() => bomSuggestMutation.mutate({ projectId })} disabled={bomSuggestMutation.isPending} className="gap-2">
                  {bomSuggestMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                  AI建议BOM
                </Button>
              </div>
              {bom && bom.length > 0 ? (
                <Card><CardContent className="p-0"><div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">部件名称</th>
                      <th className="text-left p-3 font-medium">材质</th>
                      <th className="text-left p-3 font-medium">工艺</th>
                      <th className="text-right p-3 font-medium">数量</th>
                      <th className="text-right p-3 font-medium">单价</th>
                      <th className="text-left p-3 font-medium">备注</th>
                    </tr></thead>
                    <tbody>{bom.map((item: any) => (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="p-3 font-medium">{item.partName}</td>
                        <td className="p-3 text-muted-foreground">{item.material || "-"}</td>
                        <td className="p-3 text-muted-foreground">{item.process || "-"}</td>
                        <td className="p-3 text-right">{item.quantity}</td>
                        <td className="p-3 text-right">{item.unitPrice ? `¥${item.unitPrice}` : "-"}</td>
                        <td className="p-3 text-muted-foreground">{item.remark || "-"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div></CardContent></Card>
              ) : (
                <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Package className="h-10 w-10 mb-3 opacity-30" /><p className="text-sm">暂无BOM数据，点击"AI建议BOM"自动生成</p>
                </CardContent></Card>
              )}
            </>
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
              {manual?.contentSections ? (
                <ManualViewer manual={manual} projectId={projectId} />
              ) : (
                <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">三步流程：AI生成9章节 → 编辑确认+上传素材 → 生成双语HTML/PDF</p>
                  <p className="text-xs text-muted-foreground mt-1">点击"AI生成说明书"开始</p>
                </CardContent></Card>
              )}
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
                <TestReportViewer testReport={testReport} projectId={projectId} />
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
            <ProfitCalculator projectId={projectId} bom={bom} />
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

/* ─── Profile Section (8 Sub-modules) ───────────────────── */
function ProfileSection({ projectId, profile }: { projectId: number; profile: any }) {
  const [activeSection, setActiveSection] = useState("appearance");
  const utils = trpc.useUtils();

  const generateMutation = trpc.devProfile.generateSuggestions.useMutation({
    onSuccess: () => {
      toast.success("AI建议生成完成");
      utils.devProfile.get.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const confirmMutation = trpc.devProfile.confirmSection.useMutation({
    onSuccess: () => {
      toast.success("已确认并锁定");
      utils.devProfile.get.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`确认失败: ${err.message}`),
  });

  const sections = [
    { key: "appearance", label: "外观设计", icon: "🎨", dataField: "appearanceColors", aiField: "appearanceAiSuggestion", confirmedField: "appearanceConfirmed" },
    { key: "function", label: "功能提升", icon: "⚡", dataField: "mainFunctions", aiField: "functionsAiSuggestion", confirmedField: "functionsConfirmed" },
    { key: "cost", label: "产品成本", icon: "💰", dataField: "costBreakdown", aiField: "costAiSuggestion", confirmedField: "costConfirmed" },
    { key: "package", label: "包装设计", icon: "📦", dataField: "packageDimensions", aiField: "packageAiSuggestion", confirmedField: "packageConfirmed" },
    { key: "packageDesign", label: "包装外观", icon: "🎁", dataField: "packageDesign", aiField: "packageDesignAiSuggestion", confirmedField: "packageDesignConfirmed" },
    { key: "userPersona", label: "用户画像", icon: "👤", dataField: "userPersona", aiField: "userPersonaAiSuggestion", confirmedField: "userPersonaConfirmed" },
    { key: "usageScenarios", label: "使用场景", icon: "🏠", dataField: "usageScenarios", aiField: "usageScenariosAiSuggestion", confirmedField: "usageScenariosConfirmed" },
    { key: "productMap", label: "产品地图", icon: "🗺️", dataField: "productMap", aiField: "productMapAiSuggestion", confirmedField: "productMapConfirmed" },
  ];

  const currentSection = sections.find(s => s.key === activeSection) || sections[0];
  const isConfirmed = profile?.[currentSection.confirmedField] === 1;
  const aiSuggestion = profile?.[currentSection.aiField];
  const userData = profile?.[currentSection.dataField];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Brain className="h-4 w-4" />产品画像 · 8子模块</h3>
      </div>

      {/* Sub-module Navigation */}
      <div className="flex flex-wrap gap-2">
        {sections.map(s => {
          const confirmed = profile?.[s.confirmedField] === 1;
          return (
            <Button
              key={s.key}
              variant={activeSection === s.key ? "default" : "outline"}
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setActiveSection(s.key)}
            >
              <span>{s.icon}</span>
              {s.label}
              {confirmed && <CheckCircle2 className="h-3 w-3 text-emerald-500 ml-0.5" />}
            </Button>
          );
        })}
      </div>

      {/* Current Section Content */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-lg">{currentSection.icon}</span>
              {currentSection.label}
              {isConfirmed && <Badge className="bg-emerald-100 text-emerald-700 text-xs">已确认</Badge>}
            </CardTitle>
            <div className="flex gap-2">
              {!isConfirmed && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => generateMutation.mutate({ projectId, section: activeSection as any })}
                    disabled={generateMutation.isPending}
                    className="gap-1 text-xs"
                  >
                    {generateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                    AI生成建议
                  </Button>
                  {(aiSuggestion || userData) && (
                    <Button
                      size="sm"
                      className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => {
                        const data = userData || aiSuggestion || "{}";
                        confirmMutation.mutate({ projectId, section: activeSection as any, data: typeof data === "string" ? data : JSON.stringify(data) });
                      }}
                      disabled={confirmMutation.isPending}
                    >
                      {confirmMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      确认锁定
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {aiSuggestion || userData ? (
            <div className="space-y-3">
              {aiSuggestion && (
                <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-100">
                  <p className="text-xs font-medium text-blue-700 mb-2">AI建议</p>
                  <pre className="text-xs whitespace-pre-wrap text-blue-900 max-h-64 overflow-y-auto">
                    {typeof aiSuggestion === "string" ? aiSuggestion : JSON.stringify(JSON.parse(aiSuggestion), null, 2)}
                  </pre>
                </div>
              )}
              {userData && (
                <div className="p-3 rounded-lg bg-gray-50 border">
                  <p className="text-xs font-medium text-gray-700 mb-2">当前数据</p>
                  <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {typeof userData === "string" ? userData : JSON.stringify(userData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Brain className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">点击"AI生成建议"获取{currentSection.label}方案</p>
              <p className="text-xs mt-1">AI将基于竞品数据和市场分析给出专业建议</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Manual Viewer ─────────────────────────────────────── */
function ManualViewer({ manual, projectId }: { manual: any; projectId: number }) {
  let chapters: any[] = [];
  try {
    chapters = JSON.parse(manual.contentSections);
  } catch {}

  const htmlMutation = trpc.devManual.generateHtml.useMutation({
    onSuccess: (data: any) => {
      toast.success("HTML说明书生成完成");
      if (data.htmlEnUrl) window.open(data.htmlEnUrl, "_blank");
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const pdfMutation = trpc.devManual.exportPdf.useMutation({
    onSuccess: (data: any) => {
      toast.success("PDF导出完成");
      if (data.htmlUrl) window.open(data.htmlUrl, "_blank");
    },
    onError: (err: any) => toast.error(`导出失败: ${err.message}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={() => htmlMutation.mutate({ projectId })} disabled={htmlMutation.isPending} className="gap-1 text-xs">
          {htmlMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
          生成HTML(EN+ES)
        </Button>
        <Button size="sm" variant="outline" onClick={() => pdfMutation.mutate({ projectId, language: "en" })} disabled={pdfMutation.isPending} className="gap-1 text-xs">
          <Download className="h-3 w-3" />PDF(EN)
        </Button>
        <Button size="sm" variant="outline" onClick={() => pdfMutation.mutate({ projectId, language: "es" })} disabled={pdfMutation.isPending} className="gap-1 text-xs">
          <Download className="h-3 w-3" />PDF(ES)
        </Button>
      </div>

      {chapters.length > 0 ? (
        <div className="space-y-3">
          {chapters.map((ch: any, i: number) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">Ch.{i + 1}</span>
                  {ch.titleEn || ch.key}
                  {ch.titleEs && <span className="text-xs text-muted-foreground">/ {ch.titleEs}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-blue-600 mb-1">English</p>
                    <p className="text-sm whitespace-pre-wrap">{ch.contentEn || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-orange-600 mb-1">Español</p>
                    <p className="text-sm whitespace-pre-wrap">{ch.contentEs || "—"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card><CardContent className="p-6"><Streamdown>{String(manual.contentSections || "")}</Streamdown></CardContent></Card>
      )}
    </div>
  );
}

/* ─── Test Report Viewer ────────────────────────────────── */
function TestReportViewer({ testReport, projectId }: { testReport: any; projectId: number }) {
  let items: any[] = [];
  try {
    items = JSON.parse(testReport.testItems);
  } catch {}

  const updateMutation = trpc.devManual.updateTestItemStatus.useMutation({
    onSuccess: () => toast.success("状态已更新"),
    onError: (err: any) => toast.error(`更新失败: ${err.message}`),
  });

  const categories = ["installation", "usage", "drop", "shipping", "function", "durability", "safety", "packaging"];
  const categoryLabels: Record<string, string> = {
    installation: "安装测试", usage: "使用测试", drop: "跌落测试", shipping: "运输测试",
    function: "功能测试", durability: "耐久性测试", safety: "安全测试", packaging: "包装测试",
  };

  const statusColors: Record<string, string> = {
    pass: "bg-emerald-100 text-emerald-700",
    fail: "bg-red-100 text-red-700",
    pending: "bg-gray-100 text-gray-600",
  };

  const handleExportExcel = () => {
    // Client-side CSV export as fallback
    const headers = ["Category", "Test Name (EN)", "测试名称", "Status", "Pass Standard", "Actual Result", "Notes"];
    const rows = items.map((item: any) => [
      item.category, item.nameEn, item.nameCn, item.testStatus, item.passStandard, item.actualResult || "", item.notes || "",
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.map((c: string) => `"${(c || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `test-report-${projectId}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("测试报告已导出");
  };

  const stats = {
    total: items.length,
    pass: items.filter((i: any) => i.testStatus === "pass").length,
    fail: items.filter((i: any) => i.testStatus === "fail").length,
    pending: items.filter((i: any) => i.testStatus === "pending").length,
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">总测试项</p><p className="text-xl font-bold">{stats.total}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-emerald-600">通过</p><p className="text-xl font-bold text-emerald-600">{stats.pass}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-red-600">未通过</p><p className="text-xl font-bold text-red-600">{stats.fail}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-gray-500">待测</p><p className="text-xl font-bold text-gray-500">{stats.pending}</p></CardContent></Card>
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={handleExportExcel} className="gap-1 text-xs">
          <Download className="h-3 w-3" />导出Excel
        </Button>
      </div>

      {/* Test Items by Category */}
      {categories.map(cat => {
        const catItems = items.filter((i: any) => i.category === cat);
        if (catItems.length === 0) return null;
        return (
          <Card key={cat}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{categoryLabels[cat] || cat} ({catItems.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="text-left p-2 pl-4 text-xs font-medium">测试项</th>
                    <th className="text-left p-2 text-xs font-medium">通过标准</th>
                    <th className="text-center p-2 text-xs font-medium">状态</th>
                    <th className="text-left p-2 text-xs font-medium">实际结果</th>
                  </tr></thead>
                  <tbody>
                    {catItems.map((item: any, idx: number) => {
                      const globalIdx = items.indexOf(item);
                      return (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="p-2 pl-4">
                            <p className="font-medium text-xs">{item.nameEn}</p>
                            <p className="text-xs text-muted-foreground">{item.nameCn}</p>
                          </td>
                          <td className="p-2 text-xs text-muted-foreground max-w-48">{item.passStandard || "-"}</td>
                          <td className="p-2 text-center">
                            <select
                              className={`text-xs px-2 py-1 rounded-full border-0 cursor-pointer ${statusColors[item.testStatus] || statusColors.pending}`}
                              value={item.testStatus || "pending"}
                              onChange={(e) => {
                                updateMutation.mutate({
                                  projectId,
                                  itemIndex: globalIdx,
                                  testStatus: e.target.value as any,
                                });
                              }}
                            >
                              <option value="pending">待测</option>
                              <option value="pass">通过</option>
                              <option value="fail">未通过</option>
                            </select>
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">{item.actualResult || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── Profit Calculator ─────────────────────────────────── */
function ProfitCalculator({ projectId, bom }: { projectId: number; bom: any[] }) {
  const [params, setParams] = useState({
    sellingPrice: 29.99,
    productCost: 0,
    shippingCost: 3.5,
    fbaFee: 5.0,
    referralFeeRate: 15,
    advertisingCost: 3.0,
    otherCosts: 1.0,
    totalMoldCost: 0,
  });

  const { data: bomCostSummary } = trpc.devBom.getBomCostSummary.useQuery({ projectId });

  // Auto-fill from BOM
  useMemo(() => {
    if (bomCostSummary) {
      setParams(prev => ({
        ...prev,
        productCost: bomCostSummary.totalMaterialCost || prev.productCost,
        totalMoldCost: bomCostSummary.totalMoldCost || prev.totalMoldCost,
      }));
    }
  }, [bomCostSummary]);

  const batchMutation = trpc.devBom.batchSimulate.useMutation();

  const handleSimulate = () => {
    batchMutation.mutate({
      projectId,
      ...params,
      quantities: [100, 500, 1000, 5000],
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4" />利润计算器</h3>
        {bomCostSummary && (
          <Badge variant="outline" className="text-xs">
            BOM成本自动填入: ¥{bomCostSummary.totalMaterialCost} ({bomCostSummary.bomItemCount}项)
          </Badge>
        )}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "售价($)", key: "sellingPrice" },
              { label: "产品成本(¥)", key: "productCost" },
              { label: "头程运费($)", key: "shippingCost" },
              { label: "FBA费用($)", key: "fbaFee" },
              { label: "佣金比例(%)", key: "referralFeeRate" },
              { label: "广告费($)", key: "advertisingCost" },
              { label: "其他费用($)", key: "otherCosts" },
              { label: "模具总费(¥)", key: "totalMoldCost" },
            ].map(field => (
              <div key={field.key}>
                <label className="text-xs text-muted-foreground">{field.label}</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md bg-background"
                  value={(params as any)[field.key]}
                  onChange={(e) => setParams(prev => ({ ...prev, [field.key]: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            ))}
          </div>
          <Button className="mt-4 w-full gap-2" onClick={handleSimulate} disabled={batchMutation.isPending}>
            {batchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            批量模拟 (100/500/1000/5000件)
          </Button>
        </CardContent>
      </Card>

      {batchMutation.data && (
        <Card>
          <CardHeader><CardTitle className="text-sm">批量模拟结果</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="text-right p-3 font-medium">订单量</th>
                  <th className="text-right p-3 font-medium">模具分摊/件</th>
                  <th className="text-right p-3 font-medium">单件成本</th>
                  <th className="text-right p-3 font-medium">单件利润</th>
                  <th className="text-right p-3 font-medium">利润率</th>
                  <th className="text-right p-3 font-medium">ROI</th>
                  <th className="text-right p-3 font-medium">总利润</th>
                </tr></thead>
                <tbody>
                  {batchMutation.data.simulations.map((sim: any) => (
                    <tr key={sim.quantity} className="border-b last:border-0">
                      <td className="p-3 text-right font-medium">{sim.quantity.toLocaleString()}</td>
                      <td className="p-3 text-right">¥{sim.moldPerUnit}</td>
                      <td className="p-3 text-right">${sim.totalUnitCost}</td>
                      <td className={`p-3 text-right font-medium ${sim.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>${sim.profit}</td>
                      <td className={`p-3 text-right ${sim.profitMargin >= 0 ? "text-emerald-600" : "text-red-600"}`}>{sim.profitMargin}%</td>
                      <td className="p-3 text-right">{sim.roi}%</td>
                      <td className={`p-3 text-right font-bold ${sim.totalProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>${sim.totalProfit.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
