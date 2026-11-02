import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, Edit2, Loader2, Sparkles, Target, Eye,
} from "lucide-react";
import { Streamdown } from "streamdown";

interface Props {
  planId: number;
  asin: string;
}

const DIMENSIONS = ["ACoS", "CTR", "CVR", "CPC", "CPA"] as const;
const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316",
];

export default function CompetitorAdBenchmark({ planId, asin }: Props) {
  const { data: benchmarks, refetch } = trpc.opsProductPlan.listBenchmarks.useQuery({ planId });
  const addBenchmark = trpc.opsProductPlan.addBenchmark.useMutation({ onSuccess: () => { refetch(); setShowAdd(false); resetForm(); toast.success("竞品数据已添加"); } });
  const updateBenchmark = trpc.opsProductPlan.updateBenchmark.useMutation({ onSuccess: () => { refetch(); setShowEdit(false); toast.success("已更新"); } });
  const deleteBenchmark = trpc.opsProductPlan.deleteBenchmark.useMutation({ onSuccess: () => { refetch(); toast.success("已删除"); } });
  const aiAnalysis = trpc.opsProductPlan.aiCompetitorAdAnalysis.useMutation();

  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [showAiResult, setShowAiResult] = useState(false);
  const [form, setForm] = useState({
    competitorBrand: "", competitorAsin: "", adType: "mixed" as string,
    acos: "", ctr: "", cvr: "", cpc: "", cpa: "",
    totalSpend: "", totalSales: "", totalOrders: "",
    totalImpressions: "", totalClicks: "", dataPeriod: "", analysisNotes: "",
  });

  function resetForm() {
    setForm({
      competitorBrand: "", competitorAsin: "", adType: "mixed",
      acos: "", ctr: "", cvr: "", cpc: "", cpa: "",
      totalSpend: "", totalSales: "", totalOrders: "",
      totalImpressions: "", totalClicks: "", dataPeriod: "", analysisNotes: "",
    });
  }

  function openEdit(b: any) {
    setEditId(b.id);
    setForm({
      competitorBrand: b.competitorBrand || "",
      competitorAsin: b.competitorAsin || "",
      adType: b.adType || "mixed",
      acos: b.acos || "", ctr: b.ctr || "", cvr: b.cvr || "",
      cpc: b.cpc || "", cpa: b.cpa || "",
      totalSpend: b.totalSpend || "", totalSales: b.totalSales || "",
      totalOrders: String(b.totalOrders || ""),
      totalImpressions: String(b.totalImpressions || ""),
      totalClicks: String(b.totalClicks || ""),
      dataPeriod: b.dataPeriod || "", analysisNotes: b.analysisNotes || "",
    });
    setShowEdit(true);
  }

  // Radar chart SVG
  const radarData = useMemo(() => {
    if (!benchmarks || benchmarks.length === 0) return null;
    // Normalize each dimension to 0-100 scale
    const allEntries = benchmarks.map(b => ({
      brand: b.competitorBrand,
      values: [
        parseFloat(b.acos || "0"),
        parseFloat(b.ctr || "0") * 100,
        parseFloat(b.cvr || "0") * 100,
        parseFloat(b.cpc || "0"),
        parseFloat(b.cpa || "0"),
      ],
    }));
    // Find max for each dimension
    const maxVals = DIMENSIONS.map((_, i) => Math.max(...allEntries.map(e => e.values[i]), 1));
    // Normalize to 0-1
    const normalized = allEntries.map(e => ({
      brand: e.brand,
      values: e.values.map((v, i) => {
        // For ACoS, CPC, CPA: lower is better, so invert
        if (i === 0 || i === 3 || i === 4) return 1 - (v / maxVals[i]);
        return v / maxVals[i];
      }),
    }));
    return { entries: normalized, maxVals, raw: allEntries };
  }, [benchmarks]);

  function runAiAnalysis() {
    if (!benchmarks || benchmarks.length === 0) return;
    const bms = benchmarks.map(b => ({
      brand: b.competitorBrand,
      acos: b.acos ? parseFloat(b.acos) : undefined,
      ctr: b.ctr ? parseFloat(b.ctr) : undefined,
      cvr: b.cvr ? parseFloat(b.cvr) : undefined,
      cpc: b.cpc ? parseFloat(b.cpc) : undefined,
      cpa: b.cpa ? parseFloat(b.cpa) : undefined,
    }));
    aiAnalysis.mutate({ asin, benchmarks: bms });
    setShowAiResult(true);
  }

  // SVG radar polygon helper
  function polarToCartesian(angle: number, radius: number, cx: number, cy: number) {
    const rad = (angle - 90) * (Math.PI / 180);
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  function getPolygonPoints(values: number[], cx: number, cy: number, maxR: number) {
    return values.map((v, i) => {
      const angle = (360 / values.length) * i;
      const p = polarToCartesian(angle, v * maxR, cx, cy);
      return `${p.x},${p.y}`;
    }).join(" ");
  }

  const cx = 150, cy = 150, maxR = 110;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-violet-600" />
          <h3 className="font-semibold">竞品广告对标</h3>
          <Badge variant="secondary">{benchmarks?.length || 0} 个竞品</Badge>
        </div>
        <div className="flex items-center gap-2">
          {benchmarks && benchmarks.length >= 2 && (
            <Button size="sm" variant="outline" onClick={runAiAnalysis} disabled={aiAnalysis.isPending}>
              {aiAnalysis.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
              AI分析
            </Button>
          )}
          <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }}>
            <Plus className="h-3 w-3 mr-1" /> 添加竞品
          </Button>
        </div>
      </div>

      {/* Radar Chart */}
      {radarData && radarData.entries.length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">五维度雷达对比图</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-6">
              <svg viewBox="0 0 300 300" className="w-[300px] h-[300px] flex-shrink-0">
                {/* Grid circles */}
                {[0.2, 0.4, 0.6, 0.8, 1].map(r => (
                  <circle key={r} cx={cx} cy={cy} r={r * maxR} fill="none" stroke="#e5e7eb" strokeWidth="0.5" />
                ))}
                {/* Axis lines */}
                {DIMENSIONS.map((dim, i) => {
                  const angle = (360 / 5) * i;
                  const p = polarToCartesian(angle, maxR, cx, cy);
                  return (
                    <g key={dim}>
                      <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#d1d5db" strokeWidth="0.5" />
                      <text x={p.x + (p.x > cx ? 6 : p.x < cx ? -6 : 0)} y={p.y + (p.y > cy ? 14 : p.y < cy ? -4 : 0)}
                        textAnchor={p.x > cx + 5 ? "start" : p.x < cx - 5 ? "end" : "middle"}
                        className="text-[10px] fill-gray-500">{dim}</text>
                    </g>
                  );
                })}
                {/* Data polygons */}
                {radarData.entries.map((entry, idx) => (
                  <polygon key={idx}
                    points={getPolygonPoints(entry.values, cx, cy, maxR)}
                    fill={COLORS[idx % COLORS.length]} fillOpacity="0.15"
                    stroke={COLORS[idx % COLORS.length]} strokeWidth="1.5"
                  />
                ))}
                {/* Data points */}
                {radarData.entries.map((entry, idx) =>
                  entry.values.map((v, di) => {
                    const angle = (360 / 5) * di;
                    const p = polarToCartesian(angle, v * maxR, cx, cy);
                    return <circle key={`${idx}-${di}`} cx={p.x} cy={p.y} r="3" fill={COLORS[idx % COLORS.length]} />;
                  })
                )}
              </svg>
              {/* Legend */}
              <div className="space-y-2 pt-4">
                {radarData.entries.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <span className="text-sm">{entry.brand}</span>
                  </div>
                ))}
                <div className="text-xs text-muted-foreground mt-4 space-y-1">
                  <p>* ACoS/CPC/CPA: 越低越好（图中越外越优）</p>
                  <p>* CTR/CVR: 越高越好（图中越外越优）</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Table */}
      {benchmarks && benchmarks.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>品牌</TableHead>
                    <TableHead>ASIN</TableHead>
                    <TableHead>广告类型</TableHead>
                    <TableHead className="text-right">ACoS%</TableHead>
                    <TableHead className="text-right">CTR%</TableHead>
                    <TableHead className="text-right">CVR%</TableHead>
                    <TableHead className="text-right">CPC$</TableHead>
                    <TableHead className="text-right">CPA$</TableHead>
                    <TableHead className="text-right">花费$</TableHead>
                    <TableHead className="text-right">销售额$</TableHead>
                    <TableHead>周期</TableHead>
                    <TableHead className="w-[80px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {benchmarks.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.competitorBrand}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{b.competitorAsin || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{b.adType?.toUpperCase()}</Badge></TableCell>
                      <TableCell className="text-right">{b.acos || "—"}</TableCell>
                      <TableCell className="text-right">{b.ctr || "—"}</TableCell>
                      <TableCell className="text-right">{b.cvr || "—"}</TableCell>
                      <TableCell className="text-right">{b.cpc || "—"}</TableCell>
                      <TableCell className="text-right">{b.cpa || "—"}</TableCell>
                      <TableCell className="text-right">{b.totalSpend || "—"}</TableCell>
                      <TableCell className="text-right">{b.totalSales || "—"}</TableCell>
                      <TableCell className="text-xs">{b.dataPeriod || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(b)}>
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => {
                            if (confirm("确定删除？")) deleteBenchmark.mutate({ benchmarkId: b.id });
                          }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {(!benchmarks || benchmarks.length === 0) && (
        <Card>
          <CardContent className="py-8 text-center">
            <Eye className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-2">暂无竞品广告对标数据</p>
            <p className="text-xs text-muted-foreground mb-4">添加至少2个竞品数据后可生成雷达对比图和AI分析</p>
            <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }}>
              <Plus className="h-3 w-3 mr-1" /> 添加竞品数据
            </Button>
          </CardContent>
        </Card>
      )}

      {/* AI Analysis Result */}
      {showAiResult && (
        <Card className="border-violet-200 bg-violet-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" />
              AI竞品广告对标分析
            </CardTitle>
          </CardHeader>
          <CardContent>
            {aiAnalysis.isPending && (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">正在分析竞品广告数据...</span>
              </div>
            )}
            {aiAnalysis.data && (
              <div className="space-y-4 text-sm">
                <div className="p-3 bg-white rounded-lg border">
                  <p className="font-medium text-violet-700">{aiAnalysis.data.summary}</p>
                </div>
                {/* Dimension Analysis */}
                <div>
                  <h4 className="font-medium mb-2">维度分析</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>维度</TableHead>
                        <TableHead>我方</TableHead>
                        <TableHead>竞品均值</TableHead>
                        <TableHead>差距</TableHead>
                        <TableHead>评价</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aiAnalysis.data.dimension_analysis?.map((d: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{d.dimension}</TableCell>
                          <TableCell>{d.my_value}</TableCell>
                          <TableCell>{d.avg_competitor}</TableCell>
                          <TableCell>{d.gap}</TableCell>
                          <TableCell>{d.verdict}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Strategies */}
                <div>
                  <h4 className="font-medium mb-2">优化策略</h4>
                  <div className="space-y-2">
                    {aiAnalysis.data.strategies?.map((s: any, i: number) => (
                      <div key={i} className="p-2 bg-white rounded border flex items-start gap-2">
                        <Badge variant={s.priority === "高" ? "destructive" : s.priority === "中" ? "default" : "secondary"} className="text-xs mt-0.5">{s.priority}</Badge>
                        <div>
                          <p>{s.strategy}</p>
                          <p className="text-xs text-muted-foreground mt-1">预期影响: {s.expected_impact}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                    <p className="text-xs text-emerald-600 font-medium mb-1">核心竞争优势</p>
                    <p className="text-sm">{aiAnalysis.data.competitive_advantage}</p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-xs text-red-600 font-medium mb-1">最需改善短板</p>
                    <p className="text-sm">{aiAnalysis.data.key_weakness}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>添加竞品广告数据</DialogTitle></DialogHeader>
          <BenchmarkForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>取消</Button>
            <Button onClick={() => addBenchmark.mutate({
              planId,
              ...form,
              adType: form.adType as "sp" | "sb" | "sd" | "dsp" | "mixed",
              totalOrders: form.totalOrders ? Number(form.totalOrders) : undefined,
              totalImpressions: form.totalImpressions ? Number(form.totalImpressions) : undefined,
              totalClicks: form.totalClicks ? Number(form.totalClicks) : undefined,
            })} disabled={!form.competitorBrand || addBenchmark.isPending}>
              {addBenchmark.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>编辑竞品广告数据</DialogTitle></DialogHeader>
          <BenchmarkForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>取消</Button>
            <Button onClick={() => {
              if (!editId) return;
              updateBenchmark.mutate({
                benchmarkId: editId,
                ...form,
                adType: form.adType as "sp" | "sb" | "sd" | "dsp" | "mixed",
                totalOrders: form.totalOrders ? Number(form.totalOrders) : undefined,
                totalImpressions: form.totalImpressions ? Number(form.totalImpressions) : undefined,
                totalClicks: form.totalClicks ? Number(form.totalClicks) : undefined,
              });
            }} disabled={updateBenchmark.isPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BenchmarkForm({ form, setForm }: { form: any; setForm: (fn: any) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">竞品品牌 *</Label>
          <Input value={form.competitorBrand} onChange={e => setForm((f: any) => ({ ...f, competitorBrand: e.target.value }))} placeholder="如 Anker" />
        </div>
        <div>
          <Label className="text-xs">竞品ASIN</Label>
          <Input value={form.competitorAsin} onChange={e => setForm((f: any) => ({ ...f, competitorAsin: e.target.value }))} placeholder="B0..." />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">广告类型</Label>
          <Select value={form.adType} onValueChange={v => setForm((f: any) => ({ ...f, adType: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sp">SP</SelectItem>
              <SelectItem value="sb">SB</SelectItem>
              <SelectItem value="sd">SD</SelectItem>
              <SelectItem value="dsp">DSP</SelectItem>
              <SelectItem value="mixed">综合</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">数据周期</Label>
          <Input value={form.dataPeriod} onChange={e => setForm((f: any) => ({ ...f, dataPeriod: e.target.value }))} placeholder="如 2026-03" />
        </div>
      </div>
      <div className="border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">五维度核心指标</p>
        <div className="grid grid-cols-5 gap-2">
          <div><Label className="text-xs">ACoS%</Label><Input value={form.acos} onChange={e => setForm((f: any) => ({ ...f, acos: e.target.value }))} /></div>
          <div><Label className="text-xs">CTR%</Label><Input value={form.ctr} onChange={e => setForm((f: any) => ({ ...f, ctr: e.target.value }))} /></div>
          <div><Label className="text-xs">CVR%</Label><Input value={form.cvr} onChange={e => setForm((f: any) => ({ ...f, cvr: e.target.value }))} /></div>
          <div><Label className="text-xs">CPC$</Label><Input value={form.cpc} onChange={e => setForm((f: any) => ({ ...f, cpc: e.target.value }))} /></div>
          <div><Label className="text-xs">CPA$</Label><Input value={form.cpa} onChange={e => setForm((f: any) => ({ ...f, cpa: e.target.value }))} /></div>
        </div>
      </div>
      <div className="border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">补充数据</p>
        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-xs">花费$</Label><Input value={form.totalSpend} onChange={e => setForm((f: any) => ({ ...f, totalSpend: e.target.value }))} /></div>
          <div><Label className="text-xs">销售额$</Label><Input value={form.totalSales} onChange={e => setForm((f: any) => ({ ...f, totalSales: e.target.value }))} /></div>
          <div><Label className="text-xs">订单数</Label><Input value={form.totalOrders} onChange={e => setForm((f: any) => ({ ...f, totalOrders: e.target.value }))} /></div>
          <div><Label className="text-xs">展示量</Label><Input value={form.totalImpressions} onChange={e => setForm((f: any) => ({ ...f, totalImpressions: e.target.value }))} /></div>
          <div><Label className="text-xs">点击量</Label><Input value={form.totalClicks} onChange={e => setForm((f: any) => ({ ...f, totalClicks: e.target.value }))} /></div>
        </div>
      </div>
      <div>
        <Label className="text-xs">分析备注</Label>
        <Textarea value={form.analysisNotes} onChange={e => setForm((f: any) => ({ ...f, analysisNotes: e.target.value }))} rows={2} placeholder="竞品广告策略总结..." />
      </div>
    </div>
  );
}
