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
  Pencil, Save, X, Plus, GripVertical, Radar, Star, Download,
  ArrowUpRight, ArrowDownRight, Minus, FileSpreadsheet
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

  const targetingQuery = trpc.adStructure.estimateTargeting.useQuery(
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

  const exportAdCsv = () => {
    if (!displayData?.adStructure?.campaigns) { toast.error("没有可导出的广告架构数据"); return; }
    const headers = ["Campaign名称", "广告组类型", "匹配类型", "关键词", "建议竞价($)", "月搜索量", "竞争度", "每日预算($)", "竞价策略", "否定关键词"];
    const csvRows = [headers.join(",")];
    for (const campaign of displayData.adStructure.campaigns) {
      const groupLabel = AD_GROUP_LABELS[campaign.adGroupType]?.label || campaign.adGroupType;
      const matchLabel = MATCH_TYPE_LABELS[campaign.matchType]?.label || campaign.matchType;
      const negKws = (campaign.negativeKeywords || []).join(";");
      if (campaign.keywords && campaign.keywords.length > 0) {
        for (const kw of campaign.keywords) {
          csvRows.push([
            `"${(campaign.campaignName || "").replace(/"/g, '""')}"`,
            groupLabel,
            matchLabel,
            `"${(kw.keyword || "").replace(/"/g, '""')}"`,
            kw.suggestedBid || "",
            kw.searchVolume || "",
            kw.competition || "",
            campaign.dailyBudget || "",
            campaign.bidStrategy || "",
            `"${negKws}"`,
          ].join(","));
        }
      } else {
        csvRows.push([
          `"${(campaign.campaignName || "").replace(/"/g, '""')}"`,
          groupLabel,
          matchLabel,
          "",
          "",
          "",
          "",
          campaign.dailyBudget || "",
          campaign.bidStrategy || "",
          `"${negKws}"`,
        ].join(","));
      }
    }
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ad_structure_${projectId}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    const kwCount = displayData.adStructure.campaigns.reduce((sum: number, c: any) => sum + (c.keywords?.length || 0), 0);
    toast.success(`已导出 ${displayData.adStructure.campaigns.length} 个Campaign，${kwCount} 个关键词`);
  };

  // Export Amazon Seller Central Bulk Sheet (SP Ads format)
  const exportBulkSheet = async () => {
    if (!displayData?.adStructure?.campaigns) { toast.error("没有可导出的广告架构数据"); return; }

    // Dynamic import xlsx
    const XLSX = await import("xlsx");

    const rows: any[][] = [];

    // Header row matching Amazon SP Bulk Sheet format
    const headers = [
      "Record Type", "Campaign Name", "Campaign Daily Budget",
      "Campaign Start Date", "Campaign Targeting Type", "Campaign Status",
      "Bidding Strategy", "Ad Group Name", "Ad Group Default Bid",
      "Keyword or Product Targeting", "Match Type", "Keyword Bid",
      "Product Targeting ID", "Status", "Operation",
    ];
    rows.push(headers);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    // Process each campaign
    for (const campaign of displayData.adStructure.campaigns) {
      const campaignName = campaign.campaignName || `SP-${AD_GROUP_LABELS[campaign.adGroupType]?.label || campaign.adGroupType}-${MATCH_TYPE_LABELS[campaign.matchType]?.label || campaign.matchType}`;
      const dailyBudget = (campaign.dailyBudget || "$10").replace("$", "");
      const isAuto = campaign.adGroupType === "auto_campaign";
      const targetingType = isAuto ? "Auto" : "Manual";

      // Campaign row
      rows.push([
        "Campaign", campaignName, dailyBudget,
        today, targetingType, "enabled",
        "legacyForSales", "", "",
        "", "", "",
        "", "", "Create",
      ]);

      // Ad Group row
      const adGroupName = `${campaignName}-AdGroup`;
      const defaultBid = "0.75";
      rows.push([
        "Ad Group", campaignName, "",
        "", "", "",
        "", adGroupName, defaultBid,
        "", "", "",
        "", "enabled", "Create",
      ]);

      // Keyword rows
      if (!isAuto && campaign.keywords && campaign.keywords.length > 0) {
        for (const kw of campaign.keywords) {
          if (!kw.keyword) continue;
          // Check if it's an ASIN targeting (competitor ASIN group)
          const isAsin = /^B0[A-Z0-9]{8}$/i.test(kw.keyword.trim());
          const bid = (kw.suggestedBid || "$0.75").replace("$", "");

          if (isAsin) {
            // Product targeting row
            rows.push([
              "Product Targeting", campaignName, "",
              "", "", "",
              "", adGroupName, "",
              "", "", bid,
              `asin="${kw.keyword.trim()}"`, "enabled", "Create",
            ]);
          } else {
            // Keyword row
            rows.push([
              "Keyword", campaignName, "",
              "", "", "",
              "", adGroupName, "",
              kw.keyword.trim(), campaign.matchType || "broad", bid,
              "", "enabled", "Create",
            ]);
          }
        }
      }

      // Negative keyword rows
      if (campaign.negativeKeywords && campaign.negativeKeywords.length > 0) {
        for (const negKw of campaign.negativeKeywords) {
          rows.push([
            "Negative Keyword", campaignName, "",
            "", "", "",
            "", adGroupName, "",
            negKw, "negative exact", "",
            "", "", "Create",
          ]);
        }
      }
    }

    // Auto campaign from autoCompaign section
    if (displayData.adStructure.autoCompaign) {
      const auto = displayData.adStructure.autoCompaign;
      const autoCampaignName = "SP-Auto-Campaign";
      const autoBudget = (auto.dailyBudget || "$15").replace("$", "");
      const autoBid = (auto.defaultBid || "$0.50").replace("$", "");

      rows.push([
        "Campaign", autoCampaignName, autoBudget,
        today, "Auto", "enabled",
        "legacyForSales", "", "",
        "", "", "",
        "", "", "Create",
      ]);

      rows.push([
        "Ad Group", autoCampaignName, "",
        "", "", "",
        "", `${autoCampaignName}-AdGroup`, autoBid,
        "", "", "",
        "", "enabled", "Create",
      ]);

      // Negative exact keywords for auto campaign
      if (auto.negativeExact && auto.negativeExact.length > 0) {
        for (const negKw of auto.negativeExact) {
          rows.push([
            "Negative Keyword", autoCampaignName, "",
            "", "", "",
            "", `${autoCampaignName}-AdGroup`, "",
            negKw, "negative exact", "",
            "", "", "Create",
          ]);
        }
      }

      // Negative phrase keywords for auto campaign
      if (auto.negativePhrase && auto.negativePhrase.length > 0) {
        for (const negKw of auto.negativePhrase) {
          rows.push([
            "Negative Keyword", autoCampaignName, "",
            "", "", "",
            "", `${autoCampaignName}-AdGroup`, "",
            negKw, "negative phrase", "",
            "", "", "Create",
          ]);
        }
      }
    }

    // Create workbook
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths
    ws["!cols"] = [
      { wch: 18 }, { wch: 35 }, { wch: 18 },
      { wch: 16 }, { wch: 20 }, { wch: 12 },
      { wch: 18 }, { wch: 35 }, { wch: 18 },
      { wch: 40 }, { wch: 14 }, { wch: 12 },
      { wch: 25 }, { wch: 10 }, { wch: 10 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sponsored Products Campaigns");

    // Download
    XLSX.writeFile(wb, `SP_BulkSheet_${projectId}_${new Date().toISOString().slice(0, 10)}.xlsx`);

    const kwCount = rows.filter(r => r[0] === "Keyword" || r[0] === "Product Targeting").length;
    const campaignCount = rows.filter(r => r[0] === "Campaign").length;
    toast.success(`已导出Bulk Sheet: ${campaignCount} 个Campaign，${kwCount} 个关键词/定投目标`);
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportAdCsv}>
              <Download className="h-4 w-4 mr-2" />
              导出CSV
            </Button>
            <Button variant="outline" onClick={exportBulkSheet} className="border-orange-300 text-orange-700 hover:bg-orange-50">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              导出Bulk Sheet
            </Button>
            <Button variant="outline" onClick={startEditing}>
              <Pencil className="h-4 w-4 mr-2" />
              编辑架构
            </Button>
          </div>
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
            <TabsList className="grid grid-cols-7 w-full max-w-4xl">
              <TabsTrigger value="matrix">矩阵视图</TabsTrigger>
              <TabsTrigger value="targeting">定投预估</TabsTrigger>
              <TabsTrigger value="campaigns">广告活动</TabsTrigger>
              <TabsTrigger value="budget">预算分配</TabsTrigger>
              <TabsTrigger value="negative">否定词策略</TabsTrigger>
              <TabsTrigger value="strategy">阶段策略</TabsTrigger>
              <TabsTrigger value="orderVolume">单量预估</TabsTrigger>
            </TabsList>

            {/* Targeting Estimation Tab */}
            <TabsContent value="targeting" className="space-y-4">
              {targetingQuery.isLoading ? (
                <Card><CardContent className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" /><p className="text-sm text-muted-foreground">加载竞品定投数据...</p></CardContent></Card>
              ) : !targetingQuery.data?.estimates?.length ? (
                <Card><CardContent className="p-8 text-center"><Radar className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" /><p className="text-lg font-medium mb-1">暂无竞品数据</p><p className="text-sm text-muted-foreground">请先在竞品分析页面导入竞品评论数据</p></CardContent></Card>
              ) : (
                <div className="space-y-4">
                  {/* Summary Cards */}
                  {targetingQuery.data.summary && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <Card className="border-border/50">
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold">{targetingQuery.data.summary.totalCompetitors}</p>
                          <p className="text-xs text-muted-foreground">竞品总数</p>
                        </CardContent>
                      </Card>
                      <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30">
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-green-600">{targetingQuery.data.summary.highPriority}</p>
                          <p className="text-xs text-muted-foreground">强烈推荐</p>
                        </CardContent>
                      </Card>
                      <Card className="border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/30">
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-yellow-600">{targetingQuery.data.summary.mediumPriority}</p>
                          <p className="text-xs text-muted-foreground">建议定投</p>
                        </CardContent>
                      </Card>
                      <Card className="border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/30">
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-orange-600">{targetingQuery.data.summary.lowPriority}</p>
                          <p className="text-xs text-muted-foreground">观察为主</p>
                        </CardContent>
                      </Card>
                      <Card className="border-border/50">
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold">{targetingQuery.data.summary.avgScore}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
                          <p className="text-xs text-muted-foreground">平均得分</p>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Competitor Targeting Cards */}
                  {targetingQuery.data.estimates.map((est: any, idx: number) => {
                    const priorityConfig = est.priority === "high"
                      ? { color: "border-green-300 bg-green-50/30 dark:border-green-700 dark:bg-green-950/20", badge: "bg-green-100 text-green-800", icon: ArrowUpRight, label: "强烈推荐" }
                      : est.priority === "medium"
                      ? { color: "border-yellow-300 bg-yellow-50/30 dark:border-yellow-700 dark:bg-yellow-950/20", badge: "bg-yellow-100 text-yellow-800", icon: Minus, label: "建议定投" }
                      : { color: "border-orange-300 bg-orange-50/30 dark:border-orange-700 dark:bg-orange-950/20", badge: "bg-orange-100 text-orange-800", icon: ArrowDownRight, label: "观察为主" };
                    return (
                      <Card key={idx} className={priorityConfig.color}>
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-mono font-bold text-sm">{est.asin}</span>
                                <Badge className={priorityConfig.badge}>
                                  <priorityConfig.icon className="h-3 w-3 mr-1" />
                                  {priorityConfig.label}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  #{idx + 1}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-1">{est.title}</p>
                              {est.brand !== "未知" && <p className="text-xs text-muted-foreground">品牌: {est.brand}</p>}
                            </div>
                            <div className="text-right">
                              <div className="text-3xl font-bold">{est.scores.total}</div>
                              <div className="text-xs text-muted-foreground">/ 100 分</div>
                            </div>
                          </div>

                          {/* Score Breakdown */}
                          <div className="grid grid-cols-4 gap-3 mb-4">
                            <div className="bg-background/60 rounded-lg p-2.5 text-center">
                              <Star className="h-3.5 w-3.5 mx-auto mb-1 text-yellow-500" />
                              <p className="text-lg font-semibold">{est.scores.rating}<span className="text-xs font-normal">/25</span></p>
                              <p className="text-[10px] text-muted-foreground">评分维度</p>
                              <p className="text-xs text-muted-foreground">({est.rating}★)</p>
                            </div>
                            <div className="bg-background/60 rounded-lg p-2.5 text-center">
                              <BarChart3 className="h-3.5 w-3.5 mx-auto mb-1 text-blue-500" />
                              <p className="text-lg font-semibold">{est.scores.review}<span className="text-xs font-normal">/25</span></p>
                              <p className="text-[10px] text-muted-foreground">评论维度</p>
                              <p className="text-xs text-muted-foreground">({est.reviewCount}条)</p>
                            </div>
                            <div className="bg-background/60 rounded-lg p-2.5 text-center">
                              <DollarSign className="h-3.5 w-3.5 mx-auto mb-1 text-green-500" />
                              <p className="text-lg font-semibold">{est.scores.price}<span className="text-xs font-normal">/25</span></p>
                              <p className="text-[10px] text-muted-foreground">价格维度</p>
                              <p className="text-xs text-muted-foreground">({est.price})</p>
                            </div>
                            <div className="bg-background/60 rounded-lg p-2.5 text-center">
                              <Target className="h-3.5 w-3.5 mx-auto mb-1 text-purple-500" />
                              <p className="text-lg font-semibold">{est.scores.keywordOverlap}<span className="text-xs font-normal">/25</span></p>
                              <p className="text-[10px] text-muted-foreground">关键词重叠</p>
                              <p className="text-xs text-muted-foreground">({est.keywordOverlapPercent}%)</p>
                            </div>
                          </div>

                          {/* Shared Keywords */}
                          {est.sharedKeywords?.length > 0 && (
                            <div className="mb-3">
                              <p className="text-xs font-medium mb-1.5">重叠关键词:</p>
                              <div className="flex flex-wrap gap-1">
                                {est.sharedKeywords.map((kw: string, ki: number) => (
                                  <Badge key={ki} variant="secondary" className="text-[10px]">{kw}</Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Pain Points & Delight Points */}
                          <div className="grid grid-cols-2 gap-3">
                            {est.painPoints?.length > 0 && (
                              <div>
                                <p className="text-xs font-medium mb-1 text-red-600">竞品痛点 (可利用):</p>
                                <ul className="text-xs text-muted-foreground space-y-0.5">
                                  {est.painPoints.map((p: string, pi: number) => (
                                    <li key={pi} className="flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 text-red-400 shrink-0" /><span className="line-clamp-2">{p}</span></li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {est.delightPoints?.length > 0 && (
                              <div>
                                <p className="text-xs font-medium mb-1 text-green-600">竞品优势 (需注意):</p>
                                <ul className="text-xs text-muted-foreground space-y-0.5">
                                  {est.delightPoints.map((p: string, pi: number) => (
                                    <li key={pi} className="flex items-start gap-1"><Check className="h-3 w-3 mt-0.5 text-green-400 shrink-0" /><span className="line-clamp-2">{p}</span></li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {/* Recommendation */}
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <p className="text-xs"><Info className="h-3 w-3 inline mr-1" />{est.recommendation}</p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

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

            {/* Order Volume Projection Tab */}
            <TabsContent value="orderVolume" className="space-y-4">
              {displayData.orderVolumeProjection ? (
                <div className="space-y-4">
                  {/* Assumptions & Key Metrics */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Info className="h-4 w-4 text-blue-500" />
                        预估假设与核心指标
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-3">{displayData.orderVolumeProjection.assumptions}</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="p-3 rounded-lg bg-muted/50">
                          <p className="text-xs text-muted-foreground">预估转化率</p>
                          <p className="text-lg font-semibold">{displayData.orderVolumeProjection.conversionRate || '-'}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/50">
                          <p className="text-xs text-muted-foreground">平均CPC</p>
                          <p className="text-lg font-semibold">{displayData.orderVolumeProjection.avgCPC || '-'}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/50">
                          <p className="text-xs text-muted-foreground">每日总预算</p>
                          <p className="text-lg font-semibold">{displayData.budgetAllocation?.totalDailyBudget || '-'}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Phase-by-Phase Order Volume */}
                  {displayData.orderVolumeProjection.phases && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        { key: 'newProduct', label: '新品期', icon: Zap, color: 'border-blue-200 bg-blue-50/30 dark:border-blue-800 dark:bg-blue-950/20', iconColor: 'text-blue-500' },
                        { key: 'growth', label: '成长期', icon: TrendingUp, color: 'border-green-200 bg-green-50/30 dark:border-green-800 dark:bg-green-950/20', iconColor: 'text-green-500' },
                        { key: 'mature', label: '成熟期', icon: Star, color: 'border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20', iconColor: 'text-amber-500' },
                      ].map(({ key, label, icon: Icon, color, iconColor }) => {
                        const phase = (displayData.orderVolumeProjection.phases as any)?.[key];
                        if (!phase) return null;
                        return (
                          <Card key={key} className={color}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base flex items-center gap-2">
                                <Icon className={`h-4 w-4 ${iconColor}`} />
                                {label}
                                <Badge variant="outline" className="ml-auto text-xs">{phase.period}</Badge>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {/* Ad Orders */}
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">广告出单</p>
                                <div className="grid grid-cols-3 gap-2">
                                  <div className="text-center p-2 rounded bg-background/80">
                                    <p className="text-sm font-bold">{phase.dailyAdOrders}</p>
                                    <p className="text-[10px] text-muted-foreground">日均</p>
                                  </div>
                                  <div className="text-center p-2 rounded bg-background/80">
                                    <p className="text-sm font-bold">{phase.weeklyAdOrders}</p>
                                    <p className="text-[10px] text-muted-foreground">周均</p>
                                  </div>
                                  <div className="text-center p-2 rounded bg-background/80">
                                    <p className="text-sm font-bold">{phase.monthlyAdOrders}</p>
                                    <p className="text-[10px] text-muted-foreground">月均</p>
                                  </div>
                                </div>
                              </div>
                              {/* Organic Orders */}
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">自然出单</p>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="text-center p-2 rounded bg-background/80">
                                    <p className="text-sm font-bold">{phase.dailyOrganicOrders}</p>
                                    <p className="text-[10px] text-muted-foreground">日均自然单</p>
                                  </div>
                                  <div className="text-center p-2 rounded bg-background/80">
                                    <p className="text-sm font-bold">{phase.organicOrderRatio}</p>
                                    <p className="text-[10px] text-muted-foreground">自然单占比</p>
                                  </div>
                                </div>
                              </div>
                              {/* Total & Spend */}
                              <Separator />
                              <div className="grid grid-cols-3 gap-2">
                                <div className="text-center">
                                  <p className="text-lg font-bold text-primary">{phase.totalDailyOrders}</p>
                                  <p className="text-[10px] text-muted-foreground">日均总单量</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-lg font-bold text-orange-600">{phase.dailyAdSpend}</p>
                                  <p className="text-[10px] text-muted-foreground">日均广告花费</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-lg font-bold text-red-600">{phase.estimatedACoS}</p>
                                  <p className="text-[10px] text-muted-foreground">预估ACoS</p>
                                </div>
                              </div>
                              {phase.notes && (
                                <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">{phase.notes}</p>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}

                  {/* Organic Ranking Estimate */}
                  {displayData.orderVolumeProjection.organicRankingEstimate && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-green-500" />
                          自然排名预估与首页出单量
                        </CardTitle>
                        <CardDescription>基于关键词搜索量和SPR数据预估自然排名提升路径</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Top Keywords Ranking Table */}
                        {displayData.orderVolumeProjection.organicRankingEstimate.topKeywords?.length > 0 && (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>核心关键词</TableHead>
                                <TableHead className="text-center">当前排名</TableHead>
                                <TableHead className="text-center">30天目标</TableHead>
                                <TableHead className="text-center">90天目标</TableHead>
                                <TableHead className="text-center">目标日单量</TableHead>
                                <TableHead className="text-center">首页所需日单</TableHead>
                                <TableHead className="text-center">难度</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {displayData.orderVolumeProjection.organicRankingEstimate.topKeywords.map((kw: any, i: number) => (
                                <TableRow key={i}>
                                  <TableCell className="font-medium text-sm">{kw.keyword}</TableCell>
                                  <TableCell className="text-center text-sm">{kw.currentEstimatedRank}</TableCell>
                                  <TableCell className="text-center">
                                    <Badge variant="outline" className="text-xs">{kw.targetRankAfter30Days}</Badge>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">{kw.targetRankAfter90Days}</Badge>
                                  </TableCell>
                                  <TableCell className="text-center text-sm font-medium">{kw.estimatedDailyOrdersAtTarget}</TableCell>
                                  <TableCell className="text-center text-sm font-medium text-orange-600">{kw.requiredDailySales}</TableCell>
                                  <TableCell className="text-center">
                                    <Badge className={`text-xs ${kw.difficulty === '高' ? 'bg-red-100 text-red-700' : kw.difficulty === '中' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                      {kw.difficulty}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}

                        {/* Strategy Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {displayData.orderVolumeProjection.organicRankingEstimate.firstPageStrategy && (
                            <Card className="border-green-200 bg-green-50/30 dark:border-green-800 dark:bg-green-950/20">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                  <ArrowUpRight className="h-4 w-4 text-green-500" />
                                  上首页策略
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="text-sm leading-relaxed">{displayData.orderVolumeProjection.organicRankingEstimate.firstPageStrategy}</p>
                              </CardContent>
                            </Card>
                          )}
                          {displayData.orderVolumeProjection.organicRankingEstimate.topOfSearchStrategy && (
                            <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                  <Star className="h-4 w-4 text-amber-500" />
                                  冲首页首位策略
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="text-sm leading-relaxed">{displayData.orderVolumeProjection.organicRankingEstimate.topOfSearchStrategy}</p>
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <Card>
                  <CardContent className="p-8 text-center">
                    <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
                    <p className="text-lg font-medium mb-1">暂无单量预估数据</p>
                    <p className="text-sm text-muted-foreground mb-3">请重新生成广告架构以获取单量预估数据</p>
                    <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generateMutation.isPending}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      重新生成
                    </Button>
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
