import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KnowledgeImagePreview } from "@/components/KnowledgeImagePreview";
import { distinctImageTags, imageBelongLabel, joinImageTags } from "./kbImageLabels";

export type BrowseImage = {
  id: number;
  imageSetId?: number;
  imageUrl?: string | null;
  imageAccessError?: string | null;
  asin?: string | null;
  productTitle?: string | null;
  imagePosition?: string | null;
  tagImageBelong?: string | null;
  tagImageBelongSub?: string | null;
  tagImageType?: string | null;
  tagImageTypeMain?: string | null;
  tagImageTypeSub?: string | null;
  tagSellingPointCategory?: string | null;
  tagSellingPointDetail?: string | null;
  tagComposition?: string | null;
  tagDesignStyle?: string | null;
  tagDesignStyleV2?: string | null;
  tagColorSchemeV2?: string | null;
  tagColorV2?: string | null;
};

export function SingleImagePreviewDialog({ image, onClose, onOpenSet }: {
  image: BrowseImage | null;
  onClose: () => void;
  onOpenSet?: (setId: number) => void;
}) {
  const tags = image ? distinctImageTags([
    imageBelongLabel(image), joinImageTags(image.tagImageTypeMain || image.tagImageType, image.tagImageTypeSub),
    joinImageTags(image.tagSellingPointCategory, image.tagSellingPointDetail), image.tagComposition,
    image.tagDesignStyleV2 || image.tagDesignStyle, image.tagColorSchemeV2, image.tagColorV2,
  ]) : [];
  return <Dialog open={!!image} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[94vh] w-[94vw] max-w-[94vw] flex-col gap-3 overflow-hidden p-4 sm:max-w-[94vw]" aria-describedby={undefined}>
      <DialogHeader className="pr-8"><DialogTitle>单张图片原图预览{image?.asin ? ` · ${image.asin}` : ""}</DialogTitle></DialogHeader>
      {image && <>
        <div className="min-h-0 min-w-0 overflow-auto rounded-lg bg-muted/30">
          <KnowledgeImagePreview key={`${image.id}:${image.imageUrl}`} src={image.imageUrl}
            alt={image.productTitle || "知识库图片原图"} loading="eager" accessError={image.imageAccessError}
            className="mx-auto block h-auto max-h-[72vh] max-w-full object-contain" fallbackClassName="h-[50vh] w-full" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap gap-1.5" aria-label="图片标签">
            {tags.map(tag => <Badge key={tag} variant="secondary" className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{tag}</Badge>)}
          </div>
          {onOpenSet && Number.isSafeInteger(image.imageSetId) && image.imageSetId! > 0 &&
            <Button variant="outline" onClick={() => onOpenSet(image.imageSetId!)}>在 ASIN 集中查看</Button>}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
