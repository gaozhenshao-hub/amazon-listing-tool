import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";

type FileType = "product_attributes" | "competitor_listings" | "search_term_report" | "aba_keywords";

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
  competitor_listings: {
    label: "竞品Listing文本",
    description: "多竞品格局分析 — 找共性(Parity)和找缺口(Gap)，发现差异化机会",
    accept: ".txt",
    icon: Layers,
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    module: "Module 2: Multi-Competitor",
    expectedFile: "竞品Listing文本.txt",
    templateUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310419663030562636/a79tkwusxJ5HWpLxCXSSXN/竞品Listing文本_模板_72027457.txt",
    templateFilename: "竞品Listing文本_模板.txt",
  },
  search_term_report: {
    label: "竞品出单词报告",
    description: "COSMO 场景映射 — 锁定用户最关心的真实使用场景和搜索意图",
    accept: ".csv",
    icon: Search,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    module: "Module 3: COSMO",
    expectedFile: "竞品出单词报告.csv",
    templateUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310419663030562636/a79tkwusxJ5HWpLxCXSSXN/竞品出单词报告_模板_cc5a632c.csv",
    templateFilename: "竞品出单词报告_模板.csv",
  },
  aba_keywords: {
    label: "ABA关键词数据",
    description: "A9 关键词分级 — 基于ABA数据锁定高权重核心词，分级放置",
    accept: ".csv",
    icon: BarChart3,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    module: "Module 4: A9",
    expectedFile: "ABA关键词数据.csv",
    templateUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310419663030562636/a79tkwusxJ5HWpLxCXSSXN/ABA关键词数据_模板_f863aedf.csv",
    templateFilename: "ABA关键词数据_模板.csv",
  },
};

const FILE_TYPES: FileType[] = ["product_attributes", "competitor_listings", "search_term_report", "aba_keywords"];

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

  // ─── View Mode Renderers ──────────────────────────────────────
  const renderViewContent = () => {
    switch (fileType) {
      case "product_attributes":
        return (
          <div className="space-y-3">
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

      case "competitor_listings":
        return (
          <div className="space-y-3">
            {data.parityPoints?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1">共性卖点 (Parity) — 必须包含</p>
                <div className="space-y-1">
                  {data.parityPoints.slice(0, 6).map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-xs shrink-0 border-green-300">{p.frequency}</Badge>
                      <span>{p.sellingPoint}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.gapOpportunities?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1">缺口机会 (Gap) — 差异化</p>
                <div className="space-y-1">
                  {data.gapOpportunities.slice(0, 5).map((g: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className={`text-xs shrink-0 ${
                        g.opportunityLevel === "high" ? "border-red-300 text-red-600" :
                        g.opportunityLevel === "medium" ? "border-amber-300 text-amber-600" :
                        "border-gray-300"
                      }`}>{g.opportunityLevel}</Badge>
                      <span>{g.gap}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.strategicRecommendations && (
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1">策略建议</p>
                {data.strategicRecommendations.mustInclude?.length > 0 && (
                  <div className="mb-1">
                    <span className="text-xs text-muted-foreground">必须包含: </span>
                    <span className="text-xs">{data.strategicRecommendations.mustInclude.join("; ")}</span>
                  </div>
                )}
                {data.strategicRecommendations.differentiators?.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground">差异化: </span>
                    <span className="text-xs">{data.strategicRecommendations.differentiators.join("; ")}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case "search_term_report":
        return (
          <div className="space-y-3">
            {data.scenesClusters?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-purple-700 mb-1">使用场景聚类</p>
                <div className="space-y-1.5">
                  {data.scenesClusters.slice(0, 6).map((sc: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge variant="outline" className={`text-xs shrink-0 ${
                        sc.priority === "high" ? "border-purple-400 text-purple-700" :
                        "border-purple-200 text-purple-500"
                      }`}>{sc.priority}</Badge>
                      <div>
                        <span className="font-medium">{sc.sceneName}</span>
                        {sc.sceneNameCn && <span className="text-muted-foreground ml-1">({sc.sceneNameCn})</span>}
                        {sc.buyerIntent && <p className="text-muted-foreground mt-0.5">{sc.buyerIntent}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.topScenesByVolume?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-purple-700 mb-1">搜索量TOP场景</p>
                <div className="flex flex-wrap gap-1">
                  {data.topScenesByVolume.slice(0, 6).map((s: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case "aba_keywords":
        return (
          <div className="space-y-3">
            {data.titleMustHaveKeywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">标题必含关键词 (Tier 1)</p>
                <div className="flex flex-wrap gap-1">
                  {data.titleMustHaveKeywords.map((k: string, i: number) => (
                    <Badge key={i} className="text-xs bg-amber-600">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
            {data.bulletPriorityKeywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">五点优先关键词 (Tier 2)</p>
                <div className="flex flex-wrap gap-1">
                  {data.bulletPriorityKeywords.slice(0, 8).map((k: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs border-amber-300 text-amber-700">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
            {data.goldenKeywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">黄金关键词 (高搜索+低竞争)</p>
                <div className="flex flex-wrap gap-1">
                  {data.goldenKeywords.slice(0, 6).map((k: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs bg-yellow-100 text-yellow-800">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
            {data.backendKeywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">后台搜索词</p>
                <div className="flex flex-wrap gap-1">
                  {data.backendKeywords.slice(0, 8).map((k: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs border-gray-300">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
            {data.keywordStrategy && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">关键词策略</p>
                <p className="text-xs text-muted-foreground">{data.keywordStrategy}</p>
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

    switch (fileType) {
      case "product_attributes":
        return (
          <div className="space-y-4">
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

      case "competitor_listings":
        return (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1.5">共性卖点 (Parity)</p>
              <EditableParityList
                items={editData.parityPoints || []}
                onChange={(items) => setEditData({ ...editData, parityPoints: items })}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1.5">缺口机会 (Gap)</p>
              <EditableGapList
                items={editData.gapOpportunities || []}
                onChange={(items) => setEditData({ ...editData, gapOpportunities: items })}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1.5">策略建议 — 必须包含</p>
              <EditableTagList
                items={editData.strategicRecommendations?.mustInclude || []}
                onChange={(items) => setEditData({
                  ...editData,
                  strategicRecommendations: { ...editData.strategicRecommendations, mustInclude: items },
                })}
                colorClass="border-green-300 text-green-700"
                placeholder="输入必含要素后按回车"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1.5">策略建议 — 差异化</p>
              <EditableTagList
                items={editData.strategicRecommendations?.differentiators || []}
                onChange={(items) => setEditData({
                  ...editData,
                  strategicRecommendations: { ...editData.strategicRecommendations, differentiators: items },
                })}
                colorClass="border-green-300 text-green-700"
                placeholder="输入差异化要素后按回车"
              />
            </div>
          </div>
        );

      case "search_term_report":
        return (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-purple-700 mb-1.5">使用场景聚类</p>
              <EditableSceneList
                items={(editData.scenesClusters || []).map((sc: any) => ({
                  sceneName: sc.sceneName || "",
                  sceneNameCn: sc.sceneNameCn || "",
                  priority: sc.priority || "medium",
                  buyerIntent: sc.buyerIntent || "",
                }))}
                onChange={(items) => {
                  // Merge back with existing cluster data to preserve other fields
                  const updated = items.map((item, i) => ({
                    ...(editData.scenesClusters?.[i] || {}),
                    ...item,
                  }));
                  setEditData({ ...editData, scenesClusters: updated });
                }}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-purple-700 mb-1.5">搜索量TOP场景</p>
              <EditableTagList
                items={editData.topScenesByVolume || []}
                onChange={(items) => setEditData({ ...editData, topScenesByVolume: items })}
                colorClass="border-purple-300 text-purple-700"
                placeholder="输入场景名后按回车"
              />
            </div>
          </div>
        );

      case "aba_keywords":
        return (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1.5">标题必含关键词 (Tier 1)</p>
              <EditableTagList
                items={editData.titleMustHaveKeywords || []}
                onChange={(items) => setEditData({ ...editData, titleMustHaveKeywords: items })}
                colorClass="border-amber-400 text-amber-800"
                badgeClass="bg-amber-50"
                placeholder="输入关键词后按回车"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1.5">五点优先关键词 (Tier 2)</p>
              <EditableTagList
                items={editData.bulletPriorityKeywords || []}
                onChange={(items) => setEditData({ ...editData, bulletPriorityKeywords: items })}
                colorClass="border-amber-300 text-amber-700"
                placeholder="输入关键词后按回车"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1.5">黄金关键词 (高搜索+低竞争)</p>
              <EditableTagList
                items={editData.goldenKeywords || []}
                onChange={(items) => setEditData({ ...editData, goldenKeywords: items })}
                colorClass="border-yellow-400 text-yellow-800"
                badgeClass="bg-yellow-50"
                placeholder="输入关键词后按回车"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1.5">后台搜索词</p>
              <EditableTagList
                items={editData.backendKeywords || []}
                onChange={(items) => setEditData({ ...editData, backendKeywords: items })}
                colorClass="border-gray-300"
                placeholder="输入搜索词后按回车"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1.5">关键词策略</p>
              <Textarea
                value={editData.keywordStrategy || ""}
                onChange={(e) => setEditData({ ...editData, keywordStrategy: e.target.value })}
                placeholder="描述关键词策略..."
                className="text-xs min-h-[60px]"
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

            {latestFile.errorMessage && (
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

export default function DataFilesPage() {
  const { selectedProjectId } = useProject();

  const { data: project } = trpc.project.getById.useQuery(
    { id: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: summary } = trpc.projectFile.getAnalysisSummary.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const completedModules = [
    summary?.productAttributes ? 1 : 0,
    summary?.competitorListings ? 1 : 0,
    summary?.cosmoScenes ? 1 : 0,
    summary?.a9Keywords ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据文件管理</h1>
          <p className="text-muted-foreground mt-1">
            上传产品属性表、竞品Listing、出单词报告和ABA关键词数据，AI自动分析并整合到Listing生成
          </p>
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
          <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {FILE_TYPES.map((ft) => {
                      const done = ft === "product_attributes" ? !!summary?.productAttributes :
                                   ft === "competitor_listings" ? !!summary?.competitorListings :
                                   ft === "search_term_report" ? !!summary?.cosmoScenes :
                                   !!summary?.a9Keywords;
                      return (
                        <div
                          key={ft}
                          className={`h-2.5 w-8 rounded-full transition-colors ${
                            done ? "bg-green-500" : "bg-gray-200"
                          }`}
                        />
                      );
                    })}
                  </div>
                  <span className="text-sm font-medium text-indigo-900">
                    {completedModules}/4 模块已完成
                  </span>
                </div>
                {summary?.hasAllFiles && (
                  <Badge className="bg-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    全部就绪
                  </Badge>
                )}
              </div>
              <p className="text-xs text-indigo-700 mt-2">
                {summary?.hasAllFiles
                  ? "所有四大分析模块数据已就绪，生成Listing时将自动整合这些分析结果。点击「编辑」可手动修正分析内容。"
                  : "上传并分析文件后，生成Listing时将自动整合已完成的分析模块数据。分析完成后可手动编辑修正。"}
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {FILE_TYPES.map((ft) => (
              <FileUploadCard key={ft} fileType={ft} projectId={selectedProjectId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
