import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ClipboardCheck,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  AlertCircle,
  Lightbulb,
  Image,
  BookOpen,
  Video,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS, MANAGER_ROLES } from "@shared/const";

type ReviewTab = "pending" | "reviewed" | "my_submissions";
type KbType = "all" | "product" | "listing" | "image" | "skill" | "video";

const KB_TYPE_LABELS: Record<string, string> = {
  product: "产品创意",
  listing: "Listing文案",
  image: "图片知识",
  skill: "运营SOP",
  video: "视频知识",
};

const KB_TYPE_ICONS: Record<string, any> = {
  product: Lightbulb,
  listing: FileText,
  image: Image,
  skill: BookOpen,
  video: Video,
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "草稿", color: "bg-gray-100 text-gray-700", icon: FileText },
  pending: { label: "待审核", color: "bg-amber-100 text-amber-700", icon: Clock },
  pending_review: { label: "待审核", color: "bg-amber-100 text-amber-700", icon: Clock },
  approved: { label: "已通过", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  rejected: { label: "已拒绝", color: "bg-red-100 text-red-700", icon: XCircle },
};

export default function ReviewCenter() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ReviewTab>("pending");
  const [kbTypeFilter, setKbTypeFilter] = useState<KbType>("all");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewItem, setReviewItem] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");

  const isManager = user && MANAGER_ROLES.includes(user.role as any);

  // Queries
  const statsQuery = trpc.kbReview.stats.useQuery();
  const pendingQuery = trpc.kbReview.listPending.useQuery(
    { type: kbTypeFilter === "all" ? undefined : kbTypeFilter },
    { enabled: activeTab === "pending" }
  );
  const reviewedQuery = trpc.kbReview.listReviewed.useQuery(
    { type: kbTypeFilter === "all" ? undefined : kbTypeFilter, page: 1, pageSize: 50 },
    { enabled: activeTab === "reviewed" }
  );
  const mySubmissionsQuery = trpc.kbReview.mySubmissions.useQuery(
    { type: kbTypeFilter === "all" ? undefined : kbTypeFilter },
    { enabled: activeTab === "my_submissions" }
  );

  // Mutations
  const approveMutation = trpc.kbReview.approve.useMutation({
    onSuccess: () => {
      toast.success("审核通过");
      pendingQuery.refetch();
      reviewedQuery.refetch();
      statsQuery.refetch();
      setReviewDialogOpen(false);
      setReviewNote("");
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMutation = trpc.kbReview.reject.useMutation({
    onSuccess: () => {
      toast.success("已驳回");
      pendingQuery.refetch();
      reviewedQuery.refetch();
      statsQuery.refetch();
      setReviewDialogOpen(false);
      setReviewNote("");
    },
    onError: (e) => toast.error(e.message),
  });

  const batchApproveMutation = trpc.kbReview.batchApprove.useMutation({
    onSuccess: (data) => {
      toast.success(`批量通过 ${data.successCount} 项`);
      pendingQuery.refetch();
      statsQuery.refetch();
      setSelectedItems(new Set());
    },
    onError: (e) => toast.error(e.message),
  });

  const batchRejectMutation = trpc.kbReview.batchReject.useMutation({
    onSuccess: (data) => {
      toast.success(`批量驳回 ${data.successCount} 项`);
      pendingQuery.refetch();
      statsQuery.refetch();
      setSelectedItems(new Set());
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;

  const currentItems: any[] = useMemo(() => {
    if (activeTab === "pending") {
      const d = pendingQuery.data as any;
      return d?.items || (Array.isArray(d) ? d : []);
    }
    if (activeTab === "reviewed") {
      const d = reviewedQuery.data as any;
      return d?.items || (Array.isArray(d) ? d : []);
    }
    const d = mySubmissionsQuery.data as any;
    return Array.isArray(d) ? d : (d?.items || []);
  }, [activeTab, pendingQuery.data, reviewedQuery.data, mySubmissionsQuery.data]);

  const handleReview = (item: any, action: "approve" | "reject") => {
    setReviewItem(item);
    setReviewAction(action);
    setReviewNote("");
    setReviewDialogOpen(true);
  };

  const confirmReview = () => {
    if (!reviewItem) return;
    if (reviewAction === "approve") {
      approveMutation.mutate({
        type: reviewItem.type,
        id: reviewItem.id,
        reviewNote: reviewNote || undefined,
      });
    } else {
      rejectMutation.mutate({
        type: reviewItem.type,
        id: reviewItem.id,
        reviewNote: reviewNote || "审核不通过",
      });
    }
  };

  const handleBatchAction = (action: "approve" | "reject") => {
    const items = Array.from(selectedItems).map(key => {
      const [type, id] = key.split(":");
      return { type: type as "product" | "listing" | "image" | "skill" | "video", id: Number(id) };
    });
    if (action === "approve") {
      batchApproveMutation.mutate({ items });
    } else {
      batchRejectMutation.mutate({ items, reviewNote: "批量驳回" });
    }
  };

  const toggleSelect = (key: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === currentItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(currentItems.map((item: any) => `${item.kbType}:${item.id}`)));
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7 text-primary" />
            审核中心
          </h1>
          <p className="text-muted-foreground mt-1">管理知识库内容的审核流程</p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-700">{stats.totalPending}</p>
                <p className="text-xs text-amber-600">待审核</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-700">{stats.totalApproved}</p>
                <p className="text-xs text-emerald-600">已通过</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-700">{stats.totalRejected}</p>
                <p className="text-xs text-red-600">已拒绝</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-700">{(stats.product?.draft || 0) + (stats.listing?.draft || 0) + (stats.image?.draft || 0) + (stats.skill?.draft || 0) + (stats.video?.draft || 0)}</p>
                <p className="text-xs text-blue-600">草稿</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs + Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
          {[
            { id: "pending" as ReviewTab, label: "待审核", icon: Clock, count: stats?.totalPending },
            { id: "reviewed" as ReviewTab, label: "已审核", icon: CheckCircle2, count: (stats?.totalApproved || 0) + (stats?.totalRejected || 0) },
            { id: "my_submissions" as ReviewTab, label: "我的提交", icon: FileText },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedItems(new Set()); }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count !== undefined && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {tab.count}
                </Badge>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={kbTypeFilter} onValueChange={(v) => setKbTypeFilter(v as KbType)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {Object.entries(KB_TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Batch Actions */}
      {activeTab === "pending" && isManager && selectedItems.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
          <span className="text-sm font-medium">已选择 {selectedItems.size} 项</span>
          <Button
            size="sm"
            variant="outline"
            className="text-emerald-600 border-emerald-300 hover:bg-emerald-50"
            onClick={() => handleBatchAction("approve")}
            disabled={batchApproveMutation.isPending}
          >
            <ThumbsUp className="h-4 w-4 mr-1" />
            批量通过
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 border-red-300 hover:bg-red-50"
            onClick={() => handleBatchAction("reject")}
            disabled={batchRejectMutation.isPending}
          >
            <ThumbsDown className="h-4 w-4 mr-1" />
            批量驳回
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedItems(new Set())}>
            取消选择
          </Button>
        </div>
      )}

      {/* Items List */}
      <div className="space-y-3">
        {currentItems.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-muted-foreground">
                {activeTab === "pending" ? "暂无待审核内容" :
                 activeTab === "reviewed" ? "暂无审核记录" : "暂无提交记录"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {activeTab === "pending" && isManager && (
              <div className="flex items-center gap-2 px-1">
                <Checkbox
                  checked={selectedItems.size === currentItems.length && currentItems.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm text-muted-foreground">全选</span>
              </div>
            )}
            {currentItems.map((item: any) => {
              const key = `${item.type}:${item.id}`;
              const statusConf = STATUS_CONFIG[item.reviewStatus || item.status || "draft"];
              const KbIcon = KB_TYPE_ICONS[item.type] || FileText;
              return (
                <Card key={key} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {activeTab === "pending" && isManager && (
                        <Checkbox
                          checked={selectedItems.has(key)}
                          onCheckedChange={() => toggleSelect(key)}
                          className="mt-1"
                        />
                      )}
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <KbIcon className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-foreground truncate">
                            {item.title || item.asin || `#${item.id}`}
                          </h3>
                          <Badge className={`text-xs ${statusConf?.color || "bg-gray-100"}`}>
                            {statusConf?.label || "未知"}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {KB_TYPE_LABELS[item.type] || item.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>提交人: {item.submitterName || "未知"}</span>
                          {item.reviewerName && <span>审核人: {item.reviewerName}</span>}
                          <span>
                            {new Date(item.updatedAt || item.createdAt).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                        {item.reviewNote && (
                          <p className="text-xs text-muted-foreground mt-1 bg-muted/50 rounded px-2 py-1">
                            审核备注: {item.reviewNote}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {activeTab === "pending" && isManager && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                              onClick={() => handleReview(item, "approve")}
                            >
                              <ThumbsUp className="h-4 w-4 mr-1" />
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-300 hover:bg-red-50"
                              onClick={() => handleReview(item, "reject")}
                            >
                              <ThumbsDown className="h-4 w-4 mr-1" />
                              驳回
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {reviewAction === "approve" ? (
                <ThumbsUp className="h-5 w-5 text-emerald-600" />
              ) : (
                <ThumbsDown className="h-5 w-5 text-red-600" />
              )}
              {reviewAction === "approve" ? "确认通过" : "确认驳回"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {reviewItem && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="font-medium text-sm">{reviewItem.title || reviewItem.asin || `#${reviewItem.id}`}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {KB_TYPE_LABELS[reviewItem.type]} · 提交人: {reviewItem.submitterName}
                </p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                审核备注 {reviewAction === "reject" && <span className="text-red-500">*</span>}
              </label>
              <Textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder={reviewAction === "approve" ? "可选：添加审核备注..." : "请填写驳回原因..."}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={confirmReview}
              disabled={
                (reviewAction === "reject" && !reviewNote.trim()) ||
                approveMutation.isPending ||
                rejectMutation.isPending
              }
              className={reviewAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
            >
              {(approveMutation.isPending || rejectMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              {reviewAction === "approve" ? "确认通过" : "确认驳回"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
