import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Languages, Maximize2, ImageOff } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import {
  savedImageTranslation,
  type ImageTextRegion,
} from "@shared/richContentPresentation";

function ChineseRegion({
  region,
  style,
}: {
  region: ImageTextRegion;
  style: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      if (!el.clientHeight || !el.clientWidth) return;
      let lo = 6,
        hi = Math.min(
          42,
          Math.max(
            10,
            (el.clientHeight * 0.85) /
              Math.max(1, region.source.split("\n").length)
          )
        );
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (
          el.scrollHeight > el.clientHeight + 1 ||
          el.scrollWidth > el.clientWidth + 1
        )
          hi = mid;
        else lo = mid;
      }
      el.style.fontSize = `${lo}px`;
    };
    fit();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [region.translation, region.source]);
  return (
    <div
      className="absolute overflow-hidden rounded-sm bg-white px-[2px] py-px text-center font-medium leading-[1.15] text-slate-950 shadow-sm"
      style={style}
      title={`${region.source}\n${region.translation}${region.confidence === "uncertain" ? "\n此处原文需核对" : ""}`}
    >
      <div
        ref={ref}
        className="flex h-full w-full items-center justify-center whitespace-pre-wrap break-words"
        style={{ fontSize: "clamp(8px,1vw,18px)" }}
      >
        {region.translation}
      </div>
    </div>
  );
}

/** All translation data is prepared server-side. Buttons only change local visibility. */
export function PreparedImage({
  src,
  alt,
  translation,
  sourceHash,
  contentHash,
  className = "",
  imageClassName = "block h-auto w-full",
  imageStyle,
  accessError,
  loading = "lazy",
  fetchPriority,
  openLabel,
  onOpen,
  controls = true,
  expandable = true,
  initialChinese = false,
}: {
  src?: string | null;
  alt: string;
  translation?: unknown;
  sourceHash?: string | null;
  contentHash?: string | null;
  className?: string;
  imageClassName?: string;
  imageStyle?: CSSProperties;
  accessError?: string | null;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  openLabel?: string;
  onOpen?: () => void;
  controls?: boolean;
  expandable?: boolean;
  initialChinese?: boolean;
}) {
  const saved = savedImageTranslation(translation, sourceHash, contentHash),
    [chinese, setChinese] = useState(initialChinese),
    [expanded, setExpanded] = useState(false),
    [failed, setFailed] = useState(false),
    [geometry, setGeometry] = useState<{
      left: number;
      top: number;
      width: number;
      height: number;
    } | null>(null);
  const host = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null);
  useEffect(() => setFailed(false), [src]);
  useEffect(
    () => setChinese(initialChinese),
    [src, sourceHash, contentHash, initialChinese]
  );
  useLayoutEffect(() => {
    const measure = () => {
      const el = image.current,
        root = host.current;
      if (!el || !root || !el.naturalWidth || !el.naturalHeight) return;
      const box = el.getBoundingClientRect(),
        parent = root.getBoundingClientRect(),
        computed = getComputedStyle(el),
        factorX = el.offsetWidth ? box.width / el.offsetWidth : 1,
        factorY = el.offsetHeight ? box.height / el.offsetHeight : 1,
        edge = (name: string, factor: number) =>
          (parseFloat(computed.getPropertyValue(name)) || 0) * factor,
        left =
          edge("padding-left", factorX) + edge("border-left-width", factorX),
        right =
          edge("padding-right", factorX) + edge("border-right-width", factorX),
        top = edge("padding-top", factorY) + edge("border-top-width", factorY),
        bottom =
          edge("padding-bottom", factorY) +
          edge("border-bottom-width", factorY),
        innerWidth = Math.max(0, box.width - left - right),
        innerHeight = Math.max(0, box.height - top - bottom),
        scale = Math.min(
          innerWidth / el.naturalWidth,
          innerHeight / el.naturalHeight
        ),
        width = el.naturalWidth * scale,
        height = el.naturalHeight * scale;
      setGeometry({
        left: box.left - parent.left + left + (innerWidth - width) / 2,
        top: box.top - parent.top + top + (innerHeight - height) / 2,
        width,
        height,
      });
    };
    const el = image.current;
    el?.addEventListener("load", measure);
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (host.current) observer?.observe(host.current);
    return () => {
      el?.removeEventListener("load", measure);
      observer?.disconnect();
    };
  }, [src, failed, imageStyle?.transform]);
  const ready = Boolean(saved?.regions.length),
    note =
      saved?.notes ||
      (!saved
        ? "翻译尚未准备完成"
        : saved.status === "no_text"
          ? "图片没有可辨认文字"
          : saved.status === "unreadable"
            ? "图片文字无法辨认"
            : "");
  const photo = (
    <img
      ref={image}
      src={src || undefined}
      alt={alt}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      style={imageStyle}
      className={`${imageClassName} object-contain`}
      onError={() => setFailed(true)}
    />
  );
  return (
    <>
      <div
        ref={host}
        className={`relative min-w-0 ${className}`}
        data-testid="prepared-image"
        data-source-hash={sourceHash || undefined}
      >
        {!src || failed ? (
          <div
            role="img"
            aria-label={accessError || "图片暂时不可访问"}
            className="flex min-h-32 items-center justify-center gap-2 bg-muted text-sm text-muted-foreground"
          >
            <ImageOff size={18} />
            {accessError || "图片暂时不可访问"}
          </div>
        ) : onOpen ? (
          <button
            type="button"
            aria-label={openLabel || alt}
            className="block h-full w-full cursor-zoom-in"
            onClick={onOpen}
          >
            {photo}
          </button>
        ) : (
          photo
        )}
        {chinese && saved && ready && (
          <div
            aria-label="预先保存的中文译图"
            className="pointer-events-none absolute"
            style={
              geometry
                ? {
                    left: geometry.left,
                    top: geometry.top,
                    width: geometry.width,
                    height: geometry.height,
                  }
                : { inset: 0 }
            }
          >
            {saved.regions.map((r, i) => (
              <ChineseRegion
                key={i}
                region={r}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.width * 100}%`,
                  height: `${r.height * 100}%`,
                }}
              />
            ))}
          </div>
        )}
        {controls && src && !failed && (
          <div className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-16px)] flex-wrap gap-2">
            {saved?.status !== "excluded_background" && (
              <button
                type="button"
                aria-pressed={chinese}
                disabled={!ready}
                title={note || "翻译已提前保存，点击只切换显示"}
                className="inline-flex items-center gap-1 rounded-md border bg-white/95 px-2 py-1 text-xs font-medium text-slate-800 shadow-sm disabled:cursor-default disabled:text-slate-500"
                onClick={event => {
                  event.stopPropagation();
                  setChinese(!chinese);
                }}
              >
                <Languages size={14} />
                {ready
                  ? chinese
                    ? "显示原图"
                    : saved?.status === "partial"
                      ? "显示已识别中文"
                      : "显示中文"
                  : saved?.status === "no_text"
                    ? "无图片文字"
                    : "中文未准备"}
              </button>
            )}
            {expandable && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border bg-white/95 px-2 py-1 text-xs text-slate-800 shadow-sm"
                onClick={event => {
                  event.stopPropagation();
                  setExpanded(true);
                }}
              >
                <Maximize2 size={14} />
                放大查看
              </button>
            )}
          </div>
        )}
        {chinese && note && (
          <span
            role="status"
            className="absolute left-2 right-2 top-2 rounded bg-amber-50/95 px-2 py-1 text-xs leading-normal text-amber-900"
          >
            {note}
          </span>
        )}
      </div>
      {expanded && (
        <Dialog open onOpenChange={setExpanded}>
          <DialogContent
            className="max-h-[96vh] max-w-[96vw] overflow-auto p-4"
            aria-describedby={undefined}
          >
            <DialogTitle>{alt}</DialogTitle>
            <PreparedImage
              src={src}
              alt={alt}
              translation={saved}
              sourceHash={sourceHash}
              imageClassName="mx-auto block h-auto max-h-[84vh] max-w-full"
              loading="eager"
              expandable={false}
              initialChinese={chinese}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
