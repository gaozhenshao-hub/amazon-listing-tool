import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";
import {
  Sparkles, Loader2, Activity, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, Target, Eye, MousePointerClick, DollarSign,
  ShoppingCart, Percent,
} from "lucide-react";
import { toast } from "sonner";

interface AdDiagnosticsProps {
  campaignId: string | null;
  marketplace?: string;
  days: number;
}

const HEALTH_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  excellent: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  good: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  warning: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
};

const HEALTH_LABELS: Record<string, string> = {
  excellent: "优秀", good: "良好", warning: "需关注", critical: "需改善",
};

export default function AdDiagnostics({ campaignId, marketplace, days }: AdDiagnosticsProps) {
  const [diagnosisResult, setDiagnosisResult] = useState<any>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const isLoading = false;

  const aiDiagnosis = trpc.adAnalysis.getAdDiagnosis.useMutation({
    onSuccess: (data) => {
      setDiagnosisResult(data);
      toast.success("AI诊断完成");
    },
    onError: (err) => toast.error("诊断失败", { description: err.message }),
  });

  const radarData = diagnosisResult?.dimensions?.map((d: any) => ({
    dimension: d.name,
    score: d.score,
    benchmark: 60,
  })) || [];
  const overallHealth = diagnosisResult ? 
    (diagnosisResult.overall_score >= 80 ? "excellent" : 
     diagnosisResult.overall_score >= 60 ? "good" : 
     diagnosisResult.overall_score >= 40 ? "warning" : "critical") : "good";

  const handleDiagnose = () => {
    aiDiagnosis.mutate({
      campaignId: campaignId || undefined,
      marketplace,
      days,
    });
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  const healthStyle = HEALTH_COLORS[overallHealth] || HEALTH_COLORS.good;
  const data = diagnosisResult;

  return (
    <div className="space-y-4">
      {/* Overall Health Score */}
      <Card className={`${healthStyle.bg} ${healthStyle.border} border`}>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className={`w-6 h-6 ${healthStyle.text}`} />
              <div>
                <p className="text-sm font-medium">广告健康度</p>
                <p className={`text-2xl font-bold ${healthStyle.text}`}>
                  {data?.overall_score || '--'}分
                  <span className="text-sm font-normal ml-2">({data ? HEALTH_LABELS[overallHealth] : '未诊断'})</span>
                </p>
              </div>
            </div>
            <Button onClick={handleDiagnose} disabled={aiDiagnosis.isPending} size="sm">
              {aiDiagnosis.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              AI深度诊断
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 6-Dimension Radar Chart + Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">六维度健康雷达图</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                  <Radar name="当前表现" dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                  <Radar name="行业基准" dataKey="benchmark" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.1} strokeDasharray="5 5" />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">维度详情</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {radarData.map((d: any, i: number) => {
              const icons = [Eye, MousePointerClick, ShoppingCart, DollarSign, Target, Percent];
              const Icon = icons[i % icons.length];
              const diff = d.score - d.benchmark;
              return (
                <div key={d.dimension} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                  <Icon className="w-4 h-4 text-gray-500 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{d.dimension}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{d.score}</span>
                        <span className="text-[10px] text-gray-400">/ {d.benchmark}</span>
                        {diff > 0 ? (
                          <Badge className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 border">
                            <TrendingUp className="w-2.5 h-2.5 mr-0.5" />+{diff}
                          </Badge>
                        ) : diff < 0 ? (
                          <Badge className="text-[9px] bg-red-50 text-red-700 border-red-200 border">
                            <TrendingDown className="w-2.5 h-2.5 mr-0.5" />{diff}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                      <div
                        className={`h-1.5 rounded-full ${d.score >= 70 ? "bg-emerald-500" : d.score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(d.score, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* AI Diagnosis Result */}
      {diagnosisResult && (
        <Card className="border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-500" />
              AI诊断报告
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">{diagnosisResult.overall_assessment}</p>
            </div>
            {diagnosisResult.dimensions?.map((dim: any, i: number) => (
              <div key={i} className={`p-3 rounded-lg border ${
                dim.score < 40 ? "bg-red-50/50 border-red-200" :
                dim.score < 60 ? "bg-amber-50/50 border-amber-200" :
                "bg-emerald-50/50 border-emerald-200"
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <Activity className={`w-3.5 h-3.5 ${
                    dim.score < 40 ? "text-red-500" : dim.score < 60 ? "text-amber-500" : "text-emerald-500"
                  }`} />
                  <span className="text-sm font-medium">{dim.name}</span>
                  <Badge className={`text-[10px] ${
                    dim.score < 40 ? "bg-red-100 text-red-700" :
                    dim.score < 60 ? "bg-amber-100 text-amber-700" :
                    "bg-emerald-100 text-emerald-700"
                  }`}>
                    {dim.score}分 - {dim.status}
                  </Badge>
                </div>
                {dim.problems?.map((p: string, pi: number) => (
                  <p key={pi} className="text-xs text-gray-600 ml-5">• {p}</p>
                ))}
                <div className="ml-5 mt-2 space-y-1">
                  {dim.suggestions?.map((s: string, si: number) => (
                    <p key={si} className="text-xs text-emerald-700">
                      <CheckCircle2 className="w-3 h-3 inline mr-1" />
                      {s}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
