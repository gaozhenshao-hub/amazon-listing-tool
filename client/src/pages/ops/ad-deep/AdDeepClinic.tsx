import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Stethoscope, Send, Loader2, User, Bot, AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";
import AdDeepFilters from "./AdDeepFilters";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  diagnosis?: any;
}

export default function AdDeepClinic() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPortfolios, setSelectedPortfolios] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const clinicMutation = trpc.adDeepAnalysis.clinicDiagnosis.useMutation();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSetFilters = (portfolios: string[], ds: string, de: string) => {
    setSelectedPortfolios(portfolios);
    setDateStart(ds);
    setDateEnd(de);
    toast.success("筛选条件已设置，请在下方描述您的广告问题");
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    if (selectedPortfolios.length === 0) {
      toast.error("请先设置筛选条件（选择广告组合和日期范围）");
      return;
    }

    const userMsg: Message = { role: "user", content: input.trim(), timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await clinicMutation.mutateAsync({
        portfolioNames: selectedPortfolios,
        dateStart,
        dateEnd,
        symptom: input.trim(),
        conversationHistory: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      const assistantMsg: Message = {
        role: "assistant",
        content: res.response || "分析完成",
        timestamp: Date.now(),
        diagnosis: res.diagnosis,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      toast.error(`诊断失败: ${err.message}`);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `诊断出错: ${err.message}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Stethoscope className="w-5 h-5 text-purple-600" />
        <h2 className="text-lg font-bold">疑难杂症AI诊所</h2>
        <Badge variant="outline" className="text-xs">描述症状 → AI诊断 → 操作处方</Badge>
      </div>

      <AdDeepFilters onFilter={handleSetFilters} loading={false} actionLabel="设置筛选条件" />

      {/* Chat Area */}
      <Card className="min-h-[400px] flex flex-col">
        <CardContent className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[500px]">
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Stethoscope className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">请先设置筛选条件，然后描述您遇到的广告问题</p>
              <p className="text-xs mt-2">例如："ACOS突然飙升到50%以上，但点击量没有明显变化"</p>
              <p className="text-xs">"自然排名在上升但广告转化率在下降"</p>
              <p className="text-xs">"竞品突然降价，我的广告位被挤掉了"</p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-purple-600" />
                </div>
              )}
              <div className={`max-w-[80%] space-y-2 ${msg.role === "user" ? "text-right" : ""}`}>
                <div className={`rounded-lg p-3 text-sm ${msg.role === "user" ? "bg-blue-600 text-white" : "bg-muted"}`}>
                  {msg.content}
                </div>

                {/* Structured Diagnosis */}
                {msg.diagnosis && (
                  <div className="space-y-2 text-left">
                    {msg.diagnosis.root_cause && (
                      <div className="border-l-4 border-red-400 pl-3 py-1">
                        <p className="text-xs font-medium text-red-600">根因分析</p>
                        <p className="text-sm">{msg.diagnosis.root_cause}</p>
                      </div>
                    )}
                    {msg.diagnosis.evidence?.length > 0 && (
                      <div className="border-l-4 border-blue-400 pl-3 py-1">
                        <p className="text-xs font-medium text-blue-600">数据佐证</p>
                        <ul className="text-sm space-y-0.5">
                          {msg.diagnosis.evidence.map((e: string, j: number) => (
                            <li key={j}>• {e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {msg.diagnosis.prescription?.length > 0 && (
                      <div className="border-l-4 border-green-400 pl-3 py-1">
                        <p className="text-xs font-medium text-green-600">操作处方</p>
                        <ol className="text-sm space-y-0.5">
                          {msg.diagnosis.prescription.map((p: string, j: number) => (
                            <li key={j}>{j + 1}. {p}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {msg.diagnosis.monitoring && (
                      <div className="border-l-4 border-yellow-400 pl-3 py-1">
                        <p className="text-xs font-medium text-yellow-600">后续监控</p>
                        <p className="text-sm">{msg.diagnosis.monitoring}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-blue-600" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
              </div>
              <div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground">
                AI正在分析您的广告数据，请稍候...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </CardContent>

        {/* Input Area */}
        <div className="border-t p-4">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="描述您的广告问题或症状..."
              rows={2}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button onClick={handleSend} disabled={loading || !input.trim()} className="self-end">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
