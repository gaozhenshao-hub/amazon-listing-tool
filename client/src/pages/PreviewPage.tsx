import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";

export default function PreviewPage() {
  const { selectedProjectId } = useProject();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    title: "",
    bulletPoints: "",
    description: "",
    searchTerms: "",
  });

  const { data: listing, isLoading } = trpc.listing.getActive.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();
  const updateListing = trpc.listing.update.useMutation({
    onSuccess: () => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      setIsEditing(false);
      toast.success("Listing已更新");
    },
    onError: (err) => toast.error("更新失败: " + err.message),
  });

  const translateToChinese = trpc.listing.translateToChinese.useMutation({
    onSuccess: () => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      toast.success("中文翻译生成完成！");
    },
    onError: (err) => toast.error("翻译失败: " + err.message),
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
    try {
      return JSON.parse(listing.imageAdvice);
    } catch {
      return null;
    }
  }, [listing?.imageAdvice]);

  const imageAdviceCn = useMemo(() => {
    if (!listing?.imageAdviceCn) return null;
    try {
      return JSON.parse(listing.imageAdviceCn);
    } catch {
      return null;
    }
  }, [listing?.imageAdviceCn]);

  const hasChinese = !!(listing?.titleCn || listing?.bulletPointsCn || listing?.descriptionCn || listing?.searchTermsCn);

  const generateReport = trpc.report.generateReport.useMutation({
    onSuccess: (data) => {
      // Open HTML in new window for printing/saving as PDF
      const blob = new Blob([data.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) {
        win.onload = () => {
          // Auto-trigger print dialog for PDF saving
          setTimeout(() => {
            win.print();
          }, 500);
        };
      }
      toast.success("报告已生成，请在弹出窗口中保存为PDF");
    },
    onError: (err) => toast.error("报告生成失败: " + err.message),
  });

  const handleExportReport = () => {
    if (!selectedProjectId) return;
    generateReport.mutate({ projectId: selectedProjectId });
  };

  const handleSave = () => {
    if (!listing) return;
    updateListing.mutate({
      id: listing.id,
      title: editData.title,
      bulletPoints: editData.bulletPoints,
      description: editData.description,
      searchTerms: editData.searchTerms,
    });
  };

  const handleTranslate = () => {
    if (!selectedProjectId) return;
    translateToChinese.mutate({ projectId: selectedProjectId });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}已复制到剪贴板`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">结果预览</h1>
          <p className="text-muted-foreground mt-1">
            查看、编辑和导出生成的Listing内容（中英文对比）
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector />
          {listing && (
            <div className="flex gap-2">
              {!hasChinese && !isEditing && (
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
                  生成中文翻译
                </Button>
              )}
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
                  导出完整报告
                </Button>
              )}
              <Button
                variant={isEditing ? "default" : "outline"}
                onClick={() => {
                  if (isEditing) {
                    handleSave();
                  } else {
                    setIsEditing(true);
                  }
                }}
                disabled={updateListing.isPending}
              >
                {updateListing.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : isEditing ? (
                  <Save className="h-4 w-4 mr-2" />
                ) : (
                  <Edit3 className="h-4 w-4 mr-2" />
                )}
                {isEditing ? "保存修改" : "编辑"}
              </Button>
              {isEditing && (
                <Button variant="ghost" onClick={() => {
                  setIsEditing(false);
                  if (listing) {
                    setEditData({
                      title: listing.title || "",
                      bulletPoints: listing.bulletPoints || "",
                      description: listing.description || "",
                      searchTerms: listing.searchTerms || "",
                    });
                  }
                }}>
                  取消
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
            <p className="text-muted-foreground">请先选择一个项目</p>
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
            <p className="text-muted-foreground mb-2">暂无生成结果</p>
            <p className="text-sm text-muted-foreground">请先在"Listing生成"页面生成内容</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="preview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="preview">
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              预览模式
            </TabsTrigger>
            <TabsTrigger value="bilingual">
              <Languages className="h-3.5 w-3.5 mr-1.5" />
              中英对比
            </TabsTrigger>
            <TabsTrigger value="images">
              <Image className="h-3.5 w-3.5 mr-1.5" />
              图片建议
            </TabsTrigger>
          </TabsList>

          {/* Preview Mode - English only with editing */}
          <TabsContent value="preview" className="space-y-4">
            {/* Title */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Type className="h-4 w-4 text-blue-600" />
                    产品标题
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const count = (isEditing ? editData.title : listing.title)?.length || 0;
                      const inRange = count >= 180 && count <= 200;
                      const tooShort = count < 180;
                      return (
                        <Badge variant={inRange ? "default" : "destructive"} className={`text-xs ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}>
                          {count} / 180-200 字符 {inRange ? "✓" : tooShort ? "↑偏短" : "↓偏长"}
                        </Badge>
                      );
                    })()}
                    {!isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => copyToClipboard(listing.title || "", "标题")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <Textarea
                    value={editData.title}
                    onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                    rows={3}
                    className="font-medium"
                  />
                ) : (
                  <p className="text-sm font-medium leading-relaxed">{listing.title}</p>
                )}
              </CardContent>
            </Card>

            {/* Bullet Points */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <List className="h-4 w-4 text-green-600" />
                    五点描述 (Bullet Points)
                  </CardTitle>
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        const text = bulletPointsArray.map((bp: any) =>
                          typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || bp.sellingPoint || ""}`
                        ).join("\n\n");
                        copyToClipboard(text, "五点描述");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">编辑JSON格式的五点描述</p>
                    <Textarea
                      value={editData.bulletPoints}
                      onChange={(e) => setEditData({ ...editData, bulletPoints: e.target.value })}
                      rows={12}
                      className="font-mono text-xs"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {bulletPointsArray.map((bp: any, i: number) => (
                      <div key={i} className="p-3 bg-muted/30 rounded-lg border-l-2 border-l-green-500">
                        {typeof bp === "string" ? (
                          <p className="text-sm">{bp}</p>
                        ) : (
                          <>
                            <p className="text-sm">
                              <span className="font-bold uppercase">{bp.subtitle || `Bullet ${i + 1}`}</span>
                              {bp.fullText && <span className="text-muted-foreground"> — {bp.fullText}</span>}
                              {!bp.fullText && bp.sellingPoint && <span className="text-muted-foreground"> — {bp.sellingPoint}</span>}
                            </p>
                            {(() => {
                              const fullBullet = bp.subtitle && bp.fullText
                                ? `${bp.subtitle} ${bp.fullText}`
                                : bp.fullText || bp.subtitle || "";
                              const count = fullBullet.length;
                              const inRange = count >= 200 && count <= 280;
                              const tooShort = count < 200;
                              return (
                                <Badge variant={inRange ? "default" : "destructive"} className={`text-xs mt-2 ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}>
                                  {count} / 200-280 字符 {inRange ? "✓" : tooShort ? "↑偏短" : "↓偏长"}
                                </Badge>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Description */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-purple-600" />
                    产品描述
                  </CardTitle>
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => copyToClipboard(listing.description || "", "产品描述")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <Textarea
                    value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    rows={10}
                  />
                ) : (
                  <div className="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: listing.description || "" }}
                  />
                )}
              </CardContent>
            </Card>

            {/* Search Terms */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="h-4 w-4 text-amber-600" />
                    后台搜索词 (Search Terms)
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {new Blob([(isEditing ? editData.searchTerms : listing.searchTerms) || ""]).size} / 250 bytes
                    </Badge>
                    {!isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => copyToClipboard(listing.searchTerms || "", "搜索词")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <Textarea
                    value={editData.searchTerms}
                    onChange={(e) => setEditData({ ...editData, searchTerms: e.target.value })}
                    rows={4}
                    className="font-mono text-sm"
                  />
                ) : (
                  <p className="text-sm font-mono bg-muted/30 p-3 rounded-lg break-all">
                    {listing.searchTerms}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Version Info */}
            <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
              <span>版本 {listing.version} · 生成于 {new Date(listing.createdAt).toLocaleString("zh-CN")}</span>
              <Badge variant="secondary">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                当前版本
              </Badge>
            </div>
          </TabsContent>

          {/* Bilingual Comparison Mode */}
          <TabsContent value="bilingual" className="space-y-4">
            {!hasChinese ? (
              <Card className="border-dashed border-orange-300">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Languages className="h-8 w-8 text-orange-400 mb-4" />
                  <p className="text-muted-foreground mb-3">暂无中文翻译</p>
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
                    {translateToChinese.isPending ? "翻译中..." : "一键生成中文翻译"}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Title Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Type className="h-4 w-4 text-blue-600" />
                      产品标题
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />
                        中英对照
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* English */}
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.title || "", "英文标题")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-medium leading-relaxed">{listing.title}</p>
                        {(() => {
                          const count = listing.title?.length || 0;
                          const inRange = count >= 180 && count <= 200;
                          const tooShort = count < 180;
                          return (
                            <Badge variant={inRange ? "default" : "destructive"} className={`text-xs mt-2 ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}>
                              {count} / 180-200 字符 {inRange ? "✓" : tooShort ? "↑偏短" : "↓偏长"}
                            </Badge>
                          );
                        })()}
                      </div>
                      {/* Chinese */}
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.titleCn || "", "中文标题")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-medium leading-relaxed">{listing.titleCn}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Bullet Points Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <List className="h-4 w-4 text-green-600" />
                        五点描述
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                          <Languages className="h-3 w-3 mr-1" />
                          中英对照
                        </Badge>
                      </CardTitle>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                        const enText = bulletPointsArray.map((bp: any) =>
                          typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || bp.sellingPoint || ""}`
                        ).join("\n\n");
                        const cnText = bulletPointsCnArray.map((bp: any) =>
                          typeof bp === "string" ? bp : `${bp.subtitle || ""} ${bp.fullText || ""}`
                        ).join("\n\n");
                        copyToClipboard(`=== English ===\n${enText}\n\n=== 中文 ===\n${cnText}`, "中英文五点描述");
                      }}>
                        <Copy className="h-3 w-3 mr-1" />
                        复制全部
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {bulletPointsArray.map((bp: any, i: number) => {
                      const cnBp = bulletPointsCnArray[i];
                      const fullBullet = typeof bp === "string" ? bp : (bp.subtitle && bp.fullText ? `${bp.subtitle} ${bp.fullText}` : bp.fullText || bp.subtitle || "");
                      const count = fullBullet.length;
                      const inRange = count >= 200 && count <= 280;
                      const tooShort = count < 200;
                      return (
                        <div key={i} className="rounded-lg border overflow-hidden">
                          <div className="grid grid-cols-1 lg:grid-cols-2">
                            {/* English */}
                            <div className="p-3 bg-blue-50/30 border-b lg:border-b-0 lg:border-r border-blue-200">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Badge variant="secondary" className="text-xs">EN {i + 1}</Badge>
                                <Badge variant={inRange ? "default" : "destructive"} className={`text-xs ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}>
                                  {count}字符 {inRange ? "✓" : tooShort ? "↑" : "↓"}
                                </Badge>
                              </div>
                              {typeof bp === "string" ? (
                                <p className="text-sm">{bp}</p>
                              ) : (
                                <p className="text-sm">
                                  <span className="font-bold">{bp.subtitle || `Bullet ${i + 1}`}</span>
                                  {bp.fullText && <span className="text-muted-foreground"> — {bp.fullText}</span>}
                                  {!bp.fullText && bp.sellingPoint && <span className="text-muted-foreground"> — {bp.sellingPoint}</span>}
                                </p>
                              )}
                            </div>
                            {/* Chinese */}
                            <div className="p-3 bg-orange-50/30">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700">中 {i + 1}</Badge>
                              </div>
                              {cnBp ? (
                                typeof cnBp === "string" ? (
                                  <p className="text-sm">{cnBp}</p>
                                ) : (
                                  <p className="text-sm">
                                    <span className="font-bold">{cnBp.subtitle || `卖点 ${i + 1}`}</span>
                                    {cnBp.fullText && <span className="text-orange-700"> — {cnBp.fullText}</span>}
                                  </p>
                                )
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

                {/* Description Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4 text-purple-600" />
                      产品描述
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />
                        中英对照
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* English */}
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.description || "", "英文描述")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground"
                          dangerouslySetInnerHTML={{ __html: listing.description || "" }}
                        />
                      </div>
                      {/* Chinese */}
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.descriptionCn || "", "中文描述")}>
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
                      后台搜索词
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                        <Languages className="h-3 w-3 mr-1" />
                        中英对照
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* English */}
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.searchTerms || "", "英文搜索词")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-mono break-all">{listing.searchTerms}</p>
                        <Badge variant="outline" className="text-xs mt-2">
                          {new Blob([listing.searchTerms || ""].map(String)).size} / 250 bytes
                        </Badge>
                      </div>
                      {/* Chinese */}
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(listing.searchTermsCn || "", "中文搜索词")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm font-mono break-all text-orange-900">{listing.searchTermsCn || "暂无翻译"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

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
                    {translateToChinese.isPending ? "重新翻译中..." : "重新生成中文翻译"}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {/* Image Advice Tab - Bilingual */}
          <TabsContent value="images" className="space-y-4">
            {imageAdvice ? (
              <>
                {/* Main Image - Bilingual */}
                {imageAdvice.mainImage && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        首图建议
                        {imageAdviceCn?.mainImage && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />
                            中英对照
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* English */}
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
                                  <li key={i} className="flex items-start gap-2">
                                    <span className="text-primary mt-0.5">•</span>{t}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        {/* Chinese */}
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
                              {imageAdviceCn.mainImage.colorScheme && (
                                <div>
                                  <p className="text-xs font-medium text-orange-700 mb-1">配色方案</p>
                                  <div className="flex flex-wrap gap-2">
                                    {imageAdviceCn.mainImage.colorScheme.primary && (
                                      <span className="text-xs text-orange-800">主色: {imageAdviceCn.mainImage.colorScheme.primary}</span>
                                    )}
                                    {imageAdviceCn.mainImage.colorScheme.secondary && (
                                      <span className="text-xs text-orange-800">辅色: {imageAdviceCn.mainImage.colorScheme.secondary}</span>
                                    )}
                                    {imageAdviceCn.mainImage.colorScheme.accent && (
                                      <span className="text-xs text-orange-800">点缀色: {imageAdviceCn.mainImage.colorScheme.accent}</span>
                                    )}
                                  </div>
                                </div>
                              )}
                              {imageAdviceCn.mainImage.keyElements && (
                                <div>
                                  <p className="text-xs font-medium text-orange-700 mb-1">关键元素</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {imageAdviceCn.mainImage.keyElements.map((e: string, i: number) => (
                                      <Badge key={i} variant="secondary" className="text-xs bg-orange-100 text-orange-800">{e}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {imageAdviceCn.mainImage.tips && (
                                <div>
                                  <p className="text-xs font-medium text-orange-700 mb-1">拍摄提示</p>
                                  <ul className="text-sm space-y-1 text-orange-800">
                                    {imageAdviceCn.mainImage.tips.map((t: string, i: number) => (
                                      <li key={i} className="flex items-start gap-2">
                                        <span className="text-orange-500 mt-0.5">•</span>{t}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">暂无中文翻译，请点击"生成中文翻译"</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Secondary Images - Bilingual */}
                {imageAdvice.secondaryImages && imageAdvice.secondaryImages.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        辅图建议
                        {imageAdviceCn?.secondaryImages && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />
                            中英对照
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>按卖点重要性排序的辅图方案（含配色、构图、表达方式、数据可视化建议）</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        {imageAdvice.secondaryImages.map((img: any, i: number) => {
                          const imgCn = imageAdviceCn?.secondaryImages?.[i];
                          return (
                            <div key={i} className="rounded-lg border overflow-hidden">
                              <div className="px-4 py-2 bg-muted/50 border-b flex items-center gap-3">
                                <Badge variant="default" className="text-xs">图 {img.imageNumber || i + 2}</Badge>
                                <span className="text-sm font-semibold">{img.title || img.focus || img.sellingPoint}</span>
                                {img.expressionMethod && (
                                  <Badge variant="outline" className="text-xs border-purple-300 text-purple-600">
                                    {img.expressionMethod}
                                  </Badge>
                                )}
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x">
                                {/* English */}
                                <div className="p-4 bg-blue-50/20 space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                                      `Image ${img.imageNumber || i + 2}: ${img.title || img.focus || img.sellingPoint}\nExpression: ${img.expressionMethod || ''}\nComposition: ${img.composition || ''}\nText Overlay: ${img.textOverlay || ''}\nData Visualization: ${img.dataVisualization || ''}\nTips: ${(img.tips || []).join('; ')}`,
                                      `英文图${img.imageNumber || i + 2}建议`
                                    )}>
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  {img.focus && (
                                    <p className="text-sm"><span className="text-xs text-blue-600 font-medium">核心卖点:</span> {img.focus}</p>
                                  )}
                                  {img.sellingPoint && img.sellingPoint !== img.focus && (
                                    <p className="text-sm"><span className="text-xs text-blue-600 font-medium">FABE分析:</span> {img.sellingPoint}</p>
                                  )}
                                  {img.composition && (
                                    <p className="text-sm"><span className="text-xs text-blue-600 font-medium">构图方式:</span> {img.composition}</p>
                                  )}
                                  {img.textOverlay && (
                                    <p className="text-sm"><span className="text-xs text-blue-600 font-medium">文案:</span> {img.textOverlay}</p>
                                  )}
                                  {img.colorScheme && (
                                    <div>
                                      <span className="text-xs text-blue-600 font-medium">配色方案:</span>
                                      <div className="flex flex-wrap gap-2 mt-1">
                                        {img.colorScheme.primary && (
                                          <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: img.colorScheme.primary.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                            <span className="text-xs">{img.colorScheme.primary}</span>
                                          </div>
                                        )}
                                        {img.colorScheme.secondary && (
                                          <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: img.colorScheme.secondary.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                            <span className="text-xs">{img.colorScheme.secondary}</span>
                                          </div>
                                        )}
                                        {img.colorScheme.accent && (
                                          <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: img.colorScheme.accent.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc' }} />
                                            <span className="text-xs">{img.colorScheme.accent}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {img.dataVisualization && (
                                    <p className="text-sm"><span className="text-xs text-blue-600 font-medium">数据可视化:</span> {img.dataVisualization}</p>
                                  )}
                                  {img.icons && img.icons.length > 0 && (
                                    <div>
                                      <span className="text-xs text-blue-600 font-medium">图标建议:</span>
                                      <div className="flex flex-wrap gap-1.5 mt-1">
                                        {img.icons.map((icon: string, j: number) => (
                                          <Badge key={j} variant="secondary" className="text-xs">{icon}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {img.tips && img.tips.length > 0 && (
                                    <ul className="text-xs text-muted-foreground space-y-0.5">
                                      {img.tips.map((t: string, j: number) => <li key={j}>• {t}</li>)}
                                    </ul>
                                  )}
                                </div>
                                {/* Chinese */}
                                <div className="p-4 bg-orange-50/20 space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                                    {imgCn && (
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                                        `图${img.imageNumber || i + 2}: ${imgCn.title || imgCn.focus || imgCn.sellingPoint || ''}\n表达方式: ${imgCn.expressionMethod || ''}\n构图: ${imgCn.composition || ''}\n文案: ${imgCn.textOverlay || ''}\n数据可视化: ${imgCn.dataVisualization || ''}\n提示: ${(imgCn.tips || []).join('; ')}`,
                                        `中文图${img.imageNumber || i + 2}建议`
                                      )}>
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                  {imgCn ? (
                                    <>
                                      {(imgCn.title || imgCn.focus) && (
                                        <p className="text-sm font-semibold text-orange-900">{imgCn.title || imgCn.focus || imgCn.sellingPoint}</p>
                                      )}
                                      {imgCn.sellingPoint && imgCn.sellingPoint !== imgCn.focus && (
                                        <p className="text-sm text-orange-800"><span className="text-xs text-orange-600 font-medium">FABE分析:</span> {imgCn.sellingPoint}</p>
                                      )}
                                      {imgCn.expressionMethod && (
                                        <p className="text-sm text-orange-800"><span className="text-xs text-orange-600 font-medium">表达方式:</span> {imgCn.expressionMethod}</p>
                                      )}
                                      {imgCn.composition && (
                                        <p className="text-sm text-orange-800"><span className="text-xs text-orange-600 font-medium">构图:</span> {imgCn.composition}</p>
                                      )}
                                      {imgCn.textOverlay && (
                                        <p className="text-sm text-orange-800"><span className="text-xs text-orange-600 font-medium">文案:</span> {imgCn.textOverlay}</p>
                                      )}
                                      {imgCn.colorScheme && (
                                        <div>
                                          <span className="text-xs text-orange-600 font-medium">配色方案:</span>
                                          <div className="flex flex-wrap gap-2 mt-1">
                                            {imgCn.colorScheme.primary && <span className="text-xs text-orange-800">主色: {imgCn.colorScheme.primary}</span>}
                                            {imgCn.colorScheme.secondary && <span className="text-xs text-orange-800">辅色: {imgCn.colorScheme.secondary}</span>}
                                            {imgCn.colorScheme.accent && <span className="text-xs text-orange-800">点缀色: {imgCn.colorScheme.accent}</span>}
                                          </div>
                                        </div>
                                      )}
                                      {imgCn.dataVisualization && (
                                        <p className="text-sm text-orange-800"><span className="text-xs text-orange-600 font-medium">数据可视化:</span> {imgCn.dataVisualization}</p>
                                      )}
                                      {imgCn.icons && imgCn.icons.length > 0 && (
                                        <div>
                                          <span className="text-xs text-orange-600 font-medium">图标建议:</span>
                                          <div className="flex flex-wrap gap-1.5 mt-1">
                                            {imgCn.icons.map((icon: string, j: number) => (
                                              <Badge key={j} variant="secondary" className="text-xs bg-orange-100 text-orange-800">{icon}</Badge>
                                            ))}
                                          </div>
                                        </div>
                                      )}
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

                {/* A+ Content - Bilingual */}
                {imageAdvice.aPlusContent && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        A+ 内容建议
                        {imageAdviceCn?.aPlusContent && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />
                            中英对照
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

                {/* Design Guidelines - Bilingual */}
                {imageAdvice.designGuidelines && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Palette className="h-4 w-4 text-violet-600" />
                        整体设计指南
                        {imageAdviceCn?.designGuidelines && (
                          <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />
                            中英对照
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>统一的品牌视觉规范，确保全套图片风格一致</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* English */}
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
                        {/* Chinese */}
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
                  <p className="text-muted-foreground text-sm">暂无图片建议数据</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
