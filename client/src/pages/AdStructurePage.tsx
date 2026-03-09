import { useState, useMemo, useCallback, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Loader2, Sparkles, Target, Crosshair, Globe, Shield, Zap, Bot,
  DollarSign, TrendingUp, AlertTriangle, ChevronDown, ChevronUp,
  Trash2, RefreshCw, BarChart3, PieChart, Clock, Info, Copy, Check,
  Pencil, Save, X, Plus, GripVertical
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

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<any>(null);

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

  const updateMutation = trpc.adStructure.update.useMutation({
    onSuccess: () => {
      structuresQuery.refetch();
      setIsEditing(false);
      setEditData(null);
      toast.success("广告架构已保存！");
    },
    onError: (err) => {
      toast.error(`保存失败: ${err.message}`);
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
  const displayData = isEditing ? editData : latestStructure?.structureData;

  // Group campaigns by adGroupType for matrix view
  const campaignMatrix = useMemo(() => {
    if (!displayData?.adStructure?.campaigns) return {};
    const matrix: Record<string, Record<string, any>> = {};
    for (const campaign of displayData.adStructure.campaigns) {
      const groupType = campaign.adGroupType || "other";
      const matchType = campaign.matchType || "broad";
      if (!matrix[groupType]) matrix[groupType] = {};
      matrix[groupType][matchType] = campaign;
    }
    return matrix;
  }, [displayData]);

  // Enter edit mode
  const startEditing = useCallback(() => {
    if (!latestStructure?.structureData) return;
    setEditData(JSON.parse(JSON.stringify(latestStructure.structureData)));
    setIsEditing(true);
  }, [latestStructure]);

  // Cancel edit
  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditData(null);
  }, []);

  // Save edits
  const saveEdits = useCallback(() => {
    if (!latestStructure?.id || !editData) return;
    updateMutation.mutate({ id: latestStructure.id, structureData: editData });
  }, [latestStructure, editData, updateMutation]);

  // ─── Edit helpers ───

  // Update a campaign field
  const updateCampaignField = useCallback((campaignIdx: number, field: string, value: any) => {
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.adStructure?.campaigns?.[campaignIdx]) {
        next.adStructure.campaigns[campaignIdx][field] = value;
      }
      return next;
    });
  }, []);

  // Update a keyword in a campaign
  const updateKeyword = useCallback((campaignIdx: number, kwIdx: number, field: string, value: string) => {
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.adStructure?.campaigns?.[campaignIdx]?.keywords?.[kwIdx]) {
        next.adStructure.campaigns[campaignIdx].keywords[kwIdx][field] = value;
      }
      return next;
    });
  }, []);

  // Add a keyword to a campaign
  const addKeyword = useCallback((campaignIdx: number) => {
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.adStructure?.campaigns?.[campaignIdx]) {
        if (!next.adStructure.campaigns[campaignIdx].keywords) {
          next.adStructure.campaigns[campaignIdx].keywords = [];
        }
        next.adStructure.campaigns[campaignIdx].keywords.push({
          keyword: "",
          suggestedBid: "$0.50",
          searchVolume: "中",
          competition: "中",
          note: "",
        });
      }
      return next;
    });
  }, []);

  // Remove a keyword from a campaign
  const removeKeyword = useCallback((campaignIdx: number, kwIdx: number) => {
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.adStructure?.campaigns?.[campaignIdx]?.keywords) {
        next.adStructure.campaigns[campaignIdx].keywords.splice(kwIdx, 1);
      }
      return next;
    });
  }, []);

  // Add a negative keyword to a campaign
  const addNegativeKeyword = useCallback((campaignIdx: number, keyword: string) => {
    if (!keyword.trim()) return;
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.adStructure?.campaigns?.[campaignIdx]) {
        if (!next.adStructure.campaigns[campaignIdx].negativeKeywords) {
          next.adStructure.campaigns[campaignIdx].negativeKeywords = [];
        }
        if (!next.adStructure.campaigns[campaignIdx].negativeKeywords.includes(keyword.trim())) {
          next.adStructure.campaigns[campaignIdx].negativeKeywords.push(keyword.trim());
        }
      }
      return next;
    });
  }, []);

  // Remove a negative keyword from a campaign
  const removeNegativeKeyword = useCallback((campaignIdx: number, nkIdx: number) => {
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.adStructure?.campaigns?.[campaignIdx]?.negativeKeywords) {
        next.adStructure.campaigns[campaignIdx].negativeKeywords.splice(nkIdx, 1);
      }
      return next;
    });
  }, []);

  // Update auto campaign field
  const updateAutoCampaignField = useCallback((field: string, value: any) => {
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.adStructure?.autoCompaign) {
        next.adStructure.autoCompaign[field] = value;
      }
      return next;
    });
  }, []);

  // Update budget allocation
  const updateBudgetField = useCallback((idx: number, field: string, value: any) => {
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.budgetAllocation?.breakdown?.[idx]) {
        next.budgetAllocation.breakdown[idx][field] = value;
      }
      return next;
    });
  }, []);

  const updateTotalBudget = useCallback((value: string) => {
    setEditData((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.budgetAllocation) {
        next.budgetAllocation.totalDailyBudget = value;
      }
      return next;
    });
  }, []);

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

  // Reset edit mode when switching projects
  useEffect(() => {
    setIsEditing(false);
    setEditData(null);
  }, [selectedProjectId]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">广告关键词架构</h1>
          <p className="text-muted-foreground mt-1">
            基于关键词矩阵和竞品分析数据，AI自动生成SP广告投放架构建议
          </p>
        </div>
        {latestStructure && displayData && !isEditing && (
          <Button variant="outline" onClick={startEditing}>
            <Pencil className="h-4 w-4 mr-2" />
            编辑架构
          </Button>
        )}
        {isEditing && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={cancelEditing} disabled={updateMutation.isPending}>
              <X className="h-4 w-4 mr-2" />
              取消
            </Button>
            <Button onClick={saveEdits} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              保存修改
            </Button>
          </div>
        )}
      </div>

      {/* Edit mode banner */}
      {isEditing && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
          <Pencil className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            编辑模式已开启 — 可直接修改关键词、竞价、预算等内容，完成后点击"保存修改"
          </p>
        </div>
      )}

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
              disabled={!projectId || generateMutation.isPending || isEditing}
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
                <span className="text-sm font-medium">正在分析关键词和竞品数据，生成广告架构...</span>
              </div>
              <Progress value={60} className="h-1.5" />
              <p className="text-xs text-muted-foreground mt-2">
                AI正在根据关键词矩阵、竞品ASIN数据，设计最优广告投放架构（含竞品定投建议）
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
              请先在关键词管理中导入并分类关键词，然后点击"生成广告架构"。<br />
              如果已有竞品分析数据，AI会自动推荐竞品ASIN定投目标。
            </p>
            <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
              <Sparkles className="h-4 w-4 mr-2" />
              立即生成
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {latestStructure && displayData && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span className="text-xs text-muted-foreground">广告活动</span>
                </div>
                <p className="text-2xl font-bold">{displayData.adStructure?.campaigns?.length || latestStructure.campaignCount || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="h-4 w-4 text-green-600" />
                  <span className="text-xs text-muted-foreground">投放关键词</span>
                </div>
                <p className="text-2xl font-bold">
                  {(displayData.adStructure?.campaigns || []).reduce((s: number, c: any) => s + (c.keywords?.length || 0), 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-amber-600" />
                  <span className="text-xs text-muted-foreground">建议日预算</span>
                </div>
                <p className="text-2xl font-bold">{displayData.budgetAllocation?.totalDailyBudget || "—"}</p>
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
                    {isEditing && " — 点击广告活动Tab可编辑具体关键词"}
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
                  {displayData.adStructure?.autoCompaign && (
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
                            {isEditing ? (
                              <Input
                                value={displayData.adStructure.autoCompaign.dailyBudget || ""}
                                onChange={(e) => updateAutoCampaignField("dailyBudget", e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <p className="font-medium">{displayData.adStructure.autoCompaign.dailyBudget}</p>
                            )}
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">默认竞价</p>
                            {isEditing ? (
                              <Input
                                value={displayData.adStructure.autoCompaign.defaultBid || ""}
                                onChange={(e) => updateAutoCampaignField("defaultBid", e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <p className="font-medium">{displayData.adStructure.autoCompaign.defaultBid}</p>
                            )}
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">收词策略</p>
                            {isEditing ? (
                              <Input
                                value={displayData.adStructure.autoCompaign.harvestStrategy || ""}
                                onChange={(e) => updateAutoCampaignField("harvestStrategy", e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <p className="font-medium">{displayData.adStructure.autoCompaign.harvestStrategy}</p>
                            )}
                          </div>
                        </div>
                        {displayData.adStructure.autoCompaign.optimizationTips && (
                          <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                            <p className="text-xs text-blue-700">
                              <Info className="h-3 w-3 inline mr-1" />
                              {displayData.adStructure.autoCompaign.optimizationTips}
                            </p>
                          </div>
                        )}
                        {displayData.adStructure.autoCompaign.negativeExact?.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-1">精准否定词</p>
                            <div className="flex flex-wrap gap-1">
                              {displayData.adStructure.autoCompaign.negativeExact.map((kw: string, i: number) => (
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

            {/* ═══ Campaigns List (Editable) ═══ */}
            <TabsContent value="campaigns" className="space-y-3">
              {(displayData.adStructure?.campaigns || []).map((campaign: any, idx: number) => {
                const isExpanded = expandedCampaigns.has(idx);
                const groupInfo = AD_GROUP_LABELS[campaign.adGroupType] || { label: campaign.adGroupType, icon: Target, color: "bg-gray-100 text-gray-800 border-gray-200", desc: "" };
                const matchInfo = MATCH_TYPE_LABELS[campaign.matchType] || { label: campaign.matchType, color: "" };
                const Icon = groupInfo.icon;

                return (
                  <Card key={idx} className={isEditing ? "border-amber-200" : ""}>
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

                        {/* Campaign Settings (Editable) */}
                        {isEditing && (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-muted/20 rounded-lg border border-dashed">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">日预算</label>
                              <Input
                                value={campaign.dailyBudget || ""}
                                onChange={(e) => updateCampaignField(idx, "dailyBudget", e.target.value)}
                                className="h-8 text-sm mt-1"
                                placeholder="$XX"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">竞价策略</label>
                              <Input
                                value={campaign.bidStrategy || ""}
                                onChange={(e) => updateCampaignField(idx, "bidStrategy", e.target.value)}
                                className="h-8 text-sm mt-1"
                                placeholder="竞价策略"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">优化建议</label>
                              <Input
                                value={campaign.optimizationTips || ""}
                                onChange={(e) => updateCampaignField(idx, "optimizationTips", e.target.value)}
                                className="h-8 text-sm mt-1"
                                placeholder="优化建议"
                              />
                            </div>
                          </div>
                        )}

                        {/* Bid Strategy (Read-only) */}
                        {!isEditing && campaign.bidStrategy && (
                          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <p className="text-xs font-medium text-amber-800 mb-1">竞价策略</p>
                            <p className="text-sm text-amber-700">{campaign.bidStrategy}</p>
                          </div>
                        )}

                        {/* Keywords Table (Editable) */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium">关键词列表</p>
                            <div className="flex items-center gap-2">
                              {isEditing && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addKeyword(idx);
                                  }}
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  添加关键词
                                </Button>
                              )}
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
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>关键词</TableHead>
                                <TableHead className="w-[100px]">建议竞价</TableHead>
                                <TableHead className="w-[80px]">搜索量</TableHead>
                                <TableHead className="w-[80px]">竞争度</TableHead>
                                <TableHead>备注</TableHead>
                                {isEditing && <TableHead className="w-[50px]"></TableHead>}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(campaign.keywords || []).map((kw: any, ki: number) => (
                                <TableRow key={ki}>
                                  <TableCell>
                                    {isEditing ? (
                                      <Input
                                        value={kw.keyword}
                                        onChange={(e) => updateKeyword(idx, ki, "keyword", e.target.value)}
                                        className="h-7 text-sm font-mono"
                                        placeholder="输入关键词或ASIN"
                                      />
                                    ) : (
                                      <span className="font-mono text-sm">{kw.keyword}</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {isEditing ? (
                                      <Input
                                        value={kw.suggestedBid || ""}
                                        onChange={(e) => updateKeyword(idx, ki, "suggestedBid", e.target.value)}
                                        className="h-7 text-sm w-[90px]"
                                        placeholder="$X.XX"
                                      />
                                    ) : (
                                      kw.suggestedBid && (
                                        <Badge variant="outline" className="text-xs">{kw.suggestedBid}</Badge>
                                      )
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {isEditing ? (
                                      <select
                                        value={kw.searchVolume || "中"}
                                        onChange={(e) => updateKeyword(idx, ki, "searchVolume", e.target.value)}
                                        className="h-7 text-xs border rounded px-1 bg-background"
                                      >
                                        <option value="高">高</option>
                                        <option value="中">中</option>
                                        <option value="低">低</option>
                                      </select>
                                    ) : (
                                      kw.searchVolume && (
                                        <Badge className={`text-xs ${
                                          kw.searchVolume === "高" ? "bg-red-100 text-red-700" :
                                          kw.searchVolume === "中" ? "bg-amber-100 text-amber-700" :
                                          "bg-green-100 text-green-700"
                                        }`}>{kw.searchVolume}</Badge>
                                      )
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {isEditing ? (
                                      <select
                                        value={kw.competition || "中"}
                                        onChange={(e) => updateKeyword(idx, ki, "competition", e.target.value)}
                                        className="h-7 text-xs border rounded px-1 bg-background"
                                      >
                                        <option value="高">高</option>
                                        <option value="中">中</option>
                                        <option value="低">低</option>
                                      </select>
                                    ) : (
                                      kw.competition && (
                                        <Badge className={`text-xs ${
                                          kw.competition === "高" ? "bg-red-100 text-red-700" :
                                          kw.competition === "中" ? "bg-amber-100 text-amber-700" :
                                          "bg-green-100 text-green-700"
                                        }`}>{kw.competition}</Badge>
                                      )
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {isEditing ? (
                                      <Input
                                        value={kw.note || ""}
                                        onChange={(e) => updateKeyword(idx, ki, "note", e.target.value)}
                                        className="h-7 text-xs"
                                        placeholder="备注"
                                      />
                                    ) : (
                                      <span className="text-xs text-muted-foreground">{kw.note || "—"}</span>
                                    )}
                                  </TableCell>
                                  {isEditing && (
                                    <TableCell>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                                        onClick={() => removeKeyword(idx, ki)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </TableCell>
                                  )}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* Negative Keywords (Editable) */}
                        <div>
                          <p className="text-sm font-medium mb-2 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                            否定关键词
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {(campaign.negativeKeywords || []).map((nk: string, ni: number) => (
                              <Badge key={ni} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200 gap-1">
                                {nk}
                                {isEditing && (
                                  <button
                                    className="ml-0.5 hover:text-red-900"
                                    onClick={() => removeNegativeKeyword(idx, ni)}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </Badge>
                            ))}
                            {isEditing && (
                              <NegativeKeywordInput onAdd={(kw) => addNegativeKeyword(idx, kw)} />
                            )}
                          </div>
                          {!isEditing && (!campaign.negativeKeywords || campaign.negativeKeywords.length === 0) && (
                            <p className="text-xs text-muted-foreground">暂无否定词</p>
                          )}
                        </div>

                        {/* Optimization Tips (Read-only in non-edit mode) */}
                        {!isEditing && campaign.optimizationTips && (
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

            {/* ═══ Budget Allocation (Editable) ═══ */}
            <TabsContent value="budget" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    预算分配建议
                  </CardTitle>
                  <CardDescription>
                    建议总日预算:{" "}
                    {isEditing ? (
                      <Input
                        value={displayData.budgetAllocation?.totalDailyBudget || ""}
                        onChange={(e) => updateTotalBudget(e.target.value)}
                        className="h-7 text-sm w-[100px] inline-block ml-1"
                        placeholder="$XX"
                      />
                    ) : (
                      <span className="font-bold text-foreground">{displayData.budgetAllocation?.totalDailyBudget || "—"}</span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {displayData.budgetAllocation?.breakdown ? (
                    <div className="space-y-3">
                      {displayData.budgetAllocation.breakdown.map((item: any, i: number) => (
                        <div key={i} className="flex items-center gap-4 p-3 rounded-lg border">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm">{item.campaignGroup}</span>
                              <div className="flex items-center gap-2">
                                {isEditing ? (
                                  <>
                                    <Input
                                      value={item.percentage ?? ""}
                                      onChange={(e) => updateBudgetField(i, "percentage", parseInt(e.target.value) || 0)}
                                      className="h-7 text-sm w-[60px]"
                                      type="number"
                                    />
                                    <span className="text-xs">%</span>
                                    <Input
                                      value={item.dailyAmount || ""}
                                      onChange={(e) => updateBudgetField(i, "dailyAmount", e.target.value)}
                                      className="h-7 text-sm w-[80px]"
                                      placeholder="$XX"
                                    />
                                  </>
                                ) : (
                                  <>
                                    <Badge variant="outline" className="text-xs">{item.percentage}%</Badge>
                                    <span className="font-bold text-sm">{item.dailyAmount}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <Progress value={item.percentage} className="h-2 mb-1" />
                            {isEditing ? (
                              <Input
                                value={item.reason || ""}
                                onChange={(e) => updateBudgetField(i, "reason", e.target.value)}
                                className="h-7 text-xs mt-1"
                                placeholder="分配理由"
                              />
                            ) : (
                              <p className="text-xs text-muted-foreground">{item.reason}</p>
                            )}
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
              {displayData.negativeKeywordStrategy && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      否定词策略
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {displayData.negativeKeywordStrategy.campaignLevel?.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">全局否定词（Campaign级别）</p>
                        <div className="flex flex-wrap gap-1.5">
                          {displayData.negativeKeywordStrategy.campaignLevel.map((kw: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">{kw}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {displayData.negativeKeywordStrategy.adGroupLevel && (
                      <div>
                        <p className="text-sm font-medium mb-2">广告组级别否定词</p>
                        {Object.entries(displayData.negativeKeywordStrategy.adGroupLevel).map(([group, kws]: [string, any]) => (
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
                    {displayData.negativeKeywordStrategy.rules && (
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-sm">{displayData.negativeKeywordStrategy.rules}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ═══ Phase Strategy ═══ */}
            <TabsContent value="strategy" className="space-y-4">
              {displayData.phaseStrategy && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { key: "newProduct", label: "新品期", icon: "🚀", color: "border-green-200 bg-green-50/50" },
                    { key: "growth", label: "成长期", icon: "📈", color: "border-blue-200 bg-blue-50/50" },
                    { key: "mature", label: "成熟期", icon: "🏆", color: "border-amber-200 bg-amber-50/50" },
                  ].map(phase => {
                    const data = displayData.phaseStrategy[phase.key];
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
              {displayData.overallStrategy && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">整体策略总结</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed">{displayData.overallStrategy}</p>
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

// ─── Inline component for adding negative keywords ───
function NegativeKeywordInput({ onAdd }: { onAdd: (kw: string) => void }) {
  const [value, setValue] = useState("");
  const handleAdd = () => {
    if (value.trim()) {
      onAdd(value.trim());
      setValue("");
    }
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
        className="h-6 text-xs w-[120px]"
        placeholder="添加否定词..."
      />
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleAdd}>
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
