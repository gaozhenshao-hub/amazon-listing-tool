import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  FileText,
  Loader2,
  Package,
  Star,
  Target,
  Users,
  Wrench,
  ClipboardCheck,
  Brain,
  RefreshCw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

const statusLabel: Record<string, { text: string; color: string }> = {
  draft: { text: "草稿", color: "bg-gray-500/10 text-gray-600" },
  data_collection: { text: "数据采集", color: "bg-blue-500/10 text-blue-600" },
  analyzing: { text: "分析中", color: "bg-amber-500/10 text-amber-600" },
  scoring: { text: "评分中", color: "bg-purple-500/10 text-purple-600" },
  completed: { text: "已完成", color: "bg-emerald-500/10 text-emerald-600" },
  archived: { text: "已归档", color: "bg-gray-500/10 text-gray-500" },
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

  const profileMutation = trpc.devProfile.generateSuggestions.useMutation({
    onSuccess: () => { toast.success("产品画像生成完成"); utils.devProfile.get.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });
  const scoreMutation = trpc.devScoring.generate.useMutation({
    onSuccess: () => { toast.success("项目评分完成"); utils.devScoring.getScore.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`评分失败: ${err.message}`),
  });
  const manualMutation = trpc.devManual.generateManual.useMutation({
    onSuccess: () => { toast.success("说明书生成完成"); utils.devManual.getManual.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });
  const testReportMutation = trpc.devManual.generateTestReport.useMutation({
    onSuccess: () => { toast.success("测试报告生成完成"); utils.devManual.getTestReport.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });
  const bomSuggestMutation = trpc.devBom.aiSuggest.useMutation({
    onSuccess: () => { toast.success("BOM建议生成完成"); utils.devBom.list.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

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

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/dev/projects")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{project.name}</h1>
              <Badge variant="secondary" className={`text-xs ${st.color}`}>{st.text}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {project.targetMarket} · {project.platform || "Amazon"} · 创建于 {new Date(project.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-7 w-full">
          <TabsTrigger value="overview" className="text-xs gap-1"><Target className="h-3.5 w-3.5" />概览</TabsTrigger>
          <TabsTrigger value="profile" className="text-xs gap-1"><Users className="h-3.5 w-3.5" />产品画像</TabsTrigger>
          <TabsTrigger value="scoring" className="text-xs gap-1"><Star className="h-3.5 w-3.5" />评分</TabsTrigger>
          <TabsTrigger value="bom" className="text-xs gap-1"><Package className="h-3.5 w-3.5" />BOM</TabsTrigger>
          <TabsTrigger value="manual" className="text-xs gap-1"><FileText className="h-3.5 w-3.5" />说明书</TabsTrigger>
          <TabsTrigger value="test" className="text-xs gap-1"><ClipboardCheck className="h-3.5 w-3.5" />测试报告</TabsTrigger>
          <TabsTrigger value="analysis" className="text-xs gap-1"><BarChart3 className="h-3.5 w-3.5" />分析报告</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">竞品数量</p><p className="text-2xl font-bold mt-1">{products?.length ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">BOM部件</p><p className="text-2xl font-bold mt-1">{bom?.length ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-sm text-muted-foreground">综合评分</p><p className="text-2xl font-bold mt-1">{score?.totalScore ?? "--"}</p></CardContent></Card>
          </div>
          {project.description && (
            <Card><CardHeader><CardTitle className="text-sm">项目描述</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{project.description}</p></CardContent></Card>
          )}
          {project.keywords && (
            <Card><CardHeader><CardTitle className="text-sm">核心关键词</CardTitle></CardHeader><CardContent>
              <div className="flex flex-wrap gap-2">
                {project.keywords.split(/[,，\n]/).filter(Boolean).map((kw, i) => <Badge key={i} variant="secondary">{kw.trim()}</Badge>)}
              </div>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* Profile */}
        <TabsContent value="profile" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><Brain className="h-4 w-4" />AI产品画像</h3>
            <Button size="sm" onClick={() => profileMutation.mutate({ projectId, section: "appearance" })} disabled={profileMutation.isPending} className="gap-2">
              {profileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {profile ? "重新生成" : "AI生成画像"}
            </Button>
          </div>
          {profile ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { label: "目标用户", value: profile.targetUsers },
                { label: "使用场景", value: profile.usageScenarios },
                { label: "核心功能", value: profile.mainFunctions },
                { label: "外观配色", value: profile.appearanceColors },
                { label: "包装方案", value: profile.packagingPlan },
                { label: "差异化卖点", value: profile.differentiationPoints },
                { label: "价格策略", value: profile.pricingStrategy },
                { label: "风险提示", value: profile.riskWarnings },
              ].map((item, i) => (
                <Card key={i}><CardHeader className="pb-2"><CardTitle className="text-sm">{item.label}</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.value || "暂无数据"}</p></CardContent></Card>
              ))}
            </div>
          ) : (
            <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Brain className="h-10 w-10 mb-3 opacity-30" /><p className="text-sm">点击"AI生成画像"开始分析</p>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* Scoring */}
        <TabsContent value="scoring" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><Star className="h-4 w-4" />AI立项评分</h3>
            <Button size="sm" onClick={() => scoreMutation.mutate({ projectId })} disabled={scoreMutation.isPending} className="gap-2">
              {scoreMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {score ? "重新评分" : "AI评分"}
            </Button>
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
              {score.aiReasoning && (
                <Card><CardHeader><CardTitle className="text-sm">AI分析</CardTitle></CardHeader>
                  <CardContent><Streamdown>{score.aiReasoning}</Streamdown></CardContent></Card>
              )}
            </div>
          ) : (
            <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Star className="h-10 w-10 mb-3 opacity-30" /><p className="text-sm">点击"AI评分"开始立项评估</p>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* BOM */}
        <TabsContent value="bom" className="space-y-4">
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
        </TabsContent>

        {/* Manual */}
        <TabsContent value="manual" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" />产品说明书</h3>
            <Button size="sm" onClick={() => manualMutation.mutate({ projectId })} disabled={manualMutation.isPending} className="gap-2">
              {manualMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {manual ? "重新生成" : "AI生成说明书"}
            </Button>
          </div>
          {manual?.contentSections ? (
            <Card><CardContent className="p-6"><Streamdown>{manual.contentSections}</Streamdown></CardContent></Card>
          ) : (
            <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="h-10 w-10 mb-3 opacity-30" /><p className="text-sm">点击"AI生成说明书"开始</p>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* Test Report */}
        <TabsContent value="test" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><ClipboardCheck className="h-4 w-4" />测试报告</h3>
            <Button size="sm" onClick={() => testReportMutation.mutate({ projectId })} disabled={testReportMutation.isPending} className="gap-2">
              {testReportMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {testReport ? "重新生成" : "AI生成测试报告"}
            </Button>
          </div>
          {testReport?.reportContent ? (
            <Card><CardContent className="p-6"><Streamdown>{testReport.reportContent}</Streamdown></CardContent></Card>
          ) : (
            <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ClipboardCheck className="h-10 w-10 mb-3 opacity-30" /><p className="text-sm">点击"AI生成测试报告"开始</p>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* Analysis Report */}
        <TabsContent value="analysis" className="space-y-4">
          <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <BarChart3 className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">分析报告功能即将上线</p>
            <p className="text-xs mt-1">包含市场分析、竞品分析、评论分析等AI报告</p>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
