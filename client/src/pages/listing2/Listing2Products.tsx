import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Layers,
  ChevronRight,
  Package,
  Calendar,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

// 10 个工作流阶段定义
const WORKFLOW_STEPS = [
  { id: 1, label: "产品基本信息录入" },
  { id: 2, label: "竞品Listing分析及图片分析" },
  { id: 3, label: "卖点梳理" },
  { id: 4, label: "埋词词库" },
  { id: 5, label: "图片和文案大纲" },
  { id: 6, label: "风格参考及确认" },
  { id: 7, label: "套图文档" },
  { id: 8, label: "Listing定稿" },
  { id: 9, label: "爆款视频拆解" },
  { id: 10, label: "视频剪辑脚本" },
];

export default function Listing2Products() {
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAsin, setNewAsin] = useState("");

  const { data: products, isLoading, refetch } = trpc.listing2.listProducts.useQuery();

  const createMutation = trpc.listing2.createProduct.useMutation({
    onSuccess: (data) => {
      toast.success("产品已创建");
      setDialogOpen(false);
      setNewTitle("");
      setNewAsin("");
      refetch();
      // 跳转到工作流页面
      setLocation(`/listing2/product/${data.id}`);
    },
    onError: (err) => {
      toast.error(err.message || "创建失败");
    },
  });

  const handleCreate = () => {
    if (!newTitle.trim()) {
      toast.error("请输入产品名称");
      return;
    }
    createMutation.mutate({ title: newTitle.trim(), asin: newAsin.trim() || undefined });
  };

  const getStepLabel = (step: number) => {
    return WORKFLOW_STEPS.find((s) => s.id === step)?.label ?? `阶段 ${step}`;
  };

  const getProgressPercent = (step: number) => {
    return Math.round(((step - 1) / 10) * 100);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">智能 Listing 生成 2.0</h1>
            <p className="text-sm text-muted-foreground">全流程 10 阶段工作流，从信息录入到视频脚本</p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          新增产品
        </Button>
      </div>

      {/* 产品列表 */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : !products || products.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">暂无产品</p>
              <p className="text-sm text-muted-foreground mt-1">点击"新增产品"开始第一个 Listing 工作流</p>
            </div>
            <Button onClick={() => setDialogOpen(true)} variant="outline" className="gap-2 mt-2">
              <Plus className="h-4 w-4" />
              新增产品
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {products.map((product) => {
            const progress = getProgressPercent(product.currentStep ?? 1);
            const stepLabel = getStepLabel(product.currentStep ?? 1);
            return (
              <Card
                key={product.id}
                className="cursor-pointer hover:shadow-md transition-all duration-200 hover:border-primary/40 group"
                onClick={() => setLocation(`/listing2/product/${product.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Package className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground truncate">{product.title}</span>
                          {product.asin && (
                            <Badge variant="secondary" className="text-xs font-mono shrink-0">
                              {product.asin}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-muted-foreground">
                            当前阶段：<span className="text-foreground font-medium">{stepLabel}</span>
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(product.updatedAt!).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                        {/* 进度条 */}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {product.currentStep ?? 1}/10
                          </span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 新增产品弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              新增产品
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="title">
                产品名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="例：黑色盐氯器-5克"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asin">ASIN（可选）</Label>
              <Input
                id="asin"
                placeholder="例：B09N16YDCX"
                value={newAsin}
                onChange={(e) => setNewAsin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">创建后将进入 10 阶段工作流：</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {WORKFLOW_STEPS.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-0.5 text-xs">
                    <span className="font-medium text-primary">{s.id}.</span> {s.label}
                    {s.id < 10 && <ArrowRight className="h-2.5 w-2.5 mx-0.5 text-muted-foreground" />}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-2">
              {createMutation.isPending ? "创建中..." : (
                <>
                  <Plus className="h-4 w-4" />
                  创建并进入工作流
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
