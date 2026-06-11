import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Bot,
  Send,
  Loader2,
  Plus,
  MessageSquare,
  Trash2,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Search,
  Database,
  Layers,
  User,
  Edit3,
  MoreHorizontal,
  BookOpen,
  FileText,
  Image,
  Lightbulb,
  Video,
  X,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────

interface KbReference {
  id: number;
  type: "product" | "listing" | "image" | "skill" | "video";
  title: string;
  asin: string;
  score: number | null;
  relevanceScore: number;
  excerpt: string;
  category: string;
}

interface SearchPathStep {
  level: "L1" | "L2" | "L3";
  scannedCount: number;
  matchedCount: number;
  tokensUsed: number;
}

interface ChatMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  references: KbReference[];
  searchPath: SearchPathStep[];
  tokensUsed: number | null;
  createdAt: number;
}

interface Conversation {
  id: number;
  userId: number;
  title: string | null;
  lastMessageAt: number | null;
  messageCount: number | null;
  createdAt: number;
  updatedAt: number;
}

// ─── Type Icon Map ───────────────────────────────

const TYPE_ICON_MAP: Record<string, { icon: typeof BookOpen; label: string; color: string; bgColor: string }> = {
  product: { icon: Lightbulb, label: "产品创意", color: "text-amber-600", bgColor: "bg-amber-50 dark:bg-amber-950/30" },
  listing: { icon: FileText, label: "Listing文案", color: "text-emerald-600", bgColor: "bg-emerald-50 dark:bg-emerald-950/30" },
  image: { icon: Image, label: "图片参考", color: "text-purple-600", bgColor: "bg-purple-50 dark:bg-purple-950/30" },
  skill: { icon: BookOpen, label: "运营SOP", color: "text-blue-600", bgColor: "bg-blue-50 dark:bg-blue-950/30" },
  video: { icon: Video, label: "视频参考", color: "text-rose-600", bgColor: "bg-rose-50 dark:bg-rose-950/30" },
};

const KB_DETAIL_PATHS: Record<string, string> = {
  product: "/knowledge/products",
  listing: "/knowledge/listings",
  image: "/knowledge/images",
  skill: "/knowledge/skills",
  video: "/knowledge/videos",
};

// ─── Suggested Prompts ───────────────────────────

const SUGGESTED_PROMPTS = [
  "帮我找一些充电宝类目的优秀A+图片参考",
  "有没有高转化率的Listing标题写法案例",
  "新品上架运营流程SOP有哪些",
  "竞品分析应该关注哪些维度",
  "如何优化五点描述提升转化率",
  "有没有好的品牌故事页面设计案例",
];

// ─── Reference Card Component ────────────────────

function ReferenceCard({ ref: reference, index }: { ref: KbReference; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = TYPE_ICON_MAP[reference.type] || TYPE_ICON_MAP.product;
  const TypeIcon = typeInfo.icon;

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden transition-all duration-200",
        "hover:shadow-sm",
        typeInfo.bgColor
      )}
    >
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={cn("flex items-center justify-center w-7 h-7 rounded-md", typeInfo.bgColor)}>
          <TypeIcon className={cn("w-4 h-4", typeInfo.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">[引用{index + 1}]</span>
            <span className="text-sm font-medium truncate">{reference.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              {typeInfo.label}
            </Badge>
            {reference.asin && (
              <span className="text-[10px] text-muted-foreground font-mono">{reference.asin}</span>
            )}
            {reference.score && (
              <span className="text-[10px] text-muted-foreground">评分: {reference.score}/10</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-border/50">
          {reference.excerpt && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              {reference.excerpt}
            </p>
          )}
          {reference.category && (
            <div className="mt-2">
              <Badge variant="secondary" className="text-[10px]">
                {reference.category}
              </Badge>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <a
              href={`${KB_DETAIL_PATHS[reference.type]}?highlight=${reference.id}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              查看详情
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Search Path Visualization ───────────────────

function SearchPathViz({ searchPath }: { searchPath: SearchPathStep[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!searchPath || searchPath.length === 0) return null;

  const totalTokens = searchPath.reduce((sum, s) => sum + s.tokensUsed, 0);

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Search className="w-3 h-3" />
        <span>检索路径</span>
        <span className="text-[10px] opacity-60">({totalTokens.toLocaleString()} tokens)</span>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-2 flex items-center gap-1 flex-wrap">
          {searchPath.map((step, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <div className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium",
                step.level === "L1" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" :
                step.level === "L2" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" :
                "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              )}>
                {step.level === "L1" ? <Database className="w-3 h-3" /> :
                 step.level === "L2" ? <Layers className="w-3 h-3" /> :
                 <FileText className="w-3 h-3" />}
                <span>{step.level}</span>
                <span className="opacity-70">
                  扫描{step.scannedCount} / 匹配{step.matchedCount}
                </span>
                <span className="opacity-50">{step.tokensUsed}t</span>
              </div>
              {idx < searchPath.length - 1 && (
                <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Message Feedback Component ──────────────────────────────

function MessageFeedback({
  messageId,
  references,
}: {
  messageId: number;
  references: KbReference[];
}) {
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, string>>({});
  const [showCommentFor, setShowCommentFor] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const feedbackMutation = trpc.kbFeedback.submitFeedback.useMutation({
    onSuccess: () => {
      toast.success("反馈已提交，感谢您的评价！");
      setShowCommentFor(null);
      setComment("");
    },
    onError: () => {
      toast.error("反馈提交失败，请稍后重试");
    },
  });

  const handleFeedback = (ref: KbReference, rating: "helpful" | "irrelevant" | "wrong") => {
    const key = `${ref.type}-${ref.id}`;
    setFeedbackGiven((prev) => ({ ...prev, [key]: rating }));

    if (rating === "wrong") {
      setShowCommentFor(key);
      return;
    }

    feedbackMutation.mutate({
      conversationMessageId: messageId,
      kbItemId: ref.id,
      kbItemType: ref.type,
      rating,
    });
  };

  const submitWithComment = (ref: KbReference) => {
    feedbackMutation.mutate({
      conversationMessageId: messageId,
      kbItemId: ref.id,
      kbItemType: ref.type,
      rating: "wrong",
      comment: comment || undefined,
    });
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      <p className="text-[10px] text-muted-foreground mb-2">这个回答对您有帮助吗？</p>
      <div className="flex flex-wrap gap-1.5">
        {references.map((ref) => {
          const key = `${ref.type}-${ref.id}`;
          const given = feedbackGiven[key];

          return (
            <div key={key} className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                {ref.title?.slice(0, 12) || `#${ref.id}`}
              </span>
              {given ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] h-5 px-1.5",
                    given === "helpful" && "text-emerald-600 border-emerald-300",
                    given === "irrelevant" && "text-amber-600 border-amber-300",
                    given === "wrong" && "text-red-600 border-red-300"
                  )}
                >
                  {given === "helpful" && <CheckCircle2 className="w-3 h-3 mr-0.5" />}
                  {given === "irrelevant" && <ThumbsDown className="w-3 h-3 mr-0.5" />}
                  {given === "wrong" && <AlertTriangle className="w-3 h-3 mr-0.5" />}
                  {given === "helpful" ? "有用" : given === "irrelevant" ? "不相关" : "错误"}
                </Badge>
              ) : (
                <div className="flex items-center gap-0.5">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleFeedback(ref, "helpful")}
                          className="h-5 w-5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center justify-center transition-colors"
                          disabled={feedbackMutation.isPending}
                        >
                          <ThumbsUp className="w-3 h-3 text-muted-foreground hover:text-emerald-600" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">有用</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleFeedback(ref, "irrelevant")}
                          className="h-5 w-5 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center justify-center transition-colors"
                          disabled={feedbackMutation.isPending}
                        >
                          <ThumbsDown className="w-3 h-3 text-muted-foreground hover:text-amber-600" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">不相关</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleFeedback(ref, "wrong")}
                          className="h-5 w-5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center transition-colors"
                          disabled={feedbackMutation.isPending}
                        >
                          <AlertTriangle className="w-3 h-3 text-muted-foreground hover:text-red-600" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">内容错误</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}

              {/* Comment input for "wrong" feedback */}
              {showCommentFor === key && (
                <div className="flex items-center gap-1 ml-1">
                  <Input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="请说明错误原因..."
                    className="h-5 text-[10px] w-32 px-1.5"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitWithComment(ref);
                      if (e.key === "Escape") {
                        setShowCommentFor(null);
                        setComment("");
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={() => submitWithComment(ref)}
                    disabled={feedbackMutation.isPending}
                  >
                    <Send className="w-2.5 h-2.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={() => {
                      setShowCommentFor(null);
                      setComment("");
                    }}
                  >
                    <X className="w-2.5 h-2.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export default function KBBot() {
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [editTitleId, setEditTitleId] = useState<number | null>(null);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Queries ─────────────────────────────────

  const conversationsQuery = trpc.kbBot.listConversations.useQuery();

  const historyQuery = trpc.kbBot.getHistory.useQuery(
    { conversationId: activeConversationId! },
    { enabled: !!activeConversationId }
  );

  // Sync history to local messages
  useEffect(() => {
    if (historyQuery.data?.messages) {
      setLocalMessages(
        historyQuery.data.messages.map((m: any) => ({
          ...m,
          references: Array.isArray(m.references) ? m.references : [],
          searchPath: Array.isArray(m.searchPath) ? m.searchPath : [],
        }))
      );
    }
  }, [historyQuery.data]);

  // ─── Mutations ───────────────────────────────

  const chatMutation = trpc.kbBot.chat.useMutation({
    onSuccess: (data) => {
      // Add assistant message to local state
      const assistantMsg: ChatMessage = {
        id: data.messageId,
        conversationId: data.conversationId,
        role: "assistant",
        content: data.content,
        references: data.references,
        searchPath: data.searchPath,
        tokensUsed: data.tokensUsed,
        createdAt: Date.now(),
      };
      setLocalMessages((prev) => [...prev, assistantMsg]);

      // Update active conversation if new
      if (!activeConversationId) {
        setActiveConversationId(data.conversationId);
      }

      // Refresh conversations list
      conversationsQuery.refetch();
    },
    onError: (error) => {
      toast.error("AI回答失败: " + error.message);
      // Remove the pending user message
      setLocalMessages((prev) => prev.slice(0, -1));
    },
  });

  const deleteMutation = trpc.kbBot.deleteConversation.useMutation({
    onSuccess: () => {
      toast.success("对话已删除");
      if (showDeleteConfirm === activeConversationId) {
        setActiveConversationId(null);
        setLocalMessages([]);
      }
      setShowDeleteConfirm(null);
      conversationsQuery.refetch();
    },
  });

  const clearAllMutation = trpc.kbBot.clearAll.useMutation({
    onSuccess: () => {
      toast.success("所有对话已清除");
      setActiveConversationId(null);
      setLocalMessages([]);
      setShowClearConfirm(false);
      conversationsQuery.refetch();
    },
  });

  const updateTitleMutation = trpc.kbBot.updateTitle.useMutation({
    onSuccess: () => {
      toast.success("标题已更新");
      setEditTitleId(null);
      conversationsQuery.refetch();
    },
  });

  // ─── Handlers ────────────────────────────────

  const handleSend = () => {
    const msg = inputValue.trim();
    if (!msg || chatMutation.isPending) return;

    // Add user message to local state immediately
    const userMsg: ChatMessage = {
      id: Date.now(),
      conversationId: activeConversationId || 0,
      role: "user",
      content: msg,
      references: [],
      searchPath: [],
      tokensUsed: null,
      createdAt: Date.now(),
    };
    setLocalMessages((prev) => [...prev, userMsg]);
    setInputValue("");

    // Send to server
    chatMutation.mutate({
      conversationId: activeConversationId || undefined,
      message: msg,
    });
  };

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setLocalMessages([]);
    textareaRef.current?.focus();
  };

  const handleSelectConversation = (id: number) => {
    if (id === activeConversationId) return;
    setActiveConversationId(id);
    setLocalMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement;
    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      });
    }
  }, [localMessages, chatMutation.isPending]);

  // Display messages (filter out system)
  const displayMessages = useMemo(
    () => localMessages.filter((m) => m.role === "user" || m.role === "assistant"),
    [localMessages]
  );

  const conversations = conversationsQuery.data || [];

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ─── Sidebar: Conversation List ─── */}
      <div
        className={cn(
          "flex flex-col border-r bg-muted/30 transition-all duration-200",
          sidebarCollapsed ? "w-0 overflow-hidden" : "w-72"
        )}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            对话记录
          </h3>
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleNewConversation}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>新建对话</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {conversations.length > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setShowClearConfirm(true)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>清除所有对话</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* Conversation List */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversationsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                暂无对话记录
              </div>
            ) : (
              conversations.map((conv: Conversation) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors",
                    conv.id === activeConversationId
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  )}
                  onClick={() => handleSelectConversation(conv.id)}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" />
                  <div className="flex-1 min-w-0">
                    {editTitleId === conv.id ? (
                      <Input
                        value={editTitleValue}
                        onChange={(e) => setEditTitleValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            updateTitleMutation.mutate({
                              conversationId: conv.id,
                              title: editTitleValue,
                            });
                          }
                          if (e.key === "Escape") setEditTitleId(null);
                        }}
                        onBlur={() => setEditTitleId(null)}
                        className="h-6 text-xs px-1"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <p className="text-xs truncate">{conv.title || "新对话"}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {conv.messageCount || 0} 条消息
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditTitleId(conv.id);
                        setEditTitleValue(conv.title || "");
                      }}
                    >
                      <Edit3 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(conv.id);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ─── Main Chat Area ─── */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-background/80 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <MessageSquare className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">AI知识助手</h2>
              <p className="text-[10px] text-muted-foreground">
                基于知识库的智能检索与问答
              </p>
            </div>
          </div>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleNewConversation}
          >
            <Plus className="w-3 h-3 mr-1" />
            新对话
          </Button>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-hidden" ref={scrollRef}>
          {displayMessages.length === 0 && !chatMutation.isPending ? (
            <div className="flex h-full flex-col items-center justify-center p-6">
              <div className="flex flex-col items-center gap-4 max-w-lg">
                <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Bot className="h-8 w-8 text-primary opacity-60" />
                </div>
                <h3 className="text-lg font-semibold text-center">
                  AI知识库助手
                </h3>
                <p className="text-sm text-muted-foreground text-center leading-relaxed">
                  我可以帮你检索知识库中的优秀案例、运营SOP、Listing文案等内容。
                  <br />
                  试着问我一个问题吧！
                </p>

                {/* Suggested Prompts */}
                <div className="grid grid-cols-2 gap-2 mt-4 w-full">
                  {SUGGESTED_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setInputValue(prompt);
                        // Auto-send after a small delay
                        setTimeout(() => {
                          const userMsg: ChatMessage = {
                            id: Date.now(),
                            conversationId: activeConversationId || 0,
                            role: "user",
                            content: prompt,
                            references: [],
                            searchPath: [],
                            tokensUsed: null,
                            createdAt: Date.now(),
                          };
                          setLocalMessages((prev) => [...prev, userMsg]);
                          setInputValue("");
                          chatMutation.mutate({
                            conversationId: activeConversationId || undefined,
                            message: prompt,
                          });
                        }, 50);
                      }}
                      disabled={chatMutation.isPending}
                      className="text-left px-3 py-2.5 rounded-lg border border-border/60 bg-card hover:bg-accent text-xs leading-relaxed transition-colors disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-4 p-4 max-w-4xl mx-auto">
                {displayMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-3",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {message.role === "assistant" && (
                      <div className="h-8 w-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}

                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground px-4 py-2.5"
                          : "bg-muted text-foreground px-4 py-3"
                      )}
                    >
                      {message.role === "assistant" ? (
                        <div>
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <Streamdown>{message.content}</Streamdown>
                          </div>

                          {/* Reference Cards */}
                          {message.references && message.references.length > 0 && (
                            <div className="mt-4 space-y-2">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                                <Database className="w-3.5 h-3.5" />
                                引用来源 ({message.references.length})
                              </div>
                              {message.references.map((ref: KbReference, idx: number) => (
                                <ReferenceCard key={`${ref.type}-${ref.id}`} ref={ref} index={idx} />
                              ))}
                            </div>
                          )}

                          {/* Search Path */}
                          {message.searchPath && message.searchPath.length > 0 && (
                            <SearchPathViz searchPath={message.searchPath} />
                          )}

                          {/* Feedback Buttons */}
                          {message.references && message.references.length > 0 && (
                            <MessageFeedback
                              messageId={message.id}
                              references={message.references}
                            />
                          )}
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                      )}
                    </div>

                    {message.role === "user" && (
                      <div className="h-8 w-8 shrink-0 mt-1 rounded-full bg-secondary flex items-center justify-center">
                        <User className="h-4 w-4 text-secondary-foreground" />
                      </div>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {chatMutation.isPending && (
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="rounded-lg bg-muted px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>正在检索知识库并生成回答...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t bg-background/80 backdrop-blur-sm p-4">
          <div className="max-w-4xl mx-auto">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex gap-2 items-end"
            >
              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入你的问题，AI将从知识库中检索相关内容..."
                className="flex-1 max-h-32 resize-none min-h-10"
                rows={1}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputValue.trim() || chatMutation.isPending}
                className="shrink-0 h-10 w-10"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              AI助手基于知识库内容回答，回答中的引用来源可展开查看详情
            </p>
          </div>
        </div>
      </div>

      {/* ─── Delete Confirmation Dialog ─── */}
      <Dialog open={showDeleteConfirm !== null} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除对话</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            删除后将无法恢复此对话及其所有消息，确定要继续吗？
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (showDeleteConfirm) {
                  deleteMutation.mutate({ conversationId: showDeleteConfirm });
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Clear All Confirmation Dialog ─── */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>清除所有对话</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            这将删除所有对话记录，此操作不可撤销。确定要继续吗？
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearAllMutation.mutate()}
              disabled={clearAllMutation.isPending}
            >
              {clearAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              确认清除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
