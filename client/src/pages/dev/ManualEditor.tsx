import { useState, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Lock, Unlock, Edit2, Save, X, Check, Globe, Download,
  Loader2, ChevronDown, ChevronRight, Eye, EyeOff,
  Upload, Image, FileText, QrCode, ArrowRight, ArrowLeft,
  Trash2, Plus, CheckCircle2, Circle, AlertCircle,
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
  label, desc, icon: Icon, assetType, currentUrl, projectId, onUploaded,
}: {
  label: string; desc: string; icon: any; assetType: string;
  currentUrl?: string | null; projectId: number;
  onUploaded: (url: string) => void;
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
    if (file.size > 5 * 1024 * 1024) {
      toast.error("文件大小不能超过5MB");
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
    <div className="border rounded-lg p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${currentUrl ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
          {currentUrl ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">{label}</span>
            {currentUrl && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">已上传</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mb-2">{desc}</p>
          {currentUrl && (
            <div className="mb-2">
              <img src={currentUrl} alt={label} className="h-16 rounded border object-contain bg-muted/20" />
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <Button
            size="sm" variant="outline" className="gap-1 text-xs"
            onClick={() => fileRef.current?.click()}
            disabled={uploadMut.isPending}
          >
            {uploadMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {currentUrl ? "重新上传" : "上传"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ManualEditor ──────────────────────────────────────────
export default function ManualEditor({ manual, projectId }: ManualEditorProps) {
  const utils = trpc.useUtils();
  const [currentStep, setCurrentStep] = useState(0);

  // Parse chapters from manual
  const originalChapters = useMemo<Chapter[]>(() => {
    try {
      const parsed = JSON.parse(manual?.contentSections || "[]");
      return parsed.map((ch: any) => ({
        key: ch.key || "",
        titleEn: ch.titleEn || "",
        titleEs: ch.titleEs || "",
        contentEn: ch.contentEn || "",
        contentEs: ch.contentEs || "",
        confirmed: ch.confirmed ?? false,
        imageUrl: ch.imageUrl || "",
      }));
    } catch {
      return [];
    }
  }, [manual?.contentSections]);

  const [chapters, setChapters] = useState<Chapter[]>(originalChapters);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Chapter | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [brandName, setBrandName] = useState(manual?.brandName || "");

  // Assets query
  const assetsQuery = trpc.devManual.getManualAssets.useQuery({ projectId });
  const assets = assetsQuery.data || [];

  // Get current asset URLs
  const logoUrl = manual?.logoUrl || assets.find((a: any) => a.assetType === "logo")?.fileUrl || "";
  const coverUrl = manual?.coverImageUrl || assets.find((a: any) => a.assetType === "cover")?.fileUrl || "";
  const contentBgUrl = assets.find((a: any) => a.assetType === "content_bg")?.fileUrl || "";
  const qrCodeUrl = manual?.qrCodeUrl || assets.find((a: any) => a.assetType === "qrcode")?.fileUrl || "";

  // Mutations
  const saveMutation = trpc.devManual.saveManual.useMutation({
    onSuccess: () => {
      toast.success("说明书已保存");
      utils.devManual.getManual.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`保存失败: ${err.message}`),
  });

  const generateMutation = trpc.devManual.generateManual.useMutation({
    onSuccess: (data: any) => {
      toast.success("AI内容生成完成");
      if (data.chapters) {
        setChapters(data.chapters);
        setCurrentStep(1); // Auto advance to step 2
      }
      utils.devManual.getManual.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const htmlMutation = trpc.devManual.generateHtml.useMutation({
    onSuccess: (data: any) => {
      toast.success("HTML说明书生成完成");
      utils.devManual.getManual.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const pdfMutation = trpc.devManual.exportPdf.useMutation({
    onSuccess: (data: any) => {
      toast.success("PDF导出完成");
      if (data.htmlUrl) window.open(data.htmlUrl, "_blank");
    },
    onError: (err: any) => toast.error(`导出失败: ${err.message}`),
  });

  // Chapter operations
  const confirmedCount = chapters.filter(ch => ch.confirmed).length;
  const allConfirmed = chapters.length > 0 && confirmedCount === chapters.length;

  const saveChapters = (updated: Chapter[], status?: "draft" | "editing" | "confirmed") => {
    saveMutation.mutate({
      projectId,
      chapters: JSON.stringify(updated),
      brandName: brandName || undefined,
      status: status || (updated.every(ch => ch.confirmed) ? "confirmed" : "editing"),
    });
  };

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditDraft({ ...chapters[idx] });
    setExpandedIdx(idx);
  };

  const saveEdit = () => {
    if (editingIdx === null || !editDraft) return;
    const updated = [...chapters];
    updated[editingIdx] = { ...editDraft, confirmed: false };
    setChapters(updated);
    setEditingIdx(null);
    setEditDraft(null);
    saveChapters(updated);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditDraft(null);
  };

  const confirmChapter = (idx: number) => {
    const updated = [...chapters];
    updated[idx] = { ...updated[idx], confirmed: true };
    setChapters(updated);
    saveChapters(updated);
  };

  const unlockChapter = (idx: number) => {
    const updated = [...chapters];
    updated[idx] = { ...updated[idx], confirmed: false };
    setChapters(updated);
    saveChapters(updated);
  };

  const confirmAll = () => {
    const updated = chapters.map(ch => ({ ...ch, confirmed: true }));
    setChapters(updated);
    saveChapters(updated, "confirmed");
  };

  const unlockAll = () => {
    const updated = chapters.map(ch => ({ ...ch, confirmed: false }));
    setChapters(updated);
    saveChapters(updated, "editing");
  };

  // Chapter image upload
  const chapterImageRef = useRef<HTMLInputElement>(null);
  const [uploadingChapterIdx, setUploadingChapterIdx] = useState<number | null>(null);
  const uploadChapterImage = trpc.devManual.uploadManualAsset.useMutation({
    onSuccess: (data) => {
      if (uploadingChapterIdx !== null) {
        const updated = [...chapters];
        updated[uploadingChapterIdx] = { ...updated[uploadingChapterIdx], imageUrl: data.url };
        setChapters(updated);
        saveChapters(updated);
        toast.success("章节图片上传成功");
      }
      setUploadingChapterIdx(null);
      assetsQuery.refetch();
    },
    onError: (err: any) => { toast.error(`上传失败: ${err.message}`); setUploadingChapterIdx(null); },
  });

  const handleChapterImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploadingChapterIdx === null) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("文件大小不能超过5MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadChapterImage.mutate({
        projectId,
        assetType: "chapter_image",
        chapterKey: chapters[uploadingChapterIdx]?.key || `ch${uploadingChapterIdx}`,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const onAssetUploaded = useCallback(() => {
    assetsQuery.refetch();
    utils.devManual.getManual.invalidate({ projectId });
  }, [assetsQuery, utils, projectId]);

  const steps = [
    { label: "素材上传", desc: "Logo、封面、底图、二维码" },
    { label: "AI生成 & 编辑", desc: "9章节内容生成与人工编辑" },
    { label: "生成说明书", desc: "英文/西语双版本HTML" },
  ];

  // Check step completion
  const step1Complete = !!(logoUrl || coverUrl);
  const step2Complete = chapters.length > 0 && allConfirmed;

  return (
    <div className="space-y-4">
      <StepIndicator currentStep={currentStep} steps={steps} />

      {/* ─── Step 1: Asset Upload ─── */}
      {currentStep === 0 && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" />
                整体素材上传
              </CardTitle>
              <p className="text-xs text-muted-foreground">上传品牌Logo、封面底图、内容页底图和社媒二维码等素材，用于生成专业说明书</p>
            </CardHeader>
            <CardContent>
              {/* Brand Name */}
              <div className="mb-4">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">品牌名称</label>
                <Input
                  className="max-w-xs"
                  placeholder="输入品牌名称"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  onBlur={() => { if (brandName) saveChapters(chapters); }}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AssetUploadCard
                  label="品牌Logo" desc="PNG/SVG格式，建议透明背景，用于封面和页眉"
                  icon={Image} assetType="logo" currentUrl={logoUrl}
                  projectId={projectId} onUploaded={onAssetUploaded}
                />
                <AssetUploadCard
                  label="封面底图" desc="高清产品图或品牌视觉图，用于说明书封面"
                  icon={FileText} assetType="cover" currentUrl={coverUrl}
                  projectId={projectId} onUploaded={onAssetUploaded}
                />
                <AssetUploadCard
                  label="内容页底图" desc="可选，用于内容页面的背景装饰"
                  icon={Image} assetType="content_bg" currentUrl={contentBgUrl}
                  projectId={projectId} onUploaded={onAssetUploaded}
                />
                <AssetUploadCard
                  label="社媒/官网二维码" desc="社交媒体主页或官网链接的二维码图片"
                  icon={QrCode} assetType="qrcode" currentUrl={qrCodeUrl}
                  projectId={projectId} onUploaded={onAssetUploaded}
                />
              </div>
            </CardContent>
          </Card>

          {/* Asset Preview Summary */}
          {(logoUrl || coverUrl || contentBgUrl || qrCodeUrl) && (
            <Card className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border-blue-100">
              <CardContent className="p-4">
                <p className="text-xs font-medium text-blue-700 mb-2">已上传素材预览</p>
                <div className="flex gap-4 flex-wrap">
                  {logoUrl && (
                    <div className="text-center">
                      <img src={logoUrl} alt="Logo" className="h-12 rounded border bg-white p-1 object-contain" />
                      <p className="text-[10px] text-muted-foreground mt-1">Logo</p>
                    </div>
                  )}
                  {coverUrl && (
                    <div className="text-center">
                      <img src={coverUrl} alt="Cover" className="h-12 rounded border object-cover" />
                      <p className="text-[10px] text-muted-foreground mt-1">封面</p>
                    </div>
                  )}
                  {contentBgUrl && (
                    <div className="text-center">
                      <img src={contentBgUrl} alt="Content BG" className="h-12 rounded border object-cover" />
                      <p className="text-[10px] text-muted-foreground mt-1">底图</p>
                    </div>
                  )}
                  {qrCodeUrl && (
                    <div className="text-center">
                      <img src={qrCodeUrl} alt="QR" className="h-12 rounded border object-contain" />
                      <p className="text-[10px] text-muted-foreground mt-1">二维码</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                if (!brandName) { toast.error("请先输入品牌名称"); return; }
                setCurrentStep(1);
              }}
              className="gap-1"
            >
              下一步：AI生成内容 <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── Step 2: AI Generate & Edit Chapters ─── */}
      {currentStep === 1 && (
        <div className="space-y-4">
          {/* Generate Button (if no chapters yet) */}
          {chapters.length === 0 && (
            <Card className="border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-10">
                <Globe className="h-10 w-10 mb-3 text-primary/30" />
                <p className="text-sm text-muted-foreground mb-4">点击下方按钮，AI将根据产品信息生成9章节说明书内容</p>
                <Button
                  onClick={() => generateMutation.mutate({ projectId })}
                  disabled={generateMutation.isPending}
                  className="gap-2"
                >
                  {generateMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />AI生成中...</>
                  ) : (
                    <><Globe className="h-4 w-4" />AI生成9章节内容</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Chapter List */}
          {chapters.length > 0 && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-sm">章节内容编辑</h3>
                  <Badge variant={allConfirmed ? "default" : "secondary"} className="text-xs">
                    {confirmedCount}/{chapters.length} 章已确认
                  </Badge>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setShowComparison(!showComparison)} className="gap-1 text-xs">
                    {showComparison ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showComparison ? "隐藏对比" : "AI原版对比"}
                  </Button>
                  {allConfirmed ? (
                    <Button size="sm" variant="outline" onClick={unlockAll} className="gap-1 text-xs text-amber-600">
                      <Unlock className="h-3 w-3" />全部解锁
                    </Button>
                  ) : (
                    <Button size="sm" onClick={confirmAll} className="gap-1 text-xs">
                      <Lock className="h-3 w-3" />全部确认
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => generateMutation.mutate({ projectId })} disabled={generateMutation.isPending} className="gap-1 text-xs">
                    {generateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                    重新生成
                  </Button>
                </div>
              </div>

              {/* Chapter Table */}
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left p-3 font-medium w-16">章节</th>
                          <th className="text-left p-3 font-medium">英文标题</th>
                          <th className="text-left p-3 font-medium">西语标题</th>
                          <th className="text-center p-3 font-medium w-16">素材</th>
                          <th className="text-center p-3 font-medium w-24">状态</th>
                          <th className="text-center p-3 font-medium w-36">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chapters.map((ch, idx) => {
                          const isExpanded = expandedIdx === idx;
                          return (
                            <tr key={idx} className={`border-b transition-colors ${isExpanded ? "bg-blue-50/30" : "hover:bg-muted/20"} ${ch.confirmed ? "bg-emerald-50/20" : ""}`}>
                              <td className="p-3 font-mono text-xs text-muted-foreground">
                                <button className="flex items-center gap-1" onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  Ch.{idx + 1}
                                </button>
                              </td>
                              <td className="p-3 text-sm">{ch.titleEn || ch.key}</td>
                              <td className="p-3 text-sm text-muted-foreground">{ch.titleEs || "—"}</td>
                              <td className="p-3 text-center">
                                {ch.imageUrl ? (
                                  <img src={ch.imageUrl} alt="" className="h-6 w-6 rounded object-cover inline-block" />
                                ) : (
                                  <Circle className="h-4 w-4 text-muted-foreground/30 inline-block" />
                                )}
                              </td>
                              <td className="p-3 text-center">
                                {ch.confirmed ? (
                                  <Badge className="bg-emerald-100 text-emerald-700 text-xs">已确认</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">待确认</Badge>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {!ch.confirmed ? (
                                    <>
                                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => startEdit(idx)}>
                                        <Edit2 className="h-3 w-3 mr-1" />编辑
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => {
                                        setUploadingChapterIdx(idx);
                                        chapterImageRef.current?.click();
                                      }}>
                                        <Image className="h-3 w-3 mr-1" />图片
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
                            <Input
                              value={editDraft.titleEn}
                              onChange={(e) => setEditDraft({ ...editDraft, titleEn: e.target.value })}
                              className="text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-orange-600 mb-1 block">西语标题</label>
                            <Input
                              value={editDraft.titleEs}
                              onChange={(e) => setEditDraft({ ...editDraft, titleEs: e.target.value })}
                              className="text-sm"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-medium text-blue-600 mb-1 block">英文内容</label>
                            <Textarea
                              value={editDraft.contentEn}
                              onChange={(e) => setEditDraft({ ...editDraft, contentEn: e.target.value })}
                              rows={10}
                              className="text-sm font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-orange-600 mb-1 block">西语内容</label>
                            <Textarea
                              value={editDraft.contentEs}
                              onChange={(e) => setEditDraft({ ...editDraft, contentEs: e.target.value })}
                              rows={10}
                              className="text-sm font-mono"
                            />
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
                          <Button size="sm" variant="outline" onClick={cancelEdit} className="gap-1">
                            <X className="h-3 w-3" />取消
                          </Button>
                          <Button size="sm" onClick={saveEdit} disabled={saveMutation.isPending} className="gap-1">
                            {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            保存
                          </Button>
                        </div>

                        {/* AI Original Comparison */}
                        {showComparison && originalChapters[expandedIdx] && (
                          <div className="border-t pt-4 mt-4">
                            <p className="text-xs font-medium text-muted-foreground mb-2">AI原版内容（对比参考）</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
                              <div>
                                <p className="text-xs text-blue-600 mb-1">English (Original)</p>
                                <p className="text-xs whitespace-pre-wrap bg-muted/30 p-2 rounded max-h-40 overflow-y-auto">
                                  {originalChapters[expandedIdx].contentEn || "—"}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-orange-600 mb-1">Espanol (Original)</p>
                                <p className="text-xs whitespace-pre-wrap bg-muted/30 p-2 rounded max-h-40 overflow-y-auto">
                                  {originalChapters[expandedIdx].contentEs || "—"}
                                </p>
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
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${chapters.length > 0 ? (confirmedCount / chapters.length) * 100 : 0}%` }}
                  />
                </div>
                <span>{confirmedCount}/{chapters.length} 章已确认</span>
                {saveMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
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

      {/* ─── Step 3: Generate Bilingual HTML Manual ─── */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                生成双语版说明书
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                结合上传的素材和已确认的章节内容，生成英文和西班牙语两个版本的HTML说明书
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-primary">{chapters.length}</p>
                  <p className="text-xs text-muted-foreground">总章节数</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{confirmedCount}</p>
                  <p className="text-xs text-muted-foreground">已确认章节</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{assets.length}</p>
                  <p className="text-xs text-muted-foreground">已上传素材</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-purple-600">{brandName || "—"}</p>
                  <p className="text-xs text-muted-foreground">品牌名称</p>
                </div>
              </div>

              {/* Asset Check */}
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium">素材检查</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    { label: "Logo", ok: !!logoUrl },
                    { label: "封面底图", ok: !!coverUrl },
                    { label: "内容底图", ok: !!contentBgUrl },
                    { label: "二维码", ok: !!qrCodeUrl },
                  ].map(item => (
                    <div key={item.label} className="flex items-center gap-1.5">
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
                  <div className="flex gap-2 flex-wrap">
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

              {/* Generate Buttons */}
              <div className="flex gap-3 flex-wrap">
                <Button
                  onClick={() => htmlMutation.mutate({ projectId })}
                  disabled={htmlMutation.isPending || !allConfirmed}
                  className="gap-2 flex-1"
                >
                  {htmlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                  生成双语HTML说明书
                </Button>
                <Button
                  variant="outline"
                  onClick={() => pdfMutation.mutate({ projectId, language: "en" })}
                  disabled={pdfMutation.isPending}
                  className="gap-1"
                >
                  <Download className="h-4 w-4" />PDF(EN)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => pdfMutation.mutate({ projectId, language: "es" })}
                  disabled={pdfMutation.isPending}
                  className="gap-1"
                >
                  <Download className="h-4 w-4" />PDF(ES)
                </Button>
              </div>
            </CardContent>
          </Card>

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
