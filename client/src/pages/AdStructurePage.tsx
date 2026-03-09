import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Loader2, Sparkles, Target, Crosshair, Globe, Shield, Zap, Bot,
  DollarSign, TrendingUp, AlertTriangle, ChevronDown, ChevronUp,
  Trash2, RefreshCw, BarChart3, PieChart, Clock, Info, Copy, Check
} from "lucide-react";

// Ad group type labels and colors
const AD_GROUP_LABELS: Record<string, { label: string; icon: any; color: string; desc: string }> = {
  core_keywords: { label: "核心大词组", icon: Target, color: "bg-red-100 text-red-800 border-red-200", desc: "高流量核心主词，竞争激烈但转化高" },
  precise_longtail: { label: "精准长尾组", icon: Crosshair, color: "bg-green-100 text-green-800 border-green-200", desc: "低竞争高相关长尾词，新品期主力" },
  scene_intent: { label: "场景意图组", icon: Globe, color: "bg-blue-100 text-blue-800 border-blue-200", desc: "基于使用场景和购买意图的关键词" },
  competitor_targeting: { label: "竞品ASIN定投组", icon: Zap, color: "bg-orange-100 text-orange-800 border-orange-200", desc: "竞品ASIN和竞品品牌词" },
  brand_defense: { label: "品牌防御组", icon: Shield, color: "bg-purple-100 text-purple-800 border-purple-200", desc: "自有品牌词+品牌+品类组合" },
  auto_campaign: { label: "自动广告组", icon: Bot, color: "bg-gray-100 text-gray-800 border-gray-200", desc: "自动广告的优化建议" },
};

const MATCH_TYPE_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  exact: { label: "精准匹配", color: "bg-red-50 text-red-700 border-red-200", desc: "完全匹配，CPC最高但转化最好" },
  phrase: { label: "词组匹配", color: "bg-amber-50 text-amber-700 border-amber-200", desc: "包含词组，平衡流量和精准度" },
  broad: { label: "广泛匹配", color: "bg-blue-50 text-blue-700 border-blue-200", desc: "最大流量覆盖，用于拓词和测试" },
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-green-100 text-green-700",
};

export default function AdStructurePage() {
  const { user } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("matrix");
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const projectsQuery = trpc.project.list.useQuery();
  const projects = projectsQuery.data || [];

  const projectId = selectedProjectId ? parseInt(selectedProjectId) : null;

  const structuresQuery = trpc.adStructure.getByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const generateMutation = trpc.adStructure.generate.useMutation({
    onSuccess: () => {
      structuresQuery.refetch();
      toast.success("广告架构生成完成！");
    },
    onError: (err) => {
      toast.error(`生成失败: ${err.message}`);
    },
  });

  const deleteMutation = trpc.adStructure.delete.useMutation({
    onSuccess: () => {
      structuresQuery.refetch();
      toast.success("已删除");
    },
  });

  const structures = structuresQuery.data || [];
  const latestStructure = structures[0];
  const structureData = latestStructure?.structureData;

  // Group campaigns by adGroupType for matrix view
  const campaignMatrix = useMemo(() => {
    if (!structureData?.adStructure?.campaigns) return {};
    const matrix: Record<string, Record<string, any>> = {};
    for (const campaign of structureData.adStructure.campaigns) {
      const groupType = campaign.adGroupType || "other";
      const matchType = campaign.matchType || "broad";
      if (!matrix[groupType]) matrix[groupType] = {};
      matrix[groupType][matchType] = campaign;
    }
    return matrix;
  }, [structureData]);

  const toggleCampaign = (idx: number) => {
    setExpandedCampaigns(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("已复制到剪贴板");
  };

  const handleGenerate = () => {
    if (!projectId) return;
    generateMutation.mutate({ projectId });
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">请先登录后使用广告架构功能</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">广告关键词架构</h1>
        <p className="text-muted-foreground mt-1">
          基于关键词矩阵分类，AI自动生成SP广告投放架构建议
        </p>
      </div>

      {/* Project Selection & Generate */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">选择项目</label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择一个项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} {p.brand ? `(${p.brand})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={!projectId || generateMutation.isPending}
              className="shrink-0"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  AI生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  生成广告架构
                </>
              )}
            </Button>
          </div>

          {generateMutation.isPending && (
            <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium">正在分析关键词数据并生成广告架构...</span>
              </div>
              <Progress value={60} className="h-1.5" />
              <p className="text-xs text-muted-foreground mt-2">
                AI正在根据关键词的流量、相关性、竞争度数据，设计最优广告投放矩阵
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* No data state */}
      {projectId && !structuresQuery.isLoading && structures.length === 0 && !generateMutation.isPending && (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">暂无广告架构</h3>
            <p className="text-sm text-muted-foreground mb-4">
              请先在关键词管理中导入并分类关键词，然后点击"生成广告架构"
            </p>
            <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
              <Sparkles className="h-4 w-4 mr-2" />
              立即生成
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {latestStructure && structureData && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span className="text-xs text-muted-foreground">广告活动</span>
                </div>
                <p className="text-2xl font-bold">{latestStructure.campaignCount || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="h-4 w-4 text-green-600" />
                  <span className="text-xs text-muted-foreground">投放关键词</span>
                </div>
                <p className="text-2xl font-bold">{latestStructure.keywordCount || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-amber-600" />
                  <span className="text-xs text-muted-foreground">建议日预算</span>
                </div>
                <p className="text-2xl font-bold">{structureData.budgetAllocation?.totalDailyBudget || "—"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span className="text-xs text-muted-foreground">生成时间</span>
                </div>
                <p className="text-sm font-medium">{new Date(latestStructure.createdAt).toLocaleString()}</p>
              </CardContent>
            </Card>
          </div>

          {/* Main Content Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="matrix">矩阵视图</TabsTrigger>
              <TabsTrigger value="campaigns">广告活动</TabsTrigger>
              <TabsTrigger value="budget">预算分配</TabsTrigger>
              <TabsTrigger value="strategy">阶段策略</TabsTrigger>
            </TabsList>

            {/* ═══ Matrix View ═══ */}
            <TabsContent value="matrix" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChart className="h-4 w-4" />
                    广告关键词矩阵
                  </CardTitle>
                  <CardDescription>
                    行维度为广告组类型，列维度为匹配方式，展示完整的广告架构
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px] font-bold">广告组类型</TableHead>
                          {Object.entries(MATCH_TYPE_LABELS).map(([key, val]) => (
                            <TableHead key={key} className="text-center min-w-[200px]">
                              <div className="flex flex-col items-center gap-1">
                                <Badge className={`${val.color} text-xs`}>{val.label}</Badge>
                                <span className="text-xs text-muted-foreground font-normal">{val.desc}</span>
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(AD_GROUP_LABELS).filter(([key]) => key !== "auto_campaign").map(([groupKey, groupVal]) => {
                          const Icon = groupVal.icon;
                          return (
                            <TableRow key={groupKey}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Icon className="h-4 w-4 shrink-0" />
                                  <div>
                                    <p className="font-medium text-sm">{groupVal.label}</p>
                                    <p className="text-xs text-muted-foreground">{groupVal.desc}</p>
                                  </div>
                                </div>
                              </TableCell>
                              {["exact", "phrase", "broad"].map(matchType => {
                                const campaign = campaignMatrix[groupKey]?.[matchType];
                                if (!campaign) {
                                  return (
                                    <TableCell key={matchType} className="text-center">
                                      <span className="text-xs text-muted-foreground">—</span>
                                    </TableCell>
                                  );
                                }
                                return (
                                  <TableCell key={matchType} className="align-top">
                                    <div className="space-y-2 p-2 rounded-lg bg-muted/30 border">
                                      <div className="flex items-center justify-between">
                                        <Badge variant="outline" className="text-xs">
                                          {campaign.keywords?.length || 0} 词
                                        </Badge>
                                        {campaign.priority && (
                                          <Badge className={`text-xs ${PRIORITY_COLORS[campaign.priority] || ""}`}>
                                            {campaign.priority === "high" ? "高优" : campaign.priority === "medium" ? "中优" : "低优"}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="space-y-1">
                                        {(campaign.keywords || []).slice(0, 5).map((kw: any, i: number) => (
                                          <div key={i} className="flex items-center justify-between text-xs">
                                            <span className="truncate max-w-[120px]" title={kw.keyword}>{kw.keyword}</span>
                                            {kw.suggestedBid && (
                                              <span className="text-muted-foreground shrink-0 ml-1">{kw.suggestedBid}</span>
                                            )}
                                          </div>
                                        ))}
                                        {(campaign.keywords?.length || 0) > 5 && (
                                          <p className="text-xs text-muted-foreground text-center">
                                            +{campaign.keywords.length - 5} 更多
                                          </p>
                                        )}
                                      </div>
                                      {campaign.dailyBudget && (
                                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                                          <DollarSign className="h-3 w-3" />
                                          日预算: {campaign.dailyBudget}
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Auto Campaign Section */}
                  {structureData.adStructure?.autoCompaign && (
                    <>
                      <Separator className="my-4" />
                      <div className="p-4 rounded-lg border bg-gray-50/50">
                        <div className="flex items-center gap-2 mb-3">
                          <Bot className="h-5 w-5 text-gray-600" />
                          <h4 className="font-medium">自动广告组 (Auto Campaign)</h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">日预算</p>
                            <p className="font-medium">{structureData.adStructure.autoCompaign.dailyBudget}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">默认竞价</p>
                            <p className="font-medium">{structureData.adStructure.autoCompaign.defaultBid}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">收词策略</p>
                            <p className="font-medium">{structureData.adStructure.autoCompaign.harvestStrategy}</p>
                          </div>
                        </div>
                        {structureData.adStructure.autoCompaign.optimizationTips && (
                          <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                            <p className="text-xs text-blue-700">
                              <Info className="h-3 w-3 inline mr-1" />
                              {structureData.adStructure.autoCompaign.optimizationTips}
                            </p>
                          </div>
                        )}
                        {structureData.adStructure.autoCompaign.negativeExact?.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-1">精准否定词</p>
                            <div className="flex flex-wrap gap-1">
                              {structureData.adStructure.autoCompaign.negativeExact.map((kw: string, i: number) => (
                                <Badge key={i} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">{kw}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ═══ Campaigns List ═══ */}
            <TabsContent value="campaigns" className="space-y-3">
              {(structureData.adStructure?.campaigns || []).map((campaign: any, idx: number) => {
                const isExpanded = expandedCampaigns.has(idx);
                const groupInfo = AD_GROUP_LABELS[campaign.adGroupType] || { label: campaign.adGroupType, icon: Target, color: "bg-gray-100 text-gray-800 border-gray-200", desc: "" };
                const matchInfo = MATCH_TYPE_LABELS[campaign.matchType] || { label: campaign.matchType, color: "" };
                const Icon = groupInfo.icon;

                return (
                  <Card key={idx}>
                    <CardHeader
                      className="cursor-pointer hover:bg-muted/30 transition-colors py-4"
                      onClick={() => toggleCampaign(idx)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Icon className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <CardTitle className="text-sm font-medium">
                              {campaign.campaignName || `${groupInfo.label} - ${matchInfo.label}`}
                            </CardTitle>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className={`text-xs ${groupInfo.color}`}>{groupInfo.label}</Badge>
                              <Badge className={`text-xs ${matchInfo.color}`}>{matchInfo.label}</Badge>
                              {campaign.priority && (
                                <Badge className={`text-xs ${PRIORITY_COLORS[campaign.priority] || ""}`}>
                                  {campaign.priority === "high" ? "高优先" : campaign.priority === "medium" ? "中优先" : "低优先"}
                                </Badge>
                              )}
                              {campaign.phase && (
                                <Badge variant="outline" className="text-xs">{campaign.phase}</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right text-sm">
                            <p className="font-medium">{campaign.keywords?.length || 0} 个关键词</p>
                            {campaign.dailyBudget && (
                              <p className="text-xs text-muted-foreground">日预算: {campaign.dailyBudget}</p>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>
                      </div>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent className="pt-0 space-y-4">
                        <Separator />

                        {/* Bid Strategy */}
                        {campaign.bidStrategy && (
                          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <p className="text-xs font-medium text-amber-800 mb-1">竞价策略</p>
                            <p className="text-sm text-amber-700">{campaign.bidStrategy}</p>
                          </div>
                        )}

                        {/* Keywords Table */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium">关键词列表</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                const kwText = (campaign.keywords || []).map((kw: any) => kw.keyword).join("\n");
                                copyToClipboard(kwText, `campaign-${idx}`);
                              }}
                            >
                              {copiedId === `campaign-${idx}` ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                              复制全部
                            </Button>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>关键词</TableHead>
                                <TableHead className="w-[100px]">建议竞价</TableHead>
                                <TableHead className="w-[80px]">搜索量</TableHead>
                                <TableHead className="w-[80px]">竞争度</TableHead>
                                <TableHead>备注</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(campaign.keywords || []).map((kw: any, ki: number) => (
                                <TableRow key={ki}>
                                  <TableCell className="font-mono text-sm">{kw.keyword}</TableCell>
                                  <TableCell>
                                    {kw.suggestedBid && (
                                      <Badge variant="outline" className="text-xs">{kw.suggestedBid}</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {kw.searchVolume && (
                                      <Badge className={`text-xs ${
                                        kw.searchVolume === "高" ? "bg-red-100 text-red-700" :
                                        kw.searchVolume === "中" ? "bg-amber-100 text-amber-700" :
                                        "bg-green-100 text-green-700"
                                      }`}>{kw.searchVolume}</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {kw.competition && (
                                      <Badge className={`text-xs ${
                                        kw.competition === "高" ? "bg-red-100 text-red-700" :
                                        kw.competition === "中" ? "bg-amber-100 text-amber-700" :
                                        "bg-green-100 text-green-700"
                                      }`}>{kw.competition}</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{kw.note || "—"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* Negative Keywords */}
                        {campaign.negativeKeywords?.length > 0 && (
                          <div>
                            <p className="text-sm font-medium mb-2 flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                              否定关键词
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {campaign.negativeKeywords.map((nk: string, ni: number) => (
                                <Badge key={ni} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">{nk}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Optimization Tips */}
                        {campaign.optimizationTips && (
                          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                            <p className="text-xs font-medium text-blue-800 mb-1">优化建议</p>
                            <p className="text-sm text-blue-700">{campaign.optimizationTips}</p>
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </TabsContent>

            {/* ═══ Budget Allocation ═══ */}
            <TabsContent value="budget" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    预算分配建议
                  </CardTitle>
                  <CardDescription>
                    建议总日预算: <span className="font-bold text-foreground">{structureData.budgetAllocation?.totalDailyBudget || "—"}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {structureData.budgetAllocation?.breakdown ? (
                    <div className="space-y-3">
                      {structureData.budgetAllocation.breakdown.map((item: any, i: number) => (
                        <div key={i} className="flex items-center gap-4 p-3 rounded-lg border">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm">{item.campaignGroup}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">{item.percentage}%</Badge>
                                <span className="font-bold text-sm">{item.dailyAmount}</span>
                              </div>
                            </div>
                            <Progress value={item.percentage} className="h-2 mb-1" />
                            <p className="text-xs text-muted-foreground">{item.reason}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无预算分配数据</p>
                  )}
                </CardContent>
              </Card>

              {/* Negative Keyword Strategy */}
              {structureData.negativeKeywordStrategy && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      否定词策略
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {structureData.negativeKeywordStrategy.campaignLevel?.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">全局否定词（Campaign级别）</p>
                        <div className="flex flex-wrap gap-1.5">
                          {structureData.negativeKeywordStrategy.campaignLevel.map((kw: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">{kw}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {structureData.negativeKeywordStrategy.adGroupLevel && (
                      <div>
                        <p className="text-sm font-medium mb-2">广告组级别否定词</p>
                        {Object.entries(structureData.negativeKeywordStrategy.adGroupLevel).map(([group, kws]: [string, any]) => (
                          <div key={group} className="mb-2">
                            <p className="text-xs text-muted-foreground mb-1">{AD_GROUP_LABELS[group]?.label || group}</p>
                            <div className="flex flex-wrap gap-1">
                              {(kws || []).map((kw: string, i: number) => (
                                <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {structureData.negativeKeywordStrategy.rules && (
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-sm">{structureData.negativeKeywordStrategy.rules}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ═══ Phase Strategy ═══ */}
            <TabsContent value="strategy" className="space-y-4">
              {structureData.phaseStrategy && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { key: "newProduct", label: "新品期", icon: "🚀", color: "border-green-200 bg-green-50/50" },
                    { key: "growth", label: "成长期", icon: "📈", color: "border-blue-200 bg-blue-50/50" },
                    { key: "mature", label: "成熟期", icon: "🏆", color: "border-amber-200 bg-amber-50/50" },
                  ].map(phase => {
                    const data = structureData.phaseStrategy[phase.key];
                    if (!data) return null;
                    return (
                      <Card key={phase.key} className={phase.color}>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <span>{phase.icon}</span>
                            {phase.label}
                          </CardTitle>
                          {data.duration && (
                            <CardDescription className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {data.duration}
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {data.focus && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">重点投放</p>
                              <p className="text-sm">{data.focus}</p>
                            </div>
                          )}
                          {data.budgetSplit && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">预算分配</p>
                              <p className="text-sm">{data.budgetSplit}</p>
                            </div>
                          )}
                          {data.keyActions?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">关键动作</p>
                              <ul className="space-y-1">
                                {data.keyActions.map((action: string, i: number) => (
                                  <li key={i} className="text-sm flex items-start gap-1.5">
                                    <TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                                    {action}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Overall Strategy */}
              {structureData.overallStrategy && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">整体策略总结</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed">{structureData.overallStrategy}</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>

          {/* History & Actions */}
          {structures.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">历史记录</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {structures.slice(1).map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{new Date(s.createdAt).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.campaignCount} 个广告活动 · {s.keywordCount} 个关键词
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => deleteMutation.mutate({ id: s.id })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
