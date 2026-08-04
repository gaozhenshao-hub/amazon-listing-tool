import type * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, BarChart3, Brain, Check, Edit3, Loader2, Lock, Unlock, Play, RefreshCw, TrendingUp, DollarSign, Building2, MessageSquare, LayoutDashboard, Grid3X3, Sparkles } from "lucide-react";
import { Streamdown } from "streamdown";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter, ZAxis, LineChart, Line } from "recharts";
import { CHART_COLORS, DEV_ANALYSIS_STAGES as STAGES, type DevAnalysisStageKey as StageKey } from "./stageDefinitions";

/* ─── Stage Form Editor ─── */
function FormField({ label, value, onChange, multiline, type = "text" }: { label: string; value: any; onChange: (v: any) => void; multiline?: boolean; type?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {multiline ? (
        <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="text-sm min-h-[80px]" />
      ) : type === "number" ? (
        <Input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")} className="text-sm" />
      ) : (
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="text-sm" />
      )}
    </div>
  );
}

function FormListEditor({ label, items, onChange, renderItem }: { label: string; items: any[]; onChange: (items: any[]) => void; renderItem?: (item: any, idx: number, update: (v: any) => void) => React.ReactNode }) {
  const addItem = () => onChange([...items, typeof items[0] === "string" ? "" : {}]);
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, val: any) => { const next = [...items]; next[idx] = val; onChange(next); };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={addItem}>添加</Button>
      </div>
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-start">
          <div className="flex-1">
            {renderItem ? renderItem(item, idx, (v) => updateItem(idx, v)) : (
              <Input value={typeof item === "string" ? item : JSON.stringify(item)} onChange={(e) => updateItem(idx, e.target.value)} className="text-sm" />
            )}
          </div>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500" onClick={() => removeItem(idx)}>×</Button>
        </div>
      ))}
    </div>
  );
}

export function StageFormEditor({ stageKey, data, onChange }: { stageKey: StageKey; data: any; onChange: (d: any) => void }) {
  const update = (path: string, value: any) => {
    const next = JSON.parse(JSON.stringify(data));
    const keys = path.split(".");
    let obj = next;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    onChange(next);
  };

  const ai = data.ai || {};

  switch (stageKey) {
    case "market_overview":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">市场总结</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="市场总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="市场成熟度" value={ai.maturityLevel} onChange={(v) => update("ai.maturityLevel", v)} />
                <FormField label="增长趋势" value={ai.growthTrend} onChange={(v) => update("ai.growthTrend", v)} />
                <FormField label="季节性" value={ai.seasonality} onChange={(v) => update("ai.seasonality", v)} />
                <FormField label="市场容量判断" value={ai.marketCapacity} onChange={(v) => update("ai.marketCapacity", v)} />
                <FormField label="进入时机" value={ai.entryTiming} onChange={(v) => update("ai.entryTiming", v)} />
              </div>
            </CardContent>
          </Card>
          {Array.isArray(ai.opportunities) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">市场机会</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="机会列表" items={ai.opportunities} onChange={(v) => update("ai.opportunities", v)} />
              </CardContent>
            </Card>
          )}
          {Array.isArray(ai.threats) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">市场风险</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="风险列表" items={ai.threats} onChange={(v) => update("ai.threats", v)} />
              </CardContent>
            </Card>
          )}
        </div>
      );

    case "attribute_cross":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">属性交叉分析</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
            </CardContent>
          </Card>
          {Array.isArray(ai.mainstreamProducts) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">主流产品组合</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="主流组合" items={ai.mainstreamProducts} onChange={(v) => update("ai.mainstreamProducts", v)}
                  renderItem={(item, _idx, upd) => (
                    <div className="space-y-2 p-2 border rounded">
                      <FormField label="组合" value={item.combination} onChange={(v) => upd({ ...item, combination: v })} />
                      <FormField label="占比" value={item.share} onChange={(v) => upd({ ...item, share: v })} />
                      <FormField label="分析" value={item.analysis} onChange={(v) => upd({ ...item, analysis: v })} multiline />
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}
          {Array.isArray(ai.differentiationOpportunities) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">差异化机会</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="机会" items={ai.differentiationOpportunities} onChange={(v) => update("ai.differentiationOpportunities", v)}
                  renderItem={(item, _idx, upd) => (
                    <div className="space-y-2 p-2 border rounded">
                      <FormField label="方向" value={item.direction} onChange={(v) => upd({ ...item, direction: v })} />
                      <FormField label="原因" value={item.reason} onChange={(v) => upd({ ...item, reason: v })} multiline />
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}
          {Array.isArray(ai.redOceanWarnings) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">红海警告</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="警告" items={ai.redOceanWarnings} onChange={(v) => update("ai.redOceanWarnings", v)} />
              </CardContent>
            </Card>
          )}
        </div>
      );

    case "price_analysis":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">价格分析</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="最佳价格区间(低)" value={ai.bestPriceRange?.min} onChange={(v) => update("ai.bestPriceRange.min", Number(v))} type="number" />
                <FormField label="最佳价格区间(高)" value={ai.bestPriceRange?.max} onChange={(v) => update("ai.bestPriceRange.max", Number(v))} type="number" />
              </div>
              <FormField label="定价策略" value={ai.pricingStrategy} onChange={(v) => update("ai.pricingStrategy", v)} multiline />
            </CardContent>
          </Card>
          {Array.isArray(ai.priceInsights) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">价格洞察</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="洞察" items={ai.priceInsights} onChange={(v) => update("ai.priceInsights", v)} />
              </CardContent>
            </Card>
          )}
        </div>
      );

    case "brand_competition":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">品牌竞争分析</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
              <FormField label="竞争格局" value={ai.competitionPattern} onChange={(v) => update("ai.competitionPattern", v)} />
            </CardContent>
          </Card>
          {ai.entryStrategy && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">进入策略</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <FormField label="进入方式" value={ai.entryStrategy?.approach} onChange={(v) => update("ai.entryStrategy.approach", v)} />
                <FormField label="目标细分" value={ai.entryStrategy?.targetSegment} onChange={(v) => update("ai.entryStrategy.targetSegment", v)} />
                <FormField label="差异化切入点" value={ai.entryStrategy?.differentiationPoint} onChange={(v) => update("ai.entryStrategy.differentiationPoint", v)} multiline />
              </CardContent>
            </Card>
          )}
          {ai.chinaSellerAnalysis && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">中国卖家分析</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <FormField label="份额" value={ai.chinaSellerAnalysis?.share} onChange={(v) => update("ai.chinaSellerAnalysis.share", v)} />
                <FormField label="趋势" value={ai.chinaSellerAnalysis?.trend} onChange={(v) => update("ai.chinaSellerAnalysis.trend", v)} />
                <FormField label="影响" value={ai.chinaSellerAnalysis?.implication} onChange={(v) => update("ai.chinaSellerAnalysis.implication", v)} multiline />
              </CardContent>
            </Card>
          )}
        </div>
      );

    case "review_kano":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">评论分析</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
            </CardContent>
          </Card>
          {["painPoints", "itchPoints", "wowPoints"].map(catKey => {
            const catLabel = catKey === "painPoints" ? "痛点" : catKey === "itchPoints" ? "疒点" : "爽点";
            const items = ai.kanoAnalysis?.[catKey] || [];
            return items.length > 0 ? (
              <Card key={catKey}><CardHeader className="pb-2"><CardTitle className="text-sm">{catLabel}</CardTitle></CardHeader>
                <CardContent>
                  <FormListEditor label={catLabel} items={items} onChange={(v) => update(`ai.kanoAnalysis.${catKey}`, v)}
                    renderItem={(item, _idx, upd) => (
                      <div className="space-y-2 p-2 border rounded">
                        <FormField label="主题" value={item.theme || item.feature} onChange={(v) => upd({ ...item, theme: v })} />
                        <FormField label="描述" value={item.description} onChange={(v) => upd({ ...item, description: v })} multiline />
                        <FormField label="改进建议" value={item.improvementSuggestion || item.implementationSuggestion} onChange={(v) => upd({ ...item, improvementSuggestion: v })} multiline />
                      </div>
                    )}
                  />
                </CardContent>
              </Card>
            ) : null;
          })}
        </div>
      );

    case "decision_dashboard":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">综合决策</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="综合评分(1-10)" value={ai.feasibilityScore?.overall} onChange={(v) => update("ai.feasibilityScore.overall", Number(v))} type="number" />
                <FormField label="推荐等级" value={ai.feasibilityScore?.recommendation} onChange={(v) => update("ai.feasibilityScore.recommendation", v)} />
              </div>
            </CardContent>
          </Card>
          {ai.productPositioning && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">产品定位</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <FormField label="差异化方向" value={ai.productPositioning?.differentiationDirection} onChange={(v) => update("ai.productPositioning.differentiationDirection", v)} multiline />
                <FormField label="目标用户" value={ai.productPositioning?.targetAudience} onChange={(v) => update("ai.productPositioning.targetAudience", v)} />
              </CardContent>
            </Card>
          )}
          {ai.launchPlan && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">上新计划</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="目标定价" value={ai.launchPlan?.targetPrice} onChange={(v) => update("ai.launchPlan.targetPrice", v)} />
                  <FormField label="建议上架月" value={ai.launchPlan?.bestLaunchMonth} onChange={(v) => update("ai.launchPlan.bestLaunchMonth", v)} />
                  <FormField label="首批订单量" value={ai.launchPlan?.initialOrderQuantity} onChange={(v) => update("ai.launchPlan.initialOrderQuantity", v)} />
                </div>
              </CardContent>
            </Card>
          )}
          {Array.isArray(ai.risks) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">风险与应对</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="风险" items={ai.risks} onChange={(v) => update("ai.risks", v)}
                  renderItem={(item, _idx, upd) => (
                    <div className="space-y-2 p-2 border rounded">
                      <FormField label="风险" value={item.risk} onChange={(v) => upd({ ...item, risk: v })} />
                      <div className="grid grid-cols-2 gap-2">
                        <FormField label="概率" value={item.probability} onChange={(v) => upd({ ...item, probability: v })} />
                        <FormField label="影响" value={item.impact} onChange={(v) => upd({ ...item, impact: v })} />
                      </div>
                      <FormField label="应对策略" value={item.mitigation} onChange={(v) => upd({ ...item, mitigation: v })} multiline />
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}
        </div>
      );

    default:
      // Fallback: show JSON editor for stages without form editor (attribute_tagging, tag_cross)
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">该阶段使用JSON编辑器，请直接修改下方内容：</p>
          <Textarea
            value={JSON.stringify(data, null, 2)}
            onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* ignore parse errors while typing */ } }}
            className="min-h-[500px] font-mono text-xs"
          />
        </div>
      );
  }
}
