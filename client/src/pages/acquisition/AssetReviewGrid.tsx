import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ImageOff, ShieldCheck, X } from "lucide-react";

export type AssetReviewStatus = "pending" | "approved" | "rejected";

export type ReviewAsset = {
  id: number;
  role: string;
  positionIndex: number;
  fieldStatus: string;
  reviewStatus: string;
  width: number | null;
  height: number | null;
  contentType: string | null;
  previewUrl: string | null;
  internalResearchOnly: boolean;
};

const roleLabels: Record<string, string> = {
  main: "主图",
  secondary: "辅图",
  aplus: "A+",
  brand_story: "品牌故事",
  variant: "变体",
};

export default function AssetReviewGrid({
  assets,
  reviews,
  onChange,
}: {
  assets: ReviewAsset[];
  reviews: Record<number, AssetReviewStatus>;
  onChange: (assetId: number, status: AssetReviewStatus) => void;
}) {
  if (assets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        未获取到可审核图片。字段状态会保留为未返回或无效，不会解释为商品不存在图片。
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {assets.map((asset) => {
        const status = reviews[asset.id] ?? "pending";
        return (
          <Card key={asset.id} className={status === "approved" ? "border-emerald-300" : status === "rejected" ? "border-rose-300" : ""}>
            <CardContent className="space-y-3 p-3">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                {asset.previewUrl ? (
                  <img src={asset.previewUrl} alt={`${roleLabels[asset.role] || asset.role} ${asset.positionIndex + 1}`} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground"><ImageOff className="h-8 w-8" /></div>
                )}
                <div className="absolute left-2 top-2 flex gap-2">
                  <Badge variant="secondary">{roleLabels[asset.role] || asset.role}</Badge>
                  <Badge variant={asset.fieldStatus === "pending_review" ? "outline" : "destructive"}>{asset.fieldStatus}</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>图位 {asset.positionIndex + 1}</span>
                <span>{asset.width && asset.height ? `${asset.width}×${asset.height}` : "尺寸待识别"}</span>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={status === "approved" ? "default" : "outline"} className="flex-1" onClick={() => onChange(asset.id, "approved")} disabled={!asset.previewUrl}>
                  <Check className="mr-1 h-4 w-4" />保留
                </Button>
                <Button type="button" size="sm" variant={status === "rejected" ? "destructive" : "outline"} className="flex-1" onClick={() => onChange(asset.id, "rejected")}>
                  <X className="mr-1 h-4 w-4" />排除
                </Button>
              </div>
              <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-[11px] leading-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                竞品证据仅供内部研究，不得作为我方商品素材或生成输入。
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
