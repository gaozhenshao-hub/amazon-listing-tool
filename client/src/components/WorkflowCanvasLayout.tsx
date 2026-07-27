/**
 * WorkflowCanvasLayout — 画布风格工作流布局组件
 *
 * 三栏布局：
 *   左侧：垂直步骤导航（带状态、摘要预览、连线）
 *   中间：当前步骤内容区（主工作区）
 *   右侧：上下文感知 AI 助手面板
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  Lock,
  ChevronRight,
  ChevronDown,
  Bot,
  Send,
  Loader2,
  Sparkles,
  X,
  PanelRightClose,
  PanelRightOpen,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc?: string;
  /** 已完成时显示的摘要文本（可选） */
  summary?: string;
}

export interface WorkflowCanvasLayoutProps {
  /** 页面标题 */
  title: string;
  /** 页面副标题 */
  subtitle?: string;
  /** 步骤列表 */
  steps: WorkflowStep[];
  /** 当前激活步骤 ID */
  currentStep: number;
  /** 已完成步骤 ID 集合 */
  completedSteps: Set<number>;
  /** 已锁定步骤 ID 集合（可选，用于 Listing 工作流） */
  lockedSteps?: Set<number>;
  /** 步骤点击回调 */
  onStepClick: (stepId: number) => void;
  /** 右上角操作按钮区域 */
  headerActions?: React.ReactNode;
  /** 主内容区域 */
  children: React.ReactNode;
  /** AI 助手上下文：当前项目名 */
  projectName?: string;
  /** AI 助手上下文：当前步骤数据摘要 */
  currentStepContext?: string;
  /** 是否显示 AI 助手面板（默认 true） */
  showAIPanel?: boolean;
  /** 工作流类型（用于 AI 助手的快捷指令） */
  workflowType?: "listing" | "image";
}

// ─── AI Chat Message ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ─── Left Step Navigator ──────────────────────────────────────────────────────

function StepNavigator({
  steps,
  currentStep,
  completedSteps,
  lockedSteps,
  onStepClick,
}: {
  steps: WorkflowStep[];
  currentStep: number;
  completedSteps: Set<number>;
  lockedSteps?: Set<number>;
  onStepClick: (id: number) => void;
}) {
  const [expandedSummary, setExpandedSummary] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-0 relative">
      {/* Vertical connector line */}
      <div className="absolute left-[19px] top-8 bottom-8 w-0.5 bg-border/60 z-0" />

      {steps.map((step, idx) => {
        const StepIcon = step.icon;
        const isActive = currentStep === step.id;
        const isCompleted = completedSteps.has(step.id);
        const isLocked = lockedSteps?.has(step.id) ?? false;
        const isExpandable = isCompleted && !!step.summary;
        const isExpanded = expandedSummary === step.id;

        return (
          <div key={step.id} className="relative z-10 mb-1">
            {/* Step button */}
            <button
              onClick={() => onStepClick(step.id)}
              className={cn(
                "w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-all group",
                isActive
                  ? "bg-primary/10 border border-primary/30 shadow-sm"
                  : isLocked
                  ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30"
                  : isCompleted
                  ? "bg-muted/60 hover:bg-muted border border-transparent hover:border-border"
                  : "bg-background border border-transparent hover:bg-muted/40 hover:border-border/60"
              )}
            >
              {/* Step icon / status indicator */}
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md"
                    : isLocked
                    ? "bg-green-500 text-white"
                    : isCompleted
                    ? "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isLocked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : isCompleted && !isActive ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : isActive ? (
                  <StepIcon className="h-3.5 w-3.5" />
                ) : (
                  <span className="text-xs font-bold">{step.id}</span>
                )}
              </div>

              {/* Step label */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-sm font-medium leading-tight",
                      isActive
                        ? "text-primary"
                        : isLocked || isCompleted
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  {isLocked && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 h-4 bg-green-50 text-green-600 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700"
                    >
                      已锁定
                    </Badge>
                  )}
                  {isActive && !isLocked && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-primary/10 text-primary border-primary/30">
                      进行中
                    </Badge>
                  )}
                </div>
                {step.desc && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{step.desc}</p>
                )}
              </div>

              {/* Expand toggle for summary */}
              {isExpandable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedSummary(isExpanded ? null : step.id);
                  }}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-1"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </button>

            {/* Summary preview (expandable) */}
            {isExpandable && isExpanded && (
              <div className="mx-3 mb-1 p-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs text-muted-foreground leading-relaxed">
                {step.summary}
              </div>
            )}

            {/* Connector dot between steps */}
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "absolute left-[19px] -bottom-1 w-2 h-2 rounded-full border-2 z-20 translate-x-[-3px]",
                  isCompleted
                    ? "bg-green-400 border-green-300"
                    : "bg-border border-background"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Right AI Assistant Panel ─────────────────────────────────────────────────

const LISTING_QUICK_PROMPTS = [
  "分析当前步骤的优化建议",
  "帮我检查关键词覆盖情况",
  "这个标题是否符合亚马逊规范？",
  "对比竞品，我的卖点有哪些差距？",
  "给我一个更有竞争力的表达方式",
];

const IMAGE_QUICK_PROMPTS = [
  "分析当前图片方向的优劣势",
  "主图应该重点展示哪些卖点？",
  "A+图的模块顺序是否合理？",
  "参考图的风格是否符合目标人群？",
  "给我一个更吸引人的图片创意",
];

function AIAssistantPanel({
  projectName,
  currentStepLabel,
  currentStepContext,
  workflowType,
  onClose,
}: {
  projectName?: string;
  currentStepLabel: string;
  currentStepContext?: string;
  workflowType?: "listing" | "image";
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `您好！我是您的AI助手。\n\n当前正在处理「**${currentStepLabel}**」步骤${projectName ? `（项目：${projectName}）` : ""}。\n\n您可以问我任何关于当前步骤的问题，或使用下方快捷指令获取建议。`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatMutation = trpc.listing.aiChat.useMutation();

  const quickPrompts = workflowType === "image" ? IMAGE_QUICK_PROMPTS : LISTING_QUICK_PROMPTS;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Update welcome message when step changes
  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        content: `当前步骤切换到「**${currentStepLabel}**」。\n\n${currentStepContext ? `**当前内容摘要：**\n${currentStepContext}\n\n` : ""}有什么我可以帮您的？`,
        timestamp: Date.now(),
      },
    ]);
  }, [currentStepLabel, currentStepContext]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      // Build context-aware system prompt
      const systemContext = [
        `你是一个专业的亚马逊运营AI助手，正在协助用户完成「${workflowType === "image" ? "图片建议" : "Listing生成"}」工作流。`,
        `当前步骤：${currentStepLabel}`,
        projectName ? `当前项目：${projectName}` : "",
        currentStepContext ? `当前内容摘要：${currentStepContext}` : "",
        "请基于以上上下文，给出简洁、专业、可操作的建议。回复使用中文，适当使用 Markdown 格式。",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await chatMutation.mutateAsync({
        messages: [
          { role: "system", content: systemContext },
          ...messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: text },
        ],
      });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.content || "抱歉，我暂时无法回答这个问题。",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      toast.error("AI助手暂时不可用，请稍后重试");
      setMessages((prev) => prev.slice(0, -1)); // Remove user message on error
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-primary/10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">AI 智能助手</p>
            <p className="text-[10px] text-muted-foreground leading-tight">上下文感知 · 实时建议</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Context badge */}
      <div className="px-3 py-2 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[10px] px-2 py-0.5 gap-1">
            <Zap className="h-2.5 w-2.5" />
            {currentStepLabel}
          </Badge>
          {projectName && (
            <Badge variant="outline" className="text-[10px] px-2 py-0.5">
              {projectName}
            </Badge>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn("flex gap-2", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
          >
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-muted/60 text-foreground rounded-tl-sm border border-border/40"
              )}
            >
              {msg.content.split("\n").map((line, i) => {
                // Simple markdown: **bold**
                const parts = line.split(/(\*\*[^*]+\*\*)/g);
                return (
                  <p key={i} className={i > 0 ? "mt-1" : ""}>
                    {parts.map((part, j) =>
                      part.startsWith("**") && part.endsWith("**") ? (
                        <strong key={j}>{part.slice(2, -2)}</strong>
                      ) : (
                        part
                      )
                    )}
                  </p>
                );
              })}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="bg-muted/60 rounded-xl rounded-tl-sm border border-border/40 px-3 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Quick prompts */}
      <div className="px-3 py-2 border-t border-border/60">
        <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
          <Sparkles className="h-3 w-3" /> 快捷指令
        </p>
        <div className="flex flex-wrap gap-1">
          {quickPrompts.slice(0, 3).map((prompt) => (
            <button
              key={prompt}
              onClick={() => sendMessage(prompt)}
              disabled={isLoading}
              className="text-[10px] px-2 py-1 rounded-md bg-primary/8 hover:bg-primary/15 text-primary border border-primary/20 transition-colors disabled:opacity-50 leading-tight"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-border">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="输入您的问题..."
            className="text-xs min-h-[60px] max-h-[120px] resize-none"
            disabled={isLoading}
          />
          <Button
            size="icon"
            className="h-[60px] w-9 shrink-0"
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Layout Component ────────────────────────────────────────────────────

export default function WorkflowCanvasLayout({
  title,
  subtitle,
  steps,
  currentStep,
  completedSteps,
  lockedSteps,
  onStepClick,
  headerActions,
  children,
  projectName,
  currentStepContext,
  showAIPanel = true,
  workflowType = "listing",
}: WorkflowCanvasLayoutProps) {
  const [aiPanelOpen, setAiPanelOpen] = useState(showAIPanel);
  const currentStepDef = steps.find((s) => s.id === currentStep);

  return (
    <div className="flex flex-col h-full">
      {/* ── Top Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiPanelOpen((v) => !v)}
            className={cn(
              "gap-1.5 text-xs",
              aiPanelOpen && "bg-primary/10 border-primary/30 text-primary"
            )}
          >
            {aiPanelOpen ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
            AI 助手
          </Button>
        </div>
      </div>

      {/* ── Three-column body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Step Navigator */}
        <div className="w-52 shrink-0 border-r border-border bg-muted/20 overflow-y-auto">
          <div className="p-3">
            {/* Progress summary */}
            <div className="mb-4 px-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-muted-foreground font-medium">工作流进度</span>
                <span className="text-[11px] text-muted-foreground">
                  {completedSteps.size}/{steps.length}
                </span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full transition-all duration-500"
                  style={{ width: `${(completedSteps.size / steps.length) * 100}%` }}
                />
              </div>
            </div>

            <StepNavigator
              steps={steps}
              currentStep={currentStep}
              completedSteps={completedSteps}
              lockedSteps={lockedSteps}
              onStepClick={onStepClick}
            />
          </div>
        </div>

        {/* Center: Main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">{children}</div>
        </div>

        {/* Right: AI Assistant Panel */}
        {aiPanelOpen && (
          <div className="w-72 shrink-0 flex flex-col overflow-hidden">
            <AIAssistantPanel
              projectName={projectName}
              currentStepLabel={currentStepDef?.label ?? `步骤 ${currentStep}`}
              currentStepContext={currentStepContext}
              workflowType={workflowType}
              onClose={() => setAiPanelOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
