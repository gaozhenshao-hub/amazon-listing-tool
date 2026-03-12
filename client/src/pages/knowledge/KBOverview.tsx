import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Lightbulb, FileText, Image, BookOpen, Video, ArrowRight, Sparkles, Database } from "lucide-react";
import { useLocation } from "wouter";

const modules = [
  { key: "products", title: "智能产品创意库", icon: Lightbulb, color: "from-amber-500 to-orange-500", bgColor: "from-amber-500/10 to-amber-600/5 border-amber-200/50", path: "/knowledge/products", desc: "ASIN/链接导入，AI分析产品创意亮点" },
  { key: "listings", title: "智能Listing文案库", icon: FileText, color: "from-blue-500 to-cyan-500", bgColor: "from-emerald-500/10 to-emerald-600/5 border-emerald-200/50", path: "/knowledge/listings", desc: "ASIN批量导入，AI分析文案优劣" },
  { key: "images", title: "智能图片知识库", icon: Image, color: "from-purple-500 to-pink-500", bgColor: "from-blue-500/10 to-blue-600/5 border-blue-200/50", path: "/knowledge/images", desc: "四维标签分类，瀑布流浏览" },
  { key: "skills", title: "智能运营SOP库", icon: BookOpen, color: "from-emerald-500 to-teal-500", bgColor: "from-purple-500/10 to-purple-600/5 border-purple-200/50", path: "/knowledge/skills", desc: "多格式文件导入，AI智能摘要" },
  { key: "videos", title: "智能视频知识库", icon: Video, color: "from-red-500 to-rose-500", bgColor: "from-rose-500/10 to-rose-600/5 border-rose-200/50", path: "/knowledge/videos", desc: "视频链接导入，音频转写+AI分析" },
];

export default function KBOverview() {
  const [, navigate] = useLocation();
  const { data: stats, isLoading } = trpc.kbSearch.stats.useQuery();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: searchResults, isFetching: isSearching } = trpc.kbSearch.search.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length > 1 }
  );

  const getCount = (key: string) => {
    if (!stats) return 0;
    const s = stats as any;
    return s[key] || 0;
  };

  const totalCount = modules.reduce((sum, m) => sum + getCount(m.key), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            智能知识库
          </h1>
          <p className="text-muted-foreground mt-1">采集 → AI分析 → 人工确认 → 入库，构建您的亚马逊运营知识体系</p>
        </div>
        <Badge variant="secondary" className="text-sm px-3 py-1">
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          共 {isLoading ? "..." : totalCount} 条知识
        </Badge>
      </div>

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
                (searchResults as any[]).slice(0, 10).map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors">
                    <Badge variant="outline" className="text-xs shrink-0">{item.type}</Badge>
                    <span className="font-medium truncate">{item.title || item.productTitle || "未命名"}</span>
                    {item.asin && <Badge variant="secondary" className="text-xs">{item.asin}</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">{item.status}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <Card key={mod.key} className="cursor-pointer hover:shadow-sm transition-all" onClick={() => navigate(mod.path)}>
              <CardContent className="p-4 text-center">
                <Icon className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground" />
                <p className="text-lg font-bold">{isLoading ? "..." : getCount(mod.key)}</p>
                <p className="text-xs text-muted-foreground truncate">{mod.title.replace("智能", "")}</p>
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
              className={`group cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 bg-gradient-to-br ${mod.bgColor}`}
              onClick={() => navigate(mod.path)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2.5 rounded-xl bg-gradient-to-br ${mod.color} text-white shadow-sm`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
                <h3 className="font-semibold text-base mb-1.5">{mod.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">{mod.desc}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{isLoading ? "..." : `${getCount(mod.key)} 条`}</span>
                  <Button variant="ghost" size="sm" className="text-xs h-7">进入管理 →</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
