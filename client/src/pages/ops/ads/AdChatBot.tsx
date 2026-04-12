import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Bot, Send, Loader2, Lightbulb, BarChart3, Zap, User, Sparkles,
} from "lucide-react";
import { Streamdown } from "streamdown";

interface Props {
  campaignId: string | null;
  campaignIds?: string[];
  marketplace: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  data_cards?: Array<{ title: string; metrics: Array<{ label: string; value: string }> }>;
  actionable_suggestions?: Array<{ action: string; can_auto_execute: boolean }>;
  related_questions?: string[];
}

const QUICK_QUESTIONS = [
  "我的广告ACoS偏高，应该怎么优化？",
  "如何设置合理的广告竞价策略？",
  "SP、SB、SD广告的预算应该如何分配？",
  "什么时候应该使用否定关键词？",
  "如何判断一个关键词是否值得继续投放？",
  "新品上架的广告投放策略是什么？",
];

export default function AdChatBot({ campaignId, campaignIds, marketplace }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.adAnalysisP2.adChatBot.useMutation({
    onSuccess: (result) => {
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.answer,
        data_cards: result.data_cards,
        actionable_suggestions: result.actionable_suggestions,
        related_questions: result.related_questions,
      };
      setMessages(prev => [...prev, assistantMsg]);
    },
    onError: (err) => {
      toast.error(`AI回复失败: ${err.message}`);
      setMessages(prev => [...prev, { role: "assistant", content: `抱歉，回复失败: ${err.message}` }]);
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (question?: string) => {
    const q = question || input.trim();
    if (!q) return;

    const userMsg: ChatMessage = { role: "user", content: q };
    setMessages(prev => [...prev, userMsg]);
    setInput("");

    chatMutation.mutate({
      question: q,
      campaignId: campaignId || undefined,
      campaignIds: campaignIds && campaignIds.length > 0 ? campaignIds : undefined,
      marketplace,
      conversationHistory: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
    });
  };

  return (
    <div className="space-y-4">
      <Card className="h-[600px] flex flex-col">
        <CardHeader className="pb-2 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-600" />
              AI广告问答助手
              {campaignId && <Badge variant="outline" className="text-xs">当前Campaign: {campaignId}</Badge>}
            </CardTitle>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMessages([])}>
                清空对话
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Bot className="w-12 h-12 text-blue-200 mb-3" />
              <h3 className="text-sm font-medium text-gray-600 mb-1">亚马逊广告AI助手</h3>
              <p className="text-xs text-gray-400 mb-4 max-w-sm">
                我可以帮你分析广告数据、解答广告投放问题、提供优化建议。
                {campaignId ? "已关联当前Campaign的广告数据。" : "选择一个Campaign后可获取实时数据分析。"}
              </p>
              <div className="grid grid-cols-2 gap-2 max-w-md">
                {QUICK_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    className="text-left text-xs p-2.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                    onClick={() => handleSend(q)}
                  >
                    <Lightbulb className="w-3 h-3 text-amber-500 mb-1" />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div className={`max-w-[80%] ${msg.role === "user" ? "bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-2" : "space-y-2"}`}>
                  {msg.role === "user" ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : (
                    <>
                      <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-3 py-2">
                        <div className="text-sm text-gray-700 prose prose-sm max-w-none">
                          <Streamdown>{msg.content}</Streamdown>
                        </div>
                      </div>

                      {/* Data Cards */}
                      {msg.data_cards && msg.data_cards.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {msg.data_cards.map((card, ci) => (
                            <div key={ci} className="bg-white border rounded-lg p-2 min-w-[140px]">
                              <p className="text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                                <BarChart3 className="w-3 h-3" />
                                {card.title}
                              </p>
                              {card.metrics.map((m, mi) => (
                                <div key={mi} className="flex justify-between text-xs">
                                  <span className="text-gray-500">{m.label}</span>
                                  <span className="font-medium">{m.value}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Actionable Suggestions */}
                      {msg.actionable_suggestions && msg.actionable_suggestions.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap">
                          {msg.actionable_suggestions.map((s, si) => (
                            <Badge key={si} variant="outline" className="text-xs cursor-pointer hover:bg-blue-50">
                              <Zap className="w-3 h-3 mr-1 text-amber-500" />
                              {s.action}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Related Questions */}
                      {msg.related_questions && msg.related_questions.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap">
                          {msg.related_questions.map((q, qi) => (
                            <button
                              key={qi}
                              className="text-xs px-2 py-1 rounded-full border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-gray-600"
                              onClick={() => handleSend(q)}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-gray-600" />
                  </div>
                )}
              </div>
            ))
          )}

          {chatMutation.isPending && (
            <div className="flex gap-2 justify-start">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
              <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在思考...
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </CardContent>

        {/* Input Area */}
        <div className="border-t p-3 flex-shrink-0">
          <div className="flex gap-2">
            <Input
              placeholder="输入你的广告问题..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              disabled={chatMutation.isPending}
              className="text-sm"
            />
            <Button size="sm" onClick={() => handleSend()} disabled={chatMutation.isPending || !input.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
