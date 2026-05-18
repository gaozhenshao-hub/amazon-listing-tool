import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import {
  Package,
  FileText,
  TrendingUp,
  Headphones,
  BookOpen,
  ArrowRight,
  Zap,
  BarChart3,
  Globe,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/* ─── Types ─────────────────────────────────────────────────── */
interface StatCard {
  icon: LucideIcon;
  value: string;
  label: string;
  sub: string;
}

interface ModuleCard {
  icon: LucideIcon;
  iconBg: string;
  title: string;
  description: string;
  path: string;
  status: "completed" | "developing" | "planned";
  cardBg: string;
  features: string[];
  actionLabel: string;
}

interface WorkflowStep {
  step: string;
  title: string;
  sub: string;
  bg: string;
  border: string;
}

/* ─── Data ──────────────────────────────────────────────────── */
const stats: StatCard[] = [
  { icon: Layers, value: "5", label: "工具模块", sub: "3 已完成" },
  { icon: Zap, value: "20+", label: "AI能力", sub: "持续扩展" },
  { icon: BarChart3, value: "50+", label: "数据接口", sub: "Excel导入" },
  { icon: Globe, value: "8", label: "支持站点", sub: "全球市场" },
];

const moduleCards: ModuleCard[] = [
  {
    icon: Package,
    iconBg: "bg-amber-500",
    title: "产品开发AI分析工具",
    description:
      "基于卖家精灵数据的智能选品分析，涵盖市场评估、竞品调研、AI评分和产品画像生成",
    path: "/dev",
    status: "completed",
    cardBg: "bg-gradient-to-br from-amber-50 to-orange-50/50 border-amber-200/60",
    features: ["选品分析", "竞品调研", "AI评分", "产品画像", "说明书生成"],
    actionLabel: "进入工具",
  },
  {
    icon: FileText,
    iconBg: "bg-blue-500",
    title: "Listing智能生成工具",
    description:
      "AI驱动的亚马逊Listing文案生成，支持标题、五点、长描述、A+内容和QA的智能创作",
    path: "/listing",
    status: "completed",
    cardBg: "bg-gradient-to-br from-emerald-50 to-green-50/50 border-emerald-200/60",
    features: ["标题生成", "五点描述", "长描述", "A+内容", "QA生成"],
    actionLabel: "进入工具",
  },
  {
    icon: TrendingUp,
    iconBg: "bg-orange-500",
    title: "运营AI提效工具",
    description:
      "基于Excel数据导入的运营智能分析，覆盖广告优化、库存预警、运营计划和执行复盘",
    path: "/ops",
    status: "developing",
    cardBg: "bg-gradient-to-br from-rose-50 to-pink-50/50 border-rose-200/60",
    features: ["广告优化", "库存预警", "运营计划", "执行复盘", "搜索词分析"],
    actionLabel: "查看进度",
  },
  {
    icon: Headphones,
    iconBg: "bg-red-500",
    title: "售后服务与客户管理",
    description:
      "智能客服邮件处理、评价管理、退货分析和客户CRM，提升售后效率和客户满意度",
    path: "/service",
    status: "planned",
    cardBg: "bg-gradient-to-br from-orange-50 to-amber-50/50 border-orange-200/60",
    features: ["客服邮件", "评价管理", "退货分析", "客户CRM", "品牌保护"],
    actionLabel: "了解详情",
  },
  {
    icon: BookOpen,
    iconBg: "bg-blue-600",
    title: "知识库",
    description:
      "构建产品创意、Listing文案、图片设计、运营技能和视频脚本的智能知识体系",
    path: "/knowledge",
    status: "completed",
    cardBg: "bg-gradient-to-br from-blue-50 to-indigo-50/50 border-blue-200/60",
    features: ["产品创意库", "文案知识库", "图片知识库", "运营技能库", "视频知识库"],
    actionLabel: "进入工具",
  },
];

const workflowSteps: WorkflowStep[] = [
  { step: "STEP 01", title: "选品分析", sub: "产品开发AI分析", bg: "bg-gray-50", border: "border-gray-200" },
  { step: "STEP 02", title: "上架优化", sub: "Listing智能生成", bg: "bg-amber-50", border: "border-amber-200" },
  { step: "STEP 03", title: "日常运营", sub: "运营AI提效", bg: "bg-green-50", border: "border-green-200" },
  { step: "STEP 04", title: "售后维护", sub: "售后服务管理", bg: "bg-blue-50", border: "border-blue-200" },
  { step: "STEP 05", title: "知识沉淀", sub: "知识库积累", bg: "bg-pink-50", border: "border-pink-200" },
];

const statusConfig = {
  completed: { label: "已完成", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  developing: { label: "开发中", className: "bg-orange-100 text-orange-700 border-orange-200" },
  planned: { label: "待开发", className: "bg-gray-100 text-gray-600 border-gray-200" },
};

/* ─── Component ─────────────────────────────────────────────── */
export default function PlatformHome() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const handleModuleClick = (mod: ModuleCard) => {
    if (mod.status === "planned") {
      // planned modules just show info
      return;
    }
    setLocation(mod.path);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      {/* ─── Header ─── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {user?.name || "用户"}，欢迎回来
        </h1>
        <p className="text-muted-foreground mt-1">
          亚马逊全链路智能工具 — 从选品到售后的一站式智能运营解决方案
        </p>
      </div>

      {/* ─── Stats Bar ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="border bg-card">
            <CardContent className="p-4 flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <s.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-tight">{s.value}</p>
                <p className="text-sm text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Tool Modules ─── */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold">工具模块</h2>
          <p className="text-sm text-muted-foreground hidden sm:block">
            覆盖亚马逊运营全生命周期
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {moduleCards.map((mod) => {
            const status = statusConfig[mod.status];
            return (
              <Card
                key={mod.path}
                className={`relative overflow-hidden transition-all ${mod.cardBg} ${
                  mod.status !== "planned"
                    ? "cursor-pointer hover:shadow-lg hover:-translate-y-0.5"
                    : "opacity-80"
                }`}
                onClick={() => handleModuleClick(mod)}
              >
                <CardContent className="p-5 flex flex-col h-full">
                  {/* Icon + Status */}
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`h-12 w-12 rounded-2xl ${mod.iconBg} flex items-center justify-center shadow-sm`}
                    >
                      <mod.icon className="h-6 w-6 text-white" />
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs font-medium ${status.className}`}
                    >
                      {status.label}
                    </Badge>
                  </div>

                  {/* Title + Description */}
                  <h3 className="font-bold text-base mb-2">{mod.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4 flex-1">
                    {mod.description}
                  </p>

                  {/* Feature Tags */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {mod.features.map((f) => (
                      <span
                        key={f}
                        className="text-xs px-2.5 py-1 rounded-full bg-white/70 text-muted-foreground border border-black/5"
                      >
                        {f}
                      </span>
                    ))}
                  </div>

                  {/* Action */}
                  <div className="flex items-center gap-1 text-sm font-medium text-foreground/80 group">
                    <span>{mod.actionLabel}</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ─── Workflow Section ─── */}
      <div className="pb-6">
        <h2 className="text-xl font-bold mb-2">全链路工作流</h2>
        <p className="text-sm text-muted-foreground mb-6">
          从产品开发到售后服务，AI贯穿亚马逊运营每个环节
        </p>

        <div className="flex flex-col md:flex-row items-stretch gap-3">
          {workflowSteps.map((ws, i) => (
            <div key={ws.step} className="flex items-center gap-3 flex-1">
              <div
                className={`flex-1 rounded-xl ${ws.bg} ${ws.border} border p-4 text-center`}
              >
                <p className="text-xs font-semibold text-muted-foreground tracking-wider mb-1">
                  {ws.step}
                </p>
                <p className="font-bold text-sm">{ws.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{ws.sub}</p>
              </div>
              {i < workflowSteps.length - 1 && (
                <ArrowRight className="h-4 w-4 text-muted-foreground/50 shrink-0 hidden md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
