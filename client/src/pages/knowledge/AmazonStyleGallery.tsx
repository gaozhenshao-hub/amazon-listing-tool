import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";

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

export function AmazonStyleGallery({
  mainImages,
  secondaryImages,
  brandStoryImages,
  aplusImages,
  onSelectImage,
  selectedImageId,
  onDeleteImage,
}: AmazonStyleGalleryProps) {
  // Combine main + secondary for the gallery carousel
  const galleryImages = [...mainImages, ...secondaryImages];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const currentImage = galleryImages[currentIndex];

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => {
      const newIdx = prev > 0 ? prev - 1 : galleryImages.length - 1;
      const img = galleryImages[newIdx];
      if (img) onSelectImage(img.id);
      return newIdx;
    });
  }, [galleryImages, onSelectImage]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => {
      const newIdx = prev < galleryImages.length - 1 ? prev + 1 : 0;
      const img = galleryImages[newIdx];
      if (img) onSelectImage(img.id);
      return newIdx;
    });
  }, [galleryImages, onSelectImage]);

  const handleThumbnailClick = useCallback((index: number) => {
    setCurrentIndex(index);
    const img = [...mainImages, ...secondaryImages][index];
    if (img) onSelectImage(img.id);
  }, [mainImages, secondaryImages, onSelectImage]);

  return (
    <div className="space-y-6">
      {/* ═══ Main + Secondary Gallery (Amazon Style) ═══ */}
      {galleryImages.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-blue-500 rounded-full" />
            副图 <Badge variant="secondary" className="text-[10px]">{galleryImages.length}张</Badge>
            <span className="text-[10px] text-muted-foreground">（主图+副图）</span>
          </h4>
          
          <div className="flex gap-3">
            {/* Left: Vertical thumbnail strip */}
            <div className="hidden md:flex flex-col gap-1.5 w-[72px] max-h-[480px] overflow-y-auto scrollbar-thin">
              {galleryImages.map((img, idx) => (
                <button
                  key={img.id}
                  className={`relative flex-shrink-0 w-[68px] h-[68px] rounded border-2 overflow-hidden transition-all ${
                    idx === currentIndex
                      ? "border-primary ring-1 ring-primary/30"
                      : "border-transparent hover:border-muted-foreground/30"
                  }`}
                  onClick={() => handleThumbnailClick(idx)}
                >
                  <img
                    src={img.imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {idx === 0 && (
                    <span className="absolute bottom-0 left-0 right-0 bg-blue-500/80 text-white text-[8px] text-center py-0.5">主图</span>
                  )}
                  {idx > 0 && idx <= mainImages.length - 1 && mainImages.length > 1 && (
                    <span className="absolute bottom-0 left-0 right-0 bg-blue-400/70 text-white text-[8px] text-center py-0.5">主图{idx + 1}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Center: Main display area */}
            <div className="flex-1 relative group">
              {currentImage && (
                <>
                  <div
                    className="relative bg-gray-50 rounded-lg overflow-hidden border cursor-pointer"
                    style={{ minHeight: "360px", maxHeight: "480px" }}
                    onClick={() => setLightboxOpen(true)}
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
                    {/* Zoom icon */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="bg-black/40 rounded-full p-2">
                        <ZoomIn className="h-5 w-5 text-white" />
                      </div>
                    </div>
                  </div>

                  {/* Navigation arrows */}
                  {galleryImages.length > 1 && (
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
                    {currentIndex + 1} / {galleryImages.length}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Mobile: Horizontal thumbnail strip */}
          <div className="flex md:hidden gap-1.5 mt-2 overflow-x-auto pb-2">
            {galleryImages.map((img, idx) => (
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

      {/* ═══ Brand Story Images (Vertical) ═══ */}
      {brandStoryImages.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-amber-500 rounded-full" />
            品牌故事 <Badge variant="secondary" className="text-[10px]">{brandStoryImages.length}张</Badge>
          </h4>
          <div className="flex flex-col gap-0 rounded-lg overflow-hidden border">
            {brandStoryImages.map((img, idx) => (
              <div key={img.id} className="relative group/vs">
                <img
                  src={img.imageUrl}
                  alt=""
                  className="w-full object-contain bg-white"
                  loading="lazy"
                />
                {onDeleteImage && (
                  <button
                    className="absolute top-2 right-2 z-10 bg-destructive/90 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover/vs:opacity-100 transition-opacity shadow-sm"
                    onClick={() => { if (confirm("确定删除这张图片？")) onDeleteImage(img.id); }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                {img.aplusModuleType && img.aplusModuleType !== "unknown" && (
                  <Badge className="absolute top-2 left-2 text-[9px] bg-amber-500/80 text-white border-0">
                    {APLUS_MODULE_LABELS[img.aplusModuleType] || img.aplusModuleType}
                  </Badge>
                )}
                {img.singleImageScore && (
                  <Badge className="absolute bottom-2 right-2 text-[9px] bg-primary/80 border-0">
                    {img.singleImageScore}/10
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ A+ Images (Vertical - continuous with brand story) ═══ */}
      {aplusImages.length > 0 && (
        <div className={brandStoryImages.length > 0 ? "-mt-6" : ""}>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <div className="w-1 h-4 bg-purple-500 rounded-full" />
            A+ 图片 <Badge variant="secondary" className="text-[10px]">{aplusImages.length}张</Badge>
          </h4>
          <div className="flex flex-col gap-0 rounded-lg overflow-hidden border">
            {aplusImages.map((img, idx) => (
              <div key={img.id} className="relative group/ap">
                <img
                  src={img.imageUrl}
                  alt=""
                  className="w-full object-contain bg-white"
                  loading="lazy"
                />
                {onDeleteImage && (
                  <button
                    className="absolute top-2 right-2 z-10 bg-destructive/90 hover:bg-destructive text-white rounded-full p-1 opacity-0 group-hover/ap:opacity-100 transition-opacity shadow-sm"
                    onClick={() => { if (confirm("确定删除这张图片？")) onDeleteImage(img.id); }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                {img.aplusModuleType && img.aplusModuleType !== "unknown" && (
                  <Badge className={`absolute top-2 left-2 text-[9px] border-0 backdrop-blur-sm ${
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
            ))}
          </div>
        </div>
      )}

      {/* ═══ Lightbox ═══ */}
      {lightboxOpen && currentImage && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
            onClick={() => setLightboxOpen(false)}
          >
            <X className="h-8 w-8" />
          </button>
          {galleryImages.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 z-10"
                onClick={(e) => { e.stopPropagation(); goToPrev(); }}
              >
                <ChevronLeft className="h-8 w-8" />
              </button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 z-10"
                onClick={(e) => { e.stopPropagation(); goToNext(); }}
              >
                <ChevronRight className="h-8 w-8" />
              </button>
            </>
          )}
          <img
            src={currentImage.imageUrl}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm">
            {currentIndex + 1} / {galleryImages.length}
          </div>
        </div>
      )}
    </div>
  );
}
