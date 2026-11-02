import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { TrendingUp, AlertTriangle, CheckCircle, Target, ArrowRight } from "lucide-react";
import AdDeepFilters from "./AdDeepFilters";

const STAGE_COLORS: Record<string, string> = {
  "止血期": "bg-red-100 text-red-700 border-red-300",
  "稳结构期": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "放量期": "bg-green-100 text-green-700 border-green-300",
};

export default function AdDeepProductStage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const diagnoseMutation = trpc.adDeepAnalysis.diagnoseProductStage.useMutation();
  const historyQuery = trpc.adDeepAnalysis.getStageHistory.useQuery({ limit: 5 });

  const handleAnalyze = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await diagnoseMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success("产品周期诊断完成");
    } catch (err: any) {
      toast.error(`分析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleAnalyze} loading={loading} actionLabel="诊断产品阶段" />

      {/* Result Display */}
      {result && (
        <div className="space-y-4">
          {/* Stage Badge */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                诊断结果
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge className={`text-lg px-4 py-2 ${STAGE_COLORS[result.stage] || "bg-gray-100"}`}>
                  {result.stage}
                </Badge>
                <div className="text-sm text-muted-foreground">
                  置信度: <span className="font-bold text-foreground">{result.confidence}%</span>
                </div>
              </div>

              {/* Evidence */}
              {result.evidence?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <CheckCircle className="w-4 h-4 text-green-500" /> 判断依据
                  </h4>
                  <ul className="space-y-1">
                    {result.evidence.map((e: string, i: number) => (
                      <li key={i} className="text-sm text-muted-foreground pl-4 border-l-2 border-green-200">{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Red Flags */}
              {result.red_flags?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4 text-red-500" /> 风险信号
                  </h4>
                  <ul className="space-y-1">
                    {result.red_flags.map((f: string, i: number) => (
                      <li key={i} className="text-sm text-red-600 pl-4 border-l-2 border-red-200">{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Strategy */}
              {result.strategy && (
                <div className="bg-blue-50 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-medium text-blue-800">策略建议</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-blue-600 font-medium">核心操作：</span>{result.strategy.core_action}</div>
                    <div><span className="text-blue-600 font-medium">关键词策略：</span>{result.strategy.keyword_strategy}</div>
                    <div><span className="text-blue-600 font-medium">预算策略：</span>{result.strategy.budget_strategy}</div>
                    <div><span className="text-blue-600 font-medium">竞价策略：</span>{result.strategy.bid_strategy}</div>
                  </div>
                  {result.strategy.dont_do?.length > 0 && (
                    <div className="mt-2">
                      <span className="text-red-600 font-medium text-sm">禁止操作：</span>
                      <ul className="text-sm text-red-600 list-disc list-inside">
                        {result.strategy.dont_do.map((d: string, i: number) => <li key={i}>{d}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Transition Signals */}
              {result.transition_signals?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <ArrowRight className="w-4 h-4 text-purple-500" /> 阶段过渡信号
                  </h4>
                  <ul className="space-y-1">
                    {result.transition_signals.map((s: string, i: number) => (
                      <li key={i} className="text-sm text-purple-600 pl-4 border-l-2 border-purple-200">{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* History */}
      {historyQuery.data && historyQuery.data.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">历史诊断记录</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {historyQuery.data.map((h: any) => (
                <div key={h.id} className="flex items-center gap-3 text-sm border-b pb-2">
                  <Badge className={STAGE_COLORS[h.stage] || ""}>{h.stage}</Badge>
                  <span className="text-muted-foreground">{h.dateRangeStart} ~ {h.dateRangeEnd}</span>
                  <span className="text-xs text-muted-foreground">置信度 {h.confidence}%</span>
                  <Badge variant="outline" className="text-xs">{h.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
