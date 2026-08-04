import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recalculateEconomics(data: any) {
  const economics = data.economics || {};
  const price = economics.targetPrice;
  const cost = economics.estimatedProductCost;
  if (price === null || price === undefined || cost === null || cost === undefined) {
    economics.grossProfit = null;
    economics.grossMargin = null;
    economics.netProfit = null;
    economics.netMargin = null;
    return;
  }
  const moldUnit = economics.moldCost && economics.moldAmortizationQuantity ? economics.moldCost / economics.moldAmortizationQuantity : 0;
  const gross = price - cost - moldUnit - (economics.firstMileCost || 0) - price * (economics.referralFeeRate || 0) - (economics.fbaFee || 0);
  const net = gross - price * (economics.adSalesRatio || 0) - price * (economics.returnRate || 0);
  economics.grossProfit = gross;
  economics.grossMargin = price ? gross / price : null;
  economics.netProfit = net;
  economics.netMargin = price ? net / price : null;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b pb-5 last:border-b-0 last:pb-0">
      <div><h3 className="text-sm font-semibold">{title}</h3>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, multiline, type = "text", placeholder }: { label: string; value: any; onChange: (value: any) => void; multiline?: boolean; type?: string; placeholder?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {multiline ? <Textarea value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-20 text-sm" /> : <Input type={type} value={value ?? ""} onChange={(event) => onChange(type === "number" ? numberOrNull(event.target.value) : event.target.value)} placeholder={placeholder} className="text-sm" />}
    </label>
  );
}

function StringListEditor({ label, items = [], onChange, placeholder }: { label: string; items?: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{label}</span><Button type="button" size="icon" variant="outline" className="h-7 w-7" title={`添加${label}`} onClick={() => onChange([...items, ""])}><Plus className="h-3.5 w-3.5" /></Button></div>
      {items.length === 0 && <p className="text-xs text-muted-foreground">暂无内容</p>}
      {items.map((item, index) => (
        <div key={index} className="flex gap-2">
          <Input value={item} onChange={(event) => onChange(items.map((current, itemIndex) => itemIndex === index ? event.target.value : current))} placeholder={placeholder} className="text-sm" />
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" title={`删除${label}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
    </div>
  );
}

export function InformationSummaryEditor({ data, onChange }: { data: any; onChange: (data: any) => void }) {
  const update = (path: string, value: any) => {
    const next = clone(data);
    const keys = path.split(".");
    let target = next;
    keys.slice(0, -1).forEach((key) => {
      if (!target[key]) target[key] = {};
      target = target[key];
    });
    target[keys[keys.length - 1]] = value;
    if (path.startsWith("economics.")) recalculateEconomics(next);
    onChange(next);
  };

  const updateCompetitor = (index: number, patch: Record<string, unknown>) => {
    const next = clone(data);
    next.competitors[index] = { ...next.competitors[index], ...patch };
    onChange(next);
  };

  const updateObjectList = (path: string, index: number, patch: Record<string, unknown>) => {
    const next = clone(data);
    const keys = path.split(".");
    let target = next;
    keys.forEach((key) => { target = target[key]; });
    target[index] = { ...target[index], ...patch };
    onChange(next);
  };

  const selectedCount = (data.competitors || []).filter((item: any) => item.isBenchmark).length;
  const economics = data.economics || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 border-b pb-4">
        <Badge variant="outline">系统提取</Badge>
        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">AI归纳</Badge>
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">人工补充</Badge>
        <span className="ml-auto text-xs text-muted-foreground">保存编辑后，再使用左侧“确认锁定”</span>
      </div>

      <Section title="1. 项目信息" description="产品名和竞品数据来自系统，负责人、审核人可人工补充。">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Field label="产品中文名 *" value={data.project?.productNameCn} onChange={(value) => update("project.productNameCn", value)} />
          <Field label="产品英文名" value={data.project?.productNameEn} onChange={(value) => update("project.productNameEn", value)} />
          <Field label="选品日期" type="date" value={data.project?.selectionDate} onChange={(value) => update("project.selectionDate", value)} />
          <Field label="开发负责人 *" value={data.project?.developmentOwner} onChange={(value) => update("project.developmentOwner", value)} />
          <Field label="运营负责人" value={data.project?.operationsOwner} onChange={(value) => update("project.operationsOwner", value)} />
          <Field label="审核人员" value={data.project?.reviewer} onChange={(value) => update("project.reviewer", value)} />
          <Field label="目标市场" value={data.project?.targetMarket} onChange={(value) => update("project.targetMarket", value)} />
        </div>
        <StringListEditor label="核心关键词" items={data.project?.keywords} onChange={(items) => update("project.keywords", items)} placeholder="输入关键词" />
      </Section>

      <Section title="2. 对标竞品选择" description={`已选择 ${selectedCount} 个。AI只提供候选和理由，必须由人工勾选确认。`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead><tr className="border-b text-muted-foreground"><th className="w-12 pb-2">对标</th><th className="pb-2 pr-3">竞品</th><th className="pb-2 pr-3">系统数据</th><th className="pb-2 pr-3">对标理由 *</th><th className="pb-2">人工备注</th></tr></thead>
            <tbody>{(data.competitors || []).map((item: any, index: number) => (
              <tr key={item.productId || `${item.asin}-${index}`} className={`border-b align-top last:border-0 ${item.isBenchmark ? "bg-emerald-50/60" : ""}`}>
                <td className="py-3"><Checkbox checked={Boolean(item.isBenchmark)} onCheckedChange={(checked) => updateCompetitor(index, { isBenchmark: Boolean(checked) })} aria-label={`选择 ${item.asin} 为对标竞品`} /></td>
                <td className="py-3 pr-3"><div className="flex items-center gap-2"><span className="font-mono font-medium text-primary">{item.asin || "-"}</span>{item.aiRecommendedBenchmark && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">AI推荐</Badge>}</div><p className="mt-1 max-w-56 line-clamp-2">{item.title || "未知标题"}</p></td>
                <td className="py-3 pr-3 text-muted-foreground"><p>{item.competitorStatus || "常规"} · {item.priceTier || "待判断"}价格带</p><p className="mt-1">${item.price ?? "-"} · 月销 {item.monthlySales ?? "-"} · {item.rating ?? "-"} 分</p></td>
                <td className="py-3 pr-3"><Textarea value={item.benchmarkReason || ""} onChange={(event) => updateCompetitor(index, { benchmarkReason: event.target.value })} className="min-h-20 text-xs" placeholder="为什么值得对标；AI理由可修改" /></td>
                <td className="py-3"><Textarea value={item.manualNote || ""} onChange={(event) => updateCompetitor(index, { manualNote: event.target.value })} className="min-h-20 text-xs" placeholder="人工判断、风险或参考点" /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      <Section title="3. 市场证据" description="自动汇总已确认的市场、价格、品牌和评论阶段，可人工修正后锁定。">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="销量趋势 *" value={data.marketEvidence?.salesTrend} onChange={(value) => update("marketEvidence.salesTrend", value)} multiline />
          <Field label="季节性" value={data.marketEvidence?.seasonality} onChange={(value) => update("marketEvidence.seasonality", value)} multiline />
          <div className="md:col-span-2"><Field label="品牌竞争结论 *" value={data.marketEvidence?.brandAnalysis} onChange={(value) => update("marketEvidence.brandAnalysis", value)} multiline /></div>
          <StringListEditor label="对标优势" items={data.marketEvidence?.benchmarkAdvantages} onChange={(items) => update("marketEvidence.benchmarkAdvantages", items)} />
          <StringListEditor label="对标劣势" items={data.marketEvidence?.benchmarkDisadvantages} onChange={(items) => update("marketEvidence.benchmarkDisadvantages", items)} />
        </div>
      </Section>

      <Section title="4. 产品机会" description="功能、场景、用户和卖点将直接进入综合决策上下文。">
        <div className="grid gap-4 md:grid-cols-2">
          <StringListEditor label="主要功能 *" items={data.productOpportunity?.mainFunctions} onChange={(items) => update("productOpportunity.mainFunctions", items)} />
          <StringListEditor label="使用场景" items={data.productOpportunity?.usageScenarios} onChange={(items) => update("productOpportunity.usageScenarios", items)} />
          <StringListEditor label="目标用户" items={data.productOpportunity?.targetAudience} onChange={(items) => update("productOpportunity.targetAudience", items)} />
          <StringListEditor label="正向信号" items={data.productOpportunity?.positiveSignals} onChange={(items) => update("productOpportunity.positiveSignals", items)} />
          <StringListEditor label="负向信号" items={data.productOpportunity?.negativeSignals} onChange={(items) => update("productOpportunity.negativeSignals", items)} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">核心卖点 *</span><Button type="button" size="icon" variant="outline" className="h-7 w-7" title="添加核心卖点" onClick={() => update("productOpportunity.sellingPoints", [...(data.productOpportunity?.sellingPoints || []), { point: "", evidence: "", implementation: "" }])}><Plus className="h-3.5 w-3.5" /></Button></div>
          {(data.productOpportunity?.sellingPoints || []).map((item: any, index: number) => <div key={index} className="grid gap-2 border-l-2 border-primary/30 pl-3 md:grid-cols-3"><Field label="卖点" value={item.point} onChange={(value) => updateObjectList("productOpportunity.sellingPoints", index, { point: value })} /><Field label="证据" value={item.evidence} onChange={(value) => updateObjectList("productOpportunity.sellingPoints", index, { evidence: value })} /><div className="flex gap-2"><div className="flex-1"><Field label="实现方式" value={item.implementation} onChange={(value) => updateObjectList("productOpportunity.sellingPoints", index, { implementation: value })} /></div><Button type="button" size="icon" variant="ghost" className="mt-6 h-9 w-9 text-muted-foreground hover:text-destructive" title="删除卖点" onClick={() => update("productOpportunity.sellingPoints", data.productOpportunity.sellingPoints.filter((_: any, itemIndex: number) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button></div></div>)}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">痛点与解决方案</span><Button type="button" size="icon" variant="outline" className="h-7 w-7" title="添加痛点" onClick={() => update("productOpportunity.painPoints", [...(data.productOpportunity?.painPoints || []), { point: "", evidence: "", resolved: false, resolution: "" }])}><Plus className="h-3.5 w-3.5" /></Button></div>
          {(data.productOpportunity?.painPoints || []).map((item: any, index: number) => <div key={index} className="grid gap-2 border-l-2 border-amber-300 pl-3 md:grid-cols-3"><Field label="痛点" value={item.point} onChange={(value) => updateObjectList("productOpportunity.painPoints", index, { point: value })} /><Field label="证据" value={item.evidence} onChange={(value) => updateObjectList("productOpportunity.painPoints", index, { evidence: value })} /><div className="space-y-2"><label className="flex items-center gap-2 text-xs"><Checkbox checked={Boolean(item.resolved)} onCheckedChange={(checked) => updateObjectList("productOpportunity.painPoints", index, { resolved: Boolean(checked) })} />设计方案已解决</label><div className="flex gap-2"><Input value={item.resolution || ""} onChange={(event) => updateObjectList("productOpportunity.painPoints", index, { resolution: event.target.value })} placeholder="解决方式" className="text-sm" /><Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" title="删除痛点" onClick={() => update("productOpportunity.painPoints", data.productOpportunity.painPoints.filter((_: any, itemIndex: number) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button></div></div></div>)}
        </div>
      </Section>

      <Section title="5. 专利与合规" description="勾选需要专利评估后，风险等级和结论会成为锁定必填项。">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(data.patentRisk?.required)} onCheckedChange={(checked) => update("patentRisk.required", Boolean(checked))} />需要专利风险分析</label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">风险等级</span><select value={data.patentRisk?.riskLevel || "未评估"} onChange={(event) => update("patentRisk.riskLevel", event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option>未评估</option><option>低</option><option>中</option><option>高</option></select></label>
          <StringListEditor label="专利报告/文件引用" items={data.patentRisk?.reportRefs} onChange={(items) => update("patentRisk.reportRefs", items)} />
          <StringListEditor label="相关专利" items={data.patentRisk?.relatedPatents} onChange={(items) => update("patentRisk.relatedPatents", items)} />
          <Field label="分析摘要" value={data.patentRisk?.summary} onChange={(value) => update("patentRisk.summary", value)} multiline />
          <Field label="专利风险结论" value={data.patentRisk?.conclusion} onChange={(value) => update("patentRisk.conclusion", value)} multiline />
          <div className="md:col-span-2"><Field label="规避方案" value={data.patentRisk?.avoidancePlan} onChange={(value) => update("patentRisk.avoidancePlan", value)} multiline /></div>
        </div>
      </Section>

      <Section title="6. 落地计划" description="作为立项建议草案，下游正式开发页面仍可继续细化。">
        <div className="grid gap-4 md:grid-cols-2">
          <StringListEditor label="开发优化意见" items={data.landingPlan?.developmentSuggestions} onChange={(items) => update("landingPlan.developmentSuggestions", items)} />
          <StringListEditor label="运营优化意见" items={data.landingPlan?.operationsSuggestions} onChange={(items) => update("landingPlan.operationsSuggestions", items)} />
          <StringListEditor label="外观方案" items={data.landingPlan?.appearanceConcepts} onChange={(items) => update("landingPlan.appearanceConcepts", items)} />
          <Field label="设计方案" value={data.landingPlan?.designConcept} onChange={(value) => update("landingPlan.designConcept", value)} multiline />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">开发里程碑</span><Button type="button" size="icon" variant="outline" className="h-7 w-7" title="添加里程碑" onClick={() => update("landingPlan.timeline", [...(data.landingPlan?.timeline || []), { milestone: "", targetDate: "", note: "" }])}><Plus className="h-3.5 w-3.5" /></Button></div>
          {(data.landingPlan?.timeline || []).map((item: any, index: number) => <div key={index} className="grid gap-2 border-l-2 border-primary/30 pl-3 md:grid-cols-3"><Field label="里程碑" value={item.milestone} onChange={(value) => updateObjectList("landingPlan.timeline", index, { milestone: value })} /><Field label="目标日期" type="date" value={item.targetDate} onChange={(value) => updateObjectList("landingPlan.timeline", index, { targetDate: value })} /><div className="flex gap-2"><div className="flex-1"><Field label="备注" value={item.note} onChange={(value) => updateObjectList("landingPlan.timeline", index, { note: value })} /></div><Button type="button" size="icon" variant="ghost" className="mt-6 h-9 w-9 text-muted-foreground hover:text-destructive" title="删除里程碑" onClick={() => update("landingPlan.timeline", data.landingPlan.timeline.filter((_: any, itemIndex: number) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button></div></div>)}
        </div>
      </Section>

      <Section title="7. 初步成本与利润" description="人工录入假设后自动估算；正式 BOM 和利润页仍是最终数据源。">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="目标售价 USD" type="number" value={economics.targetPrice} onChange={(value) => update("economics.targetPrice", value)} />
          <Field label="产品成本 USD" type="number" value={economics.estimatedProductCost} onChange={(value) => update("economics.estimatedProductCost", value)} />
          <Field label="模具成本 USD" type="number" value={economics.moldCost} onChange={(value) => update("economics.moldCost", value)} />
          <Field label="模具摊销数量" type="number" value={economics.moldAmortizationQuantity} onChange={(value) => update("economics.moldAmortizationQuantity", value)} />
          <Field label="头程 USD" type="number" value={economics.firstMileCost} onChange={(value) => update("economics.firstMileCost", value)} />
          <Field label="FBA费 USD" type="number" value={economics.fbaFee} onChange={(value) => update("economics.fbaFee", value)} />
          <Field label="佣金率（小数）" type="number" value={economics.referralFeeRate} onChange={(value) => update("economics.referralFeeRate", value)} placeholder="0.15" />
          <Field label="广告销售比（小数）" type="number" value={economics.adSalesRatio} onChange={(value) => update("economics.adSalesRatio", value)} placeholder="0.10" />
          <Field label="退货率（小数）" type="number" value={economics.returnRate} onChange={(value) => update("economics.returnRate", value)} placeholder="0.05" />
          <Field label="CPC USD" type="number" value={economics.cpc} onChange={(value) => update("economics.cpc", value)} />
          <Field label="转化率（小数）" type="number" value={economics.conversionRate} onChange={(value) => update("economics.conversionRate", value)} placeholder="0.12" />
        </div>
        <div className="grid gap-3 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">毛利润</p><p className="font-semibold">{economics.grossProfit == null ? "待计算" : `$${Number(economics.grossProfit).toFixed(2)}`}</p></div><div><p className="text-xs text-muted-foreground">毛利率</p><p className="font-semibold">{economics.grossMargin == null ? "待计算" : `${(economics.grossMargin * 100).toFixed(1)}%`}</p></div><div><p className="text-xs text-muted-foreground">净利润</p><p className="font-semibold">{economics.netProfit == null ? "待计算" : `$${Number(economics.netProfit).toFixed(2)}`}</p></div><div><p className="text-xs text-muted-foreground">净利率</p><p className="font-semibold">{economics.netMargin == null ? "待计算" : `${(economics.netMargin * 100).toFixed(1)}%`}</p></div></div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">供应商初步报价</span><Button type="button" size="icon" variant="outline" className="h-7 w-7" title="添加供应商" onClick={() => update("economics.suppliers", [...(economics.suppliers || []), { name: "", quote: null, moq: null, note: "" }])}><Plus className="h-3.5 w-3.5" /></Button></div>
          {(economics.suppliers || []).length === 0 && <p className="text-xs text-muted-foreground">暂无供应商报价，可在此人工补充。</p>}
          {(economics.suppliers || []).map((supplier: any, index: number) => <div key={index} className="grid gap-2 border-l-2 border-primary/30 pl-3 md:grid-cols-4"><Field label="供应商" value={supplier.name} onChange={(value) => updateObjectList("economics.suppliers", index, { name: value })} /><Field label="报价 USD" type="number" value={supplier.quote} onChange={(value) => updateObjectList("economics.suppliers", index, { quote: value })} /><Field label="MOQ" type="number" value={supplier.moq} onChange={(value) => updateObjectList("economics.suppliers", index, { moq: value })} /><div className="flex gap-2"><div className="flex-1"><Field label="备注" value={supplier.note} onChange={(value) => updateObjectList("economics.suppliers", index, { note: value })} /></div><Button type="button" size="icon" variant="ghost" className="mt-6 h-9 w-9 text-muted-foreground hover:text-destructive" title="删除供应商" onClick={() => update("economics.suppliers", economics.suppliers.filter((_: any, itemIndex: number) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button></div></div>)}
        </div>
        <StringListEditor label="成本与利润假设" items={economics.assumptions} onChange={(items) => update("economics.assumptions", items)} />
      </Section>
    </div>
  );
}
