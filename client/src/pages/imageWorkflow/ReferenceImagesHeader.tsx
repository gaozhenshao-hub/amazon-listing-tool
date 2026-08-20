import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Eye, Loader2, Lock, RefreshCw, RotateCcw, Sparkles, Unlock } from "lucide-react";

interface ReferenceImagesHeaderProps {
  canEdit?: boolean;
  hasData: boolean;
  isConfirmed: boolean;
  isGenerating: boolean;
  canGenerate?: boolean;
  generationBlockedReason?: string;
  generationProgress: number;
  isRegeneratingAll: boolean;
  isConfirming: boolean;
  isResetting: boolean;
  onGenerate: () => void;
  onRegenerateAll: () => void;
  onConfirm: () => void;
  onUnlock: () => void;
}
export function ReferenceImagesHeader({
  canEdit = true,
  hasData,
  isConfirmed,
  isGenerating,
  canGenerate = true,
  generationBlockedReason,
  generationProgress,
  isRegeneratingAll,
  isConfirming,
  isResetting,
  onGenerate: handleGenerate,
  onRegenerateAll: handleRegenerateAll,
  onConfirm: handleConfirm,
  onUnlock: handleUnlock,
}: ReferenceImagesHeaderProps) {
  return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-primary" />
                Step 4: 参考图确认
              </CardTitle>
              <CardDescription>每张图的构图参考和效果图参考，可从知识库直接选择参考图片</CardDescription>
            </div>
            <div className="flex gap-2">
              {canEdit && !hasData && (
                <Button onClick={handleGenerate} disabled={isGenerating || !canGenerate} title={!canGenerate ? generationBlockedReason : undefined}>
                  {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {isGenerating ? "后台推荐中" : "AI推荐参考"}
                </Button>
              )}
              {canEdit && hasData && !isConfirmed && (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={isGenerating || !canGenerate} title={!canGenerate ? generationBlockedReason : undefined}>
                    {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />} 重新推荐
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleRegenerateAll}
                    disabled={isRegeneratingAll}
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    title="根据已选参考图和备注，重新生成所有图片的构图和效果方案"
                  >
                    {isRegeneratingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    {isRegeneratingAll ? "AI 正在分析参考图..." : "根据参考图重新生成"}
                  </Button>
                  <Button onClick={handleConfirm} disabled={isConfirming || isGenerating}>
                    {isConfirming ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    确认参考图
                  </Button>
                </>
              )}
              {isConfirmed && (
                <div className="flex gap-2 items-center">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Lock className="w-3 h-3 mr-1" /> 已锁定
                  </Badge>
                  {canEdit && <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-700" onClick={handleUnlock} disabled={isResetting}>
                    {isResetting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />}
                    解锁编辑
                  </Button>}
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        {isGenerating && (
          <CardContent>
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <div className="flex items-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary mr-3" />
                <span className="text-muted-foreground">皇帝 Skill 正在后台推荐构图和效果参考...</span>
              </div>
              <span className="text-xs text-muted-foreground">进度 {generationProgress}% · 切换页面不会中断任务</span>
            </div>
          </CardContent>
        )}
        {isRegeneratingAll && (
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              <div className="text-center">
                <p className="text-sm font-medium text-emerald-700">皇帝 Skill 正在分析所有参考图...</p>
                <p className="text-xs text-muted-foreground mt-1">正在深度分析参考图的构图布局与视觉效果特征，预计需要 30-90 秒，请耐心等待</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
  );
}
