import { useMemo, useState } from "react";
import { CheckCircle2, FilePenLine, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import type { DistillationBinding } from "./DistillationGuidancePicker";

const PLAN_TYPES = [
  ["listing.positioning.plan", "定位"],
  ["listing.title.structure.plan", "标题结构"],
  ["listing.bullet.fabe.plan", "五点 FABE"],
  ["listing.aplus.narrative.plan", "A+ 叙事"],
  ["listing.qa.objection.plan", "QA 异议"],
  ["listing.compliance.claim.gate", "主张合规"],
] as const;

type PlanningType = (typeof PLAN_TYPES)[number][0];

export function ListingPlanningPanel({ projectId, binding }: { projectId: number; binding: DistillationBinding }) {
  const [planningType, setPlanningType] = useState<PlanningType>("listing.positioning.plan");
  const [emphasis, setEmphasis] = useState("");
  const [editingJson, setEditingJson] = useState("");
  const [editNote, setEditNote] = useState("");
  const bindingSelected = Boolean(binding.ledgerKey || binding.skillSlugs?.length);
  const listInput = useMemo(() => ({ projectId, planningType }), [projectId, planningType]);
  const plansQuery = trpc.listing.planningArtifacts.useQuery(listInput, { enabled: Boolean(projectId) });
  const generate = trpc.listing.generatePlanningArtifact.useMutation({
    onSuccess: async (result) => {
      setEditingJson(JSON.stringify(result.planning, null, 2));
      toast.success("规划草案已生成；请人工编辑、保存或在原工作流中选择性采用。");
      await plansQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const save = trpc.listing.savePlanningArtifact.useMutation({
    onSuccess: async () => {
      toast.success("人工修订已另存为新的规划草案版本；未改写Listing内容。");
      await plansQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const startGeneration = () => generate.mutate({ projectId, planningType, emphasis: emphasis || undefined, distillationBinding: binding });
  const saveEdited = () => {
    try {
      const planning = JSON.parse(editingJson);
      if (!planning || Array.isArray(planning) || typeof planning !== "object") throw new Error("规划内容必须是JSON对象");
      save.mutate({ projectId, planningType, planning, distillationBinding: binding, editNote: editNote || undefined });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "规划JSON格式无效");
    }
  };

  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><FilePenLine className="h-4 w-4 text-violet-700" />蒸馏指导下的Listing规划</CardTitle><CardDescription>定位、标题、五点、A+、QA与合规均为独立可编辑规划工件，不会自动覆盖当前五步内容。</CardDescription></div><Badge variant="outline" className={bindingSelected ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}>{bindingSelected ? "已选择指导" : "请先选择指导"}</Badge></div></CardHeader>
      <CardContent className="space-y-3"><div className="flex flex-wrap gap-2">{PLAN_TYPES.map(([type, label]) => <Button key={type} size="sm" type="button" variant={planningType === type ? "default" : "outline"} onClick={() => { setPlanningType(type); setEditingJson(""); }}>{label}</Button>)}</div><div className="flex flex-col gap-2 sm:flex-row"><Input value={emphasis} onChange={(event) => setEmphasis(event.target.value)} placeholder="本次规划重点（可选）" /><Button disabled={!bindingSelected || generate.isPending} onClick={startGeneration}>{generate.isPending ? "生成中…" : <><Sparkles className="mr-2 h-4 w-4" />生成待审规划</>}</Button></div>{!bindingSelected && <p className="text-xs text-amber-800">请在上方显式选择已发布蒸馏Skill或锁定Claim Ledger。未选择时，此处不会调用模型。</p>}{editingJson && <div className="space-y-2 rounded-lg border border-violet-200 bg-background p-3"><Textarea className="min-h-56 font-mono text-xs" value={editingJson} onChange={(event) => setEditingJson(event.target.value)} aria-label="结构化规划JSON" /><div className="flex flex-col gap-2 sm:flex-row"><Input value={editNote} onChange={(event) => setEditNote(event.target.value)} placeholder="修订说明（可选）" /><Button size="sm" disabled={!bindingSelected || save.isPending} onClick={saveEdited}>另存人工修订</Button></div></div>}<div className="space-y-2 border-t pt-3">{(plansQuery.data || []).slice(0, 5).map((plan: any) => <button type="button" key={plan.ref} className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-left hover:bg-muted" onClick={() => { if (plan.content) setEditingJson(JSON.stringify(plan.content, null, 2)); }}><span><span className="text-xs font-medium">规划草案 v{plan.version}</span><span className="ml-2 text-[11px] text-muted-foreground">{plan.updatedAt ? new Date(plan.updatedAt).toLocaleString("zh-CN", { hour12: false }) : ""}</span></span><CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" /></button>)}{!plansQuery.isLoading && !plansQuery.data?.length && <p className="text-xs text-muted-foreground">尚未创建此类规划工件。</p>}</div></CardContent>
    </Card>
  );
}
