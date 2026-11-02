import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const GENERATION_STEPS = [
  "AI正在读取产品属性数据...",
  "AI正在分析竞品Listing共性与缺口...",
  "AI正在匹配买家高频痛点和场景...",
  "AI正在规划A9关键词分配策略...",
  "AI正在生成FABE卖点方向框架...",
  "AI正在整合七条卖点核心主题...",
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
      <p className="text-xs text-muted-foreground text-center">通常需要 15-30 秒，请耐心等待...</p>
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
