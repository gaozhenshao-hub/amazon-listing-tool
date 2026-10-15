import {
  resolveSellingPointSourceEvidence,
  type SellingPointSourceAnalysis,
  type SellingPointSourcePoint,
} from "./sellingPointSourceEvidenceModel";

export type SellingPointSourceEvidenceProps = {
  point: SellingPointSourcePoint | null | undefined;
  analysis: SellingPointSourceAnalysis | null | undefined;
};

export function SellingPointSourceEvidence({ point, analysis }: SellingPointSourceEvidenceProps) {
  const evidence = resolveSellingPointSourceEvidence(point, analysis);
  if (evidence.status === "unavailable") {
    return <p className="text-xs text-muted-foreground">来源暂无法核对</p>;
  }

  return <div className="space-y-1 text-xs">
    {evidence.comparisonDiffers && <p className="text-amber-700 dark:text-amber-400">
      对比文本与当前保存原文不同（可能经过人工调整或原文更新）。
    </p>}
    <details className="rounded-md border bg-muted/30 p-2">
      <summary className="cursor-pointer break-words text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        当前保存的五点原文 · {evidence.asin} · 第 {evidence.bulletNumber} 条
      </summary>
      <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 pl-2 leading-relaxed">
        {evidence.sourceText}
      </blockquote>
      <p className="mt-2 text-muted-foreground">
        这是当前保存值，不代表报告生成时的历史版本已核验。
      </p>
    </details>
  </div>;
}
