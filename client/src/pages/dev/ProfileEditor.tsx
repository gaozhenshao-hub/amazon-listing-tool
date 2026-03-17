import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Brain, Loader2, CheckCircle2, Edit2, Save, X, Plus, Trash2, Lock, Unlock,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/* ─── Types ─── */
interface ProfileEditorProps { projectId: number; profile: any; readOnly?: boolean }

type SectionKey = "appearance" | "function" | "cost" | "package" | "packageDesign" | "userPersona" | "usageScenarios" | "productMap";

const SECTIONS: { key: SectionKey; label: string; icon: string; dataField: string; aiField: string; confirmedField: string }[] = [
  { key: "appearance", label: "外观设计", icon: "🎨", dataField: "appearanceColors", aiField: "appearanceAiSuggestion", confirmedField: "appearanceConfirmed" },
  { key: "function", label: "功能提升", icon: "⚡", dataField: "mainFunctions", aiField: "functionsAiSuggestion", confirmedField: "functionsConfirmed" },
  { key: "cost", label: "产品成本", icon: "💰", dataField: "costBreakdown", aiField: "costAiSuggestion", confirmedField: "costConfirmed" },
  { key: "package", label: "包装设计", icon: "📦", dataField: "packageDimensions", aiField: "packageAiSuggestion", confirmedField: "packageConfirmed" },
  { key: "packageDesign", label: "包装外观", icon: "🎁", dataField: "packageDesign", aiField: "packageDesignAiSuggestion", confirmedField: "packageDesignConfirmed" },
  { key: "userPersona", label: "用户画像", icon: "👤", dataField: "userPersona", aiField: "userPersonaAiSuggestion", confirmedField: "userPersonaConfirmed" },
  { key: "usageScenarios", label: "使用场景", icon: "🏠", dataField: "usageScenarios", aiField: "usageScenariosAiSuggestion", confirmedField: "usageScenariosConfirmed" },
  { key: "productMap", label: "产品地图", icon: "🗺️", dataField: "productMap", aiField: "productMapAiSuggestion", confirmedField: "productMapConfirmed" },
];

/* ─── Helpers ─── */
function safeParseJson(raw: any): any {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function ensureArray(val: any): any[] {
  if (Array.isArray(val)) return val;
  return [];
}

/* ─── Main Component ─── */
export default function ProfileEditor({ projectId, profile, readOnly = false }: ProfileEditorProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>("appearance");
  const utils = trpc.useUtils();

  const generateMutation = trpc.devProfile.generateSuggestions.useMutation({
    onSuccess: () => { toast.success("AI建议生成完成"); utils.devProfile.get.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const saveMutation = trpc.devProfile.saveSection.useMutation({
    onSuccess: () => { toast.success("已保存"); utils.devProfile.get.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`保存失败: ${err.message}`),
  });

  const confirmMutation = trpc.devProfile.confirmSection.useMutation({
    onSuccess: () => { toast.success("已确认锁定"); utils.devProfile.get.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`确认失败: ${err.message}`),
  });

  const currentSection = SECTIONS.find(s => s.key === activeSection) || SECTIONS[0];
  const isConfirmed = profile?.[currentSection.confirmedField] === 1;
  const aiRaw = safeParseJson(profile?.[currentSection.aiField]);
  const userRaw = safeParseJson(profile?.[currentSection.dataField]);
  const confirmedCount = SECTIONS.filter(s => profile?.[s.confirmedField] === 1).length;

  // Use user data if available, otherwise AI data
  const baseData = userRaw || aiRaw;

  const handleSave = (data: any) => {
    saveMutation.mutate({ projectId, section: activeSection as any, data: JSON.stringify(data) });
  };

  const handleConfirm = (data: any) => {
    confirmMutation.mutate({ projectId, section: activeSection as any, data: JSON.stringify(data) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Brain className="h-4 w-4" />产品画像 · 8子模块
          <Badge variant="outline" className="text-xs ml-2">{confirmedCount}/8 已确认</Badge>
        </h3>
      </div>

      {/* Sub-module Navigation */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map(s => {
          const confirmed = profile?.[s.confirmedField] === 1;
          return (
            <Button
              key={s.key}
              variant={activeSection === s.key ? "default" : "outline"}
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setActiveSection(s.key)}
            >
              <span>{s.icon}</span>
              {s.label}
              {confirmed && <CheckCircle2 className="h-3 w-3 text-emerald-500 ml-0.5" />}
            </Button>
          );
        })}
      </div>

      {/* Section Content */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-lg">{currentSection.icon}</span>
              {currentSection.label}
              {isConfirmed && <Badge className="bg-emerald-100 text-emerald-700 text-xs">已确认锁定</Badge>}
            </CardTitle>
            <div className="flex gap-2">
              {!isConfirmed && !readOnly && (
                <Button
                  size="sm" variant="outline"
                  onClick={() => generateMutation.mutate({ projectId, section: activeSection as any })}
                  disabled={generateMutation.isPending || readOnly}
                  className="gap-1 text-xs"
                >
                  {generateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                  AI生成建议
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!baseData && !generateMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Brain className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">点击"AI生成建议"获取{currentSection.label}方案</p>
            </div>
          ) : generateMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 mb-2 animate-spin" />
              <p className="text-sm">AI正在生成{currentSection.label}建议...</p>
            </div>
          ) : (
            <SectionEditor
              sectionKey={activeSection}
              data={baseData}
              isConfirmed={isConfirmed || readOnly}
              onSave={handleSave}
              onConfirm={handleConfirm}
              savePending={saveMutation.isPending}
              confirmPending={confirmMutation.isPending}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Section Editor (dispatches to specific table editors) ─── */
function SectionEditor({ sectionKey, data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: {
  sectionKey: SectionKey; data: any; isConfirmed: boolean;
  onSave: (d: any) => void; onConfirm: (d: any) => void;
  savePending: boolean; confirmPending: boolean;
}) {
  switch (sectionKey) {
    case "appearance": return <AppearanceEditor data={data} isConfirmed={isConfirmed} onSave={onSave} onConfirm={onConfirm} savePending={savePending} confirmPending={confirmPending} />;
    case "function": return <FunctionEditor data={data} isConfirmed={isConfirmed} onSave={onSave} onConfirm={onConfirm} savePending={savePending} confirmPending={confirmPending} />;
    case "cost": return <CostEditor data={data} isConfirmed={isConfirmed} onSave={onSave} onConfirm={onConfirm} savePending={savePending} confirmPending={confirmPending} />;
    case "package": return <PackageEditor data={data} isConfirmed={isConfirmed} onSave={onSave} onConfirm={onConfirm} savePending={savePending} confirmPending={confirmPending} />;
    case "packageDesign": return <PackageDesignEditor data={data} isConfirmed={isConfirmed} onSave={onSave} onConfirm={onConfirm} savePending={savePending} confirmPending={confirmPending} />;
    case "userPersona": return <UserPersonaEditor data={data} isConfirmed={isConfirmed} onSave={onSave} onConfirm={onConfirm} savePending={savePending} confirmPending={confirmPending} />;
    case "usageScenarios": return <UsageScenariosEditor data={data} isConfirmed={isConfirmed} onSave={onSave} onConfirm={onConfirm} savePending={savePending} confirmPending={confirmPending} />;
    case "productMap": return <ProductMapEditor data={data} isConfirmed={isConfirmed} onSave={onSave} onConfirm={onConfirm} savePending={savePending} confirmPending={confirmPending} />;
    default: return null;
  }
}

/* ─── Shared Action Bar ─── */
function ActionBar({ isConfirmed, onSave, onConfirm, savePending, confirmPending }: {
  isConfirmed: boolean; onSave: () => void; onConfirm: () => void;
  savePending: boolean; confirmPending: boolean;
}) {
  if (isConfirmed) {
    return (
      <div className="flex justify-end pt-3 border-t">
        <div className="p-2 rounded-lg bg-emerald-50/50 border border-emerald-100 text-xs text-emerald-700">
          此模块已确认锁定，数据可被其他模块引用
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end gap-2 pt-3 border-t">
      <Button size="sm" variant="outline" onClick={onSave} disabled={savePending} className="gap-1 text-xs">
        {savePending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        保存修改
      </Button>
      <Button size="sm" className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={onConfirm} disabled={confirmPending}>
        {confirmPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
        确认锁定
      </Button>
    </div>
  );
}

/* ─── Editable Cell ─── */
function EditCell({ value, onChange, disabled, type = "text", placeholder, className = "" }: {
  value: string; onChange: (v: string) => void; disabled: boolean;
  type?: "text" | "number"; placeholder?: string; className?: string;
}) {
  if (disabled) {
    return <span className={`text-sm ${className}`}>{value || "-"}</span>;
  }
  return (
    <Input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`h-8 text-xs ${className}`}
    />
  );
}

/* ─── Select Cell ─── */
function SelectCell({ value, onChange, disabled, options, placeholder }: {
  value: string; onChange: (v: string) => void; disabled: boolean;
  options: string[]; placeholder?: string;
}) {
  if (disabled) {
    return <span className="text-sm">{value || "-"}</span>;
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder={placeholder || "选择"} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* ═══════════════════════════════════════════════════════════
   1. 外观设计 Editor
   ═══════════════════════════════════════════════════════════ */
function AppearanceEditor({ data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: any) {
  const [colors, setColors] = useState(() => ensureArray(data?.colors).map((c: any) => ({
    color: c.color || "", hex: c.hex || "", reason: c.reason || "", target: c.target || c.targetAudience || "",
  })));
  const [params, setParams] = useState(() => ({
    materialSuggestion: data?.materialSuggestion || "",
    surfaceFinish: data?.surfaceFinish || "",
    differentiationDesign: data?.differentiationDesign || "",
    designInspiration: data?.designInspiration || "",
    colorMatching: data?.colorMatching || "",
    otherNotes: data?.otherNotes || "",
  }));

  const buildData = () => ({ colors, ...params });
  const addColor = () => setColors([...colors, { color: "", hex: "#000000", reason: "", target: "" }]);
  const removeColor = (i: number) => setColors(colors.filter((_: any, idx: number) => idx !== i));
  const updateColor = (i: number, field: string, val: string) => {
    const next = [...colors]; next[i] = { ...next[i], [field]: val }; setColors(next);
  };
  const updateParam = (field: string, val: string) => setParams({ ...params, [field]: val });

  return (
    <div className="space-y-4">
      {/* Color Table */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">颜色方案</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-8">#</th>
              <th className="text-left p-2 text-xs font-medium">颜色名称</th>
              <th className="text-left p-2 text-xs font-medium w-20">色值</th>
              <th className="text-left p-2 text-xs font-medium">选择原因</th>
              <th className="text-left p-2 text-xs font-medium">目标人群</th>
              {!isConfirmed && <th className="text-center p-2 text-xs font-medium w-12">操作</th>}
            </tr></thead>
            <tbody>
              {colors.map((c: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-2"><EditCell value={c.color} onChange={(v) => updateColor(i, "color", v)} disabled={isConfirmed} placeholder="颜色名" /></td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      {!isConfirmed ? (
                        <input type="color" value={c.hex || "#000000"} onChange={(e) => updateColor(i, "hex", e.target.value)} className="w-6 h-6 rounded border cursor-pointer" />
                      ) : (
                        <div className="w-4 h-4 rounded border" style={{ backgroundColor: c.hex }} />
                      )}
                      <span className="text-xs">{c.hex}</span>
                    </div>
                  </td>
                  <td className="p-2"><EditCell value={c.reason} onChange={(v) => updateColor(i, "reason", v)} disabled={isConfirmed} placeholder="原因" /></td>
                  <td className="p-2"><EditCell value={c.target} onChange={(v) => updateColor(i, "target", v)} disabled={isConfirmed} placeholder="人群" /></td>
                  {!isConfirmed && (
                    <td className="p-2 text-center">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeColor(i)}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!isConfirmed && (
            <div className="p-2 border-t">
              <Button size="sm" variant="ghost" onClick={addColor} className="gap-1 text-xs w-full">
                <Plus className="h-3 w-3" />新增颜色
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Design Parameters Table */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">设计要素</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-32">设计要素</th>
              <th className="text-left p-2 text-xs font-medium">AI建议 / 人工调整</th>
            </tr></thead>
            <tbody>
              {[
                { key: "materialSuggestion", label: "材质建议" },
                { key: "surfaceFinish", label: "表面处理" },
                { key: "differentiationDesign", label: "差异化设计" },
                { key: "designInspiration", label: "设计灵感" },
                { key: "colorMatching", label: "配色方案" },
                { key: "otherNotes", label: "其他建议" },
              ].map(p => (
                <tr key={p.key} className="border-b last:border-0">
                  <td className="p-2 text-xs font-medium text-muted-foreground">{p.label}</td>
                  <td className="p-2"><EditCell value={(params as any)[p.key]} onChange={(v) => updateParam(p.key, v)} disabled={isConfirmed} placeholder={`输入${p.label}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ActionBar isConfirmed={isConfirmed} onSave={() => onSave(buildData())} onConfirm={() => onConfirm(buildData())} savePending={savePending} confirmPending={confirmPending} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   2. 功能提升 Editor
   ═══════════════════════════════════════════════════════════ */
function FunctionEditor({ data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: any) {
  const [functions, setFunctions] = useState(() => ensureArray(data?.mainFunctions).map((f: any) => ({
    name: f.name || "", desc: f.desc || f.description || "", priority: f.priority || "中",
  })));
  const [upgrades, setUpgrades] = useState(() => ensureArray(data?.upgrades).map((u: any) => ({
    name: u.name || "", desc: u.desc || u.description || "", difficulty: u.difficulty || "中等",
    costImpact: u.costImpact || "", improvementRate: u.improvementRate || "",
  })));
  const [extras, setExtras] = useState(() => ({
    differentiationFeatures: data?.differentiationFeatures || "",
    userFeedbackInsights: data?.userFeedbackInsights || "",
  }));

  const buildData = () => ({ mainFunctions: functions, upgrades, ...extras });
  const addFunc = () => setFunctions([...functions, { name: "", desc: "", priority: "中" }]);
  const removeFunc = (i: number) => setFunctions(functions.filter((_: any, idx: number) => idx !== i));
  const updateFunc = (i: number, f: string, v: string) => { const n = [...functions]; n[i] = { ...n[i], [f]: v }; setFunctions(n); };
  const addUpgrade = () => setUpgrades([...upgrades, { name: "", desc: "", difficulty: "中等", costImpact: "", improvementRate: "" }]);
  const removeUpgrade = (i: number) => setUpgrades(upgrades.filter((_: any, idx: number) => idx !== i));
  const updateUpgrade = (i: number, f: string, v: string) => { const n = [...upgrades]; n[i] = { ...n[i], [f]: v }; setUpgrades(n); };

  return (
    <div className="space-y-4">
      {/* Main Functions */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">主要功能</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-8">#</th>
              <th className="text-left p-2 text-xs font-medium">功能名称</th>
              <th className="text-left p-2 text-xs font-medium">描述</th>
              <th className="text-left p-2 text-xs font-medium w-20">优先级</th>
              {!isConfirmed && <th className="text-center p-2 text-xs font-medium w-12">操作</th>}
            </tr></thead>
            <tbody>
              {functions.map((f: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-2"><EditCell value={f.name} onChange={(v) => updateFunc(i, "name", v)} disabled={isConfirmed} placeholder="功能名" /></td>
                  <td className="p-2"><EditCell value={f.desc} onChange={(v) => updateFunc(i, "desc", v)} disabled={isConfirmed} placeholder="描述" /></td>
                  <td className="p-2"><SelectCell value={f.priority} onChange={(v) => updateFunc(i, "priority", v)} disabled={isConfirmed} options={["高", "中", "低"]} /></td>
                  {!isConfirmed && <td className="p-2 text-center"><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeFunc(i)}><Trash2 className="h-3 w-3 text-red-500" /></Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!isConfirmed && <div className="p-2 border-t"><Button size="sm" variant="ghost" onClick={addFunc} className="gap-1 text-xs w-full"><Plus className="h-3 w-3" />新增功能</Button></div>}
        </div>
      </div>

      {/* Upgrades */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">功能升级点</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-8">#</th>
              <th className="text-left p-2 text-xs font-medium">升级点</th>
              <th className="text-left p-2 text-xs font-medium">描述</th>
              <th className="text-left p-2 text-xs font-medium w-20">难度</th>
              <th className="text-left p-2 text-xs font-medium w-24">成本影响</th>
              <th className="text-left p-2 text-xs font-medium w-24">预估提升率</th>
              {!isConfirmed && <th className="text-center p-2 text-xs font-medium w-12">操作</th>}
            </tr></thead>
            <tbody>
              {upgrades.map((u: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-2"><EditCell value={u.name} onChange={(v) => updateUpgrade(i, "name", v)} disabled={isConfirmed} placeholder="升级点" /></td>
                  <td className="p-2"><EditCell value={u.desc} onChange={(v) => updateUpgrade(i, "desc", v)} disabled={isConfirmed} placeholder="描述" /></td>
                  <td className="p-2"><SelectCell value={u.difficulty} onChange={(v) => updateUpgrade(i, "difficulty", v)} disabled={isConfirmed} options={["容易", "中等", "困难"]} /></td>
                  <td className="p-2"><EditCell value={u.costImpact} onChange={(v) => updateUpgrade(i, "costImpact", v)} disabled={isConfirmed} placeholder="如+¥3/件" /></td>
                  <td className="p-2"><EditCell value={u.improvementRate} onChange={(v) => updateUpgrade(i, "improvementRate", v)} disabled={isConfirmed} placeholder="如+25%" /></td>
                  {!isConfirmed && <td className="p-2 text-center"><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeUpgrade(i)}><Trash2 className="h-3 w-3 text-red-500" /></Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!isConfirmed && <div className="p-2 border-t"><Button size="sm" variant="ghost" onClick={addUpgrade} className="gap-1 text-xs w-full"><Plus className="h-3 w-3" />新增升级点</Button></div>}
        </div>
      </div>

      {/* Extra fields */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-32">要素</th>
            <th className="text-left p-2 text-xs font-medium">内容</th>
          </tr></thead>
          <tbody>
            <tr className="border-b"><td className="p-2 text-xs font-medium text-muted-foreground">差异化功能</td><td className="p-2"><EditCell value={extras.differentiationFeatures} onChange={(v) => setExtras({ ...extras, differentiationFeatures: v })} disabled={isConfirmed} /></td></tr>
            <tr><td className="p-2 text-xs font-medium text-muted-foreground">用户反馈洞察</td><td className="p-2"><EditCell value={extras.userFeedbackInsights} onChange={(v) => setExtras({ ...extras, userFeedbackInsights: v })} disabled={isConfirmed} /></td></tr>
          </tbody>
        </table>
      </div>

      <ActionBar isConfirmed={isConfirmed} onSave={() => onSave(buildData())} onConfirm={() => onConfirm(buildData())} savePending={savePending} confirmPending={confirmPending} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   3. 产品成本 Editor
   ═══════════════════════════════════════════════════════════ */
function CostEditor({ data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: any) {
  const [breakdown, setBreakdown] = useState(() => ensureArray(data?.breakdown).map((b: any) => ({
    item: b.item || "", estimatedCost: b.estimatedCost || "", percentage: b.percentage || "", note: b.note || "",
  })));
  const [pricing, setPricing] = useState(() => ({
    targetRetailPrice: data?.targetRetailPrice || "",
    targetMargin: data?.targetMargin || "",
    volumeDiscountNotes: data?.volumeDiscountNotes || "",
  }));
  const [tips, setTips] = useState(() => ensureArray(data?.costOptimizationTips));

  const totalCost = useMemo(() => {
    return breakdown.reduce((sum: number, b: any) => {
      const cost = parseFloat(String(b.estimatedCost).replace(/[^0-9.]/g, ""));
      return sum + (isNaN(cost) ? 0 : cost);
    }, 0);
  }, [breakdown]);

  const buildData = () => ({ breakdown, ...pricing, costOptimizationTips: tips });
  const addItem = () => setBreakdown([...breakdown, { item: "", estimatedCost: "", percentage: "", note: "" }]);
  const removeItem = (i: number) => setBreakdown(breakdown.filter((_: any, idx: number) => idx !== i));
  const updateItem = (i: number, f: string, v: string) => { const n = [...breakdown]; n[i] = { ...n[i], [f]: v }; setBreakdown(n); };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">成本明细</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-8">#</th>
              <th className="text-left p-2 text-xs font-medium">成本项</th>
              <th className="text-right p-2 text-xs font-medium w-28">预估金额(¥)</th>
              <th className="text-right p-2 text-xs font-medium w-20">占比</th>
              <th className="text-left p-2 text-xs font-medium">说明</th>
              {!isConfirmed && <th className="text-center p-2 text-xs font-medium w-12">操作</th>}
            </tr></thead>
            <tbody>
              {breakdown.map((b: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-2"><EditCell value={b.item} onChange={(v) => updateItem(i, "item", v)} disabled={isConfirmed} placeholder="成本项" /></td>
                  <td className="p-2"><EditCell value={b.estimatedCost} onChange={(v) => updateItem(i, "estimatedCost", v)} disabled={isConfirmed} placeholder="0.00" className="text-right" /></td>
                  <td className="p-2"><EditCell value={b.percentage} onChange={(v) => updateItem(i, "percentage", v)} disabled={isConfirmed} placeholder="0%" className="text-right" /></td>
                  <td className="p-2"><EditCell value={b.note} onChange={(v) => updateItem(i, "note", v)} disabled={isConfirmed} placeholder="说明" /></td>
                  {!isConfirmed && <td className="p-2 text-center"><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeItem(i)}><Trash2 className="h-3 w-3 text-red-500" /></Button></td>}
                </tr>
              ))}
              {/* Summary Row */}
              <tr className="bg-muted/30 font-semibold">
                <td className="p-2"></td>
                <td className="p-2 text-xs">合计</td>
                <td className="p-2 text-right text-xs">¥{totalCost.toFixed(2)}</td>
                <td className="p-2 text-right text-xs">100%</td>
                <td className="p-2"></td>
                {!isConfirmed && <td className="p-2"></td>}
              </tr>
            </tbody>
          </table>
          {!isConfirmed && <div className="p-2 border-t"><Button size="sm" variant="ghost" onClick={addItem} className="gap-1 text-xs w-full"><Plus className="h-3 w-3" />新增成本项</Button></div>}
        </div>
      </div>

      {/* Pricing Parameters */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">定价参数</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-40">参数</th>
              <th className="text-left p-2 text-xs font-medium">AI建议 / 人工调整</th>
            </tr></thead>
            <tbody>
              <tr className="border-b"><td className="p-2 text-xs font-medium text-muted-foreground">建议零售价(USD)</td><td className="p-2"><EditCell value={pricing.targetRetailPrice} onChange={(v) => setPricing({ ...pricing, targetRetailPrice: v })} disabled={isConfirmed} placeholder="$29.99" /></td></tr>
              <tr className="border-b"><td className="p-2 text-xs font-medium text-muted-foreground">目标利润率</td><td className="p-2"><EditCell value={pricing.targetMargin} onChange={(v) => setPricing({ ...pricing, targetMargin: v })} disabled={isConfirmed} placeholder="35%" /></td></tr>
              <tr><td className="p-2 text-xs font-medium text-muted-foreground">批量折扣说明</td><td className="p-2"><EditCell value={pricing.volumeDiscountNotes} onChange={(v) => setPricing({ ...pricing, volumeDiscountNotes: v })} disabled={isConfirmed} placeholder="如1000件起9折" /></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <ActionBar isConfirmed={isConfirmed} onSave={() => onSave(buildData())} onConfirm={() => onConfirm(buildData())} savePending={savePending} confirmPending={confirmPending} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   4. 包装设计 Editor
   ═══════════════════════════════════════════════════════════ */
function PackageEditor({ data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: any) {
  const dims = data?.dimensions || {};
  const [params, setParams] = useState(() => ({
    length: dims.length || "", width: dims.width || "", height: dims.height || "",
    weight: data?.weight || "", boxType: data?.boxType || "",
    innerStructure: data?.innerStructure || "", fillingMaterial: data?.fillingMaterial || "",
    fbaPackageRequirements: data?.fbaPackageRequirements || "",
    shippingConsiderations: data?.shippingConsiderations || "",
  }));

  const updateParam = (f: string, v: string) => setParams({ ...params, [f]: v });
  const buildData = () => ({
    dimensions: { length: params.length, width: params.width, height: params.height },
    weight: params.weight, boxType: params.boxType,
    innerStructure: params.innerStructure, fillingMaterial: params.fillingMaterial,
    fbaPackageRequirements: params.fbaPackageRequirements,
    shippingConsiderations: params.shippingConsiderations,
  });

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-40">参数</th>
            <th className="text-left p-2 text-xs font-medium">AI建议 / 人工调整</th>
          </tr></thead>
          <tbody>
            {[
              { key: "length", label: "长(cm)" }, { key: "width", label: "宽(cm)" }, { key: "height", label: "高(cm)" },
              { key: "weight", label: "重量(g)" }, { key: "boxType", label: "盒型" },
              { key: "innerStructure", label: "内部结构" }, { key: "fillingMaterial", label: "填充物" },
              { key: "fbaPackageRequirements", label: "FBA包装要求" },
              { key: "shippingConsiderations", label: "运输注意事项" },
            ].map(p => (
              <tr key={p.key} className="border-b last:border-0">
                <td className="p-2 text-xs font-medium text-muted-foreground">{p.label}</td>
                <td className="p-2"><EditCell value={(params as any)[p.key]} onChange={(v) => updateParam(p.key, v)} disabled={isConfirmed} placeholder={`输入${p.label}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ActionBar isConfirmed={isConfirmed} onSave={() => onSave(buildData())} onConfirm={() => onConfirm(buildData())} savePending={savePending} confirmPending={confirmPending} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   5. 包装外观 Editor
   ═══════════════════════════════════════════════════════════ */
function PackageDesignEditor({ data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: any) {
  const cs = data?.colorScheme || {};
  const [params, setParams] = useState(() => ({
    designStyle: data?.designStyle || "",
    primaryColor: cs.primary || "", secondaryColor: cs.secondary || "", accentColor: cs.accent || "",
    printingProcess: data?.printingProcess || "",
    brandElements: data?.brandElements || "",
    labelInfo: data?.labelInfo || "",
    unboxingExperience: data?.unboxingExperience || "",
    sustainabilityNotes: data?.sustainabilityNotes || "",
  }));

  const updateParam = (f: string, v: string) => setParams({ ...params, [f]: v });
  const buildData = () => ({
    designStyle: params.designStyle,
    colorScheme: { primary: params.primaryColor, secondary: params.secondaryColor, accent: params.accentColor },
    printingProcess: params.printingProcess, brandElements: params.brandElements,
    labelInfo: params.labelInfo, unboxingExperience: params.unboxingExperience,
    sustainabilityNotes: params.sustainabilityNotes,
  });

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-40">设计要素</th>
            <th className="text-left p-2 text-xs font-medium">AI建议 / 人工调整</th>
          </tr></thead>
          <tbody>
            {[
              { key: "designStyle", label: "设计风格" },
              { key: "primaryColor", label: "主色" },
              { key: "secondaryColor", label: "辅色" },
              { key: "accentColor", label: "点缀色" },
              { key: "printingProcess", label: "印刷工艺" },
              { key: "brandElements", label: "品牌元素" },
              { key: "labelInfo", label: "标签信息" },
              { key: "unboxingExperience", label: "开箱体验" },
              { key: "sustainabilityNotes", label: "环保包装" },
            ].map(p => (
              <tr key={p.key} className="border-b last:border-0">
                <td className="p-2 text-xs font-medium text-muted-foreground">{p.label}</td>
                <td className="p-2"><EditCell value={(params as any)[p.key]} onChange={(v) => updateParam(p.key, v)} disabled={isConfirmed} placeholder={`输入${p.label}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ActionBar isConfirmed={isConfirmed} onSave={() => onSave(buildData())} onConfirm={() => onConfirm(buildData())} savePending={savePending} confirmPending={confirmPending} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   6. 用户画像 Editor
   ═══════════════════════════════════════════════════════════ */
function UserPersonaEditor({ data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: any) {
  const demo = data?.demographics || {};
  const psycho = data?.psychographics || {};
  const [demographics, setDemographics] = useState(() => ({
    ageRange: demo.ageRange || "", gender: demo.gender || "", income: demo.income || "",
    education: demo.education || "", location: demo.location || "",
  }));
  const [painPoints, setPainPoints] = useState(() => ensureArray(data?.painPoints).map((p: any) => ({
    pain: p.pain || "", severity: p.severity || "中", currentSolution: p.currentSolution || "",
  })));
  const [extras, setExtras] = useState(() => ({
    lifestyle: psycho.lifestyle || "",
    values: psycho.values || "",
    interests: Array.isArray(psycho.interests) ? psycho.interests.join(", ") : (psycho.interests || ""),
    purchaseMotivation: Array.isArray(data?.purchaseMotivation) ? data.purchaseMotivation.join(", ") : (data?.purchaseMotivation || ""),
    buyingBehavior: data?.buyingBehavior || "",
    personaDescription: data?.personaDescription || "",
  }));

  const buildData = () => ({
    demographics,
    psychographics: { lifestyle: extras.lifestyle, values: extras.values, interests: extras.interests.split(",").map((s: string) => s.trim()).filter(Boolean) },
    painPoints,
    purchaseMotivation: extras.purchaseMotivation.split(",").map((s: string) => s.trim()).filter(Boolean),
    buyingBehavior: extras.buyingBehavior,
    personaDescription: extras.personaDescription,
  });

  const addPain = () => setPainPoints([...painPoints, { pain: "", severity: "中", currentSolution: "" }]);
  const removePain = (i: number) => setPainPoints(painPoints.filter((_: any, idx: number) => idx !== i));
  const updatePain = (i: number, f: string, v: string) => { const n = [...painPoints]; n[i] = { ...n[i], [f]: v }; setPainPoints(n); };

  return (
    <div className="space-y-4">
      {/* Demographics */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">人口统计</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-32">维度</th>
              <th className="text-left p-2 text-xs font-medium">内容</th>
            </tr></thead>
            <tbody>
              {[
                { key: "ageRange", label: "年龄段" }, { key: "gender", label: "性别分布" },
                { key: "income", label: "收入水平" }, { key: "education", label: "教育水平" },
                { key: "location", label: "地理位置" },
              ].map(p => (
                <tr key={p.key} className="border-b last:border-0">
                  <td className="p-2 text-xs font-medium text-muted-foreground">{p.label}</td>
                  <td className="p-2"><EditCell value={(demographics as any)[p.key]} onChange={(v) => setDemographics({ ...demographics, [p.key]: v })} disabled={isConfirmed} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pain Points */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">用户痛点</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-8">#</th>
              <th className="text-left p-2 text-xs font-medium">痛点</th>
              <th className="text-left p-2 text-xs font-medium w-20">严重程度</th>
              <th className="text-left p-2 text-xs font-medium">当前解决方案</th>
              {!isConfirmed && <th className="text-center p-2 text-xs font-medium w-12">操作</th>}
            </tr></thead>
            <tbody>
              {painPoints.map((p: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-2"><EditCell value={p.pain} onChange={(v) => updatePain(i, "pain", v)} disabled={isConfirmed} /></td>
                  <td className="p-2"><SelectCell value={p.severity} onChange={(v) => updatePain(i, "severity", v)} disabled={isConfirmed} options={["高", "中", "低"]} /></td>
                  <td className="p-2"><EditCell value={p.currentSolution} onChange={(v) => updatePain(i, "currentSolution", v)} disabled={isConfirmed} /></td>
                  {!isConfirmed && <td className="p-2 text-center"><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removePain(i)}><Trash2 className="h-3 w-3 text-red-500" /></Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!isConfirmed && <div className="p-2 border-t"><Button size="sm" variant="ghost" onClick={addPain} className="gap-1 text-xs w-full"><Plus className="h-3 w-3" />新增痛点</Button></div>}
        </div>
      </div>

      {/* Psychographics & Extras */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-32">要素</th>
            <th className="text-left p-2 text-xs font-medium">内容</th>
          </tr></thead>
          <tbody>
            {[
              { key: "lifestyle", label: "生活方式" }, { key: "values", label: "价值观" },
              { key: "interests", label: "兴趣爱好(逗号分隔)" },
              { key: "purchaseMotivation", label: "购买动机(逗号分隔)" },
              { key: "buyingBehavior", label: "购买行为" },
              { key: "personaDescription", label: "画像描述" },
            ].map(p => (
              <tr key={p.key} className="border-b last:border-0">
                <td className="p-2 text-xs font-medium text-muted-foreground">{p.label}</td>
                <td className="p-2"><EditCell value={(extras as any)[p.key]} onChange={(v) => setExtras({ ...extras, [p.key]: v })} disabled={isConfirmed} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ActionBar isConfirmed={isConfirmed} onSave={() => onSave(buildData())} onConfirm={() => onConfirm(buildData())} savePending={savePending} confirmPending={confirmPending} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   7. 使用场景 Editor
   ═══════════════════════════════════════════════════════════ */
function UsageScenariosEditor({ data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: any) {
  const [scenarios, setScenarios] = useState(() => ensureArray(data?.scenarios).map((s: any) => ({
    name: s.name || "", description: s.description || "", frequency: s.frequency || "",
    environment: s.environment || "", relatedProducts: s.relatedProducts || "",
    marketingAngle: s.marketingAngle || "",
  })));
  const [extras, setExtras] = useState(() => ({
    seasonalTrends: data?.seasonalTrends || "",
    crossSellingOpportunities: data?.crossSellingOpportunities || "",
  }));

  const buildData = () => ({ scenarios, ...extras });
  const addScenario = () => setScenarios([...scenarios, { name: "", description: "", frequency: "", environment: "", relatedProducts: "", marketingAngle: "" }]);
  const removeScenario = (i: number) => setScenarios(scenarios.filter((_: any, idx: number) => idx !== i));
  const updateScenario = (i: number, f: string, v: string) => { const n = [...scenarios]; n[i] = { ...n[i], [f]: v }; setScenarios(n); };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">使用场景列表</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-8">#</th>
              <th className="text-left p-2 text-xs font-medium">场景名称</th>
              <th className="text-left p-2 text-xs font-medium">描述</th>
              <th className="text-left p-2 text-xs font-medium w-20">频率</th>
              <th className="text-left p-2 text-xs font-medium">环境</th>
              <th className="text-left p-2 text-xs font-medium">营销切入点</th>
              {!isConfirmed && <th className="text-center p-2 text-xs font-medium w-12">操作</th>}
            </tr></thead>
            <tbody>
              {scenarios.map((s: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-2"><EditCell value={s.name} onChange={(v) => updateScenario(i, "name", v)} disabled={isConfirmed} placeholder="场景名" /></td>
                  <td className="p-2"><EditCell value={s.description} onChange={(v) => updateScenario(i, "description", v)} disabled={isConfirmed} placeholder="描述" /></td>
                  <td className="p-2"><EditCell value={s.frequency} onChange={(v) => updateScenario(i, "frequency", v)} disabled={isConfirmed} placeholder="频率" /></td>
                  <td className="p-2"><EditCell value={s.environment} onChange={(v) => updateScenario(i, "environment", v)} disabled={isConfirmed} placeholder="环境" /></td>
                  <td className="p-2"><EditCell value={s.marketingAngle} onChange={(v) => updateScenario(i, "marketingAngle", v)} disabled={isConfirmed} placeholder="切入点" /></td>
                  {!isConfirmed && <td className="p-2 text-center"><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeScenario(i)}><Trash2 className="h-3 w-3 text-red-500" /></Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!isConfirmed && <div className="p-2 border-t"><Button size="sm" variant="ghost" onClick={addScenario} className="gap-1 text-xs w-full"><Plus className="h-3 w-3" />新增场景</Button></div>}
        </div>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-40">要素</th>
            <th className="text-left p-2 text-xs font-medium">内容</th>
          </tr></thead>
          <tbody>
            <tr className="border-b"><td className="p-2 text-xs font-medium text-muted-foreground">季节性趋势</td><td className="p-2"><EditCell value={extras.seasonalTrends} onChange={(v) => setExtras({ ...extras, seasonalTrends: v })} disabled={isConfirmed} /></td></tr>
            <tr><td className="p-2 text-xs font-medium text-muted-foreground">交叉销售机会</td><td className="p-2"><EditCell value={extras.crossSellingOpportunities} onChange={(v) => setExtras({ ...extras, crossSellingOpportunities: v })} disabled={isConfirmed} /></td></tr>
          </tbody>
        </table>
      </div>

      <ActionBar isConfirmed={isConfirmed} onSave={() => onSave(buildData())} onConfirm={() => onConfirm(buildData())} savePending={savePending} confirmPending={confirmPending} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   8. 产品地图 Editor
   ═══════════════════════════════════════════════════════════ */
function ProductMapEditor({ data, isConfirmed, onSave, onConfirm, savePending, confirmPending }: any) {
  const pos = data?.positioning || {};
  const [positioning, setPositioning] = useState(() => ({
    priceRange: pos.priceRange || "", qualityLevel: pos.qualityLevel || "", targetSegment: pos.targetSegment || "",
  }));
  const [competitors, setCompetitors] = useState(() => ensureArray(data?.competitors).map((c: any) => ({
    brand: c.brand || "", priceRange: c.priceRange || "", strengths: c.strengths || "", weaknesses: c.weaknesses || "",
  })));
  const [gaps, setGaps] = useState(() => ensureArray(data?.marketGaps).map((g: any) => ({
    gap: g.gap || "", opportunity: g.opportunity || "",
  })));
  const [extras, setExtras] = useState(() => ({
    differentiationStrategy: data?.differentiationStrategy || "",
    entryStrategy: data?.entryStrategy || "",
  }));

  const buildData = () => ({ positioning, competitors, marketGaps: gaps, ...extras });
  const addComp = () => setCompetitors([...competitors, { brand: "", priceRange: "", strengths: "", weaknesses: "" }]);
  const removeComp = (i: number) => setCompetitors(competitors.filter((_: any, idx: number) => idx !== i));
  const updateComp = (i: number, f: string, v: string) => { const n = [...competitors]; n[i] = { ...n[i], [f]: v }; setCompetitors(n); };
  const addGap = () => setGaps([...gaps, { gap: "", opportunity: "" }]);
  const removeGap = (i: number) => setGaps(gaps.filter((_: any, idx: number) => idx !== i));
  const updateGap = (i: number, f: string, v: string) => { const n = [...gaps]; n[i] = { ...n[i], [f]: v }; setGaps(n); };

  return (
    <div className="space-y-4">
      {/* Positioning */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">产品定位</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-32">维度</th>
              <th className="text-left p-2 text-xs font-medium">内容</th>
            </tr></thead>
            <tbody>
              {[
                { key: "priceRange", label: "价格区间" },
                { key: "qualityLevel", label: "品质定位" },
                { key: "targetSegment", label: "目标细分市场" },
              ].map(p => (
                <tr key={p.key} className="border-b last:border-0">
                  <td className="p-2 text-xs font-medium text-muted-foreground">{p.label}</td>
                  <td className="p-2"><EditCell value={(positioning as any)[p.key]} onChange={(v) => setPositioning({ ...positioning, [p.key]: v })} disabled={isConfirmed} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Competitors */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">竞品对比</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-8">#</th>
              <th className="text-left p-2 text-xs font-medium">品牌</th>
              <th className="text-left p-2 text-xs font-medium w-24">价格区间</th>
              <th className="text-left p-2 text-xs font-medium">优势</th>
              <th className="text-left p-2 text-xs font-medium">劣势</th>
              {!isConfirmed && <th className="text-center p-2 text-xs font-medium w-12">操作</th>}
            </tr></thead>
            <tbody>
              {competitors.map((c: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-2"><EditCell value={c.brand} onChange={(v) => updateComp(i, "brand", v)} disabled={isConfirmed} placeholder="品牌" /></td>
                  <td className="p-2"><EditCell value={c.priceRange} onChange={(v) => updateComp(i, "priceRange", v)} disabled={isConfirmed} placeholder="$X-$Y" /></td>
                  <td className="p-2"><EditCell value={c.strengths} onChange={(v) => updateComp(i, "strengths", v)} disabled={isConfirmed} placeholder="优势" /></td>
                  <td className="p-2"><EditCell value={c.weaknesses} onChange={(v) => updateComp(i, "weaknesses", v)} disabled={isConfirmed} placeholder="劣势" /></td>
                  {!isConfirmed && <td className="p-2 text-center"><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeComp(i)}><Trash2 className="h-3 w-3 text-red-500" /></Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!isConfirmed && <div className="p-2 border-t"><Button size="sm" variant="ghost" onClick={addComp} className="gap-1 text-xs w-full"><Plus className="h-3 w-3" />新增竞品</Button></div>}
        </div>
      </div>

      {/* Market Gaps */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">市场空白</h4>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left p-2 text-xs font-medium w-8">#</th>
              <th className="text-left p-2 text-xs font-medium">空白点</th>
              <th className="text-left p-2 text-xs font-medium">机会描述</th>
              {!isConfirmed && <th className="text-center p-2 text-xs font-medium w-12">操作</th>}
            </tr></thead>
            <tbody>
              {gaps.map((g: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-2"><EditCell value={g.gap} onChange={(v) => updateGap(i, "gap", v)} disabled={isConfirmed} placeholder="空白点" /></td>
                  <td className="p-2"><EditCell value={g.opportunity} onChange={(v) => updateGap(i, "opportunity", v)} disabled={isConfirmed} placeholder="机会" /></td>
                  {!isConfirmed && <td className="p-2 text-center"><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeGap(i)}><Trash2 className="h-3 w-3 text-red-500" /></Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!isConfirmed && <div className="p-2 border-t"><Button size="sm" variant="ghost" onClick={addGap} className="gap-1 text-xs w-full"><Plus className="h-3 w-3" />新增空白点</Button></div>}
        </div>
      </div>

      {/* Strategy */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="text-left p-2 text-xs font-medium w-32">策略</th>
            <th className="text-left p-2 text-xs font-medium">内容</th>
          </tr></thead>
          <tbody>
            <tr className="border-b"><td className="p-2 text-xs font-medium text-muted-foreground">差异化策略</td><td className="p-2"><EditCell value={extras.differentiationStrategy} onChange={(v) => setExtras({ ...extras, differentiationStrategy: v })} disabled={isConfirmed} /></td></tr>
            <tr><td className="p-2 text-xs font-medium text-muted-foreground">进入策略</td><td className="p-2"><EditCell value={extras.entryStrategy} onChange={(v) => setExtras({ ...extras, entryStrategy: v })} disabled={isConfirmed} /></td></tr>
          </tbody>
        </table>
      </div>

      <ActionBar isConfirmed={isConfirmed} onSave={() => onSave(buildData())} onConfirm={() => onConfirm(buildData())} savePending={savePending} confirmPending={confirmPending} />
    </div>
  );
}
