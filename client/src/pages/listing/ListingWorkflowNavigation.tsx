import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRight, CheckCircle2, ChevronRight, FileText, Lock, MessageSquare, Search, Sparkles, Target } from "lucide-react";

export const LISTING_STEPS = [
  { id: 1, label: "卖点精雕", icon: Target },
  { id: 2, label: "标题生成", icon: Sparkles },
  { id: 3, label: "产品描述", icon: FileText },
  { id: 4, label: "搜索词", icon: Search },
  { id: 5, label: "QA问答", icon: MessageSquare },
];

export function ListingWorkflowNavigation({
  activeStep,
  completedCount,
  projectId,
  showAllLockedDialog,
  onActiveStepChange,
  onDialogChange,
  onPreview,
}: {
  activeStep: number;
  completedCount: number;
  projectId: number;
  showAllLockedDialog: boolean;
  onActiveStepChange: (step: number) => void;
  onDialogChange: (open: boolean) => void;
  onPreview: (projectId: number) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={() => onActiveStepChange(Math.max(1, activeStep - 1))} disabled={activeStep === 1}>
          上一步
        </Button>
        <div className="flex gap-2">
          {activeStep < 5 && (
            <Button onClick={() => onActiveStepChange(activeStep + 1)} variant="outline">
              跳过此步<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {completedCount === 5 && (
            <Button onClick={() => onPreview(projectId)} className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="h-4 w-4 mr-2" />前往结果预览
            </Button>
          )}
        </div>
      </div>
      <Dialog open={showAllLockedDialog} onOpenChange={onDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />全部步骤已锁定
            </DialogTitle>
            <DialogDescription>
              恭喜！您已完成全部 5 个步骤的内容确认并锁定。建议前往结果预览页进行最终审核和翻译。
            </DialogDescription>
          </DialogHeader>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 space-y-2">
            {LISTING_STEPS.map((step) => (
              <div key={step.id} className="flex items-center gap-2 text-sm">
                <Lock className="h-3.5 w-3.5 text-green-600" />
                <span className="text-green-700 dark:text-green-300">Step {step.id}: {step.label}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-green-100 text-green-600 border-green-300 ml-auto">已锁定</Badge>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => onDialogChange(false)}>继续编辑</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => { onDialogChange(false); onPreview(projectId); }}>
              <ArrowRight className="h-4 w-4 mr-2" />前往结果预览
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
