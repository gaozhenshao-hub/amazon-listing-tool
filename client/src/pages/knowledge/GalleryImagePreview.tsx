import { useState, type CSSProperties } from "react";
import { MERGED_READONLY_FEATURES_ENABLED } from "@/lib/mergedReadOnlyFeatures";

type Props = {
  src?: string | null;
  alt: string;
  accessError?: string | null;
  className: string;
  style?: CSSProperties;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
};

function Photo({ src, alt, accessError, className, style, loading = "lazy", fetchPriority }: Props) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div role="img" aria-label={accessError || "图片暂时不可访问"}
      className={`${className} flex items-center justify-center bg-muted text-center text-xs text-muted-foreground`}>
      <span>{accessError || "图片暂时不可访问"}</span>
    </div>;
  }
  return <img src={src} alt={alt} className={className} style={style} loading={loading}
    fetchPriority={fetchPriority} decoding="async" onError={() => setFailed(true)} />;
}

/** URL-keyed failure state; no new signing, fetching or authorization path. */
export function GalleryImagePreview(props: Props) {
  if (!MERGED_READONLY_FEATURES_ENABLED) {
    const { src, alt, className, style, loading, fetchPriority } = props;
    return <img src={src || undefined} alt={alt} className={className} style={style} loading={loading} fetchPriority={fetchPriority} />;
  }
  return <Photo key={props.src || ""} {...props} />;
}
