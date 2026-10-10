import type { SellingPointPlanMetadata } from "./reviewRecovery";
import { Badge } from "@/components/ui/badge";

/** The original direction-card body: this is planning guidance, not finished bullet copy. */
export function SellingPointDirectionDetails({ point }: { point: any }) {
  return <div className="space-y-1.5">
    <p className="text-xs text-muted-foreground">{point.description}</p>
    {point.descriptionZh && <p className="text-xs text-muted-foreground italic">{point.descriptionZh}</p>}
    {point.fabeDirection && <div className="grid grid-cols-2 gap-1 mt-2">
      {Object.entries(point.fabeDirection).map(([key, value]) => value
        ? <div key={key} className="text-[10px] text-muted-foreground"><span className="font-medium uppercase">{key}:</span> {value as string}</div> : null)}
    </div>}
    {point.targetKeywords?.length > 0 && <div className="flex gap-1 flex-wrap mt-1">
      {point.targetKeywords.map((keyword: string, index: number) => <Badge key={index} variant="outline" className="text-[10px]">{keyword}</Badge>)}
    </div>}
    {point.addressesGap && <p className="text-[10px] text-teal-600 mt-1">针对: {point.addressesGap}</p>}
  </div>;
}

export function SellingPointPlanSummary({ metadata }: { metadata: SellingPointPlanMetadata }) {
  return <div className="space-y-1.5 text-sm leading-relaxed">
    {metadata.overallStrategy && <p><span className="font-medium">七条方向的整体策略：</span>{metadata.overallStrategy}</p>}
    {metadata.checkListCoverage.B4_order && <p><span className="font-medium">排序逻辑：</span>{metadata.checkListCoverage.B4_order}</p>}
    {metadata.researchLimitations.map((note, index) => <p key={index} className="text-xs text-amber-800">{note}</p>)}
    {metadata.hasReviewedEdits && <p className="text-xs text-muted-foreground">以上为生成时的规划；方向卡片已保留人工审核后的修改。</p>}
    {metadata.missingPlanningMetadata && <p className="text-xs text-muted-foreground">已恢复人工审核的方向；该记录未保存整体策略与排序逻辑，无法从审核记录还原。</p>}
  </div>;
}
