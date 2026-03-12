import { useLocation } from "wouter";
import {
  Package,
  FileText,
  TrendingUp,
  Headphones,
  BookOpen,
  ArrowRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ModuleCard {
  icon: LucideIcon;
  title: string;
  description: string;
  path: string;
  enabled: boolean;
  color: string;
  features: string[];
}

const moduleCards: ModuleCard[] = [
  {
    icon: Package,
    title: "智能产品开发分析",
    description: "从市场调研到立项评分，AI驱动的全流程产品开发决策支持",
    path: "/dev",
    enabled: true,
    color: "from-blue-500/10 to-blue-600/5 border-blue-200/50",
    features: ["市场分析", "竞品对比", "AI评分", "BOM管理", "利润计算"],
  },
  {
    icon: FileText,
    title: "智能Listing生成",
    description: "基于竞品分析和关键词优化的AI Listing内容生成与评分",
    path: "/listing",
    enabled: true,
    color: "from-emerald-500/10 to-emerald-600/5 border-emerald-200/50",
    features: ["竞品爬取", "关键词管理", "AI生成", "广告架构", "Listing评分"],
  },
  {
    icon: TrendingUp,
    title: "智能运营提效",
    description: "基于领星ERP数据的利润分析、库存预警和广告优化",
    path: "/ops",
    enabled: false,
    color: "from-amber-500/10 to-amber-600/5 border-amber-200/50",
    features: ["利润分析", "库存预警", "广告优化", "销量预测", "搜索词分析"],
  },
  {
    icon: Headphones,
    title: "智能售后管理",
    description: "AI客服回复、退货分析和客户画像管理",
    path: "/service",
    enabled: false,
    color: "from-purple-500/10 to-purple-600/5 border-purple-200/50",
    features: ["AI客服", "退货分析", "客户画像", "邮件模板", "满意度追踪"],
  },
  {
    icon: BookOpen,
    title: "智能知识库",
    description: "产品创意、Listing文案、图片、运营SOP和视频的AI知识管理",
    path: "/knowledge",
    enabled: true,
    color: "from-rose-500/10 to-rose-600/5 border-rose-200/50",
    features: ["产品创意库", "文案库", "图片库", "SOP库", "视频库"],
  },
];

export default function PlatformHome() {
  const [, setLocation] = useLocation();

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">亚马逊全链路AI工具平台</h1>
        </div>
        <p className="text-muted-foreground ml-[52px]">
          覆盖产品开发、Listing优化、运营提效、售后管理和知识库五大模块，AI赋能跨境电商全链路
        </p>
      </div>

      {/* Module grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {moduleCards.map((mod) => (
          <Card
            key={mod.path}
            className={`relative overflow-hidden cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 bg-gradient-to-br ${mod.color} ${!mod.enabled ? "opacity-60" : ""}`}
            onClick={() => {
              if (mod.enabled) setLocation(mod.path);
            }}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="h-10 w-10 rounded-xl bg-background/80 flex items-center justify-center shadow-sm">
                  <mod.icon className="h-5 w-5 text-foreground" />
                </div>
                {!mod.enabled && (
                  <Badge variant="secondary" className="text-xs">
                    即将推出
                  </Badge>
                )}
                {mod.enabled && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <h3 className="font-semibold text-base mb-1.5">{mod.title}</h3>
              <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
                {mod.description}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {mod.features.map((f) => (
                  <span
                    key={f}
                    className="text-xs px-2 py-0.5 rounded-full bg-background/60 text-muted-foreground"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
