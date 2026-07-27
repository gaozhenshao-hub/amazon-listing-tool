import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  ClipboardList,
  Search,
  Lightbulb,
  Key,
  Image,
  Palette,
  LayoutGrid,
  FileText,
  Video,
  Clapperboard,
  Package,
} from "lucide-react";
import { toast } from "sonner";

// 10 个工作流阶段定义
const WORKFLOW_STEPS = [
  {
    id: 1,
    label: "产品基本信息录入",
    shortLabel: "基本信息",
    icon: ClipboardList,
    description: "录入产品基础资料，包括产品名称、ASIN、类目、目标市场等信息",
  },
  {
    id: 2,
    label: "竞品Listing分析及图片分析",
    shortLabel: "竞品分析",
    icon: Search,
    description: "分析竞品的 Listing 文案结构与主图/场景图风格，提炼差异化方向",
  },
  {
    id: 3,
    label: "卖点梳理",
    shortLabel: "卖点梳理",
    icon: Lightbulb,
    description: "基于竞品分析和产品特性，梳理核心卖点与差异化优势",
  },
  {
    id: 4,
    label: "埋词词库",
    shortLabel: "埋词词库",
    icon: Key,
    description: "整理目标关键词库，包括核心词、长尾词、场景词，为文案埋词做准备",
  },
  {
    id: 5,
    label: "图片和文案大纲",
    shortLabel: "图文大纲",
    icon: Image,
    description: "规划主图/场景图/白底图的拍摄大纲，以及 Title/Bullet/Description 的文案框架",
  },
  {
    id: 6,
    label: "风格参考及确认",
    shortLabel: "风格确认",
    icon: Palette,
    description: "确定套图视觉风格、色调、排版参考，与设计师对齐后进入执行阶段",
  },
  {
    id: 7,
    label: "套图文档",
    shortLabel: "套图文档",
    icon: LayoutGrid,
    description: "输出完整的套图设计文档，包含每张图的尺寸、内容、文字说明",
  },
  {
    id: 8,
    label: "Listing定稿",
    shortLabel: "Listing定稿",
    icon: FileText,
    description: "最终确认 Title、Bullet Points、Description、Search Terms 的完整文案",
  },
  {
    id: 9,
    label: "爆款视频拆解",
    shortLabel: "视频拆解",
    icon: Video,
    description: "拆解同类爆款视频的结构、节奏、卖点呈现方式，作为视频制作参考",
  },
  {
    id: 10,
    label: "视频剪辑脚本",
    shortLabel: "视频脚本",
    icon: Clapperboard,
    description: "输出完整的视频剪辑脚本，包含分镜、旁白、字幕、时长等信息",
  },
];

export default function Listing2Workflow() {
  const params = useParams<{ id: string }>();
  const productId = parseInt(params.id ?? "0", 10);
  const [, setLocation] = useLocation();
  const [activeStep, setActiveStep] = useState(1);

  const { data: product, isLoading } = trpc.listing2.getProduct.useQuery(
    { id: productId },
    { enabled: !!productId }
  );

  // 产品加载完成后初始化当前步骤
  useEffect(() => {
    if (product?.currentStep) setActiveStep(product.currentStep);
  }, [product?.currentStep]);

  const updateStepMutation = trpc.listing2.updateStep.useMutation({
    onError: () => toast.error("更新阶段失败"),
  });

  const handleStepClick = (stepId: number) => {
    setActiveStep(stepId);
  };

  const handleNext = () => {
    if (activeStep < 10) {
      const nextStep = activeStep + 1;
      setActiveStep(nextStep);
      updateStepMutation.mutate({ id: productId, currentStep: nextStep });
    }
  };

  const handlePrev = () => {
    if (activeStep > 1) {
      setActiveStep(activeStep - 1);
    }
  };

  const currentStepDef = WORKFLOW_STEPS.find((s) => s.id === activeStep)!;
  const StepIcon = currentStepDef.icon;
  const completedStep = product?.currentStep ?? 1;

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Package className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">产品不存在或已被删除</p>
        <Button variant="outline" onClick={() => setLocation("/listing2")}>
          返回产品列表
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 顶部面包屑 */}
      <div className="flex items-center gap-2 mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground -ml-2"
          onClick={() => setLocation("/listing2")}
        >
          <ChevronLeft className="h-4 w-4" />
          产品列表
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium text-foreground truncate max-w-xs">{product.title}</span>
        {product.asin && (
          <Badge variant="secondary" className="font-mono text-xs">
            {product.asin}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* 左侧：步骤导航 */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-2">
            工作流阶段
          </p>
          {WORKFLOW_STEPS.map((step) => {
            const Icon = step.icon;
            const isActive = step.id === activeStep;
            const isCompleted = step.id < completedStep;
            const isCurrent = step.id === completedStep;

            return (
              <button
                key={step.id}
                onClick={() => handleStepClick(step.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-accent text-foreground"
                )}
              >
                {/* 状态图标 */}
                <div className="shrink-0">
                  {isCompleted ? (
                    <CheckCircle2 className={cn("h-4 w-4", isActive ? "text-primary-foreground" : "text-primary")} />
                  ) : isCurrent ? (
                    <Circle className={cn("h-4 w-4", isActive ? "text-primary-foreground" : "text-primary")} strokeWidth={2.5} />
                  ) : (
                    <Circle className={cn("h-4 w-4", isActive ? "text-primary-foreground/60" : "text-muted-foreground")} />
                  )}
                </div>
                {/* 步骤编号 + 名称 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-xs", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {step.id.toString().padStart(2, "0")}
                    </span>
                    <span className={cn("text-sm font-medium truncate", isActive ? "text-primary-foreground" : "text-foreground")}>
                      {step.shortLabel}
                    </span>
                  </div>
                </div>
                {/* 步骤图标 */}
                <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary-foreground/80" : "text-muted-foreground")} />
              </button>
            );
          })}
        </div>

        {/* 右侧：内容区 */}
        <div className="space-y-4">
          {/* 阶段标题卡 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <StepIcon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-medium">阶段 {activeStep}/10</span>
                      {activeStep < completedStep && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          已完成
                        </Badge>
                      )}
                      {activeStep === completedStep && (
                        <Badge className="text-xs gap-1">
                          <Circle className="h-3 w-3" strokeWidth={2.5} />
                          进行中
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-lg mt-0.5">{currentStepDef.label}</CardTitle>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                {currentStepDef.description}
              </p>
            </CardHeader>
          </Card>

          {/* 内容留白区 */}
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
                <StepIcon className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium text-foreground">「{currentStepDef.label}」</p>
                <p className="text-sm text-muted-foreground mt-1">功能开发中，敬请期待</p>
              </div>
            </CardContent>
          </Card>

          {/* 底部导航按钮 */}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              onClick={handlePrev}
              disabled={activeStep === 1}
              className="gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              上一阶段
            </Button>
            <span className="text-sm text-muted-foreground">
              {activeStep} / 10
            </span>
            <Button
              onClick={handleNext}
              disabled={activeStep === 10}
              className="gap-2"
            >
              下一阶段
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
