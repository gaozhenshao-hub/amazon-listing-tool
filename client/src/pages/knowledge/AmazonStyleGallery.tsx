import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, GripVertical, Tag } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

/** Inline tag display for an image — always visible, no click needed */
function InlineTags({ img, compact = false }: { img: GalleryImage; compact?: boolean }) {
  const tags: { label: string; color: string }[] = [];
  if (img.tagImageBelong) tags.push({ label: img.tagImageBelong + (img.tagImageBelongSub ? `·${img.tagImageBelongSub}` : ""), color: "bg-indigo-500/80" });
  if (img.tagImageTypeMain) tags.push({ label: img.tagImageTypeMain + (img.tagImageTypeSub ? `·${img.tagImageTypeSub}` : ""), color: "bg-purple-500/80" });
  if (img.tagSellingPointCategory) tags.push({ label: img.tagSellingPointCategory + (img.tagSellingPointDetail ? `·${img.tagSellingPointDetail}` : ""), color: "bg-green-500/80" });
  if (img.tagComposition) tags.push({ label: img.tagComposition, color: "bg-orange-500/80" });
  if (img.tagDesignStyleV2) tags.push({ label: img.tagDesignStyleV2, color: "bg-amber-500/80" });
  if (img.tagColorSchemeV2) tags.push({ label: img.tagColorSchemeV2, color: "bg-pink-500/80" });
  if (img.tagColorV2) tags.push({ label: img.tagColorV2, color: "bg-rose-400/80" });
  if (img.singleImageScore) tags.push({ label: `评分 ${img.singleImageScore}/10`, color: "bg-primary/80" });

  if (tags.length === 0) {
    return <p className="text-xs text-muted-foreground italic">暂无标签</p>;
  }
  return (
    <div className={`flex flex-wrap gap-1 ${compact ? "" : "mt-1"}`}>
      {tags.map((t, i) => (
        <Badge key={i} className={`text-[9px] border-0 text-white ${t.color}`}>{t.label}</Badge>
      ))}
    </div>
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
        className={`relative w-[68px] h-[68px] rounded border-2 overflow-hidden transition-all ${
          isActive ? "border-primary ring-1 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"
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
function AplusRow({ img, onDeleteImage, renderTagEditor, onReorder }: {
  img: GalleryImage;
  onDeleteImage?: (id: number) => void;
  renderTagEditor?: (img: GalleryImage) => ReactNode;
  onReorder?: boolean;
}) {
  const [showEditor, setShowEditor] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="flex gap-0 border rounded-lg overflow-hidden bg-white group/aprow">
      {/* Left: image */}
      <div className="relative flex-1 min-w-0">
        <img src={img.imageUrl} alt="" className="w-full object-contain bg-white" loading="lazy" />
        {/* Drag handle */}
        {onReorder && (
          <div
            {...attributes}
            {...listeners}
            className="absolute top-2 left-2 z-10 opacity-0 group-hover/aprow:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-white/90 rounded p-1 shadow-sm"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        {/* Delete button */}
        {onDeleteImage && (
          <button
            className="absolute top-2 right-2 z-10 bg-destructive/90 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover/aprow:opacity-100 transition-opacity shadow-sm"
            onClick={() => { if (confirm("确定删除这张图片？")) onDeleteImage(img.id); }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {/* A+ sub-module badge */}
        {(img.tagImageBelongSub || (img.aplusModuleType && img.aplusModuleType !== "unknown")) && (
          <Badge className="absolute top-2 left-10 text-[9px] border-0 bg-purple-500/80 text-white">
            {img.tagImageBelongSub || img.aplusModuleType}
          </Badge>
        )}
      </div>

      {/* Right: tag panel — always visible */}
      <div className="w-[260px] flex-shrink-0 border-l bg-muted/20 p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Tag className="h-3 w-3" /> 标签
          </span>
          {renderTagEditor && (
            <button
              className="text-[10px] text-primary hover:underline"
              onClick={() => setShowEditor((v) => !v)}
            >
              {showEditor ? "收起" : "编辑"}
            </button>
          )}
        </div>
        <InlineTags img={img} />
        {showEditor && renderTagEditor && (
          <div className="mt-1 border-t pt-2 animate-in slide-in-from-top-2 duration-200">
            {renderTagEditor(img)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Brand story horizontal scroll item */
function BrandStoryItem({ img, isActive, onClick, onDeleteImage }: {
  img: GalleryImage;
  isActive: boolean;
  onClick: () => void;
  onDeleteImage?: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="relative flex-shrink-0 w-[280px] group/bsitem cursor-pointer" onClick={onClick}>
      <div className={`rounded-lg overflow-hidden border-2 transition-all ${isActive ? "border-primary ring-1 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"}`}>
        <img src={img.imageUrl} alt="" className="w-full h-[160px] object-cover bg-white" loading="lazy" />
      </div>
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 left-2 z-10 opacity-0 group-hover/bsitem:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-white/90 rounded p-1 shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
      {onDeleteImage && (
        <button
          className="absolute top-2 right-2 z-10 bg-destructive/90 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover/bsitem:opacity-100 transition-opacity shadow-sm"
          onClick={(e) => { e.stopPropagation(); if (confirm("确定删除这张图片？")) onDeleteImage(img.id); }}
        >
          <X className="h-3 w-3" />
        </button>
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
}: AmazonStyleGalleryProps) {
  // Gallery = main + secondary ONLY (A+ and brand story have their own sections)
  const [galleryItems, setGalleryItems] = useState<GalleryImage[]>([]);
  const [aplusItems, setAplusItems] = useState<GalleryImage[]>([]);
  const [brandStoryItems, setBrandStoryItems] = useState<GalleryImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeBrandStoryId, setActiveBrandStoryId] = useState<number | null>(null);
  const brandStoryScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGalleryItems([...mainImages, ...secondaryImages].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0)));
  }, [mainImages, secondaryImages]);

  useEffect(() => {
    setAplusItems([...aplusImages].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0)));
  }, [aplusImages]);

  useEffect(() => {
    setBrandStoryItems([...brandStoryImages].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0)));
    if (brandStoryImages.length > 0 && !activeBrandStoryId) {
      setActiveBrandStoryId(brandStoryImages[0].id);
    }
  }, [brandStoryImages]);

  const currentImage = galleryItems[currentIndex];
  const activeBrandStoryImg = brandStoryItems.find((i) => i.id === activeBrandStoryId) || brandStoryItems[0];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => prev > 0 ? prev - 1 : galleryItems.length - 1);
  }, [galleryItems.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => prev < galleryItems.length - 1 ? prev + 1 : 0);
  }, [galleryItems.length]);

  const handleThumbnailClick = useCallback((index: number) => {
    setCurrentIndex(index);
    const img = galleryItems[index];
    if (img) onSelectImage(selectedImageId === img.id ? null : img.id);
  }, [galleryItems, onSelectImage, selectedImageId]);

  const handleMainImageClick = useCallback(() => {
    if (currentImage) onSelectImage(selectedImageId === currentImage.id ? null : currentImage.id);
  }, [currentImage, onSelectImage, selectedImageId]);

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

  const handleAplusDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = aplusItems.findIndex((i) => i.id === active.id);
    const newIndex = aplusItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newItems = arrayMove(aplusItems, oldIndex, newIndex);
    setAplusItems(newItems);
    if (onReorder) onReorder(newItems.map((item, idx) => ({ id: item.id, positionIndex: idx + 100 })));
  }, [aplusItems, onReorder]);

  const handleBrandStoryDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = brandStoryItems.findIndex((i) => i.id === active.id);
    const newIndex = brandStoryItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newItems = arrayMove(brandStoryItems, oldIndex, newIndex);
    setBrandStoryItems(newItems);
    if (onReorder) onReorder(newItems.map((item, idx) => ({ id: item.id, positionIndex: idx + 200 })));
  }, [brandStoryItems, onReorder]);

  return (
    <div className="space-y-6">

      {/* ═══ 1. Main + Secondary Gallery (Amazon Style) ═══ */}
      {galleryItems.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-blue-500 rounded-full" />
            副图 <Badge variant="secondary" className="text-[10px]">{galleryItems.length}张</Badge>
            <span className="text-[10px] text-muted-foreground">（主图+副图，可拖拽排序）</span>
          </h4>

          <div className="flex gap-3">
            {/* Left: Vertical thumbnail strip */}
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
                      idx === currentIndex ? "border-primary ring-1 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"
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
                    <Badge variant="outline" className="absolute top-2 left-2 text-[10px] bg-white/90 backdrop-blur-sm">
                      {currentIndex === 0 ? "主图" : `#${currentIndex}`}
                    </Badge>
                    {currentImage.singleImageScore && (
                      <Badge className="absolute top-2 right-2 text-[10px] bg-primary/80 border-0">
                        {currentImage.singleImageScore}/10
                      </Badge>
                    )}
                    {/* Tags overlay at bottom */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-3">
                      <InlineTags img={currentImage} compact />
                    </div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <div className="bg-black/40 rounded-full px-3 py-1.5">
                        <span className="text-white text-xs">{selectedImageId === currentImage.id ? "收起面板" : "展开标签"}</span>
                      </div>
                    </div>
                  </div>

                  {galleryItems.length > 1 && (
                    <>
                      <Button variant="outline" size="icon" className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 shadow-md opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); goToPrev(); }}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 shadow-md opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); goToNext(); }}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </>
                  )}

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
                  idx === currentIndex ? "border-primary ring-1 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"
                }`}
                onClick={() => handleThumbnailClick(idx)}
              >
                <img src={img.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 2. A+ Content Section (left image, right tags, vertical stack) ═══ */}
      {aplusItems.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-purple-500 rounded-full" />
            A+ 内容 <Badge variant="secondary" className="text-[10px]">{aplusItems.length}张</Badge>
            {onReorder && <span className="text-[10px] text-muted-foreground">（可拖拽排序）</span>}
          </h4>
          {onReorder ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAplusDragEnd}>
              <SortableContext items={aplusItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-0">
                  {aplusItems.map((img) => (
                    <AplusRow
                      key={img.id}
                      img={img}
                      onDeleteImage={onDeleteImage}
                      renderTagEditor={renderTagEditor}
                      onReorder={!!onReorder}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="flex flex-col gap-0">
              {aplusItems.map((img) => (
                <AplusRow
                  key={img.id}
                  img={img}
                  onDeleteImage={onDeleteImage}
                  renderTagEditor={renderTagEditor}
                  onReorder={false}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ 3. Brand Story Section (horizontal scroll, tags below) ═══ */}
      {brandStoryItems.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-amber-500 rounded-full" />
            品牌故事 <Badge variant="secondary" className="text-[10px]">{brandStoryItems.length}张</Badge>
            {onReorder && <span className="text-[10px] text-muted-foreground">（可拖拽排序）</span>}
          </h4>

          {/* Horizontal scroll strip */}
          <div ref={brandStoryScrollRef} className="overflow-x-auto pb-2">
            {onReorder ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleBrandStoryDragEnd}>
                <SortableContext items={brandStoryItems.map(i => i.id)} strategy={horizontalListSortingStrategy}>
                  <div className="flex gap-3 min-w-max">
                    {brandStoryItems.map((img) => (
                      <BrandStoryItem
                        key={img.id}
                        img={img}
                        isActive={activeBrandStoryId === img.id}
                        onClick={() => setActiveBrandStoryId(img.id)}
                        onDeleteImage={onDeleteImage}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="flex gap-3 min-w-max">
                {brandStoryItems.map((img) => (
                  <BrandStoryItem
                    key={img.id}
                    img={img}
                    isActive={activeBrandStoryId === img.id}
                    onClick={() => setActiveBrandStoryId(img.id)}
                    onDeleteImage={onDeleteImage}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Tags + editor for the selected brand story image */}
          {activeBrandStoryImg && (
            <div className="mt-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {activeBrandStoryImg === brandStoryItems[0] && brandStoryItems.length > 1
                    ? `第 1 张标签`
                    : `第 ${brandStoryItems.findIndex(i => i.id === activeBrandStoryImg.id) + 1} 张标签`}
                </span>
                {renderTagEditor && (
                  <button
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => onSelectImage(selectedImageId === activeBrandStoryImg.id ? null : activeBrandStoryImg.id)}
                  >
                    {selectedImageId === activeBrandStoryImg.id ? "收起编辑" : "编辑标签"}
                  </button>
                )}
              </div>
              <InlineTags img={activeBrandStoryImg} />
              {selectedImageId === activeBrandStoryImg.id && renderTagEditor && (
                <div className="mt-2 border-t pt-2 animate-in slide-in-from-top-2 duration-200">
                  {renderTagEditor(activeBrandStoryImg)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
