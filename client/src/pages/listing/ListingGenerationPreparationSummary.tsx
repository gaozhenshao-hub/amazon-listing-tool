import type { ComponentType } from "react";
import { ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type KeywordReadiness = {
  completedSteps: number;
  total: number;
  allDone: boolean;
  steps: Array<{ key: string; label: string; done: boolean; icon: ComponentType<{ className?: string }>; count: number }>;
};

type FileSummary = Record<string, unknown>;

export function ListingGenerationPreparationSummary({
  project,
  analysisCount,
  fileSummary,
  kwReadiness,
  onManageKeywords,
}: {
  project?: { name?: string | null; brand?: string | null; productName?: string | null } | null;
  analysisCount: number;
  fileSummary?: FileSummary | null;
  kwReadiness?: KeywordReadiness | null;
  onManageKeywords: () => void;
}) {
  return <>
    <Card className="bg-blue-50/50 border-blue-200">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-blue-900">亚马逊Bullet Point规则</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-blue-700">
              <span>每条Bullet Point：<strong>200-280</strong> 字符（不超过280）</span>
              <span>卖点数量：AI生成 <strong>7</strong> 条，可手动增加最多 <strong>2</strong> 条（共9条）</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div>
              <p className="font-medium">{project?.name || "加载中..."}</p>
              <p className="text-sm text-muted-foreground">
                {project?.brand ? `${project.brand} · ` : ""}
                {project?.productName || ""}
                {analysisCount > 0 ? ` · ${analysisCount} 个竞品分析` : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {analysisCount > 0 && <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />已有竞品数据</Badge>}
            {fileSummary && Number(fileSummary.fileCount || 0) > 0 && (
              <Badge variant={fileSummary.hasAllFiles ? "default" : "secondary"}
                className={fileSummary.hasAllFiles ? "bg-green-600" : ""}>
                {fileSummary.hasAllFiles ? (
                  <><CheckCircle2 className="h-3 w-3 mr-1" />4/4 分析模块就绪</>
                ) : (
                  <>{[
                    fileSummary.productAttributes ? 1 : 0,
                    fileSummary.competitorListings ? 1 : 0,
                    fileSummary.cosmoScenes ? 1 : 0,
                    fileSummary.a9Keywords ? 1 : 0,
                  ].reduce((a: number, b: number) => a + b, 0)}/4 分析模块</>
                )}
              </Badge>
            )}
            {kwReadiness && (
              <Badge variant={kwReadiness.allDone ? "default" : "secondary"}
                className={kwReadiness.allDone ? "bg-green-600" : ""}>
                {kwReadiness.allDone ? (
                  <><CheckCircle2 className="h-3 w-3 mr-1" />关键词分析就绪</>
                ) : (
                  <>{kwReadiness.completedSteps}/{kwReadiness.total} 关键词步骤</>
                )}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>

    {kwReadiness && !kwReadiness.allDone && (
      <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200 mb-2">
                关键词分析未完成；关键词报告仅供人工审阅，不自动作为已确认产品事实入模
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                {kwReadiness.steps.map((step) => (
                  <div key={step.key} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                    step.done
                      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-white/60 text-muted-foreground dark:bg-gray-800/40"
                  }`}>
                    {step.done ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      : <step.icon className="h-3.5 w-3.5 shrink-0" />}
                    <span className="font-medium">{step.label}</span>
                    {step.done && <span className="ml-auto text-[10px]">({step.count})</span>}
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm"
                className="text-amber-700 border-amber-300 hover:bg-amber-100"
                onClick={onManageKeywords}>
                前往关键词管理<ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )}

    <Card className="border-amber-200 bg-amber-50/50">
      <CardContent className="p-4 text-xs text-amber-900">
        旧“重点强调”自由文本不再作为 AI 产品事实输入。请先在事实与卖点核心账本中核对真实证据，再生成和人工确认候选。
      </CardContent>
    </Card>
  </>;
}
