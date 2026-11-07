import { useEffect, useRef, useState } from "react";
import { Play, VideoOff } from "lucide-react";
import { type KnowledgeVideo, videoRoleLabel } from "@shared/knowledgeVideos";
import { chineseVideoVtt } from "@shared/competitorVideoAnalysis";

export default function KnowledgeVideoPlayer({
  video,
  seek,
  autoplayOnSeek = true,
}: {
  video: Omit<KnowledgeVideo, "role"> & { role: KnowledgeVideo["role"] | null };
  seek?: { seconds: number; nonce: number };
  autoplayOnSeek?: boolean;
}) {
  const [playing, setPlaying] = useState(false),
    [failed, setFailed] = useState(false),
    [showChinese, setShowChinese] = useState(false),
    [captionUrl, setCaptionUrl] = useState<string>();
  const player = useRef<HTMLVideoElement>(null),
    pending = useRef<number | null>(null);
  const subtitleText = video.analysis
    ? chineseVideoVtt(video.analysis.cues)
    : "";
  useEffect(() => {
    setFailed(false);
  }, [video.videoUrl]);
  const label = video.role ? videoRoleLabel(video.role) : "视频归属待设置";
  useEffect(() => {
    setPlaying(false);
    setFailed(false);
    pending.current = null;
  }, [video.hash]);
  useEffect(() => {
    setShowChinese(false);
    if (
      !video.analysis?.cues.length ||
      typeof URL.createObjectURL !== "function"
    ) {
      setCaptionUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([subtitleText], { type: "text/vtt;charset=utf-8" })
    );
    setCaptionUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video.hash, subtitleText, video.analysis?.cues.length]);
  function syncCaptions() {
    const tracks = player.current?.textTracks;
    if (tracks)
      for (let i = 0; i < tracks.length; i++)
        tracks[i].mode = showChinese ? "showing" : "disabled";
  }
  useEffect(syncCaptions, [showChinese, captionUrl, playing]);
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
      if(autoplayOnSeek){setPlaying(true);applySeek();}
    }
  }, [seek,autoplayOnSeek]);
  if (video.status !== "ready" || !video.videoUrl) return (
      <div aria-label={label} className="flex aspect-video w-full min-w-0 items-center justify-center rounded-lg border bg-white text-sm text-muted-foreground"
      >缺失视频 · {label}</div>
    );
  return (
    <div
      className="w-full min-w-0 max-w-full overflow-hidden rounded-lg bg-slate-950 text-white"
      aria-label={label}
    >
      {playing && !failed ? (
        <video
          ref={player}
          key={video.hash}
          src={video.videoUrl}
          poster={video.posterUrl || undefined}
          controls
          autoPlay
          playsInline
          preload="none"
          onLoadedMetadata={() => {
            applySeek();
            syncCaptions();
          }}
          onCanPlay={applySeek}
          onError={() => setFailed(true)}
          className="block aspect-video max-h-[420px] w-full object-contain"
          aria-label={"播放" + label}
        >
          {captionUrl && (
            <track
              kind="subtitles"
              src={captionUrl}
              srcLang="zh"
              label="中文字幕"
              default={showChinese}
              onLoad={syncCaptions}
        />
          )}
        </video>
      ) : (
        <button
          type="button"
          disabled={failed}
          onClick={() => setPlaying(true)}
          className="relative flex aspect-video max-h-[420px] w-full items-center justify-center"
          aria-label={"播放" + label}
        >
          {video.posterUrl && (
            <img
              src={video.posterUrl}
              alt={label + "封面"}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
          <span className="relative flex flex-col items-center gap-2 rounded-xl bg-black/60 p-4">
            {failed ? (
              <VideoOff className="h-8 w-8" />
            ) : (
              <Play className="h-9 w-9" />
            )}
            <span className="text-sm">
              {failed
                ? "视频暂时无法播放，请刷新重试"
                : "点击播放"}
            </span>
          </span>
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm leading-normal">
        <span>{label}</span>
        {video.analysis && (
          <button
            type="button"
            aria-pressed={showChinese}
            disabled={!video.analysis.cues.length}
            title={video.analysis.notes || "字幕已提前保存，切换无需等待"}
            onClick={() => setShowChinese(!showChinese)}
            className="rounded border border-white/30 px-2 py-1 text-xs disabled:text-white/50"
          >
            {video.analysis.cues.length
              ? showChinese
                ? "隐藏中文字幕"
                : "显示中文字幕"
              : "无可翻译语音或文字"}
          </button>
        )}
        {video.duration != null && (
          <span className="text-white/70">
            {Math.floor(video.duration / 60)}:
            {String(Math.floor(video.duration % 60)).padStart(2, "0")}
          </span>
        )}
      </div>
    </div>
  );
}
