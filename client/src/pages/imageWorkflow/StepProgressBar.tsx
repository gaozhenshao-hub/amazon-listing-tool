import { Check, ChevronRight, Eye, FileText, Layout, Palette, Search, Target } from "lucide-react";

const STEPS = [
  { id: 0, label: "竞品分析", icon: Search, desc: "竞品图片上传+分析" },
  { id: 1, label: "卖点梳理", icon: Target, desc: "AI分析+人工确认" },
  { id: 2, label: "图片大纲", icon: Layout, desc: "内容规划+确认" },
  { id: 3, label: "风格确认", icon: Palette, desc: "视觉风格选择" },
  { id: 4, label: "参考图确认", icon: Eye, desc: "构图+效果参考" },
  { id: 5, label: "图片建议", icon: FileText, desc: "最终输出" },
];

export function StepProgressBar({
  currentStep,
  session,
  onStepClick,
}: {
  currentStep: number;
  session: any;
  onStepClick: (step: number) => void;
}) {
  const getStepStatus = (stepId: number) => {
    if (!session) return stepId === 0 ? "current" : "locked";
    const confirmed = [
      !!session.step0Confirmed,
      !!session.step1Confirmed,
      !!session.step2Confirmed,
      !!session.step3Confirmed,
      !!session.step4Confirmed,
      !!session.step5Confirmed,
    ];
    if (confirmed[stepId]) return "completed";
    if (stepId === currentStep) return "current";
    if (stepId < currentStep) return "completed";
    // Check if previous step is confirmed
    if (stepId > 0 && confirmed[stepId]) return "available";
    return "locked";
  };

  return (
    <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
      {STEPS.map((step, idx) => {
        const status = getStepStatus(step.id);
        const Icon = step.icon;
        const isClickable = status !== "locked";

        return (
          <div key={step.id} className="flex items-center">
            <button
              onClick={() => isClickable && onStepClick(step.id)}
              disabled={!isClickable}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm whitespace-nowrap ${
                status === "completed"
                  ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                  : status === "current"
                  ? "bg-primary/10 text-primary border border-primary/30 shadow-sm"
                  : status === "available"
                  ? "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                  : "bg-gray-50 text-gray-400 border border-gray-100 cursor-not-allowed"
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                status === "completed"
                  ? "bg-green-500 text-white"
                  : status === "current"
                  ? "bg-primary text-primary-foreground"
                  : "bg-gray-200 text-gray-500"
              }`}>
                {status === "completed" ? <Check className="w-3.5 h-3.5" /> : step.id}
              </div>
              <div className="text-left">
                <div className="font-medium leading-tight">{step.label}</div>
                <div className="text-[10px] opacity-60">{step.desc}</div>
              </div>
            </button>
            {idx < STEPS.length - 1 && (
              <ChevronRight className="w-4 h-4 text-gray-300 mx-1 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
