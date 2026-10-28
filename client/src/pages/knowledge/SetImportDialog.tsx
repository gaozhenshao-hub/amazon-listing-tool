import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, UploadCloud, Loader2 } from "lucide-react";
import { createImportOnError } from "@/lib/conflictToast";
import { KnowledgeCollectionForm } from "../acquisition/KnowledgeCollectionForm";
export default function SetImportDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils(),
    [, navigate] = useLocation();
  // Manual upload state
  const [manualAsin, setManualAsin] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualFiles, setManualFiles] = useState<File[]>([]);
  const [manualPosition, setManualPosition] = useState<string>("secondary");
  const [manualAutoAnalyze, setManualAutoAnalyze] = useState(true);
  const createFromUpload = trpc.kbImages.createSetFromUpload.useMutation({
    onSuccess: (r: any) => {
      toast.success(`已创建图片集 ${r.asin}，共${r.imageCount}张图片`);
      utils.kbImages.listSets.invalidate();
      utils.kbImages.listAllImages.invalidate();
      onClose();
      setManualAsin("");
      setManualTitle("");
      setManualFiles([]);
    },
    onError: createImportOnError(id => {
      onClose();
      navigate(`/knowledge/images/${id}`);
    }),
  });
  const handleManualUpload = async () => {
    if (!manualAsin || !manualTitle || manualFiles.length === 0) return;
    const images: {
      base64: string;
      filename: string;
      position: "main" | "secondary" | "aplus" | "brand_story";
    }[] = [];
    for (const file of manualFiles) {
      const reader = new FileReader();
      const base64 = await new Promise<string>(resolve => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      images.push({
        base64,
        filename: file.name,
        position: manualPosition as any,
      });
    }
    createFromUpload.mutate({
      asin: manualAsin,
      title: manualTitle,
      images,
      autoAnalyze: manualAutoAnalyze,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>套图导入</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="asin">
          <TabsList className="w-full">
            <TabsTrigger value="asin" className="flex-1 gap-1.5">
              <Upload className="h-3.5 w-3.5" /> ASIN导入
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex-1 gap-1.5">
              <UploadCloud className="h-3.5 w-3.5" /> 手动上传
            </TabsTrigger>
          </TabsList>
          <TabsContent value="asin" className="mt-4">
            <KnowledgeCollectionForm />
          </TabsContent>
          <TabsContent value="manual" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>产品ASIN / 标识符</Label>
              <Input
                placeholder="B0XXXXXXXXX 或自定义名称"
                value={manualAsin}
                onChange={e => setManualAsin(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>
                图片集标题 <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="例如：无线电饭盒产品图片"
                value={manualTitle}
                onChange={e => setManualTitle(e.target.value)}
              />
              {!manualTitle && (
                <p className="text-xs text-destructive">
                  请输入图片集标题，用于快速识别和搜索
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>图片位置</Label>
              <Select value={manualPosition} onValueChange={setManualPosition}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">主图</SelectItem>
                  <SelectItem value="secondary">副图</SelectItem>
                  <SelectItem value="aplus">A+内容图</SelectItem>
                  <SelectItem value="brand_story">品牌故事图</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>选择图片文件（最多50张）</Label>
              <input
                type="file"
                multiple
                accept="image/*"
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                onChange={e =>
                  setManualFiles(Array.from(e.target.files || []).slice(0, 50))
                }
              />
              {manualFiles.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  已选择 {manualFiles.length} 张图片
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoAnalyze"
                checked={manualAutoAnalyze}
                onChange={e => setManualAutoAnalyze(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="autoAnalyze" className="text-sm">
                上传后自动进AI分析
              </label>
            </div>
            <Button
              onClick={handleManualUpload}
              disabled={
                createFromUpload.isPending ||
                !manualAsin ||
                !manualTitle ||
                manualFiles.length === 0
              }
              className="w-full gap-2"
            >
              {createFromUpload.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              <UploadCloud className="h-4 w-4" /> 上传并创建图片集
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
