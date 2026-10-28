import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  红色: "#ef4444", 绿色: "#22c55e", 蓝色: "#3b82f6", 黄色: "#eab308",
  橙色: "#f97316", 紫色: "#a855f7", 金色: "#d4a017", 浅灰: "#cbd5e1",
  深灰: "#475569", 浅棕: "#bf916c", 深棕: "#78350f", 白色: "#ffffff", 黑色: "#111827",
};

export function KnowledgeTag({ children, tone = "local", color = false, label, className }: {
  children: string; tone?: "set" | "local" | "video"; color?: boolean; label?: string; className?: string;
}) {
  const swatch = color ? COLORS[children] : undefined;
  return <span title={label ? `${label}：${children}` : children} className={cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-5",
    tone === "video" ? "border-violet-200 bg-violet-50 font-medium text-violet-800" :
    tone === "set" ? "border-slate-200 bg-slate-50 font-medium text-slate-700" : "border-border/80 bg-background text-muted-foreground",
    className,
  )} style={swatch ? { backgroundColor: `${swatch}12`, borderColor: children === "白色" ? "#cbd5e1" : `${swatch}50`, color: "#334155" } : undefined}>
    {swatch && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/15" style={{backgroundColor:swatch}} />}
    {label && <span className="shrink-0 font-normal opacity-60">{label}</span>}
    <span className="min-w-0 break-words">{children || "未设置"}</span>
  </span>;
}

export function CollectionTags({ category, style, primaryColor, accentColor, compact = false }: {
  category?: string | null; style?: string | null; primaryColor?: string | null; accentColor?: string | null; compact?: boolean;
}) {
  return <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")} aria-label="ASIN 集标签">
    {[["类目",category],["风格",style],["主色",primaryColor],["提亮",accentColor === "" ? "无明显提亮色" : accentColor]].map(([label,value]) =>
      <KnowledgeTag key={label} tone="set" label={label!} color={label === "主色" || label === "提亮"}>{value || "未设置"}</KnowledgeTag>)}
  </div>;
}
