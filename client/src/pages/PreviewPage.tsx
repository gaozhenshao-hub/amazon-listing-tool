import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  FileText,
  AlertTriangle,
  Save,
  Copy,
  CheckCircle2,
  Type,
  List,
  Key,
  Image,
  Loader2,
  Edit3,
  Eye,
  Languages,
  Download,
  Palette,
  Lightbulb,
  BarChart3,
  Layout,
  Smartphone,
  TypeIcon,
  History,
  RotateCcw,
  Sparkles,
  Pencil,
  GitBranch,
  Globe,
  Wand2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Check,
  X,
  Plus,
  Trash2,
  MessageCircle,
  HelpCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

function CharCountBadge({ count, min, max }: { count: number; min: number; max: number }) {
  const inRange = count >= min && count <= max;
  const tooShort = count < min;
  return (
    <Badge
      variant={inRange ? "default" : "destructive"}
      className={`text-xs ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}
    >
      {count} / {min}-{max} 字符 {inRange ? "\u2713" : tooShort ? "\u2191\u504f\u77ed" : "\u2193\u504f\u957f"}
    </Badge>
  );
}

export default function PreviewPage() {
  const { selectedProjectId } = useProject();
  const [, setLocation] = useLocation();

  // Editing state - per-bullet editing
  const [isEditing, setIsEditing] = useState(false);
  const [editingBulletIdx, setEditingBulletIdx] = useState<number | null>(null);
  const [editBulletData, setEditBulletData] = useState<{ subtitle: string; fullText: string }>({ subtitle: "", fullText: "" });
  const [editData, setEditData] = useState({
    title: "",
    bulletPoints: "",
    description: "",
    searchTerms: "",
  });
  // Track if user has confirmed edits (to enable translation)
  const [editsConfirmed, setEditsConfirmed] = useState(false);

  const { data: listing, isLoading } = trpc.listing.getActive.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();
  const updateListing = trpc.listing.update.useMutation({
    onSuccess: () => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      setIsEditing(false);
      setEditingBulletIdx(null);
      toast.success("Listing\u5df2\u66f4\u65b0");
    },
    onError: (err: any) => toast.error("\u66f4\u65b0\u5931\u8d25: " + err.message),
  });

  const translateToChinese = trpc.listing.translateToChinese.useMutation({
    onSuccess: () => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      toast.success("\u4e2d\u6587\u7ffb\u8bd1\u751f\u6210\u5b8c\u6210\uff01");
    },
    onError: (err: any) => toast.error("\u7ffb\u8bd1\u5931\u8d25: " + err.message),
  });

  useEffect(() => {
    if (listing) {
      setEditData({
        title: listing.title || "",
        bulletPoints: listing.bulletPoints || "",
        description: listing.description || "",
        searchTerms: listing.searchTerms || "",
      });
    }
  }, [listing]);

  const bulletPointsArray = useMemo(() => {
    if (!listing?.bulletPoints) return [];
    try {
      const parsed = JSON.parse(listing.bulletPoints);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return listing.bulletPoints.split("\n").filter(Boolean);
    }
  }, [listing?.bulletPoints]);

  const bulletPointsCnArray = useMemo(() => {
    if (!listing?.bulletPointsCn) return [];
    try {
      const parsed = JSON.parse(listing.bulletPointsCn);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }, [listing?.bulletPointsCn]);

  const imageAdvice = useMemo(() => {
    if (!listing?.imageAdvice) return null;
    try { return JSON.parse(listing.imageAdvice); } catch { return null; }
  }, [listing?.imageAdvice]);

  const imageAdviceCn = useMemo(() => {
    if (!listing?.imageAdviceCn) return null;
    try { return JSON.parse(listing.imageAdviceCn); } catch { return null; }
  }, [listing?.imageAdviceCn]);

  const qaContent = useMemo(() => {
    if (!(listing as any)?.qaContent) return null;
    try { return JSON.parse((listing as any).qaContent); } catch { return null; }
  }, [(listing as any)?.qaContent]);

  const qaContentCn = useMemo(() => {
    if (!(listing as any)?.qaContentCn) return null;
    try { return JSON.parse((listing as any).qaContentCn); } catch { return null; }
  }, [(listing as any)?.qaContentCn]);

  const hasChinese = !!(listing?.titleCn || listing?.bulletPointsCn || listing?.descriptionCn || listing?.searchTermsCn);

  // Completion progress
  const completionItems = useMemo(() => {
    if (!listing) return [];
    return [
      { label: "标题", done: !!listing.title },
      { label: "卖点", done: !!listing.bulletPoints },
      { label: "描述", done: !!listing.description },
      { label: "搜索词", done: !!listing.searchTerms },
      { label: "QA问答", done: !!(listing as any)?.qaContent },
      { label: "中文翻译", done: hasChinese },
    ];
  }, [listing, hasChinese]);

  const completionRate = useMemo(() => {
    if (completionItems.length === 0) return 0;
    return Math.round((completionItems.filter(i => i.done).length / completionItems.length) * 100);
  }, [completionItems]);

  // Version history
  const [expandedVersionId, setExpandedVersionId] = useState<number | null>(null);
  const [rollbackConfirmId, setRollbackConfirmId] = useState<number | null>(null);

  const versionsQuery = trpc.listing.getVersionHistory.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId && !!listing }
  );

  const rollbackMutation = trpc.listing.rollbackToVersion.useMutation({
    onSuccess: (data: any) => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      versionsQuery.refetch();
      setRollbackConfirmId(null);
      toast.success(`\u5df2\u56de\u6eda\u5230\u7248\u672c #${data.rolledBackTo}`);
    },
    onError: (err: any) => toast.error("\u56de\u6eda\u5931\u8d25: " + err.message),
  });

  const generateReport = trpc.report.generateReport.useMutation({
    onSuccess: (data: any) => {
      const blob = new Blob([data.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) {
        win.onload = () => { setTimeout(() => { win.print(); }, 500); };
      }
      toast.success("\u62a5\u544a\u5df2\u751f\u6210\uff0c\u8bf7\u5728\u5f39\u51fa\u7a97\u53e3\u4e2d\u4fdd\u5b58\u4e3aPDF");
    },
    onError: (err: any) => toast.error("\u62a5\u544a\u751f\u6210\u5931\u8d25: " + err.message),
  });

  const handleExportReport = () => {
    if (!selectedProjectId) return;
    generateReport.mutate({ projectId: selectedProjectId });
  };

  // Save full listing (title, description, searchTerms)
  const handleSaveGeneral = () => {
    if (!listing) return;
    updateListing.mutate({
      id: listing.id,
      title: editData.title,
      description: editData.description,
      searchTerms: editData.searchTerms,
    });
  };

  // Save a single bullet point edit
  const handleSaveSingleBullet = (idx: number) => {
    if (!listing) return;
    try {
      const bullets = JSON.parse(listing.bulletPoints || "[]");
      if (Array.isArray(bullets) && idx < bullets.length) {
        if (typeof bullets[idx] === "string") {
          bullets[idx] = `${editBulletData.subtitle} ${editBulletData.fullText}`;
        } else {
          bullets[idx] = {
            ...bullets[idx],
            subtitle: editBulletData.subtitle,
            fullText: editBulletData.fullText,
            characterCount: (editBulletData.subtitle + " " + editBulletData.fullText).length,
          };
        }
        updateListing.mutate({
          id: listing.id,
          bulletPoints: JSON.stringify(bullets),
        });
      }
    } catch {
      toast.error("\u5356\u70b9\u6570\u636e\u683c\u5f0f\u5f02\u5e38");
    }
  };

  // Save raw JSON bullet points edit
  const handleSaveBulletPointsRaw = () => {
    if (!listing) return;
    updateListing.mutate({
      id: listing.id,
      bulletPoints: editData.bulletPoints,
    });
  };

  const handleStartEditBullet = (idx: number) => {
    const bp = bulletPointsArray[idx];
    if (!bp) return;
    if (typeof bp === "string") {
      setEditBulletData({ subtitle: "", fullText: bp });
    } else {
      setEditBulletData({
        subtitle: bp.subtitle || "",
        fullText: bp.fullText || bp.sellingPoint || "",
      });
    }
    setEditingBulletIdx(idx);
  };

  const handleConfirmEdits = () => {
    setEditsConfirmed(true);
    toast.success("\u7f16\u8f91\u5df2\u786e\u8ba4\uff0c\u73b0\u5728\u53ef\u4ee5\u6267\u884c\u4e2d\u82f1\u6587\u7ffb\u8bd1");
  };

  const handleTranslate = () => {
    if (!selectedProjectId) return;
    translateToChinese.mutate({ projectId: selectedProjectId });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">\u7ed3\u679c\u9884\u89c8</h1>
          <p className="text-muted-foreground mt-1">
            \u67e5\u770b\u3001\u7f16\u8f91Listing\u5185\u5bb9 \u2192 \u786e\u8ba4\u540e\u7ffb\u8bd1 \u2192 \u524d\u5f80Listing\u8bc4\u5206
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector />
          {listing && (
            <div className="flex gap-2">
              {!isEditing && (
                <Button
                  variant="outline"
                  onClick={handleExportReport}
                  disabled={generateReport.isPending}
                  className="border-amber-300 text-amber-700 hover:bg-amber-50"
                >
                  {generateReport.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  \u5bfc\u51fa\u5b8c\u6574\u62a5\u544a
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {!selectedProjectId ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u9879\u76ee</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-6"><div className="h-24 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      ) : !listing ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">\u6682\u65e0\u751f\u6210\u7ed3\u679c</p>
            <p className="text-sm text-muted-foreground">\u8bf7\u5148\u5728\u201cListing\u751f\u6210\u201d\u9875\u9762\u751f\u6210\u5185\u5bb9</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="preview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="preview">
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              \u9884\u89c8\u7f16\u8f91
            </TabsTrigger>
            <TabsTrigger value="bilingual">
              <Languages className="h-3.5 w-3.5 mr-1.5" />
              \u4e2d\u82f1\u5bf9\u6bd4
            </TabsTrigger>
            <TabsTrigger value="images">
              <Image className="h-3.5 w-3.5 mr-1.5" />
              \u56fe\u7247\u5efa\u8bae
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-3.5 w-3.5 mr-1.5" />
              \u7248\u672c\u5386\u53f2
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════════════════════════════════════════════════════
              Preview & Edit Tab
              ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="preview" className="space-y-4">
            {/* Workflow Status Banner */}
            <Card className={`${hasChinese ? "border-green-300 bg-green-50/50" : editsConfirmed ? "border-blue-300 bg-blue-50/50" : "border-amber-300 bg-amber-50/50"}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    {hasChinese ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <div>
                          <p className="text-sm font-medium text-green-800">\u7ffb\u8bd1\u5df2\u5b8c\u6210</p>
                          <p className="text-xs text-green-600">\u53ef\u4ee5\u524d\u5f80Listing\u8bc4\u5206\u9875\u9762\u8fdb\u884c\u8bc4\u5206\u5206\u6790</p>
                        </div>
                      </>
                    ) : editsConfirmed ? (
                      <>
                        <Languages className="h-5 w-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-blue-800">\u7f16\u8f91\u5df2\u786e\u8ba4\uff0c\u53ef\u4ee5\u6267\u884c\u7ffb\u8bd1</p>
                          <p className="text-xs text-blue-600">\u70b9\u51fb\u201c\u6267\u884c\u4e2d\u82f1\u6587\u7ffb\u8bd1\u201d\u751f\u6210\u4e2d\u6587\u7248\u672c</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <Edit3 className="h-5 w-5 text-amber-600" />
                        <div>
                          <p className="text-sm font-medium text-amber-800">\u8bf7\u68c0\u67e5\u5e76\u7f16\u8f91\u5185\u5bb9</p>
                          <p className="text-xs text-amber-600">\u7f16\u8f91\u5b8c\u6210\u540e\u70b9\u51fb\u201c\u786e\u8ba4\u5185\u5bb9\u201d\uff0c\u7136\u540e\u6267\u884c\u4e2d\u82f1\u6587\u7ffb\u8bd1</p>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!hasChinese && !editsConfirmed && (
                      <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={handleConfirmEdits}>
                        <Check className="h-4 w-4 mr-1" />\u786e\u8ba4\u5185\u5bb9
                      </Button>
                    )}
                    {!hasChinese && editsConfirmed && (
                      <Button
                        size="sm"
                        onClick={handleTranslate}
                        disabled={translateToChinese.isPending}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {translateToChinese.isPending ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Languages className="h-4 w-4 mr-1" />
                        )}
                        {translateToChinese.isPending ? "\u7ffb\u8bd1\u4e2d..." : "\u6267\u884c\u4e2d\u82f1\u6587\u7ffb\u8bd1"}
                      </Button>
                    )}
                    {hasChinese && (
                      <Button size="sm" onClick={() => setLocation("/listing/scoring")}>
                        <ArrowRight className="h-4 w-4 mr-1" />\u524d\u5f80Listing\u8bc4\u5206
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Completion Progress */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Listing完成度</span>
                  <span className="text-sm font-bold text-primary">{completionRate}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 mb-3">
                  <div className="bg-primary h-2 rounded-full transition-all duration-500" style={{ width: `${completionRate}%` }} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {completionItems.map((item, i) => (
                    <Badge key={i} variant={item.done ? "default" : "outline"} className={`text-xs ${item.done ? "bg-green-100 text-green-700 border-green-300" : "text-muted-foreground"}`}>
                      {item.done ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <div className="h-3 w-3 mr-1 rounded-full border border-muted-foreground/50" />}
                      {item.label}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Title */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Type className="h-4 w-4 text-blue-600" />
                    \u4ea7\u54c1\u6807\u9898
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <CharCountBadge count={(isEditing ? editData.title : listing.title)?.length || 0} min={180} max={200} />
                    {!isEditing && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(listing.title || "", "\u6807\u9898")}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsEditing(true)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editData.title}
                      onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                      rows={3}
                      className="font-medium"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" onClick={handleSaveGeneral} disabled={updateListing.isPending}>
                        {updateListing.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                        \u4fdd\u5b58
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setIsEditing(false); setEditData(prev => ({ ...prev, title: listing.title || "" })); }}>
                        \u53d6\u6d88
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-medium leading-relaxed">{listing.title}</p>
                )}
              </CardContent>
            </Card>

            {/* Bullet Points - Enhanced with per-bullet editing */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <List className="h-4 w-4 text-green-600" />
                    \u5356\u70b9\u63cf\u8ff0 (Bullet Points)
                    <Badge variant="secondary" className="text-xs">{bulletPointsArray.length} \u6761</Badge>
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      const text = bulletPointsArray.map((bp: any) =>
                        typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || bp.sellingPoint || ""}`
                      ).join("\n\n");
                      copyToClipboard(text, "\u5356\u70b9\u63cf\u8ff0");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {bulletPointsArray.map((bp: any, i: number) => {
                    const isEditingThis = editingBulletIdx === i;
                    const fullBullet = typeof bp === "string"
                      ? bp
                      : bp.subtitle && bp.fullText
                        ? `${bp.subtitle} ${bp.fullText}`
                        : bp.fullText || bp.subtitle || "";

                    return (
                      <div key={i} className={`p-3 rounded-lg border-l-2 ${isEditingThis ? "border-l-blue-500 bg-blue-50/30 border border-blue-200" : "border-l-green-500 bg-muted/30"}`}>
                        {isEditingThis ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">\u7f16\u8f91\u5356\u70b9 {i + 1}</Badge>
                              <CharCountBadge count={(editBulletData.subtitle + " " + editBulletData.fullText).length} min={200} max={280} />
                            </div>
                            <div>
                              <Label className="text-xs">\u5c0f\u6807\u9898 (Subtitle)</Label>
                              <Input
                                value={editBulletData.subtitle}
                                onChange={(e) => setEditBulletData(prev => ({ ...prev, subtitle: e.target.value }))}
                                className="h-8 text-sm font-bold"
                                placeholder="\u4f8b\u5982: [PREMIUM QUALITY]"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">\u6b63\u6587 (Full Text)</Label>
                              <Textarea
                                value={editBulletData.fullText}
                                onChange={(e) => setEditBulletData(prev => ({ ...prev, fullText: e.target.value }))}
                                rows={3}
                                className="text-sm resize-none"
                              />
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" onClick={() => handleSaveSingleBullet(i)} disabled={updateListing.isPending}>
                                {updateListing.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                                \u4fdd\u5b58
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingBulletIdx(null)}>
                                \u53d6\u6d88
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                                </div>
                                {typeof bp === "string" ? (
                                  <p className="text-sm">{bp}</p>
                                ) : (
                                  <p className="text-sm">
                                    <span className="font-bold uppercase">{bp.subtitle || `Bullet ${i + 1}`}</span>
                                    {bp.fullText && <span className="text-muted-foreground"> \u2014 {bp.fullText}</span>}
                                    {!bp.fullText && bp.sellingPoint && <span className="text-muted-foreground"> \u2014 {bp.sellingPoint}</span>}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <CharCountBadge count={fullBullet.length} min={200} max={280} />
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleStartEditBullet(i)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            {typeof bp !== "string" && bp.fabeBreakdown && (
                              <div className="grid grid-cols-2 gap-1 mt-2">
                                {Object.entries(bp.fabeBreakdown).map(([key, val]) => (
                                  val ? <div key={key} className="text-[10px] text-muted-foreground"><span className="font-medium uppercase">{key}:</span> {val as string}</div> : null
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Description */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-purple-600" />
                    \u4ea7\u54c1\u63cf\u8ff0
                  </CardTitle>
                  {!isEditing && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(listing.description || "", "\u4ea7\u54c1\u63cf\u8ff0")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {listing.description ? (
                  <div className="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: listing.description || "" }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground italic">\u6682\u65e0\u4ea7\u54c1\u63cf\u8ff0</p>
                )}
              </CardContent>
            </Card>

            {/* Search Terms */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="h-4 w-4 text-amber-600" />
                    \u540e\u53f0\u641c\u7d22\u8bcd (Search Terms)
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {new Blob([(listing.searchTerms) || ""].map(String)).size} / 250 bytes
                    </Badge>
                    {!isEditing && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(listing.searchTerms || "", "\u641c\u7d22\u8bcd")}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {listing.searchTerms ? (
                  <p className="text-sm font-mono bg-muted/30 p-3 rounded-lg break-all">{listing.searchTerms}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">\u6682\u65e0\u641c\u7d22\u8bcd</p>
                )}
              </CardContent>
            </Card>

            {/* QA问答 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-teal-600" />
                    QA问答 (Customer Q&A)
                  </CardTitle>
                  {!isEditing && qaContent && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                      const qaText = (qaContent as any[]).map((qa: any, i: number) => `Q${i+1}: ${qa.question}\nA${i+1}: ${qa.answer}`).join('\n\n');
                      copyToClipboard(qaText, "QA问答");
                    }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {qaContent && Array.isArray(qaContent) && qaContent.length > 0 ? (
                  <div className="space-y-3">
                    {(qaContent as any[]).map((qa: any, i: number) => (
                      <div key={i} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <HelpCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="secondary" className="text-[10px]">Q{i + 1}</Badge>
                              {qa.category && <Badge variant="outline" className="text-[10px]">{qa.category}</Badge>}
                              {qa.priority && <Badge variant="outline" className={`text-[10px] ${qa.priority === 'high' ? 'border-red-300 text-red-600' : qa.priority === 'medium' ? 'border-amber-300 text-amber-600' : 'border-gray-300'}`}>{qa.priority}</Badge>}
                            </div>
                            <p className="text-sm font-medium">{qa.question}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 pl-6">
                          <MessageCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <Badge variant="secondary" className="text-[10px] mb-1">A{i + 1}</Badge>
                            <p className="text-sm text-muted-foreground">{qa.answer}</p>
                          </div>
                        </div>
                        {qa.sourceInsight && (
                          <p className="text-xs text-muted-foreground italic pl-6">💡 {qa.sourceInsight}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8">
                    <MessageCircle className="h-6 w-6 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">暂无QA问答数据</p>
                    <p className="text-xs text-muted-foreground mt-1">请在“Listing生成”页面的Step 5生成QA内容</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Version Info */}
            <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
              <span>\u7248\u672c {listing.version} \u00b7 \u751f\u6210\u4e8e {new Date(listing.createdAt).toLocaleString("zh-CN")}</span>
              <Badge variant="secondary">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                \u5f53\u524d\u7248\u672c
              </Badge>
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════
              Bilingual Comparison Tab
              ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="bilingual" className="space-y-4">
            {!hasChinese ? (
              <Card className="border-dashed border-orange-300">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Languages className="h-8 w-8 text-orange-400 mb-4" />
                  <p className="text-muted-foreground mb-3">\u6682\u65e0\u4e2d\u6587\u7ffb\u8bd1</p>
                  <p className="text-xs text-muted-foreground mb-4">\u8bf7\u5148\u5728\u201c\u9884\u89c8\u7f16\u8f91\u201d\u9875\u786e\u8ba4\u5185\u5bb9\u540e\u6267\u884c\u7ffb\u8bd1</p>
                  {editsConfirmed && (
                    <Button
                      onClick={handleTranslate}
                      disabled={translateToChinese.isPending}
                      className="bg-orange-600 hover:bg-orange-700"
                    >
                      {translateToChinese.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Languages className="h-4 w-4 mr-2" />
                      )}
                      {translateToChinese.isPending ? "\u7ffb\u8bd1\u4e2d..." : "\u6267\u884c\u4e2d\u82f1\u6587\u7ffb\u8bd1"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Navigation to scoring */}
                <Card className="border-green-300 bg-green-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <span className="text-sm font-medium text-green-800">\u4e2d\u82f1\u6587\u7ffb\u8bd1\u5df2\u5b8c\u6210\uff0c\u53ef\u4ee5\u524d\u5f80Listing\u8bc4\u5206</span>
                      </div>
                      <Button size="sm" onClick={() => setLocation("/listing/scoring")}>
                        <BarChart3 className="h-4 w-4 mr-1" />\u524d\u5f80Listing\u8bc4\u5206
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Title Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Type className="h-4 w-4 text-blue-600" />
                      \u4ea7\u54c1\u6807\u9898
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />\u4e2d\u82f1\u5bf9\u7167
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.title || "", "\u82f1\u6587\u6807\u9898")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-medium leading-relaxed">{listing.title}</p>
                        <CharCountBadge count={listing.title?.length || 0} min={180} max={200} />
                      </div>
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">\u4e2d\u6587</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.titleCn || "", "\u4e2d\u6587\u6807\u9898")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-medium leading-relaxed">{listing.titleCn}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Bullet Points Comparison - supports up to 9 */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <List className="h-4 w-4 text-green-600" />
                        \u5356\u70b9\u63cf\u8ff0
                        <Badge variant="secondary" className="text-xs">{bulletPointsArray.length} \u6761</Badge>
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                          <Languages className="h-3 w-3 mr-1" />\u4e2d\u82f1\u5bf9\u7167
                        </Badge>
                      </CardTitle>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                        const enText = bulletPointsArray.map((bp: any) =>
                          typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || bp.sellingPoint || ""}`
                        ).join("\n\n");
                        const cnText = bulletPointsCnArray.map((bp: any) =>
                          typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || ""}`
                        ).join("\n\n");
                        copyToClipboard(`=== English ===\n${enText}\n\n=== \u4e2d\u6587 ===\n${cnText}`, "\u4e2d\u82f1\u6587\u5356\u70b9\u63cf\u8ff0");
                      }}>
                        <Copy className="h-3 w-3 mr-1" />\u590d\u5236\u5168\u90e8
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {bulletPointsArray.map((bp: any, i: number) => {
                      const cnBp = bulletPointsCnArray[i];
                      const fullBullet = typeof bp === "string" ? bp : (bp.subtitle && bp.fullText ? `${bp.subtitle} ${bp.fullText}` : bp.fullText || bp.subtitle || "");
                      return (
                        <div key={i} className="rounded-lg border overflow-hidden">
                          <div className="grid grid-cols-1 lg:grid-cols-2">
                            <div className="p-3 bg-blue-50/30 border-b lg:border-b-0 lg:border-r border-blue-200">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Badge variant="secondary" className="text-xs">EN {i + 1}</Badge>
                                <CharCountBadge count={fullBullet.length} min={200} max={280} />
                              </div>
                              {typeof bp === "string" ? (
                                <p className="text-sm">{bp}</p>
                              ) : (
                                <p className="text-sm">
                                  <span className="font-bold">{bp.subtitle || `Bullet ${i + 1}`}</span>
                                  {bp.fullText && <span className="text-muted-foreground"> \u2014 {bp.fullText}</span>}
                                  {!bp.fullText && bp.sellingPoint && <span className="text-muted-foreground"> \u2014 {bp.sellingPoint}</span>}
                                </p>
                              )}
                            </div>
                            <div className="p-3 bg-orange-50/30">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700">\u4e2d {i + 1}</Badge>
                              </div>
                              {cnBp ? (
                                typeof cnBp === "string" ? (
                                  <p className="text-sm">{cnBp}</p>
                                ) : (
                                  <p className="text-sm">
                                    <span className="font-bold">{cnBp.subtitle || `\u5356\u70b9 ${i + 1}`}</span>
                                    {cnBp.fullText && <span className="text-orange-700"> \u2014 {cnBp.fullText}</span>}
                                  </p>
                                )
                              ) : (
                                <p className="text-sm text-muted-foreground italic">\u6682\u65e0\u7ffb\u8bd1</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* Description Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4 text-purple-600" />
                      \u4ea7\u54c1\u63cf\u8ff0
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />\u4e2d\u82f1\u5bf9\u7167
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.description || "", "\u82f1\u6587\u63cf\u8ff0")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground"
                          dangerouslySetInnerHTML={{ __html: listing.description || "" }}
                        />
                      </div>
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">\u4e2d\u6587</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.descriptionCn || "", "\u4e2d\u6587\u63cf\u8ff0")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-orange-900"
                          dangerouslySetInnerHTML={{ __html: listing.descriptionCn || "" }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Search Terms Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Key className="h-4 w-4 text-amber-600" />
                      \u540e\u53f0\u641c\u7d22\u8bcd
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />\u4e2d\u82f1\u5bf9\u7167
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.searchTerms || "", "\u82f1\u6587\u641c\u7d22\u8bcd")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-mono break-all">{listing.searchTerms}</p>
                        <Badge variant="outline" className="text-xs mt-2">
                          {new Blob([listing.searchTerms || ""].map(String)).size} / 250 bytes
                        </Badge>
                      </div>
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">\u4e2d\u6587</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.searchTermsCn || "", "\u4e2d\u6587\u641c\u7d22\u8bcd")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-mono break-all text-orange-900">{listing.searchTermsCn || "\u6682\u65e0\u7ffb\u8bd1"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* QA Comparison */}
                {(qaContent || qaContentCn) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-teal-600" />
                        QA问答
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                          <Languages className="h-3 w-3 mr-1" />中英对照
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(qaContent as any[] || []).map((qa: any, i: number) => {
                        const cnQa = qaContentCn && Array.isArray(qaContentCn) ? (qaContentCn as any[])[i] : null;
                        return (
                          <div key={i} className="rounded-lg border overflow-hidden">
                            <div className="grid grid-cols-1 lg:grid-cols-2">
                              <div className="p-3 bg-blue-50/30 border-b lg:border-b-0 lg:border-r border-blue-200">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <Badge variant="secondary" className="text-xs">EN Q{i + 1}</Badge>
                                  {qa.category && <Badge variant="outline" className="text-[10px]">{qa.category}</Badge>}
                                </div>
                                <p className="text-sm font-medium mb-1">{qa.question}</p>
                                <p className="text-sm text-muted-foreground">{qa.answer}</p>
                              </div>
                              <div className="p-3 bg-orange-50/30">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700">中 Q{i + 1}</Badge>
                                </div>
                                {cnQa ? (
                                  <>
                                    <p className="text-sm font-medium mb-1 text-orange-900">{cnQa.question}</p>
                                    <p className="text-sm text-orange-700">{cnQa.answer}</p>
                                  </>
                                ) : (
                                  <p className="text-sm text-muted-foreground italic">暂无翻译</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                {/* Regenerate translation button */}
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={handleTranslate}
                    disabled={translateToChinese.isPending}
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    {translateToChinese.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Languages className="h-4 w-4 mr-2" />
                    )}
                    {translateToChinese.isPending ? "\u91cd\u65b0\u7ffb\u8bd1\u4e2d..." : "\u91cd\u65b0\u751f\u6210\u4e2d\u6587\u7ffb\u8bd1"}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════
              Image Advice Tab
              ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="images" className="space-y-4">
            {imageAdvice ? (
              <>
                {/* 图片建议 - Main Image */}
                {imageAdvice.mainImage && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        图片建议 - 首图
                        {imageAdviceCn?.mainImage && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />中英对照
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                              `Concept: ${imageAdvice.mainImage.concept}\nTitle: ${imageAdvice.mainImage.title || ''}\nComposition: ${imageAdvice.mainImage.composition || ''}\nKey Elements: ${(imageAdvice.mainImage.keyElements || []).join(', ')}\nColor Scheme: ${imageAdvice.mainImage.colorScheme ? `Primary: ${imageAdvice.mainImage.colorScheme.primary}, Secondary: ${imageAdvice.mainImage.colorScheme.secondary}, Accent: ${imageAdvice.mainImage.colorScheme.accent}` : ''}\nTips: ${(imageAdvice.mainImage.tips || []).join('; ')}`,
                              "英文首图建议"
                            )}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-blue-700 mb-1">概念</p>
                            <p className="text-sm">{imageAdvice.mainImage.concept}</p>
                          </div>
                          {imageAdvice.mainImage.title && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">标题</p>
                              <p className="text-sm font-semibold">{imageAdvice.mainImage.title}</p>
                            </div>
                          )}
                          {imageAdvice.mainImage.composition && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">构图方式</p>
                              <p className="text-sm">{imageAdvice.mainImage.composition}</p>
                            </div>
                          )}
                          {imageAdvice.mainImage.colorScheme && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">配色方案</p>
                              <div className="flex flex-wrap gap-2">
                                {imageAdvice.mainImage.colorScheme.primary && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: imageAdvice.mainImage.colorScheme.primary.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                    <span className="text-xs">主色: {imageAdvice.mainImage.colorScheme.primary}</span>
                                  </div>
                                )}
                                {imageAdvice.mainImage.colorScheme.secondary && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: imageAdvice.mainImage.colorScheme.secondary.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                    <span className="text-xs">辅色: {imageAdvice.mainImage.colorScheme.secondary}</span>
                                  </div>
                                )}
                                {imageAdvice.mainImage.colorScheme.accent && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: imageAdvice.mainImage.colorScheme.accent.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                    <span className="text-xs">点缀色: {imageAdvice.mainImage.colorScheme.accent}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {imageAdvice.mainImage.keyElements && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">关键元素</p>
                              <div className="flex flex-wrap gap-1.5">
                                {imageAdvice.mainImage.keyElements.map((e: string, i: number) => (
                                  <Badge key={i} variant="secondary" className="text-xs">{e}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {imageAdvice.mainImage.tips && (
                            <div>
                              <p className="text-xs font-medium text-blue-700 mb-1">拍摄提示</p>
                              <ul className="text-sm space-y-1 text-muted-foreground">
                                {imageAdvice.mainImage.tips.map((t: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2"><span className="text-primary mt-0.5">•</span>{t}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                            {imageAdviceCn?.mainImage && (
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                                `概念: ${imageAdviceCn.mainImage.concept}\n标题: ${imageAdviceCn.mainImage.title || ''}\n构图: ${imageAdviceCn.mainImage.composition || ''}\n关键元素: ${(imageAdviceCn.mainImage.keyElements || []).join(', ')}\n拍摄提示: ${(imageAdviceCn.mainImage.tips || []).join('; ')}`,
                                "中文首图建议"
                              )}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                          {imageAdviceCn?.mainImage ? (
                            <>
                              <div>
                                <p className="text-xs font-medium text-orange-700 mb-1">概念</p>
                                <p className="text-sm text-orange-900">{imageAdviceCn.mainImage.concept}</p>
                              </div>
                              {imageAdviceCn.mainImage.title && (
                                <div>
                                  <p className="text-xs font-medium text-orange-700 mb-1">标题</p>
                                  <p className="text-sm font-semibold text-orange-900">{imageAdviceCn.mainImage.title}</p>
                                </div>
                              )}
                              {imageAdviceCn.mainImage.composition && (
                                <div>
                                  <p className="text-xs font-medium text-orange-700 mb-1">构图方式</p>
                                  <p className="text-sm text-orange-900">{imageAdviceCn.mainImage.composition}</p>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">暂无中文翻译</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Secondary Images */}
                {imageAdvice.secondaryImages && imageAdvice.secondaryImages.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">辅图建议 ({imageAdvice.secondaryImages.length} 张)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {imageAdvice.secondaryImages.map((img: any, i: number) => {
                          const imgCn = imageAdviceCn?.secondaryImages?.[i];
                          return (
                            <div key={i} className="rounded-lg border overflow-hidden">
                              <div className="px-4 py-2 bg-muted/50 border-b flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">辅图 {i + 1}</Badge>
                                <span className="text-sm font-medium">{img.purpose || img.concept}</span>
                                {img.title && <span className="text-xs text-muted-foreground">- {img.title}</span>}
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-2">
                                <div className="p-3 bg-blue-50/20 border-b lg:border-b-0 lg:border-r space-y-2">
                                  <span className="text-xs font-semibold text-blue-700 uppercase">English</span>
                                  <p className="text-sm">{img.concept || img.content}</p>
                                  {img.expressionMethod && (
                                    <div>
                                      <p className="text-xs font-medium text-blue-700">表达方式</p>
                                      <p className="text-sm text-muted-foreground">{img.expressionMethod}</p>
                                    </div>
                                  )}
                                  {img.dataVisualization && (
                                    <div>
                                      <p className="text-xs font-medium text-blue-700">数据可视化</p>
                                      <p className="text-sm text-muted-foreground">{img.dataVisualization}</p>
                                    </div>
                                  )}
                                  {img.keyElements && (
                                    <div className="flex flex-wrap gap-1">
                                      {img.keyElements.map((e: string, j: number) => (
                                        <Badge key={j} variant="secondary" className="text-[10px]">{e}</Badge>
                                      ))}
                                    </div>
                                  )}
                                  {img.icons && img.icons.length > 0 && (
                                    <div>
                                      <p className="text-xs font-medium text-blue-700">图标建议</p>
                                      <div className="flex flex-wrap gap-1">
                                        {img.icons.map((icon: string, j: number) => (
                                          <Badge key={j} variant="outline" className="text-[10px]">{icon}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {img.colorScheme && (
                                    <div className="flex flex-wrap gap-2">
                                      {img.colorScheme.primary && <span className="text-xs">主色: {img.colorScheme.primary}</span>}
                                      {img.colorScheme.secondary && <span className="text-xs">辅色: {img.colorScheme.secondary}</span>}
                                      {img.colorScheme.accent && <span className="text-xs">点缀色: {img.colorScheme.accent}</span>}
                                    </div>
                                  )}
                                  {img.tips && img.tips.length > 0 && (
                                    <ul className="text-xs text-muted-foreground space-y-0.5">
                                      {img.tips.map((t: string, j: number) => <li key={j}>• {t}</li>)}
                                    </ul>
                                  )}
                                </div>
                                <div className="p-3 bg-orange-50/20 space-y-2">
                                  <span className="text-xs font-semibold text-orange-700 uppercase">中文</span>
                                  {imgCn ? (
                                    <>
                                      <p className="text-sm text-orange-900">{imgCn.concept || imgCn.content}</p>
                                      {imgCn.expressionMethod && <p className="text-xs text-orange-700">表达方式: {imgCn.expressionMethod}</p>}
                                      {imgCn.dataVisualization && <p className="text-xs text-orange-700">数据可视化: {imgCn.dataVisualization}</p>}
                                      {imgCn.tips && imgCn.tips.length > 0 && (
                                        <ul className="text-xs text-orange-700 space-y-0.5">
                                          {imgCn.tips.map((t: string, j: number) => <li key={j}>• {t}</li>)}
                                        </ul>
                                      )}
                                    </>
                                  ) : (
                                    <p className="text-sm text-muted-foreground italic">暂无中文翻译</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* A+ Content */}
                {imageAdvice.aPlusContent && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        A+ 内容建议
                        {imageAdviceCn?.aPlusContent && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />中英对照
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                        <div className="p-3 rounded-lg border bg-blue-50/30 border-blue-200">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English Strategy</span>
                          <p className="text-sm mt-1">{imageAdvice.aPlusContent.overallStrategy}</p>
                        </div>
                        <div className="p-3 rounded-lg border bg-orange-50/30 border-orange-200">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文策略</span>
                          <p className="text-sm mt-1 text-orange-900">{imageAdviceCn?.aPlusContent?.overallStrategy || "暂无中文翻译"}</p>
                        </div>
                      </div>
                      {imageAdvice.aPlusContent.sections && (
                        <div className="space-y-4">
                          {imageAdvice.aPlusContent.sections.map((section: any, i: number) => {
                            const sectionCn = imageAdviceCn?.aPlusContent?.sections?.[i];
                            return (
                              <div key={i} className="rounded-lg border overflow-hidden">
                                <div className="px-4 py-2 bg-muted/50 border-b flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">{section.type}</Badge>
                                  <span className="text-sm font-medium">{section.purpose}</span>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x">
                                  <div className="p-3 bg-blue-50/20 space-y-2">
                                    <span className="text-xs font-semibold text-blue-700 uppercase">English</span>
                                    <p className="text-sm mt-1">{section.content}</p>
                                    {section.dataVisualization && (
                                      <p className="text-sm mt-1"><span className="text-xs text-blue-600 font-medium">数据可视化:</span> {section.dataVisualization}</p>
                                    )}
                                  </div>
                                  <div className="p-3 bg-orange-50/20 space-y-2">
                                    <span className="text-xs font-semibold text-orange-700 uppercase">中文</span>
                                    <p className="text-sm mt-1 text-orange-900">{sectionCn?.content || "暂无中文翻译"}</p>
                                    {sectionCn?.dataVisualization && (
                                      <p className="text-sm mt-1 text-orange-800"><span className="text-xs text-orange-600 font-medium">数据可视化:</span> {sectionCn.dataVisualization}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Design Guidelines */}
                {imageAdvice.designGuidelines && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Palette className="h-4 w-4 text-violet-600" />
                        整体设计指南
                        {imageAdviceCn?.designGuidelines && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />中英对照
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>统一的品牌视觉规范，确保全套图片风格一致</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200 space-y-3">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          {imageAdvice.designGuidelines.fontRecommendation && (
                            <div className="flex items-start gap-2">
                              <TypeIcon className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-blue-700">推荐字体</p>
                                <p className="text-sm">{imageAdvice.designGuidelines.fontRecommendation}</p>
                              </div>
                            </div>
                          )}
                          {imageAdvice.designGuidelines.overallColorPalette && (
                            <div className="flex items-start gap-2">
                              <Palette className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-blue-700">整体配色方案</p>
                                <p className="text-sm">{imageAdvice.designGuidelines.overallColorPalette}</p>
                              </div>
                            </div>
                          )}
                          {imageAdvice.designGuidelines.brandTone && (
                            <div className="flex items-start gap-2">
                              <Lightbulb className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-blue-700">品牌调性</p>
                                <p className="text-sm">{imageAdvice.designGuidelines.brandTone}</p>
                              </div>
                            </div>
                          )}
                          {imageAdvice.designGuidelines.mobileOptimization && (
                            <div className="flex items-start gap-2">
                              <Smartphone className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-blue-700">手机端优化</p>
                                <p className="text-sm">{imageAdvice.designGuidelines.mobileOptimization}</p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200 space-y-3">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          {imageAdviceCn?.designGuidelines ? (
                            <>
                              {imageAdviceCn.designGuidelines.fontRecommendation && (
                                <div className="flex items-start gap-2">
                                  <TypeIcon className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-orange-700">推荐字体</p>
                                    <p className="text-sm text-orange-900">{imageAdviceCn.designGuidelines.fontRecommendation}</p>
                                  </div>
                                </div>
                              )}
                              {imageAdviceCn.designGuidelines.overallColorPalette && (
                                <div className="flex items-start gap-2">
                                  <Palette className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-orange-700">整体配色方案</p>
                                    <p className="text-sm text-orange-900">{imageAdviceCn.designGuidelines.overallColorPalette}</p>
                                  </div>
                                </div>
                              )}
                              {imageAdviceCn.designGuidelines.brandTone && (
                                <div className="flex items-start gap-2">
                                  <Lightbulb className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-orange-700">品牌调性</p>
                                    <p className="text-sm text-orange-900">{imageAdviceCn.designGuidelines.brandTone}</p>
                                  </div>
                                </div>
                              )}
                              {imageAdviceCn.designGuidelines.mobileOptimization && (
                                <div className="flex items-start gap-2">
                                  <Smartphone className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-medium text-orange-700">手机端优化</p>
                                    <p className="text-sm text-orange-900">{imageAdviceCn.designGuidelines.mobileOptimization}</p>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">暂无中文翻译</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Regenerate translation for image advice */}
                {!imageAdviceCn && (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      onClick={handleTranslate}
                      disabled={translateToChinese.isPending}
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                    >
                      {translateToChinese.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Languages className="h-4 w-4 mr-2" />
                      )}
                      生成图片建议中文翻译
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Image className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">\u6682\u65e0\u56fe\u7247\u5efa\u8bae\u6570\u636e</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════
              Version History Tab
              ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4 text-purple-600" />
                  \u7248\u672c\u5386\u53f2
                </CardTitle>
                <CardDescription>
                  \u8bb0\u5f55\u6bcf\u6b21\u751f\u6210\u3001AI\u4f18\u5316\u3001\u624b\u52a8\u7f16\u8f91\u7684\u5185\u5bb9\u53d8\u66f4\uff0c\u652f\u6301\u4e00\u952e\u56de\u6eda
                </CardDescription>
              </CardHeader>
              <CardContent>
                {versionsQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : !versionsQuery.data || versionsQuery.data.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <History className="h-8 w-8 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground text-sm">\u6682\u65e0\u7248\u672c\u5386\u53f2</p>
                    <p className="text-xs text-muted-foreground mt-1">\u751f\u6210\u3001\u7f16\u8f91\u6216\u4f18\u5316Listing\u540e\u4f1a\u81ea\u52a8\u8bb0\u5f55\u7248\u672c</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versionsQuery.data.map((version: any, idx: number) => {
                      const isExpanded = expandedVersionId === version.id;
                      const isLatest = idx === 0;
                      const changeIconMap: Record<string, React.ReactNode> = {
                        generate: <Sparkles className="h-4 w-4 text-blue-500" />,
                        ab_apply: <GitBranch className="h-4 w-4 text-green-500" />,
                        optimize: <Wand2 className="h-4 w-4 text-purple-500" />,
                        manual_edit: <Pencil className="h-4 w-4 text-amber-500" />,
                        translate: <Globe className="h-4 w-4 text-orange-500" />,
                      };
                      const changeIcon = changeIconMap[version.changeType] || <History className="h-4 w-4 text-gray-500" />;
                      const changeLabelMap: Record<string, string> = {
                        generate: "\u751f\u6210",
                        ab_apply: "A/B\u5e94\u7528",
                        optimize: "AI\u4f18\u5316",
                        manual_edit: "\u624b\u52a8\u7f16\u8f91",
                        translate: "\u7ffb\u8bd1",
                      };
                      const changeLabel = changeLabelMap[version.changeType] || version.changeType;
                      const changeColor = ({
                        generate: "bg-blue-100 text-blue-700",
                        ab_apply: "bg-green-100 text-green-700",
                        optimize: "bg-purple-100 text-purple-700",
                        manual_edit: "bg-amber-100 text-amber-700",
                        translate: "bg-orange-100 text-orange-700",
                      } as Record<string, string>)[version.changeType] || "bg-gray-100 text-gray-700";

                      return (
                        <div key={version.id} className={`border rounded-lg transition-all ${isLatest ? "border-primary/30 bg-primary/5" : ""}`}>
                          <div
                            className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => setExpandedVersionId(isExpanded ? null : version.id)}
                          >
                            <div className="flex items-center gap-3">
                              {changeIcon}
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">#{version.versionNumber}</span>
                                  <Badge variant="secondary" className={`text-xs ${changeColor}`}>{changeLabel}</Badge>
                                  {isLatest && <Badge variant="outline" className="text-xs border-primary text-primary">\u5f53\u524d</Badge>}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">{version.changeDescription || "\u65e0\u63cf\u8ff0"}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</span>
                              {!isLatest && (
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setRollbackConfirmId(version.id); }}>
                                  <RotateCcw className="h-3 w-3 mr-1" />\u56de\u6eda
                                </Button>
                              )}
                              {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="px-3 pb-3 border-t">
                              <div className="grid gap-3 mt-3">
                                {version.title && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                                      <Type className="h-3 w-3" /> \u6807\u9898
                                    </p>
                                    <p className="text-sm bg-muted/50 p-2 rounded">{version.title}</p>
                                  </div>
                                )}
                                {version.bulletPoints && (() => {
                                  try {
                                    const bps = JSON.parse(version.bulletPoints);
                                    if (Array.isArray(bps) && bps.length > 0) {
                                      return (
                                        <div>
                                          <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                                            <List className="h-3 w-3" /> \u5356\u70b9 ({bps.length}\u6761)
                                          </p>
                                          <div className="space-y-1">
                                            {bps.map((bp: any, i: number) => (
                                              <p key={i} className="text-sm bg-muted/50 p-2 rounded">
                                                {typeof bp === "string" ? bp : bp.subtitle ? `${bp.subtitle} ${bp.fullText || ""}` : bp.fullText || JSON.stringify(bp)}
                                              </p>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    }
                                  } catch {}
                                  return null;
                                })()}
                                {version.description && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                                      <FileText className="h-3 w-3" /> \u63cf\u8ff0
                                    </p>
                                    <p className="text-sm bg-muted/50 p-2 rounded line-clamp-4">{version.description}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rollback Confirmation Dialog */}
            <Dialog open={!!rollbackConfirmId} onOpenChange={(open) => !open && setRollbackConfirmId(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>\u786e\u8ba4\u56de\u6eda</DialogTitle>
                  <DialogDescription>
                    \u56de\u6eda\u5c06\u628a\u5f53\u524dListing\u5185\u5bb9\u66ff\u6362\u4e3a\u6240\u9009\u7248\u672c\u7684\u5185\u5bb9\u3002\u5f53\u524d\u72b6\u6001\u4f1a\u81ea\u52a8\u4fdd\u5b58\u4e3a\u4e00\u4e2a\u65b0\u7248\u672c\u4ee5\u4fbf\u540e\u7eed\u6062\u590d\u3002
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRollbackConfirmId(null)}>\u53d6\u6d88</Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (rollbackConfirmId && selectedProjectId) {
                        rollbackMutation.mutate({ versionId: rollbackConfirmId, projectId: selectedProjectId });
                      }
                    }}
                    disabled={rollbackMutation.isPending}
                  >
                    {rollbackMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4 mr-2" />
                    )}
                    \u786e\u8ba4\u56de\u6eda
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
