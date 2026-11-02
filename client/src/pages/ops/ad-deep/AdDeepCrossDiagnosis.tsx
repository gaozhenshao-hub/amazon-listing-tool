import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Zap, AlertTriangle, CheckCircle, TrendingDown, TrendingUp, ArrowRight } from "lucide-react";
import AdDeepFilters from "./AdDeepFilters";

const SEVERITY_COLORS: Record<string, string> = {
  "critical": "bg-red-100 text-red-700 border-red-300",
  "warning": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "info": "bg-blue-100 text-blue-700 border-blue-300",
};

export default function AdDeepCrossDiagnosis() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const diagnoseMutation = trpc.adDeepAnalysis.crossReportDiagnosis.useMutation();

  const handleAnalyze = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await diagnoseMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success("多报表串联诊断完成");
    } catch (err: any) {
      toast.error(`分析失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleAnalyze} loading={loading} actionLabel="串联诊断" />

      {result && (
        <div className="space-y-4">
          {/* Overall Health Score */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">广告健康评分</h3>
                  <p className="text-sm text-muted-foreground">基于5份报表交叉验证</p>
                </div>
                <div className="text-right">
                  <span className={`text-4xl font-bold ${(result.health_score || 0) >= 70 ? "text-green-600" : (result.health_score || 0) >= 40 ? "text-yellow-600" : "text-red-600"}`}>
                    {result.health_score || 0}
                  </span>
                  <span className="text-lg text-muted-foreground">/100</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Diagnosis Items */}
          {result.diagnoses?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Zap className="w-4 h-4" />
                  诊断发现 ({result.diagnoses.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.diagnoses.map((d: any, i: number) => (
                  <div key={i} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className={SEVERITY_COLORS[d.severity] || ""}>{d.severity === "critical" ? "严重" : d.severity === "warning" ? "警告" : "提示"}</Badge>
                      <span className="font-medium text-sm">{d.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{d.description}</p>
                    {d.data_sources?.length > 0 && (
                      <div className="flex gap-1">
                        {d.data_sources.map((s: string, j: number) => (
                          <Badge key={j} variant="outline" className="text-xs">{s}</Badge>
                        ))}
                      </div>
                    )}
                    {d.action && (
                      <div className="bg-muted/50 rounded p-2 text-sm flex items-start gap-2">
                        <ArrowRight className="w-4 h-4 mt-0.5 text-blue-500 shrink-0" />
                        <span>{d.action}</span>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Contradictions */}
          {result.contradictions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  数据矛盾点
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.contradictions.map((c: any, i: number) => (
                  <div key={i} className="border-l-4 border-yellow-400 pl-3 py-2">
                    <p className="text-sm font-medium">{c.point}</p>
                    <p className="text-xs text-muted-foreground">{c.explanation}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Priority Actions */}
          {result.priority_actions?.length > 0 && (
            <Card className="bg-green-50 border-green-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-green-800">
                  <CheckCircle className="w-4 h-4" />
                  优先行动清单
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {result.priority_actions.map((a: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-green-700">
                      <Badge variant="outline" className="shrink-0 text-xs border-green-400">{i + 1}</Badge>
                      {a}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
