import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  AlertTriangle,
  Copy,
  Image,
  Loader2,
  Languages,
  Palette,
  Lightbulb,
  Smartphone,
  TypeIcon,
  Sparkles,
  Camera,
  BarChart3,
  Layout,
  Layers,
  Target,
  Eye,
  Paintbrush,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useState, useMemo } from "react";
import { toast } from "sonner";

// ─── Color swatch helper ────────────────────────────────────────
function ColorSwatch({ color, label }: { color: string; label: string }) {
  const hex = color.match(/#[0-9A-Fa-f]{3,8}/)?.[0] || "#ccc";
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
        style={{ backgroundColor: hex }}
      />
      <span className="text-xs">{label}: {color}</span>
    </div>
  );
}

function ColorSwatchCn({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-xs text-orange-800">{label}: {color}</span>
  );
}

// ─── FABE display component ─────────────────────────────────────
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
    <div className={`rounded-md border ${borderColor} ${bgColor} p-2.5 space-y-1.5`}>
      <p className={`text-xs font-semibold ${textColor}`}>FABE 分析</p>
      {items.map(({ key, label }) => {
        const val = typeof fabe === "string" ? null : fabe[key];
        if (!val) return null;
        return (
          <p key={key} className="text-xs">
            <span className={`font-medium ${textColor}`}>{label}:</span>{" "}
            <span className={isEn ? "" : "text-orange-900"}>{val}</span>
          </p>
        );
      })}
      {typeof fabe === "string" && (
        <p className={`text-xs ${isEn ? "" : "text-orange-900"}`}>{fabe}</p>
      )}
    </div>
  );
}

export default function ImageSuggestionsPage() {
  const { selectedProjectId } = useProject();
  const [emphasis, setEmphasis] = useState("");
  const [showEmphasis, setShowEmphasis] = useState(false);

  // Fetch active listing to get image advice
  const { data: listing, isLoading } = trpc.listing.getActive.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();

  // Generate image advice mutation
  const generateImageAdvice = trpc.listing.generateImageAdvice.useMutation({
    onSuccess: () => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      toast.success("图片建议生成完成！");
    },
    onError: (err) => toast.error("生成失败: " + err.message),
  });

  // Translate to Chinese mutation (reuses translateToChinese which also handles image advice)
  const translateImageAdvice = trpc.listing.translateToChinese.useMutation({
    onSuccess: () => {
      utils.listing.getActive.invalidate({ projectId: selectedProjectId! });
      toast.success("图片建议中文翻译生成完成！");
    },
    onError: (err: any) => toast.error("翻译失败: " + err.message),
  });

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

  const handleGenerate = () => {
    if (!selectedProjectId) return;
    generateImageAdvice.mutate({
      projectId: selectedProjectId,
      emphasis: emphasis.trim() || undefined,
    });
  };

  const handleTranslate = () => {
    if (!selectedProjectId) return;
    translateImageAdvice.mutate({ projectId: selectedProjectId });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}已复制到剪贴板`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Image className="h-6 w-6 text-violet-600" />
            智能图片建议
          </h1>
          <p className="text-muted-foreground mt-1">
            基于AI的产品图片规划，包含主图、辅图、A+内容的详细设计建议
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector />
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
      ) : (
        <>
          {/* Action Bar */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleGenerate}
                      disabled={generateImageAdvice.isPending}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      {generateImageAdvice.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      {generateImageAdvice.isPending ? "AI生成中..." : "生成图片建议"}
                    </Button>
                    {imageAdvice && !imageAdviceCn && (
                      <Button
                        variant="outline"
                        onClick={handleTranslate}
                        disabled={translateImageAdvice.isPending}
                        className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      >
                        {translateImageAdvice.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Languages className="h-4 w-4 mr-2" />
                        )}
                        生成中文翻译
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowEmphasis(!showEmphasis)}
                    className="text-muted-foreground"
                  >
                    <Target className="h-4 w-4 mr-1" />
                    {showEmphasis ? "隐藏重点设置" : "设置重点卖点"}
                  </Button>
                </div>
                {showEmphasis && (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="输入您希望重点突出的卖点、场景或设计方向（可选）..."
                      value={emphasis}
                      onChange={(e) => setEmphasis(e.target.value)}
                      rows={3}
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      AI将优先围绕您指定的重点来规划图片内容和设计方案
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          {imageAdvice ? (
            <div className="space-y-6">
              {/* Design Guidelines (Global) */}
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
                          <p className="text-sm text-muted-foreground italic">暂无中文翻译，请点击"生成中文翻译"</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Main Image */}
              {imageAdvice.mainImage && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Camera className="h-4 w-4 text-emerald-600" />
                      首图建议 (Main Image)
                      {imageAdviceCn?.mainImage && (
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                          <Languages className="h-3 w-3 mr-1" />
                          中英对照
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>纯白背景、产品占85%以上、高分辨率（2000x2000px+）</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* English */}
                      <div className="p-4 rounded-lg border bg-blue-50/30 border-blue-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                            `Concept: ${imageAdvice.mainImage.concept}\nTitle: ${imageAdvice.mainImage.title || ''}\nComposition: ${imageAdvice.mainImage.composition || ''}\nKey Elements: ${(imageAdvice.mainImage.keyElements || []).join(', ')}\nShooting Notes: ${imageAdvice.mainImage.shootingNotes || (imageAdvice.mainImage.tips || []).join('; ')}`,
                            "英文首图建议"
                          )}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-blue-700 mb-1">创意概念</p>
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
                                <ColorSwatch color={imageAdvice.mainImage.colorScheme.primary} label="主色" />
                              )}
                              {imageAdvice.mainImage.colorScheme.secondary && (
                                <ColorSwatch color={imageAdvice.mainImage.colorScheme.secondary} label="辅色" />
                              )}
                              {imageAdvice.mainImage.colorScheme.accent && (
                                <ColorSwatch color={imageAdvice.mainImage.colorScheme.accent} label="点缀色" />
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
                        {(imageAdvice.mainImage.shootingNotes || imageAdvice.mainImage.tips) && (
                          <div>
                            <p className="text-xs font-medium text-blue-700 mb-1">拍摄提示</p>
                            {imageAdvice.mainImage.shootingNotes ? (
                              <p className="text-sm text-muted-foreground">{imageAdvice.mainImage.shootingNotes}</p>
                            ) : (
                              <ul className="text-sm space-y-1 text-muted-foreground">
                                {(imageAdvice.mainImage.tips || []).map((t: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <span className="text-primary mt-0.5">•</span>{t}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Chinese */}
                      <div className="p-4 rounded-lg border bg-orange-50/30 border-orange-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文</span>
                          {imageAdviceCn?.mainImage && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                              `概念: ${imageAdviceCn.mainImage.concept}\n标题: ${imageAdviceCn.mainImage.title || ''}\n构图: ${imageAdviceCn.mainImage.composition || ''}\n拍摄提示: ${imageAdviceCn.mainImage.shootingNotes || (imageAdviceCn.mainImage.tips || []).join('; ')}`,
                              "中文首图建议"
                            )}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        {imageAdviceCn?.mainImage ? (
                          <>
                            <div>
                              <p className="text-xs font-medium text-orange-700 mb-1">创意概念</p>
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
                                  {imageAdviceCn.mainImage.colorScheme.primary && <ColorSwatchCn color={imageAdviceCn.mainImage.colorScheme.primary} label="主色" />}
                                  {imageAdviceCn.mainImage.colorScheme.secondary && <ColorSwatchCn color={imageAdviceCn.mainImage.colorScheme.secondary} label="辅色" />}
                                  {imageAdviceCn.mainImage.colorScheme.accent && <ColorSwatchCn color={imageAdviceCn.mainImage.colorScheme.accent} label="点缀色" />}
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
                            {(imageAdviceCn.mainImage.shootingNotes || imageAdviceCn.mainImage.tips) && (
                              <div>
                                <p className="text-xs font-medium text-orange-700 mb-1">拍摄提示</p>
                                {imageAdviceCn.mainImage.shootingNotes ? (
                                  <p className="text-sm text-orange-800">{imageAdviceCn.mainImage.shootingNotes}</p>
                                ) : (
                                  <ul className="text-sm space-y-1 text-orange-800">
                                    {(imageAdviceCn.mainImage.tips || []).map((t: string, i: number) => (
                                      <li key={i} className="flex items-start gap-2">
                                        <span className="text-orange-500 mt-0.5">•</span>{t}
                                      </li>
                                    ))}
                                  </ul>
                                )}
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

              {/* Secondary Images */}
              {imageAdvice.secondaryImages && imageAdvice.secondaryImages.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Layers className="h-4 w-4 text-blue-600" />
                      辅图建议 (Secondary Images 2-7)
                      {imageAdviceCn?.secondaryImages && (
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                          <Languages className="h-3 w-3 mr-1" />
                          中英对照
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>一图一卖点，按消费者关注优先级排序，含FABE分析、配色、构图、数据可视化建议</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {imageAdvice.secondaryImages.map((img: any, i: number) => {
                        const imgCn = imageAdviceCn?.secondaryImages?.[i];
                        return (
                          <div key={i} className="rounded-lg border overflow-hidden">
                            {/* Header */}
                            <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center gap-3 flex-wrap">
                              <Badge variant="default" className="text-xs">图 {img.imageNumber || i + 2}</Badge>
                              <span className="text-sm font-semibold">{img.title || img.focus || img.sellingPoint}</span>
                              {img.expressionMethod && (
                                <Badge variant="outline" className="text-xs border-purple-300 text-purple-600">
                                  <Paintbrush className="h-3 w-3 mr-1" />
                                  {img.expressionMethod}
                                </Badge>
                              )}
                            </div>
                            {/* Bilingual content */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x">
                              {/* English */}
                              <div className="p-4 bg-blue-50/20 space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English</span>
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                                    `Image ${img.imageNumber || i + 2}: ${img.title || img.focus}\nExpression: ${img.expressionMethod || ''}\nComposition: ${img.composition || ''}\nText: ${img.textOverlay || ''}\nData Viz: ${img.dataVisualization || ''}`,
                                    `英文图${img.imageNumber || i + 2}建议`
                                  )}>
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </div>
                                {img.focus && (
                                  <p className="text-sm"><span className="text-xs text-blue-600 font-medium">核心卖点:</span> {img.focus}</p>
                                )}
                                {/* FABE Analysis */}
                                {(img.fabe || img.sellingPoint) && (
                                  <FABEDisplay fabe={img.fabe || img.sellingPoint} variant="en" />
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
                                      {img.colorScheme.primary && <ColorSwatch color={img.colorScheme.primary} label="主色" />}
                                      {img.colorScheme.secondary && <ColorSwatch color={img.colorScheme.secondary} label="辅色" />}
                                      {img.colorScheme.accent && <ColorSwatch color={img.colorScheme.accent} label="点缀色" />}
                                    </div>
                                  </div>
                                )}
                                {img.dataVisualization && (
                                  <div>
                                    <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
                                      <BarChart3 className="h-3 w-3" /> 数据可视化:
                                    </span>
                                    <p className="text-sm mt-0.5">{img.dataVisualization}</p>
                                  </div>
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
                                {img.keyElements && img.keyElements.length > 0 && (
                                  <div>
                                    <span className="text-xs text-blue-600 font-medium">关键元素:</span>
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                      {img.keyElements.map((el: string, j: number) => (
                                        <Badge key={j} variant="outline" className="text-xs">{el}</Badge>
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
                                      `图${img.imageNumber || i + 2}: ${imgCn.title || imgCn.focus || ''}\n表达方式: ${imgCn.expressionMethod || ''}\n构图: ${imgCn.composition || ''}\n文案: ${imgCn.textOverlay || ''}`,
                                      `中文图${img.imageNumber || i + 2}建议`
                                    )}>
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                                {imgCn ? (
                                  <>
                                    {(imgCn.title || imgCn.focus) && (
                                      <p className="text-sm font-semibold text-orange-900">{imgCn.title || imgCn.focus}</p>
                                    )}
                                    {(imgCn.fabe || imgCn.sellingPoint) && (
                                      <FABEDisplay fabe={imgCn.fabe || imgCn.sellingPoint} variant="cn" />
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
                                          {imgCn.colorScheme.primary && <ColorSwatchCn color={imgCn.colorScheme.primary} label="主色" />}
                                          {imgCn.colorScheme.secondary && <ColorSwatchCn color={imgCn.colorScheme.secondary} label="辅色" />}
                                          {imgCn.colorScheme.accent && <ColorSwatchCn color={imgCn.colorScheme.accent} label="点缀色" />}
                                        </div>
                                      </div>
                                    )}
                                    {imgCn.dataVisualization && (
                                      <div>
                                        <span className="text-xs text-orange-600 font-medium flex items-center gap-1">
                                          <BarChart3 className="h-3 w-3" /> 数据可视化:
                                        </span>
                                        <p className="text-sm mt-0.5 text-orange-800">{imgCn.dataVisualization}</p>
                                      </div>
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
                                    {imgCn.keyElements && imgCn.keyElements.length > 0 && (
                                      <div>
                                        <span className="text-xs text-orange-600 font-medium">关键元素:</span>
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                          {imgCn.keyElements.map((el: string, j: number) => (
                                            <Badge key={j} variant="outline" className="text-xs border-orange-300 text-orange-800">{el}</Badge>
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

              {/* A+ Content */}
              {imageAdvice.aPlusContent && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Layout className="h-4 w-4 text-amber-600" />
                      A+ 内容建议
                      {imageAdviceCn?.aPlusContent && (
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                          <Languages className="h-3 w-3 mr-1" />
                          中英对照
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>吸引注意 → 展示利益 → 消除疑虑 → 建立信任</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {/* Overall Strategy */}
                    {(imageAdvice.aPlusContent.overallStrategy || imageAdvice.aPlusContent.overallStory) && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                        <div className="p-3 rounded-lg border bg-blue-50/30 border-blue-200">
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">English Strategy</span>
                          <p className="text-sm mt-1">{imageAdvice.aPlusContent.overallStrategy}</p>
                          {imageAdvice.aPlusContent.overallStory && (
                            <p className="text-sm mt-1"><span className="text-xs text-blue-600 font-medium">故事线:</span> {imageAdvice.aPlusContent.overallStory}</p>
                          )}
                          {imageAdvice.aPlusContent.consistency && (
                            <p className="text-sm mt-1"><span className="text-xs text-blue-600 font-medium">一致性:</span> {imageAdvice.aPlusContent.consistency}</p>
                          )}
                          {imageAdvice.aPlusContent.modularDesign && (
                            <p className="text-sm mt-1"><span className="text-xs text-blue-600 font-medium">模块化设计:</span> {imageAdvice.aPlusContent.modularDesign}</p>
                          )}
                        </div>
                        <div className="p-3 rounded-lg border bg-orange-50/30 border-orange-200">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">中文策略</span>
                          <p className="text-sm mt-1 text-orange-900">{imageAdviceCn?.aPlusContent?.overallStrategy || "暂无中文翻译"}</p>
                          {imageAdviceCn?.aPlusContent?.overallStory && (
                            <p className="text-sm mt-1 text-orange-800"><span className="text-xs text-orange-600 font-medium">故事线:</span> {imageAdviceCn.aPlusContent.overallStory}</p>
                          )}
                          {imageAdviceCn?.aPlusContent?.consistency && (
                            <p className="text-sm mt-1 text-orange-800"><span className="text-xs text-orange-600 font-medium">一致性:</span> {imageAdviceCn.aPlusContent.consistency}</p>
                          )}
                          {imageAdviceCn?.aPlusContent?.modularDesign && (
                            <p className="text-sm mt-1 text-orange-800"><span className="text-xs text-orange-600 font-medium">模块化设计:</span> {imageAdviceCn.aPlusContent.modularDesign}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* A+ Sections */}
                    {imageAdvice.aPlusContent.sections && (
                      <div className="space-y-4">
                        {imageAdvice.aPlusContent.sections.map((section: any, i: number) => {
                          const sectionCn = imageAdviceCn?.aPlusContent?.sections?.[i];
                          return (
                            <div key={i} className="rounded-lg border overflow-hidden">
                              <div className="px-4 py-2 bg-muted/50 border-b flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-xs">{section.type}</Badge>
                                <span className="text-sm font-medium">{section.title || section.purpose}</span>
                                {section.expressionMethod && (
                                  <Badge variant="outline" className="text-xs border-purple-300 text-purple-600">
                                    {section.expressionMethod}
                                  </Badge>
                                )}
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x">
                                <div className="p-3 bg-blue-50/20 space-y-2">
                                  <span className="text-xs font-semibold text-blue-700 uppercase">English</span>
                                  <p className="text-sm mt-1">{section.content}</p>
                                  {section.fabe && <FABEDisplay fabe={section.fabe} variant="en" />}
                                  {section.colorScheme && (
                                    <div>
                                      <span className="text-xs text-blue-600 font-medium">配色:</span>
                                      <div className="flex flex-wrap gap-2 mt-1">
                                        {section.colorScheme.primary && <ColorSwatch color={section.colorScheme.primary} label="主色" />}
                                        {section.colorScheme.secondary && <ColorSwatch color={section.colorScheme.secondary} label="辅色" />}
                                        {section.colorScheme.accent && <ColorSwatch color={section.colorScheme.accent} label="点缀色" />}
                                      </div>
                                    </div>
                                  )}
                                  {section.composition && (
                                    <p className="text-sm"><span className="text-xs text-blue-600 font-medium">构图:</span> {section.composition}</p>
                                  )}
                                  {section.dataVisualization && (
                                    <p className="text-sm"><span className="text-xs text-blue-600 font-medium">数据可视化:</span> {section.dataVisualization}</p>
                                  )}
                                  {section.icons && section.icons.length > 0 && (
                                    <div>
                                      <span className="text-xs text-blue-600 font-medium">图标:</span>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {section.icons.map((icon: string, j: number) => (
                                          <Badge key={j} variant="secondary" className="text-xs">{icon}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {section.tips && section.tips.length > 0 && (
                                    <ul className="text-xs text-muted-foreground space-y-0.5">
                                      {section.tips.map((t: string, j: number) => <li key={j}>• {t}</li>)}
                                    </ul>
                                  )}
                                </div>
                                <div className="p-3 bg-orange-50/20 space-y-2">
                                  <span className="text-xs font-semibold text-orange-700 uppercase">中文</span>
                                  {sectionCn ? (
                                    <>
                                      <p className="text-sm mt-1 text-orange-900">{sectionCn.content || "暂无中文翻译"}</p>
                                      {sectionCn.fabe && <FABEDisplay fabe={sectionCn.fabe} variant="cn" />}
                                      {sectionCn.colorScheme && (
                                        <div>
                                          <span className="text-xs text-orange-600 font-medium">配色:</span>
                                          <div className="flex flex-wrap gap-2 mt-1">
                                            {sectionCn.colorScheme.primary && <ColorSwatchCn color={sectionCn.colorScheme.primary} label="主色" />}
                                            {sectionCn.colorScheme.secondary && <ColorSwatchCn color={sectionCn.colorScheme.secondary} label="辅色" />}
                                            {sectionCn.colorScheme.accent && <ColorSwatchCn color={sectionCn.colorScheme.accent} label="点缀色" />}
                                          </div>
                                        </div>
                                      )}
                                      {sectionCn.composition && (
                                        <p className="text-sm text-orange-800"><span className="text-xs text-orange-600 font-medium">构图:</span> {sectionCn.composition}</p>
                                      )}
                                      {sectionCn.dataVisualization && (
                                        <p className="text-sm text-orange-800"><span className="text-xs text-orange-600 font-medium">数据可视化:</span> {sectionCn.dataVisualization}</p>
                                      )}
                                      {sectionCn.icons && sectionCn.icons.length > 0 && (
                                        <div>
                                          <span className="text-xs text-orange-600 font-medium">图标:</span>
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {sectionCn.icons.map((icon: string, j: number) => (
                                              <Badge key={j} variant="secondary" className="text-xs bg-orange-100 text-orange-800">{icon}</Badge>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {sectionCn.tips && sectionCn.tips.length > 0 && (
                                        <ul className="text-xs text-orange-700 space-y-0.5">
                                          {sectionCn.tips.map((t: string, j: number) => <li key={j}>• {t}</li>)}
                                        </ul>
                                      )}
                                    </>
                                  ) : (
                                    <p className="text-sm text-muted-foreground italic mt-1">暂无中文翻译</p>
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

              {/* Translate button if no Chinese */}
              {!imageAdviceCn && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={handleTranslate}
                    disabled={translateImageAdvice.isPending}
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    {translateImageAdvice.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Languages className="h-4 w-4 mr-2" />
                    )}
                    生成图片建议中文翻译
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Image className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium text-muted-foreground mb-2">暂无图片建议</p>
                <p className="text-sm text-muted-foreground mb-4">
                  点击上方"生成图片建议"按钮，AI将根据产品卖点和竞品分析为您规划完整的图片方案
                </p>
                <Button
                  onClick={handleGenerate}
                  disabled={generateImageAdvice.isPending}
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  {generateImageAdvice.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  生成图片建议
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
