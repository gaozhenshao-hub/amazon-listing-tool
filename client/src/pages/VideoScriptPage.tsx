import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Trash2, Play, CheckCircle, ChevronRight, ChevronLeft, Upload,
  FileText, Video, Sparkles, Eye, Edit3, ArrowRight, RefreshCw,
  Database, BookOpen, Link2, Loader2, Check, X, GripVertical,
  Film, Scissors, Copy, Download, History, AlertTriangle, ArrowUp, ArrowDown,
  Save, RotateCcw, Info, Palette, Clock, Monitor, Settings2,
} from "lucide-react";

// ─── Types & Constants ─────────────────────────────────────────

const STAGES = [
  { key: "stage_0a", label: "竞品脚本分析", icon: Eye, description: "上传/提取竞品视频脚本" },
  { key: "stage_0b", label: "产品信息提取", icon: Database, description: "从项目中提取产品数据" },
  { key: "stage_1", label: "段落规划", icon: FileText, description: "AI规划视频段落结构" },
  { key: "stage_2", label: "子主题展开", icon: ChevronRight, description: "展开子主题和镜头数量" },
  { key: "stage_3", label: "镜头明细", icon: Film, description: "逐镜头拍摄脚本" },
  { key: "stage_4", label: "剪辑脚本", icon: Scissors, description: "多版本剪辑方案" },
] as const;

const VIDEO_TYPE_LABELS: Record<string, string> = {
  main_video: "主图视频",
  ad_spv: "SPV广告",
  ad_sbv: "SBV广告",
  aplus_video: "A+视频",
  social_media: "社媒视频",
  other: "其他",
};

const VIDEO_TYPE_SPECS: Record<string, { maxDuration: number; minDuration: number; resolution: string; ratio: string; format: string; description: string }> = {
  main_video: { maxDuration: 60, minDuration: 15, resolution: "1920x1080", ratio: "16:9", format: "MP4/MOV", description: "产品主图视频，展示核心卖点和使用场景" },
  ad_spv: { maxDuration: 45, minDuration: 6, resolution: "1920x1080", ratio: "16:9", format: "MP4", description: "Sponsored Products Video广告，多段式结构" },
  ad_sbv: { maxDuration: 45, minDuration: 6, resolution: "1920x1080", ratio: "16:9", format: "MP4", description: "Sponsored Brands Video广告，品牌故事+产品展示" },
  aplus_video: { maxDuration: 180, minDuration: 15, resolution: "1920x1080", ratio: "16:9", format: "MP4", description: "A+页面视频，深度产品介绍和使用教程" },
  social_media: { maxDuration: 60, minDuration: 5, resolution: "1080x1920", ratio: "9:16", format: "MP4", description: "社交媒体短视频，竖屏快节奏" },
  other: { maxDuration: 300, minDuration: 5, resolution: "1920x1080", ratio: "16:9", format: "MP4", description: "自定义视频类型" },
};

const STYLE_PRESETS: Record<string, { label: string; description: string }> = {
  professional: { label: "专业商务", description: "干净背景、精确运镜、专业旁白" },
  lifestyle: { label: "生活方式", description: "自然光线、真实场景、温馨氛围" },
  tech_modern: { label: "科技感", description: "深色背景、动态图形、数据可视化" },
  minimal: { label: "极简风格", description: "白色背景、简洁构图、产品特写" },
  energetic: { label: "活力动感", description: "快节奏剪辑、鲜艳色彩、动感音乐" },
  storytelling: { label: "故事叙述", description: "情景剧式、人物驱动、情感共鸣" },
};

const SHOOTING_METHOD_LABELS: Record<string, string> = {
  model_narration: "模特口播",
  live_action: "实拍",
  ai_generated: "AI生成",
  mixed: "混合",
  screen_recording: "录屏",
};

const CAMERA_ANGLE_LABELS: Record<string, string> = {
  extreme_closeup: "极特写",
  closeup: "特写",
  medium_closeup: "中近景",
  medium: "中景",
  medium_wide: "中远景",
  wide: "全景",
  extreme_wide: "远景",
};

const INPUT_TYPE_LABELS: Record<string, string> = {
  excel_upload: "上传文件",
  video_url: "视频链接",
  knowledge_base: "知识库",
  listing_extract: "Listing提取",
};

const GENERATION_STRATEGY_LABELS: Record<string, string> = {
  real_shoot: "实拍",
  ai_image: "AI图",
  ai_video: "AI视频",
  stock_footage: "素材库",
  screen_record: "录屏",
  mixed: "混合",
};

// ─── Utility ────────────────────────────────────────────────────

function parseJson(val: any): any {
  try { return typeof val === "string" ? JSON.parse(val) : val; } catch { return null; }
}

// ─── Main Component ─────────────────────────────────────────────

export default function VideoScriptPage() {
  const [, params] = useRoute("/listing/video-script/:id");
  const [, navigate] = useLocation();
  const scriptId = params?.id ? parseInt(params.id) : null;

  if (scriptId) {
    return <VideoScriptEditor scriptId={scriptId} />;
  }
  return <VideoScriptList />;
}

// ─── Script List ────────────────────────────────────────────────

function VideoScriptList() {
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newVideoType, setNewVideoType] = useState("main_video");
  const [newDuration, setNewDuration] = useState("60");
  const [newStylePreset, setNewStylePreset] = useState("professional");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  const projects = trpc.project.list.useQuery();
  const scripts = trpc.videoScript.list.useQuery(
    { projectId: selectedProject || 0 },
    { enabled: !!selectedProject }
  );
  const createMutation = trpc.videoScript.create.useMutation({
    onSuccess: (data) => {
      toast.success("视频脚本项目已创建");
      navigate(`/listing/video-script/${data.id}`);
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = trpc.videoScript.delete.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      scripts.refetch();
    },
  });

  const projectList = projects.data || [];
  const currentSpec = VIDEO_TYPE_SPECS[newVideoType] || VIDEO_TYPE_SPECS.other;

  // Auto-adjust duration when video type changes
  useEffect(() => {
    const spec = VIDEO_TYPE_SPECS[newVideoType];
    if (spec) {
      const dur = parseFloat(newDuration);
      if (dur > spec.maxDuration) setNewDuration(spec.maxDuration.toString());
      if (dur < spec.minDuration) setNewDuration(spec.maxDuration.toString());
    }
  }, [newVideoType]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">视频脚本生成</h1>
          <p className="text-muted-foreground mt-1">
            AI驱动的六阶段渐进式视频脚本创作流程
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />新建视频脚本</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>新建视频脚本项目</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>关联项目</Label>
                <Select onValueChange={(v) => setSelectedProject(parseInt(v))} value={selectedProject?.toString() || ""}>
                  <SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger>
                  <SelectContent>
                    {projectList.map((p: any) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>脚本名称</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如：产品A 主图视频脚本" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>视频类型</Label>
                  <Select value={newVideoType} onValueChange={setNewVideoType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(VIDEO_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>目标时长（秒）</Label>
                  <Input
                    type="number"
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    min={currentSpec.minDuration}
                    max={currentSpec.maxDuration}
                  />
                  <p className="text-xs text-muted-foreground">
                    范围: {currentSpec.minDuration}s - {currentSpec.maxDuration}s
                  </p>
                </div>
              </div>

              {/* Video Type Spec Info */}
              <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-700 dark:text-blue-400">{VIDEO_TYPE_LABELS[newVideoType]} 规范</p>
                    <p className="text-muted-foreground mt-1">{currentSpec.description}</p>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Monitor className="w-3 h-3" />{currentSpec.resolution}</span>
                      <span className="flex items-center gap-1"><Film className="w-3 h-3" />{currentSpec.ratio}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{currentSpec.minDuration}-{currentSpec.maxDuration}s</span>
                      <span>{currentSpec.format}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Style Preset */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Palette className="w-4 h-4" />风格预设</Label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(STYLE_PRESETS).map(([k, v]) => (
                    <Card
                      key={k}
                      className={`cursor-pointer transition-all hover:shadow-sm ${newStylePreset === k ? "ring-2 ring-primary bg-primary/5" : ""}`}
                      onClick={() => setNewStylePreset(k)}
                    >
                      <CardContent className="py-3 px-3">
                        <p className="font-medium text-sm">{v.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{v.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
              <Button
                onClick={() => {
                  if (!selectedProject || !newName) {
                    toast.error("请填写完整信息");
                    return;
                  }
                  const dur = parseFloat(newDuration);
                  if (dur < currentSpec.minDuration || dur > currentSpec.maxDuration) {
                    toast.error(`时长需在 ${currentSpec.minDuration}s - ${currentSpec.maxDuration}s 之间`);
                    return;
                  }
                  createMutation.mutate({
                    projectId: selectedProject,
                    scriptName: newName,
                    videoType: newVideoType as any,
                    targetDuration: dur,
                    stylePreset: newStylePreset,
                  });
                }}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Project Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Label className="whitespace-nowrap">选择项目：</Label>
            <Select onValueChange={(v) => setSelectedProject(parseInt(v))} value={selectedProject?.toString() || ""}>
              <SelectTrigger className="w-[300px]"><SelectValue placeholder="选择项目查看脚本" /></SelectTrigger>
              <SelectContent>
                {projectList.map((p: any) => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Script List */}
      {selectedProject && (
        <div className="grid gap-4">
          {scripts.isLoading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">加载中...</CardContent></Card>
          ) : (scripts.data || []).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Video className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">暂无视频脚本，点击上方按钮创建</p>
              </CardContent>
            </Card>
          ) : (
            (scripts.data || []).map((s: any) => (
              <Card key={s.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/listing/video-script/${s.id}`)}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Video className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{s.scriptName}</h3>
                        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                          <Badge variant="outline">{VIDEO_TYPE_LABELS[s.videoType] || s.videoType}</Badge>
                          {s.stylePreset && <Badge variant="secondary" className="text-xs">{STYLE_PRESETS[s.stylePreset]?.label || s.stylePreset}</Badge>}
                          <span>{s.targetDuration}s</span>
                          {s.version > 1 && <Badge variant="outline" className="text-xs">v{s.version}</Badge>}
                          <span>·</span>
                          <span>创建于 {new Date(s.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StageIndicator currentStage={s.currentStage} />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("确定要删除此脚本？")) deleteMutation.mutate({ id: s.id });
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stage Indicator ────────────────────────────────────────────

function StageIndicator({ currentStage }: { currentStage: string }) {
  const currentIdx = STAGES.findIndex(s => s.key === currentStage);
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <div key={stage.key} className="flex items-center">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                isCompleted
                  ? "bg-green-500 text-white"
                  : isCurrent
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
              title={stage.label}
            >
              {isCompleted ? <Check className="w-3 h-3" /> : idx + 1}
            </div>
            {idx < STAGES.length - 1 && (
              <div className={`w-3 h-0.5 ${isCompleted ? "bg-green-500" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Duration Validator ─────────────────────────────────────────

function DurationValidator({ videoType, currentDuration, targetDuration }: { videoType: string; currentDuration: number; targetDuration: number }) {
  const spec = VIDEO_TYPE_SPECS[videoType] || VIDEO_TYPE_SPECS.other;
  const overTarget = currentDuration > targetDuration;
  const overMax = currentDuration > spec.maxDuration;
  const underMin = currentDuration < spec.minDuration && currentDuration > 0;
  const pct = targetDuration > 0 ? (currentDuration / targetDuration) * 100 : 0;

  if (!overTarget && !overMax && !underMin) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className="text-green-600 font-medium">{currentDuration.toFixed(1)}s / {targetDuration}s</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${overMax ? "bg-red-500" : overTarget ? "bg-amber-500" : "bg-green-500"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className={`font-medium ${overMax ? "text-red-600" : "text-amber-600"}`}>
          {currentDuration.toFixed(1)}s / {targetDuration}s
        </span>
      </div>
      {overMax && (
        <div className="flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle className="w-3 h-3" />
          超出{VIDEO_TYPE_LABELS[videoType]}最大时长限制 ({spec.maxDuration}s)
        </div>
      )}
      {overTarget && !overMax && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="w-3 h-3" />
          超出目标时长 {(currentDuration - targetDuration).toFixed(1)}s
        </div>
      )}
    </div>
  );
}

// ─── Script Editor (6-Stage Wizard) ─────────────────────────────

function VideoScriptEditor({ scriptId }: { scriptId: number }) {
  const [, navigate] = useLocation();
  const [showVersions, setShowVersions] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const script = trpc.videoScript.getById.useQuery({ id: scriptId });
  const versions = trpc.videoScript.getVersions.useQuery({ videoScriptId: scriptId });
  const updateMutation = trpc.videoScript.update.useMutation();
  const advanceStageMutation = trpc.videoScript.advanceStage.useMutation({
    onSuccess: () => {
      script.refetch();
      toast.success("已进入下一阶段");
    },
  });
  const confirmStageMutation = trpc.videoScript.confirmStage.useMutation({
    onSuccess: () => {
      script.refetch();
      toast.success("阶段已确认");
    },
  });
  const createVersionMutation = trpc.videoScript.createVersion.useMutation({
    onSuccess: (data) => {
      toast.success(`版本 v${data.version} 已保存`);
      versions.refetch();
      script.refetch();
      setVersionNote("");
    },
    onError: (err) => toast.error(err.message),
  });
  const rollbackMutation = trpc.videoScript.rollbackVersion.useMutation({
    onSuccess: (data) => {
      toast.success(`已回滚到版本 v${data.restoredVersion}`);
      script.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  // Export functionality - TODO: implement exportToExcel backend endpoint
  const exportMutation = {
    mutate: (_args: { videoScriptId: number }) => toast.info("Excel导出功能即将上线"),
    isPending: false,
  };

  const currentStageIdx = useMemo(() => {
    if (!script.data) return 0;
    return STAGES.findIndex(s => s.key === script.data!.currentStage);
  }, [script.data]);

  const stageStatus = useMemo(() => {
    if (!script.data) return {};
    return parseJson((script.data as any).stageStatus) || {};
  }, [script.data]);

  const handleAdvanceStage = useCallback(() => {
    if (!script.data || currentStageIdx >= STAGES.length - 1) return;
    advanceStageMutation.mutate({
      videoScriptId: scriptId,
      fromStage: STAGES[currentStageIdx].key,
      toStage: STAGES[currentStageIdx + 1].key,
    });
  }, [scriptId, currentStageIdx, script.data]);

  const handleConfirmStage = useCallback(() => {
    if (!script.data) return;
    confirmStageMutation.mutate({
      videoScriptId: scriptId,
      stage: STAGES[currentStageIdx].key,
    });
  }, [scriptId, currentStageIdx, script.data]);

  if (script.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!script.data) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">脚本不存在</p>
        <Button variant="link" onClick={() => navigate("/listing/video-script")}>返回列表</Button>
      </div>
    );
  }

  const videoType = script.data.videoType || "main_video";
  const spec = VIDEO_TYPE_SPECS[videoType] || VIDEO_TYPE_SPECS.other;
  const isStageConfirmed = stageStatus[STAGES[currentStageIdx]?.key] === "confirmed";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/listing/video-script")}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{script.data.scriptName}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{VIDEO_TYPE_LABELS[videoType] || "视频"}</Badge>
              {(script.data as any).stylePreset && (
                <Badge variant="secondary" className="text-xs">
                  <Palette className="w-3 h-3 mr-1" />
                  {STYLE_PRESETS[(script.data as any).stylePreset]?.label || (script.data as any).stylePreset}
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {script.data.targetDuration}s
              </span>
              <span className="flex items-center gap-1">
                <Monitor className="w-3 h-3" />
                {spec.resolution} ({spec.ratio})
              </span>
              {(script.data as any).version > 1 && (
                <Badge variant="outline" className="text-xs">v{(script.data as any).version}</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Version Management */}
          <Dialog open={showVersions} onOpenChange={setShowVersions}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <History className="w-4 h-4 mr-1" />版本
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>版本管理</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex items-center gap-2">
                  <Input
                    value={versionNote}
                    onChange={(e) => setVersionNote(e.target.value)}
                    placeholder="版本备注（可选）"
                    className="flex-1"
                  />
                  <Button
                    onClick={() => createVersionMutation.mutate({ videoScriptId: scriptId, versionNote: versionNote || undefined })}
                    disabled={createVersionMutation.isPending}
                    size="sm"
                  >
                    {createVersionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    保存版本
                  </Button>
                </div>
                <Separator />
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {(versions.data || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无历史版本</p>
                  ) : (
                    (versions.data || []).map((v: any) => (
                      <div key={v.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <div>
                          <p className="font-medium text-sm">v{v.version} {v.versionNote && `- ${v.versionNote}`}</p>
                          <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (confirm(`确定要回滚到版本 v${v.version}？当前未保存的更改将丢失。`)) {
                              rollbackMutation.mutate({ versionId: v.id });
                            }
                          }}
                          disabled={rollbackMutation.isPending}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />回滚
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline"
            size="sm"
            onClick={() => exportMutation.mutate({ videoScriptId: scriptId })}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            导出Excel
          </Button>
        </div>
      </div>

      {/* Stage Progress Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            {STAGES.map((stage, idx) => {
              const isCompleted = idx < currentStageIdx;
              const isCurrent = idx === currentStageIdx;
              const isConfirmed = stageStatus[stage.key] === "confirmed";
              const StageIcon = stage.icon;
              return (
                <div key={stage.key} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                        isConfirmed
                          ? "bg-green-500 text-white"
                          : isCompleted
                          ? "bg-green-400 text-white"
                          : isCurrent
                          ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isConfirmed ? <CheckCircle className="w-5 h-5" /> : isCompleted ? <Check className="w-4 h-4" /> : <StageIcon className="w-4 h-4" />}
                    </div>
                    <span className={`text-xs text-center ${isCurrent ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                      {stage.label}
                    </span>
                  </div>
                  {idx < STAGES.length - 1 && (
                    <div className={`w-full h-0.5 mx-1 ${isCompleted || isConfirmed ? "bg-green-400" : "bg-muted"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Stage Content */}
      <div className="min-h-[400px]">
        {currentStageIdx === 0 && <Stage0A scriptId={scriptId} projectId={script.data.projectId} onAdvance={handleAdvanceStage} onConfirm={handleConfirmStage} isConfirmed={isStageConfirmed} />}
        {currentStageIdx === 1 && <Stage0B scriptId={scriptId} projectId={script.data.projectId} onAdvance={handleAdvanceStage} onConfirm={handleConfirmStage} isConfirmed={isStageConfirmed} />}
        {currentStageIdx === 2 && <Stage1 scriptId={scriptId} projectId={script.data.projectId} videoType={videoType} targetDuration={Number(script.data.targetDuration) || 60} onAdvance={handleAdvanceStage} onConfirm={handleConfirmStage} isConfirmed={isStageConfirmed} />}
        {currentStageIdx === 3 && <Stage2 scriptId={scriptId} onAdvance={handleAdvanceStage} onConfirm={handleConfirmStage} isConfirmed={isStageConfirmed} />}
        {currentStageIdx === 4 && <Stage3 scriptId={scriptId} videoType={videoType} targetDuration={Number(script.data.targetDuration) || 60} onAdvance={handleAdvanceStage} onConfirm={handleConfirmStage} isConfirmed={isStageConfirmed} />}
        {currentStageIdx === 5 && <Stage4 scriptId={scriptId} onConfirm={handleConfirmStage} isConfirmed={isStageConfirmed} />}
      </div>
    </div>
  );
}

// ─── Stage Action Footer ────────────────────────────────────────

function StageFooter({ onAdvance, onConfirm, isConfirmed, nextLabel, canAdvance = true }: {
  onAdvance?: () => void;
  onConfirm: () => void;
  isConfirmed: boolean;
  nextLabel?: string;
  canAdvance?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <Button
        variant={isConfirmed ? "default" : "outline"}
        onClick={onConfirm}
        className="gap-2"
        disabled={isConfirmed}
      >
        {isConfirmed ? <CheckCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
        {isConfirmed ? "已确认本阶段" : "确认本阶段"}
      </Button>
      {onAdvance && (
        <Button onClick={onAdvance} className="gap-2" disabled={!canAdvance}>
          {nextLabel || "下一步"} <ArrowRight className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

// ─── Stage 0A: Competitor Script Analysis ───────────────────────

function Stage0A({ scriptId, projectId, onAdvance, onConfirm, isConfirmed }: {
  scriptId: number; projectId: number; onAdvance: () => void; onConfirm: () => void; isConfirmed: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [inputType, setInputType] = useState<string>("excel_upload");
  const [rawContent, setRawContent] = useState("");
  const [competitorName, setCompetitorName] = useState("");
  const [competitorAsin, setCompetitorAsin] = useState("");

  const competitors = trpc.videoScript.getCompetitorScripts.useQuery({ videoScriptId: scriptId });
  const summary = trpc.videoScript.getCompetitorSummary.useQuery({ videoScriptId: scriptId });
  const addMutation = trpc.videoScript.addCompetitorScript.useMutation({
    onSuccess: () => {
      toast.success("竞品脚本已添加");
      competitors.refetch();
      setShowAdd(false);
      setRawContent("");
      setCompetitorName("");
      setCompetitorAsin("");
    },
  });
  const analyzeMutation = trpc.videoScript.analyzeCompetitorScript.useMutation({
    onSuccess: () => {
      toast.success("AI分析完成");
      competitors.refetch();
    },
    onError: (err) => toast.error(`分析失败: ${err.message}`),
  });
  const summaryMutation = trpc.videoScript.generateCompetitorSummary.useMutation({
    onSuccess: () => {
      toast.success("汇总分析完成");
      summary.refetch();
    },
  });
  const deleteMutation = trpc.videoScript.deleteCompetitorScript.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      competitors.refetch();
    },
  });

  const competitorList = competitors.data || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5" />
            阶段0A：竞品脚本上传与AI分析
          </CardTitle>
          <CardDescription>
            上传竞品视频脚本，AI自动分析结构、视觉语言和文案风格。支持从Listing项目提取、知识库选择或直接上传。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Input Sources */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { type: "excel_upload", icon: Upload, label: "上传脚本文件", desc: "Excel/PDF" },
              { type: "video_url", icon: Link2, label: "视频链接", desc: "YouTube/Amazon" },
              { type: "listing_extract", icon: FileText, label: "Listing提取", desc: "从模块二项目" },
              { type: "knowledge_base", icon: BookOpen, label: "知识库选择", desc: "视频知识库" },
            ].map(({ type, icon: Icon, label, desc }) => (
              <Card
                key={type}
                className={`cursor-pointer transition-all hover:shadow-md ${inputType === type ? "ring-2 ring-primary" : ""}`}
                onClick={() => { setInputType(type); setShowAdd(true); }}
              >
                <CardContent className="py-4 text-center">
                  <Icon className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Add Dialog */}
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>添加竞品脚本 - {INPUT_TYPE_LABELS[inputType]}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>竞品名称</Label>
                    <Input value={competitorName} onChange={(e) => setCompetitorName(e.target.value)} placeholder="如：竞品A" />
                  </div>
                  <div className="space-y-2">
                    <Label>ASIN（可选）</Label>
                    <Input value={competitorAsin} onChange={(e) => setCompetitorAsin(e.target.value)} placeholder="B0XXXXXXXX" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>脚本内容</Label>
                  <Textarea
                    value={rawContent}
                    onChange={(e) => setRawContent(e.target.value)}
                    placeholder={
                      inputType === "video_url"
                        ? "粘贴视频链接..."
                        : inputType === "listing_extract"
                        ? "粘贴竞品Listing的五点描述和产品特征..."
                        : "粘贴脚本内容（段落结构、镜头描述、旁白文案等）..."
                    }
                    rows={10}
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
                <Button
                  onClick={() => {
                    addMutation.mutate({
                      videoScriptId: scriptId,
                      competitorName: competitorName || undefined,
                      competitorAsin: competitorAsin || undefined,
                      inputType: inputType as any,
                      rawContent,
                    });
                  }}
                  disabled={addMutation.isPending || !rawContent}
                >
                  {addMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  添加
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Competitor List */}
          {competitorList.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">已添加的竞品脚本 ({competitorList.length})</h3>
              {competitorList.map((c: any) => (
                <Card key={c.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">{INPUT_TYPE_LABELS[c.inputType]}</Badge>
                        <span className="font-medium">{c.competitorName || "未命名竞品"}</span>
                        {c.competitorAsin && <span className="text-sm text-muted-foreground">{c.competitorAsin}</span>}
                        {c.structureAnalysis && <Badge className="bg-green-500/10 text-green-600">已分析</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        {!c.structureAnalysis && c.rawContent && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => analyzeMutation.mutate({ competitorScriptId: c.id, rawContent: c.rawContent })}
                            disabled={analyzeMutation.isPending}
                          >
                            {analyzeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                            AI分析
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate({ id: c.id })}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {c.structureAnalysis && (
                      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="font-medium mb-1">结构分析</p>
                          <p className="text-muted-foreground text-xs line-clamp-3">
                            {(() => { try { const s = parseJson(c.structureAnalysis); return s?.narrative_mode || "已完成"; } catch { return "已完成"; } })()}
                          </p>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="font-medium mb-1">优点</p>
                          <p className="text-muted-foreground text-xs line-clamp-3">
                            {(() => { try { const s = parseJson(c.strengths); return Array.isArray(s) ? s.slice(0, 2).join("；") : "已分析"; } catch { return "已分析"; } })()}
                          </p>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="font-medium mb-1">可复用模式</p>
                          <p className="text-muted-foreground text-xs line-clamp-3">
                            {(() => { try { const p = parseJson(c.reusablePatterns); return Array.isArray(p) ? p.slice(0, 2).map((x: any) => x.pattern || x).join("；") : "已分析"; } catch { return "已分析"; } })()}
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {competitorList.filter((c: any) => c.structureAnalysis).length >= 2 && (
                <Button
                  onClick={() => summaryMutation.mutate({ videoScriptId: scriptId })}
                  disabled={summaryMutation.isPending}
                  className="w-full"
                  variant="outline"
                >
                  {summaryMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  生成多竞品汇总分析
                </Button>
              )}

              {summary.data && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="text-base">竞品汇总分析</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-medium mb-1">推荐结构</p>
                        <p className="text-muted-foreground">
                          {(() => { try { const rs = parseJson(summary.data.recommendedStructure); return rs?.narrative_mode || rs?.total_duration_suggestion || "已生成"; } catch { return "已生成"; } })()}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium mb-1">差异化机会</p>
                        <p className="text-muted-foreground">
                          {(() => { try { const d = parseJson(summary.data.differentiableOpportunities); return Array.isArray(d) ? d.slice(0, 2).map((x: any) => x.opportunity || x).join("；") : "已生成"; } catch { return "已生成"; } })()}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <StageFooter onAdvance={onAdvance} onConfirm={onConfirm} isConfirmed={isConfirmed} nextLabel="下一步：产品信息提取" />
    </div>
  );
}

// ─── Stage 0B: Product Info Extraction ──────────────────────────

function Stage0B({ scriptId, projectId, onAdvance, onConfirm, isConfirmed }: {
  scriptId: number; projectId: number; onAdvance: () => void; onConfirm: () => void; isConfirmed: boolean;
}) {
  const snapshot = trpc.videoScript.getProductSnapshot.useQuery({ videoScriptId: scriptId });
  const extractMutation = trpc.videoScript.extractProductInfo.useMutation({
    onSuccess: () => {
      toast.success("产品信息提取完成");
      snapshot.refetch();
    },
    onError: (err) => toast.error(`提取失败: ${err.message}`),
  });

  const snapshotData = snapshot.data as any;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            阶段0B：产品信息自动提取
          </CardTitle>
          <CardDescription>
            从项目中自动提取产品属性、卖点层级、评论痛点、关键词等数据，整合为视频脚本创作所需的产品信息摘要。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
            <Database className="w-8 h-8 text-primary" />
            <div className="flex-1">
              <p className="font-medium">数据来源</p>
              <p className="text-sm text-muted-foreground">
                产品属性文件 · 竞品分析 · Listing内容 · 评论聚合分析 · 关键词库
              </p>
            </div>
            <Button
              onClick={() => extractMutation.mutate({ videoScriptId: scriptId, projectId })}
              disabled={extractMutation.isPending}
            >
              {extractMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {snapshotData ? "重新提取" : "开始提取"}
            </Button>
          </div>

          {snapshotData && (
            <div className="space-y-4">
              {snapshotData.basicInfo && (
                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm">基本信息</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      {Object.entries((parseJson(snapshotData.basicInfo) || {}) as Record<string, string>).map(([k, v]: [string, any]) => (
                        <div key={k}>
                          <p className="text-muted-foreground text-xs">{k}</p>
                          <p className="font-medium">{String(v)}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {snapshotData.sellingPointsHierarchy && (
                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm">卖点层级</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {(parseJson(snapshotData.sellingPointsHierarchy) || []).map((sp: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 p-2 rounded bg-muted/30">
                          <Badge variant={sp.level === "primary" ? "default" : sp.level === "secondary" ? "secondary" : "outline"}>
                            {sp.level === "primary" ? "核心" : sp.level === "secondary" ? "次要" : "必要"}
                          </Badge>
                          <span className="flex-1 text-sm">{sp.point}</span>
                          {sp.evidence && <span className="text-xs text-muted-foreground">{sp.evidence}</span>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {snapshotData.painPoints && (
                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm">评论痛点与化解方案</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>痛点</TableHead>
                          <TableHead>频率</TableHead>
                          <TableHead>视频化解方案</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(parseJson(snapshotData.painPoints) || []).map((pp: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{pp.pain_point}</TableCell>
                            <TableCell>{pp.frequency}</TableCell>
                            <TableCell className="text-muted-foreground">{pp.resolution_suggestion}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {snapshotData.keywords && (
                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm">画面文案关键词</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {(parseJson(snapshotData.keywords) || []).map((kw: string, i: number) => (
                        <Badge key={i} variant="secondary">{kw}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <StageFooter onAdvance={onAdvance} onConfirm={onConfirm} isConfirmed={isConfirmed} nextLabel="下一步：段落规划" canAdvance={!!snapshotData} />
    </div>
  );
}

// ─── Stage 1: Section Planning ──────────────────────────────────

function Stage1({ scriptId, projectId, videoType, targetDuration, onAdvance, onConfirm, isConfirmed }: {
  scriptId: number; projectId: number; videoType: string; targetDuration: number; onAdvance: () => void; onConfirm: () => void; isConfirmed: boolean;
}) {
  const sections = trpc.videoScript.getSections.useQuery({ videoScriptId: scriptId });
  const generateMutation = trpc.videoScript.generateSections.useMutation({
    onSuccess: () => {
      toast.success("段落规划完成");
      sections.refetch();
    },
    onError: (err) => toast.error(`生成失败: ${err.message}`),
  });
  const updateSectionMutation = trpc.videoScript.updateSection.useMutation({
    onSuccess: () => sections.refetch(),
  });
  const reorderMutation = trpc.videoScript.reorderSections.useMutation({
    onSuccess: () => sections.refetch(),
  });

  const sectionList = sections.data || [];
  const totalDuration = sectionList.reduce((sum: number, s: any) => sum + (parseFloat(s.durationBudget) || 0), 0);

  const handleMoveSection = (idx: number, direction: "up" | "down") => {
    const ids = sectionList.map((s: any) => s.id);
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    reorderMutation.mutate({ videoScriptId: scriptId, sectionIds: ids });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            阶段1：卖点分析与段落规划
          </CardTitle>
          <CardDescription>
            AI基于产品卖点和竞品分析，规划视频的段落结构。可排序、调整时长和拍摄方式。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              onClick={() => generateMutation.mutate({ videoScriptId: scriptId, projectId })}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {sectionList.length > 0 ? "重新生成段落" : "AI生成段落规划"}
            </Button>
            <Badge variant="outline" className="text-xs">
              {VIDEO_TYPE_LABELS[videoType]} · {targetDuration}s
            </Badge>
          </div>

          {sectionList.length > 0 && (
            <>
              <DurationValidator videoType={videoType} currentDuration={totalDuration} targetDuration={targetDuration} />

              <div className="space-y-2">
                {sectionList.map((sec: any, idx: number) => (
                  <Card key={sec.id} className="border-l-4 border-l-primary/30">
                    <CardContent className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-0.5">
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleMoveSection(idx, "up")} disabled={idx === 0}>
                            <ArrowUp className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleMoveSection(idx, "down")} disabled={idx === sectionList.length - 1}>
                            <ArrowDown className="w-3 h-3" />
                          </Button>
                        </div>
                        <Badge variant="outline" className="font-mono text-xs shrink-0">{sec.sectionCode}</Badge>
                        <div className="flex-1 min-w-0">
                          <Input
                            value={sec.sectionName}
                            onChange={(e) => updateSectionMutation.mutate({ id: sec.id, sectionName: e.target.value })}
                            className="h-8 text-sm font-medium"
                          />
                        </div>
                        <Select
                          value={sec.shootingMethod || "live_action"}
                          onValueChange={(v) => updateSectionMutation.mutate({ id: sec.id, shootingMethod: v as any })}
                        >
                          <SelectTrigger className="w-28 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(SHOOTING_METHOD_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1 w-20">
                          <Input
                            type="number"
                            value={sec.durationBudget || ""}
                            onChange={(e) => updateSectionMutation.mutate({ id: sec.id, durationBudget: parseFloat(e.target.value) })}
                            className="h-8 text-xs w-14"
                          />
                          <span className="text-xs text-muted-foreground">s</span>
                        </div>
                        <div
                          className="w-16 h-2 rounded-full bg-muted overflow-hidden"
                          title={`${totalDuration > 0 ? ((parseFloat(sec.durationBudget) / totalDuration) * 100).toFixed(1) : 0}%`}
                        >
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${totalDuration > 0 ? (parseFloat(sec.durationBudget) / totalDuration) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                      <div className="ml-12 mt-1 flex items-center gap-2">
                        {sec.sectionNameEn && <p className="text-xs text-muted-foreground">{sec.sectionNameEn}</p>}
                        {(sec as any).description && <p className="text-xs text-muted-foreground/70 italic">| {(sec as any).description}</p>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <StageFooter onAdvance={onAdvance} onConfirm={onConfirm} isConfirmed={isConfirmed} nextLabel="下一步：子主题展开" canAdvance={sectionList.length > 0} />
    </div>
  );
}

// ─── Stage 2: Subtopic Expansion ────────────────────────────────

function Stage2({ scriptId, onAdvance, onConfirm, isConfirmed }: {
  scriptId: number; onAdvance: () => void; onConfirm: () => void; isConfirmed: boolean;
}) {
  const sections = trpc.videoScript.getSections.useQuery({ videoScriptId: scriptId });
  const subtopics = trpc.videoScript.getSubtopics.useQuery({ videoScriptId: scriptId });
  const generateMutation = trpc.videoScript.generateSubtopics.useMutation({
    onSuccess: () => {
      toast.success("子主题展开完成");
      subtopics.refetch();
    },
    onError: (err) => toast.error(`生成失败: ${err.message}`),
  });

  const sectionList = sections.data || [];
  const subtopicList = subtopics.data || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChevronRight className="w-5 h-5" />
            阶段2：子主题展开与镜头数量规划
          </CardTitle>
          <CardDescription>
            将每个段落展开为具体的子主题，并规划每个子主题的镜头数量。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => generateMutation.mutate({ videoScriptId: scriptId })}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {subtopicList.length > 0 ? "重新生成子主题" : "AI展开子主题"}
          </Button>

          {sectionList.map((sec: any) => {
            const subs = subtopicList.filter((s: any) => s.sectionId === sec.id);
            if (subs.length === 0) return null;
            return (
              <Card key={sec.id}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">{sec.sectionCode}</Badge>
                    {sec.sectionName}
                    <span className="text-muted-foreground font-normal">({sec.durationBudget}s)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>子主题</TableHead>
                        <TableHead className="w-24">时长</TableHead>
                        <TableHead className="w-24">镜头数</TableHead>
                        <TableHead>关联卖点</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subs.map((sub: any) => (
                        <TableRow key={sub.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{sub.subtopicName}</p>
                              {sub.subtopicNameEn && <p className="text-xs text-muted-foreground">{sub.subtopicNameEn}</p>}
                            </div>
                          </TableCell>
                          <TableCell>{sub.durationBudget}s</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{sub.shotCount} 镜头</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{sub.sellingPointRef || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </CardContent>
      </Card>

      <StageFooter onAdvance={onAdvance} onConfirm={onConfirm} isConfirmed={isConfirmed} nextLabel="下一步：镜头明细" canAdvance={subtopicList.length > 0} />
    </div>
  );
}

// ─── Stage 3: Shot Details ──────────────────────────────────────

function Stage3({ scriptId, videoType, targetDuration, onAdvance, onConfirm, isConfirmed }: {
  scriptId: number; videoType: string; targetDuration: number; onAdvance: () => void; onConfirm: () => void; isConfirmed: boolean;
}) {
  const [showCnFields, setShowCnFields] = useState(false);
  const [expandedShot, setExpandedShot] = useState<number | null>(null);
  const shots = trpc.videoScript.getShots.useQuery({ videoScriptId: scriptId });
  const generateMutation = trpc.videoScript.generateShots.useMutation({
    onSuccess: () => {
      toast.success("镜头明细生成完成");
      shots.refetch();
    },
    onError: (err) => toast.error(`生成失败: ${err.message}`),
  });
  const updateShotMutation = trpc.videoScript.updateShot.useMutation({
    onSuccess: () => shots.refetch(),
  });
  const deleteShotMutation = trpc.videoScript.deleteShot.useMutation({
    onSuccess: () => {
      toast.success("镜头已删除");
      shots.refetch();
    },
  });
  const addShotMutation = trpc.videoScript.addShot.useMutation({
    onSuccess: () => {
      toast.success("镜头已添加");
      shots.refetch();
    },
  });
  const reorderShotsMutation = trpc.videoScript.reorderShots.useMutation({
    onSuccess: () => shots.refetch(),
  });

  const shotList = shots.data || [];
  const totalDuration = shotList.reduce((sum: number, s: any) => sum + (parseFloat(s.duration) || 0), 0);

  const handleMoveShot = (sectionShots: any[], idx: number, direction: "up" | "down") => {
    const ids = sectionShots.map((s: any) => s.id);
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    reorderShotsMutation.mutate({ subtopicId: sectionShots[0].subtopicId, shotIds: ids });
  };

  // Group by section
  const groupedShots = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const shot of shotList) {
      const key = shot.sectionCode || "unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(shot);
    }
    return groups;
  }, [shotList]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Film className="w-5 h-5" />
            阶段3：逐镜头明细生成
          </CardTitle>
          <CardDescription>
            AI生成完整的拍摄脚本表格，含画面描述、景别、运镜、文案、字幕、道具等字段。可编辑、增删、排序。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Video Type Spec Info */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm">
            <Info className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">
              {VIDEO_TYPE_LABELS[videoType]}: {VIDEO_TYPE_SPECS[videoType]?.description} |
              时长 {VIDEO_TYPE_SPECS[videoType]?.minDuration}-{VIDEO_TYPE_SPECS[videoType]?.maxDuration}s |
              {VIDEO_TYPE_SPECS[videoType]?.resolution} ({VIDEO_TYPE_SPECS[videoType]?.ratio})
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => generateMutation.mutate({ videoScriptId: scriptId })}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {shotList.length > 0 ? "重新生成镜头" : "AI生成镜头明细"}
            </Button>
            {shotList.length > 0 && (
              <>
                <Badge variant="outline" className="text-xs">
                  共 {shotList.length} 镜头
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCnFields(!showCnFields)}
                >
                  {showCnFields ? "隐藏中文字段" : "显示中文字段"}
                </Button>
              </>
            )}
          </div>

          {shotList.length > 0 && (
            <DurationValidator videoType={videoType} currentDuration={totalDuration} targetDuration={targetDuration} />
          )}

          {Object.entries(groupedShots).map(([sectionCode, sectionShots]) => (
            <Card key={sectionCode}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">{sectionCode}</Badge>
                    {sectionShots[0]?.sectionName || sectionCode}
                    <Badge variant="secondary">{sectionShots.length} 镜头</Badge>
                    <span className="text-xs text-muted-foreground font-normal">
                      {sectionShots.reduce((s: number, sh: any) => s + (parseFloat(sh.duration) || 0), 0).toFixed(1)}s
                    </span>
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const firstShot = sectionShots[0];
                      if (firstShot) {
                        addShotMutation.mutate({
                          subtopicId: firstShot.subtopicId,
                          sectionId: firstShot.sectionId,
                          shotDescription: "新镜头 - 请编辑描述",
                          duration: 3,
                        });
                      }
                    }}
                  >
                    <Plus className="w-3 h-3 mr-1" />添加镜头
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">编码</TableHead>
                      <TableHead className="w-14">时长</TableHead>
                      <TableHead className="min-w-[200px]">画面描述</TableHead>
                      <TableHead className="w-20">景别</TableHead>
                      <TableHead className="w-28">运镜</TableHead>
                      <TableHead className="min-w-[120px]">画面文案(EN)</TableHead>
                      <TableHead className="min-w-[120px]">字幕(EN)</TableHead>
                      <TableHead className="min-w-[120px]">旁白(EN)</TableHead>
                      <TableHead className="w-20">策略</TableHead>
                      <TableHead className="w-24">道具</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sectionShots.map((shot: any, shotIdx: number) => (
                      <React.Fragment key={shot.id}>
                      <TableRow className="group">
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-1">
                            <div className="flex flex-col gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button className="p-0 h-3 text-muted-foreground hover:text-foreground" onClick={() => handleMoveShot(sectionShots, shotIdx, "up")} disabled={shotIdx === 0}>
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button className="p-0 h-3 text-muted-foreground hover:text-foreground" onClick={() => handleMoveShot(sectionShots, shotIdx, "down")} disabled={shotIdx === sectionShots.length - 1}>
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>
                            <span className="cursor-pointer" onClick={() => setExpandedShot(expandedShot === shot.id ? null : shot.id)}>{shot.shotCode}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={shot.duration || ""}
                            onChange={(e) => updateShotMutation.mutate({ id: shot.id, duration: parseFloat(e.target.value) })}
                            className="h-7 text-xs w-14"
                            step="0.5"
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={shot.shotDescription || ""}
                            onChange={(e) => updateShotMutation.mutate({ id: shot.id, shotDescription: e.target.value })}
                            className="min-h-[50px] text-xs"
                            rows={2}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={shot.cameraAngle || "medium"}
                            onValueChange={(v) => updateShotMutation.mutate({ id: shot.id, cameraAngle: v as any })}
                          >
                            <SelectTrigger className="h-7 text-xs w-20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(CAMERA_ANGLE_LABELS).map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={shot.cameraMovement || ""}
                            onChange={(e) => updateShotMutation.mutate({ id: shot.id, cameraMovement: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={shot.overlayTextEn || ""}
                            onChange={(e) => updateShotMutation.mutate({ id: shot.id, overlayTextEn: e.target.value })}
                            className="min-h-[36px] text-xs"
                            rows={1}
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={shot.subtitleEn || ""}
                            onChange={(e) => updateShotMutation.mutate({ id: shot.id, subtitleEn: e.target.value })}
                            className="min-h-[36px] text-xs"
                            rows={1}
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={shot.narrationEn || ""}
                            onChange={(e) => updateShotMutation.mutate({ id: shot.id, narrationEn: e.target.value })}
                            className="min-h-[36px] text-xs"
                            rows={1}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={shot.generationStrategy || "real_shoot"}
                            onValueChange={(v) => updateShotMutation.mutate({ id: shot.id, generationStrategy: v as any })}
                          >
                            <SelectTrigger className="h-7 text-xs w-20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(GENERATION_STRATEGY_LABELS).map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={(() => { try { const p = parseJson(shot.props); return Array.isArray(p) ? p.join(", ") : shot.props || ""; } catch { return ""; } })()}
                            onChange={(e) => updateShotMutation.mutate({ id: shot.id, props: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })}
                            className="h-7 text-xs"
                            placeholder="道具"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              if (confirm("确定删除此镜头？")) deleteShotMutation.mutate({ id: shot.id });
                            }}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {/* Expanded row for CN fields and notes */}
                      {(showCnFields || expandedShot === shot.id) && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={11}>
                            <div className="grid grid-cols-4 gap-3 py-1">
                              <div>
                                <Label className="text-xs text-muted-foreground">画面文案(CN)</Label>
                                <Input
                                  value={shot.overlayTextCn || ""}
                                  onChange={(e) => updateShotMutation.mutate({ id: shot.id, overlayTextCn: e.target.value })}
                                  className="h-7 text-xs mt-1"
                                  placeholder="中文画面文案"
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">字幕(CN)</Label>
                                <Input
                                  value={shot.subtitleCn || ""}
                                  onChange={(e) => updateShotMutation.mutate({ id: shot.id, subtitleCn: e.target.value })}
                                  className="h-7 text-xs mt-1"
                                  placeholder="中文字幕"
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">旁白(CN)</Label>
                                <Input
                                  value={shot.narrationCn || ""}
                                  onChange={(e) => updateShotMutation.mutate({ id: shot.id, narrationCn: e.target.value })}
                                  className="h-7 text-xs mt-1"
                                  placeholder="中文旁白"
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">备注</Label>
                                <Input
                                  value={shot.notes || ""}
                                  onChange={(e) => updateShotMutation.mutate({ id: shot.id, notes: e.target.value })}
                                  className="h-7 text-xs mt-1"
                                  placeholder="拍摄备注"
                                />
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <StageFooter onAdvance={onAdvance} onConfirm={onConfirm} isConfirmed={isConfirmed} nextLabel="下一步：剪辑脚本" canAdvance={shotList.length > 0} />
    </div>
  );
}

// ─── Stage 4: Edit Scripts ──────────────────────────────────────

function Stage4({ scriptId, onConfirm, isConfirmed }: {
  scriptId: number; onConfirm: () => void; isConfirmed: boolean;
}) {
  const editScripts = trpc.videoScript.getEditScripts.useQuery({ videoScriptId: scriptId });
  const generateMutation = trpc.videoScript.generateEditScripts.useMutation({
    onSuccess: () => {
      toast.success("剪辑脚本生成完成");
      editScripts.refetch();
    },
    onError: (err) => toast.error(`生成失败: ${err.message}`),
  });
  const updateMutation = trpc.videoScript.updateEditScript.useMutation({
    onSuccess: () => editScripts.refetch(),
  });
  // Export functionality - TODO: implement exportToExcel backend endpoint
  const exportMutation = {
    mutate: (_args: { videoScriptId: number }) => toast.info("Excel导出功能即将上线"),
    isPending: false,
  };

  const editList = editScripts.data || [];

  const PURPOSE_LABELS: Record<string, string> = {
    spv_ad: "SPV广告",
    sbv_ad: "SBV广告",
    main_listing: "主图视频",
    aplus: "A+视频",
    social_media: "社媒短视频",
    other: "其他",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scissors className="w-5 h-5" />
            阶段4：剪辑脚本生成
          </CardTitle>
          <CardDescription>
            基于拍摄脚本的段落结构，AI生成多个不同用途的剪辑方案（主图视频、广告、A+、社媒等）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => generateMutation.mutate({ videoScriptId: scriptId })}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {editList.length > 0 ? "重新生成剪辑方案" : "AI生成剪辑脚本"}
          </Button>

          {editList.length > 0 && (
            <div className="grid gap-4">
              {editList.map((es: any) => {
                const mapping = parseJson(es.sectionMapping) || [];
                return (
                  <Card key={es.id} className="border-l-4 border-l-primary/30">
                    <CardHeader className="py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CardTitle className="text-base">{es.editName}</CardTitle>
                          <Badge>{PURPOSE_LABELS[es.videoPurpose] || es.videoPurpose}</Badge>
                          <Badge variant="outline">{es.maxDuration}s</Badge>
                        </div>
                        <Button
                          size="sm"
                          variant={es.userConfirmed ? "default" : "outline"}
                          onClick={() => updateMutation.mutate({ id: es.id, userConfirmed: !es.userConfirmed })}
                        >
                          {es.userConfirmed ? <Check className="w-4 h-4 mr-1" /> : <Edit3 className="w-4 h-4 mr-1" />}
                          {es.userConfirmed ? "已确认" : "确认方案"}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">剪辑风格：</span>
                          <span>{es.editStyle}</span>
                        </div>
                        {es.description && (
                          <p className="text-sm text-muted-foreground">{es.description}</p>
                        )}
                        {Array.isArray(mapping) && mapping.length > 0 && (
                          <div>
                            <p className="text-sm font-medium mb-2">段落组合：</p>
                            <div className="flex flex-wrap gap-2">
                              {mapping.map((m: any, i: number) => (
                                <Badge
                                  key={i}
                                  variant={m.include ? "default" : "outline"}
                                  className={!m.include ? "opacity-50 line-through" : ""}
                                >
                                  {m.section_code}
                                  {m.trim_strategy && <span className="ml-1 font-normal">({m.trim_strategy})</span>}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completion */}
      {editList.length > 0 && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="py-6 text-center">
            <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-3" />
            <h3 className="text-lg font-semibold">视频脚本创作完成</h3>
            <p className="text-muted-foreground mt-1">
              所有六个阶段已完成，您可以导出完整的拍摄脚本和剪辑方案。
            </p>
            <div className="flex justify-center gap-3 mt-4">
              <Button
                variant="outline"
                onClick={() => exportMutation.mutate({ videoScriptId: scriptId })}
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                导出Excel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <StageFooter onConfirm={onConfirm} isConfirmed={isConfirmed} />
    </div>
  );
}
