import { useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, Search, TrendingUp, Youtube, Globe, MessageSquare,
  Rocket, Loader2, CheckCircle, XCircle, Clock, Pencil, Trash2,
  RefreshCw, Lock, Unlock, FileText, Sparkles,
} from "lucide-react";

// Source type config
const SOURCE_CONFIGS = [
  {
    type: "google_trends" as const,
    label: "Google趋势",
    icon: TrendingUp,
    color: "text-blue-500",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    description: "市场容量/搜索热度分析",
    placeholder: "输入产品关键词，如 ceiling fan light",
  },
  {
    type: "youtube" as const,
    label: "YouTube",
    icon: Youtube,
    color: "text-red-500",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    description: "KOL内容及评论分析",
    placeholder: "输入产品关键词，如 best ceiling fan with light",
  },
  {
    type: "tiktok" as const,
    label: "TikTok",
    icon: () => (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.1a8.16 8.16 0 0 0 4.76 1.52v-3.4c-.96 0-1.86-.22-2.67-.6l-.33.07z" />
      </svg>
    ),
    color: "text-pink-500",
    bgColor: "bg-pink-50",
    borderColor: "border-pink-200",
    description: "短视频趋势及达人分析",
    placeholder: "输入产品关键词，如 fan light review",
  },
  {
    type: "facebook" as const,
    label: "Facebook",
    icon: () => (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    description: "竞品站外推广分析",
    placeholder: "输入产品或品牌关键词",
  },
  {
    type: "independent_site" as const,
    label: "独立站",
    icon: Globe,
    color: "text-green-500",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    description: "竞品独立站调研",
    placeholder: "输入竞品网址，如 example.com 或关键词",
  },
  {
    type: "reddit" as const,
    label: "Reddit",
    icon: MessageSquare,
    color: "text-orange-500",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
    description: "帖子评论分析（痛点/需求）",
    placeholder: "输入产品关键词，如 ceiling fan noise",
  },
  {
    type: "crowdfunding" as const,
    label: "众筹网站",
    icon: Rocket,
    color: "text-purple-500",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    description: "新品趋势发现",
    placeholder: "输入产品关键词，如 smart fan",
  },
];

type SourceType = typeof SOURCE_CONFIGS[number]["type"];

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: any; label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { icon: Clock, label: "等待中", variant: "secondary" },
    running: { icon: Loader2, label: "分析中", variant: "default" },
    completed: { icon: CheckCircle, label: "已完成", variant: "outline" },
    failed: { icon: XCircle, label: "失败", variant: "destructive" },
  };
  const c = config[status] || config.pending;
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className="gap-1">
      <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
      {c.label}
    </Badge>
  );
}

export default function DevOffsiteAnalysis() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const projectId = Number(params.id);

  const [activeSource, setActiveSource] = useState<SourceType>("google_trends");
  const [keyword, setKeyword] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  // Queries
  const projectQ = trpc.devProject.getById.useQuery({ id: projectId });
  const analysesQ = trpc.offsiteAnalysis.list.useQuery({ projectId });

  // Mutations
  const analyzeMut = trpc.offsiteAnalysis.analyze.useMutation({
    onSuccess: () => {
      analysesQ.refetch();
      setKeyword("");
      toast.success("分析任务已启动");
    },
    onError: (e) => toast.error(`分析失败: ${e.message}`),
  });

  const editMut = trpc.offsiteAnalysis.edit.useMutation({
    onSuccess: () => {
      analysesQ.refetch();
      setEditingId(null);
      toast.success("编辑已保存");
    },
  });

  const confirmMut = trpc.offsiteAnalysis.confirm.useMutation({
    onSuccess: () => {
      analysesQ.refetch();
      toast.success("分析已确认锁定");
    },
  });

  const unconfirmMut = trpc.offsiteAnalysis.unconfirm.useMutation({
    onSuccess: () => {
      analysesQ.refetch();
      toast.success("已解锁，可重新编辑");
    },
  });

  const deleteMut = trpc.offsiteAnalysis.delete.useMutation({
    onSuccess: () => {
      analysesQ.refetch();
      toast.success("已删除");
    },
  });

  const reanalyzeMut = trpc.offsiteAnalysis.reanalyze.useMutation({
    onSuccess: () => {
      analysesQ.refetch();
      toast.success("AI分析已重新生成");
    },
  });

  const summaryMut = trpc.offsiteAnalysis.generateSummary.useMutation({
    onSuccess: (data) => {
      toast.success(`综合总结已生成（基于${data.sourcesCount}个数据源）`);
    },
    onError: (e) => toast.error(`生成失败: ${e.message}`),
  });

  // Filter analyses by active source
  const filteredAnalyses = useMemo(() => {
    return (analysesQ.data || []).filter(a => a.sourceType === activeSource);
  }, [analysesQ.data, activeSource]);

  // Count by source
  const countBySource = useMemo(() => {
    const counts: Record<string, number> = {};
    (analysesQ.data || []).forEach(a => {
      counts[a.sourceType] = (counts[a.sourceType] || 0) + 1;
    });
    return counts;
  }, [analysesQ.data]);

  const confirmedCount = useMemo(() => {
    return (analysesQ.data || []).filter(a => a.aiAnalysisConfirmed).length;
  }, [analysesQ.data]);

  const activeConfig = SOURCE_CONFIGS.find(s => s.type === activeSource)!;

  const handleAnalyze = () => {
    if (!keyword.trim()) {
      toast.error("请输入关键词");
      return;
    }
    analyzeMut.mutate({ projectId, sourceType: activeSource, keyword: keyword.trim() });
  };

  const handleStartEdit = (analysis: any) => {
    setEditingId(analysis.id);
    setEditText(analysis.editedAnalysis || analysis.aiAnalysis || "");
  };

  const handleSaveEdit = () => {
    if (editingId === null) return;
    editMut.mutate({ id: editingId, editedAnalysis: editText });
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/dev/project/${projectId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              站外分析
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {projectQ.data?.name || "加载中..."} - 多平台数据抓取与AI分析
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <FileText className="w-3 h-3" />
            已确认 {confirmedCount}/{(analysesQ.data || []).length}
          </Badge>
          {confirmedCount > 0 && (
            <Button
              size="sm"
              onClick={() => summaryMut.mutate({ projectId })}
              disabled={summaryMut.isPending}
            >
              {summaryMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              生成综合总结
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left sidebar - Source tabs */}
        <div className="w-56 shrink-0 space-y-1">
          {SOURCE_CONFIGS.map((src) => {
            const Icon = src.icon;
            const count = countBySource[src.type] || 0;
            const isActive = activeSource === src.type;
            return (
              <button
                key={src.type}
                onClick={() => setActiveSource(src.type)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isActive
                    ? `${src.bgColor} ${src.borderColor} border font-medium`
                    : "hover:bg-muted"
                }`}
              >
                <Icon className={`w-5 h-5 ${src.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{src.label}</div>
                  <div className="text-xs text-muted-foreground">{src.description}</div>
                </div>
                {count > 0 && (
                  <Badge variant="secondary" className="text-xs">{count}</Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Search input */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder={activeConfig.placeholder}
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  />
                </div>
                <Button
                  onClick={handleAnalyze}
                  disabled={analyzeMut.isPending || !keyword.trim()}
                >
                  {analyzeMut.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4 mr-1" />
                  )}
                  开始分析
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                输入关键词后，系统将自动抓取{activeConfig.label}数据并进行AI智能分析
              </p>
            </CardContent>
          </Card>

          {/* Analysis results */}
          {filteredAnalyses.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <div className={`w-16 h-16 rounded-full ${activeConfig.bgColor} flex items-center justify-center mx-auto mb-4`}>
                  {(() => { const Icon = activeConfig.icon; return <Icon className={`w-8 h-8 ${activeConfig.color}`} />; })()}
                </div>
                <h3 className="text-lg font-medium mb-2">暂无{activeConfig.label}分析记录</h3>
                <p className="text-muted-foreground text-sm">
                  输入关键词开始第一次{activeConfig.label}数据分析
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredAnalyses.map((analysis) => (
              <Card key={analysis.id} className={analysis.aiAnalysisConfirmed ? "border-green-200 bg-green-50/30" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{analysis.keyword}</CardTitle>
                      <StatusBadge status={analysis.status} />
                      {analysis.aiAnalysisConfirmed ? (
                        <Badge variant="outline" className="gap-1 text-green-600 border-green-300">
                          <Lock className="w-3 h-3" /> 已确认
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {analysis.status === "completed" && !analysis.aiAnalysisConfirmed && (
                        <>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => reanalyzeMut.mutate({ id: analysis.id })}
                            disabled={reanalyzeMut.isPending}
                            title="重新AI分析"
                          >
                            <RefreshCw className={`w-4 h-4 ${reanalyzeMut.isPending ? "animate-spin" : ""}`} />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => handleStartEdit(analysis)}
                            title="编辑"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="text-green-600"
                            onClick={() => confirmMut.mutate({ id: analysis.id })}
                            title="确认锁定"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {analysis.aiAnalysisConfirmed ? (
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => unconfirmMut.mutate({ id: analysis.id })}
                          title="解锁编辑"
                        >
                          <Unlock className="w-4 h-4" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost" size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("确定删除该分析记录？")) {
                            deleteMut.mutate({ id: analysis.id });
                          }
                        }}
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>
                    {new Date(analysis.createdAt).toLocaleString("zh-CN")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {analysis.status === "running" && (
                    <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>正在抓取数据并进行AI分析，请稍候...</span>
                    </div>
                  )}
                  {analysis.status === "failed" && (
                    <div className="text-destructive text-sm py-4">
                      <p className="font-medium">分析失败</p>
                      <p>{analysis.errorMessage || "未知错误"}</p>
                    </div>
                  )}
                  {analysis.status === "completed" && editingId === analysis.id && (
                    <div className="space-y-3">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={15}
                        className="font-mono text-sm"
                      />
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                          取消
                        </Button>
                        <Button size="sm" onClick={handleSaveEdit} disabled={editMut.isPending}>
                          {editMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                          保存编辑
                        </Button>
                      </div>
                    </div>
                  )}
                  {analysis.status === "completed" && editingId !== analysis.id && (
                    <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap text-sm leading-relaxed">
                      {analysis.editedAnalysis || analysis.aiAnalysis || "无分析结果"}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}

          {/* Summary section */}
          {summaryMut.data && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  站外分析综合总结
                </CardTitle>
                <CardDescription>
                  基于 {summaryMut.data.sourcesCount} 个已确认数据源的交叉分析
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap text-sm leading-relaxed">
                  {String(summaryMut.data.summary || '')}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
