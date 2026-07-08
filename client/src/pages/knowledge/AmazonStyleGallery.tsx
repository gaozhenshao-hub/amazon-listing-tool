import { useState, useCallback, useEffect, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X, GripVertical } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface GalleryImage {
  id: number;
  imageUrl: string;
  imagePosition: string;
  positionIndex?: number;
  singleImageScore?: number;
  tagImageBelong?: string;
  tagImageTypeMain?: string;
  tagImageTypeSub?: string;
  tagSellingPointCategory?: string;
  tagComposition?: string;
  tagDesignStyleV2?: string;
  tagColorSchemeV2?: string;
  aplusModuleType?: string;
  [key: string]: any;
}

interface AmazonStyleGalleryProps {
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
  onSwapAplus?: (fromIndex: number, toIndex: number) => void;
}

const APLUS_MODULE_LABELS: Record<string, string> = {
  comparison_table: "对比表格",
  image_carousel: "图片轮播",
  full_width_image: "全宽图",
  image_text_overlay: "图文叠加",
  standard_image_text: "标准图文",
  four_image_text: "四图文",
  three_image_text: "三图文",
  hotspot_interactive: "热点交互",
  video_module: "视频模块",
  brand_story_hero: "品牌主图",
  brand_story_card: "品牌卡片",
  single_image_sidebar: "单图侧栏",
  tech_specs: "技术参数",
  navigation_carousel: "导航轮播",
};

/** Sortable thumbnail item for the vertical strip */
function SortableThumbnail({ img, index, isActive, mainCount, onClick }: {
  img: GalleryImage;
  index: number;
  isActive: boolean;
  mainCount: number;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative flex-shrink-0 group/thumb">
      <button
        className={`relative w-[68px] h-[68px] rounded border-2 overflow-hidden transition-all ${
          isActive
            ? "border-primary ring-1 ring-primary/30"
            : "border-transparent hover:border-muted-foreground/30"
        }`}
        onClick={onClick}
      >
        <img src={img.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        {index === 0 && (
          <span className="absolute bottom-0 left-0 right-0 bg-blue-500/80 text-white text-[8px] text-center py-0.5">主图</span>
        )}
        {index > 0 && index < mainCount && mainCount > 1 && (
          <span className="absolute bottom-0 left-0 right-0 bg-blue-400/70 text-white text-[8px] text-center py-0.5">主图{index + 1}</span>
        )}
      </button>
      {/* Drag handle */}
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

/** Sortable A+ / Brand Story image item */
function SortableVerticalImage({ img, selectedImageId, onSelectImage, onDeleteImage, renderTagEditor, sectionType, index, total, onSwap }: {
  img: GalleryImage;
  selectedImageId: number | null;
  onSelectImage: (id: number | null) => void;
  onDeleteImage?: (imageId: number) => void;
  renderTagEditor?: (img: GalleryImage) => ReactNode;
  sectionType: "aplus" | "brand_story";
  index?: number;
  total?: number;
  onSwap?: (fromIndex: number, toIndex: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const groupClass = sectionType === "aplus" ? "group/ap" : "group/vs";
  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`relative ${groupClass} cursor-pointer transition-all ${
          selectedImageId === img.id ? "ring-2 ring-primary ring-inset" : ""
        }`}
        onClick={() => onSelectImage(selectedImageId === img.id ? null : img.id)}
      >
        <img src={img.imageUrl} alt="" className="w-full object-contain bg-white" loading="lazy" />
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 z-10 opacity-0 group-hover/ap:opacity-100 group-hover/vs:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-white/90 rounded p-1 shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        {/* Swap up/down buttons */}
        {onSwap && index !== undefined && total !== undefined && (
          <div className="absolute top-2 left-10 z-10 opacity-0 group-hover/ap:opacity-100 group-hover/vs:opacity-100 transition-opacity flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button
              disabled={index === 0}
              onClick={(e) => { e.stopPropagation(); onSwap(index, index - 1); }}
              className="bg-white/90 hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed rounded p-0.5 shadow-sm transition-colors"
              title="上移"
            >
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              disabled={index === total - 1}
              onClick={(e) => { e.stopPropagation(); onSwap(index, index + 1); }}
              className="bg-white/90 hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed rounded p-0.5 shadow-sm transition-colors"
              title="下移"
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        )}
        {onDeleteImage && (
          <button
            className="absolute top-2 right-2 z-10 bg-destructive/90 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover/ap:opacity-100 group-hover/vs:opacity-100 transition-opacity shadow-sm"
            onClick={(e) => { e.stopPropagation(); if (confirm("确定删除这张图片？")) onDeleteImage(img.id); }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {img.aplusModuleType && img.aplusModuleType !== "unknown" && (
          <Badge className={`absolute top-2 left-20 text-[9px] border-0 ${
            img.aplusModuleType === "comparison_table" ? "bg-blue-500/80 text-white" :
            img.aplusModuleType === "image_carousel" ? "bg-green-500/80 text-white" :
            img.aplusModuleType === "full_width_image" ? "bg-purple-500/80 text-white" :
            img.aplusModuleType === "image_text_overlay" ? "bg-orange-500/80 text-white" :
            img.aplusModuleType === "four_image_text" ? "bg-cyan-500/80 text-white" :
            img.aplusModuleType === "three_image_text" ? "bg-teal-500/80 text-white" :
            "bg-violet-500/80 text-white"
          }`}>
            {APLUS_MODULE_LABELS[img.aplusModuleType] || img.aplusModuleType}
          </Badge>
        )}
        {img.singleImageScore && (
          <Badge className="absolute bottom-2 right-2 text-[9px] bg-primary/80 border-0">
            {img.singleImageScore}/10
          </Badge>
        )}
      </div>
      {/* Inline tag editor */}
      {selectedImageId === img.id && renderTagEditor && (
        <div className="bg-muted/30 border-t p-3 animate-in slide-in-from-top-2 duration-200">
          {renderTagEditor(img)}
        </div>
      )}
    </div>
  );
}

export function AmazonStyleGallery({
  mainImages,
  secondaryImages,
  brandStoryImages,
  aplusImages,
  onSelectImage,
  selectedImageId,
  onDeleteImage,
  renderTagEditor,
  onReorder,
  allowEdit = false,
  onSwapAplus,
}: AmazonStyleGalleryProps) {
  // Combine main + secondary for the gallery carousel
  const [galleryItems, setGalleryItems] = useState<GalleryImage[]>([]);
  const [aplusItems, setAplusItems] = useState<GalleryImage[]>([]);
  const [brandStoryItems, setBrandStoryItems] = useState<GalleryImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    setGalleryItems([...mainImages, ...secondaryImages].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0)));
  }, [mainImages, secondaryImages]);

  useEffect(() => {
    setAplusItems([...aplusImages].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0)));
  }, [aplusImages]);

  useEffect(() => {
    setBrandStoryItems([...brandStoryImages].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0)));
  }, [brandStoryImages]);

  const currentImage = galleryItems[currentIndex];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => prev > 0 ? prev - 1 : galleryItems.length - 1);
  }, [galleryItems.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => prev < galleryItems.length - 1 ? prev + 1 : 0);
  }, [galleryItems.length]);

  const handleThumbnailClick = useCallback((index: number) => {
    setCurrentIndex(index);
    const img = galleryItems[index];
    if (img) {
      onSelectImage(selectedImageId === img.id ? null : img.id);
    }
  }, [galleryItems, onSelectImage, selectedImageId]);

  const handleMainImageClick = useCallback(() => {
    if (currentImage) {
      onSelectImage(selectedImageId === currentImage.id ? null : currentImage.id);
    }
  }, [currentImage, onSelectImage, selectedImageId]);

  // Handle drag end for gallery (main + secondary) thumbnails
  const handleGalleryDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = galleryItems.findIndex((i) => i.id === active.id);
    const newIndex = galleryItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newItems = arrayMove(galleryItems, oldIndex, newIndex);
    setGalleryItems(newItems);
    if (onReorder) {
      onReorder(newItems.map((item, idx) => ({ id: item.id, positionIndex: idx })));
    }
  }, [galleryItems, onReorder]);

  // Handle drag end for A+ images
  const handleAplusDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = aplusItems.findIndex((i) => i.id === active.id);
    const newIndex = aplusItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newItems = arrayMove(aplusItems, oldIndex, newIndex);
    setAplusItems(newItems);
    if (onReorder) {
      onReorder(newItems.map((item, idx) => ({ id: item.id, positionIndex: idx + 100 })));
    }
  }, [aplusItems, onReorder]);

  // Handle A+ swap via up/down buttons
  const handleAplusSwap = useCallback((fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= aplusItems.length) return;
    const newItems = arrayMove(aplusItems, fromIndex, toIndex);
    setAplusItems(newItems);
    if (onReorder) {
      onReorder(newItems.map((item, idx) => ({ id: item.id, positionIndex: idx + 100 })));
    }
    if (onSwapAplus) {
      onSwapAplus(fromIndex, toIndex);
    }
  }, [aplusItems, onReorder, onSwapAplus]);

  // Handle drag end for brand story images
  const handleBrandStoryDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = brandStoryItems.findIndex((i) => i.id === active.id);
    const newIndex = brandStoryItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newItems = arrayMove(brandStoryItems, oldIndex, newIndex);
    setBrandStoryItems(newItems);
    if (onReorder) {
      onReorder(newItems.map((item, idx) => ({ id: item.id, positionIndex: idx + 200 })));
    }
  }, [brandStoryItems, onReorder]);

  return (
    <div className="space-y-6">
      {/* ═══ Main + Secondary Gallery (Amazon Style) ═══ */}
      {galleryItems.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-blue-500 rounded-full" />
            副图 <Badge variant="secondary" className="text-[10px]">{galleryItems.length}张</Badge>
            <span className="text-[10px] text-muted-foreground">（主图+副图，可拖拽排序）</span>
          </h4>
          
          <div className="flex gap-3">
            {/* Left: Vertical thumbnail strip with drag-and-drop */}
            <div className="hidden md:flex flex-col gap-1.5 w-[72px] max-h-[480px] overflow-y-auto scrollbar-thin">
              {onReorder ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleGalleryDragEnd}>
                  <SortableContext items={galleryItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {galleryItems.map((img, idx) => (
                      <SortableThumbnail
                        key={img.id}
                        img={img}
                        index={idx}
                        isActive={idx === currentIndex}
                        mainCount={mainImages.length}
                        onClick={() => handleThumbnailClick(idx)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                galleryItems.map((img, idx) => (
                  <button
                    key={img.id}
                    className={`relative flex-shrink-0 w-[68px] h-[68px] rounded border-2 overflow-hidden transition-all ${
                      idx === currentIndex
                        ? "border-primary ring-1 ring-primary/30"
                        : "border-transparent hover:border-muted-foreground/30"
                    }`}
                    onClick={() => handleThumbnailClick(idx)}
                  >
                    <img src={img.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    {idx === 0 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-blue-500/80 text-white text-[8px] text-center py-0.5">主图</span>
                    )}
                    {idx > 0 && idx < mainImages.length && mainImages.length > 1 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-blue-400/70 text-white text-[8px] text-center py-0.5">主图{idx + 1}</span>
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Center: Main display area */}
            <div className="flex-1 relative group">
              {currentImage && (
                <>
                  <div
                    className={`relative bg-gray-50 rounded-lg overflow-hidden border cursor-pointer transition-all ${
                      selectedImageId === currentImage.id ? "ring-2 ring-primary" : ""
                    }`}
                    style={{ minHeight: "360px", maxHeight: "480px" }}
                    onClick={handleMainImageClick}
                  >
                    <img
                      src={currentImage.imageUrl}
                      alt=""
                      className="w-full h-full object-contain"
                      style={{ maxHeight: "480px" }}
                    />
                    {/* Position badge */}
                    <Badge
                      variant="outline"
                      className="absolute top-2 left-2 text-[10px] bg-white/90 backdrop-blur-sm"
                    >
                      {currentIndex === 0 ? "主图" : `#${currentIndex}`}
                    </Badge>
                    {/* Score badge */}
                    {currentImage.singleImageScore && (
                      <Badge className="absolute top-2 right-2 text-[10px] bg-primary/80 border-0">
                        {currentImage.singleImageScore}/10
                      </Badge>
                    )}
                    {/* Tags overlay */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-3">
                      <div className="flex flex-wrap gap-1">
                        {currentImage.tagImageTypeMain && (
                          <Badge variant="secondary" className="text-[9px] bg-purple-500/80 text-white border-0">
                            {currentImage.tagImageTypeMain}{currentImage.tagImageTypeSub ? `·${currentImage.tagImageTypeSub}` : ''}
                          </Badge>
                        )}
                        {currentImage.tagSellingPointCategory && (
                          <Badge variant="secondary" className="text-[9px] bg-green-500/80 text-white border-0">
                            {currentImage.tagSellingPointCategory}
                          </Badge>
                        )}
                        {currentImage.tagComposition && (
                          <Badge variant="secondary" className="text-[9px] bg-orange-500/80 text-white border-0">
                            {currentImage.tagComposition}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {/* Click hint */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <div className="bg-black/40 rounded-full px-3 py-1.5">
                        <span className="text-white text-xs">{selectedImageId === currentImage.id ? "收起面板" : "展开标签"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Navigation arrows */}
                  {galleryItems.length > 1 && (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); goToPrev(); }}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); goToNext(); }}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </>
                  )}

                  {/* Counter */}
                  <div className="text-center mt-2 text-xs text-muted-foreground">
                    {currentIndex + 1} / {galleryItems.length}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Inline tag editor panel */}
          {selectedImageId && currentImage && selectedImageId === currentImage.id && renderTagEditor && (
            <div className="mt-3 animate-in slide-in-from-top-2 duration-200">
              {renderTagEditor(currentImage)}
            </div>
          )}

          {/* Mobile: Horizontal thumbnail strip */}
          <div className="flex md:hidden gap-1.5 mt-2 overflow-x-auto pb-2">
            {galleryItems.map((img, idx) => (
              <button
                key={img.id}
                className={`relative flex-shrink-0 w-14 h-14 rounded border-2 overflow-hidden transition-all ${
                  idx === currentIndex
                    ? "border-primary ring-1 ring-primary/30"
                    : "border-transparent hover:border-muted-foreground/30"
                }`}
                onClick={() => handleThumbnailClick(idx)}
              >
                <img src={img.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Brand Story Images (Vertical with drag-and-drop) ═══ */}
      {brandStoryItems.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-amber-500 rounded-full" />
            品牌故事 <Badge variant="secondary" className="text-[10px]">{brandStoryItems.length}张</Badge>
            {onReorder && <span className="text-[10px] text-muted-foreground">（可拖拽排序）</span>}
          </h4>
          {onReorder ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleBrandStoryDragEnd}>
              <SortableContext items={brandStoryItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-0 rounded-lg overflow-hidden border">
                  {brandStoryItems.map((img) => (
                    <SortableVerticalImage
                      key={img.id}
                      img={img}
                      selectedImageId={selectedImageId}
                      onSelectImage={onSelectImage}
                      onDeleteImage={onDeleteImage}
                      renderTagEditor={renderTagEditor}
                      sectionType="brand_story"
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="flex flex-col gap-0 rounded-lg overflow-hidden border">
              {brandStoryItems.map((img) => (
                <div key={img.id}>
                  <div
                    className={`relative group/vs cursor-pointer transition-all ${
                      selectedImageId === img.id ? "ring-2 ring-primary ring-inset" : ""
                    }`}
                    onClick={() => onSelectImage(selectedImageId === img.id ? null : img.id)}
                  >
                    <img src={img.imageUrl} alt="" className="w-full object-contain bg-white" loading="lazy" />
                    {onDeleteImage && (
                      <button
                        className="absolute top-2 right-2 z-10 bg-destructive/90 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover/vs:opacity-100 transition-opacity shadow-sm"
                        onClick={(e) => { e.stopPropagation(); if (confirm("确定删除这张图片？")) onDeleteImage(img.id); }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    {img.singleImageScore && (
                      <Badge className="absolute bottom-2 right-2 text-[9px] bg-primary/80 border-0">
                        {img.singleImageScore}/10
                      </Badge>
                    )}
                  </div>
                  {selectedImageId === img.id && renderTagEditor && (
                    <div className="bg-muted/30 border-t p-3 animate-in slide-in-from-top-2 duration-200">
                      {renderTagEditor(img)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ A+ Images (Vertical with drag-and-drop) ═══ */}
      {aplusItems.length > 0 && (
        <div className={brandStoryItems.length > 0 ? "-mt-6" : ""}>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-purple-500 rounded-full" />
            A+ 图片 <Badge variant="secondary" className="text-[10px]">{aplusItems.length}张</Badge>
            {onReorder && <span className="text-[10px] text-muted-foreground">（可拖拽排序）</span>}
          </h4>
          {onReorder ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAplusDragEnd}>
              <SortableContext items={aplusItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-0 rounded-lg overflow-hidden border">
                  {aplusItems.map((img, idx) => (
                    <SortableVerticalImage
                      key={img.id}
                      img={img}
                      selectedImageId={selectedImageId}
                      onSelectImage={onSelectImage}
                      onDeleteImage={onDeleteImage}
                      renderTagEditor={renderTagEditor}
                      sectionType="aplus"
                      index={idx}
                      total={aplusItems.length}
                      onSwap={handleAplusSwap}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="flex flex-col gap-0 rounded-lg overflow-hidden border">
              {aplusItems.map((img) => (
                <div key={img.id}>
                  <div
                    className={`relative group/ap cursor-pointer transition-all ${
                      selectedImageId === img.id ? "ring-2 ring-primary ring-inset" : ""
                    }`}
                    onClick={() => onSelectImage(selectedImageId === img.id ? null : img.id)}
                  >
                    <img src={img.imageUrl} alt="" className="w-full object-contain bg-white" loading="lazy" />
                    {onDeleteImage && (
                      <button
                        className="absolute top-2 right-2 z-10 bg-destructive/90 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover/ap:opacity-100 transition-opacity shadow-sm"
                        onClick={(e) => { e.stopPropagation(); if (confirm("确定删除这张图片？")) onDeleteImage(img.id); }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    {img.aplusModuleType && img.aplusModuleType !== "unknown" && (
                      <Badge className={`absolute top-2 left-2 text-[9px] border-0 ${
                        img.aplusModuleType === "comparison_table" ? "bg-blue-500/80 text-white" :
                        img.aplusModuleType === "image_carousel" ? "bg-green-500/80 text-white" :
                        img.aplusModuleType === "full_width_image" ? "bg-purple-500/80 text-white" :
                        img.aplusModuleType === "image_text_overlay" ? "bg-orange-500/80 text-white" :
                        img.aplusModuleType === "four_image_text" ? "bg-cyan-500/80 text-white" :
                        img.aplusModuleType === "three_image_text" ? "bg-teal-500/80 text-white" :
                        "bg-violet-500/80 text-white"
                      }`}>
                        {APLUS_MODULE_LABELS[img.aplusModuleType] || img.aplusModuleType}
                      </Badge>
                    )}
                    {img.singleImageScore && (
                      <Badge className="absolute bottom-2 right-2 text-[9px] bg-primary/80 border-0">
                        {img.singleImageScore}/10
                      </Badge>
                    )}
                  </div>
                  {selectedImageId === img.id && renderTagEditor && (
                    <div className="bg-muted/30 border-t p-3 animate-in slide-in-from-top-2 duration-200">
                      {renderTagEditor(img)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
