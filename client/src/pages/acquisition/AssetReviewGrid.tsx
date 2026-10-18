import { Button } from "@/components/ui/button";

export type AssetDecision = "keep" | "delete" | "pending";
export type ReviewAsset = { id: number; role: string; positionIndex: number; fieldStatus: string;
  storageAvailable: boolean; contentHash: string | null; decision: AssetDecision;
  origin: "original" | "supplement"; replacesAssetId: number | null; previewUrl: string | null };
const labels: Record<string, string> = { main: "主图", secondary: "副图", aplus: "A+", brand_story: "品牌故事", variant: "变体" };

/** Decisions affect only this human revision, never the source object or the
 * existing directly ingested image set. This component has no network writes. */
export default function AssetReviewGrid({ assets, decisions, disabled, onChange, onRetryOriginal, retryDisabled = true }: {
  assets: ReviewAsset[]; decisions: Record<number, AssetDecision>; disabled: boolean;
  onChange: (assetId: number, decision: AssetDecision) => void;
  onRetryOriginal?: (assetId: number) => void; retryDisabled?: boolean;
}) {
  if (!assets.length) return <p>本次没有图片候选；不代表商品没有图片。不能确认无安全主图／副图的版本。</p>;
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {assets.map(asset => {
      const decision = decisions[asset.id] ?? asset.decision;
      const safe = asset.storageAvailable && asset.contentHash !== null;
      return <article key={asset.id} className="min-w-0 space-y-2 rounded-lg border p-3" aria-label={`${labels[asset.role] ?? asset.role} 图位 ${asset.positionIndex + 1}`}>
        <div className="flex h-48 min-w-0 items-center justify-center overflow-hidden rounded bg-muted">
          {safe && asset.previewUrl ? <img src={asset.previewUrl} alt={`${labels[asset.role] ?? asset.role} 图位 ${asset.positionIndex + 1}`} className="h-full w-full object-contain" />
            : <span className="p-3 text-sm">{safe ? "图片已安全保存；预览暂不可用" : "未安全保存，不可保留"}</span>}
        </div>
        <p className="break-words text-sm">{labels[asset.role] ?? asset.role} · 图位 {asset.positionIndex + 1} · {asset.origin === "original" ? "原始采集" : "补充图片"}</p>
        <p className="break-all text-xs text-muted-foreground">{asset.fieldStatus}{asset.replacesAssetId === null ? "" : ` · 对应原图 #${asset.replacesAssetId}`}</p>
        <p className="text-sm">{decision === "keep" ? "本修订保留" : decision === "delete" ? "本修订排除（原文件保留）" : "待决定"}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={disabled || !safe || decision === "keep"} onClick={() => onChange(asset.id, "keep")}>保留</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange(asset.id, decision === "delete" ? (safe ? "keep" : "pending") : "delete")}>{decision === "delete" ? "撤销删除" : "从本修订删除"}</Button>
          <Button size="sm" variant="ghost" disabled={disabled || decision === "pending"} onClick={() => onChange(asset.id, "pending")}>标为待决定</Button>
          {!safe && asset.origin === "original" && onRetryOriginal && <Button size="sm" variant="outline" disabled={retryDisabled} onClick={() => onRetryOriginal(asset.id)}>恢复此图原始下载（不重采集）</Button>}
        </div>
        <p className="text-xs text-muted-foreground">仅供竞品内部研究。这里不裁切、压缩或重编码原图，也不删除已入库图片。</p>
      </article>;
    })}
  </div>;
}
