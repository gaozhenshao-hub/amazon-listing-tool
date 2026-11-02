import { BookOpenCheck, CheckCircle2, LockKeyhole, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";

export type DistillationBinding = { ledgerKey?: string | null; skillSlugs?: string[] };

export function DistillationGuidancePicker({ value, onChange, compact = false }: { value: DistillationBinding; onChange: (binding: DistillationBinding) => void; compact?: boolean }) {
  const ledgerQuery = trpc.skillDistillation.claimLedgers.useQuery({});
  const skillsQuery = trpc.skillDistillation.consumableSkills.useQuery({});
  const ledgers = (ledgerQuery.data || []).filter((ledger: any) => ledger.status === "locked");
  const selectedSkills = value.skillSlugs || [];

  return (
    <Card className="border-violet-200 bg-violet-50/40">
      <CardContent className={compact ? "p-3" : "p-4"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-2"><BookOpenCheck className="mt-0.5 h-4 w-4 text-violet-700" /><div><p className="text-sm font-semibold">知识蒸馏指导（可选）</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">仅使用您手动选择的已锁定 Claim Ledger 与已发布 Skill。本次绑定会写入Run，不会覆盖已确认内容。</p></div></div>
          <Badge variant="outline" className="border-violet-200 bg-white text-violet-700">手动选择</Badge>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="space-y-1.5"><Label className="text-xs"><LockKeyhole className="mr-1 inline h-3 w-3" />已锁定 Claim Ledger</Label><Select value={value.ledgerKey || "__none"} onValueChange={(next) => onChange({ ...value, ledgerKey: next === "__none" ? null : next })}><SelectTrigger><SelectValue placeholder="不使用账本（保持原流程）" /></SelectTrigger><SelectContent><SelectItem value="__none">不使用账本（保持原流程）</SelectItem>{ledgers.map((ledger: any) => <SelectItem key={ledger.ledgerKey} value={ledger.ledgerKey}>v{ledger.version} · {ledger.claims?.length || 0} 项已锁定主张</SelectItem>)}</SelectContent></Select>{!ledgerQuery.isLoading && !ledgers.length && <p className="text-[11px] text-muted-foreground">暂无已锁定账本；请由超级管理员在“知识蒸馏”中审核后锁定。</p>}</div>
          <div className="space-y-1.5"><Label className="text-xs"><Sparkles className="mr-1 inline h-3 w-3" />已发布蒸馏 Skill</Label><div className="max-h-24 space-y-1 overflow-auto rounded-md border bg-background p-2">{(skillsQuery.data || []).map((skill: any) => <label key={skill.slug} className="flex cursor-pointer items-center gap-2 text-xs"><Checkbox checked={selectedSkills.includes(skill.slug)} onCheckedChange={(checked) => onChange({ ...value, skillSlugs: checked ? [...new Set([...selectedSkills, skill.slug])] : selectedSkills.filter((slug) => slug !== skill.slug) })} /><span className="min-w-0 flex-1 truncate">{skill.name}</span><span className="font-mono text-[10px] text-muted-foreground">v{skill.version}</span></label>)}{!skillsQuery.isLoading && !(skillsQuery.data || []).length && <p className="text-[11px] text-muted-foreground">暂无已发布蒸馏 Skill，继续使用原有生成规则。</p>}</div></div>
        </div>
        {(value.ledgerKey || selectedSkills.length > 0) && <div className="mt-3 flex items-center gap-2 rounded-md border border-violet-200 bg-white/70 px-3 py-2 text-xs text-violet-800"><CheckCircle2 className="h-3.5 w-3.5" />本次生成将引用 {value.ledgerKey ? "1 个锁定账本" : "0 个账本"} 与 {selectedSkills.length} 个已发布Skill；历史版本和已锁定输出不会改变。</div>}
      </CardContent>
    </Card>
  );
}
