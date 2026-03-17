import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import LockedContentBar from "@/components/LockedContentBar";
import {
  Sparkles,
  Loader2,
  Check,
  CheckCircle2,
  Pencil,
  RotateCcw,
  FileText,
  Code,
  Eye,
} from "lucide-react";

interface StepDescriptionProps {
  projectId: number;
  emphasis: string;
  locked?: boolean;
  onLock?: () => void;
  onUnlock?: () => void;
  onComplete: () => void;
}

export default function StepDescription({ projectId, emphasis, locked, onLock, onUnlock, onComplete }: StepDescriptionProps) {
  const [description, setDescription] = useState("");
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const [confirmed, setConfirmed] = useState(false);
  const [generated, setGenerated] = useState(false);

  const generateDescription = trpc.listing.generateDescription.useMutation({
    onSuccess: (data: any) => {
      try {
        const content = data.description || data;
        let text = "";
        if (typeof content === "string") {
          try {
            const parsed = JSON.parse(content);
            text = parsed.description || parsed.htmlDescription || parsed.text || content;
          } catch {
            text = content;
          }
        } else if (content.description) {
          text = content.description;
        } else if (content.htmlDescription) {
          text = content.htmlDescription;
        } else {
          text = JSON.stringify(content);
        }
        setDescription(text);
        setGenerated(true);
        toast.success("产品描述已生成");
      } catch {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        setDescription(text);
        setGenerated(true);
        toast.success("产品描述已生成");
      }
    },
    onError: (err) => toast.error("描述生成失败: " + err.message),
  });

  const updateListing = trpc.listing.updateByProject.useMutation({
    onSuccess: () => {
      toast.success("产品描述已保存并锁定");
      setConfirmed(true);
      onLock?.();
      onComplete();
    },
    onError: (err) => toast.error("保存失败: " + err.message),
  });

  const handleGenerate = () => {
    generateDescription.mutate({
      projectId,
      emphasis: emphasis.trim() || undefined,
    });
  };

  const handleConfirm = () => {
    if (!description.trim()) {
      toast.error("描述内容不能为空");
      return;
    }
    updateListing.mutate({
      projectId,
      field: "description",
      value: description,
    });
  };

  const handleUnlock = () => {
    setConfirmed(false);
    onUnlock?.();
  };

  // Locked state
  if (locked && confirmed) {
    return (
      <Card className="border-2 border-green-300 bg-green-50/30 dark:border-green-800 dark:bg-green-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-purple-600" />
            Step 3: 产品描述
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LockedContentBar
            locked={true}
            label="产品描述"
            onUnlock={handleUnlock}
            info="已同步到预览页"
          />
          <div
            className="text-sm text-green-800 dark:text-green-300 prose prose-sm max-w-none line-clamp-4 pl-2"
            dangerouslySetInnerHTML={{ __html: description }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-purple-600" />
          Step 3: 产品描述
        </CardTitle>
        <CardDescription>
          AI生成HTML格式产品描述 → 编辑优化 → 确认保存
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Generate button */}
        {!confirmed && (
          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={generateDescription.isPending}
          >
            {generateDescription.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />正在生成产品描述...</>
            ) : generated ? (
              <><RotateCcw className="h-4 w-4 mr-2" />重新生成描述</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />AI生成产品描述</>
            )}
          </Button>
        )}

        {generateDescription.isPending && (
          <p className="text-xs text-muted-foreground text-center">
            AI正在基于已确认的标题和卖点生成产品描述...
          </p>
        )}

        {/* Description editor */}
        {generated && !confirmed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">产品描述</h3>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={viewMode === "preview" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setViewMode("preview")}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />预览
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "source" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setViewMode("source")}
                >
                  <Code className="h-3.5 w-3.5 mr-1" />源码
                </Button>
              </div>
            </div>

            {viewMode === "source" ? (
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={12}
                className="text-sm font-mono resize-none"
              />
            ) : (
              <div className="rounded-lg border p-4 min-h-[200px]">
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: description }}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-xs">
                {description.length} 字符
              </Badge>
              <Button
                className="bg-purple-600 hover:bg-purple-700"
                onClick={handleConfirm}
                disabled={updateListing.isPending}
              >
                {updateListing.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />保存中...</>
                ) : (
                  <><Check className="h-4 w-4 mr-2" />确认并锁定描述</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Confirmed but not yet locked */}
        {confirmed && !locked && (
          <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50/50">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm font-semibold text-green-800">产品描述已确认</span>
            </div>
            <div
              className="text-sm text-green-700 prose prose-sm max-w-none line-clamp-3"
              dangerouslySetInnerHTML={{ __html: description }}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setConfirmed(false)}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />重新编辑
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
