import {
  Building2,
  ClipboardCheck,
  DollarSign,
  Grid3X3,
  LayoutDashboard,
  MessageSquare,
  TrendingUp,
} from "lucide-react";

export const CHART_COLORS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b"];

export const DEV_ANALYSIS_STAGES = [
  { key: "market_overview", label: "市场大盘", icon: TrendingUp, desc: "市场容量、竞争格局、价格分布" },
  { key: "attribute_cross", label: "属性交叉", icon: Grid3X3, desc: "多维属性交叉分析与蓝海识别" },
  { key: "price_analysis", label: "价格段分析", icon: DollarSign, desc: "价格区间分布与利润空间" },
  { key: "brand_competition", label: "品牌竞争", icon: Building2, desc: "品牌市占率与竞争格局" },
  { key: "review_kano", label: "评论深度", icon: MessageSquare, desc: "评论卡洛模型与痛点挖掘" },
  { key: "information_summary", label: "信息汇总", icon: ClipboardCheck, desc: "汇总已确认证据、人工补充与初步利润假设" },
  { key: "decision_dashboard", label: "综合决策", icon: LayoutDashboard, desc: "综合看板与立项建议" },
] as const;

export type DevAnalysisStageKey = typeof DEV_ANALYSIS_STAGES[number]["key"];
