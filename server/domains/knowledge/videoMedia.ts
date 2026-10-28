import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { KNOWLEDGE_VIDEO_SECONDS } from "../../../shared/videoLabels";
const exec = promisify(execFile);
const binary = (name: string) =>
  name === "ffmpeg"
    ? process.env.KNOWLEDGE_FFMPEG_PATH || name
    : process.env.KNOWLEDGE_FFPROBE_PATH || name;
/** Extract one local frame only; ffmpeg is never allowed to fetch source URLs. */
export async function videoPoster(source:string,signal?:AbortSignal) {
  const folder=await mkdtemp(path.join(tmpdir(),"kb-poster-"));
  try {
    const destination=path.join(folder,"poster.jpg");
    await mediaCommand("ffmpeg",["-nostdin","-v","error","-threads","1","-protocol_whitelist","file,pipe","-i",source,"-frames:v","1","-vf","scale=1280:720:force_original_aspect_ratio=decrease","-threads","1",destination],signal);
    return await readFile(destination);
  } finally {await rm(folder,{recursive:true,force:true});}
}
export async function mediaCommand(
  name: string,
  args: string[],
  signal?: AbortSignal
) {
  return exec(binary(name), args, {
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 1024 * 1024,
    signal,
  });
}
export async function inspectVideo(file: string, signal?: AbortSignal) {
  const { stdout } = await mediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_entries",
      "format=duration:stream=codec_type,width,height,codec_name",
      "-of",
      "json",
      file,
    ],
    signal
  );
  const info = JSON.parse(stdout),
    duration = Number(info.format?.duration),
    streams = info.streams || [],
    video = streams.find((s: any) => s.codec_type === "video");
  if (
    !video ||
    !Number.isFinite(duration) ||
    duration < 0.2 ||
    duration > KNOWLEDGE_VIDEO_SECONDS ||
    video.width * video.height > 3840 * 2160
  )
    throw new Error("请上传十分钟以内、分辨率不超过 4K 的完整视频");
  return {
    duration,
    width: Number(video.width),
    height: Number(video.height),
    audio: streams.some((s: any) => s.codec_type === "audio"),
    codec: String(video.codec_name),
  };
}
export async function prepareUploadedVideo(
  source: string,
  destination: string,
  signal?: AbortSignal
) {
  const info = await inspectVideo(source, signal);
  const args = [
    "-nostdin",
    "-v",
    "error",
    "-threads",
    "1",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    source,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-t",
    String(KNOWLEDGE_VIDEO_SECONDS),
    "-c:v",
    info.codec === "h264" ? "copy" : "libx264",
  ];
  if (info.codec !== "h264")
    args.push("-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p");
  await mediaCommand(
    "ffmpeg",
    [
      ...args,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-threads",
      "1",
      "-n",
      destination,
    ],
    signal
  );
  return inspectVideo(destination, signal);
}
export async function prepareVideoEvidence(
  source: string,
  signal?: AbortSignal
) {
  const info = await inspectVideo(source, signal),
    folder = await mkdtemp(path.join(tmpdir(), "kb-video-"));
  try {
    // Timestamped samples across the whole clip. Bound CPU, output size and number of model images.
    const interval = Math.max(1, Math.ceil(info.duration / 90));
    await mediaCommand(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        source,
        "-vf",
        `fps=1/${interval},scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2`,
        "-frames:v",
        "90",
        "-threads",
        "1",
        path.join(folder, "%03d.jpg"),
      ],
      signal
    );
    const frames = (await readdir(folder))
      .filter(n => n.endsWith(".jpg"))
      .sort();
    if (!frames.length) throw new Error("未能读取视频画面");
    const sheets: Buffer[] = [];
    for (let offset = 0; offset < frames.length; offset += 12) {
      const batch = frames.slice(offset, offset + 12),
        tiles: Array<{ input: Buffer; left: number; top: number }> = [];
      for (let n = 0; n < batch.length; n++) {
        const left = (n % 3) * 480,
          top = Math.floor(n / 3) * 300,
          time = Math.min(info.duration, (offset + n + 0.5) * interval).toFixed(
            1
          );
        tiles.push({
          input: await readFile(path.join(folder, batch[n])),
          left,
          top,
        });
        tiles.push({
          input: Buffer.from(
            `<svg width="480" height="30"><rect width="480" height="30" fill="white"/><text x="10" y="23" font-size="20" fill="black">${time}s</text></svg>`
          ),
          left,
          top: top + 270,
        });
      }
      sheets.push(
        await sharp({
          create: {
            width: 1440,
            height: Math.ceil(batch.length / 3) * 300,
            channels: 3,
            background: "white",
          },
        })
          .composite(tiles)
          .jpeg({ quality: 83 })
          .toBuffer()
      );
    }
    let audio: Buffer | null = null;
    if (info.audio) {
      const audioPath = path.join(folder, "audio.flac");
      await mediaCommand(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-threads",
          "1",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          source,
          "-vn",
          "-t",
          String(KNOWLEDGE_VIDEO_SECONDS),
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "flac",
          "-threads",
          "1",
          "-n",
          audioPath,
        ],
        signal
      );
      audio = await readFile(audioPath);
    }
    const poster = await sharp(await readFile(path.join(folder, frames[0])))
      .webp({ quality: 88 })
      .toBuffer();
    return { ...info, interval, sheets, audio, poster };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
