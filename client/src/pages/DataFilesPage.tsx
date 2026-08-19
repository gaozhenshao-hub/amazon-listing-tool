import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  BarChart3,
  Search,
  Target,
  Layers,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Pencil,
  Save,
  X,
  Plus,
  Minus,
  Download,
  History,
  RotateCcw,
  Clock,
  FileDown,
  Import,
  Package,
  HelpCircle,
  MessageSquare,
} from "lucide-react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { shouldShowProjectFileError } from "./dataFiles/displayState";
import { getRufusIdentityEntries } from "./dataFiles/rufusIdentity";
import { getRufusUsageScenarios } from "./dataFiles/rufusUsageScenarios";

type FileType = "product_attributes";

const FILE_TYPE_CONFIG: Record<FileType, {
  label: string;
  description: string;
  accept: string;
  icon: typeof FileText;
  color: string;
  bgColor: string;
  borderColor: string;
  module: string;
  expectedFile: string;
  templateUrl: string;
  templateFilename: string;
}> = {
  product_attributes: {
    label: "本品属性表",
    description: "Rufus 属性提取 — 深度读取产品属性参数，提取核心规格、材质、性能等",
    accept: ".txt,.csv",
    icon: Target,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    module: "Module 1: Rufus",
    expectedFile: "本品属性表.txt",
    templateUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310419663030562636/a79tkwusxJ5HWpLxCXSSXN/本品属性表_模板_bb914ab3.txt",
    templateFilename: "本品属性表_模板.txt",
  },

};

const FILE_TYPES: FileType[] = ["product_attributes"];

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
    uploaded: { label: "已上传", variant: "secondary", className: "" },
    parsing: { label: "解析中", variant: "secondary", className: "animate-pulse" },
    parsed: { label: "已解析", variant: "outline", className: "border-blue-300 text-blue-600" },
    analyzing: { label: "AI分析中", variant: "secondary", className: "animate-pulse bg-purple-100 text-purple-700" },
    completed: { label: "分析完成", variant: "default", className: "bg-green-600" },
    failed: { label: "失败", variant: "destructive", className: "" },
  };
  const c = config[status] || config.uploaded;
  return <Badge variant={c.variant} className={c.className}>{c.label}</Badge>;
}

// ─── Editable Tag List ──────────────────────────────────────────
function EditableTagList({
  items,
  onChange,
  colorClass = "border-gray-300 text-gray-700",
  badgeClass = "",
  placeholder = "输入后按回车添加",
}: {
  items: string[];
  onChange: (items: string[]) => void;
  colorClass?: string;
  badgeClass?: string;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    const val = inputValue.trim();
    if (val && !items.includes(val)) {
      onChange([...items, val]);
      setInputValue("");
    }
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <Badge key={i} variant="outline" className={`text-xs ${colorClass} ${badgeClass} pr-1 gap-1`}>
            {item}
            <button
              onClick={() => handleRemove(i)}
              className="ml-0.5 hover:text-red-500 transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-7 text-xs"
        />
        <Button variant="outline" size="sm" className="h-7 px-2 shrink-0" onClick={handleAdd} disabled={!inputValue.trim()}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── Editable Spec List (attribute: value pairs) ────────────────
function EditableSpecList({
  items,
  onChange,
  attrKey = "attribute",
  valKey = "value",
}: {
  items: Array<Record<string, string>>;
  onChange: (items: Array<Record<string, string>>) => void;
  attrKey?: string;
  valKey?: string;
}) {
  const handleChange = (index: number, field: string, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleAdd = () => {
    onChange([...items, { [attrKey]: "", [valKey]: "" }]);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={item[attrKey] || ""}
            onChange={(e) => handleChange(i, attrKey, e.target.value)}
            placeholder="属性名"
            className="h-7 text-xs flex-1"
          />
          <span className="text-xs text-muted-foreground">:</span>
          <Input
            value={item[valKey] || ""}
            onChange={(e) => handleChange(i, valKey, e.target.value)}
            placeholder="值"
            className="h-7 text-xs flex-1"
          />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => handleRemove(i)}>
            <Minus className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={handleAdd}>
        <Plus className="h-3 w-3 mr-1" /> 添加
      </Button>
    </div>
  );
}

// ─── Editable Parity/Gap Items ──────────────────────────────────
function EditableParityList({
  items,
  onChange,
}: {
  items: Array<{ sellingPoint: string; frequency: string; importance: string }>;
  onChange: (items: Array<{ sellingPoint: string; frequency: string; importance: string }>) => void;
}) {
  const handleChange = (index: number, field: string, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleAdd = () => {
    onChange([...items, { sellingPoint: "", frequency: "most", importance: "important" }]);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={item.sellingPoint}
            onChange={(e) => handleChange(i, "sellingPoint", e.target.value)}
            placeholder="卖点描述"
            className="h-7 text-xs flex-1"
          />
          <select
            value={item.frequency}
            onChange={(e) => handleChange(i, "frequency", e.target.value)}
            className="h-7 text-xs border rounded px-1 bg-background"
          >
            <option value="all">all</option>
            <option value="most">most</option>
            <option value="some">some</option>
          </select>
          <select
            value={item.importance}
            onChange={(e) => handleChange(i, "importance", e.target.value)}
            className="h-7 text-xs border rounded px-1 bg-background"
          >
            <option value="must-have">must-have</option>
            <option value="important">important</option>
            <option value="nice-to-have">nice-to-have</option>
          </select>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => handleRemove(i)}>
            <Minus className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={handleAdd}>
        <Plus className="h-3 w-3 mr-1" /> 添加共性卖点
      </Button>
    </div>
  );
}

function EditableGapList({
  items,
  onChange,
}: {
  items: Array<{ gap: string; type: string; opportunityLevel: string }>;
  onChange: (items: Array<{ gap: string; type: string; opportunityLevel: string }>) => void;
}) {
  const handleChange = (index: number, field: string, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleAdd = () => {
    onChange([...items, { gap: "", type: "ignored_scenario", opportunityLevel: "medium" }]);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={item.gap}
            onChange={(e) => handleChange(i, "gap", e.target.value)}
            placeholder="缺口描述"
            className="h-7 text-xs flex-1"
          />
          <select
            value={item.type}
            onChange={(e) => handleChange(i, "type", e.target.value)}
            className="h-7 text-xs border rounded px-1 bg-background"
          >
            <option value="ignored_scenario">忽略场景</option>
            <option value="unaddressed_pain">未解决痛点</option>
            <option value="underserved_audience">未服务人群</option>
            <option value="missing_feature">缺失功能</option>
          </select>
          <select
            value={item.opportunityLevel}
            onChange={(e) => handleChange(i, "opportunityLevel", e.target.value)}
            className="h-7 text-xs border rounded px-1 bg-background"
          >
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => handleRemove(i)}>
            <Minus className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={handleAdd}>
        <Plus className="h-3 w-3 mr-1" /> 添加缺口机会
      </Button>
    </div>
  );
}

// ─── Editable Scene Clusters ────────────────────────────────────
function EditableSceneList({
  items,
  onChange,
}: {
  items: Array<{ sceneName: string; sceneNameCn: string; priority: string; buyerIntent: string }>;
  onChange: (items: Array<{ sceneName: string; sceneNameCn: string; priority: string; buyerIntent: string }>) => void;
}) {
  const handleChange = (index: number, field: string, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleAdd = () => {
    onChange([...items, { sceneName: "", sceneNameCn: "", priority: "medium", buyerIntent: "" }]);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="p-2 border rounded-md space-y-1.5 bg-muted/10">
          <div className="flex items-center gap-1.5">
            <Input
              value={item.sceneName}
              onChange={(e) => handleChange(i, "sceneName", e.target.value)}
              placeholder="场景名称 (EN)"
              className="h-7 text-xs flex-1"
            />
            <Input
              value={item.sceneNameCn}
              onChange={(e) => handleChange(i, "sceneNameCn", e.target.value)}
              placeholder="场景名称 (中文)"
              className="h-7 text-xs flex-1"
            />
            <select
              value={item.priority}
              onChange={(e) => handleChange(i, "priority", e.target.value)}
              className="h-7 text-xs border rounded px-1 bg-background"
            >
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => handleRemove(i)}>
              <Minus className="h-3 w-3" />
            </Button>
          </div>
          <Input
            value={item.buyerIntent}
            onChange={(e) => handleChange(i, "buyerIntent", e.target.value)}
            placeholder="买家意图"
            className="h-7 text-xs"
          />
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={handleAdd}>
        <Plus className="h-3 w-3 mr-1" /> 添加使用场景
      </Button>
    </div>
  );
}

// ─── Analysis Result Card (View + Edit Mode) ────────────────────
function AnalysisResultCard({
  fileType,
  result,
  fileId,
  projectId,
}: {
  fileType: FileType;
  result: any;
  fileId: number;
  projectId: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const utils = trpc.useUtils();

  const { data: versionHistory, isLoading: historyLoading } = trpc.projectFile.getVersionHistory.useQuery(
    { fileId },
    { enabled: showHistory }
  );

  const restoreVersion = trpc.projectFile.restoreVersion.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      utils.projectFile.getVersionHistory.invalidate({ fileId });
      toast.success("已恢复到指定版本");
      setShowHistory(false);
    },
    onError: (err) => toast.error(`恢复失败: ${err.message}`),
  });

  const updateMutation = trpc.projectFile.updateAnalysisResult.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      utils.projectFile.getVersionHistory.invalidate({ fileId });
      toast.success("分析结果已保存");
      setEditing(false);
      setSaving(false);
    },
    onError: (err) => {
      toast.error(`保存失败: ${err.message}`);
      setSaving(false);
    },
  });

  const startEdit = () => {
    setEditData(JSON.parse(JSON.stringify(result))); // deep clone
    setEditing(true);
    setExpanded(true);
  };

  const cancelEdit = () => {
    setEditData(null);
    setEditing(false);
  };

  const saveEdit = () => {
    if (!editData) return;
    setSaving(true);
    updateMutation.mutate({
      fileId,
      analysisResult: JSON.stringify(editData),
      changeNote: "手动编辑",
    });
  };

  if (!result) return null;

  const data = editing ? editData : result;
  const rufusIdentityEntries = getRufusIdentityEntries(data?.productIdentity);
  const rufusUsageScenarios = getRufusUsageScenarios(data?.usageScenarios);

  // ─── View Mode Renderers ──────────────────────────────────────
  const renderViewContent = () => {
    switch (fileType) {
      case "product_attributes":
        return (
          <div className="space-y-3">
            {rufusIdentityEntries.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">产品标识</p>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {rufusIdentityEntries.map((entry) => (
                    <span key={entry.key} className="text-muted-foreground">
                      <strong>{entry.label}:</strong> {entry.value}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {data.uniqueSellingPoints?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">独特卖点 (USP)</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.uniqueSellingPoints.map((usp: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs border-blue-300 text-blue-700">{usp}</Badge>
                  ))}
                </div>
              </div>
            )}
            {data.coreSpecs?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">核心规格</p>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {data.coreSpecs.slice(0, 8).map((s: any, i: number) => (
                    <span key={i} className="text-muted-foreground">
                      <strong>{s.attribute}:</strong> {s.value}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {rufusUsageScenarios.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">使用场景</p>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {rufusUsageScenarios.map((item, index) => (
                    <p key={`${item.scenario}-${index}`}>
                      <strong>{item.scenario || "适用说明"}:</strong> {item.detail || "未填写详情"}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {data.rufusFriendlyAttributes?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">Rufus友好属性</p>
                <div className="flex flex-wrap gap-1">
                  {data.rufusFriendlyAttributes.slice(0, 6).map((a: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
              </div>
            )}
            {data.suggestedKeywordsFromAttributes?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">属性关键词建议</p>
                <div className="flex flex-wrap gap-1">
                  {data.suggestedKeywordsFromAttributes.map((k: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs border-blue-200">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        );



      default:
        return <pre className="text-xs overflow-auto max-h-40">{JSON.stringify(data, null, 2)}</pre>;
    }
  };

  // ─── Edit Mode Renderers ──────────────────────────────────────
  const renderEditContent = () => {
    if (!editData) return null;
    const productIdentity = editData.productIdentity || {};

    switch (fileType) {
      case "product_attributes":
        return (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-blue-700 mb-1.5">产品标识</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["brand", "品牌"],
                  ["productName", "产品名称"],
                  ["asin", "ASIN"],
                  ["category", "产品类目"],
                ] as const).map(([key, label]) => (
                  <Input
                    key={key}
                    value={productIdentity[key] || ""}
                    placeholder={label}
                    className="h-7 text-xs"
                    onChange={(event) => setEditData({
                      ...editData,
                      productIdentity: { ...productIdentity, [key]: event.target.value },
                    })}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-700 mb-1.5">独特卖点 (USP)</p>
              <EditableTagList
                items={editData.uniqueSellingPoints || []}
                onChange={(items) => setEditData({ ...editData, uniqueSellingPoints: items })}
                colorClass="border-blue-300 text-blue-700"
                placeholder="输入卖点后按回车"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-700 mb-1.5">核心规格</p>
              <EditableSpecList
                items={editData.coreSpecs || []}
                onChange={(items) => setEditData({ ...editData, coreSpecs: items })}
                attrKey="attribute"
                valKey="value"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-700 mb-1.5">使用场景</p>
              <EditableSpecList
                items={editData.usageScenarios || []}
                onChange={(items) => setEditData({ ...editData, usageScenarios: items })}
                attrKey="scenario"
                valKey="detail"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-700 mb-1.5">Rufus友好属性</p>
              <EditableTagList
                items={editData.rufusFriendlyAttributes || []}
                onChange={(items) => setEditData({ ...editData, rufusFriendlyAttributes: items })}
                placeholder="输入属性后按回车"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-700 mb-1.5">属性关键词建议</p>
              <EditableTagList
                items={editData.suggestedKeywordsFromAttributes || []}
                onChange={(items) => setEditData({ ...editData, suggestedKeywordsFromAttributes: items })}
                colorClass="border-blue-200"
                placeholder="输入关键词后按回车"
              />
            </div>
          </div>
        );



      default:
        return (
          <Textarea
            value={JSON.stringify(editData, null, 2)}
            onChange={(e) => {
              try { setEditData(JSON.parse(e.target.value)); } catch {}
            }}
            className="text-xs font-mono min-h-[200px]"
          />
        );
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? "收起分析结果" : "展开分析结果"}
        </button>
        <div className="flex items-center gap-1">
          {!editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowHistory(!showHistory)}
              >
                <History className="h-3 w-3 mr-1" />
                历史
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={startEdit}
              >
                <Pencil className="h-3 w-3 mr-1" />
                编辑
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={cancelEdit}
                disabled={saving}
              >
                <X className="h-3 w-3 mr-1" />
                取消
              </Button>
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={saveEdit}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                保存
              </Button>
            </>
          )}
        </div>
      </div>
      {showHistory && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/30 space-y-2">
          <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-amber-200">
            <History className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-xs font-medium text-amber-700">版本历史</span>
          </div>
          {historyLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中...
            </div>
          ) : !versionHistory || versionHistory.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">暂无版本历史记录</p>
          ) : (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {versionHistory.map((v: any, i: number) => (
                <div key={v.id} className={`flex items-center justify-between text-xs p-2 rounded ${
                  i === 0 ? "bg-amber-100/50 border border-amber-200" : "bg-background border"
                }`}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${
                      v.changeType === "auto_analysis" ? "border-green-300 text-green-600" :
                      v.changeType === "re_analysis" ? "border-purple-300 text-purple-600" :
                      "border-blue-300 text-blue-600"
                    }`}>
                      {v.changeType === "auto_analysis" ? "AI分析" :
                       v.changeType === "re_analysis" ? "重新分析" : "手动编辑"}
                    </Badge>
                    <span className="text-muted-foreground">v{v.version}</span>
                    {v.changeNote && (
                      <span className="truncate text-muted-foreground">{v.changeNote}</span>
                    )}
                    <span className="text-muted-foreground shrink-0">
                      <Clock className="h-3 w-3 inline mr-0.5" />
                      {new Date(v.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {i !== 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-amber-700 hover:text-amber-900 hover:bg-amber-100 shrink-0 ml-2"
                      onClick={() => {
                        if (confirm(`确定恢复到版本 v${v.version}？当前分析结果将被覆盖。`)) {
                          restoreVersion.mutate({ versionId: v.id });
                        }
                      }}
                      disabled={restoreVersion.isPending}
                    >
                      <RotateCcw className="h-2.5 w-2.5 mr-0.5" />
                      恢复
                    </Button>
                  )}
                  {i === 0 && (
                    <Badge variant="secondary" className="text-[10px] shrink-0 ml-2">当前</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {expanded && (
        <div className={`p-3 rounded-lg border ${editing ? "border-blue-300 bg-blue-50/30" : "bg-muted/20"}`}>
          {editing ? (
            <div>
              <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-blue-200">
                <Pencil className="h-3.5 w-3.5 text-blue-600" />
                <span className="text-xs font-medium text-blue-700">编辑模式 — 修改后点击保存</span>
              </div>
              {renderEditContent()}
            </div>
          ) : (
            renderViewContent()
          )}
        </div>
      )}
    </div>
  );
}

// ─── Import from Product Profile Button ─────────────────────────
function ImportFromProfileButton({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const [selectedDevProjectId, setSelectedDevProjectId] = useState<string>("");
  const utils = trpc.useUtils();

  // Query available dev projects for import
  const { data: importableProjects, isLoading: loadingProjects } = trpc.projectAssignment.listImportableDevProjects.useQuery(
    undefined,
    { enabled: open }
  );

  // Get profile preview when a project is selected
  const { data: profilePreview, isLoading: loadingPreview } = trpc.projectAssignment.getDevProjectProfile.useQuery(
    { devProjectId: Number(selectedDevProjectId) },
    { enabled: !!selectedDevProjectId && open }
  );

  const importMutation = trpc.projectFile.importFromProfile.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType: "product_attributes" });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      toast.success("产品画像数据已成功导入并完成AI分析");
      setOpen(false);
      setSelectedDevProjectId("");
    },
    onError: (err) => toast.error(`导入失败: ${err.message}`),
  });

  const handleImport = () => {
    if (!selectedDevProjectId) {
      toast.error("请先选择一个产品开发项目");
      return;
    }
    importMutation.mutate({
      listingProjectId: projectId,
      devProjectId: Number(selectedDevProjectId),
    });
  };

  const hasProfile = profilePreview?.profile !== null;

  // Build profile summary for preview
  const profileSummary = useMemo(() => {
    if (!profilePreview?.profile) return null;
    const p = profilePreview.profile;
    const sections: string[] = [];
    const checkField = (field: string, label: string) => {
      const val = (p as any)[field];
      if (val) {
        try {
          const parsed = typeof val === "string" ? JSON.parse(val) : val;
          if (parsed && (Array.isArray(parsed) ? parsed.length > 0 : Object.keys(parsed).length > 0)) {
            sections.push(label);
          }
        } catch {
          if (typeof val === "string" && val.trim()) sections.push(label);
        }
      }
    };
    checkField("appearanceColors", "外观设计");
    checkField("appearanceAiSuggestion", "外观设计(AI)");
    checkField("mainFunctions", "功能特点");
    checkField("functionsAiSuggestion", "功能特点(AI)");
    checkField("costBreakdown", "产品成本");
    checkField("packageDimensions", "包装尺寸");
    checkField("userPersona", "用户画像");
    checkField("usageScenarios", "使用场景");
    checkField("productMap", "产品地图");
    return sections;
  }, [profilePreview?.profile]);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSelectedDevProjectId(""); }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
        >
          <Import className="h-3.5 w-3.5 mr-2" />
          从产品画像导入
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            从产品画像导入
          </DialogTitle>
          <DialogDescription>
            选择已分配给您的产品开发项目，将其产品画像数据自动转换为本品属性表并进行AI分析
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Project Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">选择产品开发项目</label>
            <Select value={selectedDevProjectId} onValueChange={setSelectedDevProjectId}>
              <SelectTrigger>
                <SelectValue placeholder={loadingProjects ? "加载中..." : "请选择项目"} />
              </SelectTrigger>
              <SelectContent>
                {importableProjects?.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    <div className="flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.targetMarket && (
                        <Badge variant="outline" className="text-[10px] ml-1">{p.targetMarket}</Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
                {importableProjects?.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-amber-500" />
                    <p>暂无可导入的项目</p>
                    <p className="text-xs mt-1">请联系管理员分配产品开发项目</p>
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Profile Preview */}
          {selectedDevProjectId && (
            <div className="space-y-2">
              {loadingPreview ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载产品画像...
                </div>
              ) : hasProfile ? (
                <Card className="border-blue-200 bg-blue-50/50">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-medium">产品画像数据可用</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      项目: {profilePreview?.project?.name}
                    </p>
                    {profileSummary && profileSummary.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {profileSummary.map((s, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-blue-600">
                      导入后将自动运行Rufus属性分析，提取核心规格、材质、性能等参数
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-amber-200 bg-amber-50/50">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-medium text-amber-700">该项目尚未创建产品画像</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      请先在产品开发模块中完成产品画像的创建
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button
            onClick={handleImport}
            disabled={!selectedDevProjectId || !hasProfile || importMutation.isPending}
          >
            {importMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                导入并分析中...
              </>
            ) : (
              <>
                <Import className="h-4 w-4 mr-2" />
                确认导入
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileUploadCard({ fileType, projectId }: { fileType: FileType; projectId: number }) {
  const config = FILE_TYPE_CONFIG[fileType];
  const Icon = config.icon;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const utils = trpc.useUtils();

  const { data: files, isLoading } = trpc.projectFile.listByType.useQuery(
    { projectId, fileType },
    { enabled: !!projectId }
  );

  const uploadAndAnalyze = trpc.projectFile.uploadAndAnalyze.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      toast.success(`${config.label} 上传并分析完成`);
      setUploading(false);
    },
    onError: (err) => {
      toast.error(`分析失败: ${err.message}`);
      setUploading(false);
    },
  });

  const reAnalyze = trpc.projectFile.analyze.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      toast.success("重新分析完成");
    },
    onError: (err) => toast.error(`分析失败: ${err.message}`),
  });

  const deleteFile = trpc.projectFile.delete.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      toast.success("文件已删除");
    },
    onError: (err) => toast.error(`删除失败: ${err.message}`),
  });

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("文件大小不能超过5MB");
      return;
    }

    setUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadAndAnalyze.mutate({
          projectId,
          fileType,
          filename: file.name,
          content: base64,
        });
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("文件读取失败");
      setUploading(false);
    }

    if (inputRef.current) inputRef.current.value = "";
  }, [projectId, fileType, uploadAndAnalyze]);

  const latestFile = files?.[0];
  const hasCompletedFile = latestFile?.status === "completed";
  const isAnalyzing = uploading || uploadAndAnalyze.isPending || reAnalyze.isPending;

  let analysisResult: any = null;
  if (latestFile?.analysisResult) {
    try {
      analysisResult = JSON.parse(latestFile.analysisResult);
    } catch {}
  }

  return (
    <Card className={`${hasCompletedFile ? config.borderColor : ""} transition-all`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${config.bgColor}`}>
              <Icon className={`h-5 w-5 ${config.color}`} />
            </div>
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                {config.label}
                <Badge variant="outline" className="text-[10px] font-normal">{config.module}</Badge>
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">{config.description}</CardDescription>
            </div>
          </div>
          {hasCompletedFile && (
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={config.accept}
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isAnalyzing}
            className="flex-1"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                {uploading ? "上传中..." : "AI分析中..."}
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5 mr-2" />
                {latestFile ? "重新上传" : `上传 ${config.expectedFile}`}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => {
              const a = document.createElement("a");
              a.href = config.templateUrl;
              a.download = config.templateFilename;
              a.target = "_blank";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            模板
          </Button>
        </div>

        {/* Import from Product Profile */}
        {fileType === "product_attributes" && (
          <ImportFromProfileButton projectId={projectId} />
        )}

        {latestFile && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground truncate max-w-[200px]">{latestFile.filename}</span>
                <span className="text-muted-foreground">
                  {latestFile.fileSize ? `${(latestFile.fileSize / 1024).toFixed(1)}KB` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusBadge status={latestFile.status} />
                {latestFile.status === "parsed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => reAnalyze.mutate({ fileId: latestFile.id })}
                    disabled={reAnalyze.isPending}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    分析
                  </Button>
                )}
                {latestFile.status === "failed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-red-600"
                    onClick={() => reAnalyze.mutate({ fileId: latestFile.id })}
                    disabled={reAnalyze.isPending}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    重试
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                  onClick={() => {
                    if (confirm("确定删除此文件？")) {
                      deleteFile.mutate({ fileId: latestFile.id });
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {shouldShowProjectFileError(latestFile.status, latestFile.errorMessage) && (
              <p className="text-xs text-red-500">{latestFile.errorMessage}</p>
            )}

            {analysisResult && (
              <AnalysisResultCard
                fileType={fileType}
                result={analysisResult}
                fileId={latestFile.id}
                projectId={projectId}
              />
            )}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            加载中...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── BuyerQuestionsCard ──────────────────────────────────────────
function BuyerQuestionsCard({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const xlsxRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editPriority, setEditPriority] = useState<"high" | "medium" | "low">("medium");

  const { data: readiness } = trpc.buyerQuestions.getReadiness.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const { data: questions, isLoading } = trpc.buyerQuestions.list.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const importFromXlsx = trpc.buyerQuestions.importFromXlsx.useMutation({
    onSuccess: (data: { inserted: number; skipped: number; total: number }) => {
      utils.buyerQuestions.list.invalidate({ projectId });
      utils.buyerQuestions.getReadiness.invalidate({ projectId });
      toast.success(`导入完成：${data.inserted} 条新增，${data.skipped} 条跳过（重复）`);
      setImporting(false);
    },
    onError: (err: any) => {
      toast.error("导入失败: " + err.message);
      setImporting(false);
    },
  });

  const updateQuestion = trpc.buyerQuestions.update.useMutation({
    onSuccess: () => {
      utils.buyerQuestions.list.invalidate({ projectId });
      setEditingId(null);
      toast.success("已更新");
    },
    onError: (err: any) => toast.error("更新失败: " + err.message),
  });

  const deleteQuestion = trpc.buyerQuestions.delete.useMutation({
    onSuccess: () => {
      utils.buyerQuestions.list.invalidate({ projectId });
      utils.buyerQuestions.getReadiness.invalidate({ projectId });
      toast.success("已删除");
    },
    onError: (err: any) => toast.error("删除失败: " + err.message),
  });

  const handleXlsxSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("文件大小不能超过10MB"); return; }
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rows.length === 0) { toast.error("文件为空或格式不正确"); setImporting(false); return; }
      const questions = rows
        .map((row: any) => {
          const q = String(row.question || row.Question || row.QUESTION || row["问题"] || "").trim();
          const qCn = String(row.question_cn || row.questionCn || row["中文翻译"] || "").trim();
          const cat = String(row.category || row.Category || row["分类"] || "").trim();
          const pri = String(row.priority || row.Priority || row["优先级"] || "medium").trim();
          return { question: q, questionCn: qCn || undefined, category: cat || undefined, priority: (["high","medium","low"].includes(pri) ? pri : "medium") as "high"|"medium"|"low" };
        })
        .filter((q: any) => q.question.length > 0);
      if (questions.length === 0) { toast.error("未找到有效问题，请确认列名包含 'question' 字段"); setImporting(false); return; }
      importFromXlsx.mutate({ projectId, questions });
    } catch (err: any) {
      toast.error("文件解析失败: " + (err?.message || "未知错误"));
      setImporting(false);
    }
    e.target.value = "";
  }, [projectId, importFromXlsx]);

  const priorityConfig: Record<string, { label: string; className: string }> = {
    high: { label: "高", className: "bg-red-100 text-red-700 border-red-200" },
    medium: { label: "中", className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    low: { label: "低", className: "bg-gray-100 text-gray-600 border-gray-200" },
  };

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-50"><HelpCircle className="h-5 w-5 text-amber-600" /></div>
            <div>
              <CardTitle className="text-base">买家问题库</CardTitle>
              <CardDescription className="text-xs mt-0.5">上传买家常见问题（xlsx），AI在生成QA时将优先覆盖这些问题</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {readiness?.hasQuestions ? (
              <Badge className="bg-green-600 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />{readiness.count} 条问题</Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300"><AlertTriangle className="h-3 w-3 mr-1" />未上传</Badge>
            )}
            <input ref={xlsxRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleXlsxSelect} />
            <Button size="sm" variant="outline" onClick={() => xlsxRef.current?.click()} disabled={importing} className="text-amber-700 border-amber-300 hover:bg-amber-50">
              {importing ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />导入中...</> : <><Upload className="h-4 w-4 mr-1" />上传问题库 (.xlsx)</>}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-md bg-amber-50 border border-amber-100 p-3 mb-4">
          <p className="text-xs text-amber-800 font-medium mb-1">📋 Excel 模板格式（支持 .xlsx / .xls / .csv）</p>
          <p className="text-xs text-amber-700">
            必填列：<code className="bg-amber-100 px-1 rounded">question</code>（问题原文）&nbsp;｜
            可选列：<code className="bg-amber-100 px-1 rounded">category</code>（分类）、<code className="bg-amber-100 px-1 rounded">priority</code>（high/medium/low）、<code className="bg-amber-100 px-1 rounded">question_cn</code>（中文翻译）
          </p>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !questions || (questions as any[]).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">暂无问题，请上传 Excel 文件导入</p>
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs w-8">#</TableHead>
                  <TableHead className="text-xs">问题</TableHead>
                  <TableHead className="text-xs w-24">分类</TableHead>
                  <TableHead className="text-xs w-16">优先级</TableHead>
                  <TableHead className="text-xs w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(questions as any[]).map((q: any, idx: number) => (
                  <TableRow key={q.id}>
                    <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                    <TableCell>
                      <p className="text-sm">{q.question}</p>
                      {q.questionCn && <p className="text-xs text-muted-foreground mt-0.5">{q.questionCn}</p>}
                    </TableCell>
                    <TableCell>
                      {editingId === q.id ? (
                        <Input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="h-7 text-xs w-20" placeholder="分类" />
                      ) : (
                        <span className="text-xs text-muted-foreground">{q.category || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === q.id ? (
                        <Select value={editPriority} onValueChange={(v) => setEditPriority(v as "high"|"medium"|"low")}>
                          <SelectTrigger className="h-7 text-xs w-16"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="high">高</SelectItem>
                            <SelectItem value="medium">中</SelectItem>
                            <SelectItem value="low">低</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className={`text-xs ${priorityConfig[q.priority]?.className || ""}`}>{priorityConfig[q.priority]?.label || q.priority}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === q.id ? (
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-green-600" onClick={() => updateQuestion.mutate({ id: q.id, category: editCategory || undefined, priority: editPriority })}><Save className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingId(null)}><X className="h-3 w-3" /></Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingId(q.id); setEditCategory(q.category || ""); setEditPriority(q.priority || "medium"); }}><Pencil className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteQuestion.mutate({ id: q.id })}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DataFilesPage() {
  const { selectedProjectId } = useProject();

  const { data: summary } = trpc.projectFile.getAnalysisSummary.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: bqReadiness } = trpc.buyerQuestions.getReadiness.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const n3Ready = !!(summary?.productAttributes);
  const bqReady = !!(bqReadiness?.hasQuestions);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据文件管理 (N3)</h1>
          <p className="text-muted-foreground mt-1">上传本品属性表（必须）和买家问题库，作为Listing生成的前置数据</p>
        </div>
        <ProjectSelector />
      </div>

      {!selectedProjectId ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">请先在项目管理中创建并选择一个项目</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* N3 就绪状态总览 */}
          <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-8 rounded-full transition-colors ${n3Ready ? "bg-green-500" : "bg-red-400"}`} />
                    <span className="text-sm font-medium text-indigo-900">产品属性表：{n3Ready ? "✓ 已就绪" : "待上传（必须）"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-8 rounded-full transition-colors ${bqReady ? "bg-green-500" : "bg-amber-300"}`} />
                    <span className="text-sm font-medium text-indigo-900">买家问题库：{bqReady ? `✓ ${bqReadiness?.count} 条` : "可选（提升QA质量）"}</span>
                  </div>
                </div>
                {n3Ready ? (
                  <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />G1 前置数据已就绪</Badge>
                ) : (
                  <Badge variant="outline" className="text-red-600 border-red-300"><AlertTriangle className="h-3 w-3 mr-1" />产品属性表必须上传才能开始Listing生成</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 产品属性表上传 */}
          <div className="grid grid-cols-1 gap-4">
            {FILE_TYPES.map((ft) => (
              <FileUploadCard key={ft} fileType={ft} projectId={selectedProjectId} />
            ))}
          </div>

          {/* 买家问题库上传 */}
          <BuyerQuestionsCard projectId={selectedProjectId} />
        </div>
      )}
    </div>
  );
}
