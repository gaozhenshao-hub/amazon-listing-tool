import { useState, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Lock, Unlock, Edit2, Save, X, Check, Globe, Download,
  Loader2, ChevronDown, ChevronRight, Eye, EyeOff,
  Upload, Image, FileText, QrCode, ArrowRight, ArrowLeft,
  Trash2, Plus, CheckCircle2, Circle, AlertCircle, Palette,
  Type, Sparkles, Printer, ExternalLink, BookOpen,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Chapter {
  key: string;
  titleEn: string;
  titleEs: string;
  contentEn: string;
  contentEs: string;
  confirmed?: boolean;
  imageUrl?: string;
}

interface ManualEditorProps {
  manual: any;
  projectId: number;
}

// ─── Theme Color Presets ─────────────────────────────────────────
const COLOR_PRESETS = [
  { color: "#1a1a2e", name: "Deep Navy" },
  { color: "#2563eb", name: "Royal Blue" },
  { color: "#0f766e", name: "Teal" },
  { color: "#7c3aed", name: "Purple" },
  { color: "#dc2626", name: "Red" },
  { color: "#ea580c", name: "Orange" },
  { color: "#374151", name: "Charcoal" },
  { color: "#059669", name: "Emerald" },
  { color: "#0891b2", name: "Cyan" },
  { color: "#be185d", name: "Pink" },
];

// ─── Step Indicator ─────────────────────────────────────────────
function StepIndicator({ currentStep, steps }: { currentStep: number; steps: { label: string; desc: string }[] }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((step, idx) => {
        const isActive = idx === currentStep;
        const isDone = idx < currentStep;
        return (
          <div key={idx} className="flex items-center gap-2 flex-1">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg flex-1 transition-all ${
              isActive ? "bg-primary/10 border border-primary/30" : isDone ? "bg-emerald-50 border border-emerald-200" : "bg-muted/30 border border-transparent"
            }`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                isActive ? "bg-primary text-primary-foreground" : isDone ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
              }`}>
                {isDone ? <Check className="h-3.5 w-3.5" /> : idx + 1}
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${isActive ? "text-primary" : isDone ? "text-emerald-700" : "text-muted-foreground"}`}>{step.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{step.desc}</p>
              </div>
            </div>
            {idx < steps.length - 1 && (
              <ArrowRight className={`h-4 w-4 shrink-0 ${isDone ? "text-emerald-500" : "text-muted-foreground/30"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Asset Upload Card ──────────────────────────────────────────
function AssetUploadCard({
  label, desc, icon: Icon, assetType, currentUrl, projectId, onUploaded, accept,
}: {
  label: string; desc: string; icon: any; assetType: string;
  currentUrl?: string | null; projectId: number;
  onUploaded: (url: string) => void;
  accept?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadMut = trpc.devManual.uploadManualAsset.useMutation({
    onSuccess: (data) => {
      toast.success(`${label}上传成功`);
      onUploaded(data.url);
    },
    onError: (err: any) => toast.error(`上传失败: ${err.message}`),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件大小不能超过10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMut.mutate({
        projectId,
        assetType: assetType as any,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <div>
            <p className="text-xs font-medium">{label}</p>
            <p className="text-[10px] text-muted-foreground">{desc}</p>
          </div>
        </div>
        <Button
          size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
          onClick={() => fileRef.current?.click()}
          disabled={uploadMut.isPending}
        >
          {uploadMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {currentUrl ? "更换" : "上传"}
        </Button>
      </div>
      {currentUrl && (
        <div className="flex items-center gap-2">
          {assetType === "reference" ? (
            <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />查看参考说明书
            </a>
          ) : (
            <img src={currentUrl} alt={label} className="h-16 rounded border object-contain" />
          )}
          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200">已上传</Badge>
        </div>
      )}
      <input ref={fileRef} type="file" accept={accept || "image/*"} className="hidden" onChange={handleFile} />
    </div>
  );
}

// ─── Theme Picker ───────────────────────────────────────────────
function ThemePicker({
  themes, fonts, selectedTheme, selectedColor, selectedFont,
  onThemeChange, onColorChange, onFontChange, saving,
}: {
  themes: any[]; fonts: any[];
  selectedTheme: string; selectedColor: string; selectedFont: string;
  onThemeChange: (t: string) => void; onColorChange: (c: string) => void; onFontChange: (f: string) => void;
  saving: boolean;
}) {
  const [customColor, setCustomColor] = useState(selectedColor);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          排版主题与样式
          {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Theme Style */}
        <div>
          <p className="text-xs font-medium mb-2">排版风格</p>
          <div className="grid grid-cols-5 gap-2">
            {themes.map((t: any) => (
              <button
                key={t.id}
                onClick={() => onThemeChange(t.id)}
                className={`p-2 rounded-lg border text-center transition-all hover:shadow-md ${
                  selectedTheme === t.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-muted hover:border-primary/30"
                }`}
              >
                <div className="w-full h-8 rounded mb-1.5" style={{
                  background: t.id === "classic" ? `linear-gradient(135deg, ${t.defaultColor}, ${t.defaultColor}dd)` :
                    t.id === "modern" ? "#fff" :
                    t.id === "minimal" ? "#fff" :
                    t.id === "business" ? `linear-gradient(180deg, #fff, ${t.defaultColor}15)` :
                    t.defaultColor,
                  border: t.id === "modern" || t.id === "minimal" ? "1px solid #eee" : "none",
                }} />
                <p className="text-[10px] font-medium">{t.nameZh}</p>
                <p className="text-[9px] text-muted-foreground">{t.name}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Theme Color */}
        <div>
          <p className="text-xs font-medium mb-2">主题颜色</p>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.color}
                onClick={() => { onColorChange(c.color); setCustomColor(c.color); }}
                className={`w-7 h-7 rounded-full border-2 transition-all hover:scale-110 ${
                  selectedColor === c.color ? "border-foreground ring-2 ring-primary/30 scale-110" : "border-transparent"
                }`}
                style={{ background: c.color }}
                title={c.name}
              />
            ))}
            <div className="flex items-center gap-1 ml-2">
              <input
                type="color"
                value={customColor}
                onChange={(e) => { setCustomColor(e.target.value); onColorChange(e.target.value); }}
                className="w-7 h-7 rounded cursor-pointer border-0 p-0"
              />
              <span className="text-[10px] text-muted-foreground">自定义</span>
            </div>
          </div>
        </div>

        {/* Font Scheme */}
        <div>
          <p className="text-xs font-medium mb-2">字体方案</p>
          <div className="grid grid-cols-5 gap-2">
            {fonts.map((f: any) => (
              <button
                key={f.id}
                onClick={() => onFontChange(f.id)}
                className={`p-2 rounded-lg border text-center transition-all ${
                  selectedFont === f.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-muted hover:border-primary/30"
                }`}
              >
                <Type className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                <p className="text-[10px] font-medium">{f.nameZh}</p>
                <p className="text-[9px] text-muted-foreground">{f.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main ManualEditor Component ────────────────────────────────
export default function ManualEditor({ manual, projectId }: ManualEditorProps) {
  const utils = trpc.useUtils();
  const [currentStep, setCurrentStep] = useState(0);

  // Theme state
  const [themeStyle, setThemeStyle] = useState((manual as any)?.themeStyle || "classic");
  const [themeColor, setThemeColor] = useState((manual as any)?.themeColor || "#1a1a2e");
  const [fontScheme, setFontScheme] = useState((manual as any)?.fontScheme || "default");

  // Chapter state
  const [chapters, setChapters] = useState<Chapter[]>(() => {
    try { return manual?.contentSections ? JSON.parse(manual.contentSections) : []; } catch { return []; }
  });
  const [originalChapters, setOriginalChapters] = useState<Chapter[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Chapter | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [uploadingChapterIdx, setUploadingChapterIdx] = useState<number | null>(null);
  const chapterImageRef = useRef<HTMLInputElement>(null);

  // Brand info
  const [brandName, setBrandName] = useState(manual?.brandName || "");
  const [logoUrl, setLogoUrl] = useState(manual?.logoUrl || "");
  const [coverUrl, setCoverUrl] = useState(manual?.coverImageUrl || "");
  const [qrCodeUrl, setQrCodeUrl] = useState(manual?.qrCodeUrl || "");
  const [referenceUrl, setReferenceUrl] = useState((manual as any)?.referenceManualUrl || "");

  // Preview
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<"en" | "es">("en");

  // Assets
  const assetsQuery = trpc.devManual.getManualAssets.useQuery({ projectId });
  const assets = assetsQuery.data || [];
  const contentBgUrl = useMemo(() => {
    const bg = assets.find((a: any) => a.assetType === "content_bg");
    return bg?.fileUrl || "";
  }, [assets]);

  // Theme presets
  const presetsQuery = trpc.devManual.getThemePresets.useQuery();
  const themes = presetsQuery.data?.themes || [];
  const fonts = presetsQuery.data?.fonts || [];

  // Mutations
  const generateMut = trpc.devManual.generateManual.useMutation({
    onSuccess: (data) => {
      setChapters(data.chapters);
      setOriginalChapters(JSON.parse(JSON.stringify(data.chapters)));
      toast.success("9章节内容已生成");
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const saveMutation = trpc.devManual.saveManual.useMutation({
    onSuccess: () => { utils.devManual.getManual.invalidate({ projectId }); },
    onError: (err: any) => toast.error(`保存失败: ${err.message}`),
  });

  const htmlMutation = trpc.devManual.generateHtml.useMutation({
    onSuccess: (data) => {
      toast.success("双语HTML说明书已生成");
      utils.devManual.getManual.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const previewMut = trpc.devManual.previewHtml.useMutation({
    onSuccess: (data) => { setPreviewHtml(data.html); },
    onError: (err: any) => toast.error(`预览失败: ${err.message}`),
  });

  const pdfMutation = trpc.devManual.exportPdf.useMutation({
    onSuccess: (data) => {
      // Open print-ready HTML in new tab for browser print-to-PDF
      const blob = new Blob([data.html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) {
        w.onload = () => {
          setTimeout(() => w.print(), 500);
        };
      }
      toast.success("PDF打印页面已打开，请使用浏览器打印功能保存为PDF");
    },
    onError: (err: any) => toast.error(`导出失败: ${err.message}`),
  });

  const themeConfigMut = trpc.devManual.saveThemeConfig.useMutation({
    onSuccess: () => { utils.devManual.getManual.invalidate({ projectId }); },
  });

  const analyzeRefMut = trpc.devManual.analyzeReference.useMutation({
    onSuccess: (data) => {
      toast.success("参考说明书分析完成");
      if (data.recommendedTheme) setThemeStyle(data.recommendedTheme);
      if (data.recommendedColor) setThemeColor(data.recommendedColor);
      if (data.recommendedFont) setFontScheme(data.recommendedFont);
      // Auto-save recommended theme
      themeConfigMut.mutate({
        projectId,
        themeStyle: data.recommendedTheme || "classic",
        themeColor: data.recommendedColor || "#1a1a2e",
        fontScheme: data.recommendedFont || "default",
      });
    },
    onError: (err: any) => toast.error(`分析失败: ${err.message}`),
  });

  // Derived
  const confirmedCount = chapters.filter(c => c.confirmed).length;
  const allConfirmed = chapters.length > 0 && confirmedCount === chapters.length;

  // Handlers
  const handleThemeChange = useCallback((t: string) => {
    setThemeStyle(t);
    themeConfigMut.mutate({ projectId, themeStyle: t as any, themeColor, fontScheme: fontScheme as any });
  }, [projectId, themeColor, fontScheme]);

  const handleColorChange = useCallback((c: string) => {
    setThemeColor(c);
    themeConfigMut.mutate({ projectId, themeStyle: themeStyle as any, themeColor: c, fontScheme: fontScheme as any });
  }, [projectId, themeStyle, fontScheme]);

  const handleFontChange = useCallback((f: string) => {
    setFontScheme(f);
    themeConfigMut.mutate({ projectId, themeStyle: themeStyle as any, themeColor, fontScheme: f as any });
  }, [projectId, themeStyle, themeColor]);

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditDraft({ ...chapters[idx] });
    setExpandedIdx(idx);
  };

  const cancelEdit = () => { setEditingIdx(null); setEditDraft(null); };

  const saveEdit = () => {
    if (editingIdx === null || !editDraft) return;
    const updated = [...chapters];
    updated[editingIdx] = { ...editDraft };
    setChapters(updated);
    saveMutation.mutate({
      projectId,
      chapters: JSON.stringify(updated),
      brandName, logoUrl, coverImageUrl: coverUrl, qrCodeUrl,
      status: "editing",
    });
    setEditingIdx(null);
    setEditDraft(null);
  };

  const confirmChapter = (idx: number) => {
    const updated = [...chapters];
    updated[idx].confirmed = true;
    setChapters(updated);
    saveMutation.mutate({ projectId, chapters: JSON.stringify(updated), status: "editing" });
  };

  const unlockChapter = (idx: number) => {
    const updated = [...chapters];
    updated[idx].confirmed = false;
    setChapters(updated);
    saveMutation.mutate({ projectId, chapters: JSON.stringify(updated), status: "editing" });
  };

  const handleChapterImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploadingChapterIdx === null) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      const idx = uploadingChapterIdx;
      const chKey = chapters[idx]?.key || `ch${idx}`;
      trpc.devManual.uploadManualAsset.useMutation.prototype; // type hint only
      // Use inline mutation
      const updated = [...chapters];
      // For simplicity, store as data URL temporarily then save
      updated[idx] = { ...updated[idx], imageUrl: reader.result as string };
      setChapters(updated);
      if (editDraft && editingIdx === idx) {
        setEditDraft({ ...editDraft, imageUrl: reader.result as string });
      }
      toast.success("章节图片已添加");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handlePreview = (lang: "en" | "es") => {
    setPreviewLang(lang);
    previewMut.mutate({ projectId, language: lang });
  };

  const steps = [
    { label: "素材上传", desc: "Logo/封面/底图/二维码" },
    { label: "内容编辑", desc: "AI生成+人工编辑确认" },
    { label: "生成说明书", desc: "双语HTML/PDF导出" },
  ];

  return (
    <div className="space-y-4">
      <StepIndicator currentStep={currentStep} steps={steps} />

      {/* ─── Step 0: Assets + Theme + Reference ─── */}
      {currentStep === 0 && (
        <div className="space-y-4">
          {/* Brand Name */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                品牌信息
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium whitespace-nowrap">品牌名称</label>
                <Input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="输入品牌名称"
                  className="max-w-xs text-sm"
                />
              </div>
            </CardContent>
          </Card>

          {/* Asset Uploads */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Image className="h-4 w-4 text-primary" />
                素材上传
              </CardTitle>
              <p className="text-xs text-muted-foreground">上传Logo、封面底图、内容页底图和社媒二维码等素材</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <AssetUploadCard
                  label="品牌Logo" desc="PNG/SVG, 建议透明背景" icon={Image}
                  assetType="logo" currentUrl={logoUrl} projectId={projectId}
                  onUploaded={(url) => setLogoUrl(url)}
                />
                <AssetUploadCard
                  label="封面底图" desc="封面页背景图片" icon={Image}
                  assetType="cover" currentUrl={coverUrl} projectId={projectId}
                  onUploaded={(url) => setCoverUrl(url)}
                />
                <AssetUploadCard
                  label="内容页底图" desc="章节页面背景/水印" icon={Image}
                  assetType="content_bg" currentUrl={contentBgUrl} projectId={projectId}
                  onUploaded={() => assetsQuery.refetch()}
                />
                <AssetUploadCard
                  label="社媒二维码" desc="社交媒体主页二维码" icon={QrCode}
                  assetType="qrcode" currentUrl={qrCodeUrl} projectId={projectId}
                  onUploaded={(url) => setQrCodeUrl(url)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Reference Manual Upload */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-amber-600" />
                参考说明书
                <Badge variant="outline" className="text-[10px]">可选</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">上传竞品或参考说明书，AI将分析其设计风格并推荐最佳排版方案</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <AssetUploadCard
                label="参考说明书" desc="PDF/图片格式, 最大10MB" icon={FileText}
                assetType="reference" currentUrl={referenceUrl} projectId={projectId}
                onUploaded={(url) => setReferenceUrl(url)}
                accept="image/*,.pdf"
              />
              {referenceUrl && (
                <Button
                  size="sm" variant="outline" className="gap-1 text-xs"
                  onClick={() => analyzeRefMut.mutate({ projectId })}
                  disabled={analyzeRefMut.isPending}
                >
                  {analyzeRefMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  AI分析参考说明书
                </Button>
              )}
              {(manual as any)?.referenceManualNotes && (() => {
                try {
                  const notes = JSON.parse((manual as any).referenceManualNotes);
                  return (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs font-medium text-amber-800">AI分析结果</p>
                      <p className="text-xs text-amber-700">{notes.analysis || notes}</p>
                      {notes.designHighlights && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(notes.designHighlights as string[]).map((h: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px] border-amber-300 text-amber-700">{h}</Badge>
                          ))}
                        </div>
                      )}
                      {notes.recommendedTheme && (
                        <p className="text-[10px] text-amber-600">
                          推荐: {notes.recommendedTheme} 主题 | {notes.recommendedColor} | {notes.recommendedFont} 字体
                        </p>
                      )}
                    </div>
                  );
                } catch { return null; }
              })()}
            </CardContent>
          </Card>

          {/* Theme Picker */}
          {themes.length > 0 && (
            <ThemePicker
              themes={themes} fonts={fonts}
              selectedTheme={themeStyle} selectedColor={themeColor} selectedFont={fontScheme}
              onThemeChange={handleThemeChange} onColorChange={handleColorChange} onFontChange={handleFontChange}
              saving={themeConfigMut.isPending}
            />
          )}

          <div className="flex justify-end">
            <Button onClick={() => {
              if (!brandName.trim()) {
                toast.error("请输入品牌名称");
                return;
              }
              // Save brand info before proceeding
              saveMutation.mutate({
                projectId,
                chapters: chapters.length > 0 ? JSON.stringify(chapters) : "[]",
                brandName, logoUrl, coverImageUrl: coverUrl, qrCodeUrl,
              });
              setCurrentStep(1);
            }} className="gap-1">
              下一步：内容编辑 <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── Step 1: AI Generate + Edit Chapters ─── */}
      {currentStep === 1 && (
        <div className="space-y-4">
          {/* Generate Button */}
          {chapters.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center space-y-4">
                <Sparkles className="h-10 w-10 mx-auto text-primary/40" />
                <div>
                  <p className="text-sm font-medium">AI生成说明书内容</p>
                  <p className="text-xs text-muted-foreground mt-1">基于产品画像和BOM信息，自动生成9章节双语内容</p>
                </div>
                <Button onClick={() => generateMut.mutate({ projectId })} disabled={generateMut.isPending} className="gap-2">
                  {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {generateMut.isPending ? "AI正在生成..." : "开始生成"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Regenerate */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">共 {chapters.length} 章节，{confirmedCount} 已确认</p>
                <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => generateMut.mutate({ projectId })} disabled={generateMut.isPending}>
                  {generateMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  重新生成
                </Button>
              </div>

              {/* Chapter List */}
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left p-2 w-8">#</th>
                          <th className="text-left p-2">章节</th>
                          <th className="text-left p-2 hidden md:table-cell">英文标题</th>
                          <th className="text-left p-2 hidden md:table-cell">西语标题</th>
                          <th className="text-center p-2 w-16">状态</th>
                          <th className="text-right p-2 w-28">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chapters.map((ch, idx) => {
                          const isExpanded = expandedIdx === idx;
                          return (
                            <tr
                              key={idx}
                              className={`border-b hover:bg-muted/20 cursor-pointer transition-colors ${isExpanded ? "bg-blue-50/50" : ""}`}
                              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                            >
                              <td className="p-2 text-muted-foreground">{idx + 1}</td>
                              <td className="p-2">
                                <div className="flex items-center gap-1.5">
                                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  <span className="font-medium">{ch.key}</span>
                                  {ch.imageUrl && <Image className="h-3 w-3 text-blue-500" />}
                                </div>
                              </td>
                              <td className="p-2 hidden md:table-cell text-muted-foreground truncate max-w-[200px]">{ch.titleEn}</td>
                              <td className="p-2 hidden md:table-cell text-muted-foreground truncate max-w-[200px]">{ch.titleEs}</td>
                              <td className="p-2 text-center">
                                {ch.confirmed ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                                ) : (
                                  <Circle className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                                )}
                              </td>
                              <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1">
                                  {!ch.confirmed ? (
                                    <>
                                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-blue-600" onClick={() => startEdit(idx)}>
                                        <Edit2 className="h-3 w-3 mr-1" />编辑
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-emerald-600" onClick={() => confirmChapter(idx)}>
                                        <Check className="h-3 w-3 mr-1" />确认
                                      </Button>
                                    </>
                                  ) : (
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-600" onClick={() => unlockChapter(idx)}>
                                      <Unlock className="h-3 w-3 mr-1" />解锁
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Hidden file input for chapter images */}
              <input ref={chapterImageRef} type="file" accept="image/*" className="hidden" onChange={handleChapterImageFile} />

              {/* Expanded Chapter Detail / Edit */}
              {expandedIdx !== null && (
                <Card className="border-blue-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs">Ch.{expandedIdx + 1}</span>
                      {editingIdx === expandedIdx ? "编辑章节" : chapters[expandedIdx].titleEn || chapters[expandedIdx].key}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {editingIdx === expandedIdx && editDraft ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-medium text-blue-600 mb-1 block">英文标题</label>
                            <Input value={editDraft.titleEn} onChange={(e) => setEditDraft({ ...editDraft, titleEn: e.target.value })} className="text-sm" />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-orange-600 mb-1 block">西语标题</label>
                            <Input value={editDraft.titleEs} onChange={(e) => setEditDraft({ ...editDraft, titleEs: e.target.value })} className="text-sm" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-medium text-blue-600 mb-1 block">英文内容</label>
                            <Textarea value={editDraft.contentEn} onChange={(e) => setEditDraft({ ...editDraft, contentEn: e.target.value })} rows={10} className="text-sm font-mono" />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-orange-600 mb-1 block">西语内容</label>
                            <Textarea value={editDraft.contentEs} onChange={(e) => setEditDraft({ ...editDraft, contentEs: e.target.value })} rows={10} className="text-sm font-mono" />
                          </div>
                        </div>

                        {/* Chapter Image */}
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">章节配图</label>
                          <div className="flex items-center gap-3">
                            {editDraft.imageUrl ? (
                              <img src={editDraft.imageUrl} alt="" className="h-20 rounded border object-contain" />
                            ) : (
                              <div className="h-20 w-20 rounded border border-dashed flex items-center justify-center text-muted-foreground">
                                <Image className="h-6 w-6 opacity-30" />
                              </div>
                            )}
                            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => {
                              setUploadingChapterIdx(expandedIdx);
                              chapterImageRef.current?.click();
                            }}>
                              <Upload className="h-3 w-3" />{editDraft.imageUrl ? "更换图片" : "上传图片"}
                            </Button>
                          </div>
                        </div>

                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="outline" onClick={() => setShowComparison(!showComparison)} className="gap-1 text-xs">
                            {showComparison ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            {showComparison ? "隐藏对比" : "AI原版对比"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit} className="gap-1">
                            <X className="h-3 w-3" />取消
                          </Button>
                          <Button size="sm" onClick={saveEdit} disabled={saveMutation.isPending} className="gap-1">
                            {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            保存
                          </Button>
                        </div>

                        {showComparison && originalChapters[expandedIdx] && (
                          <div className="border-t pt-4 mt-4">
                            <p className="text-xs font-medium text-muted-foreground mb-2">AI原版内容（对比参考）</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
                              <div>
                                <p className="text-xs text-blue-600 mb-1">English (Original)</p>
                                <p className="text-xs whitespace-pre-wrap bg-muted/30 p-2 rounded max-h-40 overflow-y-auto">{originalChapters[expandedIdx].contentEn || "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs text-orange-600 mb-1">Espanol (Original)</p>
                                <p className="text-xs whitespace-pre-wrap bg-muted/30 p-2 rounded max-h-40 overflow-y-auto">{originalChapters[expandedIdx].contentEs || "—"}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {chapters[expandedIdx].imageUrl && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">章节配图</p>
                            <img src={chapters[expandedIdx].imageUrl} alt="" className="max-h-32 rounded border object-contain" />
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-medium text-blue-600 mb-1">English</p>
                            <p className="text-sm whitespace-pre-wrap">{chapters[expandedIdx].contentEn || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-orange-600 mb-1">Espanol</p>
                            <p className="text-sm whitespace-pre-wrap">{chapters[expandedIdx].contentEs || "—"}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Progress Bar */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${chapters.length > 0 ? (confirmedCount / chapters.length) * 100 : 0}%` }} />
                </div>
                <span>{confirmedCount}/{chapters.length} 章已确认</span>
              </div>
            </>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(0)} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> 上一步
            </Button>
            <Button
              onClick={() => {
                if (!allConfirmed) {
                  toast.error("请先确认所有章节内容");
                  return;
                }
                setCurrentStep(2);
              }}
              disabled={chapters.length === 0}
              className="gap-1"
            >
              下一步：生成说明书 <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── Step 2: Generate + Preview + PDF ─── */}
      {currentStep === 2 && (
        <div className="space-y-4">
          {/* Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                生成双语版说明书
              </CardTitle>
              <p className="text-xs text-muted-foreground">结合素材、主题配置和章节内容，生成英文和西班牙语两个版本</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-primary">{chapters.length}</p>
                  <p className="text-xs text-muted-foreground">总章节</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{confirmedCount}</p>
                  <p className="text-xs text-muted-foreground">已确认</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{assets.length}</p>
                  <p className="text-xs text-muted-foreground">素材数</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: `${themeColor}10` }}>
                  <div className="w-8 h-8 rounded-full mx-auto mb-1" style={{ background: themeColor }} />
                  <p className="text-xs text-muted-foreground">{themeStyle}</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-purple-600 truncate">{brandName || "—"}</p>
                  <p className="text-xs text-muted-foreground">品牌</p>
                </div>
              </div>

              {/* Asset Check */}
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium">素材检查</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                  {[
                    { label: "Logo", ok: !!logoUrl },
                    { label: "封面底图", ok: !!coverUrl },
                    { label: "内容底图", ok: !!contentBgUrl },
                    { label: "二维码", ok: !!qrCodeUrl },
                    { label: "参考说明书", ok: !!referenceUrl },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5 p-1.5 rounded bg-muted/20">
                      {item.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-500" />}
                      <span className={item.ok ? "text-emerald-700" : "text-amber-600"}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Generated Files */}
              {(manual?.htmlEnUrl || manual?.htmlEsUrl) && (
                <div className="border rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium">已生成文件</p>
                  <div className="flex gap-3 flex-wrap">
                    {manual?.htmlEnUrl && (
                      <a href={manual.htmlEnUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
                        <Globe className="h-3.5 w-3.5" />English HTML
                      </a>
                    )}
                    {manual?.htmlEsUrl && (
                      <a href={manual.htmlEsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-orange-600 hover:underline">
                        <Globe className="h-3.5 w-3.5" />Spanish HTML
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Button
                  onClick={() => htmlMutation.mutate({ projectId })}
                  disabled={htmlMutation.isPending || !allConfirmed}
                  className="gap-2"
                  size="lg"
                >
                  {htmlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                  生成双语HTML说明书
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handlePreview("en")}
                    disabled={previewMut.isPending || chapters.length === 0}
                    className="gap-1"
                  >
                    {previewMut.isPending && previewLang === "en" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    预览EN
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handlePreview("es")}
                    disabled={previewMut.isPending || chapters.length === 0}
                    className="gap-1"
                  >
                    {previewMut.isPending && previewLang === "es" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    预览ES
                  </Button>
                </div>
              </div>

              {/* PDF Export */}
              <div className="border-t pt-4">
                <p className="text-xs font-medium mb-2 flex items-center gap-1.5">
                  <Printer className="h-3.5 w-3.5" />
                  PDF导出（方便打印）
                </p>
                <p className="text-[10px] text-muted-foreground mb-3">点击后将打开打印预览页面，使用浏览器"打印"功能保存为PDF文件</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => pdfMutation.mutate({ projectId, language: "en" })}
                    disabled={pdfMutation.isPending || chapters.length === 0}
                    className="gap-1"
                  >
                    {pdfMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    下载PDF (English)
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => pdfMutation.mutate({ projectId, language: "es" })}
                    disabled={pdfMutation.isPending || chapters.length === 0}
                    className="gap-1"
                  >
                    {pdfMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    下载PDF (Spanish)
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Live Preview */}
          {previewHtml && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Eye className="h-4 w-4 text-primary" />
                    实时预览 ({previewLang === "en" ? "English" : "Spanish"})
                  </CardTitle>
                  <div className="flex gap-1">
                    <Button size="sm" variant={previewLang === "en" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => handlePreview("en")}>EN</Button>
                    <Button size="sm" variant={previewLang === "es" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => handlePreview("es")}>ES</Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setPreviewHtml(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden bg-white" style={{ height: "600px" }}>
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full h-full border-0"
                    title="Manual Preview"
                    sandbox="allow-same-origin"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(1)} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> 上一步
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
