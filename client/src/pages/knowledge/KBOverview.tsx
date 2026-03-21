import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Loader2, Search, Lightbulb, FileText, Image, BookOpen, Video,
  ArrowRight, Sparkles, Database, ChevronRight, Zap, Brain,
  UserCheck, Archive, Bot, TrendingUp, ExternalLink, Code2, Copy,
  Globe, Package, Layers, ThumbsUp, ThumbsDown, AlertTriangle,
  MessageSquare, Rss, BarChart3,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { toast } from "sonner";

const modules = [
  { key: "products", title: "优秀产品创意库", icon: Lightbulb, color: "from-amber-500 to-orange-500", bgColor: "bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30", iconBg: "bg-amber-100 dark:bg-amber-900/40", iconColor: "text-amber-600 dark:text-amber-400", path: "/knowledge/products", desc: "收录优秀产品创意案例，AI分析产品创新方法论，为选品和产品开发提供参考", statsKey: "productCount" },
  { key: "listings", title: "优秀Listing文案库", icon: FileText, color: "from-blue-500 to-cyan-500", bgColor: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30", iconBg: "bg-emerald-100 dark:bg-emerald-900/40", iconColor: "text-emerald-600 dark:text-emerald-400", path: "/knowledge/listings", desc: "收录高转化率Listing文案，AI从A9算法、FABE结构、COSMO场景等维度深度分析", statsKey: "listingCount" },
  { key: "images", title: "优秀图片知识库", icon: Image, color: "from-purple-500 to-pink-500", bgColor: "bg-purple-50 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-800/30", iconBg: "bg-purple-100 dark:bg-purple-900/40", iconColor: "text-purple-600 dark:text-purple-400", path: "/knowledge/images", desc: "收录优秀产品图片，AI进行12维度视觉分析，支持四维标签筛选浏览", statsKey: "imageSetCount" },
  { key: "skills", title: "运营SOP知识库", icon: BookOpen, color: "from-emerald-500 to-teal-500", bgColor: "bg-blue-50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/30", iconBg: "bg-blue-100 dark:bg-blue-900/40", iconColor: "text-blue-600 dark:text-blue-400", path: "/knowledge/skills", desc: "沉淀运营干货、SOP文档和复盘报告，作为RAG知识源提升AI建议质量", statsKey: "skillCount" },
  { key: "videos", title: "优秀视频知识库", icon: Video, color: "from-red-500 to-rose-500", bgColor: "bg-rose-50 dark:bg-rose-950/20 border-rose-200/50 dark:border-rose-800/30", iconBg: "bg-rose-100 dark:bg-rose-900/40", iconColor: "text-rose-600 dark:text-rose-400", path: "/knowledge/videos", desc: "收录优秀产品视频，AI分析黄金前3秒、脚本结构和转化锚点", statsKey: "videoCount" },
];

const valueChainSteps = [
  { icon: Zap, label: "采集", desc: "ASIN/链接/文件导入", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/40", ringColor: "ring-blue-200 dark:ring-blue-800", gradient: "from-blue-500 to-blue-600" },
  { icon: Brain, label: "AI分析", desc: "多维度深度分析", color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-100 dark:bg-purple-900/40", ringColor: "ring-purple-200 dark:ring-purple-800", gradient: "from-purple-500 to-purple-600" },
  { icon: UserCheck, label: "人工确认", desc: "编辑审核调整", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/40", ringColor: "ring-amber-200 dark:ring-amber-800", gradient: "from-amber-500 to-amber-600" },
  { icon: Archive, label: "入库", desc: "结构化存储", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/40", ringColor: "ring-emerald-200 dark:ring-emerald-800", gradient: "from-emerald-500 to-emerald-600" },
  { icon: Bot, label: "被AI调用", desc: "RAG知识增强", color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-100 dark:bg-rose-900/40", ringColor: "ring-rose-200 dark:ring-rose-800", gradient: "from-rose-500 to-rose-600" },
  { icon: TrendingUp, label: "持续进化", desc: "反馈优化迭代", color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-100 dark:bg-cyan-900/40", ringColor: "ring-cyan-200 dark:ring-cyan-800", gradient: "from-cyan-500 to-cyan-600" },
];

const crossModuleCalls = [
  { caller: "Listing工具", action: "生成文案时参考优秀文案", target: "Listing文案库", targetPath: "/knowledge/listings", dotColor: "bg-blue-500", apiEndpoint: "kbSearch.search", apiDesc: "query: 关键词 → 返回匹配的Listing文案记录" },
  { caller: "产品开发", action: "产品画像时参考创意案例", target: "产品创意库", targetPath: "/knowledge/products", dotColor: "bg-amber-500", apiEndpoint: "kbProducts.list", apiDesc: "返回全部产品创意记录，支持按ASIN/品类筛选" },
  { caller: "Listing工具", action: "图片设计时参考优秀案例", target: "图片知识库", targetPath: "/knowledge/images", dotColor: "bg-purple-500", apiEndpoint: "kbImages.listSets", apiDesc: "返回图片集列表，支持按类目/色系/图片类型/设计风格筛选" },
  { caller: "运营工具", action: "广告优化时参考SOP", target: "运营SOP库", targetPath: "/knowledge/skills", dotColor: "bg-emerald-500", apiEndpoint: "kbSkills.list", apiDesc: "返回全部SOP文档，含AI摘要和关键步骤" },
  { caller: "售后工具", action: "客服回复时参考话术", target: "运营SOP库", targetPath: "/knowledge/skills", dotColor: "bg-rose-500", apiEndpoint: "kbSearch.search", apiDesc: "query: 客服话术 → 跨库搜索匹配的SOP和文案" },
  { caller: "Listing工具", action: "视频脚本创作参考", target: "视频知识库", targetPath: "/knowledge/videos", dotColor: "bg-red-500", apiEndpoint: "kbVideos.list", apiDesc: "返回全部视频分析记录，含脚本结构和转化锚点" },
];

// API interface documentation for cross-module calling
const apiInterfaces = [
  { name: "kbSearch.search", method: "tRPC query", input: '{ query: string }', output: "Array<{ id, type, title, asin, status }>", desc: "跨模块全文搜索，返回所有匹配的知识库记录" },
  { name: "kbSearch.stats", method: "tRPC query", input: "无", output: "{ productCount, listingCount, imageSetCount, skillCount, videoCount, totalCount }", desc: "获取各子库统计数据" },
  { name: "kbProducts.list", method: "tRPC query", input: "无", output: "Array<产品创意记录>", desc: "获取产品创意库全部记录" },
  { name: "kbListings.list", method: "tRPC query", input: "无", output: "Array<Listing文案记录>", desc: "获取Listing文案库全部记录" },
  { name: "kbImages.listSets", method: "tRPC query", input: "无", output: "Array<图片集记录>", desc: "获取图片知识库全部图片集" },
  { name: "kbSkills.list", method: "tRPC query", input: "无", output: "Array<SOP文档记录>", desc: "获取运营SOP库全部记录" },
  { name: "kbVideos.list", method: "tRPC query", input: "无", output: "Array<视频分析记录>", desc: "获取视频知识库全部记录" },
];

// ─── AI Feedback Dashboard Sub-Component ────────────────

function AiFeedbackDashboard() {
  const [, navigate] = useLocation();
  const { data: overviewStats, isLoading: statsLoading } = trpc.kbFeedback.getOverviewStats.useQuery();
  const { data: topReferenced } = trpc.kbFeedback.getTopReferenced.useQuery({ limit: 5 });

  const feedbackDist = overviewStats?.feedbackDistribution || { helpful: 0, irrelevant: 0, wrong: 0 };
  const totalFeedback = (feedbackDist.helpful || 0) + (feedbackDist.irrelevant || 0) + (feedbackDist.wrong || 0);
  const helpfulPct = totalFeedback > 0 ? Math.round(((feedbackDist.helpful || 0) / totalFeedback) * 100) : 0;

  const typeColorMap: Record<string, string> = {
    skill: "bg-blue-500",
    listing: "bg-emerald-500",
    product: "bg-amber-500",
    image: "bg-purple-500",
    video: "bg-rose-500",
  };
  const typeLabelMap: Record<string, string> = {
    skill: "运营SOP",
    listing: "Listing文案",
    product: "产品创意",
    image: "图片知识",
    video: "视频知识",
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Quick Entry Cards */}
      <Card
        className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20"
        onClick={() => navigate("/knowledge/bot")}
      >
        <CardContent className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-primary text-white shadow-sm">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">AI知识助手</h3>
              <p className="text-xs text-muted-foreground">对话式检索知识库</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {statsLoading ? "..." : overviewStats?.totalConversations || 0} 次对话
              </span>
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                {statsLoading ? "..." : overviewStats?.totalCallLogs || 0} 次检索
              </span>
            </div>
            <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 p-0 text-primary hover:text-primary">
              开始对话 <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card
        className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/20 dark:to-orange-900/10 border-orange-200/50 dark:border-orange-800/30"
        onClick={() => navigate("/knowledge/intel")}
      >
        <CardContent className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-sm">
              <Rss className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">情报推荐中心</h3>
              <p className="text-xs text-muted-foreground">外部情报采集与AI评估</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Rss className="h-3 w-3" />
                {statsLoading ? "..." : overviewStats?.totalIntelSources || 0} 个情报源
              </span>
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {statsLoading ? "..." : overviewStats?.totalIntelItems || 0} 条情报
              </span>
            </div>
            <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 p-0 text-orange-600 hover:text-orange-600">
              查看情报 <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Feedback Stats Card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 text-white shadow-sm">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">反馈统计</h3>
              <p className="text-xs text-muted-foreground">知识库质量闭环</p>
            </div>
          </div>

          {totalFeedback > 0 ? (
            <div className="space-y-2">
              {/* Feedback bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden flex">
                  {(feedbackDist.helpful || 0) > 0 && (
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${((feedbackDist.helpful || 0) / totalFeedback) * 100}%` }}
                    />
                  )}
                  {(feedbackDist.irrelevant || 0) > 0 && (
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{ width: `${((feedbackDist.irrelevant || 0) / totalFeedback) * 100}%` }}
                    />
                  )}
                  {(feedbackDist.wrong || 0) > 0 && (
                    <div
                      className="h-full bg-red-500 transition-all"
                      style={{ width: `${((feedbackDist.wrong || 0) / totalFeedback) * 100}%` }}
                    />
                  )}
                </div>
                <span className="text-xs font-medium text-emerald-600">{helpfulPct}%</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ThumbsUp className="h-3 w-3 text-emerald-500" />
                  有用 {feedbackDist.helpful || 0}
                </span>
                <span className="flex items-center gap-1">
                  <ThumbsDown className="h-3 w-3 text-amber-500" />
                  不相关 {feedbackDist.irrelevant || 0}
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-red-500" />
                  错误 {feedbackDist.wrong || 0}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无反馈数据，使用AI助手后可对引用内容进行评价</p>
          )}

          {/* Top Referenced */}
          {topReferenced && (topReferenced as any[]).length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-[10px] font-medium text-muted-foreground mb-1.5">热门引用 TOP 5</p>
              <div className="space-y-1">
                {(topReferenced as any[]).slice(0, 5).map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-4">{idx + 1}.</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${typeColorMap[item.kbItemType] || "bg-gray-400"}`} />
                    <span className="truncate flex-1">{item.title}</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1">
                      {typeLabelMap[item.kbItemType] || item.kbItemType}
                    </Badge>
                    <span className="text-muted-foreground text-[10px]">{item.callCount}次</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function KBOverview() {
  const [, navigate] = useLocation();
  const { data: stats, isLoading } = trpc.kbSearch.stats.useQuery();
  const [searchQuery, setSearchQuery] = useState("");
  const [showApiPanel, setShowApiPanel] = useState(false);
  const { data: searchResults, isFetching: isSearching } = trpc.kbSearch.search.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length > 1 }
  );

  const getCount = (statsKey: string) => {
    if (!stats) return 0;
    return (stats as any)[statsKey] || 0;
  };

  const totalCount = (stats as any)?.totalCount || 0;
  const [asinPanorama, setAsinPanorama] = useState(false);
  const [panoramaAsin, setPanoramaAsin] = useState("");

  // Aggregate unique ASINs from all knowledge bases
  const { data: allProducts } = trpc.kbProducts.list.useQuery();
  const { data: allListings } = trpc.kbListings.list.useQuery();
  const { data: allImageSets } = trpc.kbImages.listSets.useQuery();
  const { data: allVideos } = trpc.kbVideos.list.useQuery();

  const asinMap = (() => {
    const map: Record<string, { product?: any; listing?: any; imageSet?: any; video?: any }> = {};
    (allProducts as any[] || []).forEach((p: any) => {
      if (p.asin) { if (!map[p.asin]) map[p.asin] = {}; map[p.asin].product = p; }
    });
    (allListings as any[] || []).forEach((l: any) => {
      if (l.asin) { if (!map[l.asin]) map[l.asin] = {}; map[l.asin].listing = l; }
    });
    (allImageSets as any[] || []).forEach((s: any) => {
      if (s.asin) { if (!map[s.asin]) map[s.asin] = {}; map[s.asin].imageSet = s; }
    });
    (allVideos as any[] || []).forEach((v: any) => {
      if (v.asin) { if (!map[v.asin]) map[v.asin] = {}; map[v.asin].video = v; }
    });
    return map;
  })();

  const asinList = Object.entries(asinMap)
    .filter(([asin]) => !panoramaAsin || asin.toLowerCase().includes(panoramaAsin.toLowerCase()))
    .sort((a, b) => {
      const countA = Object.values(a[1]).filter(Boolean).length;
      const countB = Object.values(b[1]).filter(Boolean).length;
      return countB - countA;
    });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("已复制到剪贴板"));
  };

  return (
    <TooltipProvider>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-6 w-6 text-primary" />
              知识库总览
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">知识库是整个AI工具矩阵的智慧大脑，贯穿运营前、运营中和售后全阶段</p>
          </div>
          <Badge variant="secondary" className="text-sm px-3 py-1">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            共 {isLoading ? "..." : totalCount} 条知识
          </Badge>
        </div>

        {/* ═══ Enhanced Core Value Chain ═══ */}
        <Card className="border-primary/20 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5 pointer-events-none" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              核心价值链路
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">知识从采集到进化的完整闭环，每一步都有AI和人工的深度协作</p>
          </CardHeader>
          <CardContent className="pb-6 relative">
            <div className="flex items-center justify-between gap-1 overflow-x-auto pb-2 px-2">
              {valueChainSteps.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className="flex items-center gap-1 shrink-0">
                    <div className="flex flex-col items-center gap-2 min-w-[90px] group">
                      {/* Step number */}
                      <div className="text-[10px] font-bold text-muted-foreground/60 mb-[-4px]">STEP {i + 1}</div>
                      {/* Icon with ring effect */}
                      <div className={`relative p-3 rounded-2xl ${step.bg} ring-2 ${step.ringColor} transition-all group-hover:scale-110 group-hover:shadow-lg`}>
                        <Icon className={`h-6 w-6 ${step.color}`} />
                        {/* Pulse effect for active steps */}
                        <div className={`absolute inset-0 rounded-2xl ${step.bg} animate-ping opacity-20 pointer-events-none`} style={{ animationDuration: `${3 + i * 0.5}s` }} />
                      </div>
                      <span className="text-sm font-bold">{step.label}</span>
                      <span className="text-[10px] text-muted-foreground text-center leading-tight max-w-[80px]">{step.desc}</span>
                    </div>
                    {i < valueChainSteps.length - 1 && (
                      <div className="flex items-center shrink-0 mt-[-28px]">
                        <div className="w-6 h-[2px] bg-gradient-to-r from-muted-foreground/20 to-muted-foreground/40" />
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 -mx-1" />
                        <div className="w-6 h-[2px] bg-gradient-to-r from-muted-foreground/40 to-muted-foreground/20" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Cycle indicator */}
            <div className="flex items-center justify-center mt-3 gap-2">
              <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-primary/20" />
              <Badge variant="outline" className="text-[10px] gap-1 px-2 py-0.5">
                <TrendingUp className="h-3 w-3" /> 持续闭环迭代
              </Badge>
              <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-primary/20" />
            </div>
          </CardContent>
        </Card>

        {/* Global Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="跨模块搜索知识库内容（产品、文案、图片、SOP、视频）..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {isSearching && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            </div>
            {searchResults && searchQuery.length > 1 && (
              <div className="mt-4 space-y-2">
                {(searchResults as any[]).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">未找到相关内容</p>
                ) : (
                  (searchResults as any[]).slice(0, 10).map((item: any, i: number) => {
                    const typeMap: Record<string, { label: string; path: string }> = {
                      product: { label: "产品创意", path: "/knowledge/products" },
                      listing: { label: "Listing文案", path: "/knowledge/listings" },
                      image: { label: "图片", path: "/knowledge/images" },
                      skill: { label: "运营SOP", path: "/knowledge/skills" },
                      video: { label: "视频", path: "/knowledge/videos" },
                    };
                    const typeInfo = typeMap[item.type] || { label: item.type, path: "/knowledge" };
                    return (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors" onClick={() => navigate(typeInfo.path)}>
                        <Badge variant="outline" className="text-xs shrink-0">{typeInfo.label}</Badge>
                        <span className="font-medium truncate">{item.title || item.productTitle || "未命名"}</span>
                        {item.asin && <Badge variant="secondary" className="text-xs">{item.asin}</Badge>}
                        <span className="text-xs text-muted-foreground ml-auto">{item.status}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ASIN Panoramic View Entry */}
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent cursor-pointer hover:shadow-md transition-all" onClick={() => setAsinPanorama(true)}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white shadow-sm">
              <Globe className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-base flex items-center gap-2">
                ASIN全景视图
                <Badge variant="secondary" className="text-xs">{Object.keys(asinMap).length} 个ASIN</Badge>
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">以ASIN为维度，查看每个产品在各子库中的知识沉淀情况，快速定位知识空白</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <Card key={mod.key} className="cursor-pointer hover:shadow-sm transition-all" onClick={() => navigate(mod.path)}>
                <CardContent className="p-4 text-center">
                  <div className={`w-9 h-9 rounded-lg ${mod.iconBg} flex items-center justify-center mx-auto mb-1.5`}>
                    <Icon className={`h-4.5 w-4.5 ${mod.iconColor}`} />
                  </div>
                  <p className="text-lg font-bold">{isLoading ? "..." : getCount(mod.statsKey)}</p>
                  <p className="text-xs text-muted-foreground truncate">{mod.title}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Module Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <Card
                key={mod.key}
                className={`group cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${mod.bgColor}`}
                onClick={() => navigate(mod.path)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2.5 rounded-xl bg-gradient-to-br ${mod.color} text-white shadow-sm`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {isLoading ? "..." : `${getCount(mod.statsKey)} 条`}
                    </Badge>
                  </div>
                  <h3 className="font-semibold text-base mb-1.5">{mod.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">{mod.desc}</p>
                  <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 p-0 text-primary hover:text-primary">
                    进入管理 <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ═══ AI 助手 & 情报快捷入口 + 反馈统计 ═══ */}
        <AiFeedbackDashboard />

        {/* ═══ Enhanced Cross-Module Calling Capability ═══ */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-primary/10">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  跨模块调用能力
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1.5">知识库建立后，将在工具矩阵中被广泛调用，通过内部tRPC接口实现跨模块知识检索</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowApiPanel(!showApiPanel)}>
                <Code2 className="h-3.5 w-3.5" />
                {showApiPanel ? "隐藏API" : "查看API接口"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Cross-module calling cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {crossModuleCalls.map((call, i) => (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div
                      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent/30 cursor-pointer transition-colors group/call"
                      onClick={() => navigate(call.targetPath)}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full ${call.dotColor} mt-1.5 shrink-0 ring-2 ring-offset-1 ring-offset-background ${call.dotColor.replace("bg-", "ring-")}/30`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{call.caller}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{call.action} →{" "}
                          <span className="text-primary font-medium group-hover/call:underline">{call.target}</span>
                        </p>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50 group-hover/call:text-primary shrink-0 mt-0.5 transition-colors" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs font-medium">API: {call.apiEndpoint}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{call.apiDesc}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* API Interface Panel */}
            {showApiPanel && (
              <div className="border rounded-lg overflow-hidden mt-4">
                <div className="bg-muted/50 px-4 py-2.5 flex items-center gap-2 border-b">
                  <Code2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">跨模块调用API接口文档</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">tRPC Protocol</Badge>
                </div>
                <div className="divide-y">
                  {apiInterfaces.map((api, i) => (
                    <div key={i} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="secondary" className="text-[10px] font-mono">{api.method}</Badge>
                        <code className="text-xs font-mono font-semibold text-primary">{api.name}</code>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => copyToClipboard(`trpc.${api.name}.useQuery(${api.input === "无" ? "" : api.input})`)}>
                          <Copy className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">{api.desc}</p>
                      <div className="flex flex-wrap gap-3 text-[10px]">
                        <span className="text-muted-foreground">
                          <span className="font-medium">Input:</span>{" "}
                          <code className="bg-muted px-1 py-0.5 rounded">{api.input}</code>
                        </span>
                        <span className="text-muted-foreground">
                          <span className="font-medium">Output:</span>{" "}
                          <code className="bg-muted px-1 py-0.5 rounded">{api.output}</code>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-muted/30 px-4 py-2 border-t">
                  <p className="text-[10px] text-muted-foreground">
                    调用示例：<code className="bg-muted px-1 py-0.5 rounded font-mono">const {"{"} data {"}"} = trpc.kbSearch.search.useQuery({"{"} query: "关键词" {"}"});</code>
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        {/* ASIN Panoramic View Dialog */}
        <Dialog open={asinPanorama} onOpenChange={setAsinPanorama}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                ASIN全景视图
                <Badge variant="secondary">{Object.keys(asinMap).length} 个ASIN</Badge>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="搜索ASIN..." className="pl-9" value={panoramaAsin} onChange={(e) => setPanoramaAsin(e.target.value)} />
              </div>

              {asinList.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无ASIN数据，请先在各子库中导入产品</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {asinList.slice(0, 50).map(([asin, data]) => {
                    const moduleCount = Object.values(data).filter(Boolean).length;
                    return (
                      <Card key={asin} className="hover:shadow-sm transition-all">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 min-w-[140px]">
                              <code className="text-sm font-mono font-bold text-primary">{asin}</code>
                              <Badge variant={moduleCount >= 3 ? "default" : moduleCount >= 2 ? "secondary" : "outline"} className="text-[10px]">
                                {moduleCount}/4
                              </Badge>
                            </div>
                            <div className="flex gap-2 flex-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${data.product ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground/40"}`}
                                    onClick={() => { if (data.product) { setAsinPanorama(false); navigate("/knowledge/products"); } }}>
                                    <Lightbulb className="h-3 w-3" /> 创意
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>{data.product ? `✅ 已收录: ${data.product.productTitle || "未命名"}` : "❌ 未收录"}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${data.listing ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground/40"}`}
                                    onClick={() => { if (data.listing) { setAsinPanorama(false); navigate("/knowledge/listings"); } }}>
                                    <FileText className="h-3 w-3" /> 文案
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>{data.listing ? `✅ 已收录: ${data.listing.title || "未命名"}` : "❌ 未收录"}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${data.imageSet ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400" : "bg-muted text-muted-foreground/40"}`}
                                    onClick={() => { if (data.imageSet) { setAsinPanorama(false); navigate("/knowledge/images"); } }}>
                                    <Image className="h-3 w-3" /> 图片
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>{data.imageSet ? `✅ 已收录: ${data.imageSet.imageCount || 0}张图片` : "❌ 未收录"}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${data.video ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400" : "bg-muted text-muted-foreground/40"}`}
                                    onClick={() => { if (data.video) { setAsinPanorama(false); navigate("/knowledge/videos"); } }}>
                                    <Video className="h-3 w-3" /> 视频
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>{data.video ? `✅ 已收录: ${data.video.title || "未命名"}` : "❌ 未收录"}</TooltipContent>
                              </Tooltip>
                            </div>
                            {/* Coverage indicator */}
                            <div className="flex gap-0.5">
                              {[1,2,3,4].map(n => (
                                <div key={n} className={`w-2 h-2 rounded-full ${n <= moduleCount ? "bg-primary" : "bg-muted"}`} />
                              ))}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {asinList.length > 50 && (
                    <p className="text-xs text-muted-foreground text-center py-2">显示前50个，共{asinList.length}个ASIN，请使用搜索缩小范围</p>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
