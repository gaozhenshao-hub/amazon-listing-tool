import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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

  const imageAdvice = useMemo(() => {
    if (!listing?.imageAdvice) return null;
    try {
      return JSON.parse(listing.imageAdvice);
    } catch {
      return null;
    }
  }, [listing?.imageAdvice]);

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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}已复制到剪贴板`);
  };

  const parseJson = (str: string | null) => {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">结果预览</h1>
          <p className="text-muted-foreground mt-1">
            查看、编辑和导出生成的Listing内容
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector />
          {listing && (
            <div className="flex gap-2">
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
            <TabsTrigger value="images">
              <Image className="h-3.5 w-3.5 mr-1.5" />
              图片建议
            </TabsTrigger>
          </TabsList>

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
                    <Badge variant="outline" className="text-xs">
                      {(isEditing ? editData.title : listing.title)?.length || 0} / 200 字符
                    </Badge>
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
                            {bp.characterCount && (
                              <Badge variant="outline" className="text-xs mt-2">{bp.characterCount} 字符</Badge>
                            )}
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

          <TabsContent value="images" className="space-y-4">
            {imageAdvice ? (
              <>
                {/* Main Image */}
                {imageAdvice.mainImage && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">首图建议</CardTitle>
                      <CardDescription>{imageAdvice.mainImage.concept}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {imageAdvice.mainImage.composition && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">构图建议</p>
                          <p className="text-sm">{imageAdvice.mainImage.composition}</p>
                        </div>
                      )}
                      {imageAdvice.mainImage.keyElements && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">关键元素</p>
                          <div className="flex flex-wrap gap-1.5">
                            {imageAdvice.mainImage.keyElements.map((e: string, i: number) => (
                              <Badge key={i} variant="secondary" className="text-xs">{e}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {imageAdvice.mainImage.tips && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">拍摄提示</p>
                          <ul className="text-sm space-y-1 text-muted-foreground">
                            {imageAdvice.mainImage.tips.map((t: string, i: number) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="text-primary mt-0.5">•</span>
                                {t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Secondary Images */}
                {imageAdvice.secondaryImages && imageAdvice.secondaryImages.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">辅图建议</CardTitle>
                      <CardDescription>按卖点重要性排序的辅图方案</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {imageAdvice.secondaryImages.map((img: any, i: number) => (
                          <div key={i} className="p-4 bg-muted/30 rounded-lg border">
                            <div className="flex items-center gap-3 mb-2">
                              <Badge variant="default" className="text-xs">图 {img.imageNumber || i + 2}</Badge>
                              <span className="text-sm font-medium">{img.focus || img.sellingPoint}</span>
                            </div>
                            {img.composition && (
                              <p className="text-sm text-muted-foreground mb-1">构图: {img.composition}</p>
                            )}
                            {img.textOverlay && (
                              <p className="text-sm text-muted-foreground mb-1">文案: {img.textOverlay}</p>
                            )}
                            {img.tips && img.tips.length > 0 && (
                              <ul className="text-xs text-muted-foreground mt-2 space-y-0.5">
                                {img.tips.map((t: string, j: number) => (
                                  <li key={j}>• {t}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* A+ Content */}
                {imageAdvice.aPlusContent && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">A+ 内容建议</CardTitle>
                      <CardDescription>{imageAdvice.aPlusContent.overallStrategy}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {imageAdvice.aPlusContent.sections && (
                        <div className="space-y-3">
                          {imageAdvice.aPlusContent.sections.map((section: any, i: number) => (
                            <div key={i} className="p-3 bg-muted/30 rounded-lg border">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs">{section.type}</Badge>
                                <span className="text-sm font-medium">{section.purpose}</span>
                              </div>
                              <p className="text-sm text-muted-foreground">{section.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
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
