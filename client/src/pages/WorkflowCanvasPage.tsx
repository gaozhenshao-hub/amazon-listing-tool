/**
 * WorkflowCanvasPage — 无限画布工作流总览页
 *
 * 架构 v2（用户确认版）：
 * - N1 竞品分析：输入ASIN + 竞品Listing文本上传
 * - N2 竞品对比：多竞品横向对比
 * - N3 数据文件：产品属性表 + 买家问题库（必须上传才能进入G1）
 * - N4 关键词管理：场景词表 + A9关键词表 + 关键词分析
 * - N5 评论聚合分析：卡洛模型（痛点/痒点/爽点）
 * - G1-G5 Listing生成5步（强制要求N3就绪）
 * - E1 图片建议（6步）
 * - E2 Listing评分
 * - E3 视频脚本
 * - E4 广告架构
 *
 * 交互：点击节点 → 全屏跳转到对应页面
 * SVG连线：N3→G1 红色实线（强依赖），其他数据流 灰色虚线
 */

import { trpc } from "@/lib/trpc";
import { useProject } from "@/contexts/ProjectContext";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ProjectSelector from "@/components/ProjectSelector";
import { useRef, useEffect, useState, useCallback } from "react";
import {
  Search,
  GitCompareArrows,
  Database,
  Key,
  MessageSquareText,
  Sparkles,
  Image,
  Gauge,
  Video,
  Target,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowRight,
  ChevronRight,
  Layers,
  FileText,
  LayoutGrid,
} from "lucide-react";

// ─── 节点定义 ─────────────────────────────────────────────────────────────────

type NodeStatus = "locked" | "ready" | "in_progress" | "done" | "blocked";

interface CanvasNode {
  id: string;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  layer: "prep" | "generate" | "output";
  color: {
    bg: string;
    border: string;
    icon: string;
    badge: string;
  };
  inputs: string[];
  outputs: string[];
  uploadFiles?: string[];
  aiLogic?: string;
  requiredForG1?: boolean;
}

const NODES: CanvasNode[] = [
  // ── 前置准备层 ──
  {
    id: "N1",
    label: "竞品分析",
    sublabel: "ASIN分析 + 竞品Listing文本",
    icon: Search,
    path: "/listing/analysis",
    layer: "prep",
    color: { bg: "bg-blue-50", border: "border-blue-200", icon: "text-blue-600", badge: "bg-blue-100 text-blue-700" },
    inputs: ["竞品ASIN列表", "竞品Listing文本.xlsx"],
    outputs: ["竞品分析报告", "标题/五点/评论数据"],
    uploadFiles: ["竞品Listing文本（.xlsx）"],
    aiLogic: "多竞品格局分析：找共性（Parity）+ 找缺口（Gap）",
  },
  {
    id: "N2",
    label: "竞品对比",
    sublabel: "多竞品横向对比",
    icon: GitCompareArrows,
    path: "/listing/comparison",
    layer: "prep",
    color: { bg: "bg-indigo-50", border: "border-indigo-200", icon: "text-indigo-600", badge: "bg-indigo-100 text-indigo-700" },
    inputs: ["N1竞品分析结果"],
    outputs: ["差异化机会矩阵", "竞品对比表"],
    aiLogic: "横向对比分析，识别差异化机会",
  },
  {
    id: "N3",
    label: "数据文件",
    sublabel: "产品属性表 + 买家问题库",
    icon: Database,
    path: "/listing/data-files",
    layer: "prep",
    color: { bg: "bg-orange-50", border: "border-orange-200", icon: "text-orange-600", badge: "bg-orange-100 text-orange-700" },
    inputs: ["产品属性表.txt/.csv", "买家问题库.xlsx"],
    outputs: ["Rufus属性分析结果", "买家问题库数据"],
    uploadFiles: ["产品属性表（.txt/.csv）— 必须", "买家问题库（.xlsx）— 可选"],
    aiLogic: "Rufus属性提取：深度读取产品参数、规格、材质、性能",
    requiredForG1: true,
  },
  {
    id: "N4",
    label: "关键词管理",
    sublabel: "场景词 + A9关键词 + 策略矩阵",
    icon: Key,
    path: "/listing/keywords",
    layer: "prep",
    color: { bg: "bg-violet-50", border: "border-violet-200", icon: "text-violet-600", badge: "bg-violet-100 text-violet-700" },
    inputs: ["场景词表.xlsx", "A9关键词表.xlsx", "亚马逊/领星关键词CSV"],
    outputs: ["关键词策略矩阵", "词根分析", "否词列表"],
    uploadFiles: ["场景词表（.xlsx）", "A9关键词表（.xlsx）"],
    aiLogic: "A9关键词分级：锁定高权重核心词 + COSMO场景映射",
  },
  {
    id: "N5",
    label: "评论聚合分析",
    sublabel: "卡洛模型 痛点/痒点/爽点",
    icon: MessageSquareText,
    path: "/listing/review-aggregation",
    layer: "prep",
    color: { bg: "bg-rose-50", border: "border-rose-200", icon: "text-rose-600", badge: "bg-rose-100 text-rose-700" },
    inputs: ["竞品评论数据（N1导入历史）"],
    outputs: ["痛点列表", "痒点列表", "爽点列表"],
    aiLogic: "卡洛模型分析：聚合所有竞品评论，提炼用户核心诉求",
  },
  // ── 生成层 ──
  {
    id: "G1",
    label: "卖点精雕",
    sublabel: "7条卖点核心方向 → 逐条生成",
    icon: Sparkles,
    path: "/listing/generate",
    layer: "generate",
    color: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
    inputs: ["N3产品属性（必须）", "N1竞品分析", "N4关键词策略", "N5评论聚合"],
    outputs: ["7-9条确认卖点", "Bullet Points"],
    aiLogic: "综合4类前置数据，AI生成7条卖点核心方向，人工确认后逐条生成完整Bullet Point",
  },
  {
    id: "G2",
    label: "标题生成",
    sublabel: "200字符以内，核心词前置",
    icon: FileText,
    path: "/listing/generate",
    layer: "generate",
    color: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
    inputs: ["G1确认卖点", "N4核心关键词"],
    outputs: ["标题候选方案", "A/B测试变体"],
    aiLogic: "标题10维度自检：关键词密度、字符数、可读性等",
  },
  {
    id: "G3",
    label: "产品描述",
    sublabel: "长描述 + A+ 内容规划",
    icon: FileText,
    path: "/listing/generate",
    layer: "generate",
    color: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
    inputs: ["G1卖点", "G2标题", "N1竞品分析"],
    outputs: ["产品长描述", "A+内容框架"],
    aiLogic: "基于卖点和竞品差异化，生成结构化产品描述",
  },
  {
    id: "G4",
    label: "搜索词",
    sublabel: "后台关键词 250字节",
    icon: Key,
    path: "/listing/generate",
    layer: "generate",
    color: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
    inputs: ["N4关键词策略矩阵", "G1-G3未覆盖词"],
    outputs: ["后台搜索词（250字节）"],
    aiLogic: "搜索词5维度自检：不重复标题词、无品牌名、空格分隔等",
  },
  {
    id: "G5",
    label: "QA问答",
    sublabel: "买家问题 + 专业解答",
    icon: HelpCircle,
    path: "/listing/generate",
    layer: "generate",
    color: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
    inputs: ["N3买家问题库", "G1-G4生成内容"],
    outputs: ["QA问答对（5-10条）"],
    aiLogic: "基于买家问题库，生成专业、有说服力的解答",
  },
  // ── 输出层 ──
  {
    id: "E1",
    label: "智能图片建议",
    sublabel: "6步图片规划工作流",
    icon: Image,
    path: "/listing/image-workflow",
    layer: "output",
    color: { bg: "bg-teal-50", border: "border-teal-200", icon: "text-teal-600", badge: "bg-teal-100 text-teal-700" },
    inputs: ["G1-G5 Listing内容", "N4关键词", "N1竞品图片"],
    outputs: ["主图建议", "辅图建议", "A+内容规划", "AI提示词"],
    aiLogic: "6步图片建议：卖点梳理→大纲→风格→参考图→建议→AI提示词",
  },
  {
    id: "E2",
    label: "Listing评分",
    sublabel: "多维度质量评估",
    icon: Gauge,
    path: "/listing/score",
    layer: "output",
    color: { bg: "bg-green-50", border: "border-green-200", icon: "text-green-600", badge: "bg-green-100 text-green-700" },
    inputs: ["G1-G5 Listing内容"],
    outputs: ["综合评分", "优化建议"],
    aiLogic: "多维度评分：关键词覆盖、字符数合规、可读性、差异化等",
  },
  {
    id: "E3",
    label: "视频脚本",
    sublabel: "产品视频脚本生成",
    icon: Video,
    path: "/listing/video-script",
    layer: "output",
    color: { bg: "bg-purple-50", border: "border-purple-200", icon: "text-purple-600", badge: "bg-purple-100 text-purple-700" },
    inputs: ["G1-G5 Listing内容", "N5评论痛点"],
    outputs: ["视频脚本", "分镜建议"],
    aiLogic: "基于卖点和用户痛点，生成吸引力强的视频脚本",
  },
  {
    id: "E4",
    label: "广告架构",
    sublabel: "广告词 + 投放策略",
    icon: Target,
    path: "/listing/ad-structure",
    layer: "output",
    color: { bg: "bg-pink-50", border: "border-pink-200", icon: "text-pink-600", badge: "bg-pink-100 text-pink-700" },
    inputs: ["N4关键词策略", "G1-G5 Listing内容"],
    outputs: ["广告词建议", "投放策略", "否词列表"],
    aiLogic: "基于关键词策略和Listing内容，规划广告架构",
  },
];

// ─── 数据流边定义 ──────────────────────────────────────────────────────────────
// type: "required" = 红色实线（强依赖）, "recommended" = 灰色虚线（强烈建议）, "optional" = 浅灰虚线（可选）

interface FlowEdge {
  from: string;
  to: string;
  type: "required" | "recommended" | "optional";
  label?: string;
}

const FLOW_EDGES: FlowEdge[] = [
  // 强依赖（红色实线）
  { from: "N3", to: "G1", type: "required", label: "必须" },
  // 强烈建议（橙色虚线）
  { from: "N1", to: "G1", type: "recommended", label: "竞品格局" },
  { from: "N4", to: "G1", type: "recommended", label: "关键词策略" },
  { from: "N4", to: "G4", type: "recommended", label: "关键词矩阵" },
  { from: "N5", to: "G1", type: "recommended", label: "评论洞察" },
  // 可选（灰色虚线）
  { from: "N3", to: "G5", type: "optional", label: "买家问题库" },
  // 生成层顺序依赖
  { from: "G1", to: "G2", type: "recommended" },
  { from: "G2", to: "G3", type: "recommended" },
  { from: "G1", to: "G4", type: "recommended" },
  { from: "G1", to: "G5", type: "recommended" },
  // 输出层依赖
  { from: "G1", to: "E1", type: "optional" },
  { from: "G1", to: "E2", type: "optional" },
  { from: "G1", to: "E3", type: "optional" },
  { from: "N4", to: "E4", type: "optional" },
];

// ─── SVG 连线组件 ─────────────────────────────────────────────────────────────

interface NodeRect {
  id: string;
  cx: number; // center x relative to canvas container
  cy: number; // center y relative to canvas container
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

function getEdgeStyle(type: FlowEdge["type"]) {
  switch (type) {
    case "required":
      return { stroke: "#ef4444", strokeWidth: 2.5, strokeDasharray: "none", opacity: 0.9 };
    case "recommended":
      return { stroke: "#f97316", strokeWidth: 1.5, strokeDasharray: "6,4", opacity: 0.7 };
    case "optional":
      return { stroke: "#9ca3af", strokeWidth: 1.2, strokeDasharray: "4,5", opacity: 0.5 };
  }
}

function getLabelStyle(type: FlowEdge["type"]) {
  switch (type) {
    case "required":
      return { fill: "#ef4444", fontSize: 10, fontWeight: "bold" };
    case "recommended":
      return { fill: "#f97316", fontSize: 9, fontWeight: "500" };
    case "optional":
      return { fill: "#9ca3af", fontSize: 9, fontWeight: "normal" };
  }
}

/**
 * 计算贝塞尔曲线路径：从源节点底部中心 → 目标节点顶部中心
 * 若同层（如 G1→G2），则从右侧中心 → 左侧中心
 */
function buildPath(from: NodeRect, to: NodeRect): string {
  // 判断是否同层（y坐标接近）
  const sameLevelThreshold = 60;
  const sameLevel = Math.abs(from.cy - to.cy) < sameLevelThreshold;

  if (sameLevel) {
    // 水平连线：从右侧中心 → 左侧中心
    const x1 = from.right;
    const y1 = from.cy;
    const x2 = to.left;
    const y2 = to.cy;
    const cpOffset = Math.max(20, (x2 - x1) * 0.4);
    return `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
  } else {
    // 跨层连线：从底部中心 → 顶部中心
    const x1 = from.cx;
    const y1 = from.bottom;
    const x2 = to.cx;
    const y2 = to.top;
    const cpOffset = Math.max(30, (y2 - y1) * 0.5);
    return `M ${x1} ${y1} C ${x1} ${y1 + cpOffset}, ${x2} ${y2 - cpOffset}, ${x2} ${y2}`;
  }
}

function CanvasSVGOverlay({
  nodeRects,
  edges,
  width,
  height,
}: {
  nodeRects: Map<string, NodeRect>;
  edges: FlowEdge[];
  width: number;
  height: number;
}) {
  if (nodeRects.size === 0 || width === 0 || height === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      style={{ zIndex: 0 }}
    >
      <defs>
        {/* 箭头标记 - 红色（required） */}
        <marker
          id="arrow-required"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
        </marker>
        {/* 箭头标记 - 橙色（recommended） */}
        <marker
          id="arrow-recommended"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="#f97316" />
        </marker>
        {/* 箭头标记 - 灰色（optional） */}
        <marker
          id="arrow-optional"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="#9ca3af" />
        </marker>
      </defs>

      {edges.map((edge, i) => {
        const fromRect = nodeRects.get(edge.from);
        const toRect = nodeRects.get(edge.to);
        if (!fromRect || !toRect) return null;

        const style = getEdgeStyle(edge.type);
        const labelStyle = getLabelStyle(edge.type);
        const pathD = buildPath(fromRect, toRect);
        const markerId = `arrow-${edge.type}`;

        // 计算标签位置（路径中点附近）
        const midX = (fromRect.cx + toRect.cx) / 2;
        const midY = (fromRect.cy + toRect.cy) / 2;

        return (
          <g key={`${edge.from}-${edge.to}-${i}`}>
            <path
              d={pathD}
              fill="none"
              stroke={style.stroke}
              strokeWidth={style.strokeWidth}
              strokeDasharray={style.strokeDasharray === "none" ? undefined : style.strokeDasharray}
              opacity={style.opacity}
              markerEnd={`url(#${markerId})`}
            />
            {edge.label && (
              <text
                x={midX}
                y={midY - 4}
                textAnchor="middle"
                fontSize={labelStyle.fontSize}
                fontWeight={labelStyle.fontWeight}
                fill={labelStyle.fill}
                opacity={0.85}
                style={{ userSelect: "none" }}
              >
                {edge.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── 状态计算 ─────────────────────────────────────────────────────────────────

function useNodeStatuses(projectId: number | null) {
  const { data: fileSummary } = trpc.projectFile.getAnalysisSummary.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: analyses } = trpc.analysis.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: kwStats } = trpc.keyword.stats.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: reviewAgg } = trpc.reviewAggregation.get.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: listings } = trpc.listing.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: buyerQReadiness } = trpc.buyerQuestions.getReadiness.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: imageSession } = trpc.imageWorkflow.getSession.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const n3Ready = !!fileSummary?.n3Ready;
  const hasListing = listings && listings.length > 0;
  const activeListing = listings?.find((l: any) => l.isActive === 1 || l.isActive === true);

  const statusMap: Record<string, { status: NodeStatus; summary: string }> = {
    N1: {
      status: analyses && analyses.length > 0 ? "done" : "ready",
      summary: analyses && analyses.length > 0 ? `${analyses.length} 个竞品已分析` : "待上传竞品ASIN",
    },
    N2: {
      status: analyses && analyses.length >= 2 ? "ready" : "locked",
      summary: analyses && analyses.length >= 2 ? "可进行对比分析" : "需要至少2个竞品",
    },
    N3: {
      status: n3Ready ? "done" : "ready",
      summary: n3Ready
        ? `产品属性已就绪${buyerQReadiness?.hasQuestions ? ` · ${buyerQReadiness.count}条买家问题` : ""}`
        : "待上传产品属性表（必须）",
    },
    N4: {
      status: kwStats && kwStats.total > 0 ? "done" : "ready",
      summary: kwStats && kwStats.total > 0 ? `${kwStats.total} 个关键词` : "待导入关键词",
    },
    N5: {
      status: reviewAgg ? "done" : "ready",
      summary: reviewAgg ? "卡洛模型分析已完成" : "待聚合评论数据",
    },
    G1: {
      status: !n3Ready ? "blocked" : activeListing?.bulletPoints ? "done" : "ready",
      summary: !n3Ready ? "需先完成N3产品属性上传" : activeListing?.bulletPoints ? "卖点已生成" : "待生成卖点",
    },
    G2: {
      status: activeListing?.title ? "done" : activeListing?.bulletPoints ? "ready" : "locked",
      summary: activeListing?.title ? "标题已生成" : "待生成标题",
    },
    G3: {
      status: activeListing?.description ? "done" : activeListing?.title ? "ready" : "locked",
      summary: activeListing?.description ? "描述已生成" : "待生成描述",
    },
    G4: {
      status: activeListing?.searchTerms ? "done" : activeListing?.title ? "ready" : "locked",
      summary: activeListing?.searchTerms ? "搜索词已生成" : "待生成搜索词",
    },
    G5: {
      status: activeListing?.qaContent ? "done" : activeListing?.title ? "ready" : "locked",
      summary: activeListing?.qaContent ? "QA已生成" : "待生成QA",
    },
    E1: {
      status: imageSession ? "in_progress" : hasListing ? "ready" : "locked",
      summary: imageSession ? `图片建议进行中` : "待完成Listing生成",
    },
    E2: {
      status: hasListing ? "ready" : "locked",
      summary: hasListing ? "可进行评分" : "待完成Listing生成",
    },
    E3: {
      status: hasListing ? "ready" : "locked",
      summary: hasListing ? "可生成视频脚本" : "待完成Listing生成",
    },
    E4: {
      status: kwStats && kwStats.total > 0 ? "ready" : "locked",
      summary: kwStats && kwStats.total > 0 ? "可规划广告架构" : "待完成关键词管理",
    },
  };

  return statusMap;
}

// ─── 状态样式 ─────────────────────────────────────────────────────────────────

function getStatusStyle(status: NodeStatus) {
  switch (status) {
    case "done":
      return { ring: "ring-2 ring-green-400", badge: "bg-green-100 text-green-700", dot: "bg-green-500", label: "已完成" };
    case "in_progress":
      return { ring: "ring-2 ring-blue-400 ring-offset-1", badge: "bg-blue-100 text-blue-700", dot: "bg-blue-500 animate-pulse", label: "进行中" };
    case "ready":
      return { ring: "ring-1 ring-gray-200", badge: "bg-gray-100 text-gray-600", dot: "bg-gray-300", label: "待开始" };
    case "blocked":
      return { ring: "ring-2 ring-red-300", badge: "bg-red-100 text-red-600", dot: "bg-red-400", label: "需前置" };
    case "locked":
      return { ring: "ring-1 ring-gray-100", badge: "bg-gray-50 text-gray-400", dot: "bg-gray-200", label: "未解锁" };
  }
}

// ─── 节点卡片组件 ─────────────────────────────────────────────────────────────

function NodeCard({
  node,
  status,
  summary,
  onClick,
}: {
  node: CanvasNode;
  status: NodeStatus;
  summary: string;
  onClick: () => void;
}) {
  const Icon = node.icon;
  const style = getStatusStyle(status);
  const isClickable = status !== "locked";

  return (
    <button
      data-node-id={node.id}
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
      className={`
        group relative w-full text-left rounded-xl p-4 transition-all duration-200
        ${node.color.bg} ${node.color.border} border
        ${style.ring}
        ${isClickable
          ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
          : "cursor-not-allowed opacity-60"
        }
      `}
      style={{ zIndex: 1 }}
    >
      {/* Status dot */}
      <span className={`absolute top-3 right-3 h-2 w-2 rounded-full ${style.dot}`} />

      {/* Node ID badge */}
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mb-2 ${node.color.badge}`}>
        {node.id}
      </span>

      {/* Icon + Label */}
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-lg ${node.color.bg} border ${node.color.border} flex items-center justify-center shrink-0`}>
          <Icon className={`h-4.5 w-4.5 ${node.color.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900 leading-tight">{node.label}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-tight truncate">{node.sublabel}</p>
        </div>
      </div>

      {/* Summary */}
      <p className={`mt-2.5 text-xs leading-relaxed ${status === "blocked" ? "text-red-600 font-medium" : "text-gray-600"}`}>
        {status === "blocked" && <Lock className="h-3 w-3 inline mr-1 mb-0.5" />}
        {summary}
      </p>

      {/* Upload files hint */}
      {node.uploadFiles && node.uploadFiles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.uploadFiles.map((f, i) => (
            <span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border ${
              f.includes("必须") ? "bg-red-50 border-red-200 text-red-600" : "bg-white/70 border-gray-200 text-gray-500"
            }`}>
              {f}
            </span>
          ))}
        </div>
      )}

      {/* AI logic hint */}
      {node.aiLogic && (
        <p className="mt-2 text-[10px] text-gray-400 italic leading-tight line-clamp-2">
          AI: {node.aiLogic}
        </p>
      )}

      {/* Arrow on hover */}
      {isClickable && (
        <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowRight className={`h-3.5 w-3.5 ${node.color.icon}`} />
        </div>
      )}
    </button>
  );
}

// ─── 层标题 ───────────────────────────────────────────────────────────────────

function LayerHeader({ title, subtitle, icon: Icon, color }: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className={`flex items-center gap-3 mb-4 pb-3 border-b ${color}`}>
      <Icon className="h-5 w-5 text-gray-600" />
      <div>
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function WorkflowCanvasPage() {
  const { selectedProjectId } = useProject();
  const [, setLocation] = useLocation();

  const { data: project } = trpc.project.getById.useQuery(
    { id: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const statusMap = useNodeStatuses(selectedProjectId);

  const prepNodes = NODES.filter((n) => n.layer === "prep");
  const generateNodes = NODES.filter((n) => n.layer === "generate");
  const outputNodes = NODES.filter((n) => n.layer === "output");

  // Count overall progress
  const doneCount = Object.values(statusMap).filter((s) => s.status === "done").length;
  const totalCount = Object.keys(statusMap).length;
  const progressPct = Math.round((doneCount / totalCount) * 100);

  const n3Ready = statusMap["N3"]?.status === "done";

  // ── SVG 连线逻辑 ──────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodeRects, setNodeRects] = useState<Map<string, NodeRect>>(new Map());
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  const recalcRects = useCallback(() => {
    const container = canvasRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const newMap = new Map<string, NodeRect>();

    NODES.forEach((node) => {
      const el = container.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      newMap.set(node.id, {
        id: node.id,
        cx: r.left - containerRect.left + r.width / 2,
        cy: r.top - containerRect.top + r.height / 2,
        top: r.top - containerRect.top,
        bottom: r.top - containerRect.top + r.height,
        left: r.left - containerRect.left,
        right: r.left - containerRect.left + r.width,
        width: r.width,
        height: r.height,
      });
    });

    setNodeRects(newMap);
    setSvgSize({ width: container.offsetWidth, height: container.offsetHeight });
  }, []);

  useEffect(() => {
    // Initial calculation after mount
    const timer = setTimeout(recalcRects, 100);
    return () => clearTimeout(timer);
  }, [recalcRects, selectedProjectId]);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      recalcRects();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [recalcRects]);

  // Recalc when statusMap changes (nodes might re-render)
  useEffect(() => {
    const timer = setTimeout(recalcRects, 200);
    return () => clearTimeout(timer);
  }, [statusMap, recalcRects]);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-primary" />
            工作流画布
          </h1>
          <p className="text-muted-foreground mt-1">
            {project ? `${project.name} · ` : ""}全流程节点总览，点击节点进入对应工作台
          </p>
        </div>
        <ProjectSelector />
      </div>

      {!selectedProjectId ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">请先在项目管理中创建并选择一个项目</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* ── Progress Bar ── */}
          <Card className="bg-gradient-to-r from-slate-50 to-gray-50 border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">整体进度</span>
                <span className="text-sm text-gray-500">{doneCount}/{totalCount} 节点已完成</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                {[
                  { label: "已完成", color: "bg-green-500", count: Object.values(statusMap).filter(s => s.status === "done").length },
                  { label: "进行中", color: "bg-blue-500", count: Object.values(statusMap).filter(s => s.status === "in_progress").length },
                  { label: "待开始", color: "bg-gray-300", count: Object.values(statusMap).filter(s => s.status === "ready").length },
                  { label: "需前置", color: "bg-red-400", count: Object.values(statusMap).filter(s => s.status === "blocked").length },
                  { label: "未解锁", color: "bg-gray-200", count: Object.values(statusMap).filter(s => s.status === "locked").length },
                ].map(item => item.count > 0 && (
                  <div key={item.label} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className={`h-2 w-2 rounded-full ${item.color}`} />
                    {item.label} {item.count}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── N3 强制提示 ── */}
          {!n3Ready && (
            <Card className="border-red-200 bg-red-50/50">
              <CardContent className="p-4 flex items-start gap-3">
                <Lock className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-800">Listing生成已锁定 — 需要先上传产品属性表</p>
                  <p className="text-xs text-red-600 mt-1">
                    产品属性表（N3）是Listing生成的必要前置数据。请先上传本品属性表，AI才能开始生成卖点。
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-100 shrink-0"
                  onClick={() => setLocation("/listing/data-files")}
                >
                  前往上传
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── 图例 ── */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 px-1">
            <span className="font-medium text-gray-600">连线图例：</span>
            <span className="flex items-center gap-1.5">
              <svg width="32" height="10" className="inline-block">
                <line x1="0" y1="5" x2="32" y2="5" stroke="#ef4444" strokeWidth="2.5" />
                <polygon points="26,2 32,5 26,8" fill="#ef4444" />
              </svg>
              <span className="text-red-600 font-medium">强依赖（必须完成）</span>
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="32" height="10" className="inline-block">
                <line x1="0" y1="5" x2="32" y2="5" stroke="#f97316" strokeWidth="1.5" strokeDasharray="5,3" />
                <polygon points="26,2 32,5 26,8" fill="#f97316" />
              </svg>
              <span className="text-orange-600">强烈建议</span>
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="32" height="10" className="inline-block">
                <line x1="0" y1="5" x2="32" y2="5" stroke="#9ca3af" strokeWidth="1.2" strokeDasharray="4,4" />
                <polygon points="26,2 32,5 26,8" fill="#9ca3af" />
              </svg>
              <span className="text-gray-500">可选数据流</span>
            </span>
          </div>

          {/* ── 画布主体（含 SVG 叠加层） ── */}
          <div ref={canvasRef} className="relative" style={{ isolation: "isolate" }}>
            {/* SVG 连线叠加层 */}
            <CanvasSVGOverlay
              nodeRects={nodeRects}
              edges={FLOW_EDGES}
              width={svgSize.width}
              height={svgSize.height}
            />

            <div className="space-y-8">
              {/* ── 前置准备层 ── */}
              <div>
                <LayerHeader
                  title="前置准备层"
                  subtitle="上传数据资产，为AI生成提供高质量上下文"
                  icon={Database}
                  color="border-gray-200"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  {prepNodes.map((node) => {
                    const s = statusMap[node.id] || { status: "ready" as NodeStatus, summary: "" };
                    return (
                      <NodeCard
                        key={node.id}
                        node={node}
                        status={s.status}
                        summary={s.summary}
                        onClick={() => setLocation(node.path)}
                      />
                    );
                  })}
                </div>
              </div>

              {/* ── 层间间距（SVG连线穿过此区域） ── */}
              <div className="h-8" />

              {/* ── 生成层 ── */}
              <div>
                <LayerHeader
                  title="Listing 生成层"
                  subtitle="5步顺序流程，AI生成 → 人工审核 → 确认锁定"
                  icon={Sparkles}
                  color="border-amber-200"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  {generateNodes.map((node) => {
                    const s = statusMap[node.id] || { status: "locked" as NodeStatus, summary: "" };
                    return (
                      <NodeCard
                        key={node.id}
                        node={node}
                        status={s.status}
                        summary={s.summary}
                        onClick={() => setLocation(node.path)}
                      />
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-center text-gray-400">
                  G1-G5 均在同一工作台（Listing生成）中完成，点击任意节点进入工作台
                </p>
              </div>

              {/* ── 层间间距 ── */}
              <div className="h-8" />

              {/* ── 输出层 ── */}
              <div>
                <LayerHeader
                  title="输出与优化层"
                  subtitle="基于Listing内容，生成图片建议、评分、视频脚本、广告架构"
                  icon={Layers}
                  color="border-teal-200"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {outputNodes.map((node) => {
                    const s = statusMap[node.id] || { status: "locked" as NodeStatus, summary: "" };
                    return (
                      <NodeCard
                        key={node.id}
                        node={node}
                        status={s.status}
                        summary={s.summary}
                        onClick={() => setLocation(node.path)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── 数据流说明 ── */}
          <Card className="bg-gray-50 border-gray-200">
            <CardContent className="p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                数据流向说明
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-600">
                <div>
                  <p className="font-medium text-red-600 mb-1">🔴 必须上传（强制，红色实线）</p>
                  <p>N3 产品属性表 → G1 卖点精雕（Rufus属性提取）</p>
                </div>
                <div>
                  <p className="font-medium text-orange-600 mb-1">🟠 强烈建议上传（橙色虚线）</p>
                  <p>N1 竞品Listing文本 → G1 多竞品格局分析</p>
                  <p className="mt-1">N4 场景词/A9关键词 → G1/G4 关键词策略</p>
                </div>
                <div>
                  <p className="font-medium text-gray-500 mb-1">⚪ 可选上传（灰色虚线）</p>
                  <p>N3 买家问题库 → G5 QA问答</p>
                  <p className="mt-1">N5 评论聚合 → G1 卖点差异化</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
