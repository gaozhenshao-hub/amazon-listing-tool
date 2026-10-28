import { imageTaggingUnits } from "@shared/imageTaggingUnits";
import ImageTagsPanel from "./ImageTagsPanel";
import AmazonRichContent from "./AmazonRichContent";
import { Fragment, useState, useCallback, useEffect, type ReactNode } from "react";
import type { KnowledgeVideo } from "@shared/knowledgeVideos";
import KnowledgeVideoPlayer from "./KnowledgeVideoPlayer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, GripVertical } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBalancedPreviewTransform } from "./useBalancedPreviewTransform";
import { GalleryImagePreview } from "./GalleryImagePreview";
import { SingleImagePreviewDialog } from "./SingleImagePreviewDialog";
import { activateGalleryItem, currentGalleryIndex } from "./galleryInteraction";
import { MERGED_READONLY_FEATURES_ENABLED } from "@/lib/mergedReadOnlyFeatures";

interface GalleryImage {
  id: number;
  imageUrl: string;
  imagePosition: string;
  positionIndex?: number;
  singleImageScore?: number;
  tagImageBelong?: string;
  tagImageBelongSub?: string;
  tagImageTypeMain?: string;
  tagImageTypeSub?: string;
  tagSellingPointCategory?: string;
  tagSellingPointDetail?: string;
  tagComposition?: string;
  tagDesignStyleV2?: string;
  tagColorSchemeV2?: string;
  tagColorV2?: string;
  aplusModuleType?: string;
  [key: string]: any;
}

interface AmazonStyleGalleryProps {
  renderVideo?: (video: KnowledgeVideo) => ReactNode;
  videos?: KnowledgeVideo[];
  sourceLayout?: unknown;
  mainImages: GalleryImage[];
  secondaryImages: GalleryImage[];
  brandStoryImages: GalleryImage[];
  aplusImages: GalleryImage[];
  onSelectImage: (id: number | null) => void;
  selectedImageId: number | null;
  onDeleteImage?: (imageId: number) => void;
  renderTagEditor?: (img: GalleryImage) => ReactNode;
  onReorder?: (imageOrders: { id: number; positionIndex: number }[]) => void;
  allowEdit?: boolean;
}

type PreviewFitMode = "balanced" | "full";

function PreviewFitToggle({ mode, onToggle }: { mode: PreviewFitMode; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full bg-black/45 px-2 py-1 text-[10px] text-white shadow-sm backdrop-blur-sm hover:bg-black/60"
      onClick={(event) => { event.stopPropagation(); onToggle(); }}
      title={mode === "balanced" ? "当前为平衡留白预览；点击查看完整原图画布" : "当前为完整原图画布；点击切回平衡留白预览"}
    >
      {mode === "balanced" ? "完整画布" : "平衡留白"}
    </button>
  );
}

/** Sortable thumbnail item for the vertical strip (main + secondary only) */
function SortableThumbnail({ img, index, isActive, mainCount, onClick }: {
  img: GalleryImage;
  index: number;
  isActive: boolean;
  mainCount: number;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="relative flex-shrink-0 group/thumb">
      <button
        type="button"
        aria-label={`查看商品图片 ${index + 1}`}
        aria-pressed={isActive}
        className={`relative w-[68px] h-[68px] rounded border-2 overflow-hidden transition-all ${
          isActive ? "border-primary ring-1 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"
        }`}
        onClick={onClick}
      >
        <GalleryImagePreview src={img.imageUrl} accessError={img.imageAccessError} alt="商品缩略图" className={`w-full h-full ${MERGED_READONLY_FEATURES_ENABLED ? "object-contain" : "object-cover"}`} loading="lazy" />
        {index === 0 && (
          <span className="absolute bottom-0 left-0 right-0 bg-blue-500/80 text-white text-[8px] text-center py-0.5">主图</span>
        )}
        {index > 0 && index < mainCount && mainCount > 1 && (
          <span className="absolute bottom-0 left-0 right-0 bg-blue-400/70 text-white text-[8px] text-center py-0.5">主图{index + 1}</span>
        )}
      </button>
      <div
        {...attributes}
        {...listeners}
        className="absolute -left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/thumb:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-white/90 rounded p-0.5 shadow-sm"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
    </div>
  );
}

/** A+ row: left large image, right tag panel (always visible) */
export function AmazonStyleGallery({
  videos = [],
  renderVideo,
  mainImages,
  secondaryImages,
  sourceLayout,
  brandStoryImages,
  aplusImages,
  onSelectImage,
  selectedImageId,
  onDeleteImage,
  renderTagEditor,
  onReorder,
  allowEdit = false,
}: AmazonStyleGalleryProps) {
  // Gallery = main + secondary ONLY (A+ and brand story have their own sections)
  const [galleryItems, setGalleryItems] = useState<GalleryImage[]>([]);
  const [currentImageId, setCurrentImageId] = useState<number | null>(null);
  const [videoActive, setVideoActive] = useState(false);
  const mainVideo = videos.find(video=>video.role==="main");
  const [zoomedImage, setZoomedImage] = useState<GalleryImage | null>(null);
  const selectRichImage = (image: GalleryImage) => setZoomedImage(image);
  const [galleryFitMode, setGalleryFitMode] = useState<PreviewFitMode>("balanced");

  useEffect(() => {
    const items = [...mainImages, ...secondaryImages].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0));
    setGalleryItems(items);
    setCurrentImageId(id => items[currentGalleryIndex(items, id)]?.id ?? null);
  }, [mainImages, secondaryImages]);

  const currentIndex = currentGalleryIndex(galleryItems, currentImageId);
  const videoPosition = Math.min(mainVideo?.position ?? galleryItems.length, galleryItems.length);
  const mediaIndex = videoActive ? videoPosition : currentIndex + (mainVideo && currentIndex >= videoPosition ? 1 : 0);
  const mediaCount = galleryItems.length + (mainVideo ? 1 : 0);
  const currentImage = galleryItems[currentIndex];
  const { previewRef: galleryPreviewRef, transform: galleryBalancedTransform } = useBalancedPreviewTransform(currentImage?.imageUrl || "");

  // Optimization 5/7: Preload adjacent images when currentIndex changes
  useEffect(() => {
    if (galleryItems.length === 0) return;
    // Preload current + next 2 + prev 1
    const indices = [
      currentIndex,
      (currentIndex + 1) % galleryItems.length,
      (currentIndex + 2) % galleryItems.length,
      (currentIndex - 1 + galleryItems.length) % galleryItems.length,
    ];
    const unique = [...new Set(indices)];
    unique.forEach((idx) => {
      const url = galleryItems[idx]?.imageUrl;
      if (url) {
        const img = new Image();
        img.src = url;
      }
    });
  }, [currentIndex, galleryItems]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const moveMedia = (direction: number) => {
    const next = (mediaIndex + direction + mediaCount) % mediaCount;
    setVideoActive(Boolean(mainVideo && next === videoPosition));
    if (!mainVideo || next !== videoPosition) setCurrentImageId(galleryItems[next - (mainVideo && next > videoPosition ? 1 : 0)]?.id ?? null);
  };
  const goToPrev = () => moveMedia(-1), goToNext = () => moveMedia(1);

  const handleThumbnailClick = useCallback((index: number) => {
    setVideoActive(false);
    const img = galleryItems[index];
    if (img) { setCurrentImageId(img.id); onSelectImage(selectedImageId === img.id ? null : img.id); }
  }, [galleryItems, onSelectImage, selectedImageId]);

  const handleMainImageClick = useCallback(() => {
    if (currentImage && !currentImage.missing) setZoomedImage(currentImage);
  }, [currentImage]);

  const handleGalleryDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = galleryItems.findIndex((i) => i.id === active.id);
    const newIndex = galleryItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newItems = arrayMove(galleryItems, oldIndex, newIndex);
    setGalleryItems(newItems);
    if (onReorder) onReorder(newItems.map((item, idx) => ({ id: item.id, positionIndex: idx })));
  }, [galleryItems, onReorder]);

  const videoThumbnail = mainVideo && <button type="button" aria-label="查看主图视频" aria-pressed={videoActive} onClick={()=>{setVideoActive(true);onSelectImage(null);}} className={`relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded border-2 ${videoActive ? "border-primary" : "border-transparent"}`}>
    {mainVideo.posterUrl && <img src={mainVideo.posterUrl} alt="主图视频封面" loading="lazy" className="h-full w-full object-cover" />}<span className="absolute inset-x-0 bottom-0 bg-black/70 text-xs text-white">▶ 视频</span>
  </button>;

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">

      {/* ═══ 1. Main + Secondary Gallery (Amazon Style) ═══ */}
      {mediaCount > 0 && (
        <div className="w-full min-w-0 max-w-full">
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-blue-500 rounded-full" />
            商品图片 <Badge variant="secondary" className="text-[10px]">{galleryItems.length}张</Badge>
            <span className="text-[10px] text-muted-foreground">（主图与副图{mainVideo ? " · 1 个视频" : ""}）</span>
          </h4>

          <div className="grid w-full min-w-0 max-w-full grid-cols-1 gap-3 md:grid-cols-[72px_minmax(0,1fr)_280px]">
            {/* Left: Vertical thumbnail strip */}
            <div className="hidden md:flex flex-col gap-1.5 w-[72px] shrink-0 max-h-[480px] overflow-y-auto scrollbar-thin">
              {onReorder ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleGalleryDragEnd}>
                  <SortableContext items={galleryItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {galleryItems.map((img, idx) => (
                      <Fragment key={img.id}>{mainVideo && idx === videoPosition && videoThumbnail}<SortableThumbnail
                        img={img}
                        index={idx}
                        isActive={!videoActive && idx === currentIndex}
                        mainCount={mainImages.length}
                        onClick={() => handleThumbnailClick(idx)}
                      /></Fragment>
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                galleryItems.map((img, idx) => (
                  <Fragment key={img.id}>{mainVideo && idx === videoPosition && videoThumbnail}<button
                    type="button"
                    aria-label={`查看商品图片 ${idx + 1}`}
                    aria-pressed={!videoActive && idx === currentIndex}
                    className={`relative flex-shrink-0 w-[68px] h-[68px] rounded border-2 overflow-hidden transition-all ${
                      !videoActive && idx === currentIndex ? "border-primary ring-1 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"
                    }`}
                    onClick={() => handleThumbnailClick(idx)}
                  >
                    <GalleryImagePreview src={img.imageUrl} accessError={img.imageAccessError} alt="商品缩略图" className={`w-full h-full ${MERGED_READONLY_FEATURES_ENABLED ? "object-contain" : "object-cover"}`} loading="lazy" />
                    {idx === 0 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-blue-500/80 text-white text-[8px] text-center py-0.5">主图</span>
                    )}
                    {idx > 0 && idx < mainImages.length && mainImages.length > 1 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-blue-400/70 text-white text-[8px] text-center py-0.5">主图{idx + 1}</span>
                    )}
                  </button></Fragment>
                ))
              )}
              {mainVideo && videoPosition === galleryItems.length && videoThumbnail}
            </div>

            {/* Center: Main display area */}
            <div className={`min-w-0 max-w-full flex-1 relative group ${videoActive && renderVideo ? "md:col-span-2" : ""}`}>
              {videoActive && mainVideo && <>{renderVideo ? renderVideo(mainVideo) : <KnowledgeVideoPlayer key={mainVideo.hash} video={mainVideo} />}<div className="mt-2 flex items-center justify-center gap-4"><Button size="icon" variant="outline" aria-label="上一张商品图片" onClick={goToPrev}><ChevronLeft /></Button><span className="text-xs text-muted-foreground">{mediaIndex+1} / {mediaCount}</span><Button size="icon" variant="outline" aria-label="下一张商品图片" onClick={goToNext}><ChevronRight /></Button></div></>}
              {!videoActive && currentImage && (
                <>
                  <div
                    className={`relative w-full min-w-0 max-w-full bg-gray-50 rounded-lg overflow-hidden border cursor-pointer transition-all ${
                      selectedImageId === currentImage.id ? "ring-2 ring-primary" : ""
                    }`}
                    ref={galleryPreviewRef}
                    style={{ height: "420px" }}
                    role={MERGED_READONLY_FEATURES_ENABLED ? "button" : undefined}
                    tabIndex={MERGED_READONLY_FEATURES_ENABLED ? 0 : undefined}
                    aria-label="查看当前商品原图"
                    aria-pressed={MERGED_READONLY_FEATURES_ENABLED ? selectedImageId === currentImage.id : undefined}
                    onClick={handleMainImageClick}
                    onKeyDown={MERGED_READONLY_FEATURES_ENABLED ? event => activateGalleryItem(event, handleMainImageClick) : undefined}
                  >
                    <GalleryImagePreview
                      src={currentImage.imageUrl}
                      accessError={currentImage.imageAccessError}
                      alt="当前商品图片"
                      className="absolute inset-0 h-full w-full object-contain p-2"
                      style={{ transform: galleryFitMode === "balanced" ? galleryBalancedTransform : undefined }}
                      loading="eager"
                      fetchPriority="high"
                    />
                    <Badge variant="outline" className="absolute top-2 left-2 text-[10px] bg-white/90 backdrop-blur-sm">
                      {currentIndex === 0 ? "主图" : `#${currentIndex}`}
                    </Badge>
                    {currentImage.singleImageScore && (
                      <Badge className="absolute top-2 right-2 text-[10px] bg-primary/80 border-0">
                        {currentImage.singleImageScore}/10
                      </Badge>
                    )}
                    <div className="absolute top-2 right-2 z-10 flex gap-1">
                      {!currentImage.missing && MERGED_READONLY_FEATURES_ENABLED && <button type="button" className="rounded-full bg-black/45 px-2 py-1 text-[10px] text-white" onClick={event => { event.stopPropagation(); setZoomedImage(currentImage); }}>查看原图</button>}
                      <PreviewFitToggle mode={galleryFitMode} onToggle={() => setGalleryFitMode(mode => mode === "balanced" ? "full" : "balanced")} />
                    </div>

                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <div className="bg-black/40 rounded-full px-3 py-1.5">
                        <span className="text-white text-xs">查看原图</span>
                      </div>
                    </div>
                  </div>

                  {mediaCount > 1 && (
                    <>
                      <Button variant="outline" size="icon" aria-label="上一张商品图片" className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 shadow-md opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); goToPrev(); }}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" aria-label="下一张商品图片" className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 shadow-md opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); goToNext(); }}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </>
                  )}

                  <div className="text-center mt-2 text-xs text-muted-foreground">
                    {mediaIndex + 1} / {mediaCount}
                  </div>
                </>
              )}
            </div>
            {videoActive ? !renderVideo && <aside className="rounded-lg border p-4 text-sm">归属：主图视频</aside> : currentImage && !currentImage.missing && <ImageTagsPanel key={currentImage.id} image={currentImage} canEdit={allowEdit} />}
          </div>

          {/* Mobile: Horizontal thumbnail strip */}
          <div className="flex w-full min-w-0 max-w-full md:hidden gap-1.5 mt-2 overflow-x-auto pb-2">
            {galleryItems.map((img, idx) => (
              <Fragment key={img.id}>{mainVideo && idx === videoPosition && videoThumbnail}<button
                type="button"
                aria-label={`查看商品图片 ${idx + 1}`}
                aria-pressed={!videoActive && idx === currentIndex}
                className={`relative flex-shrink-0 w-14 h-14 rounded border-2 overflow-hidden transition-all ${
                  !videoActive && idx === currentIndex ? "border-primary ring-1 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"
                }`}
                onClick={() => handleThumbnailClick(idx)}
              >
                <GalleryImagePreview src={img.imageUrl} accessError={img.imageAccessError} alt="商品缩略图" className={`w-full h-full ${MERGED_READONLY_FEATURES_ENABLED ? "object-contain" : "object-cover"}`} loading="lazy" />
              </button></Fragment>
            ))}
            {mainVideo && videoPosition === galleryItems.length && videoThumbnail}
          </div>
        </div>
      )}

      {(aplusImages.length > 0 || videos.some(video=>video.role==="aplus") || (sourceLayout as any)?.modules?.some((m:any)=>m.section==="aplus")) && <section className="min-w-0"><h2 className="mb-3 font-semibold">A+ 内容</h2><AmazonRichContent layout={sourceLayout} images={aplusImages} videos={videos} section="aplus" renderVideo={renderVideo} renderTags={images => <div className="space-y-3">{images.map(image => <ImageTagsPanel key={image.id} image={image} canEdit={allowEdit} />)}</div>} onSelect={image => selectRichImage(image as GalleryImage)} /></section>}
      {(brandStoryImages.length > 0 || (sourceLayout as any)?.modules?.some((m:any)=>m.section==="brand_story")) && <section className="min-w-0"><h2 className="mb-3 font-semibold">品牌故事</h2><AmazonRichContent layout={sourceLayout} images={brandStoryImages} section="brand_story" onSelect={image => selectRichImage(image as GalleryImage)} /></section>}

      <SingleImagePreviewDialog image={zoomedImage ? (()=>{const original=[...mainImages,...secondaryImages,...aplusImages,...brandStoryImages].find(image=>image.id===zoomedImage.id) ?? zoomedImage;const unit=imageTaggingUnits(aplusImages,sourceLayout).find(unit=>unit.images.some(image=>image.id===zoomedImage.id));return unit?.module ? {...unit.primary,module:unit.module,moduleImages:unit.images} : original;})() : null} canEdit={allowEdit} onClose={() => setZoomedImage(null)} />
    </div>
  );
}
