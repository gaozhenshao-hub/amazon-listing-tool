import { useCallback, useEffect, useState } from "react";

type VisualBounds = { minX: number; minY: number; maxX: number; maxY: number; aspectRatio: number };
const CENTERED = "translate(0px, 0px)";

/** Only preview framing changes; the original image is always object-contained. */
export function useBalancedPreviewTransform(imageUrl: string) {
  const [measurement, setMeasurement] = useState<{ imageUrl: string; bounds: VisualBounds | null } | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ element: HTMLDivElement; width: number; height: number } | null>(null);
  // Observe the actual mounted node, including previews mounted after async data.
  const previewRef = useCallback((node: HTMLDivElement | null) => setElement(node), []);

  useEffect(() => {
    if (!element) return;
    const updateSize = () => setSize({ element, width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  useEffect(() => {
    let cancelled = false;
    const clear = () => { if (!cancelled) setMeasurement({ imageUrl, bounds: null }); };
    clear();
    if (!imageUrl) return () => { cancelled = true; };
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onerror = clear;
    image.onload = () => {
      if (cancelled) return;
      try {
        if (!image.naturalWidth || !image.naturalHeight) return clear();
        const scale = Math.min(96 / image.naturalWidth, 96 / image.naturalHeight);
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return clear();
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4;
            const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2], alpha = pixels[offset + 3];
            if (!(alpha > 16 && (Math.min(r, g, b) < 232 || Math.max(r, g, b) - Math.min(r, g, b) > 14))) continue;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          }
        }
        if (maxX < minX || maxY < minY) return clear();
        if (!cancelled) setMeasurement({ imageUrl, bounds: {
          minX: minX / width, minY: minY / height,
          maxX: (maxX + 1) / width, maxY: (maxY + 1) / height,
          aspectRatio: image.naturalWidth / image.naturalHeight,
        } });
      } catch {
        // A CORS/canvas failure is only a framing failure, never an image failure.
        clear();
      }
    };
    image.src = imageUrl;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, [imageUrl]);

  // Keying prevents even the first render of a new URL using the previous image.
  const bounds = measurement?.imageUrl === imageUrl ? measurement.bounds : null;
  const containerSize = size?.element === element ? size : null;
  if (!bounds || !containerSize?.width || !containerSize.height) return { previewRef, transform: CENTERED };
  const renderedWidth = Math.min(containerSize.width, containerSize.height * bounds.aspectRatio);
  const renderedHeight = renderedWidth / bounds.aspectRatio;
  const baseX = (containerSize.width - renderedWidth) / 2;
  const baseY = (containerSize.height - renderedHeight) / 2;
  const desiredX = (0.5 - (bounds.minX + bounds.maxX) / 2) * renderedWidth;
  const desiredY = (0.5 - (bounds.minY + bounds.maxY) / 2) * renderedHeight;
  const offsetX = Math.max(-(baseX + bounds.minX * renderedWidth), Math.min(desiredX, containerSize.width - (baseX + bounds.maxX * renderedWidth)));
  const offsetY = Math.max(-(baseY + bounds.minY * renderedHeight), Math.min(desiredY, containerSize.height - (baseY + bounds.maxY * renderedHeight)));
  return { previewRef, transform: `translate(${Math.round(offsetX)}px, ${Math.round(offsetY)}px)` };
}
