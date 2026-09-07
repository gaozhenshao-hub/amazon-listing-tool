import { ImageOff, RefreshCw } from "lucide-react";
import { useState } from "react";

type KnowledgeImagePreviewProps = {
  src?: string | null;
  alt: string;
  className: string;
  fallbackClassName?: string;
  accessError?: string | null;
  loading?: "eager" | "lazy";
};

export function KnowledgeImagePreview({
  src,
  alt,
  className,
  fallbackClassName = "",
  accessError,
  loading = "lazy",
}: KnowledgeImagePreviewProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (!src || loadFailed) {
    return (
      <div
        className={`flex min-h-0 min-w-0 flex-col items-center justify-center gap-1 bg-muted px-3 text-center text-muted-foreground ${fallbackClassName}`}
        role="img"
        aria-label={accessError || "图片暂时不可访问"}
      >
        <ImageOff className="h-5 w-5 opacity-60" aria-hidden="true" />
        <span className="text-[11px] leading-4">{accessError || "图片暂时不可访问"}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            window.location.reload();
          }}
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          重新加载
        </button>
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} loading={loading} onError={() => setLoadFailed(true)} />;
}
