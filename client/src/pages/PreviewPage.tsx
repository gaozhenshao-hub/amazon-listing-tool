import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import { sanitizeListingHtml } from "@/lib/sanitizeListingHtml";
import {
  FileText,
  AlertTriangle,
  Save,
  Copy,
  CheckCircle2,
  Type,
  List,
  Key,
  Image,
  Loader2,
  Edit3,
  Eye,
  Languages,
  Palette,
  Lightbulb,
  BarChart3,
  Layout,
  Smartphone,
  TypeIcon,
  History,
  RotateCcw,
  Sparkles,
  Pencil,
  GitBranch,
  Globe,
  Wand2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Check,
  X,
  Plus,
  Trash2,
  MessageCircle,
  HelpCircle,
  Lock,
  Unlock,
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
  Clock3,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GovernedRestoreSnapshot = RouterOutputs["listing"]["listGovernedCompleteRestoreSnapshots"][number];
type GovernedRestorePreviewResponse = RouterOutputs["listing"]["previewGovernedCompleteRestore"];
type CompleteListingPayload = GovernedRestorePreviewResponse["preview"]["currentFullPayload"];

const COMPLETE_RESTORE_FIELD_GROUPS = [
  {
    label: "英文 Listing",
    fields: ["title", "itemHighlights", "bulletPoints", "description", "searchTerms"],
  },
  {
    label: "中文 Listing",
    fields: ["titleCn", "itemHighlightsCn", "bulletPointsCn", "descriptionCn", "searchTermsCn"],
  },
  {
    label: "图片建议",
    fields: ["imageAdvice", "imageAdviceCn"],
  },
  {
    label: "QA 与审核状态",
    fields: ["qaContent", "qaContentCn", "lockedSteps", "checklistScores", "agentRunId"],
  },
  {
    label: "正式 Listing 身份与状态",
    fields: ["isActive"],
  },
] as const;

const COMPLETE_RESTORE_FIELD_LABELS: Record<string, string> = {
  title: "英文标题",
  itemHighlights: "英文标题补充",
  bulletPoints: "英文卖点",
  description: "英文描述",
  searchTerms: "英文搜索词",
  imageAdvice: "英文图片建议",
  imageAdviceCn: "中文图片建议",
  titleCn: "中文标题",
  itemHighlightsCn: "中文标题补充",
  bulletPointsCn: "中文卖点",
  descriptionCn: "中文描述",
  searchTermsCn: "中文搜索词",
  qaContent: "英文 QA",
  qaContentCn: "中文 QA",
  lockedSteps: "工作台锁定步骤",
  checklistScores: "检查清单评分",
  agentRunId: "生成任务关联",
  isActive: "正式 Listing 活动状态",
  version: "Listing 版本",
  updatedAt: "更新时间（服务端分配）",
};

function restoreFieldLabel(field: string) {
  return COMPLETE_RESTORE_FIELD_LABELS[field] ?? field;
}

function formatRestoreValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "（空）";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 360 ? `${text.slice(0, 360)}…` : text;
}

function restorePayloadValue(payload: CompleteListingPayload, field: string) {
  if (!Object.prototype.hasOwnProperty.call(payload, field)) return undefined;
  return payload[field as keyof CompleteListingPayload];
}

function formatRestoreTime(value: Date | string | number | null | undefined) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间不可用" : date.toLocaleString("zh-CN");
}

function CharCountBadge({ count, min, max }: { count: number; min: number; max: number }) {
  const inRange = count >= min && count <= max;
  const tooShort = count < min;
  return (
    <Badge
      variant={inRange ? "default" : "destructive"}
      className={`text-xs ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}
    >
      {count} / {min}-{max} 字符 {inRange ? "✓" : tooShort ? "↑偏短" : "↓偏长"}
    </Badge>
  );
}

export default function PreviewPage() {
  const { selectedProjectId } = useProject();
  const [, setLocation] = useLocation();

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    title: "",
    itemHighlights: "",
    description: "",
    searchTerms: "",
  });
  // Legacy lock state is not a complete, evidence-backed Listing approval.
  const editsConfirmed = false;

  const { data: listing, isLoading } = trpc.listing.getActive.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();
  const updateListing = trpc.listing.update.useMutation({
    onSuccess: () => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      setIsEditing(false);
      toast.success("Listing已更新");
    },
    onError: (err: any) => toast.error("更新失败: " + err.message),
  });

  const translateToChinese = trpc.listing.translateToChinese.useMutation({
    onSuccess: () => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      toast.success("中文翻译生成完成！");
    },
    onError: (err: any) => toast.error("翻译失败: " + err.message),
  });

  useEffect(() => {
    if (listing) {
      setEditData({
        title: listing.title || "",
        itemHighlights: (listing as any).itemHighlights || "",
        description: listing.description || "",
        searchTerms: listing.searchTerms || "",
      });
    }
  }, [listing]);

  const bulletPointsArray = useMemo(() => {
    if (!listing?.bulletPoints) return [];
    try {
      const parsed = JSON.parse(listing.bulletPoints);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return listing.bulletPoints.split("\n").filter(Boolean);
    }
  }, [listing?.bulletPoints]);

  const bulletPointsCnArray = useMemo(() => {
    if (!listing?.bulletPointsCn) return [];
    try {
      const parsed = JSON.parse(listing.bulletPointsCn);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }, [listing?.bulletPointsCn]);

  const imageAdvice = useMemo(() => {
    if (!listing?.imageAdvice) return null;
    try {
      const parsed = JSON.parse(listing.imageAdvice);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      return parsed;
    } catch { return null; }
  }, [listing?.imageAdvice]);

  const imageAdviceCn = useMemo(() => {
    if (!listing?.imageAdviceCn) return null;
    try {
      const parsed = JSON.parse(listing.imageAdviceCn);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      return parsed;
    } catch { return null; }
  }, [listing?.imageAdviceCn]);

  const qaContent = useMemo(() => {
    if (!(listing as any)?.qaContent) return null;
    try {
      const parsed = JSON.parse((listing as any).qaContent);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }, [listing]);

  const qaContentCn = useMemo(() => {
    if (!(listing as any)?.qaContentCn) return null;
    try {
      const parsed = JSON.parse((listing as any).qaContentCn);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }, [listing]);

  const hasChinese = !!(listing?.titleCn || listing?.bulletPointsCn || listing?.descriptionCn || listing?.searchTermsCn);

  // Completion progress
  const completionItems = useMemo(() => {
    if (!listing) return [];
    return [
      { label: "标题", done: !!listing.title },
      { label: "卖点", done: !!listing.bulletPoints },
      { label: "描述", done: !!listing.description },
      { label: "搜索词", done: !!listing.searchTerms },
      { label: "QA问答", done: !!(listing as any)?.qaContent },
      { label: "中文翻译", done: hasChinese },
    ];
  }, [listing, hasChinese]);

  const completionRate = useMemo(() => {
    if (completionItems.length === 0) return 0;
    return Math.round((completionItems.filter(i => i.done).length / completionItems.length) * 100);
  }, [completionItems]);

  // Parse locked steps from listing
  const lockedSteps = useMemo(() => {
    if (!(listing as any)?.lockedSteps) return [];
    try {
      const parsed = JSON.parse((listing as any).lockedSteps);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }, [listing]);

  const STEP_LABELS = [
    { step: 1, label: "卖点精雕", icon: List },
    { step: 2, label: "标题生成", icon: Type },
    { step: 3, label: "描述生成", icon: FileText },
    { step: 4, label: "搜索词", icon: Key },
    { step: 5, label: "QA问答", icon: MessageCircle },
  ];

  const lockedCount = lockedSteps.length;
  const allLocked = lockedCount === 5;

  // Legacy versions remain a read-only historical view. Only 0204 approved,
  // complete snapshots may be selected for a restore.
  const [expandedVersionId, setExpandedVersionId] = useState<number | null>(null);
  const [selectedGovernedSnapshotId, setSelectedGovernedSnapshotId] = useState<number | null>(null);
  const [governedRestorePreview, setGovernedRestorePreview] = useState<GovernedRestorePreviewResponse | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreClockNow, setRestoreClockNow] = useState(() => Date.now());

  const versionsQuery = trpc.listing.getVersionHistory.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId && !!listing }
  );

  const governedSnapshotsQuery = trpc.listing.listGovernedCompleteRestoreSnapshots.useQuery(
    { projectId: selectedProjectId!, limit: 100 },
    {
      enabled: !!selectedProjectId && !!listing,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const governedPreviewQuery = trpc.listing.previewGovernedCompleteRestore.useQuery(
    {
      projectId: selectedProjectId!,
      sourceSnapshotId: selectedGovernedSnapshotId ?? 1,
    },
    {
      enabled: !!selectedProjectId && !!listing && selectedGovernedSnapshotId !== null,
      retry: false,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    }
  );

  const clearGovernedRestorePreview = useCallback(() => {
    setSelectedGovernedSnapshotId(null);
    setGovernedRestorePreview(null);
    setRestoreConfirmOpen(false);
  }, []);

  const governedRestoreMutation = trpc.listing.restoreGovernedCompleteSnapshot.useMutation({
    onSuccess: async (data) => {
      clearGovernedRestorePreview();
      await Promise.all([
        utils.listing.getActive.invalidate({ projectId: selectedProjectId! }),
        utils.listing.getVersionHistory.invalidate({ projectId: selectedProjectId! }),
        utils.listing.listGovernedCompleteRestoreSnapshots.invalidate({ projectId: selectedProjectId! }),
      ]);
      toast.success(
        data.outcome === "already_restored"
          ? "该完整快照已恢复；当前正式 Listing 未被重复覆盖"
          : `已恢复受治理完整快照 #${data.sourceSnapshotId}（正式 Listing 版本 ${data.listingVersion}）`
      );
    },
    onError: async (err) => {
      clearGovernedRestorePreview();
      await Promise.all([
        utils.listing.getActive.invalidate({ projectId: selectedProjectId! }),
        utils.listing.listGovernedCompleteRestoreSnapshots.invalidate({ projectId: selectedProjectId! }),
      ]);
      toast.error(`恢复未执行：${err.message}。已清除过期预览，请重新选择完整快照。`);
    },
  });

  useEffect(() => {
    clearGovernedRestorePreview();
  }, [selectedProjectId, listing?.id, listing?.version, clearGovernedRestorePreview]);

  useEffect(() => {
    if (governedSnapshotsQuery.isError) clearGovernedRestorePreview();
  }, [governedSnapshotsQuery.isError, clearGovernedRestorePreview]);

  useEffect(() => {
    if (!governedPreviewQuery.data) return;
    if (governedPreviewQuery.data.preview.sourceSnapshot.id !== selectedGovernedSnapshotId) return;
    setGovernedRestorePreview(governedPreviewQuery.data);
    setRestoreClockNow(Date.now());
  }, [governedPreviewQuery.data, selectedGovernedSnapshotId]);

  useEffect(() => {
    if (!governedPreviewQuery.isError) return;
    setGovernedRestorePreview(null);
    setRestoreConfirmOpen(false);
  }, [governedPreviewQuery.isError]);

  useEffect(() => {
    if (!governedRestorePreview) return;
    const timer = window.setInterval(() => setRestoreClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [governedRestorePreview]);

  const isGovernedRestorePreviewExpired = !!governedRestorePreview &&
    new Date(governedRestorePreview.expiresAt).getTime() <= restoreClockNow;

  const handleGovernedSnapshotSelect = (snapshot: GovernedRestoreSnapshot) => {
    setGovernedRestorePreview(null);
    setRestoreConfirmOpen(false);
    if (snapshot.id === selectedGovernedSnapshotId) {
      void governedPreviewQuery.refetch();
      return;
    }
    setSelectedGovernedSnapshotId(snapshot.id);
  };

  const refreshGovernedSnapshots = async () => {
    clearGovernedRestorePreview();
    await governedSnapshotsQuery.refetch();
  };

  const submitGovernedRestore = () => {
    const restoreToken = governedRestorePreview?.restoreToken;
    if (!restoreToken || isGovernedRestorePreviewExpired) {
      clearGovernedRestorePreview();
      toast.error("恢复预览已过期或不可用，请重新选择完整快照。");
      return;
    }
    governedRestoreMutation.mutate({ restoreToken });
  };

  // 旧报告与浏览器本地CSV无法验证当前完整人审快照，暂不提供下载。

  // Save full listing (title, itemHighlights, description, searchTerms)
  const handleSaveGeneral = () => {
    if (!listing) return;
    updateListing.mutate({
      id: listing.id,
      title: editData.title,
      itemHighlights: editData.itemHighlights,
      description: editData.description,
      searchTerms: editData.searchTerms,
    });
  };

  // 卖点只能在事实/核心/候选工作台编辑并通过事务化全字段预览同步。

  const handleConfirmEdits = () => setLocation("/listing/generate");

  const handleTranslate = () => {
    if (!selectedProjectId) return;
    translateToChinese.mutate({ projectId: selectedProjectId });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}已复制到剪贴板`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">结果预览</h1>
          <p className="text-muted-foreground mt-1">
            查看现有Listing；卖点请先核对事实与核心、编辑并确认候选，再预览全字段后同步
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector />
        </div>
      </div>
      {listing && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          旧版Listing仍可查看；直接下载报告/CSV与旧产物指针选版已暂停，不能把未经核验的草稿作为正式交付。
          卖点编辑和版本恢复请使用受治理的人审与完整快照流程。
        </p>
      )}

      {!selectedProjectId ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">请先选择一个项目</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-6"><div className="h-24 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      ) : !listing ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">暂无生成结果</p>
            <p className="text-sm text-muted-foreground">请先在“Listing生成”页面生成内容</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="preview" className="space-y-4">
          {/* Step Lock Progress Bar */}
          <Card className="mb-2">
            <CardContent className="py-4 px-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">工作台步骤锁定状态</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{lockedCount}/5 已锁定</span>
                  {allLocked ? (
                    <Badge className="bg-green-600 text-white text-xs">全部完成</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-600">待完善</Badge>
                  )}
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-muted rounded-full h-2 mb-3">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${allLocked ? 'bg-green-500' : 'bg-primary'}`}
                  style={{ width: `${(lockedCount / 5) * 100}%` }}
                />
              </div>
              {/* Step indicators */}
              <div className="grid grid-cols-5 gap-2">
                {STEP_LABELS.map(({ step, label, icon: Icon }) => {
                  const isLocked = lockedSteps.includes(step);
                  return (
                    <div
                      key={step}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ${
                        isLocked
                          ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
                          : 'bg-amber-50/50 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-800/40'
                      }`}
                    >
                      <div className={`flex items-center gap-1 ${
                        isLocked ? 'text-green-600' : 'text-amber-500'
                      }`}>
                        {isLocked ? (
                          <Lock className="h-3.5 w-3.5" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5" />
                        )}
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className={`text-xs font-medium ${
                        isLocked ? 'text-green-700' : 'text-amber-600'
                      }`}>
                        {label}
                      </span>
                      {isLocked ? (
                        <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] px-1.5 py-0">已锁定</Badge>
                      ) : (
                        <button
                          onClick={() => setLocation('/listing/generate')}
                          className="flex items-center gap-0.5 text-[10px] text-amber-600 hover:text-amber-800 hover:underline transition-colors"
                        >
                          待完善 <ArrowUpRight className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <TabsList>
            <TabsTrigger value="preview">
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              预览编辑
            </TabsTrigger>
            <TabsTrigger value="bilingual">
              <Languages className="h-3.5 w-3.5 mr-1.5" />
              中英对比
            </TabsTrigger>
            <TabsTrigger value="images">
              <Image className="h-3.5 w-3.5 mr-1.5" />
              图片建议
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-3.5 w-3.5 mr-1.5" />
              版本历史
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════════════════════════════════════════════════════
              Preview & Edit Tab
              ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="preview" className="space-y-4">
            {/* Workflow Status Banner */}
            <Card className="border-amber-300 bg-amber-50/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    {hasChinese ? (
                      <>
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                        <div>
                          <p className="text-sm font-medium text-amber-800">现有译文可查看，尚未作为新版事实审核通过</p>
                          <p className="text-xs text-amber-700">请先在Listing工作台核对事实、审核候选并预览完整同步版本</p>
                        </div>
                      </>
                    ) : editsConfirmed ? (
                      <>
                        <Languages className="h-5 w-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-blue-800">编辑已确认；自动翻译暂不可用</p>
                          <p className="text-xs text-blue-600">旧一键翻译会直接覆盖正式内容，已停用；请等待可编辑的译文候选和人工确认流程</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <Edit3 className="h-5 w-5 text-amber-600" />
                        <div>
                          <p className="text-sm font-medium text-amber-800">历史Listing尚未完成新版事实与卖点人审</p>
                          <p className="text-xs text-amber-700">请返回工作台审核候选；旧一键翻译暂不可用</p>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!hasChinese && !editsConfirmed && (
                      <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={handleConfirmEdits}>
                        <ArrowRight className="h-4 w-4 mr-1" />前往人审工作台
                      </Button>
                    )}
                    {!hasChinese && editsConfirmed && (
                      <Button
                        size="sm"
                        onClick={handleTranslate}
                        disabled title="旧一键翻译已暂停，需受治理译文候选和人工确认"
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {translateToChinese.isPending ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Languages className="h-4 w-4 mr-1" />
                        )}
                        {translateToChinese.isPending ? "翻译中..." : "执行中英文翻译"}
                      </Button>
                    )}
                    {hasChinese && (
                      <Button size="sm" onClick={() => setLocation("/listing/scoring")}>
                        <ArrowRight className="h-4 w-4 mr-1" />前往Listing评分
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Completion Progress */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Listing完成度</span>
                  <span className="text-sm font-bold text-primary">{completionRate}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 mb-3">
                  <div className="bg-primary h-2 rounded-full transition-all duration-500" style={{ width: `${completionRate}%` }} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {completionItems.map((item, i) => (
                    <Badge key={i} variant={item.done ? "default" : "outline"} className={`text-xs ${item.done ? "bg-green-100 text-green-700 border-green-300" : "text-muted-foreground"}`}>
                      {item.done ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <div className="h-3 w-3 mr-1 rounded-full border border-muted-foreground/50" />}
                      {item.label}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Title - Two-Stage Format */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Type className="h-4 w-4 text-blue-600" />
                    产品标题（两段式）
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {!isEditing && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(`${listing.title || ""}\n${(listing as any).itemHighlights || ""}`, "标题")}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsEditing(true)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700">Layer 1 - Title</Badge>
                        <CharCountBadge count={editData.title?.length || 0} min={1} max={75} />
                      </div>
                      <Textarea
                        value={editData.title}
                        onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                        rows={2}
                        className="font-medium text-sm"
                        placeholder="Brand + Core Keyword + Differentiator (≤75 chars)"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-700">Layer 2 - Item Highlights</Badge>
                        <CharCountBadge count={editData.itemHighlights?.length || 0} min={1} max={125} />
                      </div>
                      <Textarea
                        value={editData.itemHighlights}
                        onChange={(e) => setEditData({ ...editData, itemHighlights: e.target.value })}
                        rows={2}
                        className="text-sm"
                        placeholder="Specs + Use Cases + Secondary Keywords (≤125 chars)"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>合计: {(editData.title?.length || 0) + (editData.itemHighlights?.length || 0)} / ≤200 字符</span>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" onClick={handleSaveGeneral} disabled={updateListing.isPending}>
                        {updateListing.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                        保存
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setIsEditing(false); setEditData(prev => ({ ...prev, title: listing.title || "", itemHighlights: (listing as any).itemHighlights || "" })); }}>
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700">Layer 1 - Title</Badge>
                        <CharCountBadge count={listing.title?.length || 0} min={1} max={75} />
                      </div>
                      <p className="text-sm font-medium leading-relaxed">{listing.title}</p>
                    </div>
                    {(listing as any).itemHighlights && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-700">Layer 2 - Item Highlights</Badge>
                          <CharCountBadge count={(listing as any).itemHighlights?.length || 0} min={1} max={125} />
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">{(listing as any).itemHighlights}</p>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      合计: {(listing.title?.length || 0) + ((listing as any).itemHighlights?.length || 0)} 字符
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bullet Points - Enhanced with per-bullet editing */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <List className="h-4 w-4 text-green-600" />
                    卖点描述 (Bullet Points)
                    <Badge variant="secondary" className="text-xs">{bulletPointsArray.length} 条</Badge>
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      const text = bulletPointsArray.map((bp: any) =>
                        typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || bp.sellingPoint || ""}`
                      ).join("\n\n");
                      copyToClipboard(text, "卖点描述");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {bulletPointsArray.map((bp: any, i: number) => {
                    const fullBullet = typeof bp === "string"
                      ? bp
                      : bp.subtitle && bp.fullText
                        ? `${bp.subtitle} ${bp.fullText}`
                        : bp.fullText || bp.subtitle || "";

                    return (
                      <div key={i} className="p-3 rounded-lg border-l-2 border-l-green-500 bg-muted/30">
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                                </div>
                                {typeof bp === "string" ? (
                                  <p className="text-sm">{bp}</p>
                                ) : (
                                  <p className="text-sm">
                                    <span className="font-bold uppercase">{bp.subtitle || `Bullet ${i + 1}`}</span>
                                    {bp.fullText && <span className="text-muted-foreground"> — {bp.fullText}</span>}
                                    {!bp.fullText && bp.sellingPoint && <span className="text-muted-foreground"> — {bp.sellingPoint}</span>}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <CharCountBadge count={fullBullet.length} min={200} max={280} />
                                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`到审核工作台修改卖点 ${i + 1}`} onClick={() => setLocation("/listing/generate")}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            {typeof bp !== "string" && bp.fabeBreakdown && (
                              <div className="grid grid-cols-2 gap-1 mt-2">
                                {Object.entries(bp.fabeBreakdown).map(([key, val]) => (
                                  val ? <div key={key} className="text-[10px] text-muted-foreground"><span className="font-medium uppercase">{key}:</span> {val as string}</div> : null
                                ))}
                              </div>
                            )}
                          </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Description */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-purple-600" />
                    产品描述
                  </CardTitle>
                  {!isEditing && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(listing.description || "", "产品描述")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {listing.description ? (
                  <div className="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: sanitizeListingHtml(listing.description) }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground italic">暂无产品描述</p>
                )}
              </CardContent>
            </Card>

            {/* Search Terms */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="h-4 w-4 text-amber-600" />
                    后台搜索词 (Search Terms)
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {new Blob([(listing.searchTerms) || ""].map(String)).size} / 250 bytes
                    </Badge>
                    {!isEditing && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(listing.searchTerms || "", "搜索词")}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {listing.searchTerms ? (
                  <p className="text-sm font-mono bg-muted/30 p-3 rounded-lg break-all">{listing.searchTerms}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">暂无搜索词</p>
                )}
              </CardContent>
            </Card>

            {/* QA问答 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-teal-600" />
                    QA问答 (Customer Q&A)
                  </CardTitle>
                  {!isEditing && qaContent && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                      const qaText = (Array.isArray(qaContent) ? qaContent : []).map((qa: any, i: number) => `Q${i+1}: ${qa.question}\nA${i+1}: ${qa.answer}`).join('\n\n');
                      copyToClipboard(qaText, "QA问答");
                    }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {qaContent && Array.isArray(qaContent) && qaContent.length > 0 ? (
                  <div className="space-y-3">
                    {qaContent.map((qa: any, i: number) => (
                      <div key={i} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <HelpCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="secondary" className="text-[10px]">Q{i + 1}</Badge>
                              {qa.category && <Badge variant="outline" className="text-[10px]">{qa.category}</Badge>}
                              {qa.priority && <Badge variant="outline" className={`text-[10px] ${qa.priority === 'high' ? 'border-red-300 text-red-600' : qa.priority === 'medium' ? 'border-amber-300 text-amber-600' : 'border-gray-300'}`}>{qa.priority}</Badge>}
                            </div>
                            <p className="text-sm font-medium">{qa.question}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 pl-6">
                          <MessageCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <Badge variant="secondary" className="text-[10px] mb-1">A{i + 1}</Badge>
                            <p className="text-sm text-muted-foreground">{qa.answer}</p>
                          </div>
                        </div>
                        {qa.sourceInsight && (
                          <p className="text-xs text-muted-foreground italic pl-6">💡 {qa.sourceInsight}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8">
                    <MessageCircle className="h-6 w-6 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">暂无QA问答数据</p>
                    <p className="text-xs text-muted-foreground mt-1">请在“Listing生成”页面的Step 5生成QA内容</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Version Info */}
            <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
              <span>版本 {listing.version} · 生成于 {new Date(listing.createdAt).toLocaleString("zh-CN")}</span>
              <Badge variant="secondary">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                当前版本
              </Badge>
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════
              Bilingual Comparison Tab
              ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="bilingual" className="space-y-4">
            {!hasChinese ? (
              <Card className="border-dashed border-orange-300">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Languages className="h-8 w-8 text-orange-400 mb-4" />
                  <p className="text-muted-foreground mb-3">暂无中文翻译</p>
                  <p className="text-xs text-muted-foreground mb-4">旧自动翻译已暂停；当前仅展示已有中文内容</p>
                  {editsConfirmed && (
                    <Button
                      onClick={handleTranslate}
                      disabled title="旧一键翻译已暂停，需受治理译文候选和人工确认"
                      className="bg-orange-600 hover:bg-orange-700"
                    >
                      {translateToChinese.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Languages className="h-4 w-4 mr-2" />
                      )}
                      {translateToChinese.isPending ? "翻译中..." : "执行中英文翻译"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Navigation to scoring */}
                <Card className="border-green-300 bg-green-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <span className="text-sm font-medium text-green-800">中英文翻译已完成，可以前往Listing评分</span>
                      </div>
                      <Button size="sm" onClick={() => setLocation("/listing/scoring")}>
                        <BarChart3 className="h-4 w-4 mr-1" />前往Listing评分
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Title Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Type className="h-4 w-4 text-blue-600" />
                      产品标题（两段式）
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />中英对照
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* English */}
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200 space-y-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(`${listing.title || ""}\n${(listing as any).itemHighlights || ""}`, "英文标题")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div>
                          <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-600 mb-1">Layer 1</Badge>
                          <p className="text-sm font-medium leading-relaxed">{listing.title}</p>
                        </div>
                        {(listing as any).itemHighlights && (
                          <div>
                            <Badge variant="outline" className="text-[9px] border-purple-300 text-purple-600 mb-1">Layer 2</Badge>
                            <p className="text-sm leading-relaxed text-muted-foreground">{(listing as any).itemHighlights}</p>
                          </div>
                        )}
                      </div>
                      {/* Chinese */}
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200 space-y-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(`${listing.titleCn || ""}\n${(listing as any).itemHighlightsCn || ""}`, "中文标题")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div>
                          <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-600 mb-1">Layer 1</Badge>
                          <p className="text-sm font-medium leading-relaxed">{listing.titleCn}</p>
                        </div>
                        {(listing as any).itemHighlightsCn && (
                          <div>
                            <Badge variant="outline" className="text-[9px] border-purple-300 text-purple-600 mb-1">Layer 2</Badge>
                            <p className="text-sm leading-relaxed text-muted-foreground">{(listing as any).itemHighlightsCn}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Bullet Points Comparison - supports up to 9 */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <List className="h-4 w-4 text-green-600" />
                        卖点描述
                        <Badge variant="secondary" className="text-xs">{bulletPointsArray.length} 条</Badge>
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                          <Languages className="h-3 w-3 mr-1" />中英对照
                        </Badge>
                      </CardTitle>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                        const enText = bulletPointsArray.map((bp: any) =>
                          typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || bp.sellingPoint || ""}`
                        ).join("\n\n");
                        const cnText = bulletPointsCnArray.map((bp: any) =>
                          typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || ""}`
                        ).join("\n\n");
                        copyToClipboard(`=== English ===\n${enText}\n\n=== 中文 ===\n${cnText}`, "中英文卖点描述");
                      }}>
                        <Copy className="h-3 w-3 mr-1" />复制全部
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {bulletPointsArray.map((bp: any, i: number) => {
                      const cnBp = bulletPointsCnArray[i];
                      const fullBullet = typeof bp === "string" ? bp : (bp.subtitle && bp.fullText ? `${bp.subtitle} ${bp.fullText}` : bp.fullText || bp.subtitle || "");
                      return (
                        <div key={i} className="rounded-lg border overflow-hidden">
                          <div className="grid grid-cols-1 lg:grid-cols-2">
                            <div className="p-3 bg-blue-50/30 border-b lg:border-b-0 lg:border-r border-blue-200">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Badge variant="secondary" className="text-xs">EN {i + 1}</Badge>
                                <CharCountBadge count={fullBullet.length} min={200} max={280} />
                              </div>
                              {typeof bp === "string" ? (
                                <p className="text-sm">{bp}</p>
                              ) : (
                                <p className="text-sm">
                                  <span className="font-bold">{bp.subtitle || `Bullet ${i + 1}`}</span>
                                  {bp.fullText && <span className="text-muted-foreground"> — {bp.fullText}</span>}
                                  {!bp.fullText && bp.sellingPoint && <span className="text-muted-foreground"> — {bp.sellingPoint}</span>}
                                </p>
                              )}
                            </div>
                            <div className="p-3 bg-orange-50/30">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700">中 {i + 1}</Badge>
                              </div>
                              {cnBp ? (
                                typeof cnBp === "string" ? (
                                  <p className="text-sm">{cnBp}</p>
                                ) : (
                                  <p className="text-sm">
                                    <span className="font-bold">{cnBp.subtitle || `卖点 ${i + 1}`}</span>
                                    {cnBp.fullText && <span className="text-orange-700"> — {cnBp.fullText}</span>}
                                  </p>
                                )
                              ) : (
                                <p className="text-sm text-muted-foreground italic">暂无翻译</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* Description Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4 text-purple-600" />
                      产品描述
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />中英对照
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.description || "", "英文描述")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground"
                          dangerouslySetInnerHTML={{ __html: sanitizeListingHtml(listing.description) }}
                        />
                      </div>
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.descriptionCn || "", "中文描述")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-orange-900"
                          dangerouslySetInnerHTML={{ __html: sanitizeListingHtml(listing.descriptionCn) }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Search Terms Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Key className="h-4 w-4 text-amber-600" />
                      后台搜索词
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />中英对照
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.searchTerms || "", "英文搜索词")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-mono break-all">{listing.searchTerms}</p>
                        <Badge variant="outline" className="text-xs mt-2">
                          {new Blob([listing.searchTerms || ""].map(String)).size} / 250 bytes
                        </Badge>
                      </div>
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.searchTermsCn || "", "中文搜索词")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-mono break-all text-orange-900">{listing.searchTermsCn || "暂无翻译"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* QA Comparison */}
                {(qaContent || qaContentCn) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-teal-600" />
                        QA问答
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                          <Languages className="h-3 w-3 mr-1" />中英对照
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(Array.isArray(qaContent) ? qaContent : []).map((qa: any, i: number) => {
                        const cnQa = qaContentCn && Array.isArray(qaContentCn) ? (qaContentCn as any[])[i] : null;
                        return (
                          <div key={i} className="rounded-lg border overflow-hidden">
                            <div className="grid grid-cols-1 lg:grid-cols-2">
                              <div className="p-3 bg-blue-50/30 border-b lg:border-b-0 lg:border-r border-blue-200">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <Badge variant="secondary" className="text-xs">EN Q{i + 1}</Badge>
                                  {qa.category && <Badge variant="outline" className="text-[10px]">{qa.category}</Badge>}
                                </div>
                                <p className="text-sm font-medium mb-1">{qa.question}</p>
                                <p className="text-sm text-muted-foreground">{qa.answer}</p>
                              </div>
                              <div className="p-3 bg-orange-50/30">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700">中 Q{i + 1}</Badge>
                                </div>
                                {cnQa ? (
                                  <>
                                    <p className="text-sm font-medium mb-1 text-orange-900">{cnQa.question}</p>
                                    <p className="text-sm text-orange-700">{cnQa.answer}</p>
                                  </>
                                ) : (
                                  <p className="text-sm text-muted-foreground italic">暂无翻译</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                {/* Regenerate translation button */}
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={handleTranslate}
                    disabled title="旧一键翻译已暂停，需受治理译文候选和人工确认"
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    {translateToChinese.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Languages className="h-4 w-4 mr-2" />
                    )}
                    {translateToChinese.isPending ? "重新翻译中..." : "重新生成中文翻译"}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════
              Image Advice Tab
              ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="images" className="space-y-4">
            {imageAdvice ? (
              <>
                {/* 图片建议 - Main Image */}
                {imageAdvice.mainImage && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        图片建议 - 首图
                        {imageAdviceCn?.mainImage && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />中英对照
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                              `Concept: ${imageAdvice.mainImage.concept}\nTitle: ${imageAdvice.mainImage.title || ''}\nComposition: ${imageAdvice.mainImage.composition || ''}\nKey Elements: ${(imageAdvice.mainImage.keyElements || []).join(', ')}\nColor Scheme: ${imageAdvice.mainImage.colorScheme ? `Primary: ${imageAdvice.mainImage.colorScheme.primary}, Secondary: ${imageAdvice.mainImage.colorScheme.secondary}, Accent: ${imageAdvice.mainImage.colorScheme.accent}` : ''}\nTips: ${(imageAdvice.mainImage.tips || []).join('; ')}`,
                              "英文首图建议"
                            )}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-blue-700 mb-1">概念</p>
                            <p className="text-sm">{imageAdvice.mainImage.concept}</p>
                          </div>
                          {imageAdvice.mainImage.title && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">标题</p>
                              <p className="text-sm font-semibold">{imageAdvice.mainImage.title}</p>
                            </div>
                          )}
                          {imageAdvice.mainImage.composition && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">构图方式</p>
                              <p className="text-sm">{imageAdvice.mainImage.composition}</p>
                            </div>
                          )}
                          {imageAdvice.mainImage.colorScheme && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">配色方案</p>
                              <div className="flex flex-wrap gap-2">
                                {imageAdvice.mainImage.colorScheme.primary && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: imageAdvice.mainImage.colorScheme.primary.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                    <span className="text-xs">主色: {imageAdvice.mainImage.colorScheme.primary}</span>
                                  </div>
                                )}
                                {imageAdvice.mainImage.colorScheme.secondary && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: imageAdvice.mainImage.colorScheme.secondary.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                    <span className="text-xs">辅色: {imageAdvice.mainImage.colorScheme.secondary}</span>
                                  </div>
                                )}
                                {imageAdvice.mainImage.colorScheme.accent && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: imageAdvice.mainImage.colorScheme.accent.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                    <span className="text-xs">点缀色: {imageAdvice.mainImage.colorScheme.accent}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {Array.isArray(imageAdvice.mainImage.keyElements) && imageAdvice.mainImage.keyElements.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">关键元素</p>
                              <div className="flex flex-wrap gap-1.5">
                                {imageAdvice.mainImage.keyElements.map((e: string, i: number) => (
                                  <Badge key={i} variant="secondary" className="text-xs">{e}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {Array.isArray(imageAdvice.mainImage.tips) && imageAdvice.mainImage.tips.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">拍摄提示</p>
                              <ul className="text-sm space-y-1 text-muted-foreground">
                                {imageAdvice.mainImage.tips.map((t: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2"><span className="text-primary mt-0.5">•</span>{t}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                            {imageAdviceCn?.mainImage && (
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                                `概念: ${imageAdviceCn.mainImage.concept}\n标题: ${imageAdviceCn.mainImage.title || ''}\n构图: ${imageAdviceCn.mainImage.composition || ''}\n关键元素: ${(imageAdviceCn.mainImage.keyElements || []).join(', ')}\n拍摄提示: ${(imageAdviceCn.mainImage.tips || []).join('; ')}`,
                                "中文首图建议"
                              )}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                          {imageAdviceCn?.mainImage ? (
                            <>
                              <div>
                                <p className="text-xs font-medium text-orange-700 mb-1">概念</p>
                                <p className="text-sm text-orange-900">{imageAdviceCn.mainImage.concept}</p>
                              </div>
                              {imageAdviceCn.mainImage.title && (
                                <div>
                                  <p className="text-xs font-medium text-orange-700 mb-1">标题</p>
                                  <p className="text-sm font-semibold text-orange-900">{imageAdviceCn.mainImage.title}</p>
                                </div>
                              )}
                              {imageAdviceCn.mainImage.composition && (
                                <div>
                                  <p className="text-xs font-medium text-orange-700 mb-1">构图方式</p>
                                  <p className="text-sm text-orange-900">{imageAdviceCn.mainImage.composition}</p>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">暂无中文翻译</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Secondary Images */}
                {Array.isArray(imageAdvice.secondaryImages) && imageAdvice.secondaryImages.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">辅图建议 ({imageAdvice.secondaryImages.length} 张)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {imageAdvice.secondaryImages.map((img: any, i: number) => {
                          const imgCn = imageAdviceCn?.secondaryImages?.[i];
                          return (
                            <div key={i} className="rounded-lg border overflow-hidden">
                              <div className="px-4 py-2 bg-muted/50 border-b flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">辅图 {i + 1}</Badge>
                                <span className="text-sm font-medium">{img.purpose || img.concept}</span>
                                {img.title && <span className="text-xs text-muted-foreground">- {img.title}</span>}
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-2">
                                <div className="p-3 bg-blue-50/20 border-b lg:border-b-0 lg:border-r space-y-2">
                                  <span className="text-xs font-semibold text-blue-700 uppercase">English</span>
                                  <p className="text-sm">{img.concept || img.content}</p>
                                  {img.expressionMethod && (
                                    <div>
                                      <p className="text-xs font-medium text-blue-700">表达方式</p>
                                      <p className="text-sm text-muted-foreground">{img.expressionMethod}</p>
                                    </div>
                                  )}
                                  {img.dataVisualization && (
                                    <div>
                                      <p className="text-xs font-medium text-blue-700">数据可视化</p>
                                      <p className="text-sm text-muted-foreground">{img.dataVisualization}</p>
                                    </div>
                                  )}
                                  {Array.isArray(img.keyElements) && img.keyElements.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {img.keyElements.map((e: string, j: number) => (
                                        <Badge key={j} variant="secondary" className="text-[10px]">{e}</Badge>
                                      ))}
                                    </div>
                                  )}
                                  {Array.isArray(img.icons) && img.icons.length > 0 && (
                                    <div>
                                      <p className="text-xs font-medium text-blue-700">图标建议</p>
                                      <div className="flex flex-wrap gap-1">
                                        {img.icons.map((icon: string, j: number) => (
                                          <Badge key={j} variant="outline" className="text-[10px]">{icon}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {img.colorScheme && (
                                    <div className="flex flex-wrap gap-2">
                                      {img.colorScheme.primary && <span className="text-xs">主色: {img.colorScheme.primary}</span>}
                                      {img.colorScheme.secondary && <span className="text-xs">辅色: {img.colorScheme.secondary}</span>}
                                      {img.colorScheme.accent && <span className="text-xs">点缀色: {img.colorScheme.accent}</span>}
                                    </div>
                                  )}
                                  {Array.isArray(img.tips) && img.tips.length > 0 && (
                                    <ul className="text-xs text-muted-foreground space-y-0.5">
                                      {img.tips.map((t: string, j: number) => <li key={j}>• {t}</li>)}
                                    </ul>
                                  )}
                                </div>
                                <div className="p-3 bg-orange-50/20 space-y-2">
                                  <span className="text-xs font-semibold text-orange-700 uppercase">中文</span>
                                  {imgCn ? (
                                    <>
                                      <p className="text-sm text-orange-900">{imgCn.concept || imgCn.content}</p>
                                      {imgCn.expressionMethod && <p className="text-xs text-orange-700">表达方式: {imgCn.expressionMethod}</p>}
                                      {imgCn.dataVisualization && <p className="text-xs text-orange-700">数据可视化: {imgCn.dataVisualization}</p>}
                                      {Array.isArray(imgCn.tips) && imgCn.tips.length > 0 && (
                                        <ul className="text-xs text-orange-700 space-y-0.5">
                                          {imgCn.tips.map((t: string, j: number) => <li key={j}>• {t}</li>)}
                                        </ul>
                                      )}
                                    </>
                                  ) : (
                                    <p className="text-sm text-muted-foreground italic">暂无中文翻译</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* A+ Content */}
                {imageAdvice.aPlusContent && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        A+ 内容建议
                        {imageAdviceCn?.aPlusContent && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />中英对照
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                        <div className="p-3 rounded-lg border bg-blue-50/30 border-blue-200">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English Strategy</span>
                          <p className="text-sm mt-1">{imageAdvice.aPlusContent.overallStrategy}</p>
                        </div>
                        <div className="p-3 rounded-lg border bg-orange-50/30 border-orange-200">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文策略</span>
                          <p className="text-sm mt-1 text-orange-900">{imageAdviceCn?.aPlusContent?.overallStrategy || "暂无中文翻译"}</p>
                        </div>
                      </div>
                      {Array.isArray(imageAdvice.aPlusContent.sections) && imageAdvice.aPlusContent.sections.length > 0 && (
                        <div className="space-y-4">
                          {imageAdvice.aPlusContent.sections.map((section: any, i: number) => {
                            const sectionCn = imageAdviceCn?.aPlusContent?.sections?.[i];
                            return (
                              <div key={i} className="rounded-lg border overflow-hidden">
                                <div className="px-4 py-2 bg-muted/50 border-b flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">{section.type}</Badge>
                                  <span className="text-sm font-medium">{section.purpose}</span>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x">
                                  <div className="p-3 bg-blue-50/20 space-y-2">
                                    <span className="text-xs font-semibold text-blue-700 uppercase">English</span>
                                    <p className="text-sm mt-1">{section.content}</p>
                                    {section.dataVisualization && (
                                      <p className="text-sm mt-1"><span className="text-xs text-blue-600 font-medium">数据可视化:</span> {section.dataVisualization}</p>
                                    )}
                                  </div>
                                  <div className="p-3 bg-orange-50/20 space-y-2">
                                    <span className="text-xs font-semibold text-orange-700 uppercase">中文</span>
                                    <p className="text-sm mt-1 text-orange-900">{sectionCn?.content || "暂无中文翻译"}</p>
                                    {sectionCn?.dataVisualization && (
                                      <p className="text-sm mt-1 text-orange-800"><span className="text-xs text-orange-600 font-medium">数据可视化:</span> {sectionCn.dataVisualization}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Design Guidelines */}
                {imageAdvice.designGuidelines && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Palette className="h-4 w-4 text-violet-600" />
                        整体设计指南
                        {imageAdviceCn?.designGuidelines && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />中英对照
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>统一的品牌视觉规范，确保全套图片风格一致</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200 space-y-3">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          {imageAdvice.designGuidelines.fontRecommendation && (
                            <div className="flex items-start gap-2">
                              <TypeIcon className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-blue-700">推荐字体</p>
                                <p className="text-sm">{imageAdvice.designGuidelines.fontRecommendation}</p>
                              </div>
                            </div>
                          )}
                          {imageAdvice.designGuidelines.overallColorPalette && (
                            <div className="flex items-start gap-2">
                              <Palette className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-blue-700">整体配色方案</p>
                                <p className="text-sm">{imageAdvice.designGuidelines.overallColorPalette}</p>
                              </div>
                            </div>
                          )}
                          {imageAdvice.designGuidelines.brandTone && (
                            <div className="flex items-start gap-2">
                              <Lightbulb className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-blue-700">品牌调性</p>
                                <p className="text-sm">{imageAdvice.designGuidelines.brandTone}</p>
                              </div>
                            </div>
                          )}
                          {imageAdvice.designGuidelines.mobileOptimization && (
                            <div className="flex items-start gap-2">
                              <Smartphone className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-blue-700">手机端优化</p>
                                <p className="text-sm">{imageAdvice.designGuidelines.mobileOptimization}</p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200 space-y-3">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          {imageAdviceCn?.designGuidelines ? (
                            <>
                              {imageAdviceCn.designGuidelines.fontRecommendation && (
                                <div className="flex items-start gap-2">
                                  <TypeIcon className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-orange-700">推荐字体</p>
                                    <p className="text-sm text-orange-900">{imageAdviceCn.designGuidelines.fontRecommendation}</p>
                                  </div>
                                </div>
                              )}
                              {imageAdviceCn.designGuidelines.overallColorPalette && (
                                <div className="flex items-start gap-2">
                                  <Palette className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-orange-700">整体配色方案</p>
                                    <p className="text-sm text-orange-900">{imageAdviceCn.designGuidelines.overallColorPalette}</p>
                                  </div>
                                </div>
                              )}
                              {imageAdviceCn.designGuidelines.brandTone && (
                                <div className="flex items-start gap-2">
                                  <Lightbulb className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-orange-700">品牌调性</p>
                                    <p className="text-sm text-orange-900">{imageAdviceCn.designGuidelines.brandTone}</p>
                                  </div>
                                </div>
                              )}
                              {imageAdviceCn.designGuidelines.mobileOptimization && (
                                <div className="flex items-start gap-2">
                                  <Smartphone className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-orange-700">手机端优化</p>
                                    <p className="text-sm text-orange-900">{imageAdviceCn.designGuidelines.mobileOptimization}</p>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">暂无中文翻译</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Regenerate translation for image advice */}
                {!imageAdviceCn && (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      onClick={handleTranslate}
                      disabled title="旧一键翻译已暂停，需受治理译文候选和人工确认"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                    >
                      {translateToChinese.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Languages className="h-4 w-4 mr-2" />
                      )}
                      生成图片建议中文翻译
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Image className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">暂无图片建议数据</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════
              Version History Tab
              ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  受治理完整快照恢复
                </CardTitle>
                <CardDescription>
                  仅显示已确认、0204 全字段完整快照。旧版本历史只读，不能作为恢复来源。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <p className="font-medium">恢复会以完整快照覆盖当前正式 Listing，而非部分字段回滚。</p>
                  <p className="mt-1 text-xs text-amber-800">
                    必须先从服务端获取 10 分钟有效的全字段 / CAS 预览；最终确认只提交服务端签名令牌，服务端会再次验证权限、快照、全文哈希与版本。
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">已确认完整快照</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshGovernedSnapshots()}
                    disabled={governedSnapshotsQuery.isFetching}
                    aria-label="刷新受治理完整快照"
                  >
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${governedSnapshotsQuery.isFetching ? "animate-spin" : ""}`} />
                    刷新
                  </Button>
                </div>

                {governedSnapshotsQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : governedSnapshotsQuery.isError ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
                    <p className="text-muted-foreground text-sm">受治理完整快照暂不可用</p>
                    <p className="mt-1 max-w-xl text-center text-xs text-muted-foreground">
                      可能尚未部署 0204 完整快照表、当前工作空间无写入权限，或服务端未能验证快照。不会回退到旧部分字段版本。
                    </p>
                    <p className="mt-3 max-w-xl text-center text-xs text-destructive">{governedSnapshotsQuery.error.message}</p>
                  </div>
                ) : !governedSnapshotsQuery.data || governedSnapshotsQuery.data.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <ShieldCheck className="h-8 w-8 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground text-sm">没有可恢复的已确认完整快照</p>
                    <p className="mt-1 max-w-xl text-center text-xs text-muted-foreground">
                      当前项目没有 0204 已审核完整 Listing 快照。请先完成受治理的人审和完整快照写入；旧版本不会用于恢复。
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {governedSnapshotsQuery.data.map((snapshot) => {
                      const isSelected = selectedGovernedSnapshotId === snapshot.id;
                      return (
                        <button
                          key={snapshot.id}
                          type="button"
                          onClick={() => handleGovernedSnapshotSelect(snapshot)}
                          className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isSelected ? "border-emerald-500 bg-emerald-50" : "hover:bg-muted/50"
                          }`}
                          aria-pressed={isSelected}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium">完整快照 #{snapshot.id}</span>
                                <Badge className="bg-emerald-600 text-xs text-white">已确认</Badge>
                                <Badge variant="outline" className="text-xs">内容版本 {snapshot.contentVersion}</Badge>
                                <Badge variant="outline" className="text-xs">Listing v{snapshot.listingVersion}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {formatRestoreTime(snapshot.approvedAt)} 审核 · {snapshot.changeType} · 人审引用 {snapshot.humanApprovalRef}
                              </p>
                            </div>
                            <span className="font-mono text-[10px] text-muted-foreground">{snapshot.fullHash.slice(0, 12)}…</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedGovernedSnapshotId !== null && (
                  <div className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground" role="status">
                    {governedPreviewQuery.isFetching ? (
                      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />正在从服务端读取完整字段并验证 CAS…</span>
                    ) : governedPreviewQuery.isError ? (
                      <span>预览未生成：{governedPreviewQuery.error.message}。陈旧预览已清除，请刷新后重新选择。</span>
                    ) : !governedRestorePreview ? (
                      <span>正在准备服务端恢复预览…</span>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>

            {governedRestorePreview && (
              <Card className={isGovernedRestorePreviewExpired ? "border-destructive" : "border-emerald-300"}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        完整恢复预览：快照 #{governedRestorePreview.preview.sourceSnapshot.id}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        当前正式 Listing v{governedRestorePreview.preview.expectedListingVersion} → 恢复后 v{governedRestorePreview.preview.nextListingVersion}；服务端分配版本与更新时间。
                      </CardDescription>
                    </div>
                    <Badge variant={isGovernedRestorePreviewExpired ? "destructive" : "outline"} className="shrink-0">
                      <Clock3 className="mr-1 h-3.5 w-3.5" />
                      {isGovernedRestorePreviewExpired ? "预览已过期" : `令牌至 ${formatRestoreTime(governedRestorePreview.expiresAt)} 有效`}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg bg-muted/50 p-3 text-sm">
                    <p className="font-medium">将完整恢复的范围（非部分字段回滚）</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {COMPLETE_RESTORE_FIELD_GROUPS.map((group) => (
                        <div key={group.label} className="rounded border bg-background p-2">
                          <p className="text-xs font-medium">{group.label}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {group.fields.map((field) => (
                              <Badge
                                key={field}
                                variant="outline"
                                className={governedRestorePreview.preview.changedFields.includes(field) ? "border-amber-400 text-amber-800" : "text-muted-foreground"}
                              >
                                {restoreFieldLabel(field)}{governedRestorePreview.preview.changedFields.includes(field) ? " · 将变更" : " · 同值恢复"}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      另含身份字段 id、projectId、createdAt；版本与 updatedAt 由服务端在 CAS 成功时分配，不能从浏览器提交。
                    </p>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">服务端检测到的版本差异（{governedRestorePreview.preview.changedFields.length} 项）</p>
                      <span className="text-xs text-muted-foreground">当前哈希 {governedRestorePreview.preview.currentFullHash.slice(0, 12)}…</span>
                    </div>
                    {governedRestorePreview.preview.changedFields.length === 0 ? (
                      <p className="mt-2 rounded border p-3 text-sm text-muted-foreground">内容字段与所选快照相同；仅正式版本与更新时间会由服务端推进。</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {governedRestorePreview.preview.changedFields.map((field) => (
                          <div key={field} className="rounded-lg border p-3">
                            <p className="text-xs font-medium">{restoreFieldLabel(field)}</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <div><p className="text-[11px] text-muted-foreground">当前正式 Listing</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{formatRestoreValue(restorePayloadValue(governedRestorePreview.preview.currentFullPayload, field))}</pre></div>
                              <div><p className="text-[11px] text-muted-foreground">恢复后（所选完整快照）</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-emerald-50 p-2 text-xs">{formatRestoreValue(restorePayloadValue(governedRestorePreview.preview.proposedFullPayload, field))}</pre></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {isGovernedRestorePreviewExpired ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                      <span>10 分钟预览已过期。为避免提交陈旧 CAS，上次预览不能确认。</span>
                      <Button variant="outline" size="sm" onClick={() => void governedPreviewQuery.refetch()}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />重新获取预览
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-sm text-emerald-950">请由具写权限的人工审核以上全部范围和差异后，再进行最终确认。</p>
                      <Button onClick={() => setRestoreConfirmOpen(true)} disabled={governedRestoreMutation.isPending}>
                        <ShieldCheck className="mr-1.5 h-4 w-4" />审核后确认完整恢复
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-purple-600" />旧版本历史（只读）</CardTitle>
                <CardDescription>旧记录可能是部分字段投影；为防止不完整恢复，不提供回滚操作。</CardDescription>
              </CardHeader>
              <CardContent>
                {versionsQuery.isLoading ? <div className="h-16 animate-pulse rounded-lg bg-muted" /> : !versionsQuery.data?.length ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">暂无旧版本历史</p>
                ) : (
                  <div className="space-y-2">
                    {versionsQuery.data.map((version: any) => {
                      const isExpanded = expandedVersionId === version.id;
                      return <div key={version.id} className="rounded-lg border">
                        <button type="button" onClick={() => setExpandedVersionId(isExpanded ? null : version.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50">
                          <span><span className="font-medium text-sm">#{version.versionNumber}</span><span className="ml-2 text-xs text-muted-foreground">{version.changeType} · {version.changeDescription || "无描述"}</span></span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">{formatRestoreTime(version.createdAt)}{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                        </button>
                        {isExpanded && <div className="grid gap-2 border-t p-3 text-sm"><p><span className="text-muted-foreground">标题：</span>{version.title || "（空）"}</p><p className="line-clamp-4"><span className="text-muted-foreground">描述：</span>{version.description || "（空）"}</p></div>}
                      </div>;
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>最终确认完整快照恢复</DialogTitle>
                  <DialogDescription>
                    此操作将恢复快照 #{governedRestorePreview?.preview.sourceSnapshot.id} 的全部正式 Listing 字段。浏览器仅提交服务端签名的短期确认令牌；服务端会再做权限与 CAS 校验，冲突时不会覆盖当前内容。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRestoreConfirmOpen(false)}>取消</Button>
                  <Button
                    variant="destructive"
                    onClick={submitGovernedRestore}
                    disabled={governedRestoreMutation.isPending || isGovernedRestorePreviewExpired || !governedRestorePreview?.restoreToken}
                  >
                    {governedRestoreMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 mr-2" />
                    )}
                    {governedRestoreMutation.isPending ? "正在提交服务端确认…" : "我已审核，确认完整恢复"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
