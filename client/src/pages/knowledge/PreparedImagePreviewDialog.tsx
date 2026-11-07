import { trpc } from "@/lib/trpc";
import {
  SingleImagePreviewDialog,
  type BrowseImage,
} from "./SingleImagePreviewDialog";

function PreparedPreview({
  image,
  onClose,
  onOpenSet,
  canEdit,
}: {
  image: BrowseImage;
  onClose: () => void;
  onOpenSet?: (id: number) => void;
  canEdit?: boolean;
}) {
  const data = trpc.kbImages.getImagePresentation.useQuery(
    { imageId: image.id },
    {
      staleTime: 30_000,
      refetchInterval: q =>
        ["queued", "running"].includes(
          q.state.data?.translationJob?.status || ""
        )
          ? 4000
          : false,
    }
  );
  return (
    <SingleImagePreviewDialog
      image={{
        ...image,
        ...data.data?.image,
        imageTranslation: data.data?.imageTranslation || image.imageTranslation,
      }}
      presentation={data.data?.presentation}
      onClose={onClose}
      onOpenSet={onOpenSet}
      canEdit={canEdit}
    />
  );
}
export function PreparedImagePreviewDialog(props: {
  image: BrowseImage | null;
  onClose: () => void;
  onOpenSet?: (id: number) => void;
  canEdit?: boolean;
}) {
  return props.image ? (
    <PreparedPreview {...props} image={props.image} />
  ) : null;
}
