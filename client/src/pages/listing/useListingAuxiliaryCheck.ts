import { useState } from "react";
import { toast } from "sonner";
import type { CheckListScores } from "@/components/ChecklistPanel";
import { listingAuxiliaryCanonical as canonical } from "@shared/listingAuxiliaryWorkflow";
import { useListingAuxiliary, useListingAuxiliaryReceiver, type ListingAuxiliaryIntent } from "./ListingAuxiliaryContext";
import { useListingConfiguredGeneration } from "./ListingConfiguredGenerationContext";

type CheckIntent = Extract<ListingAuxiliaryIntent, { operation: "checkTitle" | "checkDescription" | "checkSearchTerms" | "checkQa" }>;
type WithoutSelection<T> = T extends CheckIntent ? Omit<T, "analysisIds"> : never;
/** A check binds the exact visible draft including selection/order/lock state.
 * Its report is not a product fact, and never confirms or saves the text. */
export function useListingAuxiliaryCheck(key: string, intent: WithoutSelection<CheckIntent>, extra: unknown, valid = true) {
  const auxiliary = useListingAuxiliary(), configured = useListingConfiguredGeneration(), fingerprint = canonical({ intent, extra, sourceSelection: configured?.sourceSelection ?? null });
  const [report, setReport] = useState<{ fingerprint: string; scores: CheckListScores } | null>(null);
  useListingAuxiliaryReceiver(key, fingerprint, candidate => {
    const scores = candidate.targets[0].result.checkListScores;
    if (!scores || typeof scores !== "object" || Array.isArray(scores)) { toast.error("自检报告缺少完整评分，未回填"); return; }
    setReport({ fingerprint, scores: scores as CheckListScores }); toast.success("自检报告已按完整原稿载入；正文和审核状态未改变");
  });
  return { scores: report?.fingerprint === fingerprint ? report.scores : undefined,
    run: () => {
      if (!valid) { toast.error("请先填写或选择要检查的完整稿件"); return; }
      if (!configured?.sourceSelection.analysisIds) { toast.error("请先明确本次竞品研究范围，可明确不使用竞品"); return; }
      // Preserve the discriminated payload; the shared parser verifies it before preview.
      if (!auxiliary?.request({ ...intent, analysisIds: configured.sourceSelection.analysisIds } as CheckIntent, key)) { toast.error("辅助原稿范围尚未就绪"); return; }
      toast.info("已准备完整自检稿件，请在辅助面板确认来源与费用；尚未调用模型");
    } };
}
