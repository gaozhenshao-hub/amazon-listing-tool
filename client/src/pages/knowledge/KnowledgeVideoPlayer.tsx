import { useEffect, useRef, useState } from "react";
import { Play, VideoOff } from "lucide-react";
import { type KnowledgeVideo, videoRoleLabel } from "@shared/knowledgeVideos";

export default function KnowledgeVideoPlayer({
  video,
  seek,
}: {
  video: Omit<KnowledgeVideo, "role"> & { role: KnowledgeVideo["role"] | null };
  seek?: { seconds: number; nonce: number };
}) {
  const [playing, setPlaying] = useState(false),
    [failed, setFailed] = useState(false);
  const player = useRef<HTMLVideoElement>(null),
    pending = useRef<number | null>(null);
  const label = video.role ? videoRoleLabel(video.role) : "视频归属待设置";
  useEffect(() => {
    setPlaying(false);
    setFailed(false);
    pending.current = null;
  }, [video.hash]);
  function applySeek() {
    const element = player.current;
    if (!element || pending.current === null || !element.readyState) return;
    element.currentTime = Math.min(
      pending.current,
      Math.max(0, (element.duration || Infinity) - 0.05)
    );
    pending.current = null;
    void element.play().catch(() => {});
  }
  useEffect(() => {
    if (seek) {
      pending.current = Math.max(0, seek.seconds);
      setPlaying(true);
      applySeek();
    }
  }, [seek]);
  if (video.status !== "ready" || !video.videoUrl) return <div aria-label={label} className="flex aspect-video w-full items-center justify-center rounded-lg border bg-white text-sm text-muted-foreground">缺失视频 · {label}</div>;
  return (
    <div
      className="overflow-hidden rounded-lg bg-slate-950 text-white"
      aria-label={label}
    >
      {playing && video.videoUrl && !failed ? (
        <video
          ref={player}
          key={video.hash}
          src={video.videoUrl}
          poster={video.posterUrl || undefined}
          controls
          autoPlay
          playsInline
          preload="none"
          onLoadedMetadata={applySeek}
          onCanPlay={applySeek}
          onError={() => setFailed(true)}
          className="aspect-video max-h-[540px] w-full object-contain"
          aria-label={`播放${label}`}
        />
      ) : (
        <button
          type="button"
          disabled={video.status !== "ready" || failed}
          onClick={() => setPlaying(true)}
          className="relative flex aspect-video w-full items-center justify-center"
          aria-label={`播放${label}`}
        >
          {video.posterUrl && (
            <img
              src={video.posterUrl}
              alt={`${label}封面`}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
          <span className="relative flex flex-col items-center gap-2 rounded-xl bg-black/60 p-4">
            {video.status === "ready" && !failed ? (
              <Play className="h-9 w-9" />
            ) : (
              <VideoOff className="h-8 w-8" />
            )}
            <span className="text-sm">
              {failed
                ? "视频暂时无法播放，请刷新重试"
                : video.status === "ready"
                  ? "点击播放"
                  : "视频未取得，可重新采集"}
            </span>
          </span>
        </button>
      )}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm leading-normal">
        <span>{label}</span>
        {video.duration != null && (
          <span className="text-white/70">
            {Math.floor(video.duration / 60)}:
            {String(Math.round(video.duration % 60)).padStart(2, "0")}
          </span>
        )}
      </div>
    </div>
  );
}
