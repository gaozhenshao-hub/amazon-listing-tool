import { AlertTriangle, Bot, Calculator, CheckCircle2, ClipboardList, FileSearch, LockKeyhole, PackageSearch, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

function EmptyValue({ children = "待补充" }: { children?: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function ValueList({ items }: { items?: string[] }) {
  if (!items?.length) return <EmptyValue />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => <Badge key={`${item}-${index}`} variant="secondary" className="font-normal">{item}</Badge>)}
    </div>
  );
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : "待补充";
}

function percentage(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${(parsed * 100).toFixed(1)}%` : "待补充";
}

export function InformationSummaryResult({ result }: { result: any }) {
  const completeness = result.completeness || {};
  const sources = result.provenance?.sources || [];
  const competitors = result.competitors || [];
  const benchmarks = competitors.filter((item: any) => item.isBenchmark);
  const recommended = competitors.filter((item: any) => item.aiRecommendedBenchmark && !item.isBenchmark);
  const opportunity = result.productOpportunity || {};
  const economics = result.economics || {};

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-primary" />
                决策前信息汇总
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">已确认分析证据、AI归纳和人工补充的统一决策输入</p>
            </div>
            <div className="min-w-44 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span>必填完整度</span>
                <span className="font-semibold">{completeness.score ?? 0}%</span>
              </div>
              <Progress value={completeness.score || 0} className="h-2" />
              <p className="text-right text-xs text-muted-foreground">
                {completeness.completedRequired || 0}/{completeness.totalRequired || 0} 项
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {sources.map((source: any) => (
              <Badge key={source.key} variant="outline" className={source.status === "confirmed" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>
                {source.status === "confirmed" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
                {source.label}
              </Badge>
            ))}
          </div>
          {result.executiveSummary ? <p className="text-sm leading-6">{result.executiveSummary}</p> : <EmptyValue>AI汇总尚未生成</EmptyValue>}
          {(completeness.requiredMissing?.length > 0 || completeness.optionalMissing?.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="border-l-2 border-red-400 pl-3">
                <p className="text-xs font-medium text-red-700">锁定前必须补充</p>
                <p className="mt-1 text-xs text-muted-foreground">{completeness.requiredMissing?.join("、") || "无"}</p>
              </div>
              <div className="border-l-2 border-amber-400 pl-3">
                <p className="text-xs font-medium text-amber-700">建议补充</p>
                <p className="mt-1 text-xs text-muted-foreground">{completeness.optionalMissing?.join("、") || "无"}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><UserRound className="h-4 w-4" />项目信息</CardTitle></CardHeader>
        <CardContent className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["产品中文名", result.project?.productNameCn], ["产品英文名", result.project?.productNameEn], ["选品日期", result.project?.selectionDate],
            ["开发负责人", result.project?.developmentOwner], ["运营负责人", result.project?.operationsOwner], ["审核人员", result.project?.reviewer],
            ["目标市场", result.project?.targetMarket],
          ].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value || <EmptyValue />}</p></div>)}
          <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">核心关键词</p><div className="mt-1"><ValueList items={result.project?.keywords} /></div></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm"><PackageSearch className="h-4 w-4" />对标竞品</CardTitle>
          <p className="text-xs text-muted-foreground">人工选择 {benchmarks.length} 个；AI另推荐 {recommended.length} 个候选</p>
        </CardHeader>
        <CardContent>
          {benchmarks.length === 0 ? <EmptyValue>请编辑并选择至少一个对标竞品</EmptyValue> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead><tr className="border-b text-muted-foreground"><th className="pb-2 pr-3">ASIN / 产品</th><th className="pb-2 pr-3">状态</th><th className="pb-2 pr-3">价格 / 销量 / 评分</th><th className="pb-2 pr-3">对标理由</th><th className="pb-2">人工备注</th></tr></thead>
                <tbody>{benchmarks.map((item: any) => (
                  <tr key={item.productId || item.asin} className="border-b align-top last:border-0">
                    <td className="py-3 pr-3"><p className="font-mono font-medium text-primary">{item.asin || "-"}</p><p className="mt-1 max-w-64 line-clamp-2">{item.title || "未知标题"}</p></td>
                    <td className="py-3 pr-3"><Badge variant="secondary">{item.competitorStatus || "常规"}</Badge><p className="mt-1 text-muted-foreground">{item.priceTier || "待判断"}价格带</p></td>
                    <td className="py-3 pr-3"><p>{money(item.price)} / {item.monthlySales ?? "-"} / {item.rating ?? "-"}</p><div className="mt-1"><ValueList items={item.primaryTags} /></div></td>
                    <td className="py-3 pr-3 leading-5">{item.benchmarkReason || <EmptyValue />}</td>
                    <td className="py-3 leading-5">{item.manualNote || <EmptyValue />}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Bot className="h-4 w-4" />市场证据与机会</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div><p className="text-xs font-medium text-muted-foreground">销量趋势</p><p className="mt-1 leading-6">{result.marketEvidence?.salesTrend || <EmptyValue />}</p></div>
            <div><p className="text-xs font-medium text-muted-foreground">季节性</p><p className="mt-1 leading-6">{result.marketEvidence?.seasonality || <EmptyValue />}</p></div>
            <div><p className="text-xs font-medium text-muted-foreground">品牌竞争</p><p className="mt-1 leading-6">{result.marketEvidence?.brandAnalysis || <EmptyValue />}</p></div>
            <Separator />
            <div><p className="mb-2 text-xs font-medium text-muted-foreground">主要功能</p><ValueList items={opportunity.mainFunctions} /></div>
            <div><p className="mb-2 text-xs font-medium text-muted-foreground">使用场景</p><ValueList items={opportunity.usageScenarios} /></div>
            <div><p className="mb-2 text-xs font-medium text-muted-foreground">目标用户</p><ValueList items={opportunity.targetAudience} /></div>
            <Separator />
            <div className="space-y-2"><p className="text-xs font-medium text-muted-foreground">核心卖点</p>{opportunity.sellingPoints?.length ? opportunity.sellingPoints.map((item: any, index: number) => <div key={index} className="border-l-2 border-emerald-300 pl-3"><p className="font-medium">{item.point}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.evidence || "证据待补充"} · {item.implementation || "实现方式待补充"}</p></div>) : <EmptyValue />}</div>
            <div className="space-y-2"><p className="text-xs font-medium text-muted-foreground">痛点与解决状态</p>{opportunity.painPoints?.length ? opportunity.painPoints.map((item: any, index: number) => <div key={index} className="flex items-start justify-between gap-3 border-l-2 border-amber-300 pl-3"><div><p>{item.point}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.resolution || "解决方式待补充"}</p></div><Badge variant={item.resolved ? "secondary" : "outline"}>{item.resolved ? "已解决" : "待解决"}</Badge></div>) : <EmptyValue />}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><FileSearch className="h-4 w-4" />专利风险与落地</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">是否需要专利分析</span><Badge variant={result.patentRisk?.required ? "destructive" : "secondary"}>{result.patentRisk?.required ? "需要" : "暂不需要"}</Badge></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">风险等级</span><Badge variant="outline">{result.patentRisk?.riskLevel || "未评估"}</Badge></div>
            <div><p className="text-xs font-medium text-muted-foreground">结论</p><p className="mt-1 leading-6">{result.patentRisk?.conclusion || <EmptyValue />}</p></div>
            <div><p className="text-xs font-medium text-muted-foreground">规避方案</p><p className="mt-1 leading-6">{result.patentRisk?.avoidancePlan || <EmptyValue />}</p></div>
            <Separator />
            <div><p className="mb-2 text-xs font-medium text-muted-foreground">开发建议</p><ValueList items={result.landingPlan?.developmentSuggestions} /></div>
            <div><p className="mb-2 text-xs font-medium text-muted-foreground">运营建议</p><ValueList items={result.landingPlan?.operationsSuggestions} /></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Calculator className="h-4 w-4" />初步经济模型</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["目标售价", money(economics.targetPrice)], ["产品成本", money(economics.estimatedProductCost)], ["毛利润", money(economics.grossProfit)],
              ["毛利率", percentage(economics.grossMargin)], ["净利润", money(economics.netProfit)], ["净利率", percentage(economics.netMargin)],
            ].map(([label, value]) => <div key={label} className="border-l-2 border-primary/30 pl-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}
          </div>
          <div className="mt-4 flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            此处为立项前估算；锁定后成为综合决策输入，正式 BOM 与利润核算仍在下游页面完成。
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
