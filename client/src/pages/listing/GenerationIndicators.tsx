import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const GENERATION_STEPS = [
  "规划环节：核对本品事实",
  "规划环节：参考可用竞品研究",
  "规划环节：梳理买家痛点与场景",
  "规划环节：分配关键词",
  "规划环节：明确每条卖点方向",
  "规划环节：安排七条方向的先后逻辑",
];

// Step 1 animated progress indicator
export function GeneratingProgress() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIdx(i => (i + 1) % GENERATION_STEPS.length), 2800);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-teal-600 shrink-0" />
        <span className="transition-all duration-500">{GENERATION_STEPS[idx]}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
        <div className="h-full bg-teal-500 rounded-full animate-pulse" style={{ width: `${((idx + 1) / GENERATION_STEPS.length) * 100}%`, transition: 'width 2.8s ease' }} />
      </div>
      <p className="text-xs text-muted-foreground text-center">以上为规划环节说明，不代表实时读取状态；缺失的研究数据将在结果中说明。</p>
    </div>
  );
}

export function CharCountBadge({ count, min, max, label }: { count: number; min: number; max: number; label?: string }) {
  const inRange = count >= min && count <= max;
  const tooShort = count < min;

  return (
    <Badge
      variant={inRange ? "default" : "destructive"}
      className={`text-xs ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}
    >
      {count} / {min}-{max} {label || "字符"}
      {inRange && " ✓"}
      {tooShort && " ↑偏短"}
      {!inRange && !tooShort && " ↓偏长"}
    </Badge>
  );
}
