import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  Upload,
  Loader2,
  AlertTriangle,
  Image as ImageIcon,
  Eye,
  X,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

export default function ImageAnalysisPage() {
  const { selectedProjectId } = useProject();
  const [selectedFiles, setSelectedFiles] = useState<{ file: File; preview: string }[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: imageAnalyses, isLoading } = trpc.imageAnalysis.listByProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();
  const analyzeImage = trpc.imageAnalysis.analyze.useMutation();

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newFiles = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setSelectedFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const handleAnalyzeAll = async () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }
    if (selectedFiles.length === 0) {
      toast.error("请先上传图片");
      return;
    }

    setAnalyzing(true);
    let successCount = 0;

    for (const { file } of selectedFiles) {
      try {
        const base64 = await fileToBase64(file);
        await analyzeImage.mutateAsync({
          projectId: selectedProjectId,
          imageBase64: base64,
          fileName: file.name,
          mimeType: file.type,
        });
        successCount++;
      } catch (err: any) {
        toast.error(`分析 ${file.name} 失败: ${err.message}`);
      }
    }

    setAnalyzing(false);
    if (successCount > 0) {
      utils.imageAnalysis.listByProject.invalidate({ projectId: selectedProjectId });
      toast.success(`成功分析 ${successCount} 张图片`);
      setSelectedFiles([]);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]); // Remove data:image/xxx;base64, prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const parseJson = (str: string | null) => {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">图片识别</h1>
          <p className="text-muted-foreground mt-1">
            上传产品图片，AI自动识别产品特征并提取Listing相关信息
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upload Area */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">上传产品图片</CardTitle>
                <CardDescription>
                  支持 JPG、PNG 格式，可同时上传多张图片进行批量分析
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="border-2 border-dashed rounded-xl p-8 text-center hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const files = Array.from(e.dataTransfer.files).filter((f) =>
                      f.type.startsWith("image/")
                    );
                    const newFiles = files.map((file) => ({
                      file,
                      preview: URL.createObjectURL(file),
                    }));
                    setSelectedFiles((prev) => [...prev, ...newFiles]);
                  }}
                >
                  <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">点击或拖拽上传图片</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    支持 JPG, PNG 格式
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />

                {/* Preview selected files */}
                {selectedFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">已选择 {selectedFiles.length} 张图片</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          selectedFiles.forEach((f) => URL.revokeObjectURL(f.preview));
                          setSelectedFiles([]);
                        }}
                      >
                        清空
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {selectedFiles.map((f, i) => (
                        <div key={i} className="relative group rounded-lg overflow-hidden border">
                          <img
                            src={f.preview}
                            alt={f.file.name}
                            className="w-full h-24 object-cover"
                          />
                          <button
                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removeFile(i)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                          <p className="text-xs truncate px-1 py-0.5 bg-muted/80">
                            {f.file.name}
                          </p>
                        </div>
                      ))}
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleAnalyzeAll}
                      disabled={analyzing}
                    >
                      {analyzing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          AI识别中...
                        </>
                      ) : (
                        <>
                          <Eye className="h-4 w-4 mr-2" />
                          开始识别 ({selectedFiles.length} 张)
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Results */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">识别结果</h2>
            {isLoading ? (
              <Card><CardContent className="p-6"><div className="h-32 bg-muted animate-pulse rounded" /></CardContent></Card>
            ) : !imageAnalyses || imageAnalyses.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <ImageIcon className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">暂无识别结果</p>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-4 pr-4">
                  {imageAnalyses.map((analysis) => {
                    const result = parseJson(analysis.analysisResult);
                    return (
                      <Card key={analysis.id}>
                        <CardContent className="p-4 space-y-4">
                          <div className="flex gap-4">
                            <img
                              src={analysis.imageUrl}
                              alt="Product"
                              className="w-24 h-24 object-cover rounded-lg border shrink-0"
                            />
                            <div className="space-y-2 min-w-0">
                              {result?.productType && (
                                <div>
                                  <p className="text-xs text-muted-foreground">产品类型</p>
                                  <p className="text-sm font-medium">{result.productType}</p>
                                </div>
                              )}
                              {result?.material && (
                                <div>
                                  <p className="text-xs text-muted-foreground">材质</p>
                                  <p className="text-sm">{result.material}</p>
                                </div>
                              )}
                              {result?.colorStyle && (
                                <div>
                                  <p className="text-xs text-muted-foreground">颜色/风格</p>
                                  <p className="text-sm">{result.colorStyle}</p>
                                </div>
                              )}
                            </div>
                          </div>

                          {result?.keyFeatures && result.keyFeatures.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1.5">识别到的特征</p>
                              <div className="flex flex-wrap gap-1.5">
                                {result.keyFeatures.map((f: string, i: number) => (
                                  <Badge key={i} variant="secondary" className="text-xs">
                                    {f}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {result?.suggestedTitleKeywords && result.suggestedTitleKeywords.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1.5">建议标题关键词</p>
                              <div className="flex flex-wrap gap-1.5">
                                {result.suggestedTitleKeywords.map((k: string, i: number) => (
                                  <Badge key={i} variant="default" className="text-xs">
                                    {k}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {result?.suggestedBulletTopics && result.suggestedBulletTopics.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1.5">建议五点主题</p>
                              <ul className="text-sm space-y-1">
                                {result.suggestedBulletTopics.map((t: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <span className="text-primary font-medium shrink-0">{i + 1}.</span>
                                    <span className="text-muted-foreground">{t}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {result?.targetAudience && (
                            <div>
                              <p className="text-xs text-muted-foreground">目标受众</p>
                              <p className="text-sm">{result.targetAudience}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
