import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import { WorkflowShell } from "@/components/workflow";
import { IMAGE_SUGGESTION_WORKFLOW_STEPS } from "@/components/workflow/workflowDefinitions";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Image,
  Loader2,
  Sparkles,
  Target,
  Layout,
  Palette,
  Eye,
  FileText,
  RotateCcw,
  Plus,
  Trash2,
  GripVertical,
  Download,
  Languages,
  Paintbrush,
  Camera,
  BarChart3,
  Layers,
  Lightbulb,
  Smartphone,
  TypeIcon,
  Copy,
  Search,
  ImageIcon,
  BookOpen,
  X,
  Filter,
  Wand2,
  Pencil,
  Send,
  Lock,
  Unlock,
  Upload,
  Zap,
  Grid3X3,
  LayoutGrid,
  RefreshCw,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { StepProgressBar } from "./imageWorkflow/StepProgressBar";
import { Step0CompetitorAnalysis } from "./imageWorkflow/CompetitorAnalysisStep";
import { Step1SellingPoints } from "./imageWorkflow/SellingPointsStep";
import { Step2ImageOutline } from "./imageWorkflow/ImageOutlineStep";
import { Step3StyleConfirm } from "./imageWorkflow/StyleConfirmationStep";
import { Step4References } from "./imageWorkflow/ReferenceImagesStep";
import { OUTLINE_APLUS_CATEGORIES, OUTLINE_APLUS_MODULES, findOutlineAplusModule, normalizeAplusModuleStyle } from "./imageWorkflow/aplusModules";
import { buildFullPlanContent, buildPdfContent, safeJsonParse } from "./imageWorkflow/exportContent";
import { normalizeSecondaryImageSlots } from "@shared/imageWorkflow";

// ═══════════════════════════════════════════════════════════════════
// ─── Step Progress Bar ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// ─── Step 0: Competitor Image Analysis ───────────────────────────
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// ─── Step 2: Image Outline ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
function ColorSwatch({ color, label }: { color: any; label: string }) {
  const colorStr = typeof color === 'object' && color !== null ? JSON.stringify(color) : String(color || '');
  const hex = colorStr?.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || "#ccc";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-4 h-4 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: hex }} />
      <span className="text-xs">{label}: {colorStr}</span>
    </div>
  );
}

function normalizeFinalImageSuggestions(data: any) {
  if (!data) return data;
  return {
    ...data,
    secondaryImages: normalizeSecondaryImageSlots(
      data.secondaryImages,
      (imageNumber) => ({
        imageNumber,
        title: `辅图${imageNumber}`,
        focus: "待补充",
        fabe: { feature: "", advantage: "", benefit: "", evidence: "" },
        expressionMethod: "",
        composition: "",
        colorScheme: { primary: "", secondary: "", accent: "" },
        textOverlay: "",
        dataVisualization: "",
        icons: [],
        keyElements: [],
        tips: [],
      }),
    ),
  };
}

function FABEDisplay({ fabe, variant = "en" }: { fabe: any; variant?: "en" | "cn" }) {
  if (!fabe) return null;
  const isEn = variant === "en";
  const textColor = isEn ? "text-blue-600" : "text-orange-600";
  const bgColor = isEn ? "bg-blue-50" : "bg-orange-50";
  const borderColor = isEn ? "border-blue-200" : "border-orange-200";
  const items = [
    { key: "feature", label: "F - 特征" },
    { key: "advantage", label: "A - 优势" },
    { key: "benefit", label: "B - 利益" },
    { key: "evidence", label: "E - 证据" },
  ];
  return (
    <div className={`${bgColor} ${borderColor} border rounded-lg p-2 space-y-1`}>
      <p className={`text-xs font-medium ${textColor}`}>FABE分析</p>
      {items.map(({ key, label }) => (
        fabe[key] ? (
          <div key={key} className="flex gap-1 text-xs">
            <span className={`font-medium ${textColor} shrink-0`}>{label}:</span>
            <span className="text-muted-foreground">{typeof fabe[key] === 'object' ? JSON.stringify(fabe[key]) : fabe[key]}</span>
          </div>
        ) : null
      ))}
    </div>
  );
}

// ─── Lockable field definitions per image type ─────────────────────────
const LOCKABLE_FIELDS: Record<string, { key: string; label: string; icon: string }[]> = {
  mainImage: [
    { key: "title", label: "标题", icon: "T" },
    { key: "concept", label: "概念", icon: "C" },
    { key: "colorScheme", label: "配色方案", icon: "🎨" },
    { key: "composition", label: "构图方式", icon: "📐" },
    { key: "shootingNotes", label: "拍摄提示", icon: "📷" },
    { key: "keyElements", label: "关键元素", icon: "⭐" },
    { key: "sellingPoints", label: "卖点", icon: "💡" },
  ],
  secondaryImage: [
    { key: "title", label: "标题", icon: "T" },
    { key: "fabe", label: "FABE分析", icon: "F" },
    { key: "expressionMethod", label: "表达方式", icon: "📝" },
    { key: "colorScheme", label: "配色方案", icon: "🎨" },
    { key: "composition", label: "构图", icon: "📐" },
    { key: "dataVisualization", label: "数据可视化", icon: "📊" },
    { key: "icons", label: "图标建议", icon: "🔣" },
    { key: "keyElements", label: "关键元素", icon: "⭐" },
    { key: "sellingPoints", label: "卖点", icon: "💡" },
    { key: "copywriting", label: "文案", icon: "✏️" },
  ],
  aPlusSection: [
    { key: "title", label: "标题", icon: "T" },
    { key: "fabe", label: "FABE分析", icon: "F" },
    { key: "expressionMethod", label: "表达方式", icon: "📝" },
    { key: "colorScheme", label: "配色方案", icon: "🎨" },
    { key: "composition", label: "构图", icon: "📐" },
    { key: "dataVisualization", label: "数据可视化", icon: "📊" },
    { key: "icons", label: "图标建议", icon: "🔣" },
    { key: "content", label: "内容描述", icon: "📄" },
    { key: "copywriting", label: "文案", icon: "✏️" },
  ],
};

// ─── Refine Popover Component ──────────────────────────────────────────
// Inline popover for refining a single image suggestion with lock feature
function RefinePopover({
  projectId,
  imageType,
  imageIndex,
  currentEnContent,
  currentCnContent,
  onRefineComplete,
  disabled,
}: {
  projectId: number;
  imageType: "mainImage" | "secondaryImage" | "aPlusSection";
  imageIndex?: number;
  currentEnContent: any;
  currentCnContent: any;
  onRefineComplete: (en: any, cn: any) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
  const [showLockPanel, setShowLockPanel] = useState(false);
  const refineMutation = trpc.imageWorkflow.refineSingleImage.useMutation();

  // Get lockable fields for this image type
  const lockableFields = useMemo(() => {
    const fields = LOCKABLE_FIELDS[imageType] || [];
    // Filter to only show fields that exist in current content
    if (!currentEnContent) return fields;
    return fields.filter((f) => {
      const val = currentEnContent[f.key];
      return val !== undefined && val !== null && val !== "";
    });
  }, [imageType, currentEnContent]);

  const toggleLock = (fieldKey: string) => {
    setLockedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const lockAll = () => {
    setLockedFields(new Set(lockableFields.map((f) => f.key)));
  };

  const unlockAll = () => {
    setLockedFields(new Set());
  };

  const quickActions = [
    { label: "标题更简短", instruction: "请把标题改得更简短有力，更有吸引力" },
    { label: "换一种构图", instruction: "请推荐一种不同的构图方式，让画面更有冲击力" },
    { label: "强化卖点表达", instruction: "请强化卖点的表达，让卖点更突出更有说服力" },
    { label: "优化文案", instruction: "请优化图片上的文案内容，让文字更精炼更有营销力" },
    { label: "调整配色", instruction: "请推荐一套更合适的配色方案，提升视觉效果" },
    { label: "增加数据可视化", instruction: "请增加数据可视化元素（图表、图标、数据对比等）让信息更直观" },
  ];

  const handleRefine = async (instr: string) => {
    if (!instr.trim()) return;
    try {
      const result = await refineMutation.mutateAsync({
        projectId,
        imageType,
        imageIndex,
        currentContent: JSON.stringify({ en: currentEnContent, cn: currentCnContent }),
        instruction: instr,
        lockedFields: lockedFields.size > 0 ? Array.from(lockedFields) : undefined,
      });
      onRefineComplete(result.en, result.cn);
      setInstruction("");
      setOpen(false);
      toast.success("微调完成" + (lockedFields.size > 0 ? `（已锁定${lockedFields.size}个元素）` : ""));
    } catch (err: any) {
      toast.error(err.message || "微调失败");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
          disabled={disabled}
        >
          <Wand2 className="w-3 h-3 mr-1" /> 微调
          {lockedFields.size > 0 && (
            <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {lockedFields.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="space-y-0">
          {/* Header with lock toggle */}
          <div className="flex items-center justify-between p-3 pb-2">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">AI 微调这张图</span>
            </div>
            <Button
              variant={showLockPanel ? "secondary" : "ghost"}
              size="sm"
              className={`h-7 px-2 text-xs ${lockedFields.size > 0 ? "text-amber-600" : "text-muted-foreground"}`}
              onClick={() => setShowLockPanel(!showLockPanel)}
            >
              {lockedFields.size > 0 ? <Lock className="w-3 h-3 mr-1" /> : <Unlock className="w-3 h-3 mr-1" />}
              {lockedFields.size > 0 ? `已锁定 ${lockedFields.size}` : "锁定元素"}
            </Button>
          </div>

          {/* Lock panel - collapsible */}
          {showLockPanel && (
            <div className="mx-3 mb-2 p-2.5 rounded-lg border border-amber-200 bg-amber-50/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-amber-800 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> 锁定元素（微调时保持不变）
                </p>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-amber-700" onClick={lockAll}>
                    全锁
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-amber-700" onClick={unlockAll}>
                    全解
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {lockableFields.map((field) => {
                  const isLocked = lockedFields.has(field.key);
                  return (
                    <button
                      key={field.key}
                      onClick={() => toggleLock(field.key)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-all border ${
                        isLocked
                          ? "bg-amber-100 border-amber-300 text-amber-800 shadow-sm"
                          : "bg-white border-gray-200 text-gray-500 hover:border-amber-200 hover:bg-amber-50"
                      }`}
                    >
                      <span className="text-[10px]">{field.icon}</span>
                      <span>{field.label}</span>
                      {isLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5 opacity-40" />}
                    </button>
                  );
                })}
              </div>
              {lockableFields.length === 0 && (
                <p className="text-xs text-amber-600/70 text-center py-1">当前图片无可锁定字段</p>
              )}
            </div>
          )}

          <div className="px-3 pb-3 space-y-3">
            {/* Quick action buttons */}
            <div className="flex flex-wrap gap-1.5">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={refineMutation.isPending}
                  onClick={() => handleRefine(action.instruction)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
            <Separator />
            {/* Custom instruction */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">或输入自定义修改指令：</p>
              <div className="flex gap-1.5">
                <Input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="例如：把标题改为XXX..."
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleRefine(instruction);
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 px-2"
                  disabled={!instruction.trim() || refineMutation.isPending}
                  onClick={() => handleRefine(instruction)}
                >
                  {refineMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </Button>
              </div>
            </div>
            {refineMutation.isPending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                AI正在微调中...
                {lockedFields.size > 0 && <span className="text-amber-600">（{lockedFields.size}个元素已锁定）</span>}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── DesignerUploadPanel: right-side artwork upload panel ────────────────────
function DesignerUploadPanel({
  imageNumber,
  label,
  uploadedUrl,
  isUploading,
  onUpload,
  onRemove,
}: {
  imageNumber: string;
  label: string;
  uploadedUrl?: string;
  isUploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 min-h-[120px]">
      <div className="flex items-center gap-2 mb-1">
        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
          <Upload className="w-3 h-3 mr-1" /> 美工成品
        </Badge>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      {uploadedUrl ? (
        <div className="relative group rounded-lg overflow-hidden border border-emerald-200 bg-emerald-50/30">
          <img
            src={uploadedUrl}
            alt={label}
            className="w-full object-contain max-h-64 rounded-lg"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <a href={uploadedUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="secondary" className="h-7 text-xs">
                <Eye className="w-3 h-3 mr-1" /> 查看
              </Button>
            </a>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={onRemove}
            >
              <Trash2 className="w-3 h-3 mr-1" /> 删除
            </Button>
          </div>
        </div>
      ) : (
        <label className={`flex flex-col items-center justify-center min-h-[120px] rounded-lg border-2 border-dashed border-emerald-300 cursor-pointer hover:bg-emerald-50/50 transition-colors ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
          {isUploading ? (
            <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
          ) : (
            <>
              <Upload className="w-6 h-6 text-emerald-400 mb-1" />
              <span className="text-xs text-emerald-600 font-medium">上传成品图片</span>
              <span className="text-xs text-muted-foreground mt-0.5">JPG / PNG / WEBP</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
            disabled={isUploading}
          />
        </label>
      )}
    </div>
  );
}

function Step5FinalSuggestions({
  projectId,
  session,
  onConfirm,
}: {
  projectId: number;
  session: any;
  onConfirm: () => void;
}) {
  const generateMutation = trpc.imageWorkflow.startStep5Generation.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep5.useMutation();
  const unlockMutation = trpc.imageWorkflow.unlockStep5.useMutation();
  const utils = trpc.useUtils();
  const [enData, setEnData] = useState<any>(null);
  const [cnData, setCnData] = useState<any>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(!!session?.step5Confirmed);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const handledRunIdsRef = useRef<Set<string>>(new Set());
  // Per-section module style state: { [sectionIndex]: moduleTypeId }
  const [sectionModuleStyles, setSectionModuleStyles] = useState<Record<number, string>>({});
  const [optimizingSectionIdx, setOptimizingSectionIdx] = useState<number | null>(null);
  const singleModuleOptimizeMutation = trpc.imageWorkflow.optimizeSingleAplusModule.useMutation();
  const sessionRunStatus = session?.step5RunStatus || "idle";
  const sessionActiveRunId = session?.step5RunId || null;
  const isRunActive = (status?: string | null) => status === "queued" || status === "running";
  const hasActiveRun = isRunActive(sessionRunStatus) || !!activeRunId;
  const step5RunQuery = trpc.imageWorkflow.getStep5Run.useQuery(
    { projectId, runId: activeRunId || sessionActiveRunId || undefined },
    {
      enabled: hasActiveRun,
      refetchInterval: (query) => {
        const data = query.state.data as any;
        const status = data?.status || sessionRunStatus;
        return isRunActive(status) ? 2000 : false;
      },
    }
  );
  const runStatus = step5RunQuery.data?.status || sessionRunStatus;
  const runProgress = Number(step5RunQuery.data?.progress ?? session?.step5RunProgress ?? 0);
  const isGenerating = generateMutation.isPending || isRunActive(runStatus);

  // Amazon Premium A+ Module Types - comprehensive list matching backend prompt
  const APLUS_MODULES = [
    { id: 'premium_full_image', name: '高级完整图片', desc: '全屏背景+文字覆盖, 1464x600px', category: '全屏展示', specs: '标题800字符, 正文300字符' },
    { id: 'premium_text', name: '高级文本', desc: '纯文本模块', category: '文本', specs: '标题80字符, 正文300字符' },
    { id: 'premium_bg_image_text', name: '高级背景图像+文本', desc: '背景图+叠加文字, 1464x600px', category: '全屏展示', specs: '标题60字符, 副标题40字符, 正文300字符' },
    { id: 'premium_four_image_text', name: '高级四图片+文本', desc: '4张小图+文字, 300x225px', category: '图文组合', specs: '标题30字符, 正文150字符' },
    { id: 'premium_dual_image_text', name: '高级双图片+文本', desc: '左右双图, 650x350px', category: '图文组合', specs: '标题50字符, 副标题50字符, 正文300字符' },
    { id: 'premium_single_image_text', name: '高级单图+文本', desc: '大图+长文, 800x600px', category: '图文组合', specs: '标题80字符, 副标题40字符, 正文500字符' },
    { id: 'premium_full_video', name: '高级全视频', desc: '视频≤200MB,≤180秒, 960x540px', category: '多媒体', specs: '标题80字符, 正文300字符' },
    { id: 'premium_video_text', name: '高级视频+文本', desc: '视频+文字, 800x600px', category: '多媒体', specs: '标题80字符, 副标题40字符, 正文500字符' },
    { id: 'premium_comparison_1', name: '高级比较表1', desc: '4-7产品, 5-12特征, 200x225px', category: '对比展示', specs: '图片200x225px' },
    { id: 'premium_comparison_2', name: '高级比较表2', desc: '2-3产品, 2-5特征, 300x225px', category: '对比展示', specs: '图片300x225px' },
    { id: 'premium_comparison_3', name: '高级比较表3', desc: '2-4产品, 3-7特征, 488x700px', category: '对比展示', specs: '图片488x700px' },
    { id: 'premium_hotspot_1', name: '高级热点1', desc: '2-6个可点击热点, 1464x600px', category: '交互展示', specs: '标题50字符, 正文200字符' },
    { id: 'premium_hotspot_2', name: '高级热点2', desc: '2-6个热点, 1464x600px', category: '交互展示', specs: '模块标题80字符' },
    { id: 'premium_nav_carousel', name: '高级导航轮播', desc: '2-5个面板, 1464x600px', category: '轮播展示', specs: '导航文本25字符' },
    { id: 'premium_rule_carousel', name: '高级规则轮播', desc: '2-5个面板, 1464x600px', category: '轮播展示', specs: '模块标题100字符' },
    { id: 'premium_simple_carousel', name: '高级简单图像轮播', desc: '2-6个面板, 1464x600px', category: '轮播展示', specs: '标题50字符' },
    { id: 'premium_video_carousel', name: '高级视频图像轮播', desc: '2-6个面板, 800x600px', category: '轮播展示', specs: '标题80字符' },
    { id: 'premium_qa', name: '高级问答', desc: '2-5个问答, 1464x600px', category: '信息展示', specs: '问题120字符, 回答250字符' },
    { id: 'premium_tech_specs', name: '高级技术规格', desc: '3-15个规格, 300x300px', category: '信息展示', specs: '标题80字符' },
    { id: 'brand_highlight', name: '品牌亮点', desc: '3-4个亮点, 135x135px', category: '品牌建设', specs: '标题30字符, 正文80字符' },
    { id: 'standard_image_text', name: '标准图文', desc: '标准A+基础模块, 970x300px', category: '标准A+', specs: '标题160字符, 正文6000字符' },
    { id: 'standard_comparison', name: '标准对比表', desc: '最多5个产品, 150x150px', category: '标准A+', specs: '标题80字符, 正文250字符' },
    { id: 'standard_four_image', name: '标准四图', desc: '4张图+文字, 220x220px', category: '标准A+', specs: '标题60字符, 正文160字符' },
    { id: 'standard_single_image', name: '标准单图', desc: '全宽单图, 970x600px', category: '标准A+', specs: '标题160字符, 正文6000字符' },
  ];

  const MODULE_CATEGORIES = Array.from(new Set(APLUS_MODULES.map(m => m.category)));
  const outlineAplusModules = useMemo(() => {
    const outline = safeJsonParse(session?.step2UserEdit || session?.step2AiResult);
    return Array.isArray(outline?.aPlusModules) ? outline.aPlusModules : [];
  }, [session?.step2AiResult, session?.step2UserEdit]);

  useEffect(() => {
    const nextStyles: Record<number, string> = {};
    outlineAplusModules.forEach((mod: any, idx: number) => {
      const selected = findOutlineAplusModule(mod.selectedModuleType || mod.recommendedModuleType || mod.selectedModuleName);
      if (selected) nextStyles[idx] = selected.id;
    });
    setSectionModuleStyles(nextStyles);
  }, [outlineAplusModules]);

  const applySectionModuleStyles = (data: any) => {
    if (!data?.aPlusContent?.sections) return data;
    const sections = data.aPlusContent.sections.map((section: any, idx: number) => {
      const outlineModule = outlineAplusModules[idx];
      const styleId = sectionModuleStyles[idx] || section.selectedModuleType || outlineModule?.selectedModuleType;
      const selected = findOutlineAplusModule(styleId || outlineModule?.selectedModuleName);
      return selected ? {
        ...section,
        selectedModuleType: selected.id,
        selectedModuleName: selected.name,
        selectedModuleCategory: selected.category,
        selectedModuleSpecs: selected.specs,
        selectedModuleStructure: selected.structure,
      } : section;
    });
    return { ...data, aPlusContent: { ...data.aPlusContent, sections } };
  };

  // Handle per-section module style optimize
  const handleSingleModuleOptimize = async (sectionIdx: number) => {
    const moduleId = sectionModuleStyles[sectionIdx];
    if (!moduleId) {
      toast.error("请先选择一个A+模块样式");
      return;
    }
    const mod = APLUS_MODULES.find(m => m.id === moduleId);
    if (!mod) return;
    setOptimizingSectionIdx(sectionIdx);
    try {
      const result = await singleModuleOptimizeMutation.mutateAsync({
        projectId,
        sectionIndex: sectionIdx,
        moduleType: moduleId,
        moduleName: mod.name,
      });
      // Update only this section in enData and cnData
      if (result.en) {
        setEnData((prev: any) => {
          const sections = [...(prev.aPlusContent?.sections || [])];
          const normalizedModule = findOutlineAplusModule(moduleId);
          sections[sectionIdx] = {
            ...sections[sectionIdx],
            ...result.en,
            selectedModuleType: moduleId,
            selectedModuleName: mod.name,
            selectedModuleCategory: normalizedModule?.category,
            selectedModuleSpecs: normalizedModule?.specs,
            selectedModuleStructure: normalizedModule?.structure,
          };
          return { ...prev, aPlusContent: { ...prev.aPlusContent, sections } };
        });
      }
      if (result.cn) {
        setCnData((prev: any) => {
          if (!prev) return prev;
          const sections = [...(prev.aPlusContent?.sections || [])];
          sections[sectionIdx] = { ...sections[sectionIdx], ...result.cn };
          return { ...prev, aPlusContent: { ...prev.aPlusContent, sections } };
        });
      }
      await utils.imageWorkflow.getSession.invalidate({ projectId });
      toast.success(`A+模块 ${sectionIdx + 1} 已根据「${mod.name}」样式重新优化`);
    } catch (err: any) {
      toast.error(err.message || "优化失败");
    } finally {
      setOptimizingSectionIdx(null);
    }
  };

  useEffect(() => {
    setIsLocked(!!session?.step5Confirmed);
  }, [session?.step5Confirmed]);

  useEffect(() => {
    if (sessionActiveRunId && isRunActive(sessionRunStatus)) {
      setActiveRunId(sessionActiveRunId);
    }
  }, [sessionActiveRunId, sessionRunStatus]);

  useEffect(() => {
    const run = step5RunQuery.data as any;
    if (!run?.runId || handledRunIdsRef.current.has(`${run.runId}:${run.status}`)) return;
    if (run.status === "succeeded") {
      handledRunIdsRef.current.add(`${run.runId}:${run.status}`);
      if (run.en) setEnData(normalizeFinalImageSuggestions(run.en));
      if (run.cn) setCnData(normalizeFinalImageSuggestions(run.cn));
      setActiveRunId(null);
      utils.imageWorkflow.getSession.invalidate({ projectId });
      toast.success("图片建议生成完成");
    } else if (run.status === "failed") {
      handledRunIdsRef.current.add(`${run.runId}:${run.status}`);
      setActiveRunId(null);
      utils.imageWorkflow.getSession.invalidate({ projectId });
      toast.error(run.error || "生成失败");
    }
  }, [projectId, step5RunQuery.data, utils.imageWorkflow.getSession]);

  const handleUnlock = async () => {
    try {
      await unlockMutation.mutateAsync({ projectId });
      await utils.imageWorkflow.getSession.invalidate({ projectId });
      setIsLocked(false);
      toast.success("已解锁Step 5，可重新编辑");
    } catch (err: any) {
      toast.error(err.message || "解锁失败");
    }
  };

  useEffect(() => {
    const savedStep5Result = session?.step5UserEdit || session?.step5OptimizedResult || session?.step5AiResult;
    if (savedStep5Result) {
      try { setEnData(normalizeFinalImageSuggestions(JSON.parse(savedStep5Result))); } catch {}
    }
    const savedStep5CnResult = session?.step5AiResultCn || session?.step5OptimizedResultCn;
    if (savedStep5CnResult) {
      try { setCnData(normalizeFinalImageSuggestions(JSON.parse(savedStep5CnResult))); } catch { setCnData(null); }
    } else {
      setCnData(null);
    }
  }, [
    session?.step5AiResult,
    session?.step5UserEdit,
    session?.step5OptimizedResult,
    session?.step5AiResultCn,
    session?.step5OptimizedResultCn,
  ]);

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ projectId });
      if (result.runId) setActiveRunId(result.runId);
      if (result.status === "succeeded") {
        setEnData(normalizeFinalImageSuggestions(result.en));
        setCnData(normalizeFinalImageSuggestions(result.cn));
      }
      await utils.imageWorkflow.getSession.invalidate({ projectId });
      if (result.status === "succeeded") {
        toast.success("图片建议生成完成");
      } else {
        toast.info("已开始后台生成，可以切换页面，回来后会自动恢复");
      }
    } catch (err: any) {
      toast.error(err.message || "生成失败");
    }
  };

  const handleConfirm = async () => {
    if (isGenerating) return;
    if (!enData) return;
    try {
      const finalData = applySectionModuleStyles(enData);
      setEnData(finalData);
      await confirmMutation.mutateAsync({ projectId, userEdit: JSON.stringify(finalData) });
      await utils.imageWorkflow.getSession.invalidate({ projectId });
      toast.success("图片建议已确认");
      onConfirm();
    } catch (err: any) {
      toast.error(err.message || "确认失败");
    }
  };

  // Refine handlers - update specific image data
  const handleRefineMainImage = (en: any, cn: any) => {
    setEnData((prev: any) => ({ ...prev, mainImage: en }));
    setCnData((prev: any) => prev ? ({ ...prev, mainImage: cn }) : prev);
  };

  const handleRefineSecondaryImage = (idx: number) => (en: any, cn: any) => {
    setEnData((prev: any) => {
      const imgs = [...(prev.secondaryImages || [])];
      imgs[idx] = en;
      return { ...prev, secondaryImages: imgs };
    });
    setCnData((prev: any) => {
      if (!prev) return prev;
      const imgs = [...(prev.secondaryImages || [])];
      imgs[idx] = cn;
      return { ...prev, secondaryImages: imgs };
    });
  };

  const handleRefineAplusSection = (idx: number) => (en: any, cn: any) => {
    setEnData((prev: any) => {
      const sections = [...(prev.aPlusContent?.sections || [])];
      sections[idx] = en;
      return { ...prev, aPlusContent: { ...prev.aPlusContent, sections } };
    });
    setCnData((prev: any) => {
      if (!prev) return prev;
      const sections = [...(prev.aPlusContent?.sections || [])];
      sections[idx] = cn;
      return { ...prev, aPlusContent: { ...prev.aPlusContent, sections } };
    });
  };

  // A+ drag and drop
  const handleDragStart = (idx: number) => setDraggedIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    const sections = [...(enData?.aPlusContent?.sections || [])];
    const [moved] = sections.splice(draggedIdx, 1);
    sections.splice(idx, 0, moved);
    setEnData({ ...enData, aPlusContent: { ...enData.aPlusContent, sections } });
    if (cnData?.aPlusContent?.sections) {
      const cnSections = [...cnData.aPlusContent.sections];
      const [cnMoved] = cnSections.splice(draggedIdx, 1);
      cnSections.splice(idx, 0, cnMoved);
      setCnData({ ...cnData, aPlusContent: { ...cnData.aPlusContent, sections: cnSections } });
    }
    setDraggedIdx(idx);
  };
  const handleDragEnd = () => setDraggedIdx(null);

  // HTML export
  const handleExportHtml = () => {
    toast.info("正在准备导出...");
    try {
      const content = buildPdfContent(applySectionModuleStyles(enData), cnData);
      const blob = new Blob([content], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "image-suggestions.html";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("已导出HTML文件");
    } catch {
      toast.error("导出失败");
    }
  };

  // PDF export via print
  const handleExportPdf = () => {
    toast.info("正在生成PDF...");
    try {
      const content = buildPdfContent(applySectionModuleStyles(enData), cnData);
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast.error("无法打开打印窗口，请允许弹出窗口");
        return;
      }
      printWindow.document.write(content);
      printWindow.document.close();
      // Add print-specific styles and auto-trigger print
      setTimeout(() => {
        printWindow.print();
      }, 500);
      toast.success("已打开打印对话框，选择“保存为PDF”即可导出");
    } catch {
      toast.error("导出失败");
    }
  };

  const isConfirmed = !!session?.step5Confirmed;

  // Designer upload state
  const [designerUploads, setDesignerUploads] = useState<Record<string, string>>(() => {
    try { 
      const arr = JSON.parse(session?.step5DesignerUploads || '[]');
      const map: Record<string, string> = {};
      arr.forEach((u: any) => { map[u.imageNumber] = u.imageUrl; });
      return map;
    } catch { return {}; }
  });
  const [uploadingDesigner, setUploadingDesigner] = useState<string | null>(null);
  const addDesignerMutation = trpc.imageWorkflow.addDesignerUpload.useMutation();
  const removeDesignerMutation = trpc.imageWorkflow.removeDesignerUpload.useMutation();

  const handleDesignerUpload = async (imageNumber: string, file: File) => {
    setUploadingDesigner(imageNumber);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', String(projectId));
      formData.append('imageNumber', imageNumber);
      const res = await fetch('/api/upload/designer-image', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('上传失败');
      const { url } = await res.json();
      await addDesignerMutation.mutateAsync({ projectId, imageUrl: url, imageNumber });
      setDesignerUploads(prev => ({ ...prev, [imageNumber]: url }));
      toast.success('成品图片已上传');
    } catch (err: any) {
      toast.error(err.message || '上传失败');
    } finally {
      setUploadingDesigner(null);
    }
  };

  const handleDesignerRemove = async (imageNumber: string) => {
    try {
      await removeDesignerMutation.mutateAsync({ projectId, imageNumber });
      setDesignerUploads(prev => { const n = { ...prev }; delete n[imageNumber]; return n; });
      toast.success('已删除成品图片');
    } catch (err: any) {
      toast.error(err.message || '删除失败');
    }
  };

  return (
    <div className={`space-y-4 ${enData && !isConfirmed && !isGenerating ? "pb-24" : ""}`}>
      {enData && !isConfirmed && !isGenerating && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Lock className="h-4 w-4 text-emerald-600" />
              <div>
                <p className="font-medium">最终图片建议待确认</p>
                <p className="text-xs text-muted-foreground">确认后将锁定 Step 5，并完成智能图片建议工作流</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isGenerating}>
                <RotateCcw className="w-4 h-4 mr-2" /> 重新生成
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportHtml}>
                <Download className="w-4 h-4 mr-2" /> 导出HTML
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPdf}>
                <FileText className="w-4 h-4 mr-2" /> 导出PDF
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={confirmMutation.isPending || isGenerating}>
                {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                确认锁定
              </Button>
            </div>
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Step 5: 图片结构及内容建议
              </CardTitle>
              <CardDescription>综合所有确认结果，输出最终图片建议（中英文对照）</CardDescription>
            </div>
            <div className="flex gap-2">
              {!enData && (
                <Button onClick={handleGenerate} disabled={isGenerating}>
                  {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {isGenerating ? "生成中..." : "生成最终建议"}
                </Button>
              )}
              {enData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={isGenerating}>
                    {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                    {isGenerating ? "生成中..." : "重新生成"}
                  </Button>
                  <Button variant="outline" onClick={handleExportHtml}>
                    <Download className="w-4 h-4 mr-2" /> 导出HTML
                  </Button>
                  <Button variant="outline" onClick={handleExportPdf}>
                    <FileText className="w-4 h-4 mr-2" /> 导出PDF
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirmMutation.isPending || isGenerating}>
                    {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认锁定
                  </Button>
                </>
              )}
              {isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleExportHtml}>
                    <Download className="w-4 h-4 mr-2" /> 导出HTML
                  </Button>
                  <Button variant="outline" onClick={handleExportPdf}>
                    <FileText className="w-4 h-4 mr-2" /> 导出PDF
                  </Button>
                  <div className="flex gap-2 items-center">
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      <Lock className="w-3 h-3 mr-1" /> 已锁定
                    </Badge>
                    <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={unlockMutation.isPending}>
                      {unlockMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                      解锁编辑
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        {isGenerating && (
          <CardContent>
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">AI 正在后台生成最终图片建议</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  进度 {Math.max(5, Math.min(100, runProgress || 5))}% · 可以切换页面，回来后会自动恢复
                </p>
                {(activeRunId || sessionActiveRunId) && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {activeRunId || sessionActiveRunId}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {enData && !isGenerating && (
        <>
          {/* Design Guidelines */}
          {enData.designGuidelines && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Paintbrush className="w-4 h-4 text-primary" /> 设计指南
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 border-r pr-4">
                    <Badge variant="outline" className="text-xs">English</Badge>
                    <p className="text-xs"><strong>Font:</strong> {typeof enData.designGuidelines.fontRecommendation === 'object' ? JSON.stringify(enData.designGuidelines.fontRecommendation) : enData.designGuidelines.fontRecommendation}</p>
                    <p className="text-xs"><strong>Color Palette:</strong> {typeof enData.designGuidelines.overallColorPalette === 'object' ? JSON.stringify(enData.designGuidelines.overallColorPalette) : enData.designGuidelines.overallColorPalette}</p>
                    <p className="text-xs"><strong>Brand Tone:</strong> {typeof enData.designGuidelines.brandTone === 'object' ? JSON.stringify(enData.designGuidelines.brandTone) : enData.designGuidelines.brandTone}</p>
                    <p className="text-xs"><strong>Mobile:</strong> {typeof enData.designGuidelines.mobileOptimization === 'object' ? JSON.stringify(enData.designGuidelines.mobileOptimization) : enData.designGuidelines.mobileOptimization}</p>
                  </div>
                  <DesignerUploadPanel
                    imageNumber="design_guidelines"
                    label="设计指南参考图"
                    uploadedUrl={designerUploads["design_guidelines"]}
                    isUploading={uploadingDesigner === "design_guidelines"}
                    onUpload={(f) => handleDesignerUpload("design_guidelines", f)}
                    onRemove={() => handleDesignerRemove("design_guidelines")}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Main Image */}
          {enData.mainImage && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between w-full">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Camera className="w-4 h-4 text-primary" /> 主图 (Main Image)
                  </CardTitle>
                  {!isConfirmed && enData.mainImage && (
                    <RefinePopover
                      projectId={projectId}
                      imageType="mainImage"
                      currentEnContent={enData.mainImage}
                      currentCnContent={cnData?.mainImage}
                      onRefineComplete={handleRefineMainImage}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 border-r pr-4">
                    <Badge variant="outline" className="text-xs">English</Badge>
                    <p className="text-sm font-medium">{enData.mainImage.title}</p>
                    <p className="text-xs"><strong>Concept:</strong> {enData.mainImage.concept}</p>
                    <p className="text-xs"><strong>Composition:</strong> {enData.mainImage.composition}</p>
                    {enData.mainImage.colorScheme && (
                      <div className="space-y-0.5">
                        <ColorSwatch color={enData.mainImage.colorScheme.primary || ""} label="Primary" />
                        <ColorSwatch color={enData.mainImage.colorScheme.secondary || ""} label="Secondary" />
                        <ColorSwatch color={enData.mainImage.colorScheme.accent || ""} label="Accent" />
                      </div>
                    )}
                    <p className="text-xs"><strong>Shooting:</strong> {enData.mainImage.shootingNotes}</p>
                  </div>
                  <DesignerUploadPanel
                    imageNumber="main_image"
                    label="主图成品"
                    uploadedUrl={designerUploads["main_image"]}
                    isUploading={uploadingDesigner === "main_image"}
                    onUpload={(f) => handleDesignerUpload("main_image", f)}
                    onRemove={() => handleDesignerRemove("main_image")}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Secondary Images */}
          {enData.secondaryImages?.map((img: any, idx: number) => {
            const cnImg = cnData?.secondaryImages?.[idx];
            return (
              <Card key={idx}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Image className="w-4 h-4 text-blue-500" /> 辅图 {img.imageNumber || idx + 2}
                    </CardTitle>
                    {!isConfirmed && (
                      <RefinePopover
                        projectId={projectId}
                        imageType="secondaryImage"
                        imageIndex={idx}
                        currentEnContent={img}
                        currentCnContent={cnImg}
                        onRefineComplete={handleRefineSecondaryImage(idx)}
                      />
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 border-r pr-4">
                      <Badge variant="outline" className="text-xs">English</Badge>
                      <p className="text-sm font-medium">{img.title}</p>
                      <p className="text-xs"><strong>Focus:</strong> {img.focus}</p>
                      <FABEDisplay fabe={img.fabe} variant="en" />
                      <p className="text-xs"><strong>Expression:</strong> {img.expressionMethod}</p>
                      <p className="text-xs"><strong>Composition:</strong> {img.composition}</p>
                      {img.colorScheme && (
                        <div className="space-y-0.5">
                          <ColorSwatch color={img.colorScheme.primary || ""} label="Primary" />
                          <ColorSwatch color={img.colorScheme.secondary || ""} label="Secondary" />
                          <ColorSwatch color={img.colorScheme.accent || ""} label="Accent" />
                        </div>
                      )}
                      <p className="text-xs"><strong>Text Overlay:</strong> {img.textOverlay}</p>
                      {img.dataVisualization && <p className="text-xs"><strong>Data Viz:</strong> {img.dataVisualization}</p>}
                      {img.icons?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {img.icons.map((icon: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{icon}</Badge>)}
                        </div>
                      )}
                    </div>
                    <DesignerUploadPanel
                      imageNumber={`secondary_${idx + 1}`}
                      label={`辅图 ${img.imageNumber || idx + 2} 成品`}
                      uploadedUrl={designerUploads[`secondary_${idx + 1}`]}
                      isUploading={uploadingDesigner === `secondary_${idx + 1}`}
                      onUpload={(f) => handleDesignerUpload(`secondary_${idx + 1}`, f)}
                      onRemove={() => handleDesignerRemove(`secondary_${idx + 1}`)}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* A+ Content with drag and drop */}
          {enData.aPlusContent && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Layers className="w-4 h-4 text-purple-500" /> A+ Content
                    </CardTitle>
                    {!isConfirmed && (
                      <Badge variant="outline" className="text-xs">拖拽模块可调整顺序</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-1 border-r pr-4">
                      <Badge variant="outline" className="text-xs">English</Badge>
                      <p className="text-xs"><strong>Strategy:</strong> {enData.aPlusContent.overallStrategy}</p>
                      <p className="text-xs"><strong>Story:</strong> {enData.aPlusContent.overallStory}</p>
                      <p className="text-xs"><strong>Consistency:</strong> {enData.aPlusContent.consistency}</p>
                      <p className="text-xs"><strong>Modular Design:</strong> {enData.aPlusContent.modularDesign}</p>
                    </div>
                    <DesignerUploadPanel
                      imageNumber="aplus_overview"
                      label="A+ 整体设计稿"
                      uploadedUrl={designerUploads["aplus_overview"]}
                      isUploading={uploadingDesigner === "aplus_overview"}
                      onUpload={(f) => handleDesignerUpload("aplus_overview", f)}
                      onRemove={() => handleDesignerRemove("aplus_overview")}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Draggable A+ sections with per-section module style selector */}
              {enData.aPlusContent.sections?.map((section: any, idx: number) => {
                const cnSection = cnData?.aPlusContent?.sections?.[idx];
                const outlineModule = outlineAplusModules[idx];
                const outlineSelectedModule = findOutlineAplusModule(
                  outlineModule?.selectedModuleType || outlineModule?.recommendedModuleType || outlineModule?.selectedModuleName
                );
                const selectedStyle = sectionModuleStyles[idx] || section.selectedModuleType || outlineSelectedModule?.id || '';
                const selectedMod = APLUS_MODULES.find(m => m.id === selectedStyle);
                const selectedModuleName = section.selectedModuleName || outlineModule?.selectedModuleName || selectedMod?.name;
                const isOptimizing = optimizingSectionIdx === idx;
                return (
                  <Card
                    key={idx}
                    draggable={!isConfirmed}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`transition-all ${draggedIdx === idx ? "opacity-50 scale-95" : ""} ${!isConfirmed ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {!isConfirmed && <GripVertical className="w-4 h-4 text-gray-400" />}
                          <CardTitle className="text-sm flex items-center gap-2">
                            A+ 模块 {idx + 1}
                            {section.type && <Badge variant="outline" className="text-xs">{section.type}</Badge>}
                            {selectedModuleName && (
                              <Badge variant="secondary" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                                {selectedModuleName}
                              </Badge>
                            )}
                          </CardTitle>
                        </div>
                        {!isConfirmed && (
                          <RefinePopover
                            projectId={projectId}
                            imageType="aPlusSection"
                            imageIndex={idx}
                            currentEnContent={section}
                            currentCnContent={cnSection}
                            onRefineComplete={handleRefineAplusSection(idx)}
                          />
                        )}
                      </div>
                      {/* Per-section A+ module style selector */}
                      {!isConfirmed && (
                        <div className="mt-3 p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                          <div className="flex items-center gap-2 mb-2">
                            <Layers className="w-3.5 h-3.5 text-purple-500" />
                            <span className="text-xs font-medium text-purple-700">A+模块样式微调</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select
                              value={selectedStyle}
                              onValueChange={(val) => setSectionModuleStyles(prev => ({ ...prev, [idx]: val }))}
                            >
                              <SelectTrigger className="h-8 text-xs flex-1 bg-white">
                                <SelectValue placeholder="选择A+模块样式..." />
                              </SelectTrigger>
                              <SelectContent>
                                {MODULE_CATEGORIES.map(cat => (
                                  <div key={cat}>
                                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">{cat}</div>
                                    {APLUS_MODULES.filter(m => m.category === cat).map(mod => (
                                      <SelectItem key={mod.id} value={mod.id}>
                                        <div className="flex flex-col">
                                          <span className="text-xs font-medium">{mod.name}</span>
                                          <span className="text-[10px] text-muted-foreground">{mod.desc} | {mod.specs}</span>
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </div>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-8 text-xs bg-purple-600 hover:bg-purple-700"
                              disabled={!selectedStyle || isOptimizing}
                              onClick={() => handleSingleModuleOptimize(idx)}
                            >
                              {isOptimizing ? (
                                <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> 优化中...</>
                              ) : (
                                <><Sparkles className="w-3 h-3 mr-1" /> AI优化</>
                              )}
                            </Button>
                          </div>
                          {selectedMod && (
                            <p className="text-[10px] text-purple-600 mt-1.5">
                              ℹ️ {selectedMod.name}: {selectedMod.desc} — {selectedMod.specs}
                            </p>
                          )}
                        </div>
                      )}
                    </CardHeader>
                    {isOptimizing ? (
                      <CardContent>
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-purple-500 mr-2" />
                          <span className="text-sm text-muted-foreground">AI正在根据「{selectedMod?.name}」样式重新优化该模块...</span>
                        </div>
                      </CardContent>
                    ) : (
                      <CardContent>
                        {/* Module specs display if optimized */}
                        {section.specs && (
                          <div className="mb-3 p-2 bg-purple-50 rounded border border-purple-100">
                            <div className="flex flex-wrap gap-2 text-[10px]">
                              {section.specs.desktopSize && <Badge variant="outline" className="text-[10px] bg-white">桌面: {section.specs.desktopSize}</Badge>}
                              {section.specs.mobileSize && <Badge variant="outline" className="text-[10px] bg-white">移动: {section.specs.mobileSize}</Badge>}
                              {section.specs.maxTitleChars && <Badge variant="outline" className="text-[10px] bg-white">标题≤{section.specs.maxTitleChars}字符</Badge>}
                              {section.specs.maxBodyChars && <Badge variant="outline" className="text-[10px] bg-white">正文≤{section.specs.maxBodyChars}字符</Badge>}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2 border-r pr-4">
                            <Badge variant="outline" className="text-xs">English</Badge>
                            <p className="text-sm font-medium">{section.title}</p>
                            <p className="text-xs"><strong>Purpose:</strong> {section.purpose}</p>
                            <p className="text-xs"><strong>Content:</strong> {section.content}</p>
                            {section.imageDescription && <p className="text-xs"><strong>Image:</strong> {section.imageDescription}</p>}
                            <FABEDisplay fabe={section.fabe} variant="en" />
                            {section.expressionMethod && <p className="text-xs"><strong>Expression:</strong> {section.expressionMethod}</p>}
                            {section.composition && <p className="text-xs"><strong>Composition:</strong> {section.composition}</p>}
                            {section.dataVisualization && <p className="text-xs"><strong>Data Viz:</strong> {section.dataVisualization}</p>}
                            {section.icons?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {section.icons.map((icon: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{icon}</Badge>)}
                              </div>
                            )}
                            {section.designTips?.length > 0 && (
                              <div className="mt-2 p-2 bg-amber-50 rounded text-xs">
                                <strong className="text-amber-700">设计提示:</strong>
                                <ul className="list-disc list-inside mt-1 text-amber-600">
                                  {section.designTips.map((tip: string, i: number) => <li key={i}>{tip}</li>)}
                                </ul>
                              </div>
                            )}
                            {/* Module-specific content display */}
                            {section.moduleSpecificContent && (
                              <div className="mt-2 p-2 bg-blue-50 rounded text-xs space-y-1">
                                <strong className="text-blue-700">模块专属内容:</strong>
                                {section.moduleSpecificContent.comparisons && (
                                  <div><strong>对比数据:</strong> {JSON.stringify(section.moduleSpecificContent.comparisons).slice(0, 200)}...</div>
                                )}
                                {section.moduleSpecificContent.panels && (
                                  <div><strong>面板:</strong> {section.moduleSpecificContent.panels.length}个面板</div>
                                )}
                                {section.moduleSpecificContent.subImages && (
                                  <div><strong>子图:</strong> {section.moduleSpecificContent.subImages.length}张子图</div>
                                )}
                                {section.moduleSpecificContent.hotspots && (
                                  <div><strong>热点:</strong> {section.moduleSpecificContent.hotspots.length}个热点</div>
                                )}
                                {section.moduleSpecificContent.comparisonRows && (
                                  <div><strong>比较表:</strong> {section.moduleSpecificContent.comparisonRows.length}行</div>
                                )}
                                {section.moduleSpecificContent.qaItems && (
                                  <div><strong>问答:</strong> {section.moduleSpecificContent.qaItems.length}个问答</div>
                                )}
                                {section.moduleSpecificContent.specs && (
                                  <div><strong>规格:</strong> {section.moduleSpecificContent.specs.length}个规格项</div>
                                )}
                              </div>
                            )}
                          </div>
                          <DesignerUploadPanel
                            imageNumber={`aplus_section_${idx + 1}`}
                            label={`A+ 模块 ${idx + 1} 成品`}
                            uploadedUrl={designerUploads[`aplus_section_${idx + 1}`]}
                            isUploading={uploadingDesigner === `aplus_section_${idx + 1}`}
                            onUpload={(f) => handleDesignerUpload(`aplus_section_${idx + 1}`, f)}
                            onRemove={() => handleDesignerRemove(`aplus_section_${idx + 1}`)}
                          />
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </>
          )}

          {!isConfirmed && (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-emerald-100 p-2 text-emerald-700">
                    <Lock className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-900">确认最终图片建议</p>
                    <p className="text-xs text-emerald-700/80">请检查主图、辅图、A+模块和美工成品图，确认无误后锁定本步骤。</p>
                  </div>
                </div>
                <Button onClick={handleConfirm} disabled={confirmMutation.isPending} className="shrink-0 bg-emerald-600 hover:bg-emerald-700">
                  {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  确认锁定
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ─── Main Page Component ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
export default function ImageWorkflowPage() {
  const { selectedProjectId } = useProject();
  const [currentStep, setCurrentStep] = useState(1);
  const agentRunId = useMemo(() => new URLSearchParams(window.location.search).get("agentRunId"), []);

  const sessionQuery = trpc.imageWorkflow.getSession.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );
  const createSessionMutation = trpc.imageWorkflow.createSession.useMutation();
  const resetMutation = trpc.imageWorkflow.resetToStep.useMutation();

  const session = sessionQuery.data;
  const confirmedStepIds = useMemo(() => {
    if (!session) return new Set<number>();
    return new Set(
      [
        session.step0Confirmed ? 0 : null,
        session.step1Confirmed ? 1 : null,
        session.step2Confirmed ? 2 : null,
        session.step3Confirmed ? 3 : null,
        session.step4Confirmed ? 4 : null,
        session.step5Confirmed ? 5 : null,
      ].filter((step): step is number => typeof step === "number"),
    );
  }, [
    session?.step0Confirmed,
    session?.step1Confirmed,
    session?.step2Confirmed,
    session?.step3Confirmed,
    session?.step4Confirmed,
    session?.step5Confirmed,
  ]);

  // Sync current step from session
  useEffect(() => {
    if (session?.currentStep !== undefined && session?.currentStep !== null) {
      setCurrentStep(session.currentStep);
    }
  }, [session?.currentStep]);

  const handleStepClick = (step: number) => {
    setCurrentStep(step);
  };

  const handleStepConfirm = () => {
    sessionQuery.refetch();
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleStartNew = async () => {
    if (!selectedProjectId) return;
    try {
      await createSessionMutation.mutateAsync({ projectId: selectedProjectId });
      sessionQuery.refetch();
      setCurrentStep(0);
      toast.success("新工作流已创建");
    } catch (err: any) {
      toast.error(err.message || "创建失败");
    }
  };

  const handleReset = async (step: number) => {
    if (!selectedProjectId) return;
    try {
      await resetMutation.mutateAsync({ projectId: selectedProjectId, step });
      sessionQuery.refetch();
      setCurrentStep(step);
      toast.success(`已重置到步骤 ${step}`);
    } catch (err: any) {
      toast.error(err.message || "重置失败");
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Image className="w-6 h-6 text-primary" />
              智能图片建议
            </h1>
            <p className="text-muted-foreground text-sm mt-1">6步工作流：竞品分析 → 卖点梳理 → 图片大纲 → 风格确认 → 参考图确认 → 图片建议</p>
          </div>
          <ProjectSelector />
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
              <p className="text-muted-foreground">请先选择一个项目</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <WorkflowShell
      title="智能图片建议"
      subtitle="6步工作流：竞品分析 → 卖点梳理 → 图片大纲 → 风格确认 → 参考图确认 → 图片建议"
      kind="image"
      steps={IMAGE_SUGGESTION_WORKFLOW_STEPS}
      activeStepId={currentStep}
      completedStepIds={confirmedStepIds}
      lockedStepIds={confirmedStepIds}
      runId={agentRunId}
      onStepClick={(stepId) => handleStepClick(Number(stepId))}
      className="max-w-6xl"
      headerActions={
        <>
          <ProjectSelector />
          {session && session.step5Confirmed && (
            <Button variant="outline" size="sm" onClick={() => {
              toast.info("正在生成完整方案...");
              try {
                const content = buildFullPlanContent(session);
                const blob = new Blob([content], { type: "text/html;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `图片设计完整方案-${new Date().toISOString().slice(0,10)}.html`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("已导出完整方案，可在浏览器中打印为PDF");
              } catch {
                toast.error("导出失败");
              }
            }}>
              <FileText className="w-3 h-3 mr-1" /> 导出完整方案
            </Button>
          )}
          {session && (
            <Button variant="outline" size="sm" onClick={handleStartNew} disabled={createSessionMutation.isPending}>
              <RotateCcw className="w-3 h-3 mr-1" /> 重新开始
            </Button>
          )}
        </>
      }
    >

      {!session && (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <div className="text-center space-y-4">
              <Image className="w-16 h-16 text-primary/30 mx-auto" />
              <div>
                <p className="text-lg font-medium">开始图片建议工作流</p>
                <p className="text-sm text-muted-foreground mt-1">通过6个步骤，AI将帮助你分析竞品、规划产品图片的完整方案</p>
              </div>
              <Button onClick={handleStartNew} disabled={createSessionMutation.isPending} size="lg">
                {createSessionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                开始工作流
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {session && currentStep === 0 && (
        <Step0CompetitorAnalysis projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 1 && (
        <Step1SellingPoints projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 2 && (
        <Step2ImageOutline projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 3 && (
        <Step3StyleConfirm projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 4 && (
        <Step4References projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}
      {session && currentStep === 5 && (
        <Step5FinalSuggestions projectId={selectedProjectId} session={session} onConfirm={handleStepConfirm} />
      )}

    </WorkflowShell>
  );
}
