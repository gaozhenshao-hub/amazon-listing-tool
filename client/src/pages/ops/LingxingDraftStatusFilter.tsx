import { Label } from "@/components/ui/label";

export function LingxingDraftStatusFilter({ value, total, onChange }: { value: string; total: number; onChange: (value: string) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><Label htmlFor="lingxing-row-status-filter">草稿状态筛选</Label><select id="lingxing-row-status-filter" aria-label="草稿状态筛选" className="h-9 rounded-md border bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}><option value="all">全部（{total}）</option><option value="new">新增</option><option value="changed">有更新</option><option value="unchanged">无变化</option><option value="needs_review">需核对</option><option value="skipped">已跳过</option></select></div>;
}
