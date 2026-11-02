import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, Edit2, Loader2, Sparkles, Zap, ChevronRight, RotateCcw,
} from "lucide-react";

interface Props {
  planId: number;
  asin: string;
  currentBsr?: number;
}

const PHASE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  launch: { bg: "bg-orange-100", border: "border-orange-400", text: "text-orange-700" },
  growth: { bg: "bg-emerald-100", border: "border-emerald-400", text: "text-emerald-700" },
  maturity: { bg: "bg-blue-100", border: "border-blue-400", text: "text-blue-700" },
  optimization: { bg: "bg-violet-100", border: "border-violet-400", text: "text-violet-700" },
  clearance: { bg: "bg-gray-100", border: "border-gray-400", text: "text-gray-700" },
  custom: { bg: "bg-amber-100", border: "border-amber-400", text: "text-amber-700" },
};

const PHASE_TYPE_LABELS: Record<string, string> = {
  launch: "新品冲刺期",
  growth: "增长期",
  maturity: "成熟期",
  optimization: "优化期",
  clearance: "清仓期",
  custom: "自定义",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "待开始", color: "bg-gray-200 text-gray-700" },
  active: { label: "进行中", color: "bg-blue-100 text-blue-700" },
  completed: { label: "已完成", color: "bg-emerald-100 text-emerald-700" },
  skipped: { label: "已跳过", color: "bg-gray-100 text-gray-500" },
};

export default function PromotionGantt({ planId, asin, currentBsr }: Props) {
  const { data: phases, refetch } = trpc.opsProductPlan.listPhases.useQuery({ planId });
  const addPhase = trpc.opsProductPlan.addPhase.useMutation({ onSuccess: () => { refetch(); setShowAdd(false); resetForm(); toast.success("阶段已添加"); } });
  const updatePhase = trpc.opsProductPlan.updatePhase.useMutation({ onSuccess: () => { refetch(); toast.success("已更新"); } });
  const deletePhase = trpc.opsProductPlan.deletePhase.useMutation({ onSuccess: () => { refetch(); toast.success("已删除"); } });
  const initBsr = trpc.opsProductPlan.initBsrPhases.useMutation({ onSuccess: () => { refetch(); toast.success("BSR分段推广周期已生成"); } });
  const aiStrategy = trpc.opsProductPlan.aiPromotionStrategy.useMutation();

  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [showAiResult, setShowAiResult] = useState(false);
  const [form, setForm] = useState({
    phaseName: "", phaseType: "custom" as string,
    bsrRangeStart: "", bsrRangeEnd: "",
    durationDays: "", startDate: "", endDate: "",
    adBudgetDaily: "", targetAcos: "",
    keyStrategy: "", milestones: "", sortOrder: "",
  });

  function resetForm() {
    setForm({
      phaseName: "", phaseType: "custom",
      bsrRangeStart: "", bsrRangeEnd: "",
      durationDays: "", startDate: "", endDate: "",
      adBudgetDaily: "", targetAcos: "",
      keyStrategy: "", milestones: "", sortOrder: "",
    });
  }

  function openEdit(p: any) {
    setEditId(p.id);
    setForm({
      phaseName: p.phaseName || "",
      phaseType: p.phaseType || "custom",
      bsrRangeStart: String(p.bsrRangeStart || ""),
      bsrRangeEnd: String(p.bsrRangeEnd || ""),
      durationDays: String(p.durationDays || ""),
      startDate: p.startDate || "",
      endDate: p.endDate || "",
      adBudgetDaily: p.adBudgetDaily || "",
      targetAcos: p.targetAcos || "",
      keyStrategy: p.keyStrategy || "",
      milestones: p.milestones || "",
      sortOrder: String(p.sortOrder || ""),
    });
    setShowEdit(true);
  }

  // Total duration for gantt bar widths
  const totalDays = useMemo(() => {
    if (!phases) return 0;
    return phases.reduce((sum, p) => sum + (p.durationDays || 30), 0);
  }, [phases]);

  // Find active phase index
  const activeIndex = useMemo(() => {
    if (!phases) return -1;
    return phases.findIndex(p => p.status === "active");
  }, [phases]);

  function runAiStrategy() {
    if (!phases || phases.length === 0) return;
    aiStrategy.mutate({
      asin,
      currentBsr,
      phases: phases.map(p => ({
        name: p.phaseName,
        bsrRange: `${p.bsrRangeStart || "?"}-${p.bsrRangeEnd || "?"}`,
        durationDays: p.durationDays || undefined,
        status: p.status,
        progress: p.progress || 0,
      })),
      currentPhaseIndex: activeIndex >= 0 ? activeIndex : undefined,
    });
    setShowAiResult(true);
  }

  function handleUpdateProgress(phaseId: number, progress: number) {
    updatePhase.mutate({ phaseId, progress });
  }

  function handleUpdateStatus(phaseId: number, status: "pending" | "active" | "completed" | "skipped") {
    updatePhase.mutate({ phaseId, status });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-600" />
          <h3 className="font-semibold">推广周期管理</h3>
          <Badge variant="secondary">{phases?.length || 0} 个阶段</Badge>
        </div>
        <div className="flex items-center gap-2">
          {phases && phases.length > 0 && (
            <Button size="sm" variant="outline" onClick={runAiStrategy} disabled={aiStrategy.isPending}>
              {aiStrategy.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
              AI策略建议
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => {
            if (confirm("将按BSR分段生成6个推广周期，会覆盖现有数据，确定？")) {
              initBsr.mutate({ planId, currentBsr });
            }
          }} disabled={initBsr.isPending}>
            {initBsr.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
            BSR分段推荐
          </Button>
          <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }}>
            <Plus className="h-3 w-3 mr-1" /> 添加阶段
          </Button>
        </div>
      </div>

      {/* Gantt Chart */}
      {phases && phases.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">推广周期甘特图</CardTitle>
          </CardHeader>
          <CardContent>
            {/* BSR Scale Bar */}
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <span>BSR 200+</span>
              <div className="flex-1 h-1 bg-gradient-to-r from-orange-300 via-emerald-300 via-blue-300 to-violet-300 rounded" />
              <span>BSR 1</span>
            </div>

            {/* Gantt Bars */}
            <div className="space-y-2">
              {phases.map((phase, idx) => {
                const widthPct = totalDays > 0 ? ((phase.durationDays || 30) / totalDays) * 100 : 100 / phases.length;
                const colors = PHASE_COLORS[phase.phaseType] || PHASE_COLORS.custom;
                const isActive = phase.status === "active";
                const statusInfo = STATUS_LABELS[phase.status] || STATUS_LABELS.pending;

                return (
                  <div key={phase.id} className="group">
                    <div className="flex items-center gap-3">
                      {/* Phase label */}
                      <div className="w-[140px] flex-shrink-0 text-right">
                        <p className={`text-xs font-medium ${isActive ? "text-blue-700" : "text-gray-600"}`}>
                          {phase.phaseName}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          BSR {phase.bsrRangeStart || "?"}-{phase.bsrRangeEnd || "?"}
                        </p>
                      </div>

                      {/* Gantt bar */}
                      <div className="flex-1 relative">
                        <div
                          className={`relative h-10 rounded-md border-l-4 ${colors.bg} ${colors.border} ${isActive ? "ring-2 ring-blue-300 ring-offset-1" : ""}`}
                          style={{ width: `${Math.max(widthPct, 15)}%` }}
                        >
                          {/* Progress fill */}
                          <div
                            className="absolute inset-0 rounded-r-md opacity-30"
                            style={{
                              width: `${phase.progress || 0}%`,
                              background: isActive ? "#3b82f6" : "#6b7280",
                            }}
                          />
                          {/* Content */}
                          <div className="relative h-full flex items-center justify-between px-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium ${colors.text}`}>
                                {phase.durationDays || "?"}天
                              </span>
                              {phase.adBudgetDaily && (
                                <span className="text-[10px] text-muted-foreground">
                                  ${phase.adBudgetDaily}/天
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge className={`text-[10px] px-1.5 py-0 ${statusInfo.color}`}>
                                {statusInfo.label}
                              </Badge>
                              <span className="text-[10px] font-medium">{phase.progress || 0}%</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(phase)}>
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => {
                          if (confirm("确定删除？")) deletePhase.mutate({ phaseId: phase.id });
                        }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Expanded detail for active phase */}
                    {isActive && (
                      <div className="ml-[152px] mt-1 p-3 bg-blue-50/50 rounded-lg border border-blue-100 text-xs space-y-2">
                        {phase.keyStrategy && (
                          <p><span className="font-medium text-blue-700">核心策略:</span> {phase.keyStrategy}</p>
                        )}
                        {phase.targetAcos && (
                          <p><span className="font-medium">目标ACoS:</span> {phase.targetAcos}%</p>
                        )}
                        <div className="flex items-center gap-3">
                          <span className="font-medium">进度:</span>
                          <Slider
                            value={[phase.progress || 0]}
                            max={100}
                            step={5}
                            className="w-40"
                            onValueCommit={(v) => handleUpdateProgress(phase.id, v[0])}
                          />
                          <span>{phase.progress || 0}%</span>
                          <div className="flex gap-1 ml-auto">
                            <Button size="sm" variant="outline" className="h-6 text-[10px]"
                              onClick={() => handleUpdateStatus(phase.id, "completed")}>
                              标记完成
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 text-[10px]"
                              onClick={() => handleUpdateStatus(phase.id, "skipped")}>
                              跳过
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Arrow connector */}
                    {idx < phases.length - 1 && (
                      <div className="ml-[152px] flex items-center text-gray-300 py-0.5">
                        <ChevronRight className="h-3 w-3" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Current BSR indicator */}
            {currentBsr && (
              <div className="mt-4 pt-3 border-t flex items-center gap-2 text-sm">
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  当前BSR: #{currentBsr}
                </Badge>
                {activeIndex >= 0 && phases && (
                  <span className="text-muted-foreground">
                    → 当前处于「{phases[activeIndex].phaseName}」阶段
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(!phases || phases.length === 0) && (
        <Card>
          <CardContent className="py-8 text-center">
            <Zap className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-2">暂无推广周期规划</p>
            <p className="text-xs text-muted-foreground mb-4">可一键生成BSR分段推荐推广周期，或手动添加自定义阶段</p>
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => initBsr.mutate({ planId, currentBsr })} disabled={initBsr.isPending}>
                {initBsr.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                BSR分段推荐
              </Button>
              <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }}>
                <Plus className="h-3 w-3 mr-1" /> 手动添加
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Strategy Result */}
      {showAiResult && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-600" />
              AI推广节奏建议
            </CardTitle>
          </CardHeader>
          <CardContent>
            {aiStrategy.isPending && (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">正在分析推广节奏...</span>
              </div>
            )}
            {aiStrategy.data && (
              <div className="space-y-3 text-sm">
                <div className="p-3 bg-white rounded-lg border">
                  <p className="text-xs font-medium text-amber-700 mb-1">当前阶段评估</p>
                  <p>{aiStrategy.data.current_phase_assessment}</p>
                </div>
                <div className="p-3 bg-white rounded-lg border">
                  <p className="text-xs font-medium text-blue-700 mb-1">下一阶段准备</p>
                  <p>{aiStrategy.data.next_phase_preparation}</p>
                </div>
                {aiStrategy.data.daily_actions?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2">每日执行动作</p>
                    <div className="space-y-1">
                      {aiStrategy.data.daily_actions.map((a: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 p-2 bg-white rounded border">
                          <Badge variant={a.priority === "高" ? "destructive" : a.priority === "中" ? "default" : "secondary"} className="text-[10px] mt-0.5">{a.priority}</Badge>
                          <div>
                            <p className="text-sm">{a.action}</p>
                            <p className="text-xs text-muted-foreground">{a.timeline}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                    <p className="text-xs text-emerald-600 font-medium mb-1">预算分配建议</p>
                    <p className="text-sm">{aiStrategy.data.budget_recommendation}</p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-xs text-red-600 font-medium mb-1">风险提醒</p>
                    <p className="text-sm">{aiStrategy.data.risk_warning}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Phase Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>添加推广阶段</DialogTitle></DialogHeader>
          <PhaseForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>取消</Button>
            <Button onClick={() => addPhase.mutate({
              planId,
              phaseName: form.phaseName,
              phaseType: form.phaseType as any,
              bsrRangeStart: form.bsrRangeStart ? Number(form.bsrRangeStart) : undefined,
              bsrRangeEnd: form.bsrRangeEnd ? Number(form.bsrRangeEnd) : undefined,
              durationDays: form.durationDays ? Number(form.durationDays) : undefined,
              startDate: form.startDate || undefined,
              endDate: form.endDate || undefined,
              adBudgetDaily: form.adBudgetDaily || undefined,
              targetAcos: form.targetAcos || undefined,
              keyStrategy: form.keyStrategy || undefined,
              milestones: form.milestones || undefined,
              sortOrder: form.sortOrder ? Number(form.sortOrder) : undefined,
            })} disabled={!form.phaseName || addPhase.isPending}>
              {addPhase.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Phase Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>编辑推广阶段</DialogTitle></DialogHeader>
          <PhaseForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>取消</Button>
            <Button onClick={() => {
              if (!editId) return;
              updatePhase.mutate({
                phaseId: editId,
                phaseName: form.phaseName || undefined,
                phaseType: form.phaseType as any || undefined,
                bsrRangeStart: form.bsrRangeStart ? Number(form.bsrRangeStart) : undefined,
                bsrRangeEnd: form.bsrRangeEnd ? Number(form.bsrRangeEnd) : undefined,
                durationDays: form.durationDays ? Number(form.durationDays) : undefined,
                startDate: form.startDate || undefined,
                endDate: form.endDate || undefined,
                adBudgetDaily: form.adBudgetDaily || undefined,
                targetAcos: form.targetAcos || undefined,
                keyStrategy: form.keyStrategy || undefined,
                milestones: form.milestones || undefined,
                sortOrder: form.sortOrder ? Number(form.sortOrder) : undefined,
              });
              setShowEdit(false);
            }} disabled={updatePhase.isPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PhaseForm({ form, setForm }: { form: any; setForm: (fn: any) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">阶段名称 *</Label>
          <Input value={form.phaseName} onChange={e => setForm((f: any) => ({ ...f, phaseName: e.target.value }))} placeholder="如 新品冲刺期" />
        </div>
        <div>
          <Label className="text-xs">阶段类型</Label>
          <Select value={form.phaseType} onValueChange={v => setForm((f: any) => ({ ...f, phaseType: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="launch">新品冲刺期</SelectItem>
              <SelectItem value="growth">增长期</SelectItem>
              <SelectItem value="maturity">成熟期</SelectItem>
              <SelectItem value="optimization">优化期</SelectItem>
              <SelectItem value="clearance">清仓期</SelectItem>
              <SelectItem value="custom">自定义</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">BSR起始</Label>
          <Input value={form.bsrRangeStart} onChange={e => setForm((f: any) => ({ ...f, bsrRangeStart: e.target.value }))} placeholder="如 101" />
        </div>
        <div>
          <Label className="text-xs">BSR结束</Label>
          <Input value={form.bsrRangeEnd} onChange={e => setForm((f: any) => ({ ...f, bsrRangeEnd: e.target.value }))} placeholder="如 200" />
        </div>
        <div>
          <Label className="text-xs">持续天数</Label>
          <Input value={form.durationDays} onChange={e => setForm((f: any) => ({ ...f, durationDays: e.target.value }))} placeholder="如 30" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">开始日期</Label>
          <Input type="date" value={form.startDate} onChange={e => setForm((f: any) => ({ ...f, startDate: e.target.value }))} />
        </div>
        <div>
          <Label className="text-xs">结束日期</Label>
          <Input type="date" value={form.endDate} onChange={e => setForm((f: any) => ({ ...f, endDate: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">日预算$</Label>
          <Input value={form.adBudgetDaily} onChange={e => setForm((f: any) => ({ ...f, adBudgetDaily: e.target.value }))} placeholder="如 50" />
        </div>
        <div>
          <Label className="text-xs">目标ACoS%</Label>
          <Input value={form.targetAcos} onChange={e => setForm((f: any) => ({ ...f, targetAcos: e.target.value }))} placeholder="如 30" />
        </div>
        <div>
          <Label className="text-xs">排序</Label>
          <Input value={form.sortOrder} onChange={e => setForm((f: any) => ({ ...f, sortOrder: e.target.value }))} placeholder="如 1" />
        </div>
      </div>
      <div>
        <Label className="text-xs">核心策略</Label>
        <Textarea value={form.keyStrategy} onChange={e => setForm((f: any) => ({ ...f, keyStrategy: e.target.value }))} rows={2} placeholder="本阶段的核心推广策略..." />
      </div>
      <div>
        <Label className="text-xs">里程碑</Label>
        <Textarea value={form.milestones} onChange={e => setForm((f: any) => ({ ...f, milestones: e.target.value }))} rows={2} placeholder="关键里程碑节点..." />
      </div>
    </div>
  );
}
